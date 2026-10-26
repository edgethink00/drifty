use super::*;
use crate::{
    crypto::CryptoBox,
    store::{EvidenceStore, NewEvidence},
};
use std::{collections::BTreeSet, fs, time::Duration};
use zeroize::Zeroizing;

fn identity() -> SurfaceIdentity {
    SurfaceIdentity {
        pid: 7,
        process_birth: 123,
        window_id: 8,
        app_id: "owned.editor".into(),
        document_id: "owned-document-fingerprint".into(),
        document_generation: 1,
    }
}

fn png() -> Vec<u8> {
    let mut data = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut data, 2, 2);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder
            .write_header()
            .unwrap()
            .write_image_data(&[42; 16])
            .unwrap();
    }
    data
}

pub(crate) fn evidence(at: i64) -> NewEvidence {
    NewEvidence {
        tracker_record_id: None,
        surface: identity(),
        observed_at_ms: at,
        text: TextEvidence::legacy_ocr(
            OcrState::Recognized,
            Zeroizing::new("ASSERT_SECRET 한글 원문".into()),
        )
        .unwrap(),
        frame: Frame::from_png(png()).unwrap(),
    }
}

pub(crate) fn open(root: &std::path::Path, now: i64) -> EvidenceStore {
    EvidenceStore::open(
        root,
        ScopeId::from_profile("owned-test-profile").unwrap(),
        Zeroizing::new([7; 32]),
        Retention::default(),
        now,
    )
    .unwrap()
}

#[test]
fn key_resolution_runs_under_writer_lock_and_never_replaces_a_lost_profile_key() {
    struct Keys {
        calls: Vec<bool>,
        available: bool,
    }
    impl crate::key_store::ProfileKeyProvider for Keys {
        fn profile_key(
            &mut self,
            _: &ScopeId,
            may_create: bool,
        ) -> Result<Zeroizing<[u8; 32]>, Error> {
            self.calls.push(may_create);
            if self.available || may_create {
                self.available = true;
                Ok(Zeroizing::new([7; 32]))
            } else {
                Err(Error::Authentication)
            }
        }
    }
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("evidence");
    let scope = ScopeId::from_profile("owned-keys").unwrap();
    let mut keys = Keys {
        calls: vec![],
        available: false,
    };
    let mut store = EvidenceStore::open_with_key_provider(
        &root,
        scope.clone(),
        &mut keys,
        Retention::default(),
        1_000,
    )
    .unwrap();
    let id = store
        .append(store.generation(), evidence(1_000), false, 1_000)
        .unwrap();
    let catalog = root.join(scope.path_component()).join("catalog.sqlite3");
    let before = fs::read(&catalog).unwrap();
    assert!(matches!(
        EvidenceStore::open_with_key_provider(
            &root,
            scope.clone(),
            &mut keys,
            Retention::default(),
            1_001
        ),
        Err(Error::Storage)
    ));
    assert_eq!(keys.calls, vec![true]);
    drop(store);
    keys.available = false;
    assert!(matches!(
        EvidenceStore::open_with_key_provider(
            &root,
            scope.clone(),
            &mut keys,
            Retention::default(),
            1_002
        ),
        Err(Error::Authentication)
    ));
    assert_eq!(keys.calls, vec![true, false]);
    assert_eq!(fs::read(&catalog).unwrap(), before);
    keys.available = true;
    let mut recovered =
        EvidenceStore::open_with_key_provider(&root, scope, &mut keys, Retention::default(), 1_003)
            .unwrap();
    assert!(recovered.read_metadata(id, 1_003).unwrap().is_some());
}

#[test]
fn encryption_binds_scope_and_record_and_survives_reopen_with_fresh_nonce_key() {
    let a = CryptoBox::new(Zeroizing::new([7; 32])).unwrap();
    let b = CryptoBox::new(Zeroizing::new([7; 32])).unwrap();
    let one = a.seal(b"metadata:scope1:id1", b"ASSERT_SECRET").unwrap();
    let two = a.seal(b"metadata:scope1:id1", b"ASSERT_SECRET").unwrap();
    let after_restore = b.seal(b"metadata:scope1:id1", b"ASSERT_SECRET").unwrap();
    assert_ne!(&one[..29], &two[..29]);
    assert_ne!(&one[1..17], &after_restore[1..17]);
    assert_eq!(
        b.open(b"metadata:scope1:id1", &one).unwrap().as_slice(),
        b"ASSERT_SECRET"
    );
    assert!(matches!(
        b.open(b"metadata:scope2:id1", &one),
        Err(Error::Authentication)
    ));
    assert!(matches!(
        b.open(b"metadata:scope1:id2", &one),
        Err(Error::Authentication)
    ));
    let mut corrupt = one;
    *corrupt.last_mut().unwrap() ^= 1;
    assert!(matches!(
        a.open(b"metadata:scope1:id1", &corrupt),
        Err(Error::Authentication)
    ));
}

#[test]
fn catalog_and_frames_never_contain_cleartext_and_reopen_reads_same_pixels() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("screen-context");
    let mut store = open(&root, 1_000);
    let id = store
        .append(store.generation(), evidence(1_000), true, 1_000)
        .unwrap();
    assert_eq!(store.read_frame(id, 1_001).unwrap().unwrap().bytes(), png());
    let profile = root.join(
        ScopeId::from_profile("owned-test-profile")
            .unwrap()
            .path_component(),
    );
    for file in fs::read_dir(&profile).unwrap() {
        let bytes = fs::read(file.unwrap().path()).unwrap();
        for secret in [
            b"ASSERT_SECRET".as_slice(),
            "한글 원문".as_bytes(),
            b"owned-document-fingerprint",
        ] {
            assert!(!bytes.windows(secret.len()).any(|slice| slice == secret));
        }
    }
    let generation = store.generation();
    drop(store);
    let mut restored = open(&root, 1_002);
    assert!(restored.generation() > generation);
    assert_eq!(
        restored
            .read_metadata(id, 1_002)
            .unwrap()
            .unwrap()
            .text
            .as_str(),
        "ASSERT_SECRET 한글 원문"
    );
    assert_eq!(
        restored.read_frame(id, 1_002).unwrap().unwrap().bytes(),
        png()
    );
    assert!(matches!(
        restored.append(generation, evidence(1_002), true, 1_002),
        Err(Error::Invalidated)
    ));
}

#[test]
fn deleting_an_empty_range_still_invalidates_inflight_work() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("screen-context");
    let mut store = open(&root, 1_000);
    let generation = store.generation();
    assert!(store.delete_range(1_000, 1_001).unwrap().removed.is_empty());
    assert!(matches!(
        store.append(generation, evidence(1_000), true, 1_000),
        Err(Error::Invalidated)
    ));
    assert!(store.capture_paused());
    store.resume_capture(1_000).unwrap();
    let id = store
        .append(store.generation(), evidence(1_000), true, 1_000)
        .unwrap();
    assert_eq!(store.purge().unwrap().removed, vec![id]);
    drop(store);
    assert!(open(&root, 1_001)
        .list_page(None, 100, 1_001)
        .unwrap()
        .records
        .is_empty());
}

#[test]
fn replay_off_has_no_frame_file_and_retention_removes_text() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("screen-context");
    let policy = Retention {
        ttl: Duration::from_secs(1),
        ..Retention::default()
    };
    let mut store = EvidenceStore::open(
        &root,
        ScopeId::from_profile("local").unwrap(),
        Zeroizing::new([7; 32]),
        policy,
        100,
    )
    .unwrap();
    let id = store
        .append(store.generation(), evidence(100), false, 100)
        .unwrap();
    assert!(store.read_frame(id, 101).unwrap().is_none());
    assert!(
        !fs::read_dir(root.join(ScopeId::from_profile("local").unwrap().path_component()))
            .unwrap()
            .any(|entry| entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with("frame-"))
    );
    assert!(store
        .list_page(None, 100, 1_100)
        .unwrap()
        .records
        .is_empty());
}

#[test]
fn simultaneous_writer_and_wrong_key_are_rejected_without_overwriting_content() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("screen-context");
    let mut first = open(&root, 100);
    let id = first
        .append(first.generation(), evidence(100), true, 100)
        .unwrap();
    assert!(EvidenceStore::open(
        &root,
        ScopeId::from_profile("owned-test-profile").unwrap(),
        Zeroizing::new([7; 32]),
        Retention::default(),
        100
    )
    .is_err());
    drop(first);
    assert!(matches!(
        EvidenceStore::open(
            &root,
            ScopeId::from_profile("owned-test-profile").unwrap(),
            Zeroizing::new([8; 32]),
            Retention::default(),
            100
        ),
        Err(Error::Authentication)
    ));
    assert!(open(&root, 101).read_frame(id, 101).unwrap().is_some());
}

#[test]
fn clock_rollback_cannot_extend_retention_or_allow_a_late_write() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("screen-context");
    let mut store = open(&root, 10_000);
    let generation = store.generation();
    let id = store
        .append(generation, evidence(10_000), true, 10_000)
        .unwrap();
    assert!(matches!(
        store.list_page(None, 100, 0),
        Err(Error::ClockRollback)
    ));
    assert!(store.generation() > generation);
    assert!(store.read_frame(id, 10_001).unwrap().is_none());
    assert!(matches!(
        store.append(generation, evidence(10_001), true, 10_001),
        Err(Error::Invalidated)
    ));
}

#[test]
fn png_validation_checks_pixels_not_just_header_and_text_counts_unicode() {
    let data = png();
    assert!(Frame::from_png(data[..24].to_vec()).is_err());
    let mut bad = data;
    bad[45] ^= 1;
    assert!(Frame::from_png(bad).is_err());
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("screen-context");
    let mut store = open(&root, 1_000);
    let mut input = evidence(1_000);
    input.text =
        TextEvidence::legacy_ocr(OcrState::Recognized, Zeroizing::new("한😀".repeat(800))).unwrap();
    store
        .append(store.generation(), input, false, 1_000)
        .unwrap();
    assert!(matches!(
        TextEvidence::legacy_ocr(OcrState::Recognized, Zeroizing::new("한😀".repeat(801))),
        Err(Error::Invalid(_))
    ));
}

#[test]
fn native_admission_facts_must_be_verified_and_explicitly_allowed() {
    // This verifies the predicate, not the as-yet-unconnected OS adapters.
    let yes = BTreeSet::from(["owned.editor".into()]);
    let none = BTreeSet::new();
    let facts = SurfaceFacts {
        identity: identity(),
        permission: true,
        foreground: true,
        interactive: true,
        protected: false,
        visibility: Visibility::Visible,
        privacy: Privacy::NotBrowser,
    };
    assert!(facts.admissible(&yes, &none));
    assert!(!facts.admissible(&none, &none));
    assert!(!facts.admissible(&yes, &yes));
    let mut changed = facts.clone();
    changed.privacy = Privacy::Unknown;
    assert!(!changed.admissible(&yes, &none));
    changed = facts.clone();
    changed.visibility = Visibility::Unknown;
    assert!(!changed.admissible(&yes, &none));
    changed = facts.clone();
    changed.permission = false;
    assert!(!changed.admissible(&yes, &none));
    changed = facts.clone();
    changed.identity.process_birth = 0;
    assert!(!changed.admissible(&yes, &none));
    changed = facts;
    changed.protected = true;
    assert!(!changed.admissible(&yes, &none));
}

#[cfg(unix)]
#[test]
fn symlinked_frame_is_not_read_or_deleted_as_an_orphan() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("screen-context");
    let mut store = open(&root, 1_000);
    let protected = temp.path().join("protected");
    fs::write(&protected, b"KEEP").unwrap();
    let frame = root
        .join(
            ScopeId::from_profile("owned-test-profile")
                .unwrap()
                .path_component(),
        )
        .join(format!("frame-{}.bin", uuid::Uuid::new_v4()));
    std::os::unix::fs::symlink(&protected, frame).unwrap();
    assert!(store.maintenance(1_001).is_err());
    assert_eq!(fs::read(protected).unwrap(), b"KEEP");
}

struct ControlledBackend {
    source: TextSource,
    started: std::sync::mpsc::SyncSender<usize>,
    release: std::sync::Mutex<std::sync::mpsc::Receiver<()>>,
    calls: std::sync::atomic::AtomicUsize,
}
impl CaptureBackend for ControlledBackend {
    fn capture(
        &self,
        policy: &CapturePolicy,
        _cancel: &Cancellation,
    ) -> Result<NativeCapture, CaptureFailure> {
        use std::sync::atomic::Ordering;
        let facts = SurfaceFacts {
            identity: identity(),
            permission: true,
            foreground: true,
            interactive: true,
            protected: false,
            visibility: Visibility::Visible,
            privacy: Privacy::NotBrowser,
        };
        if !policy.admits(&facts) {
            return Err(CaptureFailure::Excluded);
        }
        let call = self.calls.fetch_add(1, Ordering::SeqCst) + 1;
        self.started.send(call).unwrap();
        // Deliberately return after invalidation to exercise the parent barrier,
        // not a cooperative backend pretending cancellation was sufficient.
        self.release
            .lock()
            .unwrap()
            .recv_timeout(Duration::from_secs(2))
            .map_err(|_| CaptureFailure::Unavailable)?;
        Ok(NativeCapture {
            before: facts.clone(),
            after: facts,
            observed_at_ms: unix_millis().unwrap(),
            text: TextEvidence::new(
                self.source,
                TextState::Recognized,
                Zeroizing::new("owned evidence".into()),
            )
            .unwrap(),
            frame: Frame::from_png(png()).unwrap(),
            activity_hint: None,
        })
    }
}

fn active_policy() -> CapturePolicy {
    CapturePolicy {
        enabled: true,
        replay_enabled: true,
        ocr_enabled: true,
        allowed_apps: BTreeSet::from(["owned.editor".into()]),
        ..CapturePolicy::default()
    }
}

fn controlled() -> (
    ScreenContextService,
    std::sync::mpsc::Receiver<usize>,
    std::sync::mpsc::SyncSender<()>,
) {
    controlled_text(TextSource::Ocr)
}

fn controlled_text(
    source: TextSource,
) -> (
    ScreenContextService,
    std::sync::mpsc::Receiver<usize>,
    std::sync::mpsc::SyncSender<()>,
) {
    controlled_account(source, false)
}

fn controlled_account(
    source: TextSource,
    account_bound: bool,
) -> (
    ScreenContextService,
    std::sync::mpsc::Receiver<usize>,
    std::sync::mpsc::SyncSender<()>,
) {
    let (started, receive) = std::sync::mpsc::sync_channel(4);
    let (release, gate) = std::sync::mpsc::sync_channel(4);
    let backend = std::sync::Arc::new(ControlledBackend {
        source,
        started,
        release: std::sync::Mutex::new(gate),
        calls: std::sync::atomic::AtomicUsize::new(0),
    });
    let service = if account_bound {
        ScreenContextService::new_account_bound(backend)
    } else {
        ScreenContextService::new(backend)
    }
    .unwrap();
    (service, receive, release)
}

#[test]
fn native_account_revocation_blocks_late_capture_and_policy_revival_through_the_store() {
    use crate::lease::AccountGate;
    use std::time::Instant;
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("screen-context");
    let (service, started, release) = controlled_account(TextSource::Ocr, true);
    service.set_policy(active_policy()).unwrap();
    assert!(!service.request_sample());
    assert!(service
        .replace_store(Some(open(&root, unix_millis().unwrap())))
        .is_err());
    let gate = AccountGate::default();
    let bind = |profile: &str| {
        gate.bind_verified(
            gate.begin_transition().unwrap(),
            ScopeId::from_profile(profile).unwrap(),
            Instant::now() + Duration::from_secs(10),
        )
        .unwrap()
    };
    let a = bind("owned-test-profile");
    service.bind_account_lease(gate.read(a).unwrap()).unwrap();
    service
        .replace_store(Some(open(&root, unix_millis().unwrap())))
        .unwrap();
    service.set_policy(active_policy()).unwrap();
    assert!(service.request_sample());
    started.recv_timeout(Duration::from_secs(2)).unwrap();
    // No service notification is needed: an independent auth fence must stop
    // both a noncooperative late backend and a policy write already in flight.
    gate.begin_transition().unwrap();
    service.set_policy(active_policy()).unwrap();
    assert!(!service.request_sample());
    assert!(service.resume_capture().is_err());
    assert!(service.list_page(None, 100).is_err());
    release.send(()).unwrap();
    wait_idle(&service);
    assert_eq!(service.status().accepted, 0);
    assert_eq!(service.status().dropped, 1);
    let a2 = bind("owned-test-profile");
    service.bind_account_lease(gate.read(a2).unwrap()).unwrap();
    assert!(service.list_page(None, 100).unwrap().records.is_empty());
    assert!(service.request_sample());
    started.recv_timeout(Duration::from_secs(2)).unwrap();
    let b = bind("second-owned-profile");
    service.bind_account_lease(gate.read(b).unwrap()).unwrap();
    // B cannot install A's catalog even with native access to its store object.
    assert!(service
        .replace_store(Some(open(&root, unix_millis().unwrap())))
        .is_err());
    let next = EvidenceStore::open(
        &root,
        ScopeId::from_profile("second-owned-profile").unwrap(),
        Zeroizing::new([9; 32]),
        Retention::default(),
        unix_millis().unwrap(),
    )
    .unwrap();
    service.replace_store(Some(next)).unwrap();
    release.send(()).unwrap();
    wait_idle(&service);
    assert!(service.list_page(None, 100).unwrap().records.is_empty());
    service.set_policy(active_policy()).unwrap();
    assert!(service.request_sample());
    started.recv_timeout(Duration::from_secs(2)).unwrap();
    release.send(()).unwrap();
    wait_idle(&service);
    assert_eq!(service.list_page(None, 100).unwrap().records.len(), 1);
}

#[test]
fn a_revoked_bind_drops_the_active_catalog_without_deleting_its_evidence() {
    use crate::lease::AccountGate;
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("evidence");
    let now = unix_millis().unwrap();
    let mut store = open(&root, now);
    let id = store
        .append(store.generation(), evidence(now), true, now)
        .unwrap();
    let (service, _, _) = controlled_account(TextSource::Ocr, true);
    let gate = AccountGate::default();
    let account = gate
        .bind_verified(
            gate.begin_transition().unwrap(),
            ScopeId::from_profile("owned-test-profile").unwrap(),
            std::time::Instant::now() + Duration::from_secs(10),
        )
        .unwrap();
    let held = gate.read(account).unwrap();
    service.bind_account_lease(held.clone()).unwrap();
    service.replace_store(Some(store)).unwrap();
    gate.begin_transition().unwrap();
    assert!(service.bind_account_lease(held).is_err());
    assert!(service.read_metadata(id).is_err());
    assert!(!service.request_sample());
    // The runtime may now keep expiry-only ownership or open a new profile;
    // there is no hidden attached DB left to race that maintenance pass.
    let mut reopened = open(&root, now + 1);
    assert!(reopened.read_metadata(id, now + 1).unwrap().is_some());
}

fn wait_idle(service: &ScreenContextService) {
    let deadline = std::time::Instant::now() + Duration::from_secs(3);
    while {
        let state = service.status();
        state.running || state.pending
    } {
        assert!(
            std::time::Instant::now() < deadline,
            "screen worker did not settle"
        );
        std::thread::sleep(Duration::from_millis(2));
    }
}

#[test]
fn global_exclusions_override_capture_choices_and_every_stored_evidence_read() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("evidence");
    let now = unix_millis().unwrap();
    let mut store = open(&root, now);
    let hidden = store
        .append(store.generation(), evidence(now), true, now)
        .unwrap();
    let mut other = evidence(now);
    other.surface.app_id = "other.editor".into();
    let visible = store.append(store.generation(), other, true, now).unwrap();
    let (service, _, _) = controlled();
    service.replace_store(Some(store)).unwrap();
    service.set_policy(active_policy()).unwrap();
    let old_page = service.list_page(None, 1).unwrap();
    let held = service
        .observation_lease()
        .reply(service.read_metadata(hidden).unwrap().unwrap())
        .unwrap();
    service
        .set_global_exclusions(Some(BTreeSet::from(["owned.editor".into()])))
        .unwrap();
    assert!(serde_json::to_vec(&held).is_err());
    assert!(service.list_page(old_page.next_cursor, 1).is_err());
    // Reapplying UI preferences cannot remove the global exclusion.
    service.set_policy(active_policy()).unwrap();
    let page = service.list_page(None, 1).unwrap();
    assert_eq!(page.records.len(), 1);
    assert_eq!(page.records[0].id, visible);
    assert!(page.next_cursor.is_none());
    assert!(service.read_metadata(hidden).unwrap().is_none());
    assert!(service.read_frame(hidden).unwrap().is_none());
    assert!(service.read_frame(visible).unwrap().is_some());
    // Excluding an app hides its past screen evidence; it does not silently
    // delete it. Removing the rule can reveal the same authenticated record.
    service
        .set_global_exclusions(Some(BTreeSet::new()))
        .unwrap();
    assert_eq!(service.read_metadata(hidden).unwrap().unwrap().id, hidden);
    assert!(service.read_frame(hidden).unwrap().is_some());
}

#[test]
fn an_exclusion_change_drops_an_actual_late_capture_and_blocks_the_next_backend_read() {
    let temp = tempfile::tempdir().unwrap();
    let (service, started, release) = controlled();
    service
        .replace_store(Some(open(
            &temp.path().join("evidence"),
            unix_millis().unwrap(),
        )))
        .unwrap();
    service.set_policy(active_policy()).unwrap();
    assert!(service.request_sample());
    assert_eq!(started.recv_timeout(Duration::from_secs(1)).unwrap(), 1);
    service
        .set_global_exclusions(Some(BTreeSet::from(["owned.editor".into()])))
        .unwrap();
    release.send(()).unwrap();
    wait_idle(&service);
    assert_eq!(service.status().accepted, 0);
    assert!(service.list_page(None, 20).unwrap().records.is_empty());
    assert!(service.request_sample());
    wait_idle(&service);
    assert!(
        started.try_recv().is_err(),
        "excluded surface must be refused before the controlled pixel read"
    );
    assert_eq!(
        service.status().last_failure,
        Some(CaptureFailure::Excluded)
    );
}

#[test]
fn unavailable_exclusions_close_reads_and_capture_but_keep_deletion_available() {
    let temp = tempfile::tempdir().unwrap();
    let now = unix_millis().unwrap();
    let mut store = open(&temp.path().join("evidence"), now);
    let id = store
        .append(store.generation(), evidence(now), true, now)
        .unwrap();
    let (service, _, _) = controlled();
    service.replace_store(Some(store)).unwrap();
    service.set_policy(active_policy()).unwrap();
    service.set_global_exclusions(None).unwrap();
    service.set_policy(active_policy()).unwrap();
    assert!(!service.status().enabled);
    assert!(!service.request_sample());
    assert!(service.list_page(None, 20).is_err());
    assert!(service.read_metadata(id).is_err());
    assert!(service.read_frame(id).is_err());
    assert_eq!(service.purge().unwrap().removed, vec![id]);
    service
        .set_global_exclusions(Some(BTreeSet::new()))
        .unwrap();
    assert!(service.list_page(None, 20).unwrap().records.is_empty());
    assert!(service.status().paused);
    assert!(!service.request_sample());
}

#[test]
fn each_text_source_needs_its_own_policy_and_keeps_its_source_after_reopen() {
    for (source, ocr, visible, admitted) in [
        (TextSource::Accessibility, true, false, false),
        (TextSource::Ocr, false, true, false),
        (TextSource::Accessibility, false, true, true),
        (TextSource::Ocr, true, false, true),
        (TextSource::Accessibility, true, true, true),
    ] {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("screen-context");
        let (mut service, started, release) = controlled_text(source);
        service
            .replace_store(Some(open(&root, unix_millis().unwrap())))
            .unwrap();
        service
            .set_policy(CapturePolicy {
                enabled: true,
                ocr_enabled: ocr,
                visible_text_enabled: visible,
                allowed_apps: BTreeSet::from(["owned.editor".into()]),
                ..CapturePolicy::default()
            })
            .unwrap();
        assert!(service.request_sample());
        started.recv_timeout(Duration::from_secs(2)).unwrap();
        release.send(()).unwrap();
        wait_idle(&service);
        assert_eq!(service.status().accepted, u64::from(admitted));
        assert!(service.shutdown(Duration::from_millis(1100)));
        let mut reopened = open(&root, unix_millis().unwrap());
        let rows = reopened
            .list_page(None, 10, unix_millis().unwrap())
            .unwrap()
            .records;
        assert_eq!(rows.len(), usize::from(admitted));
        if let Some(row) = rows.first() {
            assert!(!row.frame_retained);
            assert_eq!(row.text_source, source);
            let metadata = reopened
                .read_metadata(row.id, unix_millis().unwrap())
                .unwrap()
                .unwrap();
            assert_eq!(metadata.text.source(), source);
            assert_eq!(metadata.text.as_str(), "owned evidence");
        }
    }
}

#[test]
fn default_off_creates_no_capture_and_pending_replaces_instead_of_growing() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("screen-context");
    let (service, started, release) = controlled();
    service
        .replace_store(Some(open(&root, unix_millis().unwrap())))
        .unwrap();
    assert!(!service.request_sample());
    assert!(started.try_recv().is_err());
    service.set_policy(active_policy()).unwrap();
    service.request_sample();
    assert_eq!(started.recv_timeout(Duration::from_secs(2)).unwrap(), 1);
    for _ in 0..20 {
        assert!(service.request_sample());
    }
    assert_eq!(service.status().replaced, 19);
    release.send(()).unwrap();
    assert_eq!(started.recv_timeout(Duration::from_secs(2)).unwrap(), 2);
    release.send(()).unwrap();
    wait_idle(&service);
    assert!(started.try_recv().is_err());
    assert_eq!(service.status().accepted, 2);
    assert_eq!(service.list_page(None, 100).unwrap().records.len(), 2);
}

#[test]
fn off_on_aba_discards_a_successful_late_backend_result() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("screen-context");
    let (service, started, release) = controlled();
    service
        .replace_store(Some(open(&root, unix_millis().unwrap())))
        .unwrap();
    service.set_policy(active_policy()).unwrap();
    service.request_sample();
    started.recv_timeout(Duration::from_secs(2)).unwrap();
    service.set_policy(CapturePolicy::default()).unwrap();
    service.set_policy(active_policy()).unwrap();
    release.send(()).unwrap();
    wait_idle(&service);
    assert_eq!(service.status().accepted, 0);
    assert_eq!(service.status().dropped, 1);
    assert!(service.list_page(None, 100).unwrap().records.is_empty());
}

#[test]
fn account_replacement_and_empty_purge_cannot_rebind_inflight_pixels() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("screen-context");
    let (service, started, release) = controlled();
    service
        .replace_store(Some(open(&root, unix_millis().unwrap())))
        .unwrap();
    service.set_policy(active_policy()).unwrap();
    service.request_sample();
    started.recv_timeout(Duration::from_secs(2)).unwrap();
    service.replace_store(None).unwrap();
    let next = EvidenceStore::open(
        &root,
        ScopeId::from_profile("second-owned-profile").unwrap(),
        Zeroizing::new([9; 32]),
        Retention::default(),
        unix_millis().unwrap(),
    )
    .unwrap();
    service.replace_store(Some(next)).unwrap();
    service.set_policy(active_policy()).unwrap();
    release.send(()).unwrap();
    wait_idle(&service);
    assert!(service.list_page(None, 100).unwrap().records.is_empty());
    service.request_sample();
    started.recv_timeout(Duration::from_secs(2)).unwrap();
    service.purge().unwrap();
    release.send(()).unwrap();
    wait_idle(&service);
    assert_eq!(service.status().accepted, 0);
    assert_eq!(service.status().dropped, 2);
    assert!(service.status().paused);
}

#[test]
fn a_partial_owned_frame_is_cleaned_after_a_crash_without_deleting_unknown_data() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("screen-context");
    drop(open(&root, 1_000));
    let scope = ScopeId::from_profile("owned-test-profile").unwrap();
    let directory = root.join(scope.path_component());
    let id = uuid::Uuid::new_v4();
    let proof = CryptoBox::new(Zeroizing::new([7; 32]))
        .unwrap()
        .seal(
            format!("pending:{}:{id}", scope.path_component()).as_bytes(),
            b"owned-file-v1",
        )
        .unwrap();
    let db = rusqlite::Connection::open(directory.join("catalog.sqlite3")).unwrap();
    db.execute(
        "INSERT INTO pending_files VALUES (?1,?2)",
        rusqlite::params![id.to_string(), proof],
    )
    .unwrap();
    drop(db);
    let partial = directory.join(format!("frame-{id}.bin"));
    fs::write(&partial, b"partial write").unwrap();
    let unknown = directory.join(format!("frame-{}.bin", uuid::Uuid::new_v4()));
    fs::write(&unknown, b"KEEP UNKNOWN FILE").unwrap();
    let mut store = open(&root, 1_001);
    assert!(!partial.exists());
    assert_eq!(fs::read(&unknown).unwrap(), b"KEEP UNKNOWN FILE");
    assert_eq!(store.purge().unwrap().pending_files, 1);
    assert_eq!(fs::read(&unknown).unwrap(), b"KEEP UNKNOWN FILE");
}

#[test]
fn media_quota_evicts_oldest_frames_and_includes_catalog_bytes() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("screen-context");
    let quota = 256 * 1024;
    let mut store = EvidenceStore::open(
        &root,
        ScopeId::from_profile("quota").unwrap(),
        Zeroizing::new([7; 32]),
        Retention {
            max_bytes: quota,
            ..Retention::default()
        },
        1_000,
    )
    .unwrap();
    let mut latest = uuid::Uuid::nil();
    for n in 0..12 {
        let mut bytes = Vec::new();
        let mut state = 7u32 + n as u32;
        let pixels: Vec<_> = (0..64 * 64 * 4)
            .map(|_| {
                state ^= state << 13;
                state ^= state >> 17;
                state ^= state << 5;
                state as u8
            })
            .collect();
        {
            let mut encoder = png::Encoder::new(&mut bytes, 64, 64);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            encoder
                .write_header()
                .unwrap()
                .write_image_data(&pixels)
                .unwrap();
        }
        let mut input = evidence(1_000 + n);
        input.frame = Frame::from_png(bytes).unwrap();
        latest = store
            .append(store.generation(), input, true, 1_000 + n)
            .unwrap();
        assert!(store.disk_bytes().unwrap() <= quota);
    }
    let rows = store.list_page(None, 100, 1_020).unwrap().records;
    assert!(rows.len() < 12);
    assert_eq!(rows.last().unwrap().id, latest);
}

#[test]
fn append_rechecks_unknown_allocation_and_preserves_it_when_eviction_cannot_fit() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("screen-context");
    let quota = 256 * 1024;
    let mut store = EvidenceStore::open(
        &root,
        ScopeId::from_profile("allocation-recheck").unwrap(),
        Zeroizing::new([7; 32]),
        Retention {
            max_bytes: quota,
            ..Retention::default()
        },
        1_000,
    )
    .unwrap();
    store
        .append(store.generation(), evidence(1_000), true, 1_000)
        .unwrap();
    // An unowned file may appear between requests; it counts toward the device
    // quota and must survive attempts to make room by evicting our evidence.
    let unknown = root.join("unowned-allocation.bin");
    let protected = vec![0x5a; 512 * 1024];
    fs::write(&unknown, &protected).unwrap();
    assert!(store.disk_bytes().unwrap() > quota);
    assert!(matches!(
        store.append(store.generation(), evidence(1_001), true, 1_001),
        Err(Error::StorageFull)
    ));
    assert!(store
        .list_page(None, 100, 1_001)
        .unwrap()
        .records
        .is_empty());
    assert_eq!(fs::read(&unknown).unwrap(), protected);
    fs::remove_file(&unknown).unwrap();
    let id = store
        .append(store.generation(), evidence(1_002), true, 1_002)
        .unwrap();
    assert!(store.disk_bytes().unwrap() <= quota);
    assert!(store.read_metadata(id, 1_002).unwrap().is_some());
}

#[test]
fn append_rejects_an_unknown_nested_directory_without_removing_it() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("screen-context");
    let mut store = open(&root, 1_000);
    let nested = root.join("unowned-directory").join("nested");
    fs::create_dir_all(&nested).unwrap();
    let protected = nested.join("keep.txt");
    fs::write(&protected, b"unowned fixture").unwrap();
    assert!(matches!(
        store.append(store.generation(), evidence(1_000), true, 1_000),
        Err(Error::Storage)
    ));
    assert_eq!(fs::read(&protected).unwrap(), b"unowned fixture");
    assert!(store
        .list_page(None, 100, 1_000)
        .unwrap()
        .records
        .is_empty());
}

#[test]
fn text_only_catalog_reuses_pages_under_long_capture_without_poisoning() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("screen-context");
    let quota = 256 * 1024;
    let mut store = EvidenceStore::open(
        &root,
        ScopeId::from_profile("text-quota").unwrap(),
        Zeroizing::new([7; 32]),
        Retention {
            max_bytes: quota,
            ..Retention::default()
        },
        1_000,
    )
    .unwrap();
    let mut latest = uuid::Uuid::nil();
    for n in 0..240 {
        let mut input = evidence(1_000 + n);
        input.text =
            TextEvidence::legacy_ocr(OcrState::Recognized, Zeroizing::new("한".repeat(1600)))
                .unwrap();
        latest = store
            .append(store.generation(), input, false, 1_000 + n)
            .unwrap();
        assert!(store.disk_bytes().unwrap() <= quota);
    }
    let rows = store.list_page(None, 100, 1_240).unwrap().records;
    assert!(!rows.is_empty() && rows.len() < 100);
    assert_eq!(rows.last().unwrap().id, latest);
    drop(store);
    let mut reopened = EvidenceStore::open(
        &root,
        ScopeId::from_profile("text-quota").unwrap(),
        Zeroizing::new([7; 32]),
        Retention {
            max_bytes: quota,
            ..Retention::default()
        },
        1_241,
    )
    .unwrap();
    assert_eq!(
        reopened
            .read_metadata(latest, 1_241)
            .unwrap()
            .unwrap()
            .text
            .chars()
            .count(),
        1600
    );
}

#[test]
fn expiry_is_cleaned_while_idle_without_a_read_request() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("screen-context");
    let store = EvidenceStore::open(
        &root,
        ScopeId::from_profile("owned-test-profile").unwrap(),
        Zeroizing::new([7; 32]),
        Retention {
            ttl: Duration::from_secs(1),
            ..Retention::default()
        },
        unix_millis().unwrap(),
    )
    .unwrap();
    let (mut service, started, release) = controlled();
    service.replace_store(Some(store)).unwrap();
    service.set_policy(active_policy()).unwrap();
    service.request_sample();
    started.recv_timeout(Duration::from_secs(2)).unwrap();
    release.send(()).unwrap();
    wait_idle(&service);
    assert_eq!(service.status().accepted, 1);
    let folder = root.join(
        ScopeId::from_profile("owned-test-profile")
            .unwrap()
            .path_component(),
    );
    let frames = || {
        fs::read_dir(&folder)
            .unwrap()
            .filter(|r| {
                r.as_ref()
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .starts_with("frame-")
            })
            .count()
    };
    assert_eq!(frames(), 1);
    let deadline = std::time::Instant::now() + Duration::from_secs(3);
    while frames() != 0 {
        assert!(
            std::time::Instant::now() < deadline,
            "idle expiry did not unlink the owned frame"
        );
        std::thread::sleep(Duration::from_millis(5));
    }
    assert!(service.shutdown(Duration::from_secs(1)));
}

#[cfg(windows)]
#[test]
fn windows_locked_frame_is_reported_pending_and_removed_after_release() {
    use std::os::windows::fs::OpenOptionsExt;
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("screen-context");
    let mut store = open(&root, 1_000);
    let id = store
        .append(store.generation(), evidence(1_000), true, 1_000)
        .unwrap();
    let path = root
        .join(
            ScopeId::from_profile("owned-test-profile")
                .unwrap()
                .path_component(),
        )
        .join(format!("frame-{id}.bin"));
    let handle = fs::OpenOptions::new()
        .read(true)
        .share_mode(1)
        .open(&path)
        .unwrap();
    let removal = store.purge().unwrap();
    assert_eq!(removal.pending_files, 1);
    assert!(path.exists());
    assert!(store.read_frame(id, 1_001).unwrap().is_none());
    drop(handle);
    assert_eq!(store.maintenance(1_001).unwrap().pending_files, 0);
    assert!(!path.exists());
}

#[test]
fn recent_review_pages_start_with_new_captures_and_keep_direction_bound_cursors() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("screen-context");
    let mut store = open(&root, 1_000);
    let mut all_ids = BTreeSet::new();
    let mut newest = BTreeSet::new();
    for at in 1_000..1_054 {
        let id = store
            .append(store.generation(), evidence(at), false, at)
            .unwrap();
        all_ids.insert(id);
        if at == 1_053 {
            newest.insert(id);
        }
    }
    for _ in 0..2 {
        let id = store
            .append(store.generation(), evidence(1_053), false, 1_053)
            .unwrap();
        all_ids.insert(id);
        newest.insert(id);
    }
    let mut hidden = evidence(1_054);
    hidden.surface.app_id = "excluded.editor".into();
    let hidden_id = store
        .append(store.generation(), hidden, false, 1_054)
        .unwrap();
    let excluded = BTreeSet::from(["excluded.editor".into()]);
    let first = store
        .list_recent_page_excluding(None, 20, 1_055, &excluded)
        .unwrap();
    assert_eq!(first.records.len(), 20);
    assert_eq!(
        first.records[..3]
            .iter()
            .map(|r| r.id)
            .collect::<BTreeSet<_>>(),
        newest
    );
    assert!(first.records[..3].iter().all(|r| r.observed_at_ms == 1_053));
    let recent_cursor = first.next_cursor.clone().unwrap();
    let wire = serde_json::to_value(&recent_cursor).unwrap();
    assert_eq!(wire["order"], "newest_first");
    let recent_cursor: crate::store::PageCursor = serde_json::from_value(wire).unwrap();
    let mut pages = first.records;
    let second = store
        .list_recent_page_excluding(Some(recent_cursor.clone()), 20, 1_055, &excluded)
        .unwrap();
    assert_eq!(second.records.len(), 20);
    pages.extend(second.records);
    let last = store
        .list_recent_page_excluding(second.next_cursor, 20, 1_055, &excluded)
        .unwrap();
    assert_eq!(last.records.len(), 16);
    assert!(last.next_cursor.is_none());
    pages.extend(last.records);
    assert!(pages
        .windows(2)
        .all(|pair| pair[0].observed_at_ms >= pair[1].observed_at_ms));
    let seen = pages.iter().map(|r| r.id).collect::<BTreeSet<_>>();
    assert_eq!(seen.len(), pages.len());
    assert_eq!(seen, all_ids);
    assert!(!seen.contains(&hidden_id));

    let chronological = store
        .list_page(None, 20, 1_055)
        .unwrap()
        .next_cursor
        .unwrap();
    assert!(matches!(
        store.list_recent_page_excluding(Some(chronological), 20, 1_055, &excluded),
        Err(Error::Invalidated)
    ));
    assert!(matches!(
        store.list_page(Some(recent_cursor.clone()), 20, 1_055),
        Err(Error::Invalidated)
    ));
    assert!(matches!(
        store.list_bound_page(&[], Some(recent_cursor.clone()), 20, &excluded, 1_055),
        Err(Error::Invalidated)
    ));
    store.delete_range(20_000, 30_000).unwrap();
    assert!(matches!(
        store.list_recent_page_excluding(Some(recent_cursor), 20, 1_055, &excluded),
        Err(Error::Invalidated)
    ));
}

#[test]
fn pages_expose_no_content_and_cursors_cannot_cross_mutation_or_reopen() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("screen-context");
    let mut store = open(&root, 1_000);
    let mut ids = Vec::new();
    for at in 1_000..1_013 {
        ids.push(
            store
                .append(store.generation(), evidence(at), false, at)
                .unwrap(),
        );
    }
    let first = store.list_page(None, 5, 1_013).unwrap();
    assert_eq!(
        first.records.iter().map(|r| r.id).collect::<Vec<_>>(),
        ids[..5]
    );
    let summary = serde_json::to_string(&first).unwrap();
    assert!(!summary.contains("ASSERT_SECRET"));
    assert!(!summary.contains("owned.editor"));
    assert!(!summary.contains("documentId"));
    assert_eq!(
        store
            .read_metadata(ids[0], 1_013)
            .unwrap()
            .unwrap()
            .text
            .as_str(),
        "ASSERT_SECRET 한글 원문"
    );
    let cursor = first.next_cursor.clone().unwrap();
    let second = store.list_page(Some(cursor.clone()), 5, 1_013).unwrap();
    let last = store.list_page(second.next_cursor, 5, 1_013).unwrap();
    assert_eq!(
        last.records.iter().map(|r| r.id).collect::<Vec<_>>(),
        ids[10..]
    );
    assert!(last.next_cursor.is_none());
    assert!(store.list_page(None, 101, 1_013).is_err());
    store.delete_range(20_000, 30_000).unwrap();
    assert!(matches!(
        store.list_page(Some(cursor), 5, 1_013),
        Err(Error::Invalidated)
    ));
    let cursor = store
        .list_page(None, 5, 1_013)
        .unwrap()
        .next_cursor
        .unwrap();
    drop(store);
    assert!(matches!(
        open(&root, 1_013).list_page(Some(cursor), 5, 1_013),
        Err(Error::Invalidated)
    ));
}

#[test]
fn cancellation_around_file_sync_and_catalog_commit_leaves_no_readable_record() {
    for cancel_at in 3..=5 {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("screen-context");
        let mut store = open(&root, 1_000);
        let calls = std::cell::Cell::new(0);
        let result =
            store.append_if_current(store.generation(), evidence(1_000), true, 1_000, &|| {
                calls.set(calls.get() + 1);
                calls.get() < cancel_at
            });
        assert!(matches!(result, Err(Error::Invalidated)));
        assert!(store
            .list_page(None, 100, 1_000)
            .unwrap()
            .records
            .is_empty());
        let directory = root.join(
            ScopeId::from_profile("owned-test-profile")
                .unwrap()
                .path_component(),
        );
        assert!(fs::read_dir(directory).unwrap().all(|entry| !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with("frame-")));
        drop(store);
        assert!(open(&root, 1_001)
            .list_page(None, 100, 1_001)
            .unwrap()
            .records
            .is_empty());
    }
}

#[test]
fn single_screen_deletion_keeps_capture_running_while_range_deletion_pauses() {
    let temp = tempfile::tempdir().unwrap();
    let now = unix_millis().unwrap();
    let mut store = open(&temp.path().join("evidence"), now);
    let first = store
        .append(store.generation(), evidence(now), true, now)
        .unwrap();
    let second = store
        .append(store.generation(), evidence(now + 1), true, now + 1)
        .unwrap();
    let (service, started, release) = controlled();
    service.replace_store(Some(store)).unwrap();
    service.set_policy(active_policy()).unwrap();
    assert_eq!(service.delete_record(first).unwrap().removed, vec![first]);
    assert!(!service.status().paused);
    assert!(service.request_sample());
    started.recv_timeout(Duration::from_secs(1)).unwrap();
    release.send(()).unwrap();
    wait_idle(&service);
    assert_eq!(service.delete_range(now, now + 2).unwrap().removed, vec![second]);
    assert!(service.status().paused);
    assert!(!service.request_sample());
}

#[test]
fn deletion_pause_survives_reopen_and_reapplying_saved_policy() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("screen-context");
    let now = unix_millis().unwrap();
    let mut store = open(&root, now);
    store.delete_range(now, now + 1).unwrap();
    drop(store);
    let mut store = open(&root, unix_millis().unwrap());
    assert!(store.capture_paused());
    assert!(matches!(
        store.append(
            store.generation(),
            evidence(now),
            true,
            unix_millis().unwrap()
        ),
        Err(Error::Invalidated)
    ));
    let (service, started, release) = controlled();
    service.replace_store(Some(store)).unwrap();
    service.set_policy(active_policy()).unwrap();
    assert!(service.status().paused);
    assert!(!service.request_sample());
    service.resume_capture().unwrap();
    assert!(!service.status().paused);
    assert!(service.request_sample());
    started.recv_timeout(Duration::from_secs(1)).unwrap();
    release.send(()).unwrap();
    wait_idle(&service);
    assert_eq!(service.status().accepted, 1);
}
