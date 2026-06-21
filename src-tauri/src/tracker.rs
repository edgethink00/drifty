#[cfg(target_os = "macos")]
use core_foundation::base::Boolean;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{mpsc, Mutex, OnceLock};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use thiserror::Error;

use crate::app_icons::{app_identity_key, resolve_app_icon_data};

#[cfg(target_os = "macos")]
#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> Boolean;
}

#[derive(Debug, Default, Clone, Copy)]
pub struct TrackerController;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppIdentity {
    pub app_name: String,
    pub bundle_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackerStatus {
    pub running: bool,
    pub accessibility_granted: bool,
    pub last_event_at: Option<String>,
    pub database_path: Option<String>,
    pub tracker_mode: Option<String>,
    pub idle_seconds: Option<f64>,
    pub idle_detection_available: Option<bool>,
    pub message: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SidecarEnvelope<T> {
    ok: bool,
    data: Option<T>,
    error: Option<String>,
}

#[derive(Debug, Error)]
pub enum TrackerError {
    #[error("tracker script missing at {0}")]
    MissingScript(String),
    #[error("tracker invocation failed: {0}")]
    CommandFailed(String),
    #[error("tracker returned invalid JSON: {0}")]
    ParseFailed(String),
    #[error("tracker returned an error: {0}")]
    TrackerReturnedError(String),
    #[error("tracker returned no data")]
    MissingData,
}

impl TrackerController {
    pub fn get_status(&self, app: &AppHandle) -> Result<TrackerStatus, TrackerError> {
        let mut status = self.invoke::<TrackerStatus>(app, "get_status", json!({}))?;
        status.accessibility_granted = merged_accessibility_granted(
            status.accessibility_granted,
            current_process_accessibility_trusted(),
        );
        Ok(status)
    }

    pub fn start(&self, app: &AppHandle) -> Result<TrackerStatus, TrackerError> {
        self.invoke::<TrackerStatus>(app, "start_tracking", json!({}))
    }

    pub fn stop(&self, app: &AppHandle) -> Result<TrackerStatus, TrackerError> {
        self.invoke::<TrackerStatus>(app, "stop_tracking", json!({}))
    }

    pub fn get_timeline(
        &self,
        app: &AppHandle,
        day: Option<String>,
        start: Option<String>,
        end: Option<String>,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(app, "get_timeline", build_period_payload(day, start, end))
    }

    pub fn get_dashboard_week_timeline(
        &self,
        app: &AppHandle,
        start: Option<String>,
        end: Option<String>,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(
            app,
            "get_dashboard_week_timeline",
            build_dashboard_week_timeline_payload(start, end),
        )
    }

    pub fn get_live_tail(
        &self,
        app: &AppHandle,
        start: Option<String>,
        end: Option<String>,
        after_segment_id: Option<String>,
        after_ended_at: Option<String>,
        limit: Option<u32>,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(
            app,
            "get_live_tail",
            build_live_tail_payload(start, end, after_segment_id, after_ended_at, limit),
        )
    }

    pub fn get_current_snapshot(&self, app: &AppHandle) -> Result<Value, TrackerError> {
        self.invoke::<Value>(app, "get_current_snapshot", json!({}))
    }

    pub fn set_developer_diagnostics(
        &self,
        app: &AppHandle,
        force_chromium_ax_capture: bool,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(
            app,
            "set_developer_diagnostics",
            json!({ "forceChromiumAxCapture": force_chromium_ax_capture }),
        )
    }

    pub fn get_hourly_summary(
        &self,
        app: &AppHandle,
        day: Option<String>,
        start: Option<String>,
        end: Option<String>,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(
            app,
            "get_hourly_summary",
            build_period_payload(day, start, end),
        )
    }

    pub fn get_raw_events(
        &self,
        app: &AppHandle,
        day: Option<String>,
        start: Option<String>,
        end: Option<String>,
        app_name: Option<String>,
        limit: Option<u32>,
    ) -> Result<Value, TrackerError> {
        let mut payload = build_period_payload(day, start, end);
        if let Some(payload_object) = payload.as_object_mut() {
            payload_object.insert("appName".into(), json!(app_name));
            payload_object.insert("limit".into(), json!(limit.unwrap_or(50)));
        }
        self.invoke::<Value>(app, "get_raw_events", payload)
    }

    pub fn get_top_sites(
        &self,
        app: &AppHandle,
        day: Option<String>,
        start: Option<String>,
        end: Option<String>,
        limit: Option<u32>,
    ) -> Result<Value, TrackerError> {
        let mut payload = build_period_payload(day, start, end);
        if let Some(payload_object) = payload.as_object_mut() {
            payload_object.insert("limit".into(), json!(limit.unwrap_or(10)));
        }
        self.invoke::<Value>(app, "get_top_sites", payload)
    }

    pub fn get_unclassified_segments(
        &self,
        app: &AppHandle,
        day: Option<String>,
        start: Option<String>,
        end: Option<String>,
        limit: Option<u32>,
    ) -> Result<Value, TrackerError> {
        let mut payload = build_period_payload(day, start, end);
        if let Some(payload_object) = payload.as_object_mut() {
            payload_object.insert("limit".into(), json!(limit.unwrap_or(50)));
        }
        self.invoke::<Value>(app, "get_unclassified_segments", payload)
    }

    pub fn get_reusable_ai_classifications(
        &self,
        app: &AppHandle,
        input_fingerprints: Vec<String>,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(
            app,
            "get_reusable_ai_classifications",
            json!({ "inputFingerprints": input_fingerprints }),
        )
    }

    pub fn get_classification_rules(&self, app: &AppHandle) -> Result<Value, TrackerError> {
        self.invoke::<Value>(app, "get_classification_rules", json!({}))
    }

    pub fn save_classification_rule(
        &self,
        app: &AppHandle,
        input: Value,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(app, "save_classification_rule", json!({ "input": input }))
    }

    pub fn delete_classification_rule(
        &self,
        app: &AppHandle,
        id: String,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(app, "delete_classification_rule", json!({ "id": id }))
    }

    pub fn delete_activity_segments(
        &self,
        app: &AppHandle,
        ids: Vec<String>,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(
            app,
            "delete_activity_segments",
            build_delete_activity_segments_payload(&ids),
        )
    }

    pub fn search_classification_rule_candidates(
        &self,
        app: &AppHandle,
        query: String,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(
            app,
            "search_classification_rule_candidates",
            json!({ "query": query }),
        )
    }

    pub fn apply_classification_rules(
        &self,
        app: &AppHandle,
        day: Option<String>,
        start: Option<String>,
        end: Option<String>,
        limit: Option<u32>,
    ) -> Result<Value, TrackerError> {
        let mut payload = build_period_payload(day, start, end);
        if let Some(payload_object) = payload.as_object_mut() {
            payload_object.insert("limit".into(), json!(limit));
        }
        self.invoke::<Value>(app, "apply_classification_rules", payload)
    }

    pub fn save_classifications(
        &self,
        app: &AppHandle,
        classifications: Value,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(
            app,
            "save_classifications",
            json!({ "classifications": classifications }),
        )
    }

    pub fn refresh_non_ai_classifications(
        &self,
        app: &AppHandle,
        day: Option<String>,
        start: Option<String>,
        end: Option<String>,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(
            app,
            "refresh_non_ai_classifications",
            build_period_payload(day, start, end),
        )
    }

    pub fn get_classification_metrics(
        &self,
        app: &AppHandle,
        day: Option<String>,
        start: Option<String>,
        end: Option<String>,
        limit: Option<u32>,
    ) -> Result<Value, TrackerError> {
        let mut payload = build_period_payload(day, start, end);
        if let Some(payload_object) = payload.as_object_mut() {
            payload_object.insert("limit".into(), json!(limit.unwrap_or(50)));
        }
        self.invoke::<Value>(app, "get_classification_metrics", payload)
    }

    pub fn get_daily_stats(&self, app: &AppHandle) -> (f64, f64, f64) {
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        let timeline = match self.get_timeline(app, Some(today), None, None) {
            Ok(v) => v,
            Err(_) => return (0.0, 0.0, 0.0),
        };
        let segments = match timeline.as_array() {
            Some(v) => v,
            None => return (0.0, 0.0, 0.0),
        };

        let mut focus_secs = 0.0f64;
        let mut drift_secs = 0.0f64;
        let mut neutral_secs = 0.0f64;

        for seg in segments {
            let duration = seg
                .get("durationSeconds")
                .or_else(|| seg.get("duration_seconds"))
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0);
            let productivity = seg
                .get("productivity")
                .or_else(|| {
                    seg.get("classification")
                        .and_then(|c| c.get("productivity"))
                })
                .and_then(|v| v.as_str())
                .unwrap_or("neutral");
            match productivity {
                "focus" => focus_secs += duration,
                "drift" => drift_secs += duration,
                _ => neutral_secs += duration,
            }
        }

        let total = focus_secs + drift_secs + neutral_secs;
        if total < 1.0 {
            return (0.0, 0.0, 0.0);
        }
        (focus_secs / total, drift_secs / total, neutral_secs / total)
    }

    pub fn get_app_icons(
        &self,
        app: &AppHandle,
        apps: &[AppIdentity],
    ) -> Result<Value, TrackerError> {
        let mut icons = serde_json::Map::new();
        for identity in apps {
            let key = app_identity_key(identity);
            let icon = resolve_app_icon_data(app, identity)?;
            icons.insert(key, icon.map(Value::String).unwrap_or(Value::Null));
        }
        Ok(Value::Object(icons))
    }

    fn invoke<T: for<'de> Deserialize<'de>>(
        &self,
        app: &AppHandle,
        command: &str,
        payload: Value,
    ) -> Result<T, TrackerError> {
        let config = tracker_sidecar_config(app)?;
        let request = json!({
            "command": command,
            "payload": payload,
        });

        let mut client = tracker_sidecar().lock().map_err(|err| {
            TrackerError::CommandFailed(format!("tracker sidecar lock failed: {err}"))
        })?;
        invoke_sidecar(&mut client, config, request)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct TrackerSidecarConfig {
    python_bin: String,
    script_path: PathBuf,
    db_path: PathBuf,
}

const TRACKER_SIDECAR_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug)]
struct TrackerSidecarClient {
    config: Option<TrackerSidecarConfig>,
    process: Option<TrackerSidecarProcess>,
    request_timeout: Duration,
}

#[derive(Debug)]
struct TrackerSidecarProcess {
    child: Child,
    stdin: ChildStdin,
    stdout: Option<BufReader<ChildStdout>>,
}

impl Default for TrackerSidecarClient {
    fn default() -> Self {
        Self {
            config: None,
            process: None,
            request_timeout: TRACKER_SIDECAR_REQUEST_TIMEOUT,
        }
    }
}

impl TrackerSidecarClient {
    fn request(
        &mut self,
        config: TrackerSidecarConfig,
        request: &Value,
    ) -> Result<String, TrackerError> {
        self.prepare_config(config);
        let request_line = serde_json::to_string(request)
            .map_err(|err| TrackerError::ParseFailed(err.to_string()))?;
        self.write_request_line(&request_line)?;
        self.read_response_line()
    }

    fn write_request_line(&mut self, request_line: &str) -> Result<(), TrackerError> {
        let write_result = {
            let process = self.ensure_running()?;
            writeln!(process.stdin, "{request_line}").and_then(|_| process.stdin.flush())
        };

        if let Err(err) = write_result {
            self.clear_process();
            return Err(TrackerError::CommandFailed(format!(
                "tracker sidecar write failed: {err}; process will be restarted on the next request"
            )));
        }

        Ok(())
    }

    fn read_response_line(&mut self) -> Result<String, TrackerError> {
        let timeout = self.request_timeout;
        let stdout = {
            let process = self.process.as_mut().ok_or_else(|| {
                TrackerError::CommandFailed("tracker sidecar process missing".into())
            })?;
            process.stdout.take().ok_or_else(|| {
                TrackerError::CommandFailed("tracker sidecar stdout reader missing".into())
            })?
        };

        let (sender, receiver) = mpsc::channel();
        thread::spawn(move || {
            let mut stdout = stdout;
            let mut response_line = String::new();
            let result = match stdout.read_line(&mut response_line) {
                Ok(0) => Err(TrackerError::CommandFailed(
                    "tracker sidecar closed stdout before sending a response; process will be restarted on the next request"
                        .into(),
                )),
                Ok(_) => Ok(response_line),
                Err(err) => Err(TrackerError::CommandFailed(format!(
                    "tracker sidecar read failed: {err}; process will be restarted on the next request"
                ))),
            };
            let _ = sender.send((stdout, result));
        });

        match receiver.recv_timeout(timeout) {
            Ok((stdout, Ok(response_line))) => {
                let process = self.process.as_mut().ok_or_else(|| {
                    TrackerError::CommandFailed("tracker sidecar process missing".into())
                })?;
                process.stdout = Some(stdout);
                Ok(response_line)
            }
            Ok((_stdout, Err(error))) => {
                self.clear_process();
                Err(error)
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                self.clear_process();
                Err(TrackerError::CommandFailed(format!(
                    "tracker sidecar timed out after {}ms; process will be restarted on the next request",
                    timeout.as_millis()
                )))
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                self.clear_process();
                Err(TrackerError::CommandFailed(
                    "tracker sidecar response reader failed; process will be restarted on the next request"
                        .into(),
                ))
            }
        }
    }

    fn prepare_config(&mut self, config: TrackerSidecarConfig) {
        if self.config.as_ref() == Some(&config) {
            return;
        }

        self.clear_process();
        self.config = Some(config);
    }

    fn ensure_running(&mut self) -> Result<&mut TrackerSidecarProcess, TrackerError> {
        if self.process_is_dead()? {
            self.clear_process();
        }

        if self.process.is_none() {
            let config = self.config.as_ref().ok_or_else(|| {
                TrackerError::CommandFailed("tracker sidecar configuration missing".into())
            })?;
            self.process = Some(spawn_sidecar(config)?);
        }

        self.process
            .as_mut()
            .ok_or_else(|| TrackerError::CommandFailed("tracker sidecar failed to start".into()))
    }

    fn process_is_dead(&mut self) -> Result<bool, TrackerError> {
        let Some(process) = self.process.as_mut() else {
            return Ok(false);
        };

        process
            .child
            .try_wait()
            .map(|status| status.is_some())
            .map_err(|err| {
                TrackerError::CommandFailed(format!("tracker sidecar status check failed: {err}"))
            })
    }

    fn clear_process(&mut self) {
        let Some(mut process) = self.process.take() else {
            return;
        };

        let _ = process.child.kill();
        let _ = process.child.wait();
    }

    #[cfg(test)]
    fn kill_child_for_test(&mut self) -> Result<(), TrackerError> {
        let Some(process) = self.process.as_mut() else {
            return Err(TrackerError::CommandFailed(
                "tracker sidecar test child missing".into(),
            ));
        };

        process
            .child
            .kill()
            .map_err(|err| TrackerError::CommandFailed(err.to_string()))?;
        process
            .child
            .wait()
            .map_err(|err| TrackerError::CommandFailed(err.to_string()))?;
        Ok(())
    }
}

impl Drop for TrackerSidecarClient {
    fn drop(&mut self) {
        self.clear_process();
    }
}

fn tracker_sidecar() -> &'static Mutex<TrackerSidecarClient> {
    static SIDECAR: OnceLock<Mutex<TrackerSidecarClient>> = OnceLock::new();
    SIDECAR.get_or_init(|| Mutex::new(TrackerSidecarClient::default()))
}

fn tracker_sidecar_config(app: &AppHandle) -> Result<TrackerSidecarConfig, TrackerError> {
    let script_path = resolve_tracker_script(app);
    if !script_path.exists() {
        return Err(TrackerError::MissingScript(
            script_path.display().to_string(),
        ));
    }

    Ok(TrackerSidecarConfig {
        python_bin: resolve_python_bin(),
        script_path,
        db_path: resolve_db_path(app),
    })
}

fn invoke_sidecar<T: for<'de> Deserialize<'de>>(
    client: &mut TrackerSidecarClient,
    config: TrackerSidecarConfig,
    request: Value,
) -> Result<T, TrackerError> {
    let response_line = client.request(config, &request)?;
    let envelope = serde_json::from_str::<SidecarEnvelope<T>>(response_line.trim_end())
        .map_err(|err| TrackerError::ParseFailed(err.to_string()))?;

    if !envelope.ok {
        return Err(TrackerError::TrackerReturnedError(
            envelope
                .error
                .unwrap_or_else(|| "unknown tracker error".into()),
        ));
    }

    envelope.data.ok_or(TrackerError::MissingData)
}

fn spawn_sidecar(config: &TrackerSidecarConfig) -> Result<TrackerSidecarProcess, TrackerError> {
    let mut child = Command::new(&config.python_bin)
        .arg(&config.script_path)
        .arg("serve")
        .arg("--db")
        .arg(&config.db_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|err| {
            TrackerError::CommandFailed(format!("tracker sidecar spawn failed: {err}"))
        })?;

    let stdin = match child.stdin.take() {
        Some(stdin) => stdin,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(TrackerError::CommandFailed(
                "tracker sidecar stdin pipe unavailable".into(),
            ));
        }
    };
    let stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(TrackerError::CommandFailed(
                "tracker sidecar stdout pipe unavailable".into(),
            ));
        }
    };

    Ok(TrackerSidecarProcess {
        child,
        stdin,
        stdout: Some(BufReader::new(stdout)),
    })
}

fn build_period_payload(day: Option<String>, start: Option<String>, end: Option<String>) -> Value {
    let mut payload = serde_json::Map::new();

    if let Some(day) = day {
        payload.insert("day".into(), json!(day));
    }

    if let Some(start) = start {
        payload.insert("start".into(), json!(start));
    }

    if let Some(end) = end {
        payload.insert("end".into(), json!(end));
    }

    Value::Object(payload)
}

fn build_dashboard_week_timeline_payload(start: Option<String>, end: Option<String>) -> Value {
    build_period_payload(None, start, end)
}

fn build_live_tail_payload(
    start: Option<String>,
    end: Option<String>,
    after_segment_id: Option<String>,
    after_ended_at: Option<String>,
    limit: Option<u32>,
) -> Value {
    let mut payload = build_period_payload(None, start, end);

    if let Some(payload_object) = payload.as_object_mut() {
        if let Some(after_segment_id) = after_segment_id {
            payload_object.insert("afterSegmentId".into(), json!(after_segment_id));
        }
        if let Some(after_ended_at) = after_ended_at {
            payload_object.insert("afterEndedAt".into(), json!(after_ended_at));
        }
        payload_object.insert("limit".into(), json!(limit.unwrap_or(8)));
    }

    payload
}

fn build_delete_activity_segments_payload(ids: &[String]) -> Value {
    json!({ "ids": ids })
}

fn merged_accessibility_granted(python_granted: bool, native_granted: Option<bool>) -> bool {
    match native_granted {
        Some(value) => value,
        None => python_granted,
    }
}

fn core_foundation_boolean_to_bool(value: u8) -> bool {
    value != 0
}

#[cfg(target_os = "macos")]
fn current_process_accessibility_trusted() -> Option<bool> {
    Some(core_foundation_boolean_to_bool(unsafe {
        AXIsProcessTrusted()
    }))
}

#[cfg(not(target_os = "macos"))]
fn current_process_accessibility_trusted() -> Option<bool> {
    None
}

fn resolve_python_bin() -> String {
    if let Ok(path) = std::env::var("DRIFTY_PYTHON_BIN") {
        return path;
    }

    let system_python = PathBuf::from("/usr/bin/python3");
    if system_python.exists() {
        return system_python.display().to_string();
    }

    "python3".to_string()
}

fn resolve_tracker_script(app: &AppHandle) -> PathBuf {
    if let Ok(path) = std::env::var("DRIFTY_TRACKER_SCRIPT") {
        return PathBuf::from(path);
    }

    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let mut candidates = Vec::new();

    for base in cwd.ancestors().take(4) {
        candidates.push(
            base.join("services")
                .join("tracker-python")
                .join("app")
                .join("main.py"),
        );
        candidates.push(
            base.join("resources")
                .join("tracker-python")
                .join("app")
                .join("main.py"),
        );
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.extend(tracker_script_resource_candidates(&resource_dir));
    }

    for candidate in candidates {
        if candidate.exists() {
            return candidate;
        }
    }

    cwd.join("services")
        .join("tracker-python")
        .join("app")
        .join("main.py")
}

fn tracker_script_resource_candidates(resource_dir: &Path) -> Vec<PathBuf> {
    vec![
        resource_dir
            .join("tracker-python")
            .join("app")
            .join("main.py"),
        resource_dir
            .join("services")
            .join("tracker-python")
            .join("app")
            .join("main.py"),
        resource_dir
            .join("_up_")
            .join("services")
            .join("tracker-python")
            .join("app")
            .join("main.py"),
    ]
}

fn resolve_db_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_local_data_dir()
        .unwrap_or_else(|_| {
            std::env::current_dir()
                .unwrap_or_else(|_| PathBuf::from("."))
                .join(".omx")
                .join("runtime")
        })
        .join("tracker.sqlite3")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tracker_status_serializes_to_camel_case() {
        let status = TrackerStatus {
            running: true,
            accessibility_granted: false,
            last_event_at: None,
            database_path: Some("tracker.sqlite3".into()),
            tracker_mode: Some("tracking".into()),
            idle_seconds: Some(12.5),
            idle_detection_available: Some(true),
            message: Some("ok".into()),
        };

        let value = serde_json::to_value(status).expect("serializes");
        assert!(value.get("running").is_some());
        assert!(value.get("databasePath").is_some());
        assert!(value.get("trackerMode").is_some());
        assert!(value.get("idleSeconds").is_some());
        assert!(value.get("idleDetectionAvailable").is_some());
    }

    #[test]
    fn delete_activity_segments_payload_preserves_selected_ids() {
        let payload = build_delete_activity_segments_payload(&["42".into(), "43".into()]);

        assert_eq!(payload, json!({ "ids": ["42", "43"] }));
    }

    #[test]
    fn live_tail_payload_preserves_range_cursor_and_default_limit() {
        let payload = build_live_tail_payload(
            Some("2026-04-06T00:00:00".into()),
            Some("2026-04-06T23:59:59".into()),
            Some("42".into()),
            Some("2026-04-06T09:05:00+00:00".into()),
            None,
        );

        assert_eq!(
            payload,
            json!({
                "start": "2026-04-06T00:00:00",
                "end": "2026-04-06T23:59:59",
                "afterSegmentId": "42",
                "afterEndedAt": "2026-04-06T09:05:00+00:00",
                "limit": 8
            })
        );
    }

    #[test]
    fn dashboard_week_timeline_payload_preserves_range() {
        let payload = build_dashboard_week_timeline_payload(
            Some("2026-04-01T00:00:00".into()),
            Some("2026-04-07T23:59:59".into()),
        );

        assert_eq!(
            payload,
            json!({
                "start": "2026-04-01T00:00:00",
                "end": "2026-04-07T23:59:59",
            })
        );
    }

    #[test]
    fn tracker_script_resource_candidates_include_tauri_bundle_layout() {
        let resource_dir = PathBuf::from("/Applications/Drifty.app/Contents/Resources");
        let candidates = tracker_script_resource_candidates(&resource_dir);

        assert!(candidates.contains(
            &resource_dir
                .join("tracker-python")
                .join("app")
                .join("main.py")
        ));
        assert!(candidates.contains(
            &resource_dir
                .join("services")
                .join("tracker-python")
                .join("app")
                .join("main.py")
        ));
        assert!(candidates.contains(
            &resource_dir
                .join("_up_")
                .join("services")
                .join("tracker-python")
                .join("app")
                .join("main.py")
        ));
    }

    #[test]
    fn native_accessibility_granted_is_authoritative_when_available() {
        assert!(merged_accessibility_granted(false, Some(true)));
        assert!(!merged_accessibility_granted(true, Some(false)));
    }

    #[test]
    fn core_foundation_boolean_values_convert_to_rust_bool() {
        assert!(!core_foundation_boolean_to_bool(0));
        assert!(core_foundation_boolean_to_bool(1));
        assert!(core_foundation_boolean_to_bool(255));
    }

    #[test]
    fn native_unavailable_preserves_python_fallback_value() {
        assert!(!merged_accessibility_granted(false, None));
        assert!(merged_accessibility_granted(true, None));
    }

    #[test]
    fn sidecar_line_protocol_reuses_one_process_for_multiple_requests() {
        let script_path = write_fake_sidecar_script(
            r#"
import json
import os
import sys

for raw in sys.stdin:
    request = json.loads(raw)
    print(json.dumps({
        "ok": True,
        "data": {
            "pid": os.getpid(),
            "command": request["command"],
            "payload": request.get("payload", {}),
        },
        "error": None,
    }), flush=True)
"#,
        );
        let config = fake_sidecar_config(&script_path);
        let mut client = TrackerSidecarClient::default();

        let first = invoke_sidecar::<Value>(
            &mut client,
            config.clone(),
            json!({ "command": "first", "payload": { "value": 1 } }),
        )
        .expect("first request succeeds");
        let second = invoke_sidecar::<Value>(
            &mut client,
            config,
            json!({ "command": "second", "payload": { "value": 2 } }),
        )
        .expect("second request succeeds");

        assert_eq!(first["command"], "first");
        assert_eq!(second["command"], "second");
        assert_eq!(first["pid"], second["pid"]);
    }

    #[test]
    fn sidecar_respawns_when_existing_child_is_dead_before_request() {
        let script_path = write_fake_sidecar_script(
            r#"
import json
import os
import sys

for raw in sys.stdin:
    request = json.loads(raw)
    print(json.dumps({
        "ok": True,
        "data": {
            "pid": os.getpid(),
            "command": request["command"],
        },
        "error": None,
    }), flush=True)
"#,
        );
        let config = fake_sidecar_config(&script_path);
        let mut client = TrackerSidecarClient::default();

        let first = invoke_sidecar::<Value>(
            &mut client,
            config.clone(),
            json!({ "command": "before_kill", "payload": {} }),
        )
        .expect("first request succeeds");
        client.kill_child_for_test().expect("child can be killed");
        let second = invoke_sidecar::<Value>(
            &mut client,
            config,
            json!({ "command": "after_kill", "payload": {} }),
        )
        .expect("request after dead child succeeds");

        assert_eq!(first["command"], "before_kill");
        assert_eq!(second["command"], "after_kill");
        assert_ne!(first["pid"], second["pid"]);
    }

    #[test]
    fn sidecar_timeout_clears_process_and_next_request_respawns() {
        let script_path = write_fake_sidecar_script(
            r#"
import json
import os
import sys
import time

for raw in sys.stdin:
    request = json.loads(raw)
    if request["command"] == "hang":
        time.sleep(5)
        continue
    print(json.dumps({
        "ok": True,
        "data": {
            "pid": os.getpid(),
            "command": request["command"],
        },
        "error": None,
    }), flush=True)
"#,
        );
        let config = fake_sidecar_config(&script_path);
        let mut client = TrackerSidecarClient::default();
        client.request_timeout = Duration::from_millis(750);

        let error = invoke_sidecar::<Value>(
            &mut client,
            config.clone(),
            json!({ "command": "hang", "payload": {} }),
        )
        .expect_err("unresponsive request times out");
        assert!(error.to_string().contains("timed out"));

        let recovered = invoke_sidecar::<Value>(
            &mut client,
            config,
            json!({ "command": "after_timeout", "payload": {} }),
        )
        .expect("next request respawns sidecar");

        assert_eq!(recovered["command"], "after_timeout");
    }

    #[test]
    fn sidecar_client_round_trips_with_real_python_tracker_serve_mode() {
        let temp_dir = tempfile::tempdir().expect("temp dir is created");
        let config = TrackerSidecarConfig {
            python_bin: resolve_python_bin(),
            script_path: real_tracker_script_path(),
            db_path: temp_dir.path().join("tracker.sqlite3"),
        };
        let mut client = TrackerSidecarClient::default();
        client.request_timeout = Duration::from_secs(10);

        let week_timeline = invoke_sidecar::<Value>(
            &mut client,
            config.clone(),
            json!({
                "command": "get_dashboard_week_timeline",
                "payload": {
                    "start": "2026-04-06T00:00:00",
                    "end": "2026-04-12T23:59:59",
                },
            }),
        )
        .expect("dashboard week request succeeds against real Python sidecar");
        let first_pid = sidecar_test_child_id(&client);

        let live_tail = invoke_sidecar::<Value>(
            &mut client,
            config.clone(),
            json!({
                "command": "get_live_tail",
                "payload": {
                    "start": "2026-04-06T00:00:00",
                    "end": "2026-04-12T23:59:59",
                },
            }),
        )
        .expect("live tail request succeeds against same real Python sidecar");
        let second_pid = sidecar_test_child_id(&client);

        let error = invoke_sidecar::<Value>(
            &mut client,
            config.clone(),
            json!({ "command": "__unknown_test_command__", "payload": {} }),
        )
        .expect_err("Python command errors are returned without killing the sidecar");
        let third_pid = sidecar_test_child_id(&client);

        let recovered = invoke_sidecar::<Value>(
            &mut client,
            config,
            json!({
                "command": "get_dashboard_week_timeline",
                "payload": {
                    "start": "2026-04-06T00:00:00",
                    "end": "2026-04-12T23:59:59",
                },
            }),
        )
        .expect("sidecar remains usable after Python command error");
        let fourth_pid = sidecar_test_child_id(&client);

        assert_eq!(week_timeline.as_array().map(Vec::len), Some(0));
        assert_eq!(live_tail["segments"].as_array().map(Vec::len), Some(0));
        assert_eq!(recovered.as_array().map(Vec::len), Some(0));
        assert!(matches!(
            error,
            TrackerError::TrackerReturnedError(message)
                if message.contains("__unknown_test_command__")
        ));
        assert_eq!(first_pid, second_pid);
        assert_eq!(first_pid, third_pid);
        assert_eq!(first_pid, fourth_pid);
    }

    fn fake_sidecar_config(script_path: &Path) -> TrackerSidecarConfig {
        TrackerSidecarConfig {
            python_bin: resolve_python_bin(),
            script_path: script_path.to_path_buf(),
            db_path: PathBuf::from("fake-tracker.sqlite3"),
        }
    }

    fn write_fake_sidecar_script(source: &str) -> PathBuf {
        let temp_dir = tempfile::tempdir().expect("temp dir is created");
        let script_path = temp_dir.path().join("fake_sidecar.py");
        std::fs::write(&script_path, source).expect("fake sidecar script is written");
        let _kept_dir = temp_dir.keep();
        script_path
    }

    fn real_tracker_script_path() -> PathBuf {
        let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("src-tauri has a repository parent")
            .to_path_buf();
        let script_path = repo_root
            .join("services")
            .join("tracker-python")
            .join("app")
            .join("main.py");
        assert!(
            script_path.exists(),
            "real tracker script must exist at {}",
            script_path.display()
        );
        script_path
    }

    fn sidecar_test_child_id(client: &TrackerSidecarClient) -> u32 {
        client
            .process
            .as_ref()
            .expect("sidecar process is running")
            .child
            .id()
    }
}
