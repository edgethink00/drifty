use super::*;
use drifty_screen_context_core::lease::AccountGate;
use tauri::ipc::{InvokeResponseBody, IpcResponse};

#[test]
fn sensitive_response_keeps_the_existing_json_envelope_without_double_encoding() {
    let gate = AccountGate::default();
    let id = gate
        .bind_verified(
            gate.begin_transition().unwrap(),
            ScopeId::from_profile("owned-response-test").unwrap(),
            Instant::now() + Duration::from_secs(10),
        )
        .unwrap();
    let lease = gate.read(id).unwrap();
    let mut service = ScreenContextService::new(Arc::new(UnavailableBackend)).unwrap();
    let page = EvidencePage {
        records: Vec::new(),
        next_cursor: None,
    };
    let value = lease
        .reply(ReviewReply::Empty(
            service.observation_lease().reply(page).unwrap(),
        ))
        .unwrap();
    let InvokeResponseBody::Json(body) = sensitive_response(value).unwrap().body().unwrap() else {
        panic!("expected whole JSON response")
    };
    let json: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(json["leaseId"], serde_json::to_value(id).unwrap());
    assert_eq!(
        json["value"],
        serde_json::json!({"records":[],"nextCursor":null})
    );
    assert!(service.shutdown(Duration::from_millis(1100)));
}

#[test]
fn account_revocation_and_serializer_failures_return_a_fixed_error_without_a_body() {
    let gate = AccountGate::default();
    let id = gate
        .bind_verified(
            gate.begin_transition().unwrap(),
            ScopeId::from_profile("owned-response-revoke").unwrap(),
            Instant::now() + Duration::from_secs(10),
        )
        .unwrap();
    let lease = gate.read(id).unwrap();
    let value = lease.reply("owned private content").unwrap();
    gate.begin_transition().unwrap();
    assert!(matches!(sensitive_response(value),Err(ref error) if error==UNAVAILABLE));
    struct Failed;
    impl Serialize for Failed {
        fn serialize<S: serde::Serializer>(&self, _: S) -> Result<S::Ok, S::Error> {
            Err(serde::ser::Error::custom("owned private serializer detail"))
        }
    }
    assert!(matches!(sensitive_response(Failed),Err(ref error) if error==UNAVAILABLE));
}

#[test]
fn native_runtime_account_invalidation_and_shutdown_close_pending_ai_reviews() {
    use drifty_screen_context_core::{
        ai_consent::{AiRecipientRevision, NativeAiRecipient},
        ai_input::{AiPurpose, AiSourceChoices},
    };
    struct Recipient(AiRecipientRevision);
    impl NativeAiRecipient for Recipient {
        fn revision(&self) -> &AiRecipientRevision {
            &self.0
        }
        fn is_current(&self) -> bool {
            true
        }
        fn supports_images(&self) -> bool {
            false
        }
    }
    let account = ScreenContextAccount::default();
    for action in ["observation", "account", "shutdown"] {
        let id = account
            .gate
            .bind_verified(
                account.gate.begin_transition().unwrap(),
                ScopeId::from_profile("owned-runtime-review").unwrap(),
                Instant::now() + Duration::from_secs(30),
            )
            .unwrap();
        let authority = account.gate.read(id).unwrap();
        let view = account
            .runtime
            .ai_consent
            .prepare(
                authority.clone(),
                Arc::new(Recipient(
                    AiRecipientRevision::from_native_configuration(b"owned-native-runtime")
                        .unwrap(),
                )),
                AiSourceChoices {
                    accessibility_text: true,
                    purposes: std::collections::BTreeSet::from([AiPurpose::Classification]),
                    ..Default::default()
                },
            )
            .unwrap();
        assert!(view.is_current());
        match action {
            "observation" => {
                account.runtime.invalidate_now();
                // Proves the runtime coordinator hook independently of the
                // account capability's own revocation fence.
                assert!(authority.is_current());
            }
            "account" => account.revoke().unwrap(),
            _ => account.shutdown(),
        }
        assert!(!view.is_current());
    }
}
#[test]
fn macos_major_reads_the_product_version_major() {
    assert_eq!(super::macos_major(b"14.8.7\0"), Some(14));
    assert_eq!(super::macos_major(b"13.6"), Some(13));
    assert_eq!(super::macos_major(b"26.0\0"), Some(26));
    assert_eq!(super::macos_major(b""), None);
    assert_eq!(super::macos_major(b"\xff"), None);
}

#[test]
fn general_scene_policy_is_mac_only_and_keeps_legacy_defaults() {
    let mut preferences = CapturePreferences {
        scope: drifty_screen_context_core::CaptureScope::ActiveDisplayScene,
        enabled: true,
        replay_enabled: true,
        ..Default::default()
    };
    assert!(preferences.validate().is_ok());
    if cfg!(target_os = "macos") {
        assert_eq!(
            policy_for(&preferences).unwrap().scope,
            drifty_screen_context_core::CaptureScope::ActiveDisplayScene
        );
    } else {
        assert!(
            matches!(policy_for(&preferences), Err(ref code) if code == "screen_context_general_capture_unavailable")
        );
    }
    preferences.scope = drifty_screen_context_core::CaptureScope::SelectedApps;
    preferences.enabled = false;
    assert!(policy_for(&preferences).is_ok());
}

#[cfg(target_os = "macos")]
#[test]
fn general_upgrade_keeps_recording_on_without_resuming_a_real_deletion_pause() {
    for deleted in [false, true] {
        let temp = tempfile::tempdir().unwrap();
        let scope = ScopeId::from_profile("general-upgrade-durable-pause").unwrap();
        let open = || {
            EvidenceStore::open(
                temp.path(),
                scope.clone(),
                zeroize::Zeroizing::new([7; 32]),
                Retention::default(),
                unix_millis().unwrap(),
            )
            .unwrap()
        };
        let mut service = ScreenContextService::new(Arc::new(UnavailableBackend)).unwrap();
        service.replace_store(Some(open())).unwrap();
        let mut preferences = CapturePreferences {
            enabled: true,
            replay_enabled: true,
            visible_text_enabled: true,
            allowed_apps: std::collections::BTreeSet::from(["textedit".into()]),
            ..Default::default()
        };
        service
            .set_policy(policy_for(&preferences).unwrap())
            .unwrap();
        service.save_preferences(&preferences).unwrap();
        service.resume_capture().unwrap();
        if deleted {
            service.delete_range(0, unix_millis().unwrap()).unwrap();
        }
        assert_eq!(service.status().paused, deleted);
        let mut next = preferences.clone();
        assert!(next.upgrade_general_recording(true));
        apply_general_upgrade(&service, &mut preferences, next).unwrap();
        assert!(!preferences.general_notice_pending);
        assert_eq!(service.status().paused, deleted);
        assert!(
            !service.request_sample(),
            "trusted rules remain closed during migration"
        );
        service
            .set_global_exclusions(Some(Default::default()))
            .unwrap();
        assert_eq!(service.status().paused, deleted);
        assert!(service.shutdown(Duration::from_millis(1100)));
        drop(service);
        let mut reopened = open();
        assert_eq!(
            reopened.capture_paused(),
            deleted,
            "pause must persist unchanged"
        );
        assert_eq!(
            reopened.read_preferences(unix_millis().unwrap()).unwrap(),
            preferences
        );
    }
}
