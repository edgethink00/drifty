use super::*;
use crate::{activity_reader::CapturedActivityHint, LocalActivityRecordRef};
use std::sync::atomic::AtomicUsize;

struct NoCapture;
impl CaptureBackend for NoCapture {
    fn capture(
        &self,
        _: &CapturePolicy,
        _: &Cancellation,
    ) -> Result<NativeCapture, CaptureFailure> {
        unreachable!()
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
        _: &dyn Fn() -> bool,
    ) -> Result<Option<LocalActivityRecordRef>, Error> {
        unreachable!()
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
fn setup(
    root: &std::path::Path,
    resolver: Option<Arc<dyn ActivityResolver>>,
) -> (ScreenContextService, Uuid, Uuid) {
    let now = unix_millis().unwrap();
    let mut store = crate::tests::open(root, now);
    let legacy = store
        .append(
            store.generation(),
            crate::tests::evidence(now - 1),
            true,
            now,
        )
        .unwrap();
    let bound = store
        .append(store.generation(), crate::tests::evidence(now), true, now)
        .unwrap();
    let row:LocalActivityRecordRef=serde_json::from_value(serde_json::json!({"recordId":"1","segmentUid":"f26d8c10-cb09-4c98-a3e3-3744216aab1e","identityDigest":"a".repeat(64),"startedAtMs":now-1000,"endedAtMs":now+1000})).unwrap();
    assert!(store
        .bind_activity_if_current(store.generation(), bound, &row, now, &|| true)
        .unwrap()
        .is_some());
    let service = if let Some(resolver) = resolver {
        ScreenContextService::new_with_activity_resolver(Arc::new(NoCapture), resolver)
    } else {
        ScreenContextService::new(Arc::new(NoCapture))
    }
    .unwrap();
    service.replace_store(Some(store)).unwrap();
    service
        .set_policy(CapturePolicy {
            allowed_apps: BTreeSet::from(["owned.editor".into()]),
            ..CapturePolicy::default()
        })
        .unwrap();
    (service, legacy, bound)
}
fn page_ids(service: &ScreenContextService) -> Vec<Uuid> {
    let page = service.list_review_evidence(None, 20).unwrap();
    let value = serde_json::to_value(page).unwrap();
    serde_json::from_value(
        value["records"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v["id"].clone())
            .collect::<serde_json::Value>(),
    )
    .unwrap()
}
fn detail(
    service: &ScreenContextService,
    id: Uuid,
) -> ActivityReadReply<Option<(Uuid, String, bool)>> {
    service
        .read_review_evidence(id, true)
        .unwrap()
        .try_map(|value| {
            Ok(value.map(|v| {
                (
                    v.metadata.id,
                    v.metadata.text.as_str().to_owned(),
                    v.frame.is_some(),
                )
            }))
        })
        .unwrap()
}

#[test]
fn missing_optional_reader_keeps_legacy_review_and_never_downgrades_bound_content() {
    let temp = tempfile::tempdir().unwrap();
    let (mut service, legacy, bound) = setup(&temp.path().join("store"), None);
    assert_eq!(page_ids(&service), vec![legacy]);
    assert!(serde_json::to_value(detail(&service, legacy))
        .unwrap()
        .is_array());
    assert_eq!(
        serde_json::to_value(detail(&service, bound)).unwrap(),
        serde_json::Value::Null
    );
    assert!(service.shutdown(Duration::from_millis(1100)));
}

#[test]
fn settings_bound_page_and_detail_revalidate_and_old_responses_cannot_revive() {
    let temp = tempfile::tempdir().unwrap();
    let now = unix_millis().unwrap();
    let row=serde_json::from_value(serde_json::json!({"recordId":"1","segmentUid":"f26d8c10-cb09-4c98-a3e3-3744216aab1e","identityDigest":"a".repeat(64),"startedAtMs":now-10000,"endedAtMs":now+10000})).unwrap();
    let reader = Arc::new(Reader {
        row: Mutex::new(Some(row)),
        calls: AtomicUsize::new(0),
    });
    let (mut service, legacy, bound) = setup(&temp.path().join("store"), Some(reader.clone()));
    assert_eq!(page_ids(&service), vec![bound, legacy]);
    let page = service.list_review_evidence(None, 20).unwrap();
    let old = detail(&service, bound);
    assert_eq!(
        serde_json::to_value(&page).unwrap()["records"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    let good = serde_json::to_value(&old).unwrap();
    assert_eq!(good[0], bound.to_string());
    assert_eq!(good[2], true);
    let saved = reader.row.lock().unwrap().take();
    assert!(serde_json::to_value(&page).is_err());
    assert!(serde_json::to_value(&old).is_err());
    assert_eq!(page_ids(&service), vec![legacy]);
    assert_eq!(
        serde_json::to_value(detail(&service, bound)).unwrap(),
        serde_json::Value::Null
    );
    *reader.row.lock().unwrap() = saved;
    assert!(serde_json::to_value(&page).is_err());
    assert!(serde_json::to_value(&old).is_err());
    assert!(service.shutdown(Duration::from_millis(1100)));
}
