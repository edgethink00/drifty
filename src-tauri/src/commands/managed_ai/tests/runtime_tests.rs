use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use super::*;

// Serializes tests that touch the process-global RUNTIME_CHILD slot, the
// runtime-listener pid override, or the shared machine-memory override.
static RUNTIME_GLOBALS_LOCK: Mutex<()> = Mutex::new(());

fn lock_runtime_globals() -> MutexGuard<'static, ()> {
    RUNTIME_GLOBALS_LOCK
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
}

#[cfg(unix)]
fn start_runtime_and_mark_ready(
    root: &Path,
    spec: ManagedAiModelSpec,
    artifact_dir: &Path,
) -> super::super::ManagedAiStatus {
    // The fake runtime cannot answer the real health endpoint, so these tests
    // mark readiness manually. Keep that transition inside the production
    // lifecycle lock so parallel install tests cannot stop the child in the
    // artificial gap between a Starting result and the test-only mark.
    let _lifecycle_guard = super::super::RUNTIME_LIFECYCLE_LOCK
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    let started = runtime::start_runtime(root, spec, artifact_dir).expect("start fake runtime");
    runtime::mark_tracked_child_ready_for_tests(root, spec.id);
    started
}

struct SufficientMemoryForTests;

impl SufficientMemoryForTests {
    fn pin() -> Self {
        // CI runners can report <8 GiB, which would trip the product memory
        // preflight before these runtime-path tests exercise their target.
        super::set_machine_memory_bytes_for_tests(Some(16 * 1024 * 1024 * 1024));
        Self
    }
}

impl Drop for SufficientMemoryForTests {
    fn drop(&mut self) {
        super::set_machine_memory_bytes_for_tests(None);
    }
}

#[test]
fn start_requires_runtime_assets() {
    let _globals = lock_runtime_globals();
    let _memory = SufficientMemoryForTests::pin();
    let root = tempfile::tempdir().expect("create temp root");
    let status =
        start_model_at_root(root.path(), "drifty-qwen3-5-4b-default", None).expect("start status");

    assert!(matches!(status.state, ManagedAiInstallState::Error));
    assert!(matches!(
        status.error_kind,
        Some(ManagedAiStatusErrorKind::ModelArtifactMissing)
    ));
}

#[cfg(unix)]
#[test]
fn start_spawns_runtime_for_downloaded_model() {
    let _globals = lock_runtime_globals();
    let _memory = SufficientMemoryForTests::pin();
    let root = tempfile::tempdir().expect("create temp root");
    let spec = require_model("drifty-qwen3-5-4b-default").expect("model spec");
    fake_download(root.path(), spec, &mut |_| Ok(())).expect("write model artifact");
    let args_path = root.path().join("runtime-args.txt");
    write_fake_runtime(root.path(), &args_path).expect("write fake runtime");

    let status =
        start_model_at_root(root.path(), "drifty-qwen3-5-4b-default", None).expect("start status");
    let recorded = wait_for_runtime_record(&args_path);
    runtime::stop_runtime_for_tests();
    recorded.expect("runtime records complete arguments before shutdown");

    assert!(matches!(
        status.state,
        ManagedAiInstallState::Starting | ManagedAiInstallState::Running
    ));
    let args = std::fs::read_to_string(args_path).expect("read runtime args");
    for expected in [
        "--host\n127.0.0.1",
        "--port\n39217",
        "--alias\ndrifty-qwen3.5-4b-local",
        "--ctx-size\n4096",
        "--parallel\n1",
        "--cache-ram\n256",
        "--reasoning\noff",
        "--reasoning-format\nnone",
        "--reasoning-budget\n0",
        "Qwen3.5-4B-Q4_K_M.gguf",
    ] {
        assert!(args.contains(expected), "missing runtime arg {expected}");
    }
}

#[cfg(unix)]
#[test]
fn repeated_start_reuses_the_same_in_flight_runtime_child() {
    let _globals = lock_runtime_globals();
    let _memory = SufficientMemoryForTests::pin();
    let root = tempfile::tempdir().expect("create temp root");
    let spec = require_model("drifty-qwen3-5-4b-default").expect("model spec");
    fake_download(root.path(), spec, &mut |_| Ok(())).expect("write model artifact");
    let starts_path = root.path().join("runtime-starts.txt");
    write_counting_fake_runtime(root.path(), &starts_path).expect("write fake runtime");

    let first = start_model_at_root(root.path(), spec.id, None).expect("first start status");
    let second = start_model_at_root(root.path(), spec.id, None).expect("second start status");
    let recorded = wait_for_runtime_record(&starts_path);
    runtime::stop_runtime_for_tests();
    recorded.expect("runtime records startup before shutdown");

    assert!(matches!(first.state, ManagedAiInstallState::Starting));
    assert!(matches!(second.state, ManagedAiInstallState::Starting));
    let starts = std::fs::read_to_string(starts_path).expect("read runtime starts");
    assert_eq!(
        starts.lines().count(),
        1,
        "the in-flight runtime must not restart"
    );
}

#[cfg(unix)]
#[test]
fn concurrent_start_creates_only_one_runtime_child() {
    let _globals = lock_runtime_globals();
    let _memory = SufficientMemoryForTests::pin();
    let root = tempfile::tempdir().expect("create temp root");
    let spec = require_model("drifty-qwen3-5-4b-default").expect("model spec");
    let artifact_dir = fake_download(root.path(), spec, &mut |_| Ok(())).expect("write model");
    let starts_path = root.path().join("runtime-starts.txt");
    write_counting_fake_runtime(root.path(), &starts_path).expect("write fake runtime");
    let barrier = std::sync::Barrier::new(3);

    std::thread::scope(|scope| {
        let first = scope.spawn(|| {
            barrier.wait();
            runtime::start_runtime(root.path(), spec, &artifact_dir)
        });
        let second = scope.spawn(|| {
            barrier.wait();
            runtime::start_runtime(root.path(), spec, &artifact_dir)
        });
        barrier.wait();
        first
            .join()
            .expect("first start thread")
            .expect("first start");
        second
            .join()
            .expect("second start thread")
            .expect("second start");
    });
    let recorded = wait_for_runtime_record(&starts_path);
    runtime::stop_runtime_for_tests();
    recorded.expect("runtime records startup before shutdown");

    let starts = std::fs::read_to_string(starts_path).expect("read runtime starts");
    assert_eq!(
        starts.lines().count(),
        1,
        "concurrent starts must share one child"
    );
}

#[cfg(unix)]
#[test]
fn start_cannot_overwrite_an_active_model_install() {
    let _globals = lock_runtime_globals();
    let _memory = SufficientMemoryForTests::pin();
    let root = tempfile::tempdir().expect("create temp root");
    let installing_spec = require_model("drifty-qwen3-5-2b-economy").expect("install model");
    let start_spec = require_model("drifty-qwen3-5-4b-default").expect("start model");
    fake_download(root.path(), start_spec, &mut |_| Ok(())).expect("write start model");
    let starts_path = root.path().join("runtime-starts.txt");
    write_counting_fake_runtime(root.path(), &starts_path).expect("write fake runtime");
    let (entered_tx, entered_rx) = std::sync::mpsc::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    let install_root = root.path();

    std::thread::scope(|scope| {
        let install = scope.spawn(move || {
            install_model_at_root_with_downloader(
                install_root,
                installing_spec.id,
                |download_root, spec, progress| {
                    entered_tx.send(()).expect("announce active install");
                    release_rx.recv().expect("release active install");
                    fake_download(download_root, spec, progress)
                },
                None,
            )
        });
        entered_rx.recv().expect("wait for active install");

        let observed = start_model_at_root(root.path(), start_spec.id, None)
            .expect("return install owner status");

        assert!(matches!(observed.state, ManagedAiInstallState::Installing));
        assert_eq!(
            observed.selected_model_id.as_deref(),
            Some(installing_spec.id)
        );
        assert!(!starts_path.exists(), "start must not spawn during install");
        assert!(runtime::tracked_child_model_id_for_tests(root.path()).is_none());
        release_tx.send(()).expect("finish install");
        let installed = install
            .join()
            .expect("join install")
            .expect("install status");
        assert!(matches!(installed.state, ManagedAiInstallState::Installed));
    });
}

#[cfg(unix)]
#[test]
fn install_supersedes_and_stops_an_unready_runtime_child() {
    let _globals = lock_runtime_globals();
    let _memory = SufficientMemoryForTests::pin();
    let root = tempfile::tempdir().expect("create temp root");
    let starting_spec = require_model("drifty-qwen3-5-4b-default").expect("start model");
    let installing_spec = require_model("drifty-qwen3-5-2b-economy").expect("install model");
    fake_download(root.path(), starting_spec, &mut |_| Ok(())).expect("write start model");
    let starts_path = root.path().join("runtime-starts.txt");
    write_counting_fake_runtime(root.path(), &starts_path).expect("write fake runtime");
    let generation = begin_runtime_status_monitor(root.path());
    let started =
        start_model_at_root_for_generation(root.path(), starting_spec.id, None, Some(generation))
            .expect("start runtime");
    wait_for_runtime_record(&starts_path).expect("observe runtime start");
    assert!(matches!(started.state, ManagedAiInstallState::Starting));
    assert_eq!(
        runtime::tracked_child_model_id_for_tests(root.path()),
        Some(starting_spec.id)
    );

    let installed =
        install_model_at_root_with_downloader(root.path(), installing_spec.id, fake_download, None)
            .expect("install replacement model");

    assert!(matches!(installed.state, ManagedAiInstallState::Installed));
    assert_eq!(
        installed.selected_model_id.as_deref(),
        Some(installing_spec.id)
    );
    assert!(!runtime_status_monitor_is_current(root.path(), generation));
    assert!(
        runtime::tracked_child_model_id_for_tests(root.path()).is_none(),
        "install must not leave an unmonitored cold-start child"
    );
}

#[cfg(unix)]
#[test]
fn installing_another_model_preserves_a_ready_runtime_child() {
    let _globals = lock_runtime_globals();
    let _memory = SufficientMemoryForTests::pin();
    let root = tempfile::tempdir().expect("create temp root");
    let running_spec = require_model("drifty-qwen3-5-4b-default").expect("running model");
    let installing_spec = require_model("drifty-qwen3-5-2b-economy").expect("install model");
    let running_artifact =
        fake_download(root.path(), running_spec, &mut |_| Ok(())).expect("write running model");
    let starts_path = root.path().join("runtime-starts.txt");
    write_counting_fake_runtime(root.path(), &starts_path).expect("write fake runtime");

    let started = start_runtime_and_mark_ready(root.path(), running_spec, &running_artifact);
    wait_for_runtime_record(&starts_path).expect("observe runtime start");
    assert!(matches!(started.state, ManagedAiInstallState::Starting));

    let installed =
        install_model_at_root_with_downloader(root.path(), installing_spec.id, fake_download, None)
            .expect("install additional model");

    assert!(matches!(installed.state, ManagedAiInstallState::Installed));
    assert_eq!(
        runtime::tracked_child_model_id_for_tests(root.path()),
        Some(running_spec.id),
        "downloading another model must not interrupt a healthy current runtime"
    );
    runtime::stop_runtime_for_tests();
}

#[cfg(unix)]
#[test]
fn install_in_another_managed_root_never_stops_the_tracked_runtime() {
    let _globals = lock_runtime_globals();
    let _memory = SufficientMemoryForTests::pin();
    let running_root = tempfile::tempdir().expect("create running root");
    let install_root = tempfile::tempdir().expect("create install root");
    let running_spec = require_model("drifty-qwen3-5-4b-default").expect("running model");
    let installing_spec = require_model("drifty-qwen3-5-2b-economy").expect("install model");
    fake_download(running_root.path(), running_spec, &mut |_| Ok(())).expect("write running model");
    let starts_path = running_root.path().join("runtime-starts.txt");
    write_counting_fake_runtime(running_root.path(), &starts_path).expect("write fake runtime");

    let started = start_model_at_root(running_root.path(), running_spec.id, None)
        .expect("start tracked runtime");
    wait_for_runtime_record(&starts_path).expect("observe runtime start");
    assert!(matches!(started.state, ManagedAiInstallState::Starting));

    let installed = install_model_at_root_with_downloader(
        install_root.path(),
        installing_spec.id,
        fake_download,
        None,
    )
    .expect("install in independent root");

    assert!(matches!(installed.state, ManagedAiInstallState::Installed));
    assert_eq!(
        runtime::tracked_child_model_id_for_tests(running_root.path()),
        Some(running_spec.id),
        "an independent managed root cannot own or stop this child"
    );
    runtime::stop_runtime_for_tests();
}

#[cfg(unix)]
#[test]
fn runtime_that_never_becomes_ready_fails_after_two_minutes() {
    let _globals = lock_runtime_globals();
    let _memory = SufficientMemoryForTests::pin();
    let root = tempfile::tempdir().expect("create temp root");
    let spec = require_model("drifty-qwen3-5-4b-default").expect("model spec");
    fake_download(root.path(), spec, &mut |_| Ok(())).expect("write model artifact");
    write_fake_runtime(root.path(), &root.path().join("runtime-args.txt"))
        .expect("write fake runtime");

    let started = start_model_at_root(root.path(), spec.id, None).expect("start status");
    assert!(matches!(started.state, ManagedAiInstallState::Starting));
    runtime::age_tracked_child_for_tests(root.path(), Duration::from_secs(121));

    let observed = read_status(root.path()).expect("read aged runtime status");

    assert!(matches!(observed.state, ManagedAiInstallState::Starting));
    let status = super::super::status::reconcile_status(root.path())
        .expect("reconcile timed-out runtime status");

    assert!(matches!(status.state, ManagedAiInstallState::Error));
    assert!(matches!(
        status.error_kind,
        Some(ManagedAiStatusErrorKind::RuntimeFailed)
    ));
    assert!(status.message.contains("within two minutes"));
}

#[cfg(unix)]
#[test]
fn ready_runtime_is_not_killed_by_the_cold_start_deadline() {
    let _globals = lock_runtime_globals();
    let _memory = SufficientMemoryForTests::pin();
    let root = tempfile::tempdir().expect("create temp root");
    let spec = require_model("drifty-qwen3-5-4b-default").expect("model spec");
    let artifact_dir = fake_download(root.path(), spec, &mut |_| Ok(())).expect("write model");
    write_fake_runtime(root.path(), &root.path().join("runtime-args.txt"))
        .expect("write fake runtime");

    let started = start_runtime_and_mark_ready(root.path(), spec, &artifact_dir);
    assert!(matches!(started.state, ManagedAiInstallState::Starting));
    runtime::age_tracked_child_for_tests(root.path(), Duration::from_secs(121));
    write_status(
        root.path(),
        &status_for_spec(
            ManagedAiInstallState::Running,
            spec,
            Some(artifact_dir),
            "Managed local AI runtime is running.",
        ),
    )
    .expect("write previously healthy status");

    let status = super::super::status::reconcile_status(root.path())
        .expect("reconcile previously healthy runtime");
    assert!(matches!(status.state, ManagedAiInstallState::Running));

    runtime::stop_runtime_for_tests();
}

#[cfg(unix)]
#[test]
fn ready_runtime_reports_failure_after_sustained_health_probe_misses() {
    let _globals = lock_runtime_globals();
    let _memory = SufficientMemoryForTests::pin();
    let root = tempfile::tempdir().expect("create temp root");
    let spec = require_model("drifty-qwen3-5-4b-default").expect("model spec");
    let artifact_dir = fake_download(root.path(), spec, &mut |_| Ok(())).expect("write model");
    write_fake_runtime(root.path(), &root.path().join("runtime-args.txt"))
        .expect("write fake runtime");

    let started = start_runtime_and_mark_ready(root.path(), spec, &artifact_dir);
    assert!(matches!(started.state, ManagedAiInstallState::Starting));
    write_status(
        root.path(),
        &status_for_spec(
            ManagedAiInstallState::Running,
            spec,
            Some(artifact_dir),
            "Managed local AI runtime is running.",
        ),
    )
    .expect("write previously healthy status");

    let first = super::super::status::reconcile_status(root.path())
        .expect("record first failed health probe");
    assert!(matches!(first.state, ManagedAiInstallState::Running));
    runtime::age_ready_health_failure_for_tests(root.path(), Duration::from_secs(9));
    let second = super::super::status::reconcile_status(root.path())
        .expect("record second failed health probe");
    assert!(matches!(second.state, ManagedAiInstallState::Running));
    let third = super::super::status::reconcile_status(root.path())
        .expect("record sustained failed health probes");

    assert!(matches!(third.state, ManagedAiInstallState::Error));
    assert!(matches!(
        third.error_kind,
        Some(ManagedAiStatusErrorKind::RuntimeFailed)
    ));
    assert!(third.message.contains("repeated health checks"));
    assert_eq!(
        runtime::tracked_child_model_id_for_tests(root.path()),
        Some(spec.id),
        "status observation must not kill the task-owned child"
    );
    runtime::stop_runtime_for_tests();
}

#[cfg(unix)]
#[test]
fn tracked_runtime_exit_before_ready_is_a_real_failure() {
    let _globals = lock_runtime_globals();
    let _memory = SufficientMemoryForTests::pin();
    let root = tempfile::tempdir().expect("create temp root");
    let spec = require_model("drifty-qwen3-5-4b-default").expect("model spec");
    fake_download(root.path(), spec, &mut |_| Ok(())).expect("write model");
    write_exiting_fake_runtime(root.path()).expect("write exiting runtime");

    let started = start_model_at_root(root.path(), spec.id, None).expect("start status");
    assert!(matches!(started.state, ManagedAiInstallState::Starting));
    let status = read_status(root.path()).expect("observe exited runtime");

    assert!(matches!(status.state, ManagedAiInstallState::Error));
    assert!(matches!(
        status.error_kind,
        Some(ManagedAiStatusErrorKind::RuntimeFailed)
    ));
    assert!(status.message.contains("exited before it became ready"));
    runtime::stop_runtime_for_tests();
}

#[cfg(unix)]
#[test]
fn tracked_runtime_exit_after_ready_is_a_real_failure() {
    let _globals = lock_runtime_globals();
    let _memory = SufficientMemoryForTests::pin();
    let root = tempfile::tempdir().expect("create temp root");
    let spec = require_model("drifty-qwen3-5-4b-default").expect("model spec");
    let artifact_dir = fake_download(root.path(), spec, &mut |_| Ok(())).expect("write model");
    write_fake_runtime(root.path(), &root.path().join("runtime-args.txt"))
        .expect("write fake runtime");
    start_model_at_root(root.path(), spec.id, None).expect("start status");
    runtime::mark_tracked_child_ready_for_tests(root.path(), spec.id);
    write_status(
        root.path(),
        &status_for_spec(
            ManagedAiInstallState::Running,
            spec,
            Some(artifact_dir),
            "Managed local AI runtime is running.",
        ),
    )
    .expect("write running status");

    runtime::terminate_tracked_child_for_tests(root.path());
    let status = read_status(root.path()).expect("observe stopped runtime");

    assert!(matches!(status.state, ManagedAiInstallState::Error));
    assert!(status.message.contains("stopped unexpectedly"));
    runtime::stop_runtime_for_tests();
}

#[cfg(unix)]
#[test]
fn foreign_listener_is_typed_as_a_port_conflict_on_start() {
    let _globals = lock_runtime_globals();
    let _memory = SufficientMemoryForTests::pin();
    let root = tempfile::tempdir().expect("create temp root");
    let spec = require_model("drifty-qwen3-5-4b-default").expect("model spec");
    fake_download(root.path(), spec, &mut |_| Ok(())).expect("write model");
    write_fake_runtime(root.path(), &root.path().join("runtime-args.txt"))
        .expect("write fake runtime");
    let mut foreign = Command::new("/bin/sleep")
        .arg("30")
        .spawn()
        .expect("spawn foreign process");

    let _listeners = runtime::override_runtime_listener_pids_for_tests(Some(vec![foreign.id()]));
    let status = start_model_at_root(root.path(), spec.id, None).expect("start status");
    let _ = foreign.kill();
    let _ = foreign.wait();

    assert!(matches!(status.state, ManagedAiInstallState::Error));
    assert!(matches!(
        status.error_kind,
        Some(ManagedAiStatusErrorKind::RuntimePortConflict)
    ));
}

#[cfg(unix)]
#[test]
fn delete_model_never_kills_an_untracked_exact_runtime_on_unix() {
    let _globals = lock_runtime_globals();
    let root = tempfile::tempdir().expect("create temp root");
    let spec = require_model("drifty-gemma-4-12b-local").expect("model spec");
    fake_download(root.path(), spec, &mut |_| Ok(())).expect("write model artifact");
    write_native_sleep_runtime(root.path()).expect("write native fake runtime");
    // Adopted server: already listening when the app launched, never tracked
    // in RUNTIME_CHILD.
    let mut adopted = spawn_adopted_runtime(root.path());

    let _listeners = runtime::override_runtime_listener_pids_for_tests(Some(vec![adopted.id()]));
    let result = super::super::delete_model_at_root(root.path(), "drifty-gemma-4-12b-local", None);

    let status = result.expect("delete status");
    assert!(matches!(status.state, ManagedAiInstallState::NotInstalled));
    assert!(matches!(adopted.try_wait(), Ok(None)));
    let _ = adopted.kill();
    let _ = adopted.wait();
}

#[cfg(unix)]
#[test]
fn app_exit_never_kills_an_untracked_exact_runtime_on_unix() {
    let _globals = lock_runtime_globals();
    let root = tempfile::tempdir().expect("create temp root");
    write_native_sleep_runtime(root.path()).expect("write native fake runtime");
    let mut adopted = spawn_adopted_runtime(root.path());

    let _listeners = runtime::override_runtime_listener_pids_for_tests(Some(vec![adopted.id()]));
    let result = runtime::stop_runtime(Some(root.path()), true);

    result.expect("stop runtime");
    assert!(matches!(adopted.try_wait(), Ok(None)));
    let _ = adopted.kill();
    let _ = adopted.wait();
}

#[cfg(unix)]
#[test]
fn cleanup_ignores_a_foreign_listener_instead_of_blocking_model_deletion() {
    let _globals = lock_runtime_globals();
    let root = tempfile::tempdir().expect("create temp root");
    let spec = require_model("drifty-gemma-4-12b-local").expect("model spec");
    fake_download(root.path(), spec, &mut |_| Ok(())).expect("write model");
    write_fake_runtime(root.path(), &root.path().join("runtime-args.txt"))
        .expect("write fake runtime");
    let mut foreign = Command::new("/bin/sleep")
        .arg("30")
        .spawn()
        .expect("spawn foreign process");

    let _listeners = runtime::override_runtime_listener_pids_for_tests(Some(vec![foreign.id()]));
    let status = super::super::delete_model_at_root(root.path(), spec.id, None)
        .expect("delete must ignore foreign listener");

    assert!(matches!(status.state, ManagedAiInstallState::NotInstalled));
    assert!(matches!(foreign.try_wait(), Ok(None)));
    let _ = foreign.kill();
    let _ = foreign.wait();
}

fn spawn_adopted_runtime(root: &Path) -> Child {
    Command::new(root.join("runtime").join("llama-server"))
        .arg("30")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn adopted runtime process")
}

#[cfg(unix)]
fn write_native_sleep_runtime(root: &Path) -> Result<(), ManagedAiError> {
    let runtime_dir = root.join("runtime");
    std::fs::create_dir_all(&runtime_dir)?;
    let runtime_path = runtime_dir.join("llama-server");
    std::fs::copy("/bin/sleep", &runtime_path)?;
    // A copied Apple platform binary is SIGKILLed by code signing outside its
    // system path, which files a crash report and races the liveness checks
    // below. Re-sign the copy ad hoc so it runs as an ordinary binary.
    #[cfg(target_os = "macos")]
    {
        let status = Command::new("/usr/bin/codesign")
            .args(["--force", "--sign", "-"])
            .arg(&runtime_path)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()?;
        assert!(status.success(), "ad hoc signing failed: {status}");
    }
    // Finish the copy's first launch assessment before a test kills it; see
    // write_assessed_fake_runtime.
    let status = Command::new(&runtime_path).arg("0").status()?;
    assert!(status.success(), "native runtime warm-up failed: {status}");
    runtime::write_runtime_completion_fixture(root)
}

#[cfg(unix)]
fn write_counting_fake_runtime(root: &Path, starts_path: &Path) -> Result<(), ManagedAiError> {
    let starts_path = shell_quote(starts_path);
    write_assessed_fake_runtime(
        root,
        &format!("printf 'started\\n' >> {starts_path}\nwhile true; do sleep 5; done\n"),
    )?;
    runtime::write_runtime_completion_fixture(root)?;
    Ok(())
}

#[cfg(unix)]
fn write_exiting_fake_runtime(root: &Path) -> Result<(), ManagedAiError> {
    write_assessed_fake_runtime(root, "exit 17\n")?;
    runtime::write_runtime_completion_fixture(root)?;
    Ok(())
}

#[cfg(unix)]
fn wait_for_runtime_record(path: &Path) -> std::io::Result<()> {
    // Spawning a child does not guarantee that its shell has run printf yet.
    // Wait for the completed record before teardown, including on slow runners.
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match std::fs::read_to_string(path) {
            Ok(contents) if contents.contains('\n') => return Ok(()),
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
        if Instant::now() >= deadline {
            return Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                format!("runtime did not record startup at {}", path.display()),
            ));
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn read_status_treats_previous_session_runtime_as_ready_to_start() {
    let _globals = lock_runtime_globals();
    let root = tempfile::tempdir().expect("create temp root");
    // Distinct model id: with the same id as start_spawns_runtime_for_downloaded_model
    // this test can observe that test's live child in the process-global
    // RUNTIME_CHILD and read Starting instead of Error.
    let spec = require_model("drifty-qwen3-5-2b-economy").expect("model spec");
    let artifact_dir = fake_download(root.path(), spec, &mut |_| Ok(())).expect("write model");
    let stale_status = status_for_spec(
        ManagedAiInstallState::Running,
        spec,
        Some(artifact_dir),
        "Managed local AI runtime is running.",
    );
    write_status(root.path(), &stale_status).expect("write stale status");

    let status = read_status(root.path()).expect("read normalized status");

    assert!(matches!(status.state, ManagedAiInstallState::Installed));
    assert_eq!(status.message, "Managed local AI is ready to start.");
    assert!(status.error_kind.is_none());
}

#[test]
fn status_serializes_runtime_memory_usage_bytes() {
    let spec = require_model("drifty-qwen3-5-4b-default").expect("model spec");
    let mut status = status_for_spec(
        ManagedAiInstallState::Running,
        spec,
        None,
        "Managed local AI runtime is running.",
    );
    status.memory_usage_bytes = Some(2_684_354_560);

    let value = serde_json::to_value(&status).expect("serialize status");

    assert_eq!(
        value
            .get("memoryUsageBytes")
            .and_then(serde_json::Value::as_u64),
        Some(2_684_354_560)
    );
}

#[test]
#[ignore]
fn qa_starts_real_runtime_from_existing_managed_ai_root() {
    let _globals = lock_runtime_globals();
    let _listeners = runtime::override_runtime_listener_pids_for_tests(None);
    let root = std::env::var("DRIFTY_MANAGED_AI_QA_ROOT")
        .map(PathBuf::from)
        .expect("set DRIFTY_MANAGED_AI_QA_ROOT to the app managed-ai directory");
    // Optionally install the runtime and model first, through the product's
    // own download path, so a fresh root (for example one under a Korean user
    // folder on Windows) can be checked end to end.
    if std::env::var("DRIFTY_MANAGED_AI_QA_INSTALL").as_deref() == Ok("1") {
        super::super::install_model_at_root(&root, "drifty-qwen3-5-2b-economy", None)
            .expect("install model");
    }
    let started =
        start_model_at_root(&root, "drifty-qwen3-5-2b-economy", None).expect("start runtime");

    assert!(matches!(
        started.state,
        ManagedAiInstallState::Starting | ManagedAiInstallState::Running
    ));

    let mut status = started;
    for _ in 0..60 {
        if matches!(status.state, ManagedAiInstallState::Running) {
            break;
        }
        std::thread::sleep(std::time::Duration::from_secs(1));
        status = read_status(&root).expect("read runtime status");
    }
    runtime::stop_runtime_for_tests();

    assert!(matches!(status.state, ManagedAiInstallState::Running));
}

// These use real owned native children with injected listener observations.
// They test process/configuration lifetime, not a real model or send transport.
struct ScreenRecipientFixture;
impl Drop for ScreenRecipientFixture {
    fn drop(&mut self) {
        runtime::stop_runtime_for_tests();
    }
}

#[cfg(unix)]
fn owned_screen_recipient_fixture(
    root: &Path,
    spec: ManagedAiModelSpec,
) -> (ScreenRecipientFixture, u32) {
    write_native_sleep_runtime(root).expect("write exact native fixture");
    let child = spawn_adopted_runtime(root);
    let pid = child.id();
    runtime::install_screen_recipient_fixture(root, child, spec);
    (ScreenRecipientFixture, pid)
}

#[test]
fn screen_recipient_observation_without_owned_child_creates_nothing() {
    let _globals = lock_runtime_globals();
    let _lifecycle = super::super::RUNTIME_LIFECYCLE_LOCK
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    runtime::stop_runtime_for_tests();
    let root = tempfile::tempdir().expect("temporary root");
    assert!(runtime::observe_screen_recipient(root.path()).is_none());
    assert_eq!(
        std::fs::read_dir(root.path())
            .expect("unchanged root")
            .count(),
        0
    );
}

#[cfg(unix)]
#[test]
fn screen_recipient_requires_ready_exact_live_child_and_serializes_only_display_fields() {
    let _globals = lock_runtime_globals();
    let _lifecycle = super::super::RUNTIME_LIFECYCLE_LOCK
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    let root = tempfile::tempdir().expect("temporary root");
    let spec = require_model("drifty-qwen3-5-4b-default").expect("model");
    let (_fixture, pid) = owned_screen_recipient_fixture(root.path(), spec);
    let _listeners = runtime::override_runtime_listener_pids_for_tests(Some(vec![pid]));
    assert!(
        runtime::observe_screen_recipient(root.path()).is_none(),
        "unready"
    );
    runtime::mark_tracked_child_ready_for_tests(root.path(), spec.id);
    assert!(runtime::observe_screen_recipient(&root.path().join("foreign-profile")).is_none());
    let observed = runtime::observe_screen_recipient(root.path()).expect("ready exact owned child");
    let value = serde_json::to_value(&observed).expect("content-free preview");
    let keys = value
        .as_object()
        .expect("preview object")
        .keys()
        .map(String::as_str)
        .collect::<Vec<_>>();
    assert_eq!(
        keys,
        [
            "imagesSupported",
            "modelId",
            "modelLabel",
            "policyVersion",
            "processing"
        ]
    );
    assert_eq!(value["imagesSupported"], false);
    assert_eq!(value["modelId"], spec.id);
    assert_eq!(value["processing"], "app_owned_local_runtime");
    let owner = drifty_screen_context_core::lease::AccountGate::default();
    let account_id = owner
        .bind_verified(
            owner.begin_transition().unwrap(),
            drifty_screen_context_core::ScopeId::from_profile("owned-review-runtime").unwrap(),
            Instant::now() + Duration::from_secs(60),
        )
        .unwrap();
    let review = drifty_screen_context_core::ai_consent::AiConsentReview::new(
        owner.read(account_id).unwrap(),
        std::sync::Arc::new(observed),
        drifty_screen_context_core::ai_input::AiSourceChoices {
            accessibility_text: true,
            purposes: std::collections::BTreeSet::from([
                drifty_screen_context_core::ai_input::AiPurpose::Classification,
            ]),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(review.is_current());
    let observed = runtime::observe_screen_recipient(root.path()).expect("same current process");
    runtime::terminate_tracked_child_for_tests(root.path());
    assert!(
        !review.is_current(),
        "real owned child death invalidates its pending consent"
    );
    assert!(!observed.is_current_for_tests());
    assert_eq!(
        serde_json::to_value(&observed).expect("invalid preview"),
        serde_json::Value::Null
    );
    assert!(runtime::observe_screen_recipient(root.path()).is_none());
}

#[cfg(unix)]
#[test]
fn screen_recipient_foreign_or_ambiguous_listener_and_health_loss_latch_invalidation() {
    let _globals = lock_runtime_globals();
    let _lifecycle = super::super::RUNTIME_LIFECYCLE_LOCK
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    let root = tempfile::tempdir().expect("temporary root");
    let spec = require_model("drifty-qwen3-5-2b-economy").expect("model");
    let (_fixture, pid) = owned_screen_recipient_fixture(root.path(), spec);
    runtime::mark_tracked_child_ready_for_tests(root.path(), spec.id);
    let _listeners = runtime::override_runtime_listener_pids_for_tests(Some(vec![pid]));
    struct ForeignChild(Child);
    impl Drop for ForeignChild {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
    let foreign = ForeignChild(spawn_adopted_runtime(root.path()));
    for pids in [
        vec![],
        vec![std::process::id()],
        vec![pid, std::process::id()],
        vec![foreign.0.id()], // same executable, independently started child
    ] {
        let observed = runtime::observe_screen_recipient(root.path()).expect("current observation");
        {
            let _foreign = runtime::override_runtime_listener_pids_for_tests(Some(pids));
            assert!(runtime::observe_screen_recipient(root.path()).is_none());
            assert!(!observed.is_current_for_tests());
        }
        assert!(
            !observed.is_current_for_tests(),
            "restored listener cannot revive observation"
        );
    }
    let observed = runtime::observe_screen_recipient(root.path()).expect("fresh observation");
    runtime::age_ready_health_failure_for_tests(root.path(), Duration::from_millis(1));
    assert!(runtime::observe_screen_recipient(root.path()).is_none());
    assert!(!observed.is_current_for_tests());
    runtime::mark_tracked_child_ready_for_tests(root.path(), spec.id);
    assert!(!observed.is_current_for_tests());
    assert!(
        runtime::observe_screen_recipient(root.path()).is_some(),
        "fresh capability after recovery"
    );
    let unobserved = runtime::observe_screen_recipient(root.path()).expect("before health ABA");
    runtime::age_ready_health_failure_for_tests(root.path(), Duration::from_millis(1));
    runtime::mark_tracked_child_ready_for_tests(root.path(), spec.id);
    assert!(
        !unobserved.is_current_for_tests(),
        "health recovery changes native lifetime even without an intervening observation"
    );
}

#[cfg(unix)]
#[test]
fn screen_recipient_same_model_restart_never_revives_previous_process_observation() {
    let _globals = lock_runtime_globals();
    let _lifecycle = super::super::RUNTIME_LIFECYCLE_LOCK
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    let root = tempfile::tempdir().expect("temporary root");
    let spec = require_model("drifty-qwen3-5-4b-default").expect("model");
    let (_fixture, pid) = owned_screen_recipient_fixture(root.path(), spec);
    runtime::mark_tracked_child_ready_for_tests(root.path(), spec.id);
    let _listeners = runtime::override_runtime_listener_pids_for_tests(Some(vec![pid]));
    let old = runtime::observe_screen_recipient(root.path()).expect("first process");
    runtime::stop_runtime_for_tests();
    let replacement = spawn_adopted_runtime(root.path());
    let replacement_pid = replacement.id();
    runtime::install_screen_recipient_fixture(root.path(), replacement, spec);
    runtime::mark_tracked_child_ready_for_tests(root.path(), spec.id);
    let _replacement_listener =
        runtime::override_runtime_listener_pids_for_tests(Some(vec![replacement_pid]));
    assert!(runtime::observe_screen_recipient(root.path()).is_some());
    assert!(
        !old.is_current_for_tests(),
        "same profile/model is a distinct child lifetime"
    );
}

#[cfg(windows)]
#[test]
#[ignore = "native child fixture, invoked explicitly by the lifecycle test"]
fn screen_recipient_windows_child_fixture() {
    // A separate copy of this test binary is the owned native child. Normal
    // test invocation does not block. Only the private child receives these
    // task-temporary paths; no app, account, model or network is used.
    if let Some(ready) = std::env::var_os("DRIFTY_SCREEN_RECIPIENT_TEST_READY") {
        std::fs::write(ready, b"ready").expect("fixture readiness");
        let mut byte = [0_u8; 1];
        let _ = std::io::Read::read(&mut std::io::stdin(), &mut byte);
    }
}

#[cfg(windows)]
#[test]
fn screen_recipient_windows_exact_child_exit_restart_and_foreign_listener_refusal() {
    let _globals = lock_runtime_globals();
    let _lifecycle = super::super::RUNTIME_LIFECYCLE_LOCK
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    let root = tempfile::tempdir().expect("temporary root");
    let dir = root.path().join("runtime");
    std::fs::create_dir(&dir).expect("fixture directory");
    let executable = dir.join("llama-server.exe");
    std::fs::copy(std::env::current_exe().expect("test binary"), &executable)
        .expect("preserve exact native fixture");
    let spec = require_model("drifty-qwen3-5-4b-default").expect("model");
    let spawn = |ready: &Path| {
        let child = Command::new(&executable)
            .args(["--exact", "commands::managed_ai::tests::runtime_tests::screen_recipient_windows_child_fixture", "--ignored", "--nocapture"])
            .env("DRIFTY_SCREEN_RECIPIENT_TEST_READY", ready)
            .stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().expect("native fixture child");
        let deadline = Instant::now() + Duration::from_secs(5);
        while !ready.exists() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        let ready_found = ready.exists();
        let pid = child.id();
        runtime::install_screen_recipient_fixture(root.path(), child, spec);
        assert!(ready_found, "child entered fixture before ownership checks");
        pid
    };
    let _fixture = ScreenRecipientFixture;
    let pid = spawn(&root.path().join("ready1"));
    let _listeners = runtime::override_runtime_listener_pids_for_tests(Some(vec![pid]));
    assert!(
        runtime::observe_screen_recipient(root.path()).is_none(),
        "unready child"
    );
    runtime::mark_tracked_child_ready_for_tests(root.path(), spec.id);
    let observed = runtime::observe_screen_recipient(root.path()).expect("exact live native child");
    assert_eq!(
        serde_json::to_value(&observed).unwrap()["imagesSupported"],
        false
    );
    {
        let _foreign =
            runtime::override_runtime_listener_pids_for_tests(Some(vec![std::process::id()]));
        assert!(runtime::observe_screen_recipient(root.path()).is_none());
        assert!(!observed.is_current_for_tests());
    }
    assert!(!observed.is_current_for_tests());
    let before_stop = runtime::observe_screen_recipient(root.path()).expect("fresh observation");
    runtime::stop_runtime_for_tests();
    assert!(!before_stop.is_current_for_tests());
    let replacement = spawn(&root.path().join("ready2"));
    runtime::mark_tracked_child_ready_for_tests(root.path(), spec.id);
    let _replacement = runtime::override_runtime_listener_pids_for_tests(Some(vec![replacement]));
    assert!(runtime::observe_screen_recipient(root.path()).is_some());
    assert!(!before_stop.is_current_for_tests());
}
