//! Ownership bridge for the pinned tauri-nspanel 2.0.1 conversion.
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::MainThreadMarker;
use std::ffi::c_void;
use tauri::WebviewWindow;
use tauri_nspanel::WebviewWindowExt;

struct PanelOwnership(Retained<AnyObject>);

impl PanelOwnership {
    /// Acquire the +1 reference the panel wrapper will own.
    ///
    /// SAFETY: the pointer must refer to a live Objective-C object.
    unsafe fn acquire(borrowed: *mut c_void) -> Option<Self> {
        Retained::retain(borrowed.cast()).map(Self)
    }

    fn transfer(self) {
        // The pinned conversion uses Id::from_retained_ptr, which assumes
        // ownership without retaining. That Id now owns this exact +1.
        let _ = Retained::into_raw(self.0);
    }
}

pub(super) fn to_panel(window: &WebviewWindow) -> tauri::Result<tauri_nspanel::Panel> {
    let _mtm = MainThreadMarker::new().ok_or_else(|| {
        tauri::Error::Io(std::io::Error::other(
            "native panels must be configured on the macOS main thread",
        ))
    })?;
    // Tauri returns an autoreleased, borrowed NSWindow pointer. The pinned
    // tauri-nspanel from_window treats it as already retained for its Id.
    // Supply the panel's independent ownership instead of consuming Tauri's.
    let borrowed = window.ns_window()?;
    // SAFETY: Tauri owns the live window, and this runs on AppKit's main thread.
    let ownership = unsafe { PanelOwnership::acquire(borrowed) }
        .ok_or_else(|| tauri::Error::Io(std::io::Error::other("native panel window is null")))?;
    let panel = window.to_panel()?;
    ownership.transfer();
    Ok(panel)
}

#[cfg(test)]
mod tests {
    use super::PanelOwnership;
    use objc2::rc::{autoreleasepool, Retained, Weak};
    use objc2::runtime::NSObject;
    use std::mem::ManuallyDrop;
    use tauri_nspanel::objc::runtime::Object;
    use tauri_nspanel::objc_id::Id;

    #[test]
    fn panel_registry_drop_preserves_the_native_owners_reference() {
        // ManuallyDrop lets a broken ownership bridge fail the weak-reference
        // assertion without sending another release to an already-dead object.
        let mut native_owner = ManuallyDrop::new(NSObject::new());
        let weak = Weak::from_retained(&native_owner);
        let registry = autoreleasepool(|_| {
            let borrowed = Retained::autorelease_ptr(Retained::clone(&native_owner));
            // Exercise the production ownership transfer with the pinned
            // library's actual Id/ShareId retain and drop implementations.
            let ownership = unsafe { PanelOwnership::acquire(borrowed.cast()) }.unwrap();
            let panel = unsafe { Id::<Object>::from_retained_ptr(borrowed.cast()) }.share();
            let registry = panel.clone();
            ownership.transfer();
            drop(panel);
            registry
        });
        assert!(
            weak.load().is_some(),
            "autorelease pool must preserve the window"
        );
        drop(registry);
        assert!(
            weak.load().is_some(),
            "panel must not release the native owner's +1"
        );
        // SAFETY: the assertions above prove the original reference is live.
        unsafe { ManuallyDrop::drop(&mut native_owner) };
        assert!(
            weak.load().is_none(),
            "the bridge must not leak a reference"
        );
    }

    #[test]
    fn abandoned_conversion_releases_its_extra_reference() {
        let native_owner = NSObject::new();
        let weak = Weak::from_retained(&native_owner);
        autoreleasepool(|_| {
            let borrowed = Retained::autorelease_ptr(native_owner.clone());
            let ownership = unsafe { PanelOwnership::acquire(borrowed.cast()) }.unwrap();
            // A conversion that does not return a panel keeps no transferred +1.
            drop(ownership);
        });
        assert!(weak.load().is_some());
        drop(native_owner);
        assert!(weak.load().is_none());
    }
}
