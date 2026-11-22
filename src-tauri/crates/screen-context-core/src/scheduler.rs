mod scene_ocr;
use crate::{
    lease::AccountReadLease,
    store::{EvidenceMetadata, EvidencePage, EvidenceStore, NewEvidence, PageCursor, Removal},
    CapturePreferences, CaptureScope, Error, Frame, SceneCaptureFacts, SurfaceFacts, TextEvidence,
    TextSource, TextState,
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
#[cfg(test)]
mod exclusion_refresh_tests;
#[cfg(test)]
mod site_gate_tests;
mod wake;
use wake::WorkerWake;
mod recovery;
use recovery::CaptureRecovery;
pub use recovery::CaptureRecoveryStatus;

/// A sensitive read also expires on deletion/policy/store changes, separately
/// from the account capability. Client generation checks cover queued IPC.
pub struct ObservationLease {
    fence: Arc<AtomicU64>,
    stopping: Arc<AtomicBool>,
    epoch: u64,
    issued_at_ms: i64,
    expires_at_ms: Option<i64>,
    invalidated: AtomicBool,
    expiry_clock: Option<crate::retention_clock::RetentionClock>,
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
                    && self.expires_at_ms.is_none_or(|expiry| {
                        self.expiry_clock
                            .as_ref()
                            .map_or(Ok(now), |clock| clock.now(now))
                            .is_ok_and(|effective| effective < expiry)
                    })
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
/// Window OCR in Electron apps needs a second second for Vision and repeated
/// native visibility guards. Cancellation and source revalidation still apply.
pub const OCR_CAPTURE_DEADLINE: Duration = Duration::from_secs(2);
/// Initial model preparation is separate from a warm capture. It cannot read
/// OS surfaces/pixels. Never count this budget as a one-second end-to-end pass.
pub const PREPARATION_DEADLINE: Duration = Duration::from_secs(5);
/// A changed screen of the same window (same process, window and title)
/// gets fresh text recognition at most this often. Every capture is still
/// stored for Replay; identical screens keep reusing their text.
pub const SAME_SURFACE_OCR_INTERVAL: Duration = Duration::from_secs(30);

#[derive(Clone, Default, PartialEq, Eq)]
pub struct CapturePolicy {
    pub scope: CaptureScope,
    pub enabled: bool,
    pub paused: bool,
    pub replay_enabled: bool,
    pub ocr_enabled: bool,
    pub visible_text_enabled: bool,
    pub allowed_apps: BTreeSet<String>,
    pub excluded_apps: BTreeSet<String>,
    /// Versioned site digests of chosen work sites. The service attaches its
    /// own trusted activity reader; callers cannot supply a resolver.
    pub work_sites: BTreeSet<String>,
    /// Browser windows are admitted only through this gate. None refuses them.
    /// Rebuilt by set_policy from work_sites; a caller's value is discarded.
    pub site_gate: Option<SiteGate>,
}

/// Work sites the person chose, as versioned site digests, plus the trusted
/// tracker reader that vouches for the current tab's site before any pixels.
#[derive(Clone)]
pub struct SiteGate {
    pub(crate) sites: BTreeSet<String>,
    pub(crate) resolver: Arc<dyn crate::activity_reader::ActivityResolver>,
}
impl PartialEq for SiteGate {
    fn eq(&self, other: &Self) -> bool {
        self.sites == other.sites && Arc::ptr_eq(&self.resolver, &other.resolver)
    }
}
impl Eq for SiteGate {}
impl SiteGate {
    /// The tracker samples every few seconds, so the current row may end
    /// slightly before now. Look back over one sample; the same app and exact
    /// window title must still match, and only a vouched site digest admits.
    fn admits(
        &self,
        app_key: &str,
        title: &crate::native::WindowTitleDigest,
        current: &dyn Fn() -> bool,
    ) -> bool {
        let Ok(now) = unix_millis() else { return false };
        for back in [0, 2_500, 5_000] {
            if !current() {
                return false;
            }
            let hint = crate::activity_reader::CapturedActivityHint {
                app_key: app_key.to_owned(),
                title_digest: title.clone(),
                observed_at_ms: now - back,
            };
            match self.resolver.resolve_capture(&hint, current) {
                Ok(Some(record)) => {
                    return record
                        .site_digest()
                        .is_some_and(|site| self.sites.contains(site));
                }
                Ok(None) => continue,
                Err(_) => return false,
            }
        }
        false
    }
}

impl CapturePolicy {
    fn validate(&self) -> Result<(), Error> {
        if self.work_sites.len() > 64
            || self.work_sites.iter().any(|d| {
                d.len() != 64
                    || !d
                        .bytes()
                        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            })
        {
            return Err(Error::Invalid("capture policy"));
        }
        if (self.scope == CaptureScope::ActiveDisplayScene
            && (!self.allowed_apps.is_empty() || self.visible_text_enabled))
            || self.allowed_apps.len() > 256
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
            && (self.scope == CaptureScope::ActiveDisplayScene || !self.allowed_apps.is_empty())
    }
    pub fn admits(&self, facts: &SurfaceFacts) -> bool {
        self.scope == CaptureScope::SelectedApps
            && self.active()
            && facts.admissible(&self.allowed_apps, &self.excluded_apps)
    }
    pub fn admits_scene(&self, facts: &SceneCaptureFacts) -> bool {
        self.scope == CaptureScope::ActiveDisplayScene
            && self.active()
            && facts.admissible(&self.excluded_apps)
    }
    /// Post-capture admission: ordinary surfaces, or a browser surface whose
    /// backend already passed the site gate before and after capture.
    pub(crate) fn admits_capture(&self, facts: &SurfaceFacts, site_admitted: bool) -> bool {
        self.admits(facts)
            || (site_admitted
                && facts.privacy == crate::Privacy::Browser
                && self.site_gate.is_some()
                && self.active()
                && facts.admissible_surface(&self.allowed_apps, &self.excluded_apps))
    }
    /// A browser surface needs a current tracker row on a chosen work site.
    pub(crate) fn admits_browser(
        &self,
        facts: &SurfaceFacts,
        title: Option<&crate::native::WindowTitleDigest>,
        current: &dyn Fn() -> bool,
    ) -> bool {
        facts.privacy == crate::Privacy::Browser
            && self.active()
            && facts.admissible_surface(&self.allowed_apps, &self.excluded_apps)
            && match (&self.site_gate, title) {
                (Some(gate), Some(title)) => gate.admits(&facts.identity.app_id, title, current),
                _ => false,
            }
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
        self.is_invalidated() || Instant::now() >= self.deadline
    }
    fn is_invalidated(&self) -> bool {
        self.flag.load(Ordering::Acquire)
            || self.stopping.load(Ordering::Acquire)
            || self.fence.load(Ordering::Acquire) != self.expected_epoch
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
    AccessibilityPermission,
    CaptureService,
    CaptureDeclined,
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
    /// True only when a backend admitted this browser surface through the
    /// policy's site gate both before pixels and again after capture.
    pub site_admitted: bool,
}

pub struct NativeSceneCapture {
    pub before: SceneCaptureFacts,
    pub after: SceneCaptureFacts,
    pub observed_at_ms: i64,
    pub text: TextEvidence,
    pub frame: Frame,
    pub activity_hint: Option<crate::native::WindowTitleDigest>,
}
enum CapturedEvidence {
    Document(Box<NativeCapture>),
    Scene(Box<NativeSceneCapture>),
}

/// The fixed OS adapter must obtain its own facts and apply `policy.admits`
/// BEFORE asking the OS for pixels. It must kill/reap its owned helper by the
/// cancellation/deadline. These facts must never be supplied by a WebView.
pub trait CaptureBackend: Send + Sync + 'static {
    /// Read the native capture permissions without asking for access,
    /// enumerating windows or starting a capture.
    fn check_capture_permissions(&self, _cancel: &Cancellation) -> Result<(), CaptureFailure> {
        Err(CaptureFailure::Unavailable)
    }
    /// Explicit adapter capability. No fallback to the document protocol.
    fn supports_scene_capture(&self) -> bool {
        false
    }
    /// Same-image OCR after the accepted image is stored. This never extends
    /// the capture deadline or grants permission to an analysis recipient.
    fn supports_deferred_scene_ocr(&self) -> bool {
        false
    }
    /// Prepare optional image-only OCR after storage and a reuse miss. No
    /// pixels are sent during preparation; it has its own cancellation budget.
    fn prepare_scene_ocr(
        &self,
        _policy: &CapturePolicy,
        _cancellation: &Cancellation,
    ) -> Result<(), CaptureFailure> {
        Ok(())
    }
    fn recognize_scene(
        &self,
        _frame: &Frame,
        _region: crate::SceneRegion,
        _cancellation: &Cancellation,
    ) -> Result<TextEvidence, CaptureFailure> {
        Err(CaptureFailure::Unsupported)
    }

    fn capture_scene(
        &self,
        _policy: &CapturePolicy,
        _cancellation: &Cancellation,
    ) -> Result<NativeSceneCapture, CaptureFailure> {
        Err(CaptureFailure::Unsupported)
    }

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
    pub recovery: Option<CaptureRecoveryStatus>,
    pub last_accepted_at_ms: Option<i64>,
}

struct State {
    store: Option<EvidenceStore>,
    policy: CapturePolicy,
    global_exclusions: Option<BTreeSet<String>>,
    epoch: u64,
    pending: Option<u64>,
    capture_suspended: bool,
    recovery: Option<CaptureRecovery>,
    capture_epoch: u64,
    active: Option<Arc<AtomicBool>>,
    deferred_active: Option<Arc<AtomicBool>>,
    // A same-epoch hint only; text and pixels remain in authenticated storage.
    previous_scene_ocr: Option<(u64, Uuid)>,
    // The surface and monotonic time of this epoch's last fresh recognition.
    last_fresh_scene_ocr: Option<(u64, scene_ocr::Surface, Instant)>,
    same_surface_ocr_interval: Duration,
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
    // Published only after a trusted-rule update crosses its storage barrier.
    // This tiny lock never covers I/O, so an equal refresh need not contend
    // with memory reads just to discover that no policy changed.
    exclusion_revision: Mutex<Option<ExclusionRevision>>,
    expiry_clock: Mutex<Option<crate::retention_clock::RetentionClock>>,
    wake: WorkerWake,
    fence: Arc<AtomicU64>,
    stopping: Arc<AtomicBool>,
    binding_wake: WorkerWake,
}
struct ExclusionRevision {
    epoch: u64,
    rules: Option<BTreeSet<String>>,
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
    state.previous_scene_ocr = None;
    state.last_fresh_scene_ocr = None;
    state.bindings.clear();
    if let Some(cancel) = state.deferred_active.take() {
        cancel.store(true, Ordering::Release);
    }
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
        let clock = self.shared.expiry_clock.lock();
        let invalid = clock.is_err();
        let expiry_clock = clock.ok().and_then(|value| value.clone());
        ObservationLease {
            fence: Arc::clone(&self.shared.fence),
            stopping: Arc::clone(&self.shared.stopping),
            epoch: self.shared.fence.load(Ordering::Acquire),
            issued_at_ms: unix_millis().unwrap_or(-1),
            expires_at_ms: None,
            invalidated: AtomicBool::new(invalid),
            expiry_clock,
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
                capture_suspended: false,
                recovery: None,
                capture_epoch: 0,
                active: None,
                deferred_active: None,
                previous_scene_ocr: None,
                last_fresh_scene_ocr: None,
                same_surface_ocr_interval: SAME_SURFACE_OCR_INTERVAL,
                closed: false,
                status: CaptureStatus::default(),
                account_required,
                account: None,
                binding_enabled: resolver.is_some(),
                bindings: VecDeque::new(),
                binding_active: None,
            }),
            exclusion_revision: Mutex::new(None),
            expiry_clock: Mutex::new(None),
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
            if let Some(recovery) = &mut state.recovery {
                *recovery = CaptureRecovery::default();
            }
        }
        state.account = Some(lease);
        Ok(())
    }

    pub fn set_policy(&self, mut policy: CapturePolicy) -> Result<(), Error> {
        let valid = policy.validate();
        policy.site_gate = if policy.work_sites.is_empty() {
            None
        } else {
            self.activity_reader.clone().map(|resolver| SiteGate {
                sites: policy.work_sites.clone(),
                resolver,
            })
        };
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
            if let Ok(revision) = self.shared.exclusion_revision.lock() {
                if let Some(revision) = revision.as_ref() {
                    if !self.shared.stopping.load(Ordering::Acquire)
                        && revision.rules == excluded
                        && revision.epoch == self.shared.fence.load(Ordering::Acquire)
                    {
                        return Ok(false);
                    }
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
        // A concurrent invalidation can advance the fence while storage is
        // locked. Publish the reconciled state epoch, never the newer fence:
        // the next equal refresh must still finish that invalidation.
        if let Ok(mut revision) = self.shared.exclusion_revision.lock() {
            *revision = Some(ExclusionRevision {
                epoch: state.epoch,
                rules: state.global_exclusions.clone(),
            });
        }
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
        if let Some(recovery) = &mut state.recovery {
            *recovery = CaptureRecovery::default();
        }
        state.status.last_failure = None;
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
        *self
            .shared
            .expiry_clock
            .lock()
            .map_err(|_| Error::WorkerUnavailable)? =
            store.as_ref().and_then(|store| store.expiry_clock.clone());
        state.store = store;
        state.policy = CapturePolicy::default();
        state.status = CaptureStatus::default();
        if let Some(recovery) = &mut state.recovery {
            *recovery = CaptureRecovery::default();
        }
        self.shared.wake.notify_one();
        Ok(())
    }

    /// Override how often a changed screen of the same window is recognized
    /// again. Protocol tests use zero to exchange every changed image.
    pub fn set_same_surface_ocr_interval(&self, interval: Duration) {
        lock(&self.shared).same_surface_ocr_interval = interval;
    }

    /// Native input inactivity suspends only new capture. Cancel active/queued
    /// work and recycle its helper without revoking already stored evidence.
    /// Explicit pause, permissions, account and policy changes still use the
    /// observation fence. The active flag remains cancelled across idle ABA.
    pub fn set_capture_suspended(&self, suspended: bool) -> Result<(), Error> {
        let mut state = lock(&self.shared);
        if state.closed || self.shared.stopping.load(Ordering::Acquire) {
            return Err(Error::Invalidated);
        }
        if state.capture_suspended == suspended {
            return Ok(());
        }
        let Some(epoch) = state.capture_epoch.checked_add(1) else {
            self.shared.stopping.store(true, Ordering::Release);
            self.shared.wake.notify_all();
            self.shared.binding_wake.notify_all();
            return Err(Error::Invalidated);
        };
        state.capture_suspended = suspended;
        state.capture_epoch = epoch;
        state.pending = None;
        if let Some(cancel) = &state.active {
            cancel.store(true, Ordering::Release);
        }
        self.shared.wake.notify_all();
        Ok(())
    }

    pub fn enable_capture_recovery(&self) {
        lock(&self.shared)
            .recovery
            .get_or_insert_with(CaptureRecovery::default);
    }

    pub fn request_sample(&self) -> bool {
        let mut state = lock(&self.shared);
        if state.closed
            || state.capture_suspended
            || state
                .recovery
                .as_ref()
                .is_some_and(|recovery| !recovery.allows_request(Instant::now()))
            || self.shared.stopping.load(Ordering::Acquire)
            || state.epoch != self.shared.fence.load(Ordering::Acquire)
            || !state.policy.active()
            || state.global_exclusions.is_none()
            || !authorized(&state)
            || state.store.is_none()
        {
            return false;
        }
        if let Some(cancel) = &state.deferred_active {
            cancel.store(true, Ordering::Release);
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
            paused: state.policy.paused
                || state
                    .store
                    .as_ref()
                    .is_some_and(|store| store.capture_paused()),
            running: state.active.is_some(),
            pending: state.pending.is_some(),
            recovery: state.recovery.as_ref().and_then(CaptureRecovery::status),
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
                .filter(|metadata| !metadata.surface.is_excluded(&policy.excluded_apps)))
        })
    }
    pub fn read_frame(&self, id: Uuid) -> Result<Option<Frame>, Error> {
        self.with_store_policy(|store, now, policy| {
            let policy = policy.ok_or(Error::Invalidated)?;
            if store
                .read_metadata(id, now)?
                .is_none_or(|metadata| metadata.surface.is_excluded(&policy.excluded_apps))
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
    pub fn preview_deletion(
        &self,
        start_ms: Option<i64>,
        end_ms: Option<i64>,
    ) -> Result<crate::store::DeletionPreview, Error> {
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
            || state.capture_suspended
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
        if policy.scope == CaptureScope::ActiveDisplayScene && !backend.supports_scene_capture() {
            Err(CaptureFailure::Unsupported)
        } else {
            backend.prepare(&policy, &cancellation)
        }
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
        let (epoch, capture_epoch, generation, policy, flag, account, permission_check) = {
            let mut state = lock(&shared);
            while !state.closed
                && !shared.stopping.load(Ordering::Acquire)
                && state.pending.is_none()
            {
                let current = (shared.fence.load(Ordering::Acquire), state.capture_epoch);
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
                    let effective = state
                        .store
                        .as_ref()
                        .and_then(|store| store.expiry_now(now).ok())
                        .unwrap_or(expiry);
                    // A wall correction or sleep must not defer physical cleanup
                    // for the old wall-clock wait. Recheck at most every minute.
                    let wait =
                        Duration::from_millis(expiry.saturating_sub(effective).max(1) as u64)
                            .min(Duration::from_secs(60));
                    drop(state);
                    thread::park_timeout(wait);
                    state = lock(&shared);
                    {
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
                || state.capture_suspended
                || state
                    .recovery
                    .as_ref()
                    .is_some_and(|recovery| !recovery.allows_request(Instant::now()))
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
            let permission_check = state
                .recovery
                .as_ref()
                .is_some_and(CaptureRecovery::checking_permission);
            state.status.preparing = !permission_check;
            (
                epoch,
                state.capture_epoch,
                generation,
                effective_policy(&state).expect("trusted exclusions checked"),
                flag,
                state.account.clone(),
                permission_check,
            )
        };
        if backend_epoch != Some((epoch, capture_epoch)) {
            backend.reset();
            backend_epoch = Some((epoch, capture_epoch));
        }
        let preparation = Cancellation {
            flag: Arc::clone(&flag),
            fence: Arc::clone(&shared.fence),
            expected_epoch: epoch,
            stopping: Arc::clone(&shared.stopping),
            deadline: Instant::now() + PREPARATION_DEADLINE,
            account: account.clone(),
        };
        if permission_check {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                backend.check_capture_permissions(&preparation)
            }))
            .unwrap_or(Err(CaptureFailure::Unavailable));
            let mut state = lock(&shared);
            state.active = None;
            if !preparation.is_invalidated() && state.capture_epoch == capture_epoch {
                let now = Instant::now();
                let result = if now >= preparation.deadline() {
                    Err(CaptureFailure::Deadline)
                } else {
                    result
                };
                let recovery = state.recovery.as_mut().expect("permission check scheduled");
                recovery.observe_permission_check(now, result);
                if result.is_ok() {
                    state.status.last_failure = None;
                    // The worker picks this request up again through the normal
                    // admission and cancellation checks.
                    state.pending = Some(epoch);
                } else {
                    state.pending = None;
                }
            }
            continue;
        }
        let prepared = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            if policy.scope == CaptureScope::ActiveDisplayScene && !backend.supports_scene_capture()
            {
                Err(CaptureFailure::Unsupported)
            } else {
                backend.prepare(&policy, &preparation)
            }
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
            deadline: Instant::now()
                + if policy.ocr_enabled {
                    OCR_CAPTURE_DEADLINE
                } else {
                    CAPTURE_DEADLINE
                },
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
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| match policy.scope {
                CaptureScope::SelectedApps => backend
                    .capture(&policy, &cancellation)
                    .map(|capture| CapturedEvidence::Document(Box::new(capture))),
                CaptureScope::ActiveDisplayScene => backend
                    .capture_scene(&policy, &cancellation)
                    .map(|capture| CapturedEvidence::Scene(Box::new(capture))),
            }))
            .unwrap_or(Err(CaptureFailure::Unavailable))
        });
        let mut state = lock(&shared);
        let ended_ms = unix_millis();
        state.active = None;
        let invalidated = cancellation.is_invalidated()
            || state.capture_epoch != capture_epoch
            || state.closed
            || state.epoch != epoch
            || effective_policy(&state).as_ref() != Some(&policy);
        // A cancelled job may finish after its deadline and after a newer
        // request is queued. Only current jobs can change the retry budget.
        let now = Instant::now();
        let result = if invalidated {
            Err(CaptureFailure::Cancelled)
        } else if now >= cancellation.deadline() {
            Err(CaptureFailure::Deadline)
        } else {
            result
        };
        if !invalidated {
            if let Some(recovery) = &mut state.recovery {
                recovery.observe(now, result.as_ref().map(|_| ()).map_err(|reason| *reason));
                if !recovery.allows_request(now) {
                    state.pending = None;
                }
            }
        }
        let mut pending_scene_ocr = None;
        let result = result.and_then(|capture| {
            let (start, end) = (
                started_ms
                    .as_ref()
                    .map_err(|_| CaptureFailure::Invalidated)?,
                ended_ms.as_ref().map_err(|_| CaptureFailure::Invalidated)?,
            );
            let capture = match capture {
                CapturedEvidence::Document(capture) => *capture,
                CapturedEvidence::Scene(capture) => {
                    let capture = *capture;
                    let optional_ocr = policy.ocr_enabled
                        && backend.supports_deferred_scene_ocr()
                        && capture.text.state() == TextState::NotRequested;
                    // Missing a trustworthy OCR region must not discard an
                    // otherwise admitted Replay image or read browser chrome.
                    let deferred =
                        optional_ocr && capture.before.identity.foreground_region.is_some();
                    if capture.before != capture.after
                        || !policy.admits_scene(&capture.before)
                        || !policy.admits_scene(&capture.after)
                        || capture.observed_at_ms < *start
                        || capture.observed_at_ms > *end
                        || end < start
                        || (!optional_ocr && !policy.permits_text(&capture.text))
                    {
                        return Err(CaptureFailure::Invalidated);
                    }
                    if !deferred
                        && !policy.replay_enabled
                        && capture.text.state() != TextState::Recognized
                    {
                        return Err(match capture.text.state() {
                            TextState::Deadline => CaptureFailure::TextDeadline,
                            TextState::Unavailable => CaptureFailure::TextUnavailable,
                            _ => CaptureFailure::NoText,
                        });
                    }
                    let hint = capture.activity_hint.clone().map(|title_digest| {
                        crate::activity_reader::CapturedActivityHint {
                            app_key: capture.before.identity.foreground.app_id.clone(),
                            title_digest,
                            observed_at_ms: capture.observed_at_ms,
                        }
                    });
                    if deferred {
                        pending_scene_ocr = Some((
                            capture.frame.copy_for_processing(),
                            capture
                                .before
                                .identity
                                .foreground_region
                                .expect("checked region"),
                            scene_ocr::Surface::of(
                                &capture.before.identity.foreground,
                                capture.activity_hint.as_ref(),
                            ),
                        ));
                    }
                    let store = state.store.as_mut().ok_or(CaptureFailure::Invalidated)?;
                    return store
                        .append_scene_if_current(
                            generation,
                            capture.before.identity,
                            capture.observed_at_ms,
                            capture.text,
                            capture.frame,
                            policy.replay_enabled,
                            *end,
                            &|| !cancellation.is_cancelled(),
                        )
                        .map(|id| (id, hint))
                        .map_err(|error| match error {
                            Error::Invalidated if Instant::now() >= cancellation.deadline() => {
                                CaptureFailure::Deadline
                            }
                            Error::Invalidated => CaptureFailure::Invalidated,
                            _ => CaptureFailure::Storage,
                        });
                }
            };
            if capture.before != capture.after
                || !policy.admits_capture(&capture.before, capture.site_admitted)
                || !policy.admits_capture(&capture.after, capture.site_admitted)
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
        let mut accepted_id = None;
        let accepted = match result {
            Ok((id, hint)) => {
                accepted_id = Some(id);
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
        if let Some((id, (frame, region, surface))) = accepted_id.zip(pending_scene_ocr) {
            scene_ocr::process(
                &shared,
                backend.as_ref(),
                scene_ocr::Job {
                    id,
                    frame,
                    region,
                    surface,
                    generation,
                    epoch,
                    account: cancellation.account.clone(),
                },
            );
        }
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
    fn refreshing_identical_rules_during_a_store_read_keeps_the_visible_proof() {
        let service = ScreenContextService::new(Arc::new(NoCapture)).unwrap();
        let exclusions = Some(BTreeSet::from(["owned.editor".to_owned()]));
        service.set_global_exclusions(exclusions.clone()).unwrap();
        let lease = service.observation_lease();
        thread::scope(|scope| {
            let store = lock(&service.shared);
            let (started_tx, started_rx) = std::sync::mpsc::channel();
            let service_ref = &service;
            let refreshed = scope.spawn(move || {
                started_tx.send(()).unwrap();
                service_ref.set_global_exclusions(exclusions).unwrap()
            });
            started_rx.recv().unwrap();
            // Let the competing refresh run before releasing the store.
            let deadline = Instant::now() + Duration::from_millis(30);
            while lease.is_current() && Instant::now() < deadline {
                thread::sleep(Duration::from_millis(1));
            }
            drop(store);
            assert!(!refreshed.join().unwrap());
            assert!(lease.is_current());
        });
    }

    #[test]
    fn changed_rules_revoke_the_visible_proof_before_the_store_is_available() {
        let service = ScreenContextService::new(Arc::new(NoCapture)).unwrap();
        let lease = service.observation_lease();
        thread::scope(|scope| {
            let store = lock(&service.shared);
            let updated = scope.spawn(|| {
                service
                    .set_global_exclusions(Some(BTreeSet::from(["owned.editor".to_owned()])))
                    .unwrap()
            });
            let deadline = Instant::now() + Duration::from_secs(1);
            while lease.is_current() && Instant::now() < deadline {
                thread::sleep(Duration::from_millis(1));
            }
            let revoked_before_store_release = !lease.is_current();
            drop(store);
            assert!(updated.join().unwrap());
            assert!(revoked_before_store_release);
        });
    }

    #[test]
    fn idle_cancels_capture_without_revoking_authorized_review() {
        // Forward-port check of the 1.20.0 idle Replay fix (c3a2616d) against
        // main's capture-only suspension.
        let service = ScreenContextService::new(Arc::new(NoCapture)).unwrap();
        let review = service.observation_lease().reply("OWNED_SCREEN").unwrap();
        service.set_capture_suspended(true).unwrap();
        assert!(serde_json::to_vec(&review).is_ok());
        service.set_capture_suspended(false).unwrap();
        assert!(serde_json::to_vec(&review).is_ok());
        service
            .set_global_exclusions(Some(BTreeSet::from(["owned.editor".to_owned()])))
            .unwrap();
        assert!(serde_json::to_vec(&review).is_err());
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
    fn replay_reply_expires_on_elapsed_time_even_while_wall_expiry_is_in_the_future() {
        let temp = tempfile::tempdir().unwrap();
        let now = unix_millis().unwrap();
        let mut store = crate::tests::open(&temp.path().join("evidence"), now);
        let tick = Arc::new(AtomicU64::new(0));
        store.expiry_clock = Some(crate::retention_clock::RetentionClock::fixture(
            now,
            tick.clone(),
        ));
        let service = ScreenContextService::new(Arc::new(NoCapture)).unwrap();
        service.replace_store(Some(store)).unwrap();
        let mut lease = service.observation_lease();
        lease.limit_until(now + 60_000);
        let response = lease.reply("OWNED_PRIVATE_TEXT").unwrap();
        tick.store(60_000_000_000, Ordering::SeqCst);
        assert!(unix_millis().unwrap() < now + 60_000);
        assert!(serde_json::to_vec(&response).is_err());
        // A later correction cannot revive an already invalidated response.
        tick.store(0, Ordering::SeqCst);
        assert!(serde_json::to_vec(&response).is_err());
    }

    #[test]
    fn status_reports_a_store_pause_that_happened_after_policy_configuration() {
        let temp = tempfile::tempdir().unwrap();
        let now = unix_millis().unwrap();
        let store = crate::tests::open(&temp.path().join("evidence"), now);
        let service = ScreenContextService::new(Arc::new(NoCapture)).unwrap();
        service.replace_store(Some(store)).unwrap();
        service
            .set_policy(CapturePolicy {
                enabled: true,
                ..CapturePolicy::default()
            })
            .unwrap();
        assert!(!service.status().paused);
        lock(&service.shared)
            .store
            .as_mut()
            .unwrap()
            .pause_capture()
            .unwrap();
        assert!(service.status().paused);
    }

    #[test]
    fn idle_worker_cleans_elapsed_expiry_on_wake_without_a_content_read() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("evidence");
        let now = unix_millis().unwrap();
        let mut store = crate::tests::open(&root, now);
        let tick = Arc::new(AtomicU64::new(0));
        store.expiry_clock = Some(crate::retention_clock::RetentionClock::fixture(
            now,
            tick.clone(),
        ));
        store
            .append(store.generation(), crate::tests::evidence(now), true, now)
            .unwrap();
        let frames = || {
            std::fs::read_dir(&root)
                .unwrap()
                .filter_map(|entry| entry.ok().filter(|entry| entry.path().is_dir()))
                .flat_map(|entry| std::fs::read_dir(entry.path()).unwrap())
                .filter_map(Result::ok)
                .filter(|entry| entry.file_name().to_string_lossy().starts_with("frame-"))
                .count()
        };
        assert_eq!(frames(), 1);
        let service = ScreenContextService::new(Arc::new(NoCapture)).unwrap();
        service.replace_store(Some(store)).unwrap();
        // Model waking after a day; no read API is called to trigger expiry.
        tick.store(86_400_000_000_000, Ordering::SeqCst);
        service.shared.wake.notify_one();
        let deadline = Instant::now() + Duration::from_secs(2);
        while frames() != 0 {
            assert!(Instant::now() < deadline, "idle expiry was not cleaned");
            std::thread::sleep(Duration::from_millis(2));
        }
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
