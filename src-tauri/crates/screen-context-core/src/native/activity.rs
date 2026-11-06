//! Explicit v3 native observation. A title digest proves equality only; native
//! permission/account/policy admission and current tracker identity/range gates
//! are still required. No WebView can supply this as capture authority.
use super::*;

pub const ACTIVITY_PROTOCOL_VERSION: u32 = 3;

#[derive(Clone, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct WindowTitleDigest(String);

impl WindowTitleDigest {
    pub fn parse(value: String) -> Result<Self, crate::Error> {
        if value.len() != 64
            || !value
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err(crate::Error::Invalid("window title digest"));
        }
        Ok(Self(value))
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
}
impl std::fmt::Debug for WindowTitleDigest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("WindowTitleDigest([redacted])")
    }
}
impl<'de> Deserialize<'de> for WindowTitleDigest {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        Self::parse(String::deserialize(d)?).map_err(serde::de::Error::custom)
    }
}

/// Mandatory v3 envelope. Explicit null means capture without a link hint.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeActivityObservation {
    #[serde(deserialize_with = "required_optional_digest")]
    pub window_title_digest: Option<WindowTitleDigest>,
}
fn required_optional_digest<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<WindowTitleDigest>, D::Error> {
    Option::deserialize(d)
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeActivityPreflight {
    pub protocol_version: u32,
    pub request_id: Uuid,
    pub facts: SurfaceFacts,
    pub activity_hint: NativeActivityObservation,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeActivityResult {
    pub protocol_version: u32,
    pub request_id: Uuid,
    pub before: SurfaceFacts,
    pub after: SurfaceFacts,
    pub activity_hint_before: NativeActivityObservation,
    pub activity_hint_after: NativeActivityObservation,
    pub observed_at_ms: i64,
    pub text_evidence: TextEvidence,
    pub frame: NativeFrameHeader,
}

pub(super) fn decode_activity_result(
    remaining: &mut &[u8],
    preflight: &NativePreflight,
    hint: &NativeActivityObservation,
    policy: &CapturePolicy,
    site_admitted: bool,
) -> Result<NativeCapture, CaptureFailure> {
    let header = packet(remaining)?;
    let result: NativeActivityResult =
        serde_json::from_slice(header).map_err(|_| CaptureFailure::Invalidated)?;
    if preflight.protocol_version != ACTIVITY_PROTOCOL_VERSION
        || result.activity_hint_before != *hint
        || result.activity_hint_after != *hint
    {
        return Err(CaptureFailure::Invalidated);
    }
    // Shared validation consumes a typed v3 result after strict v3 decoding;
    // this is not a wire conversion, version negotiation or v2 fallback.
    accept_text_result(
        NativeTextResult {
            protocol_version: result.protocol_version,
            request_id: result.request_id,
            before: result.before,
            after: result.after,
            observed_at_ms: result.observed_at_ms,
            text_evidence: result.text_evidence,
            frame: result.frame,
        },
        ACTIVITY_PROTOCOL_VERSION,
        remaining,
        preflight,
        policy,
        hint.window_title_digest.clone(),
        site_admitted,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Privacy, SurfaceIdentity, Visibility};
    use std::collections::BTreeSet;

    fn fixture() -> (
        NativeActivityResult,
        NativePreflight,
        NativeActivityObservation,
        CapturePolicy,
        Vec<u8>,
    ) {
        let facts = SurfaceFacts {
            identity: SurfaceIdentity {
                pid: 7,
                process_birth: 123,
                window_id: 8,
                app_id: "owned.editor".into(),
                document_id: "owned-doc".into(),
                document_generation: 1,
            },
            permission: true,
            foreground: true,
            interactive: true,
            protected: false,
            visibility: Visibility::Visible,
            privacy: Privacy::NotBrowser,
        };
        let mut png = Vec::new();
        let mut encoder = png::Encoder::new(&mut png, 2, 2);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder
            .write_header()
            .unwrap()
            .write_image_data(&[42; 16])
            .unwrap();
        let frame = Frame::from_png(png).unwrap();
        let pre = NativePreflight {
            protocol_version: 3,
            request_id: Uuid::new_v4(),
            facts: facts.clone(),
        };
        let hint = NativeActivityObservation {
            window_title_digest: Some(WindowTitleDigest::parse("a".repeat(64)).unwrap()),
        };
        let result = NativeActivityResult {
            protocol_version: 3,
            request_id: pre.request_id,
            before: facts.clone(),
            after: facts,
            activity_hint_before: hint.clone(),
            activity_hint_after: hint.clone(),
            observed_at_ms: 1000,
            text_evidence: TextEvidence::not_requested(),
            frame: NativeFrameHeader {
                png_bytes: frame.bytes().len(),
                width: 2,
                height: 2,
                sha256: frame.sha256().into(),
            },
        };
        let policy = CapturePolicy {
            enabled: true,
            replay_enabled: true,
            allowed_apps: BTreeSet::from(["owned.editor".into()]),
            ..CapturePolicy::default()
        };
        (result, pre, hint, policy, frame.bytes().to_vec())
    }
    fn decode(
        value: serde_json::Value,
        pixels: &[u8],
        pre: &NativePreflight,
        hint: &NativeActivityObservation,
        policy: &CapturePolicy,
    ) -> Result<NativeCapture, CaptureFailure> {
        let header = serde_json::to_vec(&value).unwrap();
        let mut packet = (header.len() as u32).to_be_bytes().to_vec();
        packet.extend(header);
        packet.extend(pixels);
        decode_activity_result(&mut packet.as_slice(), pre, hint, policy, false)
    }

    #[test]
    fn v3_only_exposes_a_hint_equal_to_both_observations_and_admitted_preflight() {
        let (mut result, pre, mut hint, policy, png) = fixture();
        let captured = decode(
            serde_json::to_value(&result).unwrap(),
            &png,
            &pre,
            &hint,
            &policy,
        )
        .unwrap();
        assert_eq!(captured.activity_hint, hint.window_title_digest);
        hint.window_title_digest = None;
        result.activity_hint_before = hint.clone();
        result.activity_hint_after = hint.clone();
        assert!(decode(
            serde_json::to_value(result).unwrap(),
            &png,
            &pre,
            &hint,
            &policy
        )
        .unwrap()
        .activity_hint
        .is_none());
    }

    #[test]
    fn v3_title_equality_never_overrides_existing_identity_consent_or_frame_validation() {
        let (result, mut pre, hint, mut policy, png) = fixture();
        let value = serde_json::to_value(result).unwrap();
        let cases = [
            ("protocolVersion", serde_json::json!(2)),
            ("requestId", serde_json::json!(Uuid::new_v4())),
            ("observedAtMs", serde_json::json!(-1)),
            (
                "activityHintAfter",
                serde_json::json!({"windowTitleDigest":"b".repeat(64)}),
            ),
            (
                "activityHintBefore",
                serde_json::json!({"windowTitleDigest":null}),
            ),
            (
                "activityHintAfter",
                serde_json::json!({"windowTitleDigest":"A".repeat(64)}),
            ),
            (
                "activityHintAfter",
                serde_json::json!({"windowTitleDigest":"a".repeat(65)}),
            ),
            (
                "activityHintAfter",
                serde_json::json!({"windowTitleDigest":"a".repeat(64),"rawTitle":"secret"}),
            ),
            (
                "frame",
                serde_json::json!({"pngBytes":png.len(),"width":3,"height":2,"sha256":"a".repeat(64)}),
            ),
            (
                "textEvidence",
                serde_json::json!({"source":"accessibility","state":"recognized","text":"unrequested"}),
            ),
        ];
        for (key, change) in cases {
            let mut changed = value.clone();
            changed[key] = change;
            assert!(
                decode(changed, &png, &pre, &hint, &policy).is_err(),
                "{key}"
            );
        }
        for key in ["activityHintBefore", "activityHintAfter"] {
            let mut changed = value.clone();
            changed.as_object_mut().unwrap().remove(key);
            assert!(decode(changed, &png, &pre, &hint, &policy).is_err());
        }
        let mut changed = value.clone();
        changed["after"]["identity"]["windowId"] = 9.into();
        assert!(decode(changed, &png, &pre, &hint, &policy).is_err());
        let mut bad_png = png.clone();
        bad_png[0] ^= 1;
        assert!(decode(value.clone(), &bad_png, &pre, &hint, &policy).is_err());
        policy.excluded_apps.insert("owned.editor".into());
        assert!(decode(value.clone(), &png, &pre, &hint, &policy).is_err());
        policy.excluded_apps.clear();
        pre.protocol_version = 2;
        assert!(decode(value, &png, &pre, &hint, &policy).is_err());
    }

    #[test]
    fn digest_shape_is_canonical_bounded_and_debug_redacted() {
        let digest = WindowTitleDigest::parse("a".repeat(64)).unwrap();
        assert_eq!(
            serde_json::to_string(&digest).unwrap(),
            format!("\"{}\"", "a".repeat(64))
        );
        assert!(!format!("{digest:?}").contains(&"a".repeat(64)));
        for bad in [
            "a".repeat(63),
            "a".repeat(65),
            "A".repeat(64),
            "g".repeat(64),
            "raw title".into(),
        ] {
            assert!(serde_json::from_value::<WindowTitleDigest>(serde_json::json!(bad)).is_err());
        }
        assert!(
            serde_json::from_value::<NativeActivityObservation>(serde_json::json!({})).is_err()
        );
        assert!(serde_json::from_value::<NativeActivityObservation>(
            serde_json::json!({"windowTitleDigest":null})
        )
        .is_ok());
    }
}
