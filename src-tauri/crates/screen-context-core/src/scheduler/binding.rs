//! One optional queue, separate from capture/store work. No forced tracker
//! flush or invented time: a missing point waits for normal sampling only.
use super::*;
use crate::{
    activity_binding::MAX_BIND_AGE_MS,
    activity_reader::{ActivityResolver, CapturedActivityHint},
};
const MAX_PENDING_BINDINGS: usize = 4;
const RETRY: Duration = Duration::from_secs(1);
#[cfg(test)]
mod tests;

pub(super) struct PendingBinding {
    id: Uuid,
    hint: CapturedActivityHint,
    generation: u64,
    epoch: u64,
    due: Instant,
    expires: Instant,
    account: Option<AccountReadLease>,
    fence: Arc<AtomicU64>,
    stopping: Arc<AtomicBool>,
    invalidated: AtomicBool,
}
impl PendingBinding {
    pub(super) fn new(
        id: Uuid,
        hint: CapturedActivityHint,
        generation: u64,
        epoch: u64,
        shared: &Shared,
        account: Option<AccountReadLease>,
    ) -> Option<Self> {
        let now = unix_millis().ok()?;
        let age = now.checked_sub(hint.observed_at_ms)?;
        if !(0..MAX_BIND_AGE_MS).contains(&age) {
            return None;
        }
        Some(Self {
            id,
            hint,
            generation,
            epoch,
            due: Instant::now(),
            expires: Instant::now() + Duration::from_millis((MAX_BIND_AGE_MS - age) as u64),
            account,
            fence: Arc::clone(&shared.fence),
            stopping: Arc::clone(&shared.stopping),
            invalidated: AtomicBool::new(false),
        })
    }
    fn current(&self) -> bool {
        self.current_at(Instant::now(), unix_millis())
    }
    fn current_at(&self, monotonic: Instant, wall: Result<i64, Error>) -> bool {
        if self.invalidated.load(Ordering::Acquire) {
            return false;
        }
        let current = !self.stopping.load(Ordering::Acquire)
            && self.epoch == self.fence.load(Ordering::Acquire)
            && monotonic < self.expires
            && self.account.as_ref().is_none_or(|lease| lease.is_current())
            && wall.is_ok_and(|now| {
                now >= self.hint.observed_at_ms && now - self.hint.observed_at_ms <= MAX_BIND_AGE_MS
            });
        if !current {
            self.invalidated.store(true, Ordering::Release);
        }
        current
    }
}
pub(super) fn enqueue(state: &mut State, pending: PendingBinding) {
    if state.bindings.len() >= MAX_PENDING_BINDINGS {
        state.bindings.pop_front();
    }
    state.bindings.push_back(pending);
}

pub(super) fn run(shared: Shared, resolver: Arc<dyn ActivityResolver>) {
    shared.binding_wake.bind_current();
    let mut reader_epoch = None;
    loop {
        let pending = {
            let mut state = lock(&shared);
            state.binding_active = None;
            loop {
                if state.closed || shared.stopping.load(Ordering::Acquire) {
                    drop(state);
                    resolver.reset();
                    return;
                }
                let epoch = shared.fence.load(Ordering::Acquire);
                if reader_epoch != Some(epoch) {
                    drop(state);
                    resolver.reset();
                    reader_epoch = Some(epoch);
                    state = lock(&shared);
                    continue;
                }
                state.bindings.retain(PendingBinding::current);
                if let Some(index) = state.bindings.iter().position(|p| p.due <= Instant::now()) {
                    let pending = state
                        .bindings
                        .remove(index)
                        .expect("selected pending binding");
                    state.binding_active = Some(pending.id);
                    break pending;
                }
                let wait = state
                    .bindings
                    .iter()
                    .map(|p| p.due.saturating_duration_since(Instant::now()))
                    .min()
                    .unwrap_or(Duration::from_secs(90));
                let deadline = Instant::now() + wait;
                drop(state);
                std::thread::park_timeout(wait);
                state = lock(&shared);
                if Instant::now() >= deadline {
                    drop(state);
                    resolver.maintain_idle();
                    state = lock(&shared);
                }
            }
        };
        if !pending.current() {
            continue;
        }
        // No capture/state/store mutex is held across the optional process/DB
        // query. Its own bounded transport reaps on cancellation/deadline.
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            resolver.resolve_capture(&pending.hint, &|| pending.current())
        }))
        .unwrap_or(Err(Error::WorkerUnavailable));
        if !pending.current() {
            continue;
        }
        // A concurrent detail/status read must not permanently discard a valid
        // association. Only this optional actor waits; it holds no tracker,
        // capture or store lock, and cancellation/age bounds every retry.
        let state = loop {
            if !pending.current() {
                break None;
            }
            match shared.state.try_lock() {
                Ok(state) => break Some(state),
                Err(std::sync::TryLockError::Poisoned(error)) => {
                    break Some(error.into_inner());
                }
                Err(std::sync::TryLockError::WouldBlock) => {
                    std::thread::sleep(Duration::from_millis(2));
                }
            }
        };
        let Some(mut state) = state else {
            continue;
        };
        if state.closed
            || state.epoch != pending.epoch
            || !authorized(&state)
            || effective_policy(&state)
                .is_none_or(|p| !p.active() || p.excluded_apps.contains(&pending.hint.app_key))
        {
            continue;
        }
        match result {
            Ok(Some(record)) => {
                if let Some(store) = state.store.as_mut() {
                    if let Ok(now) = unix_millis() {
                        let _ = store.bind_activity_if_current(
                            pending.generation,
                            pending.id,
                            &record,
                            now,
                            &|| pending.current(),
                        );
                    }
                }
            }
            Ok(None) | Err(Error::WorkerUnavailable) => {
                let mut pending = pending;
                pending.due = Instant::now() + RETRY;
                if pending.due < pending.expires {
                    enqueue(&mut state, pending);
                }
            }
            Err(_) => {} // Optional failure never changes capture success/time.
        }
    }
}
