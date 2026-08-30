use std::{
    process::{Command, Output, Stdio},
    thread,
    time::{Duration, Instant},
};

use super::ExtremeNudgeError;

mod chromium;
mod firefox;
mod matching;
#[cfg(test)]
mod qa_tests;
mod safari;
#[cfg(target_os = "windows")]
mod windows;

pub(super) use matching::{normalized_site_domain, site_domain_from_url};

const APPLESCRIPT_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum BrowserTabScriptKind {
    Chromium,
    Firefox,
    Safari,
}

pub(super) fn is_supported_browser_tab_target(app_name: &str) -> bool {
    #[cfg(target_os = "windows")]
    {
        return windows::is_supported_browser(app_name);
    }
    #[cfg(not(target_os = "windows"))]
    browser_tab_script_kind(app_name).is_some()
}

#[cfg(target_os = "windows")]
pub(super) fn close_browser_tab(
    browser_name: &str,
    browser_identity: Option<&str>,
    site_url: Option<&str>,
    site_domain: Option<&str>,
    _force_chromium_ax_tab_close: bool,
) -> Result<String, ExtremeNudgeError> {
    windows::close_browser_tab(browser_name, browser_identity, site_url, site_domain)
}

#[cfg(not(target_os = "windows"))]
pub(super) fn close_browser_tab(
    browser_name: &str,
    _browser_identity: Option<&str>,
    site_url: Option<&str>,
    site_domain: Option<&str>,
    force_chromium_ax_tab_close: bool,
) -> Result<String, ExtremeNudgeError> {
    let script = tab_close_script(
        browser_name,
        site_url.unwrap_or(""),
        site_domain,
        force_chromium_ax_tab_close,
    )
    .ok_or_else(|| ExtremeNudgeError::BrowserTabNotFound {
        diagnostic: "unsupported_browser".to_string(),
    })?;
    let output = run_osascript(&script)?;

    if !output.status.success() {
        return Err(ExtremeNudgeError::AppleScriptFailed(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let result = parse_tab_close_output(stdout.trim());
    if let BrowserTabCloseOutput::Closed { diagnostic } = result {
        return Ok(diagnostic.to_string());
    }

    Err(ExtremeNudgeError::BrowserTabNotFound {
        diagnostic: result.diagnostic().to_string(),
    })
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum BrowserTabCloseOutput<'a> {
    Closed { diagnostic: &'a str },
    NotFound { diagnostic: &'a str },
}

impl BrowserTabCloseOutput<'_> {
    fn diagnostic(&self) -> &str {
        match self {
            Self::Closed { diagnostic } | Self::NotFound { diagnostic } => diagnostic,
        }
    }
}

fn parse_tab_close_output(output: &str) -> BrowserTabCloseOutput<'_> {
    match output.split_once(':') {
        Some(("closed_browser_tab", diagnostic)) if !diagnostic.trim().is_empty() => {
            BrowserTabCloseOutput::Closed {
                diagnostic: diagnostic.trim(),
            }
        }
        Some(("not_found", diagnostic)) if !diagnostic.trim().is_empty() => {
            BrowserTabCloseOutput::NotFound {
                diagnostic: diagnostic.trim(),
            }
        }
        _ if output == "closed_browser_tab" => BrowserTabCloseOutput::Closed {
            diagnostic: "closed_browser_tab",
        },
        _ if output == "not_found" => BrowserTabCloseOutput::NotFound {
            diagnostic: "not_found",
        },
        _ => BrowserTabCloseOutput::NotFound {
            diagnostic: "unexpected_script_output",
        },
    }
}

fn run_osascript(script: &str) -> Result<Output, ExtremeNudgeError> {
    let mut child = Command::new("osascript")
        .args(["-e", script])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| ExtremeNudgeError::AppleScriptFailed(error.to_string()))?;

    let deadline = Instant::now() + APPLESCRIPT_TIMEOUT;
    loop {
        if let Some(_status) = child
            .try_wait()
            .map_err(|error| ExtremeNudgeError::AppleScriptFailed(error.to_string()))?
        {
            return child
                .wait_with_output()
                .map_err(|error| ExtremeNudgeError::AppleScriptFailed(error.to_string()));
        }

        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(ExtremeNudgeError::AppleScriptFailed(format!(
                "osascript timed out after {} seconds",
                APPLESCRIPT_TIMEOUT.as_secs()
            )));
        }

        thread::sleep(Duration::from_millis(50));
    }
}

fn browser_tab_script_kind(app_name: &str) -> Option<BrowserTabScriptKind> {
    match app_name.trim() {
        "Google Chrome"
        | "Google Chrome Canary"
        | "Microsoft Edge"
        | "Arc"
        | "Aside"
        | "Brave Browser"
        | "Chromium" => Some(BrowserTabScriptKind::Chromium),
        "Firefox" => Some(BrowserTabScriptKind::Firefox),
        "Safari" | "Safari Technology Preview" => Some(BrowserTabScriptKind::Safari),
        _ => None,
    }
}

fn tab_close_script(
    browser_name: &str,
    site_url: &str,
    site_domain: Option<&str>,
    force_chromium_ax_tab_close: bool,
) -> Option<String> {
    match browser_tab_script_kind(browser_name)? {
        BrowserTabScriptKind::Chromium => Some(chromium::tab_close_script(
            browser_name,
            site_url,
            site_domain,
            force_chromium_ax_tab_close,
        )),
        BrowserTabScriptKind::Firefox => Some(firefox::tab_close_script(
            browser_name,
            site_url,
            site_domain,
        )),
        BrowserTabScriptKind::Safari => Some(safari::tab_close_script(
            browser_name,
            site_url,
            site_domain,
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::super::ExtremeNudgeTarget;
    use super::*;

    #[test]
    fn chromium_tab_close_script_only_closes_the_current_front_tab() {
        let script = tab_close_script(
            "Google Chrome",
            "https://youtube.com/watch?v=abc",
            Some("youtube.com"),
            false,
        )
        .unwrap();

        assert!(script.contains("URL of active tab of front window"));
        assert!(script.contains("close active tab of front window"));
        assert!(script
            .contains("if frontmost is false then return \"not_found:chromium_not_frontmost\""));
        assert!(!script.contains("repeat with browserWindow in windows"));
        assert!(!script.contains("repeat with browserTab in tabs of browserWindow"));
        assert!(!script.contains("chromium_scanned_tab"));
    }

    #[test]
    fn chrome_like_tab_close_script_matches_same_domain_when_exact_url_differs() {
        let target: ExtremeNudgeTarget = serde_json::from_value(serde_json::json!({
            "appName": "Google Chrome",
            "bundleId": "com.google.Chrome",
            "browserName": "Google Chrome",
            "siteDomain": "chess.com",
            "siteUrl": "https://www.chess.com/play/online"
        }))
        .unwrap();

        assert_eq!(target.site_domain.as_deref(), Some("chess.com"));

        let script = tab_close_script(
            "Google Chrome",
            target.site_url.as_deref().unwrap(),
            target.site_domain.as_deref(),
            false,
        )
        .unwrap();

        assert!(script.contains("normalizedUrlHost(currentUrl) is targetDomain"));
    }

    #[test]
    fn chrome_like_tab_close_script_supports_aside() {
        let script = tab_close_script(
            "Aside",
            "https://docs.example.test/aside",
            Some("docs.example.test"),
            false,
        )
        .unwrap();

        assert!(script.contains("tell application \"Aside\""));
        assert!(script.contains("URL of active tab of front window"));
        assert!(script.contains("tell process \"Aside\""));
    }

    #[test]
    fn chrome_like_tab_close_script_falls_back_to_bounded_accessibility_address_bar_scan() {
        let script = tab_close_script(
            "Google Chrome",
            "https://ads.google.com/aw/policy/account",
            Some("ads.google.com"),
            false,
        )
        .unwrap();

        assert!(!script.contains("tell application \"Google Chrome\" to activate"));
        assert!(!script.contains("set frontmost to true"));
        assert!(!script.contains("keystroke \"l\" using command down"));
        assert!(!script.contains("AXFocusedUIElement"));
        assert!(!script.contains("entire contents of front window"));
        assert!(script.contains("property maxVisited : 500"));
        assert!(script.contains("property toolbarMaxVisited : 120"));
        assert!(script.contains("on scanToolbarFirst(theElement)"));
        assert!(script.contains("my scanToolbarFirst(front window)"));
        assert!(script.contains("UI elements of theElement"));
        assert!(script.contains("roleText is \"AXTextField\" or roleText is \"AXComboBox\""));
        assert!(script.contains(
            "tell application \"Google Chrome\"\n  try\n    if exists front window then"
        ));
        assert!(!script
            .contains("if not (exists front window) then return \"not_found\"\n  set targetUrl"));
        assert!(script.contains(
            "try\n          tell application \"Google Chrome\" to close active tab of front window"
        ));
        assert!(script.contains(
            "if my tabMatchesTarget(bestValue, targetUrl, targetDomain) then return \"not_found:chromium_ax_post_close_target_still_frontmost\""
        ));
        assert!(!script.contains("keystroke \"w\" using command down"));
        assert!(script.contains("end try\nreturn \"not_found:chromium_ax_target_mismatch\""));
        assert!(!script.contains("clipboard"));
        assert!(!script.contains("terminate"));
    }

    #[test]
    fn chrome_like_tab_close_script_can_force_accessibility_fallback() {
        let script = tab_close_script(
            "Google Chrome",
            "https://youtube.com/watch?v=abc",
            Some("youtube.com"),
            true,
        )
        .unwrap();

        assert!(!script.contains("URL of active tab of front window"));
        assert!(!script.contains("repeat with browserWindow in windows"));
        assert!(script.contains("tell process \"Google Chrome\""));
        assert!(script.contains("return \"closed_browser_tab:chromium_ax_front_tab\""));
    }

    #[test]
    fn tab_close_output_preserves_diagnostic_reason() {
        assert_eq!(
            parse_tab_close_output("closed_browser_tab:chromium_ax_front_tab"),
            BrowserTabCloseOutput::Closed {
                diagnostic: "chromium_ax_front_tab"
            }
        );
        assert_eq!(
            parse_tab_close_output("not_found:chromium_ax_close_failed"),
            BrowserTabCloseOutput::NotFound {
                diagnostic: "chromium_ax_close_failed"
            }
        );
    }

    #[test]
    #[cfg(not(target_os = "windows"))]
    fn browser_tab_target_detection_accepts_safari_and_firefox() {
        assert!(is_supported_browser_tab_target("Safari"));
        assert!(is_supported_browser_tab_target("Safari Technology Preview"));
        assert!(is_supported_browser_tab_target("Firefox"));
    }

    #[test]
    #[cfg(not(target_os = "windows"))]
    fn safari_tab_close_script_uses_safari_tab_model() {
        let script = tab_close_script(
            "Safari",
            "https://www.example.com/watch",
            Some("example.com"),
            false,
        )
        .unwrap();

        assert!(script.contains("tell application \"Safari\""));
        assert!(script.contains("URL of current tab of front window"));
        assert!(script.contains("close current tab of front window"));
        assert!(
            script.contains("if frontmost is false then return \"not_found:safari_not_frontmost\"")
        );
        assert!(!script.contains("repeat with browserWindow in windows"));
        assert!(!script.contains("repeat with browserTab in tabs of browserWindow"));
        assert!(script.contains("normalizedUrlHost(currentUrl) is targetDomain"));
    }

    #[test]
    #[cfg(not(target_os = "windows"))]
    fn firefox_tab_close_script_only_closes_matching_front_tab() {
        let script = tab_close_script(
            "Firefox",
            "https://www.example.com/watch",
            Some("example.com"),
            false,
        )
        .unwrap();

        assert!(script.contains("tell application \"System Events\""));
        assert!(script.contains("process \"Firefox\""));
        assert!(!script.contains("tell application \"Firefox\" to activate"));
        assert!(script
            .contains("if frontmost is false then return \"not_found:firefox_not_frontmost\""));
        assert!(script.contains("keystroke \"l\" using command down"));
        assert!(script.contains("AXFocusedUIElement"));
        assert!(script.contains("key code 53"));
        assert!(script.contains("if my tabMatchesTarget(currentUrl, targetUrl, targetDomain) then"));
        assert!(script.contains("keystroke \"w\" using command down"));
        assert!(!script.contains("terminate"));
        assert!(!script.contains("clipboard"));
        assert!(!script.contains("active tab of front window"));
    }

    #[test]
    #[cfg(not(target_os = "windows"))]
    fn tab_matcher_accepts_schemaless_browser_urls() {
        let script =
            tab_close_script("Firefox", "example.com/watch", Some("example.com"), false).unwrap();

        assert!(script.contains("set afterScheme to currentUrl"));
        assert!(script.contains("if afterScheme is not \"\" then"));
    }

    #[test]
    fn applescript_string_literal_escapes_quotes_and_backslashes() {
        assert_eq!(
            matching::applescript_string_literal(r#"https://example.test/watch?q="a\b""#),
            r#"https://example.test/watch?q=\"a\\b\""#
        );
    }

    #[test]
    fn site_domain_from_url_strips_www_and_path() {
        assert_eq!(
            site_domain_from_url("https://www.chess.com/play/online?ref=home").as_deref(),
            Some("chess.com"),
        );
    }
}
