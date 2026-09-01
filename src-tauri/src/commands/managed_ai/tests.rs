use std::path::{Path, PathBuf};

use super::{
    install_model_at_root_with_downloader, managed_ai_catalog, model_dir, model_resource_failure,
    read_status, require_model, runtime, start_model_at_root, status_for_spec, write_status,
    DownloadProgressWriteGate, ManagedAiDownloadProgress, ManagedAiError, ManagedAiInstallState,
    ManagedAiModelSpec, ManagedAiStatusErrorKind, MANAGED_ASSETS_MISSING_MESSAGE,
};

mod runtime_tests;

#[cfg(test)]
fn set_machine_memory_bytes_for_tests(bytes: Option<u64>) {
    super::hardware::set_machine_memory_bytes_for_tests(bytes);
}

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
fn catalog_pins_model_artifacts_with_exact_sizes_and_sha256() {
    for model in managed_ai_catalog() {
        let spec = require_model(&model.id).expect("catalog model has spec");
        assert!(spec.download_url.contains("/resolve/"));
        assert!(!spec.download_url.contains("/resolve/main/"));
        assert_eq!(spec.expected_sha256.len(), 64);
        assert!(spec
            .expected_sha256
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit()));
        assert!(spec.expected_size_bytes > 0);
    }
    let gemma = require_model("drifty-gemma-4-12b-local").expect("Gemma spec");
    assert_eq!(gemma.expected_size_bytes, 7_121_861_440);
}

#[test]
fn catalog_fit_matrix_matches_machine_memory() {
    const GIB: u64 = 1024 * 1024 * 1024;
    let fit_labels = |machine: u64| {
        super::catalog_for_machine(Some(machine))
            .into_iter()
            .map(|model| model.fit.expect("fit is set when machine memory is known"))
            .collect::<Vec<_>>()
    };

    assert_eq!(
        fit_labels(8 * GIB),
        vec!["good", "tight", "insufficient", "insufficient"]
    );
    assert_eq!(
        fit_labels(16 * GIB),
        vec!["good", "good", "tight", "insufficient"]
    );
    assert_eq!(
        fit_labels(32 * GIB),
        vec!["good", "good", "good", "insufficient"]
    );
    assert_eq!(fit_labels(36 * GIB), vec!["good", "good", "good", "tight"]);
    assert_eq!(fit_labels(48 * GIB), vec!["good", "good", "good", "good"]);
}

#[test]
fn catalog_recommends_best_fitting_model_for_machine() {
    const GIB: u64 = 1024 * 1024 * 1024;
    let recommended_id = |machine: u64| {
        super::catalog_for_machine(Some(machine))
            .into_iter()
            .find(|model| model.recommended)
            .map(|model| model.id)
    };

    assert_eq!(
        recommended_id(8 * GIB).as_deref(),
        Some("drifty-qwen3-5-2b-economy")
    );
    assert_eq!(
        recommended_id(16 * GIB).as_deref(),
        Some("drifty-qwen3-5-4b-default")
    );
    assert_eq!(
        recommended_id(64 * GIB).as_deref(),
        Some("drifty-qwen3-5-4b-default")
    );
}

#[test]
fn catalog_without_machine_memory_keeps_static_recommendation_and_no_fit() {
    let models = super::catalog_for_machine(None);
    let recommended = models
        .iter()
        .find(|model| model.recommended)
        .expect("static recommendation preserved");

    assert_eq!(recommended.id, "drifty-qwen3-5-4b-default");
    assert!(models
        .iter()
        .all(|model| model.fit.is_none() && model.fit_detail.is_none()));
}

#[test]
fn catalog_fit_detail_explains_tight_and_insufficient_models() {
    const GIB: u64 = 1024 * 1024 * 1024;
    let models = super::catalog_for_machine(Some(16 * GIB));

    let gemma = models
        .iter()
        .find(|model| model.id == "drifty-gemma-4-12b-local")
        .expect("gemma");
    assert_eq!(gemma.fit.as_deref(), Some("tight"));
    assert_eq!(
        gemma.fit_detail.as_deref(),
        Some("May be slow and heavy alongside other apps on a 16 GB computer.")
    );

    let smart = models
        .iter()
        .find(|model| model.id == "drifty-qwen3-6-27b-smart")
        .expect("smart");
    assert_eq!(smart.fit.as_deref(), Some("insufficient"));
    assert_eq!(
        smart.fit_detail.as_deref(),
        Some("Needs at least 36 GB of memory — this computer has 16 GB.")
    );

    let default = models
        .iter()
        .find(|model| model.id == "drifty-qwen3-5-4b-default")
        .expect("default");
    assert_eq!(default.fit.as_deref(), Some("good"));
    assert!(default.fit_detail.is_none());
}

#[test]
fn catalog_reports_runtime_memory_estimate_above_artifact_size() {
    for model in managed_ai_catalog() {
        let spec = require_model(&model.id).expect("catalog model has spec");
        assert!(
            model.estimated_runtime_memory_bytes > spec.expected_size_bytes,
            "{} runtime memory estimate must exceed its artifact size",
            model.id
        );
    }
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

    assert!(
        matches!(status.state, ManagedAiInstallState::Installed),
        "unexpected managed AI install status: {status:?}"
    );
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
fn resource_preflight_reports_insufficient_memory_for_the_selected_model() {
    let spec = require_model("drifty-qwen3-6-27b-smart").expect("model spec");
    let failure = model_resource_failure(spec, Some(16 * 1024 * 1024 * 1024), Some(u64::MAX))
        .expect("memory failure");

    assert!(matches!(
        failure.error_kind,
        ManagedAiStatusErrorKind::InsufficientMemory
    ));
    assert!(failure.message.contains("requires more memory"));
    assert_eq!(failure.required_bytes, 36 * 1024 * 1024 * 1024);
    assert_eq!(failure.available_bytes, 16 * 1024 * 1024 * 1024);
}

#[test]
fn resource_preflight_reports_insufficient_storage_before_download() {
    let spec = require_model("drifty-qwen3-5-4b-default").expect("model spec");
    let failure = model_resource_failure(spec, Some(16 * 1024 * 1024 * 1024), Some(1024))
        .expect("storage failure");

    assert!(matches!(
        failure.error_kind,
        ManagedAiStatusErrorKind::InsufficientStorage
    ));
    assert!(failure.message.contains("Not enough free storage"));
    assert_eq!(failure.required_bytes, 6 * 1024 * 1024 * 1024);
    assert_eq!(failure.available_bytes, 1024);
}

#[test]
fn storage_full_io_errors_keep_the_model_and_a_typed_recovery() {
    let root = tempfile::tempdir().expect("create temp root");
    let status = install_model_at_root_with_downloader(
        root.path(),
        "drifty-qwen3-5-4b-default",
        storage_full_download,
        None,
    )
    .expect("install model");

    assert_eq!(
        status.selected_model_id.as_deref(),
        Some("drifty-qwen3-5-4b-default")
    );
    assert!(matches!(
        status.error_kind,
        Some(ManagedAiStatusErrorKind::InsufficientStorage)
    ));
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

    assert!(
        matches!(status.state, ManagedAiInstallState::Installed),
        "unexpected managed AI progress install status: {status:?}"
    );
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
    install_model_at_root_with_downloader(
        root.path(),
        "drifty-qwen3-5-4b-default",
        fake_download,
        None,
    )
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
    let file = std::fs::File::create(artifact_dir.join(spec.file_name))?;
    #[cfg(windows)]
    mark_sparse_for_windows_test(&file)?;
    file.set_len(spec.expected_size_bytes)?;
    Ok(artifact_dir)
}

#[cfg(windows)]
fn mark_sparse_for_windows_test(file: &std::fs::File) -> std::io::Result<()> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::System::Ioctl::FSCTL_SET_SPARSE;
    use windows_sys::Win32::System::IO::DeviceIoControl;

    let mut bytes_returned = 0_u32;
    // SAFETY: the handle belongs to the live `File`; FSCTL_SET_SPARSE takes no
    // input or output buffers, and `bytes_returned` remains valid for the call.
    let succeeded = unsafe {
        DeviceIoControl(
            file.as_raw_handle() as _,
            FSCTL_SET_SPARSE,
            std::ptr::null(),
            0,
            std::ptr::null_mut(),
            0,
            &mut bytes_returned,
            std::ptr::null_mut(),
        )
    };
    if succeeded == 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
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
    runtime::write_runtime_completion_fixture(root)?;
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

fn storage_full_download(
    _root: &Path,
    _spec: ManagedAiModelSpec,
    _progress: &mut dyn FnMut(ManagedAiDownloadProgress) -> Result<(), ManagedAiError>,
) -> Result<PathBuf, ManagedAiError> {
    Err(std::io::Error::from_raw_os_error(28).into())
}
