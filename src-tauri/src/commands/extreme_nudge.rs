#[cfg(target_os = "macos")]
use std::{
    thread,
    time::{Duration, Instant},
};

#[cfg(target_os = "macos")]
use objc2::rc::autoreleasepool;
#[cfg(target_os = "macos")]
use objc2_app_kit::{NSRunningApplication, NSWorkspace};
#[cfg(target_os = "macos")]
use objc2_foundation::{NSObjectProtocol, NSString};
use serde::{Deserialize, Serialize};
use tauri::async_runtime;
use thiserror::Error;

mod browser_tabs;
#[cfg(test)]
mod qa_tests;
#[cfg(target_os = "windows")]
mod windows;

const DRIFTY_BUNDLE_ID: &str = "so.drifty.mac";
#[cfg(target_os = "macos")]
const GRACEFUL_TERMINATE_WAIT: Duration = Duration::from_millis(800);
#[cfg(target_os = "macos")]
const FORCE_TERMINATE_WAIT: Duration = Duration::from_millis(800);
#[cfg(target_os = "macos")]
const TERMINATE_POLL_INTERVAL: Duration = Duration::from_millis(25);

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtremeNudgeTarget {
    pub app_name: String,
    pub bundle_id: Option<String>,
    pub browser_name: Option<String>,
    pub site_domain: Option<String>,
    pub site_url: Option<String>,
    #[serde(default)]
    pub force_chromium_ax_tab_close: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtremeNudgeOutcome {
    pub kind: ExtremeNudgeOutcomeKind,
    pub diagnostic: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ExtremeNudgeOutcomeKind {
    ClosedBrowserTab,
    TerminatedApp,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ExtremeNudgeFailureCode {
    BrowserTargetMissing,
    ProtectedTarget,
    AppTargetMissing,
    AppNotRunning,
    AppCloseFailed,
    PermissionDenied,
    AutomationTimedOut,
    BrowserTabNotFound,
    AutomationFailed,
    InternalError,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtremeNudgeFailure {
    pub code: ExtremeNudgeFailureCode,
    pub diagnostic: Option<String>,
}

impl ExtremeNudgeFailure {
    fn new(code: ExtremeNudgeFailureCode, diagnostic: Option<&str>) -> Self {
        Self {
            code,
            diagnostic: diagnostic.and_then(safe_failure_diagnostic),
        }
    }
}

#[derive(Debug, Error)]
enum ExtremeNudgeError {
    #[error("Browser tab closing requires a captured page URL or domain")]
    MissingBrowserTarget,
    #[cfg(target_os = "windows")]
    #[error("Browser tab closing requires the captured browser executable identity")]
    MissingBrowserIdentity,
    #[error("Refusing to terminate a protected app")]
    ProtectedBundle(String),
    #[error("App identity is required")]
    MissingBundleId(String),
    #[error("No running app found for the captured identity")]
    AppNotRunning(String),
    #[error("The captured app is no longer frontmost")]
    AppNotFrontmost(String),
    #[error("Unable to terminate the captured app")]
    AppTerminateFailed(String),
    #[error("Browser automation failed")]
    AppleScriptFailed(String),
    #[error("Browser tab was not found")]
    BrowserTabNotFound { diagnostic: String },
}

impl From<ExtremeNudgeError> for ExtremeNudgeFailure {
    fn from(error: ExtremeNudgeError) -> Self {
        match error {
            ExtremeNudgeError::MissingBrowserTarget => {
                Self::new(ExtremeNudgeFailureCode::BrowserTargetMissing, None)
            }
            #[cfg(target_os = "windows")]
            ExtremeNudgeError::MissingBrowserIdentity => {
                Self::new(ExtremeNudgeFailureCode::BrowserTargetMissing, None)
            }
            ExtremeNudgeError::ProtectedBundle(_) => {
                Self::new(ExtremeNudgeFailureCode::ProtectedTarget, None)
            }
            ExtremeNudgeError::MissingBundleId(_) => {
                Self::new(ExtremeNudgeFailureCode::AppTargetMissing, None)
            }
            ExtremeNudgeError::AppNotRunning(_) => {
                Self::new(ExtremeNudgeFailureCode::AppNotRunning, None)
            }
            ExtremeNudgeError::AppNotFrontmost(_) => Self::new(
                ExtremeNudgeFailureCode::AppCloseFailed,
                Some("app_not_frontmost"),
            ),
            ExtremeNudgeError::AppTerminateFailed(_) => {
                Self::new(ExtremeNudgeFailureCode::AppCloseFailed, None)
            }
            ExtremeNudgeError::AppleScriptFailed(message) => {
                let normalized = message.to_ascii_lowercase();
                if normalized.contains("timed out") {
                    Self::new(
                        ExtremeNudgeFailureCode::AutomationTimedOut,
                        Some("osascript_timeout"),
                    )
                } else if normalized.contains("-1743")
                    || normalized.contains("not authorized to send apple events")
                    || normalized.contains("not allowed assistive access")
                {
                    Self::new(
                        ExtremeNudgeFailureCode::PermissionDenied,
                        Some("macos_automation_denied"),
                    )
                } else {
                    Self::new(
                        ExtremeNudgeFailureCode::AutomationFailed,
                        Some("osascript_failed"),
                    )
                }
            }
            ExtremeNudgeError::BrowserTabNotFound { diagnostic } => {
                let code = browser_tab_failure_code(&diagnostic);
                Self::new(code, Some(&diagnostic))
            }
        }
    }
}

fn browser_tab_failure_code(diagnostic: &str) -> ExtremeNudgeFailureCode {
    if diagnostic.ends_with("_timeout") {
        return ExtremeNudgeFailureCode::AutomationTimedOut;
    }
    if diagnostic.contains("permission_denied") || diagnostic.contains("access_denied") {
        return ExtremeNudgeFailureCode::PermissionDenied;
    }
    if matches!(
        diagnostic,
        "windows_uia_system_root_unavailable"
            | "windows_uia_system_root_not_absolute"
            | "windows_uia_trusted_powershell_unavailable"
            | "windows_uia_script_create_failed"
            | "windows_uia_spawn_failed"
            | "windows_uia_wait_failed"
            | "windows_uia_invalid_response"
            | "windows_uia_exception"
    ) {
        return ExtremeNudgeFailureCode::AutomationFailed;
    }
    ExtremeNudgeFailureCode::BrowserTabNotFound
}

#[tauri::command]
pub async fn extreme_nudge_apply(
    target: ExtremeNudgeTarget,
) -> Result<ExtremeNudgeOutcome, ExtremeNudgeFailure> {
    async_runtime::spawn_blocking(move || apply_extreme_nudge(&target))
        .await
        .map_err(|_| ExtremeNudgeFailure::new(ExtremeNudgeFailureCode::InternalError, None))?
        .map_err(ExtremeNudgeFailure::from)
}

fn apply_extreme_nudge(
    target: &ExtremeNudgeTarget,
) -> Result<ExtremeNudgeOutcome, ExtremeNudgeError> {
    if let Some(browser_name) = normalized_optional_text(target.browser_name.as_deref()) {
        // A captured browser target is never an app-level target. Falling
        // through here used to quit the entire unsupported browser, including
        // unrelated tabs, when only tab-close support was missing.
        if !browser_tabs::is_supported_browser_tab_target(&browser_name) {
            return Err(ExtremeNudgeError::BrowserTabNotFound {
                diagnostic: "unsupported_browser".to_string(),
            });
        }
        let site_url = normalized_optional_text(target.site_url.as_deref());
        let site_domain = browser_tabs::normalized_site_domain(target.site_domain.as_deref())
            .or_else(|| {
                site_url
                    .as_deref()
                    .and_then(browser_tabs::site_domain_from_url)
            });
        if site_url.is_none() && site_domain.is_none() {
            return Err(ExtremeNudgeError::MissingBrowserTarget);
        }

        let diagnostic = browser_tabs::close_browser_tab(
            &browser_name,
            target.bundle_id.as_deref(),
            site_url.as_deref(),
            site_domain.as_deref(),
            target.force_chromium_ax_tab_close,
        )?;
        return Ok(ExtremeNudgeOutcome {
            kind: ExtremeNudgeOutcomeKind::ClosedBrowserTab,
            diagnostic: Some(diagnostic),
        });
    }

    let bundle_id = normalized_bundle_id(target.bundle_id.as_deref(), &target.app_name)?;
    terminate_app_by_bundle_id(&bundle_id)?;
    Ok(ExtremeNudgeOutcome {
        kind: ExtremeNudgeOutcomeKind::TerminatedApp,
        diagnostic: None,
    })
}

fn normalized_optional_text(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn safe_failure_diagnostic(value: &str) -> Option<String> {
    let normalized = value.trim();
    if normalized.is_empty() || normalized.len() > 96 {
        return None;
    }
    normalized
        .chars()
        .all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '_'
        })
        .then(|| normalized.to_string())
}

fn normalized_bundle_id(value: Option<&str>, app_name: &str) -> Result<String, ExtremeNudgeError> {
    let bundle_id = normalized_optional_text(value)
        .ok_or_else(|| ExtremeNudgeError::MissingBundleId(app_name.trim().to_string()))?;
    if is_protected_bundle_id(&bundle_id) {
        return Err(ExtremeNudgeError::ProtectedBundle(bundle_id));
    }
    Ok(bundle_id)
}

fn is_protected_bundle_id(bundle_id: &str) -> bool {
    #[cfg(target_os = "windows")]
    {
        return windows::is_protected_identity(bundle_id);
    }
    #[cfg(not(target_os = "windows"))]
    matches!(
        bundle_id,
        DRIFTY_BUNDLE_ID
            | "com.apple.finder"
            | "com.apple.systempreferences"
            | "com.apple.SystemSettings"
            | "com.apple.loginwindow"
            | "com.apple.dock"
    )
}

#[cfg(target_os = "macos")]
fn terminate_app_by_bundle_id(bundle_id: &str) -> Result<(), ExtremeNudgeError> {
    terminate_app_by_bundle_id_impl(bundle_id, true)
}

#[cfg(target_os = "macos")]
fn terminate_app_by_bundle_id_impl(
    bundle_id: &str,
    require_frontmost: bool,
) -> Result<(), ExtremeNudgeError> {
    autoreleasepool(|_| {
        let bundle_identifier = NSString::from_str(bundle_id);
        let applications =
            NSRunningApplication::runningApplicationsWithBundleIdentifier(&bundle_identifier);
        if applications.count() == 0 {
            return Err(ExtremeNudgeError::AppNotRunning(bundle_id.to_string()));
        }
        if require_frontmost {
            let frontmost_matches = NSWorkspace::sharedWorkspace()
                .frontmostApplication()
                .and_then(|application| application.bundleIdentifier())
                .is_some_and(|identifier| identifier.to_string() == bundle_id);
            if !frontmost_matches {
                return Err(ExtremeNudgeError::AppNotFrontmost(bundle_id.to_string()));
            }
        }

        for index in 0..applications.count() {
            let application = applications.objectAtIndex(index);
            application.terminate();
        }
        if wait_for_applications_terminated(bundle_id, &applications, GRACEFUL_TERMINATE_WAIT) {
            return Ok(());
        }

        for index in 0..applications.count() {
            let application = applications.objectAtIndex(index);
            application.forceTerminate();
        }
        /* NSRunningApplication returns whether the request was sent, not whether
        the process exited, and a retained instance can keep a stale
        isTerminated value after exit. Only a fresh LaunchServices lookup may
        report success; a sent-but-ignored request must reach the renderer as
        app_close_failed. */
        if wait_for_applications_terminated(bundle_id, &applications, FORCE_TERMINATE_WAIT) {
            return Ok(());
        }

        Err(ExtremeNudgeError::AppTerminateFailed(bundle_id.to_string()))
    })
}

#[cfg(target_os = "macos")]
fn all_applications_terminated(
    bundle_id: &str,
    applications: &objc2_foundation::NSArray<NSRunningApplication>,
) -> bool {
    let bundle_identifier = NSString::from_str(bundle_id);
    let current_applications =
        NSRunningApplication::runningApplicationsWithBundleIdentifier(&bundle_identifier);
    for index in 0..applications.count() {
        let application = applications.objectAtIndex(index);
        for current_index in 0..current_applications.count() {
            let current_application = current_applications.objectAtIndex(current_index);
            if application.isEqual(Some(&current_application)) {
                return false;
            }
        }
    }
    true
}

#[cfg(target_os = "macos")]
fn wait_for_applications_terminated(
    bundle_id: &str,
    applications: &objc2_foundation::NSArray<NSRunningApplication>,
    timeout: Duration,
) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if all_applications_terminated(bundle_id, applications) {
            return true;
        }
        thread::sleep(TERMINATE_POLL_INTERVAL);
    }
    all_applications_terminated(bundle_id, applications)
}

#[cfg(not(target_os = "macos"))]
fn terminate_app_by_bundle_id(bundle_id: &str) -> Result<(), ExtremeNudgeError> {
    #[cfg(target_os = "windows")]
    {
        return windows::terminate_app_by_identity(bundle_id);
    }
    #[cfg(not(target_os = "windows"))]
    Err(ExtremeNudgeError::AppTerminateFailed(format!(
        "extreme nudge app termination is unavailable for {bundle_id}"
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn browser_tab_detection_accepts_supported_browsers() {
        assert!(browser_tabs::is_supported_browser_tab_target(
            "Google Chrome"
        ));
        assert!(browser_tabs::is_supported_browser_tab_target(
            "Microsoft Edge"
        ));
        #[cfg(not(target_os = "windows"))]
        {
            assert!(browser_tabs::is_supported_browser_tab_target("Arc"));
            assert!(browser_tabs::is_supported_browser_tab_target("Aside"));
            assert!(browser_tabs::is_supported_browser_tab_target("Safari"));
            assert!(browser_tabs::is_supported_browser_tab_target("Firefox"));
        }
    }

    #[test]
    fn browser_tab_detection_rejects_unsupported_browsers() {
        assert!(!browser_tabs::is_supported_browser_tab_target("Preview"));
    }

    #[test]
    fn unsupported_browser_targets_never_fall_through_to_whole_app_termination() {
        let target = ExtremeNudgeTarget {
            app_name: "Vivaldi".to_string(),
            bundle_id: Some("com.vivaldi.Vivaldi".to_string()),
            browser_name: Some("Vivaldi".to_string()),
            site_domain: Some("youtube.com".to_string()),
            site_url: Some("https://youtube.com/watch?v=drift".to_string()),
            force_chromium_ax_tab_close: false,
        };

        assert!(matches!(
            apply_extreme_nudge(&target),
            Err(ExtremeNudgeError::BrowserTabNotFound { diagnostic })
                if diagnostic == "unsupported_browser"
        ));
    }

    #[test]
    fn a_stale_app_target_fails_closed_with_a_safe_diagnostic() {
        let failure = ExtremeNudgeFailure::from(ExtremeNudgeError::AppNotFrontmost(
            "com.example.StaleTarget".to_string(),
        ));

        assert_eq!(failure.code, ExtremeNudgeFailureCode::AppCloseFailed);
        assert_eq!(failure.diagnostic.as_deref(), Some("app_not_frontmost"));
    }

    #[test]
    fn protected_bundle_ids_are_rejected() {
        #[cfg(not(target_os = "windows"))]
        assert!(matches!(
            normalized_bundle_id(Some(DRIFTY_BUNDLE_ID), "Drifty"),
            Err(ExtremeNudgeError::ProtectedBundle(_)),
        ));
        #[cfg(target_os = "windows")]
        assert!(matches!(
            normalized_bundle_id(Some(r"C:\Program Files\Drifty\drifty.exe"), "Drifty"),
            Err(ExtremeNudgeError::ProtectedBundle(_)),
        ));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_missing_native_app_is_reported_without_attempting_another_target() {
        assert!(matches!(
            terminate_app_by_bundle_id("so.drifty.native-qa.definitely-not-running"),
            Err(ExtremeNudgeError::AppNotRunning(_)),
        ));
    }

    #[test]
    fn browser_tab_failures_serialize_without_the_captured_target() {
        let failure = ExtremeNudgeFailure::from(ExtremeNudgeError::BrowserTabNotFound {
            diagnostic: "chromium_ax_close_failed".to_string(),
        });

        assert_eq!(failure.code, ExtremeNudgeFailureCode::BrowserTabNotFound);
        assert_eq!(
            failure.diagnostic.as_deref(),
            Some("chromium_ax_close_failed")
        );
        let serialized = serde_json::to_string(&failure).expect("serialize failure");
        assert!(!serialized.contains("https://"));
        assert!(!serialized.contains("target"));
    }

    #[test]
    fn unsafe_native_diagnostics_are_dropped() {
        assert_eq!(
            safe_failure_diagnostic("https://example.com/reset?token=secret"),
            None,
        );
        assert_eq!(
            safe_failure_diagnostic("windows_uia_target_not_found").as_deref(),
            Some("windows_uia_target_not_found"),
        );
    }

    #[test]
    fn failure_codes_keep_the_stable_renderer_wire_values() {
        let codes = [
            ExtremeNudgeFailureCode::BrowserTargetMissing,
            ExtremeNudgeFailureCode::ProtectedTarget,
            ExtremeNudgeFailureCode::AppTargetMissing,
            ExtremeNudgeFailureCode::AppNotRunning,
            ExtremeNudgeFailureCode::AppCloseFailed,
            ExtremeNudgeFailureCode::PermissionDenied,
            ExtremeNudgeFailureCode::AutomationTimedOut,
            ExtremeNudgeFailureCode::BrowserTabNotFound,
            ExtremeNudgeFailureCode::AutomationFailed,
            ExtremeNudgeFailureCode::InternalError,
        ];

        assert_eq!(
            serde_json::to_value(codes).expect("serialize failure codes"),
            serde_json::json!([
                "browser_target_missing",
                "protected_target",
                "app_target_missing",
                "app_not_running",
                "app_close_failed",
                "permission_denied",
                "automation_timed_out",
                "browser_tab_not_found",
                "automation_failed",
                "internal_error",
            ]),
        );
    }

    #[test]
    fn automation_failures_expose_only_stable_permission_and_timeout_codes() {
        let denied = ExtremeNudgeFailure::from(ExtremeNudgeError::AppleScriptFailed(
            "Not authorized to send Apple events to Google Chrome. (-1743)".to_string(),
        ));
        assert_eq!(denied.code, ExtremeNudgeFailureCode::PermissionDenied);
        assert_eq!(
            denied.diagnostic.as_deref(),
            Some("macos_automation_denied")
        );

        let timed_out = ExtremeNudgeFailure::from(ExtremeNudgeError::AppleScriptFailed(
            "osascript timed out after 5 seconds".to_string(),
        ));
        assert_eq!(timed_out.code, ExtremeNudgeFailureCode::AutomationTimedOut);
        assert_eq!(timed_out.diagnostic.as_deref(), Some("osascript_timeout"));
    }

    #[test]
    fn browser_failure_taxonomy_separates_target_lookup_from_automation_failures() {
        assert_eq!(
            browser_tab_failure_code("windows_uia_target_not_found"),
            ExtremeNudgeFailureCode::BrowserTabNotFound,
        );
        assert_eq!(
            browser_tab_failure_code("windows_uia_timeout"),
            ExtremeNudgeFailureCode::AutomationTimedOut,
        );
        assert_eq!(
            browser_tab_failure_code("windows_uia_access_denied"),
            ExtremeNudgeFailureCode::PermissionDenied,
        );
        assert_eq!(
            browser_tab_failure_code("windows_uia_spawn_failed"),
            ExtremeNudgeFailureCode::AutomationFailed,
        );
    }
}
