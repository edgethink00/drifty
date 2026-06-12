use std::sync::Mutex;

use serde::Deserialize;
use tauri::image::Image;
use tauri::menu::{Menu, MenuBuilder, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::donut_icon;
use crate::tracker::TrackerController;
use crate::{reveal_main_window, MAIN_WINDOW_LABEL};

const TRAY_ID: &str = "drifty-menu";
const MENU_APP_INFO: &str = "menu-app-info";
const MENU_UPDATE_STATUS: &str = "menu-update-status";
const MENU_OPEN: &str = "menu-open-dashboard";
const MENU_TRACKING_TOGGLE: &str = "menu-tracking-toggle";
const MENU_DRIFT_ALERTS_STATUS: &str = "menu-drift-alerts-status";
const MENU_DRIFT_LAST_CHECK: &str = "menu-drift-last-check";
const MENU_DRIFT_RESULT: &str = "menu-drift-result";
const MENU_DRIFT_DETAIL: &str = "menu-drift-detail";
const MENU_TOGGLE_THEME: &str = "menu-toggle-theme";
const MENU_SETTINGS: &str = "menu-settings";
const MENU_QUIT: &str = "menu-quit";
const UPDATE_STATUS_LABEL: &str = "Check for Updates...";

#[derive(Clone, Copy)]
struct TrayProductivityMix {
    focus: f64,
    drift: f64,
    neutral: f64,
}

#[derive(Default)]
pub struct TrayProductivityState(Mutex<Option<TrayProductivityMix>>);

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayDriftAlarmStatus {
    enabled: bool,
    last_checked_at: Option<String>,
    last_checked_label: String,
    result_label: String,
    detail_label: Option<String>,
}

#[derive(Default)]
pub struct TrayDriftAlarmState(Mutex<TrayDriftAlarmStatus>);

#[tauri::command]
pub fn tray_update_productivity_icon(
    app: AppHandle,
    state: State<'_, TrayProductivityState>,
    focus: f64,
    drift: f64,
    neutral: f64,
) -> Result<(), String> {
    let mut latest = state
        .0
        .lock()
        .map_err(|_| "tray productivity state lock poisoned".to_string())?;
    *latest = TrayProductivityMix::from_values(focus, drift, neutral);
    drop(latest);

    update_tray_icon(&app);
    Ok(())
}

#[tauri::command]
pub fn tray_update_drift_alarm_status(
    app: AppHandle,
    state: State<'_, TrayDriftAlarmState>,
    status: TrayDriftAlarmStatus,
) -> Result<(), String> {
    let mut latest = state
        .0
        .lock()
        .map_err(|_| "tray drift alarm state lock poisoned".to_string())?;
    *latest = status;
    drop(latest);

    refresh_tray_menu(&app).map_err(|error| error.to_string())
}

pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_tray_menu(app)?;

    let (initial_rgba, iw, ih) = donut_icon::render(0.0, 0.0, 0.0, is_dark_mode());
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(Image::new_owned(initial_rgba, iw, ih))
        .icon_as_template(false)
        .tooltip("Drifty")
        .show_menu_on_left_click(true)
        .menu(&menu)
        .on_menu_event(|app, event| match event.id() {
            id if id == MENU_OPEN => {
                reveal_main_window(app);
            }
            id if id == MENU_TRACKING_TOGGLE => {
                let controller = app.state::<TrackerController>();
                let is_running = controller
                    .get_status(app)
                    .map(|status| status.running)
                    .unwrap_or(false);
                if is_running {
                    let _ = controller.stop(app);
                } else {
                    let _ = controller.start(app);
                }
                let _ = refresh_tray_menu(app);
                update_tray_icon(app);
            }
            id if id == MENU_TOGGLE_THEME => {
                reveal_main_window(app);
                if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                    let _ = window.emit("tray-toggle-theme", ());
                }
            }
            id if id == MENU_SETTINGS => {
                reveal_main_window(app);
                if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                    let _ = window.emit("tray-open-settings", ());
                }
            }
            id if id == MENU_UPDATE_STATUS => {
                reveal_main_window(app);
                if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                    let _ = window.emit("tray-check-for-updates", ());
                }
            }
            id if id == MENU_QUIT => {
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;

    let app_handle = app.clone();
    std::thread::spawn(move || loop {
        update_tray_icon(&app_handle);
        std::thread::sleep(std::time::Duration::from_secs(60));
    });

    Ok(())
}

fn build_tray_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let version = app.package_info().version.to_string();
    let drift_status = latest_tray_drift_alarm_status(app);
    let app_info = MenuItem::with_id(
        app,
        MENU_APP_INFO,
        app_version_label(&version),
        false,
        None::<&str>,
    )?;
    let update_status = MenuItem::with_id(
        app,
        MENU_UPDATE_STATUS,
        update_status_label(),
        true,
        None::<&str>,
    )?;
    let drift_alerts_status = MenuItem::with_id(
        app,
        MENU_DRIFT_ALERTS_STATUS,
        drift_alerts_status_label(drift_status.enabled),
        false,
        None::<&str>,
    )?;
    let drift_last_check = MenuItem::with_id(
        app,
        MENU_DRIFT_LAST_CHECK,
        drift_last_check_label(&drift_status),
        false,
        None::<&str>,
    )?;
    let drift_result = MenuItem::with_id(
        app,
        MENU_DRIFT_RESULT,
        drift_result_label(&drift_status),
        false,
        None::<&str>,
    )?;
    let drift_detail = drift_detail_label(&drift_status)
        .map(|label| MenuItem::with_id(app, MENU_DRIFT_DETAIL, label, false, None::<&str>))
        .transpose()?;

    let mut builder = MenuBuilder::new(app)
        .text(MENU_OPEN, "Open Dashboard")
        .text(
            MENU_TRACKING_TOGGLE,
            tracking_action_label(tracker_running_state(app)),
        )
        .separator()
        .items(&[&drift_alerts_status, &drift_last_check, &drift_result]);

    if let Some(detail) = &drift_detail {
        builder = builder.item(detail);
    }

    builder
        .separator()
        .text(MENU_TOGGLE_THEME, "Toggle Theme")
        .text(MENU_SETTINGS, "Settings")
        .separator()
        .items(&[&app_info, &update_status])
        .separator()
        .text(MENU_QUIT, "Quit")
        .build()
}

fn refresh_tray_menu(app: &AppHandle) -> tauri::Result<()> {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_menu(Some(build_tray_menu(app)?))?;
    }

    Ok(())
}

fn tracker_running_state(app: &AppHandle) -> Option<bool> {
    app.try_state::<TrackerController>()
        .and_then(|controller| controller.get_status(app).ok().map(|status| status.running))
}

fn app_version_label(version: &str) -> String {
    format!("Drifty {version}")
}

fn update_status_label() -> &'static str {
    UPDATE_STATUS_LABEL
}

fn tracking_action_label(running: Option<bool>) -> &'static str {
    if running.unwrap_or(false) {
        "Pause Tracking"
    } else {
        "Start Tracking"
    }
}

fn drift_alerts_status_label(enabled: bool) -> &'static str {
    if enabled {
        "Drift alerts: On"
    } else {
        "Drift alerts: Off"
    }
}

fn drift_last_check_label(status: &TrayDriftAlarmStatus) -> String {
    let label = status.last_checked_label.trim();
    let display_label = if label.is_empty() && status.last_checked_at.is_some() {
        "Recorded"
    } else if label.is_empty() {
        "Never"
    } else {
        label
    };
    format!("Last drift check: {display_label}")
}

fn drift_result_label(status: &TrayDriftAlarmStatus) -> String {
    format!("Last result: {}", status.result_label)
}

fn drift_detail_label(status: &TrayDriftAlarmStatus) -> Option<String> {
    let detail = status.detail_label.as_ref()?.trim();
    if detail.is_empty() {
        return None;
    }
    Some(format!("Detail: {detail}"))
}

fn update_tray_icon(app: &AppHandle) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    let mix = latest_tray_productivity_mix(app).or_else(|| {
        let controller = app.try_state::<TrackerController>()?;
        let (focus, drift, neutral) = controller.get_daily_stats(app);
        TrayProductivityMix::from_values(focus, drift, neutral)
    });
    let (focus, drift, neutral) = match mix {
        Some(value) => (value.focus, value.drift, value.neutral),
        None => (0.0, 0.0, 0.0),
    };
    let dark = is_dark_mode();
    let (rgba, w, h) = donut_icon::render(focus, drift, neutral, dark);
    let _ = tray.set_icon(Some(Image::new_owned(rgba, w, h)));
}

fn latest_tray_productivity_mix(app: &AppHandle) -> Option<TrayProductivityMix> {
    app.try_state::<TrayProductivityState>()
        .and_then(|state| state.0.lock().ok().and_then(|latest| *latest))
}

fn latest_tray_drift_alarm_status(app: &AppHandle) -> TrayDriftAlarmStatus {
    app.try_state::<TrayDriftAlarmState>()
        .and_then(|state| state.0.lock().ok().map(|latest| latest.clone()))
        .unwrap_or_default()
}

fn is_dark_mode() -> bool {
    std::process::Command::new("defaults")
        .args(["read", "-g", "AppleInterfaceStyle"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim() == "Dark")
        .unwrap_or(false)
}

impl Default for TrayDriftAlarmStatus {
    fn default() -> Self {
        Self {
            enabled: false,
            last_checked_at: None,
            last_checked_label: "Off".to_string(),
            result_label: "Alerts disabled".to_string(),
            detail_label: None,
        }
    }
}

impl TrayProductivityMix {
    fn from_values(focus: f64, drift: f64, neutral: f64) -> Option<Self> {
        let focus = finite_non_negative(focus);
        let drift = finite_non_negative(drift);
        let neutral = finite_non_negative(neutral);
        let total = focus + drift + neutral;
        if total <= f64::EPSILON {
            return None;
        }

        Some(Self {
            focus: focus / total,
            drift: drift / total,
            neutral: neutral / total,
        })
    }
}

fn finite_non_negative(value: f64) -> f64 {
    if value.is_finite() {
        value.max(0.0)
    } else {
        0.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_version_label_formats_drifty_version() {
        assert_eq!(app_version_label("1.2.3"), "Drifty 1.2.3");
    }

    #[test]
    fn update_status_label_prompts_manual_update_checks() {
        assert_eq!(update_status_label(), "Check for Updates...");
    }

    #[test]
    fn tracking_action_label_starts_when_stopped_or_unknown() {
        assert_eq!(tracking_action_label(Some(false)), "Start Tracking");
        assert_eq!(tracking_action_label(None), "Start Tracking");
    }

    #[test]
    fn tracking_action_label_pauses_when_running() {
        assert_eq!(tracking_action_label(Some(true)), "Pause Tracking");
    }

    #[test]
    fn drift_alerts_status_label_reports_on_off() {
        assert_eq!(drift_alerts_status_label(true), "Drift alerts: On");
        assert_eq!(drift_alerts_status_label(false), "Drift alerts: Off");
    }

    #[test]
    fn drift_detail_label_omits_blank_details() {
        let status = TrayDriftAlarmStatus {
            enabled: true,
            last_checked_at: Some("2026-06-12T00:00:00.000Z".to_string()),
            last_checked_label: "9:00:00 AM".to_string(),
            result_label: "No eligible drift".to_string(),
            detail_label: Some(" ".to_string()),
        };

        assert_eq!(drift_detail_label(&status), None);
    }

    #[test]
    fn drift_detail_label_formats_candidate_details() {
        let status = TrayDriftAlarmStatus {
            enabled: true,
            last_checked_at: Some("2026-06-12T00:00:00.000Z".to_string()),
            last_checked_label: "9:00:00 AM".to_string(),
            result_label: "Suppressed: AI low confidence".to_string(),
            detail_label: Some("youtube.com - 2m".to_string()),
        };

        assert_eq!(
            drift_detail_label(&status),
            Some("Detail: youtube.com - 2m".to_string())
        );
    }

    #[test]
    fn tray_productivity_mix_normalizes_valid_values() {
        let mix = TrayProductivityMix::from_values(30.0, 15.0, 15.0).expect("mix");

        assert_eq!(mix.focus, 0.5);
        assert_eq!(mix.drift, 0.25);
        assert_eq!(mix.neutral, 0.25);
    }

    #[test]
    fn tray_productivity_mix_rejects_empty_values() {
        assert!(TrayProductivityMix::from_values(0.0, f64::NAN, -1.0).is_none());
    }
}
