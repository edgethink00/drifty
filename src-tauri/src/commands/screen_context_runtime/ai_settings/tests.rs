use super::*;
use drifty_screen_context_core::{ai_consent::AiRecipientRevision, lease::AccountGate};

fn bind(gate: &AccountGate) -> (AccountLeaseId, AccountReadLease) {
    let id = gate
        .bind_verified(
            gate.begin_transition().unwrap(),
            ScopeId::from_profile("owned-ai-settings").unwrap(),
            Instant::now() + Duration::from_secs(30),
        )
        .unwrap();
    (id, gate.read(id).unwrap())
}
fn choices() -> AiSourceChoices {
    AiSourceChoices {
        accessibility_text: true,
        purposes: BTreeSet::from([AiPurpose::Classification]),
        ..Default::default()
    }
}
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

#[test]
fn settings_choices_refuse_unknown_fields_duplicates_and_partial_or_coerced_selection() {
    let good = serde_json::json!({"accessibilityText":true,"ocrText":false,"images":false,"purposes":["classification"]});
    let decoded: AiChoicesWire = serde_json::from_value(good.clone()).unwrap();
    assert_eq!(AiSourceChoices::try_from(decoded).unwrap(), choices());
    for key in [
        "endpoint",
        "model",
        "recipientRevision",
        "pid",
        "recordId",
        "enabled",
    ] {
        let mut other = good.clone();
        other[key] = serde_json::json!("renderer-selected");
        assert!(serde_json::from_value::<AiChoicesWire>(other).is_err());
    }
    for patch in [
        serde_json::json!({"purposes":["classification","classification"]}),
        serde_json::json!({"purposes":[]}),
        serde_json::json!({"accessibilityText":false}),
    ] {
        let mut other = good.clone();
        other
            .as_object_mut()
            .unwrap()
            .extend(patch.as_object().unwrap().clone());
        assert!(
            AiSourceChoices::try_from(serde_json::from_value::<AiChoicesWire>(other).unwrap())
                .is_err()
        );
    }
    let mut other = good;
    other["images"] = serde_json::json!(1);
    assert!(serde_json::from_value::<AiChoicesWire>(other).is_err());
}

#[test]
fn native_use_gate_starts_off_is_exact_account_bound_and_revokes_without_store_io() {
    let owner = AccountGate::default();
    let (_, first) = bind(&owner);
    let runtime = ScreenContextRuntime::default();
    let gate = runtime.ai_gate(&first).unwrap();
    let route = Uuid::new_v4();
    assert!(gate.begin(route, AiPurpose::Classification, false).is_err());
    gate.configure(&first, Some(route), choices()).unwrap();
    let pending = gate.begin(route, AiPurpose::Classification, false).unwrap();
    assert!(pending.validate().is_ok());
    runtime.revoke_ai_use_now().unwrap();
    assert!(pending.validate().is_err());
    assert!(runtime.service.get().is_none());
    let other_owner = AccountGate::default();
    let (_, second) = bind(&other_owner);
    assert_eq!(first.scope(), second.scope());
    let next = runtime.ai_gate(&second).unwrap();
    assert!(!Arc::ptr_eq(&gate, &next));
    assert!(next.begin(route, AiPurpose::Classification, false).is_err());
    next.configure(&second, Some(route), choices()).unwrap();
    let pending = next.begin(route, AiPurpose::Classification, false).unwrap();
    runtime.invalidate_now();
    assert!(second.is_current());
    assert!(pending.validate().is_err());
}

#[test]
fn content_free_settings_and_superseded_saved_reply_never_claim_active_delivery() {
    let value = SettingsStatus {
        recipient: None,
        choices: None,
        preferences_invalid: false,
        review: None,
    };
    let wire = serde_json::to_value(value).unwrap();
    assert_eq!(
        wire,
        serde_json::json!({"recipient":null,"savedChoices":null,"preferencesInvalid":false,"active":false,"deliveryAvailable":false,"pendingReviewId":null})
    );
    let coordinator = drifty_screen_context_core::ai_consent::AiConsentCoordinator::default();
    let value = SavedStatus(coordinator.begin_operation().unwrap());
    assert_eq!(
        serde_json::to_value(&value).unwrap(),
        serde_json::json!({"saved":true,"active":false})
    );
    coordinator.invalidate_now().unwrap();
    assert!(serde_json::to_string(&value).is_err());
    assert!(matches!(sensitive_response(value),Err(ref error) if error==UNAVAILABLE));
}

#[test]
fn cancel_ipc_from_another_window_cannot_close_a_main_window_review() {
    let app = tauri::test::mock_builder()
        .manage(ScreenContextAccount::default())
        .invoke_handler(tauri::generate_handler![screen_context_ai_cancel_review])
        .build(crate::app_context())
        .unwrap();
    let main = app.get_webview_window("main").unwrap_or_else(|| {
        tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap()
    });
    let other = tauri::WebviewWindowBuilder::new(&app, "screen-ai-qa-denied", Default::default())
        .build()
        .unwrap();
    let account = app.state::<ScreenContextAccount>();
    let (id, lease) = bind(&account.gate);
    let view = account
        .runtime
        .ai_consent
        .prepare(
            lease,
            Arc::new(Recipient(
                AiRecipientRevision::from_native_configuration(b"owned-native-recipient").unwrap(),
            )),
            choices(),
        )
        .unwrap();
    let invoke = |window: &tauri::WebviewWindow<tauri::test::MockRuntime>| {
        tauri::test::get_ipc_response(
            window,
            tauri::webview::InvokeRequest {
                cmd: "screen_context_ai_cancel_review".into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: "tauri://localhost".parse().unwrap(),
                body: tauri::ipc::InvokeBody::Json(
                    serde_json::json!({"leaseId":id,"reviewId":view.id()}),
                ),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.into(),
            },
        )
    };
    assert!(invoke(&other).is_err());
    assert!(view.is_current());
    assert!(invoke(&main).is_ok());
    assert!(!view.is_current());
}
