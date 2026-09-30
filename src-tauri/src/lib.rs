mod app_icons;
mod app_menu;
mod auth_session_store;
mod cloud_device_store;
mod commands;
mod correction_evidence_store;
mod custom_endpoint_key_store;
mod donut_icon;
mod living_soul_store;
#[cfg(any(target_os = "windows", test))]
mod main_window_recovery;
mod native_crash_reports;
mod observability;
mod openrouter_key_store;
mod panic_guard;
mod quit_confirmation;
mod shell_action;
mod site_icons;
mod tracker;
mod tracker_recovery;
mod tracking_activation;
mod tracking_pause;
mod tray;

use std::{
    panic::{self, AssertUnwindSafe},
    path::{Path, PathBuf},
    sync::{Condvar, Mutex},
};

use app_menu::{app_menu_set_dev_mode_checked, handle_app_menu_event, setup_app_menu};
#[cfg(target_os = "windows")]
use commands::configure_main_window_material;
use commands::{
    accessibility_get_status, accessibility_request_access, ai_classification_anthropic_chat,
    ai_classification_openai_chat, ai_list_openai_models, cloud_sync_http_post,
    companion_informational_moments_suppressed, correction_evidence_append,
    developer_check_pre_release_update, developer_install_pre_release_update, developer_list_releases, developer_install_release,
    developer_tools_get_status, developer_tools_install_cli, developer_tools_install_codex_skill,
    developer_tools_install_skill, developer_tools_uninstall_cli,
    developer_tools_uninstall_codex_skill, developer_tools_uninstall_skill, extreme_nudge_apply,
    focus_target_activate_browser_tab, focus_target_browser_tab_exists, focus_target_open_app,
    google_calendar_authorize, google_calendar_capability, google_calendar_discard_pending,
    google_calendar_disconnect, google_calendar_events, google_calendar_finalize,
    google_calendar_status, GoogleCalendarState,
    living_soul_read, living_soul_write, managed_ai_catalog, managed_ai_delete, managed_ai_install,
    managed_ai_start, managed_ai_status, managed_ai_stop_runtime_for_app_exit,
    pet_mode_align_contact, pet_mode_begin_drag, pet_mode_cancel_motion, pet_mode_carry_cursor,
    pet_mode_cursor_inside, pet_mode_cursor_sample, pet_mode_exit_screen, pet_mode_input_bounds,
    pet_mode_intervene, pet_mode_lab_apply_target, pet_mode_lab_place_center,
    pet_mode_move_to_target, pet_mode_preview_action, pet_mode_preview_intervention,
    pet_mode_probe_ax_seat, pet_mode_reconcile_position,
    pet_mode_remember_position, pet_mode_report_contact, pet_mode_report_drag_error,
    pet_mode_prepare_outing_hunt, pet_mode_report_pointer, pet_mode_resolve_drop,
    pet_mode_return_from_outing,
    pet_mode_return_home, pet_mode_finish_fullscreen_intervention,
    pet_mode_complete_fullscreen_close, pet_mode_roam, pet_mode_set_enabled, pet_mode_set_interactive,
    pet_mode_set_dance_headroom, pet_mode_set_floor_home, pet_mode_set_presence, pet_mode_set_size,
    pet_mode_stalk_cursor, pet_mode_update,
    pet_mode_update_hit_region, pet_mode_visibility_action, pet_quick_controls_action,
    pet_quick_controls_cursor_inside, pet_quick_controls_set_visible, pet_quick_controls_sync_state, pet_quick_controls_get_state,
    sentry_capture_native_smoke, setup_companion_pill_window, setup_pet_mode_window,
    setup_pet_quick_controls_window, setup_watcher_window, share_card_save_png,
    startup_get_install_location, startup_get_open_at_login_status,
    startup_set_open_at_login_enabled, system_open_settings_pane,
    tracker_apply_classification_rules, tracker_apply_synced_deletions,
    tracker_apply_synced_segments, tracker_clear_icon_caches, tracker_delete_activity_segments,
    tracker_delete_classification_rule, tracker_delete_history_range, tracker_delete_project,
    tracker_delete_project_anchor, tracker_get_ai_review_events, tracker_get_app_icons,
    tracker_get_browser_history_environment, tracker_get_classification_metrics,
    tracker_get_classification_rules, tracker_get_current_snapshot,
    tracker_collect_ssh_agent_source, tracker_get_agent_concurrency_peak, tracker_get_dashboard_week_timeline,
    tracker_get_dev_repos, tracker_get_dev_signals,
    tracker_get_hourly_summary, tracker_get_live_tail, tracker_get_pending_sync_deletions,
    tracker_get_project_assignments, tracker_get_project_pass_runs,
    tracker_get_project_trend_timeline, tracker_get_project_window_assignments,
    tracker_get_projects, tracker_get_raw_events, tracker_get_reusable_ai_classifications,
    tracker_get_site_icons, tracker_get_status, tracker_get_sync_outbox, tracker_get_sync_state,
    tracker_get_team_project_assignments, tracker_get_team_projects, tracker_get_timeline,
    tracker_get_timeline_page, tracker_get_top_sites, tracker_get_unclassified_segments,
    tracker_get_excluded_apps, tracker_save_excluded_app, tracker_delete_excluded_app,
    tracker_get_excluded_app_history_count, tracker_delete_excluded_app_history, tracker_get_recent_apps,
    tracker_import_browser_history, tracker_mark_sync_deletions_pushed,
    tracker_preview_browser_history_import, tracker_purge_remote_segments,
    tracker_record_project_pass, tracker_refresh_non_ai_classifications,
    tracker_revert_ai_review_event, tracker_save_ai_review_events,
    tracker_save_classification_rule, tracker_save_classifications, tracker_save_project,
    tracker_save_project_anchors, tracker_save_project_assignments,
    tracker_save_project_window_assignments, tracker_save_team_project_assignments,
    tracker_search_classification_rule_candidates, tracker_search_timeline,
    tracker_set_developer_diagnostics, tracker_set_sync_state, tracker_start, tracker_stop,
    tracker_list_ssh_agent_sources, tracker_sync_dev_signals, tracker_test_ssh_agent_source,
    tracker_upsert_team_projects,
    update_policy_fetch, update_prompt_show_native,
    update_status_show_native, watcher_companion_clamp_to_screen,
    watcher_companion_cursor_over_capsule, watcher_companion_dismiss_moment,
    watcher_companion_present_prepared, watcher_companion_set_click_through,
    watcher_companion_set_enabled, watcher_companion_set_state,
    watcher_companion_set_surface_policy, watcher_companion_update,
    watcher_companion_visibility_action, watcher_peek_cursor_inside, watcher_peek_dismiss,
    watcher_peek_end_of_day_review_action, watcher_peek_end_of_day_review_displayed,
    watcher_peek_extreme_nudge_action, watcher_peek_hide, watcher_peek_respond,
    watcher_peek_set_interactive, watcher_peek_show,
    calibrate_main_window_to_work_area, window_set_onboarding_presentation,
    window_set_theme_appearance, window_show_system_menu, MainWindowMaterialState,
};
use quit_confirmation::{quit_confirmation_set_language, QuitConfirmationState};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tracker::{TrackerController, TrackerStartupState};
use tracker_recovery::{setup_tracker_recovery, shutdown_tracker_recovery, TrackerRecoveryWorker};
use tracking_pause::TrackingPauseState;
use tray::{
    setup_tray, shutdown_tray_refresh_worker, tray_set_language, tray_update_display_mode,
    tray_update_drift_alarm_status, tray_update_icon_style, tray_update_productivity_icon,
    TrayDisplayState, TrayDriftAlarmState, TrayIconStyleState, TrayLanguageState,
    TrayProductivityState, TrayRefreshWorker,
};

pub(crate) const MAIN_WINDOW_LABEL: &str = "main";

#[derive(Debug, Default, Eq, PartialEq)]
enum AppExitState {
    #[default]
    Idle,
    Running(std::thread::ThreadId),
    Complete,
}

#[derive(Default)]
struct AppExitCoordinator {
    state: Mutex<AppExitState>,
    completed: Condvar,
}

impl AppExitCoordinator {
    fn shutdown_once(&self, cleanup: impl FnOnce()) {
        let owner = std::thread::current().id();
        let mut state = self
            .state
            .lock()
            .expect("app exit state should not be poisoned");
        loop {
            match &*state {
                AppExitState::Complete => return,
                AppExitState::Running(running_owner) if *running_owner == owner => return,
                AppExitState::Running(_) => {
                    state = self
                        .completed
                        .wait(state)
                        .expect("app exit state should not be poisoned");
                }
                AppExitState::Idle => {
                    *state = AppExitState::Running(owner);
                    break;
                }
            }
        }
        drop(state);

        let result = panic::catch_unwind(AssertUnwindSafe(cleanup));
        let mut state = self
            .state
            .lock()
            .expect("app exit state should not be poisoned");
        *state = if result.is_ok() {
            AppExitState::Complete
        } else {
            AppExitState::Idle
        };
        self.completed.notify_all();
        drop(state);

        if let Err(payload) = result {
            panic::resume_unwind(payload);
        }
    }
}

fn run_exit_cleanup_steps(
    mut stop_tracker_recovery: impl FnMut(),
    mut stop_tray_refresh_worker: impl FnMut(),
    mut stop_managed_ai: impl FnMut(),
    mut stop_tracker_daemon: impl FnMut(),
    mut stop_tracker_serve_process: impl FnMut(),
) {
    let mut first_panic = None;
    for cleanup in [
        &mut stop_tracker_recovery as &mut dyn FnMut(),
        &mut stop_tray_refresh_worker,
        &mut stop_managed_ai,
        &mut stop_tracker_daemon,
        &mut stop_tracker_serve_process,
    ] {
        if let Err(payload) = panic::catch_unwind(AssertUnwindSafe(cleanup)) {
            if first_panic.is_none() {
                first_panic = Some(payload);
            }
        }
    }

    if let Some(payload) = first_panic {
        panic::resume_unwind(payload);
    }
}

fn shutdown_app_for_exit(app: &AppHandle) {
    app.state::<AppExitCoordinator>().shutdown_once(|| {
        // Invalidate queued Start/timer/enforcement tokens before shutdown
        // waits on workers or sends the intentional daemon Stop.
        tracking_pause::begin_app_exit(app);
        run_exit_cleanup_steps(
            // The recovery worker must stop before the intentional daemon stop.
            || shutdown_tracker_recovery(app),
            // Stop and join before tracker shutdown because refresh reads tracker stats.
            || shutdown_tray_refresh_worker(app),
            || managed_ai_stop_runtime_for_app_exit(app),
            // Quitting the app must also stop the detached sampling daemon.
            || tracker::stop_tracking_daemon_for_app_exit(app),
            tracker::shutdown_serve_process,
        );
    });
}

pub fn init_native_observability() -> Option<sentry::ClientInitGuard> {
    observability::install_runtime_error_log();
    let guard = observability::init_native_sentry();
    if cfg!(target_os = "windows") {
        observability::tag_webview_runtime_version(tauri::webview_version().ok());
    }
    guard
}

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
fn openrouter_load_api_key() -> Result<Option<String>, String> {
    openrouter_key_store::load_api_key()
}

#[tauri::command]
fn openrouter_save_api_key(value: String) -> Result<(), String> {
    openrouter_key_store::save_api_key(&value)
}

#[tauri::command]
fn openrouter_clear_api_key() -> Result<(), String> {
    openrouter_key_store::clear_api_key()
}

#[tauri::command]
fn custom_endpoint_load_api_key() -> Result<Option<String>, String> {
    custom_endpoint_key_store::load_api_key()
}

#[tauri::command]
fn custom_endpoint_save_api_key(value: String) -> Result<(), String> {
    custom_endpoint_key_store::save_api_key(&value)
}

#[tauri::command]
fn custom_endpoint_clear_api_key() -> Result<(), String> {
    custom_endpoint_key_store::clear_api_key()
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
        .filter(|url| {
            is_auth_callback_deep_link(url)
                || is_billing_success_deep_link(url)
                || is_team_invite_deep_link(url)
        })
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
    let Ok(parsed) = url::Url::parse(url) else {
        return false;
    };
    let is_callback = parsed.scheme() == "drifty"
        && parsed.host_str() == Some("auth")
        && parsed.username().is_empty()
        && parsed.password().is_none()
        && parsed.port().is_none()
        && matches!(
            parsed.path(),
            "/callback" | "/callback/" | "/google-callback" | "/google-callback/"
        );
    is_callback && !contains_auth_session_token(&parsed)
}

fn contains_auth_session_token(url: &url::Url) -> bool {
    let is_session_token = |key: &str| matches!(key, "access_token" | "refresh_token");
    url.query_pairs().any(|(key, _)| is_session_token(&key))
        || url.fragment().is_some_and(|fragment| {
            url::form_urlencoded::parse(fragment.as_bytes()).any(|(key, _)| is_session_token(&key))
        })
}

fn is_billing_success_deep_link(url: &str) -> bool {
    url == "drifty://billing/success" || url.starts_with("drifty://billing/success?")
}

fn is_team_invite_deep_link(url: &str) -> bool {
    url == "drifty://team-invite"
        || url.starts_with("drifty://team-invite?")
        || url.starts_with("drifty://team-invite/")
}

fn should_hide_instead_of_close(label: &str) -> bool {
    label == MAIN_WINDOW_LABEL
}

fn should_reveal_main_window_on_reopen(has_visible_windows: bool) -> bool {
    !has_visible_windows
}

#[cfg(target_os = "macos")]
fn should_use_isolated_dev_activation_policy(
    value: Option<&std::ffi::OsStr>,
    debug_build: bool,
) -> bool {
    debug_build && value == Some(std::ffi::OsStr::new("1"))
}

/// Prevent isolated dev from becoming active while Tauri creates and runs its
/// windows. `Accessory` is still activatable, so background QA remains
/// `Prohibited` for the whole session; plain `tauri:dev` is the attended path.
#[cfg(target_os = "macos")]
pub fn configure_isolated_dev_activation_policy() {
    if !should_use_isolated_dev_activation_policy(
        std::env::var_os("DRIFTY_ISOLATED_DEV").as_deref(),
        cfg!(debug_assertions),
    ) {
        return;
    }

    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy};

    let mtm = MainThreadMarker::new()
        .expect("isolated dev activation policy must be configured on the main thread");
    let app = NSApplication::sharedApplication(mtm);
    let _ = app.setActivationPolicy(NSApplicationActivationPolicy::Prohibited);
}

#[cfg(not(target_os = "macos"))]
pub fn configure_isolated_dev_activation_policy() {}

#[cfg(target_os = "macos")]
fn reveal_isolated_main_window_without_activation(app: &AppHandle) -> tauri::Result<()> {
    use objc2_app_kit::NSWindow;

    let window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| tauri::Error::WindowNotFound)?;
    let raw_window = window.ns_window()?;
    // SAFETY: Tauri owns this NSWindow and RunEvent::Ready is delivered on
    // the AppKit event-loop thread. orderFront intentionally does not make it
    // the key window or activate the application.
    let ns_window = unsafe { &*(raw_window.cast::<NSWindow>()) };
    ns_window.orderFront(None);
    Ok(())
}

#[cfg(target_os = "macos")]
fn activate_drifty_application<R: Runtime>(app: &AppHandle<R>) {
    use objc2_app_kit::NSApplication;
    use objc2_foundation::MainThreadMarker;

    let activate = || {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let application = NSApplication::sharedApplication(mtm);
        #[allow(deprecated)]
        application.activateIgnoringOtherApps(true);
    };

    if MainThreadMarker::new().is_some() {
        activate();
    } else {
        let _ = app.run_on_main_thread(activate);
    }
}

pub(crate) fn reveal_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        #[cfg(target_os = "windows")]
        if let Err(error) = commands::fit_main_window_to_current_work_area(app) {
            eprintln!("could not fit Drifty inside the Windows work area: {error}");
        }
        let _ = window.set_focus();
        #[cfg(target_os = "windows")]
        commands::start_windows_native_blur(&window);
        #[cfg(target_os = "macos")]
        activate_drifty_application(app);
    }
}

/// Explicit Windows opens retry a failed main window without restarting the
/// tracker. Background reveals stay silent; exhausted recovery gives guidance.
pub(crate) fn request_main_window(app: &AppHandle) {
    #[cfg(target_os = "windows")]
    if !main_window_is_available(app) {
        main_window_recovery::recover_on_open(app);
        return;
    }
    reveal_main_window(app);
}

fn main_window_is_available<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.get_webview_window(MAIN_WINDOW_LABEL)
        .is_some_and(|window| window.inner_size().is_ok())
}

#[cfg(target_os = "windows")]
fn repair_windows_deep_link_registration(app: &AppHandle) {
    use tauri_plugin_deep_link::DeepLinkExt;

    // A development or older portable build can leave the per-user protocol
    // pointing at an executable that no longer exists. Refreshing it from the
    // running packaged app keeps the browser auth return path bound to these
    // exact installed bytes. Installation also writes the same mapping so a
    // first callback can cold-start Drifty before this repair has ever run.
    if let Err(error) = app.deep_link().register_all() {
        eprintln!("could not refresh the Windows drifty:// registration: {error}");
    }
}

/// Windows is the only platform where a failed overlay setup has been observed
/// in production; elsewhere a failure still stops launch so it cannot go unseen.
const RECOVER_AUXILIARY_WINDOW_SETUP: bool = cfg!(target_os = "windows");

/// The watcher peek, Companion pill, pet, and pet controls are optional
/// overlays. On Windows each needs its native window handle right after
/// creation to become click-through and non-activating. When that handle was
/// unavailable (Windows 10 1903: "the underlying handle is not available"),
/// the error aborted the setup hook and Drifty never opened. With `recover`,
/// launch continues without that one overlay for this session. A
/// half-configured overlay would be a transparent topmost window that captures
/// clicks, so it is destroyed rather than kept.
fn setup_auxiliary_window<R: Runtime>(
    app: &tauri::App<R>,
    label: &str,
    recover: bool,
    setup: impl FnOnce(&tauri::App<R>) -> tauri::Result<()>,
) -> tauri::Result<()> {
    // Only a runtime error logged while this window was being created explains
    // its failure; drop anything an earlier window left behind.
    let _ = observability::take_last_runtime_error();
    let Err(error) = setup(app) else {
        return Ok(());
    };
    if !recover {
        return Err(error);
    }
    let report = auxiliary_window_failure_report(
        label,
        &error.to_string(),
        observability::take_last_runtime_error().as_deref(),
    );
    eprintln!("[startup] {label} is unavailable for this session: {report}");
    sentry::capture_message(&report, sentry::Level::Warning);
    if let Some(window) = app.get_webview_window(label) {
        if let Err(destroy_error) = window.destroy() {
            eprintln!("[startup] could not remove the partial {label} window: {destroy_error}");
        }
    }
    Ok(())
}

/// A missing native handle is only the symptom. When Tauri logged why the
/// window or its WebView could not be created, that reason leads the report.
fn auxiliary_window_failure_report(
    label: &str,
    error: &str,
    creation_error: Option<&str>,
) -> String {
    match creation_error {
        Some(creation_error) => {
            format!("Auxiliary window setup failed ({label}): {creation_error} ({error})")
        }
        None => format!("Auxiliary window setup failed ({label}): {error}"),
    }
}

/// Report a missing configured main window on platforms using default creation.
/// Windows handles the actual creation result in main_window_recovery instead.
#[cfg(any(test, not(target_os = "windows")))]
fn report_unavailable_main_window<R: Runtime>(app: &tauri::App<R>) -> Option<String> {
    if main_window_is_available(app.handle()) {
        return None;
    }
    let cause = observability::take_last_runtime_error()
        .unwrap_or_else(|| "the window was not created".to_string());
    let report = format!("Main window setup failed: {cause}");
    eprintln!("[startup] {report}");
    sentry::capture_message(&report, sentry::Level::Error);
    Some(report)
}

#[tauri::command]
fn app_reveal_main_window(app: AppHandle) {
    request_main_window(&app);
}

fn run_update_restart(cleanup: impl FnOnce(), restart: impl FnOnce()) {
    cleanup();
    restart();
}

const UPDATE_RELAUNCH_SILENT_MARKER: &str = "update-relaunch-silent";

fn update_relaunch_silent_marker_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(UPDATE_RELAUNCH_SILENT_MARKER)
}

fn mark_silent_update_relaunch(app_data_dir: &Path) {
    let path = update_relaunch_silent_marker_path(app_data_dir);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(path, b"");
}

/// Returns true when this launch should keep the main window hidden because a
/// silent post-update relaunch marker was present. The marker is consumed even
/// when deletion fails, so a stuck file cannot suppress every future launch.
fn consume_silent_update_relaunch(app_data_dir: &Path) -> bool {
    let path = update_relaunch_silent_marker_path(app_data_dir);
    if !path.exists() {
        return false;
    }
    if std::fs::remove_file(&path).is_err() {
        let _ = std::fs::remove_file(&path);
        if path.exists() {
            let backup = app_data_dir.join(format!("{UPDATE_RELAUNCH_SILENT_MARKER}.stale"));
            let _ = std::fs::rename(&path, backup);
        }
    }
    true
}

fn should_keep_main_window_hidden_on_ready(app: &AppHandle) -> bool {
    #[cfg(target_os = "windows")]
    if commands::windows_background_launch_requested() {
        return true;
    }
    app.path()
        .app_data_dir()
        .ok()
        .is_some_and(|dir| consume_silent_update_relaunch(&dir))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReadyMainWindowAction {
    RevealIsolatedWithoutActivation,
    KeepHidden,
    RevealAndFocus,
}

/// Isolated QA must keep its own non-activating reveal even when a silent
/// update marker is present, so background Computer Use still has a window.
fn ready_main_window_action(isolated_dev: bool, keep_hidden: bool) -> ReadyMainWindowAction {
    if isolated_dev {
        ReadyMainWindowAction::RevealIsolatedWithoutActivation
    } else if keep_hidden {
        ReadyMainWindowAction::KeepHidden
    } else {
        ReadyMainWindowAction::RevealAndFocus
    }
}

#[tauri::command]
fn app_restart_after_update(app: AppHandle, silent: Option<bool>) {
    if silent.unwrap_or(false) {
        if let Ok(app_data_dir) = app.path().app_data_dir() {
            mark_silent_update_relaunch(&app_data_dir);
        }
    }
    run_update_restart(|| shutdown_app_for_exit(&app), || app.restart());
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .manage(PendingAuthDeepLinks::default())
        .manage(TrayProductivityState::default())
        .manage(TrayDriftAlarmState::default())
        .manage(TrayIconStyleState::default())
        .manage(TrayDisplayState::default())
        .manage(TrayRefreshWorker::default())
        .manage(TrayLanguageState::default())
        .manage(TrackerRecoveryWorker::default())
        .manage(TrackingPauseState::default())
        .manage(QuitConfirmationState::default())
        .manage(AppExitCoordinator::default())
        .manage(GoogleCalendarState::default())
        .manage(MainWindowMaterialState::default())
        .plugin(
            tauri::plugin::Builder::<tauri::Wry, ()>::new("auth-deep-link-cache")
                .on_event(|app, event| match event {
                    // `Opened` only exists on Apple platforms. Windows delivers a
                    // deep link by launching a second process with the URL in argv,
                    // which the single-instance callback below routes through the
                    // same `remember_auth_deep_links` filter.
                    #[cfg(any(target_os = "macos", target_os = "ios"))]
                    tauri::RunEvent::Opened { urls } => {
                        if remember_auth_deep_links(app, urls.iter().map(ToString::to_string)) {
                            reveal_main_window(app);
                        }
                    }
                    // ExitRequested can still be prevented by another listener. Run irreversible
                    // cleanup only once the runtime commits to Exit.
                    tauri::RunEvent::Exit => {
                        #[cfg(target_os = "windows")]
                        commands::stop_windows_native_blur();
                        shutdown_app_for_exit(app);
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
                    #[cfg(target_os = "windows")]
                    tauri::RunEvent::WindowEvent {
                        label,
                        event:
                            tauri::WindowEvent::Resized(_)
                            | tauri::WindowEvent::ScaleFactorChanged { .. },
                        ..
                    } if label == MAIN_WINDOW_LABEL => {
                        if let Err(error) = commands::fit_main_window_to_current_work_area(app) {
                            eprintln!(
                                "could not refit Drifty after a window size or scale change: {error}"
                            );
                        }
                        commands::sync_windows_native_blur();
                    }
                    #[cfg(target_os = "windows")]
                    tauri::RunEvent::WindowEvent {
                        label,
                        event: tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Focused(_),
                        ..
                    } if label == MAIN_WINDOW_LABEL => commands::sync_windows_native_blur(),
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

    #[cfg(target_os = "windows")]
    let builder = builder
        .manage(main_window_recovery::MainWindowRecoveryState::default())
        .plugin(
            tauri_plugin_snap_layout::init()
                .button_id("windows-caption-maximize")
                .build(),
        );

    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _| {
        #[cfg(target_os = "windows")]
        let background_launch = args.iter().any(|arg| arg == "--background");
        let handled_auth_callback = remember_auth_deep_links(app, args);

        if handled_auth_callback {
            request_main_window(app);
            return;
        }

        #[cfg(target_os = "windows")]
        if background_launch {
            return;
        }

        request_main_window(app);
    }));

    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_nspanel::init());

    let builder = builder
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(TrackerController::default())
        .manage(TrackerStartupState::default())
        .on_menu_event(|app, event| handle_app_menu_event(app, event.id().as_ref()));

    let app_result = builder
        .setup(|app| {
            // Restore the durable pause before creating Windows WebViews.
            // Creating each WebView2 pumps the message loop, allowing the main
            // renderer to query status and request automatic tracking startup.
            // Restoring afterward let those requests erase a user's pause
            // during relaunch (Windows QA attempt 31, 2026-09-07).
            let tracking_pause_restored = tracking_pause::restore_on_startup(app.handle());
            #[cfg(target_os = "windows")]
            main_window_recovery::create_initial_window(app.handle());
            #[cfg(not(target_os = "windows"))]
            report_unavailable_main_window(app);
            #[cfg(target_os = "windows")]
            repair_windows_deep_link_registration(app.handle());
            setup_app_menu(app.handle())?;
            #[cfg(not(target_os = "windows"))]
            if let Err(error) = calibrate_main_window_to_work_area(app.handle()) {
                // The configured 1254×800 fallback is already usable. Monitor
                // discovery is a launch refinement and must not block startup.
                eprintln!("could not calibrate initial main-window size: {error}");
            }
            setup_auxiliary_window(
                app,
                commands::WATCHER_PEEK_WINDOW_LABEL,
                RECOVER_AUXILIARY_WINDOW_SETUP,
                setup_watcher_window,
            )?;
            setup_auxiliary_window(
                app,
                commands::COMPANION_PILL_WINDOW_LABEL,
                RECOVER_AUXILIARY_WINDOW_SETUP,
                setup_companion_pill_window,
            )?;
            setup_auxiliary_window(
                app,
                commands::PET_MODE_WINDOW_LABEL,
                RECOVER_AUXILIARY_WINDOW_SETUP,
                setup_pet_mode_window,
            )?;
            setup_auxiliary_window(
                app,
                commands::PET_QUICK_CONTROLS_WINDOW_LABEL,
                RECOVER_AUXILIARY_WINDOW_SETUP,
                setup_pet_quick_controls_window,
            )?;
            setup_tray(app.handle())?;
            // Crashes that ended earlier sessions outside Rust (AppKit
            // exceptions, aborts) only exist as macOS crash reports.
            native_crash_reports::forward_previous_crashes(app.handle());

            // Reclaim icon-cache generations nothing reads anymore. Both run
            // off-thread because they touch the filesystem, and a failure here
            // must never block startup.
            let icon_cache_handle = app.handle().clone();
            let _ = tauri::async_runtime::spawn_blocking(move || {
                if let Ok(bytes) = app_icons::purge_legacy_app_icon_cache(&icon_cache_handle) {
                    if bytes > 0 {
                        eprintln!("[icon-cache] reclaimed {bytes} bytes of legacy app icons");
                    }
                }
                if let Ok(bytes) =
                    site_icons::purge_stale_site_icon_generations(&icon_cache_handle)
                {
                    if bytes > 0 {
                        eprintln!("[icon-cache] reclaimed {bytes} bytes of stale site icons");
                    }
                }
            });

            let app_handle = app.handle().clone();
            // Installs that were already tracking before activation existed keep
            // running. A 1.10.8 database alone is not evidence, since that release
            // captured at launch; see collect_prior_use_evidence.
            tracking_activation::migrate_existing_install(
                app.handle(),
                tracking_activation::collect_prior_use_evidence(
                    &tracker::resolve_db_path(app.handle()),
                    &tracking_pause::state_path(app.handle()),
                ),
            );
            let tracking_activated = tracking_activation::is_activated(app.handle());
            if tracking_pause_restored {
                let _ = tauri::async_runtime::spawn_blocking(move || {
                    tracking_pause::enforce_restored_pause(&app_handle);
                });
            } else if !tracking_activated {
                // First run: capture waits for the user to start tracking during
                // onboarding. This is not a pause, so no pause state is written.
                eprintln!(
                    "[tracker] Tracking has not been activated on this device; waiting for onboarding to start it"
                );
            } else {
                let startup_state = app.state::<TrackerStartupState>();
                let generation = startup_state.begin_start_attempt();
                let pause_generation = app.state::<TrackingPauseState>().current_generation();
                let _ = tauri::async_runtime::spawn_blocking(move || {
                    let pause_state = app_handle.state::<TrackingPauseState>();
                    let _operation = pause_state.lock_operation();
                    if !tracking_pause::start_intent_is_current(&app_handle, pause_generation) {
                        return;
                    }
                    let controller = *app_handle.state::<TrackerController>();
                    let startup_state = app_handle.state::<TrackerStartupState>();
                    // Recheck the disk marker under the operation lock: an
                    // implicit launch must never clear or bypass a saved pause.
                    let start = match tracking_pause::run_start_unless_paused(
                        &app_handle,
                        false,
                        |_| controller.start_with_recovery(&app_handle, pause_generation),
                    ) {
                        Ok(Some(start)) => start,
                        Ok(None) => return,
                        Err(error) => {
                            eprintln!("[tracking-pause] Refusing automatic start: {error}");
                            return;
                        }
                    };
                    match start {
                        Ok(status) if status.running => {
                            if startup_state.complete_start_success(generation)
                                || pause_state.snapshot().is_active()
                            {
                                tray::queue_tracking_controls_refresh(
                                    &app_handle,
                                    Some(status.running),
                                );
                            }
                        }
                        Ok(status) => {
                            let error = tracker::TrackerError::TrackerReturnedError(
                                "tracker did not report running after automatic start".to_string(),
                            );
                            if startup_state.record_start_failure(generation, &error) {
                                tray::queue_tracking_controls_refresh(
                                    &app_handle,
                                    Some(status.running),
                                );
                            }
                            eprintln!(
                                "[tracker] Automatic start returned a stopped tracker; exposing recoverable degraded status"
                            );
                        }
                        Err(error) => {
                            startup_state.record_start_failure(generation, &error);
                            eprintln!(
                                "[tracker] Automatic start failed; exposing recoverable degraded status"
                            );
                        }
                    }
                });
            }
            setup_tracker_recovery(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            accessibility_get_status,
            accessibility_request_access,
            companion_informational_moments_suppressed,
            sentry_capture_native_smoke,
            share_card_save_png,
            ai_classification_anthropic_chat,
            ai_classification_openai_chat,
            ai_list_openai_models,
            app_menu_set_dev_mode_checked,
            quit_confirmation_set_language,
            app_restart_after_update,
            developer_list_releases,
            developer_install_release,
            developer_check_pre_release_update,
            developer_install_pre_release_update,
            developer_tools_get_status,
            developer_tools_install_cli,
            developer_tools_uninstall_cli,
            developer_tools_install_codex_skill,
            developer_tools_uninstall_codex_skill,
            developer_tools_install_skill,
            developer_tools_uninstall_skill,
            update_policy_fetch,
            update_prompt_show_native,
            update_status_show_native,
            tracker_get_status,
            tracker_start,
            tracker_stop,
            tracker_get_timeline,
            tracker_get_timeline_page,
            tracker_search_timeline,
            tracker_get_dashboard_week_timeline,
            tracker_get_project_trend_timeline,
            tracker_get_live_tail,
            tracker_get_current_snapshot,
            tracker_set_developer_diagnostics,
            tracker_preview_browser_history_import,
            tracker_import_browser_history,
            tracker_get_browser_history_environment,
            tracker_get_hourly_summary,
            tracker_get_raw_events,
            tracker_get_top_sites,
            tracker_get_app_icons,
            tracker_get_site_icons,
            tracker_clear_icon_caches,
            tracker_get_unclassified_segments,
            tracker_get_reusable_ai_classifications,
            tracker_get_classification_rules,
            tracker_save_classification_rule,
            tracker_delete_classification_rule,
            tracker_get_excluded_apps,
            tracker_save_excluded_app,
            tracker_delete_excluded_app,
            tracker_get_excluded_app_history_count,
            tracker_delete_excluded_app_history,
            tracker_get_recent_apps,
            tracker_delete_activity_segments,
            tracker_delete_history_range,
            tracker_search_classification_rule_candidates,
            tracker_apply_classification_rules,
            tracker_save_classifications,
            tracker_refresh_non_ai_classifications,
            tracker_get_classification_metrics,
            tracker_get_projects,
            tracker_get_dev_signals,
            tracker_get_agent_concurrency_peak,
            tracker_get_dev_repos,
            tracker_sync_dev_signals,
            tracker_list_ssh_agent_sources,
            tracker_test_ssh_agent_source,
            tracker_collect_ssh_agent_source,
            tracker_save_project,
            tracker_delete_project,
            tracker_save_project_anchors,
            tracker_delete_project_anchor,
            tracker_save_project_assignments,
            tracker_get_project_assignments,
            tracker_save_project_window_assignments,
            tracker_get_project_window_assignments,
            tracker_get_team_projects,
            tracker_upsert_team_projects,
            tracker_save_team_project_assignments,
            tracker_get_team_project_assignments,
            tracker_record_project_pass,
            tracker_get_project_pass_runs,
            tracker_save_ai_review_events,
            tracker_get_ai_review_events,
            tracker_revert_ai_review_event,
            tracker_get_sync_outbox,
            tracker_get_sync_state,
            tracker_set_sync_state,
            tracker_apply_synced_segments,
            tracker_get_pending_sync_deletions,
            tracker_mark_sync_deletions_pushed,
            tracker_apply_synced_deletions,
            tracker_purge_remote_segments,
            cloud_sync_http_post,
            tray_update_productivity_icon,
            tray_update_drift_alarm_status,
            tray_update_icon_style,
            tray_update_display_mode,
            tray_set_language,
            auth_take_pending_deep_links,
            auth_load_saved_session,
            auth_save_session,
            auth_clear_saved_session,
            openrouter_load_api_key,
            openrouter_save_api_key,
            openrouter_clear_api_key,
            custom_endpoint_load_api_key,
            custom_endpoint_save_api_key,
            custom_endpoint_clear_api_key,
            cloud_device_identity,
            cloud_device_install_id,
            app_reveal_main_window,
            focus_target_activate_browser_tab,
            focus_target_browser_tab_exists,
            focus_target_open_app,
            google_calendar_capability,
            google_calendar_authorize,
            google_calendar_finalize,
            google_calendar_discard_pending,
            google_calendar_status,
            google_calendar_events,
            google_calendar_disconnect,
            managed_ai_catalog,
            managed_ai_status,
            managed_ai_install,
            managed_ai_start,
            managed_ai_delete,
            startup_get_open_at_login_status,
            startup_set_open_at_login_enabled,
            startup_get_install_location,
            system_open_settings_pane,
            window_set_onboarding_presentation,
            window_set_theme_appearance,
            window_show_system_menu,
            watcher_peek_show,
            watcher_peek_hide,
            watcher_peek_dismiss,
            watcher_peek_set_interactive,
            watcher_peek_cursor_inside,
            watcher_peek_respond,
            watcher_peek_end_of_day_review_action,
            watcher_peek_end_of_day_review_displayed,
            watcher_peek_extreme_nudge_action,
            watcher_companion_set_enabled,
            watcher_companion_set_surface_policy,
            watcher_companion_set_state,
            watcher_companion_present_prepared,
            watcher_companion_set_click_through,
            watcher_companion_cursor_over_capsule,
            watcher_companion_clamp_to_screen,
            watcher_companion_update,
            watcher_companion_dismiss_moment,
            watcher_companion_visibility_action,
            extreme_nudge_apply,
            correction_evidence_append,
            living_soul_read,
            living_soul_write,
            pet_mode_set_enabled,
            pet_mode_set_size,
            pet_mode_set_dance_headroom,
            pet_mode_set_floor_home,
            pet_mode_update,
            pet_mode_visibility_action,
            pet_mode_intervene,
            pet_mode_preview_intervention,
            pet_mode_preview_action,
            pet_mode_cancel_motion,
            pet_mode_lab_apply_target,
            pet_mode_lab_place_center,
            pet_mode_move_to_target,
            pet_mode_align_contact,
            pet_mode_report_contact,
            pet_mode_report_drag_error,
            pet_mode_report_pointer,
            pet_mode_return_home,
            pet_mode_finish_fullscreen_intervention,
            pet_mode_complete_fullscreen_close,
            pet_mode_set_presence,
            pet_mode_set_interactive,
            pet_mode_update_hit_region,
            pet_mode_begin_drag,
            pet_mode_cursor_inside,
            pet_mode_cursor_sample,
            pet_mode_stalk_cursor,
            pet_mode_carry_cursor,
            pet_mode_input_bounds,
            pet_mode_roam,
            pet_mode_exit_screen,
            pet_mode_prepare_outing_hunt,
            pet_mode_return_from_outing,
            pet_mode_probe_ax_seat,
            pet_mode_reconcile_position,
            pet_mode_remember_position,
            pet_mode_resolve_drop,
            pet_quick_controls_set_visible,
            pet_quick_controls_sync_state,
            pet_quick_controls_get_state,
            pet_quick_controls_cursor_inside,
            pet_quick_controls_action,
        ])
        .build(tauri::generate_context!());

    let mut app = match app_result {
        Ok(app) => app,
        Err(error) => {
            eprintln!("error while building Drifty: {error}");
            std::process::exit(1);
        }
    };

    // Tauri/tao reapplies its own activation policy from runtime state when
    // applicationDidFinishLaunching fires. Set that state before `run` so it
    // cannot overwrite the prelaunch AppKit policy with the Regular default.
    #[cfg(target_os = "macos")]
    if should_use_isolated_dev_activation_policy(
        std::env::var_os("DRIFTY_ISOLATED_DEV").as_deref(),
        cfg!(debug_assertions),
    ) {
        app.set_activation_policy(tauri::ActivationPolicy::Prohibited);
    }

    #[cfg(target_os = "macos")]
    let isolated_dev = should_use_isolated_dev_activation_policy(
        std::env::var_os("DRIFTY_ISOLATED_DEV").as_deref(),
        cfg!(debug_assertions),
    );
    #[cfg(not(target_os = "macos"))]
    let isolated_dev = false;
    app.run(move |handle, event| {
        if !matches!(event, tauri::RunEvent::Ready) {
            return;
        }

        let keep_hidden = should_keep_main_window_hidden_on_ready(handle);
        #[cfg(target_os = "windows")]
        let keep_hidden = {
            let explicit_open = handle
                .state::<main_window_recovery::MainWindowRecoveryState>()
                .on_ready();
            keep_hidden && !explicit_open
        };
        match ready_main_window_action(isolated_dev, keep_hidden) {
            ReadyMainWindowAction::RevealIsolatedWithoutActivation => {
                // Launch finished under Prohibited with the main window hidden,
                // so tao's key-window activation hack has already been skipped.
                // Keep Prohibited for the whole background-QA session: the
                // generated .app bundle gives Computer Use a stable identity
                // without making the process activatable.
                #[cfg(target_os = "macos")]
                if let Err(error) = reveal_isolated_main_window_without_activation(handle) {
                    eprintln!("could not reveal isolated Drifty window: {error}");
                }
            }
            ReadyMainWindowAction::KeepHidden => {}
            ReadyMainWindowAction::RevealAndFocus => request_main_window(handle),
        }
    });
}

#[cfg(test)]
mod lib_tests;
