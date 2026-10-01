use std::collections::VecDeque;
use tauri::{AppHandle, LogicalPosition, WebviewWindow};

use super::pet_mode::{current_pet_logical_position, current_pet_render_geometry, emit_pet_drag_event, probe_pet_drop_plan, PetDragLease};
#[cfg(not(target_os = "macos"))]
use super::pet_mode::pet_scene_to_window_position;
#[cfg(target_os = "windows")]
use super::windows_overlay::{
    configure_windows_overlay, show_windows_overlay, WindowsOverlayInputMode,
};

const PET_SHAKE_WINDOW_MS: u64 = 1_000;
const PET_SHAKE_MIN_SAMPLE_DISTANCE_PT: f64 = 2.0;
const PET_SHAKE_MIN_LEG_PT: f64 = 24.0;
const PET_SHAKE_MIN_PATH_PT: f64 = 220.0;
const PET_SHAKE_MIN_REVERSALS: usize = 4;
// A stroke is a short back-and-forth on the cat, not a relocation. Keep the
// legs small enough that a real petting motion qualifies, but require enough
// reversals and so little net travel that a pickup-and-move cannot fake it.
const PET_STROKE_MIN_LEG_PT: f64 = 8.0;
const PET_STROKE_MIN_REVERSALS: usize = 2;
const PET_STROKE_MIN_PATH_PT: f64 = 24.0;
const PET_STROKE_MAX_NET_PT: f64 = 18.0;
const PET_STROKE_MAX_DURATION_MS: u64 = 2_400;
// Wait just long enough for a second reverse to land before treating the
// first 7px of movement as a pickup. A relocating drag still starts as soon
// as that reverse never arrives.
const PET_STROKE_PICKUP_GRACE_MS: u64 = 220;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
enum PetPanelGestureState {
    #[default]
    Pending,
    // The drag threshold crossed and WebKit owns the pickup pose, but the
    // native panel has not started following the pointer yet.
    DragPickup,
    // Native pointer following is irreversible for this press. A later
    // stroke-shaped path is the shake gesture and cannot reclassify the drag.
    Dragging,
    // Stroke classification is terminal for this press.
    Stroke,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PetPanelGestureEvent {
    DragStarted,
    StrokeDetected,
}

#[cfg(any(target_os = "windows", test))]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PetPanelPressEnd {
    Released,
    Cancelled,
}

impl PetPanelGestureState {
    fn observe(
        &mut self,
        elapsed_ms: u64,
        pointer_dx: f64,
        pointer_dy: f64,
        stroking: bool,
    ) -> Option<PetPanelGestureEvent> {
        match *self {
            Self::Pending if stroking => {
                *self = Self::Stroke;
                Some(PetPanelGestureEvent::StrokeDetected)
            }
            Self::Pending
                if elapsed_ms >= PET_STROKE_PICKUP_GRACE_MS
                    && is_pet_drag_delta(pointer_dx, pointer_dy) =>
            {
                *self = Self::DragPickup;
                Some(PetPanelGestureEvent::DragStarted)
            }
            // WebKit may already be painting the pickup pose when the second
            // stroke reversal arrives. It is still safe to reclassify here
            // because native has not moved the panel yet.
            Self::DragPickup if stroking => {
                *self = Self::Stroke;
                Some(PetPanelGestureEvent::StrokeDetected)
            }
            _ => None,
        }
    }

    fn begin_following_pointer(&mut self) {
        if *self == Self::DragPickup {
            *self = Self::Dragging;
        }
    }

    #[cfg(any(target_os = "windows", test))]
    fn observe_windows_press(
        &mut self,
        elapsed_ms: u64,
        pointer_dx: f64,
        pointer_dy: f64,
        stroking: bool,
        cancelled: bool,
    ) -> Option<PetPanelGestureEvent> {
        if cancelled {
            None
        } else {
            self.observe(elapsed_ms, pointer_dx, pointer_dy, stroking)
        }
    }

    #[cfg(any(target_os = "windows", test))]
    fn finish_mouse_press(
        &mut self,
        explicit_mouse: bool,
        pointer_dx: f64,
        pointer_dy: f64,
        end: PetPanelPressEnd,
    ) -> Option<PetPanelGestureEvent> {
        // The held-pointer grace gives a stroke time to reverse. Once this
        // explicit mouse press has ended, a still-pending relocation cannot
        // produce another reversal. Preserve its final delta even when the
        // worker first runs after button-up. Stroke remains terminal.
        if explicit_mouse
            && end == PetPanelPressEnd::Released
            && *self == Self::Pending
            && is_pet_drag_delta(pointer_dx, pointer_dy)
        {
            *self = Self::DragPickup;
            Some(PetPanelGestureEvent::DragStarted)
        } else {
            None
        }
    }

    fn moved(self) -> bool {
        // Preserve the public outcome contract: a threshold-crossed pickup is
        // a drag even if mouse-up arrives before the visual pickup delay and
        // the native panel receives its first/final position only on release.
        matches!(self, Self::DragPickup | Self::Dragging)
    }

    fn stroke_detected(self) -> bool {
        self == Self::Stroke
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PetPanelDragOutcome {
    pub moved: bool,
    pub shake_detected: bool,
    pub stroke_detected: bool,
}

#[derive(Clone, Copy, Debug)]
struct PetShakeSample {
    at_ms: u64,
    x: f64,
    y: f64,
}

#[derive(Default)]
struct PetShakeDetector {
    samples: VecDeque<PetShakeSample>,
}

impl PetShakeDetector {
    fn observe(&mut self, at_ms: u64, x: f64, y: f64) {
        let cutoff = at_ms.saturating_sub(PET_SHAKE_WINDOW_MS);
        while self
            .samples
            .front()
            .is_some_and(|sample| sample.at_ms < cutoff)
        {
            self.samples.pop_front();
        }
        if self.samples.back().is_some_and(|sample| {
            (x - sample.x).hypot(y - sample.y) < PET_SHAKE_MIN_SAMPLE_DISTANCE_PT
        }) {
            return;
        }
        self.samples.push_back(PetShakeSample { at_ms, x, y });
    }

    fn detected(&self) -> bool {
        if self.samples.len() < PET_SHAKE_MIN_REVERSALS + 2 {
            return false;
        }
        let mut path = 0.0;
        let samples: Vec<_> = self.samples.iter().copied().collect();
        for pair in samples.windows(2) {
            path += (pair[1].x - pair[0].x).hypot(pair[1].y - pair[0].y);
        }
        if path < PET_SHAKE_MIN_PATH_PT {
            return false;
        }
        meaningful_axis_reversals(&samples, PET_SHAKE_MIN_LEG_PT, |sample| sample.x)
            >= PET_SHAKE_MIN_REVERSALS
            || meaningful_axis_reversals(&samples, PET_SHAKE_MIN_LEG_PT, |sample| sample.y)
                >= PET_SHAKE_MIN_REVERSALS
    }
}

fn meaningful_axis_reversals(
    samples: &[PetShakeSample],
    min_leg_pt: f64,
    coordinate: impl Fn(&PetShakeSample) -> f64,
) -> usize {
    let Some(first) = samples.first() else {
        return 0;
    };
    let mut extreme = coordinate(first);
    let mut direction = 0_i8;
    let mut reversals = 0;
    for sample in &samples[1..] {
        let value = coordinate(sample);
        match direction {
            0 if value - extreme >= min_leg_pt => {
                direction = 1;
                extreme = value;
            }
            0 if extreme - value >= min_leg_pt => {
                direction = -1;
                extreme = value;
            }
            1 if value > extreme => extreme = value,
            1 if extreme - value >= min_leg_pt => {
                reversals += 1;
                direction = -1;
                extreme = value;
            }
            -1 if value < extreme => extreme = value,
            -1 if value - extreme >= min_leg_pt => {
                reversals += 1;
                direction = 1;
                extreme = value;
            }
            _ => {}
        }
    }
    reversals
}

fn pet_stroke_detected(samples: &[PetShakeSample]) -> bool {
    let Some(last) = samples.last() else {
        return false;
    };
    let cutoff = last.at_ms.saturating_sub(PET_STROKE_MAX_DURATION_MS);
    let window: Vec<_> = samples
        .iter()
        .copied()
        .filter(|sample| sample.at_ms >= cutoff)
        .collect();
    if window.len() < PET_STROKE_MIN_REVERSALS + 2 {
        return false;
    }
    let mut path = 0.0;
    for pair in window.windows(2) {
        path += (pair[1].x - pair[0].x).hypot(pair[1].y - pair[0].y);
    }
    if path < PET_STROKE_MIN_PATH_PT {
        return false;
    }
    let start = window[0];
    let end = window[window.len() - 1];
    let net = (end.x - start.x).hypot(end.y - start.y);
    if net > PET_STROKE_MAX_NET_PT {
        return false;
    }
    let reversals = meaningful_axis_reversals(&window, PET_STROKE_MIN_LEG_PT, |sample| sample.x)
        .max(meaningful_axis_reversals(&window, PET_STROKE_MIN_LEG_PT, |sample| sample.y));
    reversals >= PET_STROKE_MIN_REVERSALS
}

/// Configure the desktop pet as the same kind of non-activating macOS panel
/// used by the resident Companion pill. A regular transparent Tauri window can
/// activate Drifty on mouse-down, which causes the hidden main dashboard to be
/// revealed even when the webview consumes the pointer event.
#[cfg(target_os = "macos")]
pub fn configure_pet_panel(window: &WebviewWindow) -> tauri::Result<()> {
    use objc2::runtime::{AnyClass, AnyObject, ClassBuilder, Sel};
    use objc2::sel;
    use objc2_app_kit::{
        NSColor, NSStatusWindowLevel, NSWindow, NSWindowCollectionBehavior, NSWindowStyleMask,
    };
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
    // Full-screen presence belongs to the intervention, not resident life.
    let mut behavior = ns_window.collectionBehavior();
    behavior.remove(NSWindowCollectionBehavior::FullScreenAuxiliary);
    ns_window.setCollectionBehavior(behavior);
    ns_window.setLevel(NSStatusWindowLevel);
    // The versioned hit-region controller enables input only under a visible
    // cat pixel. Starting click-through prevents the transparent panel from
    // blocking the user's current app before the WebView publishes its frame.
    ns_window.setIgnoresMouseEvents(true);
    ns_window.setOpaque(false);
    ns_window.setBackgroundColor(Some(&NSColor::clearColor()));
    Ok(())
}

#[cfg(target_os = "windows")]
pub fn configure_pet_panel(window: &WebviewWindow) -> tauri::Result<()> {
    configure_windows_overlay(window, WindowsOverlayInputMode::Passive)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn configure_pet_panel(_window: &WebviewWindow) -> tauri::Result<()> {
    Ok(())
}

/// How long a marshalled presentation waits for AppKit to run the block.
/// Matches the timeout the other Pet Mode main-thread hops already use.
#[cfg(any(target_os = "macos", target_os = "windows"))]
const PET_PANEL_MAIN_THREAD_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(2000);

/// Whether a presentation has to hop to AppKit's main thread first.
///
/// Split out so the policy is testable without an `AppHandle`: ordering a
/// window in from a tokio worker aborts the process, so anything not already
/// on the main thread must be marshalled.
#[cfg(target_os = "macos")]
fn pet_panel_needs_main_thread_hop(on_main_thread: bool) -> bool {
    !on_main_thread
}

/// Show without activating the application. `WebviewWindow::show` is correct
/// on other platforms, while AppKit's panel ordering API preserves whatever
/// app the user is currently working in.
///
/// Ordering a window in is main-thread-only. Several Pet Mode commands run
/// their body inside `spawn_blocking` because they drive a sleeping animation
/// loop that must not occupy AppKit's main thread, so this function marshals
/// just the ordering step and blocks for its result. Calling it directly from
/// a tokio worker used to abort the whole process with
/// "Must only be used from the main thread".
pub fn show_pet_panel(app: &AppHandle, window: &WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use objc2::MainThreadMarker;

        if pet_panel_needs_main_thread_hop(MainThreadMarker::new().is_some()) {
            let app_for_main = app.clone();
            let window_for_main = window.clone();
            let (sender, receiver) = std::sync::mpsc::sync_channel(1);
            app.run_on_main_thread(crate::panic_guard::contained("pet_panel::show_pet_panel", move || {
                let _ = sender.send(show_pet_panel_on_main_thread(
                    &app_for_main,
                    &window_for_main,
                ));
            }))
            .map_err(|error| error.to_string())?;

            return receiver
                .recv_timeout(PET_PANEL_MAIN_THREAD_TIMEOUT)
                .map_err(|_| "Pet Mode panel presentation timed out".to_string())?;
        }

        return show_pet_panel_on_main_thread(app, window);
    }

    #[cfg(target_os = "windows")]
    {
        let app_for_main = app.clone();
        let window_for_main = window.clone();
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        app.run_on_main_thread(crate::panic_guard::contained("pet_panel::show_pet_panel", move || {
            let _ = sender.send(show_pet_panel_on_main_thread(
                &app_for_main,
                &window_for_main,
            ));
        }))
        .map_err(|error| error.to_string())?;

        return receiver
            .recv_timeout(PET_PANEL_MAIN_THREAD_TIMEOUT)
            .map_err(|_| "Pet Mode panel presentation timed out".to_string())?;
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    show_pet_panel_on_main_thread(app, window)
}

/// Position the hidden pet panel and reveal it as one AppKit transaction.
///
/// Tauri's macOS `set_position` queues `setFrameTopLeftPoint` asynchronously.
/// Calling it immediately before `show_pet_panel` can therefore reveal the
/// panel at its stale hidden position for one compositor frame. Apply the
/// native frame change synchronously on AppKit's main thread, then order the
/// panel in before returning.
pub fn show_pet_panel_at_position(
    app: &AppHandle,
    window: &WebviewWindow,
    desired: LogicalPosition<f64>,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use objc2::MainThreadMarker;

        if pet_panel_needs_main_thread_hop(MainThreadMarker::new().is_some()) {
            let app_for_main = app.clone();
            let window_for_main = window.clone();
            let (sender, receiver) = std::sync::mpsc::sync_channel(1);
            app.run_on_main_thread(crate::panic_guard::contained("pet_panel::show_pet_panel_at_position", move || {
                let _ = sender.send(show_pet_panel_at_position_on_main_thread(
                    &app_for_main,
                    &window_for_main,
                    desired,
                ));
            }))
            .map_err(|error| error.to_string())?;

            return receiver
                .recv_timeout(PET_PANEL_MAIN_THREAD_TIMEOUT)
                .map_err(|_| "Pet Mode positioned panel presentation timed out".to_string())?;
        }

        return show_pet_panel_at_position_on_main_thread(app, window, desired);
    }

    #[cfg(target_os = "windows")]
    {
        let app_for_main = app.clone();
        let window_for_main = window.clone();
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        app.run_on_main_thread(crate::panic_guard::contained("pet_panel::show_pet_panel_at_position", move || {
            let res = window_for_main
                .set_position(pet_scene_to_window_position(&window_for_main, desired))
                .map_err(|error| error.to_string())
                .and_then(|_| show_pet_panel_on_main_thread(&app_for_main, &window_for_main));
            let _ = sender.send(res);
        }))
        .map_err(|error| error.to_string())?;

        return receiver
            .recv_timeout(PET_PANEL_MAIN_THREAD_TIMEOUT)
            .map_err(|_| "Pet Mode positioned panel presentation timed out".to_string())?;
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        window
            .set_position(pet_scene_to_window_position(window, desired))
            .map_err(|error| error.to_string())?;
        show_pet_panel(app, window)
    }
}

#[cfg(target_os = "macos")]
fn pet_panel_native_origin_after_logical_move(
    current_native_origin: (f64, f64),
    current_logical: LogicalPosition<f64>,
    desired: LogicalPosition<f64>,
) -> Option<(f64, f64)> {
    if ![
        current_native_origin.0,
        current_native_origin.1,
        current_logical.x,
        current_logical.y,
        desired.x,
        desired.y,
    ]
    .into_iter()
    .all(f64::is_finite)
    {
        return None;
    }
    (
        current_native_origin.0 + (desired.x - current_logical.x),
        current_native_origin.1 - (desired.y - current_logical.y),
    )
        .into()
}

/// The actual positioned presentation, always reached on the main thread.
#[cfg(target_os = "macos")]
fn show_pet_panel_at_position_on_main_thread(
    app: &AppHandle,
    window: &WebviewWindow,
    desired: LogicalPosition<f64>,
) -> Result<(), String> {
    use objc2_app_kit::NSWindow;
    use objc2_foundation::NSPoint;

    let ptr = window.ns_window().map_err(|error| error.to_string())?;
    // SAFETY: Tauri retains this NSWindow and the caller guarantees that this
    // function runs on AppKit's main thread.
    let ns_window: &NSWindow = unsafe { &*ptr.cast::<NSWindow>() };
    let frame = ns_window.frame();
    let current = current_pet_logical_position(window)?;
    let (x, y) = pet_panel_native_origin_after_logical_move(
        (frame.origin.x, frame.origin.y),
        current,
        desired,
    )
    .ok_or_else(|| "Pet Mode positioned panel received a non-finite origin".to_string())?;
    ns_window.setFrameOrigin(NSPoint::new(x, y));
    show_pet_panel_on_main_thread(app, window)
}

/// The actual presentation, always reached on the main thread.
fn show_pet_panel_on_main_thread(app: &AppHandle, window: &WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use tauri_nspanel::ManagerExt as PanelManagerExt;

        // This helper is shared by the cat and its quick-controls panel. Use
        // the requested window's registry label; a fixed `pet-mode` lookup
        // reports success while leaving every secondary panel hidden.
        if let Ok(panel) = app.get_webview_panel(window.label()) {
            panel.order_front_regardless();
            return Ok(());
        }
    }

    #[cfg(target_os = "windows")]
    return show_windows_overlay(window);

    #[cfg(not(target_os = "windows"))]
    window.show().map_err(|error| error.to_string())
}

use std::time::{Duration, Instant};

#[derive(Clone, Copy, Debug)]
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub(super) struct PetPanelMouseDownAnchor {
    canonical_grab: (f64, f64),
    physical_down: (f64, f64),
    dpi: f64,
}

#[cfg(any(target_os = "windows", test))]
fn pet_mouse_down_anchor(
    pointer_type: Option<&str>,
    client: (f64, f64),
    origin: (f64, f64),
    dpi: f64,
    geometry: super::pet_render_geometry::PetRenderGeometry,
) -> Result<Option<PetPanelMouseDownAnchor>, String> {
    // Older callers and touch/pen retain the native sampled-pointer path.
    // Only an explicit mouse pointerdown proves an already-ended mouse press.
    if pointer_type != Some("mouse") {
        return Ok(None);
    }
    if ![
        client.0,
        client.1,
        origin.0,
        origin.1,
        dpi,
        geometry.scale(),
        geometry.render_width,
        geometry.render_height,
    ]
    .into_iter()
    .all(f64::is_finite)
        || dpi <= 0.0
        || geometry.scale() <= 0.0
        || client.0 < 0.0
        || client.0 > geometry.render_width
        || client.1 < 0.0
        || client.1 > geometry.render_height
    {
        return Err("Pet Mode mouse-down anchor is outside the rendering surface".into());
    }
    let anchor = PetPanelMouseDownAnchor {
        canonical_grab: geometry.canonical_point_at_window(client),
        physical_down: (origin.0 + client.0 * dpi, origin.1 + client.1 * dpi),
        dpi,
    };
    if ![
        anchor.canonical_grab.0,
        anchor.canonical_grab.1,
        anchor.physical_down.0,
        anchor.physical_down.1,
    ]
    .into_iter()
    .all(f64::is_finite)
    {
        return Err("Pet Mode mouse-down anchor is unavailable".into());
    }
    Ok(Some(anchor))
}

/// Capture before dance headroom is restored: that restoration moves the
/// window, while these viewport coordinates still describe the down frame.
pub(super) fn capture_pet_panel_mouse_down(
    window: &WebviewWindow,
    client: (f64, f64),
    pointer_type: Option<&str>,
) -> Result<Option<PetPanelMouseDownAnchor>, String> {
    #[cfg(target_os = "windows")]
    {
        if pointer_type != Some("mouse") {
            return Ok(None);
        }
        super::pet_mode::run_pet_native_transaction(
            window,
            "pet_panel::capture_mouse_down",
            move |window| {
                let origin = window.outer_position().map_err(|error| error.to_string())?;
                let dpi = window.scale_factor().map_err(|error| error.to_string())?;
                pet_mouse_down_anchor(
                    Some("mouse"),
                    client,
                    (origin.x as f64, origin.y as f64),
                    dpi,
                    current_pet_render_geometry(),
                )
            },
        )
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (window, client, pointer_type);
        Ok(None)
    }
}

#[cfg(any(target_os = "windows", test))]
const PET_WINDOWS_BUTTON_OBSERVE_GRACE_MS: u64 = 250;

#[cfg(any(target_os = "windows", test))]
fn pet_windows_press_end(
    held: bool,
    cancelled: bool,
    observed_button_held: bool,
    elapsed_ms: u64,
    explicit_mouse: bool,
) -> Option<PetPanelPressEnd> {
    if cancelled {
        Some(PetPanelPressEnd::Cancelled)
    } else if !held
        && (explicit_mouse
            || observed_button_held
            || elapsed_ms >= PET_WINDOWS_BUTTON_OBSERVE_GRACE_MS)
    {
        Some(PetPanelPressEnd::Released)
    } else {
        None
    }
}

#[cfg(any(target_os = "windows", test))]
fn pet_drag_origin_at_dpi(
    logical_grab_offset: (f64, f64),
    mouse: (f64, f64),
    dpi: f64,
) -> (f64, f64) {
    (
        mouse.0 - logical_grab_offset.0 * dpi,
        mouse.1 - logical_grab_offset.1 * dpi,
    )
}

const PET_DRAG_THRESHOLD_PHYSICAL_PX: f64 = 7.0;

fn is_pet_drag_delta(pointer_dx: f64, pointer_dy: f64) -> bool {
    pointer_dx.hypot(pointer_dy) >= PET_DRAG_THRESHOLD_PHYSICAL_PX
}

/// Track the real pointer without occupying AppKit's main thread. The earlier
/// nested AppKit event loop moved the non-activating panel correctly, but it
/// starved WebKit's layer commits for the full gesture, so the pickup pose was
/// never composited before mouse-up.
///
/// This version keeps the gesture loop on a background thread but applies the
/// position on the AppKit main thread, where each apply block samples the
/// freshest `NSEvent.mouseLocation` itself and calls `setFrameOrigin`
/// directly. A single in-flight flag coalesces dispatches: the background
/// loop only paces the applies, so the panel updates at whatever cadence the
/// main thread can actually paint with effectively zero sampling lag, and
/// there is no fixed-interval throttle to beat against the display refresh.
#[cfg(target_os = "macos")]
pub(super) fn perform_pet_panel_drag(
    app: &AppHandle,
    window: &WebviewWindow,
    _start_client_x: f64,
    _start_client_y: f64,
    pickup_delay_ms: u64,
    _mouse_down: Option<PetPanelMouseDownAnchor>,
    lease: &PetDragLease,
) -> Result<PetPanelDragOutcome, String> {
    use objc2_app_kit::{NSEvent, NSWindow};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc::sync_channel;
    use std::sync::Arc;

    #[link(name = "ApplicationServices", kind = "framework")]
    unsafe extern "C" {
        fn CGEventSourceButtonState(state_id: u32, button: u32) -> bool;
    }

    const COMBINED_SESSION_STATE: u32 = 0;
    const LEFT_MOUSE_BUTTON: u32 = 0;
    const MAIN_THREAD_TIMEOUT: Duration = Duration::from_millis(250);

    lease.ensure_current()?;
    let start_pointer = app.cursor_position().map_err(|error| error.to_string())?;
    let scale_factor = window.scale_factor().map_err(|error| error.to_string())?;
    let gesture_started = Instant::now();
    let mut shake_detector = PetShakeDetector::default();
    shake_detector.observe(
        0,
        start_pointer.x / scale_factor,
        start_pointer.y / scale_factor,
    );

    // Capture the authored point being held, using Cocoa global points on the
    // main thread. It remains the same point after pet scale or DPI changes.
    let anchor = {
        let (sender, receiver) = sync_channel(1);
        let window_for_anchor = window.clone();
        let anchor_lease = lease.clone();
        app.run_on_main_thread(crate::panic_guard::contained("pet_panel::perform_pet_panel_drag", move || {
            let result = (|| {
                anchor_lease.ensure_current().ok()?;
                let ptr = window_for_anchor.ns_window().ok()?;
                // SAFETY: Tauri retains this NSWindow and the block runs on
                // AppKit's main thread.
                let ns_window: &NSWindow = unsafe { &*ptr.cast::<NSWindow>() };
                let content = ns_window.contentRectForFrameRect(ns_window.frame());
                let mouse = NSEvent::mouseLocation();
                let point = current_pet_render_geometry().canonical_point_at_window((
                    mouse.x - content.origin.x,
                    content.origin.y + content.size.height - mouse.y,
                ));
                super::pet_mode::set_pet_drag_grab_point(&anchor_lease, point).ok()?;
                Some(point)
            })();
            let _ = sender.send(result);
        }))
        .map_err(|error| error.to_string())?;
        receiver
            .recv_timeout(MAIN_THREAD_TIMEOUT)
            .map_err(|_| "Pet Mode drag anchor capture timed out".to_string())?
            .ok_or_else(|| "Pet Mode drag anchor is unavailable".to_string())?
    };
    let canonical_grab = anchor;

    // Coalesce main-thread applies: at most one block is queued at a time, so
    // a busy main thread never accumulates a backlog of stale positions.
    let apply_in_flight = Arc::new(AtomicBool::new(false));
    let dispatch_apply = |wait_for_completion: bool| -> Result<(), String> {
        if apply_in_flight
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return Ok(());
        }
        let flag = Arc::clone(&apply_in_flight);
        let window_for_apply = window.clone();
        let apply_lease = lease.clone();
        let completion = if wait_for_completion {
            Some(sync_channel::<()>(1))
        } else {
            None
        };
        let completion_sender = completion.as_ref().map(|(sender, _)| sender.clone());
        app.run_on_main_thread(crate::panic_guard::contained("pet_panel::perform_pet_panel_drag", move || {
            if let Some(ptr) = apply_lease.ensure_current().ok().and_then(|_| window_for_apply.ns_window().ok()) {
                // SAFETY: Tauri retains this NSWindow and the block runs on
                // AppKit's main thread.
                let ns_window: &NSWindow = unsafe { &*ptr.cast::<NSWindow>() };
                let mouse = NSEvent::mouseLocation();
                let frame = ns_window.frame();
                let content = ns_window.contentRectForFrameRect(frame);
                let point = current_pet_render_geometry().window_point_for_canonical(canonical_grab);
                let x = mouse.x - point.0 + frame.origin.x - content.origin.x;
                let y = mouse.y - (content.size.height - point.1) + frame.origin.y - content.origin.y;
                let current = frame.origin;
                // Skip no-op moves so a stationary held pointer does not spam
                // AppKit with redundant frame notifications.
                if (x - current.x).abs() >= 0.01 || (y - current.y).abs() >= 0.01 {
                    ns_window.setFrameOrigin(objc2_foundation::NSPoint::new(x, y));
                }
            }
            flag.store(false, Ordering::Release);
            if let Some(sender) = completion_sender {
                let _ = sender.send(());
            }
        }))
        .map_err(|error| {
            apply_in_flight.store(false, Ordering::Release);
            error.to_string()
        })?;
        if let Some((_, receiver)) = completion {
            let _ = receiver.recv_timeout(MAIN_THREAD_TIMEOUT);
        }
        Ok(())
    };

    let mut gesture = PetPanelGestureState::Pending;
    let mut pickup_started_at: Option<Instant> = None;
    let pickup_delay = Duration::from_millis(pickup_delay_ms.min(500));
    let mut last_probe_at = Instant::now();

    loop {
        lease.ensure_current()?;
        let pointer = app.cursor_position().map_err(|error| error.to_string())?;
        shake_detector.observe(
            gesture_started.elapsed().as_millis().min(u64::MAX as u128) as u64,
            pointer.x / scale_factor,
            pointer.y / scale_factor,
        );
        let dx = pointer.x - start_pointer.x;
        let dy = pointer.y - start_pointer.y;
        let elapsed_ms = gesture_started.elapsed().as_millis().min(u64::MAX as u128) as u64;
        let samples: Vec<_> = shake_detector.samples.iter().copied().collect();
        let stroking = pet_stroke_detected(&samples);
        match gesture.observe(elapsed_ms, dx, dy, stroking) {
            Some(PetPanelGestureEvent::StrokeDetected) => {
                // A stroke may take over while only the pickup artwork is
                // visible. Clear its clock so this press can never begin moving
                // the panel on a later loop iteration.
                pickup_started_at = None;
                emit_pet_drag_event(window, lease, "pet-mode-stroke-detected", true)?;
            }
            Some(PetPanelGestureEvent::DragStarted) => {
                pickup_started_at = Some(Instant::now());
                // A press remains a normal petting tap until physical pointer
                // movement crosses this threshold. Emitting at that exact
                // boundary prevents a click from flashing the held sprite,
                // while the native pickup hold below gives WebKit time to paint
                // it before the panel starts following the cursor.
                emit_pet_drag_event(window, lease, "pet-mode-drag-start", true)?;
            }
            None => {}
        }
        let pickup_finished =
            pickup_started_at.is_some_and(|started_at| started_at.elapsed() >= pickup_delay);
        if pickup_finished {
            // Crossing this boundary is irreversible for the current press.
            // A later back-and-forth belongs to the shipped shake gesture, not
            // to petting, because the cat is already following the pointer.
            gesture.begin_following_pointer();
        }
        if gesture == PetPanelGestureState::Dragging {
            dispatch_apply(false)?;
            if last_probe_at.elapsed() >= Duration::from_millis(40) {
                last_probe_at = Instant::now();
                if let Ok(pos) = current_pet_logical_position(window) {
                    if let Ok(plan) = probe_pet_drop_plan(app, window, pos, false) {
                        let _ = emit_pet_drag_event(window, lease, "pet-mode-drag-probe", &plan);
                    }
                }
            }
        }
        // SAFETY: CGEventSourceButtonState is a process-independent CoreGraphics
        // query and accepts the documented combined-session/left-button enum
        // values. Unlike AppKit window APIs, it is safe to poll off-main-thread.
        let pressed =
            unsafe { CGEventSourceButtonState(COMBINED_SESSION_STATE, LEFT_MOUSE_BUTTON) };
        if !pressed {
            // A fast real drag may finish before the visual pickup hold. Keep
            // its full pointer delta instead of degrading it into a click.
            if gesture.moved() {
                gesture.begin_following_pointer();
                // Drain any in-flight coalesced apply so the waiting settle
                // below is guaranteed to be dispatched, not skipped.
                let drain_deadline = Instant::now() + MAIN_THREAD_TIMEOUT;
                while apply_in_flight.load(Ordering::Acquire) && Instant::now() < drain_deadline {
                    std::thread::sleep(Duration::from_millis(1));
                }
                // Final settle: wait for the apply so the mouse-up position is
                // committed before the command reports the end coordinates.
                lease.ensure_current()?;
                dispatch_apply(true)?;
            }
            break;
        }
        std::thread::sleep(Duration::from_millis(4));
    }

    Ok(PetPanelDragOutcome {
        moved: gesture.moved(),
        shake_detected: gesture.moved() && shake_detector.detected(),
        stroke_detected: gesture.stroke_detected(),
    })
}

/// Track the real pointer on Windows so a press can still resolve as petting.
///
/// `start_dragging` hands the whole gesture to the window manager and cannot
/// report whether the pointer ever moved, so it had to claim `moved: true` for
/// every press. The renderer treats that as a relocation, which meant a plain
/// click could never reach the tap reaction. This mirrors the macOS loop
/// instead: poll the physical cursor, drive the same shared state machine, and
/// only start following the pointer once the press is classified as a drag.
#[cfg(target_os = "windows")]
pub(super) fn perform_pet_panel_drag(
    app: &AppHandle,
    window: &WebviewWindow,
    _start_client_x: f64,
    _start_client_y: f64,
    pickup_delay_ms: u64,
    mouse_down: Option<PetPanelMouseDownAnchor>,
    lease: &PetDragLease,
) -> Result<PetPanelDragOutcome, String> {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc::sync_channel;
    use std::sync::Arc;
    use tauri::PhysicalPosition;

    const MAIN_THREAD_TIMEOUT: Duration = Duration::from_millis(250);
    // Touch and pen produce a webview pointerdown that never sets a mouse
    // button, so an unheld press must resolve as a tap instead of spinning
    // this worker forever. An explicit mouse down can already be released
    // before IPC and the worker queue finish; its immutable anchor proves it.
    // Absolute stop for a button-up edge this process never observes, such as
    // a session lock mid-gesture. Far longer than any deliberate drag.
    const MAX_GESTURE_DURATION: Duration = Duration::from_secs(120);

    let explicit_mouse = mouse_down.is_some();
    let (start_pointer, scale_factor) = if let Some(anchor) = mouse_down {
        (PhysicalPosition::new(anchor.physical_down.0, anchor.physical_down.1), anchor.dpi)
    } else {
        (
            super::pet_cursor_windows::cursor_position()?,
            window.scale_factor().map_err(|error| error.to_string())?,
        )
    };
    let gesture_started = Instant::now();
    let mut shake_detector = PetShakeDetector::default();
    shake_detector.observe(
        0,
        start_pointer.x / scale_factor,
        start_pointer.y / scale_factor,
    );

    // Keep the grabbed scene point attached when the window changes DPI.
    // Both the body and its transparent offset scale with the current monitor.
    let grab_lease = lease.clone();
    let canonical_grab = super::pet_mode::run_pet_native_transaction(window, "pet_panel::capture_windows_grab", move |window| {
        grab_lease.ensure_current()?;
        let point = if let Some(anchor) = mouse_down {
            anchor.canonical_grab
        } else {
            let pointer = super::pet_cursor_windows::cursor_position()?;
            let origin = window.outer_position().map_err(|error| error.to_string())?;
            let dpi = window.scale_factor().map_err(|error| error.to_string())?;
            current_pet_render_geometry().canonical_point_at_window((
                (pointer.x - origin.x as f64) / dpi,
                (pointer.y - origin.y as f64) / dpi,
            ))
        };
        super::pet_mode::set_pet_drag_grab_point(&grab_lease, point)?;
        Ok(point)
    })?;

    // Coalesce main-thread applies: at most one move is queued at a time, so a
    // busy main thread never accumulates a backlog of stale positions.
    let apply_in_flight = Arc::new(AtomicBool::new(false));
    let dispatch_apply = |wait_for_completion: bool| -> Result<(), String> {
        if apply_in_flight
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return Ok(());
        }
        let flag = Arc::clone(&apply_in_flight);
        let window_for_apply = window.clone();
        let apply_lease = lease.clone();
        let completion = if wait_for_completion {
            Some(sync_channel::<()>(1))
        } else {
            None
        };
        let completion_sender = completion.as_ref().map(|(sender, _)| sender.clone());
        app.run_on_main_thread(crate::panic_guard::contained("pet_panel::perform_pet_panel_drag", move || {
            // Sample the freshest cursor inside the apply so the panel lands on
            // the current pointer rather than the position that queued it.
            if let Some(mouse) = apply_lease.ensure_current().ok().and_then(|_| super::pet_cursor_windows::cursor_position().ok()) {
                let dpi = window_for_apply.scale_factor().unwrap_or(scale_factor);
                let offset = current_pet_render_geometry().window_point_for_canonical(canonical_grab);
                let (x, y) = pet_drag_origin_at_dpi(offset, (mouse.x, mouse.y), dpi);
                if x.is_finite() && y.is_finite() {
                    let target = PhysicalPosition::new(x.round() as i32, y.round() as i32);
                    // Skip no-op moves so a stationary held pointer does not
                    // spam the window with redundant position changes.
                    let changed = window_for_apply.outer_position().map_or(true, |current| {
                        current.x != target.x || current.y != target.y
                    });
                    if changed {
                        let _ = window_for_apply.set_position(target);
                    }
                }
            }
            flag.store(false, Ordering::Release);
            if let Some(sender) = completion_sender {
                let _ = sender.send(());
            }
        }))
        .map_err(|error| {
            apply_in_flight.store(false, Ordering::Release);
            error.to_string()
        })?;
        if let Some((_, receiver)) = completion {
            let _ = receiver.recv_timeout(MAIN_THREAD_TIMEOUT);
        }
        Ok(())
    };

    let mut gesture = PetPanelGestureState::Pending;
    let mut pickup_started_at: Option<Instant> = None;
    let pickup_delay = Duration::from_millis(pickup_delay_ms.min(500));
    let mut last_probe_at = Instant::now();
    let mut observed_button_held = false;

    loop {
        lease.ensure_current()?;
        let pointer = super::pet_cursor_windows::cursor_position()?;
        let elapsed_ms = gesture_started.elapsed().as_millis().min(u64::MAX as u128) as u64;
        shake_detector.observe(
            elapsed_ms,
            pointer.x / scale_factor,
            pointer.y / scale_factor,
        );
        let dx = pointer.x - start_pointer.x;
        let dy = pointer.y - start_pointer.y;
        let samples: Vec<_> = shake_detector.samples.iter().copied().collect();
        let stroking = pet_stroke_detected(&samples);
        let pointer_state = super::pet_cursor_windows::primary_pointer_state();
        match gesture.observe_windows_press(elapsed_ms, dx, dy, stroking, pointer_state.cancelled) {
            Some(PetPanelGestureEvent::StrokeDetected) => {
                // A stroke may take over while only the pickup artwork shows.
                // Clear its clock so this press can never begin moving the
                // panel on a later loop iteration.
                pickup_started_at = None;
                emit_pet_drag_event(window, lease, "pet-mode-stroke-detected", true)?;
            }
            Some(PetPanelGestureEvent::DragStarted) => {
                pickup_started_at = Some(Instant::now());
                // A press stays a normal petting tap until physical movement
                // crosses the threshold. Emitting at that exact boundary keeps
                // a click from flashing the held sprite, while the pickup hold
                // below gives the webview time to paint it before the panel
                // starts following the cursor.
                emit_pet_drag_event(window, lease, "pet-mode-drag-start", true)?;
            }
            None => {}
        }
        if pickup_started_at.is_some_and(|started_at| started_at.elapsed() >= pickup_delay) {
            // Crossing this boundary is irreversible for the current press. A
            // later back-and-forth belongs to the shipped shake gesture, not to
            // petting, because the cat is already following the pointer.
            gesture.begin_following_pointer();
        }
        if gesture == PetPanelGestureState::Dragging {
            dispatch_apply(false)?;
            if last_probe_at.elapsed() >= Duration::from_millis(40) {
                last_probe_at = Instant::now();
                if let Ok(pos) = current_pet_logical_position(window) {
                    if let Ok(plan) = probe_pet_drop_plan(app, window, pos, false) {
                        let _ = emit_pet_drag_event(window, lease, "pet-mode-drag-probe", &plan);
                    }
                }
            }
        }

        observed_button_held |= pointer_state.held;
        let press_end = pet_windows_press_end(
            pointer_state.held,
            pointer_state.cancelled,
            observed_button_held,
            elapsed_ms,
            explicit_mouse,
        );
        if press_end.is_some() || gesture_started.elapsed() >= MAX_GESTURE_DURATION {
            if press_end.is_some_and(|end| {
                gesture.finish_mouse_press(explicit_mouse, dx, dy, end).is_some()
            }) {
                emit_pet_drag_event(window, lease, "pet-mode-drag-start", true)?;
            }
            // A fast real drag can finish before the visual pickup hold. Keep
            // its full pointer delta instead of degrading it into a click.
            if gesture.moved() {
                gesture.begin_following_pointer();
                // Drain any in-flight coalesced apply so the settle below is
                // guaranteed to be dispatched rather than skipped.
                let drain_deadline = Instant::now() + MAIN_THREAD_TIMEOUT;
                while apply_in_flight.load(Ordering::Acquire) && Instant::now() < drain_deadline {
                    std::thread::sleep(Duration::from_millis(1));
                }
                // Final settle: wait for the apply so the release position is
                // committed before the command reports the end coordinates.
                lease.ensure_current()?;
                dispatch_apply(true)?;
            }
            break;
        }
        std::thread::sleep(Duration::from_millis(4));
    }

    Ok(PetPanelDragOutcome {
        moved: gesture.moved(),
        shake_detected: gesture.moved() && shake_detector.detected(),
        stroke_detected: gesture.stroke_detected(),
    })
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub(super) fn perform_pet_panel_drag(
    _app: &AppHandle,
    window: &WebviewWindow,
    _start_client_x: f64,
    _start_client_y: f64,
    _pickup_delay_ms: u64,
    _mouse_down: Option<PetPanelMouseDownAnchor>,
    lease: &PetDragLease,
) -> Result<PetPanelDragOutcome, String> {
    lease.ensure_current()?;
    window.start_dragging().map_err(|error| error.to_string())?;
    Ok(PetPanelDragOutcome {
        moved: true,
        shake_detected: false,
        stroke_detected: false,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        is_pet_drag_delta, pet_drag_origin_at_dpi, pet_mouse_down_anchor, pet_stroke_detected,
        pet_windows_press_end, PetPanelGestureEvent, PetPanelGestureState, PetPanelPressEnd,
        PetShakeDetector, PetShakeSample,
    };
    #[cfg(target_os = "macos")]
    use super::{pet_panel_native_origin_after_logical_move, pet_panel_needs_main_thread_hop};

    fn observe_path(detector: &mut PetShakeDetector, points: &[(u64, f64, f64)]) {
        for &(at_ms, x, y) in points {
            detector.observe(at_ms, x, y);
        }
    }

    #[test]
    fn native_drag_preserves_the_exact_pointer_delta_at_a_fixed_dpi() {
        let grab = (10.0 - (-1884.0), 20.0 - (-406.0));
        let (x, y) = pet_drag_origin_at_dpi(grab, (142.2, 76.4), 1.0);
        assert!((x - (-1751.8)).abs() < 1e-9);
        assert!((y - (-349.6)).abs() < 1e-9);
    }

    #[test]
    fn mixed_dpi_drag_keeps_the_same_authored_point_under_the_pointer() {
        // The grab includes both rendering padding and the body-local point.
        // Origins remain physical screen coordinates, including negatives.
        let grab = (18.0 + 50.0, 64.0 + 40.0);
        for dpi in [1.0, 1.25, 1.5, 1.75, 2.0] {
            let mouse = (-1840.25, 100.75);
            let origin = pet_drag_origin_at_dpi(grab, mouse, dpi);
            assert!((origin.0 + grab.0 * dpi - mouse.0).abs() < 1e-9);
            assert!((origin.1 + grab.1 * dpi - mouse.1).abs() < 1e-9);
        }
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

    #[test]
    fn late_mouse_worker_keeps_the_down_anchor_and_settles_the_full_completed_drag() {
        let geometry = super::super::pet_render_geometry::pet_render_layout().geometry(180.0);
        let origin = (-1840.0, -67.0);
        let client = geometry.window_point_for_canonical((50.0, 40.0));
        let anchor = pet_mouse_down_anchor(Some("mouse"), client, origin, 1.5, geometry)
            .unwrap()
            .unwrap();
        // IPC finishes after both movement and button-up. The endpoint must
        // never replace the original down point as the delta/grab baseline.
        let endpoint = (anchor.physical_down.0 + 90.0, anchor.physical_down.1 + 45.0);
        let mut gesture = PetPanelGestureState::Pending;
        assert_eq!(gesture.observe(0, 90.0, 45.0, false), None);
        let end = pet_windows_press_end(false, false, false, 0, true).unwrap();
        assert_eq!(end, PetPanelPressEnd::Released);
        assert_eq!(
            gesture.finish_mouse_press(true, 90.0, 45.0, end),
            Some(PetPanelGestureEvent::DragStarted)
        );
        gesture.begin_following_pointer();
        assert!(gesture.moved());
        let settled = pet_drag_origin_at_dpi(
            geometry.window_point_for_canonical(anchor.canonical_grab),
            endpoint,
            1.5,
        );
        assert!((settled.0 - (origin.0 + 90.0)).abs() < 1e-9);
        assert!((settled.1 - (origin.1 + 45.0)).abs() < 1e-9);
    }

    #[test]
    fn a_completed_mouse_drag_crosses_the_threshold_without_skipping_held_stroke_grace() {
        for (dx, dy, moved) in [
            (0.0, 0.0, false),
            (6.99, 0.0, false),
            (7.0, 0.0, true),
            (5.0, 5.0, true),
        ] {
            let mut gesture = PetPanelGestureState::Pending;
            assert_eq!(gesture.observe(120, dx, dy, false), None);
            assert!(!gesture.moved());
            assert!(pet_windows_press_end(true, false, true, 120, true).is_none());
            assert_eq!(
                gesture
                    .finish_mouse_press(true, dx, dy, PetPanelPressEnd::Released)
                    .is_some(),
                moved
            );
            assert_eq!(gesture.moved(), moved);
        }
        let mut held = PetPanelGestureState::Pending;
        assert_eq!(held.observe(219, 20.0, 0.0, false), None);
        assert_eq!(
            held.observe(220, 20.0, 0.0, false),
            Some(PetPanelGestureEvent::DragStarted)
        );
        assert_eq!(held, PetPanelGestureState::DragPickup);
        // Pickup remains a separate boundary; only the existing visual hold
        // or final release can begin following the pointer.
        assert_ne!(held, PetPanelGestureState::Dragging);
    }

    #[test]
    fn completed_mouse_release_cannot_reclassify_an_established_stroke() {
        let mut gesture = PetPanelGestureState::Pending;
        assert_eq!(
            gesture.observe(80, 10.0, 0.0, true),
            Some(PetPanelGestureEvent::StrokeDetected)
        );
        assert_eq!(
            gesture.finish_mouse_press(true, 30.0, 20.0, PetPanelPressEnd::Released),
            None
        );
        gesture.begin_following_pointer();
        assert!(gesture.stroke_detected());
        assert!(!gesture.moved());
    }

    #[test]
    fn touch_pen_and_older_callers_do_not_invent_a_completed_mouse_drag() {
        let geometry = super::super::pet_render_geometry::pet_render_layout().geometry(144.0);
        for pointer_type in [None, Some("touch"), Some("pen"), Some(""), Some("unknown")] {
            let anchor =
                pet_mouse_down_anchor(pointer_type, (30.0, 60.0), (100.0, 200.0), 1.5, geometry)
                    .unwrap();
            assert!(anchor.is_none());
            let mut gesture = PetPanelGestureState::Pending;
            assert_eq!(gesture.observe(120, 90.0, 45.0, false), None);
            assert!(pet_windows_press_end(false, false, false, 120, anchor.is_some()).is_none());
            assert!(pet_windows_press_end(false, false, false, 250, anchor.is_some()).is_some());
            assert_eq!(
                gesture.finish_mouse_press(
                    anchor.is_some(),
                    90.0,
                    45.0,
                    PetPanelPressEnd::Released
                ),
                None
            );
            assert!(!gesture.moved());
        }
        // The old caller's observed native mouse latch still resolves on up.
        assert!(pet_windows_press_end(false, false, true, 20, false).is_some());
    }

    #[test]
    fn escape_cancels_a_pending_mouse_press_without_turning_its_delta_into_relocation() {
        for elapsed_ms in [40, 240] {
            let mut gesture = PetPanelGestureState::Pending;
            assert_eq!(
                gesture.observe_windows_press(elapsed_ms, 90.0, 45.0, false, true),
                None
            );
            let end = pet_windows_press_end(false, true, true, elapsed_ms, true).unwrap();
            assert_eq!(end, PetPanelPressEnd::Cancelled);
            assert_eq!(gesture.finish_mouse_press(true, 90.0, 45.0, end), None);
            gesture.begin_following_pointer();
            assert!(!gesture.moved());
            assert!(!gesture.stroke_detected());
        }
        // An actual button-up, with no Escape, still completes a short drag.
        let mut released = PetPanelGestureState::Pending;
        assert_eq!(
            released.observe_windows_press(40, 90.0, 45.0, false, false),
            None
        );
        let end = pet_windows_press_end(false, false, true, 40, true).unwrap();
        assert_eq!(
            released.finish_mouse_press(true, 90.0, 45.0, end),
            Some(PetPanelGestureEvent::DragStarted)
        );
        assert!(released.moved());
    }

    #[test]
    fn mouse_down_anchor_survives_scale_dpi_and_dance_origin_changes() {
        for pet_scale in [0.5, 1.0, 1.25] {
            let geometry =
                super::super::pet_render_geometry::pet_render_layout().geometry(144.0 * pet_scale);
            for dpi in [1.0, 1.25, 1.5, 1.75, 2.0] {
                let before_restore = (-1840.0, 60.0);
                let client = geometry.window_point_for_canonical((50.0, 40.0));
                let anchor =
                    pet_mouse_down_anchor(Some("mouse"), client, before_restore, dpi, geometry)
                        .unwrap()
                        .unwrap();
                // Restoring dance headroom moves the window, not the pointer.
                let restored_origin = (before_restore.0, before_restore.1 - 60.0);
                let stationary_pointer = anchor.physical_down;
                let mut gesture = PetPanelGestureState::Pending;
                assert_eq!(
                    gesture.finish_mouse_press(
                        true,
                        stationary_pointer.0 - anchor.physical_down.0,
                        stationary_pointer.1 - anchor.physical_down.1,
                        PetPanelPressEnd::Released,
                    ),
                    None
                );
                assert!(!gesture.moved());
                assert_ne!(restored_origin.1, before_restore.1);
                for new_dpi in [1.0, 1.75] {
                    let new_geometry =
                        super::super::pet_render_geometry::pet_render_layout().geometry(108.0);
                    let endpoint = (anchor.physical_down.0 + 30.0, anchor.physical_down.1 + 15.0);
                    let offset = new_geometry.window_point_for_canonical(anchor.canonical_grab);
                    let settled = pet_drag_origin_at_dpi(offset, endpoint, new_dpi);
                    assert!((settled.0 + offset.0 * new_dpi - endpoint.0).abs() < 1e-9);
                    assert!((settled.1 + offset.1 * new_dpi - endpoint.1).abs() < 1e-9);
                }
            }
        }
    }

    #[test]
    fn invalid_explicit_mouse_anchor_fails_instead_of_fabricating_a_delta() {
        let geometry = super::super::pet_render_geometry::pet_render_layout().geometry(180.0);
        for client in [
            (f64::NAN, 30.0),
            (20.0, f64::INFINITY),
            (-0.01, 0.0),
            (geometry.render_width + 0.01, 30.0),
            (20.0, geometry.render_height + 0.01),
        ] {
            assert!(
                pet_mouse_down_anchor(Some("mouse"), client, (100.0, 200.0), 1.5, geometry)
                    .is_err()
            );
        }
        for dpi in [0.0, -1.0, f64::NAN, f64::INFINITY] {
            assert!(pet_mouse_down_anchor(
                Some("mouse"),
                (30.0, 60.0),
                (100.0, 200.0),
                dpi,
                geometry
            )
            .is_err());
        }
        assert!(pet_mouse_down_anchor(
            Some("mouse"),
            (30.0, 60.0),
            (f64::INFINITY, 200.0),
            1.5,
            geometry
        )
        .is_err());
        // The full render envelope includes valid decoration/tall-pose points
        // outside the 144x99 authored body rectangle. Do not clamp those away.
        let top = pet_mouse_down_anchor(Some("mouse"), (30.0, 0.0), (100.0, 200.0), 1.5, geometry)
            .unwrap()
            .unwrap();
        assert!(top.canonical_grab.1 < 0.0);
    }

    #[test]
    fn a_press_that_never_crosses_the_threshold_reports_no_movement() {
        // The Windows path used to hand the whole gesture to the window
        // manager, which cannot report pointer movement, so it claimed
        // `moved: true` for every press and a plain click could never reach
        // the tap reaction. Every platform now derives the outcome from this
        // state machine, where an unmoved press stays unmoved.
        let mut gesture = PetPanelGestureState::Pending;
        for elapsed_ms in [0, 120, 240, 600] {
            assert_eq!(gesture.observe(elapsed_ms, 2.0, 1.0, false), None);
        }
        // The release path promotes a pending pickup before reporting. That
        // promotion must not invent movement for a press that never had any.
        gesture.begin_following_pointer();
        assert!(!gesture.moved());
        assert!(!gesture.stroke_detected());
    }

    #[test]
    fn a_late_stroke_can_cancel_pickup_before_the_panel_moves() {
        let mut gesture = PetPanelGestureState::Pending;

        assert_eq!(
            gesture.observe(221, 12.0, 0.0, false),
            Some(PetPanelGestureEvent::DragStarted)
        );
        assert_eq!(gesture, PetPanelGestureState::DragPickup);
        assert_eq!(
            gesture.observe(240, 1.0, 0.0, true),
            Some(PetPanelGestureEvent::StrokeDetected)
        );
        assert_eq!(gesture, PetPanelGestureState::Stroke);
        assert!(!gesture.moved());
        assert!(gesture.stroke_detected());
    }

    #[test]
    fn a_stroke_cannot_take_over_after_the_panel_follows_the_pointer() {
        let mut gesture = PetPanelGestureState::Pending;

        assert_eq!(
            gesture.observe(221, 12.0, 0.0, false),
            Some(PetPanelGestureEvent::DragStarted)
        );
        gesture.begin_following_pointer();
        assert_eq!(gesture, PetPanelGestureState::Dragging);
        assert_eq!(gesture.observe(480, 0.0, 0.0, true), None);
        assert_eq!(gesture, PetPanelGestureState::Dragging);
        assert!(gesture.moved());
        assert!(!gesture.stroke_detected());
    }

    #[test]
    fn a_shake_stays_a_drag_when_its_path_later_matches_a_stroke() {
        let mut detector = PetShakeDetector::default();
        let mut gesture = PetPanelGestureState::Pending;
        for &(at_ms, x, y) in &[(0, 0.0, 0.0), (100, 30.0, 0.0), (220, 80.0, 0.0)] {
            detector.observe(at_ms, x, y);
            let samples: Vec<_> = detector.samples.iter().copied().collect();
            let event = gesture.observe(at_ms, x, y, pet_stroke_detected(&samples));
            if event == Some(PetPanelGestureEvent::DragStarted) {
                gesture.begin_following_pointer();
            }
        }

        assert_eq!(gesture, PetPanelGestureState::Dragging);

        let mut matched_stroke_shape = false;
        for step in 1..=50 {
            let at_ms = 220 + step * 120;
            let x = if step % 2 == 0 { 80.0 } else { 130.0 };
            detector.observe(at_ms, x, 0.0);
            let samples: Vec<_> = detector.samples.iter().copied().collect();
            let stroking = pet_stroke_detected(&samples);
            matched_stroke_shape |= stroking;
            assert_eq!(gesture.observe(at_ms, x, 0.0, stroking), None);
        }

        assert_eq!(gesture, PetPanelGestureState::Dragging);
        assert!(gesture.moved());
        assert!(!gesture.stroke_detected());
        assert!(matched_stroke_shape);
        assert!(detector.detected());
    }

    #[test]
    fn straight_or_jittery_drags_do_not_count_as_a_shake() {
        let mut straight = PetShakeDetector::default();
        observe_path(
            &mut straight,
            &[
                (0, 0.0, 0.0),
                (100, 60.0, 0.0),
                (200, 120.0, 0.0),
                (300, 240.0, 0.0),
            ],
        );
        assert!(!straight.detected());

        let mut jitter = PetShakeDetector::default();
        observe_path(
            &mut jitter,
            &[
                (0, 0.0, 0.0),
                (100, 5.0, 3.0),
                (200, -4.0, -2.0),
                (300, 6.0, 1.0),
                (400, -5.0, 0.0),
            ],
        );
        assert!(!jitter.detected());
    }

    #[test]
    fn repeated_recent_horizontal_or_vertical_swings_count_as_a_shake() {
        let mut horizontal = PetShakeDetector::default();
        observe_path(
            &mut horizontal,
            &[
                (0, 0.0, 0.0),
                (120, 50.0, 0.0),
                (240, 0.0, 0.0),
                (360, 50.0, 0.0),
                (480, 0.0, 0.0),
                (600, 50.0, 0.0),
            ],
        );
        assert!(horizontal.detected());

        let mut vertical = PetShakeDetector::default();
        observe_path(
            &mut vertical,
            &[
                (0, 0.0, 0.0),
                (120, 0.0, 50.0),
                (240, 0.0, 0.0),
                (360, 0.0, 50.0),
                (480, 0.0, 0.0),
                (600, 0.0, 50.0),
            ],
        );
        assert!(vertical.detected());
    }

    #[test]
    fn shake_thresholds_are_inclusive_but_do_not_accept_a_near_miss() {
        let mut exact = PetShakeDetector::default();
        observe_path(
            &mut exact,
            &[
                (0, 0.0, 0.0),
                (100, 44.0, 0.0),
                (200, 0.0, 0.0),
                (300, 44.0, 0.0),
                (400, 0.0, 0.0),
                (500, 44.0, 0.0),
            ],
        );
        assert!(exact.detected());

        let mut short_path = PetShakeDetector::default();
        observe_path(
            &mut short_path,
            &[
                (0, 0.0, 0.0),
                (100, 43.9, 0.0),
                (200, 0.0, 0.0),
                (300, 43.9, 0.0),
                (400, 0.0, 0.0),
                (500, 43.9, 0.0),
            ],
        );
        assert!(!short_path.detected());
    }

    #[test]
    fn long_travel_with_only_three_reversals_is_not_a_shake() {
        let mut detector = PetShakeDetector::default();
        observe_path(
            &mut detector,
            &[
                (0, 0.0, 0.0),
                (100, 60.0, 0.0),
                (200, 0.0, 0.0),
                (300, 60.0, 0.0),
                (400, 0.0, 0.0),
                (500, 10.0, 0.0),
            ],
        );
        assert!(!detector.detected());
    }

    #[test]
    fn a_shake_expires_when_the_user_holds_still_before_release() {
        let mut detector = PetShakeDetector::default();
        observe_path(
            &mut detector,
            &[
                (0, 0.0, 0.0),
                (120, 50.0, 0.0),
                (240, 0.0, 0.0),
                (360, 50.0, 0.0),
                (480, 0.0, 0.0),
                (600, 50.0, 0.0),
            ],
        );
        assert!(detector.detected());
        detector.observe(1_700, 50.0, 0.0);
        assert!(!detector.detected());
    }

    #[test]
    fn a_short_back_and_forth_on_the_cat_counts_as_a_stroke() {
        let samples = [
            PetShakeSample { at_ms: 0, x: 0.0, y: 0.0 },
            PetShakeSample { at_ms: 80, x: 12.0, y: 1.0 },
            PetShakeSample { at_ms: 160, x: 0.0, y: 0.0 },
            PetShakeSample { at_ms: 240, x: 12.0, y: -1.0 },
            PetShakeSample { at_ms: 320, x: 1.0, y: 0.0 },
        ];
        assert!(pet_stroke_detected(&samples));
    }

    #[test]
    fn a_relocating_drag_is_not_a_stroke() {
        let samples = [
            PetShakeSample { at_ms: 0, x: 0.0, y: 0.0 },
            PetShakeSample { at_ms: 80, x: 12.0, y: 0.0 },
            PetShakeSample { at_ms: 160, x: 0.0, y: 0.0 },
            PetShakeSample { at_ms: 240, x: 12.0, y: 0.0 },
            PetShakeSample { at_ms: 320, x: 40.0, y: 8.0 },
        ];
        assert!(!pet_stroke_detected(&samples));
    }

    #[test]
    fn a_late_reverse_still_counts_as_a_stroke() {
        let samples = [
            PetShakeSample { at_ms: 0, x: 0.0, y: 0.0 },
            PetShakeSample { at_ms: 60, x: 10.0, y: 0.0 },
            PetShakeSample { at_ms: 120, x: 0.0, y: 0.0 },
            PetShakeSample { at_ms: 180, x: 10.0, y: 0.0 },
            PetShakeSample { at_ms: 240, x: 1.0, y: 0.0 },
        ];
        assert!(pet_stroke_detected(&samples));
    }

    #[test]
    fn a_recent_window_that_ends_far_from_its_start_is_not_a_stroke() {
        let samples = [
            PetShakeSample { at_ms: 0, x: 0.0, y: 0.0 },
            PetShakeSample { at_ms: 80, x: 12.0, y: 0.0 },
            PetShakeSample { at_ms: 160, x: 0.0, y: 0.0 },
            PetShakeSample { at_ms: 240, x: 12.0, y: 0.0 },
            PetShakeSample { at_ms: 2_500, x: 40.0, y: 0.0 },
        ];
        assert!(!pet_stroke_detected(&samples));
    }

    #[test]
    fn a_grab_offset_stays_attached_to_the_pointer() {
        // Pointer returns to its anchor -> origin returns to its anchor.
        assert_eq!(
            pet_drag_origin_at_dpi((50.0, 20.0), (350.0, 520.0), 1.0),
            (300.0, 500.0)
        );
    }

    /// Pet Mode drives its walk animations from `spawn_blocking`, so several
    /// presentations reach this module on a tokio worker. Ordering a window in
    /// from there aborted the process with "Must only be used from the main
    /// thread", taking the menu-bar status item down with it.
    #[cfg(target_os = "macos")]
    #[test]
    fn presentation_off_the_main_thread_is_marshalled() {
        assert!(pet_panel_needs_main_thread_hop(false));
    }

    /// A presentation already on the main thread must stay synchronous:
    /// hopping would deadlock a caller that is itself the main thread.
    #[cfg(target_os = "macos")]
    #[test]
    fn presentation_on_the_main_thread_runs_directly() {
        assert!(!pet_panel_needs_main_thread_hop(true));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn positioned_presentation_converts_logical_y_to_appkit_y() {
        let origin = pet_panel_native_origin_after_logical_move(
            (-1884.0, -406.0),
            tauri::LogicalPosition::new(-1920.0, 120.0),
            tauri::LogicalPosition::new(-1700.0, 75.0),
        );

        assert_eq!(origin, Some((-1664.0, -361.0)));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn positioned_presentation_keeps_a_same_y_home_snap_on_an_external_display() {
        let origin = pet_panel_native_origin_after_logical_move(
            (-168.0, 44.0),
            tauri::LogicalPosition::new(-168.0, 44.0),
            tauri::LogicalPosition::new(-24.0, 44.0),
        );

        assert_eq!(origin, Some((-24.0, 44.0)));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn positioned_presentation_rejects_non_finite_coordinates() {
        assert_eq!(
            pet_panel_native_origin_after_logical_move(
                (-168.0, 44.0),
                tauri::LogicalPosition::new(-168.0, 44.0),
                tauri::LogicalPosition::new(f64::NAN, 44.0),
            ),
            None
        );
    }
}
