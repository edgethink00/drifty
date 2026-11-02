#[cfg(target_os = "macos")]
use core_foundation::{
    base::{Boolean, TCFType},
    boolean::CFBoolean,
    dictionary::CFDictionary,
    string::{CFString, CFStringRef},
};
use serde::Deserialize;
use std::process::Command;
use tauri::{async_runtime, AppHandle};

use super::permission_guide::{self, GuidePane};

#[cfg(target_os = "macos")]
#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    static kAXTrustedCheckOptionPrompt: CFStringRef;
    fn AXIsProcessTrustedWithOptions(
        options: core_foundation::dictionary::CFDictionaryRef,
    ) -> Boolean;
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SystemSettingsPane {
    Accessibility,
    Notifications,
    FullDiskAccess,
    ScreenRecording,
    /// Where the person frees disk space when the tracker's volume is full.
    Storage,
}

impl SystemSettingsPane {
    fn urls(&self) -> &'static [&'static str] {
        #[cfg(target_os = "windows")]
        {
            return self.windows_urls();
        }
        #[cfg(not(target_os = "windows"))]
        {
            match self {
            Self::Accessibility => &[
                "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility",
                "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
            ],
            Self::FullDiskAccess => &[
                "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_AllFiles",
                "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
            ],
            Self::ScreenRecording => &[
                "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture",
                "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
            ],
            Self::Notifications => &[
                "x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=so.drifty.mac",
                "x-apple.systempreferences:com.apple.Notifications-Settings.extension",
                "x-apple.systempreferences:com.apple.preference.notifications",
            ],
            // General > Storage; the minimum supported macOS is 13.0.
            Self::Storage => &["x-apple.systempreferences:com.apple.settings.Storage"],
        }
        }
    }

    /// ms-settings URIs are the documented Settings app deep links.
    /// Accessibility is the closest analogue of macOS Accessibility; there is
    /// no Full Disk Access on Windows, so that pane opens App permissions.
    fn windows_urls(&self) -> &'static [&'static str] {
        match self {
            Self::Accessibility => &[
                "ms-settings:easeofaccess-display",
                "ms-settings:easeofaccess",
            ],
            Self::FullDiskAccess => &["ms-settings:appsfeatures", "ms-settings:privacy"],
            Self::ScreenRecording => &[],
            Self::Notifications => &["ms-settings:notifications"],
            Self::Storage => &["ms-settings:storagesense"],
        }
    }

    /// The privacy list where Drifty offers the drag-to-grant guide, and how
    /// to tell the grant arrived. Accessibility and Screen Recording have a
    /// checked drop; Full Disk Access opens plainly.
    fn guide(&self) -> Option<(GuidePane, Option<fn() -> bool>)> {
        match self {
            Self::Accessibility => Some((
                GuidePane::Accessibility,
                Some(super::accessibility::accessibility_trusted_now as fn() -> bool),
            )),
            Self::ScreenRecording => Some((
                GuidePane::ScreenRecording,
                Some(screen_recording_allowed_now as fn() -> bool),
            )),
            Self::FullDiskAccess | Self::Notifications | Self::Storage => None,
        }
    }
}

/// macOS usually reports a new Screen Recording grant only after Drifty
/// relaunches, so the guide may instead close when the person returns to
/// Drifty or when System Settings asks to quit and reopen it.
#[cfg(target_os = "macos")]
fn screen_recording_allowed_now() -> bool {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGPreflightScreenCaptureAccess() -> bool;
    }
    unsafe { CGPreflightScreenCaptureAccess() }
}

#[cfg(not(target_os = "macos"))]
fn screen_recording_allowed_now() -> bool {
    false
}

/// `guide` asks for the drag-to-grant panel beside System Settings. Callers
/// pass it when the permission is still off; a plain shortcut to a granted
/// permission omits it. Without the panel the pane opens as before.
#[tauri::command]
pub async fn system_open_settings_pane(
    app: AppHandle,
    pane: SystemSettingsPane,
    guide: Option<bool>,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    if matches!(pane, SystemSettingsPane::FullDiskAccess) {
        return Err("Full Disk Access is a macOS-only permission.".to_string());
    }
    #[cfg(not(target_os="macos"))]
    if matches!(pane,SystemSettingsPane::ScreenRecording){return Err("Screen Recording permission is a macOS-only setting.".into());}
    if let Some((guide_pane, granted)) = pane.guide().filter(|_| guide.unwrap_or(false)) {
        let guided = async_runtime::spawn_blocking(move || {
            permission_guide::open(&app, guide_pane, granted)
        })
        .await
        .unwrap_or(false);
        if guided {
            return Ok(());
        }
    }
    let urls = pane.urls().to_vec();
    async_runtime::spawn_blocking(move || open_system_settings_urls(&urls))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn focus_target_open_app(bundle_id: String) -> Result<(), String> {
    async_runtime::spawn_blocking(move || open_focus_target_app(&bundle_id))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn focus_target_activate_browser_tab(
    browser_name: String,
    site_url: Option<String>,
    site_domain: Option<String>,
) -> Result<bool, String> {
    async_runtime::spawn_blocking(move || {
        activate_focus_target_browser_tab(
            &browser_name,
            site_url.as_deref(),
            site_domain.as_deref(),
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn focus_target_browser_tab_exists(
    browser_name: String,
    site_url: Option<String>,
    site_domain: Option<String>,
) -> Result<bool, String> {
    async_runtime::spawn_blocking(move || {
        focus_target_browser_tab_exists_internal(
            &browser_name,
            site_url.as_deref(),
            site_domain.as_deref(),
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

fn normalize_focus_target_bundle_id(bundle_id: &str) -> Result<String, String> {
    let trimmed = bundle_id.trim();
    if trimmed.is_empty() {
        return Err("Focus target bundle id is required".to_string());
    }

    Ok(trimmed.to_string())
}

fn focus_target_open_args(bundle_id: &str) -> Result<Vec<String>, String> {
    Ok(vec![
        "-b".to_string(),
        normalize_focus_target_bundle_id(bundle_id)?,
    ])
}

#[derive(Debug, Eq, PartialEq)]
struct FocusTargetBrowserTabMatch {
    site_url: String,
    site_domain: String,
}

fn focus_target_browser_tab_match(
    site_url: Option<&str>,
    site_domain: Option<&str>,
) -> Result<FocusTargetBrowserTabMatch, String> {
    let normalized_url = site_url
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_default()
        .to_string();
    let normalized_domain = focus_target_domain(&normalized_url, site_domain).unwrap_or_default();

    if normalized_url.is_empty() && normalized_domain.is_empty() {
        return Err("Focus target site URL or domain is required".to_string());
    }

    Ok(FocusTargetBrowserTabMatch {
        site_url: normalized_url,
        site_domain: normalized_domain,
    })
}

#[cfg(target_os = "macos")]
fn open_focus_target_app(bundle_id: &str) -> Result<(), String> {
    let args = focus_target_open_args(bundle_id)?;
    match Command::new("open").args(args).status() {
        Ok(status) if status.success() => Ok(()),
        Ok(status) => Err(format!("Focus target app returned status {status}")),
        Err(error) => Err(error.to_string()),
    }
}

#[cfg(not(target_os = "macos"))]
fn open_focus_target_app(_bundle_id: &str) -> Result<(), String> {
    // Companion focus-target actions are macOS AppleScript. Returning Ok
    // keeps the UI from treating an unsupported platform as a hard failure.
    Ok(())
}

#[cfg(target_os = "macos")]
fn activate_focus_target_browser_tab(
    browser_name: &str,
    site_url: Option<&str>,
    site_domain: Option<&str>,
) -> Result<bool, String> {
    let target_match = focus_target_browser_tab_match(site_url, site_domain)?;
    let Some(app_name) = focus_target_browser_app_name(browser_name) else {
        return Ok(false);
    };

    let script = focus_target_browser_tab_script(
        app_name,
        &target_match.site_url,
        Some(&target_match.site_domain),
    );
    let output = Command::new("osascript")
        .args(["-e", &script])
        .output()
        .map_err(|error| error.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim() == "activated_browser_tab")
}

#[cfg(not(target_os = "macos"))]
fn activate_focus_target_browser_tab(
    _browser_name: &str,
    _site_url: Option<&str>,
    _site_domain: Option<&str>,
) -> Result<bool, String> {
    Ok(false)
}

#[cfg(target_os = "macos")]
fn focus_target_browser_tab_exists_internal(
    browser_name: &str,
    site_url: Option<&str>,
    site_domain: Option<&str>,
) -> Result<bool, String> {
    let target_match = focus_target_browser_tab_match(site_url, site_domain)?;
    let Some(app_name) = focus_target_browser_app_name(browser_name) else {
        return Ok(false);
    };

    let script = focus_target_browser_tab_exists_script(
        app_name,
        &target_match.site_url,
        Some(&target_match.site_domain),
    );
    let output = Command::new("osascript")
        .args(["-e", &script])
        .output()
        .map_err(|error| error.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim() == "found_browser_tab")
}

#[cfg(not(target_os = "macos"))]
fn focus_target_browser_tab_exists_internal(
    _browser_name: &str,
    _site_url: Option<&str>,
    _site_domain: Option<&str>,
) -> Result<bool, String> {
    Ok(false)
}

fn focus_target_browser_app_name(browser_name: &str) -> Option<&'static str> {
    match browser_name.trim() {
        "Google Chrome" | "Chrome" => Some("Google Chrome"),
        "Microsoft Edge" | "Edge" => Some("Microsoft Edge"),
        "Arc" => Some("Arc"),
        "Brave Browser" | "Brave" => Some("Brave Browser"),
        "Chromium" => Some("Chromium"),
        "Safari" => Some("Safari"),
        _ => None,
    }
}

fn focus_target_browser_tab_script(
    browser_name: &str,
    site_url: &str,
    site_domain: Option<&str>,
) -> String {
    focus_target_browser_tab_script_for_result(
        browser_name,
        site_url,
        site_domain,
        FocusTargetBrowserTabScriptMode::Activate,
    )
}

fn focus_target_browser_tab_exists_script(
    browser_name: &str,
    site_url: &str,
    site_domain: Option<&str>,
) -> String {
    focus_target_browser_tab_script_for_result(
        browser_name,
        site_url,
        site_domain,
        FocusTargetBrowserTabScriptMode::Exists,
    )
}

#[derive(Clone, Copy)]
enum FocusTargetBrowserTabScriptMode {
    Activate,
    Exists,
}

fn focus_target_browser_tab_script_for_result(
    browser_name: &str,
    site_url: &str,
    site_domain: Option<&str>,
    mode: FocusTargetBrowserTabScriptMode,
) -> String {
    let browser_name = applescript_string_literal(browser_name);
    let site_url = applescript_string_literal(site_url);
    let site_domain = applescript_string_literal(site_domain.unwrap_or_default());
    let handlers = focus_target_browser_tab_match_handlers();

    if browser_name == "Safari" {
        return match mode {
            FocusTargetBrowserTabScriptMode::Activate => format!(
                r#"{handlers}
set targetUrl to "{site_url}"
set targetDomain to "{site_domain}"
if not (application "{browser_name}" is running) then return "not_found"
tell application "{browser_name}"
  repeat with browserWindow in windows
    repeat with tabIndex from 1 to count of tabs of browserWindow
      set currentUrl to URL of tab tabIndex of browserWindow
      if my tabMatchesTarget(currentUrl, targetUrl, targetDomain) then
        set current tab of browserWindow to tab tabIndex of browserWindow
        set index of browserWindow to 1
        activate
        return "activated_browser_tab"
      end if
    end repeat
  end repeat
  return "not_found"
end tell"#
            ),
            FocusTargetBrowserTabScriptMode::Exists => format!(
                r#"{handlers}
set targetUrl to "{site_url}"
set targetDomain to "{site_domain}"
if not (application "{browser_name}" is running) then return "not_found"
tell application "{browser_name}"
  repeat with browserWindow in windows
    repeat with tabIndex from 1 to count of tabs of browserWindow
      set currentUrl to URL of tab tabIndex of browserWindow
      if my tabMatchesTarget(currentUrl, targetUrl, targetDomain) then
        return "found_browser_tab"
      end if
    end repeat
  end repeat
  return "not_found"
end tell"#
            ),
        };
    }

    match mode {
        FocusTargetBrowserTabScriptMode::Activate => format!(
            r#"{handlers}
set targetUrl to "{site_url}"
set targetDomain to "{site_domain}"
if not (application "{browser_name}" is running) then return "not_found"
tell application "{browser_name}"
  repeat with browserWindow in windows
    repeat with tabIndex from 1 to count of tabs of browserWindow
      set currentUrl to URL of tab tabIndex of browserWindow
      if my tabMatchesTarget(currentUrl, targetUrl, targetDomain) then
        set active tab index of browserWindow to tabIndex
        set index of browserWindow to 1
        activate
        return "activated_browser_tab"
      end if
    end repeat
  end repeat
  return "not_found"
end tell"#
        ),
        FocusTargetBrowserTabScriptMode::Exists => format!(
            r#"{handlers}
set targetUrl to "{site_url}"
set targetDomain to "{site_domain}"
if not (application "{browser_name}" is running) then return "not_found"
tell application "{browser_name}"
  repeat with browserWindow in windows
    repeat with tabIndex from 1 to count of tabs of browserWindow
      set currentUrl to URL of tab tabIndex of browserWindow
      if my tabMatchesTarget(currentUrl, targetUrl, targetDomain) then
        return "found_browser_tab"
      end if
    end repeat
  end repeat
  return "not_found"
end tell"#
        ),
    }
}

fn focus_target_browser_tab_match_handlers() -> &'static str {
    r#"on normalizedUrlHost(rawUrl)
  set previousTextItemDelimiters to AppleScript's text item delimiters
  set AppleScript's text item delimiters to "://"
  set urlParts to text items of rawUrl
  if (count of urlParts) > 1 then
    set rawHostAndPath to item 2 of urlParts
  else
    set rawHostAndPath to item 1 of urlParts
  end if
  set AppleScript's text item delimiters to "/"
  set rawHost to item 1 of text items of rawHostAndPath
  set AppleScript's text item delimiters to ":"
  set rawHost to item 1 of text items of rawHost
  set AppleScript's text item delimiters to previousTextItemDelimiters
  ignoring case
    if rawHost starts with "www." then return text 5 thru -1 of rawHost
    return rawHost
  end ignoring
end normalizedUrlHost

on tabMatchesTarget(currentUrl, targetUrl, targetDomain)
  if targetUrl is not "" and currentUrl is targetUrl then return true
  if targetDomain is "" then return false
  ignoring case
    if my normalizedUrlHost(currentUrl) is targetDomain then return true
  end ignoring
  return false
end tabMatchesTarget"#
}

fn focus_target_domain(site_url: &str, site_domain: Option<&str>) -> Option<String> {
    site_domain
        .and_then(normalize_focus_target_domain)
        .or_else(|| site_url_host(site_url).and_then(|host| normalize_focus_target_domain(&host)))
}

fn normalize_focus_target_domain(value: &str) -> Option<String> {
    let trimmed = value.trim().trim_end_matches('.');
    if trimmed.is_empty() {
        return None;
    }

    if trimmed.contains("://") {
        return site_url_host(trimmed).and_then(|host| normalize_focus_target_domain(&host));
    }

    let host = trimmed
        .split(['/', '?', '#'])
        .next()
        .unwrap_or_default()
        .trim()
        .trim_end_matches('.');
    let host_without_port = host.split(':').next().unwrap_or_default().trim();
    if host_without_port.is_empty() {
        return None;
    }

    let lower_host = host_without_port.to_ascii_lowercase();
    let normalized = lower_host
        .strip_prefix("www.")
        .unwrap_or(lower_host.as_str())
        .to_string();
    if normalized.contains('.') {
        Some(normalized)
    } else {
        None
    }
}

fn site_url_host(site_url: &str) -> Option<String> {
    let trimmed = site_url.trim();
    if trimmed.is_empty() {
        return None;
    }

    let without_scheme = trimmed
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(trimmed);
    let without_userinfo = without_scheme
        .rsplit_once('@')
        .map(|(_, rest)| rest)
        .unwrap_or(without_scheme);
    without_userinfo
        .split(['/', '?', '#'])
        .next()
        .and_then(normalize_focus_target_domain)
}

fn applescript_string_literal(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

#[cfg(target_os = "macos")]
fn open_system_settings_urls(urls: &[&str]) -> Result<(), String> {
    request_accessibility_prompt_if_needed(urls);

    if urls.iter().any(|url| is_accessibility_settings_url(url)) {
        return Ok(());
    }

    let mut last_error = "No System Settings URL configured".to_string();

    for url in urls {
        match Command::new("open").arg(url).status() {
            Ok(status) if status.success() => return Ok(()),
            Ok(status) => {
                last_error = format!("System Settings returned status {status}");
            }
            Err(error) => {
                last_error = error.to_string();
            }
        }
    }

    Err(last_error)
}

#[cfg(target_os = "macos")]
fn request_accessibility_prompt_if_needed(urls: &[&str]) {
    if !urls.iter().any(|url| is_accessibility_settings_url(url)) {
        return;
    }

    let prompt_key = unsafe { CFString::wrap_under_get_rule(kAXTrustedCheckOptionPrompt) };
    let prompt_value = CFBoolean::true_value();
    let options =
        CFDictionary::from_CFType_pairs(&[(prompt_key.as_CFType(), prompt_value.as_CFType())]);
    unsafe {
        AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef());
    }
}

fn is_accessibility_settings_url(url: &str) -> bool {
    url.contains("Privacy_Accessibility")
}

#[cfg(target_os = "windows")]
fn open_system_settings_urls(urls: &[&str]) -> Result<(), String> {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut last_error = "No Settings URL configured".to_string();
    for url in urls {
        match Command::new("cmd")
            .args(["/C", "start", "", url])
            .creation_flags(CREATE_NO_WINDOW)
            .status()
        {
            Ok(status) if status.success() => return Ok(()),
            Ok(status) => last_error = format!("Settings returned status {status}"),
            Err(error) => last_error = error.to_string(),
        }
    }
    Err(last_error)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn open_system_settings_urls(_urls: &[&str]) -> Result<(), String> {
    Err("System Settings panes are only available on macOS and Windows".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "macos")]
    #[test]
    fn accessibility_urls_are_detected_for_prompt_only_behavior() {
        assert!(SystemSettingsPane::Accessibility
            .urls()
            .iter()
            .any(|url| is_accessibility_settings_url(url)));
        assert!(!SystemSettingsPane::Notifications
            .urls()
            .iter()
            .any(|url| is_accessibility_settings_url(url)));
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn storage_opens_general_storage_without_the_accessibility_prompt() {
        let storage = SystemSettingsPane::Storage.urls();
        assert_eq!(
            storage,
            &["x-apple.systempreferences:com.apple.settings.Storage"]
        );
        assert!(!storage.iter().any(|url| is_accessibility_settings_url(url)));
    }

    #[test]
    fn windows_settings_panes_use_ms_settings_uris() {
        let accessibility = SystemSettingsPane::Accessibility.windows_urls();
        let notifications = SystemSettingsPane::Notifications.windows_urls();
        let disk = SystemSettingsPane::FullDiskAccess.windows_urls();
        assert_eq!(
            SystemSettingsPane::Storage.windows_urls(),
            &["ms-settings:storagesense"]
        );
        assert!(accessibility
            .iter()
            .all(|url| url.starts_with("ms-settings:")));
        assert!(notifications.contains(&"ms-settings:notifications"));
        assert!(disk.iter().all(|url| url.starts_with("ms-settings:")));
        assert!(!accessibility
            .iter()
            .any(|url| is_accessibility_settings_url(url)));
    }

    #[test]
    fn focus_target_app_command_rejects_blank_bundle_ids() {
        assert!(normalize_focus_target_bundle_id("   ").is_err());
    }

    #[test]
    fn focus_target_app_command_builds_open_bundle_args() {
        assert_eq!(
            focus_target_open_args("com.microsoft.VSCode").unwrap(),
            vec!["-b".to_string(), "com.microsoft.VSCode".to_string()]
        );
    }

    #[test]
    fn focus_target_browser_tab_command_accepts_supported_browsers() {
        assert_eq!(
            focus_target_browser_app_name("Google Chrome"),
            Some("Google Chrome")
        );
        assert_eq!(focus_target_browser_app_name("Safari"), Some("Safari"));
        assert_eq!(focus_target_browser_app_name("Firefox"), None);
    }

    #[test]
    fn focus_target_browser_tab_script_activates_matching_chrome_tab() {
        let script = focus_target_browser_tab_script(
            "Google Chrome",
            "https://docs.drifty.so/work",
            Some("docs.drifty.so"),
        );

        assert!(script.contains("repeat with tabIndex from 1 to count of tabs"));
        assert!(script.contains("set active tab index of browserWindow to tabIndex"));
        assert!(script.contains("tabMatchesTarget(currentUrl, targetUrl, targetDomain)"));
        assert!(script.contains("return \"activated_browser_tab\""));
    }

    #[test]
    fn focus_target_browser_tab_exists_script_checks_tabs_without_activation() {
        let script = focus_target_browser_tab_exists_script(
            "Google Chrome",
            "https://docs.drifty.so/work",
            Some("docs.drifty.so"),
        );

        assert!(script.contains("repeat with tabIndex from 1 to count of tabs"));
        assert!(script.contains("return \"found_browser_tab\""));
        assert!(!script.contains("set active tab index"));
        assert!(!script.contains("activate"));
    }

    #[test]
    fn focus_target_browser_tab_scripts_do_not_launch_closed_browsers() {
        for browser_name in ["Google Chrome", "Safari"] {
            for script in [
                focus_target_browser_tab_script(browser_name, "https://docs.drifty.so/work", None),
                focus_target_browser_tab_exists_script(
                    browser_name,
                    "https://docs.drifty.so/work",
                    None,
                ),
            ] {
                let guard = format!(
                    "if not (application \"{browser_name}\" is running) then return \"not_found\""
                );
                assert!(script.contains(&guard));
                assert!(
                    script.find(&guard).unwrap()
                        < script
                            .find(&format!("tell application \"{browser_name}\""))
                            .unwrap()
                );
            }
        }
    }

    #[test]
    fn focus_target_browser_domain_falls_back_from_url() {
        assert_eq!(
            focus_target_domain("https://www.docs.drifty.so/work", None),
            Some("docs.drifty.so".to_string())
        );
        assert_eq!(
            focus_target_domain("https://docs.drifty.so/work", Some("  WWW.DRIFTY.SO  ")),
            Some("drifty.so".to_string())
        );
        assert_eq!(focus_target_domain("not a url", None), None);
    }
}
