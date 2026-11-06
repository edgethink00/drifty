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
    let mut png = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut png, 512, 512);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut seed = 123456789u32;
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
    }
    assert!(png.len() > 1024 * 1024);
    for mode in [
        "valid",
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
        std::fs::write(temp.path().join("scene-frame.png"), &png).unwrap();
        let path = temp.path().join(format!("ocr-{mode}"));
        std::fs::copy(env!("CARGO_BIN_EXE_screen-context-protocol-fixture"), &path).unwrap();
        let backend = NativeSceneHelperBackend::from_app_resource(&path)
            .unwrap()
            .with_deferred_ocr();
        let mut service = ScreenContextService::new(Arc::new(backend)).unwrap();
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
        if mode == "valid" {
            wait(&format!("{mode}: OCR recognition"), || {
                service.read_metadata(id).unwrap().unwrap().text.state() == TextState::Recognized
            });
            assert_eq!(
                service.read_metadata(id).unwrap().unwrap().text.as_str(),
                "same exact image"
            );
        } else {
            // Wait for the real child to finish or the fixed one-second deadline
            // to kill it; no guessed sleep or unbounded helper is left running.
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
        assert!(service.shutdown(Duration::from_millis(1100)));
    }
}
