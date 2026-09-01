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
        start_model_at_root(root.path(), "drifty-qwen3-5-4b-default").expect("start status");

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
        start_model_at_root(root.path(), "drifty-qwen3-5-4b-default").expect("start status");
    runtime::stop_runtime_for_tests();

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

    let first = start_model_at_root(root.path(), spec.id).expect("first start status");
    let second = start_model_at_root(root.path(), spec.id).expect("second start status");
    runtime::stop_runtime_for_tests();

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
    runtime::stop_runtime_for_tests();

    let starts = std::fs::read_to_string(starts_path).expect("read runtime starts");
    assert_eq!(
        starts.lines().count(),
        1,
        "concurrent starts must share one child"
    );
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

    let started = start_model_at_root(root.path(), spec.id).expect("start status");
    assert!(matches!(started.state, ManagedAiInstallState::Starting));
    runtime::age_tracked_child_for_tests(Duration::from_secs(121));

    let status = read_status(root.path()).expect("read timed-out runtime status");

    assert!(matches!(status.state, ManagedAiInstallState::Error));
    assert!(matches!(
        status.error_kind,
        Some(ManagedAiStatusErrorKind::RuntimeFailed)
    ));
    assert!(status.message.contains("within two minutes"));
}

#[cfg(unix)]
#[test]
fn delete_model_reaps_adopted_runtime_server() {
    let _globals = lock_runtime_globals();
    let root = tempfile::tempdir().expect("create temp root");
    let spec = require_model("drifty-gemma-4-12b-local").expect("model spec");
    fake_download(root.path(), spec, &mut |_| Ok(())).expect("write model artifact");
    write_fake_runtime(root.path(), &root.path().join("runtime-args.txt"))
        .expect("write fake runtime");
    // Adopted server: already listening when the app launched, never tracked
    // in RUNTIME_CHILD.
    let mut adopted = spawn_adopted_runtime(root.path());

    runtime::set_runtime_listener_pids_for_tests(Some(vec![adopted.id()]));
    let result = super::super::delete_model_at_root(root.path(), "drifty-gemma-4-12b-local");
    runtime::set_runtime_listener_pids_for_tests(None);

    let status = result.expect("delete status");
    assert!(matches!(status.state, ManagedAiInstallState::NotInstalled));
    assert!(
        wait_for_exit(&mut adopted),
        "adopted llama-server must be terminated by model delete"
    );
}

#[cfg(unix)]
#[test]
fn app_exit_reaps_adopted_runtime_server() {
    let _globals = lock_runtime_globals();
    let root = tempfile::tempdir().expect("create temp root");
    write_fake_runtime(root.path(), &root.path().join("runtime-args.txt"))
        .expect("write fake runtime");
    let mut adopted = spawn_adopted_runtime(root.path());

    runtime::set_runtime_listener_pids_for_tests(Some(vec![adopted.id()]));
    let result = runtime::stop_runtime(Some(root.path()));
    runtime::set_runtime_listener_pids_for_tests(None);

    result.expect("stop runtime");
    assert!(
        wait_for_exit(&mut adopted),
        "adopted llama-server must be terminated on app exit"
    );
}

fn spawn_adopted_runtime(root: &Path) -> Child {
    Command::new("/bin/sh")
        .arg(root.join("runtime").join("llama-server"))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn adopted runtime process")
}

#[cfg(unix)]
fn write_counting_fake_runtime(root: &Path, starts_path: &Path) -> Result<(), ManagedAiError> {
    let runtime_dir = root.join("runtime");
    std::fs::create_dir_all(&runtime_dir)?;
    let runtime_path = runtime_dir.join("llama-server");
    let starts_path = shell_quote(starts_path);
    std::fs::write(
        &runtime_path,
        format!("#!/bin/sh\nprintf 'started\\n' >> {starts_path}\nwhile true; do sleep 5; done\n"),
    )?;
    let mut permissions = std::fs::metadata(&runtime_path)?.permissions();
    use std::os::unix::fs::PermissionsExt;
    permissions.set_mode(0o755);
    std::fs::set_permissions(runtime_path, permissions)?;
    runtime::write_runtime_completion_fixture(root)?;
    Ok(())
}

fn wait_for_exit(child: &mut Child) -> bool {
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        if matches!(child.try_wait(), Ok(Some(_))) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    false
}

#[test]
fn read_status_downgrades_stale_running_without_runtime_process() {
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

    assert!(matches!(status.state, ManagedAiInstallState::Error));
    assert_eq!(status.message, "Managed local AI runtime is not running.");
    assert!(matches!(
        status.error_kind,
        Some(ManagedAiStatusErrorKind::RuntimeFailed)
    ));
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
    let root = std::env::var("DRIFTY_MANAGED_AI_QA_ROOT")
        .map(PathBuf::from)
        .expect("set DRIFTY_MANAGED_AI_QA_ROOT to the app managed-ai directory");
    let started = start_model_at_root(&root, "drifty-qwen3-5-2b-economy").expect("start runtime");

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
