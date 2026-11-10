#![cfg(target_os = "macos")]
use drifty_screen_context_core::{native::NativeSceneHelperBackend, store::EvidenceStore, *};
use std::{
    sync::Arc,
    time::{Duration, Instant},
};
fn wait(context: &str, f: impl Fn() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(4);
    while !f() {
        assert!(Instant::now() < deadline, "{context}");
        std::thread::sleep(Duration::from_millis(5));
    }
}
#[test]
fn same_image_ocr_roundtrip_rejects_foreign_or_incomplete_child_results_and_bounds_blocked_pipes() {
    // Prepare the large synthetic image before starting the real capture deadline.
    // The child still transports and validates >1 MiB, including blocked-pipe cases.
    let images: Vec<Vec<u8>> = (0..5)
        .map(|ordinal| {
            let mut png = Vec::new();
            let mut encoder = png::Encoder::new(&mut png, 512, 512);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut seed = 123456789u32 + ordinal;
            let pixels: Vec<_> = (0..512 * 512 * 4)
                .map(|_| {
                    seed ^= seed << 13;
                    seed ^= seed >> 17;
                    seed ^= seed << 5;
                    seed as u8
                })
                .collect();
            encoder
                .write_header()
                .unwrap()
                .write_image_data(&pixels)
                .unwrap();
            assert!(png.len() > 1024 * 1024);
            png
        })
        .collect();
    for mode in [
        "valid",
        "stale-second",
        "stale-fourth",
        "nonzero-fourth",
        "wrong-hash",
        "wrong-region",
        "wrong-request",
        "wrong-source",
        "unknown-field",
        "trailing",
        "nonzero",
        "blocked-input",
        "hung-result",
    ] {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(temp.path().join("scene-frame.png"), &images[0]).unwrap();
        let path = temp.path().join(format!("ocr-{mode}"));
        std::fs::copy(env!("CARGO_BIN_EXE_screen-context-protocol-fixture"), &path).unwrap();
        let backend = NativeSceneHelperBackend::from_app_resource(&path)
            .unwrap()
            .with_deferred_ocr();
        let mut service = ScreenContextService::new(Arc::new(backend)).unwrap();
        // Every changed image must reach the worker in these protocol cases.
        service.set_same_surface_ocr_interval(Duration::ZERO);
        service
            .replace_store(Some(
                EvidenceStore::open(
                    &temp.path().join("store"),
                    ScopeId::from_profile("scene-ocr-qa").unwrap(),
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
                ocr_enabled: true,
                ..Default::default()
            })
            .unwrap();
        assert!(service.request_sample());
        wait(&format!("{mode}: capture acceptance"), || {
            let status = service.status();
            assert!(
                status.last_failure.is_none(),
                "{mode}: capture failed: {status:?}"
            );
            status.accepted == 1
        });
        let id = service.list_page(None, 2).unwrap().records[0].id;
        assert!(service.read_frame(id).unwrap().unwrap().bytes().len() > 1024 * 1024);
        if matches!(
            mode,
            "valid" | "stale-second" | "stale-fourth" | "nonzero-fourth"
        ) {
            wait(&format!("{mode}: OCR recognition"), || {
                service.read_metadata(id).unwrap().unwrap().text.state() == TextState::Recognized
            });
            assert_eq!(
                service.read_metadata(id).unwrap().unwrap().text.as_str(),
                "same exact image"
            );
            let pid = std::fs::read_to_string(temp.path().join("ocr.pid")).unwrap();
            if mode != "valid" {
                let failure_at = if mode == "stale-second" { 2 } else { 4 };
                for count in 2..failure_at {
                    std::fs::write(temp.path().join("scene-frame.png"), &images[count - 1])
                        .unwrap();
                    assert!(service.request_sample());
                    wait("valid earlier image in retained worker", || {
                        let records = service.list_page(None, 20).unwrap().records;
                        records.len() == count
                            && records.iter().all(|r| {
                                service.read_metadata(r.id).unwrap().unwrap().text.state()
                                    == TextState::Recognized
                            })
                    });
                    assert_eq!(
                        pid,
                        std::fs::read_to_string(temp.path().join("ocr.pid")).unwrap()
                    );
                }
                // Different pixels require a new OCR exchange. Identical
                // pixels are covered by the scheduler's reuse tests instead.
                std::fs::write(temp.path().join("scene-frame.png"), &images[failure_at - 1])
                    .unwrap();
                assert!(service.request_sample());
                let numeric: i32 = pid.parse().unwrap();
                wait(
                    "invalid response or final exit kills reused child",
                    || unsafe { libc::kill(numeric, 0) } == -1,
                );
                let records = service.list_page(None, 10).unwrap().records;
                assert_eq!(records.len(), failure_at);
                let failed = records
                    .iter()
                    .find(|r| r.text_state != TextState::Recognized)
                    .unwrap();
                // A successful next job on this same serial worker is a
                // completion barrier: the rejected response cannot commit later.
                std::fs::write(temp.path().join("scene-frame.png"), &images[0]).unwrap();
                assert!(service.request_sample());
                wait("new worker recovers after rejected response", || {
                    let next = service.list_page(None, 20).unwrap().records;
                    next.len() == failure_at + 1
                        && next.iter().any(|r| {
                            !records.iter().any(|old| old.id == r.id)
                                && service.read_metadata(r.id).unwrap().unwrap().text.state()
                                    == TextState::Recognized
                        })
                });
                assert_ne!(
                    service
                        .read_metadata(failed.id)
                        .unwrap()
                        .unwrap()
                        .text
                        .state(),
                    TextState::Recognized
                );
            } else {
                for count in 2..=5 {
                    std::fs::write(temp.path().join("scene-frame.png"), &images[count - 1])
                        .unwrap();
                    assert!(service.request_sample());
                    wait("successive image OCR", || {
                        let records = service.list_page(None, 20).unwrap().records;
                        records.len() == count
                            && records.iter().all(|r| {
                                service.read_metadata(r.id).unwrap().unwrap().text.state()
                                    == TextState::Recognized
                            })
                    });
                    let next = std::fs::read_to_string(temp.path().join("ocr.pid")).unwrap();
                    assert_eq!(pid == next, count <= 4, "reuse at most four images");
                }
                let live: i32 = std::fs::read_to_string(temp.path().join("ocr.pid"))
                    .unwrap()
                    .parse()
                    .unwrap();
                assert!(service.request_sample());
                wait("identical image reuses text and reaps idle child", || {
                    let records = service.list_page(None, 20).unwrap().records;
                    records.len() == 6
                        && records
                            .iter()
                            .all(|r| r.text_state == TextState::Recognized)
                        && unsafe { libc::kill(live, 0) } == -1
                });
                std::fs::write(temp.path().join("scene-frame.png"), &images[0]).unwrap();
                assert!(service.request_sample());
                wait("changed image prepares again after reuse", || {
                    let records = service.list_page(None, 20).unwrap().records;
                    records.len() == 7
                        && records
                            .iter()
                            .all(|r| r.text_state == TextState::Recognized)
                });
                let restarted: i32 = std::fs::read_to_string(temp.path().join("ocr.pid"))
                    .unwrap()
                    .parse()
                    .unwrap();
                assert_ne!(live, restarted);
                let live = restarted;
                service.set_policy(CapturePolicy::default()).unwrap();
                wait(
                    "OFF reaps idle OCR worker",
                    || unsafe { libc::kill(live, 0) } == -1,
                );
                assert!(!service.request_sample());
                // Old images remain readable after OFF; no late OCR can write.
            }
        } else {
            // Wait for the real child to finish or the fixed one-second deadline
            // to kill it; no guessed sleep or unbounded helper is left running.
            wait(
                "optional preparation starts after Replay acceptance",
                || temp.path().join("ocr.pid").exists(),
            );
            let pid: i32 = std::fs::read_to_string(temp.path().join("ocr.pid"))
                .unwrap()
                .parse()
                .unwrap();
            wait(
                &format!("{mode}: child exit"),
                || unsafe { libc::kill(pid, 0) } == -1,
            );
            assert_ne!(
                service.read_metadata(id).unwrap().unwrap().text.state(),
                TextState::Recognized,
                "{mode}"
            );
        }
        assert!(
            service.read_frame(id).unwrap().is_some(),
            "OCR cannot remove Replay"
        );
        if mode != "blocked-input" {
            assert!(temp.path().join("ocr-read.marker").exists());
        }
        if mode == "valid" {
            for action in ["purge", "account-store-removal"] {
                service
                    .set_policy(CapturePolicy {
                        scope: CaptureScope::ActiveDisplayScene,
                        enabled: true,
                        replay_enabled: true,
                        ocr_enabled: true,
                        ..Default::default()
                    })
                    .unwrap();
                service.resume_capture().unwrap();
                let before = service.status().accepted;
                assert!(service.request_sample());
                wait("worker ready before invalidation", || {
                    service.status().accepted > before
                        && service
                            .list_page(None, 20)
                            .unwrap()
                            .records
                            .iter()
                            .all(|r| {
                                service.read_metadata(r.id).unwrap().unwrap().text.state()
                                    == TextState::Recognized
                            })
                });
                let live: i32 = std::fs::read_to_string(temp.path().join("ocr.pid"))
                    .unwrap()
                    .parse()
                    .unwrap();
                if action == "purge" {
                    service.purge().unwrap();
                } else {
                    service.replace_store(None).unwrap();
                }
                wait(action, || unsafe { libc::kill(live, 0) } == -1);
                assert!(!service.request_sample());
            }
        }
        assert!(service.shutdown(Duration::from_millis(1100)));
    }
}
