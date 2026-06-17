use std::path::{Path, PathBuf};

use super::{
    install_model_at_root_with_downloader, managed_ai_catalog, model_dir, read_status,
    require_model, start_model_at_root, status_for_spec, write_status, ManagedAiDownloadProgress,
    ManagedAiError, ManagedAiInstallState, ManagedAiModelSpec, MANAGED_ASSETS_MISSING_MESSAGE,
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
