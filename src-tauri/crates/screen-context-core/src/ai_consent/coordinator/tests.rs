use super::*;
use crate::{ai_consent::AiRecipientRevision, ai_input::AiPurpose, lease::AccountGate, ScopeId};
use std::{collections::BTreeSet, sync::mpsc, time::Duration, time::Instant};

struct Recipient(AiRecipientRevision);
impl NativeAiRecipient for Recipient {
    fn revision(&self) -> &AiRecipientRevision {
        &self.0
    }
    fn is_current(&self) -> bool {
        true
    }
    fn supports_images(&self) -> bool {
        false
    }
}
fn recipient() -> Arc<dyn NativeAiRecipient> {
    Arc::new(Recipient(
        AiRecipientRevision::from_native_configuration(b"native-owned-test").unwrap(),
    ))
}
fn account(owner: &AccountGate) -> AccountReadLease {
    let id = owner
        .bind_verified(
            owner.begin_transition().unwrap(),
            ScopeId::from_profile("owned-review-coordinator").unwrap(),
            Instant::now() + Duration::from_secs(300),
        )
        .unwrap();
    owner.read(id).unwrap()
}
fn choices() -> AiSourceChoices {
    AiSourceChoices {
        accessibility_text: true,
        purposes: BTreeSet::from([AiPurpose::Classification]),
        ..Default::default()
    }
}

#[test]
fn replacing_or_rejecting_a_review_closes_old_views_and_late_escape_preserves_the_replacement() {
    let owner = AccountGate::default();
    let account = account(&owner);
    let coordinator = AiConsentCoordinator::default();
    let first = coordinator
        .prepare(account.clone(), recipient(), choices())
        .unwrap();
    let second = coordinator
        .prepare(account.clone(), recipient(), choices())
        .unwrap();
    assert!(!first.is_current());
    assert!(coordinator.cancel(&account, first.id()).is_err());
    assert!(second.is_current());
    assert_eq!(second.choices(), &choices());
    assert!(coordinator
        .prepare(account.clone(), recipient(), AiSourceChoices::default())
        .is_err());
    assert!(!second.is_current());
    let third = coordinator
        .prepare(account.clone(), recipient(), choices())
        .unwrap();
    coordinator.cancel(&account, third.id()).unwrap();
    assert!(!third.is_current());
    assert!(coordinator.cancel(&account, third.id()).is_err());
}

#[test]
fn same_scope_foreign_cancel_refuses_and_account_change_closes_every_view() {
    let owner = AccountGate::default();
    let authority = account(&owner);
    let other = account(&AccountGate::default());
    assert_eq!(authority.scope(), other.scope());
    let coordinator = AiConsentCoordinator::default();
    let view = coordinator
        .prepare(authority.clone(), recipient(), choices())
        .unwrap();
    assert!(coordinator.cancel(&other, view.id()).is_err());
    assert!(view.is_current());
    owner.begin_transition().unwrap();
    assert!(!view.is_current());
    coordinator.invalidate_now().unwrap();
    assert!(!view.is_current());
}

struct SlowRecipient {
    revision: AiRecipientRevision,
    first: AtomicBool,
    entered: mpsc::SyncSender<()>,
    release: Mutex<mpsc::Receiver<()>>,
}
impl NativeAiRecipient for SlowRecipient {
    fn revision(&self) -> &AiRecipientRevision {
        &self.revision
    }
    fn is_current(&self) -> bool {
        if self.first.swap(false, Ordering::AcqRel) {
            self.entered.send(()).unwrap();
            self.release
                .lock()
                .unwrap()
                .recv_timeout(Duration::from_secs(5))
                .unwrap();
        }
        true
    }
    fn supports_images(&self) -> bool {
        false
    }
}

#[test]
fn cancel_and_new_review_do_not_wait_for_old_recipient_io_or_accept_its_late_completion() {
    let owner = AccountGate::default();
    let authority = account(&owner);
    let coordinator = Arc::new(AiConsentCoordinator::default());
    let (entered_tx, entered_rx) = mpsc::sync_channel(1);
    let (release_tx, release_rx) = mpsc::sync_channel(1);
    let target = Arc::new(SlowRecipient {
        revision: AiRecipientRevision::from_native_configuration(b"slow-owned-test").unwrap(),
        first: AtomicBool::new(true),
        entered: entered_tx,
        release: Mutex::new(release_rx),
    });
    let old_coordinator = Arc::clone(&coordinator);
    let old_authority = authority.clone();
    let old = std::thread::spawn(move || old_coordinator.prepare(old_authority, target, choices()));
    entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    coordinator.invalidate_now().unwrap();
    let replacement = coordinator
        .prepare(authority, recipient(), choices())
        .unwrap();
    release_tx.send(()).unwrap();
    assert!(matches!(old.join().unwrap(), Err(Error::Invalidated)));
    assert!(replacement.is_current());
}

#[test]
fn poisoned_slot_or_generation_exhaustion_permanently_closes_native_views() {
    let owner = AccountGate::default();
    let authority = account(&owner);
    let coordinator = AiConsentCoordinator::default();
    let view = coordinator
        .prepare(authority.clone(), recipient(), choices())
        .unwrap();
    coordinator
        .generation
        .value
        .store(u64::MAX, Ordering::Release);
    assert!(coordinator.invalidate_now().is_err());
    assert!(!view.is_current());
    assert!(coordinator
        .prepare(authority.clone(), recipient(), choices())
        .is_err());
    let coordinator = AiConsentCoordinator::default();
    let view = coordinator
        .prepare(authority, recipient(), choices())
        .unwrap();
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _slot = coordinator.pending.lock().unwrap();
        panic!("owned poisoned slot fixture");
    }));
    assert!(coordinator.invalidate_now().is_err());
    assert!(!view.is_current());
}

#[test]
fn queued_prepare_cannot_cross_off_replacement_or_another_native_coordinator() {
    let owner = AccountGate::default();
    let authority = account(&owner);
    let coordinator = AiConsentCoordinator::default();
    let queued = coordinator.begin_operation().unwrap();
    coordinator.invalidate_now().unwrap();
    assert!(coordinator
        .complete_preparation(queued, authority.clone(), recipient(), choices())
        .is_err());
    let queued = coordinator.begin_operation().unwrap();
    let current = coordinator
        .prepare(authority.clone(), recipient(), choices())
        .unwrap();
    assert!(coordinator
        .complete_preparation(queued, authority.clone(), recipient(), choices())
        .is_err());
    assert!(current.is_current());
    let foreign = AiConsentCoordinator::default();
    let foreign_queued = foreign.begin_operation().unwrap();
    assert!(coordinator
        .complete_preparation(foreign_queued, authority, recipient(), choices())
        .is_err());
    assert!(current.is_current());
}

#[test]
fn taken_confirmation_is_once_only_and_remains_cancellable_before_opening_storage() {
    let owner = AccountGate::default();
    let authority = account(&owner);
    let coordinator = AiConsentCoordinator::default();
    let current = coordinator
        .prepare(authority.clone(), recipient(), choices())
        .unwrap();
    let foreign = account(&AccountGate::default());
    assert!(coordinator.pending_review(&foreign).unwrap().is_none());
    assert!(
        coordinator
            .pending_review(&authority)
            .unwrap()
            .unwrap()
            .id()
            == current.id()
    );
    assert!(coordinator
        .take_confirmation(&foreign, current.id())
        .is_err());
    assert!(current.is_current());
    let taken = coordinator
        .take_confirmation(&authority, current.id())
        .unwrap();
    assert!(taken.is_current());
    assert!(coordinator.pending_review(&authority).unwrap().is_some());
    assert!(coordinator
        .take_confirmation(&authority, current.id())
        .is_err());
    coordinator.cancel(&authority, current.id()).unwrap();
    assert!(!taken.is_current());
    assert!(!current.is_current());
    assert!(coordinator.pending_review(&authority).unwrap().is_none());
    // No service/store/key is involved in checking or cancelling this ticket.
}
