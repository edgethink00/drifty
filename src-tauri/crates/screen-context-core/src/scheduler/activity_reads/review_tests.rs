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

#[test]
fn memory_snapshot_distinguishes_reader_failure_from_confirmed_missing_rows() {
    struct Busy;
    impl ActivityResolver for Busy {
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
            _: &dyn Fn() -> bool,
        ) -> Result<Vec<LocalActivityRecordRef>, Error> {
            Err(Error::WorkerUnavailable)
        }
        fn reset(&self) {}
    }
    let temp = tempfile::tempdir().unwrap();
    let (mut service, legacy, bound) = setup(&temp.path().join("busy"), Some(Arc::new(Busy)));
    assert_eq!(page_ids(&service), vec![legacy]);
    assert!(matches!(
        service.list_memory_evidence(None, 20),
        Err(Error::WorkerUnavailable)
    ));
    assert!(matches!(
        service.read_memory_evidence(bound),
        Err(Error::WorkerUnavailable)
    ));
    assert!(matches!(
        service.read_memory_page(None, 64),
        Err(Error::WorkerUnavailable)
    ));
    assert!(matches!(
        service.read_review_evidence_strict(bound, true),
        Err(Error::WorkerUnavailable)
    ));
    assert!(service.shutdown(Duration::from_millis(1100)));

    let reader = Arc::new(Reader {
        row: Mutex::new(None),
        calls: AtomicUsize::new(0),
    });
    let (mut service, legacy, bound) = setup(&temp.path().join("deleted"), Some(reader));
    let page = serde_json::to_value(service.list_memory_evidence(None, 20).unwrap()).unwrap();
    assert_eq!(page["records"].as_array().unwrap().len(), 1);
    assert_eq!(page["records"][0]["id"], legacy.to_string());
    assert!(serde_json::to_value(
        service
            .read_memory_evidence(bound)
            .unwrap()
            .try_map(|v| Ok(v.map(|x| x.metadata.id)))
            .unwrap()
    )
    .unwrap()
    .is_null());
    assert!(service.shutdown(Duration::from_millis(1100)));
}

#[test]
fn memory_page_batches_activity_proofs_without_reviving_deleted_content() {
    let temp = tempfile::tempdir().unwrap();
    let now = unix_millis().unwrap();
    let row: LocalActivityRecordRef = serde_json::from_value(serde_json::json!({
        "recordId":"1", "segmentUid":"f26d8c10-cb09-4c98-a3e3-3744216aab1e",
        "identityDigest":"a".repeat(64), "startedAtMs":now-10000, "endedAtMs":now+10000
    }))
    .unwrap();
    let reader = Arc::new(Reader {
        row: Mutex::new(Some(row.clone())),
        calls: AtomicUsize::new(0),
    });
    let mut store = crate::tests::open(&temp.path().join("batch"), now);
    let mut ids = Vec::new();
    for offset in 0..64 {
        let id = store
            .append(
                store.generation(),
                crate::tests::evidence(now - offset),
                true,
                now,
            )
            .unwrap();
        store
            .bind_activity_if_current(store.generation(), id, &row, now, &|| true)
            .unwrap()
            .unwrap();
        ids.push(id);
    }
    let mut service =
        ScreenContextService::new_with_activity_resolver(Arc::new(NoCapture), reader.clone())
            .unwrap();
    service.replace_store(Some(store)).unwrap();
    service
        .set_policy(CapturePolicy {
            allowed_apps: BTreeSet::from(["owned.editor".into()]),
            ..CapturePolicy::default()
        })
        .unwrap();

    // The former snapshot performed a guarded detail lookup for every source.
    let page = serde_json::to_value(service.list_memory_evidence(None, 64).unwrap()).unwrap();
    let mut individual = Vec::new();
    for record in page["records"].as_array().unwrap() {
        let id = serde_json::from_value(record["id"].clone()).unwrap();
        individual.push(
            service
                .read_memory_evidence(id)
                .unwrap()
                .try_map(|value| Ok(value.map(|v| v.metadata.id)))
                .unwrap(),
        );
    }
    assert_eq!(
        serde_json::to_value(individual)
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        64
    );
    let individual_queries = reader.calls.swap(0, Ordering::Relaxed);

    let batch = service
        .read_memory_page(None, 64)
        .unwrap()
        .try_map(|page| {
            assert!(page.next_cursor.is_none());
            Ok(page.records.into_iter().map(|m| m.id).collect::<Vec<_>>())
        })
        .unwrap();
    let actual: Vec<Uuid> = serde_json::from_value(serde_json::to_value(&batch).unwrap()).unwrap();
    assert_eq!(actual, ids);
    let batched_queries = reader.calls.load(Ordering::Relaxed);
    assert!(individual_queries > batched_queries * 8);
    assert!(
        batched_queries <= 8,
        "activity checks must remain page-bounded"
    );
    println!("memory sources=64 individual_queries={individual_queries} batched_queries={batched_queries}");

    let saved = reader.row.lock().unwrap().take();
    assert!(serde_json::to_value(&batch).is_err());
    let absent = service
        .read_memory_page(None, 64)
        .unwrap()
        .try_map(|p| Ok(p.records.len()))
        .unwrap();
    assert_eq!(serde_json::to_value(absent).unwrap(), 0);
    *reader.row.lock().unwrap() = saved;
    assert!(
        serde_json::to_value(&batch).is_err(),
        "a failed proof cannot revive"
    );
    let fresh = service
        .read_memory_page(None, 64)
        .unwrap()
        .try_map(|p| Ok(p.records.len()))
        .unwrap();
    assert_eq!(serde_json::to_value(fresh).unwrap(), 64);
    assert!(service.shutdown(Duration::from_millis(1100)));
}

#[test]
fn time_replay_reads_unbound_screens_only_with_current_selected_points_and_revokes_visible_data() {
    struct ReplayReader {
        rows: Mutex<Vec<LocalActivityRecordRef>>,
    }
    impl ActivityResolver for ReplayReader {
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
            _: &dyn Fn() -> bool,
        ) -> Result<Vec<LocalActivityRecordRef>, Error> {
            Ok(vec![])
        }
        fn read_replay_current(
            &self,
            ids: &[String],
            current: &dyn Fn() -> bool,
        ) -> Result<Vec<LocalActivityRecordRef>, Error> {
            assert!(current());
            Ok(self
                .rows
                .lock()
                .unwrap()
                .iter()
                .filter(|r| ids.iter().any(|id| id == r.record_id()))
                .cloned()
                .collect())
        }
        fn reset(&self) {}
    }
    let temp = tempfile::tempdir().unwrap();
    let now = unix_millis().unwrap();
    let reference = |start, end, uid| {
        serde_json::from_value::<LocalActivityRecordRef>(serde_json::json!({
        "recordId":"7", "segmentUid":uid, "identityDigest":"b".repeat(64), "startedAtMs":start, "endedAtMs":end
    })).unwrap()
    };
    let uid = Uuid::new_v4().to_string();
    let reader = Arc::new(ReplayReader {
        rows: Mutex::new(vec![reference(now - 5000, now + 5000, &uid)]),
    });
    let mut store = crate::tests::open(&temp.path().join("replay"), now);
    let mut frames = Vec::new();
    for point in [now - 6000, now - 2000, now - 1000] {
        frames.push(
            store
                .append(store.generation(), crate::tests::evidence(point), true, now)
                .unwrap(),
        );
    }
    // A formerly exact-bound screen can share this interval after its source
    // disappears. It stays hidden without suppressing valid time-only screens.
    let stale = store
        .append(
            store.generation(),
            crate::tests::evidence(now - 3000),
            true,
            now,
        )
        .unwrap();
    assert!(store
        .bind_activity_if_current(
            store.generation(),
            stale,
            &reader.rows.lock().unwrap()[0],
            now,
            &|| true
        )
        .unwrap()
        .is_some());
    let service =
        ScreenContextService::new_with_activity_resolver(Arc::new(NoCapture), reader.clone())
            .unwrap();
    service.replace_store(Some(store)).unwrap();
    service
        .set_policy(CapturePolicy {
            allowed_apps: BTreeSet::from(["owned.editor".into()]),
            ..Default::default()
        })
        .unwrap();
    let ids = vec!["7".into()];
    let windows = [[now - 10000, now - 1000]];
    let skipped = serde_json::to_value(
        service
            .list_replay_evidence_in_windows(&ids, None, 1, &windows)
            .unwrap(),
    )
    .unwrap();
    assert_eq!(skipped["records"].as_array().unwrap().len(), 0);
    assert!(
        !skipped["nextCursor"].is_null(),
        "a hidden bound row must preserve the scan cursor"
    );
    assert!(
        service
            .read_replay_evidence_in_windows(stale, true, &ids, &windows)
            .is_err(),
        "no downgrade of stale bound detail"
    );
    let page = service
        .list_replay_evidence_in_windows(&ids, None, 20, &windows)
        .unwrap();
    let shown = serde_json::to_value(&page).unwrap();
    assert_eq!(
        shown["records"].as_array().unwrap().len(),
        1,
        "native row intersection and half-open view bounds"
    );
    assert_eq!(shown["records"][0]["id"], frames[1].to_string());
    let exact =
        serde_json::to_value(service.list_activity_evidence(&ids, None, 20).unwrap()).unwrap();
    assert_eq!(
        exact["records"].as_array().unwrap().len(),
        0,
        "Replay must not manufacture an exact/AI binding"
    );
    assert_eq!(
        serde_json::to_value(
            service
                .read_replay_evidence_in_windows(frames[0], true, &ids, &windows)
                .unwrap()
                .try_map(|v| Ok(v.is_none()))
                .unwrap()
        )
        .unwrap(),
        true
    );
    let detail = service
        .read_replay_evidence_in_windows(frames[1], true, &ids, &windows)
        .unwrap()
        .try_map(|v| Ok(v.unwrap().frame.is_some()))
        .unwrap();
    assert_eq!(serde_json::to_value(&detail).unwrap(), true);
    let guard = page.visibility_guard().unwrap();
    reader.rows.lock().unwrap().clear();
    assert!(
        !guard.is_current(),
        "deleted activity invalidates visible Replay"
    );
    assert!(serde_json::to_value(&detail).is_err());
    reader
        .rows
        .lock()
        .unwrap()
        .push(reference(now - 5000, now + 5000, &uid));
    assert!(
        serde_json::to_value(&detail).is_err(),
        "old reply cannot revive after a removed row returns"
    );
    let fresh = service
        .list_replay_evidence_in_windows(&ids, None, 20, &windows)
        .unwrap();
    reader.rows.lock().unwrap()[0] = reference(now - 1500, now + 5000, &uid);
    assert!(
        serde_json::to_value(&fresh).is_err(),
        "trimmed point invalidates old view"
    );
    let fresh = service
        .list_replay_evidence_in_windows(&ids, None, 20, &windows)
        .unwrap();
    assert_eq!(
        serde_json::to_value(fresh).unwrap()["records"]
            .as_array()
            .unwrap()
            .len(),
        0
    );
    assert!(service
        .list_replay_evidence_in_windows(&ids, None, 20, &[[now, now]])
        .is_err());
}
