use super::*;
use crate::{store::EvidenceMetadata, TextState};
use zeroize::Zeroizing;

pub(crate) fn scene() -> DisplaySceneIdentity {
    DisplaySceneIdentity {
        display_id: 1,
        observation_epoch: 7,
        foreground: SceneForeground {
            pid: 8,
            process_birth: 19,
            window_id: 20,
            app_id: "owned.front".into(),
        },
        visible_apps: BTreeSet::from(["owned.front".into(), "owned.background".into()]),
        exclusion_inventory: None,
        foreground_region: Some(SceneRegion {
            x: 0,
            y: 0,
            width: 1,
            height: 2,
        }),
        text_scope: SceneTextScope::ForegroundWindowRegion,
    }
}

#[test]
fn scene_and_legacy_document_survive_encrypted_reopen_without_fabricating_a_document() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("scene");
    let mut store = crate::tests::open(&root, 1000);
    let legacy = store
        .append(store.generation(), crate::tests::evidence(1000), true, 1000)
        .unwrap();
    let input = crate::tests::evidence(1001);
    let scene_id = store
        .append_scene_if_current(
            store.generation(),
            scene(),
            1001,
            input.text,
            input.frame,
            true,
            1001,
            &|| true,
        )
        .unwrap();
    let scene_value =
        serde_json::to_value(store.read_metadata(scene_id, 1001).unwrap().unwrap()).unwrap();
    assert_eq!(scene_value["metadataVersion"], 4);
    assert!(scene_value.get("surface").is_none());
    assert!(scene_value["scene"].get("documentId").is_none());
    let document =
        serde_json::to_value(store.read_metadata(legacy, 1001).unwrap().unwrap()).unwrap();
    assert!(document.get("scene").is_none());
    assert_eq!(
        document["surface"]["documentId"],
        "owned-document-fingerprint"
    );
    assert!(!format!(
        "{:?}",
        store.read_metadata(scene_id, 1001).unwrap().unwrap()
    )
    .contains("owned.front"));
    drop(store);
    let mut reopened = crate::tests::open(&root, 1002);
    assert_eq!(
        serde_json::to_value(reopened.read_metadata(scene_id, 1002).unwrap().unwrap()).unwrap(),
        scene_value
    );
    assert_eq!(
        serde_json::to_value(reopened.read_metadata(legacy, 1002).unwrap().unwrap()).unwrap(),
        document
    );
    assert!(reopened.read_frame(scene_id, 1002).unwrap().is_some());
    let excluded = BTreeSet::from(["owned.background".into()]);
    let page = reopened
        .list_page_excluding(None, 20, 1002, &excluded)
        .unwrap();
    assert_eq!(page.records.len(), 1);
    assert_eq!(page.records[0].id, legacy);
    assert!(reopened
        .read_metadata(scene_id, 1002)
        .unwrap()
        .unwrap()
        .surface
        .is_excluded(&excluded));
    reopened.delete_record(scene_id, 1002).unwrap();
    assert!(reopened.read_metadata(scene_id, 1002).unwrap().is_none());
    assert!(reopened.read_frame(scene_id, 1002).unwrap().is_none());
    assert!(reopened.read_metadata(legacy, 1002).unwrap().is_some());
}

#[test]
fn scene_refuses_wrong_text_scope_region_inventory_and_future_or_mixed_wire() {
    let input = crate::tests::evidence(1000);
    let valid = scene();
    assert!(valid.validate(2, 2, &input.text).is_ok());
    for kind in 0..7 {
        let mut invalid = valid.clone();
        match kind {
            0 => invalid.foreground_region.as_mut().unwrap().x = u32::MAX,
            1 => invalid.foreground_region.as_mut().unwrap().height = 3,
            2 => invalid.foreground_region = None,
            3 => invalid.visible_apps.clear(),
            4 => {
                invalid.visible_apps.remove("owned.front");
            }
            5 => invalid.observation_epoch = 0,
            _ => invalid.text_scope = SceneTextScope::None,
        }
        assert!(invalid.validate(2, 2, &input.text).is_err());
    }
    let ax = TextEvidence::new(
        TextSource::Accessibility,
        TextState::Recognized,
        Zeroizing::new("not OCR".into()),
    )
    .unwrap();
    assert!(valid.validate(2, 2, &ax).is_err());
    let temp = tempfile::tempdir().unwrap();
    let mut store = crate::tests::open(&temp.path().join("wire"), 1000);
    let id = store
        .append_scene_if_current(
            store.generation(),
            valid,
            1000,
            input.text,
            input.frame,
            true,
            1000,
            &|| true,
        )
        .unwrap();
    let value = serde_json::to_value(store.read_metadata(id, 1000).unwrap().unwrap()).unwrap();
    for kind in 0..5 {
        let mut malformed = value.clone();
        match kind {
            0 => malformed["metadataVersion"] = 5.into(),
            1 => malformed["surface"] = serde_json::json!({"documentId":"invented"}),
            2 => malformed["scene"]["textScope"] = "whole_scene".into(),
            3 => malformed["scene"]["unknownConsent"] = true.into(),
            _ => malformed["trackerRecordId"] = "123".into(),
        }
        assert!(serde_json::from_value::<EvidenceMetadata>(malformed).is_err());
    }
}

pub(crate) fn facts() -> SceneCaptureFacts {
    SceneCaptureFacts {
        identity: scene(),
        permission: true,
        interactive: true,
        inventory_complete: true,
        windows: vec![
            SceneWindowPrivacy {
                pid: 8,
                process_birth: 19,
                window_id: 20,
                app_id: "owned.front".into(),
                app_name: None,
                site_domain: None,
                privacy: Privacy::Normal,
                protected: false,
                site_policy_known: true,
                excluded_site: false,
            },
            SceneWindowPrivacy {
                pid: 9,
                process_birth: 22,
                window_id: 21,
                app_id: "owned.background".into(),
                app_name: None,
                site_domain: None,
                privacy: Privacy::NotBrowser,
                protected: false,
                site_policy_known: false,
                excluded_site: false,
            },
        ],
    }
}

#[test]
fn general_scope_is_explicit_and_scene_admission_checks_background_privacy() {
    use crate::{CapturePolicy, CapturePreferences};
    let legacy = serde_json::json!({"enabled":true,"replayEnabled":true,"visibleTextEnabled":false,
        "ocrEnabled":false,"allowedApps":["owned.editor"],"intervalSeconds":10});
    let restored: CapturePreferences = serde_json::from_value(legacy.clone()).unwrap();
    assert_eq!(restored.scope, CaptureScope::SelectedApps);
    assert_eq!(serde_json::to_value(restored).unwrap(), legacy);
    let preferences = CapturePreferences {
        scope: CaptureScope::ActiveDisplayScene,
        enabled: true,
        replay_enabled: true,
        ocr_enabled: true,
        ..Default::default()
    };
    let policy = preferences.policy().unwrap();
    assert!(policy.admits_scene(&facts()));
    assert!(!CapturePolicy::default().admits_scene(&facts()));
    for variant in 0..13 {
        let mut observed = facts();
        match variant {
            0 => observed.permission = false,
            1 => observed.interactive = false,
            2 => observed.inventory_complete = false,
            3 => observed.windows[1].privacy = Privacy::Private,
            4 => {
                observed.windows[1].privacy = Privacy::Unknown;
                observed.windows[1].site_policy_known = false;
            }
            5 => {
                observed.windows[1].privacy = Privacy::Normal;
                observed.windows[1].site_policy_known = false;
            }
            6 => observed.windows[1].excluded_site = true,
            7 => observed.windows[1].protected = true,
            8 => observed.windows[1].window_id = 20,
            9 => observed.windows[0].pid += 1,
            10 => observed.windows[0].process_birth += 1,
            11 => observed.windows[1].process_birth = 0,
            _ => {
                observed.identity.visible_apps.remove("owned.background");
            }
        }
        if variant == 4 || variant == 5 {
            assert!(policy.admits_scene(&observed));
            let mut site_policy = policy.clone();
            site_policy
                .excluded_apps
                .insert("site:owned.example".into());
            assert!(
                !site_policy.admits_scene(&observed),
                "unknown site cannot evade an existing site rule"
            );
        } else {
            assert!(!policy.admits_scene(&observed));
        }
    }
    let mut unknown = facts();
    for window in &mut unknown.windows {
        window.privacy = Privacy::Unknown;
        window.site_policy_known = true;
    }
    assert!(
        policy.admits_scene(&unknown),
        "unknown private status alone must not block recording"
    );
    unknown.windows[1].privacy = Privacy::Private;
    assert!(
        !policy.admits_scene(&unknown),
        "confirmed private background window still blocks"
    );
    let mut excluded = policy.clone();
    excluded.excluded_apps.insert("owned.background".into());
    assert!(!excluded.admits_scene(&facts()));
    let mut mixed = preferences;
    mixed.allowed_apps.insert("owned.editor".into());
    assert!(mixed.validate().is_err());
}

#[test]
fn scene_worker_stores_same_source_and_refuses_epoch_change_without_legacy_fallback() {
    use crate::{
        Cancellation, CaptureBackend, CaptureFailure, CapturePolicy, NativeCapture,
        NativeSceneCapture, ScreenContextService,
    };
    use std::{
        sync::Arc,
        time::{Duration, Instant},
    };
    struct SceneBackend {
        changes: bool,
    }
    impl CaptureBackend for SceneBackend {
        fn supports_scene_capture(&self) -> bool {
            true
        }
        fn capture(
            &self,
            _: &CapturePolicy,
            _: &Cancellation,
        ) -> Result<NativeCapture, CaptureFailure> {
            panic!("scene request must not use legacy document capture")
        }
        fn capture_scene(
            &self,
            policy: &CapturePolicy,
            _: &Cancellation,
        ) -> Result<NativeSceneCapture, CaptureFailure> {
            let before = facts();
            if !policy.admits_scene(&before) {
                return Err(CaptureFailure::Protected);
            }
            let mut after = before.clone();
            if self.changes {
                after.identity.observation_epoch += 1;
            }
            let input = crate::tests::evidence(crate::unix_millis().unwrap());
            Ok(NativeSceneCapture {
                before,
                after,
                observed_at_ms: input.observed_at_ms,
                text: input.text,
                frame: input.frame,
                activity_hint: None,
            })
        }
    }
    struct Legacy;
    impl CaptureBackend for Legacy {
        fn prepare(&self, _: &CapturePolicy, _: &Cancellation) -> Result<(), CaptureFailure> {
            panic!("unsupported scene request cannot even start a legacy helper")
        }
        fn capture(
            &self,
            _: &CapturePolicy,
            _: &Cancellation,
        ) -> Result<NativeCapture, CaptureFailure> {
            panic!()
        }
    }
    for case in 0..3 {
        let temp = tempfile::tempdir().unwrap();
        let backend: Arc<dyn CaptureBackend> = if case == 2 {
            Arc::new(Legacy)
        } else {
            Arc::new(SceneBackend { changes: case == 1 })
        };
        let mut service = ScreenContextService::new(backend).unwrap();
        service
            .replace_store(Some(crate::tests::open(
                &temp.path().join("store"),
                crate::unix_millis().unwrap(),
            )))
            .unwrap();
        service
            .set_policy(CapturePolicy {
                scope: CaptureScope::ActiveDisplayScene,
                enabled: true,
                replay_enabled: true,
                ocr_enabled: true,
                ..Default::default()
            })
            .unwrap();
        assert!(service.request_sample());
        let deadline = Instant::now() + Duration::from_secs(3);
        while service.status().pending || service.status().running {
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(2));
        }
        let page = service.list_page(None, 20).unwrap();
        if case == 0 {
            assert_eq!(page.records.len(), 1);
            let id = page.records[0].id;
            assert!(service
                .read_metadata(id)
                .unwrap()
                .unwrap()
                .surface
                .is_scene());
            assert!(service.read_frame(id).unwrap().is_some());
            service
                .set_global_exclusions(Some(BTreeSet::from(["owned.background".into()])))
                .unwrap();
            assert!(service.list_page(None, 20).unwrap().records.is_empty());
            assert!(service.read_frame(id).unwrap().is_none());
        } else {
            assert!(page.records.is_empty());
            assert_eq!(
                service.status().last_failure,
                Some(if case == 1 {
                    CaptureFailure::Invalidated
                } else {
                    CaptureFailure::Unsupported
                })
            );
        }
        assert!(service.shutdown(Duration::from_millis(1100)));
    }
}

pub(crate) fn inventoried_facts() -> SceneCaptureFacts {
    let mut facts = facts();
    facts.windows[0].app_name = Some("Owned Browser".into());
    facts.windows[0].site_domain = Some("work.example.com".into());
    facts.windows[1].app_name = Some("Owned Background".into());
    facts.identity.exclusion_inventory = Some(SceneExclusionInventory {
        app_names: BTreeSet::from(["owned browser".into(), "owned background".into()]),
        site_domains: BTreeSet::from(["work.example.com".into()]),
        sites_complete: true,
    });
    facts
}
#[test]
fn native_inventory_cannot_omit_a_window_site_or_name_and_domain_rules_include_subdomains() {
    let observed = inventoried_facts();
    assert!(observed.admissible(&BTreeSet::new()));
    for rule in [
        "site:example.com",
        "site:work.example.com",
        "name:owned background",
        "OWNED.FRONT",
    ] {
        assert!(
            !observed.admissible(&BTreeSet::from([rule.into()])),
            "{rule}"
        );
    }
    for rule in [
        "site:ample.com",
        "site:example.com.evil.test",
        "name:owned back",
    ] {
        assert!(
            observed.admissible(&BTreeSet::from([rule.into()])),
            "{rule}"
        );
    }
    for variant in 0..5 {
        let mut altered = observed.clone();
        match variant {
            0 => altered
                .identity
                .exclusion_inventory
                .as_mut()
                .unwrap()
                .site_domains
                .clear(),
            1 => altered
                .identity
                .exclusion_inventory
                .as_mut()
                .unwrap()
                .app_names
                .clear(),
            2 => altered.windows[1].app_name = None,
            3 => {
                altered
                    .identity
                    .exclusion_inventory
                    .as_mut()
                    .unwrap()
                    .sites_complete = false
            }
            _ => altered.windows[0].site_domain = Some("other.test".into()),
        }
        assert!(!altered.admissible(&BTreeSet::new()), "variant {variant}");
    }
    for malformed in [
        "https://example.com/a",
        "example.com:443",
        "example.com/",
        "UPPER.test",
        "a..test",
        "-a.test",
    ] {
        assert!(!valid_site_domain(malformed));
    }
    // Old scene receipts have no inventory. They cannot evade new exclusion
    // rules after an upgrade merely because the field was absent at capture.
    assert!(!facts().admissible(&BTreeSet::from(["site:example.com".into()])));
    assert!(!facts().admissible(&BTreeSet::from(["name:owned background".into()])));
}
#[test]
fn later_site_and_name_exclusions_hide_encrypted_scene_pages_after_reopen() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("inventory");
    let mut store = crate::tests::open(&root, 1000);
    let input = crate::tests::evidence(1000);
    let id = store
        .append_scene_if_current(
            store.generation(),
            inventoried_facts().identity,
            1000,
            input.text,
            input.frame,
            true,
            1000,
            &|| true,
        )
        .unwrap();
    let legacy_input = crate::tests::evidence(1001);
    let legacy = store
        .append_scene_if_current(
            store.generation(),
            scene(),
            1001,
            legacy_input.text,
            legacy_input.frame,
            true,
            1001,
            &|| true,
        )
        .unwrap();
    let reference: crate::LocalActivityRecordRef = serde_json::from_value(serde_json::json!({
        "recordId":"1","segmentUid":"f26d8c10-cb09-4c98-a3e3-3744216aab1e","identityDigest":"a".repeat(64),"startedAtMs":1000,"endedAtMs":2000
    })).unwrap();
    assert!(store
        .bind_activity_if_current(store.generation(), id, &reference, 1001, &|| true)
        .unwrap()
        .is_some());
    drop(store);
    let mut store = crate::tests::open(&root, 1002);
    let metadata = store.read_metadata(id, 1002).unwrap().unwrap();
    for rule in ["site:example.com", "name:owned background"] {
        let rules = BTreeSet::from([rule.into()]);
        assert!(metadata.surface.is_excluded(&rules));
        assert!(store
            .list_bound_page(std::slice::from_ref(&reference), None, 20, &rules, 1002)
            .unwrap()
            .records
            .is_empty());
        assert!(store
            .list_page_excluding(None, 20, 1002, &rules)
            .unwrap()
            .records
            .is_empty());
    }
    let allowed = BTreeSet::from(["site:other.test".into()]);
    let page = store.list_page_excluding(None, 20, 1002, &allowed).unwrap();
    assert_eq!(page.records.len(), 1);
    assert_eq!(page.records[0].id, id);
    assert!(store
        .read_metadata(legacy, 1002)
        .unwrap()
        .unwrap()
        .surface
        .is_excluded(&allowed));
    store.delete_record(id, 1002).unwrap();
    assert!(store.read_frame(id, 1002).unwrap().is_none());
}

#[test]
fn unknown_site_is_recorded_only_without_site_rules_and_is_hidden_when_a_site_rule_arrives() {
    let mut observed = inventoried_facts();
    observed.windows[0].privacy = Privacy::Unknown;
    observed.windows[0].site_domain = None;
    observed.windows[0].site_policy_known = false;
    let inventory = observed.identity.exclusion_inventory.as_mut().unwrap();
    inventory.site_domains.clear();
    inventory.sites_complete = false;
    assert!(observed.admissible(&BTreeSet::new()));
    let rules = BTreeSet::from(["site:bank.example".into()]);
    assert!(!observed.admissible(&rules));
    assert!(observed.identity.is_excluded(&rules));
}
