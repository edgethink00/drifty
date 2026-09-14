//! Ambient context for companion moments.
//!
//! Informational moments (day review, milestones, celebrations) are
//! "right now" objects with no decision attached. Popping one over a
//! fullscreen app — a keynote, a film, a game — is the kind of exposure that
//! turns a companion into a nuisance, so the surfaces ask here before
//! presenting them. Interventions (drift alarm, extreme nudge) deliberately
//! do not consult this: late-night drift is exactly when they matter.

#[cfg(target_os = "macos")]
use objc2_app_kit::NSWorkspace;

#[cfg(target_os = "macos")]
const FULLSCREEN_AX_BUDGET: std::time::Duration = std::time::Duration::from_millis(120);
#[cfg(target_os = "macos")]
const AX_MIN_TIMEOUT_SECONDS: f32 = 0.001;

/// True when a fullscreen app other than Drifty itself is frontmost.
/// Fails open (false) whenever the state cannot be determined, so a missing
/// accessibility grant never silences moments outright.
#[tauri::command]
pub fn companion_informational_moments_suppressed() -> bool {
    frontmost_other_app_is_fullscreen()
}

#[cfg(target_os = "macos")]
fn frontmost_other_app_is_fullscreen() -> bool {
    use core_foundation::base::{CFType, CFTypeRef, TCFType};
    use core_foundation::boolean::CFBoolean;
    use core_foundation::string::CFString;
    use std::ffi::c_void;
    use std::time::Instant;

    type AXUIElementRef = *const c_void;
    type AXError = i32;
    type PidT = i32;

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXUIElementCreateApplication(pid: PidT) -> AXUIElementRef;
        fn AXUIElementCopyAttributeValue(
            element: AXUIElementRef,
            attribute: core_foundation::string::CFStringRef,
            value: *mut CFTypeRef,
        ) -> AXError;
        fn AXUIElementSetMessagingTimeout(element: AXUIElementRef, timeout: f32) -> AXError;
        fn CFRelease(cf: CFTypeRef);
    }

    let Some(frontmost) = NSWorkspace::sharedWorkspace().frontmostApplication() else {
        return false;
    };
    let pid = frontmost.processIdentifier();
    if pid == std::process::id() as PidT {
        return false;
    }

    // SAFETY: Category 8 - FFI boundary. We own the application AXUIElement
    // and every copied attribute value, and release each exactly once before
    // returning. Any AX error (no focused window, permission missing, app
    // gone) reads as "not fullscreen", i.e. fail open.
    unsafe {
        let app = AXUIElementCreateApplication(pid);
        if app.is_null() {
            return false;
        }
        let deadline = Instant::now() + FULLSCREEN_AX_BUDGET;
        let result = (|| {
            if AXUIElementSetMessagingTimeout(app, remaining_ax_timeout_seconds(deadline)) != 0 {
                return false;
            }
            let mut window_ref: CFTypeRef = std::ptr::null();
            let window_key = CFString::new("AXFocusedWindow");
            if AXUIElementCopyAttributeValue(app, window_key.as_concrete_TypeRef(), &mut window_ref)
                != 0
                || window_ref.is_null()
            {
                return false;
            }
            let fullscreen = (|| {
                if Instant::now() >= deadline
                    || AXUIElementSetMessagingTimeout(
                        window_ref as AXUIElementRef,
                        remaining_ax_timeout_seconds(deadline),
                    ) != 0
                {
                    return false;
                }
                let mut value_ref: CFTypeRef = std::ptr::null();
                let fullscreen_key = CFString::new("AXFullScreen");
                if AXUIElementCopyAttributeValue(
                    window_ref as AXUIElementRef,
                    fullscreen_key.as_concrete_TypeRef(),
                    &mut value_ref,
                ) != 0
                    || value_ref.is_null()
                {
                    return false;
                }
                CFType::wrap_under_create_rule(value_ref)
                    .downcast_into::<CFBoolean>()
                    .map(|boolean| boolean == CFBoolean::true_value())
                    .unwrap_or(false)
            })();
            CFRelease(window_ref);
            fullscreen
        })();
        CFRelease(app as CFTypeRef);
        result
    }
}

#[cfg(target_os = "macos")]
fn remaining_ax_timeout_seconds(deadline: std::time::Instant) -> f32 {
    deadline
        .saturating_duration_since(std::time::Instant::now())
        .as_secs_f32()
        .max(AX_MIN_TIMEOUT_SECONDS)
}

#[cfg(not(target_os = "macos"))]
fn frontmost_other_app_is_fullscreen() -> bool {
    false
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    #[test]
    fn fullscreen_ax_timeout_never_restores_the_multisecond_default() {
        let expired = std::time::Instant::now() - std::time::Duration::from_secs(1);
        assert_eq!(
            remaining_ax_timeout_seconds(expired),
            AX_MIN_TIMEOUT_SECONDS
        );
        let remaining = remaining_ax_timeout_seconds(
            std::time::Instant::now() + std::time::Duration::from_millis(30),
        );
        assert!(remaining > 0.0);
        assert!(remaining <= 0.03);
    }
}
