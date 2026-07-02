mod app_icons;
mod app_menu;
mod auth_session_store;
mod cloud_device_store;
mod commands;
mod donut_icon;
mod tracker;
mod tray;

use std::sync::Mutex;

use app_menu::{app_menu_set_dev_mode_checked, handle_app_menu_event, setup_app_menu};
use commands::{
    accessibility_get_status, accessibility_request_access, ai_classification_openai_chat,
    developer_check_pre_release_update, developer_install_pre_release_update, drift_alarm_action,
    drift_alarm_current, drift_alarm_dismiss, drift_alarm_hide, drift_alarm_show,
    extreme_nudge_apply, focus_target_activate_browser_tab, focus_target_browser_tab_exists,
    focus_target_open_app, managed_ai_catalog, managed_ai_delete, managed_ai_install,
    managed_ai_start, managed_ai_status, managed_ai_stop_runtime_for_app_exit,
    setup_drift_alarm_window, setup_watcher_window, startup_get_open_at_login_status,
    startup_set_open_at_login_enabled, system_open_settings_pane,
    tracker_apply_classification_rules, tracker_delete_activity_segments,
    tracker_delete_classification_rule, tracker_get_app_icons, tracker_get_classification_metrics,
    tracker_get_classification_rules, tracker_get_current_snapshot,
    tracker_get_dashboard_week_timeline, tracker_get_hourly_summary, tracker_get_live_tail,
    tracker_get_raw_events, tracker_get_reusable_ai_classifications, tracker_get_status,
    tracker_get_timeline, tracker_get_timeline_page, tracker_get_top_sites,
    tracker_get_unclassified_segments, tracker_refresh_non_ai_classifications,
    tracker_save_classification_rule, tracker_save_classifications,
    tracker_search_classification_rule_candidates, tracker_search_timeline,
    tracker_set_developer_diagnostics, tracker_start, tracker_stop, update_prompt_show_native,
    watcher_peek_cursor_inside, watcher_peek_dismiss, watcher_peek_end_of_day_review_action,
    watcher_peek_extreme_nudge_action, watcher_peek_hide, watcher_peek_respond,
    watcher_peek_set_interactive, watcher_peek_show, window_set_onboarding_presentation,
    DriftAlarmState,
};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tracker::TrackerController;
use tray::{
    setup_tray, tray_update_drift_alarm_status, tray_update_icon_style,
    tray_update_productivity_icon, TrayDriftAlarmState, TrayIconStyleState, TrayProductivityState,
};

pub(crate) const MAIN_WINDOW_LABEL: &str = "main";

#[derive(Default)]
struct PendingAuthDeepLinks(Mutex<Vec<String>>);

#[tauri::command]
fn auth_take_pending_deep_links(state: State<'_, PendingAuthDeepLinks>) -> Vec<String> {
    let Ok(mut urls) = state.0.lock() else {
        return Vec::new();
    };
    std::mem::take(&mut *urls)
}

#[tauri::command]
fn auth_load_saved_session(app: AppHandle) -> Result<Option<String>, String> {
    auth_session_store::load_saved_session(&app)
}

#[tauri::command]
fn auth_save_session(_app: AppHandle, value: String) -> Result<(), String> {
    auth_session_store::save_session(&value)
}

#[tauri::command]
fn auth_clear_saved_session(app: AppHandle) -> Result<(), String> {
    auth_session_store::clear_saved_session(&app)
}

#[tauri::command]
async fn cloud_device_install_id(app: AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        cloud_device_store::load_or_create_install_id(&app)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn cloud_device_identity(
    app: AppHandle,
) -> Result<cloud_device_store::CloudDeviceIdentity, String> {
    tauri::async_runtime::spawn_blocking(move || cloud_device_store::load_or_create_identity(&app))
        .await
        .map_err(|error| error.to_string())?
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
        if let Ok(mut pending_urls) = pending.0.lock() {
            pending_urls.extend(callback_urls.clone());
        }
    }

    let _ = app.emit("deep-link://new-url", callback_urls);
    true
}

fn is_auth_callback_deep_link(url: &str) -> bool {
    let is_callback = url.starts_with("drifty://auth/callback")
        || url.starts_with("drifty://auth/google-callback");
    is_callback && !contains_auth_session_token(url)
}

fn contains_auth_session_token(url: &str) -> bool {
    url.contains("access_token=") || url.contains("refresh_token=")
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

pub(crate) fn reveal_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn app_reveal_main_window(app: AppHandle) {
    reveal_main_window(&app);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .manage(PendingAuthDeepLinks::default())
        .manage(TrayProductivityState::default())
        .manage(TrayDriftAlarmState::default())
        .manage(TrayIconStyleState::default())
        .manage(DriftAlarmState::default())
        .plugin(
            tauri::plugin::Builder::<tauri::Wry, ()>::new("auth-deep-link-cache")
                .on_event(|app, event| match event {
                    tauri::RunEvent::Opened { urls } => {
                        let _ = remember_auth_deep_links(app, urls.iter().map(ToString::to_string));
                    }
                    tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. } => {
                        managed_ai_stop_runtime_for_app_exit(app);
                        tracker::shutdown_serve_process();
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
        .manage(TrackerController::default())
        .on_menu_event(|app, event| handle_app_menu_event(app, event.id().as_ref()));

    if let Err(error) = builder
        .setup(|app| {
            setup_app_menu(app.handle())?;
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
            app_menu_set_dev_mode_checked,
            developer_check_pre_release_update,
            developer_install_pre_release_update,
            update_prompt_show_native,
            tracker_get_status,
            tracker_start,
            tracker_stop,
            tracker_get_timeline,
            tracker_get_timeline_page,
            tracker_search_timeline,
            tracker_get_dashboard_week_timeline,
            tracker_get_live_tail,
            tracker_get_current_snapshot,
            tracker_set_developer_diagnostics,
            tracker_get_hourly_summary,
            tracker_get_raw_events,
            tracker_get_top_sites,
            tracker_get_app_icons,
            tracker_get_unclassified_segments,
            tracker_get_reusable_ai_classifications,
            tracker_get_classification_rules,
            tracker_save_classification_rule,
            tracker_delete_classification_rule,
            tracker_delete_activity_segments,
            tracker_search_classification_rule_candidates,
            tracker_apply_classification_rules,
            tracker_save_classifications,
            tracker_refresh_non_ai_classifications,
            tracker_get_classification_metrics,
            tray_update_productivity_icon,
            tray_update_drift_alarm_status,
            tray_update_icon_style,
            auth_take_pending_deep_links,
            auth_load_saved_session,
            auth_save_session,
            auth_clear_saved_session,
            cloud_device_identity,
            cloud_device_install_id,
            app_reveal_main_window,
            focus_target_activate_browser_tab,
            focus_target_browser_tab_exists,
            focus_target_open_app,
            managed_ai_catalog,
            managed_ai_status,
            managed_ai_install,
            managed_ai_start,
            managed_ai_delete,
            startup_get_open_at_login_status,
            startup_set_open_at_login_enabled,
            system_open_settings_pane,
            window_set_onboarding_presentation,
            watcher_peek_show,
            watcher_peek_hide,
            watcher_peek_dismiss,
            watcher_peek_set_interactive,
            watcher_peek_cursor_inside,
            watcher_peek_respond,
            watcher_peek_end_of_day_review_action,
            watcher_peek_extreme_nudge_action,
            drift_alarm_current,
            drift_alarm_show,
            drift_alarm_hide,
            drift_alarm_dismiss,
            drift_alarm_action,
            extreme_nudge_apply,
        ])
        .run(tauri::generate_context!())
    {
        eprintln!("error while running Drifty: {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod lib_tests;
