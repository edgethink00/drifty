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

fn push_exit_call(calls: &std::sync::Arc<std::sync::Mutex<Vec<&'static str>>>, call: &'static str) {
    calls
        .lock()
        .expect("cleanup call log should not be poisoned")
        .push(call);
}

#[test]
fn exit_cleanup_steps_preserve_production_order() {
    let calls = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let managed_ai_calls = std::sync::Arc::clone(&calls);
    let daemon_calls = std::sync::Arc::clone(&calls);
    let serve_calls = std::sync::Arc::clone(&calls);

    run_exit_cleanup_steps(
        || push_exit_call(&managed_ai_calls, "managed-ai"),
        || push_exit_call(&daemon_calls, "tracker-daemon"),
        || push_exit_call(&serve_calls, "tracker-serve-process"),
    );

    assert_eq!(
        calls
            .lock()
            .expect("cleanup call log should not be poisoned")
            .as_slice(),
        ["managed-ai", "tracker-daemon", "tracker-serve-process"].as_slice()
    );
}

#[test]
fn exit_cleanup_steps_continue_after_a_panicking_step() {
    let calls = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let managed_ai_calls = std::sync::Arc::clone(&calls);
    let daemon_calls = std::sync::Arc::clone(&calls);
    let serve_calls = std::sync::Arc::clone(&calls);

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        run_exit_cleanup_steps(
            || push_exit_call(&managed_ai_calls, "managed-ai"),
            || {
                push_exit_call(&daemon_calls, "tracker-daemon");
                panic!("tracker daemon cleanup failed");
            },
            || push_exit_call(&serve_calls, "tracker-serve-process"),
        );
    }));

    assert!(result.is_err());
    assert_eq!(
        calls
            .lock()
            .expect("cleanup call log should not be poisoned")
            .as_slice(),
        ["managed-ai", "tracker-daemon", "tracker-serve-process"].as_slice()
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
