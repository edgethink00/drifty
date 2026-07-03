use std::path::{Path, PathBuf};

use super::{
    install_model_at_root_with_downloader, managed_ai_catalog, model_dir, read_status,
    require_model, runtime, start_model_at_root, status_for_spec, write_status,
    DownloadProgressWriteGate, ManagedAiDownloadProgress, ManagedAiError, ManagedAiInstallState,
    ManagedAiModelSpec, ManagedAiStatusErrorKind, MANAGED_ASSETS_MISSING_MESSAGE,
};

mod runtime_tests;

#[test]
fn catalog_uses_current_local_models() {
    let labels = managed_ai_catalog()
        .into_iter()
        .map(|model| model.label)
        .collect::<Vec<_>>();

    assert_eq!(
        labels,
        vec!["Qwen 3.5 2B", "Qwen 3.5 4B", "Gemma 4 12B", "Qwen 3.6 27B"]
    );
}

#[test]
fn install_downloads_model_artifact_before_marking_installed() {
    let root = tempfile::tempdir().expect("create temp root");
    let status = install_model_at_root_with_downloader(
        root.path(),
        "drifty-qwen3-5-4b-default",
        fake_download,
        None,
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
        installed_model_ids(&status),
        vec!["drifty-qwen3-5-4b-default"]
    );
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
        None,
    )
    .expect("install model");

    assert!(matches!(status.state, ManagedAiInstallState::Error));
    assert_eq!(
        status.selected_model_id.as_deref(),
        Some("drifty-qwen3-5-4b-default")
    );
    assert!(status.artifact_dir.is_none());
    assert!(matches!(
        status.error_kind,
        Some(ManagedAiStatusErrorKind::DownloadFailed)
    ));
    assert!(status.message.contains("network unavailable"));
    assert!(!model_dir(root.path(), "drifty-qwen3-5-4b-default").exists());
}

#[test]
fn install_reports_global_error_for_non_download_failures() {
    let root = tempfile::tempdir().expect("create temp root");
    let status = install_model_at_root_with_downloader(
        root.path(),
        "drifty-qwen3-5-4b-default",
        storage_failing_download,
        None,
    )
    .expect("install model");

    assert!(matches!(status.state, ManagedAiInstallState::Error));
    assert!(status.selected_model_id.is_none());
    assert!(status.error_kind.is_none());
    assert!(status.message.contains("storage failed"));
}

#[test]
fn install_records_downloader_reported_progress_before_marking_installed() {
    let root = tempfile::tempdir().expect("create temp root");
    let status = install_model_at_root_with_downloader(
        root.path(),
        "drifty-qwen3-5-4b-default",
        progress_reporting_download,
        None,
    )
    .expect("install model");

    assert!(matches!(status.state, ManagedAiInstallState::Installed));
    assert!(status.progress.is_none());
    assert_eq!(
        installed_model_ids(&status),
        vec!["drifty-qwen3-5-4b-default"]
    );
    let saved_status = read_status(root.path()).expect("read final status");
    assert!(matches!(
        saved_status.state,
        ManagedAiInstallState::Installed
    ));
    assert!(saved_status.progress.is_none());
    assert_eq!(
        installed_model_ids(&saved_status),
        vec!["drifty-qwen3-5-4b-default"]
    );
}

#[test]
fn install_tracks_multiple_downloaded_models() {
    let root = tempfile::tempdir().expect("create temp root");
    install_model_at_root_with_downloader(root.path(), "drifty-qwen3-5-4b-default", fake_download, None)
        .expect("install default model");

    let status = install_model_at_root_with_downloader(
        root.path(),
        "drifty-qwen3-5-2b-economy",
        fake_download,
        None,
    )
    .expect("install economy model");

    assert_eq!(
        installed_model_ids(&status),
        vec!["drifty-qwen3-5-2b-economy", "drifty-qwen3-5-4b-default"]
    );
    let saved_status = read_status(root.path()).expect("read saved status");
    assert_eq!(
        installed_model_ids(&saved_status),
        vec!["drifty-qwen3-5-2b-economy", "drifty-qwen3-5-4b-default"]
    );
}

#[test]
fn read_status_reports_installed_models_without_status_file() {
    let root = tempfile::tempdir().expect("create temp root");
    let spec = require_model("drifty-qwen3-5-4b-default").expect("model spec");
    fake_download(root.path(), spec, &mut |_| Ok(())).expect("write model artifact");

    let status = read_status(root.path()).expect("read status");

    assert!(matches!(status.state, ManagedAiInstallState::NotInstalled));
    assert_eq!(
        installed_model_ids(&status),
        vec!["drifty-qwen3-5-4b-default"]
    );
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
    assert!(matches!(
        status.error_kind,
        Some(ManagedAiStatusErrorKind::ModelArtifactMissing)
    ));
    assert_eq!(status.message, MANAGED_ASSETS_MISSING_MESSAGE);
}

#[test]
fn progress_gate_writes_once_per_integer_percent_change() {
    let mut gate = DownloadProgressWriteGate::default();
    let percents = [0_u8, 0, 0, 1, 1, 2, 2, 2, 3, 50, 50, 99, 100, 100, 100];

    let written = percents
        .into_iter()
        .filter(|percent| gate.should_write(*percent))
        .collect::<Vec<_>>();

    assert_eq!(written, vec![0, 1, 2, 3, 50, 99, 100]);
}

#[test]
fn progress_gate_bounds_status_writes_for_chunked_download() {
    let total: u64 = 3 * 1024 * 1024 * 1024;
    let chunk: u64 = 64 * 1024;
    let mut gate = DownloadProgressWriteGate::default();
    let mut writes = 0_u32;
    let mut last_written_percent = None;
    let mut downloaded = 0_u64;
    while downloaded < total {
        downloaded = (downloaded + chunk).min(total);
        let progress = ManagedAiDownloadProgress::from_counts(downloaded, total);
        if gate.should_write(progress.percent) {
            writes += 1;
            last_written_percent = Some(progress.percent);
        }
    }

    // One write per integer percent instead of one per 64KB chunk.
    assert_eq!(writes, 101);
    assert_eq!(last_written_percent, Some(100));
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

fn installed_model_ids(status: &super::ManagedAiStatus) -> Vec<&str> {
    let mut ids = status
        .installed_models
        .iter()
        .map(|model| model.id.as_str())
        .collect::<Vec<_>>();
    ids.sort_unstable();
    ids
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

fn storage_failing_download(
    _root: &Path,
    _spec: ManagedAiModelSpec,
    _progress: &mut dyn FnMut(ManagedAiDownloadProgress) -> Result<(), ManagedAiError>,
) -> Result<PathBuf, ManagedAiError> {
    Err(std::io::Error::new(std::io::ErrorKind::Other, "disk full").into())
}
