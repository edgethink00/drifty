use super::*;

struct ThreadExitSignal(std::sync::mpsc::Sender<()>);

impl Drop for ThreadExitSignal {
    fn drop(&mut self) {
        let _ = self.0.send(());
    }
}

#[test]
fn app_version_label_formats_drifty_version() {
    assert_eq!(app_version_label("1.2.3"), "Drifty 1.2.3");
}

fn sample_tray_menu_plan(
    lang: TrayLanguage,
    pause_snapshot: TrackingPauseSnapshot,
    drift_summary: Option<&str>,
) -> TrayMenuPlan {
    tray_menu_plan_from(
        lang,
        Some(true),
        pause_snapshot,
        "Drift alerts on".to_string(),
        drift_summary.map(str::to_string),
        "1.2.3",
    )
}

fn visible_rows(plan: &TrayMenuPlan) -> Vec<(String, String, bool)> {
    tray_menu_rows(plan)
        .into_iter()
        .filter(|row| row.visible)
        .map(|row| {
            (
                row.id.to_string(),
                row.text.unwrap_or_else(|| "---".into()),
                row.enabled,
            )
        })
        .collect()
}

#[test]
fn running_tray_preserves_pause_choices_and_static_actions() {
    let plan = sample_tray_menu_plan(TrayLanguage::English, TrackingPauseSnapshot::Inactive, None);
    let rendered = visible_rows(&plan);
    let labels: Vec<_> = rendered
        .iter()
        .map(|(_, text, enabled)| (text.as_str(), *enabled))
        .collect();
    assert_eq!(
        labels,
        vec![
            ("Pause Tracking", false),
            ("15 Minutes", true),
            ("30 Minutes", true),
            ("1 Hour", true),
            ("Forever", true),
            ("---", false),
            ("Drift alerts on", false),
            ("---", false),
            ("Open Dashboard", true),
            ("Settings", true),
            ("---", false),
            ("Drifty 1.2.3", false),
            ("Check for Updates...", true),
            ("---", false),
            ("Quit", true),
        ]
    );
}

#[test]
fn paused_and_stopped_trays_offer_only_the_applicable_tracking_action() {
    for (running, pause, action, status) in [
        (
            Some(true),
            TrackingPauseSnapshot::Indefinite,
            "Resume Tracking",
            Some("Paused until you resume"),
        ),
        (
            Some(false),
            TrackingPauseSnapshot::Inactive,
            "Start Tracking",
            None,
        ),
        (
            None,
            TrackingPauseSnapshot::Inactive,
            "Start Tracking",
            None,
        ),
    ] {
        let plan = tray_menu_plan_from(
            TrayLanguage::English,
            running,
            pause,
            "Alerts".into(),
            Some("2h drifted".into()),
            "1.2.3",
        );
        let rendered = visible_rows(&plan);
        assert_eq!(
            rendered[0],
            (tray_menu_id::TRACKING_TOGGLE.into(), action.into(), true)
        );
        assert!(!rendered.iter().any(
            |(id, _, _)| id == tray_menu_id::PAUSE_FOR_15 || id == tray_menu_id::PAUSE_FOREVER
        ));
        let pause_row = rendered
            .iter()
            .find(|(id, _, _)| id == tray_menu_id::PAUSE_STATUS);
        assert_eq!(pause_row.map(|(_, label, _)| label.as_str()), status);
        assert!(rendered
            .iter()
            .any(|(id, label, enabled)| id == tray_menu_id::DRIFT_SUMMARY
                && label == "2h drifted"
                && !enabled));
    }
}

#[test]
fn korean_menu_and_language_roundtrip_preserve_actions_and_optional_rows() {
    let en = sample_tray_menu_plan(
        TrayLanguage::English,
        TrackingPauseSnapshot::Indefinite,
        Some("summary"),
    );
    let ko = sample_tray_menu_plan(
        TrayLanguage::Korean,
        TrackingPauseSnapshot::Indefinite,
        Some("summary"),
    );
    let english = visible_rows(&en);
    let korean = visible_rows(&ko);
    assert_eq!(korean[0].1, "활동 기록 다시 시작");
    assert!(korean.iter().any(|(_, label, _)| label == "대시보드 열기"));
    assert!(korean.iter().any(|(_, label, _)| label == "설정"));
    assert!(korean.iter().any(|(_, label, _)| label == "업데이트 확인…"));
    assert_eq!(
        english
            .iter()
            .map(|(id, _, enabled)| (id, enabled))
            .collect::<Vec<_>>(),
        korean
            .iter()
            .map(|(id, _, enabled)| (id, enabled))
            .collect::<Vec<_>>()
    );
}

#[test]
fn every_tracking_and_summary_state_uses_the_same_bounded_item_pool() {
    let baseline = tray_menu_rows(&sample_tray_menu_plan(
        TrayLanguage::English,
        TrackingPauseSnapshot::Inactive,
        None,
    ));
    let schema = |rows: Vec<MenuRow>| {
        rows.into_iter()
            .map(|row| (row.id, row.text.is_some()))
            .collect::<Vec<_>>()
    };
    let expected = schema(baseline);
    let mut unique_ids = std::collections::HashSet::new();
    assert!(expected.iter().all(|(id, _)| unique_ids.insert(*id)));
    for language in [TrayLanguage::English, TrayLanguage::Korean] {
        for running in [None, Some(false), Some(true)] {
            for pause in [
                TrackingPauseSnapshot::Inactive,
                TrackingPauseSnapshot::Indefinite,
                TrackingPauseSnapshot::Timed {
                    resumes_at_unix_seconds: 1_800_000_000,
                },
                TrackingPauseSnapshot::ResumeFailed {
                    resumes_at_unix_seconds: 1_800_000_000,
                },
            ] {
                for summary in [None, Some("drift")] {
                    let plan = tray_menu_plan_from(
                        language,
                        running,
                        pause,
                        "Alerts".into(),
                        summary.map(str::to_string),
                        "1.2.3",
                    );
                    assert_eq!(
                        schema(tray_menu_rows(&plan)),
                        expected,
                        "state changes must never allocate replacement click targets"
                    );
                }
            }
        }
    }
}

#[test]
fn menu_refreshes_dispatch_the_complete_snapshot_and_update_transaction() {
    // A regression to worker-side snapshots or independently queued native
    // setters can resurrect stale menus. Keep these orchestration boundaries.
    let source = include_str!("../tray.rs");
    let refresh = source
        .split("fn refresh_tray_menu(app:")
        .nth(1)
        .unwrap()
        .split("fn refresh_tray_menu_on_main_thread")
        .next()
        .unwrap();
    assert!(refresh.contains("run_on_main_thread"));
    assert!(!refresh.contains("tray_menu_plan("));
    let language = source
        .split("pub async fn tray_set_language(")
        .nth(1)
        .unwrap()
        .split("pub(crate) fn tray_icon_rect")
        .next()
        .unwrap();
    assert!(
        language.find("run_menu_update").unwrap() < language.find("latest_tray_language").unwrap()
    );
    assert!(
        !source.contains(".set_menu("),
        "tray refresh must preserve its original menu root"
    );
    let app_menu = include_str!("../app_menu.rs");
    assert_eq!(app_menu.matches(".set_as_app_menu()").count(), 1);
    assert!(
        app_menu.find("try_state::<AppMenuState>").unwrap()
            < app_menu.find("let menu = Menu::default").unwrap()
    );
}

#[test]
fn focused_time_title_uses_hours_and_zero_padded_minutes() {
    assert_eq!(format_focus_time(0.0), "0:00");
    assert_eq!(format_focus_time(9_660.0), "2:41");
    assert_eq!(format_focus_time(f64::NAN), "0:00");
}

#[test]
fn focused_time_title_is_three_percent_larger_than_the_menu_bar_default() {
    assert!((scaled_tray_title_size(13.0) - 13.39).abs() < f64::EPSILON);
}

#[test]
fn focused_time_title_reduces_weight_by_four_percent_and_locates_secondary_copy() {
    assert!((reduced_tray_title_weight(680.0) - 652.8).abs() < f64::EPSILON);
    assert_eq!(focused_label_start_utf16("2:41 focused", "focused"), Some(5));
}

#[test]
fn focused_label_start_utf16_works_for_korean_suffix() {
    assert_eq!(focused_label_start_utf16("2:41 집중", "집중"), Some(5));
}

#[test]
fn donut_focus_time_replaces_the_dot_with_a_compact_productivity_ring() {
    let (_, hybrid_width, hybrid_height) = render_tray_display_icon(
        TrayDisplayMode::DonutFocusTime,
        0.6,
        0.2,
        0.2,
        true,
        TrayIconStyle::Expanded,
    );
    let (_, dot_width, dot_height) = render_tray_display_icon(
        TrayDisplayMode::FocusTime,
        0.6,
        0.2,
        0.2,
        true,
        TrayIconStyle::Expanded,
    );

    assert_eq!((hybrid_width, hybrid_height), (22, 18));
    assert_eq!((dot_width, dot_height), (14, 18));
}

#[test]
fn tray_icon_spacing_adds_only_transparent_pixels_after_the_indicator() {
    let source = vec![255, 64, 32, 255];
    let (padded, width, height) = add_trailing_icon_space((source, 1, 1), 2);

    assert_eq!((width, height), (3, 1));
    assert_eq!(padded, vec![255, 64, 32, 255, 0, 0, 0, 0, 0, 0, 0, 0]);
}

#[test]
fn tracking_action_label_starts_when_stopped_or_unknown() {
    assert_eq!(
        tracking_action_label(Some(false), TrackingPauseSnapshot::Inactive, TrayLanguage::English),
        "Start Tracking"
    );
    assert_eq!(
        tracking_action_label(None, TrackingPauseSnapshot::Inactive, TrayLanguage::English),
        "Start Tracking"
    );
}

#[test]
fn tracking_action_label_pauses_when_running() {
    assert_eq!(
        tracking_action_label(Some(true), TrackingPauseSnapshot::Inactive, TrayLanguage::English),
        "Pause Tracking"
    );
}

#[test]
fn inline_pause_options_are_visible_only_for_confirmed_running_tracking() {
    assert!(pause_options_visible(
        Some(true),
        TrackingPauseSnapshot::Inactive
    ));
    assert!(!pause_options_visible(
        Some(false),
        TrackingPauseSnapshot::Inactive
    ));
    assert!(!pause_options_visible(
        None,
        TrackingPauseSnapshot::Inactive
    ));
}

#[test]
fn tracking_action_label_resumes_for_indefinite_timed_and_failed_pauses() {
    for pause in [
        TrackingPauseSnapshot::Indefinite,
        TrackingPauseSnapshot::Timed {
            resumes_at_unix_seconds: 1_800_000_000,
        },
        TrackingPauseSnapshot::ResumeFailed {
            resumes_at_unix_seconds: 1_800_000_000,
        },
    ] {
        assert_eq!(tracking_action_label(Some(false), pause, TrayLanguage::English), "Resume Tracking");
        assert!(!pause_options_visible(Some(false), pause));
    }
}

#[test]
fn pause_status_labels_explain_indefinite_timed_and_failed_states() {
    assert_eq!(
        pause_status_label(TrackingPauseSnapshot::Indefinite, TrayLanguage::English).as_deref(),
        Some("Paused until you resume")
    );
    assert!(pause_status_label(TrackingPauseSnapshot::Timed {
        resumes_at_unix_seconds: 1_800_000_000,
    }, TrayLanguage::English)
    .expect("timed label")
    .starts_with("Paused · resumes at "));
    assert_eq!(
        pause_status_label(TrackingPauseSnapshot::ResumeFailed {
            resumes_at_unix_seconds: 1_800_000_000,
        }, TrayLanguage::English)
        .as_deref(),
        Some("Paused · automatic resume failed")
    );
}

#[test]
fn tray_icon_render_key_matches_for_unchanged_input() {
    assert_eq!(
        TrayIconRenderKey::new(
            0.5,
            0.25,
            0.25,
            true,
            TrayIconStyle::Compact,
            TrayDisplayMode::Donut
        ),
        TrayIconRenderKey::new(
            0.5,
            0.25,
            0.25,
            true,
            TrayIconStyle::Compact,
            TrayDisplayMode::Donut
        ),
    );
}

#[test]
fn tray_icon_render_key_changes_when_any_render_input_changes() {
    let base = TrayIconRenderKey::new(
        0.5,
        0.25,
        0.25,
        true,
        TrayIconStyle::Compact,
        TrayDisplayMode::Donut,
    );

    assert_ne!(
        base,
        TrayIconRenderKey::new(
            0.6,
            0.25,
            0.25,
            true,
            TrayIconStyle::Compact,
            TrayDisplayMode::Donut
        )
    );
    assert_ne!(
        base,
        TrayIconRenderKey::new(
            0.5,
            0.3,
            0.25,
            true,
            TrayIconStyle::Compact,
            TrayDisplayMode::Donut
        )
    );
    assert_ne!(
        base,
        TrayIconRenderKey::new(
            0.5,
            0.25,
            0.3,
            true,
            TrayIconStyle::Compact,
            TrayDisplayMode::Donut
        )
    );
    assert_ne!(
        base,
        TrayIconRenderKey::new(
            0.5,
            0.25,
            0.25,
            false,
            TrayIconStyle::Compact,
            TrayDisplayMode::Donut
        )
    );
    assert_ne!(
        base,
        TrayIconRenderKey::new(
            0.5,
            0.25,
            0.25,
            true,
            TrayIconStyle::Expanded,
            TrayDisplayMode::Donut
        )
    );
    assert_ne!(
        base,
        TrayIconRenderKey::new(
            0.5,
            0.25,
            0.25,
            true,
            TrayIconStyle::Compact,
            TrayDisplayMode::FocusTime
        )
    );
}

#[test]
fn older_queued_render_cannot_overwrite_newer_direct_render() {
    let mut state = TrayIconRenderState::default();
    let queued_a_generation = state.claim_request();
    let queued_a_key = TrayIconRenderKey::new(
        0.5,
        0.25,
        0.25,
        true,
        TrayIconStyle::Compact,
        TrayDisplayMode::Donut,
    );

    let direct_b_generation = state.claim_request();
    let direct_b_key = TrayIconRenderKey::new(
        0.6,
        0.25,
        0.15,
        true,
        TrayIconStyle::Compact,
        TrayDisplayMode::Donut,
    );
    assert!(
        state.should_apply(direct_b_generation, direct_b_key),
        "newer direct update should apply"
    );
    state.record_applied(direct_b_key);

    assert!(
        !state.should_apply(queued_a_generation, queued_a_key),
        "older queued update must be discarded when it executes after direct update"
    );
    assert_eq!(state.last_applied_key, Some(direct_b_key));
}

#[test]
fn tray_refresh_worker_starts_once_and_does_not_restart_after_shutdown() {
    let worker = TrayRefreshWorker::default();
    let (started_tx, started_rx) = std::sync::mpsc::sync_channel(1);

    assert!(worker
        .start(move |_| {
            started_tx
                .send(())
                .expect("test should receive the first refresh");
        })
        .expect("worker should start"));
    started_rx
        .recv_timeout(std::time::Duration::from_secs(1))
        .expect("worker should run its initial refresh");
    assert!(!worker
        .start(|_| panic!("duplicate start must not launch a second worker"))
        .expect("duplicate start should be a no-op"));

    worker.shutdown();

    assert!(!worker
        .start(|_| panic!("stopped worker must not restart"))
        .expect("start after shutdown should be a no-op"));
}

#[test]
fn tray_refresh_worker_stop_wakes_wait_joins_and_is_idempotent() {
    let worker = TrayRefreshWorker::default();
    let (started_tx, started_rx) = std::sync::mpsc::sync_channel(1);
    let (exited_tx, exited_rx) = std::sync::mpsc::channel();
    let thread_exit_signal = ThreadExitSignal(exited_tx);

    assert!(worker
        .start(move |_| {
            let _ = &thread_exit_signal;
            started_tx
                .send(())
                .expect("test should receive the first refresh");
        })
        .expect("worker should start"));
    started_rx
        .recv_timeout(std::time::Duration::from_secs(1))
        .expect("worker should be waiting for its next refresh");

    let shutdown_started = std::time::Instant::now();
    worker.shutdown();

    assert!(
        shutdown_started.elapsed() < std::time::Duration::from_secs(5),
        "shutdown should interrupt the 60-second refresh wait"
    );
    exited_rx
        .try_recv()
        .expect("shutdown should join the refresh worker before returning");

    worker.shutdown();
    assert!(exited_rx.try_recv().is_err());
}

#[test]
fn tray_refresh_worker_does_not_wait_for_main_thread_handoff() {
    let worker = TrayRefreshWorker::default();
    let (callback_tx, callback_rx) = std::sync::mpsc::sync_channel::<Box<dyn FnOnce() + Send>>(1);
    let (queued_tx, queued_rx) = std::sync::mpsc::sync_channel(1);
    let mutation_count = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let refresh_mutation_count = std::sync::Arc::clone(&mutation_count);

    assert!(worker
        .start(move |stopping| {
            let callback_tx = callback_tx.clone();
            let queued_tx = queued_tx.clone();
            let mutation_count = std::sync::Arc::clone(&refresh_mutation_count);
            let queued = enqueue_main_thread_mutation(
                stopping,
                move |callback| {
                    callback_tx
                        .send(callback)
                        .expect("test should receive the main-thread callback");
                    Ok::<(), ()>(())
                },
                move || {
                    mutation_count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                },
            )
            .expect("test callback queue should accept the handoff");
            queued_tx
                .send(queued)
                .expect("test should receive the enqueue result");
        })
        .expect("worker should start"));
    assert!(queued_rx
        .recv_timeout(std::time::Duration::from_secs(1))
        .expect("refresh should enqueue without waiting for the main thread"));

    let shutdown_started = std::time::Instant::now();
    worker.shutdown();

    assert!(
        shutdown_started.elapsed() < std::time::Duration::from_secs(5),
        "shutdown must not wait for the queued main-thread callback"
    );
    callback_rx
        .recv_timeout(std::time::Duration::from_secs(1))
        .expect("main-thread callback should remain queued")();
    assert_eq!(
        mutation_count.load(std::sync::atomic::Ordering::SeqCst),
        0,
        "a callback queued before shutdown must skip its tray mutation"
    );
}

#[test]
fn tray_refresh_worker_prevents_late_main_thread_enqueue_during_shutdown() {
    let worker = std::sync::Arc::new(TrayRefreshWorker::default());
    let (refresh_started_tx, refresh_started_rx) = std::sync::mpsc::sync_channel(1);
    let (release_refresh_tx, release_refresh_rx) = std::sync::mpsc::channel();
    let (callback_tx, callback_rx) = std::sync::mpsc::sync_channel::<Box<dyn FnOnce() + Send>>(1);
    let (enqueue_result_tx, enqueue_result_rx) = std::sync::mpsc::sync_channel(1);

    assert!(worker
        .start(move |stopping| {
            refresh_started_tx
                .send(std::sync::Arc::clone(stopping))
                .expect("test should observe the active refresh");
            release_refresh_rx
                .recv()
                .expect("test should release the active refresh");
            let callback_tx = callback_tx.clone();
            let enqueue_result_tx = enqueue_result_tx.clone();
            let queued = enqueue_main_thread_mutation(
                stopping,
                move |callback| {
                    callback_tx
                        .send(callback)
                        .expect("late callback must not be queued");
                    Ok::<(), ()>(())
                },
                || {},
            )
            .expect("test callback queue should accept the handoff");
            enqueue_result_tx
                .send(queued)
                .expect("test should receive the enqueue result");
        })
        .expect("worker should start"));

    let stopping = refresh_started_rx
        .recv_timeout(std::time::Duration::from_secs(1))
        .expect("refresh should begin before shutdown");
    let shutdown_worker = std::sync::Arc::clone(&worker);
    let shutdown = std::thread::spawn(move || shutdown_worker.shutdown());

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(1);
    while !stopping.load(std::sync::atomic::Ordering::Acquire) {
        assert!(
            std::time::Instant::now() < deadline,
            "shutdown should mark the worker stopping before joining it"
        );
        std::thread::yield_now();
    }

    release_refresh_tx
        .send(())
        .expect("active refresh should still be waiting");
    assert!(!enqueue_result_rx
        .recv_timeout(std::time::Duration::from_secs(1))
        .expect("refresh should finish after shutdown starts"));
    shutdown
        .join()
        .expect("shutdown should join the active refresh worker");
    assert!(callback_rx.try_recv().is_err());
}

#[test]
fn tray_refresh_worker_records_refresh_panics() {
    let worker = TrayRefreshWorker::default();
    let (started_tx, started_rx) = std::sync::mpsc::sync_channel(1);

    assert!(worker
        .start(move |_| {
            started_tx
                .send(())
                .expect("test should observe the panicking refresh");
            panic!("refresh failure");
        })
        .expect("worker should start"));
    started_rx
        .recv_timeout(std::time::Duration::from_secs(1))
        .expect("refresh should run");

    assert!(worker.shutdown());
}
