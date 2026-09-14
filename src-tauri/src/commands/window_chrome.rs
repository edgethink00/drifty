use std::sync::{Mutex, OnceLock};

use tauri::{AppHandle, LogicalSize, Manager, Theme};

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
/// Default sizes on either side of the dashboard's 804px compact boundary.
const DEFAULT_MAIN_WINDOW_WIDTH: f64 = 1254.0;
const DEFAULT_MAIN_WINDOW_COMPACT_HEIGHT: f64 = 800.0;
const DEFAULT_MAIN_WINDOW_ROOMY_HEIGHT: f64 = 809.0;
/// A roomy default should not merely fit: it should leave about 80 logical
/// pixels on both sides of each axis when centered. This separates spacious
/// work areas from tighter ones without relying on model names or physical
/// diagonal size.
const DEFAULT_MAIN_WINDOW_ROOMY_HEADROOM: f64 = 160.0;

fn work_area_supports_roomy_default(work_area_width: f64, work_area_height: f64) -> bool {
    work_area_width >= DEFAULT_MAIN_WINDOW_WIDTH + DEFAULT_MAIN_WINDOW_ROOMY_HEADROOM
        && work_area_height >= DEFAULT_MAIN_WINDOW_ROOMY_HEIGHT + DEFAULT_MAIN_WINDOW_ROOMY_HEADROOM
}

fn calibrated_main_window_size(work_area_width: f64, work_area_height: f64) -> LogicalSize<f64> {
    let preferred_height = if work_area_supports_roomy_default(work_area_width, work_area_height) {
        DEFAULT_MAIN_WINDOW_ROOMY_HEIGHT
    } else {
        DEFAULT_MAIN_WINDOW_COMPACT_HEIGHT
    };

    LogicalSize::new(
        DEFAULT_MAIN_WINDOW_WIDTH.min(work_area_width.max(DEFAULT_MIN_WIDTH)),
        preferred_height.min(work_area_height.max(DEFAULT_MIN_HEIGHT)),
    )
}

/// Fit the hidden main window to the monitor's current safe work area before
/// it is revealed. This is intentionally a launch-time default, not a listener:
/// moving displays or resizing the window remains fully under user control.
pub(crate) fn calibrate_main_window_to_work_area(app: &AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
            return Ok(());
        };
        let monitor = match window.current_monitor() {
            Ok(Some(monitor)) => Some(monitor),
            Ok(None) | Err(_) => window
                .primary_monitor()
                .map_err(|error| error.to_string())?,
        };
        let Some(monitor) = monitor else {
            return Ok(());
        };
        let work_area = monitor
            .work_area()
            .size
            .to_logical::<f64>(monitor.scale_factor());
        let target = calibrated_main_window_size(work_area.width, work_area.height);
        let scale = window.scale_factor().map_err(|error| error.to_string())?;
        let current = window
            .inner_size()
            .map_err(|error| error.to_string())?
            .to_logical::<f64>(scale);

        if (current.width - target.width).abs() > 0.5
            || (current.height - target.height).abs() > 0.5
        {
            window.set_size(target).map_err(|error| error.to_string())?;
        }
    }

    #[cfg(not(target_os = "macos"))]
    let _ = app;

    Ok(())
}

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

/// Pin the main window's appearance to the app's own theme.
///
/// The native shell material renders in the window's effective appearance. When
/// the app runs its dark theme on a light system (or the reverse), an unpinned
/// window makes macOS draw the light material under a dark tint, which reads as
/// a flat opaque slab instead of glass.
#[tauri::command]
pub fn window_set_theme_appearance(app: AppHandle, dark: bool) -> Result<(), String> {
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let Some(window) = handle.get_webview_window(MAIN_WINDOW_LABEL) else {
            return;
        };
        // Appearance is cosmetic; a failure must not take down theming.
        let _ = window.set_theme(Some(if dark { Theme::Dark } else { Theme::Light }));
    })
    .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_size(actual: LogicalSize<f64>, width: f64, height: f64) {
        assert_eq!(actual.width, width);
        assert_eq!(actual.height, height);
    }

    #[test]
    fn roomy_work_areas_use_the_six_rank_default() {
        assert_size(calibrated_main_window_size(1680.0, 1084.0), 1254.0, 809.0);
        assert_size(calibrated_main_window_size(1920.0, 1080.0), 1254.0, 809.0);
        assert_size(calibrated_main_window_size(1414.0, 969.0), 1254.0, 809.0);
    }

    #[test]
    fn either_missing_headroom_keeps_the_five_rank_default() {
        assert_size(calibrated_main_window_size(1413.0, 1084.0), 1254.0, 800.0);
        assert_size(calibrated_main_window_size(1680.0, 968.0), 1254.0, 800.0);
    }

    #[test]
    fn compact_work_areas_use_the_safe_area_without_creating_avoidable_scroll() {
        assert_size(calibrated_main_window_size(1280.0, 800.0), 1254.0, 800.0);
        assert_size(calibrated_main_window_size(1100.0, 760.0), 1100.0, 760.0);
    }

    #[test]
    fn undersized_work_areas_never_break_the_existing_minimum() {
        assert_size(calibrated_main_window_size(980.0, 700.0), 980.0, 700.0);
        assert_size(calibrated_main_window_size(900.0, 640.0), 960.0, 680.0);
        assert_size(calibrated_main_window_size(0.0, 0.0), 960.0, 680.0);
    }
}
