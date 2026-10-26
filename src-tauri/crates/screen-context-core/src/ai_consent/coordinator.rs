//! One native-held confirmation per settings coordinator. Its atomic generation
//! invalidates preparation and storage work without waiting for either one.
use super::{AiConsentReview, AiConsentReviewId, AiConsentReviewView, NativeAiRecipient};
use crate::{ai_input::AiSourceChoices, ai_input::AiUseGate, lease::AccountReadLease};
use crate::{Error, ScreenContextService};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};

#[derive(Default)]
struct Generation {
    value: AtomicU64,
    closed: AtomicBool,
}
impl Generation {
    fn advance(&self) -> Result<u64, Error> {
        if self.closed.load(Ordering::Acquire) {
            return Err(Error::Invalidated);
        }
        self.value
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |v| v.checked_add(1))
            .map(|v| v + 1)
            .map_err(|_| {
                self.closed.store(true, Ordering::Release);
                Error::Invalidated
            })
    }
    fn current(&self, value: u64) -> bool {
        !self.closed.load(Ordering::Acquire) && self.value.load(Ordering::Acquire) == value
    }
}

struct Pending {
    account: AccountReadLease,
    review: Option<AiConsentReview>,
    view: PendingAiConsentView,
}

/// No serialization or transport authority. The app may serialize a separate
/// content-free display only while this account/recipient/review is current.
#[derive(Clone)]
pub struct PendingAiConsentView {
    review: AiConsentReviewView,
    generation: Arc<Generation>,
    version: u64,
}
impl PendingAiConsentView {
    pub fn id(&self) -> AiConsentReviewId {
        self.review.id()
    }
    pub fn choices(&self) -> &AiSourceChoices {
        self.review.choices()
    }
    pub fn expires_at_ms(&self) -> Result<i64, Error> {
        self.review.expires_at_ms()
    }
    pub fn is_current(&self) -> bool {
        self.generation.current(self.version)
            && self.review.is_current()
            && self.generation.current(self.version)
    }
}

#[derive(Default)]
pub struct AiConsentCoordinator {
    generation: Arc<Generation>,
    pending: Mutex<Option<Pending>>,
}

/// Native-only request ordering. An IPC entry point reserves this before
/// queueing blocking recipient or OFF-save work; an older queued request cannot
/// reopen a review or commit settings after a later operation/account transition.
pub struct AiConsentOperation {
    generation: Arc<Generation>,
    version: u64,
}
impl AiConsentOperation {
    pub fn is_current(&self) -> bool {
        self.generation.current(self.version)
    }
}

/// One taken native confirmation, validated before the app opens storage or
/// accesses a profile key. The coordinator retains its cancellation view.
pub struct AiConsentConfirmation {
    review: AiConsentReview,
    generation: Arc<Generation>,
    version: u64,
}
impl AiConsentConfirmation {
    pub fn is_current(&self) -> bool {
        self.generation.current(self.version)
            && self.review.is_current()
            && self.generation.current(self.version)
    }
}

impl AiConsentCoordinator {
    /// Content-free status uses the exact capability and rechecks the native
    /// proof outside the slot lock. An equal model label cannot conceal a dead
    /// process or expired review from the settings dialog.
    pub fn pending_review(
        &self,
        authority: &AccountReadLease,
    ) -> Result<Option<PendingAiConsentView>, Error> {
        if !authority.is_current() {
            return Err(Error::Invalidated);
        }
        let view = self
            .pending
            .lock()
            .map_err(|_| self.poison())?
            .as_ref()
            .filter(|p| p.account.same_capability(authority))
            .map(|p| p.view.clone());
        Ok(view.filter(PendingAiConsentView::is_current))
    }

    /// Invalidates even a review already taken by confirm(). The generation
    /// advances before the short slot lock; recipient checks and disk I/O never
    /// run under this lock. Account/logout/shutdown call this synchronously.
    pub fn invalidate_now(&self) -> Result<(), Error> {
        let version = self.generation.advance()?;
        let old = {
            let mut pending = self.pending.lock().map_err(|_| self.poison())?;
            if !self.generation.current(version) {
                return Ok(());
            }
            pending.take()
        };
        if let Some(old) = old {
            old.view.review.invalidate_now();
        }
        Ok(())
    }

    pub fn prepare(
        &self,
        account: AccountReadLease,
        recipient: Arc<dyn NativeAiRecipient>,
        choices: AiSourceChoices,
    ) -> Result<PendingAiConsentView, Error> {
        let preparation = self.begin_operation()?;
        self.complete_preparation(preparation, account, recipient, choices)
    }

    pub fn begin_operation(&self) -> Result<AiConsentOperation, Error> {
        // A rejected replacement cannot leave an older confirmation usable.
        let version = self.generation.advance()?;
        let old = {
            let mut pending = self.pending.lock().map_err(|_| self.poison())?;
            if !self.generation.current(version) {
                return Err(Error::Invalidated);
            }
            pending.take()
        };
        if let Some(old) = old {
            old.view.review.invalidate_now();
        }
        Ok(AiConsentOperation {
            generation: Arc::clone(&self.generation),
            version,
        })
    }

    pub fn complete_preparation(
        &self,
        preparation: AiConsentOperation,
        account: AccountReadLease,
        recipient: Arc<dyn NativeAiRecipient>,
        choices: AiSourceChoices,
    ) -> Result<PendingAiConsentView, Error> {
        if !Arc::ptr_eq(&preparation.generation, &self.generation)
            || !self.generation.current(preparation.version)
        {
            return Err(Error::Invalidated);
        }
        let version = preparation.version;
        let review = AiConsentReview::new(account.clone(), recipient, choices)?;
        let view = PendingAiConsentView {
            review: review.view(),
            generation: Arc::clone(&self.generation),
            version,
        };
        if !view.is_current() {
            return Err(Error::Invalidated);
        }
        let mut pending = self.pending.lock().map_err(|_| self.poison())?;
        if !self.generation.current(version) {
            return Err(Error::Invalidated);
        }
        *pending = Some(Pending {
            account,
            review: Some(review),
            view: view.clone(),
        });
        Ok(view)
    }

    /// A late Escape from an older dialog cannot cancel its replacement.
    pub fn cancel(&self, authority: &AccountReadLease, id: AiConsentReviewId) -> Result<(), Error> {
        let mut pending = self.pending.lock().map_err(|_| self.poison())?;
        let owned = pending.as_ref().is_some_and(|p| {
            p.view.id() == id
                && p.account.same_capability(authority)
                && self.generation.current(p.view.version)
        });
        if !owned {
            return Err(Error::Invalidated);
        }
        self.generation.advance()?;
        if let Some(old) = pending.take() {
            old.view.review.invalidate_now();
        }
        Ok(())
    }

    pub fn confirm(
        &self,
        authority: &AccountReadLease,
        id: AiConsentReviewId,
        service: &ScreenContextService,
        gate: &AiUseGate,
    ) -> Result<AiConsentOperation, Error> {
        let confirmation = self.take_confirmation(authority, id)?;
        self.complete_confirmation(confirmation, authority, service, gate)
    }

    pub fn take_confirmation(
        &self,
        authority: &AccountReadLease,
        id: AiConsentReviewId,
    ) -> Result<AiConsentConfirmation, Error> {
        let (review, version) = {
            let mut pending = self.pending.lock().map_err(|_| self.poison())?;
            let owned = pending
                .as_mut()
                .filter(|p| {
                    p.view.id() == id
                        && p.account.same_capability(authority)
                        && self.generation.current(p.view.version)
                })
                .ok_or(Error::Invalidated)?;
            let review = owned.review.take().ok_or(Error::Invalidated)?;
            // Keep its cancellation view in the slot until I/O finishes. A
            // second confirm cannot take it, while Escape/OFF can still close it.
            (review, owned.view.version)
        };
        let confirmation = AiConsentConfirmation {
            review,
            generation: Arc::clone(&self.generation),
            version,
        };
        if !confirmation.is_current() {
            return Err(Error::Invalidated);
        }
        Ok(confirmation)
    }

    pub fn complete_confirmation(
        &self,
        confirmation: AiConsentConfirmation,
        authority: &AccountReadLease,
        service: &ScreenContextService,
        gate: &AiUseGate,
    ) -> Result<AiConsentOperation, Error> {
        if !Arc::ptr_eq(&confirmation.generation, &self.generation) || !confirmation.is_current() {
            return Err(Error::Invalidated);
        }
        let version = confirmation.version;
        let id = confirmation.review.id();
        let result = confirmation
            .review
            .save_guarded(authority, id, service, gate, &|| {
                self.generation.current(version)
            });
        let mut pending = self.pending.lock().map_err(|_| self.poison())?;
        if pending.as_ref().is_some_and(|p| p.view.version == version) {
            *pending = None;
        }
        result?;
        let operation = AiConsentOperation {
            generation: Arc::clone(&self.generation),
            version,
        };
        if !operation.is_current() {
            return Err(Error::Invalidated);
        }
        Ok(operation)
    }

    fn poison(&self) -> Error {
        self.generation.closed.store(true, Ordering::Release);
        Error::Invalidated
    }
}

#[cfg(test)]
mod tests;
