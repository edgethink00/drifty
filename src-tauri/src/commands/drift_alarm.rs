use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, LogicalPosition, Manager, Monitor, State, WebviewUrl, WebviewWindowBuilder,
};

pub const DRIFT_ALARM_WINDOW_LABEL: &str = "drift-alarm";

const DRIFT_ALARM_WIDTH: f64 = 800.0;
const DRIFT_ALARM_HEIGHT: f64 = 440.0;
const DRIFT_ALARM_WORK_AREA_MARGIN: f64 = 36.0;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriftAlarmPayload {
    pub id: String,
    pub context_label: String,
    pub drift_duration_label: String,
    pub drift_duration_seconds: i64,
    pub preserved_focus_strike_label: String,
    pub preserved_focus_strike_seconds: i64,
    pub generated_at: String,
    pub break_options: Vec<i64>,
    pub focus_targets: Vec<DriftAlarmFocusTarget>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriftAlarmFocusTarget {
    pub target_id: String,
    pub label: String,
    pub detail: String,
    pub app_name: String,
    pub bundle_id: Option<String>,
    pub site_domain: Option<String>,
    pub site_title: Option<String>,
    pub icon_src: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum DriftAlarmAction {
    ReturnToFocus {
        #[serde(rename = "targetId")]
        target_id: String,
    },
    StartBreak { minutes: i64 },
    ManualCorrection,
    Settings,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriftAlarmActionPayload {
    pub action: DriftAlarmAction,
}

#[derive(Default)]
pub struct DriftAlarmState(Mutex<Option<DriftAlarmPayload>>);

pub fn setup_drift_alarm_window(app: &tauri::App) -> tauri::Result<()> {
    let window = WebviewWindowBuilder::new(
        app,
        DRIFT_ALARM_WINDOW_LABEL,
        WebviewUrl::App("index.html?driftySurface=drift-alarm".into()),
    )
    .title("")
    .inner_size(DRIFT_ALARM_WIDTH, DRIFT_ALARM_HEIGHT)
    .min_inner_size(DRIFT_ALARM_WIDTH, DRIFT_ALARM_HEIGHT)
    .max_inner_size(DRIFT_ALARM_WIDTH, DRIFT_ALARM_HEIGHT)
    .decorations(false)
    .shadow(false)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .focused(false)
    .focusable(true)
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
pub fn drift_alarm_show(
    app: AppHandle,
    state: State<'_, DriftAlarmState>,
    payload: DriftAlarmPayload,
) -> Result<(), String> {
    let window = app
        .get_webview_window(DRIFT_ALARM_WINDOW_LABEL)
        .ok_or_else(|| "drift alarm window is not available".to_string())?;

    set_current_alarm(&state, Some(payload.clone()))?;
    position_drift_alarm_window(&app)?;
    window
        .set_ignore_cursor_events(false)
        .map_err(|error| error.to_string())?;
    window
        .set_always_on_top(true)
        .map_err(|error| error.to_string())?;
    window
        .set_visible_on_all_workspaces(true)
        .map_err(|error| error.to_string())?;
    app.emit_to(DRIFT_ALARM_WINDOW_LABEL, "drift-alarm-show", payload)
        .map_err(|error| error.to_string())?;
    window.show().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn drift_alarm_current(
    state: State<'_, DriftAlarmState>,
) -> Result<Option<DriftAlarmPayload>, String> {
    state
        .0
        .lock()
        .map_err(|_| "drift alarm state lock poisoned".to_string())
        .map(|payload| payload.clone())
}

#[tauri::command]
pub fn drift_alarm_hide(app: AppHandle, state: State<'_, DriftAlarmState>) -> Result<(), String> {
    set_current_alarm(&state, None)?;
    hide_drift_alarm_window(&app)
}

#[tauri::command]
pub fn drift_alarm_dismiss(
    app: AppHandle,
    state: State<'_, DriftAlarmState>,
) -> Result<(), String> {
    set_current_alarm(&state, None)?;
    hide_drift_alarm_window(&app)?;

    app.emit_to("main", "drift-alarm-dismissed", ())
        .map_err(|error| error.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn drift_alarm_action(
    app: AppHandle,
    state: State<'_, DriftAlarmState>,
    action: DriftAlarmAction,
) -> Result<(), String> {
    set_current_alarm(&state, None)?;
    hide_drift_alarm_window(&app)?;

    app.emit_to(
        "main",
        "drift-alarm-action",
        DriftAlarmActionPayload { action },
    )
    .map_err(|error| error.to_string())?;

    Ok(())
}

fn hide_drift_alarm_window(app: &AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window(DRIFT_ALARM_WINDOW_LABEL) else {
        return Ok(());
    };

    window
        .set_ignore_cursor_events(true)
        .map_err(|error| error.to_string())?;
    window.hide().map_err(|error| error.to_string())
}

fn set_current_alarm(
    state: &State<'_, DriftAlarmState>,
    payload: Option<DriftAlarmPayload>,
) -> Result<(), String> {
    let mut current = state
        .0
        .lock()
        .map_err(|_| "drift alarm state lock poisoned".to_string())?;
    *current = payload;
    Ok(())
}

fn position_drift_alarm_window(app: &AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window(DRIFT_ALARM_WINDOW_LABEL) else {
        return Ok(());
    };
    let Some(monitor) = resolve_drift_alarm_monitor(app) else {
        return Ok(());
    };

    let scale_factor = monitor.scale_factor();
    let work_area = monitor.work_area();
    let position = work_area.position.to_logical::<f64>(scale_factor);
    let size = work_area.size.to_logical::<f64>(scale_factor);
    let alarm_position =
        calculate_drift_alarm_window_position(position.x, position.y, size.width, size.height);

    window
        .set_position(alarm_position)
        .map_err(|error| error.to_string())
}

fn calculate_drift_alarm_window_position(
    work_area_x: f64,
    work_area_y: f64,
    work_area_width: f64,
    _work_area_height: f64,
) -> LogicalPosition<f64> {
    LogicalPosition::new(
        work_area_x + work_area_width - DRIFT_ALARM_WIDTH - DRIFT_ALARM_WORK_AREA_MARGIN,
        work_area_y + DRIFT_ALARM_WORK_AREA_MARGIN,
    )
}

fn resolve_drift_alarm_monitor(app: &AppHandle) -> Option<Monitor> {
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
    fn positions_alarm_near_work_area_top_right() {
        let position = calculate_drift_alarm_window_position(0.0, 25.0, 1440.0, 775.0);

        assert_eq!(position.x, 604.0);
        assert_eq!(position.y, 61.0);
    }

    #[test]
    fn keeps_alarm_inside_shifted_work_area() {
        let position = calculate_drift_alarm_window_position(80.0, 0.0, 1360.0, 900.0);

        assert_eq!(position.x, 604.0);
        assert_eq!(position.y, 36.0);
    }
}
