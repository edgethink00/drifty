use super::super::backend::GuardedBackend;
use super::*;
use drifty_screen_context_core::{
    activity_reader::{ActivityResolver, CapturedActivityHint},
    Frame, LocalActivityRecordRef, Privacy, SurfaceFacts, SurfaceIdentity, Visibility,
};
use std::sync::atomic::AtomicUsize;
use zeroize::Zeroizing;
struct OwnedCapture;
impl CaptureBackend for OwnedCapture {
    fn capture(
        &self,
        _: &CapturePolicy,
        _: &Cancellation,
    ) -> Result<NativeCapture, CaptureFailure> {
        let facts = SurfaceFacts {
            identity: SurfaceIdentity {
                pid: 7,
                process_birth: 1,
                window_id: 2,
                app_id: "owned.editor".into(),
                document_id: "owned-test".into(),
                document_generation: 1,
            },
            permission: true,
            foreground: true,
            interactive: true,
            protected: false,
            privacy: Privacy::NotBrowser,
            visibility: Visibility::Visible,
        };
        let frame=Frame::from_png(STANDARD.decode("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAADklEQVR4nGPQggIGGAMAF7ICochlLlkAAAAASUVORK5CYII=").unwrap()).unwrap();
        Ok(NativeCapture {
            before: facts.clone(),
            after: facts,
            observed_at_ms: unix_millis().unwrap(),
            text: TextEvidence::not_requested(),
            frame,
            activity_hint: Some(
                drifty_screen_context_core::native::WindowTitleDigest::parse("a".repeat(64))
                    .unwrap(),
            ),
        })
    }
}
struct Reader {
    row: Mutex<Option<LocalActivityRecordRef>>,
    calls: AtomicUsize,
}
impl ActivityResolver for Reader {
    fn resolve_capture(
        &self,
        _: &CapturedActivityHint,
        current: &dyn Fn() -> bool,
    ) -> Result<Option<LocalActivityRecordRef>, Error> {
        assert!(current());
        Ok(self.row.lock().unwrap().clone())
    }
    fn read_current(
        &self,
        _: &[String],
        current: &dyn Fn() -> bool,
    ) -> Result<Vec<LocalActivityRecordRef>, Error> {
        assert!(current());
        self.calls.fetch_add(1, Ordering::Relaxed);
        Ok(self.row.lock().unwrap().clone().into_iter().collect())
    }
    fn reset(&self) {}
}
fn fixture(root: &std::path::Path) -> (ScreenContextService, Arc<Reader>) {
    let now = unix_millis().unwrap();
    let row:LocalActivityRecordRef=serde_json::from_value(serde_json::json!({"recordId":"1","segmentUid":"f26d8c10-cb09-4c98-a3e3-3744216aab1e","identityDigest":"a".repeat(64),"startedAtMs":now-10000,"endedAtMs":now+10000})).unwrap();
    let store = EvidenceStore::open(
        root,
        ScopeId::from_profile("owned-visible-evidence").unwrap(),
        Zeroizing::new([7; 32]),
        Retention::default(),
        now,
    )
    .unwrap();
    let reader = Arc::new(Reader {
        row: Mutex::new(Some(row)),
        calls: AtomicUsize::new(0),
    });
    let service =
        ScreenContextService::new_with_activity_resolver(Arc::new(OwnedCapture), reader.clone())
            .unwrap();
    service.replace_store(Some(store)).unwrap();
    service
        .set_policy(CapturePolicy {
            enabled: true,
            replay_enabled: true,
            allowed_apps: std::collections::BTreeSet::from(["owned.editor".into()]),
            ..CapturePolicy::default()
        })
        .unwrap();
    assert!(service.request_sample());
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let page = service.list_page(None, 20).unwrap();
        if let Some(row) = page.records.first() {
            if service
                .read_metadata(row.id)
                .unwrap()
                .unwrap()
                .activity_binding
                .is_some()
            {
                break;
            }
        }
        assert!(
            Instant::now() < deadline,
            "owned synthetic capture did not bind"
        );
        thread::sleep(Duration::from_millis(2));
    }
    (service, reader)
}
#[test]
fn status_renewal_keeps_visibility_and_expiry_discards_before_stopping_queries() {
    let temp = tempfile::tempdir().unwrap();
    let (mut service, reader) = fixture(&temp.path().join("store"));
    let runtime = ScreenContextRuntime::default();
    let reply = service.list_review_evidence(None, 20).unwrap();
    runtime.watch_page(&reply).unwrap();
    drop(reply);
    runtime.visibility.lock().unwrap().until = Some(Instant::now() - Duration::from_secs(1));
    runtime.touch_visibility();
    assert!(!runtime
        .visibility
        .lock()
        .unwrap()
        .discard_if_stale(Instant::now() + Duration::from_secs(3), 0));
    let calls = reader.calls.load(Ordering::Relaxed);
    assert!(runtime
        .visibility
        .lock()
        .unwrap()
        .discard_if_stale(Instant::now() + Duration::from_secs(6), 0));
    assert!(!runtime.visibility.lock().unwrap().has_guard());
    assert!(!runtime
        .visibility
        .lock()
        .unwrap()
        .discard_if_stale(Instant::now() + Duration::from_secs(7), 0));
    assert_eq!(reader.calls.load(Ordering::Relaxed), calls);
    assert!(service.shutdown(Duration::from_millis(1100)));
}
#[test]
fn activity_removal_discards_visible_content_once_and_restoration_cannot_revive_it() {
    let temp = tempfile::tempdir().unwrap();
    let (mut service, reader) = fixture(&temp.path().join("store"));
    let runtime = ScreenContextRuntime::default();
    let reply = service.list_review_evidence(None, 20).unwrap();
    runtime.watch_page(&reply).unwrap();
    drop(reply);
    let saved = reader.row.lock().unwrap().take();
    assert!(runtime
        .visibility
        .lock()
        .unwrap()
        .discard_if_stale(Instant::now(), 0));
    *reader.row.lock().unwrap() = saved;
    let calls = reader.calls.load(Ordering::Relaxed);
    assert!(!runtime
        .visibility
        .lock()
        .unwrap()
        .discard_if_stale(Instant::now(), 0));
    assert_eq!(reader.calls.load(Ordering::Relaxed), calls);
    assert!(service.shutdown(Duration::from_millis(1100)));
}

#[test]
fn deliberate_client_mutations_forget_old_watches_without_an_extra_event_or_query() {
    let temp = tempfile::tempdir().unwrap();
    let (mut service, reader) = fixture(&temp.path().join("store"));
    let runtime = ScreenContextRuntime::default();
    let reply = service.list_review_evidence(None, 20).unwrap();
    runtime.watch_page(&reply).unwrap();
    runtime.forget_visibility_now();
    let calls = reader.calls.load(Ordering::Relaxed);
    let generation = runtime.visibility_generation.load(Ordering::Acquire);
    assert!(!runtime
        .visibility
        .lock()
        .unwrap()
        .discard_if_stale(Instant::now(), generation));
    assert!(!runtime.visibility.lock().unwrap().has_guard());
    assert_eq!(reader.calls.load(Ordering::Relaxed), calls);
    service.invalidate_observations();
    assert!(runtime.watch_page(&reply).is_err());
    assert_eq!(reader.calls.load(Ordering::Relaxed), calls);
    assert!(service.shutdown(Duration::from_millis(1100)));
}

// Exercise the service through the product wrapper: testing the core adapter
// alone cannot detect a wrapper that drops its empty-helper preparation signal.
#[derive(Default)]
struct RecyclingCapture {
    captures: AtomicUsize,
    empty_preparations: AtomicUsize,
    exhausted: AtomicBool,
}
impl CaptureBackend for RecyclingCapture {
    fn needs_idle_preparation(&self) -> bool {
        self.exhausted.load(Ordering::Acquire)
    }
    fn prepare(&self, _: &CapturePolicy, _: &Cancellation) -> Result<(), CaptureFailure> {
        if self.exhausted.swap(false, Ordering::AcqRel) {
            self.empty_preparations.fetch_add(1, Ordering::AcqRel);
        }
        Ok(())
    }
    fn capture(
        &self,
        policy: &CapturePolicy,
        cancel: &Cancellation,
    ) -> Result<NativeCapture, CaptureFailure> {
        let capture = OwnedCapture.capture(policy, cancel)?;
        if (self.captures.fetch_add(1, Ordering::AcqRel) + 1) % 8 == 0 {
            self.exhausted.store(true, Ordering::Release);
        }
        Ok(capture)
    }
}
fn guarded_service(root: &std::path::Path, backend: Arc<GuardedBackend>) -> ScreenContextService {
    let store = EvidenceStore::open(
        root,
        ScopeId::from_profile("owned-guarded-helper").unwrap(),
        Zeroizing::new([7; 32]),
        Retention::default(),
        unix_millis().unwrap(),
    )
    .unwrap();
    let service = ScreenContextService::new(backend).unwrap();
    service.replace_store(Some(store)).unwrap();
    service
        .set_policy(CapturePolicy {
            enabled: true,
            replay_enabled: true,
            allowed_apps: std::collections::BTreeSet::from(["owned.editor".into()]),
            ..CapturePolicy::default()
        })
        .unwrap();
    service
}
fn wait_guarded_job(service: &ScreenContextService, total: u64) {
    let until = Instant::now() + Duration::from_secs(2);
    while service.status().accepted + service.status().dropped < total {
        assert!(
            Instant::now() < until,
            "guarded service did not finish the requested job"
        );
        thread::sleep(Duration::from_millis(2));
    }
}
#[test]
fn guarded_backend_prepares_exhausted_helper_without_a_ninth_sample() {
    let temp = tempfile::tempdir().unwrap();
    let inner = Arc::new(RecyclingCapture::default());
    let backend = Arc::new(GuardedBackend {
        inner: inner.clone(),
        suspended: Arc::new(AtomicBool::new(false)),
    });
    let mut service = guarded_service(temp.path(), backend);
    for expected in 1..=8 {
        assert!(service.request_sample());
        wait_guarded_job(&service, expected);
    }
    let until = Instant::now() + Duration::from_secs(1);
    while inner.empty_preparations.load(Ordering::Acquire) == 0 && Instant::now() < until {
        thread::sleep(Duration::from_millis(2));
    }
    let empty = inner.empty_preparations.load(Ordering::Acquire);
    assert!(service.shutdown(Duration::from_millis(1100)));
    assert_eq!(empty, 1, "product wrapper lost the exhausted-helper signal");
    assert_eq!(inner.captures.load(Ordering::Acquire), 8);
    assert_eq!(service.status().accepted, 8);
    assert_eq!(service.status().dropped, 0);
}
#[test]
fn guarded_backend_suspension_blocks_preparation_and_capture_until_resumed() {
    let temp = tempfile::tempdir().unwrap();
    let inner = Arc::new(RecyclingCapture::default());
    inner.exhausted.store(true, Ordering::Release);
    let suspended = Arc::new(AtomicBool::new(true));
    let backend = Arc::new(GuardedBackend {
        inner: inner.clone(),
        suspended: suspended.clone(),
    });
    let mut service = guarded_service(temp.path(), backend.clone());
    assert!(!backend.needs_idle_preparation());
    assert!(service.request_sample());
    wait_guarded_job(&service, 1);
    assert_eq!(
        service.status().last_failure,
        Some(CaptureFailure::Protected)
    );
    assert_eq!(inner.empty_preparations.load(Ordering::Acquire), 0);
    assert_eq!(inner.captures.load(Ordering::Acquire), 0);
    suspended.store(false, Ordering::Release);
    let forwards_after_resume = backend.needs_idle_preparation();
    assert!(service.request_sample());
    wait_guarded_job(&service, 2);
    assert!(service.shutdown(Duration::from_millis(1100)));
    assert!(
        forwards_after_resume,
        "resumed wrapper must preserve pending preparation"
    );
    assert_eq!(inner.empty_preparations.load(Ordering::Acquire), 1);
    assert_eq!(inner.captures.load(Ordering::Acquire), 1);
    assert_eq!(service.status().accepted, 1);
    assert_eq!(service.status().dropped, 1);
}

#[test]
fn guarded_backend_forwards_general_capability_and_respects_pause_without_legacy_fallback() {
    struct SceneOnly(AtomicUsize);
    impl CaptureBackend for SceneOnly {
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
            panic!("a general-screen job reached the document backend")
        }
        fn capture_scene(
            &self,
            _: &CapturePolicy,
            _: &Cancellation,
        ) -> Result<drifty_screen_context_core::NativeSceneCapture, CaptureFailure> {
            self.0.fetch_add(1, Ordering::AcqRel);
            Err(CaptureFailure::NoText)
        }
    }
    let temp = tempfile::tempdir().unwrap();
    let inner = Arc::new(SceneOnly(AtomicUsize::new(0)));
    let suspended = Arc::new(AtomicBool::new(true));
    let backend = Arc::new(GuardedBackend {
        inner: inner.clone(),
        suspended: suspended.clone(),
    });
    assert!(backend.supports_scene_capture() && backend.supports_deferred_scene_ocr());
    let mut service = guarded_service(temp.path(), backend);
    service
        .set_policy(CapturePolicy {
            scope: drifty_screen_context_core::CaptureScope::ActiveDisplayScene,
            enabled: true,
            replay_enabled: true,
            ..Default::default()
        })
        .unwrap();
    assert!(service.request_sample());
    wait_guarded_job(&service, 1);
    assert_eq!(
        service.status().last_failure,
        Some(CaptureFailure::Protected)
    );
    assert_eq!(inner.0.load(Ordering::Acquire), 0);
    suspended.store(false, Ordering::Release);
    assert!(service.request_sample());
    wait_guarded_job(&service, 2);
    assert_eq!(service.status().last_failure, Some(CaptureFailure::NoText));
    assert_eq!(inner.0.load(Ordering::Acquire), 1);
    assert!(service.shutdown(Duration::from_millis(1100)));
}
