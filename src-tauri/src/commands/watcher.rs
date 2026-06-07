use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Monitor, WebviewUrl,
    WebviewWindowBuilder,
};

pub const WATCHER_PEEK_WINDOW_LABEL: &str = "watcher-peek";

const WATCHER_PEEK_WIDTH: f64 = 560.0;
const WATCHER_PEEK_HEIGHT: f64 = 340.0;
const END_OF_DAY_REVIEW_WIDTH: f64 = 560.0;
const END_OF_DAY_REVIEW_HEIGHT: f64 = 620.0;
const WATCHER_PEEK_WORK_AREA_MARGIN: f64 = 32.0;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatcherPeekResponsePayload {
    pub response: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EndOfDayReviewActionPayload {
    pub action: String,
}

pub fn setup_watcher_window(app: &tauri::App) -> tauri::Result<()> {
    let window = WebviewWindowBuilder::new(
        app,
        WATCHER_PEEK_WINDOW_LABEL,
        WebviewUrl::App("index.html?driftySurface=watcher".into()),
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
pub fn watcher_peek_show(app: AppHandle, payload: Value) -> Result<(), String> {
    let window = app
        .get_webview_window(WATCHER_PEEK_WINDOW_LABEL)
        .ok_or_else(|| "watcher peek window is not available".to_string())?;

    resize_watcher_window(&app, &payload)?;
    position_watcher_window(&app, &payload)?;
    window
        .set_ignore_cursor_events(should_ignore_cursor_events_for_payload(&payload))
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

fn reveal_main_window_for_review_action(app: &AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.unminimize();
        let _ = main.show();
        let _ = main.set_focus();
    }
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

#[tauri::command]
pub fn watcher_peek_end_of_day_review_action(
    app: AppHandle,
    action: String,
) -> Result<(), String> {
    watcher_peek_hide(app.clone())?;
    reveal_main_window_for_review_action(&app);

    if let Some(main) = app.get_webview_window("main") {
        main.emit(
            "end-of-day-review-action",
            EndOfDayReviewActionPayload { action },
        )
        .map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn position_watcher_window(app: &AppHandle, payload: &Value) -> Result<(), String> {
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
    let watcher_position = if is_end_of_day_review_payload(payload) {
        calculate_end_of_day_review_window_position(position.x, position.y, size.width, size.height)
    } else {
        calculate_watcher_window_position(position.x, position.y, size.width, size.height)
    };

    window
        .set_position(watcher_position)
        .map_err(|error| error.to_string())
}

fn resize_watcher_window(app: &AppHandle, payload: &Value) -> Result<(), String> {
    let Some(window) = app.get_webview_window(WATCHER_PEEK_WINDOW_LABEL) else {
        return Ok(());
    };
    let (width, height) = watcher_window_dimensions_for_payload(payload);
    let target_size = LogicalSize::new(width, height);

    window
        .set_min_size(None::<LogicalSize<f64>>)
        .map_err(|error| error.to_string())?;
    window
        .set_max_size(None::<LogicalSize<f64>>)
        .map_err(|error| error.to_string())?;
    window
        .set_size(target_size)
        .map_err(|error| error.to_string())?;
    window
        .set_min_size(Some(target_size))
        .map_err(|error| error.to_string())?;
    window
        .set_max_size(Some(target_size))
        .map_err(|error| error.to_string())
}

fn watcher_window_dimensions_for_payload(payload: &Value) -> (f64, f64) {
    if is_end_of_day_review_payload(payload) {
        (END_OF_DAY_REVIEW_WIDTH, END_OF_DAY_REVIEW_HEIGHT)
    } else {
        (WATCHER_PEEK_WIDTH, WATCHER_PEEK_HEIGHT)
    }
}

fn should_ignore_cursor_events_for_payload(payload: &Value) -> bool {
    !is_end_of_day_review_payload(payload)
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

fn calculate_end_of_day_review_window_position(
    work_area_x: f64,
    work_area_y: f64,
    work_area_width: f64,
    work_area_height: f64,
) -> LogicalPosition<f64> {
    let available_x = (work_area_width - END_OF_DAY_REVIEW_WIDTH).max(0.0);
    let available_y = (work_area_height - END_OF_DAY_REVIEW_HEIGHT).max(0.0);
    let x_margin = WATCHER_PEEK_WORK_AREA_MARGIN.min(available_x);
    let y_margin = WATCHER_PEEK_WORK_AREA_MARGIN.min(available_y);

    LogicalPosition::new(
        work_area_x + available_x - x_margin,
        work_area_y + y_margin,
    )
}

fn is_end_of_day_review_payload(payload: &Value) -> bool {
    matches!(payload.get("placement").and_then(Value::as_str), Some("top-right"))
        || matches!(
            payload.get("kind").and_then(Value::as_str),
            Some("endOfDayReview")
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

    #[test]
    fn positions_end_of_day_review_top_right_in_work_area() {
        let position = calculate_end_of_day_review_window_position(0.0, 25.0, 1440.0, 775.0);

        assert_eq!(position.x, 848.0);
        assert_eq!(position.y, 57.0);
    }

    #[test]
    fn sizes_end_of_day_review_as_redesigned_review_panel() {
        let payload = serde_json::json!({"kind": "endOfDayReview"});
        let (width, height) = watcher_window_dimensions_for_payload(&payload);

        assert_eq!(width, 560.0);
        assert_eq!(height, 620.0);
    }

    #[test]
    fn keeps_normal_watcher_peek_size_for_standard_payloads() {
        let payload = serde_json::json!({"kind": "watcherPeek"});
        let (width, height) = watcher_window_dimensions_for_payload(&payload);

        assert_eq!(width, WATCHER_PEEK_WIDTH);
        assert_eq!(height, WATCHER_PEEK_HEIGHT);
    }

    #[test]
    fn keeps_end_of_day_review_inside_shifted_work_area_when_space_allows() {
        let position = calculate_end_of_day_review_window_position(80.0, 24.0, 1360.0, 900.0);

        assert_eq!(position.x, 848.0);
        assert_eq!(position.y, 56.0);
    }

    #[test]
    fn detects_end_of_day_review_payload_by_kind() {
        let payload = serde_json::json!({"kind": "endOfDayReview"});

        assert!(is_end_of_day_review_payload(&payload));
    }

    #[test]
    fn detects_end_of_day_review_payload_by_placement() {
        let payload = serde_json::json!({"placement": "top-right"});

        assert!(is_end_of_day_review_payload(&payload));
    }

    #[test]
    fn does_not_detect_normal_watcher_payload() {
        let payload = serde_json::json!({
            "kind": "watcherPeek",
            "placement": "bottom-left"
        });

        assert!(!is_end_of_day_review_payload(&payload));
    }

    #[test]
    fn end_of_day_review_payload_accepts_cursor_events() {
        let payload = serde_json::json!({"kind": "endOfDayReview"});

        assert!(!should_ignore_cursor_events_for_payload(&payload));
    }

    #[test]
    fn normal_watcher_payload_ignores_cursor_events() {
        let payload = serde_json::json!({"kind": "watcherPeek"});

        assert!(should_ignore_cursor_events_for_payload(&payload));
    }
}
