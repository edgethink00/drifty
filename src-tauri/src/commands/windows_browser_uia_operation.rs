use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};

pub(super) enum OperationKind {
    Read { owner: Option<String> },
    Close,
}

struct ActiveOperation {
    generation: u64,
    kind: OperationKind,
}

struct State {
    active: Option<ActiveOperation>,
    generation: u64,
    waiting: bool,
}

pub(super) struct OperationGate {
    state: Mutex<State>,
    changed: Condvar,
}

pub(super) struct OperationGuard<'a> {
    gate: &'a OperationGate,
    generation: u64,
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum ReadRecovery {
    Ready,
    Blocked,
    TimedOut,
}

impl OperationGate {
    pub(super) const fn new() -> Self {
        Self {
            state: Mutex::new(State {
                active: None,
                generation: 0,
                waiting: false,
            }),
            changed: Condvar::new(),
        }
    }

    pub(super) fn acquire(&self, kind: OperationKind) -> Result<OperationGuard<'_>, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "windows_uia_busy".to_string())?;
        // A recovering reader is a single bounded waiter, never an action queue.
        if state.active.is_some() || state.waiting {
            return Err("windows_uia_busy".to_string());
        }
        state.generation = state.generation.wrapping_add(1);
        let generation = state.generation;
        state.active = Some(ActiveOperation { generation, kind });
        Ok(OperationGuard {
            gate: self,
            generation,
        })
    }

    pub(super) fn wait_for_read(&self, owner: &str, budget: Duration) -> ReadRecovery {
        let deadline = Instant::now() + budget;
        let Ok(mut state) = self.state.lock() else {
            return ReadRecovery::Blocked;
        };
        if state.waiting || owner.is_empty() {
            return ReadRecovery::Blocked;
        }
        let generation = match state.active.as_ref() {
            None => return ReadRecovery::Ready,
            Some(ActiveOperation {
                generation,
                kind:
                    OperationKind::Read {
                        owner: Some(active_owner),
                    },
            }) if active_owner == owner => *generation,
            _ => return ReadRecovery::Blocked,
        };
        state.waiting = true;
        self.changed.notify_all();
        let result = loop {
            match state.active.as_ref() {
                None => break ReadRecovery::Ready,
                Some(active) if active.generation == generation => {}
                _ => break ReadRecovery::Blocked,
            }
            let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
                break ReadRecovery::TimedOut;
            };
            match self.changed.wait_timeout(state, remaining) {
                Ok((next, _)) => state = next,
                // Poisoned state remains closed to future operations.
                Err(_) => return ReadRecovery::Blocked,
            }
        };
        state.waiting = false;
        self.changed.notify_all();
        result
    }
}

impl Drop for OperationGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut state) = self.gate.state.lock() {
            if state
                .active
                .as_ref()
                .is_some_and(|active| active.generation == self.generation)
            {
                state.active = None;
                self.gate.changed.notify_all();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{sync::Arc, thread};

    fn read(owner: &str) -> OperationKind {
        OperationKind::Read {
            owner: Some(owner.to_string()),
        }
    }

    fn wait_until_recovering(gate: &OperationGate) {
        let mut state = gate.state.lock().unwrap();
        let deadline = Instant::now() + Duration::from_secs(2);
        while !state.waiting {
            let remaining = deadline
                .checked_duration_since(Instant::now())
                .expect("waiter started");
            state = gate.changed.wait_timeout(state, remaining).unwrap().0;
        }
    }

    #[test]
    fn same_read_release_allows_one_subsequent_action_without_reusing_its_result() {
        let gate = Arc::new(OperationGate::new());
        let guard = gate.acquire(read("pet-1")).unwrap();
        let other = gate.clone();
        let waiter = thread::spawn(move || other.wait_for_read("pet-1", Duration::from_secs(2)));
        wait_until_recovering(&gate);
        assert!(gate.acquire(OperationKind::Close).is_err());
        drop(guard);
        assert_eq!(waiter.join().unwrap(), ReadRecovery::Ready);
        let close = gate.acquire(OperationKind::Close).unwrap();
        assert!(gate.acquire(OperationKind::Close).is_err());
        drop(close);
    }

    #[test]
    fn a_close_including_post_invoke_verification_is_never_waited_on() {
        let gate = OperationGate::new();
        let _close = gate.acquire(OperationKind::Close).unwrap();
        assert_eq!(
            gate.wait_for_read("pet-1", Duration::from_secs(5)),
            ReadRecovery::Blocked
        );
        assert!(gate.acquire(read("pet-1")).is_err());
    }

    #[test]
    fn an_unrelated_read_is_never_waited_on() {
        let gate = OperationGate::new();
        let _read = gate.acquire(read("other-pet")).unwrap();
        assert_eq!(
            gate.wait_for_read("pet-1", Duration::from_secs(5)),
            ReadRecovery::Blocked
        );
    }

    #[test]
    fn an_unowned_read_cannot_be_claimed_by_a_pet() {
        let gate = OperationGate::new();
        let _read = gate.acquire(OperationKind::Read { owner: None }).unwrap();
        assert_eq!(
            gate.wait_for_read("pet-1", Duration::from_secs(5)),
            ReadRecovery::Blocked
        );
    }

    #[test]
    fn a_hung_read_stays_quarantined_after_the_bounded_wait_expires() {
        let gate = OperationGate::new();
        let read = gate.acquire(read("pet-1")).unwrap();
        assert_eq!(
            gate.wait_for_read("pet-1", Duration::from_millis(10)),
            ReadRecovery::TimedOut
        );
        for _ in 0..10 {
            assert!(gate.acquire(OperationKind::Close).is_err());
        }
        drop(read);
        assert_eq!(
            gate.wait_for_read("pet-1", Duration::ZERO),
            ReadRecovery::Ready
        );
    }

    #[test]
    fn concurrent_recovery_does_not_create_another_waiter_or_action_queue() {
        let gate = Arc::new(OperationGate::new());
        let read = gate.acquire(read("pet-1")).unwrap();
        let other = gate.clone();
        let waiter = thread::spawn(move || other.wait_for_read("pet-1", Duration::from_secs(2)));
        wait_until_recovering(&gate);
        assert_eq!(
            gate.wait_for_read("pet-1", Duration::from_secs(5)),
            ReadRecovery::Blocked
        );
        assert!(gate.acquire(OperationKind::Close).is_err());
        drop(read);
        assert_eq!(waiter.join().unwrap(), ReadRecovery::Ready);
    }

    #[test]
    fn read_completed_before_recovery_does_not_add_delay() {
        let gate = OperationGate::new();
        drop(gate.acquire(read("pet-1")).unwrap());
        assert_eq!(
            gate.wait_for_read("pet-1", Duration::ZERO),
            ReadRecovery::Ready
        );
    }

    #[test]
    fn a_new_close_after_read_release_blocks_the_old_recovery_request() {
        let gate = OperationGate::new();
        drop(gate.acquire(read("pet-1")).unwrap());
        let _close = gate.acquire(OperationKind::Close).unwrap();
        assert_eq!(
            gate.wait_for_read("pet-1", Duration::from_secs(5)),
            ReadRecovery::Blocked
        );
    }
}
