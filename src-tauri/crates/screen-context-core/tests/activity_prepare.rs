//! Native-only fixed protocol, ownership and cancellation; no OS capture/DB.
use drifty_screen_context_core::{
    activity_reader::NativeActivityReader, ActivityPreparation, Error, NativeActivityPreparer,
};
use std::{
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

fn preparer(root: &Path, mode: &str) -> Arc<NativeActivityPreparer> {
    let executable = root.join(format!(
        "preparer-fixture-{mode}{}",
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
        .unwrap()
        .preparation(),
    )
}
fn reaped(root: &Path) {
    let pid: u32 = std::fs::read_to_string(root.join("prepare-entered.txt"))
        .unwrap()
        .parse()
        .unwrap();
    #[cfg(unix)]
    unsafe {
        assert_eq!(
            libc::waitpid(pid as i32, std::ptr::null_mut(), libc::WNOHANG),
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
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if !handle.is_null() {
            let mut code = 259;
            assert_ne!(GetExitCodeProcess(handle, &mut code), 0);
            CloseHandle(handle);
            assert_ne!(code, 259);
        }
    }
}
#[test]
fn fixed_preparation_states_require_successful_exit_and_start_no_capture_or_database() {
    for (mode, state) in [
        ("ready", ActivityPreparation::Ready),
        ("writer-stale", ActivityPreparation::WriterNotReady),
        ("missing", ActivityPreparation::MissingDatabase),
        ("unavailable", ActivityPreparation::Unavailable),
    ] {
        let root = tempfile::tempdir().unwrap();
        let prep = preparer(root.path(), mode);
        assert!(!root.path().join("prepare-entered.txt").exists());
        assert_eq!(prep.prepare(&|| true).unwrap(), state);
        assert!(!root.path().join("never-created.sqlite3").exists());
        reaped(root.path());
    }
}
#[test]
fn malformed_or_diagnostic_output_and_failed_exit_never_echo_or_claim_ready() {
    for mode in [
        "wrong-version",
        "unknown-state",
        "trailing",
        "diagnostics",
        "nonzero",
    ] {
        let root = tempfile::tempdir().unwrap();
        let error = preparer(root.path(), mode)
            .prepare(&|| true)
            .expect_err(mode);
        assert!(!error.to_string().contains("owned private"));
        reaped(root.path());
    }
}
#[test]
fn revocation_and_one_active_preparation_cancel_and_reap_the_owned_child() {
    let root = tempfile::tempdir().unwrap();
    let prep = preparer(root.path(), "hung");
    assert!(matches!(prep.prepare(&|| false), Err(Error::Invalidated)));
    assert!(!root.path().join("prepare-entered.txt").exists());
    let current = Arc::new(AtomicBool::new(true));
    let active = current.clone();
    let task = prep.clone();
    let thread = std::thread::spawn(move || task.prepare(&|| active.load(Ordering::Acquire)));
    let deadline = Instant::now() + Duration::from_secs(2);
    while !root.path().join("prepare-entered.txt").exists() {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(2));
    }
    let start = Instant::now();
    assert!(matches!(
        prep.prepare(&|| true),
        Err(Error::WorkerUnavailable)
    ));
    assert!(start.elapsed() < Duration::from_millis(50));
    current.store(false, Ordering::Release);
    assert!(thread.join().unwrap().is_err());
    reaped(root.path());
}
#[test]
fn hung_preparation_keeps_the_original_two_second_budget_and_reaps() {
    let root = tempfile::tempdir().unwrap();
    let prep = preparer(root.path(), "hung");
    let start = Instant::now();
    assert!(prep.prepare(&|| true).is_err());
    assert!(start.elapsed() < Duration::from_millis(2500));
    reaped(root.path());
}

#[test]
fn dedicated_preparer_passes_the_selected_producer_spelling_to_the_real_child() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("owned 한글 producer");
    std::fs::create_dir(&root).unwrap();
    let helper = root.join(format!(
        "preparer-fixture-ready{}",
        std::env::consts::EXE_SUFFIX
    ));
    std::fs::copy(
        env!("CARGO_BIN_EXE_screen-context-protocol-fixture"),
        &helper,
    )
    .unwrap();
    let producer = root.join("selected tracker.exe");
    std::fs::write(&producer, b"owned producer fixture").unwrap();
    let db = root.join("never-created.sqlite3");
    let reader =
        NativeActivityReader::from_packaged_activity_helper(&helper, &producer, &db).unwrap();
    assert_eq!(
        reader.preparation().prepare(&|| true).unwrap(),
        ActivityPreparation::Ready
    );
    let received: std::path::PathBuf = serde_json::from_slice(
        &std::fs::read(root.join("prepare-producer-argument.json")).unwrap(),
    )
    .unwrap();
    #[cfg(windows)]
    assert_eq!(received, producer);
    #[cfg(not(windows))]
    assert_eq!(received, std::fs::canonicalize(&producer).unwrap());
    assert!(!db.exists());
    reaped(&root);
}
