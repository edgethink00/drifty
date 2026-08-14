use serde::Deserialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager, WebviewWindow};

use super::pet_mode::PET_MODE_WINDOW_LABEL;

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
static HIT_REGION_PRESS: Mutex<PressState> = Mutex::new(PressState {
    active: false,
    owned_by_pet: false,
});

pub fn reset_pet_hit_region() {
    if let Ok(mut state) = HIT_REGION.lock() {
        clear_hit_region_input(&mut state);
    }
    if let Ok(mut press) = HIT_REGION_PRESS.lock() {
        *press = PressState::default();
    }
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
    #[cfg(target_os = "macos")]
    {
        use objc2::MainThreadMarker;
        if MainThreadMarker::new().is_none() {
            let window_for_main = window.clone();
            let (sender, receiver) = std::sync::mpsc::sync_channel(1);
            window
                .run_on_main_thread(move || {
                    let _ = sender.send(refresh_pet_hit_region_on_main_thread(&window_for_main));
                })
                .map_err(|error| error.to_string())?;
            return receiver
                .recv_timeout(MAIN_THREAD_TIMEOUT)
                .map_err(|_| "Pet Mode hit-region refresh timed out".to_string())?;
        }
        return refresh_pet_hit_region_on_main_thread(window);
    }
    #[cfg(not(target_os = "macos"))]
    {
        let pointer = window
            .app_handle()
            .cursor_position()
            .map_err(|error| error.to_string())?;
        let position = window.outer_position().map_err(|error| error.to_string())?;
        let size = window.outer_size().map_err(|error| error.to_string())?;
        let inside = HIT_REGION
            .lock()
            .map(|state| {
                hit_test_physical(
                    &state,
                    pointer.x - position.x as f64,
                    pointer.y - position.y as f64,
                    size.width as f64,
                    size.height as f64,
                )
            })
            .unwrap_or(false);
        set_pet_window_interactive(window, inside)
    }
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
                .run_on_main_thread(move || {
                    let _ = sender.send(set_pet_window_interactive_on_main_thread(
                        &window_for_main,
                        interactive,
                    ));
                })
                .map_err(|error| error.to_string())?;
            return receiver
                .recv_timeout(MAIN_THREAD_TIMEOUT)
                .map_err(|_| "Pet Mode hit-region mutation timed out".to_string())?;
        }
        return set_pet_window_interactive_on_main_thread(window, interactive);
    }
    #[cfg(not(target_os = "macos"))]
    {
        window
            .set_ignore_cursor_events(!interactive)
            .map_err(|error| error.to_string())?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        if let Ok(mut state) = HIT_REGION.lock() {
            state.pointer_inside = interactive;
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
    Ok(())
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
            handle_monitored_mouse_event(
                &app_for_global,
                event.r#type(),
                false,
                event.windowNumber(),
                pet_window_number,
            );
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
            handle_monitored_mouse_event(
                &app_for_local,
                event_ref.r#type(),
                true,
                event_ref.windowNumber(),
                pet_window_number,
            );
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
    let Some(window) = app.get_webview_window(PET_MODE_WINDOW_LABEL) else {
        return;
    };

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
        let _ = refresh_pet_hit_region_for_window(&window);
        return;
    }

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
        let inside = hit_test_physical(
            &state,
            local_x,
            local_y,
            bounds.size.width,
            bounds.size.height,
        );
        // Keep the state lock across the AppKit mutation. A renderer update
        // cannot interleave between the decision and the NSWindow property.
        set_macos_window_interactive(ns_window, inside);
        state.pointer_inside = inside;
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
    physical_width: f64,
    physical_height: f64,
) -> bool {
    if state.version != HIT_REGION_VERSION
        || state.spans.is_empty()
        || physical_width <= 0.0
        || physical_height <= 0.0
        || local_x < 0.0
        || local_y < 0.0
        || local_x >= physical_width
        || local_y >= physical_height
    {
        return false;
    }
    // AppKit/Tauri cursor coordinates already describe the pointer point in
    // physical screen space. Adding half a pixel here would shift every test
    // at 1× and produce asymmetric boundary behavior at mixed scales.
    let mut x = local_x * BASE_WIDTH / physical_width;
    let y = local_y * BASE_HEIGHT / physical_height;
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
    fn hit_test_respects_span_boundaries() {
        let region = state(false);
        assert!(hit_test_physical(&region, 20.0, 10.0, 144.0, 99.0));
        assert!(hit_test_physical(&region, 29.5, 10.0, 144.0, 99.0));
        assert!(!hit_test_physical(&region, 30.0, 10.0, 144.0, 99.0));
        assert!(!hit_test_physical(&region, 20.0, 10.5, 144.0, 99.0));
    }

    #[test]
    fn hit_test_scales_physical_pixels() {
        let region = state(false);
        assert!(hit_test_physical(&region, 40.0, 20.0, 288.0, 198.0));
        assert!(!hit_test_physical(&region, 10.0, 20.0, 288.0, 198.0));
    }

    #[test]
    fn hit_test_mirrors_canonical_x() {
        let region = state(true);
        assert!(hit_test_physical(&region, 114.5, 10.0, 144.0, 99.0));
        assert!(!hit_test_physical(&region, 20.0, 10.0, 144.0, 99.0));
    }

    #[test]
    fn invalid_or_empty_region_is_click_through() {
        let mut region = state(false);
        region.spans.clear();
        assert!(!hit_test_physical(&region, 20.0, 10.0, 144.0, 99.0));
    }
}
