use super::*;
use crate::tracker::{
    apply_tracker_startup_state, apply_tracking_pause_state, degraded_tracker_status,
    reconcile_start_result_with_status, tracker_start_error_message, tracker_status_error_message,
    tracker_stop_error_message, TrackerError, TrackerStartupState, TrackerStatus,
    TRACKER_PAUSE_STILL_RUNNING_MESSAGE, TRACKER_PAUSE_UNCONFIRMED_MESSAGE,
    TRACKER_STARTUP_FAILURE_MESSAGE_MAX_CHARS,
};

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
    assert!(!is_auth_callback_deep_link(
        "drifty://auth/callback-evil?code=ignored"
    ));
    assert!(!is_auth_callback_deep_link(
        "drifty://auth/google-callback/extra?code=ignored"
    ));
    assert!(!is_auth_callback_deep_link(
        "drifty://auth/google-callback#access%5Ftoken=secret"
    ));
    assert!(!is_auth_callback_deep_link(
        "drifty://auth/google-callback?code=ignored&access_token=secret"
    ));
    assert!(!is_auth_callback_deep_link(
        "drifty://auth/google-callback?code=ignored#refresh_token=secret"
    ));
}

#[test]
fn auth_deep_link_filter_routes_code_boundaries_to_the_frontend() {
    assert!(is_auth_callback_deep_link(
        "drifty://auth/google-callback?code="
    ));
    assert!(is_auth_callback_deep_link(&format!(
        "drifty://auth/google-callback?code={}",
        "x".repeat(4_096)
    )));
    assert!(is_auth_callback_deep_link(&format!(
        "drifty://auth/google-callback?code={}",
        "x".repeat(4_097)
    )));
    assert!(is_auth_callback_deep_link(
        "drifty://auth/google-callback?code=%E0%A4%A"
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
fn team_invite_deep_link_filter_accepts_only_team_invite_links() {
    assert!(is_team_invite_deep_link("drifty://team-invite"));
    assert!(is_team_invite_deep_link(
        "drifty://team-invite?token=abcdefghijklmnopqrstuvwxyzABCDEFG_1234567890&code=DRFT-ABCD-2345"
    ));
    assert!(is_team_invite_deep_link(
        "drifty://team-invite/?code=DRFT-ABCD-2345"
    ));
    assert!(!is_team_invite_deep_link(
        "https://drifty.so/team-invite?code=DRFT-ABCD-2345"
    ));
    assert!(!is_team_invite_deep_link(
        "drifty://team-invite.evil.example?code=DRFT-ABCD-2345"
    ));
    assert!(!is_team_invite_deep_link(
        "drifty://auth/callback?code=DRFT-ABCD-2345"
    ));
}

#[test]
fn command_w_main_window_close_hides_instead_of_closing() {
    assert!(should_hide_instead_of_close("main"));
    assert!(!should_hide_instead_of_close("watcher-peek"));
    assert!(!should_hide_instead_of_close("settings"));
}

#[test]
fn macos_reopen_policy_reveals_only_without_visible_windows() {
    assert!(should_reveal_main_window_on_reopen(false));
    assert!(!should_reveal_main_window_on_reopen(true));
}

#[cfg(target_os = "macos")]
#[test]
fn isolated_dev_activation_policy_requires_explicit_launcher_marker() {
    use std::ffi::OsStr;

    assert!(should_use_isolated_dev_activation_policy(
        Some(OsStr::new("1")),
        true,
    ));
    assert!(!should_use_isolated_dev_activation_policy(
        Some(OsStr::new("1")),
        false,
    ));
    assert!(!should_use_isolated_dev_activation_policy(None, true));
    assert!(!should_use_isolated_dev_activation_policy(
        Some(OsStr::new("0")),
        true
    ));
    assert!(!should_use_isolated_dev_activation_policy(
        Some(OsStr::new("true")),
        true
    ));
}
fn tracker_status(running: bool) -> TrackerStatus {
    let (tracker_mode, message) = if running {
        ("tracking", "Tracker is running.")
    } else {
        ("stopped", "Tracker is stopped.")
    };

    TrackerStatus {
        running,
        tracking_paused: false,
        accessibility_granted: true,
        last_event_at: Some("2026-07-12T12:00:00Z".into()),
        database_path: Some("tracker.sqlite3".into()),
        tracker_mode: Some(tracker_mode.into()),
        idle_seconds: Some(0.0),
        idle_detection_available: Some(true),
        message: Some(message.into()),
    }
}

#[test]
fn persisted_pause_exposes_live_or_unconfirmed_capture_until_stop_is_verified() {
    let live = apply_tracking_pause_state(tracker_status(true), true);
    assert!(live.running);
    assert!(live.tracking_paused);
    assert_eq!(live.tracker_mode.as_deref(), Some("degraded"));
    assert_eq!(live.message.as_deref(), Some(TRACKER_PAUSE_STILL_RUNNING_MESSAGE));

    let unknown = apply_tracking_pause_state(degraded_tracker_status("status unavailable".into()), true);
    assert!(!unknown.running);
    assert!(unknown.tracking_paused);
    assert_eq!(unknown.tracker_mode.as_deref(), Some("degraded"));
    assert_eq!(unknown.message.as_deref(), Some(TRACKER_PAUSE_UNCONFIRMED_MESSAGE));
}

#[test]
fn tracker_startup_state_retains_failure_until_tracker_recovers() {
    let startup_state = TrackerStartupState::default();
    let initial_start = startup_state.begin_start_attempt();
    assert!(startup_state.record_start_failure(
        initial_start,
        &TrackerError::MissingRuntime("/private/tracker-runtime".into()),
    ));
    assert_eq!(
        startup_state.failure_message().as_deref(),
        Some("Activity tracking components are unavailable. Try starting it again.")
    );

    let retry_start = startup_state.begin_start_attempt();
    assert!(startup_state.record_start_failure(
        retry_start,
        &TrackerError::CommandFailed("raw tracker output must not reach the user".into()),
    ));
    assert_eq!(
        startup_state.failure_message().as_deref(),
        Some("Activity tracking could not start. Try starting it again.")
    );

    let degraded = apply_tracker_startup_state(&startup_state, tracker_status(false));
    assert!(!degraded.running);
    assert_eq!(degraded.tracker_mode.as_deref(), Some("degraded"));
    assert!(startup_state.failure_message().is_some());

    let recovered = apply_tracker_startup_state(&startup_state, tracker_status(true));
    assert!(recovered.running);
    assert_eq!(recovered.tracker_mode.as_deref(), Some("tracking"));
    assert_eq!(recovered.message.as_deref(), Some("Tracker is running."));
    assert_eq!(startup_state.failure_message(), None);
}

#[test]
fn tracker_start_recovers_a_lost_reply_only_when_status_confirms_running() {
    let recovered = reconcile_start_result_with_status(
        Err(TrackerError::CommandFailed("sidecar response lost".into())),
        || Ok(tracker_status(true)),
    )
    .expect("running daemon confirms the start");
    assert!(recovered.running);

    let failed = reconcile_start_result_with_status(
        Err(TrackerError::CommandFailed("sidecar response lost".into())),
        || Ok(tracker_status(false)),
    );
    assert!(matches!(failed, Err(TrackerError::CommandFailed(_))));

    let late_running = reconcile_start_result_with_status(Ok(tracker_status(false)), || {
        Ok(tracker_status(true))
    })
    .expect("daemon became visible after the start response");
    assert!(late_running.running);

    let missing = reconcile_start_result_with_status(
        Err(TrackerError::MissingRuntime("missing component".into())),
        || panic!("missing runtime cannot be recovered by a status probe"),
    );
    assert!(matches!(missing, Err(TrackerError::MissingRuntime(_))));
}
#[test]
fn tracker_startup_state_ignores_stale_start_completions() {
    let startup_state = TrackerStartupState::default();
    let automatic_start = startup_state.begin_start_attempt();
    let explicit_start = startup_state.begin_start_attempt();

    assert!(startup_state.record_start_failure(
        explicit_start,
        &TrackerError::CommandFailed("newer explicit start stderr".into()),
    ));
    assert!(!startup_state.complete_start_success(automatic_start));
    assert!(startup_state.failure_message().is_some());

    assert!(startup_state.complete_start_success(explicit_start));
    assert_eq!(startup_state.failure_message(), None);
    assert!(!startup_state.record_start_failure(
        automatic_start,
        &TrackerError::CommandFailed("stale automatic start stderr".into()),
    ));
}

#[test]
fn tracker_startup_state_stop_supersedes_in_flight_start() {
    let startup_state = TrackerStartupState::default();
    let start_generation = startup_state.begin_start_attempt();

    assert!(startup_state.record_start_failure(
        start_generation,
        &TrackerError::CommandFailed("initial start stderr".into()),
    ));
    assert!(startup_state.failure_message().is_some());

    let stop_generation = startup_state.begin_stop_attempt();
    assert!(startup_state.complete_stop_success(stop_generation));
    assert_eq!(startup_state.failure_message(), None);
    assert!(!startup_state.complete_start_success(start_generation));
    assert!(!startup_state.record_start_failure(
        start_generation,
        &TrackerError::CommandFailed("late start stderr".into()),
    ));

    let stopped = apply_tracker_startup_state(&startup_state, tracker_status(false));
    assert!(!stopped.running);
    assert_eq!(stopped.tracker_mode.as_deref(), Some("stopped"));
    assert_eq!(stopped.message.as_deref(), Some("Tracker is stopped."));
}

#[test]
fn older_stop_completion_does_not_discard_newer_start_failure() {
    let startup_state = TrackerStartupState::default();
    let older_stop = startup_state.begin_stop_attempt();
    let newer_start = startup_state.begin_start_attempt();

    assert!(!startup_state.complete_stop_success(older_stop));
    assert!(startup_state.record_start_failure(
        newer_start,
        &TrackerError::CommandFailed("newer start failed".into()),
    ));
    assert!(startup_state.failure_message().is_some());
}

#[test]
fn tracker_start_and_status_errors_are_safe_and_bounded() {
    let raw_detail = "/private/tracker-runtime stderr: provider secret";
    let start_error = tracker_start_error_message();
    let status_error = tracker_status_error_message();
    let stop_error = tracker_stop_error_message();

    for message in [&start_error, &status_error, &stop_error] {
        assert!(message.chars().count() <= TRACKER_STARTUP_FAILURE_MESSAGE_MAX_CHARS);
        assert!(!message.contains(raw_detail));
    }
    assert_eq!(
        start_error,
        "Activity tracking could not start. Try starting it again."
    );
    assert_eq!(
        status_error,
        "Activity tracking status is unavailable. Try again."
    );
    assert_eq!(stop_error, "Activity tracking could not stop. Try again.");
}

#[test]
fn degraded_tracker_status_uses_a_bounded_message() {
    let status = degraded_tracker_status("x".repeat(TRACKER_STARTUP_FAILURE_MESSAGE_MAX_CHARS + 1));

    assert!(!status.running);
    assert_eq!(status.tracker_mode.as_deref(), Some("degraded"));
    assert_eq!(
        status
            .message
            .as_deref()
            .expect("degraded status includes a user-safe message")
            .chars()
            .count(),
        TRACKER_STARTUP_FAILURE_MESSAGE_MAX_CHARS
    );
}

fn push_exit_call(calls: &std::sync::Arc<std::sync::Mutex<Vec<&'static str>>>, call: &'static str) {
    calls
        .lock()
        .expect("cleanup call log should not be poisoned")
        .push(call);
}

#[test]
fn exit_cleanup_stops_request_producer_before_final_daemon_stop() {
    let calls = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let managed_ai_calls = std::sync::Arc::clone(&calls);
    let daemon_calls = std::sync::Arc::clone(&calls);
    let serve_calls = std::sync::Arc::clone(&calls);
    let tray_worker_calls = std::sync::Arc::clone(&calls);

    run_exit_cleanup_steps(
        || push_exit_call(&calls, "tracker-recovery-worker"),
        || push_exit_call(&tray_worker_calls, "tray-refresh-worker"),
        || push_exit_call(&managed_ai_calls, "managed-ai"),
        || push_exit_call(&daemon_calls, "tracker-daemon"),
        || push_exit_call(&serve_calls, "tracker-serve-process"),
    );

    assert_eq!(
        calls
            .lock()
            .expect("cleanup call log should not be poisoned")
            .as_slice(),
        [
            "tracker-recovery-worker",
            "tray-refresh-worker",
            "managed-ai",
            "tracker-serve-process",
            "tracker-daemon",
        ]
        .as_slice()
    );
}

#[test]
fn exit_cleanup_steps_continue_after_a_panicking_step() {
    let calls = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let managed_ai_calls = std::sync::Arc::clone(&calls);
    let daemon_calls = std::sync::Arc::clone(&calls);
    let serve_calls = std::sync::Arc::clone(&calls);
    let tray_worker_calls = std::sync::Arc::clone(&calls);

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        run_exit_cleanup_steps(
            || push_exit_call(&calls, "tracker-recovery-worker"),
            || push_exit_call(&tray_worker_calls, "tray-refresh-worker"),
            || push_exit_call(&managed_ai_calls, "managed-ai"),
            || push_exit_call(&daemon_calls, "tracker-daemon"),
            || {
                push_exit_call(&serve_calls, "tracker-serve-process");
                panic!("tracker serve cleanup failed");
            },
        );
    }));

    assert!(result.is_err());
    assert_eq!(
        calls
            .lock()
            .expect("cleanup call log should not be poisoned")
            .as_slice(),
        [
            "tracker-recovery-worker",
            "tray-refresh-worker",
            "managed-ai",
            "tracker-serve-process",
            "tracker-daemon",
        ]
        .as_slice()
    );
}

#[test]
fn app_exit_coordinator_runs_successful_cleanup_once() {
    let coordinator = AppExitCoordinator::default();
    let calls = std::sync::atomic::AtomicUsize::new(0);

    for _ in 0..3 {
        coordinator.shutdown_once(|| {
            calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        });
    }

    assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
}

#[test]
fn app_exit_coordinator_allows_retry_after_cleanup_panics() {
    let coordinator = AppExitCoordinator::default();
    let calls = std::sync::atomic::AtomicUsize::new(0);

    let first = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        coordinator.shutdown_once(|| {
            calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            panic!("first cleanup failed");
        });
    }));
    assert!(first.is_err());

    coordinator.shutdown_once(|| {
        calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    });

    assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 2);
}

#[test]
fn app_exit_coordinator_ignores_same_thread_reentry() {
    let coordinator = AppExitCoordinator::default();
    let outer_calls = std::sync::atomic::AtomicUsize::new(0);
    let nested_calls = std::sync::atomic::AtomicUsize::new(0);

    coordinator.shutdown_once(|| {
        outer_calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        coordinator.shutdown_once(|| {
            nested_calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        });
    });

    assert_eq!(outer_calls.load(std::sync::atomic::Ordering::SeqCst), 1);
    assert_eq!(nested_calls.load(std::sync::atomic::Ordering::SeqCst), 0);
}

#[test]
fn app_exit_coordinator_waits_for_cleanup_in_progress() {
    let coordinator = std::sync::Arc::new(AppExitCoordinator::default());
    let started = std::sync::Arc::new(std::sync::Barrier::new(2));
    let release = std::sync::Arc::new(std::sync::Barrier::new(2));
    let calls = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));

    let first_coordinator = std::sync::Arc::clone(&coordinator);
    let first_started = std::sync::Arc::clone(&started);
    let first_release = std::sync::Arc::clone(&release);
    let first_calls = std::sync::Arc::clone(&calls);
    let first = std::thread::spawn(move || {
        first_coordinator.shutdown_once(|| {
            first_calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            first_started.wait();
            first_release.wait();
        });
    });
    started.wait();

    let (completed_tx, completed_rx) = std::sync::mpsc::channel();
    let second_coordinator = std::sync::Arc::clone(&coordinator);
    let second_calls = std::sync::Arc::clone(&calls);
    let second = std::thread::spawn(move || {
        second_coordinator.shutdown_once(|| {
            second_calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        });
        completed_tx
            .send(())
            .expect("completion receiver should remain available");
    });

    assert!(completed_rx
        .recv_timeout(std::time::Duration::from_millis(50))
        .is_err());
    release.wait();
    completed_rx
        .recv_timeout(std::time::Duration::from_secs(1))
        .expect("waiting caller should return after cleanup completes");

    first.join().expect("first cleanup thread should complete");
    second
        .join()
        .expect("second cleanup thread should complete");
    assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
}

#[test]
fn update_restart_runs_exit_cleanup_before_restart() {
    let calls = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let restart_calls = std::sync::Arc::clone(&calls);

    run_update_restart(
        || push_exit_call(&calls, "cleanup"),
        || push_exit_call(&restart_calls, "restart"),
    );

    assert_eq!(
        calls
            .lock()
            .expect("update restart call log should not be poisoned")
            .as_slice(),
        ["cleanup", "restart"].as_slice()
    );
}

#[test]
fn silent_update_relaunch_marker_absent_does_not_hide_window() {
    let directory = tempfile::tempdir().expect("temp dir");
    assert!(!consume_silent_update_relaunch(directory.path()));
    assert!(!update_relaunch_silent_marker_path(directory.path()).exists());
}

#[test]
fn silent_update_relaunch_marker_is_consumed_and_deleted() {
    let directory = tempfile::tempdir().expect("temp dir");
    mark_silent_update_relaunch(directory.path());
    let marker = update_relaunch_silent_marker_path(directory.path());
    assert!(marker.is_file());
    assert!(consume_silent_update_relaunch(directory.path()));
    assert!(!marker.exists());
    assert!(!consume_silent_update_relaunch(directory.path()));
}

fn failing_overlay_setup<R: Runtime>(app: &tauri::App<R>, label: &str) -> tauri::Result<()> {
    tauri::WebviewWindowBuilder::new(app, label, Default::default()).build()?;
    Err(tauri::Error::InvalidWindowHandle)
}

#[test]
fn auxiliary_window_setup_failure_keeps_launching_without_that_overlay() {
    let app = tauri::test::mock_app();

    let result = setup_auxiliary_window(&app, "pet-mode", true, |app| {
        failing_overlay_setup(app, "pet-mode")
    });

    assert!(result.is_ok(), "an optional overlay must not abort setup");
}

#[test]
fn auxiliary_window_setup_failure_still_stops_launch_without_recovery() {
    let app = tauri::test::mock_app();

    let result = setup_auxiliary_window(&app, "pet-mode", false, |app| {
        failing_overlay_setup(app, "pet-mode")
    });

    assert!(matches!(result, Err(tauri::Error::InvalidWindowHandle)));
}

#[test]
fn auxiliary_window_setup_success_keeps_the_overlay() {
    let app = tauri::test::mock_app();

    let result = setup_auxiliary_window(&app, "watcher-peek", true, |app| {
        tauri::WebviewWindowBuilder::new(app, "watcher-peek", Default::default()).build()?;
        Ok(())
    });

    assert!(result.is_ok());
    assert!(app.get_webview_window("watcher-peek").is_some());
}

#[test]
fn auxiliary_window_failure_report_leads_with_the_logged_creation_error() {
    assert_eq!(
        auxiliary_window_failure_report(
            "pet-mode",
            "the underlying handle is not available",
            Some("failed to create webview: WebView2 error: 0x8007139F"),
        ),
        "Auxiliary window setup failed (pet-mode): failed to create webview: WebView2 error: 0x8007139F (the underlying handle is not available)"
    );
    assert_eq!(
        auxiliary_window_failure_report("pet-mode", "the underlying handle is not available", None),
        "Auxiliary window setup failed (pet-mode): the underlying handle is not available"
    );
}

#[test]
fn main_window_report_names_a_launch_that_has_no_window() {
    let app = tauri::test::mock_app();
    assert_eq!(
        report_unavailable_main_window(&app).as_deref(),
        Some("Main window setup failed: the window was not created")
    );

    tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("mock main window");
    assert_eq!(report_unavailable_main_window(&app), None);
}

#[test]
fn ready_window_policy_reveals_and_focuses_a_normal_launch() {
    assert_eq!(
        ready_main_window_action(false, false),
        ReadyMainWindowAction::RevealAndFocus
    );
}

#[test]
fn ready_window_policy_keeps_a_silent_or_background_launch_hidden() {
    assert_eq!(
        ready_main_window_action(false, true),
        ReadyMainWindowAction::KeepHidden
    );
}

#[test]
fn ready_window_policy_prefers_isolated_reveal_over_the_silent_marker() {
    assert_eq!(
        ready_main_window_action(true, true),
        ReadyMainWindowAction::RevealIsolatedWithoutActivation
    );
    assert_eq!(
        ready_main_window_action(true, false),
        ReadyMainWindowAction::RevealIsolatedWithoutActivation
    );
}

#[test]
fn silent_update_relaunch_marker_delete_failure_still_hides_this_launch() {
    let directory = tempfile::tempdir().expect("temp dir");
    let marker = update_relaunch_silent_marker_path(directory.path());
    std::fs::create_dir(&marker).expect("marker directory that remove_file cannot delete");
    assert!(consume_silent_update_relaunch(directory.path()));
    assert!(!marker.exists());
    assert!(directory
        .path()
        .join(format!("{UPDATE_RELAUNCH_SILENT_MARKER}.stale"))
        .exists());
    assert!(!consume_silent_update_relaunch(directory.path()));
}
