use super::*;
use std::collections::BTreeSet;

fn record() -> LocalActivityRecordRef {
    serde_json::from_value(serde_json::json!({"recordId":"864290113",
        "segmentUid":"f26d8c10-cb09-4c98-a3e3-3744216aab1e", "identityDigest":"a".repeat(64),
        "startedAtMs":900,"endedAtMs":2000}))
    .unwrap()
}
fn changed(
    record: &LocalActivityRecordRef,
    key: &str,
    value: serde_json::Value,
) -> LocalActivityRecordRef {
    let mut wire = serde_json::to_value(record).unwrap();
    wire[key] = value;
    serde_json::from_value(wire).unwrap()
}
fn header(store: &EvidenceStore, id: Uuid) -> Vec<u8> {
    store
        .db
        .query_row(
            "SELECT header FROM evidence WHERE id=?1",
            [id.to_string()],
            |r| r.get(0),
        )
        .unwrap()
}
fn append(store: &mut EvidenceStore, at: i64) -> Uuid {
    store
        .append(store.generation(), crate::tests::evidence(at), true, at)
        .unwrap()
}

#[test]
fn view_windows_filter_before_pagination_and_keep_half_open_dst_gaps() {
    let temp = tempfile::tempdir().unwrap();
    let mut store = crate::tests::open(&temp.path().join("store"), 1000);
    let row = record();
    let mut ids = Vec::new();
    for at in [1000, 1100, 1200, 1300] {
        let id = append(&mut store, at);
        assert!(store
            .bind_activity_if_current(store.generation(), id, &row, at, &|| true)
            .unwrap()
            .is_some());
        ids.push(id);
    }
    let ranges = [[1000, 1100], [1200, 1300]];
    let first = store
        .list_bound_page_in_windows(
            std::slice::from_ref(&row),
            None,
            1,
            &BTreeSet::new(),
            Some(&ranges),
            1301,
        )
        .unwrap();
    assert_eq!(
        first.records.iter().map(|r| r.id).collect::<Vec<_>>(),
        vec![ids[0]]
    );
    let second = store
        .list_bound_page_in_windows(
            std::slice::from_ref(&row),
            first.next_cursor,
            1,
            &BTreeSet::new(),
            Some(&ranges),
            1301,
        )
        .unwrap();
    assert_eq!(
        second.records.iter().map(|r| r.id).collect::<Vec<_>>(),
        vec![ids[2]]
    );
    assert!(second.next_cursor.is_none());
    assert!(store
        .list_bound_page_in_windows(
            std::slice::from_ref(&row),
            None,
            20,
            &BTreeSet::from(["owned.editor".into()]),
            Some(&ranges),
            1301
        )
        .unwrap()
        .records
        .is_empty());
    for bad in [
        vec![],
        vec![[1000, 1000]],
        vec![[-1, 1000]],
        vec![[1000, 1200], [1100, 1300]],
        vec![[1000, 1100], [1100, 1200]],
    ] {
        assert!(store
            .list_bound_page_in_windows(
                std::slice::from_ref(&row),
                None,
                20,
                &BTreeSet::new(),
                Some(&bad),
                1301
            )
            .is_err());
    }
}

#[test]
fn explicit_single_screen_deletion_preserves_its_same_timestamp_neighbor_and_keeps_capture_running() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("store");
    let mut store = crate::tests::open(&root, 1000);
    let first = append(&mut store, 1000);
    let second = append(&mut store, 1000);
    let retained = fs::read(store.frame_path(second)).unwrap();
    let page = store.list_page(None, 1, 1000).unwrap();
    let deletion = store.delete_record(first, 1001).unwrap();
    assert_eq!(deletion.removed, vec![first]);
    // One screen's deletion never pauses capture; range and full deletion do.
    assert!(!store.capture_paused());
    assert!(store.read_metadata(first, 1001).unwrap().is_none());
    assert!(store.read_metadata(second, 1001).unwrap().is_some());
    assert_eq!(fs::read(store.frame_path(second)).unwrap(), retained);
    assert!(store.list_page(page.next_cursor, 20, 1001).is_err());
    assert!(store.delete_record(first, 1002).unwrap().removed.is_empty());
    drop(store);
    let mut reopened = crate::tests::open(&root, 1003);
    assert!(!reopened.capture_paused());
    assert!(reopened.read_metadata(first, 1003).unwrap().is_none());
    assert!(reopened.read_metadata(second, 1003).unwrap().is_some());
    assert_eq!(fs::read(reopened.frame_path(second)).unwrap(), retained);
}

#[test]
fn encrypted_binding_survives_reopen_with_same_frame_expiry_and_no_plaintext_reference() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("store");
    let mut store = crate::tests::open(&root, 1000);
    let id = append(&mut store, 1000);
    let row = record();
    let before = header(&store, id);
    let frame = fs::read(store.frame_path(id)).unwrap();
    let expires = store
        .read_metadata(id, 1000)
        .unwrap()
        .unwrap()
        .expires_at_ms;
    let generation = store.generation();
    let proof = store
        .bind_activity_if_current(generation, id, &row, 1001, &|| true)
        .unwrap()
        .unwrap();
    assert!(proof.matches(&row, 1000));
    assert_eq!(store.generation(), generation);
    let after = header(&store, id);
    assert_ne!(before, after);
    assert_ne!(&before[17..29], &after[17..29]);
    assert_eq!(fs::read(store.frame_path(id)).unwrap(), frame);
    let metadata = store.read_bound_metadata(id, &row, 1001).unwrap().unwrap();
    assert_eq!(metadata.expires_at_ms, expires);
    assert!(metadata.tracker_record_id.is_none());
    let value = serde_json::to_value(&metadata).unwrap();
    assert_eq!(value["metadataVersion"], 3);
    assert!(!value.as_object().unwrap().contains_key("trackerRecordId"));
    assert!(!format!("{metadata:?}{proof:?}{row:?}").contains(row.record_id()));
    let catalog = fs::read(store.directory.join(CATALOG)).unwrap();
    for secret in [
        row.record_id().as_bytes(),
        b"f26d8c10-cb09-4c98-a3e3-3744216aab1e",
    ] {
        assert!(!catalog.windows(secret.len()).any(|b| b == secret));
    }
    let pages: u32 = store
        .db
        .query_row(
            "SELECT count(*) FROM sqlite_schema WHERE type='table'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(pages, 3);
    drop(metadata);
    drop(store);
    let mut reopened = crate::tests::open(&root, 1002);
    assert!(reopened
        .read_bound_metadata(id, &row, 1002)
        .unwrap()
        .is_some());
    assert_eq!(
        reopened
            .read_bound_frame(id, &row, 1002)
            .unwrap()
            .unwrap()
            .bytes(),
        crate::tests::evidence(1000).frame.bytes()
    );
    let extended = changed(&row, "endedAtMs", 3000.into());
    let sealed = header(&reopened, id);
    assert!(reopened
        .bind_activity_if_current(reopened.generation(), id, &extended, 1003, &|| true)
        .unwrap()
        .is_some());
    assert_eq!(header(&reopened, id), sealed);
}

#[test]
fn current_uid_identity_and_half_open_range_all_gate_reads_without_rebinding() {
    let temp = tempfile::tempdir().unwrap();
    let mut store = crate::tests::open(&temp.path().join("store"), 1000);
    let id = append(&mut store, 1000);
    let row = record();
    store
        .bind_activity_if_current(store.generation(), id, &row, 1001, &|| true)
        .unwrap();
    for changed in [
        changed(&row, "segmentUid", Uuid::new_v4().to_string().into()),
        changed(&row, "identityDigest", "b".repeat(64).into()),
        changed(&row, "recordId", "864290114".into()),
        changed(&row, "startedAtMs", 1001.into()),
        changed(&row, "endedAtMs", 1000.into()),
    ] {
        assert!(store
            .read_bound_metadata(id, &changed, 1002)
            .unwrap()
            .is_none());
        assert!(store
            .read_bound_frame(id, &changed, 1002)
            .unwrap()
            .is_none());
        assert!(store
            .list_bound_page(&[changed], None, 20, &BTreeSet::new(), 1002)
            .unwrap()
            .records
            .is_empty());
    }
    let reused = changed(&row, "segmentUid", Uuid::new_v4().to_string().into());
    assert!(matches!(
        store.bind_activity_if_current(store.generation(), id, &reused, 1002, &|| true),
        Err(Error::Invalidated)
    ));
    assert!(store
        .read_bound_metadata(id, &row, 11001)
        .unwrap()
        .is_some()); // Historical read, not a new hint.
}

#[test]
fn cancelled_binding_restores_exact_header_and_keeps_older_valid_frames() {
    let temp = tempfile::tempdir().unwrap();
    let mut store = crate::tests::open(&temp.path().join("store"), 1000);
    let first = append(&mut store, 1000);
    let second = append(&mut store, 1001);
    let previous = header(&store, first);
    let frame1 = fs::read(store.frame_path(first)).unwrap();
    let frame2 = fs::read(store.frame_path(second)).unwrap();
    let cursor = store.list_page(None, 1, 1001).unwrap().next_cursor.unwrap();
    let observer = Connection::open_with_flags(
        store.directory.join(CATALOG),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .unwrap();
    observer
        .busy_timeout(std::time::Duration::from_millis(50))
        .unwrap();
    // The actual second SQLite reader sees the old header until COMMIT, then
    // withdraws the predicate. No dependence on implementation call counts.
    let current = || {
        observer
            .query_row(
                "SELECT header FROM evidence WHERE id=?1",
                [first.to_string()],
                |r| r.get::<_, Vec<u8>>(0),
            )
            .is_ok_and(|b| b == previous)
    };
    assert!(matches!(
        store.bind_activity_if_current(store.generation(), first, &record(), 1002, &current),
        Err(Error::Invalidated)
    ));
    assert_eq!(header(&store, first), previous);
    assert!(store
        .read_metadata(first, 1002)
        .unwrap()
        .unwrap()
        .activity_binding
        .is_none());
    assert_eq!(fs::read(store.frame_path(first)).unwrap(), frame1);
    assert_eq!(fs::read(store.frame_path(second)).unwrap(), frame2);
    assert!(matches!(
        store.list_page(Some(cursor), 1, 1002),
        Err(Error::Invalidated)
    ));
    assert_eq!(store.list_page(None, 20, 1002).unwrap().records.len(), 2);
}

#[test]
fn stale_missing_uncovered_legacy_paused_and_revoked_writes_cannot_associate() {
    let temp = tempfile::tempdir().unwrap();
    let mut store = crate::tests::open(&temp.path().join("store"), 1000);
    let id = append(&mut store, 1000);
    let previous = header(&store, id);
    let row = record();
    assert!(matches!(
        store.bind_activity_if_current(store.generation(), id, &row, 1001, &|| false),
        Err(Error::Invalidated)
    ));
    assert!(store
        .bind_activity_if_current(store.generation(), Uuid::new_v4(), &row, 1001, &|| true)
        .unwrap()
        .is_none());
    let outside = changed(&row, "startedAtMs", 1001.into());
    assert!(store
        .bind_activity_if_current(store.generation(), id, &outside, 1001, &|| true)
        .unwrap()
        .is_none());
    assert!(store
        .bind_activity_if_current(store.generation(), id, &row, 11001, &|| true)
        .unwrap()
        .is_none());
    assert_eq!(header(&store, id), previous);
    let mut old = crate::tests::evidence(11001);
    old.tracker_record_id = Some(row.record_id().into());
    let old_id = store.append(store.generation(), old, true, 11001).unwrap();
    let old_row = changed(&row, "endedAtMs", 12000.into());
    assert!(matches!(
        store.bind_activity_if_current(store.generation(), old_id, &old_row, 11002, &|| true),
        Err(Error::Invalidated)
    ));
    assert!(store
        .read_bound_metadata(old_id, &old_row, 11002)
        .unwrap()
        .is_none());
    let generation = store.generation();
    store.pause_capture().unwrap();
    assert!(matches!(
        store.bind_activity_if_current(generation, id, &row, 11002, &|| true),
        Err(Error::Invalidated)
    ));
    assert!(store
        .read_metadata(id, 11002)
        .unwrap()
        .unwrap()
        .activity_binding
        .is_none());
}

#[test]
fn current_reference_filter_precedes_pagination_and_preserves_capture_duration_boundary() {
    let temp = tempfile::tempdir().unwrap();
    let mut store = crate::tests::open(&temp.path().join("store"), 1000);
    let row = record();
    let mut expected = Vec::new();
    for offset in 0..7 {
        let id = append(&mut store, 1000 + offset);
        if offset % 3 != 0 {
            store
                .bind_activity_if_current(store.generation(), id, &row, 1000 + offset, &|| true)
                .unwrap();
            expected.push(id);
        }
    }
    let mut cursor = None;
    let mut found = Vec::new();
    loop {
        let page = store
            .list_bound_page(
                std::slice::from_ref(&row),
                cursor,
                1,
                &BTreeSet::new(),
                1010,
            )
            .unwrap();
        found.extend(page.records.iter().map(|r| r.id));
        cursor = page.next_cursor;
        if cursor.is_none() {
            break;
        }
    }
    assert_eq!(found, expected);
    assert!(store
        .list_bound_page(
            std::slice::from_ref(&row),
            None,
            20,
            &BTreeSet::from(["owned.editor".into()]),
            1010
        )
        .unwrap()
        .records
        .is_empty());
    assert!(store
        .list_bound_page(&[], None, 20, &BTreeSet::new(), 1010)
        .unwrap()
        .records
        .is_empty());
    assert!(store
        .list_bound_page(
            &[row.clone(), row.clone()],
            None,
            20,
            &BTreeSet::new(),
            1010
        )
        .is_err());
    let too_many = vec![row.clone(); MAX_ACTIVITY_REFS + 1];
    assert!(store
        .list_bound_page(&too_many, None, 20, &BTreeSet::new(), 1010)
        .is_err());
    let point = expected[0];
    let expiry = store
        .read_metadata(point, 1010)
        .unwrap()
        .unwrap()
        .expires_at_ms;
    assert!(store
        .read_bound_metadata(point, &row, expiry)
        .unwrap()
        .is_none());
    assert!(!store.frame_path(point).exists());
}

#[test]
fn sqlite_write_failure_preserves_header_and_frame_and_poisoned_writer_refuses_reads() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("store");
    let mut store = crate::tests::open(&root, 1000);
    let id = append(&mut store, 1000);
    let previous = header(&store, id);
    let frame = fs::read(store.frame_path(id)).unwrap();
    store.db.execute_batch("CREATE TRIGGER owned_write_fault BEFORE UPDATE OF header ON evidence BEGIN SELECT RAISE(ABORT, 'owned test fault'); END;").unwrap();
    assert!(store
        .bind_activity_if_current(store.generation(), id, &record(), 1001, &|| true)
        .is_err());
    assert!(store.poisoned);
    assert_eq!(header(&store, id), previous);
    assert_eq!(fs::read(store.frame_path(id)).unwrap(), frame);
    assert!(store.read_metadata(id, 1001).is_err());
    store
        .db
        .execute_batch("DROP TRIGGER owned_write_fault")
        .unwrap();
    drop(store);
    let mut reopened = crate::tests::open(&root, 1002);
    assert!(reopened
        .read_metadata(id, 1002)
        .unwrap()
        .unwrap()
        .activity_binding
        .is_none());
    assert!(reopened.read_frame(id, 1002).unwrap().is_some());
}

#[test]
fn future_bound_headers_are_preserved_and_mixed_legacy_fields_never_grant_a_binding() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("store");
    let mut store = crate::tests::open(&root, 1000);
    let id = append(&mut store, 1000);
    let row = record();
    let unbound = serde_json::to_value(store.read_metadata(id, 1000).unwrap().unwrap()).unwrap();
    assert_eq!(unbound.as_object().unwrap().len(), 10);
    assert!(unbound.get("metadataVersion").is_none());
    assert!(unbound.get("activityBinding").is_none());
    store
        .bind_activity_if_current(store.generation(), id, &row, 1001, &|| true)
        .unwrap();
    let bound = serde_json::to_value(store.read_metadata(id, 1001).unwrap().unwrap()).unwrap();
    for key in ["metadataVersion", "activityBinding"] {
        let mut bad = bound.clone();
        bad.as_object_mut().unwrap().remove(key);
        assert!(serde_json::from_value::<EvidenceMetadata>(bad).is_err());
    }
    let mut mixed = bound.clone();
    mixed["trackerRecordId"] = "864290113".into();
    assert!(serde_json::from_value::<EvidenceMetadata>(mixed).is_err());
    let mut future = bound;
    future["metadataVersion"] = 4.into();
    assert!(serde_json::from_value::<EvidenceMetadata>(future.clone()).is_err());
    let sealed = store
        .crypto
        .seal(
            &store.aad("metadata", id),
            &serde_json::to_vec(&future).unwrap(),
        )
        .unwrap();
    store
        .db
        .execute(
            "UPDATE evidence SET header=?1 WHERE id=?2",
            params![sealed, id.to_string()],
        )
        .unwrap();
    let catalog = store.directory.join(CATALOG);
    let frame_path = store.frame_path(id);
    let frame = fs::read(&frame_path).unwrap();
    drop(store);
    let before = fs::read(&catalog).unwrap();
    assert!(matches!(
        EvidenceStore::open(
            &root,
            ScopeId::from_profile("owned-test-profile").unwrap(),
            Zeroizing::new([7; 32]),
            Retention::default(),
            1002
        ),
        Err(Error::Authentication)
    ));
    assert_eq!(fs::read(catalog).unwrap(), before);
    assert_eq!(fs::read(frame_path).unwrap(), frame);
}
