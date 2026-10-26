//! Separate explicit choices for the native-owned managed recipient. No endpoint,
//! model, revision, PID, path or screen content is accepted from the renderer.
use super::*;
use drifty_screen_context_core::{
    ai_consent::{
        AiConsentOperation, AiConsentPreferences, AiConsentReviewId, NativeAiRecipient,
        PendingAiConsentView,
    },
    ai_input::{AiPurpose, AiSourceChoices, AiUseGate},
};
use serde::Serializer;
use std::collections::BTreeSet;

const RECIPIENT_UNAVAILABLE: &str = "screen_context_ai_recipient_unavailable";
const UNSAVED: &str = "screen_context_ai_settings_unsaved";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiChoicesWire {
    accessibility_text: bool,
    ocr_text: bool,
    images: bool,
    purposes: Vec<AiPurpose>,
}
impl TryFrom<AiChoicesWire> for AiSourceChoices {
    type Error = String;
    fn try_from(wire: AiChoicesWire) -> Result<Self, String> {
        let purposes = wire.purposes.iter().copied().collect::<BTreeSet<_>>();
        if wire.purposes.len() > 3
            || purposes.len() != wire.purposes.len()
            || (wire.accessibility_text || wire.ocr_text || wire.images) != !purposes.is_empty()
        {
            return Err("screen_context_invalid_settings".into());
        }
        Ok(Self {
            accessibility_text: wire.accessibility_text,
            ocr_text: wire.ocr_text,
            images: wire.images,
            purposes,
        })
    }
}
impl From<&AiSourceChoices> for AiChoicesWire {
    fn from(value: &AiSourceChoices) -> Self {
        Self {
            accessibility_text: value.accessibility_text,
            ocr_text: value.ocr_text,
            images: value.images,
            purposes: value.purposes.iter().copied().collect(),
        }
    }
}

pub(super) struct AccountAiUse {
    account: AccountReadLease,
    gate: Arc<AiUseGate>,
}

struct SettingsStatus {
    recipient: Option<Arc<super::super::managed_ai::ScreenRecipientObservation>>,
    choices: Option<AiChoicesWire>,
    preferences_invalid: bool,
    review: Option<PendingAiConsentView>,
}
impl Serialize for SettingsStatus {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let current = || {
            self.recipient.as_ref().is_none_or(|r| r.is_current())
                && self
                    .review
                    .as_ref()
                    .is_none_or(PendingAiConsentView::is_current)
        };
        if !current() {
            return Err(serde::ser::Error::custom(CHANGED));
        }
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Wire<'a> {
            recipient: Option<&'a super::super::managed_ai::ScreenRecipientObservation>,
            saved_choices: &'a Option<AiChoicesWire>,
            preferences_invalid: bool,
            active: bool,
            delivery_available: bool,
            pending_review_id: Option<AiConsentReviewId>,
        }
        let result = Wire {
            recipient: self.recipient.as_deref(),
            saved_choices: &self.choices,
            preferences_invalid: self.preferences_invalid,
            active: false,
            delivery_available: false,
            pending_review_id: self.review.as_ref().map(PendingAiConsentView::id),
        }
        .serialize(serializer)?;
        if !current() {
            return Err(serde::ser::Error::custom(CHANGED));
        }
        Ok(result)
    }
}

struct ReviewStatus {
    view: PendingAiConsentView,
    recipient: Arc<super::super::managed_ai::ScreenRecipientObservation>,
}
impl Serialize for ReviewStatus {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        if !self.view.is_current() {
            return Err(serde::ser::Error::custom(CHANGED));
        }
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Wire<'a> {
            review_id: AiConsentReviewId,
            choices: AiChoicesWire,
            recipient: &'a super::super::managed_ai::ScreenRecipientObservation,
            expires_at_ms: i64,
        }
        let result = Wire {
            review_id: self.view.id(),
            choices: self.view.choices().into(),
            recipient: self.recipient.as_ref(),
            expires_at_ms: self
                .view
                .expires_at_ms()
                .map_err(|_| serde::ser::Error::custom(CHANGED))?,
        }
        .serialize(serializer)?;
        if !self.view.is_current() {
            return Err(serde::ser::Error::custom(CHANGED));
        }
        Ok(result)
    }
}

struct SavedStatus(AiConsentOperation);
impl Serialize for SavedStatus {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        if !self.0.is_current() {
            return Err(serde::ser::Error::custom(CHANGED));
        }
        let result = serde_json::json!({"saved":true,"active":false}).serialize(serializer)?;
        if !self.0.is_current() {
            return Err(serde::ser::Error::custom(CHANGED));
        }
        Ok(result)
    }
}

impl ScreenContextRuntime {
    fn ai_gate(&self, lease: &AccountReadLease) -> Result<Arc<AiUseGate>, String> {
        if self.stopping() || !lease.is_current() {
            return Err(CHANGED.into());
        }
        let mut slot = self.ai_use.lock().map_err(|_| UNAVAILABLE.to_owned())?;
        if let Some(owned) = slot.as_ref() {
            if owned.account.same_capability(lease) {
                return Ok(Arc::clone(&owned.gate));
            }
            owned.gate.revoke().map_err(error_code)?;
        }
        let gate = Arc::new(AiUseGate::new(lease.clone()).map_err(error_code)?);
        *slot = Some(AccountAiUse {
            account: lease.clone(),
            gate: Arc::clone(&gate),
        });
        Ok(gate)
    }
    pub(super) fn revoke_ai_use_now(&self) -> Result<(), String> {
        // This independent short lock never covers recipient/store I/O.
        let slot = self.ai_use.lock().map_err(|_| UNAVAILABLE.to_owned())?;
        if let Some(owned) = slot.as_ref() {
            owned.gate.revoke().map_err(error_code)?;
        }
        Ok(())
    }
    fn ai_store(
        &self,
        app: &AppHandle,
        lease: &AccountReadLease,
        create: bool,
    ) -> Result<Option<Arc<ScreenContextService>>, String> {
        self.with_state(lease, |state| {
            if !create && !state.opened {
                let root = app
                    .path()
                    .app_local_data_dir()
                    .map_err(|_| UNAVAILABLE.to_owned())?
                    .join("screen-evidence-v1");
                if !EvidenceStore::exists_for_profile(&root, lease.scope()).map_err(error_code)? {
                    return Ok(None);
                }
            }
            self.ensure_store(app, state, lease, create)?;
            Ok(state
                .opened
                .then(|| Arc::clone(self.service.get().expect("opened service"))))
        })
    }
    fn ai_status(
        &self,
        app: &AppHandle,
        lease: &AccountReadLease,
    ) -> Result<SettingsStatus, String> {
        let recipient = super::super::managed_ai::observe_screen_recipient(app).map(Arc::new);
        let preferences = match self.ai_store(app, lease, false)? {
            Some(service) => service.read_ai_consent_preferences(),
            None => Ok(AiConsentPreferences::default()),
        };
        let invalid = preferences.is_err();
        let choices = recipient.as_ref().and_then(|r| {
            preferences
                .as_ref()
                .ok()
                .map(|p| AiChoicesWire::from(&p.choices_for(r.revision())))
        });
        let review = if recipient.is_some() {
            self.ai_consent.pending_review(lease).map_err(error_code)?
        } else {
            None
        };
        Ok(SettingsStatus {
            recipient,
            choices,
            preferences_invalid: invalid,
            review,
        })
    }
}

/// No first-use evidence store, key, consent table, model start or AI use.
#[tauri::command]
pub async fn screen_context_ai_get_settings(
    app: AppHandle,
    lease_id: AccountLeaseId,
) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        sensitive_response(authorized(&app, lease_id, |runtime, lease| {
            runtime.ai_status(&app, lease)
        })?)
    })
    .await
    .map_err(|_| UNAVAILABLE.to_owned())?
}

#[tauri::command]
pub async fn screen_context_ai_prepare_review(
    app: AppHandle,
    lease_id: AccountLeaseId,
    choices: AiChoicesWire,
) -> Result<tauri::ipc::Response, String> {
    let account = app.state::<ScreenContextAccount>();
    account.gate.read(lease_id).map_err(error_code)?;
    // Reserve ordering before queueing blocking work. Even malformed replacement
    // choices close the previous review, while accepting no renderer recipient.
    let operation = account
        .runtime
        .ai_consent
        .begin_operation()
        .map_err(error_code)?;
    let choices = AiSourceChoices::try_from(choices)?;
    tauri::async_runtime::spawn_blocking(move || {
        sensitive_response(authorized(&app, lease_id, |runtime, lease| {
            if !operation.is_current() {
                return Err(CHANGED.into());
            }
            let recipient = Arc::new(
                super::super::managed_ai::observe_screen_recipient(&app)
                    .ok_or_else(|| RECIPIENT_UNAVAILABLE.to_owned())?,
            );
            let view = runtime
                .ai_consent
                .complete_preparation(operation, lease.clone(), recipient.clone(), choices)
                .map_err(error_code)?;
            Ok(ReviewStatus { view, recipient })
        })?)
    })
    .await
    .map_err(|_| UNAVAILABLE.to_owned())?
}

#[tauri::command]
pub fn screen_context_ai_cancel_review(
    account: tauri::State<'_, ScreenContextAccount>,
    lease_id: AccountLeaseId,
    review_id: AiConsentReviewId,
) -> Result<AccountReply<bool>, String> {
    let lease = account.gate.read(lease_id).map_err(error_code)?;
    account
        .runtime
        .ai_consent
        .cancel(&lease, review_id)
        .map_err(error_code)?;
    lease.reply(true).map_err(error_code)
}

#[tauri::command]
pub async fn screen_context_ai_confirm_review(
    app: AppHandle,
    lease_id: AccountLeaseId,
    review_id: AiConsentReviewId,
) -> Result<tauri::ipc::Response, String> {
    let account = app.state::<ScreenContextAccount>();
    let lease = account.gate.read(lease_id).map_err(error_code)?;
    let gate = account.runtime.ai_gate(&lease)?;
    gate.revoke().map_err(error_code)?; // Before opening storage/key I/O.
    tauri::async_runtime::spawn_blocking(move || {
        sensitive_response(authorized(&app, lease_id, |runtime, lease| {
            let confirmation = runtime
                .ai_consent
                .take_confirmation(lease, review_id)
                .map_err(error_code)?;
            if !confirmation.is_current() {
                return Err(CHANGED.into());
            }
            let service = runtime
                .ai_store(&app, lease, true)?
                .ok_or_else(|| UNSAVED.to_owned())?;
            let operation = runtime
                .ai_consent
                .complete_confirmation(confirmation, lease, &service, &gate)
                .map_err(|_| UNSAVED.to_owned())?;
            if !operation.is_current() {
                return Err(UNSAVED.into());
            }
            mark_configured(&app).map_err(|_| UNSAVED.to_owned())?;
            if !operation.is_current() {
                return Err(UNSAVED.into());
            }
            Ok(SavedStatus(operation))
        })?)
    })
    .await
    .map_err(|_| UNAVAILABLE.to_owned())?
}

#[tauri::command]
pub async fn screen_context_ai_turn_off(
    app: AppHandle,
    lease_id: AccountLeaseId,
) -> Result<tauri::ipc::Response, String> {
    let account = app.state::<ScreenContextAccount>();
    let operation = account
        .runtime
        .ai_consent
        .begin_operation()
        .map_err(error_code)?;
    account.runtime.revoke_ai_use_now()?; // Also closes use when account expired.
    account.gate.read(lease_id).map_err(error_code)?;
    tauri::async_runtime::spawn_blocking(move || {
        sensitive_response(authorized(&app, lease_id, |runtime, lease| {
            if !operation.is_current() {
                return Err(UNSAVED.into());
            }
            let gate = runtime.ai_gate(lease)?;
            gate.revoke().map_err(error_code)?;
            if let Some(service) = runtime.ai_store(&app, lease, false)? {
                service
                    .save_ai_consent_preferences_guarded(
                        &gate,
                        &AiConsentPreferences::default(),
                        &|| operation.is_current() && lease.is_current(),
                    )
                    .map_err(|_| UNSAVED.to_owned())?;
            }
            if !operation.is_current() {
                return Err(UNSAVED.into());
            }
            Ok(SavedStatus(operation))
        })?)
    })
    .await
    .map_err(|_| UNAVAILABLE.to_owned())?
}

#[cfg(test)]
mod tests;
