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
