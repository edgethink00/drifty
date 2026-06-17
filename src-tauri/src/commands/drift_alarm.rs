use std::{process::Command, sync::Mutex};

use serde::{Deserialize, Serialize};
use tauri::{
    window::{Effect, EffectState, EffectsBuilder},
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Monitor, State, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder,
};

pub const DRIFT_ALARM_WINDOW_LABEL: &str = "drift-alarm";
const DRIFTY_BUNDLE_ID: &str = "so.drifty.mac";

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
    pub source_site_domain: Option<String>,
    pub source_app_name: String,
    pub source_icon_src: Option<String>,
    pub copy: Option<DriftAlarmCopy>,
    pub source_segment_id: Option<String>,
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
#[serde(rename_all = "camelCase")]
pub struct DriftAlarmCopy {
    pub title: String,
    pub summary: String,
    pub context_pills: Vec<String>,
    pub return_to_focus_label: String,
    pub break_choice_label: String,
    pub no_focus_target_label: String,
    pub back_to_dashboard_label: String,
    pub manual_correction_label: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum DriftAlarmAction {
    ReturnToFocus {
        #[serde(rename = "targetId")]
        target_id: String,
    },
    StartBreak {
        minutes: i64,
    },
    ManualCorrection,
    Settings,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriftAlarmActionPayload {
    pub action: DriftAlarmAction,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct PreviousFrontmostApp {
    bundle_id: String,
}

#[derive(Default)]
struct DriftAlarmRuntimeState {
    current_alarm: Option<DriftAlarmPayload>,
    previous_frontmost_app: Option<PreviousFrontmostApp>,
}

#[derive(Default)]
pub struct DriftAlarmState(Mutex<DriftAlarmRuntimeState>);

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

    set_current_alarm(
        &state,
        Some(payload.clone()),
        capture_previous_frontmost_app(),
    )?;
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
        .map(|runtime| runtime.current_alarm.clone())
}

#[tauri::command]
pub fn drift_alarm_hide(app: AppHandle, state: State<'_, DriftAlarmState>) -> Result<(), String> {
    set_current_alarm(&state, None, None)?;
    hide_drift_alarm_window(&app)
}

#[tauri::command]
pub fn drift_alarm_dismiss(
    app: AppHandle,
    state: State<'_, DriftAlarmState>,
) -> Result<(), String> {
    let previous_frontmost_app = clear_alarm_and_take_previous_frontmost_app(&state)?;
    hide_drift_alarm_window(&app)?;

    let emit_result = app
        .emit_to("main", "drift-alarm-dismissed", ())
        .map_err(|error| error.to_string());

    restore_previous_frontmost_app(previous_frontmost_app);

    emit_result?;

    Ok(())
}

#[tauri::command]
pub fn drift_alarm_action(
    app: AppHandle,
    state: State<'_, DriftAlarmState>,
    action: DriftAlarmAction,
) -> Result<(), String> {
    let should_restore_previous_frontmost_app =
        should_restore_previous_frontmost_app_for_action(&action);
    let previous_frontmost_app = clear_alarm_and_take_previous_frontmost_app(&state)?;
    hide_drift_alarm_window(&app)?;

    let emit_result = app
        .emit_to(
            "main",
            "drift-alarm-action",
            DriftAlarmActionPayload { action },
        )
        .map_err(|error| error.to_string());

    if should_restore_previous_frontmost_app {
        restore_previous_frontmost_app(previous_frontmost_app);
    }

    emit_result?;

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
    previous_frontmost_app: Option<PreviousFrontmostApp>,
) -> Result<(), String> {
    let mut runtime = state
        .0
        .lock()
        .map_err(|_| "drift alarm state lock poisoned".to_string())?;
    runtime.current_alarm = payload;
    runtime.previous_frontmost_app = previous_frontmost_app;
    Ok(())
}

fn clear_alarm_and_take_previous_frontmost_app(
    state: &State<'_, DriftAlarmState>,
) -> Result<Option<PreviousFrontmostApp>, String> {
    let mut runtime = state
        .0
        .lock()
        .map_err(|_| "drift alarm state lock poisoned".to_string())?;
    runtime.current_alarm = None;
    Ok(runtime.previous_frontmost_app.take())
}

fn should_restore_previous_frontmost_app_for_action(action: &DriftAlarmAction) -> bool {
    matches!(action, DriftAlarmAction::StartBreak { .. })
}

fn previous_frontmost_app_from_bundle_id(bundle_id: &str) -> Option<PreviousFrontmostApp> {
    normalize_previous_frontmost_app_bundle_id(bundle_id)
        .map(|bundle_id| PreviousFrontmostApp { bundle_id })
}

fn normalize_previous_frontmost_app_bundle_id(bundle_id: &str) -> Option<String> {
    let trimmed = bundle_id.trim();
    if trimmed.is_empty()
        || trimmed == "missing value"
        || trimmed == DRIFTY_BUNDLE_ID
        || is_non_restorable_system_bundle_id(trimmed)
    {
        return None;
    }

    Some(trimmed.to_string())
}

fn is_non_restorable_system_bundle_id(bundle_id: &str) -> bool {
    matches!(
        bundle_id,
        "com.apple.exposelauncher"
            | "com.apple.dock"
            | "com.apple.loginwindow"
            | "com.apple.Spotlight"
            | "com.apple.controlcenter"
            | "com.apple.notificationcenterui"
            | "com.apple.systemuiserver"
    )
}

fn parse_lsappinfo_bundle_id(output: &str) -> Option<String> {
    output.lines().find_map(|line| {
        let line = line.trim();
        let bundle_id = line.strip_prefix("\"bundleID\"=")?.trim().trim_matches('"');
        normalize_previous_frontmost_app_bundle_id(bundle_id)
    })
}

#[cfg(target_os = "macos")]
fn capture_previous_frontmost_app() -> Option<PreviousFrontmostApp> {
    capture_frontmost_bundle_id_with_system_events()
        .or_else(capture_frontmost_bundle_id_with_lsappinfo)
        .and_then(|bundle_id| previous_frontmost_app_from_bundle_id(&bundle_id))
}

#[cfg(not(target_os = "macos"))]
fn capture_previous_frontmost_app() -> Option<PreviousFrontmostApp> {
    None
}

#[cfg(target_os = "macos")]
fn capture_frontmost_bundle_id_with_system_events() -> Option<String> {
    let output = Command::new("osascript")
        .args([
            "-e",
            "tell application \"System Events\" to get bundle identifier of first application process whose frontmost is true",
        ])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    String::from_utf8(output.stdout)
        .ok()
        .and_then(|bundle_id| normalize_previous_frontmost_app_bundle_id(&bundle_id))
}

#[cfg(target_os = "macos")]
fn capture_frontmost_bundle_id_with_lsappinfo() -> Option<String> {
    let front_output = Command::new("lsappinfo").arg("front").output().ok()?;
    if !front_output.status.success() {
        return None;
    }

    let front = String::from_utf8(front_output.stdout).ok()?;
    if front.contains("NULL") {
        return None;
    }

    let asn = front.trim().trim_matches(['[', ']']).trim();
    if asn.is_empty() {
        return None;
    }

    let info_output = Command::new("lsappinfo")
        .args(["info", asn])
        .output()
        .ok()?;
    if !info_output.status.success() {
        return None;
    }

    String::from_utf8(info_output.stdout)
        .ok()
        .and_then(|info| parse_lsappinfo_bundle_id(&info))
}

fn restore_previous_frontmost_app(previous_frontmost_app: Option<PreviousFrontmostApp>) {
    let Some(previous_frontmost_app) = previous_frontmost_app else {
        return;
    };

    if let Err(error) = activate_app_by_bundle_id(&previous_frontmost_app.bundle_id) {
        eprintln!("Failed to restore previous frontmost app: {error}");
    }
}

#[cfg(target_os = "macos")]
fn activate_app_by_bundle_id(bundle_id: &str) -> Result<(), String> {
    let bundle_id = normalize_previous_frontmost_app_bundle_id(bundle_id)
        .ok_or_else(|| "Previous frontmost app bundle id is not restorable".to_string())?;
    match Command::new("open").args(["-b", &bundle_id]).status() {
        Ok(status) if status.success() => Ok(()),
        Ok(status) => Err(format!("Previous frontmost app returned status {status}")),
        Err(error) => Err(error.to_string()),
    }
}

#[cfg(not(target_os = "macos"))]
fn activate_app_by_bundle_id(_bundle_id: &str) -> Result<(), String> {
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

fn resize_drift_alarm_window(
    window: &WebviewWindow,
    width: f64,
    height: f64,
) -> Result<(), String> {
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

    #[test]
    fn previous_frontmost_bundle_id_rejects_blank_missing_and_drifty() {
        assert_eq!(normalize_previous_frontmost_app_bundle_id("   "), None);
        assert_eq!(
            normalize_previous_frontmost_app_bundle_id("missing value"),
            None
        );
        assert_eq!(
            normalize_previous_frontmost_app_bundle_id(DRIFTY_BUNDLE_ID),
            None
        );
    }

    #[test]
    fn previous_frontmost_bundle_id_rejects_system_transient_overlay_bundles() {
        // Given: macOS transient or system overlay bundle identifiers.
        let bundle_ids = [
            "com.apple.exposelauncher",
            "com.apple.dock",
            "com.apple.loginwindow",
            "com.apple.Spotlight",
            "com.apple.controlcenter",
            "com.apple.notificationcenterui",
            "com.apple.systemuiserver",
        ];

        for bundle_id in bundle_ids {
            // When: the previous frontmost bundle id is normalized.
            let normalized = normalize_previous_frontmost_app_bundle_id(bundle_id);

            // Then: it is rejected as non-restorable.
            assert_eq!(normalized, None, "{bundle_id} should not be restorable");
        }
    }

    #[test]
    fn previous_frontmost_bundle_id_trims_restorable_apps() {
        assert_eq!(
            normalize_previous_frontmost_app_bundle_id("  com.google.Chrome\n"),
            Some("com.google.Chrome".to_string())
        );
    }

    #[test]
    fn previous_frontmost_restore_only_runs_for_break_actions() {
        assert!(should_restore_previous_frontmost_app_for_action(
            &DriftAlarmAction::StartBreak { minutes: 15 }
        ));
        assert!(!should_restore_previous_frontmost_app_for_action(
            &DriftAlarmAction::ReturnToFocus {
                target_id: "app:com.microsoft.VSCode".to_string(),
            }
        ));
        assert!(!should_restore_previous_frontmost_app_for_action(
            &DriftAlarmAction::ManualCorrection
        ));
        assert!(!should_restore_previous_frontmost_app_for_action(
            &DriftAlarmAction::Settings
        ));
    }

    #[test]
    fn previous_frontmost_app_is_built_from_restorable_bundle_id() {
        assert_eq!(
            previous_frontmost_app_from_bundle_id("com.apple.Safari"),
            Some(PreviousFrontmostApp {
                bundle_id: "com.apple.Safari".to_string(),
            })
        );
        assert_eq!(
            previous_frontmost_app_from_bundle_id(DRIFTY_BUNDLE_ID),
            None
        );
    }

    #[test]
    fn lsappinfo_bundle_id_parser_finds_restorable_bundle_id() {
        let output = r#"
            "name"="Google Chrome"
            "bundleID"="com.google.Chrome"
        "#;

        assert_eq!(
            parse_lsappinfo_bundle_id(output),
            Some("com.google.Chrome".to_string())
        );
    }

    #[test]
    fn lsappinfo_bundle_id_parser_rejects_drifty_bundle_id() {
        let output = r#"
            "name"="drifty"
            "bundleID"="so.drifty.mac"
        "#;

        assert_eq!(parse_lsappinfo_bundle_id(output), None);
    }
}
