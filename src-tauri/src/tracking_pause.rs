use std::{
    fs, io,
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard},
    thread,
    time::Duration,
};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{async_runtime, AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

use crate::{
    tracker::{
        apply_tracker_startup_state, apply_tracking_pause_state, TrackerController, TrackerError,
        TrackerStartupState, TrackerStatus,
    },
    tracking_activation, tray,
};

const PAUSE_STATE_FILE_NAME: &str = "tracking-pause.json";
const PAUSE_STATE_VERSION: u8 = 1;
const TIMER_POLL_INTERVAL_SECONDS: i64 = 5;
const PAUSE_ENFORCEMENT_RETRY_DELAY: Duration = Duration::from_secs(2);
const PAUSE_ENFORCEMENT_MAX_RETRY_DELAY: Duration = Duration::from_secs(30);

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TimedPause {
    version: u8,
    pub(crate) paused_at_unix_seconds: i64,
    pub(crate) resumes_at_unix_seconds: i64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IndefinitePause {
    version: u8,
    kind: IndefinitePauseKind,
    paused_at_unix_seconds: i64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum IndefinitePauseKind {
    Indefinite,
}

impl IndefinitePause {
    fn new(paused_at_unix_seconds: i64) -> Self {
        Self {
            version: PAUSE_STATE_VERSION,
            kind: IndefinitePauseKind::Indefinite,
            paused_at_unix_seconds,
        }
    }

    fn is_valid(self) -> bool {
        self.version == PAUSE_STATE_VERSION
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PersistedTrackingPause {
    Timed(TimedPause),
    Indefinite(IndefinitePause),
}

impl TimedPause {
    fn new(paused_at_unix_seconds: i64, resumes_at_unix_seconds: i64) -> Self {
        Self {
            version: PAUSE_STATE_VERSION,
            paused_at_unix_seconds,
            resumes_at_unix_seconds,
        }
    }

    fn is_valid(self) -> bool {
        self.version == PAUSE_STATE_VERSION
            && self.resumes_at_unix_seconds > self.paused_at_unix_seconds
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum TrackingPauseSnapshot {
    Inactive,
    Indefinite,
    Timed { resumes_at_unix_seconds: i64 },
    ResumeFailed { resumes_at_unix_seconds: i64 },
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct TrackingPauseView {
    pub(crate) snapshot: TrackingPauseSnapshot,
    pub(crate) stopped_confirmed: bool,
}

impl TrackingPauseView {
    pub(crate) fn running_hint(self, running: Option<bool>) -> Option<bool> {
        if self.snapshot.is_active() && !self.stopped_confirmed {
            tray::pause_requested_running_hint(running)
        } else {
            running
        }
    }
}

pub(crate) enum IndefinitePauseStopOutcome {
    Paused(TrackerStatus),
    StillRunning(TrackerStatus),
    Ambiguous(TrackerError),
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct TrackingIntent {
    pub(crate) generation: u64,
    pub(crate) startup_generation: u64,
}

enum TimedPauseStopOutcome {
    Paused,
    StillRunning(TrackerStatus),
    Ambiguous(TrackerError),
}

impl TrackingPauseSnapshot {
    pub(crate) fn is_active(self) -> bool {
        !matches!(self, Self::Inactive)
    }
}

#[derive(Debug, Default)]
struct TrackingPauseLifecycle {
    generation: u64,
    shutting_down: bool,
    indefinite: bool,
    timed_pause: Option<TimedPause>,
    resume_in_flight: bool,
    auto_resume_failed: bool,
    stopped_confirmed: bool,
}

#[derive(Debug, Default)]
pub(crate) struct TrackingPauseState {
    lifecycle: Mutex<TrackingPauseLifecycle>,
    // Only durable intent changes use this lock. Never hold it during a
    // controller RPC: Pause must be saved while a slow Start owns operation.
    intent: Mutex<()>,
    operation: Mutex<()>,
}

impl TrackingPauseState {
    fn lock_intent(&self) -> MutexGuard<'_, ()> {
        self.intent
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub(crate) fn lock_operation(&self) -> MutexGuard<'_, ()> {
        self.operation
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub(crate) fn current_generation(&self) -> u64 {
        self.lifecycle
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .generation
    }

    pub(crate) fn generation_is_current(&self, generation: u64) -> bool {
        self.current_generation() == generation
    }

    fn permits_start_generation(&self, generation: u64) -> bool {
        let lifecycle = self
            .lifecycle
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        !lifecycle.shutting_down
            && lifecycle.generation == generation
            && ((!lifecycle.indefinite && lifecycle.timed_pause.is_none())
                || lifecycle.resume_in_flight)
    }

    fn pause_generation_is_active(&self, generation: u64) -> bool {
        let lifecycle = self
            .lifecycle
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        !lifecycle.shutting_down
            && lifecycle.generation == generation
            && (lifecycle.indefinite || lifecycle.timed_pause.is_some())
    }

    fn is_shutting_down(&self) -> bool {
        self.lifecycle
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .shutting_down
    }

    fn begin_exit(&self, startup_state: &TrackerStartupState) {
        let _intent = self.lock_intent();
        let mut lifecycle = self
            .lifecycle
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        lifecycle.generation = lifecycle.generation.wrapping_add(1);
        lifecycle.shutting_down = true;
        lifecycle.resume_in_flight = false;
        lifecycle.stopped_confirmed = false;
        startup_state.begin_stop_attempt();
        // Keep saved Pause and activation intact for the next app launch.
    }

    fn arm(&self, pause: TimedPause) -> u64 {
        let mut lifecycle = self
            .lifecycle
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        lifecycle.generation = lifecycle.generation.wrapping_add(1);
        lifecycle.indefinite = false;
        lifecycle.timed_pause = Some(pause);
        lifecycle.resume_in_flight = false;
        lifecycle.auto_resume_failed = false;
        lifecycle.stopped_confirmed = false;
        lifecycle.generation
    }

    pub(crate) fn cancel(&self) -> u64 {
        let mut lifecycle = self
            .lifecycle
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        lifecycle.generation = lifecycle.generation.wrapping_add(1);
        lifecycle.indefinite = false;
        lifecycle.timed_pause = None;
        lifecycle.resume_in_flight = false;
        lifecycle.auto_resume_failed = false;
        lifecycle.stopped_confirmed = false;
        lifecycle.generation
    }

    pub(crate) fn snapshot(&self) -> TrackingPauseSnapshot {
        self.view().snapshot
    }

    pub(crate) fn view(&self) -> TrackingPauseView {
        let lifecycle = self
            .lifecycle
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let snapshot = if let Some(pause) = lifecycle.timed_pause {
            if lifecycle.auto_resume_failed {
                TrackingPauseSnapshot::ResumeFailed {
                    resumes_at_unix_seconds: pause.resumes_at_unix_seconds,
                }
            } else {
                TrackingPauseSnapshot::Timed {
                    resumes_at_unix_seconds: pause.resumes_at_unix_seconds,
                }
            }
        } else if lifecycle.indefinite {
            TrackingPauseSnapshot::Indefinite
        } else {
            TrackingPauseSnapshot::Inactive
        };
        TrackingPauseView {
            snapshot,
            stopped_confirmed: lifecycle.stopped_confirmed,
        }
    }

    pub(crate) fn confirm_stopped(&self, generation: u64) -> bool {
        let mut lifecycle = self
            .lifecycle
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if lifecycle.generation != generation
            || lifecycle.shutting_down
            || (!lifecycle.indefinite && lifecycle.timed_pause.is_none())
        {
            return false;
        }
        lifecycle.stopped_confirmed = true;
        true
    }

    pub(crate) fn invalidate_stopped_confirmation(&self, generation: u64) {
        let mut lifecycle = self
            .lifecycle
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if lifecycle.generation == generation {
            lifecycle.stopped_confirmed = false;
        }
    }

    fn waiting_pause(&self, generation: u64) -> Option<TimedPause> {
        let lifecycle = self
            .lifecycle
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if lifecycle.shutting_down
            || lifecycle.generation != generation
            || lifecycle.resume_in_flight
            || lifecycle.auto_resume_failed
        {
            return None;
        }
        lifecycle.timed_pause
    }

    fn begin_due_resume(&self, generation: u64, now_unix_seconds: i64) -> bool {
        let mut lifecycle = self
            .lifecycle
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some(pause) = lifecycle.timed_pause else {
            return false;
        };
        if lifecycle.shutting_down
            || lifecycle.generation != generation
            || lifecycle.resume_in_flight
            || lifecycle.auto_resume_failed
            || pause.resumes_at_unix_seconds > now_unix_seconds
        {
            return false;
        }
        lifecycle.resume_in_flight = true;
        lifecycle.stopped_confirmed = false;
        true
    }

    fn complete_due_resume(&self, generation: u64, succeeded: bool) -> bool {
        let mut lifecycle = self
            .lifecycle
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if lifecycle.generation != generation || !lifecycle.resume_in_flight {
            return false;
        }
        lifecycle.resume_in_flight = false;
        lifecycle.stopped_confirmed = false;
        if succeeded {
            lifecycle.generation = lifecycle.generation.wrapping_add(1);
            lifecycle.indefinite = false;
            lifecycle.timed_pause = None;
            lifecycle.auto_resume_failed = false;
        } else {
            lifecycle.auto_resume_failed = true;
        }
        true
    }

    fn mark_auto_resume_failed(&self, generation: u64) -> bool {
        let mut lifecycle = self
            .lifecycle
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if lifecycle.generation != generation || lifecycle.timed_pause.is_none() {
            return false;
        }
        lifecycle.resume_in_flight = false;
        lifecycle.auto_resume_failed = true;
        true
    }

    fn mark_indefinite(&self) -> u64 {
        let mut lifecycle = self
            .lifecycle
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        lifecycle.generation = lifecycle.generation.wrapping_add(1);
        lifecycle.indefinite = true;
        lifecycle.timed_pause = None;
        lifecycle.resume_in_flight = false;
        lifecycle.auto_resume_failed = false;
        lifecycle.stopped_confirmed = false;
        lifecycle.generation
    }
}

pub(crate) fn state_path(app: &AppHandle) -> PathBuf {
    pause_state_path(app).unwrap_or_else(|_| PathBuf::from(PAUSE_STATE_FILE_NAME))
}

fn pause_state_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|directory| directory.join(PAUSE_STATE_FILE_NAME))
        .map_err(|error| format!("Could not resolve tracking-pause state path: {error}"))
}

fn write_pause_state(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Tracking-pause state path has no parent directory".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not create tracking-pause state directory: {error}"))?;
    let temp_path = parent.join(format!(
        ".{PAUSE_STATE_FILE_NAME}.{}.tmp",
        std::process::id()
    ));
    let bytes = serde_json::to_vec(value)
        .map_err(|error| format!("Could not encode tracking-pause state: {error}"))?;
    fs::write(&temp_path, bytes)
        .map_err(|error| format!("Could not write tracking-pause state: {error}"))?;
    fs::rename(&temp_path, path)
        .map_err(|error| format!("Could not install tracking-pause state: {error}"))?;
    Ok(())
}

fn write_timed_pause(path: &Path, pause: TimedPause) -> Result<(), String> {
    write_pause_state(path, &pause)
}

fn write_indefinite_pause(path: &Path, pause: IndefinitePause) -> Result<(), String> {
    write_pause_state(path, &pause)
}

fn read_persisted_pause(path: &Path) -> Result<Option<PersistedTrackingPause>, String> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Could not read tracking-pause state: {error}")),
    };
    if let Ok(pause) = serde_json::from_slice::<TimedPause>(&bytes) {
        if pause.is_valid() {
            return Ok(Some(PersistedTrackingPause::Timed(pause)));
        }
        return Err("Timed-pause state is invalid".to_string());
    }
    if let Ok(pause) = serde_json::from_slice::<IndefinitePause>(&bytes) {
        if pause.is_valid() {
            return Ok(Some(PersistedTrackingPause::Indefinite(pause)));
        }
        return Err("Indefinite-pause state is invalid".to_string());
    }
    Err("Could not decode tracking-pause state".to_string())
}

fn clear_pause_file(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Could not clear tracking-pause state: {error}")),
    }
}

fn should_restore_pause(pause: TimedPause, now_unix_seconds: i64) -> bool {
    pause.is_valid() && pause.resumes_at_unix_seconds > now_unix_seconds
}

fn timer_wait_seconds(pause: TimedPause, now_unix_seconds: i64) -> Option<u64> {
    if pause.resumes_at_unix_seconds <= now_unix_seconds {
        return None;
    }
    Some(
        (pause.resumes_at_unix_seconds - now_unix_seconds).clamp(1, TIMER_POLL_INTERVAL_SECONDS)
            as u64,
    )
}

pub(crate) fn prepare_indefinite_pause(app: &AppHandle) -> Result<TrackingIntent, String> {
    prepare_pause_at_path(
        &app.state::<TrackingPauseState>(),
        &app.state::<TrackerStartupState>(),
        &pause_state_path(app)?,
        PersistedTrackingPause::Indefinite(IndefinitePause::new(Utc::now().timestamp())),
    )
}

fn prepare_pause_at_path(
    state: &TrackingPauseState,
    startup_state: &TrackerStartupState,
    path: &Path,
    pause: PersistedTrackingPause,
) -> Result<TrackingIntent, String> {
    let _intent = state.lock_intent();
    if state.is_shutting_down() {
        return Err("tracking operations are shutting down".to_string());
    }
    let generation = match pause {
        PersistedTrackingPause::Indefinite(pause) => {
            write_indefinite_pause(path, pause)?;
            state.mark_indefinite()
        }
        PersistedTrackingPause::Timed(pause) => {
            write_timed_pause(path, pause)?;
            state.arm(pause)
        }
    };
    Ok(TrackingIntent {
        generation,
        startup_generation: startup_state.begin_stop_attempt(),
    })
}

pub(crate) fn finish_indefinite_pause_stop(
    app: &AppHandle,
    controller: &TrackerController,
    intent: TrackingIntent,
    stop_result: Result<TrackerStatus, TrackerError>,
) -> IndefinitePauseStopOutcome {
    let state = app.state::<TrackingPauseState>();
    let outcome = match stop_result {
        Ok(status) if status_confirms_stopped(&status) => IndefinitePauseStopOutcome::Paused(status),
        Ok(status) if status.running => IndefinitePauseStopOutcome::StillRunning(status),
        Ok(_) => IndefinitePauseStopOutcome::Ambiguous(TrackerError::TrackerReturnedError(
            "tracker stop status is unconfirmed".into(),
        )),
        Err(stop_error) if !state.generation_is_current(intent.generation) => {
            IndefinitePauseStopOutcome::Ambiguous(stop_error)
        }
        Err(stop_error) => match controller.get_status(app) {
            Ok(status) if status_confirms_stopped(&status) => IndefinitePauseStopOutcome::Paused(status),
            Ok(status) if status.running => IndefinitePauseStopOutcome::StillRunning(status),
            _ => IndefinitePauseStopOutcome::Ambiguous(stop_error),
        },
    };

    if matches!(&outcome, IndefinitePauseStopOutcome::Paused(_)) {
        state.confirm_stopped(intent.generation);
    } else {
        state.invalidate_stopped_confirmation(intent.generation);
    }
    if state.generation_is_current(intent.generation)
        && !matches!(&outcome, IndefinitePauseStopOutcome::Paused(_))
    {
        // The marker and lifecycle were committed before waiting for operation.
        // A late result must not recreate a pause cleared by a newer Resume.
        schedule_pause_enforcement(app, intent.generation);
    }
    outcome
}

fn status_confirms_stopped(status: &TrackerStatus) -> bool {
    !status.running && status.tracker_mode.as_deref() != Some("degraded")
}

fn resolve_timed_pause_stop(
    stop_result: Result<TrackerStatus, TrackerError>,
    status_probe: impl FnOnce() -> Result<TrackerStatus, TrackerError>,
) -> TimedPauseStopOutcome {
    match stop_result {
        Ok(status) if status_confirms_stopped(&status) => TimedPauseStopOutcome::Paused,
        Ok(status) if status.running => TimedPauseStopOutcome::StillRunning(status),
        Ok(_) => TimedPauseStopOutcome::Ambiguous(TrackerError::TrackerReturnedError(
            "tracker stop status is unconfirmed".into(),
        )),
        Err(stop_error) => match status_probe() {
            Ok(status) if status_confirms_stopped(&status) => TimedPauseStopOutcome::Paused,
            // A lost stop reply can arrive before the daemon finishes exiting.
            // A single still-running or failed status read cannot cancel the
            // user's durable pause intent.
            _ => TimedPauseStopOutcome::Ambiguous(stop_error),
        },
    }
}

pub(crate) fn snapshot(app: &AppHandle) -> TrackingPauseSnapshot {
    app.state::<TrackingPauseState>().snapshot()
}

pub(crate) fn begin_app_exit(app: &AppHandle) {
    app.state::<TrackingPauseState>()
        .begin_exit(&app.state::<TrackerStartupState>());
}

pub(crate) fn read_status_with_latest_pause(
    state: &TrackingPauseState,
    read: impl FnOnce() -> Result<TrackerStatus, TrackerError>,
) -> Result<TrackerStatus, TrackerError> {
    let generation = state.current_generation();
    let status = match read() {
        Ok(status) => status,
        Err(error) => {
            state.invalidate_stopped_confirmation(generation);
            return Err(error);
        }
    };
    if status_confirms_stopped(&status) {
        state.confirm_stopped(generation);
    } else {
        state.invalidate_stopped_confirmation(generation);
    }
    // Pause can be saved during a read that holds operation. Sample intent
    // after the observation and keep a running/unknown observation truthful.
    Ok(apply_tracking_pause_state(
        status,
        state.snapshot().is_active(),
    ))
}

pub(crate) fn read_status_with_startup_state(
    state: &TrackingPauseState,
    startup_state: &TrackerStartupState,
    read: impl FnOnce() -> Result<TrackerStatus, TrackerError>,
    publish_native: impl FnOnce(Option<bool>),
) -> Result<TrackerStatus, TrackerError> {
    let status = match read_status_with_latest_pause(state, read) {
        Ok(status) => status,
        Err(error) => {
            publish_native(None);
            return Err(error);
        }
    };
    // Startup failure decoration can turn a real stopped observation into a
    // degraded status. Publish the native evidence before that decoration.
    let running = if !status.running && status.tracker_mode.as_deref() == Some("degraded") {
        None
    } else {
        Some(status.running)
    };
    publish_native(running);
    Ok(apply_tracking_pause_state(
        apply_tracker_startup_state(startup_state, status),
        state.snapshot().is_active(),
    ))
}

pub(crate) fn prepare_manual_start(
    app: &AppHandle,
    resume_paused: bool,
) -> Result<Option<TrackingIntent>, String> {
    prepare_manual_start_at_path(
        &app.state::<TrackingPauseState>(),
        &app.state::<TrackerStartupState>(),
        &pause_state_path(app)?,
        resume_paused,
        || tracking_activation::activate(app),
    )
}

fn prepare_manual_start_at_path(
    state: &TrackingPauseState,
    startup_state: &TrackerStartupState,
    path: &Path,
    resume_paused: bool,
    activate: impl FnOnce() -> Result<(), String>,
) -> Result<Option<TrackingIntent>, String> {
    let _intent = state.lock_intent();
    if state.is_shutting_down() {
        return Err("tracking operations are shutting down".to_string());
    }
    if !resume_paused && blocks_implicit_start_at_path(state, path)? {
        return Ok(None);
    }
    // Activation and clearing are local durable intent, not evidence that the
    // daemon is running. Keep a failed activation/clear from erasing a pause.
    let startup_generation = startup_state.begin_start_attempt();
    if let Err(error) = activate().and_then(|()| {
        if resume_paused {
            clear_pause_file(path)
        } else {
            Ok(())
        }
    }) {
        startup_state.record_start_failure(
            startup_generation,
            &TrackerError::TrackerReturnedError(error.clone()),
        );
        return Err(error);
    }
    Ok(Some(TrackingIntent {
        generation: state.cancel(),
        startup_generation,
    }))
}

pub(crate) fn start_intent_is_current(app: &AppHandle, generation: u64) -> bool {
    let state = app.state::<TrackingPauseState>();
    let Ok(path) = pause_state_path(app) else {
        return false;
    };
    start_intent_is_current_at_path(&state, &path, generation)
}

fn start_intent_is_current_at_path(
    state: &TrackingPauseState,
    path: &Path,
    generation: u64,
) -> bool {
    let _intent = state.lock_intent();
    if !state.permits_start_generation(generation) {
        return false;
    }
    match read_persisted_pause(path) {
        Ok(None) => true,
        Ok(Some(_)) => false,
        Err(error) => {
            preserve_unreadable_pause(state, &error);
            false
        }
    }
}

pub(crate) fn run_start_unless_paused<T>(
    app: &AppHandle,
    resume_paused: bool,
    start: impl FnOnce(u64) -> T,
) -> Result<Option<T>, String> {
    run_start_unless_paused_at_path(
        &app.state::<TrackingPauseState>(),
        &pause_state_path(app)?,
        resume_paused,
        start,
    )
}

fn run_start_unless_paused_at_path<T>(
    state: &TrackingPauseState,
    path: &Path,
    resume_paused: bool,
    start: impl FnOnce(u64) -> T,
) -> Result<Option<T>, String> {
    let generation = {
        let _intent = state.lock_intent();
        if state.is_shutting_down() {
            return Ok(None);
        }
        if !resume_paused && blocks_implicit_start_at_path(state, path)? {
            return Ok(None);
        }
        state.current_generation()
    };
    Ok(Some(start(generation)))
}

fn blocks_implicit_start_at_path(state: &TrackingPauseState, path: &Path) -> Result<bool, String> {
    // A renderer can hold a status read from before startup restored the pause.
    // The disk marker must therefore guard an implicit start even when the
    // in-memory lifecycle has not been restored yet. An unreadable marker is
    // not permission to begin recording.
    if state.snapshot().is_active() {
        return Ok(true);
    }
    Ok(read_persisted_pause(path)?.is_some())
}

pub(crate) fn restore_on_startup(app: &AppHandle) -> bool {
    let state = app.state::<TrackingPauseState>();
    let _intent = state.lock_intent();
    let path = match pause_state_path(app) {
        Ok(path) => path,
        Err(error) => {
            eprintln!("[tracking-pause] {error}");
            // Without the state path startup cannot prove that the user did
            // not pause tracking. Keep the native automatic start stopped.
            app.state::<TrackingPauseState>().mark_indefinite();
            return true;
        }
    };
    let pause = match read_persisted_pause(&path) {
        Ok(Some(pause)) => pause,
        Ok(None) => return false,
        Err(error) => {
            // An unreadable marker may be the only durable evidence of a
            // paused tracker. Preserve it so an explicit Resume can clear it,
            // and stop native startup from recording in the meantime.
            preserve_unreadable_pause(&app.state::<TrackingPauseState>(), &error);
            return true;
        }
    };
    match pause {
        PersistedTrackingPause::Indefinite(_) => {
            app.state::<TrackingPauseState>().mark_indefinite();
            true
        }
        PersistedTrackingPause::Timed(pause) => {
            if !should_restore_pause(pause, Utc::now().timestamp()) {
                return clear_restored_timed_pause_or_preserve(
                    &app.state::<TrackingPauseState>(),
                    pause,
                    || clear_pause_file(&path),
                );
            }
            let generation = app.state::<TrackingPauseState>().arm(pause);
            if let Err(error) = schedule_timed_resume(app.clone(), generation) {
                eprintln!("[tracking-pause] Could not schedule restored pause: {error}");
                return clear_restored_timed_pause_or_preserve(
                    &app.state::<TrackingPauseState>(),
                    pause,
                    || clear_pause_file(&path),
                );
            }
            true
        }
    }
}

fn clear_restored_timed_pause_or_preserve(
    state: &TrackingPauseState,
    pause: TimedPause,
    clear: impl FnOnce() -> Result<(), String>,
) -> bool {
    match clear() {
        Ok(()) => {
            state.cancel();
            false
        }
        Err(error) => {
            // A marker that could not be removed still blocks implicit start.
            // Reflect that durable state in memory and require explicit Resume.
            let generation = state.arm(pause);
            state.mark_auto_resume_failed(generation);
            eprintln!("[tracking-pause] Could not clear restored timed pause: {error}");
            true
        }
    }
}

fn preserve_unreadable_pause(state: &TrackingPauseState, error: &str) {
    eprintln!("[tracking-pause] {error}; preserving pause until explicit Resume");
    state.mark_indefinite();
}

pub(crate) fn enforce_restored_pause(app: &AppHandle) {
    let generation = app.state::<TrackingPauseState>().current_generation();
    enforce_pause_generation(app, generation);
}

fn schedule_pause_enforcement(app: &AppHandle, generation: u64) {
    let enforcement_app = app.clone();
    let _ = async_runtime::spawn_blocking(move || {
        enforce_pause_generation(&enforcement_app, generation);
    });
}

fn enforce_pause_generation(app: &AppHandle, generation: u64) {
    let state = app.state::<TrackingPauseState>();
    let controller = *app.state::<TrackerController>();
    enforce_pause_until_stopped(
        &state,
        generation,
        || {
            let result = resolve_timed_pause_stop(controller.stop(app), || {
                if state.generation_is_current(generation) {
                    controller.get_status(app)
                } else {
                    Err(TrackerError::TrackerReturnedError(
                        "pause stop was superseded".into(),
                    ))
                }
            });
            if !state.generation_is_current(generation) {
                return true;
            }
            match &result {
                TimedPauseStopOutcome::Paused => {
                    state.confirm_stopped(generation);
                    tray::queue_tracking_controls_refresh(app, Some(false));
                }
                TimedPauseStopOutcome::StillRunning(status) => {
                    tray::queue_tracking_controls_refresh(app, Some(status.running));
                }
                TimedPauseStopOutcome::Ambiguous(error) => {
                    eprintln!("[tracking-pause] Could not confirm the paused tracker: {error}");
                    tray::queue_tracking_controls_refresh(app, None);
                }
            }
            matches!(result, TimedPauseStopOutcome::Paused)
        },
        thread::sleep,
    );
}

fn enforce_pause_until_stopped(
    state: &TrackingPauseState,
    generation: u64,
    mut stop_and_confirm: impl FnMut() -> bool,
    mut wait: impl FnMut(Duration),
) {
    let mut failed_attempts = 0_usize;
    loop {
        let mut stopped = false;
        let active = run_if_pause_generation_active(state, generation, || {
            stopped = stop_and_confirm();
        });
        if !active || stopped {
            return;
        }
        failed_attempts = failed_attempts.saturating_add(1);
        wait(pause_enforcement_retry_delay(failed_attempts));
    }
}

fn run_if_pause_generation_active(
    state: &TrackingPauseState,
    generation: u64,
    action: impl FnOnce(),
) -> bool {
    let _operation = state.lock_operation();
    if !state.pause_generation_is_active(generation) {
        return false;
    }
    action();
    true
}

fn pause_enforcement_retry_delay(failed_attempts: usize) -> Duration {
    let exponent = failed_attempts.saturating_sub(3).min(4) as u32;
    PAUSE_ENFORCEMENT_RETRY_DELAY
        .saturating_mul(1_u32 << exponent)
        .min(PAUSE_ENFORCEMENT_MAX_RETRY_DELAY)
}

pub(crate) fn pause_tracking_for(app: &AppHandle, minutes: u64) {
    if !matches!(minutes, 15 | 30 | 60) {
        return;
    }
    let paused_at = Utc::now().timestamp();
    let resumes_at = paused_at.saturating_add((minutes as i64).saturating_mul(60));
    let pause = TimedPause::new(paused_at, resumes_at);
    let state = app.state::<TrackingPauseState>();
    let intent = match pause_state_path(app).and_then(|path| {
        prepare_pause_at_path(
            &state,
            &app.state::<TrackerStartupState>(),
            &path,
            PersistedTrackingPause::Timed(pause),
        )
    }) {
        Ok(intent) => intent,
        Err(error) => {
            eprintln!("[tracking-pause] Refusing an unpersisted timed pause: {error}");
            return;
        }
    };
    tray::queue_pause_requested_refresh(app);
    if let Err(error) = schedule_timed_resume(app.clone(), intent.generation) {
        eprintln!("[tracking-pause] Could not schedule pause: {error}");
        state.mark_auto_resume_failed(intent.generation);
    }
    // Timed actions originate on the menu thread. Save intent there, but keep
    // controller serialization and its potentially slow wait on a worker.
    let worker_app = app.clone();
    let _ = async_runtime::spawn_blocking(move || {
        finish_timed_pause_stop(&worker_app, intent);
    });
}

fn finish_timed_pause_stop(app: &AppHandle, intent: TrackingIntent) {
    let state = app.state::<TrackingPauseState>();
    let _operation = state.lock_operation();
    if !state.generation_is_current(intent.generation) || !state.snapshot().is_active() {
        return;
    }
    let controller = *app.state::<TrackerController>();
    let (needs_enforcement, running_hint) =
        match resolve_timed_pause_stop(controller.stop(app), || {
            if state.generation_is_current(intent.generation) {
                controller.get_status(app)
            } else {
                Err(TrackerError::TrackerReturnedError(
                    "pause stop was superseded".into(),
                ))
            }
        }) {
            TimedPauseStopOutcome::Paused => (false, Some(false)),
            TimedPauseStopOutcome::StillRunning(status) => {
                eprintln!("[tracking-pause] Tracker still reports running after pause request");
                (true, Some(status.running))
            }
            TimedPauseStopOutcome::Ambiguous(error) => {
                eprintln!(
                    "[tracking-pause] Preserving timed pause after an ambiguous stop: {error}"
                );
                (true, None)
            }
        };
    if !state.generation_is_current(intent.generation) {
        return;
    }
    if running_hint == Some(false) {
        state.confirm_stopped(intent.generation);
        app.state::<TrackerStartupState>()
            .complete_stop_success(intent.startup_generation);
    }
    tray::queue_tracking_controls_refresh(app, running_hint);
    if needs_enforcement {
        schedule_pause_enforcement(app, intent.generation);
    }
}

fn schedule_timed_resume(app: AppHandle, generation: u64) -> io::Result<()> {
    thread::Builder::new()
        .name("drifty-timed-pause".into())
        .spawn(move || timed_resume_loop(app, generation))?;
    Ok(())
}

fn timed_resume_loop(app: AppHandle, generation: u64) {
    loop {
        let Some(pause) = app.state::<TrackingPauseState>().waiting_pause(generation) else {
            return;
        };
        let now = Utc::now().timestamp();
        let Some(wait_seconds) = timer_wait_seconds(pause, now) else {
            break;
        };
        thread::sleep(Duration::from_secs(wait_seconds));
    }

    let state = app.state::<TrackingPauseState>();
    let _operation = state.lock_operation();
    let controller = *app.state::<TrackerController>();
    let startup_state = app.state::<TrackerStartupState>();
    let startup_generation = match pause_state_path(&app).and_then(|path| {
        prepare_due_resume_at_path(
            &state,
            &startup_state,
            &path,
            generation,
            Utc::now().timestamp(),
        )
    }) {
        Ok(Some(generation)) => generation,
        Ok(None) => return,
        Err(error) => {
            tray::queue_tracking_controls_ui_refresh(&app);
            eprintln!(
                "[tracking-pause] Automatic resume was skipped because its durable pause could not be cleared: {error}"
            );
            return;
        }
    };
    // The pause marker has been cleared above. A lost sidecar reply must not
    // leave a live daemon hidden behind a failed automatic-resume state.
    let start = finish_due_resume_start(
        &state,
        generation,
        &startup_state,
        startup_generation,
        || controller.start_with_recovery(&app, generation),
    );
    match start {
        Ok(Some(status)) if status.running => {
            tray::queue_tracking_controls_refresh(&app, Some(status.running));
            if state.generation_is_current(generation.wrapping_add(1)) {
                let _ = app
                    .notification()
                    .builder()
                    .title("Tracking resumed")
                    .body("Drifty resumed tracking after your timed pause.")
                    .show();
            }
        }
        Ok(Some(status)) => {
            tray::queue_tracking_controls_refresh(&app, Some(status.running));
            eprintln!("[tracking-pause] Automatic resume returned a stopped tracker");
        }
        Ok(None) => {}
        Err(error) => {
            tray::queue_tracking_controls_refresh(&app, None);
            eprintln!("[tracking-pause] Automatic resume failed: {error}");
        }
    }
}

fn prepare_due_resume_at_path(
    state: &TrackingPauseState,
    startup_state: &TrackerStartupState,
    path: &Path,
    generation: u64,
    now_unix_seconds: i64,
) -> Result<Option<u64>, String> {
    let _intent = state.lock_intent();
    if !state.begin_due_resume(generation, now_unix_seconds) {
        return Ok(None);
    }
    let startup_generation = startup_state.begin_start_attempt();
    if let Err(error) = clear_pause_file(path) {
        startup_state.record_start_failure(
            startup_generation,
            &TrackerError::TrackerReturnedError(error.clone()),
        );
        state.complete_due_resume(generation, false);
        return Err(error);
    }
    Ok(Some(startup_generation))
}

fn finish_due_resume_start(
    state: &TrackingPauseState,
    pause_generation: u64,
    startup_state: &TrackerStartupState,
    startup_generation: u64,
    start: impl FnOnce() -> Result<TrackerStatus, TrackerError>,
) -> Result<Option<TrackerStatus>, TrackerError> {
    let result = start();
    let _intent = state.lock_intent();
    if !state.generation_is_current(pause_generation) {
        // A Pause or explicit Resume arrived during the RPC. Its marker and
        // lifecycle already won; an old timer cannot publish or cancel it.
        return Ok(None);
    }
    match result {
        Ok(status) if status.running => {
            startup_state.complete_start_success(startup_generation);
            state.complete_due_resume(pause_generation, true);
            Ok(Some(status))
        }
        Ok(status) => {
            let error = TrackerError::TrackerReturnedError(
                "tracker did not report running after automatic resume".to_string(),
            );
            startup_state.record_start_failure(startup_generation, &error);
            state.complete_due_resume(pause_generation, false);
            Ok(Some(status))
        }
        Err(error) => {
            startup_state.record_start_failure(startup_generation, &error);
            state.complete_due_resume(pause_generation, false);
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tracker::reconcile_start_result_with_status;
    use tempfile::tempdir;

    fn tracker_status(running: bool) -> TrackerStatus {
        serde_json::from_value(serde_json::json!({
            "running": running,
            "accessibilityGranted": false,
        }))
        .expect("valid tracker status")
    }

    #[test]
    fn pause_is_durable_before_a_slow_start_releases_the_operation_lock() {
        use std::sync::{mpsc, Arc};

        let directory = tempdir().expect("tempdir");
        let path = directory.path().join(PAUSE_STATE_FILE_NAME);
        let state = Arc::new(TrackingPauseState::default());
        let startup_state = Arc::new(TrackerStartupState::default());
        let cached_running_before_start = Some(false);
        let tray_state = tray::TrayDriftAlarmState::default();
        let stale_renderer_status = || {
            serde_json::from_value(serde_json::json!({
                "enabled": true,
                "statusLabel": "Drift alerts: Monitoring",
                "lastCheckedAt": null,
                "lastCheckedLabel": "Never",
                "resultLabel": "No eligible drift",
                "trackerRunning": cached_running_before_start,
            }))
            .expect("valid renderer tray status")
        };
        tray_state
            .publish_renderer_status(stale_renderer_status(), || state.view())
            .expect("initial renderer status before Start");
        let start = prepare_manual_start_at_path(&state, &startup_state, &path, true, || Ok(()))
            .expect("durable start")
            .expect("start intent");
        let slow_start = state.lock_operation();
        let worker_state = Arc::clone(&state);
        let worker_startup = Arc::clone(&startup_state);
        let worker_path = path.clone();
        let (saved_tx, saved_rx) = mpsc::channel();
        let worker = thread::spawn(move || {
            let pause = prepare_pause_at_path(
                &worker_state,
                &worker_startup,
                &worker_path,
                PersistedTrackingPause::Indefinite(IndefinitePause::new(100)),
            )
            .expect("persist pause without waiting for Start");
            saved_tx.send(pause).expect("report saved intent");
            run_if_pause_generation_active(&worker_state, pause.generation, || {})
        });
        let saved = saved_rx.recv_timeout(Duration::from_secs(2));
        // Release before any assertion can unwind so a regression cannot leave
        // a blocked worker behind. Receipt itself proves it did not wait on RPC.
        let persisted_before_release = read_persisted_pause(&path);
        let superseded = !start_intent_is_current_at_path(&state, &path, start.generation);
        let pre_helper_render_hint = state.view().running_hint(tray_state.tracker_running());
        let pre_helper_publish =
            tray_state.publish_renderer_status(stale_renderer_status(), || state.view());
        let pre_helper_running = tray_state.tracker_running();
        let early_hint = tray_state.mark_pause_requested(|| state.view());
        let stale_publish = tray_state
            .publish_renderer_status(stale_renderer_status(), || state.view());
        let pending_running_hint = tray_state.tracker_running();
        drop(slow_start);
        assert!(worker.join().expect("pause worker joins"));
        let saved = saved.expect("Pause must be saved while Start still owns operation");
        assert!(matches!(
            persisted_before_release.expect("read marker"),
            Some(PersistedTrackingPause::Indefinite(_))
        ));
        assert!(
            superseded,
            "the old Start cannot recover or clear the new Pause"
        );
        assert!(state.generation_is_current(saved.generation));
        pre_helper_publish.expect("renderer update between prepare and the early helper");
        assert_eq!(pre_helper_render_hint, None, "new Pause is unconfirmed immediately");
        assert_eq!(pre_helper_running, None, "helper-before-publisher ordering is not required");
        early_hint.expect("save native unknown before the UI callback");
        stale_publish.expect("renderer metrics may still be published during Pause");
        assert_eq!(
            pending_running_hint, None,
            "a stale renderer status cannot confirm Pause while Start still owns operation"
        );
        let observed = read_status_with_latest_pause(&state, || Ok(tracker_status(true)))
            .expect("the held Start's running reply remains observable");
        assert!(observed.running && observed.tracking_paused);
        let restarted = TrackingPauseState::default();
        assert!(blocks_implicit_start_at_path(&restarted, &path).expect("restart marker"));
    }

    #[test]
    fn pause_stopped_confirmation_belongs_only_to_the_current_generation() {
        let state = TrackingPauseState::default();
        let first = state.mark_indefinite();
        assert!(!state.view().stopped_confirmed);
        assert_eq!(state.view().running_hint(Some(false)), None);
        assert!(state.confirm_stopped(first));
        assert_eq!(state.view().running_hint(Some(false)), Some(false));

        let second = state.arm(TimedPause::new(100, 200));
        assert!(!state.confirm_stopped(first), "an old Stop cannot confirm a new Pause");
        assert!(!state.view().stopped_confirmed);
        assert_eq!(state.view().running_hint(Some(false)), None);
        assert!(state.confirm_stopped(second));
        assert_eq!(state.view().running_hint(Some(false)), Some(false));
        state.invalidate_stopped_confirmation(first);
        assert!(state.view().stopped_confirmed, "an old unknown reply cannot replace fresh proof");
        state.mark_indefinite();
        assert!(!state.view().stopped_confirmed, "restored/corrupt/new indefinite Pause starts unconfirmed");
    }

    #[test]
    fn pause_confirmation_refuses_errors_degraded_and_superseded_native_reads() {
        let state = TrackingPauseState::default();
        let generation = state.mark_indefinite();
        let fresh = read_status_with_latest_pause(&state, || Ok(tracker_status(false)))
            .expect("fresh stopped status");
        assert!(!fresh.running && state.view().stopped_confirmed);

        assert!(read_status_with_latest_pause(&state, || Err(
            TrackerError::CommandFailed("status unavailable".into())
        )).is_err());
        assert!(!state.view().stopped_confirmed);
        assert!(state.confirm_stopped(generation));
        read_status_with_latest_pause(&state, || Ok(crate::tracker::degraded_tracker_status(
            "status unavailable".into()
        )))
        .expect("degraded status remains visible");
        assert!(!state.view().stopped_confirmed, "degraded false is not stopped proof");

        read_status_with_latest_pause(&state, || {
            state.mark_indefinite();
            Ok(tracker_status(false))
        })
        .expect("Pause changes while the native status read is pending");
        assert!(!state.view().stopped_confirmed, "old-generation status cannot confirm the new Pause");
        read_status_with_latest_pause(&state, || Ok(tracker_status(false)))
            .expect("fresh read for the new generation");
        assert!(state.view().stopped_confirmed);
        read_status_with_latest_pause(&state, || Ok(tracker_status(true)))
            .expect("running observation");
        assert!(!state.view().stopped_confirmed);
    }

    #[test]
    fn pause_native_status_is_published_before_startup_failure_decoration() {
        let state = TrackingPauseState::default();
        let generation = state.mark_indefinite();
        let startup_state = TrackerStartupState::default();
        let startup_generation = startup_state.begin_start_attempt();
        assert!(startup_state.record_start_failure(startup_generation, &TrackerError::CommandFailed(
            "automatic Resume failed".into()
        )));
        let mut published = Vec::new();
        let decorated = read_status_with_startup_state(
            &state, &startup_state,
            || Ok(tracker_status(false)),
            |hint| {
                assert!(state.view().stopped_confirmed, "raw native stopped proof is current");
                published.push(hint);
            },
        )
        .expect("fresh false remains known despite startup diagnostics");
        assert_eq!(published, vec![Some(false)]);
        assert_eq!(decorated.tracker_mode.as_deref(), Some("degraded"));
        assert_eq!(state.view().running_hint(Some(false)), Some(false));

        published.clear();
        assert!(read_status_with_startup_state(
            &state, &startup_state,
            || Err(TrackerError::CommandFailed("status failed".into())),
            |hint| published.push(hint),
        ).is_err());
        assert_eq!(published, vec![None]);
        assert!(!state.view().stopped_confirmed);

        assert!(state.confirm_stopped(generation));
        published.clear();
        read_status_with_startup_state(
            &state, &startup_state,
            || Ok(crate::tracker::degraded_tracker_status("status failed".into())),
            |hint| published.push(hint),
        )
        .expect("raw degraded fallback remains unknown");
        assert_eq!(published, vec![None]);
        assert!(!state.view().stopped_confirmed);
    }

    #[test]
    fn pause_stopped_confirmation_is_invalidated_by_manual_timed_resume_and_exit() {
        let state = TrackingPauseState::default();
        let generation = state.mark_indefinite();
        assert!(state.confirm_stopped(generation));
        state.cancel();
        assert!(!state.view().stopped_confirmed);
        assert_eq!(state.view().snapshot, TrackingPauseSnapshot::Inactive);

        let timed = state.arm(TimedPause::new(100, 200));
        assert!(state.confirm_stopped(timed));
        assert!(state.begin_due_resume(timed, 200));
        assert!(!state.view().stopped_confirmed, "automatic Resume may issue Start now");
        assert!(state.complete_due_resume(timed, false));
        assert!(!state.view().stopped_confirmed);
        assert!(state.confirm_stopped(timed));
        state.begin_exit(&TrackerStartupState::default());
        assert!(!state.view().stopped_confirmed);
        assert!(!state.confirm_stopped(timed), "Exit invalidates older confirmation work");
    }

    #[test]
    fn queued_implicit_start_preserves_a_new_pause_without_sending_start() {
        use std::sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        };

        let directory = tempdir().expect("tempdir");
        let path = directory.path().join(PAUSE_STATE_FILE_NAME);
        let state = Arc::new(TrackingPauseState::default());
        let startup_state = TrackerStartupState::default();
        let start = prepare_manual_start_at_path(&state, &startup_state, &path, false, || Ok(()))
            .expect("implicit start preparation")
            .expect("unpaused start");
        let held_operation = state.lock_operation();
        let worker_state = Arc::clone(&state);
        let worker_path = path.clone();
        let starts = Arc::new(AtomicUsize::new(0));
        let worker_starts = Arc::clone(&starts);
        let worker = thread::spawn(move || {
            let _operation = worker_state.lock_operation();
            if start_intent_is_current_at_path(&worker_state, &worker_path, start.generation) {
                worker_starts.fetch_add(1, Ordering::SeqCst);
            }
        });
        prepare_pause_at_path(
            &state,
            &startup_state,
            &path,
            PersistedTrackingPause::Indefinite(IndefinitePause::new(100)),
        )
        .expect("new pause wins while implicit start waits");
        drop(held_operation);
        worker.join().expect("queued start joins");
        assert_eq!(starts.load(Ordering::SeqCst), 0);
        assert!(
            path.exists(),
            "the queued implicit Start must not erase Pause"
        );
        assert_eq!(state.snapshot(), TrackingPauseSnapshot::Indefinite);
        assert!(
            prepare_manual_start_at_path(&state, &startup_state, &path, false, || {
                panic!("a paused implicit start must not activate or clear")
            })
            .expect("paused implicit start")
            .is_none()
        );
    }

    #[test]
    fn newer_explicit_resume_wins_over_a_queued_stop_and_its_enforcement() {
        use std::sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        };

        let directory = tempdir().expect("tempdir");
        let path = directory.path().join(PAUSE_STATE_FILE_NAME);
        let state = Arc::new(TrackingPauseState::default());
        let startup_state = TrackerStartupState::default();
        let held_start = state.lock_operation();
        let pause = prepare_pause_at_path(
            &state,
            &startup_state,
            &path,
            PersistedTrackingPause::Indefinite(IndefinitePause::new(100)),
        )
        .expect("early Pause intent");
        let worker_state = Arc::clone(&state);
        let stops = Arc::new(AtomicUsize::new(0));
        let worker_stops = Arc::clone(&stops);
        let old_stop = thread::spawn(move || {
            run_if_pause_generation_active(&worker_state, pause.generation, || {
                worker_stops.fetch_add(1, Ordering::SeqCst);
            })
        });
        let resume = prepare_manual_start_at_path(&state, &startup_state, &path, true, || {
            assert!(path.exists(), "activation must precede marker clear");
            assert!(state.snapshot().is_active());
            Ok(())
        })
        .expect("new durable Resume")
        .expect("Resume intent");
        assert!(!path.exists());
        assert_eq!(state.snapshot(), TrackingPauseSnapshot::Inactive);
        assert!(start_intent_is_current_at_path(
            &state,
            &path,
            resume.generation
        ));
        drop(held_start);
        assert!(!old_stop.join().expect("old Stop joins"));
        enforce_pause_until_stopped(
            &state,
            pause.generation,
            || {
                stops.fetch_add(1, Ordering::SeqCst);
                true
            },
            |_| panic!("a superseded pause must not retry"),
        );
        assert_eq!(stops.load(Ordering::SeqCst), 0);
        assert!(!startup_state.complete_stop_success(pause.startup_generation));
        assert!(startup_state.complete_start_success(resume.startup_generation));
        assert!(
            !path.exists(),
            "an old Stop completion cannot restore its marker"
        );
    }

    #[test]
    fn a_status_read_reports_pause_requested_during_the_read_without_hiding_running() {
        let directory = tempdir().expect("tempdir");
        let path = directory.path().join(PAUSE_STATE_FILE_NAME);
        let state = TrackingPauseState::default();
        let startup_state = TrackerStartupState::default();
        let observed = read_status_with_latest_pause(&state, || {
            prepare_pause_at_path(
                &state,
                &startup_state,
                &path,
                PersistedTrackingPause::Indefinite(IndefinitePause::new(100)),
            )
            .expect("Pause arrives before the status reply");
            Ok(tracker_status(true))
        })
        .expect("status remains observable");
        assert!(observed.running, "intent is not stopped-daemon evidence");
        assert!(observed.tracking_paused);
        assert_eq!(observed.tracker_mode.as_deref(), Some("degraded"));
        assert_eq!(
            observed.message.as_deref(),
            Some(crate::tracker::TRACKER_PAUSE_STILL_RUNNING_MESSAGE)
        );
    }

    #[test]
    fn failed_manual_resume_preserves_durable_pause_and_its_generation() {
        let directory = tempdir().expect("tempdir");
        let path = directory.path().join(PAUSE_STATE_FILE_NAME);
        let state = TrackingPauseState::default();
        let startup_state = TrackerStartupState::default();
        let pause = prepare_pause_at_path(
            &state,
            &startup_state,
            &path,
            PersistedTrackingPause::Indefinite(IndefinitePause::new(100)),
        )
        .expect("Pause intent");
        assert!(
            prepare_manual_start_at_path(&state, &startup_state, &path, true, || Err(
                "activation write failed".into()
            ))
            .is_err()
        );
        assert!(path.exists());
        assert!(state.generation_is_current(pause.generation));
        fs::remove_file(&path).expect("replace marker with unwritable directory");
        fs::create_dir(&path).expect("directory cannot be cleared as a file");
        assert!(
            prepare_manual_start_at_path(&state, &startup_state, &path, true, || Ok(())).is_err()
        );
        assert!(state.generation_is_current(pause.generation));
        assert_eq!(state.snapshot(), TrackingPauseSnapshot::Indefinite);
    }

    #[test]
    fn a_corrupt_marker_blocks_an_already_prepared_start_until_explicit_resume() {
        let directory = tempdir().expect("tempdir");
        let path = directory.path().join(PAUSE_STATE_FILE_NAME);
        let state = TrackingPauseState::default();
        let startup_state = TrackerStartupState::default();
        let start = prepare_manual_start_at_path(&state, &startup_state, &path, false, || Ok(()))
            .expect("prepare start")
            .expect("start token");
        fs::write(&path, b"invalid pause").expect("corrupt marker during operation wait");
        assert!(!start_intent_is_current_at_path(
            &state,
            &path,
            start.generation
        ));
        assert_eq!(state.snapshot(), TrackingPauseSnapshot::Indefinite);
        assert!(path.exists());
        let resume = prepare_manual_start_at_path(&state, &startup_state, &path, true, || Ok(()))
            .expect("explicit Resume clears corrupt marker")
            .expect("Resume intent");
        assert!(start_intent_is_current_at_path(
            &state,
            &path,
            resume.generation
        ));
        assert!(!path.exists());
    }

    #[test]
    fn a_new_pause_during_timed_resume_preserves_the_new_marker_and_suppresses_old_completion() {
        let directory = tempdir().expect("tempdir");
        let path = directory.path().join(PAUSE_STATE_FILE_NAME);
        let state = TrackingPauseState::default();
        let startup_state = TrackerStartupState::default();
        let timed = prepare_pause_at_path(
            &state,
            &startup_state,
            &path,
            PersistedTrackingPause::Timed(TimedPause::new(100, 200)),
        )
        .expect("timed Pause intent");
        let startup_generation =
            prepare_due_resume_at_path(&state, &startup_state, &path, timed.generation, 200)
                .expect("prepare automatic resume")
                .expect("due timer");
        assert!(!path.exists());
        assert!(start_intent_is_current_at_path(
            &state,
            &path,
            timed.generation
        ));
        let result = finish_due_resume_start(
            &state,
            timed.generation,
            &startup_state,
            startup_generation,
            || {
                prepare_pause_at_path(
                    &state,
                    &startup_state,
                    &path,
                    PersistedTrackingPause::Indefinite(IndefinitePause::new(201)),
                )
                .expect("new Pause during automatic Start RPC");
                Ok(tracker_status(true))
            },
        )
        .expect("superseded timer is silent");
        assert!(result.is_none());
        assert!(matches!(
            read_persisted_pause(&path).expect("new marker survives"),
            Some(PersistedTrackingPause::Indefinite(_))
        ));
        assert_eq!(state.snapshot(), TrackingPauseSnapshot::Indefinite);
        let observed = read_status_with_latest_pause(&state, || Ok(tracker_status(true)))
            .expect("actual running is still reported");
        assert!(observed.running && observed.tracking_paused);
    }

    #[test]
    fn newer_manual_resume_invalidates_a_due_timer_before_it_can_clear_or_start() {
        let directory = tempdir().expect("tempdir");
        let path = directory.path().join(PAUSE_STATE_FILE_NAME);
        let state = TrackingPauseState::default();
        let startup_state = TrackerStartupState::default();
        let timed = prepare_pause_at_path(
            &state,
            &startup_state,
            &path,
            PersistedTrackingPause::Timed(TimedPause::new(100, 200)),
        )
        .expect("timed Pause");
        let resume = prepare_manual_start_at_path(&state, &startup_state, &path, true, || Ok(()))
            .expect("manual Resume")
            .expect("manual intent");
        assert!(
            prepare_due_resume_at_path(&state, &startup_state, &path, timed.generation, 200)
                .expect("stale timer is skipped")
                .is_none()
        );
        assert!(start_intent_is_current_at_path(
            &state,
            &path,
            resume.generation
        ));
        assert_eq!(state.snapshot(), TrackingPauseSnapshot::Inactive);
        assert!(!path.exists());
    }

    #[test]
    fn committed_app_exit_invalidates_queued_start_and_rejects_later_activation() {
        let directory = tempdir().expect("tempdir");
        let path = directory.path().join(PAUSE_STATE_FILE_NAME);
        let state = TrackingPauseState::default();
        let startup_state = TrackerStartupState::default();
        let start = prepare_manual_start_at_path(&state, &startup_state, &path, true, || Ok(()))
            .expect("prepared manual Start")
            .expect("start intent");
        let _held_start = state.lock_operation();
        let coordinator = crate::AppExitCoordinator::default();
        coordinator.shutdown_once(|| state.begin_exit(&startup_state));
        assert!(
            !start_intent_is_current_at_path(&state, &path, start.generation),
            "manual, tray, startup and recovery Start share the closing guard"
        );
        assert!(
            run_start_unless_paused_at_path(&state, &path, false, |_| panic!(
                "native startup must not send a mutation after Exit"
            ))
            .expect("native launch is skipped")
            .is_none()
        );
        assert!(
            prepare_manual_start_at_path(&state, &startup_state, &path, true, || panic!(
                "a command after Exit must not write activation"
            ))
            .is_err()
        );
        assert!(!startup_state.complete_start_success(start.startup_generation));
        assert!(!path.exists(), "Exit must not invent a durable Pause");
        let next_launch = TrackingPauseState::default();
        assert!(!blocks_implicit_start_at_path(&next_launch, &path).expect("normal next launch"));
    }

    #[test]
    fn committed_app_exit_preserves_pause_marker_and_cancels_timer_and_restore_work() {
        let directory = tempdir().expect("tempdir");
        let path = directory.path().join(PAUSE_STATE_FILE_NAME);
        let state = TrackingPauseState::default();
        let startup_state = TrackerStartupState::default();
        let pause = TimedPause::new(100, 200);
        let intent = prepare_pause_at_path(
            &state,
            &startup_state,
            &path,
            PersistedTrackingPause::Timed(pause),
        )
        .expect("durable timed Pause");
        state.begin_exit(&startup_state);
        assert!(state.waiting_pause(intent.generation).is_none());
        assert!(
            prepare_due_resume_at_path(&state, &startup_state, &path, intent.generation, 200)
                .expect("old timer is cancelled")
                .is_none()
        );
        assert!(!run_if_pause_generation_active(
            &state,
            state.current_generation(),
            || panic!("a late restore worker must not start controller work during Exit")
        ));
        assert_eq!(
            read_persisted_pause(&path).expect("marker survives Exit"),
            Some(PersistedTrackingPause::Timed(pause))
        );
        assert_eq!(
            state.snapshot(),
            TrackingPauseSnapshot::Timed {
                resumes_at_unix_seconds: 200
            }
        );
        let next_launch = TrackingPauseState::default();
        assert!(blocks_implicit_start_at_path(&next_launch, &path).expect("restart restores Pause"));
    }

    #[test]
    fn timed_pause_recovers_a_lost_stop_reply_without_cancelling_pause_intent() {
        let lost_reply = || TrackerError::CommandFailed("stop reply lost".to_string());
        assert!(matches!(
            resolve_timed_pause_stop(Err(lost_reply()), || Ok(tracker_status(false))),
            TimedPauseStopOutcome::Paused
        ));
        assert!(matches!(
            resolve_timed_pause_stop(Err(lost_reply()), || Ok(tracker_status(true))),
            TimedPauseStopOutcome::Ambiguous(_)
        ));
        assert!(matches!(
            resolve_timed_pause_stop(Err(lost_reply()), || Err(lost_reply())),
            TimedPauseStopOutcome::Ambiguous(_)
        ));
        assert!(matches!(
            resolve_timed_pause_stop(Err(lost_reply()), || Ok(crate::tracker::degraded_tracker_status(
                "status unavailable".into()
            ))),
            TimedPauseStopOutcome::Ambiguous(_)
        ));
        assert!(matches!(
            resolve_timed_pause_stop(Ok(crate::tracker::degraded_tracker_status(
                "status unavailable".into()
            )), || panic!("a degraded reply is not a fresh stopped confirmation")),
            TimedPauseStopOutcome::Ambiguous(_)
        ));
        assert!(matches!(
            resolve_timed_pause_stop(Ok(tracker_status(true)), || {
                panic!("a completed stop reply needs no second status read")
            }),
            TimedPauseStopOutcome::StillRunning(_)
        ));
    }

    #[test]
    fn pause_enforcement_retries_beyond_initial_burst_until_stop_is_confirmed() {
        let state = TrackingPauseState::default();
        state.mark_indefinite();
        let mut attempts = 0;
        let mut delays = Vec::new();
        enforce_pause_until_stopped(
            &state,
            state.current_generation(),
            || {
                attempts += 1;
                attempts == 8
            },
            |delay| delays.push(delay),
        );
        assert_eq!(attempts, 8);
        assert_eq!(
            delays,
            vec![2, 2, 2, 4, 8, 16, 30]
                .into_iter()
                .map(Duration::from_secs)
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn pause_enforcement_stops_when_explicit_resume_cancels_the_pause() {
        let state = TrackingPauseState::default();
        state.mark_indefinite();
        let mut attempts = 0;
        enforce_pause_until_stopped(
            &state,
            state.current_generation(),
            || {
                attempts += 1;
                false
            },
            |_| {
                state.cancel();
            },
        );
        assert_eq!(attempts, 1);
    }

    #[test]
    fn old_pause_enforcement_stops_when_a_new_pause_replaces_its_generation() {
        let state = TrackingPauseState::default();
        state.mark_indefinite();
        let mut attempts = 0;
        enforce_pause_until_stopped(
            &state,
            state.current_generation(),
            || {
                attempts += 1;
                false
            },
            |_| {
                state.arm(TimedPause::new(100, 200));
            },
        );
        assert_eq!(attempts, 1);
        assert!(state.snapshot().is_active());
    }

    #[test]
    fn manual_cancel_invalidates_the_waiting_generation() {
        let state = TrackingPauseState::default();
        let generation = state.arm(TimedPause::new(100, 200));
        state.cancel();

        assert_eq!(state.waiting_pause(generation), None);
        assert_eq!(state.snapshot(), TrackingPauseSnapshot::Inactive);
    }

    #[test]
    fn manual_stop_is_distinguished_from_an_unexpected_stopped_tracker() {
        let state = TrackingPauseState::default();
        assert_eq!(state.snapshot(), TrackingPauseSnapshot::Inactive);

        state.mark_indefinite();
        assert_eq!(state.snapshot(), TrackingPauseSnapshot::Indefinite);

        state.cancel();
        assert_eq!(state.snapshot(), TrackingPauseSnapshot::Inactive);
    }

    #[test]
    fn newer_pause_invalidates_the_previous_timer() {
        let state = TrackingPauseState::default();
        let first_generation = state.arm(TimedPause::new(100, 200));
        let second_generation = state.arm(TimedPause::new(120, 300));

        assert_eq!(state.waiting_pause(first_generation), None);
        assert_eq!(
            state.waiting_pause(second_generation),
            Some(TimedPause::new(120, 300))
        );
    }

    #[test]
    fn due_resume_can_only_begin_after_the_deadline() {
        let state = TrackingPauseState::default();
        let generation = state.arm(TimedPause::new(100, 200));

        assert!(!state.begin_due_resume(generation, 199));
        assert!(state.begin_due_resume(generation, 200));
        assert!(!state.begin_due_resume(generation, 200));
    }

    #[test]
    fn timed_resume_treats_a_verified_lost_start_reply_as_success() {
        let state = TrackingPauseState::default();
        let pause_generation = state.arm(TimedPause::new(100, 200));
        assert!(state.begin_due_resume(pause_generation, 200));
        let startup_state = TrackerStartupState::default();
        let startup_generation = startup_state.begin_start_attempt();
        let mut starts = 0;
        let result = finish_due_resume_start(
            &state,
            pause_generation,
            &startup_state,
            startup_generation,
            || {
                starts += 1;
                reconcile_start_result_with_status(
                    Err(TrackerError::CommandFailed("lost start reply".to_string())),
                    || {
                        serde_json::from_value(serde_json::json!({
                            "running": true,
                            "accessibilityGranted": false,
                        }))
                        .map_err(|error| TrackerError::ParseFailed(error.to_string()))
                    },
                )
            },
        )
        .expect("verified daemon completes timed resume")
        .expect("current timed resume publishes its observation");

        assert_eq!(starts, 1, "the start mutation must not be replayed");
        assert!(result.running);
        assert_eq!(state.snapshot(), TrackingPauseSnapshot::Inactive);
        assert_eq!(startup_state.failure_message(), None);
    }

    #[test]
    fn failed_resume_remains_visible_and_does_not_retry() {
        let state = TrackingPauseState::default();
        let generation = state.arm(TimedPause::new(100, 200));
        assert!(state.begin_due_resume(generation, 200));
        assert!(state.complete_due_resume(generation, false));

        assert_eq!(
            state.snapshot(),
            TrackingPauseSnapshot::ResumeFailed {
                resumes_at_unix_seconds: 200
            }
        );
        assert_eq!(state.waiting_pause(generation), None);
    }

    #[test]
    fn successful_resume_clears_the_pause_state() {
        let state = TrackingPauseState::default();
        let generation = state.arm(TimedPause::new(100, 200));
        assert!(state.begin_due_resume(generation, 200));
        assert!(state.complete_due_resume(generation, true));

        assert_eq!(state.snapshot(), TrackingPauseSnapshot::Inactive);
        assert_eq!(state.waiting_pause(generation), None);
    }

    #[test]
    fn manual_cancel_wins_over_an_in_flight_automatic_resume_completion() {
        let state = TrackingPauseState::default();
        let generation = state.arm(TimedPause::new(100, 200));
        assert!(state.begin_due_resume(generation, 200));

        state.cancel();

        assert!(!state.complete_due_resume(generation, true));
        assert_eq!(state.snapshot(), TrackingPauseSnapshot::Inactive);
    }

    #[test]
    fn stale_restore_stop_cannot_run_after_manual_resume_wins_the_operation_lock() {
        use std::sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        };

        let state = Arc::new(TrackingPauseState::default());
        state.mark_indefinite();
        let resume_operation = state.lock_operation();
        let restore_state = Arc::clone(&state);
        let stop_called = Arc::new(AtomicBool::new(false));
        let restore_stop_called = Arc::clone(&stop_called);

        let restore = std::thread::spawn(move || {
            run_if_pause_generation_active(
                &restore_state,
                restore_state.current_generation(),
                || {
                    restore_stop_called.store(true, Ordering::Release);
                },
            )
        });

        // Manual Resume owns the operation lock while it clears durable and
        // in-memory pause state, so a queued restore stop must re-check the
        // state after the lock is released and skip its stale action.
        state.cancel();
        drop(resume_operation);

        assert!(!restore.join().expect("restore thread joins"));
        assert!(!stop_called.load(Ordering::Acquire));
        assert_eq!(state.snapshot(), TrackingPauseSnapshot::Inactive);
    }

    #[test]
    fn scheduler_failure_is_visible_without_waiting_for_the_deadline() {
        let state = TrackingPauseState::default();
        let generation = state.arm(TimedPause::new(100, 200));

        assert!(state.mark_auto_resume_failed(generation));
        assert_eq!(
            state.snapshot(),
            TrackingPauseSnapshot::ResumeFailed {
                resumes_at_unix_seconds: 200
            }
        );
        assert_eq!(state.waiting_pause(generation), None);
    }

    #[test]
    fn restart_restores_only_a_valid_future_deadline() {
        let pause = TimedPause::new(100, 200);

        assert!(should_restore_pause(pause, 199));
        assert!(!should_restore_pause(pause, 200));
        assert!(!should_restore_pause(TimedPause::new(300, 200), 150));
    }

    #[test]
    fn restored_timed_pause_clear_failure_remains_visible_and_blocks_start() {
        let state = TrackingPauseState::default();
        let pause = TimedPause::new(100, 200);
        assert!(clear_restored_timed_pause_or_preserve(
            &state,
            pause,
            || { Err("read-only pause directory".into()) }
        ));
        assert_eq!(
            state.snapshot(),
            TrackingPauseSnapshot::ResumeFailed {
                resumes_at_unix_seconds: 200
            }
        );
        assert!(state.snapshot().is_active());
        assert!(!clear_restored_timed_pause_or_preserve(
            &state,
            pause,
            || Ok(())
        ));
        assert_eq!(state.snapshot(), TrackingPauseSnapshot::Inactive);
    }

    #[test]
    fn timer_polls_wall_clock_at_most_five_seconds_for_wake_safety() {
        let pause = TimedPause::new(100, 1_000);

        assert_eq!(timer_wait_seconds(pause, 101), Some(5));
        assert_eq!(timer_wait_seconds(pause, 999), Some(1));
        assert_eq!(timer_wait_seconds(pause, 1_000), None);
    }

    #[test]
    fn persisted_pause_round_trips_and_rejects_invalid_state() {
        let directory = tempdir().expect("tempdir");
        let path = directory.path().join(PAUSE_STATE_FILE_NAME);
        let pause = TimedPause::new(100, 200);
        write_timed_pause(&path, pause).expect("write pause");
        assert_eq!(
            read_persisted_pause(&path).expect("read pause"),
            Some(PersistedTrackingPause::Timed(pause))
        );

        fs::write(
            &path,
            br#"{"version":1,"pausedAtUnixSeconds":300,"resumesAtUnixSeconds":200}"#,
        )
        .expect("write invalid state");
        assert!(read_persisted_pause(&path).is_err());
    }

    #[test]
    fn indefinite_pause_round_trips_through_the_restart_file() {
        let directory = tempdir().expect("tempdir");
        let path = directory.path().join(PAUSE_STATE_FILE_NAME);
        let pause = IndefinitePause::new(100);
        write_indefinite_pause(&path, pause).expect("write indefinite pause");

        assert_eq!(
            read_persisted_pause(&path).expect("read indefinite pause"),
            Some(PersistedTrackingPause::Indefinite(pause))
        );
    }

    #[test]
    fn implicit_start_checks_disk_even_before_pause_restoration() {
        let directory = tempdir().expect("tempdir");
        let path = directory.path().join(PAUSE_STATE_FILE_NAME);
        let state = TrackingPauseState::default();
        assert_eq!(
            run_start_unless_paused_at_path(&state, &path, false, |_| 1).expect("absent pause"),
            Some(1)
        );

        write_indefinite_pause(&path, IndefinitePause::new(100)).expect("write pause");
        let mut activation_writes = 0;
        let mut pause_clears = 0;
        let result = run_start_unless_paused_at_path(&state, &path, false, |_| {
            activation_writes += 1;
            pause_clears += 1;
        });
        assert_eq!(result.expect("persisted pause"), None);
        assert_eq!((activation_writes, pause_clears), (0, 0));
        assert!(path.exists(), "implicit start must preserve the marker");

        write_timed_pause(&path, TimedPause::new(100, 200)).expect("write timed pause");
        assert_eq!(
            run_start_unless_paused_at_path(&state, &path, false, |_| 1).expect("timed pause"),
            None
        );
    }

    #[test]
    fn implicit_start_honors_memory_pause_and_refuses_unreadable_marker() {
        let directory = tempdir().expect("tempdir");
        let path = directory.path().join(PAUSE_STATE_FILE_NAME);
        let state = TrackingPauseState::default();
        state.mark_indefinite();
        assert_eq!(
            run_start_unless_paused_at_path(&state, &path, false, |_| 1).expect("memory pause"),
            None
        );

        state.cancel();
        fs::write(&path, b"invalid pause").expect("write invalid pause");
        assert!(run_start_unless_paused_at_path(&state, &path, false, |_| 1).is_err());
        assert!(
            path.exists(),
            "implicit start must not clear an unreadable marker"
        );
    }

    #[test]
    fn startup_preserves_a_corrupt_pause_until_explicit_resume() {
        let directory = tempdir().expect("tempdir");
        let path = directory.path().join(PAUSE_STATE_FILE_NAME);
        let state = TrackingPauseState::default();
        fs::write(&path, b"invalid pause").expect("write invalid pause");

        let error = read_persisted_pause(&path).expect_err("corrupt marker is unreadable");
        preserve_unreadable_pause(&state, &error);
        assert_eq!(state.snapshot(), TrackingPauseSnapshot::Indefinite);
        assert!(path.exists(), "startup must preserve the durable marker");
        assert_eq!(
            run_start_unless_paused_at_path(&state, &path, false, |_| 1)
                .expect("implicit start remains paused"),
            None
        );

        assert_eq!(
            run_start_unless_paused_at_path(&state, &path, true, |_| {
                prepare_manual_start_at_path(
                    &state,
                    &TrackerStartupState::default(),
                    &path,
                    true,
                    || Ok(()),
                )
                .map(|_| ())
            })
            .expect("explicit Resume is allowed"),
            Some(Ok(()))
        );
        assert!(!path.exists());
        assert_eq!(state.snapshot(), TrackingPauseSnapshot::Inactive);
        assert_eq!(
            run_start_unless_paused_at_path(&state, &path, false, |_| 1).expect("subsequent start"),
            Some(1)
        );
    }

    #[test]
    fn startup_preserves_a_pause_when_the_marker_cannot_be_read_or_cleared() {
        let directory = tempdir().expect("tempdir");
        let path = directory.path().join(PAUSE_STATE_FILE_NAME);
        let state = TrackingPauseState::default();
        fs::create_dir(&path).expect("unreadable marker path");

        let error = read_persisted_pause(&path).expect_err("directory cannot be read as marker");
        preserve_unreadable_pause(&state, &error);
        assert_eq!(state.snapshot(), TrackingPauseSnapshot::Indefinite);
        assert_eq!(
            run_start_unless_paused_at_path(&state, &path, false, |_| 1)
                .expect("implicit start remains paused"),
            None
        );
        assert!(run_start_unless_paused_at_path(&state, &path, true, |_| {
            prepare_manual_start_at_path(
                &state,
                &TrackerStartupState::default(),
                &path,
                true,
                || Ok(()),
            )
            .map(|_| ())
        })
        .expect("explicit Resume is allowed")
        .expect("start closure ran")
        .is_err());
        assert_eq!(state.snapshot(), TrackingPauseSnapshot::Indefinite);
        assert!(path.exists());
    }

    #[test]
    fn explicit_resume_runs_with_a_saved_pause() {
        let directory = tempdir().expect("tempdir");
        let path = directory.path().join(PAUSE_STATE_FILE_NAME);
        let state = TrackingPauseState::default();
        write_indefinite_pause(&path, IndefinitePause::new(100)).expect("write pause");

        assert_eq!(
            run_start_unless_paused_at_path(&state, &path, true, |_| 1).expect("explicit start"),
            Some(1)
        );
    }

    #[test]
    fn manual_resume_clears_disk_before_memory_and_preserves_pause_on_failure() {
        let directory = tempdir().expect("tempdir");
        let path = directory.path().join(PAUSE_STATE_FILE_NAME);
        let state = TrackingPauseState::default();
        state.mark_indefinite();
        write_indefinite_pause(&path, IndefinitePause::new(100)).expect("write pause");

        prepare_manual_start_at_path(&state, &TrackerStartupState::default(), &path, true, || {
            Ok(())
        })
        .map(|_| ())
        .expect("clear pause");
        assert_eq!(state.snapshot(), TrackingPauseSnapshot::Inactive);
        assert!(!path.exists());

        let failing_path = directory.path().join("not-a-file");
        fs::create_dir(&failing_path).expect("create directory at pause path");
        state.mark_indefinite();
        assert!(prepare_manual_start_at_path(
            &state,
            &TrackerStartupState::default(),
            &failing_path,
            true,
            || Ok(())
        )
        .map(|_| ())
        .is_err());
        assert_eq!(state.snapshot(), TrackingPauseSnapshot::Indefinite);
    }

    #[test]
    fn persisted_pause_replacement_leaves_no_partial_temp_file() {
        let directory = tempdir().expect("tempdir");
        let path = directory.path().join(PAUSE_STATE_FILE_NAME);
        write_timed_pause(&path, TimedPause::new(100, 200)).expect("first write");
        let replacement = TimedPause::new(300, 400);
        write_timed_pause(&path, replacement).expect("replacement write");

        assert_eq!(
            read_persisted_pause(&path).expect("read pause"),
            Some(PersistedTrackingPause::Timed(replacement))
        );
        assert_eq!(
            fs::read_dir(directory.path())
                .expect("read tempdir")
                .filter_map(Result::ok)
                .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
                .count(),
            0
        );
    }
}
