#![cfg(target_os = "macos")]
use drifty_screen_context_core::{native::NativeSceneHelperBackend, store::EvidenceStore, *};
use std::{
    collections::BTreeSet,
    path::Path,
    sync::Arc,
    time::{Duration, Instant},
};

fn service(root: &Path, mode: &str) -> (ScreenContextService, CapturePolicy) {
    let binary = root.join(mode);
    std::fs::copy(
        env!("CARGO_BIN_EXE_screen-context-protocol-fixture"),
        &binary,
    )
    .unwrap();
    let backend = NativeSceneHelperBackend::from_app_resource(&binary)
        .unwrap()
        .with_deferred_ocr()
        .with_scene_worker();
    let service = ScreenContextService::new(Arc::new(backend)).unwrap();
    service
        .replace_store(Some(
            EvidenceStore::open(
                &root.join("store"),
                ScopeId::from_profile("owned-scene-test").unwrap(),
                zeroize::Zeroizing::new([7; 32]),
                Retention::default(),
                unix_millis().unwrap(),
            )
            .unwrap(),
        ))
        .unwrap();
    let policy = CapturePolicy {
        scope: CaptureScope::ActiveDisplayScene,
        enabled: true,
        replay_enabled: true,
        ocr_enabled: mode.starts_with("ocr-"),
        ..CapturePolicy::default()
    };
    service.set_policy(policy.clone()).unwrap();
    (service, policy)
}

fn sample(service: &ScreenContextService) -> CaptureStatus {
    assert!(service.request_sample());
    let until = Instant::now() + Duration::from_secs(3);
    loop {
        let status = service.status();
        if !status.running && !status.pending {
            return status;
        }
        assert!(Instant::now() < until, "scene capture did not settle");
        std::thread::sleep(Duration::from_millis(5));
    }
}

fn pids(root: &Path) -> Vec<i32> {
    std::fs::read_to_string(root.join("scene-pids.txt"))
        .unwrap()
        .lines()
        .map(|pid| pid.parse().unwrap())
        .collect()
}

fn assert_reaped(pid: i32) {
    assert_eq!(
        unsafe { libc::waitpid(pid, std::ptr::null_mut(), libc::WNOHANG) },
        -1
    );
    assert_eq!(
        std::io::Error::last_os_error().raw_os_error(),
        Some(libc::ECHILD)
    );
}

#[test]
fn reuses_child_for_eight_admissions_and_discards_it_on_pause() {
    let temp = tempfile::tempdir().unwrap();
    let (mut service, policy) = service(temp.path(), "scene-normal");
    for accepted in 1..=9 {
        let status = sample(&service);
        assert_eq!(status.accepted, accepted, "{:?}", status.last_failure);
    }
    let children = pids(temp.path());
    assert_eq!(children.len(), 2);
    assert_reaped(children[0]);
    let log = std::fs::read_to_string(temp.path().join("scene-admitted.txt")).unwrap();
    let rows: Vec<_> = log
        .lines()
        .map(|line| line.split_once(' ').unwrap())
        .collect();
    assert_eq!(rows.len(), 9);
    assert!(rows[..8].iter().all(|row| row.0 == children[0].to_string()));
    assert_eq!(rows[8].0, children[1].to_string());
    assert_eq!(
        rows.iter().map(|row| row.1).collect::<BTreeSet<_>>().len(),
        9
    );
    assert_eq!(service.list_page(None, 20).unwrap().records.len(), 9);

    service
        .set_policy(CapturePolicy {
            paused: true,
            ..policy
        })
        .unwrap();
    assert!(!service.request_sample());
    let until = Instant::now() + Duration::from_secs(2);
    while unsafe { libc::kill(children[1], 0) } == 0 {
        assert!(Instant::now() < until, "paused scene helper still running");
        std::thread::sleep(Duration::from_millis(5));
    }
    assert_reaped(children[1]);
    service.resume_capture().unwrap();
    assert_eq!(sample(&service).accepted, 10);
    let children = pids(temp.path());
    assert_eq!(children.len(), 3);
    assert!(service.shutdown(Duration::from_millis(1100)));
    assert_reaped(children[2]);
}

#[test]
fn private_preflight_never_releases_pixels() {
    let temp = tempfile::tempdir().unwrap();
    let (service, _) = service(temp.path(), "scene-private");
    let status = sample(&service);
    assert_eq!(status.accepted, 0);
    assert_eq!(status.last_failure, Some(CaptureFailure::Excluded));
    assert!(!temp.path().join("scene-admitted.txt").exists());
    assert_reaped(pids(temp.path())[0]);
}

#[test]
fn a_screenshot_past_the_deadline_finishes_before_its_helper_is_reaped() {
    let temp = tempfile::tempdir().unwrap();
    let (service, _) = service(temp.path(), "scene-slow");
    let status = sample(&service);
    assert_eq!(status.accepted, 0);
    assert_eq!(status.last_failure, Some(CaptureFailure::Deadline));
    let pid = pids(temp.path())[0];
    assert_eq!(
        std::fs::read_to_string(temp.path().join("scene-screenshot-finished.txt")).unwrap(),
        format!("{pid} true"),
        "the helper was killed during its screenshot, or before stdin closed"
    );
    assert_reaped(pid);
    assert!(service.list_page(None, 20).unwrap().records.is_empty());
}

#[test]
fn reusing_recognized_text_discards_ocr_worker_without_restarting_capture() {
    let temp = tempfile::tempdir().unwrap();
    let output = std::fs::File::create(temp.path().join("scene-frame.png")).unwrap();
    let mut encoder = png::Encoder::new(output, 512, 512);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    encoder
        .write_header()
        .unwrap()
        .write_image_data(&vec![190; 512 * 512 * 4])
        .unwrap();
    let (service, _) = service(temp.path(), "ocr-valid");
    for accepted in 1..=3 {
        assert_eq!(sample(&service).accepted, accepted);
        let deadline = Instant::now() + Duration::from_secs(3);
        while !service
            .list_page(None, 10)
            .unwrap()
            .records
            .iter()
            .all(|item| item.text_state == TextState::Recognized)
        {
            assert!(Instant::now() < deadline, "fixture OCR did not settle");
            std::thread::sleep(Duration::from_millis(5));
        }
    }
    let ocr_pid: i32 = std::fs::read_to_string(temp.path().join("ocr.pid"))
        .unwrap()
        .parse()
        .unwrap();
    assert_reaped(ocr_pid);
    assert_eq!(pids(temp.path()).len(), 1);
}

#[test]
fn a_refusal_or_stale_completion_cannot_reuse_the_last_admission() {
    for (mode, failure, grants) in [
        ("scene-permission-second", CaptureFailure::Permission, 1),
        ("scene-stale-end", CaptureFailure::Invalidated, 2),
    ] {
        let temp = tempfile::tempdir().unwrap();
        let (service, _) = service(temp.path(), mode);
        assert_eq!(sample(&service).accepted, 1);
        let status = sample(&service);
        assert_eq!(status.last_failure, Some(failure));
        assert_eq!(status.accepted, 1);
        assert_eq!(service.list_page(None, 20).unwrap().records.len(), 1);
        assert_eq!(
            std::fs::read_to_string(temp.path().join("scene-admitted.txt"))
                .unwrap()
                .lines()
                .count(),
            grants,
        );
        assert_reaped(pids(temp.path())[0]);
        assert_eq!(sample(&service).accepted, 2);
        assert_eq!(pids(temp.path()).len(), 2);
    }
}
