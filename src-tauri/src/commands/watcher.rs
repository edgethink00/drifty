use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, LogicalPosition, Manager, Monitor, WebviewUrl, WebviewWindowBuilder,
};

pub const WATCHER_PEEK_WINDOW_LABEL: &str = "watcher-peek";

const WATCHER_PEEK_WIDTH: f64 = 560.0;
const WATCHER_PEEK_HEIGHT: f64 = 340.0;
const WATCHER_PEEK_WORK_AREA_MARGIN: f64 = 32.0;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatcherPeekPayload {
    pub id: i64,
    pub productivity: String,
    pub category: String,
    pub context_label: String,
    pub duration_label: String,
    pub duration_seconds: i64,
    pub slot_index: i32,
    pub focus_session_kind: String,
    pub drift_pattern: String,
    pub drift_reminder_elapsed_seconds: Option<i64>,
    pub recent_watcher_response: Option<String>,
    pub minutes_since_last_watcher: Option<i64>,
    pub focus_seconds_today: i64,
    pub current_hour_focus_seconds: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatcherPeekResponsePayload {
    pub response: String,
}

pub fn setup_watcher_window(app: &tauri::App) -> tauri::Result<()> {
    let window = WebviewWindowBuilder::new(
        app,
        WATCHER_PEEK_WINDOW_LABEL,
        WebviewUrl::App("index.html".into()),
    )
    .title("")
    .inner_size(WATCHER_PEEK_WIDTH, WATCHER_PEEK_HEIGHT)
    .min_inner_size(WATCHER_PEEK_WIDTH, WATCHER_PEEK_HEIGHT)
    .max_inner_size(WATCHER_PEEK_WIDTH, WATCHER_PEEK_HEIGHT)
    .decorations(false)
    .shadow(false)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .focused(false)
    .focusable(false)
    .skip_taskbar(true)
    .always_on_top(true)
    .visible_on_all_workspaces(true)
    .transparent(true)
    .visible(false)
    .build()?;

    let _ = window.set_ignore_cursor_events(true);
    Ok(())
}

#[tauri::command]
pub fn watcher_peek_show(app: AppHandle, payload: WatcherPeekPayload) -> Result<(), String> {
    let window = app
        .get_webview_window(WATCHER_PEEK_WINDOW_LABEL)
        .ok_or_else(|| "watcher peek window is not available".to_string())?;

    position_watcher_window(&app, &payload)?;
    window
        .set_ignore_cursor_events(true)
        .map_err(|error| error.to_string())?;
    window
        .set_always_on_top(true)
        .map_err(|error| error.to_string())?;
    window
        .set_visible_on_all_workspaces(true)
        .map_err(|error| error.to_string())?;
    window
        .emit("watcher-peek-show", payload)
        .map_err(|error| error.to_string())?;
    window.show().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn watcher_peek_hide(app: AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window(WATCHER_PEEK_WINDOW_LABEL) else {
        return Ok(());
    };

    window
        .set_ignore_cursor_events(true)
        .map_err(|error| error.to_string())?;
    window.hide().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn watcher_peek_dismiss(app: AppHandle) -> Result<(), String> {
    watcher_peek_hide(app.clone())?;

    if let Some(main) = app.get_webview_window("main") {
        main.emit("watcher-peek-dismissed", ())
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn watcher_peek_set_interactive(app: AppHandle, interactive: bool) -> Result<(), String> {
    let Some(window) = app.get_webview_window(WATCHER_PEEK_WINDOW_LABEL) else {
        return Ok(());
    };

    window
        .set_ignore_cursor_events(!interactive)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn watcher_peek_respond(app: AppHandle, response: String) -> Result<(), String> {
    watcher_peek_hide(app.clone())?;

    if let Some(main) = app.get_webview_window("main") {
        main.emit(
            "watcher-peek-response",
            WatcherPeekResponsePayload { response },
        )
        .map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn position_watcher_window(app: &AppHandle, _payload: &WatcherPeekPayload) -> Result<(), String> {
    let Some(window) = app.get_webview_window(WATCHER_PEEK_WINDOW_LABEL) else {
        return Ok(());
    };
    let Some(monitor) = resolve_watcher_monitor(app) else {
        return Ok(());
    };

    let scale_factor = monitor.scale_factor();
    let work_area = monitor.work_area();
    let position = work_area.position.to_logical::<f64>(scale_factor);
    let size = work_area.size.to_logical::<f64>(scale_factor);
    let watcher_position =
        calculate_watcher_window_position(position.x, position.y, size.width, size.height);

    window
        .set_position(watcher_position)
        .map_err(|error| error.to_string())
}

fn calculate_watcher_window_position(
    work_area_x: f64,
    work_area_y: f64,
    work_area_width: f64,
    work_area_height: f64,
) -> LogicalPosition<f64> {
    LogicalPosition::new(
        work_area_x + ((work_area_width - WATCHER_PEEK_WIDTH) / 2.0).round(),
        work_area_y + work_area_height - WATCHER_PEEK_HEIGHT - WATCHER_PEEK_WORK_AREA_MARGIN,
    )
}

fn resolve_watcher_monitor(app: &AppHandle) -> Option<Monitor> {
    if let Ok(cursor) = app.cursor_position() {
        let primary_scale_factor = app
            .primary_monitor()
            .ok()
            .flatten()
            .map(|monitor| monitor.scale_factor())
            .unwrap_or(1.0);
        let cursor = cursor.to_logical::<f64>(primary_scale_factor);

        if let Ok(Some(monitor)) = app.monitor_from_point(cursor.x, cursor.y) {
            return Some(monitor);
        }
    }

    if let Some(main) = app.get_webview_window("main") {
        if let Ok(Some(monitor)) = main.current_monitor() {
            return Some(monitor);
        }
    }

    app.primary_monitor().ok().flatten()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn positions_watcher_above_work_area_bottom() {
        let position = calculate_watcher_window_position(0.0, 25.0, 1440.0, 775.0);

        assert_eq!(position.x, 440.0);
        assert_eq!(position.y, 428.0);
    }

    #[test]
    fn centers_watcher_inside_shifted_work_area() {
        let position = calculate_watcher_window_position(80.0, 0.0, 1360.0, 900.0);

        assert_eq!(position.x, 480.0);
        assert_eq!(position.y, 528.0);
    }
}
