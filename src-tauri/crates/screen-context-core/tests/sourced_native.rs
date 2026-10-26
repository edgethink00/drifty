//! Source-aware real-child contract/lifecycle controls. No screen APIs.
use drifty_screen_context_core::{native::PreparedNativeHelperBackend, store::EvidenceStore, *};
use std::{
    collections::BTreeSet,
    path::Path,
    sync::Arc,
    time::{Duration, Instant},
};

fn service(root: &Path, mode: &str, ocr: bool, visible: bool) -> ScreenContextService {
    service_version(root, mode, ocr, visible, 2)
}
fn service_version(
    root: &Path,
    mode: &str,
    ocr: bool,
    visible: bool,
    version: u32,
) -> ScreenContextService {
    let binary = root.join(format!(
        "{}-fixture-{mode}{}",
        if version == 3 { "activity" } else { "source" },
        std::env::consts::EXE_SUFFIX
    ));
    std::fs::copy(
        env!("CARGO_BIN_EXE_screen-context-protocol-fixture"),
        &binary,
    )
    .unwrap();
    let backend = if version == 3 {
        PreparedNativeHelperBackend::from_activity_resource(&binary)
    } else {
        PreparedNativeHelperBackend::from_source_resource(&binary)
    }
    .unwrap()
    .require_document("1".repeat(64))
    .unwrap();
    let service = ScreenContextService::new(Arc::new(backend)).unwrap();
    service
        .replace_store(Some(
            EvidenceStore::open(
                &root.join("store"),
                ScopeId::from_profile("owned-source-profile").unwrap(),
                zeroize::Zeroizing::new([7; 32]),
                Retention::default(),
                unix_millis().unwrap(),
            )
            .unwrap(),
        ))
        .unwrap();
    service
        .set_policy(CapturePolicy {
            enabled: true,
            replay_enabled: !ocr && !visible,
            ocr_enabled: ocr,
            visible_text_enabled: visible,
            allowed_apps: BTreeSet::from(["owned.editor".into()]),
            ..CapturePolicy::default()
        })
        .unwrap();
    service
}
fn wait(service: &ScreenContextService) -> CaptureStatus {
    let deadline =
        Instant::now() + PREPARATION_DEADLINE + CAPTURE_DEADLINE + Duration::from_secs(1);
    loop {
        let status = service.status();
        if !status.running && !status.pending {
            return status;
        }
        assert!(
            Instant::now() < deadline,
            "source-aware helper did not settle"
        );
        std::thread::sleep(Duration::from_millis(5));
    }
}
fn reaped(root: &Path) {
    for pid in std::fs::read_to_string(root.join("pids.txt"))
        .unwrap()
        .lines()
        .map(|s| s.parse::<u32>().unwrap())
    {
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
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if !handle.is_null() {
                let mut code = 259;
                assert_ne!(GetExitCodeProcess(handle, &mut code), 0);
                CloseHandle(handle);
                assert_ne!(code, 259);
            }
        }
    }
}

#[test]
fn native_v2_preserves_source_for_each_requested_mode_without_retaining_text_only_frames() {
    for (ocr, visible, source) in [
        (false, true, TextSource::Accessibility),
        (true, false, TextSource::Ocr),
        (true, true, TextSource::Accessibility),
        (false, false, TextSource::None),
    ] {
        let temp = tempfile::tempdir().unwrap();
        let mut service = service(temp.path(), "normal", ocr, visible);
        assert!(service.request_sample());
        let status = wait(&service);
        assert_eq!(status.accepted, 1, "{:?}", status.last_failure);
        let rows = service.list_page(None, 10).unwrap().records;
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].text_source, source);
        assert_eq!(rows[0].frame_retained, source == TextSource::None);
        let metadata = service.read_metadata(rows[0].id).unwrap().unwrap();
        assert_eq!(metadata.text.source(), source);
        assert_eq!(metadata.text.is_empty(), source == TextSource::None);
        assert!(service.shutdown(Duration::from_millis(1100)));
        reaped(temp.path());
    }
}

#[test]
fn legacy_or_missing_or_unrequested_sources_never_store_evidence() {
    for mode in [
        "legacy-ready",
        "legacy-result",
        "missing-source",
        "wrong-source",
    ] {
        let temp = tempfile::tempdir().unwrap();
        let mut service = service(temp.path(), mode, false, true);
        assert!(service.request_sample());
        let status = wait(&service);
        assert_eq!(status.accepted, 0, "{mode}");
        assert_eq!(status.dropped, 1, "{mode}");
        assert!(
            service.list_page(None, 10).unwrap().records.is_empty(),
            "{mode}"
        );
        if mode == "legacy-ready" {
            assert!(!temp.path().join("admitted.txt").exists());
        }
        assert!(service.shutdown(Duration::from_millis(1100)));
        reaped(temp.path());
    }
}

#[test]
fn native_v3_title_or_explicit_no_hint_keeps_capture_unlinked_and_reuses_its_child() {
    for mode in ["normal", "no-title"] {
        let temp = tempfile::tempdir().unwrap();
        let mut service = service_version(temp.path(), mode, false, true, 3);
        for accepted in 1..=2 {
            assert!(service.request_sample());
            assert_eq!(wait(&service).accepted, accepted);
        }
        let rows = service.list_page(None, 10).unwrap().records;
        assert_eq!(rows.len(), 2);
        for row in rows {
            let metadata = service.read_metadata(row.id).unwrap().unwrap();
            assert!(metadata.tracker_record_id.is_none());
            assert_eq!(metadata.text.source(), TextSource::Accessibility);
        }
        assert_eq!(
            std::fs::read_to_string(temp.path().join("pids.txt"))
                .unwrap()
                .lines()
                .count(),
            1
        );
        assert!(service.shutdown(Duration::from_millis(1100)));
        reaped(temp.path());
    }
}

#[test]
fn native_v3_mixed_versions_or_mutated_incomplete_title_proof_never_store_evidence() {
    for mode in [
        "legacy-ready",
        "source-ready",
        "missing-pre-hint",
        "bad-pre-digest",
        "unknown-pre-hint",
        "legacy-result",
        "source-result",
        "changed-title",
        "changed-before-title",
        "bad-result-digest",
        "missing-result-hint",
        "unknown-result-hint",
        "wrong-result-version",
        "source-footer",
        "wrong-footer",
        "trailing-output",
        "early-output",
        "wrong-document",
    ] {
        let temp = tempfile::tempdir().unwrap();
        let mut service = service_version(temp.path(), mode, false, true, 3);
        assert!(service.request_sample());
        let status = wait(&service);
        assert_eq!(status.accepted, 0, "{mode}");
        assert_eq!(status.dropped, 1, "{mode}");
        assert!(
            service.list_page(None, 10).unwrap().records.is_empty(),
            "{mode}"
        );
        if [
            "legacy-ready",
            "source-ready",
            "missing-pre-hint",
            "bad-pre-digest",
            "unknown-pre-hint",
            "early-output",
            "wrong-document",
        ]
        .contains(&mode)
        {
            assert!(!temp.path().join("admitted.txt").exists(), "{mode}");
        }
        assert!(service.shutdown(Duration::from_millis(1100)));
        reaped(temp.path());
    }
}
