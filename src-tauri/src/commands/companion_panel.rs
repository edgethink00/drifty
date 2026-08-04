use serde::Serialize;
#[cfg(target_os = "macos")]
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, OnceLock};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

use super::watcher::COMPANION_PILL_WINDOW_LABEL;

pub const COMPANION_POINTER_ENTERED_EVENT: &str = "watcher-companion-pointer-entered";
pub const COMPANION_POINTER_MOVED_EVENT: &str = "watcher-companion-pointer-moved";
pub const COMPANION_POINTER_EXITED_EVENT: &str = "watcher-companion-pointer-exited";
pub const COMPANION_PANEL_TRANSITION_EVENT: &str = "watcher-companion-transition";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CompanionPanelTransitionPayload {
    state: String,
    phase: String,
    anchor: CompanionHorizontalAnchor,
}

type CompanionTransitionMessage = (WebviewWindow, CompanionPanelTransitionPayload);
static COMPANION_TRANSITION_SENDER: OnceLock<mpsc::Sender<CompanionTransitionMessage>> =
    OnceLock::new();

/* WebKit can be in the middle of a viewport transaction while AppKit runs the
animation block. Emitting synchronously from that stack can deadlock, while
spawning one thread per event can reorder `completed` ahead of `started`.
One serial worker preserves native phase order without re-entering WebKit. */
fn emit_companion_panel_transition(
    window: &WebviewWindow,
    state: &str,
    phase: &str,
    anchor: CompanionHorizontalAnchor,
) {
    let payload = CompanionPanelTransitionPayload {
        state: state.to_string(),
        phase: phase.to_string(),
        anchor,
    };
    let sender = COMPANION_TRANSITION_SENDER.get_or_init(|| {
        let (sender, receiver) = mpsc::channel::<CompanionTransitionMessage>();
        std::thread::spawn(move || {
            while let Ok((window, payload)) = receiver.recv() {
                let _ = window.emit(COMPANION_PANEL_TRANSITION_EVENT, payload);
            }
        });
        sender
    });
    let _ = sender.send((window.clone(), payload));
}

/// How much of the capsule stays reachable when it is placed against an edge.
/// Mirrors the drag clamp in `watcher.rs` so a resize never relocates a pill
/// the user parked somewhere the clamp allows.
use super::watcher::{
    companion_pill_capsule_size, companion_pill_gutter, companion_pill_left_inset,
    companion_pill_state, COMPANION_PILL_CANVAS_WIDTH as COMPANION_PANEL_CANVAS_WIDTH,
    COMPANION_PILL_COLLAPSED_WIDTH as COMPANION_PANEL_RESTING_WIDTH,
    COMPANION_PILL_GUTTER_X as COMPANION_PANEL_GUTTER_X,
    COMPANION_PILL_GUTTER_Y as COMPANION_PANEL_GUTTER_Y,
    COMPANION_PILL_MIN_REACHABLE_X as COMPANION_PANEL_MIN_REACHABLE_X,
    COMPANION_PILL_MIN_REACHABLE_Y as COMPANION_PANEL_MIN_REACHABLE_Y,
};

fn companion_capsule_width(frame_width: f64, left_inset: f64) -> f64 {
    let fixed_canvas_width = COMPANION_PANEL_CANVAS_WIDTH + COMPANION_PANEL_GUTTER_X * 2.0;
    if (frame_width - fixed_canvas_width).abs() < 2.0 {
        frame_width - left_inset - COMPANION_PANEL_GUTTER_X
    } else {
        frame_width - left_inset * 2.0
    }
}

/// Insets from the panel frame to the visible capsule before and after resize.
/// The horizontal value includes unused room in the fixed-width canvas, while
/// the vertical value is the actual transparent shadow/confetti gutter.
#[derive(Clone, Copy, Debug)]
pub struct CompanionPanelAnchor {
    pub old_gutter_x: f64,
    pub old_gutter_y: f64,
    pub new_gutter_x: f64,
    pub new_gutter_y: f64,
    /// Preserve the relationship chosen when a moment opened. A centered pill
    /// grows around its center; only pills that would clip against an edge pin
    /// that edge while opening and closing.
    pub horizontal: Option<CompanionHorizontalAnchor>,
    /// Preserve the vertical relationship chosen when the moment opened. Most
    /// pills grow around their center; only a pill close enough to a display
    /// boundary pins the threatened edge.
    pub vertical: Option<CompanionVerticalAnchor>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[repr(u8)]
#[serde(rename_all = "lowercase")]
pub enum CompanionHorizontalAnchor {
    Left = 0,
    Center = 1,
    Right = 2,
}

impl CompanionHorizontalAnchor {
    pub fn from_u8(value: u8) -> Self {
        match value {
            0 => Self::Left,
            2 => Self::Right,
            _ => Self::Center,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum CompanionVerticalAnchor {
    Bottom = 0,
    Center = 1,
    Top = 2,
}

impl CompanionVerticalAnchor {
    pub fn from_u8(value: u8) -> Self {
        match value {
            0 => Self::Bottom,
            2 => Self::Top,
            _ => Self::Center,
        }
    }
}

/// A rectangle in AppKit's bottom-left origin space.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CompanionFrame {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[cfg(target_os = "macos")]
impl From<objc2_foundation::NSRect> for CompanionFrame {
    fn from(rect: objc2_foundation::NSRect) -> Self {
        Self {
            x: rect.origin.x,
            y: rect.origin.y,
            width: rect.size.width,
            height: rect.size.height,
        }
    }
}

/// Constrain the visible capsule rather than its much larger transparent
/// NSPanel. The capsule stays below the menu bar while side and bottom edges
/// remain flexible as long as a useful grab target is left on screen.
pub fn calculate_companion_drag_frame(
    proposed: CompanionFrame,
    screen: CompanionFrame,
    safe_capsule_top: f64,
) -> CompanionFrame {
    let capsule_width = (proposed.width - COMPANION_PANEL_GUTTER_X * 2.0).max(0.0);
    calculate_companion_drag_frame_for_capsule(
        proposed,
        screen,
        safe_capsule_top,
        COMPANION_PANEL_GUTTER_X,
        capsule_width,
    )
}

fn calculate_companion_drag_frame_for_capsule(
    proposed: CompanionFrame,
    screen: CompanionFrame,
    safe_capsule_top: f64,
    capsule_left_inset: f64,
    capsule_width: f64,
) -> CompanionFrame {
    let capsule_height = (proposed.height - COMPANION_PANEL_GUTTER_Y * 2.0).max(0.0);
    let reachable_x = COMPANION_PANEL_MIN_REACHABLE_X.min(capsule_width);
    let reachable_y = COMPANION_PANEL_MIN_REACHABLE_Y.min(capsule_height);
    let min_capsule_x = screen.x - (capsule_width - reachable_x);
    let max_capsule_x = (screen.x + screen.width - reachable_x).max(min_capsule_x);
    let capsule_x = (proposed.x + capsule_left_inset).clamp(min_capsule_x, max_capsule_x);
    let min_capsule_top = (screen.y + reachable_y).min(screen.y + screen.height);
    let max_capsule_top = safe_capsule_top
        .max(min_capsule_top)
        .min(screen.y + screen.height);
    let capsule_top = (proposed.y + proposed.height - COMPANION_PANEL_GUTTER_Y)
        .clamp(min_capsule_top, max_capsule_top);

    CompanionFrame {
        x: capsule_x - capsule_left_inset,
        y: capsule_top + COMPANION_PANEL_GUTTER_Y - proposed.height,
        ..proposed
    }
}

/// Reconstruct the frame the pointer asked for when AppKit finishes its native
/// drag loop, then apply the capsule-aware screen clamp.
///
/// Some macOS versions constrain a borderless panel's rectangular frame before
/// consulting its override. For this pill that leaves the visible capsule one
/// transparent-gutter height below the menu bar. Rebuilding the requested frame
/// from the release pointer and the original grab point makes the final position
/// deterministic while preserving the exact point the user held.
#[cfg(test)]
pub fn calculate_companion_drag_release_frame(
    current: CompanionFrame,
    screen: CompanionFrame,
    safe_capsule_top: f64,
    pointer_x: f64,
    pointer_y: f64,
    grab_x: f64,
    grab_y: f64,
) -> CompanionFrame {
    calculate_companion_drag_release_frame_for_capsule(
        current,
        screen,
        safe_capsule_top,
        pointer_x,
        pointer_y,
        grab_x,
        grab_y,
        COMPANION_PANEL_GUTTER_X,
        (current.width - COMPANION_PANEL_GUTTER_X * 2.0).max(0.0),
    )
}

fn calculate_companion_drag_release_frame_for_capsule(
    current: CompanionFrame,
    screen: CompanionFrame,
    safe_capsule_top: f64,
    pointer_x: f64,
    pointer_y: f64,
    grab_x: f64,
    grab_y: f64,
    capsule_left_inset: f64,
    capsule_width: f64,
) -> CompanionFrame {
    calculate_companion_drag_frame_for_capsule(
        CompanionFrame {
            x: pointer_x - grab_x,
            y: pointer_y - grab_y,
            ..current
        },
        screen,
        safe_capsule_top,
        capsule_left_inset,
        capsule_width,
    )
}

/// Place the resized window so the capsule inside it does not move.
///
/// Anchoring the window frame instead would jump the visible pill by the
/// difference between the two gutters: switching a bottom-right pill into a
/// milestone shifted it about 270pt left and 72pt down, because a celebration
/// pads its window far more generously to make room for confetti.
///
/// The capsule normally keeps its center on both axes. If that would clip the
/// target card, the threatened edge is held instead. Clamping is done against
/// the capsule as well, letting the transparent gutter hang off the screen.
pub fn calculate_companion_resize_frame(
    old_frame: CompanionFrame,
    screen_frame: CompanionFrame,
    safe_capsule_top: f64,
    width: f64,
    height: f64,
    anchor: CompanionPanelAnchor,
) -> CompanionFrame {
    let old_capsule_x = old_frame.x + anchor.old_gutter_x;
    let old_capsule_width = companion_capsule_width(old_frame.width, anchor.old_gutter_x);
    let old_capsule_height = old_frame.height - anchor.old_gutter_y * 2.0;
    let new_capsule_width = companion_capsule_width(width, anchor.new_gutter_x);
    let new_capsule_height = height - anchor.new_gutter_y * 2.0;

    let horizontal = anchor.horizontal.unwrap_or_else(|| {
        resolve_companion_horizontal_anchor(
            old_capsule_x,
            old_capsule_width,
            new_capsule_width,
            screen_frame,
        )
    });
    let desired_capsule_x = match horizontal {
        CompanionHorizontalAnchor::Left => old_capsule_x,
        CompanionHorizontalAnchor::Center => {
            old_capsule_x + (old_capsule_width - new_capsule_width) / 2.0
        }
        CompanionHorizontalAnchor::Right => old_capsule_x + old_capsule_width - new_capsule_width,
    };

    // AppKit measures y upwards, so the capsule's top edge sits this far up.
    let old_capsule_top = old_frame.y + old_frame.height - anchor.old_gutter_y;
    let vertical = anchor.vertical.unwrap_or_else(|| {
        resolve_companion_vertical_anchor(
            old_capsule_top,
            old_capsule_height,
            new_capsule_height,
            screen_frame.y,
            safe_capsule_top,
        )
    });
    let desired_capsule_top = match vertical {
        CompanionVerticalAnchor::Top => old_capsule_top,
        CompanionVerticalAnchor::Center => {
            old_capsule_top + (new_capsule_height - old_capsule_height) / 2.0
        }
        CompanionVerticalAnchor::Bottom => {
            old_capsule_top + new_capsule_height - old_capsule_height
        }
    };

    /* Growing into a card must not relocate a pill the user parked somewhere
    deliberate, so the same "stay reachable" rule the drag clamp uses applies
    here: enough of the capsule to grab, and no more than that demanded. */
    let reachable_x = COMPANION_PANEL_MIN_REACHABLE_X.min(new_capsule_width);
    let min_capsule_x = screen_frame.x - (new_capsule_width - reachable_x);
    let max_capsule_x = (screen_frame.x + screen_frame.width - reachable_x).max(min_capsule_x);
    let capsule_x = desired_capsule_x.clamp(min_capsule_x, max_capsule_x);

    /* AppKit measures upward, so the capsule's top is its highest edge. Keep
    that edge below the menu bar even while the transparent gutter hangs
    outside the visible work area. */
    let max_capsule_top = safe_capsule_top
        .max(screen_frame.y)
        .min(screen_frame.y + screen_frame.height);
    let min_capsule_top = (screen_frame.y
        + COMPANION_PANEL_MIN_REACHABLE_Y.min(new_capsule_height))
    .min(max_capsule_top);
    let capsule_top = desired_capsule_top.clamp(min_capsule_top, max_capsule_top);

    CompanionFrame {
        x: capsule_x - anchor.new_gutter_x,
        y: capsule_top + anchor.new_gutter_y - height,
        width,
        height,
    }
}

/// Rebase a queried AppKit frame onto the center captured at the beginning of
/// a centered resize sequence. AppKit may report a pixel-rounded origin after
/// an animation; using that rounded value as the next source frame would move
/// the pill by a fraction of a point on every open and close.
fn companion_frame_with_stable_vertical_center(
    old_frame: CompanionFrame,
    old_gutter_y: f64,
    vertical: Option<CompanionVerticalAnchor>,
    baseline_center_y: &mut Option<f64>,
) -> CompanionFrame {
    if vertical != Some(CompanionVerticalAnchor::Center) {
        *baseline_center_y = None;
        return old_frame;
    }

    let old_capsule_height = old_frame.height - old_gutter_y * 2.0;
    let old_capsule_center_y =
        old_frame.y + old_frame.height - old_gutter_y - old_capsule_height / 2.0;
    let stable_center_y = *baseline_center_y.get_or_insert(old_capsule_center_y);
    CompanionFrame {
        y: old_frame.y + stable_center_y - old_capsule_center_y,
        ..old_frame
    }
}

/// Center-preserving is the default on the vertical axis too. AppKit measures
/// upward, so a target whose centered top exceeds the menu-bar-safe edge pins
/// its top; a target crossing the display bottom pins its bottom.
pub fn resolve_companion_vertical_anchor(
    capsule_top: f64,
    capsule_height: f64,
    target_capsule_height: f64,
    screen_bottom: f64,
    safe_capsule_top: f64,
) -> CompanionVerticalAnchor {
    let center_y = capsule_top - capsule_height / 2.0;
    let centered_top = center_y + target_capsule_height / 2.0;
    let centered_bottom = center_y - target_capsule_height / 2.0;
    if centered_top > safe_capsule_top {
        CompanionVerticalAnchor::Top
    } else if centered_bottom < screen_bottom {
        CompanionVerticalAnchor::Bottom
    } else {
        CompanionVerticalAnchor::Center
    }
}

/// Center-preserving is the default. Pin an edge only when the target capsule
/// would otherwise cross that display edge.
pub fn resolve_companion_horizontal_anchor(
    capsule_x: f64,
    capsule_width: f64,
    target_capsule_width: f64,
    screen: CompanionFrame,
) -> CompanionHorizontalAnchor {
    let center_x = capsule_x + capsule_width / 2.0;
    let centered_left = center_x - target_capsule_width / 2.0;
    let centered_right = center_x + target_capsule_width / 2.0;
    if centered_left < screen.x {
        CompanionHorizontalAnchor::Left
    } else if centered_right > screen.x + screen.width {
        CompanionHorizontalAnchor::Right
    } else {
        CompanionHorizontalAnchor::Center
    }
}

/// A symmetric 280ms ease-in-out keeps the first frame small without creating
/// a velocity spike at the midpoint. The old front-loaded ease-out moved ~38%
/// of the width in its first capture; the first replacement overcorrected with
/// a steep S-curve. AppKit's standard ease-in-out shape keeps both ends quiet
/// and caps the middle step at a much calmer rate.
#[cfg(target_os = "macos")]
const COMPANION_PANEL_RESIZE_DURATION_S: f64 = 0.28;
#[cfg(target_os = "macos")]
/* A fallback for non-canvas width changes. Current companion states share a
fixed horizontal canvas, but keep the fallback display-sized for any future
surface that genuinely changes native width. */
const COMPANION_PANEL_MANUAL_FPS: f64 = 120.0;

/// Solve the same symmetric cubic Bézier used by the CSS capsule width.
/// Binary subdivision is stable for this monotonic curve and only runs for the
/// handful of frames in a 280ms transition.
#[cfg(any(target_os = "macos", test))]
fn companion_resize_progress(linear_progress: f64) -> f64 {
    let x = linear_progress.clamp(0.0, 1.0);
    let cubic = |t: f64, p1: f64, p2: f64| {
        let one_minus_t = 1.0 - t;
        3.0 * one_minus_t * one_minus_t * t * p1 + 3.0 * one_minus_t * t * t * p2 + t * t * t
    };
    let mut low = 0.0;
    let mut high = 1.0;
    for _ in 0..14 {
        let mid = (low + high) / 2.0;
        if cubic(mid, 0.42, 0.58) < x {
            low = mid;
        } else {
            high = mid;
        }
    }
    cubic((low + high) / 2.0, 0.0, 1.0)
}

#[cfg(any(target_os = "macos", test))]
fn interpolate_companion_frame(
    from: CompanionFrame,
    to: CompanionFrame,
    progress: f64,
) -> CompanionFrame {
    let mix = |start: f64, end: f64| start + (end - start) * progress;
    CompanionFrame {
        x: mix(from.x, to.x),
        y: mix(from.y, to.y),
        width: mix(from.width, to.width),
        height: mix(from.height, to.height),
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CompanionPointerPayload {
    screen_x: f64,
    screen_y: f64,
}

#[cfg(target_os = "macos")]
use objc2::rc::Retained;
#[cfg(target_os = "macos")]
use objc2::Message;
#[cfg(target_os = "macos")]
use objc2::{define_class, msg_send, MainThreadOnly};
#[cfg(target_os = "macos")]
use objc2::{ffi, runtime::AnyObject};
#[cfg(target_os = "macos")]
use objc2::{AnyThread, DefinedClass, MainThreadMarker};
#[cfg(target_os = "macos")]
use objc2_app_kit::{
    NSAnimationContext, NSApplication, NSColor, NSEvent, NSEventMask, NSEventTrackingRunLoopMode,
    NSEventType, NSScreen, NSStatusWindowLevel, NSTrackingArea, NSTrackingAreaOptions, NSWindow,
    NSWindowCollectionBehavior, NSWindowStyleMask,
};
#[cfg(target_os = "macos")]
use objc2_foundation::{NSDate, NSObject, NSObjectProtocol};
#[cfg(target_os = "macos")]
use objc2_quartz_core::CAMediaTimingFunction;
#[cfg(target_os = "macos")]
use std::ptr::NonNull;
#[cfg(target_os = "macos")]
#[allow(deprecated)]
use tauri_nspanel::{
    cocoa::foundation::NSRect as CocoaRect,
    objc::{
        declare::ClassDecl,
        runtime::{Class as CocoaClass, Object as CocoaObject, Sel as CocoaSel},
    },
    raw_nspanel::object_setClass,
};
#[cfg(target_os = "macos")]
use tauri_nspanel::{ManagerExt as PanelManagerExt, WebviewWindowExt};

#[cfg(target_os = "macos")]
static COMPANION_POINTER_TRACKER_KEY: u8 = 0;

/// The exact visible-capsule center captured before a centered expansion.
///
/// AppKit accepts sub-point frames, but querying the window again after an
/// animation can return a pixel-rounded origin. Re-deriving the next frame
/// from that rounded value accumulated roughly half a point on every open and
/// close, so a right-pinned pill appeared to finish its horizontal movement
/// and then creep upward. Keeping the original center makes both directions
/// target the same geometry and therefore retrace one another exactly.
#[cfg(target_os = "macos")]
static COMPANION_PANEL_VERTICAL_CENTER_Y: std::sync::Mutex<Option<f64>> =
    std::sync::Mutex::new(None);
#[cfg(target_os = "macos")]
static COMPANION_PANEL_RESIZE_GENERATION: AtomicU64 = AtomicU64::new(0);

pub fn reset_companion_panel_vertical_center() {
    #[cfg(target_os = "macos")]
    if let Ok(mut center) = COMPANION_PANEL_VERTICAL_CENTER_Y.lock() {
        *center = None;
    }
}

/// Preserve the panel's existing Spaces/full-screen auxiliary behavior while
/// explicitly opting it out of macOS window tiling. The allows/disallows flags
/// are mutually exclusive and AppKit raises if both are present.
#[cfg(target_os = "macos")]
fn companion_panel_collection_behavior(
    mut behavior: NSWindowCollectionBehavior,
) -> NSWindowCollectionBehavior {
    behavior.remove(NSWindowCollectionBehavior::FullScreenAllowsTiling);
    behavior.insert(NSWindowCollectionBehavior::FullScreenDisallowsTiling);
    behavior
}

/// AppKit normally constrains the *whole rectangular window* to the visible
/// work area during a drag. That is wrong for this panel: the capsule floats
/// inside a 64pt transparent gutter, so constraining the window leaves the
/// visible pill 64pt below the menu bar and makes the top of the screen feel
/// arbitrarily unreachable.
///
/// Let AppKit's native drag loop follow the pointer, then constrain the visible
/// capsule here rather than constraining its transparent backing window.
#[cfg(target_os = "macos")]
#[allow(deprecated)]
extern "C" fn companion_panel_constrain_frame(
    _this: &CocoaObject,
    _selector: CocoaSel,
    proposed_frame: CocoaRect,
    screen: *mut CocoaObject,
) -> CocoaRect {
    if screen.is_null() {
        return proposed_frame;
    }
    // SAFETY: AppKit supplies a live NSScreen object to this NSWindow override.
    let screen = unsafe { &*(screen.cast::<NSScreen>()) };
    let screen_frame = screen.frame();
    let visible_frame = screen.visibleFrame();
    let constrained = calculate_companion_drag_frame(
        CompanionFrame {
            x: proposed_frame.origin.x,
            y: proposed_frame.origin.y,
            width: proposed_frame.size.width,
            height: proposed_frame.size.height,
        },
        CompanionFrame {
            x: screen_frame.origin.x,
            y: screen_frame.origin.y,
            width: screen_frame.size.width,
            height: screen_frame.size.height,
        },
        visible_frame.origin.y + visible_frame.size.height,
    );
    let mut result = proposed_frame;
    result.origin.x = constrained.x;
    result.origin.y = constrained.y;
    result
}

#[cfg(target_os = "macos")]
#[allow(deprecated)]
fn companion_panel_runtime_class() -> &'static CocoaClass {
    const CLASS_NAME: &str = "DriftyCompanionPanel";
    if let Some(class) = CocoaClass::get(CLASS_NAME) {
        return class;
    }

    let superclass = CocoaClass::get("RawNSPanel")
        .expect("tauri-nspanel must register RawNSPanel before companion setup");
    let mut class = ClassDecl::new(CLASS_NAME, superclass)
        .expect("DriftyCompanionPanel should only be registered once");
    // SAFETY: The selector is an NSWindow override with AppKit's exact ABI.
    // The subclass adds no ivars and returns the proposed frame unchanged.
    unsafe {
        class.add_method(
            CocoaSel::register("constrainFrameRect:toScreen:"),
            companion_panel_constrain_frame
                as extern "C" fn(&CocoaObject, CocoaSel, CocoaRect, *mut CocoaObject) -> CocoaRect,
        );
    }
    class.register()
}

#[cfg(target_os = "macos")]
struct CompanionPointerTrackerIvars {
    app: AppHandle,
}

#[cfg(target_os = "macos")]
define_class!(
    #[unsafe(super = NSObject)]
    #[thread_kind = MainThreadOnly]
    #[ivars = CompanionPointerTrackerIvars]
    struct CompanionPointerTracker;

    unsafe impl NSObjectProtocol for CompanionPointerTracker {}

    impl CompanionPointerTracker {
        #[unsafe(method(mouseEntered:))]
        fn mouse_entered(&self, _event: &NSEvent) {
            emit_pointer_event(&self.ivars().app, COMPANION_POINTER_ENTERED_EVENT);
        }

        #[unsafe(method(mouseMoved:))]
        fn mouse_moved(&self, _event: &NSEvent) {
            emit_pointer_event(&self.ivars().app, COMPANION_POINTER_MOVED_EVENT);
        }

        #[unsafe(method(mouseExited:))]
        fn mouse_exited(&self, _event: &NSEvent) {
            emit_pointer_event(&self.ivars().app, COMPANION_POINTER_EXITED_EVENT);
        }
    }
);

#[cfg(target_os = "macos")]
impl CompanionPointerTracker {
    fn new(mtm: MainThreadMarker, app: AppHandle) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(CompanionPointerTrackerIvars { app });
        // SAFETY: `NSObject`'s `init` initializes this NSObject subclass.
        unsafe { msg_send![super(this), init] }
    }
}

fn emit_pointer_event(app: &AppHandle, event: &str) {
    let Ok(cursor) = app.cursor_position() else {
        return;
    };
    let Some(window) = app.get_webview_window(COMPANION_PILL_WINDOW_LABEL) else {
        return;
    };
    let _ = window.emit(
        event,
        CompanionPointerPayload {
            screen_x: cursor.x,
            screen_y: cursor.y,
        },
    );
}

#[cfg(target_os = "macos")]
pub fn configure_companion_panel(app: &AppHandle, window: &WebviewWindow) -> tauri::Result<()> {
    let panel = window.to_panel()?;
    panel.set_floating_panel(true);
    panel.set_becomes_key_only_if_needed(true);
    panel.set_hides_on_deactivate(false);
    panel.set_works_when_modal(true);
    panel.set_accepts_mouse_moved_events(true);
    panel.set_released_when_closed(false);

    let Some(mtm) = MainThreadMarker::new() else {
        return Err(tauri::Error::Io(std::io::Error::other(
            "companion panel must be configured on the macOS main thread",
        )));
    };
    let ns_window = window.ns_window()?;
    // SAFETY: `to_panel` has already changed this instance to RawNSPanel. Our
    // runtime class is a no-ivar subclass of RawNSPanel, so the object layout is
    // unchanged and all tauri-nspanel behavior remains inherited.
    unsafe {
        object_setClass(
            ns_window.cast::<CocoaObject>(),
            companion_panel_runtime_class() as *const CocoaClass as *mut CocoaObject,
        );
    }
    // SAFETY: Tauri returns the AppKit NSWindow pointer owned by this WebviewWindow.
    // The runtime class remains an NSPanel subclass and is layout-compatible
    // with NSWindow for the inherited content-view API.
    let ns_window = unsafe { &*(ns_window.cast::<NSWindow>()) };
    // Add the non-activating bit to the mask Tauri already configured rather
    // than assigning it, so the window keeps the style bits the builder set.
    ns_window.setStyleMask(ns_window.styleMask() | NSWindowStyleMask::NonactivatingPanel);
    // Our event loop below moves the panel programmatically. Marking it as not
    // user-movable keeps WindowServer from interpreting the same gesture as a
    // Sequoia Fill/tile request when the pointer reaches a screen edge.
    ns_window.setMovable(false);
    ns_window.setCollectionBehavior(companion_panel_collection_behavior(
        ns_window.collectionBehavior(),
    ));
    // A resident utility belongs with status UI, not regular application
    // windows. Besides keeping it above app content, this level prevents
    // accessibility-based window managers from treating the pill as a window
    // to Fill/tile. It is deliberately lower than pop-up menus and screen
    // savers, unlike more aggressive overlay levels.
    ns_window.setLevel(NSStatusWindowLevel);
    // `set_ignore_cursor_events` is dispatched asynchronously onto the main
    // queue, so its ordering against the rest of this setup is not guaranteed.
    // Assert the resident pill's click-through state synchronously here.
    ns_window.setIgnoresMouseEvents(false);
    // `transparent(true)` configures the initial Tauri webview, but converting
    // it into an NSPanel and animating its frame can make AppKit briefly draw
    // the default opaque backing store. Reassert a clear, non-opaque panel so
    // only the rounded web content is ever composited onto the desktop.
    ns_window.setOpaque(false);
    ns_window.setBackgroundColor(Some(&NSColor::clearColor()));
    let content_view = ns_window.contentView().ok_or_else(|| {
        tauri::Error::Io(std::io::Error::other("companion panel has no content view"))
    })?;
    let tracker = CompanionPointerTracker::new(mtm, app.clone());
    let options = NSTrackingAreaOptions::MouseEnteredAndExited
        | NSTrackingAreaOptions::MouseMoved
        | NSTrackingAreaOptions::ActiveAlways
        | NSTrackingAreaOptions::InVisibleRect;
    // SAFETY: The tracking owner is an Objective-C NSObject implementing the
    // mouseEntered:/mouseMoved:/mouseExited: selectors requested by `options`.
    let tracking_area = unsafe {
        NSTrackingArea::initWithRect_options_owner_userInfo(
            NSTrackingArea::alloc(),
            content_view.bounds(),
            options,
            Some(&tracker),
            None,
        )
    };
    content_view.addTrackingArea(&tracking_area);
    // NSTrackingArea.owner is weak. Associate the tracker with the content
    // view so it stays alive exactly as long as the panel's native view does.
    // SAFETY: Both pointers reference live Objective-C objects and the static
    // key has a unique process-stable address.
    unsafe {
        ffi::objc_setAssociatedObject(
            Retained::as_ptr(&content_view)
                .cast_mut()
                .cast::<AnyObject>(),
            std::ptr::addr_of!(COMPANION_POINTER_TRACKER_KEY).cast(),
            Retained::as_ptr(&tracker).cast_mut().cast::<AnyObject>(),
            ffi::OBJC_ASSOCIATION_RETAIN_NONATOMIC,
        );
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn configure_companion_panel(_app: &AppHandle, _window: &WebviewWindow) -> tauri::Result<()> {
    Ok(())
}

pub fn show_companion_panel(app: &AppHandle, window: &WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    if let Ok(panel) = app.get_webview_panel(COMPANION_PILL_WINDOW_LABEL) {
        panel.order_front_regardless();
        return Ok(());
    }

    window.show().map_err(|error| error.to_string())
}

/// Return the display bounds and menu-bar-safe top edge for the pointer's
/// current display. A drag can cross monitors, so following `window.screen()`
/// alone would keep using the display the capsule is leaving.
#[cfg(target_os = "macos")]
fn companion_drag_screen(
    mtm: MainThreadMarker,
    ns_window: &NSWindow,
    pointer: objc2_foundation::NSPoint,
) -> Option<(CompanionFrame, f64)> {
    let screens = NSScreen::screens(mtm);
    let matching = screens.iter().find(|screen| {
        let frame = screen.frame();
        pointer.x >= frame.origin.x
            && pointer.x < frame.origin.x + frame.size.width
            && pointer.y >= frame.origin.y
            && pointer.y < frame.origin.y + frame.size.height
    });
    let screen = matching.or_else(|| ns_window.screen())?;
    let frame = screen.frame();
    let visible_frame = screen.visibleFrame();
    Some((
        CompanionFrame::from(frame),
        visible_frame.origin.y + visible_frame.size.height,
    ))
}

/// Move the panel from a real global pointer sample while preserving the exact
/// point inside the panel that the user originally grabbed.
#[cfg(target_os = "macos")]
fn move_companion_panel_to_pointer(
    mtm: MainThreadMarker,
    ns_window: &NSWindow,
    pointer: objc2_foundation::NSPoint,
    grab_x: f64,
    grab_y: f64,
    capsule_left_inset: f64,
    capsule_width: f64,
) {
    let Some((screen, safe_top)) = companion_drag_screen(mtm, ns_window, pointer) else {
        return;
    };
    let corrected = calculate_companion_drag_release_frame_for_capsule(
        CompanionFrame::from(ns_window.frame()),
        screen,
        safe_top,
        pointer.x,
        pointer.y,
        grab_x,
        grab_y,
        capsule_left_inset,
        capsule_width,
    );
    ns_window.setFrameOrigin(objc2_foundation::NSPoint::new(corrected.x, corrected.y));
}

/// Track the real AppKit drag events ourselves instead of delegating to
/// `performWindowDragWithEvent:`. AppKit's stock loop constrains the panel's
/// large transparent rectangle before the visible capsule can reach the menu
/// bar. Applying the capsule-aware clamp to every pointer sample keeps the grab
/// point attached and makes the full drag path use the same boundary as the
/// initial placement.
#[cfg(target_os = "macos")]
pub fn perform_companion_panel_drag(
    app: &AppHandle,
    window: &WebviewWindow,
    start_client_x: f64,
    start_client_y: f64,
) -> Result<(), String> {
    // The user's drag establishes a new spatial baseline. The next centered
    // expansion must capture that position rather than reuse the old one.
    reset_companion_panel_vertical_center();
    let window = window.clone();
    let state = companion_pill_state();
    let state = if state.is_empty() {
        "collapsed"
    } else {
        &state
    };
    let (gutter_x, _) = companion_pill_gutter(state);
    let capsule_left_inset = companion_pill_left_inset(state, gutter_x)?;
    let (capsule_width, _) = companion_pill_capsule_size(state)?;
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    app.run_on_main_thread(move || {
        let result = (|| -> Result<(), String> {
            let raw_window = window.ns_window().map_err(|error| error.to_string())?;
            // SAFETY: Tauri owns this NSWindow and this closure runs on the
            // AppKit main thread.
            let ns_window = unsafe { &*(raw_window.cast::<NSWindow>()) };
            let mtm = MainThreadMarker::new()
                .ok_or_else(|| "companion drag must run on the main thread".to_string())?;
            let frame = ns_window.frame();
            let grab_x = start_client_x;
            let grab_y = frame.size.height - start_client_y;
            let application = NSApplication::sharedApplication(mtm);
            let mask = NSEventMask::LeftMouseDragged
                | NSEventMask::LeftMouseUp
                | NSEventMask::MouseCancelled;
            // SAFETY: AppKit owns this process-global run-loop mode for the
            // lifetime of the application.
            let tracking_mode = unsafe { NSEventTrackingRunLoopMode };

            loop {
                // Wake periodically even if WebKit delivered the mouse-up
                // before this IPC reached the main thread. An unbounded wait
                // here would freeze AppKit after a quick background click.
                let deadline = NSDate::dateWithTimeIntervalSinceNow(0.05);
                let event = application.nextEventMatchingMask_untilDate_inMode_dequeue(
                    mask,
                    Some(&deadline),
                    tracking_mode,
                    true,
                );
                let Some(event) = event else {
                    if NSEvent::pressedMouseButtons() & 1 == 0 {
                        move_companion_panel_to_pointer(
                            mtm,
                            ns_window,
                            NSEvent::mouseLocation(),
                            grab_x,
                            grab_y,
                            capsule_left_inset,
                            capsule_width,
                        );
                        break;
                    }
                    continue;
                };
                let pointer = NSEvent::mouseLocation();
                move_companion_panel_to_pointer(
                    mtm,
                    ns_window,
                    pointer,
                    grab_x,
                    grab_y,
                    capsule_left_inset,
                    capsule_width,
                );

                if matches!(
                    event.r#type(),
                    NSEventType::LeftMouseUp | NSEventType::MouseCancelled
                ) {
                    break;
                }
            }
            Ok(())
        })();
        let _ = sender.send(result);
    })
    .map_err(|error| error.to_string())?;

    receiver
        .recv()
        .map_err(|error| format!("companion drag ended unexpectedly: {error}"))?
}

#[cfg(not(target_os = "macos"))]
pub fn move_companion_panel_by(
    _app: &AppHandle,
    window: &WebviewWindow,
    delta_x: f64,
    delta_y_from_top: f64,
) -> Result<(), String> {
    let position = window.outer_position().map_err(|error| error.to_string())?;
    window
        .set_position(tauri::PhysicalPosition::new(
            (position.x as f64 + delta_x).round() as i32,
            (position.y as f64 + delta_y_from_top).round() as i32,
        ))
        .map_err(|error| error.to_string())
}

/// Drive a right-edge resize as explicit display-sized frame commits instead
/// of an implicit NSWindow animation. AppKit's animator lets WKWebView publish
/// its viewport about one frame before WindowServer publishes the matching
/// window origin; committing one complete rectangle per frame keeps those two
/// values in the same transaction.
#[cfg(target_os = "macos")]
fn schedule_right_companion_resize(
    app: AppHandle,
    window: WebviewWindow,
    from: CompanionFrame,
    to: CompanionFrame,
    state: String,
    horizontal: CompanionHorizontalAnchor,
    generation: u64,
) {
    std::thread::spawn(move || {
        let steps = (COMPANION_PANEL_RESIZE_DURATION_S * COMPANION_PANEL_MANUAL_FPS).ceil() as u64;
        let start = std::time::Instant::now();
        for step in 1..=steps {
            let linear = step as f64 / steps as f64;
            let deadline = start
                + std::time::Duration::from_secs_f64(COMPANION_PANEL_RESIZE_DURATION_S * linear);
            if let Some(wait) = deadline.checked_duration_since(std::time::Instant::now()) {
                std::thread::sleep(wait);
            }
            if COMPANION_PANEL_RESIZE_GENERATION.load(Ordering::SeqCst) != generation {
                return;
            }

            let frame = interpolate_companion_frame(from, to, companion_resize_progress(linear));
            let target_window = window.clone();
            let _ = app.run_on_main_thread(move || {
                let Ok(raw_window) = target_window.ns_window() else {
                    return;
                };
                // SAFETY: Tauri owns this NSWindow and this closure runs on the
                // AppKit main thread.
                let ns_window = unsafe { &*(raw_window.cast::<NSWindow>()) };
                let frame = objc2_foundation::NSRect::new(
                    objc2_foundation::NSPoint::new(frame.x, frame.y),
                    objc2_foundation::NSSize::new(frame.width, frame.height),
                );
                ns_window.setFrame_display_animate(frame, true, false);
            });
        }

        /* Keep the transition alive for one more presentation tick before
        React removes its transition state. */
        std::thread::sleep(std::time::Duration::from_secs_f64(
            1.0 / COMPANION_PANEL_MANUAL_FPS,
        ));
        if COMPANION_PANEL_RESIZE_GENERATION.load(Ordering::SeqCst) != generation {
            return;
        }
        let completion_window = window.clone();
        let _ = app.run_on_main_thread(move || {
            emit_companion_panel_transition(&completion_window, &state, "completed", horizontal);
        });
    });
}

/// Resize the resident panel as one native AppKit surface. Animating the
/// NSWindow frame keeps WebKit's viewport, rounded clipping, and hit testing on
/// the same geometry for every animation frame; independently animating CSS
/// width/height makes the content visibly clip against a stale native window.
///
/// The timing is stated explicitly rather than left to AppKit.
/// `setFrame:display:animate:` derives its own duration from how much the frame
/// changes and runs a nested modal event loop while it plays, so the day review
/// took visibly longer to open than a milestone and input stalled for the whole
/// gesture. One 280ms ease-in-out keeps every state change feeling like the
/// same surface and leaves the main thread responsive.
#[cfg(target_os = "macos")]
pub fn resize_companion_panel(
    app: &AppHandle,
    window: &WebviewWindow,
    width: f64,
    height: f64,
    state: String,
    animated: bool,
    anchor: CompanionPanelAnchor,
) -> Result<(), String> {
    let resize_app = app.clone();
    let window = window.clone();
    app.run_on_main_thread(move || {
        let result = (|| -> Result<(), String> {
            let raw_window = window.ns_window().map_err(|error| error.to_string())?;
            // SAFETY: Tauri owns this NSWindow for the lifetime of the cloned
            // WebviewWindow. AppKit frame APIs are invoked on the main thread.
            let ns_window = unsafe { &*(raw_window.cast::<NSWindow>()) };
            let old_frame = ns_window.frame();
            let (screen_frame, safe_capsule_top) = ns_window
                .screen()
                .map(|screen| {
                    let frame = screen.frame();
                    let visible_frame = screen.visibleFrame();
                    (frame, visible_frame.origin.y + visible_frame.size.height)
                })
                .unwrap_or((old_frame, old_frame.origin.y + old_frame.size.height));

            let old_companion_frame = CompanionFrame::from(old_frame);
            let calculation_frame = COMPANION_PANEL_VERTICAL_CENTER_Y
                .lock()
                .map(|mut center| {
                    companion_frame_with_stable_vertical_center(
                        old_companion_frame,
                        anchor.old_gutter_y,
                        anchor.vertical,
                        &mut center,
                    )
                })
                .unwrap_or(old_companion_frame);

            let target_companion_frame = calculate_companion_resize_frame(
                calculation_frame,
                CompanionFrame::from(screen_frame),
                safe_capsule_top,
                width,
                height,
                anchor,
            );
            let screen_companion_frame = CompanionFrame::from(screen_frame);
            let old_capsule_x = old_companion_frame.x + anchor.old_gutter_x;
            let old_capsule_width =
                companion_capsule_width(old_companion_frame.width, anchor.old_gutter_x);
            let new_capsule_width = companion_capsule_width(width, anchor.new_gutter_x);
            let horizontal = anchor.horizontal.unwrap_or_else(|| {
                resolve_companion_horizontal_anchor(
                    old_capsule_x,
                    old_capsule_width,
                    new_capsule_width,
                    screen_companion_frame,
                )
            });
            let ns_rect = |frame: CompanionFrame| {
                objc2_foundation::NSRect::new(
                    objc2_foundation::NSPoint::new(frame.x, frame.y),
                    objc2_foundation::NSSize::new(frame.width, frame.height),
                )
            };
            let target_frame = ns_rect(target_companion_frame);
            let resize_generation =
                COMPANION_PANEL_RESIZE_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;

            emit_companion_panel_transition(&window, &state, "started", horizontal);

            if !animated {
                ns_window.setFrame_display_animate(target_frame, true, false);
                emit_companion_panel_transition(&window, &state, "completed", horizontal);
                return Ok(());
            }

            /* CG/AppKit can report the visible 396pt resting panel as 397pt
            after the border-backed WebView is attached. Treat that single
            point as the same resting geometry; otherwise opening accidentally
            takes the generic AppKit animator while closing takes the manual
            right-edge path, recreating the exact asymmetric gap pulse. */
            let changes_resting_width = (old_capsule_width - COMPANION_PANEL_RESTING_WIDTH).abs()
                < 2.0
                || (new_capsule_width - COMPANION_PANEL_RESTING_WIDTH).abs() < 2.0;
            if horizontal == CompanionHorizontalAnchor::Right
                && changes_resting_width
                && (old_companion_frame.width - target_companion_frame.width).abs() >= 0.5
            {
                schedule_right_companion_resize(
                    resize_app.clone(),
                    window.clone(),
                    old_companion_frame,
                    target_companion_frame,
                    state.clone(),
                    horizontal,
                    resize_generation,
                );
                return Ok(());
            }

            let animation_window = ns_window.retain();
            let changes = block2::RcBlock::new(move |context: NonNull<NSAnimationContext>| {
                // SAFETY: AppKit passes the grouping's live context for the
                // duration of this block.
                let context = unsafe { context.as_ref() };
                context.setDuration(COMPANION_PANEL_RESIZE_DURATION_S);
                context.setTimingFunction(Some(&CAMediaTimingFunction::functionWithControlPoints(
                    0.42, 0.0, 0.58, 1.0,
                )));
                // SAFETY: `animator` is NSWindow's NSAnimatablePropertyContainer
                // proxy and forwards `setFrame:display:` into the running group.
                let animator: Retained<NSWindow> =
                    unsafe { msg_send![&*animation_window, animator] };
                animator.setFrame_display(target_frame, true);
            });
            let completion_window = window.clone();
            let completion_state = state.clone();
            let completion = block2::RcBlock::new(move || {
                emit_companion_panel_transition(
                    &completion_window,
                    &completion_state,
                    "completed",
                    horizontal,
                );
            });
            NSAnimationContext::runAnimationGroup_completionHandler(&changes, Some(&completion));
            Ok(())
        })();

        if let Err(error) = result {
            eprintln!("failed to resize companion panel: {error}");
        }
    })
    .map_err(|error| error.to_string())
}

#[cfg(not(target_os = "macos"))]
pub fn resize_companion_panel(
    _app: &AppHandle,
    window: &WebviewWindow,
    width: f64,
    height: f64,
    state: String,
    _animated: bool,
    anchor: CompanionPanelAnchor,
) -> Result<(), String> {
    let horizontal = anchor
        .horizontal
        .unwrap_or(CompanionHorizontalAnchor::Center);
    emit_companion_panel_transition(window, &state, "started", horizontal);
    window
        .set_size(tauri::LogicalSize::new(width, height))
        .map_err(|error| error.to_string())?;
    emit_companion_panel_transition(window, &state, "completed", horizontal);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SHADOW_X: f64 = 32.0;
    const SHADOW_Y: f64 = 40.0;
    const CONFETTI_X: f64 = 176.0;
    const CONFETTI_Y: f64 = 112.0;

    /// A roomy desktop, so nothing is clamped unless a test asks for it.
    fn screen() -> CompanionFrame {
        CompanionFrame {
            x: 0.0,
            y: 0.0,
            width: 1728.0,
            height: 1080.0,
        }
    }

    /// Where the capsule's top-left corner ends up, in screen terms.
    fn capsule_top_left(frame: CompanionFrame, gutter_x: f64, gutter_y: f64) -> (f64, f64) {
        (frame.x + gutter_x, frame.y + frame.height - gutter_y)
    }

    fn collapsed_frame_at(capsule_x: f64, capsule_top: f64) -> CompanionFrame {
        let width = 220.0 + SHADOW_X * 2.0;
        let height = 28.9 + SHADOW_Y * 2.0;
        CompanionFrame {
            x: capsule_x - SHADOW_X,
            y: capsule_top + SHADOW_Y - height,
            width,
            height,
        }
    }

    #[test]
    fn native_drag_keeps_the_visible_capsule_below_the_menu_bar() {
        let proposed = CompanionFrame {
            x: 1_370.0,
            y: 1_022.0,
            width: 422.0,
            height: 159.0,
        };

        let display = CompanionFrame {
            height: 1_117.0,
            ..screen()
        };
        let next = calculate_companion_drag_frame(proposed, display, 1_084.0);

        assert_eq!(next.x, proposed.x);
        assert_eq!(next.y, 989.0);
        assert_eq!(next.y + next.height - COMPANION_PANEL_GUTTER_Y, 1_084.0);
    }

    #[test]
    fn drag_release_reaches_the_menu_bar_from_the_original_grab_point() {
        let current = CompanionFrame {
            x: 312.0,
            y: -7.0,
            width: 422.0,
            height: 158.4,
        };
        let display = CompanionFrame {
            height: 1_117.0,
            ..screen()
        };

        let next = calculate_companion_drag_release_frame(
            current, display, 1_084.0, 523.0, 1_110.0, 211.0, 79.2,
        );

        assert_eq!(next.x, 312.0, "the original horizontal grab point moved");
        assert!(
            (next.y + next.height - COMPANION_PANEL_GUTTER_Y - 1_084.0).abs() < 0.001,
            "the capsule stopped below the menu bar",
        );
    }

    #[test]
    fn fixed_canvas_drag_clamps_the_visible_collapsed_capsule() {
        const COLLAPSED_WIDTH: f64 = 220.0;
        const LEFT_INSET: f64 = 410.0 + COMPANION_PANEL_GUTTER_X - COLLAPSED_WIDTH;
        let proposed = CompanionFrame {
            x: 1_700.0,
            y: 900.0,
            width: 410.0 + COMPANION_PANEL_GUTTER_X * 2.0,
            height: 28.9 + COMPANION_PANEL_GUTTER_Y * 2.0,
        };

        let next = calculate_companion_drag_frame_for_capsule(
            proposed,
            screen(),
            1_080.0,
            LEFT_INSET,
            COLLAPSED_WIDTH,
        );

        assert_eq!(
            next.x + LEFT_INSET,
            1_728.0 - COMPANION_PANEL_MIN_REACHABLE_X,
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn companion_panel_opts_out_of_system_tiling_without_losing_spaces_behavior() {
        let existing = NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::FullScreenAuxiliary
            | NSWindowCollectionBehavior::FullScreenAllowsTiling;

        let configured = companion_panel_collection_behavior(existing);

        assert!(configured.contains(NSWindowCollectionBehavior::CanJoinAllSpaces));
        assert!(configured.contains(NSWindowCollectionBehavior::FullScreenAuxiliary));
        assert!(configured.contains(NSWindowCollectionBehavior::FullScreenDisallowsTiling));
        assert!(!configured.contains(NSWindowCollectionBehavior::FullScreenAllowsTiling));
    }

    #[test]
    fn native_drag_leaves_a_mid_screen_grab_offset_untouched() {
        let proposed = CompanionFrame {
            x: 600.0,
            y: 500.0,
            width: 422.0,
            height: 159.0,
        };

        assert_eq!(
            calculate_companion_drag_frame(proposed, screen(), 1_084.0),
            proposed,
        );
    }

    #[test]
    fn native_drag_keeps_a_recoverable_target_at_side_and_bottom_edges() {
        let proposed = CompanionFrame {
            x: -500.0,
            y: -200.0,
            width: 422.0,
            height: 159.0,
        };

        let next = calculate_companion_drag_frame(proposed, screen(), 1_080.0);
        let capsule_left = next.x + COMPANION_PANEL_GUTTER_X;
        let capsule_top = next.y + next.height - COMPANION_PANEL_GUTTER_Y;

        assert_eq!(capsule_left, -174.0);
        assert_eq!(capsule_top, 24.0);
    }

    #[test]
    fn growing_into_a_milestone_leaves_the_capsule_where_it_was() {
        // A pill parked on the right-hand side of the screen.
        let old = collapsed_frame_at(1300.0, 1000.0);
        let anchor = CompanionPanelAnchor {
            old_gutter_x: SHADOW_X,
            old_gutter_y: SHADOW_Y,
            new_gutter_x: CONFETTI_X,
            new_gutter_y: CONFETTI_Y,
            horizontal: Some(CompanionHorizontalAnchor::Right),
            vertical: Some(CompanionVerticalAnchor::Top),
        };
        let milestone_width = 410.0 + CONFETTI_X * 2.0;
        let milestone_height = 54.0 + CONFETTI_Y * 2.0;

        let next = calculate_companion_resize_frame(
            old,
            screen(),
            1080.0,
            milestone_width,
            milestone_height,
            anchor,
        );

        let (_, old_top) = capsule_top_left(old, SHADOW_X, SHADOW_Y);
        let (_, new_top) = capsule_top_left(next, CONFETTI_X, CONFETTI_Y);
        // The capsule's top edge does not move at all.
        assert!(
            (new_top - old_top).abs() < 0.001,
            "capsule jumped vertically"
        );

        // Anchored right, so the capsule's right edge is preserved.
        let old_right = old.x + SHADOW_X + (old.width - SHADOW_X * 2.0);
        let new_right = next.x + CONFETTI_X + (next.width - CONFETTI_X * 2.0);
        assert!(
            (new_right - old_right).abs() < 0.001,
            "capsule jumped horizontally"
        );
    }

    #[test]
    fn fixed_canvas_keeps_a_right_anchored_visible_edge_exact() {
        const CANVAS_WIDTH: f64 = 410.0;
        const GUTTER_X: f64 = 88.0;
        const GUTTER_Y: f64 = 64.0;
        let old = CompanionFrame {
            x: 1_230.0,
            y: 900.0,
            width: CANVAS_WIDTH + GUTTER_X * 2.0,
            height: 28.9 + GUTTER_Y * 2.0,
        };
        let next = calculate_companion_resize_frame(
            old,
            screen(),
            1_080.0,
            CANVAS_WIDTH + GUTTER_X * 2.0,
            54.0 + GUTTER_Y * 2.0,
            CompanionPanelAnchor {
                old_gutter_x: CANVAS_WIDTH + GUTTER_X - 220.0,
                old_gutter_y: GUTTER_Y,
                new_gutter_x: GUTTER_X,
                new_gutter_y: GUTTER_Y,
                horizontal: Some(CompanionHorizontalAnchor::Right),
                vertical: Some(CompanionVerticalAnchor::Top),
            },
        );

        let old_visible_right = old.x + old.width - GUTTER_X;
        let next_visible_right = next.x + next.width - GUTTER_X;
        assert_eq!(old.x, next.x, "the native horizontal frame must not move");
        assert_eq!(
            old.width, next.width,
            "the native canvas width must stay fixed"
        );
        assert_eq!(old_visible_right, 1_728.0);
        assert_eq!(next_visible_right, old_visible_right);
    }

    #[test]
    fn a_centered_pill_and_milestone_share_the_same_center() {
        const GUTTER_X: f64 = 88.0;
        const GUTTER_Y: f64 = 64.0;
        let resting = CompanionFrame {
            x: 864.0 - (220.0 + GUTTER_X * 2.0) / 2.0,
            y: 900.0,
            width: 220.0 + GUTTER_X * 2.0,
            height: 28.9 + GUTTER_Y * 2.0,
        };
        let open = calculate_companion_resize_frame(
            resting,
            screen(),
            1080.0,
            410.0 + GUTTER_X * 2.0,
            54.0 + GUTTER_Y * 2.0,
            CompanionPanelAnchor {
                old_gutter_x: GUTTER_X,
                old_gutter_y: GUTTER_Y,
                new_gutter_x: GUTTER_X,
                new_gutter_y: GUTTER_Y,
                horizontal: Some(CompanionHorizontalAnchor::Center),
                vertical: Some(CompanionVerticalAnchor::Center),
            },
        );

        let resting_center = resting.x + resting.width / 2.0;
        let open_center = open.x + open.width / 2.0;
        assert!((open_center - resting_center).abs() < 0.001);
        let resting_capsule_center_y = resting.y + resting.height / 2.0;
        let open_capsule_center_y = open.y + open.height / 2.0;
        assert!((open_capsule_center_y - resting_capsule_center_y).abs() < 0.001);
    }

    #[test]
    fn anchor_resolution_only_pins_when_centering_would_clip() {
        let display = screen();
        assert_eq!(
            resolve_companion_horizontal_anchor(754.0, 220.0, 410.0, display),
            CompanionHorizontalAnchor::Center,
        );
        assert_eq!(
            resolve_companion_horizontal_anchor(1484.0, 220.0, 410.0, display),
            CompanionHorizontalAnchor::Right,
        );
        assert_eq!(
            resolve_companion_horizontal_anchor(24.0, 220.0, 410.0, display),
            CompanionHorizontalAnchor::Left,
        );
    }

    #[test]
    fn vertical_anchor_centers_with_clearance_and_pins_only_at_a_boundary() {
        let safe_top = 1084.0;
        assert_eq!(
            resolve_companion_vertical_anchor(safe_top - 24.0, 28.9, 54.0, 0.0, safe_top,),
            CompanionVerticalAnchor::Center,
        );
        assert_eq!(
            resolve_companion_vertical_anchor(safe_top, 28.9, 54.0, 0.0, safe_top),
            CompanionVerticalAnchor::Top,
        );
        assert_eq!(
            resolve_companion_vertical_anchor(28.9, 28.9, 54.0, 0.0, safe_top),
            CompanionVerticalAnchor::Bottom,
        );
    }

    #[test]
    fn default_top_right_open_and_close_retrace_the_same_vertical_center() {
        const GUTTER_X: f64 = 88.0;
        const GUTTER_Y: f64 = 64.0;
        let visible = CompanionFrame {
            x: 0.0,
            y: 0.0,
            width: 1728.0,
            height: 1117.0,
        };
        let safe_top = 1084.0;
        let resting_capsule_top = safe_top - 24.0;
        let resting = CompanionFrame {
            x: 1420.0,
            y: resting_capsule_top + GUTTER_Y - (28.9 + GUTTER_Y * 2.0),
            width: 220.0 + GUTTER_X * 2.0,
            height: 28.9 + GUTTER_Y * 2.0,
        };
        let open = calculate_companion_resize_frame(
            resting,
            visible,
            safe_top,
            410.0 + GUTTER_X * 2.0,
            54.0 + GUTTER_Y * 2.0,
            CompanionPanelAnchor {
                old_gutter_x: GUTTER_X,
                old_gutter_y: GUTTER_Y,
                new_gutter_x: GUTTER_X,
                new_gutter_y: GUTTER_Y,
                horizontal: Some(CompanionHorizontalAnchor::Right),
                vertical: Some(CompanionVerticalAnchor::Center),
            },
        );
        let closed = calculate_companion_resize_frame(
            open,
            visible,
            safe_top,
            220.0 + GUTTER_X * 2.0,
            28.9 + GUTTER_Y * 2.0,
            CompanionPanelAnchor {
                old_gutter_x: GUTTER_X,
                old_gutter_y: GUTTER_Y,
                new_gutter_x: GUTTER_X,
                new_gutter_y: GUTTER_Y,
                horizontal: Some(CompanionHorizontalAnchor::Right),
                vertical: Some(CompanionVerticalAnchor::Center),
            },
        );

        let resting_center_y = resting.y + resting.height / 2.0;
        let open_center_y = open.y + open.height / 2.0;
        let closed_center_y = closed.y + closed.height / 2.0;
        assert!((open_center_y - resting_center_y).abs() < 0.001);
        assert!((closed_center_y - resting_center_y).abs() < 0.001);
        let resting_right = resting.x + resting.width - GUTTER_X;
        let open_right = open.x + open.width - GUTTER_X;
        let closed_right = closed.x + closed.width - GUTTER_X;
        assert!((resting_right - visible.width).abs() < 0.001);
        assert!((open_right - resting_right).abs() < 0.001);
        assert!((closed_right - resting_right).abs() < 0.001);
    }

    #[test]
    fn centered_resize_ignores_appkit_origin_rounding_between_cycles() {
        let mut baseline = None;
        let collapsed = CompanionFrame {
            x: 1_396.0,
            y: 0.0,
            width: 396.0,
            height: 156.9,
        };
        let initial = companion_frame_with_stable_vertical_center(
            collapsed,
            64.0,
            Some(CompanionVerticalAnchor::Center),
            &mut baseline,
        );
        assert_eq!(initial, collapsed);

        // AppKit can return the expanded frame with its sub-point origin
        // rounded. Rebase it without accepting the rounded center as a new
        // baseline, then verify another cycle resolves to the exact same frame.
        let rounded_open = CompanionFrame {
            x: 1_206.0,
            y: -13.0,
            width: 586.0,
            height: 182.0,
        };
        let rebased_open = companion_frame_with_stable_vertical_center(
            rounded_open,
            64.0,
            Some(CompanionVerticalAnchor::Center),
            &mut baseline,
        );
        let capsule_height = rebased_open.height - 128.0;
        let rebased_center = rebased_open.y + rebased_open.height - 64.0 - capsule_height / 2.0;
        assert!((rebased_center - baseline.unwrap()).abs() < 0.000_001);

        let next_cycle = companion_frame_with_stable_vertical_center(
            rounded_open,
            64.0,
            Some(CompanionVerticalAnchor::Center),
            &mut baseline,
        );
        assert_eq!(
            next_cycle, rebased_open,
            "the center must not accumulate drift"
        );
    }

    #[test]
    fn manual_right_resize_keeps_one_right_edge_for_every_frame() {
        let resting = CompanionFrame {
            x: 1_420.0,
            y: 960.0,
            width: 396.0,
            height: 156.9,
        };
        let milestone = CompanionFrame {
            x: 1_230.0,
            y: 947.45,
            width: 586.0,
            height: 182.0,
        };
        let mut previous_progress = -1.0;
        for step in 0..=17 {
            let linear = step as f64 / 17.0;
            let progress = companion_resize_progress(linear);
            assert!(progress >= previous_progress);
            previous_progress = progress;
            let opening = interpolate_companion_frame(resting, milestone, progress);
            let closing = interpolate_companion_frame(milestone, resting, progress);
            assert!((opening.x + opening.width - 1_816.0).abs() < 0.000_001);
            assert!((closing.x + closing.width - 1_816.0).abs() < 0.000_001);
        }
    }

    #[test]
    fn closing_a_wide_moment_keeps_the_edge_chosen_when_it_opened() {
        const GUTTER_X: f64 = 88.0;
        const GUTTER_Y: f64 = 64.0;
        let visible = CompanionFrame {
            x: 0.0,
            y: 0.0,
            width: 1728.0,
            height: 1084.0,
        };
        /* This resting pill starts just right of center. Growing leftwards
        makes the wide card's center cross the midpoint, which used to flip
        the close animation to a left anchor and permanently move the pill. */
        let resting = CompanionFrame {
            x: 740.0,
            y: 1084.0 + GUTTER_Y - (28.9 + GUTTER_Y * 2.0),
            width: 220.0 + GUTTER_X * 2.0,
            height: 28.9 + GUTTER_Y * 2.0,
        };
        let open = calculate_companion_resize_frame(
            resting,
            visible,
            1084.0,
            410.0 + GUTTER_X * 2.0,
            54.0 + GUTTER_Y * 2.0,
            CompanionPanelAnchor {
                old_gutter_x: GUTTER_X,
                old_gutter_y: GUTTER_Y,
                new_gutter_x: GUTTER_X,
                new_gutter_y: GUTTER_Y,
                horizontal: Some(CompanionHorizontalAnchor::Right),
                vertical: Some(CompanionVerticalAnchor::Top),
            },
        );
        let closed = calculate_companion_resize_frame(
            open,
            visible,
            1084.0,
            220.0 + GUTTER_X * 2.0,
            28.9 + GUTTER_Y * 2.0,
            CompanionPanelAnchor {
                old_gutter_x: GUTTER_X,
                old_gutter_y: GUTTER_Y,
                new_gutter_x: GUTTER_X,
                new_gutter_y: GUTTER_Y,
                horizontal: Some(CompanionHorizontalAnchor::Right),
                vertical: Some(CompanionVerticalAnchor::Top),
            },
        );

        let resting_right = resting.x + resting.width - GUTTER_X;
        let open_right = open.x + open.width - GUTTER_X;
        let closed_right = closed.x + closed.width - GUTTER_X;
        assert!((open_right - resting_right).abs() < 0.001);
        assert!((closed_right - resting_right).abs() < 0.001);
    }

    #[test]
    fn a_left_hand_pill_grows_rightwards_from_its_own_edge() {
        let old = collapsed_frame_at(120.0, 1000.0);
        let anchor = CompanionPanelAnchor {
            old_gutter_x: SHADOW_X,
            old_gutter_y: SHADOW_Y,
            new_gutter_x: CONFETTI_X,
            new_gutter_y: CONFETTI_Y,
            horizontal: Some(CompanionHorizontalAnchor::Left),
            vertical: Some(CompanionVerticalAnchor::Center),
        };

        let next = calculate_companion_resize_frame(
            old,
            screen(),
            1080.0,
            410.0 + CONFETTI_X * 2.0,
            54.0 + CONFETTI_Y * 2.0,
            anchor,
        );

        let (old_left, _) = capsule_top_left(old, SHADOW_X, SHADOW_Y);
        let (new_left, _) = capsule_top_left(next, CONFETTI_X, CONFETTI_Y);
        assert!(
            (new_left - old_left).abs() < 0.001,
            "left edge should be held"
        );
    }

    #[test]
    fn keeps_the_capsule_on_screen_while_the_gutter_may_hang_off() {
        // Hard against the right edge of the desktop.
        let old = collapsed_frame_at(1728.0 - 246.0, 1000.0);
        let anchor = CompanionPanelAnchor {
            old_gutter_x: SHADOW_X,
            old_gutter_y: SHADOW_Y,
            new_gutter_x: CONFETTI_X,
            new_gutter_y: CONFETTI_Y,
            horizontal: None,
            vertical: Some(CompanionVerticalAnchor::Center),
        };

        let next = calculate_companion_resize_frame(
            old,
            screen(),
            1080.0,
            410.0 + CONFETTI_X * 2.0,
            54.0 + CONFETTI_Y * 2.0,
            anchor,
        );

        /* The capsule may sit flush with an edge, or past it, as long as enough
        of it is left to grab — it has no title bar to recover it with. */
        let capsule_left = next.x + CONFETTI_X;
        let capsule_right = capsule_left + 410.0;
        let visible = capsule_right.min(1728.0) - capsule_left.max(0.0);
        assert!(
            visible >= COMPANION_PANEL_MIN_REACHABLE_X - 0.001,
            "too little of the capsule is reachable: {visible}px"
        );
        // The transparent gutter is allowed to overhang.
        assert!(next.x < 0.0 || next.x + next.width > 1728.0);
    }

    /* Expanding a pill that came from an older build's menu-bar band must move
    the visible capsule below the current safe top. */
    #[test]
    fn keeps_the_capsule_below_the_menu_bar_when_it_expands() {
        let display_top = screen().y + screen().height;
        let work_area_top = display_top - 33.0;
        let old = collapsed_frame_at(900.0, display_top);
        let anchor = CompanionPanelAnchor {
            old_gutter_x: SHADOW_X,
            old_gutter_y: SHADOW_Y,
            new_gutter_x: CONFETTI_X,
            new_gutter_y: CONFETTI_Y,
            horizontal: None,
            vertical: None,
        };

        let next = calculate_companion_resize_frame(
            old,
            screen(),
            work_area_top,
            410.0 + CONFETTI_X * 2.0,
            54.0 + CONFETTI_Y * 2.0,
            anchor,
        );

        let capsule_top = next.y + next.height - CONFETTI_Y;
        assert!(
            (capsule_top - work_area_top).abs() < 0.001,
            "the capsule entered the menu-bar band"
        );
    }
}
