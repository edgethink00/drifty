use super::*;

struct Keys {
    values: BTreeMap<ScopeId, u8>,
    calls: usize,
}
impl ProfileKeyProvider for Keys {
    fn profile_key(
        &mut self,
        scope: &ScopeId,
        may_create: bool,
    ) -> Result<Zeroizing<[u8; 32]>, Error> {
        assert!(!may_create);
        self.calls += 1;
        self.values
            .get(scope)
            .map(|v| Zeroizing::new([*v; 32]))
            .ok_or(Error::Authentication)
    }
}
fn seed(root: &Path, name: &str, key: u8, ids: &[Option<&str>]) -> (ScopeId, Vec<Uuid>) {
    let scope = ScopeId::from_profile(name).unwrap();
    let mut store = EvidenceStore::open(
        root,
        scope.clone(),
        Zeroizing::new([key; 32]),
        Retention::default(),
        1000,
    )
    .unwrap();
    let mut evidence_ids = Vec::new();
    for id in ids {
        let evidence = store
            .append(store.generation(), crate::tests::evidence(1000), true, 1000)
            .unwrap();
        if let Some(id) = id {
            let reference: crate::LocalActivityRecordRef = serde_json::from_value(serde_json::json!({
                "recordId": id, "segmentUid":"f26d8c10-cb09-4c98-a3e3-3744216aab1e", "identityDigest":"a".repeat(64),
                "startedAtMs":999,"endedAtMs":1001
            })).unwrap();
            assert!(store
                .bind_activity_if_current(store.generation(), evidence, &reference, 1000, &|| true)
                .unwrap()
                .is_some());
        }
        evidence_ids.push(evidence);
    }
    (scope, evidence_ids)
}
fn effects(ids: &[&str], overflow: bool) -> ActivityDeletionEffects {
    serde_json::from_value(serde_json::json!({"version":1,"recordIds":ids,"overflow":overflow}))
        .unwrap()
}
fn owner(root: &Path) -> InactiveProfileMaintenance {
    InactiveProfileMaintenance::open_existing(root)
        .unwrap()
        .unwrap()
}

#[test]
fn selected_deletion_removes_matching_and_unbound_evidence_in_all_existing_profiles() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("evidence");
    let (a, _) = seed(&root, "owned-a", 7, &[Some("1"), Some("2"), None]);
    let (b, _) = seed(&root, "owned-b", 8, &[Some("1"), Some("3")]);
    let mut keys = Keys {
        values: BTreeMap::from([(a.clone(), 7), (b.clone(), 8)]),
        calls: 0,
    };
    let deletion = owner(&root).begin_activity_deletion().unwrap();
    assert!(InactiveProfileMaintenance::activity_deletion_pending(&root).unwrap());
    assert!(pending(&root, &a).unwrap() && pending(&root, &b).unwrap());
    let report = deletion
        .finish(&effects(&["1"], false), &mut keys, 1001)
        .unwrap();
    assert_eq!(report.removed_records, 3);
    assert_eq!(report.processed_profiles, 2);
    assert_eq!(report.unavailable_profiles, 0);
    assert!(!InactiveProfileMaintenance::activity_deletion_pending(&root).unwrap());
    for (scope, key, expected) in [(a, 7, "2"), (b, 8, "3")] {
        let mut store = EvidenceStore::open(
            &root,
            scope.clone(),
            Zeroizing::new([key; 32]),
            Retention::default(),
            1002,
        )
        .unwrap();
        let rows = store.list_page(None, 10, 1002).unwrap().records;
        assert_eq!(rows.len(), 1);
        assert_eq!(
            store
                .read_metadata(rows[0].id, 1002)
                .unwrap()
                .unwrap()
                .activity_binding
                .as_ref()
                .unwrap()
                .record_id(),
            expected
        );
        assert!(store.capture_paused());
        assert!(!pending(&root, &scope).unwrap());
    }
}

#[test]
fn lost_reply_or_process_exit_leaves_markers_and_reopen_purges_before_any_read() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("evidence");
    let (scope, ids) = seed(&root, "owned-interrupted", 7, &[Some("1"), Some("2")]);
    drop(owner(&root).begin_activity_deletion().unwrap());
    let mut store = EvidenceStore::open(
        &root,
        scope.clone(),
        Zeroizing::new([7; 32]),
        Retention::default(),
        1001,
    )
    .unwrap();
    assert!(store.list_page(None, 10, 1001).unwrap().records.is_empty());
    assert!(store.read_frame(ids[0], 1001).unwrap().is_none());
    assert!(store.capture_paused());
    assert!(!pending(&root, &scope).unwrap());
}

#[test]
fn missing_or_wrong_key_preserves_marked_profile_until_authenticated_recovery() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("evidence");
    let (scope, _) = seed(&root, "owned-lost-key", 7, &[Some("1"), Some("2")]);
    let catalog = root.join(scope.path_component()).join(CATALOG);
    let before = fs::read(&catalog).unwrap();
    let mut keys = Keys {
        values: BTreeMap::new(),
        calls: 0,
    };
    let report = owner(&root)
        .begin_activity_deletion()
        .unwrap()
        .finish(&effects(&["1"], false), &mut keys, 1001)
        .unwrap();
    assert_eq!(report.unavailable_profiles, 1);
    assert_eq!(fs::read(&catalog).unwrap(), before);
    assert!(pending(&root, &scope).unwrap());
    assert!(EvidenceStore::open(
        &root,
        scope.clone(),
        Zeroizing::new([8; 32]),
        Retention::default(),
        1002
    )
    .is_err());
    assert_eq!(fs::read(&catalog).unwrap(), before);
    let mut store = EvidenceStore::open(
        &root,
        scope,
        Zeroizing::new([7; 32]),
        Retention::default(),
        1003,
    )
    .unwrap();
    assert!(store.list_page(None, 10, 1003).unwrap().records.is_empty());
}

#[test]
fn no_op_receipt_never_removes_evidence_or_queries_keys_and_overflow_never_partially_keeps_it() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("evidence");
    let (scope, _) = seed(&root, "owned-no-op", 7, &[Some("1"), None]);
    let catalog = root.join(scope.path_component()).join(CATALOG);
    let before = fs::read(&catalog).unwrap();
    let mut keys = Keys {
        values: BTreeMap::from([(scope.clone(), 7)]),
        calls: 0,
    };
    let report = owner(&root)
        .begin_activity_deletion()
        .unwrap()
        .finish(&effects(&[], false), &mut keys, 1001)
        .unwrap();
    assert_eq!(report.removed_records, 0);
    assert_eq!(keys.calls, 0);
    assert_eq!(fs::read(&catalog).unwrap(), before);
    assert!(!pending(&root, &scope).unwrap());
    let report = owner(&root)
        .begin_activity_deletion()
        .unwrap()
        .finish(&effects(&[], true), &mut keys, 1002)
        .unwrap();
    assert_eq!(report.removed_records, 2);
}

#[test]
fn an_active_store_cannot_be_bypassed_by_a_shared_maintenance_handle() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("evidence");
    let mut store = crate::tests::open(&root, 1000);
    let id = store
        .append(store.generation(), crate::tests::evidence(1000), true, 1000)
        .unwrap();
    assert!(store
        .inactive_maintenance_handle()
        .begin_activity_deletion()
        .is_err());
    assert!(store.read_frame(id, 1001).unwrap().is_some());
}

#[test]
fn unknown_or_malformed_receipts_cannot_clear_a_recovery_marker() {
    let good = serde_json::json!({"version":1,"recordIds":["1"],"overflow":false});
    for (key, value) in [
        ("version", serde_json::json!(2)),
        ("recordIds", serde_json::json!(["01"])),
        ("recordIds", serde_json::json!(["1", "1"])),
        ("recordIds", serde_json::json!(["9223372036854775808"])),
        ("overflow", serde_json::json!(true)),
        ("extra", serde_json::json!("private")),
    ] {
        let mut changed = good.clone();
        changed[key] = value;
        assert!(serde_json::from_value::<ActivityDeletionEffects>(changed).is_err());
    }
}
