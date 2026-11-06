//! Real-child protocol/lifetime controls. No screen APIs or OS permissions.
use drifty_screen_context_core::{native::PreparedNativeHelperBackend, store::EvidenceStore, *};
use std::{
    collections::BTreeSet,
    path::Path,
    sync::Arc,
    time::{Duration, Instant},
};

fn service(root: &Path, mode: &str) -> ScreenContextService {
    let binary = root.join(format!(
        "warm-fixture-{mode}{}",
        std::env::consts::EXE_SUFFIX
    ));
    std::fs::copy(
        env!("CARGO_BIN_EXE_screen-context-protocol-fixture"),
        &binary,
    )
    .unwrap();
    let backend = PreparedNativeHelperBackend::from_app_resource(&binary)
        .unwrap()
        .require_document("1".repeat(64))
        .unwrap();
    let service = ScreenContextService::new(Arc::new(backend)).unwrap();
    service
        .replace_store(Some(
            EvidenceStore::open(
                &root.join("store"),
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
            allowed_apps: BTreeSet::from(["owned.editor".into()]),
            ..CapturePolicy::default()
        })
        .unwrap();
    service
}
fn wait(service: &ScreenContextService) -> CaptureStatus {
    let until = Instant::now() + PREPARATION_DEADLINE + CAPTURE_DEADLINE + Duration::from_secs(1);
    loop {
        let status = service.status();
        if !status.running && !status.pending {
            return status;
        }
        assert!(Instant::now() < until, "prepared operation did not settle");
        std::thread::sleep(Duration::from_millis(5));
    }
}
fn pids(root: &Path) -> Vec<u32> {
    std::fs::read_to_string(root.join("pids.txt"))
        .unwrap()
        .lines()
        .map(|s| s.parse().unwrap())
        .collect()
}
fn assert_reaped(pid: u32) {
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
            assert_ne!(code, 259, "owned helper is still running");
        }
    }
}

fn not_running(pid: u32) -> bool {
    #[cfg(unix)]
    {
        (unsafe { libc::kill(pid as i32, 0) }) == -1
            && std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH)
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
        if handle.is_null() {
            return true;
        }
        let mut code = 259;
        let ok = GetExitCodeProcess(handle, &mut code);
        CloseHandle(handle);
        ok != 0 && code != 259
    }
}

#[test]
fn reuses_one_child_with_fresh_requests_and_replaces_it_after_eight_jobs() {
    let temp = tempfile::tempdir().unwrap();
    let mut service = service(temp.path(), "normal");
    for accepted in 1..=9 {
        assert!(service.request_sample());
        let status = wait(&service);
        assert_eq!(status.accepted, accepted, "{:?}", status.last_failure);
    }
    let pids = pids(temp.path());
    assert_eq!(pids.len(), 2);
    let rows = std::fs::read_to_string(temp.path().join("admitted.txt")).unwrap();
    let rows: Vec<_> = rows
        .lines()
        .map(|l| l.split_whitespace().collect::<Vec<_>>())
        .collect();
    assert_eq!(rows.len(), 9);
    assert!(rows[..8].iter().all(|r| r[0] == pids[0].to_string()));
    assert_eq!(rows[8][0], pids[1].to_string());
    assert_eq!(rows.iter().map(|r| r[1]).collect::<BTreeSet<_>>().len(), 9);
    assert_eq!(service.list_page(None, 20).unwrap().records.len(), 9);
    assert!(service.shutdown(Duration::from_millis(1100)));
    for pid in pids {
        assert_reaped(pid);
    }
}

fn wait_for_replacement(service: &ScreenContextService, root: &Path, preparing: bool) {
    let until = Instant::now() + PREPARATION_DEADLINE + Duration::from_secs(1);
    loop {
        let status = service.status();
        if status.accepted == 8
            && pids(root).len() == 2
            && status.preparing == preparing
            && status.running == preparing
        {
            return;
        }
        assert!(
            Instant::now() < until,
            "idle helper replacement did not settle"
        );
        std::thread::sleep(Duration::from_millis(5));
    }
}

fn complete_seven_jobs(service: &ScreenContextService) {
    for accepted in 1..=7 {
        assert!(service.request_sample());
        assert_eq!(wait(service).accepted, accepted);
    }
}

#[test]
fn eighth_job_prepares_one_empty_child_without_admitting_a_ninth_request() {
    let temp = tempfile::tempdir().unwrap();
    let mut service = service(temp.path(), "normal");
    complete_seven_jobs(&service);
    assert!(service.request_sample());
    wait_for_replacement(&service, temp.path(), false);
    let owned = pids(temp.path());
    assert_reaped(owned[0]);
    assert_eq!(
        std::fs::read_to_string(temp.path().join("admitted.txt"))
            .unwrap()
            .lines()
            .count(),
        8,
        "empty preparation must not send JOB or GO"
    );
    assert_eq!(service.list_page(None, 20).unwrap().records.len(), 8);
    assert_eq!(service.status().dropped, 0);
    assert!(service.shutdown(Duration::from_millis(1100)));
    for pid in owned {
        assert_reaped(pid);
    }
}

#[test]
fn lifecycle_changes_cancel_idle_preparation_without_another_capture() {
    for action in ["off", "purge", "store-detach", "shutdown", "input-idle"] {
        let temp = tempfile::tempdir().unwrap();
        let mut service = service(temp.path(), "hung-recycle");
        complete_seven_jobs(&service);
        assert!(service.request_sample());
        wait_for_replacement(&service, temp.path(), true);
        let owned = pids(temp.path());
        assert_reaped(owned[0]);
        match action {
            "off" => service.set_policy(CapturePolicy::default()).unwrap(),
            "input-idle" => service.set_capture_suspended(true).unwrap(),
            "purge" => {
                service.purge().unwrap();
            }
            "store-detach" => service.replace_store(None).unwrap(),
            "shutdown" => assert!(service.shutdown(Duration::from_millis(1100))),
            _ => unreachable!(),
        }
        let status = wait(&service);
        assert_eq!(
            status.accepted,
            if action == "store-detach" { 0 } else { 8 },
            "{action}"
        );
        assert_eq!(status.dropped, 0, "idle preparation is not a capture");
        assert!(!service.request_sample(), "{action}");
        assert_eq!(
            pids(temp.path()).len(),
            2,
            "no automatic retry after {action}"
        );
        assert_eq!(
            std::fs::read_to_string(temp.path().join("admitted.txt"))
                .unwrap()
                .lines()
                .count(),
            8,
            "{action} allowed a ninth GO"
        );
        if action == "off" || action == "input-idle" {
            assert_eq!(service.list_page(None, 20).unwrap().records.len(), 8);
        } else if action == "purge" {
            assert!(service.list_page(None, 20).unwrap().records.is_empty());
        }
        assert!(service.shutdown(Duration::from_millis(1100)));
        for pid in owned {
            assert_reaped(pid);
        }
    }
}

#[test]
fn failed_idle_preparation_waits_for_a_requested_job_before_trying_again() {
    let temp = tempfile::tempdir().unwrap();
    let mut service = service(temp.path(), "failed-recycle");
    complete_seven_jobs(&service);
    assert!(service.request_sample());
    wait_for_replacement(&service, temp.path(), false);
    assert_reaped(pids(temp.path())[1]);
    assert_eq!(service.status().dropped, 0);
    assert_eq!(service.status().last_failure, None);
    assert_eq!(
        std::fs::read_to_string(temp.path().join("admitted.txt"))
            .unwrap()
            .lines()
            .count(),
        8
    );
    assert!(service.request_sample());
    assert_eq!(wait(&service).accepted, 9);
    let owned = pids(temp.path());
    assert_eq!(owned.len(), 3);
    assert!(service.shutdown(Duration::from_millis(1100)));
    for pid in owned {
        assert_reaped(pid);
    }
}

#[test]
fn rejects_pre_go_and_malformed_completion_without_any_stored_evidence() {
    for mode in [
        "wrong-document",
        "early-output",
        "wrong-footer",
        "trailing-output",
        "hung-job",
    ] {
        let temp = tempfile::tempdir().unwrap();
        let mut service = service(temp.path(), mode);
        assert!(service.request_sample());
        let status = wait(&service);
        assert_eq!(status.accepted, 0, "{mode}");
        assert_eq!(status.dropped, 1, "{mode}");
        assert!(
            service.list_page(None, 10).unwrap().records.is_empty(),
            "{mode}"
        );
        if ["wrong-document", "early-output"].contains(&mode) {
            assert!(
                !temp.path().join("admitted.txt").exists(),
                "{mode} received GO"
            );
        }
        assert!(service.shutdown(Duration::from_millis(1100)));
        for pid in pids(temp.path()) {
            assert_reaped(pid);
        }
    }
}

#[test]
fn off_cancels_preparation_and_does_not_collect_a_frame() {
    let temp = tempfile::tempdir().unwrap();
    let mut service = service(temp.path(), "hung-ready");
    assert!(service.request_sample());
    let until = Instant::now() + Duration::from_secs(2);
    while !temp.path().join("pids.txt").exists() {
        assert!(Instant::now() < until);
        std::thread::sleep(Duration::from_millis(5));
    }
    assert!(service.status().preparing);
    service.set_policy(CapturePolicy::default()).unwrap();
    let status = wait(&service);
    assert_eq!(status.accepted, 0);
    assert!(!temp.path().join("admitted.txt").exists());
    assert!(service.shutdown(Duration::from_millis(1100)));
    for pid in pids(temp.path()) {
        assert_reaped(pid);
    }
}

#[test]
fn purge_destroys_an_idle_prepared_child_and_keeps_capture_paused() {
    let temp = tempfile::tempdir().unwrap();
    let mut service = service(temp.path(), "normal");
    assert!(service.request_sample());
    assert_eq!(wait(&service).accepted, 1);
    service.purge().unwrap();
    assert!(!service.request_sample());
    let owned = pids(temp.path());
    let until = Instant::now() + Duration::from_secs(1);
    while !owned.iter().all(|pid| not_running(*pid)) {
        assert!(Instant::now() < until, "purge retained an idle helper");
        std::thread::sleep(Duration::from_millis(5));
    }
    assert!(service.shutdown(Duration::from_millis(1100)));
    for pid in pids(temp.path()) {
        assert_reaped(pid);
    }
    assert!(service.list_page(None, 10).is_err());
}

#[test]
fn account_replacement_reaps_the_old_child_before_a_new_profile_collects() {
    let temp = tempfile::tempdir().unwrap();
    let mut service = service(temp.path(), "normal");
    assert!(service.request_sample());
    assert_eq!(wait(&service).accepted, 1);
    let previous = service.list_page(None, 10).unwrap().records[0].id;
    let old_pid = pids(temp.path())[0];
    service.replace_store(None).unwrap();
    assert!(!service.request_sample());
    let until = Instant::now() + Duration::from_secs(1);
    while !not_running(old_pid) {
        assert!(
            Instant::now() < until,
            "account replacement retained a helper"
        );
        std::thread::sleep(Duration::from_millis(5));
    }
    service
        .replace_store(Some(
            EvidenceStore::open(
                &temp.path().join("store"),
                ScopeId::from_profile("second-owned-profile").unwrap(),
                zeroize::Zeroizing::new([8; 32]),
                Retention::default(),
                unix_millis().unwrap(),
            )
            .unwrap(),
        ))
        .unwrap();
    assert!(!service.request_sample()); // A new account starts OFF.
    assert!(service.read_metadata(previous).unwrap().is_none());
    service
        .set_policy(CapturePolicy {
            enabled: true,
            replay_enabled: true,
            ocr_enabled: true,
            allowed_apps: BTreeSet::from(["owned.editor".into()]),
            ..CapturePolicy::default()
        })
        .unwrap();
    assert!(service.request_sample());
    assert_eq!(wait(&service).accepted, 1);
    assert_eq!(service.list_page(None, 10).unwrap().records.len(), 1);
    assert_eq!(pids(temp.path()).len(), 2);
    assert!(service.shutdown(Duration::from_millis(1100)));
    for pid in pids(temp.path()) {
        assert_reaped(pid);
    }
}

#[test]
fn a_visible_text_request_does_not_launch_a_legacy_ocr_only_worker() {
    let temp = tempfile::tempdir().unwrap();
    let mut service = service(temp.path(), "normal");
    service
        .set_policy(CapturePolicy {
            enabled: true,
            replay_enabled: true,
            visible_text_enabled: true,
            allowed_apps: BTreeSet::from(["owned.editor".into()]),
            ..CapturePolicy::default()
        })
        .unwrap();
    assert!(service.request_sample());
    let status = wait(&service);
    assert_eq!(status.accepted, 0);
    assert_eq!(status.last_failure, Some(CaptureFailure::Unsupported));
    assert!(!temp.path().join("pids.txt").exists());
    assert!(service.list_page(None, 10).unwrap().records.is_empty());
    service
        .set_policy(CapturePolicy {
            enabled: true,
            ocr_enabled: true,
            allowed_apps: BTreeSet::from(["owned.editor".into()]),
            ..CapturePolicy::default()
        })
        .unwrap();
    assert!(service.request_sample());
    assert_eq!(wait(&service).accepted, 1);
    assert_eq!(
        service.list_page(None, 10).unwrap().records[0].text_source,
        TextSource::Ocr
    );
    assert!(service.shutdown(Duration::from_millis(1100)));
    for pid in pids(temp.path()) {
        assert_reaped(pid);
    }
}

#[test]
fn input_idle_reaps_prepared_helper_and_resume_requires_a_fresh_job() {
    let temp = tempfile::tempdir().unwrap();
    let mut service = service(temp.path(), "normal");
    assert!(service.request_sample());
    assert_eq!(wait(&service).accepted, 1);
    let reply = service.observation_lease().reply("owned saved text").unwrap();
    let first = pids(temp.path())[0];
    service.set_capture_suspended(true).unwrap();
    let deadline = Instant::now() + Duration::from_secs(2);
    while !not_running(first) {
        assert!(Instant::now() < deadline, "idle retained its capture helper");
        std::thread::sleep(Duration::from_millis(2));
    }
    assert_reaped(first);
    assert!(!service.request_sample());
    assert_eq!(service.list_page(None, 20).unwrap().records.len(), 1);
    assert!(serde_json::to_value(&reply).is_ok());
    service.set_capture_suspended(false).unwrap();
    assert!(!service.status().pending);
    assert!(serde_json::to_value(&reply).is_ok());
    assert!(service.request_sample());
    assert_eq!(wait(&service).accepted, 2);
    assert_eq!(pids(temp.path()).len(), 2);
    assert!(service.shutdown(Duration::from_millis(1100)));
    for pid in pids(temp.path()) {
        assert_reaped(pid);
    }
}

#[test]
fn input_idle_cancels_active_and_queued_capture_across_immediate_resume() {
    let temp = tempfile::tempdir().unwrap();
    let mut service = service(temp.path(), "hung-job");
    let reply = service.observation_lease().reply("owned saved text").unwrap();
    assert!(service.request_sample());
    let deadline = Instant::now() + Duration::from_secs(3);
    while !temp.path().join("admitted.txt").exists() {
        assert!(Instant::now() < deadline, "capture did not reach GO");
        std::thread::sleep(Duration::from_millis(2));
    }
    assert!(service.request_sample());
    assert!(service.status().pending);
    service.set_capture_suspended(true).unwrap();
    service.set_capture_suspended(false).unwrap();
    let status = wait(&service);
    assert_eq!(status.accepted, 0, "late capture survived idle ABA");
    assert_eq!(status.dropped, 1);
    assert!(!status.pending);
    assert!(service.list_page(None, 20).unwrap().records.is_empty());
    assert!(serde_json::to_value(&reply).is_ok());
    assert_eq!(pids(temp.path()).len(), 1, "queued capture started after resume");
    assert!(service.shutdown(Duration::from_millis(1100)));
    assert_reaped(pids(temp.path())[0]);
}
