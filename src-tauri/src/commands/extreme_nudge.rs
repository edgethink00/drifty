use std::{process::Command, thread, time::Duration};

#[cfg(target_os = "macos")]
use objc2::rc::autoreleasepool;
#[cfg(target_os = "macos")]
use objc2_app_kit::NSRunningApplication;
#[cfg(target_os = "macos")]
use objc2_foundation::NSString;
use serde::{Deserialize, Serialize};
use tauri::async_runtime;
use thiserror::Error;

const DRIFTY_BUNDLE_ID: &str = "so.drifty.mac";
const GRACEFUL_TERMINATE_WAIT: Duration = Duration::from_millis(800);
const FORCE_TERMINATE_WAIT: Duration = Duration::from_millis(250);

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtremeNudgeTarget {
    pub app_name: String,
    pub bundle_id: Option<String>,
    pub browser_name: Option<String>,
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
    #[error("Chrome-like browser tab closing requires a captured page URL")]
    MissingBrowserUrl,
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
        let site_url = normalized_optional_text(target.site_url.as_deref())
            .ok_or(ExtremeNudgeError::MissingBrowserUrl)?;
        close_chrome_like_browser_tab(browser_name, &site_url)?;
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

fn close_chrome_like_browser_tab(
    browser_name: &str,
    site_url: &str,
) -> Result<(), ExtremeNudgeError> {
    let script = chrome_like_tab_close_script(browser_name, site_url);
    let output = Command::new("osascript")
        .args(["-e", &script])
        .output()
        .map_err(|error| ExtremeNudgeError::AppleScriptFailed(error.to_string()))?;

    if !output.status.success() {
        return Err(ExtremeNudgeError::AppleScriptFailed(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    if stdout.trim() == "closed_browser_tab" {
        return Ok(());
    }

    Err(ExtremeNudgeError::BrowserTabNotFound(site_url.to_string()))
}

fn chrome_like_tab_close_script(browser_name: &str, site_url: &str) -> String {
    let browser_name = applescript_string_literal(browser_name);
    let site_url = applescript_string_literal(site_url);
    format!(
        r#"tell application "{browser_name}"
  if not (exists front window) then return "not_found"
  try
    if URL of active tab of front window is "{site_url}" then
      close active tab of front window
      return "closed_browser_tab"
    end if
  end try
  repeat with browserWindow in windows
    set matchingTabs to (every tab of browserWindow whose URL is "{site_url}")
    if (count of matchingTabs) > 0 then
      close item 1 of matchingTabs
      return "closed_browser_tab"
    end if
  end repeat
  return "not_found"
end tell"#
    )
}

fn applescript_string_literal(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
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
    fn tab_close_script_matches_active_tab_before_scanning_windows() {
        let script =
            chrome_like_tab_close_script("Google Chrome", "https://youtube.com/watch?v=abc");

        assert!(script.contains("URL of active tab of front window"));
        assert!(script.contains("close active tab of front window"));
        assert!(script.contains(
            "every tab of browserWindow whose URL is \"https://youtube.com/watch?v=abc\""
        ));
    }

    #[test]
    fn applescript_string_literal_escapes_quotes_and_backslashes() {
        assert_eq!(
            applescript_string_literal(r#"https://example.test/watch?q="a\b""#),
            r#"https://example.test/watch?q=\"a\\b\""#
        );
    }

    #[test]
    fn protected_bundle_ids_are_rejected() {
        assert!(matches!(
            normalized_bundle_id(Some(DRIFTY_BUNDLE_ID), "Drifty"),
            Err(ExtremeNudgeError::ProtectedBundle(_)),
        ));
    }
}
