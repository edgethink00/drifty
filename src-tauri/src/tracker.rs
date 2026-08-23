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
mod mutation;
mod query;

#[cfg(target_os = "macos")]
#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> Boolean;
}

#[derive(Debug, Default, Clone, Copy)]
pub struct TrackerController;
pub(crate) const TRACKER_STARTUP_FAILURE_MESSAGE_MAX_CHARS: usize = 160;
pub(crate) const TRACKER_START_ERROR_MESSAGE: &str =
    "Activity tracking could not start. Try starting it again.";
pub(crate) const TRACKER_STOP_ERROR_MESSAGE: &str = "Activity tracking could not stop. Try again.";
pub(crate) const TRACKER_STATUS_ERROR_MESSAGE: &str =
    "Activity tracking status is unavailable. Try again.";
pub(crate) const TRACKER_PAUSED_MESSAGE: &str = "Tracking paused until you resume.";

#[derive(Debug, Default)]
struct TrackerStartupLifecycle {
    generation: u64,
    failure_message: Option<String>,
}

#[derive(Debug, Default)]
pub struct TrackerStartupState {
    lifecycle: Mutex<TrackerStartupLifecycle>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppIdentity {
    pub app_name: String,
    pub bundle_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeveloperDiagnosticsSettings {
    pub force_chromium_ax_capture: bool,
    pub force_frontmost_fallback_capture: bool,
    pub force_browser_history_url_fallback: bool,
    pub enhanced_context_enabled: bool,
    pub enhanced_context_capture_local: bool,
    pub enhanced_context_source_families: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackerStatus {
    pub running: bool,
    #[serde(default)]
    pub tracking_paused: bool,
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

impl TrackerStartupState {
    pub(crate) fn begin_start_attempt(&self) -> u64 {
        let mut lifecycle = self
            .lifecycle
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        advance_tracker_startup_generation(&mut lifecycle);
        lifecycle.generation
    }

    pub(crate) fn record_start_failure(&self, generation: u64, error: &TrackerError) -> bool {
        let mut lifecycle = self
            .lifecycle
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if lifecycle.generation != generation {
            return false;
        }

        lifecycle.failure_message = Some(bounded_tracker_startup_failure_message(error));
        true
    }

    pub(crate) fn complete_start_success(&self, generation: u64) -> bool {
        let mut lifecycle = self
            .lifecycle
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if lifecycle.generation != generation {
            return false;
        }

        retire_tracker_startup_state(&mut lifecycle);
        true
    }

    pub(crate) fn begin_stop_attempt(&self) -> u64 {
        let mut lifecycle = self
            .lifecycle
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        advance_tracker_startup_generation(&mut lifecycle);
        lifecycle.generation
    }

    pub(crate) fn complete_stop_success(&self, generation: u64) -> bool {
        let mut lifecycle = self
            .lifecycle
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if lifecycle.generation != generation {
            return false;
        }

        retire_tracker_startup_state(&mut lifecycle);
        true
    }

    pub(crate) fn record_healthy_running_status(&self) {
        let mut lifecycle = self
            .lifecycle
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        retire_tracker_startup_state(&mut lifecycle);
    }

    pub(crate) fn failure_message(&self) -> Option<String> {
        self.lifecycle
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .failure_message
            .clone()
    }
}

fn advance_tracker_startup_generation(lifecycle: &mut TrackerStartupLifecycle) {
    lifecycle.generation = lifecycle.generation.wrapping_add(1);
}

fn retire_tracker_startup_state(lifecycle: &mut TrackerStartupLifecycle) {
    advance_tracker_startup_generation(lifecycle);
    lifecycle.failure_message = None;
}

pub(crate) fn apply_tracker_startup_state(
    startup_state: &TrackerStartupState,
    mut status: TrackerStatus,
) -> TrackerStatus {
    if status.running {
        startup_state.record_healthy_running_status();
        return status;
    }

    let Some(message) = startup_state.failure_message() else {
        return status;
    };

    status.running = false;
    status.tracker_mode = Some("degraded".into());
    status.message = Some(bounded_tracker_status_message(&message));
    status
}

pub(crate) fn apply_tracking_pause_state(
    mut status: TrackerStatus,
    tracking_paused: bool,
) -> TrackerStatus {
    status.tracking_paused = tracking_paused;
    if tracking_paused {
        // The persisted user choice is authoritative while startup finishes
        // stopping a previously running daemon or status inspection degrades.
        status.running = false;
        status.tracker_mode = Some("stopped".into());
        status.message = Some(TRACKER_PAUSED_MESSAGE.into());
    }
    status
}

pub(crate) fn degraded_tracker_status(failure_message: String) -> TrackerStatus {
    TrackerStatus {
        running: false,
        tracking_paused: false,
        accessibility_granted: false,
        last_event_at: None,
        database_path: None,
        tracker_mode: Some("degraded".into()),
        idle_seconds: None,
        idle_detection_available: None,
        message: Some(bounded_tracker_status_message(&failure_message)),
    }
}

fn bounded_tracker_startup_failure_message(error: &TrackerError) -> String {
    let message = match error {
        TrackerError::MissingScript(_) | TrackerError::MissingRuntime(_) => {
            "Activity tracking components are unavailable. Try starting it again."
        }
        TrackerError::CommandFailed(_)
        | TrackerError::ServeTimedOut(_)
        | TrackerError::ParseFailed(_)
        | TrackerError::TrackerReturnedError(_)
        | TrackerError::MissingData => TRACKER_START_ERROR_MESSAGE,
    };
    bounded_tracker_status_message(message)
}

pub(crate) fn tracker_start_error_message() -> String {
    bounded_tracker_status_message(TRACKER_START_ERROR_MESSAGE)
}

pub(crate) fn tracker_status_error_message() -> String {
    bounded_tracker_status_message(TRACKER_STATUS_ERROR_MESSAGE)
}

pub(crate) fn tracker_stop_error_message() -> String {
    bounded_tracker_status_message(TRACKER_STOP_ERROR_MESSAGE)
}

fn bounded_tracker_status_message(message: &str) -> String {
    message
        .chars()
        .take(TRACKER_STARTUP_FAILURE_MESSAGE_MAX_CHARS)
        .collect()
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

    pub(crate) fn daemon_running(&self, app: &AppHandle) -> Result<bool, TrackerError> {
        let runtime = resolve_tracker_runtime(app)?;
        let db_path = resolve_db_path(app);
        let pid_path = tracker_daemon_pid_path(&db_path);
        let pid = match std::fs::read_to_string(&pid_path) {
            Ok(value) => match value.trim().parse::<u32>() {
                Ok(pid) if pid > 0 => pid,
                _ => return Ok(false),
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(error) => return Err(TrackerError::CommandFailed(error.to_string())),
        };
        let Some(command) = daemon_process_command_line(pid)? else {
            return Ok(false);
        };
        Ok(tracker_daemon_command_matches(
            &command,
            &runtime,
            &db_path,
        ))
    }

    pub(crate) fn recover_start(&self, app: &AppHandle) -> Result<TrackerStatus, TrackerError> {
        let runtime = resolve_tracker_runtime(app)?;
        let db_path = resolve_db_path(app);
        let request = json!({
            "command": "start_tracking",
            "payload": {},
        });
        let raw =
            invoke_one_shot_with_timeout(&runtime, &db_path, &request, Duration::from_secs(3))?;
        parse_envelope::<TrackerStatus>(&raw)
    }

    pub fn get_current_snapshot(&self, app: &AppHandle) -> Result<Value, TrackerError> {
        self.invoke::<Value>(app, "get_current_snapshot", json!({}))
    }

    pub fn preview_browser_history_import(
        &self,
        app: &AppHandle,
        lookback_days: Option<u32>,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(
            app,
            "preview_browser_history_import",
            build_browser_history_import_payload(lookback_days),
        )
    }

    pub fn get_browser_history_environment(&self, app: &AppHandle) -> Result<Value, TrackerError> {
        self.invoke::<Value>(app, "get_browser_history_environment", json!({}))
    }

    pub fn get_sync_outbox(
        &self,
        app: &AppHandle,
        after_seq: i64,
        limit: Option<i64>,
        hot_grace_seconds: Option<i64>,
    ) -> Result<Value, TrackerError> {
        let mut payload = json!({ "afterSeq": after_seq });
        if let Some(limit) = limit {
            payload["limit"] = json!(limit);
        }
        if let Some(grace) = hot_grace_seconds {
            payload["hotGraceSeconds"] = json!(grace);
        }
        self.invoke::<Value>(app, "get_sync_outbox", payload)
    }

    pub fn get_sync_state(&self, app: &AppHandle) -> Result<Value, TrackerError> {
        self.invoke::<Value>(app, "get_sync_state", json!({}))
    }

    pub fn get_pending_sync_deletions(
        &self,
        app: &AppHandle,
        limit: Option<i64>,
    ) -> Result<Value, TrackerError> {
        let mut payload = json!({});
        if let Some(limit) = limit {
            payload["limit"] = json!(limit);
        }
        self.invoke::<Value>(app, "get_pending_sync_deletions", payload)
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

    pub fn get_projects(&self, app: &AppHandle) -> Result<Value, TrackerError> {
        self.invoke::<Value>(app, "get_projects", json!({}))
    }

    pub fn get_dev_signals(
        &self,
        app: &AppHandle,
        day: Option<String>,
        start: Option<String>,
        end: Option<String>,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(app, "get_dev_signals", build_period_payload(day, start, end))
    }

    pub fn get_dev_repos(&self, app: &AppHandle) -> Result<Value, TrackerError> {
        self.invoke::<Value>(app, "get_dev_repos", json!({}))
    }

    pub fn sync_dev_signals(
        &self,
        app: &AppHandle,
        backfill_days: Option<u32>,
    ) -> Result<Value, TrackerError> {
        let mut payload = serde_json::Map::new();
        if let Some(days) = backfill_days {
            payload.insert("backfillDays".into(), json!(days));
        }
        self.invoke::<Value>(app, "sync_dev_signals", Value::Object(payload))
    }

    pub fn get_project_assignments(
        &self,
        app: &AppHandle,
        day: Option<String>,
        start: Option<String>,
        end: Option<String>,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(
            app,
            "get_project_assignments",
            build_period_payload(day, start, end),
        )
    }

    pub fn get_team_projects(&self, app: &AppHandle) -> Result<Value, TrackerError> {
        self.invoke::<Value>(app, "get_team_projects", json!({}))
    }

    pub fn get_project_window_assignments(
        &self,
        app: &AppHandle,
        day: Option<String>,
        start: Option<String>,
        end: Option<String>,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(
            app,
            "get_project_window_assignments",
            build_period_payload(day, start, end),
        )
    }

    pub fn get_team_project_assignments(
        &self,
        app: &AppHandle,
        day: Option<String>,
        start: Option<String>,
        end: Option<String>,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(
            app,
            "get_team_project_assignments",
            build_period_payload(day, start, end),
        )
    }

    pub fn get_project_pass_runs(
        &self,
        app: &AppHandle,
        day: Option<String>,
        start: Option<String>,
        end: Option<String>,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(
            app,
            "get_project_pass_runs",
            build_period_payload(day, start, end),
        )
    }

    pub fn get_ai_review_events(
        &self,
        app: &AppHandle,
        day: Option<String>,
        start: Option<String>,
        end: Option<String>,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(
            app,
            "get_ai_review_events",
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
        let retry_safety = sidecar_command_retry_safety(command);

        let request = json!({
            "command": command,
            "payload": payload,
        });

        // Fast path: reuse a long-lived `serve` process so each request avoids
        // the ~160ms interpreter/import cold-start (and the contention of
        // spawning several interpreters at once during a refresh burst).
        let raw = invoke_with_serve_fallback(
            retry_safety,
            || {
                let serve_result = if should_use_one_shot_when_serve_busy(command) {
                    serve_request_if_idle(&runtime, &db_path, &request, retry_safety)
                } else {
                    serve_request(&runtime, &db_path, &request, retry_safety)
                };
                serve_result.map(|line| line.into_bytes())
            },
            || invoke_one_shot(&runtime, &db_path, &request),
        )?;

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

fn tracker_daemon_pid_path(db: &Path) -> PathBuf {
    db.parent()
        .unwrap_or_else(|| Path::new("."))
        .join(".state")
        .join("tracker.pid")
}

fn tracker_daemon_command_matches(command: &str, runtime: &TrackerRuntime, db: &Path) -> bool {
    let suffix = format!(" daemon --db {}", db.to_string_lossy());
    let Some(prefix) = command.strip_suffix(&suffix) else {
        return false;
    };
    match runtime.kind {
        TrackerRuntimeKind::PackagedSidecar => {
            let expected = runtime.executable_path.to_string_lossy();
            prefix == expected || prefix.ends_with(expected.as_ref())
        }
        TrackerRuntimeKind::SourcePython => runtime
            .base_args
            .first()
            .is_some_and(|script| prefix.ends_with(script.to_string_lossy().as_ref())),
    }
}

/// Full command line of the daemon process, or None when the pid is gone.
///
/// macOS keeps the historical ps probe; Windows goes through sysinfo
/// because there is no ps there - the hardcoded call surfaced as
/// "program not found" in the recovery loop and made daemon inspection
/// structurally impossible on that platform.
#[cfg(unix)]
fn daemon_process_command_line(pid: u32) -> Result<Option<String>, TrackerError> {
    let output = Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "command="])
        .output()
        .map_err(|error| TrackerError::CommandFailed(error.to_string()))?;
    if !output.status.success() {
        return Ok(None);
    }
    Ok(Some(
        String::from_utf8_lossy(&output.stdout).trim().to_string(),
    ))
}

#[cfg(windows)]
fn daemon_process_command_line(pid: u32) -> Result<Option<String>, TrackerError> {
    use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

    let system_pid = Pid::from_u32(pid);
    let mut system = System::new();
    system.refresh_processes_specifics(
        ProcessesToUpdate::Some(&[system_pid]),
        true,
        ProcessRefreshKind::nothing().with_cmd(UpdateKind::OnlyIfNotSet),
    );
    let Some(process) = system.process(system_pid) else {
        return Ok(None);
    };
    let cmd = process.cmd();
    if cmd.is_empty() {
        return Ok(None);
    }
    Ok(Some(
        cmd.iter()
            .map(|part| part.to_string_lossy())
            .collect::<Vec<_>>()
            .join(" "),
    ))
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

fn invoke_one_shot_with_timeout(
    runtime: &TrackerRuntime,
    db: &Path,
    request: &Value,
    timeout: Duration,
) -> Result<Vec<u8>, TrackerError> {
    let mut child = command_from_argv(runtime.argv_for_one_shot(db, request))?
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| TrackerError::CommandFailed(error.to_string()))?;
    let started_at = Instant::now();
    loop {
        match child
            .try_wait()
            .map_err(|error| TrackerError::CommandFailed(error.to_string()))?
        {
            Some(_) => {
                let output = child
                    .wait_with_output()
                    .map_err(|error| TrackerError::CommandFailed(error.to_string()))?;
                if !output.status.success() {
                    return Err(TrackerError::CommandFailed(
                        String::from_utf8_lossy(&output.stderr).trim().to_string(),
                    ));
                }
                return Ok(output.stdout);
            }
            None if started_at.elapsed() >= timeout => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(TrackerError::ServeTimedOut(timeout));
            }
            None => thread::sleep(Duration::from_millis(20)),
        }
    }
}

/// A long-lived tracker `serve` process. Requests and responses are
/// newline-delimited JSON; access is serialized through a mutex so request and
/// response order always matches (the server processes one line at a time).
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SidecarCommandRetrySafety {
    SafeRead,
    Mutation,
}

fn sidecar_command_retry_safety(command: &str) -> SidecarCommandRetrySafety {
    // New commands must opt in here only after establishing they are safe to
    // replay. An unknown command is conservatively treated as a mutation.
    match command {
        "get_status"
        | "get_timeline"
        | "get_timeline_page"
        | "search_timeline"
        | "get_dashboard_week_timeline"
        | "get_project_trend_timeline"
        | "get_live_tail"
        | "get_current_snapshot"
        | "preview_browser_history_import"
        | "get_browser_history_environment"
        | "get_sync_outbox"
        | "get_sync_state"
        | "get_pending_sync_deletions"
        | "get_hourly_summary"
        | "get_raw_events"
        | "get_top_sites"
        | "get_unclassified_segments"
        | "get_reusable_ai_classifications"
        | "get_classification_rules"
        | "search_classification_rule_candidates"
        | "get_projects"
        | "get_project_assignments"
        | "get_dev_signals"
        | "get_dev_repos"
        | "get_project_window_assignments"
        | "get_team_projects"
        | "get_team_project_assignments"
        | "get_project_pass_runs"
        | "get_ai_review_events"
        | "get_classification_metrics" => SidecarCommandRetrySafety::SafeRead,
        _ => SidecarCommandRetrySafety::Mutation,
    }
}

fn invoke_with_serve_fallback<F, G>(
    retry_safety: SidecarCommandRetrySafety,
    serve: F,
    one_shot: G,
) -> Result<Vec<u8>, TrackerError>
where
    F: FnOnce() -> Result<Vec<u8>, TrackerError>,
    G: FnOnce() -> Result<Vec<u8>, TrackerError>,
{
    match serve() {
        Ok(raw) => Ok(raw),
        // A serve timeout has already consumed the configured request budget.
        // Do not enter the unbounded one-shot path for the same invocation.
        Err(err @ TrackerError::ServeTimedOut(_)) => Err(err),
        Err(_) if retry_safety == SidecarCommandRetrySafety::SafeRead => one_shot(),
        // A failed write/flush or a missing serve response is ambiguous: the
        // sidecar may have already completed a mutating request.
        Err(err) => Err(err),
    }
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
    retry_safety: SidecarCommandRetrySafety,
) -> Result<String, TrackerError> {
    serve_request_with_lock_mode(runtime, db, request, retry_safety, ServeLockMode::Wait)
}

fn serve_request_if_idle(
    runtime: &TrackerRuntime,
    db: &Path,
    request: &Value,
    retry_safety: SidecarCommandRetrySafety,
) -> Result<String, TrackerError> {
    serve_request_with_lock_mode(
        runtime,
        db,
        request,
        retry_safety,
        ServeLockMode::SkipIfBusy,
    )
}

fn serve_request_with_lock_mode(
    runtime: &TrackerRuntime,
    db: &Path,
    request: &Value,
    retry_safety: SidecarCommandRetrySafety,
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

    // A retry is safe only for the explicitly whitelisted read commands.
    let retry_attempts = serve_retry_attempts(retry_safety);
    let mut last_err = TrackerError::CommandFailed("serve process unavailable".into());
    for _ in 0..retry_attempts {
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

fn serve_retry_attempts(retry_safety: SidecarCommandRetrySafety) -> usize {
    match retry_safety {
        SidecarCommandRetrySafety::SafeRead => 2,
        SidecarCommandRetrySafety::Mutation => 1,
    }
}

const EXIT_STOP_TRACKING_WAIT: Duration = Duration::from_secs(3);

/// Best-effort stop of the detached sampling daemon on app exit so activity
/// recording does not keep running after the user quits. Runs the sidecar
/// `stop_tracking` command on a helper thread and bounds the wait so a wedged
/// sidecar can never hang shutdown.
pub fn stop_tracking_daemon_for_app_exit(app: &AppHandle) {
    let app = app.clone();
    stop_tracking_daemon_for_app_exit_with(move || {
        let _ = TrackerController.stop(&app);
    });
}

fn stop_tracking_daemon_for_app_exit_with(stop: impl FnOnce() + Send + 'static) -> bool {
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        stop();
        let _ = sender.send(());
    });
    receiver.recv_timeout(EXIT_STOP_TRACKING_WAIT).is_ok()
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
        force_kill_pid(pid);
    }
}

#[cfg(unix)]
fn force_kill_pid(pid: u32) {
    let _ = Command::new("kill").arg("-9").arg(pid.to_string()).status();
}

/// No kill -9 on Windows; sysinfo terminates the process by pid.
#[cfg(windows)]
fn force_kill_pid(pid: u32) {
    use sysinfo::{Pid, ProcessesToUpdate, System};

    let system_pid = Pid::from_u32(pid);
    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::Some(&[system_pid]), true);
    if let Some(process) = system.process(system_pid) {
        process.kill();
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

fn build_browser_history_import_payload(lookback_days: Option<u32>) -> Value {
    json!({ "lookbackDays": lookback_days.unwrap_or(2).clamp(1, 30) })
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
    for (key, value) in crate::observability::tracker_sentry_env_vars() {
        command.env(key, value);
    }
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

    // Windows executables carry an extension, and Tauri names the bundled
    // sidecar `drifty-tracker.exe`. Without the suffixed candidates the
    // lookup misses a sidecar sitting right next to the app.
    for name in sidecar_file_names() {
        candidates.push(resource_dir.join(&name));
        candidates.push(resource_dir.join("binaries").join(&name));
    }

    // The Windows sidecar is a PyInstaller onedir bundle: a directory holding
    // the exe and its runtime, because onefile self-extraction made every
    // spawn too slow for the recovery budget.
    for rel in sidecar_bundle_paths() {
        candidates.push(resource_dir.join(&rel));
        candidates.push(resource_dir.join("binaries").join(&rel));
    }

    // A Windows install keeps the sidecar beside the executable rather than
    // under a resource directory.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            for name in sidecar_file_names() {
                candidates.push(exe_dir.join(&name));
                candidates.push(exe_dir.join("binaries").join(&name));
            }
            for rel in sidecar_bundle_paths() {
                candidates.push(exe_dir.join(&rel));
                candidates.push(exe_dir.join("binaries").join(&rel));
            }
        }
    }

    candidates
}

/// Sidecar file names to try, most specific first.
fn sidecar_file_names() -> Vec<String> {
    let suffix = std::env::consts::EXE_SUFFIX;
    let mut names = Vec::new();
    if let Some(target_triple) = option_env!("TAURI_ENV_TARGET_TRIPLE") {
        names.push(format!("drifty-tracker-{target_triple}{suffix}"));
    }
    names.push(format!("drifty-tracker{suffix}"));
    names
}

/// Paths of the exe inside a onedir sidecar bundle, most specific first.
fn sidecar_bundle_paths() -> Vec<PathBuf> {
    let exe_name = format!("drifty-tracker{}", std::env::consts::EXE_SUFFIX);
    let mut paths = Vec::new();
    if let Some(target_triple) = option_env!("TAURI_ENV_TARGET_TRIPLE") {
        paths.push(PathBuf::from(format!("drifty-tracker-{target_triple}")).join(&exe_name));
    }
    paths.push(PathBuf::from("drifty-tracker").join(&exe_name));
    paths
}

fn is_packaged_resource_dir(resource_dir: &Path) -> bool {
    resource_dir.ends_with(Path::new("Contents").join("Resources"))
}

fn resolve_source_tracker_script(cwd: &Path) -> PathBuf {
    if let Ok(path) = std::env::var("DRIFTY_TRACKER_SCRIPT") {
        return PathBuf::from(path);
    }

    // The working directory is not a reliable anchor. A Windows process
    // launched from Explorer or a scheduled task inherits C:\WINDOWS\system32,
    // so a cwd-only search reported the script missing at a system path that
    // was never plausible. The executable's own location is stable, so search
    // from there as well.
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf));
    let roots = std::iter::once(cwd.to_path_buf()).chain(exe_dir);

    for root in roots {
        // Deep enough to climb out of target/<profile>/ in a dev build.
        for base in root.ancestors().take(5) {
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
    // SAFETY: AXIsProcessTrusted is a read-only macOS accessibility trust probe.
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

    // `python3` is a Unix convention. On Windows it usually resolves to the
    // WindowsApps execution-alias stub, which is not an interpreter: it exits
    // 9009 and offers to open the Store. Measured on the test host, where the
    // stub shadows a perfectly good Python 3.14 install. The `py` launcher is
    // the documented way to find a real interpreter, with `python` as the
    // fallback for installs that skipped it.
    if cfg!(windows) {
        for candidate in ["py", "python"] {
            if python_candidate_runs(candidate) {
                return candidate.to_string();
            }
        }
        return "python".to_string();
    }

    let system_python = PathBuf::from("/usr/bin/python3");
    if system_python.exists() {
        return system_python.display().to_string();
    }

    "python3".to_string()
}

/// Whether `candidate` is a real interpreter rather than a Store alias stub.
///
/// Presence on PATH is not enough to decide this: the stub is on PATH and only
/// reveals itself by failing when actually run.
fn python_candidate_runs(candidate: &str) -> bool {
    let mut command = std::process::Command::new(candidate);
    command.arg("--version");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: never flash a console while probing.
        command.creation_flags(0x0800_0000);
    }
    command
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
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
    const MUTATING_COMMANDS: &[&str] = &[
        "start_tracking",
        "stop_tracking",
        "set_developer_diagnostics",
        "import_browser_history",
        "set_sync_state",
        "apply_synced_segments",
        "mark_sync_deletions_pushed",
        "apply_synced_deletions",
        "purge_remote_segments",
        "save_classification_rule",
        "delete_classification_rule",
        "delete_activity_segments",
        "delete_history_range",
        "apply_classification_rules",
        "save_classifications",
        "refresh_non_ai_classifications",
        "save_project",
        "delete_project",
        "save_project_anchors",
        "delete_project_anchor",
        "save_project_assignments",
        "save_project_window_assignments",
        "upsert_team_projects",
        "save_team_project_assignments",
        "record_project_pass",
        "save_ai_review_events",
        "revert_ai_review_event",
    ];

    #[test]
    fn stop_daemon_for_app_exit_reports_completed_fast_stop() {
        assert!(stop_tracking_daemon_for_app_exit_with(|| {}));
    }

    #[test]
    fn stop_daemon_for_app_exit_bounds_the_wait_when_stop_hangs() {
        let started = Instant::now();
        let completed = stop_tracking_daemon_for_app_exit_with(|| {
            thread::sleep(EXIT_STOP_TRACKING_WAIT + Duration::from_secs(5));
        });
        assert!(!completed);
        assert!(started.elapsed() < EXIT_STOP_TRACKING_WAIT + Duration::from_secs(2));
    }

    #[test]
    fn tracker_status_serializes_to_camel_case() {
        let status = TrackerStatus {
            running: true,
            tracking_paused: false,
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
        assert!(value.get("trackingPaused").is_some());
        assert!(value.get("tracking_paused").is_none());
        assert!(value.get("databasePath").is_some());
        assert!(value.get("trackerMode").is_some());
        assert!(value.get("idleSeconds").is_some());
        assert!(value.get("idleDetectionAvailable").is_some());
    }

    #[test]
    fn browser_history_import_payload_defaults_to_last_48_hours() {
        let payload = build_browser_history_import_payload(None);

        assert_eq!(payload, json!({ "lookbackDays": 2 }));
    }

    #[test]
    fn browser_history_import_payload_clamps_extreme_values() {
        assert_eq!(
            build_browser_history_import_payload(Some(0)),
            json!({ "lookbackDays": 1 })
        );
        assert_eq!(
            build_browser_history_import_payload(Some(365)),
            json!({ "lookbackDays": 30 })
        );
    }

    #[test]
    fn only_timeline_page_uses_one_shot_when_serve_is_busy() {
        assert!(should_use_one_shot_when_serve_busy("get_timeline_page"));
        assert!(!should_use_one_shot_when_serve_busy("get_timeline"));
        assert!(!should_use_one_shot_when_serve_busy("get_status"));
    }

    #[test]
    fn mutating_commands_return_serve_errors_without_one_shot_replay() {
        for &command in MUTATING_COMMANDS {
            for serve_error in [
                TrackerError::ServeTimedOut(Duration::from_millis(10)),
                TrackerError::CommandFailed("serve process closed its output".into()),
            ] {
                let expected_error = serve_error.to_string();
                let fallback_invocations = std::cell::Cell::new(0);

                let result = invoke_with_serve_fallback(
                    sidecar_command_retry_safety(command),
                    || Err(serve_error),
                    || {
                        fallback_invocations.set(fallback_invocations.get() + 1);
                        Ok(b"one-shot response".to_vec())
                    },
                );

                assert_eq!(
                    result
                        .expect_err("mutations must return the serve error")
                        .to_string(),
                    expected_error,
                    "{command} must return its serve error"
                );
                assert_eq!(
                    fallback_invocations.get(),
                    0,
                    "{command} must not invoke the one-shot fallback"
                );
            }
        }
    }

    #[test]
    fn mutation_serve_path_allows_exactly_one_round_trip_attempt() {
        assert_eq!(serve_retry_attempts(SidecarCommandRetrySafety::Mutation), 1);
        assert_eq!(serve_retry_attempts(SidecarCommandRetrySafety::SafeRead), 2);
    }

    #[test]
    fn safe_read_uses_one_shot_fallback_after_serve_failure() {
        let fallback_invocations = std::cell::Cell::new(0);

        let raw = invoke_with_serve_fallback(
            sidecar_command_retry_safety("get_status"),
            || {
                Err(TrackerError::CommandFailed(
                    "serve process unavailable".into(),
                ))
            },
            || {
                fallback_invocations.set(fallback_invocations.get() + 1);
                Ok(b"one-shot response".to_vec())
            },
        )
        .expect("safe reads use the one-shot fallback");

        assert_eq!(raw, b"one-shot response");
        assert_eq!(fallback_invocations.get(), 1);
    }

    #[test]
    fn safe_read_returns_serve_timeout_without_unbounded_one_shot_fallback() {
        let fallback_invocations = std::cell::Cell::new(0);
        let timeout = Duration::from_millis(10);

        let result = invoke_with_serve_fallback(
            sidecar_command_retry_safety("get_status"),
            || Err(TrackerError::ServeTimedOut(timeout)),
            || {
                fallback_invocations.set(fallback_invocations.get() + 1);
                Ok(b"one-shot response".to_vec())
            },
        );

        assert!(matches!(
            result,
            Err(TrackerError::ServeTimedOut(duration)) if duration == timeout
        ));
        assert_eq!(
            fallback_invocations.get(),
            0,
            "a timed-out serve request must not enter the unbounded one-shot path"
        );
    }

    #[test]
    fn retry_policy_whitelists_current_read_commands_and_defaults_to_mutation() {
        for command in [
            "get_status",
            "get_timeline",
            "get_timeline_page",
            "search_timeline",
            "get_dashboard_week_timeline",
            "get_live_tail",
            "get_current_snapshot",
            "preview_browser_history_import",
            "get_browser_history_environment",
            "get_sync_outbox",
            "get_sync_state",
            "get_pending_sync_deletions",
            "get_hourly_summary",
            "get_raw_events",
            "get_top_sites",
            "get_unclassified_segments",
            "get_reusable_ai_classifications",
            "get_classification_rules",
            "search_classification_rule_candidates",
            "get_projects",
            "get_project_assignments",
            "get_dev_signals",
            "get_dev_repos",
            "get_project_window_assignments",
            "get_team_projects",
            "get_team_project_assignments",
            "get_project_pass_runs",
            "get_ai_review_events",
            "get_classification_metrics",
        ] {
            assert_eq!(
                sidecar_command_retry_safety(command),
                SidecarCommandRetrySafety::SafeRead,
                "{command} should retain read fallback"
            );
        }

        for &command in MUTATING_COMMANDS {
            assert_eq!(
                sidecar_command_retry_safety(command),
                SidecarCommandRetrySafety::Mutation,
                "{command} must never be replayed"
            );
        }

        assert_eq!(
            sidecar_command_retry_safety("future_command"),
            SidecarCommandRetrySafety::Mutation
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
    fn daemon_command_match_preserves_paths_with_spaces() {
        let runtime = TrackerRuntime::source_python(
            PathBuf::from("/usr/bin/python3"),
            PathBuf::from("/repo with spaces/services/tracker-python/app/main.py"),
        );
        let db = Path::new("/Library/Application Support/Drifty/tracker.sqlite3");
        let command = "/usr/bin/python3 /repo with spaces/services/tracker-python/app/main.py daemon --db /Library/Application Support/Drifty/tracker.sqlite3";

        assert!(tracker_daemon_command_matches(command, &runtime, db));
        assert!(tracker_daemon_command_matches(
            "/Library/Frameworks/Python.framework/Versions/3.14/Resources/Python.app/Contents/MacOS/Python /repo with spaces/services/tracker-python/app/main.py daemon --db /Library/Application Support/Drifty/tracker.sqlite3",
            &runtime,
            db,
        ));
        assert!(!tracker_daemon_command_matches(
            "/usr/bin/python3 /repo with spaces/services/tracker-python/app/main.py serve --db /Library/Application Support/Drifty/tracker.sqlite3",
            &runtime,
            db,
        ));
    }

    #[test]
    fn recovery_one_shot_is_killed_at_its_own_short_timeout() {
        let dir = temp_dir_path("recovery-one-shot-timeout");
        std::fs::create_dir_all(&dir).expect("create temp dir");
        let script = dir.join("fake-recovery-sidecar");
        std::fs::write(
            &script,
            "#!/bin/sh\nif [ \"$1\" = \"warmup\" ]; then exit 0; fi\nexec sleep 600\n",
        )
        .expect("write fake recovery sidecar");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755))
                .expect("mark script executable");
        }
        assert!(Command::new(&script)
            .arg("warmup")
            .status()
            .expect("warm up fake recovery sidecar")
            .success());

        let runtime = TrackerRuntime::packaged_sidecar(script);
        let timeout = Duration::from_millis(100);
        let started = Instant::now();
        let result = invoke_one_shot_with_timeout(
            &runtime,
            &dir.join("tracker.sqlite3"),
            &json!({ "command": "start_tracking", "payload": {} }),
            timeout,
        );

        assert!(matches!(
            result,
            Err(TrackerError::ServeTimedOut(duration)) if duration == timeout
        ));
        assert!(started.elapsed() < Duration::from_secs(2));
        let _ = std::fs::remove_dir_all(dir);
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
        let hung = serve_request(&runtime, &db, &request, SidecarCommandRetrySafety::SafeRead);
        let elapsed = started.elapsed();
        let respawned = serve_request(&runtime, &db, &request, SidecarCommandRetrySafety::SafeRead);
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
