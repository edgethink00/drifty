//! Animate the entire native HUD, including its material. Moving only the
//! WebView would clip the 36pt capsule and leave its backdrop popping in.
use super::PetQuickControlsLayout;
use crate::commands::pet_mode::current_pet_logical_position;
use crate::commands::pet_panel::show_pet_panel_at_position;
use objc2::MainThreadMarker;
use objc2_app_kit::{NSWindow, NSWorkspace};
use objc2_foundation::NSPoint;
use std::cell::RefCell;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::time::{Duration, Instant};
use tauri::{LogicalPosition, Manager, WebviewWindow};

const ENTER_MS: f64 = 200.0;
const EXIT_MS: f64 = 90.0;
const TRAVEL_PT: f64 = 4.0;
static GENERATION: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy)]
struct Presentation {
    anchor: (f64, f64),
    toward_pet: f64,
    visible: bool,
}

thread_local! {
    static PRESENTATION: RefCell<Option<Presentation>> = const { RefCell::new(None) };
}

pub(super) fn on_main<R: Send + 'static>(
    window: &WebviewWindow,
    work: impl FnOnce(WebviewWindow) -> Result<R, String> + Send + 'static,
) -> Result<R, String> {
    if MainThreadMarker::new().is_some() {
        return work(window.clone());
    }
    let (send, recv) = std::sync::mpsc::sync_channel(1);
    let owned = window.clone();
    window
        .run_on_main_thread(move || {
            let _ = send.send(work(owned));
        })
        .map_err(|error| error.to_string())?;
    recv.recv_timeout(Duration::from_secs(1))
        .map_err(|_| "Pet controls presentation timed out".to_string())?
}

// Call only on AppKit's main thread. Tauri retains the window for this borrow.
fn native(window: &WebviewWindow) -> Result<&NSWindow, String> {
    debug_assert!(MainThreadMarker::new().is_some());
    let ptr = window.ns_window().map_err(|error| error.to_string())?;
    Ok(unsafe { &*ptr.cast::<NSWindow>() })
}

fn eased_progress(elapsed_ms: f64, duration_ms: f64) -> f64 {
    let t = (elapsed_ms / duration_ms).clamp(0.0, 1.0);
    1.0 - (1.0 - t).powi(3)
}

pub(super) fn hide_immediately(window: &WebviewWindow) -> Result<(), String> {
    on_main(window, |window| {
        GENERATION.fetch_add(1, Ordering::Relaxed);
        PRESENTATION.with(|state| *state.borrow_mut() = None);
        let _ = window.set_ignore_cursor_events(true);
        window.hide().map_err(|error| error.to_string())?;
        native(&window)?.setAlphaValue(1.0);
        super::release_pet_quick_controls_interaction(window.app_handle());
        Ok(())
    })
}

pub(super) fn show(window: &WebviewWindow, layout: PetQuickControlsLayout) -> Result<(), String> {
    on_main(window, move |window| {
        let ns = native(&window)?;
        let was_visible = ns.isVisible();
        let current = current_pet_logical_position(&window)?;
        let frame = ns.frame();
        let anchor = (
            frame.origin.x + layout.x - current.x,
            frame.origin.y - (layout.y - current.y),
        );
        // AppKit Y grows upward: a below-cat HUD starts four points higher.
        let toward_pet = if layout.placement == "below" {
            TRAVEL_PT
        } else {
            -TRAVEL_PT
        };
        if !was_visible {
            ns.setAlphaValue(0.0);
            show_pet_panel_at_position(
                window.app_handle(),
                &window,
                LogicalPosition::new(layout.x, layout.y - toward_pet),
            )?;
        }
        let _ = window.set_ignore_cursor_events(false);
        let state = Presentation {
            anchor,
            toward_pet,
            visible: true,
        };
        PRESENTATION.with(|stored| *stored.borrow_mut() = Some(state));
        animate(&window, state, None)
    })
}

pub(super) fn hide(window: &WebviewWindow) -> Result<(), String> {
    hide_with_completion(window, None)
}

// Run on a worker: the renderer retains its confirmation until AppKit has
// actually hidden the last animation frame, rather than guessing with a timer.
pub(super) fn hide_and_wait(window: &WebviewWindow) -> Result<(), String> {
    let (send, recv) = channel();
    hide_with_completion(window, Some(send))?;
    recv.recv_timeout(Duration::from_secs(1))
        .map_err(|_| "Pet feedback dismissal did not finish".to_string())?
}

fn hide_with_completion(
    window: &WebviewWindow,
    completion: Option<Sender<Result<(), String>>>,
) -> Result<(), String> {
    on_main(window, move |window| {
        let state = PRESENTATION.with(|stored| {
            let mut stored = stored.borrow_mut();
            let state = stored.as_mut()?;
            if !state.visible {
                return None;
            }
            state.visible = false;
            Some(*state)
        });
        match state {
            Some(state) => animate(&window, state, completion),
            None => {
                // Feedback owns this dismissal. An earlier hover exit may
                // already have cleared presentation; settle it before replying.
                if let Some(completion) = completion {
                    let result = hide_immediately(&window);
                    let _ = completion.send(result.clone());
                    return result;
                }
                Ok(())
            }
        }
    })
}

// A menu/acknowledgement takes ownership of an already visible HUD. Settle it
// before AppKit enters menu tracking, and invalidate a pending hover dismissal.
pub(super) fn hold_visible(window: &WebviewWindow) -> Result<(), String> {
    on_main(window, |window| {
        let ns = native(&window)?;
        if !ns.isVisible() {
            return Ok(());
        }
        GENERATION.fetch_add(1, Ordering::Relaxed);
        PRESENTATION.with(|stored| {
            if let Some(state) = stored.borrow_mut().as_mut() {
                state.visible = true;
                ns.setFrameOrigin(NSPoint::new(state.anchor.0, state.anchor.1));
                ns.setAlphaValue(1.0);
            }
        });
        Ok(())
    })
}

// Locale/state updates may reposition the HUD mid-animation. Shift its anchor
// and current frame together without replaying the entrance or canceling exit.
pub(super) fn relocate(
    window: &WebviewWindow,
    layout: PetQuickControlsLayout,
) -> Result<(), String> {
    on_main(window, move |window| {
        let current = current_pet_logical_position(&window)?;
        let ns = native(&window)?;
        let frame = ns.frame();
        let next = (
            frame.origin.x + layout.x - current.x,
            frame.origin.y - (layout.y - current.y),
        );
        PRESENTATION.with(|stored| {
            if let Some(state) = stored.borrow_mut().as_mut() {
                // Moving anchor and frame together preserves the captured
                // animation offset relative to the anchor.
                let delta = (next.0 - state.anchor.0, next.1 - state.anchor.1);
                state.anchor = next;
                state.toward_pet = if layout.placement == "below" {
                    TRAVEL_PT
                } else {
                    -TRAVEL_PT
                };
                ns.setFrameOrigin(NSPoint::new(
                    frame.origin.x + delta.0,
                    frame.origin.y + delta.1,
                ));
            }
        });
        Ok(())
    })
}

fn animate(
    window: &WebviewWindow,
    state: Presentation,
    completion: Option<Sender<Result<(), String>>>,
) -> Result<(), String> {
    let ns = native(window)?;
    let generation = GENERATION.fetch_add(1, Ordering::Relaxed).wrapping_add(1);
    let start_alpha = ns.alphaValue();
    let start_offset = (
        ns.frame().origin.x - state.anchor.0,
        ns.frame().origin.y - state.anchor.1,
    );
    let target_alpha = if state.visible { 1.0 } else { 0.0 };
    // Cocoa exposes this preference even though the generated binding omits it.
    let reduce_motion: bool = unsafe {
        objc2::msg_send![
            &*NSWorkspace::sharedWorkspace(),
            accessibilityDisplayShouldReduceMotion
        ]
    };
    let duration = if reduce_motion {
        0.0
    } else if state.visible {
        ENTER_MS
    } else {
        EXIT_MS
    };
    if reduce_motion {
        ns.setAlphaValue(target_alpha);
        ns.setFrameOrigin(NSPoint::new(state.anchor.0, state.anchor.1));
        if !state.visible {
            let result = hide_immediately(window);
            if let Some(completion) = completion {
                let _ = completion.send(result.clone());
            }
            return result;
        }
        return Ok(());
    }
    let window = window.clone();
    std::thread::spawn(move || {
        let started = Instant::now();
        loop {
            std::thread::sleep(Duration::from_millis(16));
            if GENERATION.load(Ordering::Relaxed) != generation {
                break;
            }
            let elapsed = started.elapsed().as_secs_f64() * 1000.0;
            let progress = eased_progress(elapsed, duration);
            let finished = elapsed >= duration;
            let owned = window.clone();
            let frame_completion = completion.clone();
            if window
                .run_on_main_thread(move || {
                    if GENERATION.load(Ordering::Relaxed) != generation {
                        return;
                    }
                    let Ok(ns) = native(&owned) else {
                        return;
                    };
                    let Some(current) = PRESENTATION.with(|stored| *stored.borrow()) else {
                        return;
                    };
                    let target_offset = if current.visible {
                        0.0
                    } else {
                        current.toward_pet
                    };
                    ns.setAlphaValue(start_alpha + (target_alpha - start_alpha) * progress);
                    ns.setFrameOrigin(NSPoint::new(
                        current.anchor.0 + start_offset.0 * (1.0 - progress),
                        current.anchor.1
                            + start_offset.1
                            + (target_offset - start_offset.1) * progress,
                    ));
                    if finished && !current.visible {
                        let result = hide_immediately(&owned);
                        if let Some(completion) = frame_completion {
                            let _ = completion.send(result);
                        }
                    }
                })
                .is_err()
                || finished
            {
                break;
            }
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn motion_settles_without_overshoot_even_after_a_delayed_frame() {
        for duration in [ENTER_MS, EXIT_MS] {
            assert_eq!(eased_progress(0.0, duration), 0.0);
            assert_eq!(eased_progress(duration, duration), 1.0);
            assert_eq!(eased_progress(duration * 3.0, duration), 1.0);
            let samples: Vec<_> = (0..=20)
                .map(|i| eased_progress(duration * i as f64 / 20.0, duration))
                .collect();
            assert!(samples.windows(2).all(|pair| pair[0] <= pair[1]));
        }
    }
}
