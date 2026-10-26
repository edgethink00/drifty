use super::*;
use crate::{
    activity_reader::CapturedActivityHint, lease::AccountGate, LocalActivityRecordRef, ScopeId,
    ScreenContextService,
};
use std::{
    sync::{atomic::AtomicUsize, Mutex},
    time::{Duration, Instant},
};

struct Reader {
    value: Mutex<Option<serde_json::Value>>,
    calls: AtomicUsize,
}
impl ActivityResolver for Reader {
    fn resolve_capture(
        &self,
        _: &CapturedActivityHint,
        _: &dyn Fn() -> bool,
    ) -> Result<Option<LocalActivityRecordRef>, Error> {
        unreachable!()
    }
    fn read_current(
        &self,
        ids: &[String],
        current: &dyn Fn() -> bool,
    ) -> Result<Vec<LocalActivityRecordRef>, Error> {
        self.calls.fetch_add(1, Ordering::Relaxed);
        if !current() {
            return Err(Error::Invalidated);
        }
        assert_eq!(ids, ["1"]);
        self.value
            .lock()
            .unwrap()
            .as_ref()
            .map(|value| {
                serde_json::from_value(value.clone())
                    .map(|row| vec![row])
                    .map_err(|_| Error::Invalidated)
            })
            .unwrap_or(Ok(Vec::new()))
    }
    fn reset(&self) {}
}
struct NoCapture;
impl crate::CaptureBackend for NoCapture {
    fn capture(
        &self,
        _: &crate::CapturePolicy,
        _: &crate::Cancellation,
    ) -> Result<crate::NativeCapture, crate::CaptureFailure> {
        unreachable!()
    }
}
fn row() -> serde_json::Value {
    serde_json::json!({"recordId":"1","segmentUid":"f26d8c10-cb09-4c98-a3e3-3744216aab1e","identityDigest":"a".repeat(64),"startedAtMs":999,"endedAtMs":1001})
}
fn reader() -> Arc<Reader> {
    Arc::new(Reader {
        value: Mutex::new(Some(row())),
        calls: AtomicUsize::new(0),
    })
}
fn guard(
    service: &ScreenContextService,
    reader: Arc<Reader>,
    account: Option<AccountReadLease>,
) -> CurrentActivityGuard {
    let binding=serde_json::from_value(serde_json::json!({"recordId":"1","segmentUid":"f26d8c10-cb09-4c98-a3e3-3744216aab1e","identityDigest":"a".repeat(64)})).unwrap();
    CurrentActivityGuard::new(
        service.observation_lease(),
        account,
        reader,
        vec![ActivityProof {
            binding,
            observed_at_ms: 1000,
        }],
    )
    .unwrap()
}

#[test]
fn current_identity_and_point_are_rechecked_and_a_failure_cannot_revive_after_restoration() {
    let mut service = ScreenContextService::new(Arc::new(NoCapture)).unwrap();
    for (field, value) in [
        (
            "segmentUid",
            serde_json::json!("c76b243b-09a7-45cd-89c0-eebc9ff4e548"),
        ),
        ("identityDigest", serde_json::json!("b".repeat(64))),
        ("startedAtMs", serde_json::json!(1001)),
        ("endedAtMs", serde_json::json!(1000)),
        ("revokedRanges", serde_json::json!([[1000, 1001]])),
    ] {
        let reader = reader();
        let reply =
            ActivityReadReply::new("owned private text", guard(&service, reader.clone(), None))
                .unwrap();
        assert_eq!(
            serde_json::to_string(&reply).unwrap(),
            "\"owned private text\""
        );
        reader.value.lock().unwrap().as_mut().unwrap()[field] = value;
        let error = serde_json::to_string(&reply).unwrap_err().to_string();
        assert!(!error.contains("owned"));
        *reader.value.lock().unwrap() = Some(row());
        assert!(
            serde_json::to_string(&reply).is_err(),
            "old response revived after {field} restoration"
        );
    }
    assert!(service.shutdown(Duration::from_millis(1100)));
}

#[test]
fn native_visibility_guard_outlives_json_and_latches_a_later_activity_revocation() {
    let mut service = ScreenContextService::new(Arc::new(NoCapture)).unwrap();
    let reader = reader();
    let reply = ActivityReadReply::new(
        "owned visible payload",
        guard(&service, reader.clone(), None),
    )
    .unwrap();
    let visible = reply.visibility_guard().unwrap();
    serde_json::to_string(&reply).unwrap();
    drop(reply);
    assert!(visible.is_current());
    *reader.value.lock().unwrap() = None;
    assert!(!visible.is_current());
    *reader.value.lock().unwrap() = Some(row());
    let calls = reader.calls.load(Ordering::Relaxed);
    assert!(!visible.is_current());
    assert_eq!(reader.calls.load(Ordering::Relaxed), calls);
    assert!(service.shutdown(Duration::from_millis(1100)));
}

struct DeleteDuringSerialize(Arc<Reader>);
impl Serialize for DeleteDuringSerialize {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        *self.0.value.lock().unwrap() = None;
        serializer.serialize_str("owned partial secret payload")
    }
}

struct FailedSerialize;
impl Serialize for FailedSerialize {
    fn serialize<S: Serializer>(&self, _: S) -> Result<S::Ok, S::Error> {
        Err(serde::ser::Error::custom(
            "owned private serializer failure",
        ))
    }
}
#[test]
fn a_projection_serializer_error_is_redacted_and_permanently_invalidates_its_response() {
    let mut service = ScreenContextService::new(Arc::new(NoCapture)).unwrap();
    let reader = reader();
    let reply =
        ActivityReadReply::new(FailedSerialize, guard(&service, reader.clone(), None)).unwrap();
    let error = serde_json::to_string(&reply).unwrap_err().to_string();
    assert_eq!(error, "screen context activity invalidated");
    let calls = reader.calls.load(Ordering::Relaxed);
    assert!(serde_json::to_string(&reply).is_err());
    assert_eq!(reader.calls.load(Ordering::Relaxed), calls);
    assert!(service.shutdown(Duration::from_millis(1100)));
}
#[test]
fn deletion_during_serialization_discards_the_entire_response_and_native_projection_keeps_its_guard(
) {
    let mut service = ScreenContextService::new(Arc::new(NoCapture)).unwrap();
    let reader = reader();
    let reply = ActivityReadReply::new(7, guard(&service, reader.clone(), None))
        .unwrap()
        .try_map(|_| Ok(DeleteDuringSerialize(reader.clone())))
        .unwrap();
    let error = serde_json::to_string(&reply).unwrap_err().to_string();
    assert!(!error.contains("owned"));
    assert!(!error.contains("partial"));
    *reader.value.lock().unwrap() = Some(row());
    assert!(serde_json::to_string(&reply).is_err());
    assert!(service.shutdown(Duration::from_millis(1100)));
}

#[test]
fn account_aba_and_observation_invalidation_refuse_without_another_reader_query() {
    let mut service = ScreenContextService::new(Arc::new(NoCapture)).unwrap();
    let reader = reader();
    let gate = AccountGate::default();
    let scope = ScopeId::from_profile("owned-read-profile").unwrap();
    let first = gate
        .bind_verified(
            gate.begin_transition().unwrap(),
            scope.clone(),
            Instant::now() + Duration::from_secs(10),
        )
        .unwrap();
    let reply = ActivityReadReply::new(
        "owned",
        guard(&service, reader.clone(), Some(gate.read(first).unwrap())),
    )
    .unwrap();
    let calls = reader.calls.load(Ordering::Relaxed);
    gate.bind_verified(
        gate.begin_transition().unwrap(),
        scope,
        Instant::now() + Duration::from_secs(10),
    )
    .unwrap();
    assert!(serde_json::to_string(&reply).is_err());
    assert_eq!(reader.calls.load(Ordering::Relaxed), calls);
    let reply = ActivityReadReply::new("owned", guard(&service, reader.clone(), None)).unwrap();
    let calls = reader.calls.load(Ordering::Relaxed);
    service.invalidate_observations_now();
    assert!(serde_json::to_string(&reply).is_err());
    assert_eq!(reader.calls.load(Ordering::Relaxed), calls);
    assert!(service.shutdown(Duration::from_millis(1100)));
}

#[test]
fn natural_range_growth_keeps_the_same_binding_and_an_empty_response_never_starts_a_reader() {
    let mut service = ScreenContextService::new(Arc::new(NoCapture)).unwrap();
    let reader = reader();
    let reply = ActivityReadReply::new("owned", guard(&service, reader.clone(), None)).unwrap();
    reader.value.lock().unwrap().as_mut().unwrap()["endedAtMs"] = serde_json::json!(2000);
    assert!(serde_json::to_string(&reply).is_ok());
    let calls = reader.calls.load(Ordering::Relaxed);
    let reply = ActivityReadReply::new(
        Option::<String>::None,
        CurrentActivityGuard::new(service.observation_lease(), None, reader.clone(), vec![])
            .unwrap(),
    )
    .unwrap();
    assert_eq!(serde_json::to_string(&reply).unwrap(), "null");
    assert_eq!(reader.calls.load(Ordering::Relaxed), calls);
    assert!(service.shutdown(Duration::from_millis(1100)));
}
