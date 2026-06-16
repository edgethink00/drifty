use std::{thread, time::Duration};

#[cfg(target_os = "macos")]
use objc2::rc::autoreleasepool;
#[cfg(target_os = "macos")]
use objc2_app_kit::NSRunningApplication;
#[cfg(target_os = "macos")]
use objc2_foundation::NSString;
use serde::{Deserialize, Serialize};
use tauri::async_runtime;
use thiserror::Error;

mod browser_tabs;

const DRIFTY_BUNDLE_ID: &str = "so.drifty.mac";
const GRACEFUL_TERMINATE_WAIT: Duration = Duration::from_millis(800);
const FORCE_TERMINATE_WAIT: Duration = Duration::from_millis(250);

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtremeNudgeTarget {
    pub app_name: String,
    pub bundle_id: Option<String>,
    pub browser_name: Option<String>,
    pub site_domain: Option<String>,
    pub site_url: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtremeNudgeOutcome {
    pub kind: ExtremeNudgeOutcomeKind,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ExtremeNudgeOutcomeKind {
    ClosedBrowserTab,
    TerminatedApp,
}

#[derive(Debug, Error)]
enum ExtremeNudgeError {
    #[error("Chrome-like browser tab closing requires a captured page URL or domain")]
    MissingBrowserTarget,
    #[error("Refusing to terminate protected app bundle {0}")]
    ProtectedBundle(String),
    #[error("App bundle id is required for {0}")]
    MissingBundleId(String),
    #[error("No running app found for bundle {0}")]
    AppNotRunning(String),
    #[error("Unable to terminate app bundle {0}")]
    AppTerminateFailed(String),
    #[error("osascript failed: {0}")]
    AppleScriptFailed(String),
    #[error("Browser tab was not found for {0}")]
    BrowserTabNotFound(String),
}

#[tauri::command]
pub async fn extreme_nudge_apply(
    target: ExtremeNudgeTarget,
) -> Result<ExtremeNudgeOutcome, String> {
    async_runtime::spawn_blocking(move || apply_extreme_nudge(&target))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

fn apply_extreme_nudge(
    target: &ExtremeNudgeTarget,
) -> Result<ExtremeNudgeOutcome, ExtremeNudgeError> {
    if let Some(browser_name) = target
        .browser_name
        .as_deref()
        .filter(|name| is_chrome_like_browser(name))
    {
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

        browser_tabs::close_chrome_like_browser_tab(
            browser_name,
            site_url.as_deref(),
            site_domain.as_deref(),
        )?;
        return Ok(ExtremeNudgeOutcome {
            kind: ExtremeNudgeOutcomeKind::ClosedBrowserTab,
        });
    }

    let bundle_id = normalized_bundle_id(target.bundle_id.as_deref(), &target.app_name)?;
    terminate_app_by_bundle_id(&bundle_id)?;
    Ok(ExtremeNudgeOutcome {
        kind: ExtremeNudgeOutcomeKind::TerminatedApp,
    })
}

fn normalized_optional_text(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
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

fn is_chrome_like_browser(app_name: &str) -> bool {
    matches!(
        app_name.trim(),
        "Google Chrome" | "Microsoft Edge" | "Arc" | "Brave Browser" | "Chromium"
    )
}

#[cfg(target_os = "macos")]
fn terminate_app_by_bundle_id(bundle_id: &str) -> Result<(), ExtremeNudgeError> {
    autoreleasepool(|_| {
        let bundle_identifier = NSString::from_str(bundle_id);
        let applications =
            NSRunningApplication::runningApplicationsWithBundleIdentifier(&bundle_identifier);
        if applications.count() == 0 {
            return Err(ExtremeNudgeError::AppNotRunning(bundle_id.to_string()));
        }

        for index in 0..applications.count() {
            let application = applications.objectAtIndex(index);
            application.terminate();
        }
        thread::sleep(GRACEFUL_TERMINATE_WAIT);
        if all_applications_terminated(&applications) {
            return Ok(());
        }

        let mut requested_force_terminate = false;
        for index in 0..applications.count() {
            let application = applications.objectAtIndex(index);
            if !application.isTerminated() {
                requested_force_terminate =
                    application.forceTerminate() || requested_force_terminate;
            }
        }
        thread::sleep(FORCE_TERMINATE_WAIT);
        if requested_force_terminate || all_applications_terminated(&applications) {
            return Ok(());
        }

        Err(ExtremeNudgeError::AppTerminateFailed(bundle_id.to_string()))
    })
}

#[cfg(target_os = "macos")]
fn all_applications_terminated(
    applications: &objc2_foundation::NSArray<NSRunningApplication>,
) -> bool {
    for index in 0..applications.count() {
        let application = applications.objectAtIndex(index);
        if !application.isTerminated() {
            return false;
        }
    }
    true
}

#[cfg(not(target_os = "macos"))]
fn terminate_app_by_bundle_id(_bundle_id: &str) -> Result<(), ExtremeNudgeError> {
    Err(ExtremeNudgeError::AppTerminateFailed(
        "extreme nudge app termination is only available on macOS".to_string(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chrome_like_detection_accepts_supported_browsers() {
        assert!(is_chrome_like_browser("Google Chrome"));
        assert!(is_chrome_like_browser("Microsoft Edge"));
        assert!(is_chrome_like_browser("Arc"));
    }

    #[test]
    fn chrome_like_detection_rejects_unsupported_browsers() {
        assert!(!is_chrome_like_browser("Safari"));
        assert!(!is_chrome_like_browser("Firefox"));
    }

    #[test]
    fn protected_bundle_ids_are_rejected() {
        assert!(matches!(
            normalized_bundle_id(Some(DRIFTY_BUNDLE_ID), "Drifty"),
            Err(ExtremeNudgeError::ProtectedBundle(_)),
        ));
    }
}
