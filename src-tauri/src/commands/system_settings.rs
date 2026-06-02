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
}
