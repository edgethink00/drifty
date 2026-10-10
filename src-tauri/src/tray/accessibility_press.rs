//! Opens the menu bar menu for VoiceOver and keyboard presses (#1781).
//!
//! tray-icon covers the status item's button with its own `TaoTrayTarget`
//! view and attaches the menu only while that view handles `mouseDown:`.
//! Assistive technology presses the button underneath (AXPress, then
//! `performClick:`), which finds neither a menu nor an action, so nothing
//! opens. Give the button an action that replays a left mouse-down on
//! tray-icon's view. The menu then opens through the same code as a pointer
//! click, and no tray-icon `RefCell` stays borrowed while the menu runs its
//! nested event loop. Pointer clicks never reach this action because the
//! overlay view receives them.
//!
//! The action only schedules the replay. Opening the menu inside the press
//! would hold the assistive technology's AXPress request until the menu
//! closes. tray-icon attaches the menu only while it is showing it, so an
//! attached menu at either step means the press came from that show and is
//! ignored; otherwise the scheduled replay would reopen the menu after it
//! closed.

use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{define_class, msg_send, sel, DefinedClass, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{NSButton, NSEvent, NSEventModifierFlags, NSEventType, NSStatusItem, NSView};
use objc2_foundation::{NSObject, NSObjectProtocol, NSPoint};

/// The Objective-C class name tray-icon 0.25 registers for its overlay view.
const TRAY_TARGET_CLASS_NAME: &str = "TaoTrayTarget";

struct TrayAccessibilityPressTargetIvars {
    status_item: Retained<NSStatusItem>,
}

define_class!(
    #[unsafe(super = NSObject)]
    #[thread_kind = MainThreadOnly]
    #[ivars = TrayAccessibilityPressTargetIvars]
    struct TrayAccessibilityPressTarget;

    unsafe impl NSObjectProtocol for TrayAccessibilityPressTarget {}

    impl TrayAccessibilityPressTarget {
        #[unsafe(method(trayAccessibilityPress:))]
        fn press(&self, _sender: Option<&AnyObject>) {
            if self.menu_is_showing() {
                return;
            }
            // SAFETY: the selector names a zero-argument method of this class,
            // and a nil object argument is ignored.
            unsafe {
                let _: () = msg_send![
                    self,
                    performSelector: sel!(trayAccessibilityOpenMenu),
                    withObject: None::<&AnyObject>,
                    afterDelay: 0.0f64
                ];
            }
        }

        #[unsafe(method(trayAccessibilityOpenMenu))]
        fn open_menu(&self) {
            if self.menu_is_showing() {
                return;
            }
            let mtm = self.mtm();
            let Some(button) = self.ivars().status_item.button(mtm) else {
                return;
            };
            replay_tray_mouse_down(&button, mtm);
        }
    }
);

impl TrayAccessibilityPressTarget {
    fn new(mtm: MainThreadMarker, status_item: Retained<NSStatusItem>) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(TrayAccessibilityPressTargetIvars { status_item });
        // SAFETY: NSObject's init returns an initialized instance of this subclass.
        unsafe { msg_send![super(this), init] }
    }

    fn menu_is_showing(&self) -> bool {
        self.ivars().status_item.menu(self.mtm()).is_some()
    }
}

/// Routes accessibility and keyboard presses of Drifty's status item to the
/// same menu path as a left click. Call once after the tray is built.
pub(super) fn install(tray: &tauri::tray::TrayIcon) {
    let _ = tray.with_inner_tray_icon(|inner| {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let Some(status_item) = inner.ns_status_item() else {
            return;
        };
        let Some(button) = status_item.button(mtm) else {
            return;
        };
        if tray_target_view(&button).is_none() {
            eprintln!(
                "[tray] {TRAY_TARGET_CLASS_NAME} view not found; VoiceOver cannot open the menu"
            );
            return;
        }
        let target = TrayAccessibilityPressTarget::new(mtm, status_item);
        // SAFETY: TrayAccessibilityPressTarget implements this selector with
        // the (id)sender action signature.
        unsafe {
            button.setTarget(Some(&target));
            button.setAction(Some(sel!(trayAccessibilityPress:)));
        }
        // NSControl does not retain its target. The status item lives for the
        // whole process, so keep the target alive for the same duration.
        let _ = Retained::into_raw(target);
    });
}

fn tray_target_view(button: &NSButton) -> Option<Retained<NSView>> {
    button
        .subviews()
        .iter()
        .find(|view| view.class().name().to_str() == Ok(TRAY_TARGET_CLASS_NAME))
}

fn replay_tray_mouse_down(button: &NSButton, mtm: MainThreadMarker) {
    let Some(tray_target) = tray_target_view(button) else {
        return;
    };
    let Some(window) = button.window() else {
        return;
    };
    let bounds = tray_target.bounds();
    let center = NSPoint::new(
        bounds.origin.x + bounds.size.width / 2.0,
        bounds.origin.y + bounds.size.height / 2.0,
    );
    let location = tray_target.convertPoint_toView(center, None);
    let Some(event) = NSEvent::mouseEventWithType_location_modifierFlags_timestamp_windowNumber_context_eventNumber_clickCount_pressure(
        NSEventType::LeftMouseDown,
        location,
        NSEventModifierFlags::empty(),
        0.0,
        window.windowNumber(),
        None,
        0,
        1,
        1.0,
    ) else {
        return;
    };
    // tray-icon unwraps the event's window while building its click event.
    if event.window(mtm).is_none() {
        return;
    }
    // SAFETY: TaoTrayTarget is an NSView subclass implementing mouseDown:,
    // and the event is a left mouse-down in its window.
    unsafe {
        let _: () = msg_send![&*tray_target, mouseDown: &*event];
    }
    button.highlight(false);
}
