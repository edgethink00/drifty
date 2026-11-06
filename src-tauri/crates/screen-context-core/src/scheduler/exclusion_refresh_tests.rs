use super::*;
use std::sync::mpsc;

struct NoCapture;
impl CaptureBackend for NoCapture {
    fn capture(
        &self,
        _: &CapturePolicy,
        _: &Cancellation,
    ) -> Result<NativeCapture, CaptureFailure> {
        panic!("default OFF must not capture")
    }
}

#[test]
fn unchanged_trusted_rules_do_not_cancel_capture_while_the_store_is_busy() {
    let service = Arc::new(ScreenContextService::new(Arc::new(NoCapture)).unwrap());
    let rules = Some(BTreeSet::from(["excluded.editor".into()]));
    service.set_global_exclusions(rules.clone()).unwrap();
    let lease = service.observation_lease();
    let state = lock(&service.shared);
    let other = Arc::clone(&service);
    let (sent, received) = mpsc::channel();
    let refresh = thread::spawn(move || {
        sent.send(other.set_global_exclusions(rules)).unwrap();
    });
    let result = received.recv_timeout(Duration::from_secs(1));
    let still_current = lease.is_current();
    // Always release the test barrier, including against the old implementation.
    drop(state);
    refresh.join().unwrap();
    assert!(
        still_current,
        "a rule refresh must not revoke current evidence"
    );
    assert_eq!(result.unwrap().unwrap(), false);
}

#[test]
fn changed_or_unavailable_rules_revoke_before_waiting_for_a_busy_store() {
    for rules in [Some(BTreeSet::from(["excluded.editor".into()])), None] {
        let service = Arc::new(ScreenContextService::new(Arc::new(NoCapture)).unwrap());
        let lease = service.observation_lease();
        let state = lock(&service.shared);
        let other = Arc::clone(&service);
        let (sent, received) = mpsc::channel();
        let change = thread::spawn(move || {
            sent.send(other.set_global_exclusions(rules)).unwrap();
        });
        let deadline = Instant::now() + Duration::from_secs(1);
        while lease.is_current() && Instant::now() < deadline {
            thread::yield_now();
        }
        let revoked = !lease.is_current();
        let waiting = received.try_recv().is_err();
        drop(state);
        change.join().unwrap();
        assert!(revoked, "new restrictions must revoke before storage I/O");
        assert!(
            waiting,
            "a mutation must finish its storage barrier before acknowledgment"
        );
        assert!(received.recv().unwrap().is_ok());
    }
}

#[test]
fn equal_rules_after_invalidation_still_reconcile_the_new_fence() {
    let service = ScreenContextService::new(Arc::new(NoCapture)).unwrap();
    let rules = Some(BTreeSet::from(["excluded.editor".into()]));
    service.set_global_exclusions(rules.clone()).unwrap();
    service.invalidate_observations_now();
    let before = service.shared.fence.load(Ordering::Acquire);
    service.set_global_exclusions(rules).unwrap();
    let state = lock(&service.shared);
    assert!(state.epoch > before);
    assert_eq!(state.epoch, service.shared.fence.load(Ordering::Acquire));
}
