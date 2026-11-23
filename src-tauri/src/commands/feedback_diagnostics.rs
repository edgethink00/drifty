//! System facts a feedback report includes when the person leaves
//! "Include debug logs" checked. The WebView cannot read them itself:
//! WebKit reports a frozen macOS version and WebView2 omits the Windows build.

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::native_crash_reports::{recent_crash_summaries, RecentCrashSummary};
use crate::observability::latest_runtime_error;
use crate::tracker::{
    apply_tracker_startup_state, degraded_tracker_status, describe_tracking_pause_for_diagnostics,
    tracker_status_error_message, TrackerController, TrackerError, TrackerStartupState,
    TrackerStatus,
};
use crate::tracking_pause::TrackingPauseState;

/// A support-only read: no control lock, shared serve queue, tray publication or
/// stopped confirmation. Read the latest intent after the observation.
#[tauri::command]
pub async fn feedback_diagnostics_get_tracker_status(
    app: AppHandle,
) -> Result<TrackerStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let result = TrackerController.get_feedback_status(&app);
        let paused = app.state::<TrackingPauseState>().snapshot().is_active();
        let startup = app.state::<TrackerStartupState>();
        match result {
            Ok(status) => Ok(describe_tracking_pause_for_diagnostics(
                apply_tracker_startup_state(&startup, status),
                paused,
            )),
            Err(error) => {
                if matches!(error, TrackerError::ServeTimedOut(_)) {
                    return Err("feedback_tracker_status_timeout".into());
                }
                if let Some(status) =
                    crate::tracker::storage_health::failed_storage_status(&error, paused, || {
                        crate::tracker::storage_health::available_bytes_on_database_volume(
                            &crate::tracker::resolve_db_path(&app),
                        )
                    })
                {
                    return Ok(status);
                }
                match startup.failure_message() {
                    Some(message) => Ok(describe_tracking_pause_for_diagnostics(
                        degraded_tracker_status(message),
                        paused,
                    )),
                    None => Err(tracker_status_error_message()),
                }
            }
        }
    })
    .await
    .map_err(|_| tracker_status_error_message())?
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeFeedbackDiagnostics {
    os_name: &'static str,
    os_version: Option<String>,
    arch: &'static str,
    recent_crashes: Vec<RecentCrashSummary>,
    last_windowing_error: Option<String>,
}

/// Reads crash reports from disk, so it runs off the async runtime's workers.
#[tauri::command]
pub async fn feedback_diagnostics_get_native(
    app: AppHandle,
) -> Result<NativeFeedbackDiagnostics, String> {
    tauri::async_runtime::spawn_blocking(move || NativeFeedbackDiagnostics {
        os_name: std::env::consts::OS,
        os_version: os_version(),
        arch: std::env::consts::ARCH,
        recent_crashes: recent_crash_summaries(&app),
        last_windowing_error: latest_runtime_error(),
    })
    .await
    .map_err(|error| error.to_string())
}

/// "Version 26.1 (Build 25B78)": the marketing version plus the build.
#[cfg(target_os = "macos")]
fn os_version() -> Option<String> {
    use objc2_foundation::NSProcessInfo;

    let version = NSProcessInfo::processInfo()
        .operatingSystemVersionString()
        .to_string();
    let trimmed = version.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

#[cfg(windows)]
fn os_version() -> Option<String> {
    let version = windows_version::OsVersion::current();
    Some(format!(
        "{}.{}.{}",
        version.major, version.minor, version.build
    ))
}

#[cfg(not(any(target_os = "macos", windows)))]
fn os_version() -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_with_the_field_names_the_feedback_client_reads() {
        let value = serde_json::to_value(NativeFeedbackDiagnostics {
            os_name: "macos",
            os_version: Some("Version 26.1 (Build 25B78)".to_string()),
            arch: "aarch64",
            recent_crashes: vec![RecentCrashSummary {
                incident_id: "6C1A0E4B-0000-4000-8000-000000000000".to_string(),
                kind: "EXC_BAD_ACCESS".to_string(),
                app_version: Some("1.12.5".to_string()),
                occurred_at_ms: 1_760_000_000_000,
            }],
            last_windowing_error: None,
        })
        .expect("serialize");

        assert_eq!(value["osName"], "macos");
        assert_eq!(value["osVersion"], "Version 26.1 (Build 25B78)");
        assert_eq!(value["arch"], "aarch64");
        assert_eq!(value["lastWindowingError"], serde_json::Value::Null);
        assert_eq!(
            value["recentCrashes"][0]["incidentId"],
            "6C1A0E4B-0000-4000-8000-000000000000"
        );
        assert_eq!(value["recentCrashes"][0]["kind"], "EXC_BAD_ACCESS");
        assert_eq!(value["recentCrashes"][0]["appVersion"], "1.12.5");
        assert_eq!(
            value["recentCrashes"][0]["occurredAtMs"],
            1_760_000_000_000_u64
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn reads_the_running_macos_version() {
        let version = os_version().expect("macOS reports a version");
        assert!(version.contains("Version"), "{version}");
    }
}
