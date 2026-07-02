use std::sync::{Mutex, OnceLock};

use tauri::{AppHandle, LogicalSize, Manager};

#[cfg(target_os = "macos")]
use objc2_app_kit::{NSWindow, NSWindowButton};

use crate::MAIN_WINDOW_LABEL;

/// Logical size of the v2.1 onboarding card. In compact mode the whole window
/// shrinks to this so the card itself reads as the macOS window.
const ONBOARDING_CARD_WIDTH: f64 = 720.0;
const ONBOARDING_CARD_HEIGHT: f64 = 540.0;
/// Minimum window size from tauri.conf.json, restored once onboarding exits.
const DEFAULT_MIN_WIDTH: f64 = 960.0;
const DEFAULT_MIN_HEIGHT: f64 = 680.0;

/// Remembers the window size from before compact onboarding so it can be
/// restored afterwards.
fn saved_window_size() -> &'static Mutex<Option<LogicalSize<f64>>> {
    static SAVED: OnceLock<Mutex<Option<LogicalSize<f64>>>> = OnceLock::new();
    SAVED.get_or_init(|| Mutex::new(None))
}

/// Drive the main window's onboarding presentation.
///
/// `active` hides the macOS traffic lights so the flow reads as a clean window.
/// When `compact` is also set, the window shrinks and centers to the card size
/// so the onboarding card becomes the window itself; the prior size is restored
/// when onboarding exits.
#[tauri::command]
pub fn window_set_onboarding_presentation(
    app: AppHandle,
    active: bool,
    compact: bool,
) -> Result<(), String> {
    set_titlebar_controls_visible(&app, !active)?;

    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return Ok(());
    };

    if active && compact {
        let scale = window.scale_factor().map_err(|error| error.to_string())?;
        let current = window
            .inner_size()
            .map_err(|error| error.to_string())?
            .to_logical::<f64>(scale);
        if let Ok(mut saved) = saved_window_size().lock() {
            saved.get_or_insert(current);
        }
        window
            .set_resizable(false)
            .map_err(|error| error.to_string())?;
        window
            .set_min_size(Some(LogicalSize::new(
                ONBOARDING_CARD_WIDTH,
                ONBOARDING_CARD_HEIGHT,
            )))
            .map_err(|error| error.to_string())?;
        window
            .set_size(LogicalSize::new(
                ONBOARDING_CARD_WIDTH,
                ONBOARDING_CARD_HEIGHT,
            ))
            .map_err(|error| error.to_string())?;
        window.center().map_err(|error| error.to_string())?;
    } else if !active {
        let restore = saved_window_size().lock().ok().and_then(|mut s| s.take());
        window
            .set_min_size(Some(LogicalSize::new(
                DEFAULT_MIN_WIDTH,
                DEFAULT_MIN_HEIGHT,
            )))
            .map_err(|error| error.to_string())?;
        if let Some(size) = restore {
            window.set_size(size).map_err(|error| error.to_string())?;
            window.center().map_err(|error| error.to_string())?;
        }
        window
            .set_resizable(true)
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

#[cfg(target_os = "macos")]
fn set_titlebar_controls_visible(app: &AppHandle, visible: bool) -> Result<(), String> {
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let Some(window) = handle.get_webview_window(MAIN_WINDOW_LABEL) else {
            return;
        };
        let Ok(ptr) = window.ns_window() else {
            return;
        };
        // Safe: dispatched onto the macOS main thread, where touching the
        // NSWindow returned by Tauri is sound for the window's lifetime.
        let ns_window: &NSWindow = unsafe { &*ptr.cast::<NSWindow>() };
        for kind in [
            NSWindowButton::CloseButton,
            NSWindowButton::MiniaturizeButton,
            NSWindowButton::ZoomButton,
        ] {
            if let Some(button) = ns_window.standardWindowButton(kind) {
                button.setHidden(!visible);
            }
        }
    })
    .map_err(|error| error.to_string())
}

#[cfg(not(target_os = "macos"))]
fn set_titlebar_controls_visible(_app: &AppHandle, _visible: bool) -> Result<(), String> {
    Ok(())
}
