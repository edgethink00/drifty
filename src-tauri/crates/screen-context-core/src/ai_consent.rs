//! Separate durable choices, never capture/Content context/sync inheritance.
//! Native settings must confirm the complete effective recipient configuration
//! before creating a grant. Stored choices are not an active request capability.
use crate::{
    ai_input::{AiPurpose, AiSourceChoices},
    Error,
};
use ring::digest;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

const MAX_RECIPIENTS: usize = 8;

mod review;
pub use review::{AiConsentReview, AiConsentReviewId, AiConsentReviewView, NativeAiRecipient};
mod coordinator;
pub use coordinator::{
    AiConsentConfirmation, AiConsentCoordinator, AiConsentOperation, PendingAiConsentView,
};

/// A digest of canonical native-selected recipient/model/processing policy.
/// Do not include API keys, tokens or user screen content in that configuration.
/// No Deserialize or WebView endpoint can manufacture this native selector.
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct AiRecipientRevision(String);
impl AiRecipientRevision {
    pub fn from_native_configuration(canonical: &[u8]) -> Result<Self, Error> {
        if canonical.is_empty() || canonical.len() > 16 * 1024 {
            return Err(Error::Invalid("AI recipient configuration"));
        }
        let mut hash = digest::Context::new(&digest::SHA256);
        hash.update(b"drifty-screen-ai-recipient-policy-v1\0");
        hash.update(canonical);
        Ok(Self(
            hash.finish()
                .as_ref()
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect(),
        ))
    }
    pub(crate) fn for_scene_ocr_policy(&self) -> Result<Self, Error> {
        let canonical = format!("general-screen-selected-ocr-v1\0{}", self.0);
        Self::from_native_configuration(canonical.as_bytes())
    }
    fn from_saved(value: String) -> Result<Self, Error> {
        if value.len() != 64
            || !value
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err(Error::Invalid("AI consent revision"));
        }
        Ok(Self(value))
    }
}
impl std::fmt::Debug for AiRecipientRevision {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("AiRecipientRevision([redacted])")
    }
}

#[derive(Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "ConsentWire", into = "ConsentWire")]
pub struct AiConsentPreferences {
    grants: BTreeMap<AiRecipientRevision, AiSourceChoices>,
}
impl std::fmt::Debug for AiConsentPreferences {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("AiConsentPreferences([redacted])")
    }
}
impl AiConsentPreferences {
    /// A future native confirmation route supplies this explicit selection.
    /// Only a fully empty choice removes a grant; half-specified grants refuse.
    pub fn confirm(
        &mut self,
        recipient: AiRecipientRevision,
        choices: AiSourceChoices,
    ) -> Result<(), Error> {
        let sources = choices.accessibility_text || choices.ocr_text || choices.images;
        if sources != !choices.purposes.is_empty() {
            return Err(Error::Invalid("AI consent choices"));
        }
        if !sources {
            self.grants.remove(&recipient);
            return Ok(());
        }
        if !self.grants.contains_key(&recipient) && self.grants.len() >= MAX_RECIPIENTS {
            return Err(Error::Invalid("AI consent recipient limit"));
        }
        self.grants.insert(recipient, choices);
        Ok(())
    }
    pub fn choices_for(&self, recipient: &AiRecipientRevision) -> AiSourceChoices {
        self.grants.get(recipient).cloned().unwrap_or_default()
    }
    pub fn forget_all(&mut self) {
        self.grants.clear();
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ConsentWire {
    version: u8,
    grants: Vec<GrantWire>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GrantWire {
    recipient_revision: String,
    accessibility_text: bool,
    ocr_text: bool,
    images: bool,
    purposes: Vec<AiPurpose>,
}
impl TryFrom<ConsentWire> for AiConsentPreferences {
    type Error = Error;
    fn try_from(wire: ConsentWire) -> Result<Self, Error> {
        if wire.version != 1 || wire.grants.len() > MAX_RECIPIENTS {
            return Err(Error::Invalid("AI consent version or limit"));
        }
        let mut value = Self::default();
        for grant in wire.grants {
            let recipient = AiRecipientRevision::from_saved(grant.recipient_revision)?;
            if value.grants.contains_key(&recipient) {
                return Err(Error::Invalid("AI consent duplicate recipient"));
            }
            let purposes = grant.purposes.iter().copied().collect::<BTreeSet<_>>();
            if purposes.len() != grant.purposes.len() || purposes.is_empty() {
                return Err(Error::Invalid("AI consent purposes"));
            }
            value.confirm(
                recipient,
                AiSourceChoices {
                    accessibility_text: grant.accessibility_text,
                    ocr_text: grant.ocr_text,
                    images: grant.images,
                    purposes,
                },
            )?;
        }
        Ok(value)
    }
}
impl From<AiConsentPreferences> for ConsentWire {
    fn from(value: AiConsentPreferences) -> Self {
        Self {
            version: 1,
            grants: value
                .grants
                .into_iter()
                .map(|(recipient, choices)| GrantWire {
                    recipient_revision: recipient.0,
                    accessibility_text: choices.accessibility_text,
                    ocr_text: choices.ocr_text,
                    images: choices.images,
                    purposes: choices.purposes.into_iter().collect(),
                })
                .collect(),
        }
    }
}

#[cfg(test)]
mod tests;
