//! Native-only resource, account and storage routing. No PID, HWND, document
//! fingerprint, filesystem path or key is accepted from the WebView.
use super::ScreenContextAccount;
use base64::{engine::general_purpose::STANDARD, Engine};
use drifty_screen_context_core::{
    key_store::NativeProfileKeys,
    lease::{AccountLeaseId, AccountReadLease, AccountReply},
    store::{EvidencePage, EvidenceStore, PageCursor},
    unix_millis, ActivityPreparation, ActivityReadReply, Cancellation, CaptureBackend,
    CaptureFailure, CapturePolicy, CapturePreferences, Error, NativeActivityPreparer,
    NativeCapture, ObservationReply, Retention, ScopeId, ScreenContextService, TextEvidence,
};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Condvar, Mutex, OnceLock,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};
use uuid::Uuid;
use zeroize::Zeroize;

const UNAVAILABLE: &str = "screen_context_unavailable";
const CHANGED: &str = "screen_context_account_changed";
mod activity_deletion;
mod activity_view;
mod activity_input;
pub use activity_input::*;
mod backend;
pub use activity_view::*;
mod ai_settings;
pub use ai_settings::*;
mod exclusions;
mod memory;
mod memory_export;
mod memory_models;
pub use memory_models::*;
mod memory_runtime;
pub use memory_runtime::*;
#[cfg(test)]
mod response_tests;
mod retention;
mod visibility;
pub use memory::*;
pub use memory_export::*;

#[derive(Default)]
struct RuntimeState {
    scope: Option<ScopeId>,
    preferences: CapturePreferences,
    opened: bool,
    preferences_invalid: bool,
    lease: Option<AccountReadLease>,
    last_request: Option<Instant>,
    retention: retention::RuntimeRetention,
}
#[derive(Default)]
pub(crate) struct ScreenContextRuntime {
    memory: memory::MemoryRuntime,
    ai_consent: drifty_screen_context_core::ai_consent::AiConsentCoordinator,
    ai_use: Mutex<Option<ai_settings::AccountAiUse>>,
    state: Mutex<RuntimeState>,
    exclusion_io: Mutex<()>,
    service: OnceLock<Arc<ScreenContextService>>,
    activity_preparation: OnceLock<NativeActivityPreparer>,
    visibility: Mutex<visibility::VisibleEvidence>,
    visibility_generation: AtomicU64,
    helper_installed: OnceLock<bool>,
    ticker: OnceLock<JoinHandle<()>>,
    ticker_start: Mutex<()>,
    stop: Arc<(Mutex<bool>, Condvar)>,
    suspended: Arc<AtomicBool>,
}
struct UnavailableBackend;
impl CaptureBackend for UnavailableBackend {
    fn prepare(&self, _: &CapturePolicy, _: &Cancellation) -> Result<(), CaptureFailure> {
        Err(CaptureFailure::Unavailable)
    }
    fn capture(
        &self,
        _: &CapturePolicy,
        _: &Cancellation,
    ) -> Result<NativeCapture, CaptureFailure> {
        Err(CaptureFailure::Unavailable)
    }
}

fn configured_marker(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|_| UNAVAILABLE.to_owned())?
        .join("screen-evidence-v1")
        .join("configured.marker"))
}
fn configured(app: &AppHandle) -> bool {
    configured_marker(app)
        .ok()
        .and_then(|path| fs::symlink_metadata(path).ok())
        .is_some_and(|metadata| {
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                if metadata.file_attributes() & 0x400 != 0 {
                    return false;
                }
            }
            metadata.is_file() && !metadata.file_type().is_symlink() && metadata.len() == 0
        })
}
fn mark_configured(app: &AppHandle) -> Result<(), String> {
    if configured(app) {
        return Ok(());
    }
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(configured_marker(app)?)
        .map_err(|_| UNAVAILABLE.to_owned())?;
    file.flush()
        .and_then(|_| file.sync_all())
        .map_err(|_| UNAVAILABLE.to_owned())
}
fn globally_paused(app: &AppHandle) -> bool {
    app.try_state::<crate::tracking_pause::TrackingPauseState>()
        .is_none_or(|state| state.snapshot().is_active())
}
fn input_recent() -> bool {
    #[cfg(target_os = "macos")]
    {
        #[link(name = "CoreGraphics", kind = "framework")]
        extern "C" {
            fn CGEventSourceSecondsSinceLastEventType(state: i32, event: u32) -> f64;
        }
        let seconds = unsafe { CGEventSourceSecondsSinceLastEventType(0, u32::MAX) };
        seconds.is_finite() && (0.0..120.0).contains(&seconds)
    }
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::{
            System::SystemInformation::GetTickCount64,
            UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO},
        };
        let mut info = LASTINPUTINFO {
            cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };
        if unsafe { GetLastInputInfo(&mut info) } == 0 {
            return false;
        }
        (unsafe { GetTickCount64() } as u32).wrapping_sub(info.dwTime) < 120_000
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        false
    }
}

fn helper_path(app: &AppHandle) -> Result<PathBuf, String> {
    let name = if cfg!(target_os = "windows") {
        "screen-context/helper.exe"
    } else {
        "screen-context/helper"
    };
    app.path()
        .resolve(name, tauri::path::BaseDirectory::Resource)
        .map_err(|_| UNAVAILABLE.into())
}

/// The macOS capture helper uses ScreenCaptureKit screenshots, which need macOS 14.
/// Drifty itself runs on macOS 13, where the optional feature stays hidden instead
/// of offering a recording that can never start.
#[cfg(target_os = "macos")]
fn capture_supported_os() -> bool {
    let mut buffer = [0u8; 32];
    let mut length = buffer.len();
    // SAFETY: a NUL-terminated name, a writable buffer and its length; no new value.
    let result = unsafe {
        libc::sysctlbyname(
            b"kern.osproductversion\0".as_ptr().cast(),
            buffer.as_mut_ptr().cast(),
            &mut length,
            std::ptr::null_mut(),
            0,
        )
    };
    result == 0 && macos_major(&buffer[..length.min(buffer.len())]).is_some_and(|major| major >= 14)
}
#[cfg(not(target_os = "macos"))]
fn capture_supported_os() -> bool {
    true
}
#[cfg(any(target_os = "macos", test))]
fn macos_major(raw: &[u8]) -> Option<u32> {
    let text = std::str::from_utf8(raw).ok()?.trim_end_matches('\0');
    text.split('.').next()?.trim().parse().ok()
}
fn supported_apps() -> Vec<SupportedApp> {
    #[cfg(target_os = "macos")]
    {
        vec![
            SupportedApp {
                id: "textedit",
                name: "TextEdit",
            },
            SupportedApp {
                id: "preview",
                name: "Preview",
            },
            SupportedApp {
                id: "vscode",
                name: "Visual Studio Code",
            },
            SupportedApp {
                id: "cursor",
                name: "Cursor",
            },
            SupportedApp {
                id: "slack",
                name: "Slack",
            },
            SupportedApp {
                id: "discord",
                name: "Discord",
            },
            SupportedApp {
                id: "chatgpt",
                name: "ChatGPT",
            },
            SupportedApp {
                id: "cmux",
                name: "cmux",
            },
            SupportedApp {
                id: "powerpoint",
                name: "Microsoft PowerPoint",
            },
            SupportedApp {
                id: "aside",
                name: "Aside",
            },
            SupportedApp {
                id: "chrome",
                name: "Google Chrome",
            },
        ]
    }
    #[cfg(target_os = "windows")]
    {
        vec![SupportedApp {
            id: "notepad",
            name: "Notepad",
        }]
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Vec::new()
    }
}
/// Recording saved with an app list becomes general recording once general capture
/// is available, except while memory holds it to its apps: memory reads those apps'
/// documents, and general recording has no app list for it to select from.
fn upgrade_unless_memory_holds(preferences: &mut CapturePreferences, keep_apps: bool, general_ready: bool) {
    if !keep_apps {
        preferences.upgrade_general_recording(general_ready);
    }
}

fn policy_for(preferences: &CapturePreferences) -> Result<CapturePolicy, String> {
    if preferences.scope == drifty_screen_context_core::CaptureScope::ActiveDisplayScene {
        return if cfg!(target_os = "macos") {
            preferences.policy().map_err(error_code)
        } else {
            Err("screen_context_general_capture_unavailable".into())
        };
    }
    let mut policy = preferences.policy().map_err(error_code)?;
    policy.allowed_apps.clear();
    for app in &preferences.allowed_apps {
        match app.as_str() {
            #[cfg(target_os = "macos")]
            "textedit" => {
                policy.allowed_apps.insert("com.apple.TextEdit".into());
            }
            #[cfg(target_os = "macos")]
            "preview" => {
                policy.allowed_apps.insert("com.apple.Preview".into());
            }
            #[cfg(target_os = "macos")]
            "vscode" => {
                policy.allowed_apps.insert("com.microsoft.VSCode".into());
            }
            #[cfg(target_os = "macos")]
            "cursor" => {
                policy
                    .allowed_apps
                    .insert("com.todesktop.230313mzl4w4u92".into());
            }
            #[cfg(target_os = "macos")]
            "slack" => {
                policy
                    .allowed_apps
                    .insert("com.tinyspeck.slackmacgap".into());
            }
            #[cfg(target_os = "macos")]
            "discord" => {
                policy.allowed_apps.insert("com.hnc.Discord".into());
            }
            #[cfg(target_os = "macos")]
            "chatgpt" => {
                policy.allowed_apps.insert("com.openai.codex".into());
            }
            #[cfg(target_os = "macos")]
            "cmux" => {
                policy.allowed_apps.insert("com.cmuxterm.app".into());
            }
            #[cfg(target_os = "macos")]
            "powerpoint" => {
                policy
                    .allowed_apps
                    .insert("com.microsoft.Powerpoint".into());
            }
            // Browsers also need chosen memory work sites; see SiteGate.
            #[cfg(target_os = "macos")]
            "aside" => {
                policy.allowed_apps.insert("at.studio.AsideBrowser".into());
            }
            #[cfg(target_os = "macos")]
            "chrome" => {
                policy.allowed_apps.insert("com.google.Chrome".into());
            }
            #[cfg(target_os = "windows")]
            "notepad" => {
                policy
                    .allowed_apps
                    .insert("Microsoft.WindowsNotepad_8wekyb3d8bbwe!App".into());
                let mut buffer = vec![0u16; 32768];
                let length = unsafe {
                    windows_sys::Win32::System::SystemInformation::GetSystemDirectoryW(
                        buffer.as_mut_ptr(),
                        buffer.len() as u32,
                    )
                } as usize;
                if length == 0 || length >= buffer.len() {
                    return Err(UNAVAILABLE.into());
                }
                let path =
                    String::from_utf16(&buffer[..length]).map_err(|_| UNAVAILABLE.to_owned())?;
                policy
                    .allowed_apps
                    .insert(format!("{path}\\notepad.exe").to_lowercase());
            }
            _ => return Err("screen_context_unsupported_app".into()),
        }
    }
    Ok(policy)
}
fn failure_code(reason: CaptureFailure) -> &'static str {
    match reason {
        CaptureFailure::Permission => "permission",
        CaptureFailure::Excluded => "excluded",
        CaptureFailure::Visibility => "visibility",
        CaptureFailure::Protected => "protected",
        CaptureFailure::Unsupported => "unsupported",
        CaptureFailure::Cancelled => "cancelled",
        CaptureFailure::Deadline => "deadline",
        CaptureFailure::Unavailable => "unavailable",
        CaptureFailure::Invalidated => "invalidated",
        CaptureFailure::Storage => "storage",
        CaptureFailure::NoText => "no_text",
        CaptureFailure::TextDeadline => "text_deadline",
        CaptureFailure::TextUnavailable => "text_unavailable",
    }
}
fn error_code(error: Error) -> String {
    match error {
        Error::Invalidated => CHANGED,
        Error::Authentication => "screen_context_key_unavailable",
        Error::StorageFull => "screen_context_storage_full",
        Error::ClockRollback => "screen_context_clock_changed",
        Error::Invalid(_) => "screen_context_invalid_settings",
        _ => UNAVAILABLE,
    }
    .to_owned()
}

impl ScreenContextRuntime {
    fn stopping(&self) -> bool {
        self.stop.0.lock().map_or(true, |stop| *stop)
    }
    pub(crate) fn suspend_global(&self) {
        self.suspended.store(true, Ordering::Release);
        self.invalidate_now();
    }
    pub(crate) fn shutdown(&self) {
        self.memory.invalidate();
        let _ = self.ai_consent.invalidate_now();
        let _ = self.revoke_ai_use_now();
        if let Ok(mut stop) = self.stop.0.lock() {
            *stop = true;
        }
        self.stop.1.notify_all();
        if let Some(service) = self.service.get() {
            service.stop_now();
        }
        let deadline = Instant::now() + Duration::from_millis(1100);
        while self
            .ticker
            .get()
            .is_some_and(|ticker| !ticker.is_finished())
            || self
                .service
                .get()
                .is_some_and(|service| !service.worker_stopped())
        {
            if Instant::now() >= deadline {
                break;
            }
            thread::sleep(Duration::from_millis(2));
        }
    }
    pub(crate) fn invalidate_now(&self) {
        self.memory.invalidate();
        let _ = self.ai_consent.invalidate_now();
        let _ = self.revoke_ai_use_now();
        if let Some(service) = self.service.get() {
            service.invalidate_observations_now();
        }
    }
    pub(crate) fn bind(&self, app: &AppHandle, lease: AccountReadLease) -> Result<(), String> {
        if self.stopping() {
            return Err(UNAVAILABLE.into());
        }
        let mut state = self.state.lock().map_err(|_| UNAVAILABLE.to_owned())?;
        if !lease.is_current() {
            return Err(CHANGED.into());
        }
        self.clear_visibility();
        if state.scope.as_ref() != Some(lease.scope()) {
            state.scope = Some(lease.scope().clone());
            state.preferences = CapturePreferences::default();
            state.opened = false;
            state.preferences_invalid = false;
            state.last_request = None;
        }
        if let Some(service) = self.service.get() {
            if let Err(error) = service.bind_account_lease(lease.clone()) {
                state.opened = false;
                state.lease = None;
                state.last_request = None;
                return Err(error_code(error));
            }
        }
        state.lease = Some(lease.clone());
        if configured(app) {
            self.ensure_store(app, &mut state, &lease, false)?;
        }
        drop(state);
        // An unavailable tracker closes evidence/capture, not the account
        // capability needed to turn capture off or delete screen evidence.
        let _ = self.refresh_exclusions(app);
        Ok(())
    }
    fn service(
        &self,
        app: &AppHandle,
        lease: &AccountReadLease,
    ) -> Result<&Arc<ScreenContextService>, String> {
        if self.stopping() {
            return Err(UNAVAILABLE.into());
        }
        if !lease.is_current() {
            return Err(CHANGED.into());
        }
        if let Some(service) = self.service.get() {
            return Ok(service);
        }
        let backend = helper_path(app)
            .ok()
            .filter(|_| capture_supported_os())
            .and_then(|p| backend::from_resource(&p).ok());
        let reader = crate::tracker::screen_activity_reader(app)
            .ok()
            .map(Arc::new);
        let pair = backend.zip(reader);
        let installed = pair.is_some();
        let (backend, reader): (Arc<dyn CaptureBackend>, _) = match pair {
            Some((backend, reader)) => {
                self.activity_preparation
                    .set(reader.preparation())
                    .map_err(|_| UNAVAILABLE.to_owned())?;
                (backend, Some(reader))
            }
            None => (Arc::new(UnavailableBackend), None),
        };
        let backend = Arc::new(backend::GuardedBackend {
            inner: backend,
            suspended: Arc::clone(&self.suspended),
        });
        let service = Arc::new(
            match reader {
                Some(reader) => {
                    ScreenContextService::new_account_bound_with_activity_resolver(backend, reader)
                }
                None => ScreenContextService::new_account_bound(backend),
            }
            .map_err(error_code)?,
        );
        service.set_global_exclusions(None).map_err(error_code)?;
        service
            .bind_account_lease(lease.clone())
            .map_err(error_code)?;
        // All callers hold state, so resource/worker construction is one-shot.
        self.helper_installed
            .set(installed)
            .map_err(|_| UNAVAILABLE.to_owned())?;
        self.service
            .set(service)
            .map_err(|_| UNAVAILABLE.to_owned())?;
        self.start_ticker(app)?;
        Ok(self.service.get().expect("installed owned service"))
    }
    fn start_ticker(&self, app: &AppHandle) -> Result<(), String> {
        let _start = self
            .ticker_start
            .lock()
            .map_err(|_| UNAVAILABLE.to_owned())?;
        if self.stopping() {
            return Err(UNAVAILABLE.into());
        }
        if self.ticker.get().is_some() {
            return Ok(());
        }
        let stop = Arc::clone(&self.stop);
        let timer_app = app.clone();
        let ticker = thread::Builder::new()
            .name("drifty-screen-clock".into())
            .spawn(move || loop {
                let Ok(stopped) = stop.0.lock() else {
                    break;
                };
                if *stopped {
                    break;
                }
                let Ok((stopped, _)) = stop.1.wait_timeout(stopped, Duration::from_secs(1)) else {
                    break;
                };
                if *stopped {
                    break;
                }
                drop(stopped);
                let account = timer_app.state::<ScreenContextAccount>();
                account.runtime.tick(&timer_app);
            })
            .map_err(|_| UNAVAILABLE.to_owned())?;
        self.ticker
            .set(ticker)
            .map_err(|_| UNAVAILABLE.to_owned())?;
        Ok(())
    }
    fn tick(&self, app: &AppHandle) {
        self.memory.tick(app);
        self.tick_visibility(app);
        self.tick_retention(app);
        let Some(service) = self.service.get() else {
            return;
        };
        let (should_capture, account_expired) = {
            let Ok(state) = self.state.try_lock() else {
                return;
            };
            let enabled = state.opened && state.preferences.enabled;
            let current = state.lease.as_ref().is_some_and(|lease| lease.is_current());
            (enabled && current, enabled && !current)
        };
        if account_expired && !self.suspended.swap(true, Ordering::AcqRel) {
            service.invalidate_observations_now();
        }
        if !should_capture {
            return;
        }
        if !self.update_capture_suspension(service, globally_paused(app), input_recent()) {
            return;
        }
        let Ok(mut state) = self.state.try_lock() else {
            return;
        };
        if !state.lease.as_ref().is_some_and(|lease| lease.is_current())
            || !state.preferences.enabled
        {
            return;
        }
        let now = Instant::now();
        if state.last_request.is_none_or(|last| {
            now.duration_since(last)
                >= Duration::from_secs(state.preferences.interval_seconds as u64)
        }) {
            state.last_request = Some(now);
            drop(state);
            if self.refresh_exclusions(app).is_ok() {
                service.request_sample();
            }
        }
    }
    fn update_capture_suspension(
        &self,
        service: &ScreenContextService,
        globally_paused: bool,
        input_recent: bool,
    ) -> bool {
        // Inactivity stops sampling, but is not a revocation of saved history.
        // Keep explicit/global pause on the existing observation fence.
        let was = self.suspended.swap(globally_paused, Ordering::AcqRel);
        if globally_paused {
            if !was {
                service.invalidate_observations_now();
            }
            return false;
        }
        if was {
            service.invalidate_observations();
        }
        service.set_capture_suspended(!input_recent).is_ok() && input_recent
    }
    fn ensure_store(
        &self,
        app: &AppHandle,
        state: &mut RuntimeState,
        lease: &AccountReadLease,
        create: bool,
    ) -> Result<(), String> {
        if !lease.is_current() || state.scope.as_ref() != Some(lease.scope()) {
            return Err(CHANGED.into());
        }
        let service = self.service(app, lease)?;
        if state.opened {
            return self.upgrade_general(app, state, lease);
        }
        let root = app
            .path()
            .app_local_data_dir()
            .map_err(|_| UNAVAILABLE.to_owned())?
            .join("screen-evidence-v1");
        if !create
            && !EvidenceStore::exists_for_profile(&root, lease.scope()).map_err(error_code)?
        {
            return Ok(());
        }
        state.retention.before_store_open();
        let mut keys = NativeProfileKeys::new(&app.config().identifier).map_err(error_code)?;
        let mut store = EvidenceStore::open_with_key_provider(
            &root,
            lease.scope().clone(),
            &mut keys,
            Retention::default(),
            unix_millis().map_err(error_code)?,
        )
        .map_err(error_code)?;
        store
            .enable_elapsed_retention(unix_millis().map_err(error_code)?)
            .map_err(error_code)?;
        let preferences = store.read_preferences(unix_millis().map_err(error_code)?);
        // A malformed preference cannot enable capture, but authenticated
        // history remains available for review/purge and explicit reset.
        state.preferences_invalid = preferences.is_err();
        state.preferences = preferences.unwrap_or_default();
        if (state.preferences.scope == drifty_screen_context_core::CaptureScope::ActiveDisplayScene
            && !cfg!(target_os = "macos"))
            || state
                .preferences
                .allowed_apps
                .iter()
                .any(|v| !supported_apps().iter().any(|a| a.id == v))
        {
            state.preferences = CapturePreferences::default();
            state.preferences_invalid = true;
        }
        if !lease.is_current() {
            return Err(CHANGED.into());
        }
        state.retention.attach(&store);
        service.replace_store(Some(store)).map_err(error_code)?;
        state.opened = true;
        let policy = if self.helper_installed.get().copied().unwrap_or(false) {
            let mut policy = policy_for(&state.preferences)?;
            policy.work_sites = memory::work_site_digests(app, lease);
            policy
        } else {
            CapturePolicy::default()
        };
        service.set_policy(policy).map_err(error_code)?;
        self.upgrade_general(app, state, lease)
    }
    fn general_supported(&self) -> bool {
        cfg!(target_os = "macos")
            && capture_supported_os()
            && self.helper_installed.get().copied().unwrap_or(false)
    }
    fn upgrade_general(
        &self,
        app: &AppHandle,
        state: &mut RuntimeState,
        lease: &AccountReadLease,
    ) -> Result<(), String> {
        let mut next = state.preferences.clone();
        if state.preferences_invalid
            || !next.enabled
            || memory::holds_capture(app, lease)
            || self.memory.enabling()
            || next.scope != drifty_screen_context_core::CaptureScope::SelectedApps
            || !next
                .upgrade_general_recording(self.general_supported() && screen_recording_permitted())
        {
            return Ok(());
        }
        let service = self.service(app, lease)?;
        apply_general_upgrade(&service, &mut state.preferences, next)?;
        state.last_request = None;
        Ok(())
    }
    /// Rebuild the active capture policy after memory settings change.
    pub(super) fn reapply_capture_policy(
        &self,
        app: &AppHandle,
        lease: &AccountReadLease,
    ) -> Result<(), String> {
        let service = self.service(app, lease)?;
        self.with_state(lease, |state| {
            if !state.opened || !self.helper_installed.get().copied().unwrap_or(false) {
                return Ok(());
            }
            let mut policy = policy_for(&state.preferences)?;
            policy.work_sites = memory::work_site_digests(app, lease);
            service.set_policy(policy).map_err(error_code)
        })
    }
    fn with_state<T>(
        &self,
        lease: &AccountReadLease,
        run: impl FnOnce(&mut RuntimeState) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut state = self.state.lock().map_err(|_| UNAVAILABLE.to_owned())?;
        if !lease.is_current() || state.scope.as_ref() != Some(lease.scope()) {
            return Err(CHANGED.into());
        }
        let result = run(&mut state)?;
        if !lease.is_current() {
            return Err(CHANGED.into());
        }
        Ok(result)
    }
    fn status_locked(
        &self,
        app: &AppHandle,
        state: &mut RuntimeState,
        lease: &AccountReadLease,
    ) -> Result<RuntimeStatus, String> {
        self.touch_visibility();
        self.ensure_store(app, state, lease, false)?;
        let current = self.service(app, lease)?.status();
        Ok(RuntimeStatus {
            activity_cleanup_pending: drifty_screen_context_core::store::InactiveProfileMaintenance::activity_deletion_pending(
                &app.path().app_local_data_dir().map_err(|_| UNAVAILABLE.to_owned())?.join("screen-evidence-v1"),
            ).map_err(error_code)?,
            preferences: state.preferences.clone(),
            preferences_invalid: state.preferences_invalid,
            helper_installed: self.helper_installed.get().copied().unwrap_or(false),
            ocr_supported: cfg!(target_os = "macos"),
            general_capture_supported: self.general_supported(),
            supported_apps: supported_apps(),
            capture_enabled: current.enabled,
            global_paused: globally_paused(app),
            paused: current.paused,
            running: current.running,
            preparing: current.preparing,
            accepted: current.accepted,
            dropped: current.dropped,
            last_failure: current.last_failure.map(failure_code),
            last_accepted_at_ms: current.last_accepted_at_ms,
        })
    }
    /// keep_apps: memory holds recording to its own app list, so a chosen app
    /// list is saved as chosen instead of becoming general recording.
    fn configure(
        &self,
        app: &AppHandle,
        lease: &AccountReadLease,
        mut preferences: CapturePreferences,
        resume: bool,
        keep_apps: bool,
    ) -> Result<RuntimeStatus, String> {
        self.with_state(lease, |state| {
            preferences.validate().map_err(error_code)?;
            if preferences.scope == drifty_screen_context_core::CaptureScope::ActiveDisplayScene
                && !self.general_supported()
            {
                return Err("screen_context_general_capture_unavailable".into());
            }
            self.clear_visibility();
            let apps = supported_apps();
            if preferences
                .allowed_apps
                .iter()
                .any(|id| !apps.iter().any(|a| a.id == id))
            {
                return Err("screen_context_unsupported_app".into());
            }
            if preferences.enabled && preferences.ocr_enabled && !cfg!(target_os = "macos") {
                return Err("screen_context_ocr_unavailable".into());
            }
            let service = self.service(app, lease)?;
            if preferences.enabled && !self.helper_installed.get().copied().unwrap_or(false) {
                return Err("screen_context_helper_unavailable".into());
            }
            if preferences.enabled
                && (!state.preferences.enabled || (resume && service.status().paused))
            {
                if !globally_paused(app) && !crate::tracker::screen_activity_producer_current(app) {
                    return Err("screen_context_tracker_not_ready".to_owned());
                }
                let preparer = self
                    .activity_preparation
                    .get()
                    .ok_or_else(|| UNAVAILABLE.to_owned())?;
                let current = || lease.is_current() && !self.stopping();
                match preparer.prepare(&current).map_err(error_code)? {
                    ActivityPreparation::Ready => {}
                    ActivityPreparation::WriterNotReady | ActivityPreparation::MissingDatabase => {
                        return Err("screen_context_tracker_not_ready".to_owned())
                    }
                    ActivityPreparation::Unavailable => return Err(UNAVAILABLE.to_owned()),
                }
            }
            self.ensure_store(app, state, lease, true)?;
            // The notice is native-owned: a stale settings form cannot clear it.
            preferences.general_notice_pending = state.preferences.general_notice_pending;
            upgrade_unless_memory_holds(
                &mut preferences,
                keep_apps,
                self.general_supported() && screen_recording_permitted(),
            );
            if preferences.enabled {
                // Persist cleanup opt-in before the first job can write. A
                // crash between capture and this marker must not strand data
                // outside the next startup's expiry-only maintenance path.
                if let Err(error) = mark_configured(app) {
                    let _ = service.set_policy(CapturePolicy::default());
                    return Err(error);
                }
            }
            let mut policy = policy_for(&preferences)?;
            policy.work_sites = memory::work_site_digests(app, lease);
            service.set_policy(policy).map_err(error_code)?;
            if let Err(error) = service.save_preferences(&preferences) {
                let _ = service.set_policy(CapturePolicy::default());
                return Err(error_code(error));
            }
            state.preferences = preferences;
            state.preferences_invalid = false;
            state.last_request = None;
            if resume && state.preferences.enabled {
                service.resume_capture().map_err(error_code)?;
            }
            self.status_locked(app, state, lease)
        })
    }
}

fn apply_general_upgrade(
    service: &ScreenContextService,
    current: &mut CapturePreferences,
    next: CapturePreferences,
) -> Result<(), String> {
    // Closing the trusted exclusion gate cancels jobs and prevents new capture
    // until general rules are refreshed. An OFF policy would also persist a
    // deletion-style pause, incorrectly requiring an existing ON user to Resume.
    // Preserve the actual durable pause; never resume it as part of migration.
    service.set_global_exclusions(None).map_err(error_code)?;
    service.save_preferences(&next).map_err(error_code)?;
    *current = next;
    service.set_policy(policy_for(current)?).map_err(error_code)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupportedApp {
    id: &'static str,
    name: &'static str,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    activity_cleanup_pending: bool,
    preferences: CapturePreferences,
    preferences_invalid: bool,
    helper_installed: bool,
    ocr_supported: bool,
    general_capture_supported: bool,
    supported_apps: Vec<SupportedApp>,
    capture_enabled: bool,
    global_paused: bool,
    paused: bool,
    running: bool,
    preparing: bool,
    accepted: u64,
    dropped: u64,
    last_failure: Option<&'static str>,
    last_accepted_at_ms: Option<i64>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceDetail {
    id: Uuid,
    observed_at_ms: i64,
    expires_at_ms: i64,
    text_evidence: TextEvidence,
    frame_url: Option<String>,
}
impl Drop for EvidenceDetail {
    fn drop(&mut self) {
        if let Some(url) = &mut self.frame_url {
            url.zeroize();
        }
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteResult {
    removed_count: usize,
    pending_files: usize,
}

fn authorized<T: Serialize>(
    app: &AppHandle,
    id: AccountLeaseId,
    run: impl FnOnce(&ScreenContextRuntime, &AccountReadLease) -> Result<T, String>,
) -> Result<AccountReply<T>, String> {
    let account = app.state::<ScreenContextAccount>();
    let lease = account.gate.read(id).map_err(error_code)?;
    let value = run(&account.runtime, &lease)?;
    lease.reply(value).map_err(error_code)
}

#[derive(Serialize)]
#[serde(untagged)]
enum ReviewReply<T> {
    Current(ActivityReadReply<T>),
    // No configured/open profile: only an empty page or null detail is issued.
    Empty(ObservationReply<T>),
}

fn sensitive_response(value: impl Serialize) -> Result<tauri::ipc::Response, String> {
    // Run inside the owning blocking task. Whole-body serialization executes
    // every account/observation/current-activity guard before handing JSON to
    // Tauri. No sensitive serializer exception or partial JSON is returned.
    let body = serde_json::to_string(&value).map_err(|_| UNAVAILABLE.to_owned())?;
    Ok(tauri::ipc::Response::new(body))
}

/// Content-free, read-only recipient preview. This neither reads evidence nor
/// saves consent, activates an AI gate, starts a model or sends a request.
#[tauri::command]
pub async fn screen_context_managed_ai_recipient(
    app: AppHandle,
    lease_id: AccountLeaseId,
) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let reply = authorized(&app, lease_id, |_runtime, _lease| {
            Ok(super::managed_ai::observe_screen_recipient(&app))
        })?;
        sensitive_response(reply)
    })
    .await
    .map_err(|_| UNAVAILABLE.to_owned())?
}

#[tauri::command]
pub async fn screen_context_get_status(
    app: AppHandle,
    lease_id: AccountLeaseId,
) -> Result<AccountReply<RuntimeStatus>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        authorized(&app, lease_id, |runtime, lease| {
            runtime.with_state(lease, |state| runtime.status_locked(&app, state, lease))
        })
    })
    .await
    .map_err(|_| UNAVAILABLE.to_owned())?
}
#[tauri::command]
pub async fn screen_context_configure(
    app: AppHandle,
    lease_id: AccountLeaseId,
    preferences: CapturePreferences,
    resume: bool,
) -> Result<AccountReply<RuntimeStatus>, String> {
    let account = app.state::<ScreenContextAccount>();
    account.gate.read(lease_id).map_err(error_code)?;
    account.runtime.forget_visibility_now();
    account.runtime.invalidate_now();
    tauri::async_runtime::spawn_blocking(move || {
        authorized(&app, lease_id, |runtime, lease| {
            // While memory is on, recording keeps to memory's apps whatever the form sends.
            let keep_apps = memory::holds_capture(&app, lease);
            runtime.configure_with_exclusions(&app, lease, preferences, resume, keep_apps)
        })
    })
    .await
    .map_err(|_| UNAVAILABLE.to_owned())?
}
/// Acknowledge only the notice; never overwrite an intervening OFF/settings save.
#[tauri::command]
pub async fn screen_context_acknowledge_scope(
    app: AppHandle,
    lease_id: AccountLeaseId,
) -> Result<AccountReply<RuntimeStatus>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        authorized(&app, lease_id, |runtime, lease| {
            runtime.with_state(lease, |state| {
                runtime.ensure_store(&app, state, lease, false)?;
                if state.opened && state.preferences.general_notice_pending {
                    let mut next = state.preferences.clone();
                    next.general_notice_pending = false;
                    runtime
                        .service(&app, lease)?
                        .save_preferences(&next)
                        .map_err(error_code)?;
                    state.preferences = next;
                }
                runtime.status_locked(&app, state, lease)
            })
        })
    })
    .await
    .map_err(|_| UNAVAILABLE.to_owned())?
}
#[tauri::command]
pub async fn screen_context_list_evidence(
    app: AppHandle,
    lease_id: AccountLeaseId,
    cursor: Option<PageCursor>,
) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let reply = authorized(&app, lease_id, |runtime, lease| {
            runtime.refresh_exclusions(&app)?;
            runtime.with_state(lease, |state| {
                runtime.ensure_store(&app, state, lease, false)?;
                let service = runtime.service(&app, lease)?;
                if state.opened {
                    let page = service
                        .list_review_evidence(cursor, 20)
                        .map_err(error_code)?;
                    runtime.watch_page(lease_id, &page)?;
                    Ok(ReviewReply::Current(page))
                } else {
                    let page = EvidencePage {
                        records: Vec::new(),
                        next_cursor: None,
                    };
                    Ok(ReviewReply::Empty(
                        service
                            .observation_lease()
                            .reply(page)
                            .map_err(error_code)?,
                    ))
                }
            })
        })?;
        sensitive_response(reply)
    })
    .await
    .map_err(|_| UNAVAILABLE.to_owned())?
}
#[tauri::command]
pub async fn screen_context_read_evidence(
    app: AppHandle,
    lease_id: AccountLeaseId,
    record_id: Uuid,
    include_frame: bool,
    record_ids: Option<Vec<String>>,
    windows: Option<Vec<[i64; 2]>>,
) -> Result<tauri::ipc::Response, String> {
    let selection = match (record_ids, windows) {
        (Some(ids), Some(windows)) => {
            activity_view::validate(&ids, &windows)?;
            Some((ids, windows))
        }
        (None, None) => None,
        _ => return Err("screen_context_invalid_range".into()),
    };
    tauri::async_runtime::spawn_blocking(move || {
        let reply = authorized(&app, lease_id, |runtime, lease| {
            runtime.refresh_exclusions(&app)?;
            runtime.with_state(lease, |state| {
                runtime.ensure_store(&app, state, lease, false)?;
                let service = runtime.service(&app, lease)?;
                if state.opened {
                    let detail = match &selection {
                        Some((ids, windows)) => service.read_replay_evidence_in_windows(
                            record_id,
                            include_frame,
                            ids,
                            windows,
                        ),
                        None => service.read_review_evidence_strict(record_id, include_frame),
                    }
                    .map_err(error_code)?
                    .try_map(|value| {
                        Ok(value.map(|evidence| EvidenceDetail {
                            id: evidence.metadata.id,
                            observed_at_ms: evidence.metadata.observed_at_ms,
                            expires_at_ms: evidence.metadata.expires_at_ms,
                            text_evidence: evidence.metadata.text.clone(),
                            frame_url: evidence.frame.map(|frame| {
                                format!("data:image/png;base64,{}", STANDARD.encode(frame.bytes()))
                            }),
                        }))
                    })
                    .map_err(error_code)?;
                    runtime.watch_detail(lease_id, &detail)?;
                    Ok(ReviewReply::Current(detail))
                } else {
                    Ok(ReviewReply::Empty(
                        service
                            .observation_lease()
                            .reply(None::<EvidenceDetail>)
                            .map_err(error_code)?,
                    ))
                }
            })
        })?;
        sensitive_response(reply)
    })
    .await
    .map_err(|_| UNAVAILABLE.to_owned())?
}
#[tauri::command]
pub async fn screen_context_sample_now(
    app: AppHandle,
    lease_id: AccountLeaseId,
) -> Result<AccountReply<bool>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        thread::sleep(Duration::from_secs(3));
        authorized(&app, lease_id, |runtime, lease| {
            runtime.refresh_exclusions(&app)?;
            runtime.with_state(lease, |state| {
                runtime.ensure_store(&app, state, lease, false)?;
                Ok(state.opened
                    && !globally_paused(&app)
                    && input_recent()
                    && !runtime.suspended.load(Ordering::Acquire)
                    && runtime.service(&app, lease)?.request_sample())
            })
        })
    })
    .await
    .map_err(|_| UNAVAILABLE.to_owned())?
}
#[tauri::command]
pub fn screen_context_was_configured(app: AppHandle) -> bool {
    configured(&app)
}

fn screen_recording_permitted() -> bool {
    #[cfg(target_os = "macos")]
    {
        #[link(name = "CoreGraphics", kind = "framework")]
        extern "C" {
            fn CGPreflightScreenCaptureAccess() -> bool;
        }
        unsafe { CGPreflightScreenCaptureAccess() }
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

#[derive(Serialize)]
pub struct ScreenRecordingPermissionStatus {
    granted: bool,
}
/// Whether macOS already allows Screen Recording for Drifty. A preflight only:
/// it never prompts, needs no account lease and reads no screen content.
/// Windows has no such permission and reports false.
#[tauri::command]
pub async fn screen_context_permission_status() -> Result<ScreenRecordingPermissionStatus, String> {
    let granted = tauri::async_runtime::spawn_blocking(screen_recording_permitted)
        .await
        .map_err(|_| UNAVAILABLE.to_owned())?;
    Ok(ScreenRecordingPermissionStatus { granted })
}

#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ScreenCapturePermission {
    ScreenRecording,
    Accessibility,
}
#[derive(Serialize)]
pub struct ScreenPermissionResult {
    granted: bool,
}
#[tauri::command]
pub async fn screen_context_request_permission(
    app: AppHandle,
    lease_id: AccountLeaseId,
    permission: ScreenCapturePermission,
) -> Result<AccountReply<ScreenPermissionResult>, String> {
    if !cfg!(target_os = "macos") {
        return Err("screen_context_permission_not_required".into());
    }
    let account = app.state::<ScreenContextAccount>();
    let lease = account.gate.read(lease_id).map_err(error_code)?;
    account.runtime.forget_visibility_now();
    account.runtime.invalidate_now();
    #[cfg(target_os = "macos")]
    let granted = match permission {
        ScreenCapturePermission::ScreenRecording => tauri::async_runtime::spawn_blocking(|| {
            #[link(name = "CoreGraphics", kind = "framework")]
            extern "C" {
                fn CGPreflightScreenCaptureAccess() -> bool;
                fn CGRequestScreenCaptureAccess() -> bool;
            }
            unsafe { CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess() }
        })
        .await
        .map_err(|_| UNAVAILABLE.to_owned())?,
        ScreenCapturePermission::Accessibility => {
            super::accessibility_request_access(app.clone())
                .await
                .map_err(|_| UNAVAILABLE.to_owned())?
                .granted
        }
    };
    #[cfg(not(target_os = "macos"))]
    let granted = {
        let _ = permission;
        false
    };
    account.runtime.bind(&app, lease.clone())?;
    lease
        .reply(ScreenPermissionResult { granted })
        .map_err(error_code)
}
#[tauri::command]
pub async fn screen_context_preview_deletion(
    app: AppHandle,
    lease_id: AccountLeaseId,
    start_ms: Option<i64>,
    end_ms: Option<i64>,
) -> Result<AccountReply<drifty_screen_context_core::store::DeletionPreview>, String> {
    if !matches!((start_ms, end_ms), (None, None))
        && !matches!((start_ms, end_ms), (Some(start), Some(end)) if start >= 0 && end > start)
    {
        return Err("screen_context_invalid_range".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        authorized(&app, lease_id, |runtime, lease| {
            runtime.with_state(lease, |state| {
                runtime.ensure_store(&app, state, lease, false)?;
                if !state.opened {
                    return Ok(Default::default());
                }
                runtime
                    .service(&app, lease)?
                    .preview_deletion(start_ms, end_ms)
                    .map_err(error_code)
            })
        })
    })
    .await
    .map_err(|_| UNAVAILABLE.to_owned())?
}

#[tauri::command]
pub async fn screen_context_delete_evidence(
    app: AppHandle,
    lease_id: AccountLeaseId,
    start_ms: Option<i64>,
    end_ms: Option<i64>,
    record_id: Option<Uuid>,
) -> Result<AccountReply<DeleteResult>, String> {
    let account = app.state::<ScreenContextAccount>();
    account.gate.read(lease_id).map_err(error_code)?;
    account.runtime.forget_visibility_now();
    account.runtime.invalidate_now();
    tauri::async_runtime::spawn_blocking(move || {
        authorized(&app, lease_id, |runtime, lease| {
            runtime.with_state(lease, |state| {
                runtime.ensure_store(&app, state, lease, false)?;
                if !state.opened {
                    return Ok(DeleteResult {
                        removed_count: 0,
                        pending_files: 0,
                    });
                }
                let service = runtime.service(&app, lease)?;
                let removal = match (record_id, start_ms, end_ms) {
                    (Some(id), None, None) => service.delete_record(id),
                    (None, None, None) => service.purge(),
                    (None, Some(start), Some(end)) => service.delete_range(start, end),
                    _ => return Err("screen_context_invalid_range".into()),
                }
                .map_err(error_code)?;
                Ok(DeleteResult {
                    removed_count: removal.removed.len(),
                    pending_files: removal.pending_files,
                })
            })
        })
    })
    .await
    .map_err(|_| UNAVAILABLE.to_owned())?
}
