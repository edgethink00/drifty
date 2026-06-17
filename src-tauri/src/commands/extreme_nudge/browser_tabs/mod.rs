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

pub(super) use matching::{normalized_site_domain, site_domain_from_url};

const APPLESCRIPT_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum BrowserTabScriptKind {
    Chromium,
    Firefox,
    Safari,
}

pub(super) fn is_supported_browser_tab_target(app_name: &str) -> bool {
    browser_tab_script_kind(app_name).is_some()
}

pub(super) fn close_browser_tab(
    browser_name: &str,
    site_url: Option<&str>,
    site_domain: Option<&str>,
) -> Result<(), ExtremeNudgeError> {
    let target_label = site_url.or(site_domain).unwrap_or("unknown target");
    let script = tab_close_script(browser_name, site_url.unwrap_or(""), site_domain)
        .ok_or_else(|| ExtremeNudgeError::BrowserTabNotFound(target_label.to_string()))?;
    let output = run_osascript(&script)?;

    if !output.status.success() {
        return Err(ExtremeNudgeError::AppleScriptFailed(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    if stdout.trim() == "closed_browser_tab" {
        return Ok(());
    }

    Err(ExtremeNudgeError::BrowserTabNotFound(
        target_label.to_string(),
    ))
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
) -> Option<String> {
    match browser_tab_script_kind(browser_name)? {
        BrowserTabScriptKind::Chromium => Some(chromium::tab_close_script(
            browser_name,
            site_url,
            site_domain,
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
    fn tab_close_script_matches_active_tab_before_scanning_windows() {
        let script = tab_close_script(
            "Google Chrome",
            "https://youtube.com/watch?v=abc",
            Some("youtube.com"),
        )
        .unwrap();

        assert!(script.contains("URL of active tab of front window"));
        assert!(script.contains("close active tab of front window"));
        assert!(script.contains("repeat with browserWindow in windows"));
        assert!(script.contains("repeat with browserTab in tabs of browserWindow"));
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
        )
        .unwrap();

        assert!(script.contains("normalizedUrlHost(currentUrl) is targetDomain"));
    }

    #[test]
    fn browser_tab_target_detection_accepts_safari_and_firefox() {
        assert!(is_supported_browser_tab_target("Safari"));
        assert!(is_supported_browser_tab_target("Safari Technology Preview"));
        assert!(is_supported_browser_tab_target("Firefox"));
    }

    #[test]
    fn safari_tab_close_script_uses_safari_tab_model() {
        let script = tab_close_script(
            "Safari",
            "https://www.example.com/watch",
            Some("example.com"),
        )
        .unwrap();

        assert!(script.contains("tell application \"Safari\""));
        assert!(script.contains("URL of current tab of front window"));
        assert!(script.contains("close current tab of front window"));
        assert!(script.contains("repeat with browserTab in tabs of browserWindow"));
        assert!(script.contains("normalizedUrlHost(currentUrl) is targetDomain"));
    }

    #[test]
    fn firefox_tab_close_script_only_closes_matching_front_tab() {
        let script = tab_close_script(
            "Firefox",
            "https://www.example.com/watch",
            Some("example.com"),
        )
        .unwrap();

        assert!(script.contains("tell application \"System Events\""));
        assert!(script.contains("process \"Firefox\""));
        assert!(script.contains("tell application \"Firefox\" to activate"));
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
    fn tab_matcher_accepts_schemaless_browser_urls() {
        let script = tab_close_script("Firefox", "example.com/watch", Some("example.com")).unwrap();

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
