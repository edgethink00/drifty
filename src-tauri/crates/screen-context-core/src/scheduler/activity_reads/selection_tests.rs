use super::*;
use crate::{activity_reader::CapturedActivityHint, store::NewEvidence, MemorySourceSelection};
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
    row: Mutex<Option<crate::LocalActivityRecordRef>>,
    busy: AtomicBool,
    calls: AtomicUsize,
}
impl ActivityResolver for Reader {
    fn resolve_capture(
        &self,
        _: &CapturedActivityHint,
        _: &dyn Fn() -> bool,
    ) -> Result<Option<crate::LocalActivityRecordRef>, Error> {
        unreachable!()
    }
    fn read_current(
        &self,
        _: &[String],
        current: &dyn Fn() -> bool,
    ) -> Result<Vec<crate::LocalActivityRecordRef>, Error> {
        assert!(current());
        self.calls.fetch_add(1, Ordering::Relaxed);
        if self.busy.load(Ordering::Relaxed) {
            return Err(Error::WorkerUnavailable);
        }
        Ok(self.row.lock().unwrap().clone().into_iter().collect())
    }
    fn reset(&self) {}
}
fn activity(start: i64, end: i64) -> crate::LocalActivityRecordRef {
    serde_json::from_value(serde_json::json!({
        "recordId":"1", "segmentUid":"f26d8c10-cb09-4c98-a3e3-3744216aab1e",
        "identityDigest":"a".repeat(64), "startedAtMs":start, "endedAtMs":end
    }))
    .unwrap()
}
fn evidence(at: i64, text: &str) -> NewEvidence {
    let mut row = crate::tests::evidence(at);
    row.text = TextEvidence::new(
        TextSource::Ocr,
        TextState::Recognized,
        text.to_owned().into(),
    )
    .unwrap();
    row
}
fn setup(
    rows: Vec<NewEvidence>,
) -> (
    tempfile::TempDir,
    ScreenContextService,
    Arc<Reader>,
    Vec<Uuid>,
) {
    let temp = tempfile::tempdir().unwrap();
    let now = unix_millis().unwrap();
    let row = activity(now - 86_400_000, now + 60_000);
    let reader = Arc::new(Reader {
        row: Mutex::new(Some(row.clone())),
        busy: AtomicBool::new(false),
        calls: AtomicUsize::new(0),
    });
    let earliest = rows.iter().map(|r| r.observed_at_ms).min().unwrap_or(now);
    let mut store = crate::tests::open(&temp.path().join("evidence"), earliest);
    let mut ids = vec![Uuid::nil(); rows.len()];
    let mut ordered: Vec<_> = rows.into_iter().enumerate().collect();
    ordered.sort_by_key(|(_, r)| r.observed_at_ms);
    for (index, evidence) in ordered {
        // Simulate normal capture/binding at that instant, then read the retained
        // catalog at real now. Do not weaken the native binding freshness limit.
        let captured_at = evidence.observed_at_ms;
        let id = store
            .append(store.generation(), evidence, false, captured_at)
            .unwrap();
        store
            .bind_activity_if_current(store.generation(), id, &row, captured_at, &|| true)
            .unwrap()
            .unwrap();
        ids[index] = id;
    }
    let service =
        ScreenContextService::new_with_activity_resolver(Arc::new(NoCapture), reader.clone())
            .unwrap();
    service.replace_store(Some(store)).unwrap();
    service
        .set_policy(CapturePolicy {
            allowed_apps: BTreeSet::from(["owned.editor".into(), "owned.second".into()]),
            ..CapturePolicy::default()
        })
        .unwrap();
    (temp, service, reader, ids)
}
fn selection(hours: u32) -> MemorySourceSelection {
    MemorySourceSelection::new(
        BTreeSet::from(["owned.editor".into(), "owned.second".into()]),
        hours,
    )
    .unwrap()
}
fn selected(service: &ScreenContextService, hours: u32) -> Vec<Uuid> {
    let lease = service.observation_lease();
    let mut selection = selection(hours);
    let mut cursor = None;
    let mut pages = Vec::new();
    loop {
        pages.push(
            service
                .read_memory_selection_page(cursor.take(), &mut selection)
                .unwrap()
                .try_map(|page| {
                    cursor = page.next_cursor;
                    Ok(page.records.iter().map(|m| m.id).collect::<Vec<_>>())
                })
                .unwrap(),
        );
        if cursor.is_none() || selection.is_full() {
            break;
        }
    }
    let pages: Vec<Vec<Uuid>> =
        serde_json::from_value(serde_json::to_value(lease.reply(pages).unwrap()).unwrap()).unwrap();
    pages.into_iter().flatten().collect()
}

#[test]
fn repeated_captures_do_not_evict_an_earlier_distinct_work_context() {
    let now = unix_millis().unwrap();
    let mut rows = vec![evidence(now - 513 * 30_000, "A: export review pending")];
    for i in 0..512 {
        rows.push(evidence(now - (511 - i) * 30_000, "B: import still open"));
    }
    let (_temp, mut service, reader, ids) = setup(rows);
    let started = Instant::now();
    assert_eq!(selected(&service, 24), vec![ids[512], ids[0]]);
    let queries = reader.calls.load(Ordering::Relaxed);
    assert!(
        queries <= 16,
        "duplicate-only pages must not add tracker queries: {queries}"
    );
    println!(
        "memory selection raw=513 selected=2 activity_queries={queries} seconds={:.3}",
        started.elapsed().as_secs_f64()
    );
    // The representative changes on deletion; original observations remain in
    // the store, and a fresh supported duplicate can still supply the group.
    service.delete_record(ids[512]).unwrap();
    assert_eq!(selected(&service, 24), vec![ids[511], ids[0]]);
    assert!(service.read_metadata(ids[1]).unwrap().is_some());
    assert!(service.shutdown(Duration::from_millis(1100)));
}

#[test]
fn selection_keeps_changed_content_and_each_grouping_field_distinct() {
    let now = unix_millis().unwrap();
    let mut rows = vec![
        evidence(now - 6, "Review Tuesday"),
        evidence(now - 5, "Review Wednesday"),
    ];
    let mut doc = evidence(now - 4, "Review Wednesday");
    doc.surface.document_id = "second-document".into();
    rows.push(doc);
    let mut app = evidence(now - 3, "Review Wednesday");
    app.surface.app_id = "owned.second".into();
    rows.push(app);
    let mut ax = evidence(now - 2, "Review Wednesday");
    ax.text = TextEvidence::new(
        TextSource::Accessibility,
        TextState::Recognized,
        "Review Wednesday".to_owned().into(),
    )
    .unwrap();
    rows.push(ax);
    rows.push(evidence(now - 1, "Review Wednesday"));
    let (_temp, mut service, _, ids) = setup(rows);
    assert_eq!(
        selected(&service, 24),
        vec![ids[5], ids[4], ids[3], ids[2], ids[0]]
    );
    assert!(service.shutdown(Duration::from_millis(1100)));
}

#[test]
fn selection_still_caps_distinct_groups_at_500_newest_sources() {
    let now = unix_millis().unwrap();
    let rows = (0..501)
        .map(|i| evidence(now - (500 - i), &format!("Distinct work {i}")))
        .collect();
    let (_temp, mut service, _, ids) = setup(rows);
    assert_eq!(
        selected(&service, 24),
        ids[1..].iter().rev().copied().collect::<Vec<_>>()
    );
    assert!(service.shutdown(Duration::from_millis(1100)));
}

#[test]
fn expired_disallowed_and_empty_sources_do_not_consume_selection_slots() {
    let now = unix_millis().unwrap();
    let mut disallowed = evidence(now - 2, "Not selected");
    disallowed.surface.app_id = "owned.unselected".into();
    let mut empty = evidence(now - 1, "placeholder");
    empty.text = TextEvidence::not_requested();
    let (_temp, mut service, _, ids) = setup(vec![
        evidence(now - 7_200_000, "Old context"),
        evidence(now - 3, "Current context"),
        disallowed,
        empty,
    ]);
    assert_eq!(selected(&service, 1), vec![ids[1]]);
    assert_eq!(selected(&service, 24), vec![ids[1], ids[0]]);
    assert!(service.shutdown(Duration::from_millis(1100)));
}

#[test]
fn unsupported_latest_duplicate_does_not_hide_an_older_supported_source() {
    let now = unix_millis().unwrap();
    let (_temp, mut service, reader, ids) = setup(vec![
        evidence(now - 10_000, "Same work"),
        evidence(now - 1000, "Same work"),
    ]);
    *reader.row.lock().unwrap() = Some(activity(now - 20_000, now - 5000));
    assert_eq!(selected(&service, 24), vec![ids[0]]);
    assert!(service.shutdown(Duration::from_millis(1100)));
}

#[test]
fn selected_sources_revalidate_and_failed_selection_cannot_resume() {
    let now = unix_millis().unwrap();
    let (_temp, mut service, reader, ids) = setup(vec![
        evidence(now - 1, "Same work"),
        evidence(now, "Same work"),
    ]);
    let mut selection = selection(24);
    let page = service
        .read_memory_selection_page(None, &mut selection)
        .unwrap()
        .try_map(|p| Ok(p.records.iter().map(|m| m.id).collect::<Vec<_>>()))
        .unwrap();
    assert_eq!(
        serde_json::to_value(&page).unwrap(),
        serde_json::json!([ids[1]])
    );
    let saved = reader.row.lock().unwrap().take();
    assert!(serde_json::to_value(&page).is_err());
    *reader.row.lock().unwrap() = saved;
    assert!(serde_json::to_value(&page).is_err());
    reader.busy.store(true, Ordering::Relaxed);
    let mut failed = super::selection_tests::selection(24);
    assert!(matches!(
        service.read_memory_selection_page(None, &mut failed),
        Err(Error::WorkerUnavailable)
    ));
    reader.busy.store(false, Ordering::Relaxed);
    assert!(service
        .read_memory_selection_page(None, &mut failed)
        .is_err());
    assert_eq!(selected(&service, 24), vec![ids[1]]);
    assert!(service.shutdown(Duration::from_millis(1100)));
}

#[test]
fn deletion_between_pages_invalidates_the_whole_selection() {
    let now = unix_millis().unwrap();
    let rows = (0..65).map(|i| evidence(now - i, "Same work")).collect();
    let (_temp, mut service, _, ids) = setup(rows);
    let mut selection = selection(24);
    let mut cursor = None;
    let page = service
        .read_memory_selection_page(None, &mut selection)
        .unwrap()
        .try_map(|p| {
            cursor = p.next_cursor;
            Ok(p.records.len())
        })
        .unwrap();
    assert!(cursor.is_some());
    service.delete_record(ids[0]).unwrap();
    assert!(service
        .read_memory_selection_page(cursor, &mut selection)
        .is_err());
    assert!(serde_json::to_value(page).is_err());
    assert!(service.shutdown(Duration::from_millis(1100)));
}

#[test]
fn exact_citation_survives_representative_rotation_but_not_deletion_or_expiry() {
    let now = unix_millis().unwrap();
    let (_temp, mut service, reader, ids) = setup(vec![
        evidence(now - 7_200_000, "Same work"), evidence(now, "Same work")]);
    assert_eq!(selected(&service, 24), vec![ids[1]]);
    let mut selection = selection(24);
    let cited = service.read_memory_selection_source(ids[0], &mut selection).unwrap()
        .try_map(|v| Ok(v.map(|v| v.metadata.id))).unwrap();
    assert_eq!(serde_json::to_value(&cited).unwrap(), serde_json::json!(ids[0]));
    // The preferred original consumes the group's single slot in this request.
    let rest = service.read_memory_selection_page(None, &mut selection).unwrap()
        .try_map(|p| Ok(p.records.len())).unwrap();
    assert_eq!(serde_json::to_value(rest).unwrap(), 0);
    let mut short = super::selection_tests::selection(1);
    let expired = service.read_memory_selection_source(ids[0], &mut short).unwrap()
        .try_map(|v| Ok(v.map(|v| v.metadata.id))).unwrap();
    assert!(serde_json::to_value(expired).unwrap().is_null());
    service.delete_record(ids[0]).unwrap();
    assert!(serde_json::to_value(cited).is_err());
    let mut fresh = super::selection_tests::selection(24);
    let absent = service.read_memory_selection_source(ids[0], &mut fresh).unwrap()
        .try_map(|v| Ok(v.map(|v| v.metadata.id))).unwrap();
    assert!(serde_json::to_value(absent).unwrap().is_null());
    reader.busy.store(true, Ordering::Relaxed);
    assert!(matches!(service.read_memory_selection_source(ids[1], &mut fresh), Err(Error::WorkerUnavailable)));
    assert!(service.shutdown(Duration::from_millis(1100)));
}
