use super::*;
use crate::ai_input::{AiInputSelection, AiUseLease, PayloadBuilder, PreparedAiInput};
use crate::{
    ai_consent::{AiConsentPreferences, AiRecipientRevision},
    ai_input::{AiSourceChoices, AiUseGate},
};

impl ScreenContextService {
    pub fn read_ai_consent_preferences(&self) -> Result<AiConsentPreferences, Error> {
        self.with_store(|store, now| store.read_ai_consent_preferences(now))
    }

    /// Save separately confirmed native choices. Close this exact account's
    /// active AI gate BEFORE waiting for any store I/O. Saving never activates
    /// a route: native settings must separately resolve/confirm the current
    /// recipient and apply a fresh capability after a successful durable save.
    pub fn save_ai_consent_preferences(
        &self,
        gate: &AiUseGate,
        value: &AiConsentPreferences,
    ) -> Result<(), Error> {
        self.save_ai_consent_preferences_guarded(gate, value, &|| true)
    }

    /// The native review's account, recipient lifetime and deadline remain
    /// current through each durable-write boundary. A saved choice still does
    /// not activate a route or authorize a renderer-selected recipient.
    pub fn save_ai_consent_preferences_guarded(
        &self,
        gate: &AiUseGate,
        value: &AiConsentPreferences,
        current: &dyn Fn() -> bool,
    ) -> Result<(), Error> {
        let (observation, account) = self.ai_consent_write_authority(gate, None)?;
        self.with_store(|store, now| {
            store.save_ai_consent_preferences(value, now, &|| {
                observation.is_current() && account.is_current() && current()
            })
        })
    }

    /// Edit one reviewed recipient under the same store lock as the current
    /// read. Concurrent reviews cannot overwrite a different recipient's saved
    /// grant using an older preferences snapshot. Unknown/interrupted formats
    /// refuse here; recovery remains a separate explicit full settings save.
    pub(crate) fn confirm_ai_consent_preferences_guarded(
        &self,
        gate: &AiUseGate,
        authority: &AccountReadLease,
        recipient: AiRecipientRevision,
        choices: AiSourceChoices,
        current: &dyn Fn() -> bool,
    ) -> Result<(), Error> {
        let (observation, account) = self.ai_consent_write_authority(gate, Some(authority))?;
        self.with_store(|store, now| {
            let current = || observation.is_current() && account.is_current() && current();
            if !current() {
                return Err(Error::Invalidated);
            }
            let mut value = store.read_ai_consent_preferences(now)?;
            value.confirm(recipient, choices)?;
            store.save_ai_consent_preferences(&value, now, &current)
        })
    }

    fn ai_consent_write_authority(
        &self,
        gate: &AiUseGate,
        authority: Option<&AccountReadLease>,
    ) -> Result<(ObservationLease, AccountReadLease), Error> {
        let observation = self.observation_lease();
        let account = {
            let state = lock(&self.shared);
            if !authorized(&state) || !observation.is_current() {
                return Err(Error::Invalidated);
            }
            state.account.clone().ok_or(Error::Invalidated)?
        };
        if authority
            .is_some_and(|authority| !account.same_capability(authority) || !authority.is_current())
        {
            return Err(Error::Invalidated);
        }
        gate.revoke_for_account(&account)?;
        Ok((observation, account))
    }

    /// Native-only shadow assembler. No IPC/provider/network activation. A
    /// separately confirmed gate must belong to this exact account capability.
    pub fn prepare_ai_input(
        &self,
        selection: AiInputSelection,
        lease: AiUseLease,
    ) -> Result<Option<PreparedAiInput>, Error> {
        lease.validate()?;
        let mut context = self.activity_read_context()?;
        lease.validate_account(context.account.as_ref())?;
        let mut evidence = Vec::new();
        for id in selection.evidence_ids {
            lease.validate()?;
            if let Some(sample) = self.read_bound_evidence(
                &mut context,
                id,
                lease.choices.images && lease.provider_supports_images,
            )? {
                let metadata = &sample.metadata;
                if !metadata
                    .activity_binding
                    .as_ref()
                    .is_some_and(|binding| selection.record_ids.contains(binding.record_id()))
                    || !(selection.window[0]..selection.window[1])
                        .contains(&metadata.observed_at_ms)
                {
                    return Err(Error::Invalidated);
                }
                evidence.push(sample);
            }
        }
        evidence.sort_by_key(|sample| (sample.metadata.observed_at_ms, sample.metadata.id));
        let mut builder = PayloadBuilder::new(&lease, selection.window);
        let mut proofs = Vec::new();
        for sample in evidence {
            proofs.push(ActivityProof::from_metadata(&sample.metadata)?);
            builder.append(sample, &lease, selection.window)?;
        }
        lease.validate()?;
        if builder.is_empty() {
            return Ok(None);
        }
        builder
            .finish(lease, |value| context.reply(value, proofs))
            .map(Some)
    }
}
