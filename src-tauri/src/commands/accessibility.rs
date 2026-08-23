use serde::Serialize;
use tauri::async_runtime;

#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessibilityPermissionStatus {
    pub granted: bool,
    pub required: bool,
    pub platform: &'static str,
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
        required: true,
        platform: "macos",
    }
}

#[cfg(target_os = "windows")]
fn accessibility_status() -> AccessibilityPermissionStatus {
    // Windows foreground-window and UI Automation capture has no macOS-style
    // per-app Accessibility grant. Treat capture as ready and tell the shared
    // renderer that it must not present a permission the user cannot grant.
    AccessibilityPermissionStatus {
        granted: true,
        required: false,
        platform: "windows",
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn accessibility_status() -> AccessibilityPermissionStatus {
    AccessibilityPermissionStatus {
        granted: false,
        required: false,
        platform: "other",
    }
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

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;

    #[test]
    fn windows_reports_capture_ready_without_a_fake_permission_gate() {
        assert_eq!(
            accessibility_status(),
            AccessibilityPermissionStatus {
                granted: true,
                required: false,
                platform: "windows",
            }
        );
    }
}
