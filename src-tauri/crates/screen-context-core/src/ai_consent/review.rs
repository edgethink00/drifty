//! Native pending confirmation. A review ID selects native-held immutable
//! choices; it never selects an endpoint/model or grants transport authority.
use super::AiRecipientRevision;
use crate::{
    ai_input::{AiSourceChoices, AiUseGate},
    lease::AccountReadLease,
    Error, ScreenContextService,
};
use serde::{Deserialize, Serialize};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant, SystemTime},
};
use uuid::Uuid;

const REVIEW_LIFETIME: Duration = Duration::from_secs(120);

/// Implemented by a native-owned recipient resolver. A WebView configuration,
/// URL, PID or same-executable listener is not an implementation of this proof.
/// Current checks must latch observed invalidation, including process ABA.
pub trait NativeAiRecipient: Send + Sync {
    fn revision(&self) -> &AiRecipientRevision;
    fn is_current(&self) -> bool;
    fn supports_images(&self) -> bool;
    fn accepts_choices(&self, choices: &AiSourceChoices) -> bool {
        (choices.accessibility_text || choices.ocr_text || choices.images)
            && !choices.purposes.is_empty()
            && (!choices.images || self.supports_images())
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct AiConsentReviewId(Uuid);

/// Intentionally neither Clone nor Deserialize/Serialize. The owning native
/// settings coordinator must hold at most one review and take it on confirmation
/// or cancellation. The UI may receive its ID and a separate content-free view.
pub struct AiConsentReview {
    id: AiConsentReviewId,
    proof: Arc<ReviewProof>,
    choices: AiSourceChoices,
}

struct ReviewProof {
    account: AccountReadLease,
    recipient: Arc<dyn NativeAiRecipient>,
    started: Instant,
    wall_started: SystemTime,
    invalidated: AtomicBool,
}

/// Native-only display lifetime. Cloning this view cannot duplicate the owned
/// confirmation or manufacture a recipient. Dropping/consuming its review
/// invalidates all outstanding views, including a response awaiting delivery.
#[derive(Clone)]
pub struct AiConsentReviewView {
    id: AiConsentReviewId,
    proof: Arc<ReviewProof>,
    choices: AiSourceChoices,
}

impl AiConsentReviewView {
    pub fn id(&self) -> AiConsentReviewId {
        self.id
    }
    pub fn choices(&self) -> &AiSourceChoices {
        &self.choices
    }
    pub fn is_current(&self) -> bool {
        self.proof.current_at(Instant::now(), SystemTime::now())
    }
    pub fn expires_at_ms(&self) -> Result<i64, Error> {
        let deadline = self
            .proof
            .wall_started
            .checked_add(REVIEW_LIFETIME)
            .ok_or(Error::Invalidated)?;
        let value = deadline
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| Error::Invalidated)?
            .as_millis();
        i64::try_from(value).map_err(|_| Error::Invalidated)
    }
    pub(crate) fn invalidate_now(&self) {
        self.proof.invalidated.store(true, Ordering::Release);
    }
}

impl Drop for AiConsentReview {
    fn drop(&mut self) {
        self.proof.invalidated.store(true, Ordering::Release);
    }
}

impl AiConsentReview {
    pub fn new(
        account: AccountReadLease,
        recipient: Arc<dyn NativeAiRecipient>,
        choices: AiSourceChoices,
    ) -> Result<Self, Error> {
        if !account.is_current() || !recipient.is_current() {
            return Err(Error::Invalidated);
        }
        // Empty choices use the separate immediate revocation path. An image
        // unsupported by this exact recipient cannot silently become text.
        if !(choices.accessibility_text || choices.ocr_text || choices.images)
            || choices.purposes.is_empty()
            || (choices.images && !recipient.supports_images())
            || !recipient.accepts_choices(&choices)
        {
            return Err(Error::Invalid("AI consent review choices"));
        }
        Ok(Self {
            id: AiConsentReviewId(Uuid::new_v4()),
            proof: Arc::new(ReviewProof {
                account,
                recipient,
                started: Instant::now(),
                wall_started: SystemTime::now(),
                invalidated: AtomicBool::new(false),
            }),
            choices,
        })
    }

    pub fn id(&self) -> AiConsentReviewId {
        self.id
    }
    pub fn choices(&self) -> &AiSourceChoices {
        &self.choices
    }
    pub fn view(&self) -> AiConsentReviewView {
        AiConsentReviewView {
            id: self.id,
            proof: Arc::clone(&self.proof),
            choices: self.choices.clone(),
        }
    }

    pub fn is_current(&self) -> bool {
        self.current_at(Instant::now(), SystemTime::now())
    }

    fn current_at(&self, now: Instant, wall: SystemTime) -> bool {
        self.proof.current_at(now, wall)
    }

    /// Consume the exact native-held review. No replacement choices or
    /// recipient configuration arrive with the confirmation ID. Saving closes
    /// current AI use first and rechecks this proof at every durable boundary;
    /// it does not activate a route, start a model or transmit screen content.
    pub fn save(
        self,
        authority: &AccountReadLease,
        id: AiConsentReviewId,
        service: &ScreenContextService,
        gate: &AiUseGate,
    ) -> Result<(), Error> {
        self.save_guarded(authority, id, service, gate, &|| true)
    }

    /// A native coordinator supplies a cancellation generation independently
    /// of its short state lock. Cancellation can close a write already waiting
    /// on storage; no coordinator lock is held during recipient checks or I/O.
    pub fn save_guarded(
        self,
        authority: &AccountReadLease,
        id: AiConsentReviewId,
        service: &ScreenContextService,
        gate: &AiUseGate,
        current: &dyn Fn() -> bool,
    ) -> Result<(), Error> {
        if self.id != id
            || !self.proof.account.same_capability(authority)
            || !current()
            || !self.is_current()
        {
            return Err(Error::Invalidated);
        }
        service.confirm_ai_consent_preferences_guarded(
            gate,
            authority,
            self.proof.recipient.revision().clone(),
            self.choices.clone(),
            &|| current() && self.is_current() && current(),
        )
    }
}

impl ReviewProof {
    fn current_at(&self, now: Instant, wall: SystemTime) -> bool {
        let valid = !self.invalidated.load(Ordering::Acquire)
            && self.account.is_current()
            && now
                .checked_duration_since(self.started)
                .is_some_and(|age| age < REVIEW_LIFETIME)
            && wall
                .duration_since(self.wall_started)
                .is_ok_and(|age| age < REVIEW_LIFETIME)
            && self.recipient.is_current()
            && !self.invalidated.load(Ordering::Acquire)
            && self.account.is_current();
        if !valid {
            self.invalidated.store(true, Ordering::Release);
        }
        valid
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ai_input::AiPurpose, lease::AccountGate, ScopeId};
    use std::collections::BTreeSet;

    struct Recipient {
        revision: AiRecipientRevision,
        current: AtomicBool,
    }
    impl NativeAiRecipient for Recipient {
        fn revision(&self) -> &AiRecipientRevision {
            &self.revision
        }
        fn is_current(&self) -> bool {
            self.current.load(Ordering::Acquire)
        }
        fn supports_images(&self) -> bool {
            false
        }
    }
    fn account(gate: &AccountGate) -> AccountReadLease {
        let id = gate
            .bind_verified(
                gate.begin_transition().unwrap(),
                ScopeId::from_profile("owned-review").unwrap(),
                Instant::now() + Duration::from_secs(300),
            )
            .unwrap();
        gate.read(id).unwrap()
    }
    fn recipient() -> Arc<Recipient> {
        Arc::new(Recipient {
            revision: AiRecipientRevision::from_native_configuration(b"owned-model-processing")
                .unwrap(),
            current: AtomicBool::new(true),
        })
    }
    fn choices() -> AiSourceChoices {
        AiSourceChoices {
            accessibility_text: true,
            purposes: BTreeSet::from([AiPurpose::Classification]),
            ..Default::default()
        }
    }

    #[test]
    fn review_holds_immutable_explicit_choices_and_refuses_unsupported_or_partial_choices() {
        let owner = AccountGate::default();
        let authority = account(&owner);
        let target = recipient();
        let chosen = choices();
        let review =
            AiConsentReview::new(authority.clone(), target.clone(), chosen.clone()).unwrap();
        assert_eq!(review.choices(), &chosen);
        assert!(review.is_current());
        let another = AiConsentReview::new(authority.clone(), target.clone(), chosen).unwrap();
        assert!(review.id() != another.id());
        for invalid in [
            AiSourceChoices::default(),
            AiSourceChoices {
                images: true,
                ..choices()
            },
            AiSourceChoices {
                purposes: BTreeSet::new(),
                ..choices()
            },
        ] {
            assert!(AiConsentReview::new(authority.clone(), target.clone(), invalid).is_err());
        }
    }

    #[test]
    fn observed_recipient_or_account_revocation_never_revives_a_review() {
        let owner = AccountGate::default();
        let authority = account(&owner);
        let target = recipient();
        let review = AiConsentReview::new(authority.clone(), target.clone(), choices()).unwrap();
        target.current.store(false, Ordering::Release);
        assert!(!review.is_current());
        target.current.store(true, Ordering::Release);
        assert!(!review.is_current());
        let review = AiConsentReview::new(authority, target, choices()).unwrap();
        let replacement = account(&owner);
        assert!(!review.is_current());
        assert!(replacement.is_current());
        assert!(!review.is_current());
    }

    #[test]
    fn review_expires_on_either_clock_and_latches_clock_rollback() {
        for mode in ["monotonic", "wall", "rollback"] {
            let owner = AccountGate::default();
            let review = AiConsentReview::new(account(&owner), recipient(), choices()).unwrap();
            let (now, wall) = match mode {
                "monotonic" => (
                    review.proof.started + REVIEW_LIFETIME,
                    review.proof.wall_started,
                ),
                "wall" => (
                    review.proof.started,
                    review.proof.wall_started + REVIEW_LIFETIME,
                ),
                _ => (
                    review.proof.started,
                    review.proof.wall_started - Duration::from_millis(1),
                ),
            };
            assert!(!review.current_at(now, wall));
            assert!(!review.current_at(review.proof.started, review.proof.wall_started));
        }
    }
}
