use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{
    window::{Effect, EffectState, EffectsBuilder},
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Monitor, State, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder,
};

pub const DRIFT_ALARM_WINDOW_LABEL: &str = "drift-alarm";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriftAlarmPayload {
    pub id: String,
    pub mode: DriftAlarmMode,
    pub context_label: String,
    pub drift_duration_label: String,
    pub drift_duration_seconds: i64,
    pub preserved_focus_strike_label: String,
    pub preserved_focus_strike_seconds: i64,
    pub generated_at: String,
    pub break_options: Vec<i64>,
    pub focus_targets: Vec<DriftAlarmFocusTarget>,
    pub break_return: Option<DriftAlarmBreakReturnDetails>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DriftAlarmMode {
    Drift,
    BreakReturn,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriftAlarmBreakReturnDetails {
    pub break_duration_minutes: i64,
    pub break_duration_label: String,
    pub paused_from_label: String,
    pub next_focus_label: String,
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
    .effects(
        EffectsBuilder::new()
            .effect(Effect::UnderWindowBackground)
            .state(EffectState::Active)
            .build(),
    )
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
    resize_drift_alarm_window(&window, size.width, size.height)?;

    window
        .set_position(alarm_position)
        .map_err(|error| error.to_string())
}

fn resize_drift_alarm_window(window: &WebviewWindow, width: f64, height: f64) -> Result<(), String> {
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

fn calculate_drift_alarm_window_position(
    work_area_x: f64,
    work_area_y: f64,
    work_area_width: f64,
    work_area_height: f64,
) -> LogicalPosition<f64> {
    let _ = (work_area_width, work_area_height);
    LogicalPosition::new(work_area_x, work_area_y)
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
    fn positions_alarm_overlay_at_work_area_origin() {
        let position = calculate_drift_alarm_window_position(0.0, 25.0, 1440.0, 775.0);

        assert_eq!(position.x, 0.0);
        assert_eq!(position.y, 25.0);
    }

    #[test]
    fn positions_alarm_overlay_at_shifted_work_area_origin() {
        let position = calculate_drift_alarm_window_position(80.0, 0.0, 1360.0, 900.0);

        assert_eq!(position.x, 80.0);
        assert_eq!(position.y, 0.0);
    }
}
