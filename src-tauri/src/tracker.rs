#[cfg(target_os = "macos")]
use core_foundation::base::Boolean;
use std::ffi::OsString;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex, OnceLock, TryLockError};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use thiserror::Error;

use crate::app_icons::{app_identity_key, resolve_app_icon_data};
use crate::site_icons::resolve_site_icons_batch;
use crate::{tracking_activation, tracking_pause};
mod mutation;
mod query;
#[cfg(windows)]
mod windows_daemon_identity;

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
pub(crate) const TRACKER_PAUSE_STILL_RUNNING_MESSAGE: &str =
    "Pause requested, but tracking is still running. Drifty is retrying.";
pub(crate) const TRACKER_PAUSE_UNCONFIRMED_MESSAGE: &str =
    "Pause requested, but tracking status is unavailable. Drifty is retrying.";
#[cfg(windows)]
const WINDOWS_CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Default)]
struct TrackerStartupLifecycle {
    generation: u64,
    failure_message: Option<String>,
    start_in_flight: bool,
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
    #[serde(default)]
    pub browser_content_context_enabled: bool,
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
    #[error("tracker is shutting down")]
    ShuttingDown,
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
        lifecycle.start_in_flight = true;
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

        lifecycle.start_in_flight = false;
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
        lifecycle.start_in_flight = false;
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
        // A status read can hold the operation lock while a manual Start
        // prepares its intent. Observing an already-running daemon must clear
        // an old error without invalidating that queued Start's completion.
        if lifecycle.start_in_flight {
            lifecycle.failure_message = None;
        } else {
            retire_tracker_startup_state(&mut lifecycle);
        }
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
    lifecycle.start_in_flight = false;
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

/// A start request may reach the sidecar and launch the daemon even when its
/// response is lost. Only callers that have already persisted activation and
/// cleared a manual pause may use this read-only status probe to recover it.
pub(crate) fn reconcile_start_result_with_status(
    start_result: Result<TrackerStatus, TrackerError>,
    status_probe: impl FnOnce() -> Result<TrackerStatus, TrackerError>,
) -> Result<TrackerStatus, TrackerError> {
    match start_result {
        Ok(status) if status.running => Ok(status),
        Err(error @ (TrackerError::MissingScript(_) | TrackerError::MissingRuntime(_))) => {
            Err(error)
        }
        result => match status_probe() {
            Ok(status) if status.running => Ok(status),
            _ => result,
        },
    }
}

const START_RECOVERY_PROBE_ATTEMPTS: usize = 6;
const START_RECOVERY_PROBE_INTERVAL: Duration = Duration::from_millis(300);
const START_RECOVERY_TOTAL_BUDGET: Duration = Duration::from_secs(10);
const START_RECOVERY_READ_TIMEOUT: Duration = Duration::from_secs(3);

fn confirm_current_runtime_running_with_reads(
    mut continue_start: impl FnMut() -> bool,
    mut verify: impl FnMut() -> Result<bool, TrackerError>,
    mut status: impl FnMut() -> Result<TrackerStatus, TrackerError>,
    mut wait: impl FnMut(Duration),
) -> Result<TrackerStatus, TrackerError> {
    let mut last_error = TrackerError::TrackerReturnedError(
        "current tracker runtime is not running".to_string(),
    );
    for attempt in 0..START_RECOVERY_PROBE_ATTEMPTS {
        if attempt > 0 {
            wait(START_RECOVERY_PROBE_INTERVAL);
        }
        if !continue_start() {
            return Err(superseded_start_error());
        }
        match verify() {
            Ok(true) => {
                if !continue_start() {
                    return Err(superseded_start_error());
                }
                let current = status();
                if !continue_start() {
                    return Err(superseded_start_error());
                }
                match current {
                    Ok(current) if current.running => return Ok(current),
                    Ok(_) => {
                        last_error = TrackerError::TrackerReturnedError(
                            "current tracker runtime stopped before status confirmation".to_string(),
                        );
                    }
                    Err(error @ TrackerError::ServeTimedOut(_)) => return Err(error),
                    Err(error) => last_error = error,
                }
            }
            Ok(false) => {
                last_error = TrackerError::TrackerReturnedError(
                    "current tracker runtime is not running".to_string(),
                );
            }
            Err(error @ TrackerError::ServeTimedOut(_)) => return Err(error),
            Err(TrackerError::TrackerReturnedError(message))
                if message == "'verify_current_runtime_running'" =>
            {
                // Legacy sidecars return this KeyError when the identity command
                // is absent. Repeating it cannot confirm the running runtime;
                // preserve the original start failure without more probes.
                return Err(TrackerError::TrackerReturnedError(message));
            }
            Err(error) => last_error = error,
        }
    }
    Err(last_error)
}

fn superseded_start_error() -> TrackerError {
    TrackerError::TrackerReturnedError(
        "start superseded by a newer tracking request".to_string(),
    )
}

pub(crate) fn apply_tracking_pause_state(
    mut status: TrackerStatus,
    tracking_paused: bool,
) -> TrackerStatus {
    status.tracking_paused = tracking_paused;
    if tracking_paused {
        // The durable marker records intent, not proof that capture stopped.
        // A failed stop may leave a live daemon; preserve that observation and
        // surface an actionable degraded state while enforcement retries.
        if status.running {
            status.tracker_mode = Some("degraded".into());
            status.message = Some(TRACKER_PAUSE_STILL_RUNNING_MESSAGE.into());
        } else if status.tracker_mode.as_deref() == Some("degraded") {
            status.message = Some(TRACKER_PAUSE_UNCONFIRMED_MESSAGE.into());
        } else {
            status.tracker_mode = Some("stopped".into());
            status.message = Some(TRACKER_PAUSED_MESSAGE.into());
        }
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
        | TrackerError::ShuttingDown
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
    pub(crate) fn backup_for_version_switch(&self, app: &AppHandle) -> Result<Option<String>, String> {
        if !resolve_db_path(app).exists() { return Ok(None); }
        self.invoke::<String>(app, "backup_for_version_switch", json!({})).map(Some).map_err(|e| e.to_string())
    }

    pub fn get_status(&self, app: &AppHandle) -> Result<TrackerStatus, TrackerError> {
        let mut status = self.invoke::<TrackerStatus>(
            app,
            "get_status",
            json!({ "skipAccessibilityProbe": cfg!(target_os = "macos") }),
        )?;
        status.accessibility_granted = merged_accessibility_granted(
            status.accessibility_granted,
            current_process_accessibility_trusted(),
        );
        Ok(status)
    }

    /// Call only after activation is durable and any saved pause has been
    /// cleared. A lost start reply can be recovered by confirming that the
    /// sole daemon belongs to this runtime and database, without replaying
    /// the start mutation.
    pub(crate) fn start_with_recovery(
        &self,
        app: &AppHandle,
        intent_generation: u64,
    ) -> Result<TrackerStatus, TrackerError> {
        let continue_start = || {
            tracking_activation::is_activated(app)
                && tracking_pause::start_intent_is_current(app, intent_generation)
        };
        if !continue_start() {
            return Err(superseded_start_error());
        }
        let start_result = self.start(app);
        if !continue_start() {
            // The mutation may already have started a daemon. Preserve its
            // observation, but do not delay the queued Pause with recovery.
            return start_result;
        }
        reconcile_start_result_with_status(start_result, || {
            let deadline = Instant::now() + START_RECOVERY_TOTAL_BUDGET;
            confirm_current_runtime_running_with_reads(
                continue_start,
                || self.recovery_read(app, "verify_current_runtime_running", deadline),
                || {
                    let mut status: TrackerStatus = self.recovery_read(app, "get_status", deadline)?;
                    status.accessibility_granted = merged_accessibility_granted(
                        status.accessibility_granted,
                        current_process_accessibility_trusted(),
                    );
                    Ok(status)
                },
                thread::sleep,
            )
        })
    }

    fn recovery_read<T: for<'de> Deserialize<'de>>(
        &self,
        app: &AppHandle,
        command: &str,
        deadline: Instant,
    ) -> Result<T, TrackerError> {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(TrackerError::ServeTimedOut(START_RECOVERY_TOTAL_BUDGET));
        }
        let runtime = resolve_tracker_runtime(app)?;
        let db_path = resolve_db_path(app);
        let request = json!({ "command": command, "payload": {} });
        let raw = invoke_one_shot_with_timeout(
            &runtime,
            &db_path,
            &request,
            remaining.min(START_RECOVERY_READ_TIMEOUT),
        )?;
        parse_envelope(&raw)
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
        #[cfg(windows)]
        return Ok(windows_daemon_identity::daemon_matches(pid, &runtime, &db_path));

        #[cfg(unix)]
        let Some(command) = daemon_process_command_line(pid)? else {
            return Ok(false);
        };
        #[cfg(unix)]
        Ok(tracker_daemon_command_matches(&command, &runtime, &db_path))
    }

    pub(crate) fn recover_start(
        &self,
        app: &AppHandle,
        intent_generation: u64,
    ) -> Result<TrackerStatus, TrackerError> {
        if !tracking_activation::is_activated(app)
            || !tracking_pause::start_intent_is_current(app, intent_generation)
        {
            return Err(superseded_start_error());
        }
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
        let raw = self.invoke_raw(app, "get_current_snapshot", json!({}))?;
        parse_current_snapshot_envelope(&raw)
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

    pub fn get_excluded_apps(
        &self,
        app: &AppHandle,
        include_tombstones: bool,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(
            app,
            "get_excluded_apps",
            json!({ "includeTombstones": include_tombstones }),
        )
    }

    pub fn get_excluded_app_history_count(
        &self,
        app: &AppHandle,
        name: String,
        bundle_id: Option<String>,
        site_domain: Option<String>,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(
            app,
            "get_excluded_app_history_count",
            json!({ "name": name, "bundleId": bundle_id, "siteDomain": site_domain }),
        )
    }

    pub fn get_recent_apps(&self, app: &AppHandle, limit: usize) -> Result<Value, TrackerError> {
        self.invoke::<Value>(app, "get_recent_apps", json!({ "limit": limit }))
    }

    /// What saving a classification rule would do to existing records; writes nothing.
    pub fn preview_classification_rule(
        &self,
        app: &AppHandle,
        input: Value,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(app, "preview_classification_rule", json!({ "input": input }))
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

    pub fn get_agent_concurrency_peak(
        &self,
        app: &AppHandle,
        day: Option<String>,
        start: Option<String>,
        end: Option<String>,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(
            app,
            "get_agent_concurrency_peak",
            build_period_payload(day, start, end),
        )
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

    pub fn test_ssh_agent_source(
        &self,
        app: &AppHandle,
        host: String,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(app, "test_ssh_agent_source", json!({ "host": host }))
    }

    pub fn list_ssh_agent_sources(&self, app: &AppHandle) -> Result<Value, TrackerError> {
        self.invoke::<Value>(app, "list_ssh_agent_sources", json!({}))
    }

    pub fn collect_ssh_agent_source(
        &self,
        app: &AppHandle,
        host: String,
        backfill_days: Option<u32>,
    ) -> Result<Value, TrackerError> {
        let mut payload = serde_json::Map::new();
        payload.insert("host".into(), json!(host));
        if let Some(days) = backfill_days {
            payload.insert("backfillDays".into(), json!(days));
        }
        self.invoke::<Value>(app, "collect_ssh_agent_source", Value::Object(payload))
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

    pub fn get_site_icons(
        &self,
        app: &AppHandle,
        domains: &[String],
        cached_only: bool,
    ) -> Result<Value, TrackerError> {
        let mut icons = serde_json::Map::new();
        for (domain, icon) in resolve_site_icons_batch(app, domains, cached_only)? {
            icons.insert(domain, icon.map(Value::String).unwrap_or(Value::Null));
        }
        Ok(Value::Object(icons))
    }

    fn invoke<T: for<'de> Deserialize<'de>>(
        &self,
        app: &AppHandle,
        command: &str,
        payload: Value,
    ) -> Result<T, TrackerError> {
        let raw = self.invoke_raw(app, command, payload)?;
        parse_envelope::<T>(&raw)
    }

    fn invoke_raw(
        &self,
        app: &AppHandle,
        command: &str,
        payload: Value,
    ) -> Result<Vec<u8>, TrackerError> {
        let runtime = resolve_tracker_runtime(app)?;
        let db_path = resolve_db_path(app);
        let retry_safety = sidecar_command_retry_safety(command);

        let request = json!({
            "command": command,
            "payload": payload,
        });

        if let Some(timeout) = ssh_agent_one_shot_timeout(command) {
            return invoke_one_shot_with_timeout(
                &runtime,
                &db_path,
                &request,
                timeout.max(serve_round_trip_timeout()),
            );
        }

        // Fast path: reuse a long-lived `serve` process so each request avoids
        // the ~160ms interpreter/import cold-start (and the contention of
        // spawning several interpreters at once during a refresh burst).
        invoke_with_serve_fallback(
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
        )
    }
}

fn parse_current_snapshot_envelope(raw: &[u8]) -> Result<Value, TrackerError> {
    let envelope = serde_json::from_slice::<SidecarEnvelope<Value>>(raw)
        .map_err(|err| TrackerError::ParseFailed(err.to_string()))?;

    if !envelope.ok {
        return Err(TrackerError::TrackerReturnedError(
            envelope.error.unwrap_or_else(|| "unknown tracker error".into()),
        ));
    }

    // Only current activity is optional: a failed foreground read is a gap.
    Ok(envelope.data.unwrap_or(Value::Null))
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

#[cfg(any(unix, test))]
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
/// macOS keeps the historical ps probe. Windows checks the parsed arguments
/// and safely simplifies verbatim paths in windows_daemon_identity.
#[cfg(unix)]
fn daemon_process_command_line(pid: u32) -> Result<Option<String>, TrackerError> {
    let mut command = Command::new("ps");
    command.args(["-p", &pid.to_string(), "-o", "command="]);
    daemon_process_command_line_from(command)
}

#[cfg(all(test, unix))]
pub(crate) fn inspect_process_command_for_test(
    command: Command,
) -> Result<Option<String>, TrackerError> {
    daemon_process_command_line_from(command)
}

#[cfg(unix)]
fn daemon_process_command_line_from(mut command: Command) -> Result<Option<String>, TrackerError> {
    use std::io::Read;
    use std::os::fd::AsRawFd;

    const INSPECTION_TIMEOUT: Duration = Duration::from_secs(1);
    const MAX_INSPECTION_OUTPUT: usize = 256 * 1024;

    let started = Instant::now();
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| TrackerError::CommandFailed(error.to_string()))?;
    let result = (|| {
        let mut stdout = child.stdout.take().ok_or_else(|| {
            TrackerError::CommandFailed("process inspection stdout unavailable".into())
        })?;
        // Drain on this thread without blocking on pipe capacity or an inherited
        // pipe after child exit. No reader thread can outlive the exit deadline.
        let fd = stdout.as_raw_fd();
        let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
        if flags == -1 || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } == -1
        {
            return Err(TrackerError::CommandFailed(
                std::io::Error::last_os_error().to_string(),
            ));
        }

        let mut output = Vec::new();
        let mut eof = false;
        let mut buffer = [0_u8; 8192];
        loop {
            loop {
                if started.elapsed() >= INSPECTION_TIMEOUT {
                    return Err(TrackerError::CommandFailed(
                        "process inspection timed out".into(),
                    ));
                }
                match stdout.read(&mut buffer) {
                    Ok(0) => {
                        eof = true;
                        break;
                    }
                    Ok(count) => {
                        if output.len() + count > MAX_INSPECTION_OUTPUT {
                            return Err(TrackerError::CommandFailed(
                                "process inspection output exceeded limit".into(),
                            ));
                        }
                        output.extend_from_slice(&buffer[..count]);
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => break,
                    Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                    Err(error) => return Err(TrackerError::CommandFailed(error.to_string())),
                }
            }
            if let Some(status) = child
                .try_wait()
                .map_err(|error| TrackerError::CommandFailed(error.to_string()))?
            {
                if !status.success() {
                    return Ok(None);
                }
                if eof {
                    return Ok(Some(String::from_utf8_lossy(&output).trim().to_string()));
                }
            }
            thread::sleep(Duration::from_millis(10));
        }
    })();
    if result.is_err() {
        // This handle owns only the inspection child, never the inspected daemon.
        let _ = child.kill();
        let _ = child.wait();
    }
    result
}

fn invoke_one_shot(
    runtime: &TrackerRuntime,
    db: &Path,
    request: &Value,
) -> Result<Vec<u8>, TrackerError> {
    invoke_one_shot_with_timeout(runtime, db, request, serve_round_trip_timeout())
}

fn invoke_one_shot_with_timeout(
    runtime: &TrackerRuntime,
    db: &Path,
    request: &Value,
    timeout: Duration,
) -> Result<Vec<u8>, TrackerError> {
    let mut command = command_from_argv(runtime.argv_for_one_shot(db, request))?;
    let output = crate::bounded_process::output(&mut command, timeout).map_err(|error| {
        if error.kind() == std::io::ErrorKind::TimedOut {
            TrackerError::ServeTimedOut(timeout)
        } else {
            TrackerError::CommandFailed(error.to_string())
        }
    })?;
    if !output.status.success() {
        return Err(TrackerError::CommandFailed(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ));
    }
    Ok(output.stdout)
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
    response_overflow: Arc<AtomicBool>,
    runtime_identity: String,
    db_path: PathBuf,
}

static SERVE_PROCESS: OnceLock<Mutex<Option<ServeProcess>>> = OnceLock::new();
static SERVE_EXITING: AtomicBool = AtomicBool::new(false);
static SERVE_REQUEST_ID: AtomicU64 = AtomicU64::new(1);
// PID of the live serve child so shutdown can force-kill it when the serve
// mutex is stuck behind a hung round trip. Unix uses the PID directly;
// Windows also retains an identity-preserving duplicated process handle.
// 0 means no live child.
static SERVE_CHILD_PID: AtomicU32 = AtomicU32::new(0);

#[cfg(windows)]
struct WindowsServeChildHandle {
    pid: u32,
    handle: windows_sys::Win32::Foundation::HANDLE,
}

// A process HANDLE is an owned kernel reference and may be transferred across
// threads. This wrapper closes it exactly once from Drop.
#[cfg(windows)]
unsafe impl Send for WindowsServeChildHandle {}

#[cfg(windows)]
impl WindowsServeChildHandle {
    fn duplicate(child: &Child) -> Result<Self, TrackerError> {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::{
            Foundation::{DuplicateHandle, DUPLICATE_SAME_ACCESS},
            System::Threading::GetCurrentProcess,
        };

        let current_process = unsafe { GetCurrentProcess() };
        let mut duplicated = std::ptr::null_mut();
        let success = unsafe {
            DuplicateHandle(
                current_process,
                child.as_raw_handle(),
                current_process,
                &mut duplicated,
                0,
                0,
                DUPLICATE_SAME_ACCESS,
            )
        };
        if success == 0 || duplicated.is_null() {
            return Err(TrackerError::CommandFailed(format!(
                "unable to retain tracker process handle: {}",
                std::io::Error::last_os_error()
            )));
        }
        Ok(Self {
            pid: child.id(),
            handle: duplicated,
        })
    }

    fn terminate(&self) -> bool {
        unsafe { windows_sys::Win32::System::Threading::TerminateProcess(self.handle, 1) != 0 }
    }
}

#[cfg(windows)]
impl Drop for WindowsServeChildHandle {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.handle);
        }
    }
}

#[cfg(windows)]
fn windows_serve_child_handle() -> &'static Mutex<Option<WindowsServeChildHandle>> {
    static HANDLE: OnceLock<Mutex<Option<WindowsServeChildHandle>>> = OnceLock::new();
    HANDLE.get_or_init(|| Mutex::new(None))
}

#[cfg(windows)]
fn remember_windows_serve_child(child: &Child) -> Result<(), TrackerError> {
    let handle = WindowsServeChildHandle::duplicate(child)?;
    let mut guard = windows_serve_child_handle()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *guard = Some(handle);
    Ok(())
}

#[cfg(windows)]
fn clear_windows_serve_child(pid: u32) {
    let mut guard = windows_serve_child_handle()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if guard.as_ref().is_some_and(|handle| handle.pid == pid) {
        guard.take();
    }
}

#[cfg(windows)]
fn force_kill_windows_serve_child() {
    let handle = windows_serve_child_handle()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .take();
    if let Some(handle) = handle {
        let _ = handle.terminate();
    }
}

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
        | "verify_current_runtime_running"
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
        | "get_excluded_apps"
        | "get_excluded_app_history_count"
        | "get_recent_apps"
        | "search_classification_rule_candidates"
        | "preview_classification_rule"
        | "get_projects"
        | "get_project_assignments"
        | "get_dev_signals"
        | "get_agent_concurrency_peak"
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
        Err(err @ TrackerError::ShuttingDown) => Err(err),
        Err(_) if retry_safety == SidecarCommandRetrySafety::SafeRead => one_shot(),
        // A failed write/flush or a missing serve response is ambiguous: the
        // sidecar may have already completed a mutating request.
        Err(err) => Err(err),
    }
}

fn should_use_one_shot_when_serve_busy(command: &str) -> bool {
    command == "get_timeline_page"
}

/// SSH source commands wait on another machine: the tracker allows 15s for a
/// connection test and 45s for the remote export, then ingests what came back.
/// They need no warm serve state, so each runs in its own bounded one-shot
/// process. A slow first import then neither exceeds the shared serve budget
/// nor holds the serve slot that every screen refresh waits behind.
fn ssh_agent_one_shot_timeout(command: &str) -> Option<Duration> {
    match command {
        "list_ssh_agent_sources" => Some(Duration::from_secs(15)),
        "test_ssh_agent_source" => Some(Duration::from_secs(30)),
        "collect_ssh_agent_source" => Some(Duration::from_secs(120)),
        _ => None,
    }
}

fn serve_slot() -> &'static Mutex<Option<ServeProcess>> {
    SERVE_PROCESS.get_or_init(|| Mutex::new(None))
}

fn ensure_serve_accepting_requests() -> Result<(), TrackerError> {
    if SERVE_EXITING.load(Ordering::SeqCst) {
        Err(TrackerError::ShuttingDown)
    } else {
        Ok(())
    }
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
    #[cfg(windows)]
    if let Err(error) = remember_windows_serve_child(&child) {
        let _ = child.kill();
        let _ = child.wait();
        return Err(error);
    }
    SERVE_CHILD_PID.store(child.id(), Ordering::SeqCst);

    // The protocol has one request in flight. Reject unsolicited response
    // floods without blocking the reader: backpressure here could deadlock
    // a sidecar writing stdout while the caller writes its next stdin request.
    let (response_sender, responses) = mpsc::sync_channel(1);
    let response_overflow = Arc::new(AtomicBool::new(false));
    let reader_overflow = Arc::clone(&response_overflow);
    thread::spawn(move || {
        collect_serve_responses(BufReader::new(stdout), response_sender, reader_overflow);
    });

    Ok(ServeProcess {
        child,
        stdin,
        responses,
        response_overflow,
        runtime_identity: runtime.identity(),
        db_path: db.to_path_buf(),
    })
}

fn collect_serve_responses(
    mut reader: impl BufRead,
    sender: mpsc::SyncSender<std::io::Result<String>>,
    overflow: Arc<AtomicBool>,
) {
    loop {
        let response = read_serve_response(&mut reader, crate::bounded_process::MAX_STDOUT_BYTES);
        let eof = matches!(&response, Ok(line) if line.is_empty());
        let finished = eof || response.is_err();
        match sender.try_send(response) {
            Ok(()) => {}
            Err(mpsc::TrySendError::Full(_)) => {
                // EOF is a terminal signal, not another response. The queued
                // final reply remains valid when a one-response sidecar exits.
                if !eof { overflow.store(true, Ordering::SeqCst); }
                break;
            }
            Err(mpsc::TrySendError::Disconnected(_)) => break,
        }
        if finished { break; }
    }
}

fn read_serve_response(reader: &mut impl BufRead, limit: usize) -> std::io::Result<String> {
    let mut line = String::new();
    // Read at most one byte past the limit, including the newline. Checking
    // after an unrestricted read_line would already have allocated the output.
    reader.take(limit as u64 + 1).read_line(&mut line)?;
    if line.len() > limit {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("tracker response exceeded {limit} byte limit"),
        ));
    }
    Ok(line)
}

fn kill_serve_process(mut proc: ServeProcess) {
    let pid = proc.child.id();
    let _ = proc.child.kill();
    let _ = proc.child.wait();
    #[cfg(windows)]
    clear_windows_serve_child(pid);
    let _ = SERVE_CHILD_PID.compare_exchange(pid, 0, Ordering::SeqCst, Ordering::SeqCst);
}

#[derive(Clone, Copy)]
struct ServeInvocationBudget {
    started: Instant,
    timeout: Duration,
}

impl ServeInvocationBudget {
    fn new() -> Self {
        Self {
            started: Instant::now(),
            timeout: serve_round_trip_timeout(),
        }
    }

    fn remaining(self) -> Result<Duration, TrackerError> {
        let remaining = self.timeout.saturating_sub(self.started.elapsed());
        if remaining.is_zero() {
            Err(TrackerError::ServeTimedOut(self.timeout))
        } else {
            Ok(remaining)
        }
    }
}

const SERVE_LOCK_POLL_INTERVAL: Duration = Duration::from_millis(5);

fn lock_serve_slot_until<'a>(
    slot: &'a Mutex<Option<ServeProcess>>,
    budget: ServeInvocationBudget,
) -> Result<std::sync::MutexGuard<'a, Option<ServeProcess>>, TrackerError> {
    loop {
        let remaining = budget.remaining()?;
        match slot.try_lock() {
            Ok(guard) => return Ok(guard),
            Err(TryLockError::Poisoned(_)) => {
                return Err(TrackerError::CommandFailed("serve lock poisoned".into()));
            }
            Err(TryLockError::WouldBlock) => {
                thread::sleep(remaining.min(SERVE_LOCK_POLL_INTERVAL));
            }
        }
    }
}

fn serve_round_trip(
    proc: &mut ServeProcess,
    line: &str,
    budget: ServeInvocationBudget,
) -> Result<String, TrackerError> {
    reject_response_overflow(proc)?;
    proc.stdin
        .write_all(line.as_bytes())
        .map_err(serve_io_err)?;
    proc.stdin.write_all(b"\n").map_err(serve_io_err)?;
    proc.stdin.flush().map_err(serve_io_err)?;

    let remaining = budget.remaining()?;
    let response = proc.responses.recv_timeout(remaining);
    reject_response_overflow(proc)?;
    match response {
        Ok(Ok(response)) if response.is_empty() => Err(TrackerError::CommandFailed(
            "serve process closed its output".into(),
        )),
        Ok(Ok(response)) => Ok(response),
        Ok(Err(err)) => Err(serve_io_err(err)),
        Err(RecvTimeoutError::Timeout) => {
            // A wedged sidecar would otherwise hold the serve mutex forever;
            // kill it so the slot resets and a later call respawns.
            let _ = proc.child.kill();
            Err(TrackerError::ServeTimedOut(budget.timeout))
        }
        Err(RecvTimeoutError::Disconnected) => Err(TrackerError::CommandFailed(
            "serve reader thread terminated".into(),
        )),
    }
}

fn reject_response_overflow(proc: &ServeProcess) -> Result<(), TrackerError> {
    if proc.response_overflow.load(Ordering::SeqCst) {
        Err(TrackerError::CommandFailed("serve response queue exceeded limit".into()))
    } else {
        Ok(())
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
    // Lock admission and response waiting spend one invocation budget.
    ensure_serve_accepting_requests()?;
    let budget = ServeInvocationBudget::new();
    let slot = serve_slot();
    let mut guard = match lock_mode {
        ServeLockMode::Wait => lock_serve_slot_until(slot, budget)?,
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

    ensure_serve_accepting_requests()?;
    budget.remaining()?;

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
        ensure_serve_accepting_requests()?;
        budget.remaining()?;
        if guard.is_none() {
            *guard = Some(spawn_serve_process(runtime, db)?);
        }

        let id = SERVE_REQUEST_ID.fetch_add(1, Ordering::Relaxed);
        let mut framed = request.clone();
        if let Some(object) = framed.as_object_mut() {
            object.insert("id".into(), json!(id));
        }
        let line = framed.to_string();

        // Exit can begin while process creation holds the slot. In that case
        // no request may be written to a child published after shutdown's wait.
        if let Err(error) = ensure_serve_accepting_requests() {
            if let Some(proc) = guard.take() {
                kill_serve_process(proc);
            }
            return Err(error);
        }
        budget.remaining()?;
        let attempt = {
            match guard.as_mut() {
                Some(proc) => serve_round_trip(proc, &line, budget),
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
/// recording does not keep running after the user quits. Runtime resolution
/// and the one-shot Stop share one budget; the caller reaps its Stop child
/// before returning to the app's final exit.
pub fn stop_tracking_daemon_for_app_exit(app: &AppHandle) {
    let app = app.clone();
    let _ = stop_tracking_daemon_for_app_exit_with(move || {
        Ok((resolve_tracker_runtime(&app)?, resolve_db_path(&app)))
    });
}

pub(crate) fn shutdown_serve_for_app_exit() {
    // An already-admitted Start must not overtake the independent exit Stop.
    // Close admission before terminating serve so waiters cannot respawn it.
    SERVE_EXITING.store(true, Ordering::SeqCst);
    shutdown_serve_process();
}

fn stop_tracking_daemon_for_app_exit_with(
    resolve: impl FnOnce() -> Result<(TrackerRuntime, PathBuf), TrackerError> + Send + 'static,
) -> Result<Vec<u8>, TrackerError> {
    let deadline = Instant::now() + EXIT_STOP_TRACKING_WAIT;
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        // A late resolver may finish after Quit's budget, but cannot send Stop.
        let _ = sender.send(resolve());
    });
    let (runtime, db) = receiver
        .recv_timeout(deadline.saturating_duration_since(Instant::now()))
        .map_err(|error| match error {
            RecvTimeoutError::Timeout => TrackerError::ServeTimedOut(EXIT_STOP_TRACKING_WAIT),
            RecvTimeoutError::Disconnected => {
                TrackerError::CommandFailed("exit tracker runtime resolution failed".into())
            }
        })??;
    let remaining = deadline.saturating_duration_since(Instant::now());
    if remaining.is_zero() {
        return Err(TrackerError::ServeTimedOut(EXIT_STOP_TRACKING_WAIT));
    }
    // Interactive serve may be busy. Send exactly one Stop independently, with
    // Python's existing process/DB ownership checks. Keep child ownership on
    // the exit caller: a detached worker's Drop might never run at app exit.
    invoke_one_shot_with_timeout(
        &runtime,
        &db,
        &json!({"command": "stop_tracking", "payload": {}}),
        remaining,
    )
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
    #[cfg(unix)]
    {
        let pid = SERVE_CHILD_PID.swap(0, Ordering::SeqCst);
        if pid != 0 {
            force_kill_pid(pid);
        }
    }
    #[cfg(windows)]
    {
        SERVE_CHILD_PID.store(0, Ordering::SeqCst);
        force_kill_windows_serve_child();
    }
}

#[cfg(unix)]
fn force_kill_pid(pid: u32) {
    let _ = Command::new("kill").arg("-9").arg(pid.to_string()).status();
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
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // The packaged tracker is a console-subsystem executable because its
        // request protocol uses stdin/stdout. CREATE_NO_WINDOW preserves those
        // redirected pipes without flashing a console over the desktop app.
        command.creation_flags(WINDOWS_CREATE_NO_WINDOW);
        // Detached sampling daemons inherit this identity through both serve
        // and one-shot launches. Their retained process handle ends capture
        // even when the best-effort stop RPC outlives the app's exit budget.
        let creation_time = windows_app_process_creation_time()?;
        command.env("DRIFTY_TRACKER_APP_PID", std::process::id().to_string());
        command.env("DRIFTY_TRACKER_APP_CREATION_TIME", creation_time.to_string());
    }
    #[cfg(target_os = "macos")]
    {
        // The daemon can outlive both a failed exit cleanup and the one-shot
        // process that recovered it. Bind it to this app's native lifetime.
        // Refuse launch if identity cannot be read; missing env means standalone CLI.
        let creation_time = macos_app_process_creation_time()?;
        command.env("DRIFTY_TRACKER_APP_PID", std::process::id().to_string());
        command.env(
            "DRIFTY_TRACKER_APP_CREATION_TIME",
            creation_time.to_string(),
        );
    }
    for (key, value) in crate::observability::tracker_sentry_env_vars() {
        command.env(key, value);
    }
    Ok(command)
}

#[cfg(target_os = "macos")]
fn macos_app_process_creation_time() -> Result<u64, TrackerError> {
    let pid = std::process::id();
    // proc_bsdinfo is defined by the platform libc ABI. Python validates the
    // same Unix birth time before and after retaining a kqueue exit subscription.
    let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of_val(&info) as i32;
    let read = unsafe {
        libc::proc_pidinfo(
            pid as i32,
            libc::PROC_PIDTBSDINFO,
            0,
            &mut info as *mut _ as *mut libc::c_void,
            size,
        )
    };
    if read != size || info.pbi_pid != pid || info.pbi_start_tvusec >= 1_000_000 {
        return Err(TrackerError::CommandFailed(
            "tracker owning app process identity is unavailable".into(),
        ));
    }
    info.pbi_start_tvsec
        .checked_mul(1_000_000)
        .and_then(|seconds| seconds.checked_add(info.pbi_start_tvusec))
        .filter(|created| *created > 0)
        .ok_or_else(|| {
            TrackerError::CommandFailed("tracker owning app process identity is unavailable".into())
        })
}

#[cfg(any(windows, test))]
fn windows_filetime_value(low: u32, high: u32) -> u64 {
    (u64::from(high) << 32) | u64::from(low)
}

#[cfg(windows)]
fn windows_app_process_creation_time() -> Result<u64, TrackerError> {
    use windows_sys::Win32::{
        Foundation::FILETIME,
        System::Threading::{GetCurrentProcess, GetProcessTimes},
    };
    let mut created = FILETIME {
        dwLowDateTime: 0,
        dwHighDateTime: 0,
    };
    let mut exited = created;
    let mut kernel = created;
    let mut user = created;
    let read = unsafe {
        GetProcessTimes(
            GetCurrentProcess(),
            &mut created,
            &mut exited,
            &mut kernel,
            &mut user,
        )
    };
    if read == 0 {
        return Err(TrackerError::CommandFailed(
            "tracker owning app process identity is unavailable".into(),
        ));
    }
    Ok(windows_filetime_value(
        created.dwLowDateTime,
        created.dwHighDateTime,
    ))
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
    resolve_tracker_runtime_from_paths_with_policy(
        resource_dir,
        cwd,
        cfg!(debug_assertions),
        python_resolver,
    )
}

fn resolve_tracker_runtime_from_paths_with_policy(
    resource_dir: Option<&Path>,
    cwd: &Path,
    allow_source_runtime: bool,
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

    if !allow_source_runtime {
        return Err(TrackerError::MissingRuntime(
            "bundled tracker sidecar is unavailable; production builds do not execute source Python"
                .into(),
        ));
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

    // Current Windows installs use this canonical onedir bundle. A legacy
    // flat executable (or target-suffixed build artifact) can remain beside
    // it after an update; never let that compatibility fallback shadow the
    // tracker shipped with the current app. macOS's Contents/MacOS sidecar
    // above keeps priority over all resource and executable-adjacent paths.
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf));
    let onedir_exe = format!("drifty-tracker{}", std::env::consts::EXE_SUFFIX);
    for root in std::iter::once(resource_dir).chain(exe_dir.as_deref()) {
        candidates.push(root.join("drifty-tracker").join(&onedir_exe));
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
    if let Some(exe_dir) = exe_dir {
        for name in sidecar_file_names() {
            candidates.push(exe_dir.join(&name));
            candidates.push(exe_dir.join("binaries").join(&name));
        }
        for rel in sidecar_bundle_paths() {
            candidates.push(exe_dir.join(&rel));
            candidates.push(exe_dir.join("binaries").join(&rel));
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
        command.creation_flags(WINDOWS_CREATE_NO_WINDOW);
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

pub(crate) fn resolve_db_path(app: &AppHandle) -> PathBuf {
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

    #[cfg(unix)]
    static SERVE_TEST_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn active_pause_preserves_a_live_or_unknown_tracker_observation() {
        let status = TrackerStatus {
            running: true,
            tracking_paused: false,
            accessibility_granted: true,
            last_event_at: None,
            database_path: None,
            tracker_mode: Some("tracking".into()),
            idle_seconds: None,
            idle_detection_available: None,
            message: None,
        };
        let still_running = apply_tracking_pause_state(status.clone(), true);
        assert!(still_running.running);
        assert!(still_running.tracking_paused);
        assert_eq!(still_running.tracker_mode.as_deref(), Some("degraded"));
        assert_eq!(
            still_running.message.as_deref(),
            Some(TRACKER_PAUSE_STILL_RUNNING_MESSAGE)
        );

        let unknown = apply_tracking_pause_state(degraded_tracker_status("failed".into()), true);
        assert!(!unknown.running);
        assert!(unknown.tracking_paused);
        assert_eq!(unknown.tracker_mode.as_deref(), Some("degraded"));
        assert_eq!(
            unknown.message.as_deref(),
            Some(TRACKER_PAUSE_UNCONFIRMED_MESSAGE)
        );

        let confirmed_stopped = apply_tracking_pause_state(
            TrackerStatus {
                running: false,
                ..status
            },
            true,
        );
        assert_eq!(confirmed_stopped.tracker_mode.as_deref(), Some("stopped"));
        assert_eq!(confirmed_stopped.message.as_deref(), Some(TRACKER_PAUSED_MESSAGE));
    }
    const MUTATING_COMMANDS: &[&str] = &[
        "backup_for_version_switch",
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
    fn current_snapshot_envelope_preserves_capture_gaps_without_relaxing_other_commands() {
        let gap = br#"{"ok":true,"data":null,"error":null}"#;
        let captured = br#"{"ok":true,"data":{"appName":"Code"},"error":null}"#;
        let failed = br#"{"ok":false,"data":null,"error":"capture failed"}"#;

        assert_eq!(parse_current_snapshot_envelope(gap).unwrap(), Value::Null);
        assert_eq!(
            parse_current_snapshot_envelope(captured).unwrap()["appName"],
            Value::String("Code".into())
        );
        assert!(matches!(parse_envelope::<Value>(gap), Err(TrackerError::MissingData)));
        assert!(matches!(
            parse_current_snapshot_envelope(failed),
            Err(TrackerError::TrackerReturnedError(message)) if message == "capture failed"
        ));
    }

    #[test]
    fn timeline_envelope_preserves_passive_engagement_evidence() {
        let raw = br#"{"ok":true,"data":[{"id":"42","engagementEvidence":"foreground-audio"}],"error":null}"#;

        let timeline = parse_envelope::<Value>(raw).expect("timeline envelope");

        assert_eq!(
            timeline[0]["engagementEvidence"],
            Value::String("foreground-audio".into())
        );
    }

    #[test]
    fn raw_timeline_envelope_passes_data_through_unchanged() {
        let raw = br#"{"ok": true, "data": [{"id": "42", "appName": "\uc54c\ub9bc", "durationSeconds": 30}], "error": null}"#;

        let timeline =
            parse_envelope::<Box<serde_json::value::RawValue>>(raw).expect("raw envelope");

        assert_eq!(
            timeline.get(),
            r#"[{"id": "42", "appName": "\uc54c\ub9bc", "durationSeconds": 30}]"#
        );
        assert_eq!(
            serde_json::to_string(&timeline).expect("serialize"),
            timeline.get()
        );
        let parsed: Value = serde_json::from_str(timeline.get()).expect("valid json");
        assert_eq!(parsed[0]["appName"], Value::String("알림".into()));
    }

    #[test]
    fn raw_timeline_envelope_still_reports_tracker_errors() {
        let raw = br#"{"ok": false, "data": null, "error": "database is locked"}"#;

        let error =
            parse_envelope::<Box<serde_json::value::RawValue>>(raw).expect_err("tracker error");

        assert!(
            matches!(error, TrackerError::TrackerReturnedError(message) if message == "database is locked")
        );
    }

    #[cfg(windows)]
    #[test]
    fn duplicated_windows_child_handle_terminates_the_original_process_object() {
        use std::os::windows::process::CommandExt;

        let mut command = Command::new("ping");
        command
            .args(["-n", "30", "127.0.0.1"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(WINDOWS_CREATE_NO_WINDOW);
        let mut child = command.spawn().expect("spawn bounded Windows child");
        let handle = match WindowsServeChildHandle::duplicate(&child) {
            Ok(handle) => handle,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                panic!("duplicate child handle: {error}");
            }
        };

        assert_eq!(handle.pid, child.id());
        assert!(handle.terminate());
        assert!(!child.wait().expect("wait for terminated child").success());
    }

    #[test]
    fn windows_owner_creation_time_preserves_all_filetime_bits() {
        assert_eq!(
            windows_filetime_value(0x9abc_def0, 0x1234_5678),
            0x1234_5678_9abc_def0
        );
        assert_eq!(windows_filetime_value(u32::MAX, u32::MAX), u64::MAX);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn all_macos_tracker_launch_modes_carry_the_current_app_identity() {
        let created = macos_app_process_creation_time().unwrap().to_string();
        assert_eq!(
            created,
            macos_app_process_creation_time().unwrap().to_string()
        );
        for mode in ["serve", "--request-json", "daemon"] {
            let command = command_from_argv(vec!["drifty-tracker".into(), mode.into()])
                .expect("owned tracker command");
            let env: std::collections::HashMap<_, _> = command.get_envs().collect();
            assert_eq!(
                env.get(std::ffi::OsStr::new("DRIFTY_TRACKER_APP_PID"))
                    .copied()
                    .flatten(),
                Some(std::ffi::OsStr::new(&std::process::id().to_string()))
            );
            assert_eq!(
                env.get(std::ffi::OsStr::new("DRIFTY_TRACKER_APP_CREATION_TIME"))
                    .copied()
                    .flatten(),
                Some(std::ffi::OsStr::new(&created))
            );
        }
    }

    #[cfg(windows)]
    #[test]
    fn all_windows_tracker_launch_modes_carry_the_current_app_identity() {
        for mode in ["serve", "--request-json", "daemon"] {
            let command = command_from_argv(vec!["drifty-tracker".into(), mode.into()])
                .expect("owned tracker command");
            let env: std::collections::HashMap<_, _> = command.get_envs().collect();
            assert_eq!(
                env.get(std::ffi::OsStr::new("DRIFTY_TRACKER_APP_PID"))
                    .copied()
                    .flatten(),
                Some(std::ffi::OsStr::new(&std::process::id().to_string()))
            );
            assert_eq!(
                env.get(std::ffi::OsStr::new("DRIFTY_TRACKER_APP_CREATION_TIME"))
                    .copied()
                    .flatten(),
                Some(std::ffi::OsStr::new(
                    &windows_app_process_creation_time().unwrap().to_string()
                ))
            );
        }
    }

    #[test]
    fn stop_daemon_for_app_exit_bounds_runtime_resolution() {
        let started = Instant::now();
        let result = stop_tracking_daemon_for_app_exit_with(|| {
            thread::sleep(EXIT_STOP_TRACKING_WAIT + Duration::from_secs(5));
            Err(TrackerError::MissingRuntime("fixture".into()))
        });
        assert!(matches!(result, Err(TrackerError::ServeTimedOut(_))));
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
    fn ssh_agent_commands_run_outside_the_shared_serve_budget() {
        // The remote export alone may take 45s; its budget must cover that plus
        // ingestion instead of the 30s shared serve round trip.
        let collect =
            ssh_agent_one_shot_timeout("collect_ssh_agent_source").expect("collect is one-shot");
        assert!(collect > SERVE_ROUND_TRIP_TIMEOUT + Duration::from_secs(45));
        let test = ssh_agent_one_shot_timeout("test_ssh_agent_source").expect("test is one-shot");
        assert!(test > Duration::from_secs(15));
        assert!(ssh_agent_one_shot_timeout("list_ssh_agent_sources").is_some());
        assert!(ssh_agent_one_shot_timeout("get_timeline_page").is_none());
        assert!(ssh_agent_one_shot_timeout("sync_dev_signals").is_none());
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
            "verify_current_runtime_running",
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
            "get_excluded_apps",
            "get_excluded_app_history_count",
            "get_recent_apps",
            "search_classification_rule_candidates",
            "preview_classification_rule",
            "get_projects",
            "get_project_assignments",
            "get_dev_signals",
            "get_agent_concurrency_peak",
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
        let sidecar = resource_dir.join(format!("drifty-tracker{}", std::env::consts::EXE_SUFFIX));
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
    fn production_runtime_never_falls_back_to_source_python() {
        let repo = temp_dir_path("production-no-source-fallback");
        let resource_dir = repo.join("installed-resources");
        let script = repo
            .join("services")
            .join("tracker-python")
            .join("app")
            .join("main.py");
        std::fs::create_dir_all(&resource_dir).expect("create resource dir");
        std::fs::create_dir_all(script.parent().expect("script parent"))
            .expect("create script dir");
        std::fs::write(&script, b"print('must not run')").expect("write source script");

        let err = resolve_tracker_runtime_from_paths_with_policy(
            Some(&resource_dir),
            repo.as_path(),
            false,
            || panic!("production runtime must not resolve Python"),
        )
        .expect_err("missing production sidecar must fail closed");

        assert!(matches!(err, TrackerError::MissingRuntime(_)));
        assert!(err.to_string().contains("do not execute source Python"));
        let _ = std::fs::remove_dir_all(repo);
    }

    #[test]
    fn packaged_sidecar_ignores_python_bin_override() {
        let resource_dir = temp_dir_path("packaged-ignores-python");
        let sidecar = resource_dir.join(format!("drifty-tracker{}", std::env::consts::EXE_SUFFIX));
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
    fn packaged_sidecar_selects_onedir_bundle_under_resources() {
        let resource_dir = temp_dir_path("packaged-onedir-runtime");
        let sidecar = resource_dir
            .join("drifty-tracker")
            .join(format!("drifty-tracker{}", std::env::consts::EXE_SUFFIX));
        std::fs::create_dir_all(sidecar.parent().expect("onedir parent")).expect("create onedir");
        std::fs::write(&sidecar, b"fake sidecar").expect("write sidecar");

        let runtime =
            resolve_tracker_runtime_from_paths(Some(&resource_dir), resource_dir.as_path())
                .expect("onedir packaged sidecar runtime");

        assert_eq!(runtime.kind, TrackerRuntimeKind::PackagedSidecar);
        assert_eq!(runtime.executable_path, sidecar);

        let _ = std::fs::remove_dir_all(resource_dir);
    }

    #[test]
    fn packaged_sidecar_prefers_current_onedir_over_legacy_flat_executables() {
        let resource_dir = temp_dir_path("packaged-current-onedir-priority");
        let sidecar = resource_dir
            .join("drifty-tracker")
            .join(format!("drifty-tracker{}", std::env::consts::EXE_SUFFIX));
        std::fs::create_dir_all(sidecar.parent().expect("onedir parent"))
            .expect("create current onedir");
        std::fs::write(&sidecar, b"current bundled tracker").expect("write current tracker");
        let legacy_dir = resource_dir.join("binaries");
        std::fs::create_dir_all(&legacy_dir).expect("create legacy directory");
        for name in sidecar_file_names() {
            std::fs::write(legacy_dir.join(&name), b"legacy tracker")
                .expect("write legacy tracker");
            // Windows' flat .exe and the current directory can coexist at
            // the install root. Unix's extensionless name is the directory.
            if !std::env::consts::EXE_SUFFIX.is_empty() {
                std::fs::write(resource_dir.join(name), b"legacy root tracker")
                    .expect("write legacy root tracker");
            }
        }

        let runtime = resolve_tracker_runtime_from_paths_with_python_resolver(
            Some(&resource_dir),
            resource_dir.as_path(),
            || panic!("packaged runtime must not resolve Python"),
        )
        .expect("current packaged runtime");

        assert_eq!(runtime.executable_path, sidecar);
        assert_eq!(runtime.kind, TrackerRuntimeKind::PackagedSidecar);
        let _ = std::fs::remove_dir_all(resource_dir);
    }

    #[cfg(target_os = "macos")]
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
        let alternate = resource_dir.join("drifty-tracker").join("drifty-tracker");
        std::fs::create_dir_all(alternate.parent().expect("alternate parent"))
            .expect("create alternate onedir");
        std::fs::write(alternate, b"alternate tracker").expect("write alternate tracker");

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

    #[cfg(unix)]
    #[test]
    fn ordinary_one_shot_bounds_hung_children_and_inherited_output() {
        let _serve_guard = SERVE_TEST_LOCK.lock().expect("serialize timeout override");
        let dir = tempfile::tempdir().expect("create fixture directory");
        let timeout = Duration::from_millis(150);
        for (name, action) in [
            ("hung", "exec sleep 2"),
            ("inherited", "sleep 2 &\nprintf '{}\\n'\nexit 0"),
        ] {
            let script = dir.path().join(name);
            std::fs::write(
                &script,
                format!("#!/bin/sh\nif [ \"$1\" = \"warmup\" ]; then exit 0; fi\n{action}\n"),
            )
            .unwrap();
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
            assert!(Command::new(&script).arg("warmup").status().unwrap().success());
            let runtime = TrackerRuntime::packaged_sidecar(script);
            let previous_timeout = std::env::var_os("DRIFTY_TRACKER_ROUNDTRIP_TIMEOUT_MS");
            std::env::set_var("DRIFTY_TRACKER_ROUNDTRIP_TIMEOUT_MS", "150");
            let started = Instant::now();
            let result = invoke_one_shot(
                &runtime,
                &dir.path().join("tracker.sqlite3"),
                &json!({ "command": "get_status", "payload": {} }),
            );
            let elapsed = started.elapsed();
            match previous_timeout {
                Some(value) => std::env::set_var("DRIFTY_TRACKER_ROUNDTRIP_TIMEOUT_MS", value),
                None => std::env::remove_var("DRIFTY_TRACKER_ROUNDTRIP_TIMEOUT_MS"),
            }
            assert!(matches!(result, Err(TrackerError::ServeTimedOut(value)) if value == timeout), "{name}: {result:?}");
            assert!(elapsed < Duration::from_secs(1), "{name}: {elapsed:?}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn daemon_inspection_returns_before_the_exit_cleanup_budget() {
        let dir = tempfile::tempdir().expect("owned inspection fixture");
        let pid_path = dir.path().join("inspection.pid");
        let mut command = Command::new("/usr/bin/python3");
        command.args(["-c", "import os,pathlib,sys,time;pathlib.Path(sys.argv[1]).write_text(str(os.getpid()));time.sleep(3);print('synthetic daemon')"]);
        command.arg(&pid_path);
        let started = Instant::now();
        let result = daemon_process_command_line_from(command);
        assert!(
            matches!(&result, Err(TrackerError::CommandFailed(message)) if message == "process inspection timed out"),
            "a stalled inspection must time out: {result:?}"
        );
        assert!(
            started.elapsed() < Duration::from_secs(2),
            "inspection exceeded exit budget: {:?}",
            started.elapsed()
        );
        let pid = std::fs::read_to_string(pid_path).expect("child started");
        assert!(
            !Command::new("/bin/kill")
                .args(["-0", pid.trim()])
                .stderr(Stdio::null())
                .status()
                .expect("inspect fixture pid")
                .success(),
            "timed-out inspection was not reaped"
        );
    }

    #[cfg(unix)]
    #[test]
    fn daemon_inspection_preserves_trimmed_output_and_unavailable_pid() {
        let mut command = Command::new("/usr/bin/python3");
        command.args(["-c", "print('  synthetic daemon  ')"]);
        assert_eq!(
            daemon_process_command_line_from(command).unwrap(),
            Some("synthetic daemon".into())
        );
        let mut command = Command::new("/usr/bin/python3");
        command.args(["-c", "import sys;sys.exit(9)"]);
        assert_eq!(daemon_process_command_line_from(command).unwrap(), None);
        assert!(daemon_process_command_line(std::process::id())
            .unwrap()
            .is_some());
    }

    #[cfg(unix)]
    #[test]
    fn daemon_inspection_drains_output_larger_than_pipe_capacity() {
        let mut command = Command::new("/usr/bin/python3");
        command.args([
            "-c",
            "import sys;sys.stdout.write('x'*100000);sys.stdout.flush()",
        ]);
        let result = daemon_process_command_line_from(command).unwrap().unwrap();
        assert_eq!(result.len(), 100000);
    }

    #[cfg(unix)]
    #[test]
    fn daemon_inspection_rejects_oversized_output_without_waiting_for_child() {
        let mut command = Command::new("/usr/bin/python3");
        command.args([
            "-c",
            "import sys,time;sys.stdout.write('x'*1000000);sys.stdout.flush();time.sleep(3)",
        ]);
        let started = Instant::now();
        let result = daemon_process_command_line_from(command);
        assert!(
            matches!(result, Err(TrackerError::CommandFailed(message)) if message == "process inspection output exceeded limit")
        );
        assert!(started.elapsed() < Duration::from_secs(2));
    }


    #[cfg(unix)]
    #[test]
    fn daemon_inspection_still_waits_for_child_after_stdout_eof() {
        let mut command = Command::new("/usr/bin/python3");
        command.args(["-c", "import os,time;os.close(1);time.sleep(3)"]);
        let started = Instant::now();
        let result = daemon_process_command_line_from(command);
        assert!(matches!(
            result,
            Err(TrackerError::CommandFailed(message)) if message == "process inspection timed out"
        ));
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[cfg(unix)]
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

    #[cfg(unix)]
    #[test]
    fn lost_start_reply_recovers_through_a_fresh_sidecar_without_replaying_start() {
        let _serve_guard = SERVE_TEST_LOCK.lock().expect("serialize serve tests");
        shutdown_serve_process();

        let dir = temp_dir_path("lost-start-reply");
        std::fs::create_dir_all(&dir).expect("create temp dir");
        let script = dir.join("fake-serve");
        let marker = dir.join("started-once");
        let source = r#"#!/bin/sh
if [ "$1" = "warmup" ]; then exit 0; fi
respond() {
  case "$1" in
    *'"command":"start_tracking"'*)
      printf 'x' >> '__MARKER__'
      exit 0
      ;;
    *'"command":"verify_current_runtime_running"'*)
      if [ -f '__MARKER__' ]; then
        printf '%s\n' '{"ok":true,"data":true}'
      else
        printf '%s\n' '{"ok":true,"data":false}'
      fi
      ;;
    *'"command":"get_status"'*)
      printf '%s\n' '{"ok":true,"data":{"running":true,"accessibilityGranted":false}}'
      ;;
  esac
}
if [ "$1" = "--db" ]; then
  respond "$4"
  exit 0
fi
while IFS= read -r line; do
  respond "$line"
done
"#;
        std::fs::write(&script, source.replace("__MARKER__", &marker.to_string_lossy()))
            .expect("write fake sidecar");
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755))
            .expect("mark sidecar executable");
        assert!(Command::new(&script)
            .arg("warmup")
            .status()
            .expect("warm up sidecar")
            .success());

        let runtime = TrackerRuntime::packaged_sidecar(script);
        let db = dir.join("tracker.sqlite3");
        let verify = json!({ "command": "verify_current_runtime_running", "payload": {} });
        let before: bool = parse_envelope(
            serve_request(&runtime, &db, &verify, SidecarCommandRetrySafety::SafeRead)
                .expect("read stopped baseline")
                .as_bytes(),
        )
        .expect("parse stopped baseline");
        assert!(!before, "a first start has no daemon to recover yet");

        let start_request = json!({ "command": "start_tracking", "payload": {} });
        let start_result = invoke_with_serve_fallback(
            SidecarCommandRetrySafety::Mutation,
            || {
                serve_request(
                    &runtime,
                    &db,
                    &start_request,
                    SidecarCommandRetrySafety::Mutation,
                )
                .map(String::into_bytes)
            },
            || panic!("a lost mutation reply must not replay start through one-shot"),
        )
        .and_then(|raw| parse_envelope::<TrackerStatus>(&raw));
        assert!(matches!(&start_result, Err(TrackerError::CommandFailed(_))));

        let recovered = reconcile_start_result_with_status(start_result, || {
            let verified: bool = parse_envelope(
                &invoke_one_shot_with_timeout(
                    &runtime,
                    &db,
                    &verify,
                    START_RECOVERY_READ_TIMEOUT,
                )?,
            )?;
            if !verified {
                return Err(TrackerError::TrackerReturnedError(
                    "current tracker runtime is not running".into(),
                ));
            }
            let status_request = json!({ "command": "get_status", "payload": {} });
            parse_envelope(
                &invoke_one_shot_with_timeout(
                    &runtime,
                    &db,
                    &status_request,
                    START_RECOVERY_READ_TIMEOUT,
                )?,
            )
        })
        .expect("fresh status recovers the lost start reply");
        assert!(recovered.running);
        assert_eq!(
            std::fs::read_to_string(&marker).expect("start marker"),
            "x",
            "start_tracking must have run exactly once"
        );

        shutdown_serve_process();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn start_recovery_waits_for_a_late_daemon_without_replaying_start() {
        let mut verification_reads = 0;
        let mut status_reads = 0;
        let mut waits = 0;
        let recovered = reconcile_start_result_with_status(
            Err(TrackerError::CommandFailed("start reply lost".into())),
            || {
                confirm_current_runtime_running_with_reads(
                    || true,
                    || {
                        verification_reads += 1;
                        Ok(verification_reads == 4)
                    },
                    || {
                        status_reads += 1;
                        Ok(serde_json::from_value(json!({
                            "running": true,
                            "accessibilityGranted": false,
                        }))
                        .expect("valid tracker status"))
                    },
                    |interval| {
                        assert_eq!(interval, START_RECOVERY_PROBE_INTERVAL);
                        waits += 1;
                    },
                )
            },
        )
        .expect("later matching daemon confirms the one start");
        assert!(recovered.running);
        assert_eq!(verification_reads, 4);
        assert_eq!(status_reads, 1);
        assert_eq!(waits, 3);

        let mut absent_reads = 0;
        let missing = confirm_current_runtime_running_with_reads(
            || true,
            || {
                absent_reads += 1;
                Ok(false)
            },
            || panic!("status must not be accepted without runtime verification"),
            |_| {},
        );
        assert!(missing.is_err());
        assert_eq!(absent_reads, START_RECOVERY_PROBE_ATTEMPTS);
    }

    #[test]
    fn start_recovery_does_not_repeat_an_unsupported_identity_command() {
        let mut reads = 0;
        let result = reconcile_start_result_with_status(
            Err(TrackerError::CommandFailed("original start reply lost".into())),
            || {
                confirm_current_runtime_running_with_reads(
                    || true,
                    || {
                        reads += 1;
                        // Exact request envelope returned by a frozen legacy
                        // tracker that has no identity-verification command.
                        parse_envelope::<bool>(
                            br#"{"ok":false,"data":null,"error":"'verify_current_runtime_running'"}"#,
                        )
                    },
                    || panic!("an unsupported identity command cannot authorize status"),
                    |_| panic!("an unsupported command must not schedule another attempt"),
                )
            },
        );
        assert!(matches!(
            result,
            Err(TrackerError::CommandFailed(message)) if message == "original start reply lost"
        ));
        assert_eq!(reads, 1);
    }

    #[test]
    fn start_recovery_still_retries_transient_identity_errors() {
        for first_error in [
            TrackerError::CommandFailed("temporary launch failure".into()),
            TrackerError::TrackerReturnedError("database is locked".into()),
            TrackerError::TrackerReturnedError("'another_key'".into()),
        ] {
            let mut first_error = Some(first_error);
            let mut reads = 0;
            let mut waits = 0;
            let result = confirm_current_runtime_running_with_reads(
                || true,
                || {
                    reads += 1;
                    first_error.take().map_or(Ok(true), Err)
                },
                || {
                    Ok(serde_json::from_value(json!({
                        "running": true,
                        "accessibilityGranted": false,
                    }))
                    .expect("valid tracker status"))
                },
                |_| waits += 1,
            );
            assert!(result.expect("a transient failure may recover").running);
            assert_eq!(reads, 2);
            assert_eq!(waits, 1);
        }
    }

    #[test]
    fn start_recovery_does_not_repeat_a_timed_out_read() {
        let mut reads = 0;
        let result = confirm_current_runtime_running_with_reads(
            || true,
            || {
                reads += 1;
                Err(TrackerError::ServeTimedOut(START_RECOVERY_READ_TIMEOUT))
            },
            || panic!("a timed-out verification cannot authorize status"),
            |_| panic!("a timed-out read must not schedule another attempt"),
        );
        assert!(matches!(result, Err(TrackerError::ServeTimedOut(_))));
        assert_eq!(reads, 1);

        let mut status_reads = 0;
        let result = confirm_current_runtime_running_with_reads(
            || true,
            || Ok(true),
            || {
                status_reads += 1;
                Err(TrackerError::ServeTimedOut(START_RECOVERY_READ_TIMEOUT))
            },
            |_| panic!("a timed-out status must not schedule another attempt"),
        );
        assert!(matches!(result, Err(TrackerError::ServeTimedOut(_))));
        assert_eq!(status_reads, 1);
    }

    #[test]
    fn a_new_pause_after_runtime_verification_skips_the_start_recovery_status_read() {
        use std::sync::atomic::{AtomicBool, Ordering};

        let current = AtomicBool::new(true);
        let mut verification_reads = 0;
        let result = confirm_current_runtime_running_with_reads(
            || current.load(Ordering::SeqCst),
            || {
                verification_reads += 1;
                current.store(false, Ordering::SeqCst);
                Ok(true)
            },
            || panic!("a newer Pause must not wait for another recovery read"),
            |_| panic!("a superseded Start must not retry"),
        );
        assert!(result.is_err());
        assert_eq!(verification_reads, 1);
    }

    #[test]
    fn a_new_pause_during_the_recovery_interval_skips_the_next_identity_probe() {
        use std::sync::atomic::{AtomicBool, Ordering};

        let current = AtomicBool::new(true);
        let mut verification_reads = 0;
        let mut waits = 0;
        let result = confirm_current_runtime_running_with_reads(
            || current.load(Ordering::SeqCst),
            || {
                verification_reads += 1;
                Ok(false)
            },
            || panic!("an absent daemon must not authorize status"),
            |_| {
                waits += 1;
                current.store(false, Ordering::SeqCst);
            },
        );
        assert!(result.is_err());
        assert_eq!(verification_reads, 1);
        assert_eq!(waits, 1);
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
    fn serve_queue_keeps_a_final_reply_at_eof_and_rejects_extra_replies() {
        for (input, expect_overflow) in [("{}\n", false), ("{}\n{}\n", true)] {
            let (sender, receiver) = mpsc::sync_channel(1);
            let overflow = Arc::new(AtomicBool::new(false));
            collect_serve_responses(std::io::Cursor::new(input), sender, Arc::clone(&overflow));
            assert_eq!(overflow.load(Ordering::SeqCst), expect_overflow);
            assert_eq!(receiver.recv().unwrap().unwrap(), "{}\n");
            assert!(receiver.recv().is_err());
        }
    }

    #[cfg(unix)]
    #[test]
    fn unsolicited_serve_responses_fail_before_writing_another_request() {
        let _serve_guard = SERVE_TEST_LOCK.lock().expect("serialize serve tests");
        let dir = tempfile::tempdir().unwrap();
        let script = dir.path().join("unsolicited.py");
        std::fs::write(&script,
            "import sys,time\nsys.stdout.write('{}\\n'*3)\nsys.stdout.flush()\ntime.sleep(5)\n"
        ).unwrap();
        let runtime = TrackerRuntime::source_python(PathBuf::from("/usr/bin/python3"), script);
        let mut proc = spawn_serve_process(&runtime, &dir.path().join("unused.sqlite3")).unwrap();
        let deadline = Instant::now() + Duration::from_secs(3);
        while !proc.response_overflow.load(Ordering::SeqCst) && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(5));
        }
        let overflow = proc.response_overflow.load(Ordering::SeqCst);
        // Larger than the pipe capacity: a write to this non-reading peer
        // would hang if overflow were only checked after submitting a request.
        let result = serve_round_trip(&mut proc, &"x".repeat(1024 * 1024), ServeInvocationBudget::new());
        kill_serve_process(proc);
        assert!(overflow, "unsolicited output must stop at the queue bound");
        assert!(matches!(result,
            Err(TrackerError::CommandFailed(ref message)) if message.contains("queue")));
    }

    #[test]
    fn serve_response_limit_preserves_framing_and_counts_bytes() {
        let mut reader = std::io::Cursor::new("éé\nnext\n");
        assert_eq!(read_serve_response(&mut reader, 5).unwrap(), "éé\n");
        assert_eq!(read_serve_response(&mut reader, 5).unwrap(), "next\n");
        assert_eq!(read_serve_response(&mut reader, 5).unwrap(), "");
        let mut oversized = std::io::Cursor::new("abcdef\nnext\n");
        let error = read_serve_response(&mut oversized, 5).unwrap_err();
        assert_eq!(error.kind(), std::io::ErrorKind::InvalidData);
        assert_eq!(oversized.position(), 6, "stop reading at the byte budget");
        let mut unterminated = std::io::Cursor::new("abcdef");
        assert!(read_serve_response(&mut unterminated, 5).is_err());
        let mut exact_eof = std::io::Cursor::new("abcde");
        assert_eq!(read_serve_response(&mut exact_eof, 5).unwrap(), "abcde");
    }

    #[cfg(unix)]
    #[test]
    fn oversized_serve_response_is_rejected_and_next_request_respawns() {
        let _serve_guard = SERVE_TEST_LOCK.lock().expect("serialize serve tests");
        shutdown_serve_process();
        let dir = tempfile::tempdir().unwrap();
        let script = dir.path().join("oversized-serve.py");
        let marker = dir.path().join("sent-oversized");
        std::fs::write(
            &script,
            format!(
                r#"import pathlib, sys
marker = pathlib.Path({marker})
for line in sys.stdin:
    if not marker.exists():
        marker.touch()
        sys.stdout.write('x' * ({limit} + 1) + '\n')
    else:
        sys.stdout.write('{{"ok":true,"data":{{"pong":true,"payload":"' + 'x' * (128 * 1024 * 1024) + '"}}}}\n')
    sys.stdout.flush()
"#,
                marker = serde_json::to_string(&marker).unwrap(),
                limit = crate::bounded_process::MAX_STDOUT_BYTES,
            ),
        ).unwrap();
        let runtime = TrackerRuntime::source_python(PathBuf::from("/usr/bin/python3"), script);
        let db = dir.path().join("unused.sqlite3");
        let request = json!({"command": "ping", "payload": {}});
        let rejected = serve_request(&runtime, &db, &request, SidecarCommandRetrySafety::Mutation);
        let discarded = serve_slot().lock().unwrap().is_none();
        let recovered = serve_request(&runtime, &db, &request, SidecarCommandRetrySafety::SafeRead);
        shutdown_serve_process();
        assert!(rejected.is_err(), "oversized response was accepted");
        assert!(matches!(rejected,
            Err(TrackerError::CommandFailed(ref message)) if message.contains("limit")));

        assert!(discarded, "oversized-response sidecar must be discarded");
        let recovered: Value = serde_json::from_str(&recovered.expect("next request recovers")).unwrap();
        assert_eq!(recovered["data"]["pong"], true);
        assert_eq!(recovered["data"]["payload"].as_str().unwrap().len(), 128 * 1024 * 1024);
    }

    #[cfg(unix)]
    #[test]
    fn serve_round_trip_times_out_on_hung_sidecar_and_respawns() {
        let _serve_guard = SERVE_TEST_LOCK.lock().expect("serialize serve tests");
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


    #[cfg(unix)]
    #[test]
    fn serve_waiting_calls_share_the_invocation_timeout_budget() {
        let _serve_guard = SERVE_TEST_LOCK.lock().expect("serialize serve tests");
        shutdown_serve_process();
        let dir = temp_dir_path("serve-lock-budget");
        std::fs::create_dir_all(&dir).expect("create temp dir");
        let script = dir.join("fake-hung-serve");
        std::fs::write(
            &script,
            "#!/bin/sh\nif [ \"$1\" = \"warmup\" ]; then exit 0; fi\nexec sleep 600\n",
        )
        .expect("write fake sidecar");
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert!(Command::new(&script)
            .arg("warmup")
            .status()
            .unwrap()
            .success());
        const TIMEOUT_MS: u64 = 300;
        std::env::set_var(
            "DRIFTY_TRACKER_ROUNDTRIP_TIMEOUT_MS",
            TIMEOUT_MS.to_string(),
        );
        let runtime = std::sync::Arc::new(TrackerRuntime::packaged_sidecar(script));
        let db = std::sync::Arc::new(dir.join("db.sqlite3"));
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(4));
        let handles: Vec<_> = (0..3)
            .map(|_| {
                let runtime = runtime.clone();
                let db = db.clone();
                let barrier = barrier.clone();
                thread::spawn(move || {
                    barrier.wait();
                    let started = Instant::now();
                    let result = serve_request(
                        &runtime,
                        &db,
                        &json!({"command":"ping","payload":{}}),
                        SidecarCommandRetrySafety::Mutation,
                    );
                    (started.elapsed(), result)
                })
            })
            .collect();
        barrier.wait();
        let outcomes: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
        std::env::remove_var("DRIFTY_TRACKER_ROUNDTRIP_TIMEOUT_MS");
        shutdown_serve_process();
        std::fs::remove_dir_all(dir).unwrap();
        for (_, result) in &outcomes {
            assert!(
                matches!(result, Err(TrackerError::ServeTimedOut(d)) if *d == Duration::from_millis(TIMEOUT_MS))
            );
        }
        let elapsed: Vec<_> = outcomes.iter().map(|(d, _)| d.as_millis()).collect();
        eprintln!("concurrent serve durations_ms={elapsed:?}");
        assert!(
            outcomes
                .iter()
                .all(|(d, _)| *d < Duration::from_millis(650)),
            "lock waiting must share the invocation budget: {elapsed:?}"
        );
    }

    #[cfg(unix)]
    #[test]
    fn serve_waiter_timeout_does_not_submit_or_cancel_another_call() {
        let _serve_guard = SERVE_TEST_LOCK.lock().expect("serialize serve tests");
        shutdown_serve_process();
        let guard = serve_slot().lock().unwrap();
        std::env::set_var("DRIFTY_TRACKER_ROUNDTRIP_TIMEOUT_MS", "100");
        let handle = thread::spawn(|| {
            let runtime =
                TrackerRuntime::packaged_sidecar(PathBuf::from("/never-spawn-qa-sidecar"));
            let started = Instant::now();
            let result = serve_request(
                &runtime,
                Path::new("/unused-qa-db"),
                &json!({"command":"stop_tracking"}),
                SidecarCommandRetrySafety::Mutation,
            );
            (started.elapsed(), result)
        });
        thread::sleep(Duration::from_millis(250));
        drop(guard);
        let (elapsed, result) = handle.join().unwrap();
        std::env::remove_var("DRIFTY_TRACKER_ROUNDTRIP_TIMEOUT_MS");
        assert!(
            matches!(result, Err(TrackerError::ServeTimedOut(d)) if d == Duration::from_millis(100)),
            "waiter must expire before process submission: {result:?}"
        );
        assert!(
            elapsed < Duration::from_millis(200),
            "waiter took {elapsed:?}"
        );
        assert!(serve_slot().lock().unwrap().is_none());
    }

    #[cfg(unix)]
    #[test]
    fn app_exit_cancels_inflight_and_waiting_start_before_stop() {
        let _serve_guard = SERVE_TEST_LOCK.lock().expect("serialize serve tests");
        struct ResetExit;
        impl Drop for ResetExit {
            fn drop(&mut self) {
                shutdown_serve_process();
                SERVE_EXITING.store(false, Ordering::SeqCst);
            }
        }
        let _reset = ResetExit;
        shutdown_serve_process();
        let dir = temp_dir_path("exit-start-order");
        std::fs::create_dir_all(&dir).unwrap();
        let script = dir.join("fake_tracker.py");
        std::fs::write(
            &script,
            r#"
import json,sys,time
from pathlib import Path
root=Path(sys.argv[sys.argv.index('--db')+1]).parent
if '--request-json' in sys.argv:
    request=json.loads(sys.argv[sys.argv.index('--request-json')+1])
    assert request['command']=='stop_tracking'
    (root/'stop-applied').write_text('stop')
    print(json.dumps({'ok':True,'data':{'running':False}}),flush=True)
else:
    for line in sys.stdin:
        request=json.loads(line)
        assert request['command']=='start_tracking'
        (root/'start-admitted').write_text('start')
        until=time.monotonic()+10
        while not (root/'stop-applied').exists() and time.monotonic()<until:time.sleep(.005)
        (root/'late-start').write_text('start after Stop')
        print(json.dumps({'ok':True,'data':{'running':True}}),flush=True)
"#,
        )
        .unwrap();
        let runtime = TrackerRuntime::source_python(PathBuf::from("/usr/bin/python3"), script);
        let db = dir.join("tracker.sqlite3");
        let request_start = |runtime: TrackerRuntime, db: PathBuf| {
            serve_request(
                &runtime,
                &db,
                &json!({"command":"start_tracking","payload":{}}),
                SidecarCommandRetrySafety::Mutation,
            )
        };
        let first_runtime = runtime.clone();
        let first_db = db.clone();
        let first = thread::spawn(move || request_start(first_runtime, first_db));
        let until = Instant::now() + Duration::from_secs(5);
        while !dir.join("start-admitted").exists() && Instant::now() < until {
            thread::sleep(Duration::from_millis(5));
        }
        assert!(dir.join("start-admitted").exists());
        let queued_runtime = runtime.clone();
        let queued_db = db.clone();
        let (waiting, entered) = mpsc::channel();
        let queued = thread::spawn(move || {
            waiting.send(()).unwrap();
            request_start(queued_runtime, queued_db)
        });
        entered.recv().unwrap();
        thread::sleep(Duration::from_millis(30));
        shutdown_serve_for_app_exit();
        let stop_result = stop_tracking_daemon_for_app_exit_with(move || Ok((runtime, db)));
        assert!(first.join().unwrap().is_err());
        assert!(matches!(
            queued.join().unwrap(),
            Err(TrackerError::ShuttingDown)
        ));
        assert!(
            stop_result.is_ok(),
            "exit Stop should still run after admission closes"
        );
        assert!(dir.join("stop-applied").exists());
        assert!(
            !dir.join("late-start").exists(),
            "Start must not follow the final Stop"
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn app_exit_rejection_does_not_fall_back_to_another_process() {
        for safety in [
            SidecarCommandRetrySafety::SafeRead,
            SidecarCommandRetrySafety::Mutation,
        ] {
            let result = invoke_with_serve_fallback(
                safety,
                || Err(TrackerError::ShuttingDown),
                || panic!("Exit must not spawn a fallback"),
            );
            assert!(matches!(result, Err(TrackerError::ShuttingDown)));
        }
    }

    #[cfg(unix)]
    #[test]
    fn app_exit_stop_reaches_the_sidecar_while_interactive_serve_is_busy() {
        let _serve_guard = SERVE_TEST_LOCK.lock().expect("serialize serve tests");
        shutdown_serve_process();
        let dir = temp_dir_path("exit-stop-busy-serve");
        std::fs::create_dir_all(&dir).unwrap();
        let script = dir.join("fake_tracker.py");
        let marker = dir.join("stop-received");
        std::fs::write(
            &script,
            r#"
import json,sys
from pathlib import Path
def respond(request):
    assert request['command']=='stop_tracking'
    db=Path(sys.argv[sys.argv.index('--db')+1])
    with (db.parent/'stop-received').open('a') as f:f.write('x')
    print(json.dumps({'ok':True,'data':{'running':False}}),flush=True)
if '--request-json' in sys.argv:
    respond(json.loads(sys.argv[sys.argv.index('--request-json')+1]))
else:
    for line in sys.stdin:respond(json.loads(line))
"#,
        )
        .unwrap();
        let runtime = TrackerRuntime::source_python(PathBuf::from("/usr/bin/python3"), script);
        let db = dir.join("tracker.sqlite3");
        let busy = serve_slot().lock().unwrap();
        let result = stop_tracking_daemon_for_app_exit_with(move || Ok((runtime, db)));
        let received_before_queue_release = marker.exists();
        drop(busy);
        shutdown_serve_process();
        let submissions = std::fs::read_to_string(marker).unwrap();
        std::fs::remove_dir_all(dir).unwrap();
        assert!(result.is_ok(), "Quit failed to issue Stop: {result:?}");
        assert!(
            received_before_queue_release,
            "Stop waited behind unrelated interactive work"
        );
        assert_eq!(submissions, "x", "exit Stop must be submitted once");
    }

    #[cfg(unix)]
    #[test]
    #[ignore]
    fn app_exit_stop_parent_fixture() {
        let dir = PathBuf::from(std::env::var_os("DRIFTY_EXIT_STOP_FIXTURE_DIR").unwrap());
        let runtime = TrackerRuntime::source_python(
            PathBuf::from("/usr/bin/python3"),
            dir.join("fake_tracker.py"),
        );
        let _ = stop_tracking_daemon_for_app_exit_with(move || {
            thread::sleep(Duration::from_millis(300));
            Ok((runtime, dir.join("tracker.sqlite3")))
        });
        // Model the real app's process::exit, which does not run thread drops.
        std::process::exit(0);
    }

    #[cfg(unix)]
    #[test]
    fn app_exit_stop_reaps_its_child_before_parent_exit() {
        let dir = temp_dir_path("exit-stop-parent");
        std::fs::create_dir_all(&dir).unwrap();
        let marker = dir.join("child-pid");
        std::fs::write(
            dir.join("fake_tracker.py"),
            format!(
                "import os,time\nfrom pathlib import Path\nPath({:?}).write_text(str(os.getpid()))\ntime.sleep(60)\n",
                marker.to_string_lossy()
            ),
        ).unwrap();
        let mut parent = Command::new(std::env::current_exe().unwrap());
        parent
            .args([
                "--exact",
                "tracker::tests::app_exit_stop_parent_fixture",
                "--ignored",
                "--nocapture",
            ])
            .env("DRIFTY_EXIT_STOP_FIXTURE_DIR", &dir);
        let result = crate::bounded_process::output(&mut parent, Duration::from_secs(8)).unwrap();
        assert!(result.status.success());
        let pid: i32 = std::fs::read_to_string(marker).unwrap().parse().unwrap();
        // This PID belongs to the child just spawned by our isolated fixture.
        let survived = unsafe { libc::kill(pid, 0) } == 0;
        if survived {
            unsafe { libc::kill(pid, libc::SIGKILL) };
        }
        std::fs::remove_dir_all(dir).unwrap();
        assert!(!survived, "the exit Stop child outlived the exiting app");
    }

    #[cfg(unix)]
    #[test]
    fn app_exit_stop_bounds_a_hung_child_and_does_not_replay_failure() {
        let _serve_guard = SERVE_TEST_LOCK.lock().expect("serialize serve tests");
        let dir = temp_dir_path("exit-stop-failure");
        std::fs::create_dir_all(&dir).unwrap();
        for hang in [false, true] {
            let marker = dir.join(if hang { "hung" } else { "failed" });
            let script = dir.join("fake_tracker.py");
            std::fs::write(&script, format!(
                "from pathlib import Path\nimport time\nwith Path({:?}).open('a') as f:f.write('x')\n{}\nraise SystemExit(7)\n",
                marker.to_string_lossy(), if hang { "time.sleep(60)" } else { "pass" }
            )).unwrap();
            let runtime = TrackerRuntime::source_python(PathBuf::from("/usr/bin/python3"), script);
            let started = Instant::now();
            let db = dir.join("tracker.sqlite3");
            let result = stop_tracking_daemon_for_app_exit_with(move || Ok((runtime, db)));
            assert!(result.is_err());
            if hang {
                assert!(
                    matches!(result, Err(TrackerError::ServeTimedOut(d)) if d <= EXIT_STOP_TRACKING_WAIT)
                );
            }
            assert!(started.elapsed() < EXIT_STOP_TRACKING_WAIT + Duration::from_secs(2));
            assert_eq!(
                std::fs::read_to_string(marker).unwrap(),
                "x",
                "failed exit Stop is never replayed"
            );
        }
        std::fs::remove_dir_all(dir).unwrap();
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
