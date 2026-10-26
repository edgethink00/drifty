use super::*;

fn recipient(value: &str) -> AiRecipientRevision {
    AiRecipientRevision::from_native_configuration(value.as_bytes()).unwrap()
}
fn choices() -> AiSourceChoices {
    AiSourceChoices {
        ocr_text: true,
        purposes: BTreeSet::from([AiPurpose::Classification]),
        ..Default::default()
    }
}

#[test]
fn defaults_do_not_inherit_and_recipient_model_or_processing_changes_require_another_grant() {
    let a = recipient("providerA/model1/processor-policy1");
    let mut preferences = AiConsentPreferences::default();
    assert_eq!(preferences.choices_for(&a), AiSourceChoices::default());
    preferences.confirm(a.clone(), choices()).unwrap();
    assert_eq!(preferences.choices_for(&a), choices());
    for config in [
        "providerB/model1/processor-policy1",
        "providerA/model2/processor-policy1",
        "providerA/model1/processor-policy2",
    ] {
        assert_eq!(
            preferences.choices_for(&recipient(config)),
            AiSourceChoices::default()
        );
    }
    let encoded = serde_json::to_string(&preferences).unwrap();
    assert!(!encoded.contains("providerA"));
    assert!(!format!("{preferences:?} {a:?}").contains("providerA"));
    let restored: AiConsentPreferences = serde_json::from_str(&encoded).unwrap();
    assert_eq!(restored.choices_for(&a), choices());
    preferences
        .confirm(a.clone(), AiSourceChoices::default())
        .unwrap();
    assert_eq!(preferences.choices_for(&a), AiSourceChoices::default());
    assert!(AiRecipientRevision::from_native_configuration(b"").is_err());
    assert!(AiRecipientRevision::from_native_configuration(&vec![b'a'; 16385]).is_err());
}

#[test]
fn saved_wire_rejects_future_extra_unknown_duplicate_or_half_specified_grants() {
    let mut prefs = AiConsentPreferences::default();
    prefs.confirm(recipient("owned"), choices()).unwrap();
    let good = serde_json::to_value(prefs).unwrap();
    for change in [
        "version",
        "extra",
        "recipient",
        "duplicate-recipient",
        "duplicate-purpose",
        "unknown-purpose",
        "sources",
        "purpose-empty",
    ] {
        let mut value = good.clone();
        match change {
            "version" => value["version"] = 2.into(),
            "extra" => value["captureEnabled"] = true.into(),
            "recipient" => {
                value["grants"][0]["recipientRevision"] = "https://not-a-native-route".into()
            }
            "duplicate-recipient" => {
                let row = value["grants"][0].clone();
                value["grants"].as_array_mut().unwrap().push(row);
            }
            "duplicate-purpose" => {
                value["grants"][0]["purposes"] =
                    serde_json::json!(["classification", "classification"])
            }
            "unknown-purpose" => {
                value["grants"][0]["purposes"] = serde_json::json!(["learning_samples"])
            }
            "sources" => value["grants"][0]["ocrText"] = false.into(),
            "purpose-empty" => value["grants"][0]["purposes"] = serde_json::json!([]),
            _ => unreachable!(),
        }
        assert!(
            serde_json::from_value::<AiConsentPreferences>(value).is_err(),
            "accepted {change}"
        );
    }
    assert!(serde_json::from_value::<AiConsentPreferences>(
        serde_json::json!({"enabled":true,"replayEnabled":true})
    )
    .is_err());
}

#[test]
fn recipient_limit_refuses_without_mutating_and_forgetting_keeps_sources_off() {
    let mut prefs = AiConsentPreferences::default();
    for i in 0..8 {
        prefs
            .confirm(recipient(&format!("owned{i}")), choices())
            .unwrap();
    }
    let before = serde_json::to_vec(&prefs).unwrap();
    assert!(prefs.confirm(recipient("extra"), choices()).is_err());
    assert_eq!(serde_json::to_vec(&prefs).unwrap(), before);
    prefs
        .confirm(recipient("owned0"), AiSourceChoices::default())
        .unwrap();
    prefs.confirm(recipient("extra"), choices()).unwrap();
    prefs.forget_all();
    assert_eq!(
        serde_json::to_value(prefs).unwrap(),
        serde_json::json!({"version":1,"grants":[]})
    );
    let mut prefs = AiConsentPreferences::default();
    assert!(prefs
        .confirm(
            recipient("bad"),
            AiSourceChoices {
                images: true,
                ..Default::default()
            }
        )
        .is_err());
}
