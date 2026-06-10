#[cfg(target_os = "macos")]
use core_foundation::{
    base::{Boolean, TCFType},
    boolean::CFBoolean,
    dictionary::CFDictionary,
    string::{CFString, CFStringRef},
};
use serde::Deserialize;
use std::process::Command;
use tauri::async_runtime;

#[cfg(target_os = "macos")]
#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    static kAXTrustedCheckOptionPrompt: CFStringRef;
    fn AXIsProcessTrustedWithOptions(options: core_foundation::dictionary::CFDictionaryRef) -> Boolean;
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SystemSettingsPane {
    Accessibility,
    Notifications,
}

impl SystemSettingsPane {
    fn urls(&self) -> &'static [&'static str] {
        match self {
            Self::Accessibility => &[
                "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility",
                "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
            ],
            Self::Notifications => &[
                "x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=so.drifty.mac",
                "x-apple.systempreferences:com.apple.Notifications-Settings.extension",
                "x-apple.systempreferences:com.apple.preference.notifications",
            ],
        }
    }
}

#[tauri::command]
pub async fn system_open_settings_pane(pane: SystemSettingsPane) -> Result<(), String> {
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
    site_url: String,
) -> Result<bool, String> {
    async_runtime::spawn_blocking(move || activate_focus_target_browser_tab(&browser_name, &site_url))
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
    Ok(vec!["-b".to_string(), normalize_focus_target_bundle_id(bundle_id)?])
}

fn normalize_focus_target_url(site_url: &str) -> Result<String, String> {
    let trimmed = site_url.trim();
    if trimmed.is_empty() {
        return Err("Focus target site URL is required".to_string());
    }

    Ok(trimmed.to_string())
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
    Err("Focus target app activation is only available on macOS".to_string())
}

#[cfg(target_os = "macos")]
fn activate_focus_target_browser_tab(browser_name: &str, site_url: &str) -> Result<bool, String> {
    let site_url = normalize_focus_target_url(site_url)?;
    let Some(app_name) = focus_target_browser_app_name(browser_name) else {
        return Ok(false);
    };

    let script = focus_target_browser_tab_script(app_name, &site_url);
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
fn activate_focus_target_browser_tab(_browser_name: &str, _site_url: &str) -> Result<bool, String> {
    Err("Focus target browser tab activation is only available on macOS".to_string())
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

fn focus_target_browser_tab_script(browser_name: &str, site_url: &str) -> String {
    let browser_name = applescript_string_literal(browser_name);
    let site_url = applescript_string_literal(site_url);

    if browser_name == "Safari" {
        return format!(
            r#"tell application "{browser_name}"
  repeat with browserWindow in windows
    repeat with tabIndex from 1 to count of tabs of browserWindow
      if URL of tab tabIndex of browserWindow is "{site_url}" then
        set current tab of browserWindow to tab tabIndex of browserWindow
        set index of browserWindow to 1
        activate
        return "activated_browser_tab"
      end if
    end repeat
  end repeat
  return "not_found"
end tell"#
        );
    }

    format!(
        r#"tell application "{browser_name}"
  repeat with browserWindow in windows
    repeat with tabIndex from 1 to count of tabs of browserWindow
      if URL of tab tabIndex of browserWindow is "{site_url}" then
        set active tab index of browserWindow to tabIndex
        set index of browserWindow to 1
        activate
        return "activated_browser_tab"
      end if
    end repeat
  end repeat
  return "not_found"
end tell"#
    )
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
    let options = CFDictionary::from_CFType_pairs(&[(prompt_key.as_CFType(), prompt_value.as_CFType())]);
    unsafe {
        AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef());
    }
}

fn is_accessibility_settings_url(url: &str) -> bool {
    url.contains("Privacy_Accessibility")
}

#[cfg(not(target_os = "macos"))]
fn open_system_settings_urls(_urls: &[&str]) -> Result<(), String> {
    Err("System Settings panes are only available on macOS".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

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
        );

        assert!(script.contains("repeat with tabIndex from 1 to count of tabs"));
        assert!(script.contains("set active tab index of browserWindow to tabIndex"));
        assert!(script.contains("return \"activated_browser_tab\""));
    }
}
