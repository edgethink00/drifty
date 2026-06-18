use std::path::{Path, PathBuf};

use super::{
    install_model_at_root_with_downloader, managed_ai_catalog, model_dir, read_status,
    require_model, runtime, start_model_at_root, status_for_spec, write_status,
    ManagedAiDownloadProgress, ManagedAiError, ManagedAiInstallState, ManagedAiModelSpec,
    MANAGED_ASSETS_MISSING_MESSAGE,
};

#[test]
fn catalog_uses_current_local_models() {
    let labels = managed_ai_catalog()
        .into_iter()
        .map(|model| model.label)
        .collect::<Vec<_>>();

    assert_eq!(
        labels,
        vec!["Qwen 3.5 2B", "Qwen 3.5 4B", "Gemma 3 12B", "Qwen 3.6 27B"]
    );
}

#[test]
fn install_downloads_model_artifact_before_marking_installed() {
    let root = tempfile::tempdir().expect("create temp root");
    let status = install_model_at_root_with_downloader(
        root.path(),
        "drifty-qwen3-5-4b-default",
        fake_download,
    )
    .expect("install model");
    let artifact_dir = model_dir(root.path(), "drifty-qwen3-5-4b-default");

    assert!(matches!(status.state, ManagedAiInstallState::Installed));
    assert_eq!(
        status.selected_model_id.as_deref(),
        Some("drifty-qwen3-5-4b-default")
    );
    assert_eq!(status.model.as_deref(), Some("drifty-qwen3.5-4b-local"));
    assert_eq!(
        status.artifact_dir.as_deref(),
        Some(artifact_dir.to_string_lossy().as_ref())
    );
    assert!(artifact_dir.join("Qwen3.5-4B-Q4_K_M.gguf").is_file());
}

#[test]
fn install_returns_error_status_when_download_fails() {
    let root = tempfile::tempdir().expect("create temp root");
    let status = install_model_at_root_with_downloader(
        root.path(),
        "drifty-qwen3-5-4b-default",
        failing_download,
    )
    .expect("install model");

    assert!(matches!(status.state, ManagedAiInstallState::Error));
    assert_eq!(
        status.selected_model_id.as_deref(),
        Some("drifty-qwen3-5-4b-default")
    );
    assert!(status.artifact_dir.is_none());
    assert!(status.message.contains("network unavailable"));
    assert!(!model_dir(root.path(), "drifty-qwen3-5-4b-default").exists());
}

#[test]
fn install_records_downloader_reported_progress_before_marking_installed() {
    let root = tempfile::tempdir().expect("create temp root");
    let status = install_model_at_root_with_downloader(
        root.path(),
        "drifty-qwen3-5-4b-default",
        progress_reporting_download,
    )
    .expect("install model");

    assert!(matches!(status.state, ManagedAiInstallState::Installed));
    assert!(status.progress.is_none());
    let saved_status = read_status(root.path()).expect("read final status");
    assert!(matches!(
        saved_status.state,
        ManagedAiInstallState::Installed
    ));
    assert!(saved_status.progress.is_none());
}

#[test]
fn start_requires_runtime_assets() {
    let root = tempfile::tempdir().expect("create temp root");
    let status =
        start_model_at_root(root.path(), "drifty-qwen3-5-4b-default").expect("start status");

    assert!(matches!(status.state, ManagedAiInstallState::Error));
}

#[test]
fn start_spawns_runtime_for_downloaded_model() {
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
    assert!(args.contains("--host\n127.0.0.1"));
    assert!(args.contains("--port\n39217"));
    assert!(args.contains("--alias\ndrifty-qwen3.5-4b-local"));
    assert!(args.contains("--reasoning\noff"));
    assert!(args.contains("--reasoning-format\nnone"));
    assert!(args.contains("--reasoning-budget\n0"));
    assert!(args.contains("Qwen3.5-4B-Q4_K_M.gguf"));
}

#[test]
fn read_status_downgrades_stale_installed_empty_model_dir() {
    let root = tempfile::tempdir().expect("create temp root");
    let spec = require_model("drifty-qwen3-5-4b-default").expect("model spec");
    let stale_model_dir = model_dir(root.path(), "drifty-qwen3-5-4b-default");
    std::fs::create_dir_all(&stale_model_dir).expect("create stale empty dir");
    let stale_status = status_for_spec(
        ManagedAiInstallState::Installed,
        spec,
        Some(stale_model_dir),
        "Stale installed status.",
    );
    write_status(root.path(), &stale_status).expect("write stale status");

    let status = read_status(root.path()).expect("read normalized status");

    assert!(matches!(status.state, ManagedAiInstallState::Error));
    assert!(status.artifact_dir.is_none());
    assert_eq!(status.message, MANAGED_ASSETS_MISSING_MESSAGE);
}

#[test]
fn read_status_downgrades_stale_running_without_runtime_process() {
    let root = tempfile::tempdir().expect("create temp root");
    let spec = require_model("drifty-qwen3-5-4b-default").expect("model spec");
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

fn fake_download(
    root: &Path,
    spec: ManagedAiModelSpec,
    _progress: &mut dyn FnMut(ManagedAiDownloadProgress) -> Result<(), ManagedAiError>,
) -> Result<PathBuf, ManagedAiError> {
    let artifact_dir = model_dir(root, spec.id);
    std::fs::create_dir_all(&artifact_dir)?;
    std::fs::write(artifact_dir.join(spec.file_name), b"gguf")?;
    Ok(artifact_dir)
}

fn write_fake_runtime(root: &Path, args_path: &Path) -> Result<(), ManagedAiError> {
    let runtime_dir = root.join("runtime");
    std::fs::create_dir_all(&runtime_dir)?;
    let runtime_path = runtime_dir.join("llama-server");
    let args_path = shell_quote(args_path);
    std::fs::write(
        &runtime_path,
        format!("#!/bin/sh\nprintf '%s\\n' \"$@\" > {args_path}\nwhile true; do sleep 5; done\n"),
    )?;
    let mut permissions = std::fs::metadata(&runtime_path)?.permissions();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        permissions.set_mode(0o755);
    }
    std::fs::set_permissions(runtime_path, permissions)?;
    Ok(())
}

fn shell_quote(path: &Path) -> String {
    let value = path.to_string_lossy();
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn progress_reporting_download(
    root: &Path,
    spec: ManagedAiModelSpec,
    progress: &mut dyn FnMut(ManagedAiDownloadProgress) -> Result<(), ManagedAiError>,
) -> Result<PathBuf, ManagedAiError> {
    progress(ManagedAiDownloadProgress::from_counts(
        spec.expected_size_bytes / 2,
        spec.expected_size_bytes,
    ))?;
    let progress_status = read_status(root).expect("read in-progress status");
    assert!(matches!(
        progress_status.state,
        ManagedAiInstallState::Installing
    ));
    assert_eq!(progress_status.selected_model_id.as_deref(), Some(spec.id));
    assert_eq!(
        progress_status.progress.as_ref().map(|item| item.percent),
        Some(50)
    );
    assert_eq!(
        progress_status
            .progress
            .as_ref()
            .map(|item| item.downloaded_bytes),
        Some(spec.expected_size_bytes / 2)
    );

    fake_download(root, spec, progress)
}

fn failing_download(
    _root: &Path,
    _spec: ManagedAiModelSpec,
    _progress: &mut dyn FnMut(ManagedAiDownloadProgress) -> Result<(), ManagedAiError>,
) -> Result<PathBuf, ManagedAiError> {
    Err(ManagedAiError::DownloadFailed(
        "network unavailable".to_string(),
    ))
}
