use super::*;
use crate::{
    activity_reader::{ActivityResolver, CapturedActivityHint},
    lease::AccountGate,
    unix_millis, Cancellation, CaptureBackend, CaptureFailure, CapturePolicy,
    LocalActivityRecordRef, NativeCapture, ScopeId, ScreenContextService, TextEvidence,
};
use std::sync::atomic::AtomicUsize;

struct NoCapture;
impl CaptureBackend for NoCapture {
    fn capture(
        &self,
        _: &CapturePolicy,
        _: &Cancellation,
    ) -> Result<NativeCapture, CaptureFailure> {
        unreachable!("AI preparation cannot start capture")
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
        ids: &[String],
        current: &dyn Fn() -> bool,
    ) -> Result<Vec<LocalActivityRecordRef>, Error> {
        self.calls.fetch_add(1, Ordering::Relaxed);
        if !current() {
            return Err(Error::Invalidated);
        }
        assert_eq!(ids, ["1"]);
        Ok(self.row.lock().unwrap().clone().into_iter().collect())
    }
    fn reset(&self) {}
}
fn account(gate: &AccountGate) -> AccountReadLease {
    let transition = gate.begin_transition().unwrap();
    let id = gate
        .bind_verified(
            transition,
            ScopeId::from_profile("owned-test-profile").unwrap(),
            Instant::now() + Duration::from_secs(120),
        )
        .unwrap();
    gate.read(id).unwrap()
}
fn choices() -> AiSourceChoices {
    AiSourceChoices {
        accessibility_text: true,
        ocr_text: true,
        images: true,
        purposes: BTreeSet::from([AiPurpose::Classification]),
    }
}
fn text(source: TextSource, content: &str) -> TextEvidence {
    TextEvidence::new(
        source,
        TextState::Recognized,
        Zeroizing::new(content.to_owned()),
    )
    .unwrap()
}
struct Harness {
    service: ScreenContextService,
    owner: AccountGate,
    authority: AccountReadLease,
    consent: AiUseGate,
    provider: Uuid,
    reader: Arc<Reader>,
    ids: Vec<Uuid>,
    legacy: Uuid,
    now: i64,
    // Rust drops fields in declaration order. SQLite and the native service
    // must close before Windows can remove this temporary directory.
    _temp: tempfile::TempDir,
}
impl Harness {
    fn new(texts: Vec<TextEvidence>, frames: bool, large: bool) -> Self {
        Self::new_for_scene(texts, frames, large, false)
    }
    fn new_for_scene(texts: Vec<TextEvidence>, frames: bool, large: bool, scene: bool) -> Self {
        let temp = tempfile::tempdir().unwrap();
        let now = unix_millis().unwrap();
        let mut store = crate::tests::open(&temp.path().join("store"), now);
        let row: LocalActivityRecordRef = serde_json::from_value(serde_json::json!({"recordId":"1","segmentUid":"f26d8c10-cb09-4c98-a3e3-3744216aab1e","identityDigest":"a".repeat(64),"startedAtMs":now-10000,"endedAtMs":now+10000})).unwrap();
        let legacy = store
            .append(
                store.generation(),
                crate::tests::evidence(now - 10),
                false,
                now,
            )
            .unwrap();
        let mut ids = Vec::new();
        for (index, text) in texts.into_iter().enumerate() {
            let mut input = crate::tests::evidence(now - 5 + index as i64);
            input.text = text;
            if large {
                input.frame = large_frame();
            }
            let id = if scene {
                store
                    .append_scene_if_current(
                        store.generation(),
                        crate::scene::tests::inventoried_facts().identity,
                        input.observed_at_ms,
                        input.text,
                        input.frame,
                        frames,
                        now,
                        &|| true,
                    )
                    .unwrap()
            } else {
                store
                    .append(store.generation(), input, frames, now)
                    .unwrap()
            };
            assert!(store
                .bind_activity_if_current(store.generation(), id, &row, now, &|| true)
                .unwrap()
                .is_some());
            ids.push(id);
        }
        let reader = Arc::new(Reader {
            row: Mutex::new(Some(row)),
            calls: AtomicUsize::new(0),
        });
        let service = ScreenContextService::new_account_bound_with_activity_resolver(
            Arc::new(NoCapture),
            reader.clone(),
        )
        .unwrap();
        let owner = AccountGate::default();
        let authority = account(&owner);
        service.bind_account_lease(authority.clone()).unwrap();
        service.replace_store(Some(store)).unwrap();
        service
            .set_policy(CapturePolicy {
                allowed_apps: BTreeSet::from(["owned.editor".into()]),
                ..Default::default()
            })
            .unwrap();
        let consent = AiUseGate::new(authority.clone()).unwrap();
        let provider = Uuid::new_v4();
        Self {
            _temp: temp,
            service,
            owner,
            authority,
            consent,
            provider,
            reader,
            ids,
            legacy,
            now,
        }
    }
    fn configure(&self, choices: AiSourceChoices) {
        self.consent
            .configure(&self.authority, Some(self.provider), choices)
            .unwrap();
    }
    fn selection(&self) -> AiInputSelection {
        AiInputSelection::new(
            vec!["1".into()],
            self.ids.clone(),
            [self.now - 10, self.now + 1],
        )
        .unwrap()
    }
    fn prepare(&self, supports_images: bool) -> PreparedAiInput {
        self.service
            .prepare_ai_input(
                self.selection(),
                self.consent
                    .begin(self.provider, AiPurpose::Classification, supports_images)
                    .unwrap(),
            )
            .unwrap()
            .unwrap()
    }
}
impl Drop for Harness {
    fn drop(&mut self) {
        assert!(self.service.shutdown(Duration::from_millis(1100)));
    }
}
fn large_frame() -> Frame {
    let mut bytes = vec![0u8; 600 * 500 * 4];
    let mut state = 1u32;
    for byte in &mut bytes {
        state ^= state << 13;
        state ^= state >> 17;
        state ^= state << 5;
        *byte = state as u8;
    }
    let mut png = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut png, 600, 500);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder
            .write_header()
            .unwrap()
            .write_image_data(&bytes)
            .unwrap();
    }
    assert!(png.len() > MAX_AI_TOTAL_IMAGE_BYTES / 2 && png.len() < crate::MAX_FRAME_BYTES);
    Frame::from_png(png).unwrap()
}
fn json(input: &PreparedAiInput) -> serde_json::Value {
    input
        .with_current_parts(|bytes, _| Ok(serde_json::from_slice(bytes).unwrap()))
        .unwrap()
}

#[test]
fn new_consent_is_off_and_does_not_inherit_source_capture_or_other_ai_choices() {
    let h = Harness::new(vec![text(TextSource::Ocr, "owned")], true, false);
    assert!(h
        .consent
        .begin(h.provider, AiPurpose::Classification, true)
        .is_err());
    h.configure(choices());
    assert!(h
        .consent
        .begin(Uuid::new_v4(), AiPurpose::Classification, true)
        .is_err());
    assert!(h
        .consent
        .begin(h.provider, AiPurpose::TimelineCards, true)
        .is_err());
    assert!(h
        .consent
        .begin(h.provider, AiPurpose::ProjectAssignment, true)
        .is_err());
    assert!(h
        .consent
        .configure(&h.authority, Some(Uuid::nil()), choices())
        .is_err());
    let lease = h
        .consent
        .begin(h.provider, AiPurpose::Classification, true)
        .unwrap();
    h.consent.revoke().unwrap();
    h.configure(choices());
    assert!(
        lease.validate().is_err(),
        "restoring old choices revived a revoked request"
    );
    let lease = h
        .consent
        .begin(h.provider, AiPurpose::Classification, true)
        .unwrap();
    h.consent
        .configure(&h.authority, Some(Uuid::new_v4()), choices())
        .unwrap();
    assert!(lease.validate().is_err());
}

#[test]
fn the_exact_account_capability_is_required_even_for_the_same_profile() {
    let h = Harness::new(vec![text(TextSource::Ocr, "owned")], false, false);
    h.configure(choices());
    let other = AccountGate::default();
    let other_lease = account(&other);
    assert!(h
        .consent
        .configure(&other_lease, Some(h.provider), choices())
        .is_err());
    let request = h
        .consent
        .begin(h.provider, AiPurpose::Classification, false)
        .unwrap();
    h.service.bind_account_lease(other_lease).unwrap();
    assert!(h.service.prepare_ai_input(h.selection(), request).is_err());
    let before = h
        .consent
        .begin(h.provider, AiPurpose::Classification, false)
        .unwrap();
    let _ = account(&h.owner);
    assert!(before.validate().is_err());
    assert!(h
        .consent
        .begin(h.provider, AiPurpose::Classification, false)
        .is_err());
    assert!(h.consent.revoke().is_ok());
}

#[test]
fn native_selection_rejects_remote_duplicate_malformed_or_unbounded_inputs() {
    let ids = vec![Uuid::new_v4()];
    for records in [
        vec![],
        vec!["0".into()],
        vec!["01".into()],
        vec!["sync:1".into()],
        vec!["1".into(), "1".into()],
        vec!["9223372036854775808".into()],
    ] {
        assert!(AiInputSelection::new(records, ids.clone(), [0, 1000]).is_err());
    }
    for window in [
        [-1, 1000],
        [0, 0],
        [1, 0],
        [0, MAX_REQUEST_WINDOW_MS + 1],
        [253_402_300_799_999, 253_402_300_800_000],
    ] {
        assert!(AiInputSelection::new(vec!["1".into()], ids.clone(), window).is_err());
    }
    for evidence in [
        vec![],
        vec![Uuid::nil()],
        vec![ids[0], ids[0]],
        (0..6).map(|_| Uuid::new_v4()).collect(),
    ] {
        assert!(AiInputSelection::new(vec!["1".into()], evidence, [0, 1000]).is_err());
    }
    assert!(AiInputSelection::new(
        vec!["9223372036854775807".into()],
        ids,
        [0, MAX_REQUEST_WINDOW_MS]
    )
    .is_ok());
}

#[test]
fn actual_encrypted_bound_records_become_relative_refs_with_unicode_and_image_caps() {
    let h = Harness::new(
        (0..5)
            .map(|_| text(TextSource::Accessibility, &"한😀".repeat(400)))
            .collect(),
        true,
        false,
    );
    h.configure(choices());
    let input = h.prepare(true);
    let value = input
        .with_current_parts(|bytes, parts| {
            assert_eq!(parts.len(), 3);
            assert!(parts
                .iter()
                .all(|part| part.png().starts_with(b"\x89PNG\r\n\x1a\n")));
            assert_eq!(
                parts
                    .iter()
                    .map(|part| part.reference())
                    .collect::<Vec<_>>(),
                ["img1", "img2", "img3"]
            );
            let value: serde_json::Value = serde_json::from_slice(bytes).unwrap();
            let encoded = std::str::from_utf8(bytes).unwrap();
            for forbidden in [
                "segmentUid",
                "recordId",
                "observedAtMs",
                "expiresAtMs",
                "frameSha256",
                "pid",
                "documentId",
                "owned.editor",
                "owned-document-fingerprint",
                "f26d8c10-cb09-4c98-a3e3-3744216aab1e",
            ] {
                assert!(
                    !encoded.contains(forbidden),
                    "metadata escaped: {forbidden}"
                );
            }
            for id in &h.ids {
                assert!(!encoded.contains(&id.to_string()));
            }
            Ok(value)
        })
        .unwrap();
    assert_eq!(value["schemaVersion"], "drifty.screen-context.v2");
    assert_eq!(value["purpose"], "classification");
    assert_eq!(value["recordRefs"], serde_json::json!(["r1"]));
    assert_eq!(value["windowDurationMillis"], 11);
    assert_eq!(
        value
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect::<BTreeSet<_>>(),
        BTreeSet::from([
            "schemaVersion",
            "policyRevision",
            "purpose",
            "requestRef",
            "windowDurationMillis",
            "recordRefs",
            "evidence",
            "attachments"
        ])
    );
    assert_eq!(
        value["evidence"][0]
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect::<BTreeSet<_>>(),
        BTreeSet::from(["ref", "recordRef", "offsetMillis", "text", "image"])
    );
    assert_eq!(
        value["attachments"][0]
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect::<BTreeSet<_>>(),
        BTreeSet::from(["ref", "mimeType", "width", "height"])
    );
    assert_eq!(value["evidence"].as_array().unwrap().len(), 5);
    let lengths = value["evidence"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| {
            row["text"]["excerpt"]
                .as_str()
                .map_or(0, |s| s.chars().count())
        })
        .collect::<Vec<_>>();
    assert_eq!(lengths, [600, 600, 400, 0, 0]);
    for (i, row) in value["evidence"].as_array().unwrap().iter().enumerate() {
        assert_eq!(row["offsetMillis"], 5 + i as i64);
        assert_eq!(row["text"]["source"], "accessibility");
        assert_eq!(row["text"]["truncated"], true);
    }
    assert_eq!(value["evidence"][3]["image"]["state"], "budget");
    assert_eq!(
        input.resolve_record_refs(&["r1".into()]).unwrap()[0].as_str(),
        "1"
    );
    assert!(input.resolve_record_refs(&["r2".into()]).is_err());
    assert!(input
        .resolve_record_refs(&["r1".into(), "r1".into()])
        .is_err());
}

#[test]
fn accessibility_ocr_and_images_are_independent_and_unavailable_is_not_an_empty_screen() {
    let h = Harness::new(
        vec![
            text(TextSource::Accessibility, "must not transmit"),
            TextEvidence::new(
                TextSource::Ocr,
                TextState::Unavailable,
                Zeroizing::new(String::new()),
            )
            .unwrap(),
        ],
        false,
        false,
    );
    h.configure(AiSourceChoices {
        ocr_text: true,
        purposes: choices().purposes,
        ..Default::default()
    });
    let value = json(&h.prepare(false));
    assert_eq!(value["evidence"].as_array().unwrap().len(), 1);
    assert_eq!(value["evidence"][0]["text"]["state"], "unavailable");
    assert!(value["evidence"][0]["text"].get("excerpt").is_none());
    assert!(value["evidence"][0].get("image").is_none());
    assert_eq!(value["attachments"], serde_json::json!([]));
    let selection =
        AiInputSelection::new(vec!["1".into()], vec![h.ids[0]], [h.now - 10, h.now + 1]).unwrap();
    assert!(h
        .service
        .prepare_ai_input(
            selection,
            h.consent
                .begin(h.provider, AiPurpose::Classification, false)
                .unwrap()
        )
        .unwrap()
        .is_none());
    h.configure(AiSourceChoices {
        images: true,
        purposes: choices().purposes,
        ..Default::default()
    });
    let value = json(&h.prepare(true));
    assert!(value["evidence"][0].get("text").is_none());
    assert_eq!(value["evidence"][0]["image"]["state"], "not_retained");
}

#[test]
fn image_consent_never_bypasses_provider_capability_or_total_encoded_binary_budget() {
    let h = Harness::new(
        vec![text(TextSource::Ocr, "one"), text(TextSource::Ocr, "two")],
        true,
        true,
    );
    h.configure(choices());
    let unsupported = h.prepare(false);
    unsupported
        .with_current_parts(|bytes, parts| {
            assert!(parts.is_empty());
            let j: serde_json::Value = serde_json::from_slice(bytes).unwrap();
            assert_eq!(j["evidence"][0]["image"]["state"], "provider_unsupported");
            assert_eq!(j["attachments"], serde_json::json!([]));
            Ok(())
        })
        .unwrap();
    let value = h
        .prepare(true)
        .with_current_parts(|bytes, parts| {
            assert_eq!(parts.len(), 1);
            assert!(
                parts.iter().map(|part| part.png().len()).sum::<usize>()
                    <= MAX_AI_TOTAL_IMAGE_BYTES
            );
            Ok(serde_json::from_slice::<serde_json::Value>(bytes).unwrap())
        })
        .unwrap();
    assert_eq!(value["evidence"][0]["image"]["state"], "included");
    assert_eq!(value["evidence"][1]["image"]["state"], "budget");
}

#[test]
fn wrong_record_or_half_open_point_refuses_and_legacy_never_becomes_ai_evidence() {
    let h = Harness::new(vec![text(TextSource::Ocr, "owned")], false, false);
    h.configure(choices());
    for selection in [
        AiInputSelection::new(vec!["2".into()], h.ids.clone(), [h.now - 10, h.now + 1]).unwrap(),
        AiInputSelection::new(vec!["1".into()], h.ids.clone(), [h.now - 10, h.now - 5]).unwrap(),
    ] {
        assert!(h
            .service
            .prepare_ai_input(
                selection,
                h.consent
                    .begin(h.provider, AiPurpose::Classification, false)
                    .unwrap()
            )
            .is_err());
    }
    let legacy =
        AiInputSelection::new(vec!["1".into()], vec![h.legacy], [h.now - 20, h.now + 1]).unwrap();
    assert!(h
        .service
        .prepare_ai_input(
            legacy,
            h.consent
                .begin(h.provider, AiPurpose::Classification, false)
                .unwrap()
        )
        .unwrap()
        .is_none());
}

#[test]
fn revocation_before_access_exposes_no_parts_and_source_restoration_cannot_revive_the_request() {
    let h = Harness::new(
        vec![text(TextSource::Ocr, "owned private payload")],
        true,
        false,
    );
    h.configure(choices());
    let input = h.prepare(true);
    h.consent.revoke().unwrap();
    h.configure(choices());
    let mut called = false;
    assert!(input
        .with_current_parts(|_, _| {
            called = true;
            Ok(())
        })
        .is_err());
    assert!(!called);
    assert!(input.resolve_record_refs(&["r1".into()]).is_err());
}

#[test]
fn current_activity_failure_latches_even_after_the_old_row_is_restored() {
    let h = Harness::new(vec![text(TextSource::Ocr, "owned")], false, false);
    h.configure(choices());
    let input = h.prepare(false);
    let saved = h.reader.row.lock().unwrap().take();
    assert!(input.validate_for_commit().is_err());
    *h.reader.row.lock().unwrap() = saved;
    let calls = h.reader.calls.load(Ordering::Relaxed);
    assert!(input.with_current_parts(|_, _| Ok(())).is_err());
    assert_eq!(h.reader.calls.load(Ordering::Relaxed), calls);
}

#[test]
fn account_policy_and_deletion_epochs_invalidate_prepared_input_and_local_result_mapping() {
    for change in ["account", "policy", "delete"] {
        let h = Harness::new(vec![text(TextSource::Ocr, "owned")], true, false);
        h.configure(choices());
        let input = h.prepare(true);
        match change {
            "account" => {
                let _ = account(&h.owner);
            }
            "policy" => {
                h.service.set_policy(CapturePolicy::default()).unwrap();
            }
            "delete" => {
                h.service.delete_record(h.ids[0]).unwrap();
            }
            _ => unreachable!(),
        }
        let mut called = false;
        assert!(input
            .with_current_parts(|_, _| {
                called = true;
                Ok(())
            })
            .is_err());
        assert!(!called);
        assert!(input.resolve_record_refs(&["r1".into()]).is_err());
    }
}

#[test]
fn a_synchronous_callback_that_revokes_consent_cannot_commit_a_result() {
    let h = Harness::new(vec![text(TextSource::Ocr, "owned")], false, false);
    h.configure(choices());
    let input = h.prepare(false);
    let result = input.with_current_parts(|_, _| {
        h.consent.revoke().unwrap();
        Ok("uncommitted model result")
    });
    assert!(result.is_err());
    assert!(input.validate_for_commit().is_err());
}

#[test]
fn bounded_request_age_and_clock_rollback_latch_without_changing_host_time() {
    let h = Harness::new(vec![text(TextSource::Ocr, "owned")], false, false);
    h.configure(choices());
    let mut expired = h
        .consent
        .begin(h.provider, AiPurpose::Classification, false)
        .unwrap();
    expired.started = Instant::now() - MAX_INPUT_AGE;
    assert!(expired.validate().is_err());
    expired.started = Instant::now();
    assert!(expired.validate().is_err());
    let mut future = h
        .consent
        .begin(h.provider, AiPurpose::Classification, false)
        .unwrap();
    future.wall_started = SystemTime::now() + Duration::from_secs(60);
    assert!(future.validate().is_err());
    future.wall_started = SystemTime::now();
    assert!(future.validate().is_err());
}

#[test]
fn escaped_unicode_budget_stays_bounded_and_an_oversized_json_write_keeps_no_partial_item() {
    use std::io::Write;
    let h = Harness::new(
        (0..3)
            .map(|_| text(TextSource::Ocr, &"\u{0001}".repeat(800)))
            .collect(),
        false,
        false,
    );
    h.configure(choices());
    h.prepare(false)
        .with_current_parts(|bytes, _| {
            assert!(bytes.len() <= MAX_AI_JSON_BYTES);
            let value: serde_json::Value = serde_json::from_slice(bytes).unwrap();
            assert_eq!(
                value["evidence"][0]["text"]["excerpt"]
                    .as_str()
                    .unwrap()
                    .chars()
                    .count(),
                600
            );
            Ok(())
        })
        .unwrap();
    let mut buffer = JsonBuffer(Zeroizing::new(Vec::with_capacity(MAX_AI_JSON_BYTES)));
    buffer
        .write_all(&vec![b'a'; MAX_AI_JSON_BYTES - 1])
        .unwrap();
    let before = buffer.0.len();
    assert!(buffer.write_all(b"oversize").is_err());
    assert_eq!(buffer.0.len(), before);
}

#[test]
fn saving_separate_consent_closes_active_input_and_does_not_activate_the_saved_grant() {
    use crate::ai_consent::{AiConsentPreferences, AiRecipientRevision};
    let h = Harness::new(vec![text(TextSource::Ocr, "owned")], false, false);
    h.configure(choices());
    let prepared = h.prepare(false);
    let recipient =
        AiRecipientRevision::from_native_configuration(b"owned-route/model/processing-policy")
            .unwrap();
    let mut saved = AiConsentPreferences::default();
    saved.confirm(recipient.clone(), choices()).unwrap();
    h.service
        .save_ai_consent_preferences(&h.consent, &saved)
        .unwrap();
    assert!(prepared.validate_for_commit().is_err());
    assert!(h
        .consent
        .begin(h.provider, AiPurpose::Classification, false)
        .is_err());
    assert_eq!(h.service.read_ai_consent_preferences().unwrap(), saved);
    h.consent
        .configure(
            &h.authority,
            Some(h.provider),
            saved.choices_for(&recipient),
        )
        .unwrap();
    assert!(h.prepare(false).validate_for_commit().is_ok());
}

#[test]
fn an_unwritable_future_consent_store_still_closes_this_accounts_active_ai_input() {
    use crate::ai_consent::AiConsentPreferences;
    let h = Harness::new(vec![text(TextSource::Ocr, "owned")], false, false);
    h.configure(choices());
    let prepared = h.prepare(false);
    let path = h
        ._temp
        .path()
        .join("store")
        .join(
            ScopeId::from_profile("owned-test-profile")
                .unwrap()
                .path_component(),
        )
        .join("catalog.sqlite3");
    let foreign = rusqlite::Connection::open(path).unwrap();
    foreign.execute_batch("CREATE TABLE screen_ai_consent(future TEXT);INSERT INTO screen_ai_consent VALUES('preserve')").unwrap();
    drop(foreign);
    assert!(h
        .service
        .save_ai_consent_preferences(&h.consent, &AiConsentPreferences::default())
        .is_err());
    assert!(prepared.validate_for_commit().is_err());
    assert!(h
        .consent
        .begin(h.provider, AiPurpose::Classification, false)
        .is_err());
}

#[test]
fn recipient_review_revocation_during_a_durable_save_refuses_reopen_and_keeps_ai_off() {
    use crate::ai_consent::{AiConsentPreferences, AiRecipientRevision};
    let h = Harness::new(vec![text(TextSource::Ocr, "owned")], false, false);
    h.configure(choices());
    let prepared = h.prepare(false);
    let path = h
        ._temp
        .path()
        .join("store")
        .join(h.authority.scope().path_component())
        .join("catalog.sqlite3");
    let reader = rusqlite::Connection::open(path).unwrap();
    let mut saved = AiConsentPreferences::default();
    saved
        .confirm(
            AiRecipientRevision::from_native_configuration(b"reviewed-native-model").unwrap(),
            choices(),
        )
        .unwrap();

    // A recipient lost before saving still closes the active account gate,
    // while a first read/write refusal creates no optional consent table.
    assert!(matches!(
        h.service
            .save_ai_consent_preferences_guarded(&h.consent, &saved, &|| false),
        Err(Error::Invalidated)
    ));
    assert!(prepared.validate_for_commit().is_err());
    let count: i64 = reader
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE name='screen_ai_consent'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 0);

    // Observe the actual durable pending barrier through another connection,
    // then simulate the reviewed native recipient disappearing. The original
    // durable-save guard must run again after that independently visible write.
    let recipient_current = || {
        reader.query_row(
            "SELECT pending FROM screen_ai_consent WHERE id=1",
            [],
            |r| r.get::<_, i64>(0),
        ) != Ok(1)
    };
    assert!(matches!(
        h.service
            .save_ai_consent_preferences_guarded(&h.consent, &saved, &recipient_current),
        Err(Error::Invalidated)
    ));
    assert_eq!(
        reader
            .query_row(
                "SELECT pending FROM screen_ai_consent WHERE id=1",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        1
    );
    assert!(h.service.read_ai_consent_preferences().is_err());
    assert!(h
        .consent
        .begin(h.provider, AiPurpose::Classification, false)
        .is_err());

    // A fresh explicit review may repair our own interrupted save. Persistence
    // alone continues to grant neither a provider route nor an AI-use lease.
    h.service
        .save_ai_consent_preferences_guarded(&h.consent, &saved, &|| true)
        .unwrap();
    assert_eq!(h.service.read_ai_consent_preferences().unwrap(), saved);
    assert!(h
        .consent
        .begin(h.provider, AiPurpose::Classification, false)
        .is_err());
}

struct ReviewedRecipient(crate::ai_consent::AiRecipientRevision);
impl crate::ai_consent::NativeAiRecipient for ReviewedRecipient {
    fn revision(&self) -> &crate::ai_consent::AiRecipientRevision {
        &self.0
    }
    fn is_current(&self) -> bool {
        true
    }
    fn supports_images(&self) -> bool {
        true
    }
}

#[test]
fn native_reviews_save_exact_choices_without_overwriting_other_reviews_or_activating_ai() {
    use crate::ai_consent::{AiConsentReview, AiRecipientRevision};
    let h = Harness::new(vec![text(TextSource::Ocr, "owned")], false, false);
    h.configure(choices());
    let prepared = h.prepare(false);
    let a = Arc::new(ReviewedRecipient(
        AiRecipientRevision::from_native_configuration(b"native-A").unwrap(),
    ));
    let b = Arc::new(ReviewedRecipient(
        AiRecipientRevision::from_native_configuration(b"native-B").unwrap(),
    ));
    let a_choices = AiSourceChoices {
        accessibility_text: true,
        purposes: BTreeSet::from([AiPurpose::Classification]),
        ..Default::default()
    };
    let b_choices = AiSourceChoices {
        ocr_text: true,
        purposes: BTreeSet::from([AiPurpose::TimelineCards]),
        ..Default::default()
    };
    let a_review = AiConsentReview::new(h.authority.clone(), a.clone(), a_choices.clone()).unwrap();
    let b_review = AiConsentReview::new(h.authority.clone(), b.clone(), b_choices.clone()).unwrap();
    let id = a_review.id();
    a_review
        .save(&h.authority, id, &h.service, &h.consent)
        .unwrap();
    assert!(prepared.validate_for_commit().is_err());
    let id = b_review.id();
    b_review
        .save(&h.authority, id, &h.service, &h.consent)
        .unwrap();
    let saved = h.service.read_ai_consent_preferences().unwrap();
    assert_eq!(saved.choices_for(&a.0), a_choices);
    assert_eq!(saved.choices_for(&b.0), b_choices);
    assert!(h
        .consent
        .begin(h.provider, AiPurpose::Classification, true)
        .is_err());
}

#[test]
fn native_confirmation_refuses_foreign_review_id_and_even_same_scope_foreign_account() {
    use crate::ai_consent::{AiConsentReview, AiRecipientRevision};
    let h = Harness::new(vec![text(TextSource::Ocr, "owned")], false, false);
    let target = Arc::new(ReviewedRecipient(
        AiRecipientRevision::from_native_configuration(b"native-A").unwrap(),
    ));
    let review = AiConsentReview::new(h.authority.clone(), target.clone(), choices()).unwrap();
    let other = AiConsentReview::new(h.authority.clone(), target.clone(), choices()).unwrap();
    assert!(matches!(
        review.save(&h.authority, other.id(), &h.service, &h.consent),
        Err(Error::Invalidated)
    ));
    let foreign_owner = AccountGate::default();
    let foreign = account(&foreign_owner);
    assert_eq!(foreign.scope(), h.authority.scope());
    let review = AiConsentReview::new(h.authority.clone(), target.clone(), choices()).unwrap();
    let id = review.id();
    assert!(matches!(
        review.save(&foreign, id, &h.service, &h.consent),
        Err(Error::Invalidated)
    ));
    let other_service = Harness::new(vec![text(TextSource::Ocr, "other owned")], false, false);
    let review = AiConsentReview::new(h.authority.clone(), target, choices()).unwrap();
    let id = review.id();
    assert!(matches!(
        review.save(
            &h.authority,
            id,
            &other_service.service,
            &other_service.consent
        ),
        Err(Error::Invalidated)
    ));
    assert_eq!(
        other_service.service.read_ai_consent_preferences().unwrap(),
        crate::ai_consent::AiConsentPreferences::default()
    );
    assert_eq!(
        h.service.read_ai_consent_preferences().unwrap(),
        crate::ai_consent::AiConsentPreferences::default()
    );
}

#[test]
fn native_coordinator_confirms_once_and_keeps_saved_choices_separate_from_active_ai() {
    use crate::ai_consent::{AiConsentCoordinator, AiRecipientRevision};
    let h = Harness::new(vec![text(TextSource::Ocr, "owned")], false, false);
    h.configure(choices());
    let prepared = h.prepare(false);
    let target = Arc::new(ReviewedRecipient(
        AiRecipientRevision::from_native_configuration(b"native-coordinated-A").unwrap(),
    ));
    let coordinator = AiConsentCoordinator::default();
    let old = coordinator
        .prepare(h.authority.clone(), target.clone(), choices())
        .unwrap();
    let current = coordinator
        .prepare(h.authority.clone(), target.clone(), choices())
        .unwrap();
    assert!(coordinator
        .confirm(&h.authority, old.id(), &h.service, &h.consent)
        .is_err());
    assert!(current.is_current());
    coordinator
        .confirm(&h.authority, current.id(), &h.service, &h.consent)
        .unwrap();
    assert!(!current.is_current());
    assert!(prepared.validate_for_commit().is_err());
    assert!(coordinator
        .confirm(&h.authority, current.id(), &h.service, &h.consent)
        .is_err());
    assert_eq!(
        h.service
            .read_ai_consent_preferences()
            .unwrap()
            .choices_for(&target.0),
        choices()
    );
    assert!(h
        .consent
        .begin(h.provider, AiPurpose::Classification, true)
        .is_err());
}

struct CancelOnPendingRecipient {
    revision: crate::ai_consent::AiRecipientRevision,
    coordinator: std::sync::Weak<crate::ai_consent::AiConsentCoordinator>,
    path: std::path::PathBuf,
    saw_pending: std::sync::atomic::AtomicBool,
}
impl crate::ai_consent::NativeAiRecipient for CancelOnPendingRecipient {
    fn revision(&self) -> &crate::ai_consent::AiRecipientRevision {
        &self.revision
    }
    fn is_current(&self) -> bool {
        let reader = rusqlite::Connection::open_with_flags(
            &self.path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .unwrap();
        if reader.query_row(
            "SELECT pending FROM screen_ai_consent WHERE id=1",
            [],
            |r| r.get::<_, i64>(0),
        ) == Ok(1)
            && !self.saw_pending.swap(true, Ordering::AcqRel)
        {
            // The independent connection observes the real durable commit;
            // cancellation must not need the service/store lock held by save.
            self.coordinator
                .upgrade()
                .unwrap()
                .invalidate_now()
                .unwrap();
        }
        true
    }
    fn supports_images(&self) -> bool {
        true
    }
}

#[test]
fn native_coordinator_cancellation_interrupts_taken_review_after_real_durable_barrier() {
    use crate::ai_consent::{AiConsentCoordinator, AiRecipientRevision};
    let h = Harness::new(vec![text(TextSource::Ocr, "owned")], false, false);
    h.configure(choices());
    let prepared = h.prepare(false);
    let path = h
        ._temp
        .path()
        .join("store")
        .join(h.authority.scope().path_component())
        .join("catalog.sqlite3");
    let coordinator = Arc::new(AiConsentCoordinator::default());
    let target = Arc::new(CancelOnPendingRecipient {
        revision: AiRecipientRevision::from_native_configuration(b"native-cancel-on-commit")
            .unwrap(),
        coordinator: Arc::downgrade(&coordinator),
        path: path.clone(),
        saw_pending: std::sync::atomic::AtomicBool::new(false),
    });
    let view = coordinator
        .prepare(h.authority.clone(), target.clone(), choices())
        .unwrap();
    assert!(matches!(
        coordinator.confirm(&h.authority, view.id(), &h.service, &h.consent),
        Err(Error::Invalidated)
    ));
    assert!(target.saw_pending.load(Ordering::Acquire));
    assert!(!view.is_current());
    assert!(prepared.validate_for_commit().is_err());
    let reader =
        rusqlite::Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .unwrap();
    assert_eq!(
        reader
            .query_row(
                "SELECT pending FROM screen_ai_consent WHERE id=1",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        1
    );
    assert!(h.service.read_ai_consent_preferences().is_err());
    assert!(h
        .consent
        .begin(h.provider, AiPurpose::Classification, true)
        .is_err());
    assert!(coordinator
        .confirm(&h.authority, view.id(), &h.service, &h.consent)
        .is_err());
}

#[test]
fn scene_ocr_requires_new_reviewed_policy_and_never_includes_images_or_revives_after_route_loss() {
    use crate::ai_consent::{AiConsentReview, AiRecipientRevision};
    struct Recipient {
        revision: AiRecipientRevision,
        live: AtomicBool,
    }
    impl NativeAiRecipient for Recipient {
        fn revision(&self) -> &AiRecipientRevision {
            &self.revision
        }
        fn is_current(&self) -> bool {
            self.live.load(Ordering::Acquire)
        }
        fn supports_images(&self) -> bool {
            true
        }
    }
    let h = Harness::new_for_scene(
        vec![
            text(TextSource::Ocr, "selected synthetic scene text"),
            TextEvidence::new(TextSource::Ocr, TextState::NoText, Zeroizing::default()).unwrap(),
        ],
        true,
        false,
        true,
    );
    h.configure(choices());
    let old = h
        .consent
        .begin(h.provider, AiPurpose::Classification, true)
        .unwrap();
    assert!(
        h.service.prepare_ai_input(h.selection(), old).is_err(),
        "legacy grants must refuse scenes"
    );
    let target = Arc::new(Recipient {
        revision: AiRecipientRevision::from_native_configuration(b"owned-cloud-route-model-v1")
            .unwrap(),
        live: AtomicBool::new(true),
    });
    let scene = Arc::new(SceneOcrRecipient::from_native(target.clone()).unwrap());
    let ocr = AiSourceChoices {
        ocr_text: true,
        purposes: BTreeSet::from([AiPurpose::Classification]),
        ..Default::default()
    };
    let mut old_preferences = AiConsentPreferences::default();
    old_preferences
        .confirm(target.revision().clone(), ocr.clone())
        .unwrap();
    assert!(h
        .consent
        .configure_scene_ocr(&h.authority, h.provider, scene.clone(), &old_preferences)
        .is_err());
    for invalid in [
        choices(),
        AiSourceChoices {
            accessibility_text: true,
            ..ocr.clone()
        },
        AiSourceChoices {
            images: true,
            ..ocr.clone()
        },
    ] {
        assert!(AiConsentReview::new(h.authority.clone(), scene.clone(), invalid).is_err());
    }
    let review = AiConsentReview::new(h.authority.clone(), scene.clone(), ocr).unwrap();
    let review_id = review.id();
    review
        .save(&h.authority, review_id, &h.service, &h.consent)
        .unwrap();
    let saved = h.service.read_ai_consent_preferences().unwrap();
    h.consent
        .configure_scene_ocr(&h.authority, h.provider, scene.clone(), &saved)
        .unwrap();
    // A no-text scene cannot by itself create an external analysis request.
    let no_text = AiInputSelection::new(
        vec!["1".into()], vec![h.ids[1]], [h.now - 10, h.now + 1],
    ).unwrap();
    let lease = h.consent.begin(h.provider, AiPurpose::Classification, false).unwrap();
    assert!(h.service.prepare_ai_input(no_text, lease).unwrap().is_none());
    let input = h.prepare(true);
    input
        .with_current_parts(|bytes, images| {
            assert!(images.is_empty());
            let payload: serde_json::Value = serde_json::from_slice(bytes).unwrap();
            assert_eq!(payload["schemaVersion"], "drifty.screen-scene-ocr.v1");
            assert_eq!(payload["evidence"].as_array().unwrap().len(), 1);
            assert!(payload["attachments"].as_array().unwrap().is_empty());
            assert_eq!(payload["evidence"][0]["text"]["scope"], "foreground_window_region");
            let body = std::str::from_utf8(bytes).unwrap();
            assert!(body.contains("selected synthetic scene text"));
            for forbidden in [
                "owned.front",
                "owned.background",
                "owned browser",
                "work.example.com",
                "exclusionInventory",
                "displayId",
                "windowId",
                "processBirth",
                "data:image",
            ] {
                assert!(!body.contains(forbidden));
            }
            Ok(())
        })
        .unwrap();
    target.live.store(false, Ordering::Release);
    assert!(input.validate_for_commit().is_err());
    target.live.store(true, Ordering::Release);
    assert!(!scene.is_current());
    assert!(h
        .consent
        .begin(h.provider, AiPurpose::Classification, true)
        .is_err());
    let replacement = Arc::new(SceneOcrRecipient::from_native(target).unwrap());
    h.consent
        .configure_scene_ocr(&h.authority, h.provider, replacement, &saved)
        .unwrap();
    assert!(input.validate_for_commit().is_err());
    let pending = h.prepare(false);
    h.consent.revoke().unwrap();
    assert!(pending.validate_for_commit().is_err());
}
