//! Full-screen close choreography. The target is an invisible edge point; only the
//! existing, revalidated nudge command closes the target after paw contact.
use super::*;
use objc2::MainThreadMarker;
use objc2_app_kit::{NSColor, NSWindow, NSWindowCollectionBehavior};
use objc2_foundation::{NSPoint, NSRect, NSSize};
use objc2_quartz_core::{CALayer, CATransaction};

// A virtual contact point just inside the left edge; no button is rendered.
const EDGE_CONTACT_INSET: f64 = 8.0;
const ENTRY_PAUSE: Duration = Duration::from_millis(400);
const NOTICE_HOLD: Duration = Duration::from_millis(400);
// Covers entry, contact, the fresh tracker probe, and the native close.
// Completion normally releases the scene; this is only the lost-client failsafe.
const SCENE_TIMEOUT: Duration = Duration::from_secs(45);

#[derive(Clone, Copy, Debug)]
struct Layout {
    target_x: f64,
    target_y: f64,
    start: LogicalPosition<f64>,
    entry_end: LogicalPosition<f64>,
    contact: LogicalPosition<f64>,
}

fn layout(
    frame: (f64, f64, f64, f64),
    size: (f64, f64),
    contact_offset: (f64, f64),
) -> Option<Layout> {
    let (x, y, width, height) = frame;
    if ![x, y, width, height, size.0, size.1]
        .into_iter()
        .all(f64::is_finite)
        || width < size.0 + 80.0
        || height < size.1 + 96.0
    {
        return None;
    }
    let target_x = x + EDGE_CONTACT_INSET.max(contact_offset.0);
    let target_y = y + 96.0_f64.max(48.0 + contact_offset.1);
    let cat_y = target_y - contact_offset.1;
    Some(Layout {
        target_x,
        target_y,
        // Start completely beyond the right edge. The entry mask prevents this
        // off-screen portion from appearing on a neighboring display.
        start: LogicalPosition::new(x + width, cat_y),
        entry_end: LogicalPosition::new(x + width - size.0 - 2.0, cat_y),
        contact: LogicalPosition::new(target_x - contact_offset.0, cat_y),
    })
}

#[derive(Clone)]
struct Scene {
    id: String,
    generation: u64,
    layout: Layout,
    reduced: bool,
    contacted: bool,
    close_completed: bool,
    motion_revision: u64,
}
static SCENE: Mutex<Option<Scene>> = Mutex::new(None);
static RETIRED: Mutex<std::collections::VecDeque<String>> =
    Mutex::new(std::collections::VecDeque::new());
static GENERATION: AtomicU64 = AtomicU64::new(0);

fn on_main<R: Send + 'static>(
    app: &AppHandle,
    work: impl FnOnce(MainThreadMarker) -> Result<R, String> + Send + 'static,
) -> Result<R, String> {
    if let Some(mtm) = MainThreadMarker::new() {
        return work(mtm);
    }
    let (send, recv) = std::sync::mpsc::sync_channel(1);
    app.run_on_main_thread(move || {
        let result = MainThreadMarker::new()
            .ok_or_else(|| "AppKit main thread unavailable".to_string())
            .and_then(work);
        let _ = send.send(result);
    })
    .map_err(|e| e.to_string())?;
    recv.recv_timeout(Duration::from_secs(1))
        .map_err(|_| "Full-screen presentation timed out".to_string())?
}

fn current(generation: u64) -> bool {
    SCENE
        .lock()
        .unwrap()
        .as_ref()
        .is_some_and(|scene| scene.generation == generation)
}

pub(super) fn accept_contact(id: &str, contacted: bool) -> bool {
    if RETIRED.lock().unwrap().iter().any(|old| old == id) {
        return false;
    }
    if let Some(scene) = SCENE.lock().unwrap().as_mut().filter(|s| s.id == id) {
        scene.contacted = contacted;
    }
    true
}

pub(super) fn close_completed(id: &str) {
    if let Some(scene) = SCENE.lock().unwrap().as_mut().filter(|s| s.id == id) {
        scene.close_completed = true;
    }
}

// AppKit can retain a panel on a full-screen Space after its auxiliary flag
// is removed. Keep resident visibility explicit, while an active scene owns
// its own presentation. Do not change the user's enabled/presence state.
pub(super) fn monitor_resident_visibility(app: AppHandle) {
    std::thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(250));
        if !PET_MODE_ENABLED.load(Ordering::Relaxed) || SCENE.lock().unwrap().is_some() {
            continue;
        }
        let suppressed = objc2::rc::autoreleasepool(|_| {
            super::super::companion_context::companion_informational_moments_suppressed()
        });
        let _ = set_panel_style(&app, None, false, if suppressed { 0.0 } else { 1.0 });
    });
}

fn set_panel_style(
    app: &AppHandle,
    generation: Option<u64>,
    enabled: bool,
    alpha: f64,
) -> Result<(), String> {
    let app_for_main = app.clone();
    on_main(app, move |_| {
        if generation.map_or_else(|| SCENE.lock().unwrap().is_some(), |id| !current(id)) {
            return Ok(());
        }
        if let Some(window) = app_for_main.get_webview_window(PET_MODE_WINDOW_LABEL) {
            let ptr = window.ns_window().map_err(|e| e.to_string())?;
            let ns = unsafe { &*ptr.cast::<NSWindow>() };
            if !enabled {
                if let Some(layer) = ns.contentView().and_then(|view| view.layer()) {
                    // SAFETY: removing the scene-owned mask on the main thread.
                    unsafe { layer.setMask(None) };
                }
            }
            let mut behavior = ns.collectionBehavior();
            behavior.set(NSWindowCollectionBehavior::FullScreenAuxiliary, enabled);
            if (ns.alphaValue() - alpha).abs() > 0.001 {
                ns.setAlphaValue(alpha);
            }
            if ns.collectionBehavior() != behavior {
                ns.setCollectionBehavior(behavior);
            }
        }
        Ok(())
    })
}

// Position and clip in one main-thread transaction: a partly entered cat is
// visible only on the target display, even with another display to its right.
fn position_entry_frame(
    app: &AppHandle,
    window: &WebviewWindow,
    generation: u64,
    revision: u64,
    desired: LogicalPosition<f64>,
    right_edge: f64,
) -> Result<(), String> {
    let window = window.clone();
    on_main(app, move |_| {
        if !current(generation) || !pet_window_motion_is_current(revision, None) {
            return Ok(());
        }
        let ptr = window.ns_window().map_err(|e| e.to_string())?;
        let ns = unsafe { &*ptr.cast::<NSWindow>() };
        let view = ns.contentView().ok_or("Pet panel has no content view")?;
        view.setWantsLayer(true);
        let layer = view.layer().ok_or("Pet panel has no content layer")?;
        let bounds = view.bounds();
        let visible_width = (right_edge - desired.x).clamp(0.0, bounds.size.width);
        let current_position = current_pet_logical_position(&window)?;
        let origin = ns.frame().origin;
        CATransaction::begin();
        CATransaction::setDisableActions(true);
        if visible_width < bounds.size.width {
            let mask = CALayer::new();
            mask.setBackgroundColor(Some(&NSColor::blackColor().CGColor()));
            mask.setFrame(NSRect::new(
                bounds.origin,
                NSSize::new(visible_width, bounds.size.height),
            ));
            // SAFETY: an independent, retained layer used solely as this mask.
            unsafe { layer.setMask(Some(&mask)) };
        } else {
            unsafe { layer.setMask(None) };
        }
        ns.setFrameOrigin(NSPoint::new(
            origin.x + desired.x - current_position.x,
            origin.y - (desired.y - current_position.y),
        ));
        CATransaction::commit();
        Ok(())
    })
}

pub(super) fn approach(
    app: &AppHandle,
    window: &WebviewWindow,
    target: &PetModeInterventionTarget,
    frame: (f64, f64, f64, f64),
    reduced: bool,
) -> Result<PetModeResolvedTarget, String> {
    let layout = layout(frame, pet_size(), pet_contact_offsets("left"))
        .ok_or_else(|| "Full-screen target has invalid bounds".to_string())?;
    let mut scene = Scene {
        id: target.id.clone(),
        generation: GENERATION.fetch_add(1, Ordering::Relaxed) + 1,
        layout,
        reduced,
        contacted: false,
        close_completed: false,
        motion_revision: 0,
    };
    {
        let mut slot = SCENE.lock().unwrap();
        if slot.is_some() {
            return Err("Full-screen intervention is already active".to_string());
        }
        cancel_pet_motion();
        scene.motion_revision = PET_MODE_MOTION_REVISION.load(Ordering::Relaxed);
        *slot = Some(scene.clone());
    }
    // A lost renderer must not leave the auxiliary pet panel indefinitely.
    let watchdog_app = app.clone();
    let generation = scene.generation;
    async_runtime::spawn(async move {
        watchdog_delay(SCENE_TIMEOUT).await;
        clear_generation(&watchdog_app, generation);
    });
    let result = (|| {
        let revision = scene.motion_revision;
        set_panel_style(app, Some(generation), true, 0.0)?;
        let entry_start = if reduced {
            layout.entry_end
        } else {
            layout.start
        };
        show_pet_panel_at_position(app, window, entry_start)?;
        emit_pet_event(window, json!({ "kind": "facing", "facing": "left" }))?;
        emit_pet_event(window, json!({ "kind": "motion", "motion": "walk" }))?;
        // Prepare the first clipped frame while the panel is still invisible.
        position_entry_frame(
            app,
            window,
            generation,
            revision,
            entry_start,
            layout.start.x,
        )?;
        thread::sleep(Duration::from_millis(34));
        set_panel_style(app, Some(generation), true, 1.0)?;
        let steps = if reduced { 1 } else { 36 };
        for step in 1..=steps {
            if !current(generation)
                || !PET_MODE_ENABLED.load(Ordering::Relaxed)
                || !pet_window_motion_is_current(revision, None)
            {
                return Ok(false);
            }
            let t = step as f64 / steps as f64;
            position_entry_frame(
                app,
                window,
                generation,
                revision,
                LogicalPosition::new(
                    entry_start.x + (layout.entry_end.x - entry_start.x) * t,
                    entry_start.y,
                ),
                layout.start.x,
            )?;
            if !reduced {
                thread::sleep(Duration::from_millis(16));
            }
        }
        if !current(generation) || !pet_window_motion_is_current(revision, None) {
            return Ok(false);
        }
        // Let the arrival read as three distinct beats before the chase.
        for (phase, duration) in [("pause", ENTRY_PAUSE), ("notice", NOTICE_HOLD)] {
            emit_pet_event(
                window,
                json!({
                    "kind": "fullscreen_beat", "id": target.id, "phase": phase,
                }),
            )?;
            let started = Instant::now();
            while started.elapsed() < duration {
                if !current(generation)
                    || !PET_MODE_ENABLED.load(Ordering::Relaxed)
                    || !pet_window_motion_is_current(revision, None)
                {
                    return Ok(false);
                }
                thread::sleep(Duration::from_millis(16));
            }
        }
        let distance = (layout.entry_end.x - layout.contact.x).abs();
        let completed = animate_pet_window_with_facing_guarded_and_purpose(
            window,
            layout.contact,
            "left",
            if reduced {
                f64::MAX
            } else {
                (distance / 2.0).max(PET_MODE_RUN_SPEED)
            },
            if reduced { 0.01 } else { 2.0 },
            "run",
            None,
            None,
            Some(revision),
        )?;
        if completed {
            if let Some(active) = SCENE.lock().unwrap().as_mut().filter(|s| s.generation == generation) {
                // The guarded run claimed exactly revision + 1. Never adopt
                // a later drag's revision when finish is queued behind it.
                active.motion_revision = revision.wrapping_add(1);
            }
        }
        Ok(completed)
    })();
    match result {
        Ok(completed) => Ok(PetModeResolvedTarget {
            facing: "left",
            target_kind: if target.browser_name.is_some() {
                PetModeTargetKind::BrowserTabClose
            } else {
                PetModeTargetKind::WindowClose
            },
            motion_outcome: if completed {
                PetModeTargetMotionOutcome::Completed
            } else {
                PetModeTargetMotionOutcome::Cancelled
            },
            confidence: PetModeTargetConfidence::High,
            diagnostic: "fullscreen_virtual_close".to_string(),
            target_x: layout.target_x,
            target_y: layout.target_y,
        }),
        Err(error) => {
            clear_generation(app, generation);
            Err(error)
        }
    }
}

// Keep the bounded watchdog sleep off the async executor.
async fn watchdog_delay(duration: Duration) {
    let _ = async_runtime::spawn_blocking(move || thread::sleep(duration)).await;
}

pub(super) fn finish(app: &AppHandle, id: &str, interrupted: bool) -> Result<bool, String> {
    let scene = SCENE
        .lock()
        .unwrap()
        .as_ref()
        .filter(|s| s.id == id)
        .cloned();
    let Some(scene) = scene else {
        return Ok(false);
    };
    let generation = scene.generation;
    let mut motion_revision = scene.motion_revision;
    // Contact acknowledges the paw frame; the main window still revalidates
    // and closes asynchronously. Wait for that result before choosing a return.
    if scene.contacted && !interrupted {
        // The scene watchdog bounds a lost client. Do not impose a second,
        // shorter timeout here: a slow fresh-target probe must not send the
        // cat home before the actual close result arrives.
        loop {
            let waiting = SCENE
                .lock()
                .unwrap()
                .as_ref()
                .is_some_and(|s| s.generation == generation && !s.close_completed);
            if !waiting || !pet_window_motion_is_current(motion_revision, None) {
                break;
            }
            thread::sleep(Duration::from_millis(25));
        }
    }
    let result = (|| {
        if current(generation) && !interrupted && PET_MODE_ENABLED.load(Ordering::Relaxed)
            && pet_window_motion_is_current(motion_revision, None)
        {
            if let Some(window) = app.get_webview_window(PET_MODE_WINDOW_LABEL) {
                let suppressed = super::super::companion_context::companion_informational_moments_suppressed();
                if suppressed && !scene.reduced {
                    if !animate_pet_window_with_facing_guarded_and_purpose(
                        &window, scene.layout.entry_end, "right", 1400.0, 0.8,
                        "run", None, None, Some(motion_revision),
                    )? {
                        return Ok(());
                    }
                    motion_revision = motion_revision.wrapping_add(1);
                }
                if !pet_window_motion_is_current(motion_revision, None) {
                    return Ok(());
                }
                if suppressed {
                    set_panel_style(app, Some(generation), true, 0.0)?;
                }
                let monitor = resolve_pet_home_monitor(app)
                    .ok_or_else(|| "No monitor is available for Pet Mode".to_string())?;
                let home = calculate_pet_home_position_with_nudge(Some(app), &monitor);
                let moved = if suppressed || scene.reduced {
                    set_pet_window_position_if_motion_current(&window, home, motion_revision)?
                } else {
                    let start = current_pet_logical_position(&window)?;
                    animate_pet_window_with_facing_guarded_and_purpose(
                        &window, home, if home.x >= start.x { "right" } else { "left" },
                        PET_MODE_WALK_SPEED, PET_MODE_WALK_MAX_SECONDS, "walk",
                        None, None, Some(motion_revision),
                    )?
                };
                if moved { motion_revision = motion_revision.wrapping_add(1); }
            }
        }
        Ok(())
    })();
    clear_generation_with_motion(app, generation, Some(motion_revision), !interrupted);
    result.map(|_| true)
}

pub(super) fn clear(app: &AppHandle) {
    let generation = SCENE.lock().unwrap().as_ref().map(|s| s.generation);
    if let Some(generation) = generation {
        clear_generation(app, generation);
    }
}

fn clear_generation(app: &AppHandle, generation: u64) {
    clear_generation_with_motion(app, generation, None, true);
}

fn clear_generation_with_motion(app: &AppHandle, generation: u64, expected_motion: Option<u64>, cancel_motion: bool) {
    let removed = {
        let mut slot = SCENE.lock().unwrap();
        if slot
            .as_ref()
            .is_some_and(|scene| scene.generation == generation)
        {
            // Retire motion before releasing the scene slot so a new approach
            // cannot be cancelled by the previous scene's delayed cleanup.
            let _motion_guard = PET_MODE_MOTION_START.lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if cancel_motion && claim_pet_motion_revision(&PET_MODE_MOTION_REVISION, expected_motion).is_some() {
                PET_MODE_ENTRY_ACTIVE.store(false, Ordering::Relaxed);
            }
            if let Some(scene) = slot.take() {
                let mut retired = RETIRED.lock().unwrap();
                retired.push_back(scene.id);
                while retired.len() > 32 {
                    retired.pop_front();
                }
            }
            true
        } else {
            false
        }
    };
    if !removed {
        return;
    }
    let suppressed = super::super::companion_context::companion_informational_moments_suppressed();
    let _ = set_panel_style(app, None, false, if suppressed { 0.0 } else { 1.0 });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn full_screen_layout_keeps_the_paw_at_the_left_edge_without_clipping_the_cat() {
        for frame in [
            (0.0, 0.0, 1440.0, 900.0),
            (-1920.0, -300.0, 1920.0, 1080.0),
            (1440.0, 200.0, 3840.0, 2160.0),
        ] {
            for scale in [0.75, 1.0, 1.5, 2.0] {
                let size = (144.0 * scale, 99.0 * scale);
                let offset = (scale, 40.0 * scale);
                let l = layout(frame, size, offset).unwrap();
                assert_eq!(l.start.x, frame.0 + frame.2);
                for p in [l.entry_end, l.contact] {
                    assert!(p.x >= frame.0 && p.x + size.0 <= frame.0 + frame.2);
                    assert!(p.y >= frame.1 + 48.0 && p.y + size.1 <= frame.1 + frame.3);
                }
                assert!((l.contact.x + offset.0 - l.target_x).abs() < 0.01);
                assert!((l.contact.y + offset.1 - l.target_y).abs() < 0.01);
                assert!((l.target_x - frame.0 - EDGE_CONTACT_INSET).abs() < 0.01);
                assert!(l.target_x < l.entry_end.x);
            }
        }
    }
    #[test]
    fn refuses_invalid_or_too_small_fullscreen_bounds() {
        for frame in [
            (f64::NAN, 0.0, 1440.0, 900.0),
            (0.0, 0.0, 200.0, 100.0),
            (0.0, 0.0, -1.0, 900.0),
        ] {
            assert!(layout(frame, (144.0, 99.0), (1.0, 40.0)).is_none());
        }
    }
}
