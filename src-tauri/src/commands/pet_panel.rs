use tauri::{AppHandle, Emitter, WebviewWindow};

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
            assert!(
                !encoding.is_null(),
                "NSWindow constrain encoding must exist"
            );
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

fn pet_drag_position(window_x: i32, window_y: i32, pointer_dx: f64, pointer_dy: f64) -> (i32, i32) {
    (
        window_x.saturating_add(pointer_dx.round() as i32),
        window_y.saturating_add(pointer_dy.round() as i32),
    )
}

const PET_DRAG_THRESHOLD_PHYSICAL_PX: f64 = 7.0;

fn is_pet_drag_delta(pointer_dx: f64, pointer_dy: f64) -> bool {
    pointer_dx.hypot(pointer_dy) >= PET_DRAG_THRESHOLD_PHYSICAL_PX
}

/// Track the real pointer without occupying AppKit's main thread. The earlier
/// nested AppKit event loop moved the non-activating panel correctly, but it
/// starved WebKit's layer commits for the full gesture. As a result the
/// approved pickup pose was not composited until mouse-up, immediately before
/// the release pose replaced it. Sampling global physical coordinates keeps
/// the grab point exact across negative/mixed-scale display origins while the
/// normal main run loop remains free to render the sprite transition.
#[cfg(target_os = "macos")]
pub fn perform_pet_panel_drag(
    app: &AppHandle,
    window: &WebviewWindow,
    _start_client_x: f64,
    _start_client_y: f64,
    pickup_delay_ms: u64,
) -> Result<bool, String> {
    use std::time::{Duration, Instant};
    use tauri::{PhysicalPosition, Position};

    #[link(name = "ApplicationServices", kind = "framework")]
    unsafe extern "C" {
        fn CGEventSourceButtonState(state_id: u32, button: u32) -> bool;
    }

    const COMBINED_SESSION_STATE: u32 = 0;
    const LEFT_MOUSE_BUTTON: u32 = 0;
    let start_pointer = app.cursor_position().map_err(|error| error.to_string())?;
    let start_window = window.outer_position().map_err(|error| error.to_string())?;
    let mut last_window = start_window;
    let mut moved = false;
    let mut pickup_started_at: Option<Instant> = None;
    let pickup_delay = Duration::from_millis(pickup_delay_ms.min(500));

    loop {
        let pointer = app.cursor_position().map_err(|error| error.to_string())?;
        let dx = pointer.x - start_pointer.x;
        let dy = pointer.y - start_pointer.y;
        let (x, y) = pet_drag_position(start_window.x, start_window.y, dx, dy);
        let next_window = PhysicalPosition::new(x, y);
        if !moved && is_pet_drag_delta(dx, dy) {
            moved = true;
            pickup_started_at = Some(Instant::now());
            // A press remains a normal petting tap until physical pointer
            // movement crosses this threshold. Emitting at that exact boundary
            // prevents a click from ever flashing the held sprite, while the
            // native pickup hold below gives WebKit time to paint it before the
            // panel starts following the cursor.
            window
                .emit("pet-mode-drag-start", true)
                .map_err(|error| error.to_string())?;
        }
        let pickup_finished =
            pickup_started_at.is_some_and(|started_at| started_at.elapsed() >= pickup_delay);
        if pickup_finished && next_window != last_window {
            window
                .set_position(Position::Physical(next_window))
                .map_err(|error| error.to_string())?;
            last_window = next_window;
        }
        // SAFETY: CGEventSourceButtonState is a process-independent CoreGraphics
        // query and accepts the documented combined-session/left-button enum
        // values. Unlike AppKit window APIs, it is safe to poll off-main-thread.
        let pressed =
            unsafe { CGEventSourceButtonState(COMBINED_SESSION_STATE, LEFT_MOUSE_BUTTON) };
        if !pressed {
            // A fast real drag may finish before the visual pickup hold. Keep
            // its full pointer delta instead of degrading it into a click.
            if moved && next_window != last_window {
                window
                    .set_position(Position::Physical(next_window))
                    .map_err(|error| error.to_string())?;
            }
            break;
        }
        std::thread::sleep(Duration::from_millis(8));
    }

    Ok(moved)
}

#[cfg(not(target_os = "macos"))]
pub fn perform_pet_panel_drag(
    _app: &AppHandle,
    window: &WebviewWindow,
    _start_client_x: f64,
    _start_client_y: f64,
    _pickup_delay_ms: u64,
) -> Result<bool, String> {
    window.start_dragging().map_err(|error| error.to_string())?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::{is_pet_drag_delta, pet_drag_position};

    #[test]
    fn native_drag_preserves_the_exact_pointer_delta() {
        assert_eq!(pet_drag_position(-1884, -406, 132.2, 56.4), (-1752, -350));
    }

    #[test]
    fn a_tap_or_small_pointer_jitter_does_not_start_a_drag() {
        assert!(!is_pet_drag_delta(0.0, 0.0));
        assert!(!is_pet_drag_delta(4.0, 4.0));
        assert!(!is_pet_drag_delta(6.99, 0.0));
    }

    #[test]
    fn drag_starts_only_when_the_physical_threshold_is_crossed() {
        assert!(is_pet_drag_delta(7.0, 0.0));
        assert!(is_pet_drag_delta(5.0, 5.0));
    }
}
