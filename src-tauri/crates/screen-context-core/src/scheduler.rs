use crate::{
    lease::AccountReadLease,
    store::{EvidenceMetadata, EvidencePage, EvidenceStore, NewEvidence, PageCursor, Removal},
    CapturePreferences, Error, Frame, SurfaceFacts, TextEvidence, TextSource, TextState,
};
use serde::{Serialize, Serializer};
use std::{
    collections::{BTreeSet, VecDeque},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;
mod activity_reads;
mod binding;
mod wake;
use wake::WorkerWake;

/// A sensitive read also expires on deletion/policy/store changes, separately
/// from the account capability. Client generation checks cover queued IPC.
pub struct ObservationLease {
    fence: Arc<AtomicU64>,
    stopping: Arc<AtomicBool>,
    epoch: u64,
    issued_at_ms: i64,
    expires_at_ms: Option<i64>,
    invalidated: AtomicBool,
}
impl ObservationLease {
    pub fn limit_until(&mut self, expires_at_ms: i64) {
        self.expires_at_ms = Some(
            self.expires_at_ms
                .map_or(expires_at_ms, |old| old.min(expires_at_ms)),
        );
    }
    pub fn is_current(&self) -> bool {
        if self.invalidated.load(Ordering::Acquire) {
            return false;
        }
        let current = !self.stopping.load(Ordering::Acquire)
            && self.epoch == self.fence.load(Ordering::Acquire)
            && unix_millis().is_ok_and(|now| {
                self.issued_at_ms >= 0
                    && now >= self.issued_at_ms
                    && self.expires_at_ms.is_none_or(|expiry| now < expiry)
            });
        if !current {
            self.invalidated.store(true, Ordering::Release);
        }
        current
    }
    pub fn reply<T: Serialize>(self, value: T) -> Result<ObservationReply<T>, Error> {
        if !self.is_current() {
            return Err(Error::Invalidated);
        }
        Ok(ObservationReply { lease: self, value })
    }
}
pub struct ObservationReply<T> {
    lease: ObservationLease,
    value: T,
}
impl<T: Serialize> Serialize for ObservationReply<T> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::Error;
        if !self.lease.is_current() {
            return Err(S::Error::custom("screen context observation invalidated"));
        }
        let result = self.value.serialize(serializer)?;
        if !self.lease.is_current() {
            return Err(S::Error::custom("screen context observation invalidated"));
        }
        Ok(result)
    }
}

pub const CAPTURE_DEADLINE: Duration = Duration::from_secs(1);
/// Initial model preparation is separate from a warm capture. It cannot read
/// OS surfaces/pixels. Never count this budget as a one-second end-to-end pass.
pub const PREPARATION_DEADLINE: Duration = Duration::from_secs(5);

#[derive(Clone, Default, PartialEq, Eq)]
pub struct CapturePolicy {
    pub enabled: bool,
    pub paused: bool,
    pub replay_enabled: bool,
    pub ocr_enabled: bool,
    pub visible_text_enabled: bool,
    pub allowed_apps: BTreeSet<String>,
    pub excluded_apps: BTreeSet<String>,
}

impl CapturePolicy {
    fn validate(&self) -> Result<(), Error> {
        if self.allowed_apps.len() > 256
            || self.excluded_apps.len() > 1024
            || self
                .allowed_apps
                .iter()
                .chain(&self.excluded_apps)
                .any(|s| s.is_empty() || s.len() > 256)
        {
            return Err(Error::Invalid("capture policy"));
        }
        Ok(())
    }
    fn active(&self) -> bool {
        self.enabled
            && !self.paused
            && (self.replay_enabled || self.ocr_enabled || self.visible_text_enabled)
            && !self.allowed_apps.is_empty()
    }
    pub fn admits(&self, facts: &SurfaceFacts) -> bool {
        self.active() && facts.admissible(&self.allowed_apps, &self.excluded_apps)
    }
    pub(crate) fn permits_text(&self, text: &TextEvidence) -> bool {
        match text.source() {
            TextSource::None => !self.ocr_enabled && !self.visible_text_enabled,
            TextSource::Ocr => self.ocr_enabled,
            TextSource::Accessibility => self.visible_text_enabled,
        }
    }
}

pub struct Cancellation {
    flag: Arc<AtomicBool>,
    fence: Arc<AtomicU64>,
    expected_epoch: u64,
    stopping: Arc<AtomicBool>,
    deadline: Instant,
    account: Option<AccountReadLease>,
}
impl Cancellation {
    pub fn is_cancelled(&self) -> bool {
        self.flag.load(Ordering::Acquire)
            || self.stopping.load(Ordering::Acquire)
            || self.fence.load(Ordering::Acquire) != self.expected_epoch
            || Instant::now() >= self.deadline
            || self
                .account
                .as_ref()
                .is_some_and(|lease| !lease.is_current())
    }
    pub fn deadline(&self) -> Instant {
        self.deadline
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaptureFailure {
    Permission,
    Excluded,
    Visibility,
    Protected,
    Unsupported,
    Cancelled,
    Deadline,
    Unavailable,
    Invalidated,
    Storage,
    NoText,
    TextDeadline,
    TextUnavailable,
}

pub struct NativeCapture {
    pub before: SurfaceFacts,
    pub after: SurfaceFacts,
    pub observed_at_ms: i64,
    pub text: TextEvidence,
    pub frame: Frame,
    /// Capture-bound exact-title equality hint only. The sampler does not yet
    /// persist/use this; it grants no tracker link, permission or identity.
    pub activity_hint: Option<crate::native::WindowTitleDigest>,
}

/// The fixed OS adapter must obtain its own facts and apply `policy.admits`
/// BEFORE asking the OS for pixels. It must kill/reap its owned helper by the
/// cancellation/deadline. These facts must never be supplied by a WebView.
pub trait CaptureBackend: Send + Sync + 'static {
    fn prepare(
        &self,
        _policy: &CapturePolicy,
        _cancellation: &Cancellation,
    ) -> Result<(), CaptureFailure> {
        Ok(())
    }
    /// A completed helper may need replacing before the next request. This
    /// query must not start a process or inspect any OS surface. Preparation
    /// still runs on the owned worker under the current account/policy fence.
    fn needs_idle_preparation(&self) -> bool {
        false
    }
    /// Called on the owned worker after a lifecycle change and on shutdown.
    /// Discard prepared models/children; this must never start a helper.
    fn reset(&self) {}
    fn capture(
        &self,
        policy: &CapturePolicy,
        cancellation: &Cancellation,
    ) -> Result<NativeCapture, CaptureFailure>;
}

#[derive(Clone, Default, Debug)]
pub struct CaptureStatus {
    pub enabled: bool,
    pub paused: bool,
    pub running: bool,
    pub preparing: bool,
    pub pending: bool,
    pub accepted: u64,
    pub dropped: u64,
    pub replaced: u64,
    pub last_failure: Option<CaptureFailure>,
    pub last_accepted_at_ms: Option<i64>,
}

struct State {
    store: Option<EvidenceStore>,
    policy: CapturePolicy,
    global_exclusions: Option<BTreeSet<String>>,
    epoch: u64,
    pending: Option<u64>,
    active: Option<Arc<AtomicBool>>,
    closed: bool,
    status: CaptureStatus,
    account_required: bool,
    account: Option<AccountReadLease>,
    binding_enabled: bool,
    bindings: VecDeque<binding::PendingBinding>,
    binding_active: Option<Uuid>,
}
struct SharedState {
    state: Mutex<State>,
    wake: WorkerWake,
    fence: Arc<AtomicU64>,
    stopping: Arc<AtomicBool>,
    binding_wake: WorkerWake,
}
type Shared = Arc<SharedState>;

// Invalidate before waiting for any storage I/O. The second advance under the
// state lock makes overlapping changes safe even if their lock order differs.
fn begin_change(shared: &Shared) {
    if shared
        .fence
        .fetch_update(Ordering::AcqRel, Ordering::Acquire, |value| {
            value.checked_add(1)
        })
        .is_err()
    {
        shared.stopping.store(true, Ordering::Release);
    }
    shared.wake.notify_all();
    shared.binding_wake.notify_all();
}

/// One owned worker and one replaceable pending request for the app lifetime.
/// No helper, timer, or capture starts merely by constructing the service.
pub struct ScreenContextService {
    shared: Shared,
    worker: Option<JoinHandle<()>>,
    binding_worker: Option<JoinHandle<()>>,
    activity_reader: Option<Arc<dyn crate::activity_reader::ActivityResolver>>,
}

fn lock(shared: &Shared) -> std::sync::MutexGuard<'_, State> {
    shared.state.lock().unwrap_or_else(|p| p.into_inner())
}
fn authorized(state: &State) -> bool {
    match &state.account {
        Some(lease) => {
            lease.is_current()
                && state
                    .store
                    .as_ref()
                    .is_none_or(|store| store.scope() == lease.scope())
        }
        None => !state.account_required,
    }
}
fn effective_policy(state: &State) -> Option<CapturePolicy> {
    let mut policy = state.policy.clone();
    policy
        .excluded_apps
        .extend(state.global_exclusions.as_ref()?.iter().cloned());
    Some(policy)
}
fn invalidate(state: &mut State, shared: &Shared) {
    begin_change(shared);
    state.epoch = shared.fence.load(Ordering::Acquire);
    if shared.stopping.load(Ordering::Acquire) {
        state.closed = true;
        state.policy.enabled = false;
    }
    state.pending = None;
    state.bindings.clear();
    if let Some(cancel) = &state.active {
        cancel.store(true, Ordering::Release);
    }
}
pub fn unix_millis() -> Result<i64, Error> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| Error::ClockRollback)?
        .as_millis();
    i64::try_from(now).map_err(|_| Error::ClockRollback)
}

impl ScreenContextService {
    pub fn observation_lease(&self) -> ObservationLease {
        ObservationLease {
            fence: Arc::clone(&self.shared.fence),
            stopping: Arc::clone(&self.shared.stopping),
            epoch: self.shared.fence.load(Ordering::Acquire),
            issued_at_ms: unix_millis().unwrap_or(-1),
            expires_at_ms: None,
            invalidated: AtomicBool::new(false),
        }
    }

    pub fn read_preferences(&self) -> Result<CapturePreferences, Error> {
        self.with_store(|store, now| store.read_preferences(now))
    }

    pub fn save_preferences(&self, value: &CapturePreferences) -> Result<(), Error> {
        let observation = self.observation_lease();
        self.with_store(|store, now| {
            store.save_preferences(value, now, &|| observation.is_current())
        })
    }
    pub fn new(backend: Arc<dyn CaptureBackend>) -> Result<Self, Error> {
        Self::construct(backend, false)
    }

    /// Product runtime: no capture/read is admitted before a native account
    /// lease is installed. Legacy isolated QA can still use new().
    pub fn new_account_bound(backend: Arc<dyn CaptureBackend>) -> Result<Self, Error> {
        Self::construct(backend, true)
    }

    /// Native-only integration. Construction creates no reader process or DB;
    /// only a successfully admitted v3 capture can enqueue an optional lookup.
    pub fn new_account_bound_with_activity_resolver(
        backend: Arc<dyn CaptureBackend>,
        resolver: Arc<dyn crate::activity_reader::ActivityResolver>,
    ) -> Result<Self, Error> {
        Self::construct_with_resolver(backend, true, Some(resolver))
    }
    /// Isolated native QA; production uses the account-bound constructor.
    pub fn new_with_activity_resolver(
        backend: Arc<dyn CaptureBackend>,
        resolver: Arc<dyn crate::activity_reader::ActivityResolver>,
    ) -> Result<Self, Error> {
        Self::construct_with_resolver(backend, false, Some(resolver))
    }

    fn construct(backend: Arc<dyn CaptureBackend>, account_required: bool) -> Result<Self, Error> {
        Self::construct_with_resolver(backend, account_required, None)
    }
    fn construct_with_resolver(
        backend: Arc<dyn CaptureBackend>,
        account_required: bool,
        resolver: Option<Arc<dyn crate::activity_reader::ActivityResolver>>,
    ) -> Result<Self, Error> {
        let shared = Arc::new(SharedState {
            state: Mutex::new(State {
                store: None,
                policy: CapturePolicy::default(),
                global_exclusions: Some(BTreeSet::new()),
                epoch: 0,
                pending: None,
                active: None,
                closed: false,
                status: CaptureStatus::default(),
                account_required,
                account: None,
                binding_enabled: resolver.is_some(),
                bindings: VecDeque::new(),
                binding_active: None,
            }),
            wake: WorkerWake::default(),
            fence: Arc::new(AtomicU64::new(0)),
            stopping: Arc::new(AtomicBool::new(false)),
            binding_wake: WorkerWake::default(),
        });
        let worker_shared = Arc::clone(&shared);
        let worker = thread::Builder::new()
            .name("drifty-screen-context".into())
            .spawn(move || run(worker_shared, backend))
            .map_err(|_| Error::WorkerUnavailable)?;
        let activity_reader = resolver.clone();
        let binding_worker = if let Some(resolver) = resolver {
            let binding_shared = Arc::clone(&shared);
            match thread::Builder::new()
                .name("drifty-screen-link".into())
                .spawn(move || binding::run(binding_shared, resolver))
            {
                Ok(worker) => Some(worker),
                Err(_) => {
                    shared.stopping.store(true, Ordering::Release);
                    shared.wake.notify_all();
                    let _ = worker.join();
                    return Err(Error::WorkerUnavailable);
                }
            }
        } else {
            None
        };
        Ok(Self {
            shared,
            worker: Some(worker),
            binding_worker,
            activity_reader,
        })
    }

    /// Revocation is checked independently of the storage/policy fence, so a
    /// late policy mutation cannot revive a revoked or expired account. A
    /// different account drops the old store before it becomes readable.
    pub fn bind_account_lease(&self, lease: AccountReadLease) -> Result<(), Error> {
        begin_change(&self.shared);
        let mut state = lock(&self.shared);
        invalidate(&mut state, &self.shared);
        state.account_required = true;
        state.account = None;
        if state.closed || !lease.is_current() {
            state.store = None;
            state.policy = CapturePolicy::default();
            return Err(Error::Invalidated);
        }
        if state
            .store
            .as_ref()
            .is_some_and(|store| store.scope() != lease.scope())
        {
            state.store = None;
            state.policy = CapturePolicy::default();
            state.status = CaptureStatus::default();
        }
        state.account = Some(lease);
        Ok(())
    }

    pub fn set_policy(&self, mut policy: CapturePolicy) -> Result<(), Error> {
        let valid = policy.validate();
        begin_change(&self.shared);
        let mut state = lock(&self.shared);
        if state.closed || self.shared.stopping.load(Ordering::Acquire) {
            return Err(Error::Invalidated);
        }
        invalidate(&mut state, &self.shared);
        state.status.last_accepted_at_ms = None;
        if valid.is_err() {
            state.policy = CapturePolicy::default();
            return valid;
        }
        // A failed durable write must leave this process stopped, rather than
        // retaining an earlier active policy behind a newly current fence.
        state.policy = CapturePolicy::default();
        if let Some(store) = state.store.as_mut() {
            if !policy.enabled || policy.paused {
                store.pause_capture()?;
            }
            policy.paused |= store.capture_paused();
        }
        state.policy = policy;
        Ok(())
    }

    /// Native tracker rules are independent of user capture choices. None
    /// closes both capture and evidence reads until trusted rules are restored.
    /// The caller invalidates immediately before starting an exclusion mutation.
    pub fn set_global_exclusions(&self, excluded: Option<BTreeSet<String>>) -> Result<bool, Error> {
        let valid = excluded.as_ref().is_none_or(|apps| {
            apps.len() <= 1024 && apps.iter().all(|app| !app.is_empty() && app.len() <= 256)
        });
        let excluded = if valid { excluded } else { None };
        if valid {
            if let Ok(state) = self.shared.state.try_lock() {
                if !state.closed
                    && !self.shared.stopping.load(Ordering::Acquire)
                    && state.global_exclusions == excluded
                    && state.epoch == self.shared.fence.load(Ordering::Acquire)
                {
                    return Ok(false);
                }
            }
        }
        begin_change(&self.shared);
        let mut state = lock(&self.shared);
        if state.closed || self.shared.stopping.load(Ordering::Acquire) {
            return Err(Error::Invalidated);
        }
        let changed_existing =
            state.global_exclusions.is_some() && state.global_exclusions != excluded;
        invalidate(&mut state, &self.shared);
        if state.global_exclusions != excluded {
            state.global_exclusions = None;
            if let Some(store) = state.store.as_mut() {
                store.invalidate_cursors()?;
            }
        }
        state.global_exclusions = excluded;
        if valid {
            Ok(changed_existing)
        } else {
            Err(Error::Invalid("global exclusions"))
        }
    }

    /// Explicit resume after a user pause/deletion. Reapplying a saved enabled
    /// policy cannot clear a durable pause left by deletion or a clock failure.
    pub fn resume_capture(&self) -> Result<(), Error> {
        begin_change(&self.shared);
        let mut state = lock(&self.shared);
        if state.closed || self.shared.stopping.load(Ordering::Acquire) || !authorized(&state) {
            return Err(Error::Invalidated);
        }
        invalidate(&mut state, &self.shared);
        state.policy.paused = true;
        state
            .store
            .as_mut()
            .ok_or(Error::Invalidated)?
            .resume_capture(unix_millis()?)?;
        state.policy.paused = false;
        Ok(())
    }

    /// Called for account/profile replacement and sign-out, even if the new
    /// profile happens to use the same displayed identity. Old jobs cannot bind.
    pub fn replace_store(&self, store: Option<EvidenceStore>) -> Result<(), Error> {
        begin_change(&self.shared);
        let mut state = lock(&self.shared);
        if state.closed || self.shared.stopping.load(Ordering::Acquire) {
            return Err(Error::Invalidated);
        }
        invalidate(&mut state, &self.shared);
        if store.as_ref().is_some_and(|store| {
            state
                .account
                .as_ref()
                .is_some_and(|lease| lease.scope() != store.scope())
                || !authorized(&state)
        }) {
            return Err(Error::Invalidated);
        }
        state.store = store;
        state.policy = CapturePolicy::default();
        state.status = CaptureStatus::default();
        self.shared.wake.notify_one();
        Ok(())
    }

    pub fn request_sample(&self) -> bool {
        let mut state = lock(&self.shared);
        if state.closed
            || self.shared.stopping.load(Ordering::Acquire)
            || state.epoch != self.shared.fence.load(Ordering::Acquire)
            || !state.policy.active()
            || state.global_exclusions.is_none()
            || !authorized(&state)
            || state.store.is_none()
        {
            return false;
        }
        let epoch = state.epoch;
        if state.pending.replace(epoch).is_some() {
            state.status.replaced = state.status.replaced.saturating_add(1);
        }
        self.shared.wake.notify_one();
        true
    }

    pub fn status(&self) -> CaptureStatus {
        let state = lock(&self.shared);
        CaptureStatus {
            enabled: state.policy.enabled && state.global_exclusions.is_some(),
            paused: state.policy.paused,
            running: state.active.is_some(),
            pending: state.pending.is_some(),
            ..state.status.clone()
        }
    }

    /// Native focus/permission/session notifications invalidate ABA transitions
    /// even when the final permission boolean or document name is unchanged.
    /// Publish cancellation without waiting for storage. A native account
    /// controller follows this with store/policy replacement after its I/O lock
    /// becomes available. No new request is admitted while epochs differ.
    pub fn invalidate_observations_now(&self) {
        begin_change(&self.shared);
    }

    pub fn invalidate_observations(&self) {
        begin_change(&self.shared);
        invalidate(&mut lock(&self.shared), &self.shared);
        self.shared.wake.notify_all();
    }

    pub fn list_page(
        &self,
        cursor: Option<PageCursor>,
        limit: usize,
    ) -> Result<EvidencePage, Error> {
        self.with_store_policy(|store, now, policy| {
            let policy = policy.ok_or(Error::Invalidated)?;
            store.list_page_excluding(cursor, limit, now, &policy.excluded_apps)
        })
    }
    pub fn read_metadata(&self, id: Uuid) -> Result<Option<EvidenceMetadata>, Error> {
        self.with_store_policy(|store, now, policy| {
            let policy = policy.ok_or(Error::Invalidated)?;
            Ok(store
                .read_metadata(id, now)?
                .filter(|metadata| !policy.excluded_apps.contains(&metadata.surface.app_id)))
        })
    }
    pub fn read_frame(&self, id: Uuid) -> Result<Option<Frame>, Error> {
        self.with_store_policy(|store, now, policy| {
            let policy = policy.ok_or(Error::Invalidated)?;
            if store
                .read_metadata(id, now)?
                .is_none_or(|metadata| policy.excluded_apps.contains(&metadata.surface.app_id))
            {
                return Ok(None);
            }
            store.read_frame(id, now)
        })
    }

    /// One screen's deletion invalidates in-flight work but keeps capture running.
    pub fn delete_record(&self, id: Uuid) -> Result<Removal, Error> {
        begin_change(&self.shared);
        let mut state = lock(&self.shared);
        invalidate(&mut state, &self.shared);
        if !authorized(&state) {
            return Err(Error::Invalidated);
        }
        state
            .store
            .as_mut()
            .ok_or(Error::Invalidated)?
            .delete_record(id, unix_millis()?)
    }
    fn with_store<T>(
        &self,
        read: impl FnOnce(&mut EvidenceStore, i64) -> Result<T, Error>,
    ) -> Result<T, Error> {
        self.with_store_policy(|store, now, _| read(store, now))
    }
    fn with_store_policy<T>(
        &self,
        read: impl FnOnce(&mut EvidenceStore, i64, Option<&CapturePolicy>) -> Result<T, Error>,
    ) -> Result<T, Error> {
        let mut state = lock(&self.shared);
        let epoch = state.epoch;
        if !authorized(&state) {
            return Err(Error::Invalidated);
        }
        let account = state.account.clone();
        let current = || {
            !self.shared.stopping.load(Ordering::Acquire)
                && epoch == self.shared.fence.load(Ordering::Acquire)
                && account.as_ref().is_none_or(|lease| lease.is_current())
        };
        if !current() {
            return Err(Error::Invalidated);
        }
        let policy = effective_policy(&state);
        let result = read(
            state.store.as_mut().ok_or(Error::Invalidated)?,
            unix_millis()?,
            policy.as_ref(),
        );
        if !current() {
            return Err(Error::Invalidated);
        }
        result
    }
    pub fn preview_deletion(&self, start_ms: Option<i64>, end_ms: Option<i64>) -> Result<crate::store::DeletionPreview, Error> {
        self.with_store(|store, _| store.preview_deletion(start_ms, end_ms))
    }

    pub fn delete_range(&self, start_ms: i64, end_ms: i64) -> Result<Removal, Error> {
        if start_ms < 0 || end_ms <= start_ms {
            return Err(Error::Invalid("delete range"));
        }
        begin_change(&self.shared);
        let mut state = lock(&self.shared);
        invalidate(&mut state, &self.shared);
        if !authorized(&state) {
            return Err(Error::Invalidated);
        }
        state.policy.paused = true;
        state
            .store
            .as_mut()
            .ok_or(Error::Invalidated)?
            .delete_range(start_ms, end_ms)
    }
    pub fn purge(&self) -> Result<Removal, Error> {
        begin_change(&self.shared);
        let mut state = lock(&self.shared);
        invalidate(&mut state, &self.shared);
        if !authorized(&state) {
            return Err(Error::Invalidated);
        }
        state.policy.paused = true;
        state.store.as_mut().ok_or(Error::Invalidated)?.purge()
    }
    pub fn stop_now(&self) {
        // This path must not wait for a filesystem stalled inside the worker.
        // The worker observes this fence before publishing any late result.
        self.shared.stopping.store(true, Ordering::Release);
        begin_change(&self.shared);
        if let Ok(mut state) = self.shared.state.try_lock() {
            invalidate(&mut state, &self.shared);
            state.closed = true;
            state.policy.enabled = false;
        }
        self.shared.wake.notify_all();
    }

    pub fn worker_stopped(&self) -> bool {
        self.worker
            .as_ref()
            .is_none_or(|worker| worker.is_finished())
            && self
                .binding_worker
                .as_ref()
                .is_none_or(|worker| worker.is_finished())
    }

    pub fn close(&mut self) {
        self.stop_now();
        if self
            .worker
            .as_ref()
            .is_some_and(|worker| worker.is_finished())
        {
            if let Some(worker) = self.worker.take() {
                let _ = worker.join();
            }
        }
        if self
            .binding_worker
            .as_ref()
            .is_some_and(|worker| worker.is_finished())
        {
            if let Some(worker) = self.binding_worker.take() {
                let _ = worker.join();
            }
        }
    }

    pub fn shutdown(&mut self, budget: Duration) -> bool {
        self.close();
        let deadline = Instant::now() + budget.min(CAPTURE_DEADLINE + Duration::from_millis(100));
        while !self.worker_stopped() {
            if Instant::now() >= deadline {
                return false;
            }
            thread::sleep(Duration::from_millis(2));
        }
        let captured = self
            .worker
            .take()
            .is_none_or(|worker| worker.join().is_ok());
        let linked = self
            .binding_worker
            .take()
            .is_none_or(|worker| worker.join().is_ok());
        captured && linked
    }
}
impl Drop for ScreenContextService {
    fn drop(&mut self) {
        self.close();
    }
}

fn prepare_between_jobs(shared: &Shared, backend: &dyn CaptureBackend) {
    if !backend.needs_idle_preparation() {
        return;
    }
    let (policy, cancellation) = {
        let mut state = lock(shared);
        if state.closed
            || shared.stopping.load(Ordering::Acquire)
            || state.pending.is_some()
            || state.epoch != shared.fence.load(Ordering::Acquire)
            || !state.policy.active()
            || !authorized(&state)
            || state.store.is_none()
        {
            return;
        }
        let Some(policy) = effective_policy(&state) else {
            return;
        };
        let flag = Arc::new(AtomicBool::new(false));
        state.active = Some(Arc::clone(&flag));
        state.status.preparing = true;
        let cancellation = Cancellation {
            flag,
            fence: Arc::clone(&shared.fence),
            expected_epoch: state.epoch,
            stopping: Arc::clone(&shared.stopping),
            deadline: Instant::now() + PREPARATION_DEADLINE,
            account: state.account.clone(),
        };
        (policy, cancellation)
    };
    // No store/state lock is held while a fresh, empty helper initializes.
    // This sends neither JOB nor GO and cannot reuse facts from the last frame.
    let prepared = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        backend.prepare(&policy, &cancellation)
    }))
    .unwrap_or(Err(CaptureFailure::Unavailable));
    if prepared.is_err() || cancellation.is_cancelled() {
        backend.reset();
    }
    let mut state = lock(shared);
    state.status.preparing = false;
    if state
        .active
        .as_ref()
        .is_some_and(|flag| Arc::ptr_eq(flag, &cancellation.flag))
    {
        state.active = None;
    }
    // A failed speculative preparation is not a failed capture. The next
    // requested job retains its original bounded preparation and capture path.
    shared.wake.notify_all();
}

fn run(shared: Shared, backend: Arc<dyn CaptureBackend>) {
    shared.wake.bind_current();
    let mut backend_epoch = None;
    loop {
        let (epoch, generation, policy, flag, account) = {
            let mut state = lock(&shared);
            while !state.closed
                && !shared.stopping.load(Ordering::Acquire)
                && state.pending.is_none()
            {
                let current = shared.fence.load(Ordering::Acquire);
                if backend_epoch != Some(current) {
                    drop(state);
                    backend.reset();
                    backend_epoch = Some(current);
                    state = lock(&shared);
                    continue;
                }
                if let Some(expiry) = state
                    .store
                    .as_ref()
                    .and_then(|store| store.next_expiry_ms())
                {
                    let now = unix_millis().unwrap_or(0);
                    let wait = Duration::from_millis(expiry.saturating_sub(now).max(1) as u64);
                    let deadline = Instant::now() + wait;
                    drop(state);
                    thread::park_timeout(wait);
                    state = lock(&shared);
                    if Instant::now() >= deadline {
                        if let Some(store) = state.store.as_mut() {
                            if unix_millis()
                                .and_then(|now| store.maintenance(now))
                                .is_err()
                            {
                                state.status.last_failure = Some(CaptureFailure::Storage);
                                // Failed disk cleanup must not become a busy loop.
                                drop(state);
                                thread::park_timeout(Duration::from_secs(1));
                                state = lock(&shared);
                            }
                        }
                    }
                } else {
                    drop(state);
                    thread::park();
                    state = lock(&shared);
                }
            }
            if state.closed || shared.stopping.load(Ordering::Acquire) {
                state.store = None;
                drop(state);
                backend.reset();
                return;
            }
            let epoch = state.pending.take().expect("pending request");
            if epoch != state.epoch
                || epoch != shared.fence.load(Ordering::Acquire)
                || !state.policy.active()
                || state.global_exclusions.is_none()
                || !authorized(&state)
            {
                continue;
            }
            let Some(store) = state.store.as_mut() else {
                continue;
            };
            if unix_millis()
                .and_then(|now| store.maintenance(now))
                .is_err()
            {
                state.status.dropped = state.status.dropped.saturating_add(1);
                state.status.last_failure = Some(CaptureFailure::Storage);
                continue;
            }
            let generation = store.generation();
            let flag = Arc::new(AtomicBool::new(false));
            state.active = Some(Arc::clone(&flag));
            state.status.preparing = true;
            (
                epoch,
                generation,
                effective_policy(&state).expect("trusted exclusions checked"),
                flag,
                state.account.clone(),
            )
        };
        if backend_epoch != Some(epoch) {
            backend.reset();
            backend_epoch = Some(epoch);
        }
        let preparation = Cancellation {
            flag: Arc::clone(&flag),
            fence: Arc::clone(&shared.fence),
            expected_epoch: epoch,
            stopping: Arc::clone(&shared.stopping),
            deadline: Instant::now() + PREPARATION_DEADLINE,
            account: account.clone(),
        };
        let prepared = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            backend.prepare(&policy, &preparation)
        }))
        .unwrap_or(Err(CaptureFailure::Unavailable));
        if prepared.is_err() {
            backend.reset();
        }
        lock(&shared).status.preparing = false;
        let cancellation = Cancellation {
            flag,
            fence: Arc::clone(&shared.fence),
            expected_epoch: epoch,
            stopping: Arc::clone(&shared.stopping),
            deadline: Instant::now() + CAPTURE_DEADLINE,
            account,
        };
        let started_ms = unix_millis();
        let result = prepared.and_then(|()| {
            if Instant::now() >= preparation.deadline() {
                return Err(CaptureFailure::Deadline);
            }
            if preparation.is_cancelled() || cancellation.is_cancelled() {
                return Err(CaptureFailure::Cancelled);
            }
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                backend.capture(&policy, &cancellation)
            }))
            .unwrap_or(Err(CaptureFailure::Unavailable))
        });
        let mut state = lock(&shared);
        let ended_ms = unix_millis();
        state.active = None;
        let result = if Instant::now() >= cancellation.deadline() {
            Err(CaptureFailure::Deadline)
        } else if cancellation.is_cancelled() {
            Err(CaptureFailure::Cancelled)
        } else if state.closed
            || state.epoch != epoch
            || effective_policy(&state).as_ref() != Some(&policy)
        {
            Err(CaptureFailure::Invalidated)
        } else {
            result
        };
        let result = result.and_then(|capture| {
            let (start, end) = (
                started_ms
                    .as_ref()
                    .map_err(|_| CaptureFailure::Invalidated)?,
                ended_ms.as_ref().map_err(|_| CaptureFailure::Invalidated)?,
            );
            if capture.before != capture.after
                || !policy.admits(&capture.before)
                || !policy.admits(&capture.after)
                || capture.observed_at_ms < *start
                || capture.observed_at_ms > *end
                || end < start
                || !policy.permits_text(&capture.text)
            {
                return Err(CaptureFailure::Invalidated);
            }
            if !policy.replay_enabled && capture.text.state() != TextState::Recognized {
                return Err(match capture.text.state() {
                    TextState::Deadline => CaptureFailure::TextDeadline,
                    TextState::Unavailable => CaptureFailure::TextUnavailable,
                    _ => CaptureFailure::NoText,
                });
            }
            let store = state.store.as_mut().ok_or(CaptureFailure::Invalidated)?;
            let hint = capture.activity_hint.clone().map(|title_digest| {
                crate::activity_reader::CapturedActivityHint {
                    app_key: capture.before.identity.app_id.clone(),
                    title_digest,
                    observed_at_ms: capture.observed_at_ms,
                }
            });
            store
                .append_if_current(
                    generation,
                    NewEvidence {
                        tracker_record_id: None,
                        surface: capture.before.identity,
                        observed_at_ms: capture.observed_at_ms,
                        text: capture.text,
                        frame: capture.frame,
                    },
                    policy.replay_enabled,
                    *end,
                    &|| !cancellation.is_cancelled(),
                )
                .map_err(|error| match error {
                    Error::Invalidated if Instant::now() >= cancellation.deadline() => {
                        CaptureFailure::Deadline
                    }
                    Error::Invalidated => CaptureFailure::Invalidated,
                    _ => CaptureFailure::Storage,
                })
                .map(|id| (id, hint))
        });
        let accepted = match result {
            Ok((id, hint)) => {
                state.status.accepted = state.status.accepted.saturating_add(1);
                state.status.last_failure = None;
                state.status.last_accepted_at_ms = ended_ms.ok();
                if state.binding_enabled {
                    if let Some(hint) = hint {
                        if let Some(pending) = binding::PendingBinding::new(
                            id,
                            hint,
                            generation,
                            epoch,
                            &shared,
                            cancellation.account.clone(),
                        ) {
                            binding::enqueue(&mut state, pending);
                            shared.binding_wake.notify_one();
                        }
                    }
                }
                true
            }
            Err(reason) => {
                state.status.dropped = state.status.dropped.saturating_add(1);
                state.status.last_failure = Some(reason);
                false
            }
        };
        drop(state);
        shared.wake.notify_all();
        if accepted {
            prepare_between_jobs(&shared, backend.as_ref());
        }
    }
}

#[cfg(test)]
mod fence_tests {
    use super::*;

    struct NoCapture;
    impl CaptureBackend for NoCapture {
        fn capture(
            &self,
            _: &CapturePolicy,
            _: &Cancellation,
        ) -> Result<NativeCapture, CaptureFailure> {
            panic!("default OFF must not capture")
        }
    }

    #[test]
    fn deletion_invalidates_an_already_decrypted_reply_before_serialization() {
        let temp = tempfile::tempdir().unwrap();
        let now = unix_millis().unwrap();
        let mut store = crate::tests::open(&temp.path().join("evidence"), now);
        let generation = store.generation();
        let id = store
            .append_if_current(generation, crate::tests::evidence(now), true, now, &|| true)
            .unwrap();
        let service = ScreenContextService::new(Arc::new(NoCapture)).unwrap();
        service.replace_store(Some(store)).unwrap();
        let boundary = service.observation_lease();
        let metadata = service.read_metadata(id).unwrap().unwrap();
        let response = boundary.reply(metadata).unwrap();
        service.purge().unwrap();
        assert!(serde_json::to_vec(&response).is_err());
        assert!(service.list_page(None, 20).unwrap().records.is_empty());
    }
    #[test]
    fn content_reply_cannot_outlive_record_expiry_or_extend_its_limit() {
        let service = ScreenContextService::new(Arc::new(NoCapture)).unwrap();
        let mut lease = service.observation_lease();
        let expiry = unix_millis().unwrap() + 10;
        lease.limit_until(expiry);
        lease.limit_until(expiry + 60_000);
        let response = lease.reply("OWNED_PRIVATE_TEXT").unwrap();
        let wait = Instant::now() + Duration::from_secs(1);
        while unix_millis().unwrap() < expiry {
            assert!(Instant::now() < wait);
            thread::sleep(Duration::from_millis(1));
        }
        assert!(serde_json::to_vec(&response).is_err());
    }

    #[test]
    fn cancellation_precedes_waiting_for_a_busy_store() {
        let service = Arc::new(ScreenContextService::new(Arc::new(NoCapture)).unwrap());
        let state = lock(&service.shared);
        let cancellation = Cancellation {
            flag: Arc::new(AtomicBool::new(false)),
            fence: Arc::clone(&service.shared.fence),
            expected_epoch: state.epoch,
            stopping: Arc::clone(&service.shared.stopping),
            deadline: Instant::now() + Duration::from_secs(2),
            account: None,
        };
        let other = Arc::clone(&service);
        let (sent, received) = std::sync::mpsc::sync_channel(1);
        let change = thread::spawn(move || {
            other.set_policy(CapturePolicy::default()).unwrap();
            sent.send(()).unwrap();
        });
        let deadline = Instant::now() + Duration::from_secs(1);
        while !cancellation.is_cancelled() {
            assert!(Instant::now() < deadline);
            thread::yield_now();
        }
        assert!(
            received.try_recv().is_err(),
            "OFF must not acknowledge before its storage barrier"
        );
        drop(state);
        received.recv_timeout(Duration::from_secs(1)).unwrap();
        change.join().unwrap();
    }

    #[test]
    fn shutdown_has_a_budget_even_when_the_store_lock_is_busy() {
        let mut service = ScreenContextService::new(Arc::new(NoCapture)).unwrap();
        let shared = Arc::clone(&service.shared);
        let (locked, receive) = std::sync::mpsc::sync_channel(1);
        let (release, released) = std::sync::mpsc::sync_channel(1);
        let holder = thread::spawn(move || {
            let _state = lock(&shared);
            locked.send(()).unwrap();
            released.recv_timeout(Duration::from_secs(2)).unwrap();
        });
        receive.recv_timeout(Duration::from_secs(1)).unwrap();
        let started = Instant::now();
        assert!(!service.shutdown(Duration::from_millis(50)));
        assert!(started.elapsed() < Duration::from_millis(500));
        release.send(()).unwrap();
        holder.join().unwrap();
        assert!(service.shutdown(Duration::from_secs(1)));
    }
}
