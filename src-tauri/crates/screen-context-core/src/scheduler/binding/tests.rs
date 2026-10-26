use super::*;
use crate::{lease::AccountGate, LocalActivityRecordRef, Privacy, ScopeId, Visibility};
use std::sync::{atomic::AtomicUsize, mpsc};

struct ImmediateBackend {
    hint: bool,
    calls: AtomicUsize,
}
impl CaptureBackend for ImmediateBackend {
    fn capture(
        &self,
        _: &CapturePolicy,
        _: &Cancellation,
    ) -> Result<NativeCapture, CaptureFailure> {
        self.calls.fetch_add(1, Ordering::Relaxed);
        let now = unix_millis().unwrap();
        let e = crate::tests::evidence(now);
        let facts = SurfaceFacts {
            identity: e.surface,
            permission: true,
            foreground: true,
            interactive: true,
            protected: false,
            visibility: Visibility::Visible,
            privacy: Privacy::NotBrowser,
        };
        Ok(NativeCapture {
            before: facts.clone(),
            after: facts,
            observed_at_ms: now,
            text: TextEvidence::not_requested(),
            frame: e.frame,
            activity_hint: self
                .hint
                .then(|| crate::native::WindowTitleDigest::parse("a".repeat(64)).unwrap()),
        })
    }
}
struct ControlledResolver {
    started: mpsc::Sender<CapturedActivityHint>,
    release: Mutex<mpsc::Receiver<bool>>,
    calls: AtomicUsize,
    returned: AtomicUsize,
    fail_next: AtomicBool,
}
impl ActivityResolver for ControlledResolver {
    fn resolve_capture(
        &self,
        hint: &CapturedActivityHint,
        _: &dyn Fn() -> bool,
    ) -> Result<Option<LocalActivityRecordRef>, Error> {
        self.calls.fetch_add(1, Ordering::Relaxed);
        self.started.send(hint.clone()).unwrap();
        // Deliberately ignores cancellation: the native store fence must still
        // reject this result after OFF/account/deletion/exclusion transitions.
        let found = self
            .release
            .lock()
            .unwrap()
            .recv_timeout(Duration::from_secs(3))
            .map_err(|_| Error::WorkerUnavailable)?;
        self.returned.fetch_add(1, Ordering::Release);
        if self.fail_next.swap(false, Ordering::AcqRel) {
            return Err(Error::WorkerUnavailable);
        }
        Ok(found.then(||serde_json::from_value(serde_json::json!({"recordId":"864290113","segmentUid":"f26d8c10-cb09-4c98-a3e3-3744216aab1e","identityDigest":"a".repeat(64),"startedAtMs":hint.observed_at_ms-1,"endedAtMs":hint.observed_at_ms+1})).unwrap()))
    }
    fn read_current(
        &self,
        _: &[String],
        _: &dyn Fn() -> bool,
    ) -> Result<Vec<LocalActivityRecordRef>, Error> {
        unreachable!()
    }
    fn reset(&self) {}
}
fn policy() -> CapturePolicy {
    CapturePolicy {
        enabled: true,
        replay_enabled: true,
        allowed_apps: BTreeSet::from(["owned.editor".into()]),
        ..CapturePolicy::default()
    }
}
fn setup(
    root: &std::path::Path,
    hint: bool,
    account: bool,
) -> (
    ScreenContextService,
    mpsc::Receiver<CapturedActivityHint>,
    mpsc::Sender<bool>,
    Arc<ControlledResolver>,
) {
    let (started, rx) = mpsc::channel();
    let (tx, release) = mpsc::channel();
    let resolver = Arc::new(ControlledResolver {
        started,
        release: Mutex::new(release),
        calls: AtomicUsize::new(0),
        returned: AtomicUsize::new(0),
        fail_next: AtomicBool::new(false),
    });
    let backend = Arc::new(ImmediateBackend {
        hint,
        calls: AtomicUsize::new(0),
    });
    let service = if account {
        ScreenContextService::new_account_bound_with_activity_resolver(backend, resolver.clone())
    } else {
        ScreenContextService::new_with_activity_resolver(backend, resolver.clone())
    }
    .unwrap();
    if !account {
        service
            .replace_store(Some(crate::tests::open(root, unix_millis().unwrap())))
            .unwrap();
        service.set_policy(policy()).unwrap();
    }
    (service, rx, tx, resolver)
}

#[test]
fn a_concurrent_store_read_cannot_permanently_drop_a_resolved_binding() {
    let temp = tempfile::tempdir().unwrap();
    let (mut service, started, release, resolver) = setup(&temp.path().join("store"), true, false);
    service.request_sample();
    wait_capture(&service, 1);
    started.recv_timeout(Duration::from_secs(2)).unwrap();
    let state = lock(&service.shared);
    release.send(true).unwrap();
    let deadline = Instant::now() + Duration::from_secs(2);
    while resolver.returned.load(Ordering::Acquire) == 0 {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(2));
    }
    std::thread::sleep(Duration::from_millis(50));
    drop(state);
    wait_idle(&service);
    assert!(metadata(&service)[0].activity_binding.is_some());
    assert_eq!(resolver.calls.load(Ordering::Acquire), 1);
    assert_eq!(service.status().accepted, 1);
    assert!(service.shutdown(Duration::from_millis(1100)));
}

#[test]
fn unavailable_optional_reader_retries_only_the_original_recent_capture() {
    let temp = tempfile::tempdir().unwrap();
    let (mut service, started, release, resolver) = setup(&temp.path().join("store"), true, false);
    resolver.fail_next.store(true, Ordering::Release);
    service.request_sample();
    wait_capture(&service, 1);
    let first = started.recv_timeout(Duration::from_secs(2)).unwrap();
    release.send(false).unwrap();
    let retried = started.recv_timeout(Duration::from_secs(2)).unwrap();
    assert_eq!(first.observed_at_ms, retried.observed_at_ms);
    release.send(true).unwrap();
    wait_idle(&service);
    assert!(metadata(&service)[0].activity_binding.is_some());
    assert_eq!(resolver.calls.load(Ordering::Acquire), 2);
    assert_eq!(service.status().accepted, 1);
    assert!(service.shutdown(Duration::from_millis(1100)));
}
fn wait_capture(service: &ScreenContextService, count: u64) {
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        let status = service.status();
        if status.accepted >= count {
            return;
        }
        assert!(Instant::now() < deadline, "{:?}", status.last_failure);
        std::thread::sleep(Duration::from_millis(2));
    }
}
fn wait_idle(service: &ScreenContextService) {
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        let state = lock(&service.shared);
        let idle = state.bindings.is_empty() && state.binding_active.is_none();
        drop(state);
        if idle {
            return;
        }
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(2));
    }
}
fn metadata(service: &ScreenContextService) -> Vec<EvidenceMetadata> {
    service
        .list_page(None, 100)
        .unwrap()
        .records
        .into_iter()
        .map(|r| service.read_metadata(r.id).unwrap().unwrap())
        .collect()
}

#[test]
fn normal_sample_extension_is_retried_outside_store_and_without_delaying_capture() {
    let temp = tempfile::tempdir().unwrap();
    let (mut service, started, release, _) = setup(&temp.path().join("store"), true, false);
    assert!(service.request_sample());
    wait_capture(&service, 1);
    let first = started.recv_timeout(Duration::from_secs(2)).unwrap();
    assert!(metadata(&service)[0].activity_binding.is_none());
    assert!(service.request_sample());
    wait_capture(&service, 2); // Query is still held.
    release.send(false).unwrap(); // Point not yet covered by ordinary tracker.
    let second = started.recv_timeout(Duration::from_secs(2)).unwrap();
    release.send(true).unwrap();
    let retried = started.recv_timeout(Duration::from_secs(2)).unwrap();
    release.send(true).unwrap();
    wait_idle(&service);
    assert!(
        first.observed_at_ms == retried.observed_at_ms
            || second.observed_at_ms == retried.observed_at_ms
    );
    assert!(metadata(&service)
        .iter()
        .all(|m| m.activity_binding.is_some()));
    assert_eq!(service.status().accepted, 2);
    assert!(service.shutdown(Duration::from_millis(1100)));
}

#[test]
fn late_binding_after_off_on_exclusion_or_deletion_cannot_revive_an_old_capture() {
    for mutation in ["off-on", "exclusion", "deletion"] {
        let temp = tempfile::tempdir().unwrap();
        let (mut service, started, release, _) = setup(&temp.path().join("store"), true, false);
        service.request_sample();
        wait_capture(&service, 1);
        started.recv_timeout(Duration::from_secs(2)).unwrap();
        match mutation {
            "off-on" => {
                service.set_policy(CapturePolicy::default()).unwrap();
                service.set_policy(policy()).unwrap();
            }
            "exclusion" => {
                service
                    .set_global_exclusions(Some(BTreeSet::from(["owned.editor".into()])))
                    .unwrap();
            }
            _ => {
                service.purge().unwrap();
            }
        }
        release.send(true).unwrap();
        wait_idle(&service);
        if mutation == "exclusion" {
            service
                .set_global_exclusions(Some(BTreeSet::new()))
                .unwrap();
        }
        let rows = metadata(&service);
        assert!(
            rows.iter().all(|m| m.activity_binding.is_none()),
            "{mutation}"
        );
        assert_eq!(rows.len(), usize::from(mutation != "deletion"));
        assert!(service.shutdown(Duration::from_millis(1100)));
    }
}

#[test]
fn native_account_aba_independently_rejects_lookup_after_same_scope_returns() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("store");
    let (mut service, started, release, _) = setup(&root, true, true);
    let gate = AccountGate::default();
    let scope = ScopeId::from_profile("owned-test-profile").unwrap();
    let account = gate
        .bind_verified(
            gate.begin_transition().unwrap(),
            scope.clone(),
            Instant::now() + Duration::from_secs(10),
        )
        .unwrap();
    service
        .bind_account_lease(gate.read(account).unwrap())
        .unwrap();
    service
        .replace_store(Some(crate::tests::open(&root, unix_millis().unwrap())))
        .unwrap();
    service.set_policy(policy()).unwrap();
    service.request_sample();
    wait_capture(&service, 1);
    started.recv_timeout(Duration::from_secs(2)).unwrap();
    let next = gate
        .bind_verified(
            gate.begin_transition().unwrap(),
            scope,
            Instant::now() + Duration::from_secs(10),
        )
        .unwrap();
    service
        .bind_account_lease(gate.read(next).unwrap())
        .unwrap();
    release.send(true).unwrap();
    wait_idle(&service);
    assert!(metadata(&service)[0].activity_binding.is_none());
    assert!(service.shutdown(Duration::from_millis(1100)));
}

#[test]
fn legacy_or_null_hint_never_starts_optional_lookup_and_queue_is_bounded() {
    let temp = tempfile::tempdir().unwrap();
    let (mut service, started, _, resolver) = setup(&temp.path().join("store"), false, false);
    service.request_sample();
    wait_capture(&service, 1);
    assert!(started.try_recv().is_err());
    assert_eq!(resolver.calls.load(Ordering::Relaxed), 0);
    assert!(metadata(&service)[0].activity_binding.is_none());
    assert!(service.shutdown(Duration::from_millis(1100)));
    let temp = tempfile::tempdir().unwrap();
    let (mut service, started, release, _) = setup(&temp.path().join("store"), true, false);
    service.request_sample();
    wait_capture(&service, 1);
    started.recv_timeout(Duration::from_secs(2)).unwrap();
    for count in 2..=8 {
        service.request_sample();
        wait_capture(&service, count);
    }
    assert_eq!(lock(&service.shared).bindings.len(), MAX_PENDING_BINDINGS);
    service.set_policy(CapturePolicy::default()).unwrap();
    release.send(true).unwrap();
    wait_idle(&service);
    assert!(service.shutdown(Duration::from_millis(1100)));
}

#[test]
fn lookup_ticket_time_failure_is_permanent_when_wall_or_monotonic_time_recovers() {
    let temp = tempfile::tempdir().unwrap();
    let (mut service, _, _, _) = setup(&temp.path().join("store"), true, false);
    let now = unix_millis().unwrap();
    let epoch = lock(&service.shared).epoch;
    let make = || {
        PendingBinding::new(
            Uuid::new_v4(),
            CapturedActivityHint {
                app_key: "owned.editor".into(),
                title_digest: crate::native::WindowTitleDigest::parse("a".repeat(64)).unwrap(),
                observed_at_ms: now,
            },
            0,
            epoch,
            &service.shared,
            None,
        )
        .unwrap()
    };
    let ticket = make();
    assert!(ticket.current_at(Instant::now(), Ok(now)));
    assert!(!ticket.current_at(Instant::now(), Ok(now - 1)));
    assert!(!ticket.current_at(Instant::now(), Ok(now)));
    let ticket = make();
    assert!(!ticket.current_at(ticket.expires + Duration::from_nanos(1), Ok(now)));
    assert!(!ticket.current_at(Instant::now(), Ok(now)));
    let ticket = make();
    assert!(!ticket.current_at(Instant::now(), Ok(now + MAX_BIND_AGE_MS + 1)));
    assert!(!ticket.current_at(Instant::now(), Ok(now)));
    assert!(service.shutdown(Duration::from_millis(1100)));
}

#[test]
fn expired_capture_during_a_held_lookup_cannot_be_recreated_by_its_result() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("store");
    let (mut service, started, release, _) = setup(&root, true, false);
    service.replace_store(None).unwrap();
    let store = EvidenceStore::open(
        &root,
        ScopeId::from_profile("owned-test-profile").unwrap(),
        zeroize::Zeroizing::new([7; 32]),
        crate::Retention {
            ttl: Duration::from_secs(1),
            ..crate::Retention::default()
        },
        unix_millis().unwrap(),
    )
    .unwrap();
    service.replace_store(Some(store)).unwrap();
    service.set_policy(policy()).unwrap();
    service.request_sample();
    wait_capture(&service, 1);
    started.recv_timeout(Duration::from_secs(2)).unwrap();
    std::thread::sleep(Duration::from_millis(1100));
    release.send(true).unwrap();
    wait_idle(&service);
    assert!(metadata(&service).is_empty());
    assert_eq!(service.status().accepted, 1);
    assert!(service.shutdown(Duration::from_millis(1100)));
}
