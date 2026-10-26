//! Read the earlier OCR-only encrypted headers without inventing an
//! accessibility source. Distinct strict shapes reject mixed/unknown fields.
use super::EvidenceMetadata;
use crate::{ActivityBinding, Error, OcrState, SurfaceIdentity, TextEvidence};
use serde::Deserialize;
use uuid::Uuid;
use zeroize::Zeroizing;

#[derive(Deserialize)]
#[serde(untagged)]
pub(super) enum MetadataWire {
    Bound(Bound),
    Current(Current),
    Legacy(Legacy),
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Bound {
    metadata_version: u8,
    id: Uuid,
    activity_binding: ActivityBinding,
    surface: SurfaceIdentity,
    observed_at_ms: i64,
    expires_at_ms: i64,
    text_evidence: TextEvidence,
    frame_retained: bool,
    frame_width: u32,
    frame_height: u32,
    frame_sha256: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Current {
    id: Uuid,
    tracker_record_id: Option<String>,
    surface: SurfaceIdentity,
    observed_at_ms: i64,
    expires_at_ms: i64,
    text_evidence: TextEvidence,
    frame_retained: bool,
    frame_width: u32,
    frame_height: u32,
    frame_sha256: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Legacy {
    id: Uuid,
    tracker_record_id: Option<String>,
    surface: SurfaceIdentity,
    observed_at_ms: i64,
    expires_at_ms: i64,
    #[serde(deserialize_with = "secret")]
    text: Zeroizing<String>,
    ocr_state: OcrState,
    frame_retained: bool,
    frame_width: u32,
    frame_height: u32,
    frame_sha256: String,
}

fn secret<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Zeroizing<String>, D::Error> {
    String::deserialize(d).map(Zeroizing::new)
}

impl TryFrom<MetadataWire> for EvidenceMetadata {
    type Error = Error;
    fn try_from(wire: MetadataWire) -> Result<Self, Self::Error> {
        let (current, binding) = match wire {
            MetadataWire::Bound(bound) => {
                if bound.metadata_version != 3 {
                    return Err(Error::Invalid("binding metadata version"));
                }
                let binding = bound.activity_binding;
                (
                    Current {
                        id: bound.id,
                        tracker_record_id: None,
                        surface: bound.surface,
                        observed_at_ms: bound.observed_at_ms,
                        expires_at_ms: bound.expires_at_ms,
                        text_evidence: bound.text_evidence,
                        frame_retained: bound.frame_retained,
                        frame_width: bound.frame_width,
                        frame_height: bound.frame_height,
                        frame_sha256: bound.frame_sha256,
                    },
                    Some(binding),
                )
            }
            MetadataWire::Current(current) => (current, None),
            MetadataWire::Legacy(old) => (
                Current {
                    id: old.id,
                    tracker_record_id: old.tracker_record_id,
                    surface: old.surface,
                    observed_at_ms: old.observed_at_ms,
                    expires_at_ms: old.expires_at_ms,
                    text_evidence: TextEvidence::legacy_ocr(old.ocr_state, old.text)?,
                    frame_retained: old.frame_retained,
                    frame_width: old.frame_width,
                    frame_height: old.frame_height,
                    frame_sha256: old.frame_sha256,
                },
                None,
            ),
        };
        Ok(Self {
            id: current.id,
            tracker_record_id: current.tracker_record_id,
            activity_binding: binding,
            surface: current.surface,
            observed_at_ms: current.observed_at_ms,
            expires_at_ms: current.expires_at_ms,
            text: current.text_evidence,
            frame_retained: current.frame_retained,
            frame_width: current.frame_width,
            frame_height: current.frame_height,
            frame_sha256: current.frame_sha256,
        })
    }
}

impl serde::Serialize for EvidenceMetadata {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        if self.activity_binding.is_some() && self.tracker_record_id.is_some() {
            return Err(serde::ser::Error::custom("mixed activity association"));
        }
        // An unbound header keeps its exact source-v2 shape. A bound header is
        // distinguishable and strict; a legacy integer/string is never promoted.
        let mut value = serializer.serialize_struct(
            "EvidenceMetadata",
            if self.activity_binding.is_some() {
                11
            } else {
                10
            },
        )?;
        value.serialize_field("id", &self.id)?;
        if let Some(binding) = &self.activity_binding {
            value.serialize_field("metadataVersion", &3u8)?;
            value.serialize_field("activityBinding", binding)?;
        } else {
            value.serialize_field("trackerRecordId", &self.tracker_record_id)?;
        }
        value.serialize_field("surface", &self.surface)?;
        value.serialize_field("observedAtMs", &self.observed_at_ms)?;
        value.serialize_field("expiresAtMs", &self.expires_at_ms)?;
        value.serialize_field("textEvidence", &self.text)?;
        value.serialize_field("frameRetained", &self.frame_retained)?;
        value.serialize_field("frameWidth", &self.frame_width)?;
        value.serialize_field("frameHeight", &self.frame_height)?;
        value.serialize_field("frameSha256", &self.frame_sha256)?;
        value.end()
    }
}
