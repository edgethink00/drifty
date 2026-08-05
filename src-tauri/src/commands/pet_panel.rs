use tauri::{AppHandle, WebviewWindow};

use super::pet_mode::PET_MODE_WINDOW_LABEL;

/// Configure the desktop pet as the same kind of non-activating macOS panel
/// used by the resident Companion pill. A regular transparent Tauri window can
/// activate Drifty on mouse-down, which causes the hidden main dashboard to be
/// revealed even when the webview consumes the pointer event.
#[cfg(target_os = "macos")]
pub fn configure_pet_panel(window: &WebviewWindow) -> tauri::Result<()> {
    use objc2::runtime::{AnyClass, AnyObject, ClassBuilder, Sel};
    use objc2::sel;
    use objc2_app_kit::{NSColor, NSStatusWindowLevel, NSWindow, NSWindowStyleMask};
    use objc2_foundation::NSRect;
    use std::ffi::{c_char, c_void};
    use std::sync::OnceLock;
    use tauri_nspanel::WebviewWindowExt;

    static PET_PANEL_CLASS: OnceLock<&'static AnyClass> = OnceLock::new();

    extern "C" fn unconstrained_frame(
        _this: *mut AnyObject,
        _cmd: Sel,
        frame: NSRect,
        _screen: *mut AnyObject,
    ) -> NSRect {
        frame
    }

    type Method = *mut c_void;
    #[link(name = "objc")]
    extern "C" {
        fn class_getInstanceMethod(cls: *const AnyClass, name: Sel) -> Method;
        fn method_getTypeEncoding(method: Method) -> *const c_char;
        fn class_addMethod(
            cls: *const AnyClass,
            name: Sel,
            implementation: *const c_void,
            types: *const c_char,
        ) -> bool;
    }

    let panel = window.to_panel()?;
    panel.set_floating_panel(true);
    panel.set_becomes_key_only_if_needed(true);
    panel.set_hides_on_deactivate(false);
    panel.set_works_when_modal(true);
    panel.set_accepts_mouse_moved_events(true);
    panel.set_released_when_closed(false);

    let ns_window = window.ns_window()?;
    let panel_object = unsafe { &*ns_window.cast::<AnyObject>() };
    let current_class = panel_object.class();
    let pet_panel_class = *PET_PANEL_CLASS.get_or_init(|| {
        if let Some(existing) = AnyClass::get(c"DriftyPetUnconstrainedPanel") {
            return existing;
        }
        let builder = ClassBuilder::new(c"DriftyPetUnconstrainedPanel", current_class)
            .expect("Pet Mode panel subclass should register once");
        let subclass = builder.register();
        unsafe {
            let selector = sel!(constrainFrameRect:toScreen:);
            let inherited = class_getInstanceMethod(current_class, selector);
            assert!(!inherited.is_null(), "NSWindow constrain method must exist");
            let encoding = method_getTypeEncoding(inherited);
            assert!(!encoding.is_null(), "NSWindow constrain encoding must exist");
            let implementation = unconstrained_frame as *const () as *const c_void;
            assert!(
                class_addMethod(subclass, selector, implementation, encoding),
                "Pet Mode unconstrained frame override should register"
            );
        }
        subclass
    });
    if panel_object.class() != pet_panel_class {
        // Safe: the subclass adds no ivars and overrides one NSWindow method
        // with the exact `NSRect, NSScreen? -> NSRect` ABI. Configuration runs
        // on the AppKit main thread before the panel is shown.
        unsafe {
            AnyObject::set_class(panel_object, pet_panel_class);
        }
    }
    // SAFETY: `to_panel` converted this exact WebviewWindow into an NSPanel;
    // NSPanel is an NSWindow subclass and retains the same object lifetime.
    let ns_window = unsafe { &*(ns_window.cast::<NSWindow>()) };
    ns_window.setStyleMask(ns_window.styleMask() | NSWindowStyleMask::NonactivatingPanel);
    ns_window.setLevel(NSStatusWindowLevel);
    ns_window.setIgnoresMouseEvents(false);
    ns_window.setOpaque(false);
    ns_window.setBackgroundColor(Some(&NSColor::clearColor()));
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn configure_pet_panel(_window: &WebviewWindow) -> tauri::Result<()> {
    Ok(())
}

/// Show without activating the application. `WebviewWindow::show` is correct
/// on other platforms, while AppKit's panel ordering API preserves whatever
/// app the user is currently working in.
pub fn show_pet_panel(app: &AppHandle, window: &WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use tauri_nspanel::ManagerExt as PanelManagerExt;

        if let Ok(panel) = app.get_webview_panel(PET_MODE_WINDOW_LABEL) {
            panel.order_front_regardless();
            return Ok(());
        }
    }

    window.show().map_err(|error| error.to_string())
}
