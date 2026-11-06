use drifty_screen_context_core::process::admitted_output;
use std::{
    io,
    process::Command,
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

fn fixture(mode: &str, root: &std::path::Path) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_screen-context-protocol-fixture"));
    command.arg(mode).arg(root);
    command
}

#[cfg(target_os = "macos")]
#[test]
fn helper_does_not_inherit_ambient_descriptors_and_spawn_errors_remain_errors() {
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
    let (reader, _writer) = std::io::pipe().unwrap();
    // F_DUPFD deliberately models the interval between pipe() and CLOEXEC on
    // macOS. Keep a high descriptor open without depending on scheduling luck.
    let fd = unsafe { libc::fcntl(reader.as_raw_fd(), libc::F_DUPFD, 200) };
    assert!(fd >= 200);
    let ambient = unsafe { OwnedFd::from_raw_fd(fd) };
    assert_eq!(
        unsafe { libc::fcntl(fd, libc::F_GETFD) } & libc::FD_CLOEXEC,
        0
    );
    let mut child = Command::new(env!("CARGO_BIN_EXE_screen-context-protocol-fixture"));
    child.arg("reject-ambient-fd").arg(fd.to_string());
    let result =
        drifty_screen_context_core::process::output(&mut child, Duration::from_secs(5)).unwrap();
    assert!(
        result.status.success(),
        "helper inherited an unrelated descriptor"
    );
    // The parent's descriptor stays open. Only the child's exec closes it.
    assert_ne!(
        unsafe { libc::fcntl(ambient.as_raw_fd(), libc::F_GETFD) },
        -1
    );
    let error = drifty_screen_context_core::process::output(
        &mut Command::new("/drifty-intentionally-missing-helper"),
        Duration::from_secs(5),
    )
    .unwrap_err();
    assert_eq!(error.kind(), io::ErrorKind::NotFound);
}

#[test]
fn rejected_preflight_cannot_receive_the_pixel_capture_go_byte() {
    let temp = tempfile::tempdir().unwrap();
    let error = admitted_output(
        &mut fixture("normal", temp.path()),
        Duration::from_secs(5),
        4096,
        4096,
        &|| false,
        &mut |bytes| {
            assert_eq!(bytes, b"owned-preflight");
            Err(io::ErrorKind::PermissionDenied.into())
        },
    )
    .unwrap_err();
    assert_eq!(error.kind(), io::ErrorKind::PermissionDenied);
    assert!(!temp.path().join("admitted.marker").exists());
}

#[test]
fn accepted_preflight_releases_exactly_one_go_byte() {
    let temp = tempfile::tempdir().unwrap();
    let result = admitted_output(
        &mut fixture("normal", temp.path()),
        Duration::from_secs(5),
        4096,
        4096,
        &|| false,
        &mut |bytes| {
            assert_eq!(bytes, b"owned-preflight");
            Ok(())
        },
    )
    .unwrap();
    assert!(result.status.success());
    assert!(result.stdout.ends_with(b"owned-result"));
    assert!(temp.path().join("admitted.marker").exists());
}

#[test]
fn cancellation_during_preflight_is_rechecked_before_go() {
    let temp = tempfile::tempdir().unwrap();
    let cancelled = AtomicBool::new(false);
    let error = admitted_output(
        &mut fixture("normal", temp.path()),
        Duration::from_secs(5),
        4096,
        4096,
        &|| cancelled.load(Ordering::Acquire),
        &mut |_| {
            cancelled.store(true, Ordering::Release);
            Ok(())
        },
    )
    .unwrap_err();
    assert_eq!(error.kind(), io::ErrorKind::Interrupted);
    assert!(!temp.path().join("admitted.marker").exists());
}

#[test]
fn oversized_or_premature_native_output_fails_without_admission() {
    for mode in ["oversize", "early-output"] {
        let temp = tempfile::tempdir().unwrap();
        let mut called = false;
        let error = admitted_output(
            &mut fixture(mode, temp.path()),
            Duration::from_secs(5),
            4096,
            4096,
            &|| false,
            &mut |_| {
                called = true;
                Ok(())
            },
        )
        .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidData);
        assert!(!called);
        assert!(!temp.path().join("admitted.marker").exists());
    }
}

#[test]
fn a_hung_admitted_child_is_killed_and_never_returns_a_partial_result() {
    let temp = tempfile::tempdir().unwrap();
    let error = admitted_output(
        &mut fixture("hung", temp.path()),
        Duration::from_secs(5),
        4096,
        4096,
        &|| false,
        &mut |_| Ok(()),
    )
    .unwrap_err();
    assert_eq!(error.kind(), io::ErrorKind::TimedOut);
    assert!(temp.path().join("admitted.marker").exists());
    let pid: u32 = std::fs::read_to_string(temp.path().join("child.pid"))
        .unwrap()
        .parse()
        .unwrap();
    #[cfg(unix)]
    {
        assert_eq!(
            unsafe { libc::waitpid(pid as i32, std::ptr::null_mut(), libc::WNOHANG) },
            -1
        );
        assert_eq!(
            io::Error::last_os_error().raw_os_error(),
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
            let ok = GetExitCodeProcess(handle, &mut code);
            CloseHandle(handle);
            assert_ne!(ok, 0);
            assert_ne!(code, 259, "owned native helper is still running");
        }
    }
}

#[test]
fn typed_adapter_binds_real_child_output_to_one_encrypted_local_record() {
    use drifty_screen_context_core::{native::NativeHelperBackend, store::EvidenceStore, *};
    let temp = tempfile::tempdir().unwrap();
    let backend = NativeHelperBackend::from_app_resource(std::path::Path::new(env!(
        "CARGO_BIN_EXE_screen-context-protocol-fixture"
    )))
    .unwrap()
    .require_document("1".repeat(64))
    .unwrap();
    let service = ScreenContextService::new(std::sync::Arc::new(backend)).unwrap();
    service
        .replace_store(Some(
            EvidenceStore::open(
                &temp.path().join("screen-context"),
                ScopeId::from_profile("owned-profile").unwrap(),
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
            replay_enabled: true,
            ocr_enabled: true,
            allowed_apps: std::collections::BTreeSet::from(["owned.editor".into()]),
            ..CapturePolicy::default()
        })
        .unwrap();
    assert!(service.request_sample());
    let deadline = std::time::Instant::now() + Duration::from_secs(3);
    loop {
        let status = service.status();
        if !status.running && !status.pending {
            assert_eq!(status.accepted, 1, "{:?}", status.last_failure);
            break;
        }
        assert!(std::time::Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(5));
    }
    let page = service.list_page(None, 10).unwrap();
    assert_eq!(page.records.len(), 1);
    let id = page.records[0].id;
    assert_eq!(
        service.read_metadata(id).unwrap().unwrap().text.as_str(),
        "한글 owned fixture"
    );
    assert_eq!(service.read_frame(id).unwrap().unwrap().width(), 2);
    assert_eq!(service.purge().unwrap().removed, vec![id]);
    assert!(service.read_frame(id).unwrap().is_none());
}

#[test]
fn wrong_document_is_rejected_before_releasing_a_real_child() {
    use drifty_screen_context_core::{native::NativeHelperBackend, store::EvidenceStore, *};
    let temp = tempfile::tempdir().unwrap();
    let backend = NativeHelperBackend::from_app_resource(std::path::Path::new(env!(
        "CARGO_BIN_EXE_screen-context-protocol-fixture"
    )))
    .unwrap()
    .require_document("0".repeat(64))
    .unwrap();
    let service = ScreenContextService::new(std::sync::Arc::new(backend)).unwrap();
    service
        .replace_store(Some(
            EvidenceStore::open(
                &temp.path().join("screen-context"),
                ScopeId::from_profile("owned-profile").unwrap(),
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
            replay_enabled: true,
            ocr_enabled: true,
            allowed_apps: std::collections::BTreeSet::from(["owned.editor".into()]),
            ..CapturePolicy::default()
        })
        .unwrap();
    assert!(service.request_sample());
    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    loop {
        let status = service.status();
        if !status.running && !status.pending {
            assert_eq!(status.accepted, 0);
            assert_eq!(status.dropped, 1);
            assert_eq!(status.last_failure, Some(CaptureFailure::Excluded));
            break;
        }
        assert!(std::time::Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(5));
    }
    assert!(service.list_page(None, 10).unwrap().records.is_empty());
}

#[test]
fn scene_child_unknown_privacy_can_store_but_confirmed_private_gets_no_go_and_changed_epoch_gets_no_record(
) {
    use drifty_screen_context_core::{native::NativeSceneHelperBackend, store::EvidenceStore, *};
    for mode in ["unknown", "private", "changed"] {
        let temp = tempfile::tempdir().unwrap();
        let path = temp
            .path()
            .join(format!("scene-{mode}{}", std::env::consts::EXE_SUFFIX));
        std::fs::copy(env!("CARGO_BIN_EXE_screen-context-protocol-fixture"), &path).unwrap();
        let backend = NativeSceneHelperBackend::from_app_resource(&path).unwrap();
        let mut service = ScreenContextService::new(std::sync::Arc::new(backend)).unwrap();
        service
            .replace_store(Some(
                EvidenceStore::open(
                    &temp.path().join("store"),
                    ScopeId::from_profile("scene-qa").unwrap(),
                    zeroize::Zeroizing::new([7; 32]),
                    Retention::default(),
                    unix_millis().unwrap(),
                )
                .unwrap(),
            ))
            .unwrap();
        service
            .set_policy(CapturePolicy {
                scope: CaptureScope::ActiveDisplayScene,
                enabled: true,
                replay_enabled: true,
                ..Default::default()
            })
            .unwrap();
        assert!(service.request_sample());
        let deadline = std::time::Instant::now() + Duration::from_secs(3);
        while {
            let s = service.status();
            s.running || s.pending
        } {
            assert!(std::time::Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(5));
        }
        let status = service.status();
        assert_eq!(
            status.accepted,
            u64::from(mode == "unknown"),
            "{mode}: {:?}",
            status.last_failure
        );
        assert_eq!(
            temp.path().join("scene-admitted.marker").exists(),
            mode != "private"
        );
        let page = service.list_page(None, 10).unwrap();
        assert_eq!(page.records.len(), usize::from(mode == "unknown"));
        if mode == "unknown" {
            let id = page.records[0].id;
            assert!(service
                .read_metadata(id)
                .unwrap()
                .unwrap()
                .surface
                .is_scene());
            assert_eq!(service.read_frame(id).unwrap().unwrap().width(), 2);
            service.purge().unwrap();
            assert!(service.read_frame(id).unwrap().is_none());
        } else {
            assert_eq!(status.dropped, 1);
        }
        service.shutdown(Duration::from_millis(1100));
    }
}
