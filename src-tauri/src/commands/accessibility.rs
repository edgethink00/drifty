use serde::Serialize;
use tauri::async_runtime;

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessibilityPermissionStatus {
    pub granted: bool,
}

#[tauri::command]
pub async fn accessibility_get_status() -> Result<AccessibilityPermissionStatus, String> {
    async_runtime::spawn_blocking(accessibility_status)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn accessibility_request_access() -> Result<AccessibilityPermissionStatus, String> {
    async_runtime::spawn_blocking(request_accessibility_access)
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(target_os = "macos")]
fn accessibility_status() -> AccessibilityPermissionStatus {
    AccessibilityPermissionStatus {
        granted: accessibility_trusted(false),
    }
}

#[cfg(not(target_os = "macos"))]
fn accessibility_status() -> AccessibilityPermissionStatus {
    AccessibilityPermissionStatus { granted: false }
}

#[cfg(target_os = "macos")]
fn request_accessibility_access() -> Result<AccessibilityPermissionStatus, String> {
    let granted = accessibility_trusted(true);
    if !granted {
        open_accessibility_settings()?;
    }
    Ok(accessibility_status())
}

#[cfg(not(target_os = "macos"))]
fn request_accessibility_access() -> Result<AccessibilityPermissionStatus, String> {
    Ok(accessibility_status())
}

#[cfg(target_os = "macos")]
fn accessibility_trusted(prompt: bool) -> bool {
    use core_foundation::{
        base::{Boolean, TCFType},
        boolean::CFBoolean,
        dictionary::CFDictionary,
        string::{CFString, CFStringRef},
    };

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        static kAXTrustedCheckOptionPrompt: CFStringRef;
        fn AXIsProcessTrustedWithOptions(
            options: core_foundation::dictionary::CFDictionaryRef,
        ) -> Boolean;
    }

    let prompt_key = unsafe { CFString::wrap_under_get_rule(kAXTrustedCheckOptionPrompt) };
    let prompt_value = if prompt {
        CFBoolean::true_value()
    } else {
        CFBoolean::false_value()
    };
    let options =
        CFDictionary::from_CFType_pairs(&[(prompt_key.as_CFType(), prompt_value.as_CFType())]);
    unsafe { AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef()) != 0 }
}

#[cfg(target_os = "macos")]
fn open_accessibility_settings() -> Result<(), String> {
    let urls = [
        "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility",
        "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
    ];
    let mut last_error = "No Accessibility settings URL configured".to_string();

    for url in urls {
        match std::process::Command::new("open").arg(url).status() {
            Ok(status) if status.success() => return Ok(()),
            Ok(status) => last_error = format!("System Settings returned status {status}"),
            Err(error) => last_error = error.to_string(),
        }
    }

    Err(last_error)
}
