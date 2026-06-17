mod auth_session_store;
mod commands;
mod donut_icon;
mod tracker;
mod tray;

use std::sync::Mutex;

use commands::{
    accessibility_get_status, accessibility_request_access, ai_classification_openai_chat,
    drift_alarm_action, drift_alarm_current, drift_alarm_dismiss, drift_alarm_hide,
    drift_alarm_show, extreme_nudge_apply, focus_target_activate_browser_tab,
    focus_target_open_app, managed_ai_catalog, managed_ai_delete, managed_ai_install,
    managed_ai_start, managed_ai_status, managed_ai_stop_runtime_for_app_exit,
    setup_drift_alarm_window, setup_watcher_window, system_open_settings_pane,
    tracker_apply_classification_rules, tracker_delete_activity_segments,
    tracker_delete_classification_rule, tracker_get_app_icons, tracker_get_classification_metrics,
    tracker_get_classification_rules, tracker_get_current_snapshot, tracker_get_hourly_summary,
    tracker_get_live_tail, tracker_get_raw_events, tracker_get_reusable_ai_classifications,
    tracker_get_status, tracker_get_timeline, tracker_get_top_sites,
    tracker_get_unclassified_segments, tracker_refresh_non_ai_classifications,
    tracker_save_classification_rule, tracker_save_classifications,
    tracker_search_classification_rule_candidates, tracker_start, tracker_stop,
    watcher_peek_dismiss, watcher_peek_end_of_day_review_action, watcher_peek_hide,
    watcher_peek_respond, watcher_peek_set_interactive, watcher_peek_show, DriftAlarmState,
};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tracker::TrackerController;
use tray::{
    setup_tray, tray_update_drift_alarm_status, tray_update_productivity_icon, TrayDriftAlarmState,
    TrayProductivityState,
};

pub(crate) const MAIN_WINDOW_LABEL: &str = "main";

#[derive(Default)]
struct PendingAuthDeepLinks(Mutex<Vec<String>>);

#[tauri::command]
fn auth_take_pending_deep_links(state: State<'_, PendingAuthDeepLinks>) -> Vec<String> {
    let mut urls = state
        .0
        .lock()
        .expect("pending auth deep links lock poisoned");
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
    let is_callback =
        url.starts_with("drifty://auth/callback") || url.starts_with("drifty://auth/google-callback");
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .manage(PendingAuthDeepLinks::default())
        .manage(TrayProductivityState::default())
        .manage(TrayDriftAlarmState::default())
        .manage(DriftAlarmState::default())
        .plugin(
            tauri::plugin::Builder::<tauri::Wry, ()>::new("auth-deep-link-cache")
                .on_event(|app, event| match event {
                    tauri::RunEvent::Opened { urls } => {
                        let _ = remember_auth_deep_links(app, urls.iter().map(ToString::to_string));
                    }
                    tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. } => {
                        managed_ai_stop_runtime_for_app_exit();
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
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
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
            tracker_get_live_tail,
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
            tracker_delete_activity_segments,
            tracker_search_classification_rule_candidates,
            tracker_apply_classification_rules,
            tracker_save_classifications,
            tracker_refresh_non_ai_classifications,
            tracker_get_classification_metrics,
            tray_update_productivity_icon,
            tray_update_drift_alarm_status,
            auth_take_pending_deep_links,
            auth_load_saved_session,
            auth_save_session,
            auth_clear_saved_session,
            focus_target_activate_browser_tab,
            focus_target_open_app,
            managed_ai_catalog,
            managed_ai_status,
            managed_ai_install,
            managed_ai_start,
            managed_ai_delete,
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
            extreme_nudge_apply,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Drifty");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_deep_link_filter_accepts_drifty_callbacks() {
        assert!(is_auth_callback_deep_link(
            "drifty://auth/callback?code=startup-code"
        ));
        assert!(!is_auth_callback_deep_link(
            "drifty://auth/callback#access_token=access&refresh_token=refresh"
        ));
        assert!(is_auth_callback_deep_link(
            "drifty://auth/google-callback?code=google-code"
        ));
        assert!(!is_auth_callback_deep_link(
            "drifty://auth/not-callback?code=ignored"
        ));
    }

    #[test]
    fn billing_deep_link_filter_accepts_only_drifty_success_links() {
        assert!(is_billing_success_deep_link("drifty://billing/success"));
        assert!(is_billing_success_deep_link(
            "drifty://billing/success?checkout_id=checkout-1"
        ));
        assert!(!is_billing_success_deep_link("other://billing/success"));
        assert!(!is_billing_success_deep_link("drifty://billing/cancel"));
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
}
