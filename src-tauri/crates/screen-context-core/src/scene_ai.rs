//! Separate general-screen processing policy for an already native-resolved
//! recipient. This wrapper resolves no URL, starts no model and sends nothing.
use crate::{
    ai_consent::{AiRecipientRevision, NativeAiRecipient},
    ai_input::AiSourceChoices,
    Error,
};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

/// A new policy revision prevents old document/metadata grants from authorizing
/// scene OCR, even when the underlying provider and model have not changed.
pub struct SceneOcrRecipient {
    recipient: Arc<dyn NativeAiRecipient>,
    revision: AiRecipientRevision,
    invalidated: AtomicBool,
}
impl SceneOcrRecipient {
    pub fn from_native(recipient: Arc<dyn NativeAiRecipient>) -> Result<Self, Error> {
        if !recipient.is_current() {
            return Err(Error::Invalidated);
        }
        let revision = recipient.revision().for_scene_ocr_policy()?;
        Ok(Self {
            recipient,
            revision,
            invalidated: AtomicBool::new(false),
        })
    }
}
impl NativeAiRecipient for SceneOcrRecipient {
    fn revision(&self) -> &AiRecipientRevision {
        &self.revision
    }
    fn is_current(&self) -> bool {
        if self.invalidated.load(Ordering::Acquire) {
            return false;
        }
        if !self.recipient.is_current() {
            self.invalidated.store(true, Ordering::Release);
            return false;
        }
        true
    }
    fn supports_images(&self) -> bool {
        false
    }
    fn accepts_choices(&self, choices: &AiSourceChoices) -> bool {
        self.recipient.accepts_choices(choices)
            && choices.ocr_text
            && !choices.accessibility_text
            && !choices.images
            && !choices.purposes.is_empty()
    }
}
