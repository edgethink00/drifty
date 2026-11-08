use super::*;
use crate::tests::{evidence, open};

fn append(store: &mut EvidenceStore, at: i64) -> Uuid {
    store
        .append(store.generation(), evidence(at), true, at)
        .unwrap()
}
fn files(store: &EvidenceStore) -> Vec<PathBuf> {
    fs::read_dir(&store.directory)
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| {
            p.file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("frame-")
        })
        .collect()
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

#[test]
fn duplicate_keeps_independent_timeline_metadata_and_reopens_after_original_deletion() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("shared");
    let mut store = open(&root, 1000);
    let first = append(&mut store, 1000);
    let original_header = header(&store, first);
    let original_cipher = fs::read(store.frame_path(first)).unwrap();
    let mut second_input = evidence(2000);
    second_input.surface.app_id = "another.editor".into();
    second_input.text = TextEvidence::not_requested();
    let second = store
        .append(store.generation(), second_input, true, 2000)
        .unwrap();
    assert_ne!(first, second);
    assert_eq!(files(&store).len(), 1);
    assert_eq!(store.index[&second].frame_id, first);
    assert_eq!(header(&store, first), original_header);
    assert_eq!(fs::read(store.frame_path(first)).unwrap(), original_cipher);
    assert_eq!(
        store
            .read_metadata(first, 2000)
            .unwrap()
            .unwrap()
            .observed_at_ms,
        1000
    );
    let m = store.read_metadata(second, 2000).unwrap().unwrap();
    assert_eq!(m.observed_at_ms, 2000);
    assert_eq!(m.text.state(), TextState::NotRequested);
    assert_ne!(
        m.surface.exclusion_keys(),
        store.index[&first].exclusion_keys
    );
    // Storage references are private: public metadata has no frame ID/envelope.
    let public = serde_json::to_value(&m).unwrap();
    assert!(public.get("frameId").is_none() && public.get("storageVersion").is_none());
    let clear = store
        .crypto
        .open(&store.aad("metadata", second), &header(&store, second))
        .unwrap();
    assert!(serde_json::from_slice::<EvidenceMetadata>(&clear).is_err());
    assert_eq!(
        store.preview_deletion(None, None).unwrap().image_bytes,
        original_cipher.len() as u64
    );
    assert_eq!(
        store
            .preview_deletion(Some(1000), Some(2000))
            .unwrap()
            .image_bytes,
        0
    );
    store.delete_record(first, 2001).unwrap();
    assert_eq!(files(&store).len(), 1);
    assert_eq!(
        store.read_frame(second, 2001).unwrap().unwrap().bytes(),
        evidence(2000).frame.bytes()
    );
    drop(store);
    let mut store = open(&root, 2002);
    assert!(store.read_metadata(first, 2002).unwrap().is_none());
    assert_eq!(
        store.read_frame(second, 2002).unwrap().unwrap().bytes(),
        evidence(2000).frame.bytes()
    );
    assert_eq!(store.delete_record(second, 2003).unwrap().pending_files, 0);
    assert!(files(&store).is_empty());
    assert_eq!(
        store.preview_deletion(None, None).unwrap(),
        DeletionPreview::default()
    );
    assert!(!store.capture_paused());
}

#[test]
fn expiry_removes_each_record_at_its_own_deadline_and_only_then_the_last_file() {
    let temp = tempfile::tempdir().unwrap();
    let mut store = open(&temp.path().join("expiry"), 1000);
    let a = append(&mut store, 1000);
    let b = append(&mut store, 2000);
    let end = store.read_metadata(a, 2000).unwrap().unwrap().expires_at_ms;
    assert_eq!(store.maintenance(end).unwrap().removed, vec![a]);
    assert_eq!(files(&store).len(), 1);
    assert!(store.read_frame(b, end).unwrap().is_some());
    assert_eq!(store.maintenance(end + 1000).unwrap().removed, vec![b]);
    assert!(files(&store).is_empty());
}

#[test]
fn cancellation_at_every_append_fence_preserves_existing_shared_owner() {
    for cancel_at in 1..=5 {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("cancel");
        let mut store = open(&root, 1000);
        let first = append(&mut store, 1000);
        let ciphertext = fs::read(store.frame_path(first)).unwrap();
        let calls = std::cell::Cell::new(0);
        let result =
            store.append_if_current(store.generation(), evidence(2000), true, 2000, &|| {
                calls.set(calls.get() + 1);
                calls.get() < cancel_at
            });
        assert!(
            matches!(result, Err(Error::Invalidated)),
            "fence {cancel_at}"
        );
        assert_eq!(store.index.len(), 1);
        assert_eq!(fs::read(store.frame_path(first)).unwrap(), ciphertext);
        assert_eq!(files(&store).len(), 1);
        drop(store);
        let mut store = open(&root, 2001);
        assert_eq!(store.list_page(None, 100, 2001).unwrap().records.len(), 1);
        assert!(store.read_frame(first, 2001).unwrap().is_some());
    }
}

#[test]
fn corrupt_candidate_is_never_reused_and_does_not_publish_a_new_reference() {
    let temp = tempfile::tempdir().unwrap();
    let mut store = open(&temp.path().join("bad"), 1000);
    let first = append(&mut store, 1000);
    let path = store.frame_path(first);
    let mut bytes = fs::read(&path).unwrap();
    *bytes.last_mut().unwrap() ^= 1;
    fs::write(&path, &bytes).unwrap();
    assert!(matches!(
        store.append(store.generation(), evidence(2000), true, 2000),
        Err(Error::Authentication)
    ));
    assert_eq!(store.index.len(), 1);
    assert_eq!(files(&store).len(), 1);
    assert_eq!(fs::read(path).unwrap(), bytes);
}

#[test]
fn text_only_records_do_not_share_or_gain_a_frame() {
    let temp = tempfile::tempdir().unwrap();
    let mut store = open(&temp.path().join("text"), 1000);
    append(&mut store, 1000);
    let id = store
        .append(store.generation(), evidence(2000), false, 2000)
        .unwrap();
    assert_eq!(store.index[&id].frame_id, id);
    assert!(store.read_frame(id, 2000).unwrap().is_none());
    assert_eq!(files(&store).len(), 1);
    store.delete_range(1000, 2000).unwrap();
    assert!(files(&store).is_empty());
    assert_eq!(store.index.len(), 1);
}

fn noise_frame(seed: u32) -> Frame {
    let mut state = seed;
    let mut data = Vec::new();
    let pixels: Vec<_> = (0..64 * 64 * 4)
        .map(|_| {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            state as u8
        })
        .collect();
    {
        let mut png = png::Encoder::new(&mut data, 64, 64);
        png.set_color(png::ColorType::Rgba);
        png.set_depth(png::BitDepth::Eight);
        png.write_header()
            .unwrap()
            .write_image_data(&pixels)
            .unwrap();
    }
    Frame::from_png(data).unwrap()
}

#[test]
fn different_pixels_never_share_and_shared_quota_counts_the_file_once() {
    let temp = tempfile::tempdir().unwrap();
    let mut store = EvidenceStore::open(
        &temp.path().join("quota"),
        ScopeId::from_profile("small").unwrap(),
        Zeroizing::new([7; 32]),
        Retention {
            max_bytes: 256 * 1024,
            ..Retention::default()
        },
        1000,
    )
    .unwrap();
    for n in 0..30 {
        let mut e = evidence(1000 + n);
        e.frame = noise_frame(7);
        store.append(store.generation(), e, true, 1000 + n).unwrap();
        assert!(store.disk_bytes().unwrap() <= 256 * 1024);
        assert_eq!(files(&store).len(), 1);
    }
    assert!(
        store.index.len() >= 12,
        "shared payload should not evict one record per frame budget"
    );
    assert_eq!(
        store.used_frame_bytes(),
        fs::metadata(&files(&store)[0]).unwrap().len()
    );
    drop(store);
    let mut store = open(&temp.path().join("different"), 1000);
    let mut e = evidence(1000);
    e.frame = noise_frame(7);
    store.append(store.generation(), e, true, 1000).unwrap();
    let mut e = evidence(2000);
    e.frame = noise_frame(8);
    let different = store.append(store.generation(), e, true, 2000).unwrap();
    assert_eq!(files(&store).len(), 2);
    assert_eq!(store.index[&different].frame_id, different);
    assert_eq!(
        store.read_frame(different, 2000).unwrap().unwrap().bytes(),
        noise_frame(8).bytes()
    );
}

#[test]
fn record_limit_eviction_of_the_only_candidate_recreates_its_authenticated_payload() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("limit");
    let mut store = open(&root, 1000);
    let first = append(&mut store, 1000);
    let before = fs::read(store.frame_path(first)).unwrap();
    // Populate real encrypted text-only rows in one transaction to reach the
    // record limit without 10,000 unrelated fsync cycles. Index and DB agree.
    let template = store.load_metadata(first).unwrap().unwrap();
    let mut rows = Vec::new();
    for n in 1..MAX_RECORDS {
        let mut m = template.clone();
        m.id = Uuid::new_v4();
        m.frame_retained = false;
        m.observed_at_ms = 1000 + n as i64;
        m.expires_at_ms += n as i64;
        let clear = encode_header(&m, m.id).unwrap();
        rows.push((
            m.id,
            store
                .crypto
                .seal(&store.aad("metadata", m.id), &clear)
                .unwrap(),
        ));
        store.index.insert(m.id, Indexed::new(&m, 0, m.id));
    }
    let tx = store.db.transaction().unwrap();
    for (id, sealed) in rows {
        tx.execute(
            "INSERT INTO evidence VALUES (?1,?2,0)",
            params![id.to_string(), sealed],
        )
        .unwrap();
    }
    tx.commit().unwrap();
    let id = append(&mut store, 11000);
    assert_eq!(store.index.len(), MAX_RECORDS);
    assert!(!store.index.contains_key(&first));
    assert_eq!(store.index[&id].frame_id, first);
    assert_eq!(files(&store).len(), 1);
    // New nonce/ciphertext proves the evicted blob was written again.
    assert_ne!(fs::read(store.frame_path(first)).unwrap(), before);
    assert_eq!(
        store.read_frame(id, 11000).unwrap().unwrap().bytes(),
        evidence(11000).frame.bytes()
    );
    drop(store);
    let mut store = open(&root, 11001);
    assert!(store.read_frame(id, 11001).unwrap().is_some());
}

#[test]
fn committed_shared_append_revocation_removes_only_its_new_record() {
    let temp = tempfile::tempdir().unwrap();
    let mut store = open(&temp.path().join("commit"), 1000);
    let first = append(&mut store, 1000);
    let observer = Connection::open_with_flags(
        store.directory.join(CATALOG),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .unwrap();
    let current = || {
        observer
            .query_row("SELECT COUNT(*) FROM evidence", [], |r| r.get::<_, i64>(0))
            .unwrap()
            == 1
    };
    assert!(matches!(
        store.append_if_current(store.generation(), evidence(2000), true, 2000, &current),
        Err(Error::Invalidated)
    ));
    assert_eq!(store.index.len(), 1);
    assert_eq!(files(&store).len(), 1);
    assert!(store.read_frame(first, 2000).unwrap().is_some());
}

#[test]
fn interrupted_last_reference_removal_recovers_partial_owned_blob_and_preserves_unknown() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("crash");
    let mut store = open(&root, 1000);
    let first = append(&mut store, 1000);
    let second = append(&mut store, 2000);
    store.delete_record(first, 2001).unwrap();
    let proof = store
        .crypto
        .seal(&store.aad("pending", first), b"owned-file-v1")
        .unwrap();
    let tx = store.db.transaction().unwrap();
    tx.execute("DELETE FROM evidence WHERE id=?1", [second.to_string()])
        .unwrap();
    tx.execute(
        "INSERT INTO pending_files VALUES (?1,?2)",
        params![first.to_string(), proof],
    )
    .unwrap();
    tx.commit().unwrap();
    let path = store.frame_path(first);
    fs::write(&path, b"partial owned ciphertext").unwrap();
    let unknown = store.frame_path(Uuid::new_v4());
    fs::write(&unknown, b"do not remove unknown").unwrap();
    drop(store);
    let mut store = open(&root, 2002);
    assert!(!path.exists());
    assert_eq!(fs::read(&unknown).unwrap(), b"do not remove unknown");
    assert_eq!(store.maintenance(2002).unwrap().pending_files, 1);
    assert!(store.index.is_empty());
}

#[test]
fn invalid_shared_envelopes_are_rejected_and_reference_conflict_prevents_recovery() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("tamper");
    let mut store = open(&root, 1000);
    let first = append(&mut store, 1000);
    let second = append(&mut store, 2000);
    let metadata = store.load_metadata(second).unwrap().unwrap();
    let good = encode_header(&metadata, first).unwrap();
    for case in 0..6 {
        let mut value: serde_json::Value = serde_json::from_slice(&good).unwrap();
        match case {
            0 => value["storageVersion"] = 2.into(),
            1 => value["frameId"] = Uuid::nil().to_string().into(),
            2 => value["frameId"] = second.to_string().into(),
            3 => value["metadata"]["frameRetained"] = false.into(),
            4 => value["extra"] = true.into(),
            _ => value["metadata"] = value.clone(),
        }
        assert!(decode_header(&serde_json::to_vec(&value).unwrap()).is_err());
    }
    // Even an authenticated envelope with a conflicting size cannot authorize
    // cleanup. No frame, pending proof or generation is changed on failed open.
    store
        .db
        .execute(
            "UPDATE evidence SET frame_bytes=frame_bytes+1 WHERE id=?1",
            [second.to_string()],
        )
        .unwrap();
    let directory = store.directory.clone();
    drop(store);
    let before: BTreeMap<_, _> = fs::read_dir(&directory)
        .unwrap()
        .map(|e| {
            let path = e.unwrap().path();
            (path.clone(), fs::read(path).unwrap())
        })
        .collect();
    assert!(matches!(
        EvidenceStore::open(
            &root,
            ScopeId::from_profile("owned-test-profile").unwrap(),
            Zeroizing::new([7; 32]),
            Retention::default(),
            2001
        ),
        Err(Error::Authentication)
    ));
    for (path, bytes) in before {
        assert_eq!(fs::read(path).unwrap(), bytes);
    }
}

#[test]
fn copying_a_shared_blob_between_profiles_never_authenticates_even_with_the_same_key() {
    let temp = tempfile::tempdir().unwrap();
    let mut a = open(&temp.path().join("a"), 1000);
    let first = append(&mut a, 1000);
    let shared = append(&mut a, 2000);
    let bytes = fs::read(a.frame_path(first)).unwrap();
    drop(a);
    let mut b = EvidenceStore::open(
        &temp.path().join("b"),
        ScopeId::from_profile("other-profile").unwrap(),
        Zeroizing::new([7; 32]),
        Retention::default(),
        1000,
    )
    .unwrap();
    let id = append(&mut b, 1000);
    let id2 = append(&mut b, 2000);
    fs::write(b.frame_path(id), bytes).unwrap();
    assert!(matches!(
        b.read_frame(id2, 2000),
        Err(Error::Authentication)
    ));
    assert!(b.read_frame(shared, 2000).unwrap().is_none());
}

#[test]
fn shared_scene_enrichment_and_activity_binding_preserve_the_reference_across_reopen() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("enrich");
    let mut store = open(&root, 1000);
    let mut scene = crate::scene::tests::scene();
    scene.text_scope = crate::SceneTextScope::None;
    let region = scene.foreground_region.unwrap();
    let mut ids = Vec::new();
    for at in [1000, 1100] {
        ids.push(
            store
                .append_scene_if_current(
                    store.generation(),
                    scene.clone(),
                    at,
                    TextEvidence::not_requested(),
                    evidence(at).frame,
                    true,
                    at,
                    &|| true,
                )
                .unwrap(),
        );
    }
    let first = ids[0];
    let second = ids[1];
    let encrypted = fs::read(store.frame_path(first)).unwrap();
    let record = serde_json::from_value(serde_json::json!({"recordId":"864290113",
        "segmentUid":"f26d8c10-cb09-4c98-a3e3-3744216aab1e","identityDigest":"a".repeat(64),
        "startedAtMs":900,"endedAtMs":2000}))
    .unwrap();
    assert!(store
        .bind_activity_if_current(store.generation(), second, &record, 1101, &|| true)
        .unwrap()
        .is_some());
    let hash = evidence(1100).frame.sha256().to_owned();
    let text = TextEvidence::new(
        TextSource::Ocr,
        TextState::Recognized,
        Zeroizing::new("second record only".into()),
    )
    .unwrap();
    assert!(store
        .enrich_scene_ocr_if_current(
            store.generation(),
            second,
            &hash,
            region,
            text,
            1102,
            &|| true
        )
        .unwrap());
    assert_eq!(fs::read(store.frame_path(first)).unwrap(), encrypted);
    drop(store);
    let mut store = open(&root, 1103);
    let m = store.read_metadata(second, 1103).unwrap().unwrap();
    assert_eq!(m.text.as_str(), "second record only");
    assert!(m.activity_binding.is_some());
    assert_eq!(store.index[&second].frame_id, first);
    assert_eq!(
        store
            .read_metadata(first, 1103)
            .unwrap()
            .unwrap()
            .text
            .state(),
        TextState::NotRequested
    );
    store.delete_record(first, 1103).unwrap();
    assert!(store
        .read_bound_frame(second, &record, 1103)
        .unwrap()
        .is_some());
    assert_eq!(files(&store).len(), 1);
}

#[test]
fn signed_out_maintenance_keeps_shared_payload_until_the_final_reference_expires() {
    struct Keys;
    impl crate::key_store::ProfileKeyProvider for Keys {
        fn profile_key(
            &mut self,
            _: &ScopeId,
            may_create: bool,
        ) -> Result<Zeroizing<[u8; 32]>, Error> {
            assert!(!may_create);
            Ok(Zeroizing::new([7; 32]))
        }
    }
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("inactive");
    let mut store = open(&root, 1000);
    let first = append(&mut store, 1000);
    append(&mut store, 2000);
    let end = store.load_metadata(first).unwrap().unwrap().expires_at_ms;
    let path = store.frame_path(first);
    drop(store);
    let mut maintenance = InactiveProfileMaintenance::open_existing(&root)
        .unwrap()
        .unwrap();
    let report = maintenance.maintain(None, &mut Keys, end).unwrap();
    assert_eq!(report.removed_records, 1);
    assert_eq!(report.unavailable_profiles, 0);
    assert!(path.exists());
    let report = maintenance.maintain(None, &mut Keys, end + 1000).unwrap();
    assert_eq!(report.removed_records, 1);
    assert_eq!(report.pending_files, 0);
    assert!(!path.exists());
}
