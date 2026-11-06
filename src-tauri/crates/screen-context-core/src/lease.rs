//! Native account capability and response lifetime. The caller verifies identity
//! before binding; no user/account string is accepted by an evidence read.
use crate::{Error, ScopeId};
use serde::{ser::SerializeStruct, Serialize, Serializer};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};
use std::time::{Instant, SystemTime};
use uuid::Uuid;

#[derive(Clone, Copy, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(transparent)]
pub struct AccountLeaseId(Uuid);
impl std::fmt::Debug for AccountLeaseId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("AccountLeaseId([redacted])")
    }
}
struct Binding {
    scope: ScopeId,
    id: AccountLeaseId,
    lifetime: Arc<LeaseLifetime>,
}
struct LeaseLifetime {
    bounds: Mutex<LeaseBounds>,
    alive: AtomicBool,
}
struct LeaseBounds {
    started: Instant,
    deadline: Instant,
    wall_started: SystemTime,
    wall_deadline: SystemTime,
}
impl LeaseLifetime {
    fn current(&self) -> bool {
        let Ok(bounds) = self.bounds.lock() else {
            self.alive.store(false, Ordering::Release);
            return false;
        };
        // Sample clocks after the lock: a concurrent renewal may move the
        // issuance time forward while this reader is waiting for the bounds.
        self.current_bounds(&bounds, Instant::now(), SystemTime::now())
    }
    #[cfg(test)]
    fn at(&self, now: Instant, wall: SystemTime) -> bool {
        let Ok(bounds) = self.bounds.lock() else {
            self.alive.store(false, Ordering::Release);
            return false;
        };
        self.current_bounds(&bounds, now, wall)
    }
    fn current_bounds(&self, bounds: &LeaseBounds, now: Instant, wall: SystemTime) -> bool {
        if !self.alive.load(Ordering::Acquire) {
            return false;
        }
        if now < bounds.started
            || now >= bounds.deadline
            || wall < bounds.wall_started
            || wall >= bounds.wall_deadline
        {
            self.alive.store(false, Ordering::Release);
            return false;
        }
        true
    }
    fn renew_at(&self, now: Instant, wall: SystemTime, deadline: Instant) -> Result<(), Error> {
        let mut bounds = self.bounds.lock().map_err(|_| Error::Invalidated)?;
        if !self.current_bounds(&bounds, now, wall) {
            return Err(Error::Invalidated);
        }
        let remaining = deadline
            .checked_duration_since(now)
            .filter(|duration| !duration.is_zero())
            .ok_or(Error::Invalidated)?;
        let wall_deadline = wall.checked_add(remaining).ok_or(Error::Invalidated)?;
        *bounds = LeaseBounds {
            started: now,
            deadline,
            wall_started: wall,
            wall_deadline,
        };
        Ok(())
    }
}
pub struct AccountTransition {
    fence: Arc<AtomicU64>,
    closed: Arc<AtomicBool>,
    epoch: u64,
}
impl AccountTransition {
    pub fn is_current(&self) -> bool {
        !self.closed.load(Ordering::Acquire) && self.epoch == self.fence.load(Ordering::Acquire)
    }
}
/// This lock protects only capability changes; no I/O or serialization runs
/// under it. Revocation therefore does not wait for an evidence read to finish.
pub struct AccountGate {
    fence: Arc<AtomicU64>,
    closed: Arc<AtomicBool>,
    binding: Mutex<Option<Binding>>,
}
impl Default for AccountGate {
    fn default() -> Self {
        Self {
            fence: Arc::new(AtomicU64::new(0)),
            closed: Arc::new(AtomicBool::new(false)),
            binding: Mutex::new(None),
        }
    }
}
impl AccountGate {
    pub fn begin_transition(&self) -> Result<AccountTransition, Error> {
        let mut binding = self.binding.lock().map_err(|_| {
            self.closed.store(true, Ordering::Release);
            Error::Invalidated
        })?;
        *binding = None;
        let epoch = self
            .fence
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |v| v.checked_add(1))
            .map_err(|_| {
                self.closed.store(true, Ordering::Release);
                Error::Invalidated
            })?
            + 1;
        Ok(AccountTransition {
            fence: Arc::clone(&self.fence),
            closed: Arc::clone(&self.closed),
            epoch,
        })
    }
    /// Only trusted native authentication may provide this scope. A transition
    /// is consumed once, is specific to this gate, and cannot win a later login.
    pub fn bind_verified(
        &self,
        transition: AccountTransition,
        scope: ScopeId,
        deadline: Instant,
    ) -> Result<AccountLeaseId, Error> {
        let mut binding = self.binding.lock().map_err(|_| Error::Invalidated)?;
        if !Arc::ptr_eq(&transition.fence, &self.fence)
            || !transition.is_current()
            || binding.is_some()
            || deadline <= Instant::now()
        {
            return Err(Error::Invalidated);
        }
        let started = Instant::now();
        let remaining = deadline
            .checked_duration_since(started)
            .filter(|v| !v.is_zero())
            .ok_or(Error::Invalidated)?;
        let wall_started = SystemTime::now();
        let wall_deadline = wall_started
            .checked_add(remaining)
            .ok_or(Error::Invalidated)?;
        let id = AccountLeaseId(Uuid::new_v4());
        *binding = Some(Binding {
            scope,
            id,
            lifetime: Arc::new(LeaseLifetime {
                bounds: Mutex::new(LeaseBounds {
                    started,
                    deadline,
                    wall_started,
                    wall_deadline,
                }),
                alive: AtomicBool::new(true),
            }),
        });
        Ok(id)
    }
    /// Trusted native authentication may renew only the exact still-live grant
    /// it captured before verification. Neither scope equality nor an old UUID
    /// can revive an expired grant or win a concurrent account transition.
    pub fn renew_verified(
        &self,
        lease: &AccountReadLease,
        scope: &ScopeId,
        deadline: Instant,
    ) -> Result<(), Error> {
        let binding = self.binding.lock().map_err(|_| Error::Invalidated)?;
        let binding = binding.as_ref().ok_or(Error::Invalidated)?;
        if !Arc::ptr_eq(&lease.fence, &self.fence)
            || self.closed.load(Ordering::Acquire)
            || lease.epoch != self.fence.load(Ordering::Acquire)
            || lease.id != binding.id
            || !Arc::ptr_eq(&lease.lifetime, &binding.lifetime)
            || scope != &binding.scope
        {
            return Err(Error::Invalidated);
        }
        binding
            .lifetime
            .renew_at(Instant::now(), SystemTime::now(), deadline)
    }
    pub fn read(&self, id: AccountLeaseId) -> Result<AccountReadLease, Error> {
        let binding = self.binding.lock().map_err(|_| Error::Invalidated)?;
        let binding = binding
            .as_ref()
            .filter(|b| !self.closed.load(Ordering::Acquire) && b.id == id && b.lifetime.current())
            .ok_or(Error::Invalidated)?;
        Ok(AccountReadLease {
            fence: Arc::clone(&self.fence),
            closed: Arc::clone(&self.closed),
            epoch: self.fence.load(Ordering::Acquire),
            id,
            scope: binding.scope.clone(),
            lifetime: Arc::clone(&binding.lifetime),
        })
    }
}

#[derive(Clone)]
pub struct AccountReadLease {
    fence: Arc<AtomicU64>,
    closed: Arc<AtomicBool>,
    epoch: u64,
    id: AccountLeaseId,
    scope: ScopeId,
    lifetime: Arc<LeaseLifetime>,
}
impl AccountReadLease {
    /// Invalidates only this captured grant, never a later account's grant.
    pub fn revoke(&self) {
        self.lifetime.alive.store(false, Ordering::Release);
    }
    /// Native owners compare the exact verified capability, including its
    /// generation and lifetime. Equal profile names alone never suffice. This
    /// comparison is not a current-authority check or a serializable selector.
    pub fn same_capability(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.fence, &other.fence)
            && Arc::ptr_eq(&self.lifetime, &other.lifetime)
            && self.epoch == other.epoch
            && self.id == other.id
            && self.scope == other.scope
    }

    pub fn scope(&self) -> &ScopeId {
        &self.scope
    }
    pub fn is_current(&self) -> bool {
        !self.closed.load(Ordering::Acquire)
            && self.epoch == self.fence.load(Ordering::Acquire)
            && self.lifetime.current()
    }
    pub fn reply<T: Serialize>(self, value: T) -> Result<AccountReply<T>, Error> {
        if !self.is_current() {
            return Err(Error::Invalidated);
        }
        Ok(AccountReply { lease: self, value })
    }
}
/// Serialization checks the lease again. A response already queued in the
/// WebView still carries leaseId, which the client MUST match before displaying.
/// Rust cannot retract a message after the IPC transport has accepted it.
pub struct AccountReply<T> {
    lease: AccountReadLease,
    value: T,
}
impl<T: Serialize> Serialize for AccountReply<T> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::Error;
        if !self.lease.is_current() {
            return Err(S::Error::custom("screen context response invalidated"));
        }
        let mut value = serializer.serialize_struct("ScreenContextReply", 2)?;
        value.serialize_field("leaseId", &self.lease.id)?;
        value.serialize_field("value", &self.value)?;
        if !self.lease.is_current() {
            return Err(S::Error::custom("screen context response invalidated"));
        }
        value.end()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;
    fn scope(name: &str) -> ScopeId {
        ScopeId::from_profile(name).unwrap()
    }
    fn bind(gate: &AccountGate, name: &str) -> AccountLeaseId {
        gate.bind_verified(
            gate.begin_transition().unwrap(),
            scope(name),
            Instant::now() + Duration::from_secs(10),
        )
        .unwrap()
    }
    #[test]
    fn account_aba_and_expired_foreign_transitions_cannot_restore_an_old_capability() {
        let gate = AccountGate::default();
        let a = bind(&gate, "owned-a");
        let held = gate.read(a).unwrap();
        let slow = gate.begin_transition().unwrap();
        let b = bind(&gate, "owned-b");
        assert!(gate
            .bind_verified(
                slow,
                scope("owned-a"),
                Instant::now() + Duration::from_secs(10)
            )
            .is_err());
        assert!(!held.is_current());
        assert!(gate.read(a).is_err());
        assert!(gate.read(b).is_ok());
        let a2 = bind(&gate, "owned-a");
        assert_ne!(a, a2);
        assert!(gate.read(a).is_err());
        let other = AccountGate::default();
        assert!(gate
            .bind_verified(
                other.begin_transition().unwrap(),
                scope("owned-a"),
                Instant::now() + Duration::from_secs(10)
            )
            .is_err());
        assert!(other
            .bind_verified(
                other.begin_transition().unwrap(),
                scope("owned-a"),
                Instant::now()
            )
            .is_err());
    }
    #[test]
    fn a_decrypted_value_cannot_serialize_after_account_revocation() {
        let gate = AccountGate::default();
        let id = bind(&gate, "owned-a");
        let response = gate.read(id).unwrap().reply("OWNED_PRIVATE_TEXT").unwrap();
        gate.begin_transition().unwrap();
        assert!(serde_json::to_string(&response).is_err());
    }
    #[test]
    fn verified_renewal_preserves_the_exact_live_capability_and_held_reply() {
        let gate = AccountGate::default();
        let id = bind(&gate, "owned-a");
        let held = gate.read(id).unwrap();
        let response = held.clone().reply("OWNED_PRIVATE_TEXT").unwrap();
        let old_deadline = held.lifetime.bounds.lock().unwrap().deadline;
        gate.renew_verified(
            &held,
            &scope("owned-a"),
            old_deadline + Duration::from_secs(10),
        )
        .unwrap();
        assert!(held.same_capability(&gate.read(id).unwrap()));
        assert_eq!(
            held.lifetime.bounds.lock().unwrap().deadline,
            old_deadline + Duration::from_secs(10)
        );
        assert!(serde_json::to_string(&response).is_ok());
        held.revoke();
        assert!(!held.is_current());
        assert!(serde_json::to_string(&response).is_err());
    }
    #[test]
    fn renewal_cannot_cross_scope_gate_revocation_or_account_aba() {
        let gate = AccountGate::default();
        let id = bind(&gate, "owned-a");
        let held = gate.read(id).unwrap();
        let deadline = Instant::now() + Duration::from_secs(20);
        assert!(gate
            .renew_verified(&held, &scope("owned-b"), deadline)
            .is_err());
        let other = AccountGate::default();
        bind(&other, "owned-a");
        assert!(other
            .renew_verified(&held, &scope("owned-a"), deadline)
            .is_err());
        bind(&gate, "owned-b");
        let next = bind(&gate, "owned-a");
        assert!(gate
            .renew_verified(&held, &scope("owned-a"), deadline)
            .is_err());
        // A failed old verification must not revoke the newly installed account.
        held.revoke();
        assert!(gate.read(next).is_ok());
    }
    #[test]
    fn renewal_never_revives_expiry_or_rollback_and_can_shorten_a_grant() {
        let now = Instant::now();
        let wall = SystemTime::now();
        let make = || LeaseLifetime {
            bounds: Mutex::new(LeaseBounds {
                started: now,
                deadline: now + Duration::from_secs(10),
                wall_started: wall,
                wall_deadline: wall + Duration::from_secs(10),
            }),
            alive: AtomicBool::new(true),
        };
        for (instant, utc) in [
            (now + Duration::from_secs(10), wall),
            (now, wall + Duration::from_secs(10)),
            (now, wall - Duration::from_secs(1)),
        ] {
            let lease = make();
            assert!(lease
                .renew_at(instant, utc, now + Duration::from_secs(30))
                .is_err());
            assert!(lease
                .renew_at(now, wall, now + Duration::from_secs(30))
                .is_err());
        }
        let lease = make();
        lease
            .renew_at(
                now + Duration::from_secs(1),
                wall + Duration::from_secs(1),
                now + Duration::from_secs(3),
            )
            .unwrap();
        assert!(lease.at(now + Duration::from_secs(2), wall + Duration::from_secs(2)));
        assert!(!lease.at(now + Duration::from_secs(3), wall + Duration::from_secs(3)));
    }
    #[test]
    fn exhausted_generation_revokes_the_last_lease_and_cannot_rebind() {
        let gate = AccountGate::default();
        gate.fence.store(u64::MAX - 1, Ordering::Release);
        let id = bind(&gate, "owned-a");
        let held = gate.read(id).unwrap();
        assert!(held.is_current());
        assert!(gate.begin_transition().is_err());
        assert!(!held.is_current());
        assert!(gate.read(id).is_err());
        assert!(gate.begin_transition().is_err());
    }
    #[test]
    fn sleep_elapsed_wall_time_and_clock_rollback_permanently_expire_a_lease() {
        let instant = Instant::now();
        let wall = SystemTime::now();
        let make = || LeaseLifetime {
            bounds: Mutex::new(LeaseBounds {
                started: instant,
                deadline: instant + Duration::from_secs(10),
                wall_started: wall,
                wall_deadline: wall + Duration::from_secs(10),
            }),
            alive: AtomicBool::new(true),
        };
        let sleep = make();
        assert!(sleep.at(
            instant + Duration::from_secs(1),
            wall + Duration::from_secs(1)
        ));
        // Suspend accounting for Instant is platform dependent. Wall expiry is
        // decisive even when only one second of monotonic time has elapsed.
        assert!(!sleep.at(
            instant + Duration::from_secs(1),
            wall + Duration::from_secs(11)
        ));
        assert!(!sleep.at(
            instant + Duration::from_secs(2),
            wall + Duration::from_secs(2)
        ));
        let rollback = make();
        assert!(!rollback.at(
            instant + Duration::from_secs(1),
            wall - Duration::from_secs(1)
        ));
        assert!(!rollback.at(
            instant + Duration::from_secs(2),
            wall + Duration::from_secs(2)
        ));
    }
    #[test]
    fn revocation_during_serialization_returns_no_successful_body() {
        struct Changing<'a>(&'a AccountGate);
        impl Serialize for Changing<'_> {
            fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
                self.0.begin_transition().unwrap();
                s.serialize_str("OWNED_PRIVATE_TEXT")
            }
        }
        let gate = AccountGate::default();
        let id = bind(&gate, "owned-a");
        let response = gate.read(id).unwrap().reply(Changing(&gate)).unwrap();
        assert!(serde_json::to_vec(&response).is_err());
        let id = bind(&gate, "owned-a");
        let response = gate.read(id).unwrap().reply(7).unwrap();
        let wire = serde_json::to_value(response).unwrap();
        assert_eq!(wire["leaseId"], serde_json::to_value(id).unwrap());
        assert_eq!(wire["value"], 7);
        assert!(wire.get("scope").is_none());
    }
}
