mod drift_alarm_status;
mod productivity_icon;
#[cfg(test)]
mod tests;

use std::sync::Mutex;

use tauri::image::Image;
use tauri::menu::{Menu, MenuBuilder, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, State};

use self::drift_alarm_status::{
    drift_alerts_status_label, drift_detail_label, drift_last_check_label, drift_result_label,
    TrayDriftAlarmStatus,
};
use self::productivity_icon::{
    latest_tray_productivity_mix, update_tray_productivity_mix, TrayProductivityMix,
};

pub use self::productivity_icon::TrayProductivityState;
use crate::donut_icon::{self, DonutIconRenderInput, TrayIconStyle};
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

#[derive(Default)]
pub struct TrayDriftAlarmState(Mutex<TrayDriftAlarmStatus>);

#[derive(Default)]
pub struct TrayIconStyleState(Mutex<TrayIconStyle>);

#[tauri::command]
pub fn tray_update_productivity_icon(
    app: AppHandle,
    state: State<'_, TrayProductivityState>,
    focus: f64,
    drift: f64,
    neutral: f64,
) -> Result<(), String> {
    update_tray_productivity_mix(&state, focus, drift, neutral)?;
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

#[tauri::command]
pub fn tray_update_icon_style(
    app: AppHandle,
    state: State<'_, TrayIconStyleState>,
    style: TrayIconStyle,
) -> Result<(), String> {
    let mut latest = state
        .0
        .lock()
        .map_err(|_| "tray icon style state lock poisoned".to_string())?;
    *latest = style;
    drop(latest);

    update_tray_icon(&app);
    Ok(())
}

pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_tray_menu(app)?;

    let (initial_rgba, iw, ih) = donut_icon::render(DonutIconRenderInput {
        focus: 0.0,
        drift: 0.0,
        neutral: 0.0,
        is_dark: is_dark_mode(),
        style: latest_tray_icon_style(app),
    });
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
                let next_status = if is_running {
                    controller.stop(app)
                } else {
                    controller.start(app)
                };
                if let Ok(status) = next_status {
                    update_cached_tracker_running(app, Some(status.running));
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
        drift_alerts_status_label(&drift_status),
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
            tracking_action_label(drift_status.tracker_running()),
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

fn update_cached_tracker_running(app: &AppHandle, running: Option<bool>) {
    if let Some(state) = app.try_state::<TrayDriftAlarmState>() {
        if let Ok(mut latest) = state.0.lock() {
            latest.set_tracker_running(running);
        }
    }
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
    let (rgba, w, h) = donut_icon::render(DonutIconRenderInput {
        focus,
        drift,
        neutral,
        is_dark: dark,
        style: latest_tray_icon_style(app),
    });
    let _ = tray.set_icon(Some(Image::new_owned(rgba, w, h)));
}

fn latest_tray_icon_style(app: &AppHandle) -> TrayIconStyle {
    app.try_state::<TrayIconStyleState>()
        .and_then(|state| state.0.lock().ok().map(|latest| *latest))
        .unwrap_or_default()
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
