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
    tracker::{TrackerController, TrackerError, TrackerStartupState, TrackerStatus},
    tray,
};

const PAUSE_STATE_FILE_NAME: &str = "tracking-pause.json";
const PAUSE_STATE_VERSION: u8 = 1;
const TIMER_POLL_INTERVAL_SECONDS: i64 = 5;

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

pub(crate) enum IndefinitePauseStopOutcome {
    Paused(TrackerStatus),
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
    indefinite: bool,
    timed_pause: Option<TimedPause>,
    resume_in_flight: bool,
    auto_resume_failed: bool,
}

#[derive(Debug, Default)]
pub(crate) struct TrackingPauseState {
    lifecycle: Mutex<TrackingPauseLifecycle>,
    operation: Mutex<()>,
}

impl TrackingPauseState {
    pub(crate) fn lock_operation(&self) -> MutexGuard<'_, ()> {
        self.operation
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
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
        lifecycle.generation
    }

    pub(crate) fn snapshot(&self) -> TrackingPauseSnapshot {
        let lifecycle = self
            .lifecycle
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some(pause) = lifecycle.timed_pause else {
            return if lifecycle.indefinite {
                TrackingPauseSnapshot::Indefinite
            } else {
                TrackingPauseSnapshot::Inactive
            };
        };
        if lifecycle.auto_resume_failed {
            TrackingPauseSnapshot::ResumeFailed {
                resumes_at_unix_seconds: pause.resumes_at_unix_seconds,
            }
        } else {
            TrackingPauseSnapshot::Timed {
                resumes_at_unix_seconds: pause.resumes_at_unix_seconds,
            }
        }
    }

    fn waiting_pause(&self, generation: u64) -> Option<TimedPause> {
        let lifecycle = self
            .lifecycle
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if lifecycle.generation != generation
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
        if lifecycle.generation != generation
            || lifecycle.resume_in_flight
            || lifecycle.auto_resume_failed
            || pause.resumes_at_unix_seconds > now_unix_seconds
        {
            return false;
        }
        lifecycle.resume_in_flight = true;
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
        lifecycle.generation
    }
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

fn persist_timed_pause(app: &AppHandle, pause: TimedPause) -> Result<(), String> {
    write_timed_pause(&pause_state_path(app)?, pause)
}

fn clear_persisted_pause(app: &AppHandle) -> Result<(), String> {
    clear_pause_file(&pause_state_path(app)?)
}

pub(crate) fn prepare_indefinite_pause(app: &AppHandle) -> Result<(), String> {
    write_indefinite_pause(
        &pause_state_path(app)?,
        IndefinitePause::new(Utc::now().timestamp()),
    )
}

pub(crate) fn commit_indefinite_pause(app: &AppHandle) {
    app.state::<TrackingPauseState>().mark_indefinite();
}

pub(crate) fn abort_indefinite_pause(app: &AppHandle) {
    if let Err(error) = clear_persisted_pause(app) {
        eprintln!("[tracking-pause] {error}");
    }
}

pub(crate) fn finish_indefinite_pause_stop(
    app: &AppHandle,
    controller: &TrackerController,
    stop_result: Result<TrackerStatus, TrackerError>,
) -> IndefinitePauseStopOutcome {
    let outcome = match stop_result {
        Ok(status) if !status.running => IndefinitePauseStopOutcome::Paused(status),
        Ok(status) => IndefinitePauseStopOutcome::StillRunning(status),
        Err(stop_error) => match controller.get_status(app) {
            Ok(status) if !status.running => IndefinitePauseStopOutcome::Paused(status),
            Ok(status) => IndefinitePauseStopOutcome::StillRunning(status),
            Err(_) => IndefinitePauseStopOutcome::Ambiguous(stop_error),
        },
    };

    match &outcome {
        IndefinitePauseStopOutcome::Paused(_) => commit_indefinite_pause(app),
        IndefinitePauseStopOutcome::StillRunning(_) => abort_indefinite_pause(app),
        IndefinitePauseStopOutcome::Ambiguous(_) => {
            // A mutating sidecar request may complete even if its response is
            // lost. Preserve the durable user intent and retry enforcement on
            // a fresh sidecar instead of letting recovery restart tracking.
            commit_indefinite_pause(app);
            let enforcement_app = app.clone();
            let _ = async_runtime::spawn_blocking(move || {
                enforce_restored_pause(&enforcement_app);
            });
        }
    }
    outcome
}

pub(crate) fn snapshot(app: &AppHandle) -> TrackingPauseSnapshot {
    app.state::<TrackingPauseState>().snapshot()
}

pub(crate) fn clear_for_manual_start(app: &AppHandle) -> Result<(), String> {
    clear_pause_and_cancel(&app.state::<TrackingPauseState>(), &pause_state_path(app)?)
}

fn clear_pause_and_cancel(state: &TrackingPauseState, path: &Path) -> Result<(), String> {
    // Keep the in-memory pause authoritative until the durable marker is gone.
    // If clearing fails, callers can stop the just-started tracker and report a
    // failed Resume without creating an active/durable split-brain state.
    clear_pause_file(path)?;
    state.cancel();
    Ok(())
}

pub(crate) fn restore_on_startup(app: &AppHandle) -> bool {
    let path = match pause_state_path(app) {
        Ok(path) => path,
        Err(error) => {
            eprintln!("[tracking-pause] {error}");
            return false;
        }
    };
    let pause = match read_persisted_pause(&path) {
        Ok(Some(pause)) => pause,
        Ok(None) => return false,
        Err(error) => {
            eprintln!("[tracking-pause] {error}");
            let _ = clear_pause_file(&path);
            return false;
        }
    };
    match pause {
        PersistedTrackingPause::Indefinite(_) => {
            app.state::<TrackingPauseState>().mark_indefinite();
            true
        }
        PersistedTrackingPause::Timed(pause) => {
            if !should_restore_pause(pause, Utc::now().timestamp()) {
                let _ = clear_pause_file(&path);
                return false;
            }
            let generation = app.state::<TrackingPauseState>().arm(pause);
            if let Err(error) = schedule_timed_resume(app.clone(), generation) {
                eprintln!("[tracking-pause] Could not schedule restored pause: {error}");
                app.state::<TrackingPauseState>().cancel();
                let _ = clear_pause_file(&path);
                return false;
            }
            true
        }
    }
}

pub(crate) fn enforce_restored_pause(app: &AppHandle) {
    let state = app.state::<TrackingPauseState>();
    let controller = *app.state::<TrackerController>();
    run_if_pause_still_active(&state, || match controller.stop(app) {
        Ok(status) => tray::queue_tracking_controls_refresh(app, Some(status.running)),
        Err(error) => eprintln!("[tracking-pause] Could not enforce restored pause: {error}"),
    });
}

fn run_if_pause_still_active(state: &TrackingPauseState, action: impl FnOnce()) -> bool {
    let _operation = state.lock_operation();
    if !state.snapshot().is_active() {
        return false;
    }
    action();
    true
}

pub(crate) fn pause_tracking_for(app: &AppHandle, minutes: u64) {
    if !matches!(minutes, 15 | 30 | 60) {
        return;
    }
    let state = app.state::<TrackingPauseState>();
    let operation = state.lock_operation();
    let controller = *app.state::<TrackerController>();
    let is_running = controller
        .get_status(app)
        .map(|status| status.running)
        .unwrap_or(false);
    if !is_running {
        return;
    }
    let paused_at = Utc::now().timestamp();
    let resumes_at = paused_at.saturating_add((minutes as i64).saturating_mul(60));
    let pause = TimedPause::new(paused_at, resumes_at);
    if let Err(error) = persist_timed_pause(app, pause) {
        eprintln!("[tracking-pause] Refusing an unpersisted timed pause: {error}");
        return;
    }
    let status = match controller.stop(app) {
        Ok(status) => status,
        Err(error) => {
            let _ = clear_persisted_pause(app);
            eprintln!("[tracking-pause] Could not pause tracking: {error}");
            return;
        }
    };
    if status.running {
        let _ = clear_persisted_pause(app);
        eprintln!("[tracking-pause] Tracker still reports running after pause request");
        tray::refresh_tracking_controls(app, Some(true));
        return;
    }
    let generation = state.arm(pause);
    tray::refresh_tracking_controls(app, Some(status.running));
    drop(operation);
    if let Err(error) = schedule_timed_resume(app.clone(), generation) {
        eprintln!("[tracking-pause] Could not schedule pause: {error}");
        state.mark_auto_resume_failed(generation);
        tray::refresh_tracking_controls(app, Some(false));
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
    if !state.begin_due_resume(generation, Utc::now().timestamp()) {
        return;
    }
    let controller = *app.state::<TrackerController>();
    let startup_state = app.state::<TrackerStartupState>();
    let startup_generation = startup_state.begin_start_attempt();
    if let Err(error) = clear_persisted_pause(&app) {
        let clear_error = TrackerError::TrackerReturnedError(error.clone());
        startup_state.record_start_failure(startup_generation, &clear_error);
        state.complete_due_resume(generation, false);
        tray::queue_tracking_controls_refresh(&app, Some(false));
        eprintln!(
            "[tracking-pause] Automatic resume was skipped because its durable pause could not be cleared: {error}"
        );
        return;
    }
    match controller.start(&app) {
        Ok(status) if status.running => {
            startup_state.complete_start_success(startup_generation);
            state.complete_due_resume(generation, true);
            tray::queue_tracking_controls_refresh(&app, Some(status.running));
            let _ = app
                .notification()
                .builder()
                .title("Tracking resumed")
                .body("Drifty resumed tracking after your timed pause.")
                .show();
        }
        Ok(status) => {
            let error = TrackerError::TrackerReturnedError(
                "tracker did not report running after automatic resume".to_string(),
            );
            startup_state.record_start_failure(startup_generation, &error);
            state.complete_due_resume(generation, false);
            tray::queue_tracking_controls_refresh(&app, Some(status.running));
            eprintln!("[tracking-pause] Automatic resume returned a stopped tracker");
        }
        Err(error) => {
            startup_state.record_start_failure(startup_generation, &error);
            state.complete_due_resume(generation, false);
            tray::queue_tracking_controls_refresh(&app, Some(false));
            eprintln!("[tracking-pause] Automatic resume failed: {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

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
            run_if_pause_still_active(&restore_state, || {
                restore_stop_called.store(true, Ordering::Release);
            })
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
    fn manual_resume_clears_disk_before_memory_and_preserves_pause_on_failure() {
        let directory = tempdir().expect("tempdir");
        let path = directory.path().join(PAUSE_STATE_FILE_NAME);
        let state = TrackingPauseState::default();
        state.mark_indefinite();
        write_indefinite_pause(&path, IndefinitePause::new(100)).expect("write pause");

        clear_pause_and_cancel(&state, &path).expect("clear pause");
        assert_eq!(state.snapshot(), TrackingPauseSnapshot::Inactive);
        assert!(!path.exists());

        let failing_path = directory.path().join("not-a-file");
        fs::create_dir(&failing_path).expect("create directory at pause path");
        state.mark_indefinite();
        assert!(clear_pause_and_cancel(&state, &failing_path).is_err());
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
