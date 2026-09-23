use std::path::{Path, PathBuf};

use super::{
    begin_runtime_status_monitor, finish_runtime_status_monitor,
    install_model_at_root_with_downloader, install_model_at_root_with_runtime_preparer,
    managed_ai_catalog, model_dir, model_resource_failure, read_status, require_model, runtime,
    runtime_status_monitor_is_current, start_model_at_root, start_model_at_root_for_generation,
    status_for_spec, write_status, DownloadProgressWriteGate, ManagedAiDownloadProgress,
    ManagedAiError, ManagedAiInstallState, ManagedAiModelSpec, ManagedAiStatusErrorKind,
    MANAGED_ASSETS_MISSING_MESSAGE,
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
fn newer_runtime_monitor_generation_supersedes_stale_completion() {
    let root = tempfile::tempdir().expect("create temp root");
    let first = begin_runtime_status_monitor(root.path());
    let second = begin_runtime_status_monitor(root.path());

    assert!(!runtime_status_monitor_is_current(root.path(), first));
    assert!(runtime_status_monitor_is_current(root.path(), second));

    finish_runtime_status_monitor(root.path(), first);
    assert!(runtime_status_monitor_is_current(root.path(), second));

    finish_runtime_status_monitor(root.path(), second);
    assert!(!runtime_status_monitor_is_current(root.path(), second));
}

#[test]
fn invalidated_runtime_monitor_cannot_publish_after_newer_lifecycle_status() {
    let root = tempfile::tempdir().expect("create temp root");
    let stale_spec = require_model("drifty-qwen3-5-4b-default").expect("stale model");
    let current_spec = require_model("drifty-qwen3-5-2b-economy").expect("current model");
    write_status(
        root.path(),
        &super::status_for_model_error(
            stale_spec,
            None,
            "Stale monitor terminal status.",
            ManagedAiStatusErrorKind::RuntimeFailed,
        ),
    )
    .expect("write stale monitor status");
    let stale_generation = begin_runtime_status_monitor(root.path());
    let root_path = root.path();

    std::thread::scope(|scope| {
        let (publish_reached_tx, publish_reached_rx) = std::sync::mpsc::channel();
        let (release_publish_tx, release_publish_rx) = std::sync::mpsc::channel();
        let stale_poll = scope.spawn(move || {
            super::poll_runtime_status_monitor_with_before_publish(
                root_path,
                stale_spec.id,
                stale_generation,
                None,
                || {
                    publish_reached_tx
                        .send(())
                        .expect("signal final publish boundary");
                    release_publish_rx.recv().expect("release stale publish");
                },
            )
        });
        publish_reached_rx
            .recv()
            .expect("stale poll reached final publish boundary");
        assert!(
            matches!(
                super::RUNTIME_LIFECYCLE_LOCK.try_lock(),
                Err(std::sync::TryLockError::WouldBlock)
            ),
            "the monitor must retain lifecycle ownership through publication"
        );

        let current_generation = begin_runtime_status_monitor(root.path());
        let current_writer = scope.spawn(move || {
            let _lifecycle_guard = super::RUNTIME_LIFECYCLE_LOCK
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            let current_status = super::status_for_model_error(
                current_spec,
                None,
                "Newer lifecycle terminal status.",
                ManagedAiStatusErrorKind::RuntimeFailed,
            );
            write_status(root_path, &current_status).expect("write newer lifecycle status");
        });
        release_publish_tx.send(()).expect("release stale publish");

        assert_eq!(
            stale_poll
                .join()
                .expect("join stale poll")
                .expect("stale poll result"),
            super::RuntimeStatusMonitorPoll::Finished
        );
        current_writer.join().expect("join newer lifecycle writer");
        assert!(runtime_status_monitor_is_current(
            root.path(),
            current_generation
        ));
        finish_runtime_status_monitor(root.path(), current_generation);
    });

    let persisted: super::ManagedAiStatus = serde_json::from_slice(
        &std::fs::read(root.path().join("status.json")).expect("read final status"),
    )
    .expect("parse final status");
    assert!(matches!(persisted.state, ManagedAiInstallState::Error));
    assert_eq!(
        persisted.selected_model_id.as_deref(),
        Some(current_spec.id)
    );
    assert_eq!(persisted.message, "Newer lifecycle terminal status.");
}

#[test]
fn concurrent_status_writes_remain_atomic_and_parseable() {
    let root = tempfile::tempdir().expect("create status root");
    let spec = require_model("drifty-qwen3-5-2b-economy").expect("model spec");
    let root_path = root.path();
    std::thread::scope(|scope| {
        let writes = (0..24)
            .map(|index| {
                scope.spawn(move || {
                    let status = status_for_spec(
                        ManagedAiInstallState::Error,
                        spec,
                        None,
                        &format!("concurrent status {index}"),
                    );
                    write_status(root_path, &status)
                })
            })
            .collect::<Vec<_>>();
        for write in writes {
            write
                .join()
                .expect("join status writer")
                .expect("write status");
        }
    });

    let bytes = std::fs::read(root.path().join("status.json")).expect("read final status");
    let parsed: super::ManagedAiStatus =
        serde_json::from_slice(&bytes).expect("parse final status");
    assert!(matches!(parsed.state, ManagedAiInstallState::Error));
    assert!(std::fs::read_dir(root.path())
        .expect("read status root")
        .all(|entry| !entry
            .expect("status entry")
            .file_name()
            .to_string_lossy()
            .starts_with(".status.json.")));
}

#[test]
fn stale_queued_start_cannot_overwrite_the_newer_lifecycle_owner() {
    let root = tempfile::tempdir().expect("create temp root");
    let stale = begin_runtime_status_monitor(root.path());
    let current = begin_runtime_status_monitor(root.path());

    let status = start_model_at_root_for_generation(
        root.path(),
        "drifty-qwen3-5-2b-economy",
        None,
        Some(stale),
    )
    .expect("return current status for superseded start");

    assert!(matches!(status.state, ManagedAiInstallState::NotInstalled));
    assert!(status.selected_model_id.is_none());
    assert!(runtime_status_monitor_is_current(root.path(), current));
    finish_runtime_status_monitor(root.path(), current);
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
fn install_marks_ready_only_after_runtime_preparation() {
    let root = tempfile::tempdir().expect("create temp root");
    let spec = require_model("drifty-qwen3-5-4b-default").expect("model spec");
    let runtime_prepared = std::cell::Cell::new(false);

    let status = install_model_at_root_with_runtime_preparer(
        root.path(),
        spec.id,
        fake_download,
        |runtime_root| {
            let preparing = read_status(runtime_root)?;
            assert!(matches!(preparing.state, ManagedAiInstallState::Installing));
            assert_eq!(preparing.selected_model_id.as_deref(), Some(spec.id));
            assert!(preparing.progress.is_none());
            assert!(preparing.artifact_dir.is_some());
            assert_eq!(installed_model_ids(&preparing), vec![spec.id]);
            runtime_prepared.set(true);
            Ok(())
        },
    )
    .expect("install model and prepare runtime");

    assert!(runtime_prepared.get());
    assert!(matches!(status.state, ManagedAiInstallState::Installed));
    assert_eq!(status.message, "Managed local AI is ready to start.");
}

#[test]
fn runtime_preparation_failure_keeps_the_downloaded_model_for_retry() {
    let root = tempfile::tempdir().expect("create temp root");
    let spec = require_model("drifty-qwen3-5-4b-default").expect("model spec");

    let status =
        install_model_at_root_with_runtime_preparer(root.path(), spec.id, fake_download, |_| {
            Err(ManagedAiError::RuntimeMissing(
                "runtime download unavailable".to_string(),
            ))
        })
        .expect("return recoverable runtime setup status");

    assert!(matches!(status.state, ManagedAiInstallState::Error));
    assert!(matches!(
        status.error_kind,
        Some(ManagedAiStatusErrorKind::RuntimeMissing)
    ));
    assert_eq!(status.selected_model_id.as_deref(), Some(spec.id));
    assert_eq!(installed_model_ids(&status), vec![spec.id]);
    assert!(model_dir(root.path(), spec.id)
        .join(spec.file_name)
        .is_file());
    assert!(!super::is_install_active(root.path(), spec.id));
}

#[test]
fn runtime_archive_download_failure_keeps_the_model_and_uses_setup_recovery() {
    let root = tempfile::tempdir().expect("create temp root");
    let spec = require_model("drifty-qwen3-5-4b-default").expect("model spec");

    let status =
        install_model_at_root_with_runtime_preparer(root.path(), spec.id, fake_download, |_| {
            Err(ManagedAiError::RuntimeDownloadFailed(
                "runtime archive request timed out".to_string(),
            ))
        })
        .expect("return runtime download recovery status");

    assert!(matches!(status.state, ManagedAiInstallState::Error));
    assert!(matches!(
        status.error_kind,
        Some(ManagedAiStatusErrorKind::RuntimeDownloadFailed)
    ));
    assert_eq!(installed_model_ids(&status), vec![spec.id]);
    assert!(model_dir(root.path(), spec.id)
        .join(spec.file_name)
        .is_file());
}

#[test]
#[ignore = "downloads and verifies the pinned managed runtime over the network"]
fn qa_model_install_prepares_the_real_runtime_before_ready() {
    let root = tempfile::tempdir().expect("create QA root");
    let spec = require_model("drifty-qwen3-5-2b-economy").expect("model spec");

    let status = install_model_at_root_with_runtime_preparer(
        root.path(),
        spec.id,
        fake_download,
        runtime::prepare_runtime,
    )
    .expect("install model and pinned runtime");

    assert!(matches!(status.state, ManagedAiInstallState::Installed));
    assert!(runtime::runtime_assets_ready(root.path()).expect("verify runtime assets"));
    assert_eq!(status.message, "Managed local AI is ready to start.");
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
fn install_reuses_active_root_install_instead_of_starting_another_downloader() {
    let root = tempfile::tempdir().expect("create temp root");
    let root_path = root.path().to_path_buf();
    let first_root = root_path.clone();
    let (started_tx, started_rx) = std::sync::mpsc::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();

    let first_install = std::thread::spawn(move || {
        install_model_at_root_with_downloader(
            &first_root,
            "drifty-qwen3-5-4b-default",
            move |download_root, spec, progress| {
                progress(ManagedAiDownloadProgress::from_counts(
                    spec.expected_size_bytes / 2,
                    spec.expected_size_bytes,
                ))?;
                started_tx.send(()).expect("signal blocked download");
                release_rx.recv().expect("release blocked download");
                fake_download(download_root, spec, progress)
            },
            None,
        )
        .expect("complete first install")
    });

    started_rx
        .recv_timeout(std::time::Duration::from_secs(5))
        .expect("first downloader started");

    for requested_model_id in ["drifty-qwen3-5-4b-default", "drifty-qwen3-5-2b-economy"] {
        let duplicate = super::install_model_at_root_with_preflight_and_downloader(
            &root_path,
            requested_model_id,
            |_| panic!("duplicate preflight must not overwrite active download status"),
            unexpected_download,
            None,
        )
        .expect("reuse active install status");

        assert!(matches!(duplicate.state, ManagedAiInstallState::Installing));
        assert_eq!(
            duplicate.selected_model_id.as_deref(),
            Some("drifty-qwen3-5-4b-default")
        );
        assert_eq!(
            duplicate.progress.as_ref().map(|progress| progress.percent),
            Some(50)
        );
    }

    release_tx.send(()).expect("release first download");
    let installed = first_install.join().expect("join first install");
    assert!(matches!(installed.state, ManagedAiInstallState::Installed));
    assert_eq!(
        installed_model_ids(&installed),
        vec!["drifty-qwen3-5-4b-default"]
    );
}

#[test]
fn duplicate_during_preflight_preserves_owner_before_status_is_written() {
    let root = tempfile::tempdir().expect("create temp root");
    let owner = require_model("drifty-qwen3-5-4b-default").expect("owner spec");
    let previous = require_model("drifty-qwen3-5-2b-economy").expect("previous spec");
    let stale = super::status_for_model_error(
        previous,
        None,
        "Previous download failed",
        ManagedAiStatusErrorKind::DownloadFailed,
    );
    write_status(root.path(), &stale).expect("write previous model status");

    let installed = super::install_model_at_root_with_preflight_and_downloader(
        root.path(),
        owner.id,
        |_| {
            for requested_model in [owner.id, previous.id] {
                let duplicate = super::install_model_at_root_with_preflight_and_downloader(
                    root.path(),
                    requested_model,
                    |_| panic!("duplicate request must not run preflight"),
                    unexpected_download,
                    None,
                )?;
                assert!(matches!(duplicate.state, ManagedAiInstallState::Installing));
                assert_eq!(duplicate.selected_model_id.as_deref(), Some(owner.id));
                assert!(duplicate.error_kind.is_none());
                assert!(duplicate.progress.is_none());
            }
            // The duplicate response must not overwrite persisted status while
            // the owner is still deciding whether its preflight can succeed.
            let persisted = read_status(root.path())?;
            assert_eq!(persisted.selected_model_id.as_deref(), Some(previous.id));
            assert!(matches!(persisted.state, ManagedAiInstallState::Error));
            Ok(None)
        },
        fake_download,
        None,
    )
    .expect("finish owner install");

    assert!(matches!(installed.state, ManagedAiInstallState::Installed));
    assert_eq!(installed.selected_model_id.as_deref(), Some(owner.id));
    assert!(!super::is_install_active(root.path(), owner.id));
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
fn runtime_setup_retry_reuses_valid_model_without_download_or_full_storage_preflight() {
    let root = tempfile::tempdir().expect("create temp root");
    let spec = require_model("drifty-qwen3-5-2b-economy").expect("model spec");
    let installed =
        install_model_at_root_with_downloader(root.path(), spec.id, fake_download, None)
            .expect("install model and runtime fixture");
    let artifact_dir = installed
        .artifact_dir
        .as_deref()
        .map(PathBuf::from)
        .expect("installed artifact directory");
    let artifact_path = artifact_dir.join(spec.file_name);
    let artifact_size = std::fs::metadata(&artifact_path)
        .expect("read installed model")
        .len();
    std::fs::remove_dir_all(root.path().join("runtime")).expect("remove runtime fixture");

    let retried = super::install_model_at_root_with_preflight_and_downloader(
        root.path(),
        spec.id,
        |needs_model_download| {
            assert!(
                !needs_model_download,
                "a valid model must skip the full download storage preflight"
            );
            Ok(None)
        },
        unexpected_download,
        None,
    )
    .expect("prepare only the missing runtime");

    assert!(matches!(retried.state, ManagedAiInstallState::Installed));
    assert!(runtime::runtime_assets_ready(root.path()).expect("runtime is restored"));
    assert_eq!(
        std::fs::metadata(artifact_path)
            .expect("model remains installed")
            .len(),
        artifact_size
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
fn read_status_recovers_interrupted_install() {
    let root = tempfile::tempdir().expect("create temp root");
    let spec = require_model("drifty-qwen3-5-4b-default").expect("model spec");
    let stale_status =
        super::status_for_download_progress(spec, ManagedAiDownloadProgress::from_counts(42, 100));
    write_status(root.path(), &stale_status).expect("write stale status");

    let status = read_status(root.path()).expect("read normalized status");

    assert!(matches!(status.state, ManagedAiInstallState::Error));
    assert_eq!(
        status.selected_model_id.as_deref(),
        Some("drifty-qwen3-5-4b-default")
    );
    assert!(status.artifact_dir.is_none());
    assert!(status.progress.is_none());
    assert!(matches!(
        status.error_kind,
        Some(ManagedAiStatusErrorKind::DownloadFailed)
    ));
    assert_eq!(
        status.message,
        "Managed local AI download was interrupted. Try downloading again."
    );

    let retried = install_model_at_root_with_downloader(root.path(), spec.id, fake_download, None)
        .expect("retry interrupted install");
    assert!(matches!(retried.state, ManagedAiInstallState::Installed));
}

#[test]
fn failed_preflight_and_download_release_install_for_retry() {
    let root = tempfile::tempdir().expect("create temp root");
    let spec = require_model("drifty-qwen3-5-4b-default").expect("model spec");
    let blocked = super::install_model_at_root_with_preflight_and_downloader(
        root.path(),
        spec.id,
        |_| {
            let status = super::status_for_model_error(
                spec,
                None,
                "Not enough free storage",
                ManagedAiStatusErrorKind::InsufficientStorage,
            );
            write_status(root.path(), &status)?;
            Ok(Some(status))
        },
        unexpected_download,
        None,
    )
    .expect("preflight failure status");
    assert!(matches!(
        blocked.error_kind,
        Some(ManagedAiStatusErrorKind::InsufficientStorage)
    ));
    assert!(!super::is_install_active(root.path(), spec.id));

    let failed =
        install_model_at_root_with_downloader(root.path(), spec.id, failing_download, None)
            .expect("download failure status");
    assert!(matches!(
        failed.error_kind,
        Some(ManagedAiStatusErrorKind::DownloadFailed)
    ));
    assert!(!super::is_install_active(root.path(), spec.id));

    let retried = install_model_at_root_with_downloader(root.path(), spec.id, fake_download, None)
        .expect("retry failed install");
    assert!(matches!(retried.state, ManagedAiInstallState::Installed));
    assert!(!super::is_install_active(root.path(), spec.id));
}

#[test]
fn status_read_during_install_completion_does_not_report_interruption() {
    let root = tempfile::tempdir().expect("create temp root");
    let spec = require_model("drifty-qwen3-5-4b-default").expect("model spec");
    let active = super::ActiveInstallGuard::acquire(root.path(), spec.id)
        .unwrap_or_else(|_| panic!("acquire install ownership"));
    let installing =
        super::status_for_download_progress(spec, ManagedAiDownloadProgress::from_counts(90, 100));

    let status = super::status::normalize_status_with_artifact_lookup(
        root.path(),
        installing,
        |root, spec| {
            let observed_artifact = super::status_artifact_dir(root, spec)?;
            assert!(observed_artifact.is_none());
            // Complete the download after the reader observed no final file,
            // but before it can interpret that snapshot as an interruption.
            let artifact = fake_download(root, spec, &mut |_| Ok(()))?;
            runtime::write_runtime_completion_fixture(root)?;
            write_status(
                root,
                &status_for_spec(
                    ManagedAiInstallState::Installed,
                    spec,
                    Some(artifact),
                    "Managed local model downloaded.",
                ),
            )?;
            drop(active);
            Ok(observed_artifact)
        },
    )
    .expect("read during completion");

    assert!(matches!(status.state, ManagedAiInstallState::Installing));
    assert!(status.error_kind.is_none());
    let next = read_status(root.path()).expect("read completed install");
    assert!(matches!(next.state, ManagedAiInstallState::Installed));
}

#[test]
fn read_status_finishes_interrupted_install_when_artifact_was_promoted() {
    let root = tempfile::tempdir().expect("create temp root");
    let spec = require_model("drifty-qwen3-5-4b-default").expect("model spec");
    let artifact_dir = fake_download(root.path(), spec, &mut |_| Ok(())).expect("write artifact");
    runtime::write_runtime_completion_fixture(root.path()).expect("write runtime fixture");
    let stale_status = status_for_spec(
        ManagedAiInstallState::Installing,
        spec,
        None,
        "Downloading managed local model... (100%)",
    );
    write_status(root.path(), &stale_status).expect("write stale status");

    let status = read_status(root.path()).expect("read normalized status");

    assert!(matches!(status.state, ManagedAiInstallState::Installed));
    assert_eq!(
        status.artifact_dir.as_deref(),
        Some(artifact_dir.to_string_lossy().as_ref())
    );
    assert!(status.progress.is_none());
    assert!(status.error_kind.is_none());
    assert_eq!(status.message, "Managed local AI is ready to start.");
}

#[test]
fn read_status_does_not_call_an_interrupted_install_ready_without_runtime() {
    let root = tempfile::tempdir().expect("create temp root");
    let spec = require_model("drifty-qwen3-5-4b-default").expect("model spec");
    fake_download(root.path(), spec, &mut |_| Ok(())).expect("write artifact");
    let stale_status = status_for_spec(
        ManagedAiInstallState::Installing,
        spec,
        None,
        "Preparing managed local AI runtime...",
    );
    write_status(root.path(), &stale_status).expect("write interrupted status");

    let status = read_status(root.path()).expect("normalize interrupted runtime setup");

    assert!(matches!(status.state, ManagedAiInstallState::Error));
    assert!(matches!(
        status.error_kind,
        Some(ManagedAiStatusErrorKind::RuntimeMissing)
    ));
    assert_eq!(installed_model_ids(&status), vec![spec.id]);
    assert!(status.message.contains("runtime setup was interrupted"));
}

#[test]
fn read_status_revalidates_runtime_before_calling_an_installed_model_ready() {
    let root = tempfile::tempdir().expect("create temp root");
    let spec = require_model("drifty-qwen3-5-4b-default").expect("model spec");
    let artifact_dir = fake_download(root.path(), spec, &mut |_| Ok(())).expect("write artifact");
    let installed = status_for_spec(
        ManagedAiInstallState::Installed,
        spec,
        Some(artifact_dir),
        "Managed local AI is ready to start.",
    );
    write_status(root.path(), &installed).expect("write installed status");

    let status = read_status(root.path()).expect("revalidate runtime assets");

    assert!(matches!(status.state, ManagedAiInstallState::Error));
    assert!(matches!(
        status.error_kind,
        Some(ManagedAiStatusErrorKind::RuntimeMissing)
    ));
    assert_eq!(installed_model_ids(&status), vec![spec.id]);
    assert!(status.message.contains("runtime needs to be prepared"));
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
fn status_replace_retries_transient_sharing_errors_then_succeeds() {
    let mut calls = 0;
    let mut sleeps = Vec::new();
    let result = super::status::retry_transient_replace(
        || {
            calls += 1;
            if calls < 3 {
                Err(std::io::Error::from_raw_os_error(5))
            } else {
                Ok(())
            }
        },
        super::status::is_windows_sharing_error,
        |delay| sleeps.push(delay.as_millis()),
    );

    assert!(result.is_ok());
    assert_eq!(calls, 3);
    assert_eq!(sleeps, vec![25, 50]);
}

#[test]
fn status_replace_stops_after_bounded_transient_attempts() {
    let mut calls = 0;
    let mut total_sleep_ms = 0;
    let error = super::status::retry_transient_replace(
        || {
            calls += 1;
            Err(std::io::Error::from_raw_os_error(32))
        },
        super::status::is_windows_sharing_error,
        |delay| total_sleep_ms += delay.as_millis(),
    )
    .expect_err("persistent sharing violation surfaces");

    assert_eq!(error.raw_os_error(), Some(32));
    assert_eq!(calls, super::status::STATUS_REPLACE_MAX_ATTEMPTS);
    assert!(total_sleep_ms <= 1_000);
}

#[test]
fn status_replace_does_not_retry_other_errors() {
    let mut calls = 0;
    let error = super::status::retry_transient_replace(
        || {
            calls += 1;
            Err(std::io::Error::from_raw_os_error(28))
        },
        super::status::is_windows_sharing_error,
        |_| panic!("non-sharing errors must not wait"),
    )
    .expect_err("disk full surfaces immediately");

    assert_eq!(error.raw_os_error(), Some(28));
    assert_eq!(calls, 1);
}

#[test]
fn refused_progress_write_does_not_abort_model_download() {
    let root = tempfile::tempdir().expect("create temp root");
    let spec = require_model("drifty-qwen3-5-4b-default").expect("model spec");

    let installed = install_model_at_root_with_downloader(
        root.path(),
        spec.id,
        progress_write_refused_download,
        None,
    )
    .expect("install despite refused progress write");

    assert!(matches!(installed.state, ManagedAiInstallState::Installed));
    assert!(matches!(
        read_status(root.path()).expect("read final status").state,
        ManagedAiInstallState::Installed
    ));
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
    let temp_args_path = shell_quote(&args_path.with_extension("tmp"));
    let args_path = shell_quote(args_path);
    write_assessed_fake_runtime(
        root,
        &format!("printf '%s\\n' \"$@\" > {temp_args_path}\nmv {temp_args_path} {args_path}\nwhile true; do sleep 5; done\n"),
    )?;
    runtime::write_runtime_completion_fixture(root)?;
    Ok(())
}

const FAKE_RUNTIME_WARMUP_ENV: &str = "DRIFTY_FAKE_RUNTIME_WARMUP";

/// Writes the fake `runtime/llama-server` shell script and finishes its first
/// launch assessment before any test depends on it.
///
/// On macOS 26, syspolicyd crashes when it is still assessing a freshly written
/// script that a test has already killed and deleted with its temp dir. Every
/// assessed launch on the host then stalls at `_dyld_start` until launchd
/// respawns syspolicyd. Running the script once to completion, directly and
/// through `/bin/sh` as the app does, keeps later kills and cleanup out of
/// that assessment window.
fn write_assessed_fake_runtime(root: &Path, body: &str) -> Result<PathBuf, ManagedAiError> {
    let runtime_dir = root.join("runtime");
    std::fs::create_dir_all(&runtime_dir)?;
    let runtime_path = runtime_dir.join("llama-server");
    std::fs::write(
        &runtime_path,
        format!("#!/bin/sh\nif [ \"${FAKE_RUNTIME_WARMUP_ENV}\" = 1 ]; then exit 0; fi\n{body}"),
    )?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = std::fs::metadata(&runtime_path)?.permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&runtime_path, permissions)?;
        for mut launch in [std::process::Command::new(&runtime_path), {
            let mut shell = std::process::Command::new("/bin/sh");
            shell.arg(&runtime_path);
            shell
        }] {
            let status = launch
                .env(FAKE_RUNTIME_WARMUP_ENV, "1")
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status()?;
            assert!(status.success(), "fake runtime warm-up failed: {status}");
        }
    }
    Ok(runtime_path)
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

fn progress_write_refused_download(
    root: &Path,
    spec: ManagedAiModelSpec,
    progress: &mut dyn FnMut(ManagedAiDownloadProgress) -> Result<(), ManagedAiError>,
) -> Result<PathBuf, ManagedAiError> {
    // A non-empty directory in place of status.json makes every replace fail,
    // standing in for a file that another process refuses to release.
    let status_path = root.join("status.json");
    std::fs::remove_file(&status_path)?;
    std::fs::create_dir_all(status_path.join("held"))?;
    progress(ManagedAiDownloadProgress::from_counts(
        spec.expected_size_bytes / 2,
        spec.expected_size_bytes,
    ))?;
    std::fs::remove_dir_all(&status_path)?;

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

fn unexpected_download(
    _root: &Path,
    _spec: ManagedAiModelSpec,
    _progress: &mut dyn FnMut(ManagedAiDownloadProgress) -> Result<(), ManagedAiError>,
) -> Result<PathBuf, ManagedAiError> {
    panic!("duplicate install must not start another downloader")
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
