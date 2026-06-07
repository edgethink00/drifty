mod commands;
mod donut_icon;
mod tracker;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use commands::{
    accessibility_get_status, accessibility_request_access, ai_classification_openai_chat,
    drift_alarm_action, drift_alarm_current, drift_alarm_dismiss, drift_alarm_hide,
    drift_alarm_show, focus_target_open_app, setup_drift_alarm_window, setup_watcher_window,
    system_open_settings_pane,
    tracker_apply_classification_rules, tracker_delete_classification_rule, tracker_get_app_icons,
    tracker_get_classification_metrics, tracker_get_classification_rules,
    tracker_get_current_snapshot, tracker_get_hourly_summary, tracker_get_raw_events,
    tracker_get_reusable_ai_classifications, tracker_get_status, tracker_get_timeline,
    tracker_get_top_sites, tracker_get_unclassified_segments,
    tracker_refresh_non_ai_classifications, tracker_save_classification_rule,
    tracker_save_classifications, tracker_search_classification_rule_candidates, tracker_start,
    tracker_stop, watcher_peek_dismiss, watcher_peek_end_of_day_review_action,
    watcher_peek_hide, watcher_peek_respond, watcher_peek_set_interactive, watcher_peek_show,
    DriftAlarmState,
};
use tauri::image::Image;
use tauri::menu::{Menu, MenuBuilder, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tracker::TrackerController;

const MAIN_WINDOW_LABEL: &str = "main";
const TRAY_ID: &str = "drifty-menu";
const MENU_APP_INFO: &str = "menu-app-info";
const MENU_UPDATE_STATUS: &str = "menu-update-status";
const MENU_OPEN: &str = "menu-open-dashboard";
const MENU_TRACKING_TOGGLE: &str = "menu-tracking-toggle";
const MENU_TOGGLE_THEME: &str = "menu-toggle-theme";
const MENU_SETTINGS: &str = "menu-settings";
const MENU_QUIT: &str = "menu-quit";
const UPDATE_STATUS_LABEL: &str = "Check for Updates...";
const AUTH_SESSION_FILE_NAME: &str = "auth-session.json";
const LEGACY_AUTH_APP_DATA_DIR_NAME: &str = "com.example.dtime";

#[derive(Default)]
struct PendingAuthDeepLinks(Mutex<Vec<String>>);

#[derive(Clone, Copy)]
struct TrayProductivityMix {
    focus: f64,
    drift: f64,
    neutral: f64,
}

#[derive(Default)]
struct TrayProductivityState(Mutex<Option<TrayProductivityMix>>);

#[tauri::command]
fn auth_take_pending_deep_links(state: State<'_, PendingAuthDeepLinks>) -> Vec<String> {
    let mut urls = state
        .0
        .lock()
        .expect("pending auth deep links lock poisoned");
    std::mem::take(&mut *urls)
}

#[tauri::command]
fn tray_update_productivity_icon(
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

fn auth_session_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    Ok(dir.join(AUTH_SESSION_FILE_NAME))
}

fn legacy_auth_session_path(primary_session_path: &Path) -> Option<PathBuf> {
    let app_data_dir = primary_session_path.parent()?;
    let app_support_dir = app_data_dir.parent()?;
    Some(
        app_support_dir
            .join(LEGACY_AUTH_APP_DATA_DIR_NAME)
            .join(AUTH_SESSION_FILE_NAME),
    )
}

fn auth_session_read_paths(app: &AppHandle) -> Result<Vec<PathBuf>, String> {
    let primary = auth_session_path(app)?;
    let mut paths = vec![primary.clone()];

    if let Some(legacy) = legacy_auth_session_path(&primary) {
        if legacy != primary {
            paths.push(legacy);
        }
    }

    Ok(paths)
}

#[tauri::command]
fn auth_load_saved_session(app: AppHandle) -> Result<Option<String>, String> {
    for path in auth_session_read_paths(&app)? {
        match fs::read_to_string(path) {
            Ok(value) => return Ok(Some(value)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
    }

    Ok(None)
}

#[tauri::command]
fn auth_save_session(app: AppHandle, value: String) -> Result<(), String> {
    let path = auth_session_path(&app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(path, value).map_err(|error| error.to_string())
}

#[tauri::command]
fn auth_clear_saved_session(app: AppHandle) -> Result<(), String> {
    for path in auth_session_read_paths(&app)? {
        match fs::remove_file(path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
    }

    Ok(())
}

fn remember_auth_deep_links<R: Runtime>(
    app: &AppHandle<R>,
    urls: impl IntoIterator<Item = String>,
) -> bool {
    let callback_urls: Vec<String> = urls
        .into_iter()
        .filter(|url| is_auth_callback_deep_link(url) || is_billing_success_deep_link(url))
        .collect();

    if callback_urls.is_empty() {
        return false;
    }

    if let Some(pending) = app.try_state::<PendingAuthDeepLinks>() {
        pending
            .0
            .lock()
            .expect("pending auth deep links lock poisoned")
            .extend(callback_urls.clone());
    }

    let _ = app.emit("deep-link://new-url", callback_urls);
    true
}

fn is_auth_callback_deep_link(url: &str) -> bool {
    url.starts_with("drifty://auth/callback") || url.starts_with("dtime://auth/callback")
}

fn is_billing_success_deep_link(url: &str) -> bool {
    url == "drifty://billing/success" || url.starts_with("drifty://billing/success?")
}

fn should_hide_instead_of_close(label: &str) -> bool {
    label == MAIN_WINDOW_LABEL
}

fn should_reveal_main_window_on_reopen(has_visible_windows: bool) -> bool {
    !has_visible_windows
}

fn reveal_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .manage(PendingAuthDeepLinks::default())
        .manage(TrayProductivityState::default())
        .manage(DriftAlarmState::default())
        .plugin(
            tauri::plugin::Builder::<tauri::Wry, ()>::new("auth-deep-link-cache")
                .on_event(|app, event| match event {
                    tauri::RunEvent::Opened { urls } => {
                        let _ = remember_auth_deep_links(app, urls.iter().map(ToString::to_string));
                    }
                    tauri::RunEvent::WindowEvent {
                        label,
                        event: tauri::WindowEvent::CloseRequested { api, .. },
                        ..
                    } if should_hide_instead_of_close(label) => {
                        api.prevent_close();
                        if let Some(window) = app.get_webview_window(label) {
                            let _ = window.hide();
                        }
                    }
                    #[cfg(target_os = "macos")]
                    tauri::RunEvent::Reopen {
                        has_visible_windows,
                        ..
                    } if should_reveal_main_window_on_reopen(*has_visible_windows) => {
                        reveal_main_window(app);
                    }
                    _ => {}
                })
                .build(),
        );

    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _| {
        let handled_auth_callback = remember_auth_deep_links(app, args);

        if handled_auth_callback {
            return;
        }

        reveal_main_window(app);
    }));

    let builder = builder
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(TrackerController::default());

    builder
        .setup(|app| {
            setup_watcher_window(app)?;
            setup_drift_alarm_window(app)?;
            setup_tray(app.handle())?;
            let controller = app.state::<TrackerController>();
            let _ = controller.start(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            accessibility_get_status,
            accessibility_request_access,
            ai_classification_openai_chat,
            tracker_get_status,
            tracker_start,
            tracker_stop,
            tracker_get_timeline,
            tracker_get_current_snapshot,
            tracker_get_hourly_summary,
            tracker_get_raw_events,
            tracker_get_top_sites,
            tracker_get_app_icons,
            tracker_get_unclassified_segments,
            tracker_get_reusable_ai_classifications,
            tracker_get_classification_rules,
            tracker_save_classification_rule,
            tracker_delete_classification_rule,
            tracker_search_classification_rule_candidates,
            tracker_apply_classification_rules,
            tracker_save_classifications,
            tracker_refresh_non_ai_classifications,
            tracker_get_classification_metrics,
            tray_update_productivity_icon,
            auth_take_pending_deep_links,
            auth_load_saved_session,
            auth_save_session,
            auth_clear_saved_session,
            focus_target_open_app,
            system_open_settings_pane,
            watcher_peek_show,
            watcher_peek_hide,
            watcher_peek_dismiss,
            watcher_peek_set_interactive,
            watcher_peek_respond,
            watcher_peek_end_of_day_review_action,
            drift_alarm_current,
            drift_alarm_show,
            drift_alarm_hide,
            drift_alarm_dismiss,
            drift_alarm_action,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Drifty");
}

fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
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

    // Background thread: refresh donut icon every 60 seconds
    let app_handle = app.clone();
    std::thread::spawn(move || loop {
        update_tray_icon(&app_handle);
        std::thread::sleep(std::time::Duration::from_secs(60));
    });

    Ok(())
}

fn build_tray_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let version = app.package_info().version.to_string();
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

    MenuBuilder::new(app)
        .text(MENU_OPEN, "Open Dashboard")
        .text(
            MENU_TRACKING_TOGGLE,
            tracking_action_label(tracker_running_state(app)),
        )
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

fn is_dark_mode() -> bool {
    std::process::Command::new("defaults")
        .args(["read", "-g", "AppleInterfaceStyle"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim() == "Dark")
        .unwrap_or(false)
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
    fn auth_deep_link_filter_accepts_drifty_callbacks() {
        assert!(is_auth_callback_deep_link(
            "drifty://auth/callback?code=startup-code"
        ));
        assert!(is_auth_callback_deep_link(
            "drifty://auth/callback#access_token=access&refresh_token=refresh"
        ));
        assert!(!is_auth_callback_deep_link(
            "drifty://auth/not-callback?code=ignored"
        ));
    }

    #[test]
    fn auth_deep_link_filter_temporarily_accepts_legacy_dtime_callbacks() {
        assert!(is_auth_callback_deep_link(
            "dtime://auth/callback?code=legacy-code"
        ));
        assert!(is_auth_callback_deep_link(
            "dtime://auth/callback#access_token=access&refresh_token=refresh"
        ));
    }

    #[test]
    fn billing_deep_link_filter_accepts_only_drifty_success_links() {
        assert!(is_billing_success_deep_link("drifty://billing/success"));
        assert!(is_billing_success_deep_link(
            "drifty://billing/success?checkout_id=checkout-1"
        ));
        assert!(!is_billing_success_deep_link("dtime://billing/success"));
        assert!(!is_billing_success_deep_link("drifty://billing/cancel"));
    }

    #[test]
    fn auth_session_legacy_path_uses_previous_bundle_id_sibling() {
        let primary = PathBuf::from(
            "/Users/example/Library/Application Support/so.drifty.mac/auth-session.json",
        );

        assert_eq!(
            legacy_auth_session_path(&primary),
            Some(PathBuf::from(
                "/Users/example/Library/Application Support/com.example.dtime/auth-session.json"
            ))
        );
    }

    #[test]
    fn update_status_label_prompts_manual_update_checks() {
        assert_eq!(update_status_label(), "Check for Updates...");
    }

    #[test]
    fn main_window_close_policy_only_handles_main_label() {
        assert!(should_hide_instead_of_close("main"));
        assert!(!should_hide_instead_of_close("watcher-peek"));
        assert!(!should_hide_instead_of_close("settings"));
    }

    #[test]
    fn macos_reopen_policy_reveals_only_without_visible_windows() {
        assert!(should_reveal_main_window_on_reopen(false));
        assert!(!should_reveal_main_window_on_reopen(true));
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
