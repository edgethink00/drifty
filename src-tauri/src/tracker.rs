#[cfg(target_os = "macos")]
use core_foundation::base::Boolean;
use std::path::{Path, PathBuf};
use std::process::Command;

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
        let script_path = resolve_tracker_script(app);
        if !script_path.exists() {
            return Err(TrackerError::MissingScript(
                script_path.display().to_string(),
            ));
        }

        let request = json!({
            "command": command,
            "payload": payload,
        });

        let output = Command::new(resolve_python_bin())
            .arg(script_path)
            .arg("--db")
            .arg(resolve_db_path(app))
            .arg("--request-json")
            .arg(request.to_string())
            .output()
            .map_err(|err| TrackerError::CommandFailed(err.to_string()))?;

        if !output.status.success() {
            return Err(TrackerError::CommandFailed(
                String::from_utf8_lossy(&output.stderr).trim().to_string(),
            ));
        }

        let envelope = serde_json::from_slice::<SidecarEnvelope<T>>(&output.stdout)
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
}
