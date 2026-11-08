use super::*;
use std::sync::atomic::AtomicUsize;

struct DeferredBackend {
    captures: AtomicUsize,
    entered: AtomicUsize,
    release: AtomicBool,
    missing_region: bool,
}
impl CaptureBackend for DeferredBackend {
    fn supports_scene_capture(&self) -> bool {
        true
    }
    fn supports_deferred_scene_ocr(&self) -> bool {
        true
    }
    fn capture(
        &self,
        _: &CapturePolicy,
        _: &Cancellation,
    ) -> Result<NativeCapture, CaptureFailure> {
        Err(CaptureFailure::Unsupported)
    }
    fn capture_scene(
        &self,
        _: &CapturePolicy,
        _: &Cancellation,
    ) -> Result<NativeSceneCapture, CaptureFailure> {
        self.captures.fetch_add(1, Ordering::Release);
        let mut facts = crate::scene::tests::facts();
        facts.identity.text_scope = crate::SceneTextScope::None;
        if self.missing_region {
            facts.identity.foreground_region = None;
        }
        Ok(NativeSceneCapture {
            before: facts.clone(),
            after: facts,
            observed_at_ms: unix_millis().unwrap(),
            text: TextEvidence::not_requested(),
            frame: crate::tests::evidence(1000).frame,
            activity_hint: None,
        })
    }
    fn recognize_scene(
        &self,
        _: &Frame,
        _: SceneRegion,
        cancel: &Cancellation,
    ) -> Result<TextEvidence, CaptureFailure> {
        self.entered.fetch_add(1, Ordering::Release);
        while !self.release.load(Ordering::Acquire) && self.captures.load(Ordering::Acquire) < 2 {
            if cancel.is_cancelled() {
                return Err(CaptureFailure::Cancelled);
            }
            thread::sleep(Duration::from_millis(2));
        }
        TextEvidence::new(
            TextSource::Ocr,
            TextState::Recognized,
            Zeroizing::new("same image text".into()),
        )
        .map_err(|_| CaptureFailure::Unavailable)
    }
}
fn wait(condition: impl Fn() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(3);
    while !condition() {
        assert!(Instant::now() < deadline);
        thread::sleep(Duration::from_millis(2));
    }
}
fn setup() -> (
    tempfile::TempDir,
    Arc<DeferredBackend>,
    ScreenContextService,
) {
    let temp = tempfile::tempdir().unwrap();
    let backend = Arc::new(DeferredBackend {
        captures: AtomicUsize::new(0),
        entered: AtomicUsize::new(0),
        release: AtomicBool::new(false),
        missing_region: false,
    });
    let service = ScreenContextService::new(backend.clone()).unwrap();
    service
        .replace_store(Some(crate::tests::open(
            &temp.path().join("store"),
            unix_millis().unwrap(),
        )))
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
    wait(|| backend.entered.load(Ordering::Acquire) == 1);
    (temp, backend, service)
}
#[test]
fn replay_is_readable_before_ocr_and_exact_image_text_arrives_without_recapturing() {
    let (_temp, backend, mut service) = setup();
    let page = service.list_page(None, 10).unwrap();
    assert_eq!(page.records.len(), 1);
    let id = page.records[0].id;
    let image = service.read_frame(id).unwrap().unwrap();
    assert_eq!(
        service.read_metadata(id).unwrap().unwrap().text.state(),
        TextState::NotRequested
    );
    backend.release.store(true, Ordering::Release);
    wait(|| service.read_metadata(id).unwrap().unwrap().text.state() == TextState::Recognized);
    assert_eq!(
        service.read_frame(id).unwrap().unwrap().sha256(),
        image.sha256()
    );
    assert_eq!(backend.captures.load(Ordering::Acquire), 1);
    assert!(service.shutdown(Duration::from_millis(1100)));
}
#[test]
fn identical_captures_keep_all_records_without_repeating_ocr_and_epoch_change_resets_hint() {
    let (_temp, backend, mut service) = setup();
    backend.release.store(true, Ordering::Release);
    wait(|| lock(&service.shared).previous_scene_ocr.is_some());
    for accepted in 2..=3 {
        assert!(service.request_sample());
        wait(|| service.status().accepted == accepted);
        wait(|| {
            service
                .list_page(None, 10)
                .unwrap()
                .records
                .iter()
                .all(|r| r.text_state == TextState::Recognized)
        });
    }
    assert_eq!(backend.captures.load(Ordering::Acquire), 3);
    assert_eq!(backend.entered.load(Ordering::Acquire), 1);
    assert_eq!(service.list_page(None, 10).unwrap().records.len(), 3);
    service.invalidate_observations();
    assert!(lock(&service.shared).previous_scene_ocr.is_none());
    assert!(service.request_sample());
    wait(|| backend.entered.load(Ordering::Acquire) == 2);
    assert!(service.shutdown(Duration::from_millis(1100)));
}

#[test]
fn deletion_cancels_pending_ocr_without_resurrecting_the_record() {
    let (temp, backend, mut service) = setup();
    let id = service.list_page(None, 10).unwrap().records[0].id;
    assert_eq!(service.purge().unwrap().removed, vec![id]);
    assert!(service.read_frame(id).unwrap().is_none());
    backend.release.store(true, Ordering::Release);
    assert!(service.shutdown(Duration::from_millis(1100)));
    drop(service);
    let mut reopened = crate::tests::open(&temp.path().join("store"), unix_millis().unwrap());
    assert!(reopened
        .read_metadata(id, unix_millis().unwrap())
        .unwrap()
        .is_none());
    assert!(reopened
        .read_frame(id, unix_millis().unwrap())
        .unwrap()
        .is_none());
}

#[test]
fn a_new_capture_preempts_optional_ocr_and_keeps_the_earlier_replay() {
    let (_temp, backend, mut service) = setup();
    let first = service.list_page(None, 10).unwrap().records[0].id;
    assert!(service.request_sample());
    wait(|| backend.captures.load(Ordering::Acquire) == 2 && service.status().accepted == 2);
    let rows = service.list_page(None, 10).unwrap();
    let second = rows.records.iter().find(|r| r.id != first).unwrap().id;
    wait(|| service.read_metadata(second).unwrap().unwrap().text.state() == TextState::Recognized);
    assert!(service.read_frame(first).unwrap().is_some());
    assert_eq!(
        service.read_metadata(first).unwrap().unwrap().text.state(),
        TextState::NotRequested
    );
    assert!(service.shutdown(Duration::from_millis(1100)));
}

#[test]
fn missing_ocr_region_keeps_replay_without_reading_chrome_but_cannot_store_text_only() {
    for replay in [true, false] {
        let temp = tempfile::tempdir().unwrap();
        let backend = Arc::new(DeferredBackend {
            captures: AtomicUsize::new(0),
            entered: AtomicUsize::new(0),
            release: AtomicBool::new(true),
            missing_region: true,
        });
        let mut service = ScreenContextService::new(backend.clone()).unwrap();
        service
            .replace_store(Some(crate::tests::open(
                &temp.path().join("store"),
                unix_millis().unwrap(),
            )))
            .unwrap();
        service
            .set_policy(CapturePolicy {
                scope: CaptureScope::ActiveDisplayScene,
                enabled: true,
                replay_enabled: replay,
                ocr_enabled: true,
                ..Default::default()
            })
            .unwrap();
        assert!(service.request_sample());
        wait(|| service.status().accepted + service.status().dropped == 1);
        assert_eq!(backend.entered.load(Ordering::Acquire), 0);
        let rows = service.list_page(None, 10).unwrap();
        if replay {
            assert_eq!(service.status().accepted, 1);
            let id = rows.records[0].id;
            assert!(service.read_frame(id).unwrap().is_some());
            assert_eq!(
                service.read_metadata(id).unwrap().unwrap().text.state(),
                TextState::NotRequested
            );
        } else {
            assert!(rows.records.is_empty());
            assert_eq!(service.status().last_failure, Some(CaptureFailure::NoText));
        }
        assert!(service.shutdown(Duration::from_millis(1100)));
    }
}
