#[cfg(target_os = "macos")]
use core_foundation::base::Boolean;
use std::ffi::OsString;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Mutex, OnceLock, TryLockError};
use std::thread;
use std::time::{Duration, Instant};

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
    #[error("tracker runtime missing: {0}")]
    MissingRuntime(String),
    #[error("tracker invocation failed: {0}")]
    CommandFailed(String),
    #[error("tracker serve request timed out after {0:?}")]
    ServeTimedOut(Duration),
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

    pub fn get_timeline_page(
        &self,
        app: &AppHandle,
        start: Option<String>,
        end: Option<String>,
        before_segment_id: Option<String>,
        before_ended_at: Option<String>,
        limit: Option<u32>,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(
            app,
            "get_timeline_page",
            build_timeline_page_payload(start, end, before_segment_id, before_ended_at, limit),
        )
    }

    pub fn search_timeline(
        &self,
        app: &AppHandle,
        query: String,
        start: Option<String>,
        end: Option<String>,
        before_segment_id: Option<String>,
        before_ended_at: Option<String>,
        limit: Option<u32>,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(
            app,
            "search_timeline",
            build_timeline_search_payload(
                query,
                start,
                end,
                before_segment_id,
                before_ended_at,
                limit,
            ),
        )
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
        force_frontmost_fallback_capture: bool,
        force_browser_history_url_fallback: bool,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(
            app,
            "set_developer_diagnostics",
            build_developer_diagnostics_payload(
                force_chromium_ax_capture,
                force_frontmost_fallback_capture,
                force_browser_history_url_fallback,
            ),
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
        target_kind: Option<String>,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(
            app,
            "search_classification_rule_candidates",
            json!({ "query": query, "targetKind": target_kind }),
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
        let runtime = resolve_tracker_runtime(app)?;
        let db_path = resolve_db_path(app);

        let request = json!({
            "command": command,
            "payload": payload,
        });

        // Fast path: reuse a long-lived `serve` process so each query avoids the
        // ~160ms interpreter/import cold-start (and the contention of spawning
        // several interpreters at once during a refresh burst). Fall back to a
        // one-shot invocation if the persistent process is unavailable.
        let serve_result = if should_use_one_shot_when_serve_busy(command) {
            serve_request_if_idle(&runtime, &db_path, &request)
        } else {
            serve_request(&runtime, &db_path, &request)
        };
        let raw = match serve_result {
            Ok(line) => line.into_bytes(),
            Err(_) => invoke_one_shot(&runtime, &db_path, &request)?,
        };

        parse_envelope::<T>(&raw)
    }
}

fn parse_envelope<T: for<'de> Deserialize<'de>>(raw: &[u8]) -> Result<T, TrackerError> {
    let envelope = serde_json::from_slice::<SidecarEnvelope<T>>(raw)
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TrackerRuntimeKind {
    PackagedSidecar,
    SourcePython,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct TrackerRuntime {
    executable_path: PathBuf,
    base_args: Vec<OsString>,
    display_identity: String,
    kind: TrackerRuntimeKind,
}

impl TrackerRuntime {
    fn packaged_sidecar(executable_path: PathBuf) -> Self {
        Self {
            display_identity: format!("packaged sidecar {}", executable_path.display()),
            executable_path,
            base_args: Vec::new(),
            kind: TrackerRuntimeKind::PackagedSidecar,
        }
    }

    fn source_python(python_path: PathBuf, script_path: PathBuf) -> Self {
        Self {
            display_identity: format!(
                "source python {} {}",
                python_path.display(),
                script_path.display()
            ),
            executable_path: python_path,
            base_args: vec![script_path.into_os_string()],
            kind: TrackerRuntimeKind::SourcePython,
        }
    }

    fn identity(&self) -> String {
        let mut parts = vec![match self.kind {
            TrackerRuntimeKind::PackagedSidecar => "packaged-sidecar".to_string(),
            TrackerRuntimeKind::SourcePython => "source-python".to_string(),
        }];
        parts.push(self.executable_path.to_string_lossy().into_owned());
        parts.extend(
            self.base_args
                .iter()
                .map(|arg| arg.to_string_lossy().into_owned()),
        );
        parts.join("\0")
    }

    fn argv_for_one_shot(&self, db: &Path, request: &Value) -> Vec<OsString> {
        let mut argv = self.argv_prefix();
        argv.push("--db".into());
        argv.push(db.as_os_str().to_os_string());
        argv.push("--request-json".into());
        argv.push(request.to_string().into());
        argv
    }

    fn argv_for_serve(&self, db: &Path) -> Vec<OsString> {
        let mut argv = self.argv_prefix();
        argv.push("serve".into());
        argv.push("--db".into());
        argv.push(db.as_os_str().to_os_string());
        argv
    }

    fn argv_prefix(&self) -> Vec<OsString> {
        let mut argv = Vec::with_capacity(1 + self.base_args.len() + 4);
        argv.push(self.executable_path.as_os_str().to_os_string());
        argv.extend(self.base_args.iter().cloned());
        argv
    }
}

fn invoke_one_shot(
    runtime: &TrackerRuntime,
    db: &Path,
    request: &Value,
) -> Result<Vec<u8>, TrackerError> {
    let output = command_from_argv(runtime.argv_for_one_shot(db, request))?
        .output()
        .map_err(|err| TrackerError::CommandFailed(err.to_string()))?;

    if !output.status.success() {
        return Err(TrackerError::CommandFailed(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ));
    }

    Ok(output.stdout)
}

/// A long-lived tracker `serve` process. Requests and responses are
/// newline-delimited JSON; access is serialized through a mutex so request and
/// response order always match (the server processes one line at a time).
/// Responses arrive through a dedicated reader thread so a wedged sidecar can
/// be bounded by a timeout instead of pinning the mutex forever.
struct ServeProcess {
    child: Child,
    stdin: ChildStdin,
    responses: mpsc::Receiver<std::io::Result<String>>,
    runtime_identity: String,
    db_path: PathBuf,
}

static SERVE_PROCESS: OnceLock<Mutex<Option<ServeProcess>>> = OnceLock::new();
static SERVE_REQUEST_ID: AtomicU64 = AtomicU64::new(1);
// PID of the live serve child so shutdown can force-kill it when the serve
// mutex is stuck behind a hung round trip. 0 means no live child.
static SERVE_CHILD_PID: AtomicU32 = AtomicU32::new(0);

const SERVE_ROUND_TRIP_TIMEOUT: Duration = Duration::from_secs(30);
const SHUTDOWN_LOCK_WAIT: Duration = Duration::from_secs(2);
const SHUTDOWN_LOCK_POLL: Duration = Duration::from_millis(50);

fn serve_round_trip_timeout() -> Duration {
    std::env::var("DRIFTY_TRACKER_ROUNDTRIP_TIMEOUT_MS")
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .filter(|millis| *millis > 0)
        .map(Duration::from_millis)
        .unwrap_or(SERVE_ROUND_TRIP_TIMEOUT)
}

enum ServeLockMode {
    Wait,
    SkipIfBusy,
}

fn should_use_one_shot_when_serve_busy(command: &str) -> bool {
    command == "get_timeline_page"
}

fn serve_slot() -> &'static Mutex<Option<ServeProcess>> {
    SERVE_PROCESS.get_or_init(|| Mutex::new(None))
}

fn spawn_serve_process(runtime: &TrackerRuntime, db: &Path) -> Result<ServeProcess, TrackerError> {
    let mut child = command_from_argv(runtime.argv_for_serve(db))?
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|err| TrackerError::CommandFailed(err.to_string()))?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| TrackerError::CommandFailed("serve stdin unavailable".into()))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| TrackerError::CommandFailed("serve stdout unavailable".into()))?;
    SERVE_CHILD_PID.store(child.id(), Ordering::SeqCst);

    let (response_sender, responses) = mpsc::channel();
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            let mut line = String::new();
            match reader.read_line(&mut line) {
                // An empty line marks EOF; the thread exits with the process.
                Ok(0) => {
                    let _ = response_sender.send(Ok(String::new()));
                    break;
                }
                Ok(_) => {
                    if response_sender.send(Ok(line)).is_err() {
                        break;
                    }
                }
                Err(err) => {
                    let _ = response_sender.send(Err(err));
                    break;
                }
            }
        }
    });

    Ok(ServeProcess {
        child,
        stdin,
        responses,
        runtime_identity: runtime.identity(),
        db_path: db.to_path_buf(),
    })
}

fn kill_serve_process(mut proc: ServeProcess) {
    let pid = proc.child.id();
    let _ = proc.child.kill();
    let _ = proc.child.wait();
    let _ = SERVE_CHILD_PID.compare_exchange(pid, 0, Ordering::SeqCst, Ordering::SeqCst);
}

fn serve_round_trip(proc: &mut ServeProcess, line: &str) -> Result<String, TrackerError> {
    proc.stdin
        .write_all(line.as_bytes())
        .map_err(serve_io_err)?;
    proc.stdin.write_all(b"\n").map_err(serve_io_err)?;
    proc.stdin.flush().map_err(serve_io_err)?;

    let timeout = serve_round_trip_timeout();
    match proc.responses.recv_timeout(timeout) {
        Ok(Ok(response)) if response.is_empty() => Err(TrackerError::CommandFailed(
            "serve process closed its output".into(),
        )),
        Ok(Ok(response)) => Ok(response),
        Ok(Err(err)) => Err(serve_io_err(err)),
        Err(RecvTimeoutError::Timeout) => {
            // A wedged sidecar would otherwise hold the serve mutex forever;
            // kill it so the slot resets and a later call respawns.
            let _ = proc.child.kill();
            Err(TrackerError::ServeTimedOut(timeout))
        }
        Err(RecvTimeoutError::Disconnected) => Err(TrackerError::CommandFailed(
            "serve reader thread terminated".into(),
        )),
    }
}

fn serve_io_err(err: std::io::Error) -> TrackerError {
    TrackerError::CommandFailed(err.to_string())
}

fn serve_request(
    runtime: &TrackerRuntime,
    db: &Path,
    request: &Value,
) -> Result<String, TrackerError> {
    serve_request_with_lock_mode(runtime, db, request, ServeLockMode::Wait)
}

fn serve_request_if_idle(
    runtime: &TrackerRuntime,
    db: &Path,
    request: &Value,
) -> Result<String, TrackerError> {
    serve_request_with_lock_mode(runtime, db, request, ServeLockMode::SkipIfBusy)
}

fn serve_request_with_lock_mode(
    runtime: &TrackerRuntime,
    db: &Path,
    request: &Value,
    lock_mode: ServeLockMode,
) -> Result<String, TrackerError> {
    let slot = serve_slot();
    let mut guard = match lock_mode {
        ServeLockMode::Wait => slot
            .lock()
            .map_err(|_| TrackerError::CommandFailed("serve lock poisoned".into()))?,
        ServeLockMode::SkipIfBusy => match slot.try_lock() {
            Ok(guard) => guard,
            Err(TryLockError::WouldBlock) => {
                return Err(TrackerError::CommandFailed("serve process busy".into()));
            }
            Err(TryLockError::Poisoned(_)) => {
                return Err(TrackerError::CommandFailed("serve lock poisoned".into()));
            }
        },
    };

    // Discard a process spawned for a different runtime/db (paths can change
    // between dev runs); it will be respawned below.
    let stale = guard
        .as_ref()
        .map(|proc| serve_process_is_stale(&proc.runtime_identity, &proc.db_path, runtime, db))
        .unwrap_or(false);
    if stale {
        if let Some(proc) = guard.take() {
            kill_serve_process(proc);
        }
    }

    // Two attempts: the first may discover a dead process (broken pipe), the
    // second runs against a freshly spawned one.
    let mut last_err = TrackerError::CommandFailed("serve process unavailable".into());
    for _ in 0..2 {
        if guard.is_none() {
            *guard = Some(spawn_serve_process(runtime, db)?);
        }

        let id = SERVE_REQUEST_ID.fetch_add(1, Ordering::Relaxed);
        let mut framed = request.clone();
        if let Some(object) = framed.as_object_mut() {
            object.insert("id".into(), json!(id));
        }
        let line = framed.to_string();

        let attempt = {
            match guard.as_mut() {
                Some(proc) => serve_round_trip(proc, &line),
                None => Err(TrackerError::CommandFailed(
                    "serve process unavailable".into(),
                )),
            }
        };

        match attempt {
            Ok(response) => return Ok(response),
            Err(err) => {
                if let Some(proc) = guard.take() {
                    kill_serve_process(proc);
                }
                // A timeout means the sidecar wedged mid-request, not that a
                // dead process was discovered; don't spend a second timeout in
                // the same call — the next call respawns against a fresh slot.
                if matches!(err, TrackerError::ServeTimedOut(_)) {
                    return Err(err);
                }
                last_err = err;
            }
        }
    }

    Err(last_err)
}

/// Terminate the long-lived serve process (called on app exit). The process also
/// exits on its own when its stdin reaches EOF, so this is a best-effort cleanup.
/// The wait for the serve mutex is bounded so a hung round trip can never block
/// app quit; in that case the child is force-killed through its recorded PID.
pub fn shutdown_serve_process() {
    let Some(slot) = SERVE_PROCESS.get() else {
        return;
    };
    let deadline = Instant::now() + SHUTDOWN_LOCK_WAIT;
    loop {
        match slot.try_lock() {
            Ok(mut guard) => {
                if let Some(proc) = guard.take() {
                    kill_serve_process(proc);
                }
                return;
            }
            Err(TryLockError::Poisoned(poisoned)) => {
                if let Some(proc) = poisoned.into_inner().take() {
                    kill_serve_process(proc);
                }
                return;
            }
            Err(TryLockError::WouldBlock) => {
                if Instant::now() >= deadline {
                    break;
                }
                thread::sleep(SHUTDOWN_LOCK_POLL);
            }
        }
    }
    let pid = SERVE_CHILD_PID.swap(0, Ordering::SeqCst);
    if pid != 0 {
        let _ = Command::new("kill").arg("-9").arg(pid.to_string()).status();
    }
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

fn build_timeline_page_payload(
    start: Option<String>,
    end: Option<String>,
    before_segment_id: Option<String>,
    before_ended_at: Option<String>,
    limit: Option<u32>,
) -> Value {
    let mut payload = build_period_payload(None, start, end);

    if let Some(payload_object) = payload.as_object_mut() {
        if let Some(before_segment_id) = before_segment_id {
            payload_object.insert("beforeSegmentId".into(), json!(before_segment_id));
        }
        if let Some(before_ended_at) = before_ended_at {
            payload_object.insert("beforeEndedAt".into(), json!(before_ended_at));
        }
        payload_object.insert("limit".into(), json!(limit.unwrap_or(200)));
    }

    payload
}

fn build_timeline_search_payload(
    query: String,
    start: Option<String>,
    end: Option<String>,
    before_segment_id: Option<String>,
    before_ended_at: Option<String>,
    limit: Option<u32>,
) -> Value {
    let mut payload =
        build_timeline_page_payload(start, end, before_segment_id, before_ended_at, limit);

    if let Some(payload_object) = payload.as_object_mut() {
        payload_object.insert("query".into(), json!(query));
    }

    payload
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

fn build_developer_diagnostics_payload(
    force_chromium_ax_capture: bool,
    force_frontmost_fallback_capture: bool,
    force_browser_history_url_fallback: bool,
) -> Value {
    json!({
        "forceChromiumAxCapture": force_chromium_ax_capture,
        "forceFrontmostFallbackCapture": force_frontmost_fallback_capture,
        "forceBrowserHistoryUrlFallback": force_browser_history_url_fallback,
    })
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

fn command_from_argv(argv: Vec<OsString>) -> Result<Command, TrackerError> {
    let mut args = argv.into_iter();
    let Some(program) = args.next() else {
        return Err(TrackerError::CommandFailed(
            "tracker runtime argv was empty".into(),
        ));
    };
    let mut command = Command::new(program);
    command.args(args);
    Ok(command)
}

fn resolve_tracker_runtime(app: &AppHandle) -> Result<TrackerRuntime, TrackerError> {
    let resource_dir = app.path().resource_dir().ok();
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    resolve_tracker_runtime_from_paths(resource_dir.as_deref(), cwd.as_path())
}

fn resolve_tracker_runtime_from_paths(
    resource_dir: Option<&Path>,
    cwd: &Path,
) -> Result<TrackerRuntime, TrackerError> {
    resolve_tracker_runtime_from_paths_with_python_resolver(resource_dir, cwd, || {
        PathBuf::from(resolve_python_bin())
    })
}

fn resolve_tracker_runtime_from_paths_with_python_resolver(
    resource_dir: Option<&Path>,
    cwd: &Path,
    python_resolver: impl FnOnce() -> PathBuf,
) -> Result<TrackerRuntime, TrackerError> {
    if let Some(resource_dir) = resource_dir {
        if let Some(sidecar) = packaged_sidecar_candidates(resource_dir)
            .into_iter()
            .find(|candidate| candidate.is_file())
        {
            return Ok(TrackerRuntime::packaged_sidecar(sidecar));
        }

        if is_packaged_resource_dir(resource_dir) {
            return Err(TrackerError::MissingRuntime(format!(
                "bundled tracker sidecar not found under {}",
                resource_dir.display()
            )));
        }
    }

    let script_path = resolve_source_tracker_script(cwd);
    if !script_path.exists() {
        return Err(TrackerError::MissingScript(
            script_path.display().to_string(),
        ));
    }

    Ok(TrackerRuntime::source_python(
        python_resolver(),
        script_path,
    ))
}

fn packaged_sidecar_candidates(resource_dir: &Path) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if is_packaged_resource_dir(resource_dir) {
        if let Some(contents_dir) = resource_dir.parent() {
            let macos_dir = contents_dir.join("MacOS");
            candidates.push(macos_dir.join("drifty-tracker"));
            if let Some(target_triple) = option_env!("TAURI_ENV_TARGET_TRIPLE") {
                candidates.push(macos_dir.join(format!("drifty-tracker-{target_triple}")));
            }
        }
    }

    candidates.push(resource_dir.join("drifty-tracker"));
    candidates.push(resource_dir.join("binaries").join("drifty-tracker"));

    if let Some(target_triple) = option_env!("TAURI_ENV_TARGET_TRIPLE") {
        candidates.push(resource_dir.join(format!("drifty-tracker-{target_triple}")));
        candidates.push(
            resource_dir
                .join("binaries")
                .join(format!("drifty-tracker-{target_triple}")),
        );
    }

    candidates
}

fn is_packaged_resource_dir(resource_dir: &Path) -> bool {
    resource_dir.ends_with(Path::new("Contents").join("Resources"))
}

fn resolve_source_tracker_script(cwd: &Path) -> PathBuf {
    if let Ok(path) = std::env::var("DRIFTY_TRACKER_SCRIPT") {
        return PathBuf::from(path);
    }

    for base in cwd.ancestors().take(4) {
        let candidate = base
            .join("services")
            .join("tracker-python")
            .join("app")
            .join("main.py");
        if candidate.exists() {
            return candidate;
        }

        let resource_candidate = base
            .join("resources")
            .join("tracker-python")
            .join("app")
            .join("main.py");
        if resource_candidate.exists() {
            return resource_candidate;
        }
    }

    cwd.join("services")
        .join("tracker-python")
        .join("app")
        .join("main.py")
}

fn serve_process_is_stale(
    current_runtime_identity: &str,
    current_db: &Path,
    runtime: &TrackerRuntime,
    db: &Path,
) -> bool {
    current_runtime_identity != runtime.identity() || current_db != db
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

#[cfg(test)]
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
    fn developer_diagnostics_payload_preserves_browser_history_fallback_flag() {
        let payload = build_developer_diagnostics_payload(true, false, true);

        assert_eq!(
            payload,
            json!({
                "forceChromiumAxCapture": true,
                "forceFrontmostFallbackCapture": false,
                "forceBrowserHistoryUrlFallback": true,
            })
        );
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
    fn timeline_page_payload_preserves_range_cursor_and_default_limit() {
        let payload = build_timeline_page_payload(
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
                "beforeSegmentId": "42",
                "beforeEndedAt": "2026-04-06T09:05:00+00:00",
                "limit": 200
            })
        );
    }

    #[test]
    fn timeline_search_payload_preserves_query_range_cursor_and_default_limit() {
        let payload = build_timeline_search_payload(
            "github issue".into(),
            Some("2026-04-06T00:00:00".into()),
            Some("2026-04-06T23:59:59".into()),
            Some("42".into()),
            Some("2026-04-06T09:05:00+00:00".into()),
            None,
        );

        assert_eq!(
            payload,
            json!({
                "query": "github issue",
                "start": "2026-04-06T00:00:00",
                "end": "2026-04-06T23:59:59",
                "beforeSegmentId": "42",
                "beforeEndedAt": "2026-04-06T09:05:00+00:00",
                "limit": 200
            })
        );
    }

    #[test]
    fn only_timeline_page_uses_one_shot_when_serve_is_busy() {
        assert!(should_use_one_shot_when_serve_busy("get_timeline_page"));
        assert!(!should_use_one_shot_when_serve_busy("get_timeline"));
        assert!(!should_use_one_shot_when_serve_busy("get_status"));
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
    fn packaged_sidecar_runtime_selects_bundled_executable() {
        let resource_dir = temp_dir_path("packaged-sidecar-runtime");
        let sidecar = resource_dir.join("drifty-tracker");
        std::fs::create_dir_all(&resource_dir).expect("create resource dir");
        std::fs::write(&sidecar, b"fake sidecar").expect("write sidecar");

        let runtime =
            resolve_tracker_runtime_from_paths(Some(&resource_dir), resource_dir.as_path())
                .expect("packaged sidecar runtime");

        assert_eq!(runtime.kind, TrackerRuntimeKind::PackagedSidecar);
        assert_eq!(runtime.executable_path, sidecar);
        assert!(runtime.base_args.is_empty());
        assert_eq!(
            runtime.display_identity,
            format!("packaged sidecar {}", sidecar.display())
        );

        let _ = std::fs::remove_dir_all(resource_dir);
    }

    #[test]
    fn development_runtime_falls_back_to_source_script() {
        let repo = temp_dir_path("source-runtime");
        let script = repo
            .join("services")
            .join("tracker-python")
            .join("app")
            .join("main.py");
        std::fs::create_dir_all(script.parent().expect("script parent"))
            .expect("create script dir");
        std::fs::write(&script, b"print('ok')").expect("write source script");
        let python = PathBuf::from("/dev/python3");

        let runtime =
            resolve_tracker_runtime_from_paths_with_python_resolver(None, repo.as_path(), || {
                python.clone()
            })
            .expect("source python runtime");

        assert_eq!(runtime.kind, TrackerRuntimeKind::SourcePython);
        assert_eq!(runtime.executable_path, python);
        assert_eq!(runtime.base_args, vec![script.into_os_string()]);

        let _ = std::fs::remove_dir_all(repo);
    }

    #[test]
    fn packaged_runtime_errors_when_sidecar_is_missing() {
        let resource_dir = temp_dir_path("missing-packaged-sidecar")
            .join("Drifty.app")
            .join("Contents")
            .join("Resources");
        std::fs::create_dir_all(&resource_dir).expect("create resource dir");

        let err = resolve_tracker_runtime_from_paths_with_python_resolver(
            Some(&resource_dir),
            resource_dir.as_path(),
            || panic!("packaged runtime must not resolve Python"),
        )
        .expect_err("missing sidecar should fail in packaged mode");

        assert!(matches!(err, TrackerError::MissingRuntime(_)));
        assert!(err.to_string().contains("tracker runtime missing"));

        let _ = std::fs::remove_dir_all(
            resource_dir
                .ancestors()
                .nth(3)
                .expect("temp root")
                .to_path_buf(),
        );
    }

    #[test]
    fn packaged_sidecar_ignores_python_bin_override() {
        let resource_dir = temp_dir_path("packaged-ignores-python");
        let sidecar = resource_dir.join("drifty-tracker");
        std::fs::create_dir_all(&resource_dir).expect("create resource dir");
        std::fs::write(&sidecar, b"fake sidecar").expect("write sidecar");

        let runtime = resolve_tracker_runtime_from_paths_with_python_resolver(
            Some(&resource_dir),
            resource_dir.as_path(),
            || PathBuf::from("/tmp/drifty-poison/python3"),
        )
        .expect("packaged runtime");

        assert_eq!(runtime.kind, TrackerRuntimeKind::PackagedSidecar);
        assert_eq!(runtime.executable_path, sidecar);
        assert!(runtime
            .argv_for_serve(Path::new("/tmp/tracker.sqlite3"))
            .into_iter()
            .all(|arg| arg != "/tmp/drifty-poison/python3"));

        let _ = std::fs::remove_dir_all(resource_dir);
    }

    #[test]
    fn packaged_app_resources_selects_macos_sidecar() {
        let app_root = temp_dir_path("packaged-app-layout").join("Drifty.app");
        let resource_dir = app_root.join("Contents").join("Resources");
        let sidecar = app_root
            .join("Contents")
            .join("MacOS")
            .join("drifty-tracker");
        std::fs::create_dir_all(sidecar.parent().expect("sidecar parent"))
            .expect("create macos dir");
        std::fs::create_dir_all(&resource_dir).expect("create resource dir");
        std::fs::write(&sidecar, b"fake sidecar").expect("write sidecar");

        let runtime = resolve_tracker_runtime_from_paths_with_python_resolver(
            Some(&resource_dir),
            resource_dir.as_path(),
            || panic!("packaged runtime must not resolve Python"),
        )
        .expect("packaged app sidecar runtime");

        assert_eq!(runtime.kind, TrackerRuntimeKind::PackagedSidecar);
        assert_eq!(runtime.executable_path, sidecar);

        let _ = std::fs::remove_dir_all(
            app_root
                .ancestors()
                .nth(1)
                .expect("temp root")
                .to_path_buf(),
        );
    }

    #[test]
    fn packaged_sidecar_one_shot_argv_is_canonical() {
        let runtime =
            TrackerRuntime::packaged_sidecar(PathBuf::from("/App/Resources/drifty-tracker"));
        let request = json!({ "command": "get_status", "payload": {} });
        let argv =
            os_args_to_strings(runtime.argv_for_one_shot(Path::new("/tmp/db.sqlite3"), &request));
        println!("packaged one-shot argv: {argv:?}");

        assert_eq!(
            argv,
            vec![
                "/App/Resources/drifty-tracker",
                "--db",
                "/tmp/db.sqlite3",
                "--request-json",
                "{\"command\":\"get_status\",\"payload\":{}}",
            ]
        );
    }

    #[test]
    fn source_runtime_one_shot_argv_is_canonical() {
        let runtime = TrackerRuntime::source_python(
            PathBuf::from("/usr/bin/python3"),
            PathBuf::from("/repo/services/tracker-python/app/main.py"),
        );
        let request = json!({ "command": "get_status", "payload": {} });
        let argv =
            os_args_to_strings(runtime.argv_for_one_shot(Path::new("/tmp/db.sqlite3"), &request));
        println!("source one-shot argv: {argv:?}");

        assert_eq!(
            argv,
            vec![
                "/usr/bin/python3",
                "/repo/services/tracker-python/app/main.py",
                "--db",
                "/tmp/db.sqlite3",
                "--request-json",
                "{\"command\":\"get_status\",\"payload\":{}}",
            ]
        );
    }

    #[test]
    fn packaged_sidecar_serve_argv_is_canonical() {
        let runtime =
            TrackerRuntime::packaged_sidecar(PathBuf::from("/App/Resources/drifty-tracker"));
        let argv = os_args_to_strings(runtime.argv_for_serve(Path::new("/tmp/db.sqlite3")));
        println!("packaged serve argv: {argv:?}");

        assert_eq!(
            argv,
            vec![
                "/App/Resources/drifty-tracker",
                "serve",
                "--db",
                "/tmp/db.sqlite3"
            ]
        );
    }

    #[test]
    fn source_runtime_serve_argv_is_canonical() {
        let runtime = TrackerRuntime::source_python(
            PathBuf::from("/usr/bin/python3"),
            PathBuf::from("/repo/services/tracker-python/app/main.py"),
        );
        let argv = os_args_to_strings(runtime.argv_for_serve(Path::new("/tmp/db.sqlite3")));
        println!("source serve argv: {argv:?}");

        assert_eq!(
            argv,
            vec![
                "/usr/bin/python3",
                "/repo/services/tracker-python/app/main.py",
                "serve",
                "--db",
                "/tmp/db.sqlite3",
            ]
        );
    }

    #[test]
    fn serve_identity_is_stale_when_runtime_changes() {
        let source = TrackerRuntime::source_python(
            PathBuf::from("/usr/bin/python3"),
            PathBuf::from("/repo/services/tracker-python/app/main.py"),
        );
        let sidecar =
            TrackerRuntime::packaged_sidecar(PathBuf::from("/App/Resources/drifty-tracker"));

        assert!(serve_process_is_stale(
            &source.identity(),
            Path::new("/tmp/db.sqlite3"),
            &sidecar,
            Path::new("/tmp/db.sqlite3")
        ));
    }

    fn os_args_to_strings(args: Vec<std::ffi::OsString>) -> Vec<String> {
        args.into_iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect()
    }

    fn temp_dir_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("drifty-tracker-test-{name}-{}", std::process::id()))
    }

    #[test]
    fn serve_round_trip_times_out_on_hung_sidecar_and_respawns() {
        let dir = temp_dir_path("serve-timeout");
        std::fs::create_dir_all(&dir).expect("create temp dir");
        let script = dir.join("fake-serve");
        let marker = dir.join("hung-once");
        // First serve spawn hangs without replying; every later spawn answers
        // each request line with a valid envelope.
        std::fs::write(
            &script,
            format!(
                "#!/bin/sh\nif [ \"$1\" = \"warmup\" ]; then\n  exit 0\nfi\nif [ ! -f \"{marker}\" ]; then\n  : > \"{marker}\"\n  exec sleep 600\nfi\nwhile read line; do\n  printf '%s\\n' '{{\"ok\": true, \"data\": {{\"pong\": true}}}}'\ndone\n",
                marker = marker.display()
            ),
        )
        .expect("write fake serve script");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755))
                .expect("mark script executable");
        }
        // The first exec of a freshly written script can stall behind the
        // macOS malware scan; run it once so the timed calls below only
        // measure the sidecar behavior.
        assert!(Command::new(&script)
            .arg("warmup")
            .status()
            .expect("warm up fake serve script")
            .success());

        std::env::set_var("DRIFTY_TRACKER_ROUNDTRIP_TIMEOUT_MS", "500");
        let runtime = TrackerRuntime::packaged_sidecar(script);
        let db = dir.join("db.sqlite3");
        let request = json!({ "command": "ping", "payload": {} });

        let started = std::time::Instant::now();
        let hung = serve_request(&runtime, &db, &request);
        let elapsed = started.elapsed();
        let respawned = serve_request(&runtime, &db, &request);
        std::env::remove_var("DRIFTY_TRACKER_ROUNDTRIP_TIMEOUT_MS");
        shutdown_serve_process();

        assert!(hung.is_err(), "hung sidecar must not produce a response");
        assert!(
            elapsed < std::time::Duration::from_secs(10),
            "round trip must be bounded by the timeout, took {elapsed:?}"
        );
        let response = respawned.expect("next call respawns the serve process");
        assert!(response.contains("pong"), "unexpected response {response}");

        let _ = std::fs::remove_dir_all(dir);
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
}
