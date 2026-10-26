use super::*;

fn record() -> LocalActivityRecordRef {
    serde_json::from_value(serde_json::json!({"recordId":"864290113", "segmentUid":"f26d8c10-cb09-4c98-a3e3-3744216aab1e",
        "identityDigest":"a".repeat(64), "startedAtMs":900,"endedAtMs":2000})).unwrap()
}

#[test]
fn optional_binding_quota_refusal_never_evicts_the_existing_capture() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("store");
    let mut store = EvidenceStore::open(
        &root,
        ScopeId::from_profile("owned-test-profile").unwrap(),
        Zeroizing::new([7; 32]),
        Retention {
            max_bytes: 256 * 1024,
            ..Retention::default()
        },
        1000,
    )
    .unwrap();
    let id = store
        .append(store.generation(), crate::tests::evidence(1000), true, 1000)
        .unwrap();
    let previous: Vec<u8> = store
        .db
        .query_row(
            "SELECT header FROM evidence WHERE id=?1",
            [id.to_string()],
            |r| r.get(0),
        )
        .unwrap();
    let frame = fs::read(store.frame_path(id)).unwrap();
    // Only this temporary test root is filled, under the unchanged256KiB cap.
    File::create(root.join("owned-quota-padding.bin"))
        .unwrap()
        .set_len(256 * 1024)
        .unwrap();
    assert!(matches!(
        store.bind_activity_if_current(store.generation(), id, &record(), 1001, &|| true),
        Err(Error::StorageFull)
    ));
    let after: Vec<u8> = store
        .db
        .query_row(
            "SELECT header FROM evidence WHERE id=?1",
            [id.to_string()],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(after, previous);
    assert_eq!(store.index.len(), 1);
    assert!(!store.poisoned);
    assert_eq!(fs::read(store.frame_path(id)).unwrap(), frame);
    assert_eq!(store.retention.max_bytes, 256 * 1024);
    assert!(store
        .read_metadata(id, 1001)
        .unwrap()
        .unwrap()
        .activity_binding
        .is_none());
}

#[test]
fn signed_out_expiry_only_maintenance_reads_bound_format_and_never_creates_a_key() {
    struct ExistingKeys {
        calls: Vec<bool>,
    }
    impl crate::key_store::ProfileKeyProvider for ExistingKeys {
        fn profile_key(
            &mut self,
            _: &ScopeId,
            may_create: bool,
        ) -> Result<Zeroizing<[u8; 32]>, Error> {
            self.calls.push(may_create);
            assert!(!may_create);
            Ok(Zeroizing::new([7; 32]))
        }
    }
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("store");
    let mut store = crate::tests::open(&root, 1000);
    let id = store
        .append(store.generation(), crate::tests::evidence(1000), true, 1000)
        .unwrap();
    store
        .bind_activity_if_current(store.generation(), id, &record(), 1001, &|| true)
        .unwrap();
    let expiry = store
        .read_metadata(id, 1001)
        .unwrap()
        .unwrap()
        .expires_at_ms;
    let frame = store.frame_path(id);
    drop(store);
    let mut keeper = InactiveProfileMaintenance::open_existing(&root)
        .unwrap()
        .unwrap();
    let mut keys = ExistingKeys { calls: Vec::new() };
    let before = keeper.maintain(None, &mut keys, expiry - 1).unwrap();
    assert_eq!(before.processed_profiles, 1);
    assert_eq!(before.removed_records, 0);
    assert_eq!(before.next_expiry_ms, Some(expiry));
    assert!(frame.exists());
    let after = keeper.maintain(None, &mut keys, expiry).unwrap();
    assert_eq!(after.processed_profiles, 1);
    assert_eq!(after.removed_records, 1);
    assert_eq!(after.pending_files, 0);
    assert_eq!(after.unavailable_profiles, 0);
    assert!(!frame.exists());
    assert_eq!(keys.calls, vec![false, false]);
    assert_eq!(
        fs::read_dir(&root)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|p| p.path().is_dir())
            .count(),
        1
    );
}
