use super::*;
use crate::{scene::tests::facts, CaptureScope, SceneTextScope};

fn fixture() -> (
    NativeScenePreflight,
    serde_json::Value,
    CapturePolicy,
    Vec<u8>,
) {
    let mut facts = facts();
    facts.identity.text_scope = SceneTextScope::None;
    let input = crate::tests::evidence(1000);
    let pre = NativeScenePreflight {
        protocol_version: 4,
        request_id: Uuid::new_v4(),
        facts: facts.clone(),
        activity_hint: NativeActivityObservation {
            window_title_digest: Some(WindowTitleDigest::parse("a".repeat(64)).unwrap()),
        },
    };
    let result = NativeSceneResult {
        protocol_version: 4,
        request_id: pre.request_id,
        before: facts.clone(),
        after: facts,
        activity_hint_before: pre.activity_hint.clone(),
        activity_hint_after: pre.activity_hint.clone(),
        observed_at_ms: 1000,
        text_evidence: TextEvidence::not_requested(),
        frame: NativeFrameHeader {
            png_bytes: input.frame.bytes().len(),
            width: input.frame.width(),
            height: input.frame.height(),
            sha256: input.frame.sha256().into(),
        },
    };
    (
        pre,
        serde_json::to_value(result).unwrap(),
        CapturePolicy {
            scope: CaptureScope::ActiveDisplayScene,
            enabled: true,
            replay_enabled: true,
            ..Default::default()
        },
        input.frame.bytes().to_vec(),
    )
}
fn decode(
    value: serde_json::Value,
    pixels: &[u8],
    pre: &NativeScenePreflight,
    policy: &CapturePolicy,
) -> Result<NativeSceneCapture, CaptureFailure> {
    let header = serde_json::to_vec(&value).unwrap();
    let mut packet = (header.len() as u32).to_be_bytes().to_vec();
    packet.extend(header);
    packet.extend(pixels);
    decode_result(&mut packet.as_slice(), pre, policy)
}
#[test]
fn scene_protocol_keeps_typed_scene_and_equal_native_activity_hint() {
    let (pre, value, policy, png) = fixture();
    let capture = decode(value, &png, &pre, &policy).unwrap();
    assert!(capture.after == pre.facts);
    assert_eq!(capture.activity_hint, pre.activity_hint.window_title_digest);
    assert_eq!(capture.frame.bytes(), png);
}
#[test]
fn scene_wire_refuses_changed_source_scope_grant_identity_pixels_and_mixed_versions() {
    let (mut pre, value, mut policy, png) = fixture();
    for kind in 0..16 {
        let mut changed = value.clone();
        match kind {
            0 => changed["protocolVersion"] = 3.into(),
            1 => changed["requestId"] = Uuid::new_v4().to_string().into(),
            2 => changed["before"]["identity"]["observationEpoch"] = 6.into(),
            3 => changed["after"]["identity"]["foreground"]["processBirth"] = 99.into(),
            4 => changed["after"]["windows"][1]["privacy"] = "private".into(),
            5 => changed["after"]["inventoryComplete"] = false.into(),
            6 => {
                changed["textEvidence"] =
                    serde_json::json!({"source":"ocr","state":"recognized","text":"unrequested"})
            }
            7 => changed["activityHintAfter"]["windowTitleDigest"] = "b".repeat(64).into(),
            8 => {
                changed
                    .as_object_mut()
                    .unwrap()
                    .remove("activityHintBefore");
            }
            9 => changed["frame"]["sha256"] = "0".repeat(64).into(),
            10 => changed["frame"]["width"] = 1.into(),
            11 => changed["frame"]["pngBytes"] = (png.len() + 1).into(),
            12 => changed["observedAtMs"] = (-1).into(),
            13 => changed["before"]["identity"]["documentId"] = "fake".into(),
            14 => changed["after"]["windows"][0]["extraAuthority"] = true.into(),
            _ => changed["activityHintAfter"] = serde_json::json!({}),
        }
        assert!(
            decode(changed, &png, &pre, &policy).is_err(),
            "variant {kind}"
        );
    }
    let mut bad = png.clone();
    bad[0] ^= 1;
    assert!(decode(value.clone(), &bad, &pre, &policy).is_err());
    let mut extra = png.clone();
    extra.push(0);
    assert!(decode(value.clone(), &extra, &pre, &policy).is_err());
    policy.excluded_apps.insert("owned.background".into());
    assert!(decode(value.clone(), &png, &pre, &policy).is_err());
    policy.excluded_apps.clear();
    pre.protocol_version = 3;
    assert!(decode(value, &png, &pre, &policy).is_err());
}
#[test]
fn refusal_requires_same_request_version_and_no_pixels() {
    let (pre, _, policy, png) = fixture();
    let value =
        serde_json::json!({"protocolVersion":4,"requestId":pre.request_id,"refusal":"changed"});
    assert!(matches!(
        decode(value.clone(), &[], &pre, &policy),
        Err(CaptureFailure::Invalidated)
    ));
    let value =
        serde_json::json!({"protocolVersion":4,"requestId":pre.request_id,"refusal":"permission"});
    assert!(matches!(
        decode(value.clone(), &[], &pre, &policy),
        Err(CaptureFailure::Permission)
    ));
    assert!(matches!(
        decode(value, &png, &pre, &policy),
        Err(CaptureFailure::Invalidated)
    ));
}
