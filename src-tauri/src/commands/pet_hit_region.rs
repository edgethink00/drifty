use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager, WebviewWindow};

use super::pet_mode::{current_pet_render_geometry, pet_geometry_transition_active, PET_MODE_WINDOW_LABEL};
#[cfg(target_os = "windows")]
use super::windows_overlay::set_windows_overlay_click_through;

const HIT_REGION_VERSION: u32 = 1;
const BASE_WIDTH: f64 = 288.0;
const BASE_HEIGHT: f64 = 198.0;
const MAX_SPAN_INTEGERS: usize = 4_096;
const MAIN_THREAD_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetModeHitRegionUpdate {
    generation: String,
    version: u32,
    region_id: String,
    revision: u64,
    mirrored: bool,
    spans: Vec<u16>,
}

#[derive(Clone, Debug, Default)]
struct HitRegionState {
    generation: String,
    version: u32,
    revision: u64,
    mirrored: bool,
    spans: Vec<u16>,
    pointer_inside: bool,
}

#[derive(Clone, Copy, Debug, Default)]
struct PressState {
    active: bool,
    owned_by_pet: bool,
}

static HIT_REGION: Mutex<HitRegionState> = Mutex::new(HitRegionState {
    version: 0,
    generation: String::new(),
    revision: 0,
    mirrored: false,
    spans: Vec::new(),
    pointer_inside: false,
});
static HIT_REGION_MONITOR_INSTALLED: AtomicBool = AtomicBool::new(false);
static HIT_REGION_NATIVE_REFRESH_PENDING: AtomicBool = AtomicBool::new(false);
static HIT_REGION_PRESS: Mutex<PressState> = Mutex::new(PressState {
    active: false,
    owned_by_pet: false,
});

/// Two memory-only observations, not a pointer history. Read-only Lab bounds
/// can compare a real native press with renderer delivery without changing the
/// input policy or dispatching synthetic events.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowsPetInputSample {
    sampled_at_ms: u64,
    scale_factor: f64,
    window_client_x: f64,
    window_client_y: f64,
    mask_revision: u64,
    mask_span_count: usize,
    mask_inside: bool,
    button_down: bool,
    interactive: bool,
    ignored_cursor_events_before_apply: Option<bool>,
    ignored_cursor_events: Option<bool>,
    policy_applied: bool,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowsPetInputDiagnostics {
    latest: Option<WindowsPetInputSample>,
    last_press: Option<WindowsPetInputSample>,
    renderer_pointer_down_count: u64,
    drag_request_count: u64,
}

#[cfg(any(target_os = "windows", test))]
impl WindowsPetInputDiagnostics {
    fn observe(&mut self, sample: WindowsPetInputSample) {
        if sample.button_down && !self.latest.as_ref().is_some_and(|last| last.button_down) {
            self.last_press = Some(sample.clone());
        }
        self.latest = Some(sample);
    }
}

#[cfg(target_os = "windows")]
static WINDOWS_INPUT_DIAGNOSTICS: Mutex<WindowsPetInputDiagnostics> =
    Mutex::new(WindowsPetInputDiagnostics {
        latest: None,
        last_press: None,
        renderer_pointer_down_count: 0,
        drag_request_count: 0,
    });

#[cfg(target_os = "windows")]
pub(super) fn windows_pet_input_diagnostics() -> WindowsPetInputDiagnostics {
    WINDOWS_INPUT_DIAGNOSTICS
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .clone()
}

#[cfg(target_os = "windows")]
pub(super) fn record_windows_renderer_pointer_down() {
    let mut state = WINDOWS_INPUT_DIAGNOSTICS.lock().unwrap_or_else(|error| error.into_inner());
    state.renderer_pointer_down_count = state.renderer_pointer_down_count.saturating_add(1);
}

#[cfg(target_os = "windows")]
pub(super) fn record_windows_drag_request() {
    let mut state = WINDOWS_INPUT_DIAGNOSTICS.lock().unwrap_or_else(|error| error.into_inner());
    state.drag_request_count = state.drag_request_count.saturating_add(1);
}
pub fn reset_pet_hit_region() {
    if let Ok(mut state) = HIT_REGION.lock() {
        clear_hit_region_input(&mut state);
        HIT_REGION_NATIVE_REFRESH_PENDING.store(true, Ordering::Release);
    }
    if let Ok(mut press) = HIT_REGION_PRESS.lock() {
        *press = PressState::default();
    }
}

fn hit_region_has_spans() -> bool {
    HIT_REGION
        .lock()
        .map(|state| !state.spans.is_empty())
        .unwrap_or(false)
}

fn hit_region_press_active() -> bool {
    HIT_REGION_PRESS
        .lock()
        .map(|press| press.active)
        .unwrap_or(false)
}

fn hit_region_native_refresh_pending() -> bool {
    HIT_REGION_NATIVE_REFRESH_PENDING.load(Ordering::Acquire)
}

fn hit_region_geometry_refresh_needed(
    press_active: bool,
    has_spans: bool,
    native_refresh_pending: bool,
) -> bool {
    press_active || has_spans || native_refresh_pending
}

fn should_refresh_hit_region_for_mouse_event(
    is_down: bool,
    owned_by_pet: bool,
    press_active: bool,
    has_spans: bool,
) -> bool {
    if is_down {
        owned_by_pet || has_spans
    } else {
        press_active || has_spans
    }
}

pub fn pet_hit_region_geometry_refresh_needed() -> bool {
    hit_region_geometry_refresh_needed(
        hit_region_press_active(),
        hit_region_has_spans(),
        hit_region_native_refresh_pending(),
    )
}

fn clear_hit_region_input(state: &mut HitRegionState) {
    // Preserve the ordering watermark so an older renderer request that was
    // already in flight cannot resurrect input after disable/hide.
    state.spans.clear();
    state.pointer_inside = false;
}

#[tauri::command]
pub fn pet_mode_update_hit_region(
    app: AppHandle,
    update: PetModeHitRegionUpdate,
) -> Result<(), String> {
    let Some(window) = app.get_webview_window(PET_MODE_WINDOW_LABEL) else {
        return Ok(());
    };
    validate_update(&update)?;
    {
        let mut state = HIT_REGION
            .lock()
            .map_err(|_| "Pet Mode hit-region state is unavailable".to_string())?;
        let accepted = state.generation < update.generation
            || (state.generation == update.generation && state.revision < update.revision);
        if !accepted {
            return Ok(());
        }
        *state = HitRegionState {
            generation: update.generation,
            version: update.version,
            revision: update.revision,
            mirrored: update.mirrored,
            spans: update.spans,
            pointer_inside: false,
        };
        HIT_REGION_NATIVE_REFRESH_PENDING.store(true, Ordering::Release);
    }
    refresh_pet_hit_region_for_window(&window)
}

pub fn pet_hit_region_pointer_inside() -> bool {
    HIT_REGION
        .lock()
        .map(|state| state.pointer_inside)
        .unwrap_or(false)
}

pub fn refresh_pet_hit_region_for_window(window: &WebviewWindow) -> Result<(), String> {
    if pet_geometry_transition_active() {
        HIT_REGION_NATIVE_REFRESH_PENDING.store(true, Ordering::Release);
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    if !super::pet_mode::pet_native_thread_is_current(window)? {
        return super::pet_mode::run_pet_native_transaction(window, "pet_hit_region::refresh_windows", |window| {
            refresh_pet_hit_region_for_window(&window)
        });
    }
    #[cfg(target_os = "macos")]
    {
        use objc2::MainThreadMarker;
        if MainThreadMarker::new().is_none() {
            let window_for_main = window.clone();
            let (sender, receiver) = std::sync::mpsc::sync_channel(1);
            window
                .run_on_main_thread(crate::panic_guard::contained("pet_hit_region::refresh_pet_hit_region_for_window", move || {
                    let _ = sender.send(refresh_pet_hit_region_on_main_thread(&window_for_main));
                }))
                .map_err(|error| error.to_string())?;
            return receiver
                .recv_timeout(MAIN_THREAD_TIMEOUT)
                .map_err(|_| "Pet Mode hit-region refresh timed out".to_string())?;
        }
        return refresh_pet_hit_region_on_main_thread(window);
    }
    #[cfg(target_os = "windows")]
    {
        let pointer = super::pet_cursor_windows::cursor_position()?;
        let position = window.outer_position().map_err(|error| error.to_string())?;
        let dpi = super::pet_cursor_windows::window_scale_factor(window)?;
        let scene_rect = current_pet_render_geometry().physical_scene_rect(dpi);
        let (inside, mask_revision, mask_span_count) = HIT_REGION
            .lock()
            .map(|state| {
                (
                    hit_test_physical(
                        &state,
                        pointer.x - position.x as f64,
                        pointer.y - position.y as f64,
                        scene_rect,
                    ),
                    state.revision,
                    state.spans.len() / 3,
                )
            })
            .unwrap_or((false, 0, 0));
        let button_down = windows_mouse_button_down();
        let interactive = resolve_windows_press_interaction(inside, button_down);
        let ignored_cursor_events_before_apply =
            super::windows_overlay::windows_overlay_ignores_cursor_events(window).ok();
        let result = set_windows_pet_interactive(window, interactive);
        let sample = WindowsPetInputSample {
            sampled_at_ms: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
            scale_factor: dpi,
            window_client_x: (pointer.x - position.x as f64) / dpi,
            window_client_y: (pointer.y - position.y as f64) / dpi,
            mask_revision,
            mask_span_count,
            mask_inside: inside,
            button_down,
            interactive,
            ignored_cursor_events_before_apply,
            ignored_cursor_events:
                super::windows_overlay::windows_overlay_ignores_cursor_events(window).ok(),
            policy_applied: result.is_ok(),
        };
        WINDOWS_INPUT_DIAGNOSTICS
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .observe(sample);
        result
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let pointer = window
            .app_handle()
            .cursor_position()
            .map_err(|error| error.to_string())?;
        let position = window.outer_position().map_err(|error| error.to_string())?;
        let dpi = window.scale_factor().map_err(|error| error.to_string())?;
        let scene_rect = current_pet_render_geometry().physical_scene_rect(dpi);
        let inside = HIT_REGION
            .lock()
            .map(|state| {
                hit_test_physical(
                    &state,
                    pointer.x - position.x as f64,
                    pointer.y - position.y as f64,
                    scene_rect,
                )
            })
            .unwrap_or(false);
        let result = set_pet_window_interactive(window, inside);
        if result.is_ok() {
            HIT_REGION_NATIVE_REFRESH_PENDING.store(false, Ordering::Release);
        }
        result
    }
}

#[cfg(target_os = "windows")]
fn windows_mouse_button_down() -> bool {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, VK_LBUTTON, VK_MBUTTON, VK_RBUTTON,
    };

    [VK_LBUTTON, VK_RBUTTON, VK_MBUTTON]
        .into_iter()
        .any(|button| unsafe { GetAsyncKeyState(button as i32) } < 0)
}

#[cfg(target_os = "windows")]
fn resolve_windows_press_interaction(pointer_inside: bool, button_down: bool) -> bool {
    let Ok(mut press) = HIT_REGION_PRESS.lock() else {
        return pointer_inside;
    };
    resolve_press_interaction(&mut press, pointer_inside, button_down)
}

#[cfg(any(target_os = "windows", test))]
fn resolve_press_interaction(press: &mut PressState, pointer_inside: bool, button_down: bool) -> bool {
    if button_down {
        if !press.active {
            press.active = true;
            press.owned_by_pet = pointer_inside;
        }
        press.owned_by_pet
    } else {
        *press = PressState::default();
        pointer_inside
    }
}

#[cfg(target_os = "windows")]
fn set_windows_pet_interactive(window: &WebviewWindow, interactive: bool) -> Result<(), String> {
    let watermark = HIT_REGION
        .lock()
        .map(|state| (state.generation.clone(), state.revision))
        .map_err(|_| "Pet Mode hit-region state is unavailable".to_string())?;
    // A mask publication resets pointer_inside before this call. Only the
    // actual native pointer bit can decide whether a style apply is needed.
    // Hold no HIT_REGION/PRESS lock across the native transaction or callbacks.
    set_windows_overlay_click_through(window, !interactive)?;
    if let Ok(mut state) = HIT_REGION.lock() {
        if complete_windows_hit_region_refresh(&mut state, &watermark, interactive) {
            HIT_REGION_NATIVE_REFRESH_PENDING.store(false, Ordering::Release);
        }
    }
    Ok(())
}

#[cfg(any(target_os = "windows", test))]
fn complete_windows_hit_region_refresh(
    state: &mut HitRegionState,
    watermark: &(String, u64),
    interactive: bool,
) -> bool {
    if state.generation != watermark.0 || state.revision != watermark.1 {
        return false;
    }
    state.pointer_inside = interactive;
    true
}

pub fn set_pet_window_interactive(window: &WebviewWindow, interactive: bool) -> Result<(), String> {
    if !interactive {
        if let Ok(mut press) = HIT_REGION_PRESS.lock() {
            *press = PressState::default();
        }
    }
    #[cfg(target_os = "macos")]
    {
        use objc2::MainThreadMarker;
        if MainThreadMarker::new().is_none() {
            let window_for_main = window.clone();
            let (sender, receiver) = std::sync::mpsc::sync_channel(1);
            window
                .run_on_main_thread(crate::panic_guard::contained("pet_hit_region::set_pet_window_interactive", move || {
                    let _ = sender.send(set_pet_window_interactive_on_main_thread(
                        &window_for_main,
                        interactive,
                    ));
                }))
                .map_err(|error| error.to_string())?;
            return receiver
                .recv_timeout(MAIN_THREAD_TIMEOUT)
                .map_err(|_| "Pet Mode hit-region mutation timed out".to_string())?;
        }
        return set_pet_window_interactive_on_main_thread(window, interactive);
    }
    #[cfg(target_os = "windows")]
    {
        return set_windows_pet_interactive(window, interactive);
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        window
            .set_ignore_cursor_events(!interactive)
            .map_err(|error| error.to_string())?;
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        if let Ok(mut state) = HIT_REGION.lock() {
            state.pointer_inside = interactive;
            if !interactive && state.spans.is_empty() {
                HIT_REGION_NATIVE_REFRESH_PENDING.store(false, Ordering::Release);
            }
        }
        Ok(())
    }
}

pub fn install_pet_hit_region_monitor(app: &AppHandle) -> Result<(), String> {
    if HIT_REGION_MONITOR_INSTALLED
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        if let Err(error) = install_macos_monitor(app) {
            HIT_REGION_MONITOR_INSTALLED.store(false, Ordering::Release);
            return Err(error);
        }
    }
    #[cfg(target_os = "windows")]
    if let Err(error) = install_windows_monitor(app) {
        HIT_REGION_MONITOR_INSTALLED.store(false, Ordering::Release);
        return Err(error);
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn install_windows_monitor(app: &AppHandle) -> Result<(), String> {
    let app = app.clone();
    std::thread::Builder::new()
        .name("drifty-pet-hit-region".into())
        .spawn(move || loop {
            let Some(window) = app.get_webview_window(PET_MODE_WINDOW_LABEL) else {
                break;
            };
            if matches!(window.is_visible(), Ok(true)) {
                let _ = refresh_pet_hit_region_for_window(&window);
                std::thread::sleep(Duration::from_millis(16));
            } else {
                std::thread::sleep(Duration::from_millis(100));
            }
        })
        .map(|_| ())
        .map_err(|error| format!("failed to start Windows Pet Mode hit-region monitor: {error}"))
}

#[cfg(target_os = "macos")]
fn install_macos_monitor(app: &AppHandle) -> Result<(), String> {
    use block2::RcBlock;
    use objc2_app_kit::{NSEvent, NSEventMask};
    use std::ptr::NonNull;

    let pet_window_number = app
        .get_webview_window(PET_MODE_WINDOW_LABEL)
        .map(|window| configure_macos_mouse_tracking(&window))
        .transpose()?
        .unwrap_or_default();

    let app_for_global = app.clone();
    let global: block2::RcBlock<dyn Fn(NonNull<NSEvent>)> =
        RcBlock::new(move |event: NonNull<NSEvent>| {
            let event = unsafe { event.as_ref() };
            // A panic cannot unwind out of an AppKit block; it would abort.
            crate::panic_guard::contain_panic("pet_hit_region::global_mouse_monitor", || {
                handle_monitored_mouse_event(
                    &app_for_global,
                    event.r#type(),
                    false,
                    event.windowNumber(),
                    pet_window_number,
                )
            });
        });
    let mask = NSEventMask::MouseMoved
        | NSEventMask::LeftMouseDragged
        | NSEventMask::LeftMouseDown
        | NSEventMask::LeftMouseUp
        | NSEventMask::RightMouseDragged
        | NSEventMask::RightMouseDown
        | NSEventMask::RightMouseUp
        | NSEventMask::OtherMouseDragged
        | NSEventMask::OtherMouseDown
        | NSEventMask::OtherMouseUp
        | NSEventMask::ScrollWheel;
    let global_monitor = NSEvent::addGlobalMonitorForEventsMatchingMask_handler(mask, &global)
        .ok_or_else(|| "macOS did not install the Pet Mode global mouse monitor".to_string())?;

    let app_for_local = app.clone();
    let local: block2::RcBlock<dyn Fn(NonNull<NSEvent>) -> *mut NSEvent> =
        RcBlock::new(move |event: NonNull<NSEvent>| {
            let event_ref = unsafe { event.as_ref() };
            // Contain a panic and still hand the event back unchanged.
            crate::panic_guard::contain_panic("pet_hit_region::local_mouse_monitor", || {
                handle_monitored_mouse_event(
                    &app_for_local,
                    event_ref.r#type(),
                    true,
                    event_ref.windowNumber(),
                    pet_window_number,
                )
            });
            event.as_ptr()
        });
    let Some(local_monitor) =
        (unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(mask, &local) })
    else {
        unsafe { NSEvent::removeMonitor(&global_monitor) };
        return Err("macOS did not install the Pet Mode local mouse monitor".to_string());
    };
    // Monitor tokens remain valid for the application lifetime. If either
    // install fails above, the earlier token is removed and the install guard
    // is reset so a later window creation may retry.
    std::mem::forget(global_monitor);
    std::mem::forget(local_monitor);
    Ok(())
}

#[cfg(target_os = "macos")]
fn handle_monitored_mouse_event(
    app: &AppHandle,
    event_type: objc2_app_kit::NSEventType,
    received_locally: bool,
    event_window_number: isize,
    pet_window_number: isize,
) {
    use objc2_app_kit::NSEventType;
    let is_down = event_type == NSEventType::LeftMouseDown
        || event_type == NSEventType::RightMouseDown
        || event_type == NSEventType::OtherMouseDown;
    let is_up = event_type == NSEventType::LeftMouseUp
        || event_type == NSEventType::RightMouseUp
        || event_type == NSEventType::OtherMouseUp;
    if is_down {
        // The monitor cannot retarget this already-dispatched down event. Its
        // job here is to freeze the *actual recipient* for the rest of the
        // press. Recomputing from the current pointer would be wrong after a
        // transparent click-through: the global monitor runs after dispatch,
        // and could otherwise enable the pet between the underlying window's
        // mouse-down and mouse-up.
        let owned_by_pet =
            press_owned_by_pet(received_locally, event_window_number, pet_window_number);
        if let Ok(mut press) = HIT_REGION_PRESS.lock() {
            press.active = true;
            press.owned_by_pet = owned_by_pet;
        }
        if !should_refresh_hit_region_for_mouse_event(
            true,
            owned_by_pet,
            true,
            hit_region_has_spans() || hit_region_native_refresh_pending(),
        ) {
            return;
        }
        let Some(window) = app.get_webview_window(PET_MODE_WINDOW_LABEL) else {
            return;
        };
        let _ = refresh_pet_hit_region_for_window(&window);
        return;
    }

    let press_active = hit_region_press_active();
    if !should_refresh_hit_region_for_mouse_event(
        false,
        false,
        press_active,
        hit_region_has_spans() || hit_region_native_refresh_pending(),
    ) {
        return;
    }
    let Some(window) = app.get_webview_window(PET_MODE_WINDOW_LABEL) else {
        return;
    };
    let _ = refresh_pet_hit_region_for_window(&window);
    if is_up && objc2_app_kit::NSEvent::pressedMouseButtons() == 0 {
        if let Ok(mut press) = HIT_REGION_PRESS.lock() {
            *press = PressState::default();
        }
        let _ = refresh_pet_hit_region_for_window(&window);
    }
}

#[cfg(target_os = "macos")]
fn configure_macos_mouse_tracking(window: &WebviewWindow) -> Result<isize, String> {
    use objc2_app_kit::NSWindow;
    let pointer = window.ns_window().map_err(|error| error.to_string())?;
    let ns_window: &NSWindow = unsafe { &*pointer.cast::<NSWindow>() };
    ns_window.setAcceptsMouseMovedEvents(true);
    Ok(ns_window.windowNumber())
}

fn press_owned_by_pet(
    received_locally: bool,
    event_window_number: isize,
    pet_window_number: isize,
) -> bool {
    received_locally && pet_window_number > 0 && event_window_number == pet_window_number
}

#[cfg(target_os = "macos")]
fn refresh_pet_hit_region_on_main_thread(window: &WebviewWindow) -> Result<(), String> {
    use objc2_app_kit::{NSEvent, NSWindow};

    let pointer = window.ns_window().map_err(|error| error.to_string())?;
    let ns_window: &NSWindow = unsafe { &*pointer.cast::<NSWindow>() };

    let press_decision = HIT_REGION_PRESS.lock().ok().and_then(|mut press| {
        if press.active && NSEvent::pressedMouseButtons() == 0 {
            *press = PressState::default();
        }
        press.active.then_some(press.owned_by_pet)
    });

    let interactive = if let Some(owned_by_pet) = press_decision {
        owned_by_pet
    } else if let Some(content_view) = ns_window.contentView() {
        let point =
            content_view.convertPoint_fromView(ns_window.mouseLocationOutsideOfEventStream(), None);
        let bounds = content_view.bounds();
        let (local_x, local_y) = content_point_from_top_left(
            point.x,
            point.y,
            bounds.origin.x,
            bounds.origin.y,
            bounds.size.height,
            content_view.isFlipped(),
        );
        let mut state = HIT_REGION
            .lock()
            .map_err(|_| "Pet Mode hit-region state is unavailable".to_string())?;
        // The fullscreen edge entrance clips the portion on an adjacent
        // display. Invisible pixels must also pass pointer input through.
        let inside_mask = content_view
            .layer()
            .and_then(|layer| layer.mask())
            .is_none_or(|mask| {
                let frame = mask.frame();
                point.x >= frame.origin.x
                    && point.x < frame.origin.x + frame.size.width
                    && point.y >= frame.origin.y
                    && point.y < frame.origin.y + frame.size.height
            });
        let inside = inside_mask
            && hit_test_physical(
                &state,
                local_x,
                local_y,
                current_pet_render_geometry().physical_scene_rect(1.0),
            );
        // Keep the state lock across the AppKit mutation. A renderer update
        // cannot interleave between the decision and the NSWindow property.
        set_macos_window_interactive(ns_window, inside);
        state.pointer_inside = inside;
        HIT_REGION_NATIVE_REFRESH_PENDING.store(false, Ordering::Release);
        return Ok(());
    } else {
        false
    };

    set_pet_window_interactive_on_main_thread(window, interactive)
}

#[cfg(target_os = "macos")]
fn set_pet_window_interactive_on_main_thread(
    window: &WebviewWindow,
    interactive: bool,
) -> Result<(), String> {
    use objc2_app_kit::NSWindow;
    let pointer = window.ns_window().map_err(|error| error.to_string())?;
    let ns_window: &NSWindow = unsafe { &*pointer.cast::<NSWindow>() };
    let mut state = HIT_REGION
        .lock()
        .map_err(|_| "Pet Mode hit-region state is unavailable".to_string())?;
    set_macos_window_interactive(ns_window, interactive);
    state.pointer_inside = interactive;
    if !interactive && state.spans.is_empty() {
        HIT_REGION_NATIVE_REFRESH_PENDING.store(false, Ordering::Release);
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn set_macos_window_interactive(window: &objc2_app_kit::NSWindow, interactive: bool) {
    // This is synchronous on AppKit's main thread. Tauri's queued cross-thread
    // setter can otherwise land after the following mouse-down selection.
    window.setIgnoresMouseEvents(!interactive);
}

fn validate_update(update: &PetModeHitRegionUpdate) -> Result<(), String> {
    let generation = update.generation.as_bytes();
    if generation.len() != 20
        || generation[13] != b'-'
        || !generation[..13].iter().all(u8::is_ascii_digit)
        || !generation[14..].iter().all(u8::is_ascii_digit)
    {
        return Err("Pet Mode hit-region generation is invalid".to_string());
    }
    if update.version != HIT_REGION_VERSION {
        return Err(format!(
            "Unsupported Pet Mode hit-region version {}",
            update.version
        ));
    }
    if update.region_id.is_empty() || update.region_id.len() > 64 {
        return Err("Pet Mode hit-region id is invalid".to_string());
    }
    if update.spans.len() % 3 != 0 {
        return Err("Pet Mode hit-region spans must be y/start/end triples".to_string());
    }
    if update.spans.len() > MAX_SPAN_INTEGERS {
        return Err("Pet Mode hit-region contains too many spans".to_string());
    }
    let mut previous: Option<(u16, u16)> = None;
    let valid = update.spans.chunks_exact(3).all(|span| {
        let ordered =
            previous.is_none_or(|(row, end)| span[0] > row || (span[0] == row && span[1] >= end));
        previous = Some((span[0], span[2]));
        ordered && span[0] < BASE_HEIGHT as u16 && span[1] < span[2] && span[2] <= BASE_WIDTH as u16
    });
    if !valid {
        return Err("Pet Mode hit-region span is outside canonical bounds".to_string());
    }
    Ok(())
}

fn hit_test_physical(
    state: &HitRegionState,
    local_x: f64,
    local_y: f64,
    scene_rect: (f64, f64, f64, f64),
) -> bool {
    // Canonical v1 spans still describe only the authored body scene. Every
    // transparent padding edge and decoration outside it remains click-through.
    // Use the renderer's uniform scene scale, not the rounded outer window size.
    let (left, top, scene_width, scene_height) = scene_rect;
    let local_x = local_x - left;
    let local_y = local_y - top;
    if state.version != HIT_REGION_VERSION
        || state.spans.is_empty()
        || ![local_x, local_y, scene_width, scene_height].into_iter().all(f64::is_finite)
        || scene_width <= 0.0
        || scene_height <= 0.0
        || local_x < 0.0
        || local_y < 0.0
        || local_x >= scene_width
        || local_y >= scene_height
    {
        return false;
    }
    let mut x = local_x * BASE_WIDTH / scene_width;
    let y = local_y * BASE_HEIGHT / scene_height;
    if state.mirrored {
        x = BASE_WIDTH - x;
    }
    state.spans.chunks_exact(3).any(|span| {
        let row = span[0] as f64;
        row <= y && y < row + 1.0 && span[1] as f64 <= x && x < span[2] as f64
    })
}

#[cfg(target_os = "macos")]
fn content_point_from_top_left(
    point_x: f64,
    point_y: f64,
    origin_x: f64,
    origin_y: f64,
    height: f64,
    flipped: bool,
) -> (f64, f64) {
    let x = point_x - origin_x;
    let y_from_bottom = point_y - origin_y;
    (
        x,
        if flipped {
            y_from_bottom
        } else {
            height - y_from_bottom
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn input_diagnostics_preserve_the_press_edge_after_hover_and_release() {
        let sample = |at, down, inside| WindowsPetInputSample {
            sampled_at_ms: at,
            scale_factor: 2.25,
            window_client_x: 84.0,
            window_client_y: 96.0,
            mask_revision: 7,
            mask_span_count: 192,
            mask_inside: inside,
            button_down: down,
            interactive: inside,
            ignored_cursor_events_before_apply: Some(true),
            ignored_cursor_events: Some(!inside),
            policy_applied: true,
        };
        let mut state = WindowsPetInputDiagnostics::default();
        state.observe(sample(1, false, true));
        state.observe(sample(2, true, true));
        // Dragging outside the body and then looking at Lab bounds must not
        // replace the original mask/pointer/policy observation at button down.
        state.observe(sample(3, true, false));
        state.observe(sample(4, false, false));
        assert_eq!(state.last_press.as_ref().unwrap().sampled_at_ms, 2);
        assert!(state.last_press.as_ref().unwrap().mask_inside);
        assert_eq!(state.latest.as_ref().unwrap().sampled_at_ms, 4);
        let readback = serde_json::to_value(state.clone()).unwrap();
        assert_eq!(readback["lastPress"]["ignoredCursorEventsBeforeApply"], true);
        assert_eq!(readback["lastPress"]["ignoredCursorEvents"], false);
        assert_eq!(readback["lastPress"]["policyApplied"], true);
        assert_eq!(state.last_press.as_ref().unwrap().sampled_at_ms, 2);
        state.observe(sample(5, true, false));
        assert_eq!(state.last_press.as_ref().unwrap().sampled_at_ms, 5);
        assert!(!state.last_press.as_ref().unwrap().mask_inside);
        assert_eq!(readback["lastPress"]["sampledAtMs"], 2);
    }

    fn state(mirrored: bool) -> HitRegionState {
        HitRegionState {
            generation: "test".into(),
            version: HIT_REGION_VERSION,
            revision: 1,
            mirrored,
            spans: vec![20, 40, 60],
            pointer_inside: false,
        }
    }

    #[test]
    fn generated_artifact_matches_native_contract() {
        let artifact: serde_json::Value = serde_json::from_str(include_str!(
            "../../../apps/desktop/public/pet-mode/hit-regions-v1.json"
        ))
        .expect("generated hit-region artifact must be JSON");
        assert_eq!(
            artifact["version"].as_u64(),
            Some(HIT_REGION_VERSION as u64)
        );
        assert_eq!(artifact["width"].as_f64(), Some(BASE_WIDTH));
        assert_eq!(artifact["height"].as_f64(), Some(BASE_HEIGHT));
        assert_eq!(artifact["logicalWidth"].as_u64(), Some(144));
        assert_eq!(artifact["logicalHeight"].as_u64(), Some(99));
        assert_eq!(artifact["mirrorResamplingToleranceXPx"].as_u64(), Some(2));
        let largest_region = artifact["regions"]
            .as_object()
            .and_then(|regions| {
                regions
                    .values()
                    .filter_map(|value| value.as_array())
                    .map(Vec::len)
                    .max()
            })
            .expect("generated artifact must contain regions");
        assert!(largest_region <= MAX_SPAN_INTEGERS);
    }

    #[test]
    fn newer_generation_wins_after_renderer_revision_resets() {
        fn accepts(current: &HitRegionState, generation: &str, revision: u64) -> bool {
            current.generation.as_str() < generation
                || (current.generation == generation && current.revision < revision)
        }
        let current = HitRegionState {
            generation: "0000000000010-000000".into(),
            revision: 500,
            ..state(false)
        };
        assert!(accepts(&current, "0000000000011-000000", 1));
        assert!(!accepts(&current, "0000000000009-000000", 900));
        assert!(accepts(&current, "0000000000010-000000", 501));
    }

    #[test]
    fn press_ownership_follows_the_dispatched_window() {
        let pet_window = 42;
        assert!(press_owned_by_pet(true, pet_window, pet_window));
        assert!(!press_owned_by_pet(true, 7, pet_window));
        assert!(!press_owned_by_pet(false, pet_window, pet_window));
        assert!(!press_owned_by_pet(true, 0, 0));
    }

    #[test]
    fn dormant_monitor_skips_mouse_refreshes_until_input_can_matter() {
        assert!(!should_refresh_hit_region_for_mouse_event(
            false, false, false, false,
        ));
        assert!(!should_refresh_hit_region_for_mouse_event(
            true, false, false, false,
        ));
        assert!(should_refresh_hit_region_for_mouse_event(
            false, false, false, true,
        ));
        assert!(should_refresh_hit_region_for_mouse_event(
            false, false, true, false,
        ));
        assert!(should_refresh_hit_region_for_mouse_event(
            true, true, false, false,
        ));
        assert!(!hit_region_geometry_refresh_needed(false, false, false));
        assert!(hit_region_geometry_refresh_needed(false, false, true));
        assert!(hit_region_geometry_refresh_needed(false, true, false));
        assert!(hit_region_geometry_refresh_needed(true, false, false));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn content_coordinates_are_normalized_to_web_top_left() {
        assert_eq!(
            content_point_from_top_left(25.0, 70.0, 5.0, 10.0, 99.0, false),
            (20.0, 39.0),
        );
        assert_eq!(
            content_point_from_top_left(25.0, 70.0, 5.0, 10.0, 99.0, true),
            (20.0, 60.0),
        );
    }

    #[test]
    fn reset_clears_input_without_reopening_old_generation() {
        let mut current = HitRegionState {
            generation: "0000000000010-000000".into(),
            revision: 42,
            spans: vec![20, 40, 60],
            pointer_inside: true,
            ..state(false)
        };
        clear_hit_region_input(&mut current);
        assert_eq!(current.generation, "0000000000010-000000");
        assert_eq!(current.revision, 42);
        assert!(current.spans.is_empty());
        assert!(!current.pointer_inside);
    }

    #[test]
    fn logical_mask_reset_reconciles_the_native_windows_pointer_bit() {
        use std::cell::Cell;
        use super::super::windows_overlay::update_windows_overlay_pointer_policy;
        const TRANSPARENT: u32 = 0x20;
        let native_style = Cell::new(0x0808_0080_u32); // interactive layered/no-activate/tool window
        let unrelated_style = native_style.get();
        let writes = Cell::new(0);
        let mut current = HitRegionState {
            generation: "0000000000010-000000".into(),
            revision: 42,
            pointer_inside: true,
            ..state(false)
        };
        clear_hit_region_input(&mut current);
        assert!(!current.pointer_inside);
        assert!(current.spans.is_empty());
        let watermark = (current.generation.clone(), current.revision);
        let reconcile = || update_windows_overlay_pointer_policy(
            true, true, TRANSPARENT,
            || Ok(native_style.get()),
            |desired| { native_style.set(desired); writes.set(writes.get() + 1); Ok(()) },
        );
        assert!(reconcile().unwrap());
        assert!(complete_windows_hit_region_refresh(&mut current, &watermark, false));
        assert_eq!(native_style.get(), unrelated_style | TRANSPARENT);
        assert!(!reconcile().unwrap());
        assert_eq!(writes.get(), 1); // no repeated frame/style apply after reset/show
    }

    #[test]
    fn native_refresh_ack_cannot_clear_a_newer_mask_publication() {
        let mut current = state(false);
        let watermark = (current.generation.clone(), current.revision);
        current.revision += 1;
        assert!(!complete_windows_hit_region_refresh(&mut current, &watermark, true));
        assert!(!current.pointer_inside);
        let watermark = (current.generation.clone(), current.revision);
        current.generation = "0000000000011-000000".into();
        assert!(!complete_windows_hit_region_refresh(&mut current, &watermark, true));
        assert!(!current.pointer_inside);
    }

    #[test]
    fn windows_press_keeps_its_first_owner_through_body_and_gutter_crossings() {
        let mut press = PressState::default();
        assert!(!resolve_press_interaction(&mut press, false, true));
        assert!(!resolve_press_interaction(&mut press, true, true));
        assert!(resolve_press_interaction(&mut press, true, false));
        assert!(resolve_press_interaction(&mut press, true, true));
        assert!(resolve_press_interaction(&mut press, false, true));
        assert!(!resolve_press_interaction(&mut press, false, false));
        assert!(!press.active);
    }

    #[test]
    fn hit_test_respects_span_boundaries() {
        let region = state(false);
        assert!(hit_test_physical(&region, 20.0, 10.0, (0.0, 0.0, 144.0, 99.0)));
        assert!(hit_test_physical(&region, 29.5, 10.0, (0.0, 0.0, 144.0, 99.0)));
        assert!(!hit_test_physical(&region, 30.0, 10.0, (0.0, 0.0, 144.0, 99.0)));
        assert!(!hit_test_physical(&region, 20.0, 10.5, (0.0, 0.0, 144.0, 99.0)));
    }

    #[test]
    fn hit_test_scales_physical_pixels() {
        let region = state(false);
        assert!(hit_test_physical(&region, 40.0, 20.0, (0.0, 0.0, 288.0, 198.0)));
        assert!(!hit_test_physical(&region, 10.0, 20.0, (0.0, 0.0, 288.0, 198.0)));
    }

    #[test]
    fn live_dpi_body_input_must_follow_the_current_physical_scene() {
        let region = state(false);
        for dpi in [1.0, 1.25, 1.5, 1.75, 2.0, 2.25] {
            let pointer = ((18.0 + 20.0) * dpi, (64.0 + 10.0) * dpi);
            let current = (18.0 * dpi, 64.0 * dpi, 144.0 * dpi, 99.0 * dpi);
            assert!(hit_test_physical(&region, pointer.0, pointer.1, current));
            if dpi != 1.0 {
                // The native body has scaled while a launch-DPI mask treats
                // this same visible pixel as transparent, forwarding input.
                assert!(!hit_test_physical(&region, pointer.0, pointer.1, (18.0, 64.0, 144.0, 99.0)));
            }
        }
    }

    #[test]
    fn padded_scene_preserves_body_input_and_all_four_gutters_pass_through() {
        let region = state(false);
        for pet_scale in [0.5, 0.75, 1.0, 1.25] {
            for dpi in [1.0, 1.25, 1.5, 1.75, 2.0, 2.25] {
                let scale = pet_scale * dpi;
                let rect = (18.0 * scale, 64.0 * scale, 144.0 * scale, 99.0 * scale);
                assert!(hit_test_physical(&region, (18.0 + 20.0) * scale, (64.0 + 10.0) * scale, rect));
                for point in [(17.9, 74.0), (38.0, 63.9), (162.0, 74.0), (38.0, 163.0)] {
                    assert!(!hit_test_physical(&region, point.0 * scale, point.1 * scale, rect));
                }
            }
        }
    }

    #[test]
    fn rounded_outer_window_height_cannot_stretch_the_input_mask() {
        let region = state(false);
        // 75% at 125% DPI has a 92.8125px scene height. Its native surface may
        // round to an integer, but the renderer's authored row remains exact.
        let scale = 0.75 * 1.25;
        let rect = (0.0, 64.0 * scale, 144.0 * scale, 99.0 * scale);
        assert!(hit_test_physical(&region, 20.0 * scale, 74.0 * scale, rect));
        assert!(!hit_test_physical(&region, 20.0 * scale, 74.5 * scale, rect));
    }

    #[test]
    fn hit_test_mirrors_canonical_x() {
        let region = state(true);
        assert!(hit_test_physical(&region, 114.5, 10.0, (0.0, 0.0, 144.0, 99.0)));
        assert!(!hit_test_physical(&region, 20.0, 10.0, (0.0, 0.0, 144.0, 99.0)));
    }

    #[test]
    fn invalid_or_empty_region_is_click_through() {
        let mut region = state(false);
        region.spans.clear();
        assert!(!hit_test_physical(&region, 20.0, 10.0, (0.0, 0.0, 144.0, 99.0)));
    }
}
