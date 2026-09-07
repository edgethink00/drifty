use std::{
    panic::{self, AssertUnwindSafe},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    thread::JoinHandle,
    time::Duration,
};

use tauri::{AppHandle, Manager};

use crate::{
    tracker::{TrackerController, TrackerError, TrackerStartupState},
    tracking_activation,
    tracking_pause::{self, TrackingPauseState},
    tray,
};

const HEALTH_POLL_INTERVAL: Duration = Duration::from_secs(10);
const RETRY_DELAYS: [Duration; 3] = [
    Duration::from_secs(2),
    Duration::from_secs(10),
    Duration::from_secs(30),
];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RecoveryAction {
    Wait(Duration),
    AttemptStart,
}

#[derive(Debug, Default)]
struct RecoverySchedule {
    failed_attempts: usize,
    attempt_armed: bool,
    exhausted: bool,
}

impl RecoverySchedule {
    fn observe(&mut self, tracking_paused: bool, tracker_running: bool) -> RecoveryAction {
        if tracking_paused || tracker_running {
            self.reset();
            return RecoveryAction::Wait(HEALTH_POLL_INTERVAL);
        }
        if self.exhausted {
            return RecoveryAction::Wait(HEALTH_POLL_INTERVAL);
        }
        if self.attempt_armed {
            self.attempt_armed = false;
            return RecoveryAction::AttemptStart;
        }

        self.attempt_armed = true;
        RecoveryAction::Wait(RETRY_DELAYS[self.failed_attempts])
    }

    fn record_attempt(&mut self, succeeded: bool) -> Duration {
        if succeeded {
            self.reset();
            return HEALTH_POLL_INTERVAL;
        }

        self.failed_attempts = self.failed_attempts.saturating_add(1);
        if self.failed_attempts >= RETRY_DELAYS.len() {
            self.exhausted = true;
            self.attempt_armed = false;
            HEALTH_POLL_INTERVAL
        } else {
            self.attempt_armed = true;
            RETRY_DELAYS[self.failed_attempts]
        }
    }

    fn reset(&mut self) {
        self.failed_attempts = 0;
        self.attempt_armed = false;
        self.exhausted = false;
    }
}

pub struct TrackerRecoveryWorker {
    lifecycle: Mutex<TrackerRecoveryWorkerLifecycle>,
}

enum TrackerRecoveryWorkerLifecycle {
    NotStarted,
    Running {
        stop_tx: mpsc::Sender<()>,
        stopping: Arc<AtomicBool>,
        failed: Arc<AtomicBool>,
        join: JoinHandle<()>,
    },
    Stopping,
    Stopped,
}

impl Default for TrackerRecoveryWorker {
    fn default() -> Self {
        Self {
            lifecycle: Mutex::new(TrackerRecoveryWorkerLifecycle::NotStarted),
        }
    }
}

impl TrackerRecoveryWorker {
    fn start(
        &self,
        mut tick: impl FnMut(&Arc<AtomicBool>) -> Duration + Send + 'static,
    ) -> std::io::Result<bool> {
        let mut lifecycle = self
            .lifecycle
            .lock()
            .expect("tracker recovery lifecycle should not be poisoned");
        if !matches!(&*lifecycle, TrackerRecoveryWorkerLifecycle::NotStarted) {
            return Ok(false);
        }

        let (stop_tx, stop_rx) = mpsc::channel();
        let stopping = Arc::new(AtomicBool::new(false));
        let failed = Arc::new(AtomicBool::new(false));
        let worker_stopping = Arc::clone(&stopping);
        let worker_failed = Arc::clone(&failed);
        let join = std::thread::Builder::new()
            .name("drifty-tracker-recovery".into())
            .spawn(move || {
                let mut wait = HEALTH_POLL_INTERVAL;
                while !worker_stopping.load(Ordering::Acquire) {
                    match stop_rx.recv_timeout(wait) {
                        Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
                        Err(mpsc::RecvTimeoutError::Timeout) => {}
                    }
                    if worker_stopping.load(Ordering::Acquire) {
                        break;
                    }

                    match panic::catch_unwind(AssertUnwindSafe(|| tick(&worker_stopping))) {
                        Ok(next_wait) => wait = next_wait,
                        Err(_) => {
                            worker_failed.store(true, Ordering::Release);
                            worker_stopping.store(true, Ordering::Release);
                            eprintln!("[tracker-recovery] Worker panicked and stopped");
                        }
                    }
                }
            })?;

        *lifecycle = TrackerRecoveryWorkerLifecycle::Running {
            stop_tx,
            stopping,
            failed,
            join,
        };
        Ok(true)
    }

    pub(crate) fn shutdown(&self) -> bool {
        let worker = {
            let mut lifecycle = self
                .lifecycle
                .lock()
                .expect("tracker recovery lifecycle should not be poisoned");
            let previous =
                std::mem::replace(&mut *lifecycle, TrackerRecoveryWorkerLifecycle::Stopping);
            match previous {
                TrackerRecoveryWorkerLifecycle::Running {
                    stop_tx,
                    stopping,
                    failed,
                    join,
                } => {
                    stopping.store(true, Ordering::Release);
                    Some((stop_tx, failed, join))
                }
                state => {
                    *lifecycle = state;
                    None
                }
            }
        };

        let Some((stop_tx, failed, join)) = worker else {
            return false;
        };
        let _ = stop_tx.send(());
        let join_failed = join.join().is_err();
        if join_failed {
            eprintln!("[tracker-recovery] Worker thread terminated with a panic");
        }

        let worker_failed = failed.load(Ordering::Acquire) || join_failed;
        let mut lifecycle = self
            .lifecycle
            .lock()
            .expect("tracker recovery lifecycle should not be poisoned");
        if matches!(&*lifecycle, TrackerRecoveryWorkerLifecycle::Stopping) {
            *lifecycle = TrackerRecoveryWorkerLifecycle::Stopped;
        }
        worker_failed
    }
}

pub(crate) fn setup_tracker_recovery(app: &AppHandle) -> std::io::Result<()> {
    let app_handle = app.clone();
    let mut schedule = RecoverySchedule::default();
    let _ = app
        .state::<TrackerRecoveryWorker>()
        .start(move |stopping| recovery_tick(&app_handle, stopping, &mut schedule))?;
    Ok(())
}

pub(crate) fn shutdown_tracker_recovery(app: &AppHandle) {
    if let Some(worker) = app.try_state::<TrackerRecoveryWorker>() {
        worker.shutdown();
    }
}

fn recovery_tick(
    app: &AppHandle,
    stopping: &Arc<AtomicBool>,
    schedule: &mut RecoverySchedule,
) -> Duration {
    if stopping.load(Ordering::Acquire) {
        return HEALTH_POLL_INTERVAL;
    }

    let tracking_paused = tracking_pause::snapshot(app).is_active();
    if tracking_paused {
        // Pause is authoritative even if native process inspection is
        // temporarily unavailable. Reset any exhausted recovery budget and do
        // not probe or restart the daemon while the user expects no tracking.
        return drive_recovery(schedule, true, false, || {
            unreachable!("paused tracking must never attempt recovery")
        });
    }
    if !tracking_activation::is_activated(app) {
        // A device that has never started tracking has nothing to recover.
        // Treat it like a pause for scheduling so no probe or restart happens.
        return drive_recovery(schedule, true, false, || {
            unreachable!("inactive tracking must never attempt recovery")
        });
    }
    let tracker_running = match app.state::<TrackerController>().daemon_running(app) {
        Ok(running) => running,
        Err(error) => {
            eprintln!("[tracker-recovery] Could not inspect tracker daemon: {error}");
            return HEALTH_POLL_INTERVAL;
        }
    };
    drive_recovery(schedule, tracking_paused, tracker_running, || {
        attempt_tracker_recovery(app, stopping)
    })
}

fn drive_recovery(
    schedule: &mut RecoverySchedule,
    tracking_paused: bool,
    tracker_running: bool,
    attempt_start: impl FnOnce() -> bool,
) -> Duration {
    match schedule.observe(tracking_paused, tracker_running) {
        RecoveryAction::Wait(wait) => wait,
        RecoveryAction::AttemptStart => schedule.record_attempt(attempt_start()),
    }
}

fn attempt_tracker_recovery(app: &AppHandle, stopping: &Arc<AtomicBool>) -> bool {
    if stopping.load(Ordering::Acquire) {
        return true;
    }

    let pause_state = app.state::<TrackingPauseState>();
    let _operation = pause_state.lock_operation();
    if stopping.load(Ordering::Acquire) || pause_state.snapshot().is_active() {
        return true;
    }

    let controller = *app.state::<TrackerController>();
    match controller.daemon_running(app) {
        Ok(true) => return true,
        Ok(false) => {}
        Err(error) => {
            eprintln!("[tracker-recovery] Could not confirm stopped tracker daemon: {error}");
            return false;
        }
    }

    let startup_state = app.state::<TrackerStartupState>();
    let generation = startup_state.begin_start_attempt();
    match controller.recover_start(app) {
        Ok(status) if status.running => {
            startup_state.complete_start_success(generation);
            tray::queue_tracking_controls_refresh(app, Some(true));
            eprintln!("[tracker-recovery] Recovered an unexpectedly stopped tracker daemon");
            true
        }
        Ok(status) => {
            let error = TrackerError::TrackerReturnedError(
                "tracker did not report running after recovery start".to_string(),
            );
            startup_state.record_start_failure(generation, &error);
            tray::queue_tracking_controls_refresh(app, Some(status.running));
            eprintln!("[tracker-recovery] Recovery start returned a stopped tracker");
            false
        }
        Err(error) => {
            startup_state.record_start_failure(generation, &error);
            tray::queue_tracking_controls_refresh(app, Some(false));
            eprintln!("[tracker-recovery] Recovery start failed: {error}");
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unexpected_stop_uses_bounded_two_ten_thirty_second_attempts() {
        let mut schedule = RecoverySchedule::default();

        assert_eq!(
            schedule.observe(false, false),
            RecoveryAction::Wait(Duration::from_secs(2))
        );
        assert_eq!(schedule.observe(false, false), RecoveryAction::AttemptStart);
        assert_eq!(schedule.record_attempt(false), Duration::from_secs(10));
        assert_eq!(schedule.observe(false, false), RecoveryAction::AttemptStart);
        assert_eq!(schedule.record_attempt(false), Duration::from_secs(30));
        assert_eq!(schedule.observe(false, false), RecoveryAction::AttemptStart);
        assert_eq!(schedule.record_attempt(false), HEALTH_POLL_INTERVAL);
        assert!(schedule.exhausted);
        assert_eq!(
            schedule.observe(false, false),
            RecoveryAction::Wait(HEALTH_POLL_INTERVAL)
        );
    }

    #[test]
    fn running_or_paused_tracking_resets_recovery_budget() {
        let mut schedule = RecoverySchedule::default();
        schedule.observe(false, false);
        schedule.observe(false, false);
        schedule.record_attempt(false);

        assert_eq!(
            schedule.observe(false, true),
            RecoveryAction::Wait(HEALTH_POLL_INTERVAL)
        );
        assert_eq!(schedule.failed_attempts, 0);
        assert!(!schedule.exhausted);

        schedule.observe(false, false);
        schedule.observe(false, false);
        schedule.record_attempt(false);
        assert_eq!(
            schedule.observe(true, false),
            RecoveryAction::Wait(HEALTH_POLL_INTERVAL)
        );
        assert_eq!(schedule.failed_attempts, 0);
        assert!(!schedule.exhausted);
    }

    #[test]
    fn successful_recovery_restores_the_full_retry_budget() {
        let mut schedule = RecoverySchedule::default();
        schedule.observe(false, false);
        schedule.observe(false, false);
        schedule.record_attempt(false);

        assert_eq!(schedule.record_attempt(true), HEALTH_POLL_INTERVAL);
        assert_eq!(
            schedule.observe(false, false),
            RecoveryAction::Wait(Duration::from_secs(2))
        );
    }

    #[test]
    fn paused_tracking_resets_an_exhausted_budget_before_health_inspection() {
        let mut schedule = RecoverySchedule::default();
        for _ in 0..RETRY_DELAYS.len() {
            schedule.observe(false, false);
            schedule.observe(false, false);
            schedule.record_attempt(false);
        }
        assert!(schedule.exhausted);

        let wait = drive_recovery(&mut schedule, true, false, || {
            panic!("paused tracking must not invoke recovery")
        });

        assert_eq!(wait, HEALTH_POLL_INTERVAL);
        assert_eq!(schedule.failed_attempts, 0);
        assert!(!schedule.exhausted);
    }

    #[test]
    fn recovery_driver_starts_only_after_a_confirmed_unpaused_stop() {
        let mut schedule = RecoverySchedule::default();
        let mut attempts = 0;

        let wait = drive_recovery(&mut schedule, true, false, || {
            attempts += 1;
            false
        });
        assert_eq!(wait, HEALTH_POLL_INTERVAL);
        assert_eq!(attempts, 0);

        let wait = drive_recovery(&mut schedule, false, true, || {
            attempts += 1;
            false
        });
        assert_eq!(wait, HEALTH_POLL_INTERVAL);
        assert_eq!(attempts, 0);

        let wait = drive_recovery(&mut schedule, false, false, || {
            attempts += 1;
            false
        });
        assert_eq!(wait, Duration::from_secs(2));
        assert_eq!(attempts, 0);

        let wait = drive_recovery(&mut schedule, false, false, || {
            attempts += 1;
            true
        });
        assert_eq!(wait, HEALTH_POLL_INTERVAL);
        assert_eq!(attempts, 1);
    }

    #[test]
    fn recovery_worker_starts_once_and_shutdown_interrupts_its_wait() {
        let worker = TrackerRecoveryWorker::default();
        assert!(worker
            .start(|_| Duration::from_secs(600))
            .expect("worker should start"));
        assert!(!worker
            .start(|_| panic!("duplicate worker must not start"))
            .expect("duplicate start is a no-op"));
        assert!(!worker.shutdown());
    }
}
