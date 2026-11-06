//! Real child framing/cancellation/input budgets. This fixture never captures
//! a screen, reads app data or grants account/capture authority.
use drifty_screen_context_core::{
    activity_reader::{ActivityResolver, CapturedActivityHint, NativeActivityReader},
    native::WindowTitleDigest,
    Error,
};
use std::{
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

fn reader(root: &Path, mode: &str) -> Arc<NativeActivityReader> {
    let executable = root.join(format!(
        "reader-fixture-{mode}{}",
        std::env::consts::EXE_SUFFIX
    ));
    std::fs::copy(
        env!("CARGO_BIN_EXE_screen-context-protocol-fixture"),
        &executable,
    )
    .unwrap();
    Arc::new(
        NativeActivityReader::from_packaged_runtime(
            &executable,
            &root.join("never-created.sqlite3"),
        )
        .unwrap(),
    )
}
fn pids(root: &Path) -> Vec<u32> {
    std::fs::read_to_string(root.join("reader-pids.txt"))
        .unwrap()
        .lines()
        .map(|v| v.parse().unwrap())
        .collect()
}
fn reaped(root: &Path) {
    for pid in pids(root) {
        #[cfg(unix)]
        {
            assert_eq!(
                unsafe { libc::waitpid(pid as i32, std::ptr::null_mut(), libc::WNOHANG) },
                -1
            );
            assert_eq!(
                std::io::Error::last_os_error().raw_os_error(),
                Some(libc::ECHILD)
            );
        }
        #[cfg(windows)]
        unsafe {
            use windows_sys::Win32::{
                Foundation::CloseHandle,
                System::Threading::{
                    GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
                },
            };
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if !h.is_null() {
                let mut code = 259;
                assert_ne!(GetExitCodeProcess(h, &mut code), 0);
                CloseHandle(h);
                assert_ne!(code, 259);
            }
        }
    }
}
fn hint() -> CapturedActivityHint {
    CapturedActivityHint {
        app_key: "owned.editor".into(),
        title_digest: WindowTitleDigest::parse("a".repeat(64)).unwrap(),
        observed_at_ms: 1000,
    }
}

#[test]
fn input_capacity_rotates_before_lifetime_budget_and_never_truncates_64_ids() {
    let temp = tempfile::tempdir().unwrap();
    let reader = reader(temp.path(), "normal");
    let ids: Vec<_> = (0..64)
        .map(|n| (9223372036854775807i64 - n).to_string())
        .collect();
    for _ in 0..3 {
        let rows = reader.read_current(&ids, &|| true).unwrap();
        assert_eq!(rows.len(), 64);
        assert_eq!(
            rows.iter().map(|r| r.record_id()).collect::<Vec<_>>(),
            ids.iter().map(String::as_str).collect::<Vec<_>>()
        );
    }
    assert_eq!(pids(temp.path()).len(), 2);
    reader.reset();
    reaped(temp.path());
    assert!(!temp.path().join("never-created.sqlite3").exists());
}
#[test]
fn fresh_requests_reuse_one_child_and_reset_reaps_it() {
    let temp = tempfile::tempdir().unwrap();
    let reader = reader(temp.path(), "normal");
    for _ in 0..3 {
        assert!(reader
            .resolve_capture(&hint(), &|| true)
            .unwrap()
            .unwrap()
            .contains(1000));
    }
    assert_eq!(pids(temp.path()).len(), 1);
    reader.reset();
    reaped(temp.path());
}
#[test]
fn malformed_downgraded_foreign_duplicate_reordered_or_unbounded_replies_refuse_and_reap() {
    for mode in [
        "wrong-ready",
        "early-output",
        "wrong-version",
        "missing-point-fence",
        "wrong-point-fence",
        "malformed-point-fence",
        "wrong-request",
        "unknown-field",
        "foreign-id",
        "bad-uid",
        "duplicate-row",
        "reordered",
        "oversize",
        "wrong-footer-version",
        "wrong-footer",
        "trailing-output",
    ] {
        let temp = tempfile::tempdir().unwrap();
        let reader = reader(temp.path(), mode);
        assert!(
            reader
                .read_current(&["1".into(), "2".into()], &|| true)
                .is_err(),
            "{mode}"
        );
        reader.reset();
        reaped(temp.path());
    }
    for mode in ["two-resolve", "outside-point", "revoked-point"] {
        let temp = tempfile::tempdir().unwrap();
        let reader = reader(temp.path(), mode);
        assert!(reader.resolve_capture(&hint(), &|| true).is_err(), "{mode}");
        reader.reset();
        reaped(temp.path());
    }
}
#[test]
fn invalid_or_revoked_work_does_not_start_a_child_or_create_a_database() {
    let temp = tempfile::tempdir().unwrap();
    let reader = reader(temp.path(), "normal");
    for ids in [
        vec![],
        vec!["0".into()],
        vec!["01".into()],
        vec!["1".into(), "1".into()],
        vec!["1".into(); 65],
    ] {
        assert!(reader.read_current(&ids, &|| true).is_err());
    }
    assert!(reader.read_current(&["1".into()], &|| false).is_err());
    let mut bad = hint();
    bad.app_key = "a\nb".into();
    assert!(reader.resolve_capture(&bad, &|| true).is_err());
    assert!(!temp.path().join("reader-pids.txt").exists());
    assert!(!temp.path().join("never-created.sqlite3").exists());
}
#[test]
fn capture_never_queues_and_waiting_display_read_remains_cancellable() {
    let temp = tempfile::tempdir().unwrap();
    let reader = reader(temp.path(), "hung-query");
    let active = reader.clone();
    let ready = temp.path().join("reader-entered.txt");
    let current = Arc::new(AtomicBool::new(true));
    let current1 = current.clone();
    let job = std::thread::spawn(move || {
        active.read_current(&["1".into()], &|| current1.load(Ordering::Acquire))
    });
    let deadline = Instant::now() + Duration::from_secs(3);
    while !ready.exists() {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(2));
    }
    let start = Instant::now();
    assert!(matches!(
        reader.resolve_capture(&hint(), &|| true),
        Err(Error::WorkerUnavailable)
    ));
    assert!(start.elapsed() < Duration::from_millis(50));
    let waiting = reader.clone();
    let allowed = Arc::new(AtomicBool::new(true));
    let allowed1 = allowed.clone();
    let queued = std::thread::spawn(move || {
        waiting.read_current(&["2".into()], &|| allowed1.load(Ordering::Acquire))
    });
    std::thread::sleep(Duration::from_millis(10));
    allowed.store(false, Ordering::Release);
    assert!(matches!(queued.join().unwrap(), Err(Error::Invalidated)));
    assert_eq!(pids(temp.path()).len(), 1);
    reader.reset();
    assert!(job.join().unwrap().is_err());
    reaped(temp.path());
    assert!(current.load(Ordering::Acquire)); // Reset itself cancels the query.
}
#[test]
fn parent_deadline_kills_only_its_hung_reader() {
    let temp = tempfile::tempdir().unwrap();
    let reader = reader(temp.path(), "hung-query");
    let start = Instant::now();
    assert!(reader.read_current(&["1".into()], &|| true).is_err());
    assert!(start.elapsed() < Duration::from_secs(3));
    reaped(temp.path());
}
