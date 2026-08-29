use std::collections::VecDeque;
use tauri::{AppHandle, Emitter, WebviewWindow};

use super::pet_mode::{current_pet_logical_position, probe_pet_drop_plan, PET_MODE_WINDOW_LABEL};

const PET_SHAKE_WINDOW_MS: u64 = 1_000;
const PET_SHAKE_MIN_SAMPLE_DISTANCE_PT: f64 = 2.0;
const PET_SHAKE_MIN_LEG_PT: f64 = 24.0;
const PET_SHAKE_MIN_PATH_PT: f64 = 220.0;
const PET_SHAKE_MIN_REVERSALS: usize = 4;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PetPanelDragOutcome {
    pub moved: bool,
    pub shake_detected: bool,
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
        meaningful_axis_reversals(&samples, |sample| sample.x) >= PET_SHAKE_MIN_REVERSALS
            || meaningful_axis_reversals(&samples, |sample| sample.y) >= PET_SHAKE_MIN_REVERSALS
    }
}

fn meaningful_axis_reversals(
    samples: &[PetShakeSample],
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
            0 if value - extreme >= PET_SHAKE_MIN_LEG_PT => {
                direction = 1;
                extreme = value;
            }
            0 if extreme - value >= PET_SHAKE_MIN_LEG_PT => {
                direction = -1;
                extreme = value;
            }
            1 if value > extreme => extreme = value,
            1 if extreme - value >= PET_SHAKE_MIN_LEG_PT => {
                reversals += 1;
                direction = -1;
                extreme = value;
            }
            -1 if value < extreme => extreme = value,
            -1 if value - extreme >= PET_SHAKE_MIN_LEG_PT => {
                reversals += 1;
                direction = 1;
                extreme = value;
            }
            _ => {}
        }
    }
    reversals
}

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
    // The versioned hit-region controller enables input only under a visible
    // cat pixel. Starting click-through prevents the transparent panel from
    // blocking the user's current app before the WebView publishes its frame.
    ns_window.setIgnoresMouseEvents(true);
    ns_window.setOpaque(false);
    ns_window.setBackgroundColor(Some(&NSColor::clearColor()));
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn configure_pet_panel(_window: &WebviewWindow) -> tauri::Result<()> {
    Ok(())
}

/// How long a marshalled presentation waits for AppKit to run the block.
/// Matches the timeout the other Pet Mode main-thread hops already use.
#[cfg(target_os = "macos")]
const PET_PANEL_MAIN_THREAD_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(250);

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
            app.run_on_main_thread(move || {
                let _ = sender.send(show_pet_panel_on_main_thread(
                    &app_for_main,
                    &window_for_main,
                ));
            })
            .map_err(|error| error.to_string())?;

            return receiver
                .recv_timeout(PET_PANEL_MAIN_THREAD_TIMEOUT)
                .map_err(|_| "Pet Mode panel presentation timed out".to_string())?;
        }
    }

    show_pet_panel_on_main_thread(app, window)
}

/// The actual presentation, always reached on the main thread.
fn show_pet_panel_on_main_thread(app: &AppHandle, window: &WebviewWindow) -> Result<(), String> {
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

use std::time::{Duration, Instant};

/// New window origin that keeps the initial grab offset attached to the
/// pointer. All values share one coordinate space; the caller feeds Cocoa
/// global points so no y-flip or scale conversion is needed.
fn pet_drag_origin(
    start_origin: (f64, f64),
    start_mouse: (f64, f64),
    mouse: (f64, f64),
) -> (f64, f64) {
    (
        start_origin.0 + (mouse.0 - start_mouse.0),
        start_origin.1 + (mouse.1 - start_mouse.1),
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
pub fn perform_pet_panel_drag(
    app: &AppHandle,
    window: &WebviewWindow,
    _start_client_x: f64,
    _start_client_y: f64,
    pickup_delay_ms: u64,
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

    let start_pointer = app.cursor_position().map_err(|error| error.to_string())?;
    let scale_factor = window.scale_factor().map_err(|error| error.to_string())?;
    let gesture_started = Instant::now();
    let mut shake_detector = PetShakeDetector::default();
    shake_detector.observe(
        0,
        start_pointer.x / scale_factor,
        start_pointer.y / scale_factor,
    );

    // Capture the drag anchor (window origin + pointer) in Cocoa global
    // points on the main thread so every later apply is a pure delta in one
    // coordinate space, exact across negative/mixed-scale display origins.
    let anchor = {
        let (sender, receiver) = sync_channel(1);
        let window_for_anchor = window.clone();
        app.run_on_main_thread(move || {
            let result = (|| {
                let ptr = window_for_anchor.ns_window().ok()?;
                // SAFETY: Tauri retains this NSWindow and the block runs on
                // AppKit's main thread.
                let ns_window: &NSWindow = unsafe { &*ptr.cast::<NSWindow>() };
                let origin = ns_window.frame().origin;
                let mouse = NSEvent::mouseLocation();
                Some(((origin.x, origin.y), (mouse.x, mouse.y)))
            })();
            let _ = sender.send(result);
        })
        .map_err(|error| error.to_string())?;
        receiver
            .recv_timeout(MAIN_THREAD_TIMEOUT)
            .map_err(|_| "Pet Mode drag anchor capture timed out".to_string())?
            .ok_or_else(|| "Pet Mode drag anchor is unavailable".to_string())?
    };
    let (anchor_origin, anchor_mouse) = anchor;

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
        let completion = if wait_for_completion {
            Some(sync_channel::<()>(1))
        } else {
            None
        };
        let completion_sender = completion.as_ref().map(|(sender, _)| sender.clone());
        app.run_on_main_thread(move || {
            if let Ok(ptr) = window_for_apply.ns_window() {
                // SAFETY: Tauri retains this NSWindow and the block runs on
                // AppKit's main thread.
                let ns_window: &NSWindow = unsafe { &*ptr.cast::<NSWindow>() };
                let mouse = NSEvent::mouseLocation();
                let (x, y) = pet_drag_origin(anchor_origin, anchor_mouse, (mouse.x, mouse.y));
                let current = ns_window.frame().origin;
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
        })
        .map_err(|error| {
            apply_in_flight.store(false, Ordering::Release);
            error.to_string()
        })?;
        if let Some((_, receiver)) = completion {
            let _ = receiver.recv_timeout(MAIN_THREAD_TIMEOUT);
        }
        Ok(())
    };

    let mut moved = false;
    let mut pickup_started_at: Option<Instant> = None;
    let pickup_delay = Duration::from_millis(pickup_delay_ms.min(500));
    let mut last_probe_at = Instant::now();

    loop {
        let pointer = app.cursor_position().map_err(|error| error.to_string())?;
        shake_detector.observe(
            gesture_started.elapsed().as_millis().min(u64::MAX as u128) as u64,
            pointer.x / scale_factor,
            pointer.y / scale_factor,
        );
        let dx = pointer.x - start_pointer.x;
        let dy = pointer.y - start_pointer.y;
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
        if pickup_finished {
            dispatch_apply(false)?;
            if last_probe_at.elapsed() >= Duration::from_millis(40) {
                last_probe_at = Instant::now();
                if let Ok(pos) = current_pet_logical_position(window) {
                    if let Ok(plan) = probe_pet_drop_plan(app, window, pos, false) {
                        let _ = window.emit("pet-mode-drag-probe", &plan);
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
            if moved {
                // Drain any in-flight coalesced apply so the waiting settle
                // below is guaranteed to be dispatched, not skipped.
                let drain_deadline = Instant::now() + MAIN_THREAD_TIMEOUT;
                while apply_in_flight.load(Ordering::Acquire) && Instant::now() < drain_deadline {
                    std::thread::sleep(Duration::from_millis(1));
                }
                // Final settle: wait for the apply so the mouse-up position is
                // committed before the command reports the end coordinates.
                dispatch_apply(true)?;
            }
            break;
        }
        std::thread::sleep(Duration::from_millis(4));
    }

    Ok(PetPanelDragOutcome {
        moved,
        shake_detected: moved && shake_detector.detected(),
    })
}

#[cfg(not(target_os = "macos"))]
pub fn perform_pet_panel_drag(
    _app: &AppHandle,
    window: &WebviewWindow,
    _start_client_x: f64,
    _start_client_y: f64,
    _pickup_delay_ms: u64,
) -> Result<PetPanelDragOutcome, String> {
    window.start_dragging().map_err(|error| error.to_string())?;
    Ok(PetPanelDragOutcome {
        moved: true,
        shake_detected: false,
    })
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "macos")]
    use super::pet_panel_needs_main_thread_hop;
    use super::{is_pet_drag_delta, pet_drag_origin, PetShakeDetector};

    fn observe_path(detector: &mut PetShakeDetector, points: &[(u64, f64, f64)]) {
        for &(at_ms, x, y) in points {
            detector.observe(at_ms, x, y);
        }
    }

    #[test]
    fn native_drag_preserves_the_exact_pointer_delta() {
        let (x, y) = pet_drag_origin((-1884.0, -406.0), (10.0, 20.0), (142.2, 76.4));
        assert!((x - (-1751.8)).abs() < 1e-9);
        assert!((y - (-349.6)).abs() < 1e-9);
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
    fn a_grab_offset_stays_attached_to_the_pointer() {
        // Pointer returns to its anchor -> origin returns to its anchor.
        assert_eq!(
            pet_drag_origin((300.0, 500.0), (350.0, 520.0), (350.0, 520.0)),
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
}
