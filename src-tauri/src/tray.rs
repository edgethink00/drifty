mod drift_alarm_status;
mod menu;
mod productivity_icon;
#[cfg(test)]
mod tests;

use std::{
    panic::{self, AssertUnwindSafe},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    thread::JoinHandle,
    time::Duration,
};

use chrono::{DateTime, Local, Utc};
use tauri::image::Image;
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, State};

#[cfg(target_os = "macos")]
use objc2::MainThreadMarker;
#[cfg(target_os = "macos")]
use objc2_app_kit::{
    NSColor, NSFont, NSFontAttributeName, NSFontWeightSemibold, NSForegroundColorAttributeName,
    NSKernAttributeName,
};
#[cfg(target_os = "macos")]
use objc2_foundation::{
    NSAttributedString, NSDictionary, NSMutableAttributedString, NSNumber, NSRange, NSString,
};

use self::drift_alarm_status::{
    drift_alerts_status_label, drift_summary_label, TrayDriftAlarmStatus,
};
use self::menu::{run_menu_update, MenuRow, TrayMenu};
use self::productivity_icon::{
    latest_tray_productivity_mix, update_tray_productivity_mix, TrayProductivityMix,
};

pub use self::productivity_icon::TrayProductivityState;
use crate::donut_icon::{self, TrayDisplayMode, TrayIconStyle};
#[cfg(not(target_os = "windows"))]
use crate::donut_icon::DonutIconRenderInput;
use crate::shell_action::{self, tray_menu_id, ShellAction};
use crate::tracker::{TrackerController, TrackerError, TrackerStartupState};
use crate::tracking_pause::{self, TrackingPauseSnapshot, TrackingPauseState, TrackingPauseView};
use crate::app_menu;

const TRAY_ID: &str = "drifty-menu";
const UPDATE_STATUS_LABEL: &str = "Check for Updates...";
const TRAY_REFRESH_INTERVAL: Duration = Duration::from_secs(60);
const TRAY_TITLE_SCALE: f64 = 1.03;

// ---------------------------------------------------------------------------
// Tray display language
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(crate) enum TrayLanguage {
    #[default]
    English,
    Korean,
}

impl TrayLanguage {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "en" => Ok(Self::English),
            "ko" => Ok(Self::Korean),
            _ => Err(format!("Unsupported tray language: {value}")),
        }
    }

    pub(crate) fn is_korean(self) -> bool {
        self == Self::Korean
    }
}

#[derive(Default)]
pub struct TrayLanguageState(Mutex<TrayLanguage>);

pub(crate) fn latest_tray_language(app: &AppHandle) -> TrayLanguage {
    app.try_state::<TrayLanguageState>()
        .and_then(|state| state.0.lock().ok().map(|lang| *lang))
        .unwrap_or_default()
}

#[tauri::command]
pub async fn tray_set_language(
    app: AppHandle,
    state: State<'_, TrayLanguageState>,
    language: String,
) -> Result<(), String> {
    let parsed = TrayLanguage::parse(&language)?;
    {
        let mut latest = state
            .0
            .lock()
            .map_err(|_| "tray language state lock poisoned".to_string())?;
        *latest = parsed;
    }
    run_menu_update(app, |app| {
        // Read inside the transaction: an older queued IPC must not overwrite
        // a newer language using a snapshot captured on its worker thread.
        let language = latest_tray_language(app);
        let tray_result = refresh_tray_menu_on_main_thread(app);
        let display = latest_tray_display(app);
        apply_tray_display_title(app, display, language);
        let app_result = app_menu::setup_app_menu(app);
        tray_result.and(app_result)
    })
    .await
}

pub(crate) fn tray_icon_rect(app: &AppHandle) -> Option<tauri::Rect> {
    app.tray_by_id(TRAY_ID)
        .and_then(|tray| tray.rect().ok().flatten())
}

#[derive(Default)]
pub struct TrayDriftAlarmState(Mutex<TrayDriftAlarmStatus>);

impl TrayDriftAlarmState {
    pub(crate) fn publish_renderer_status(
        &self,
        mut status: TrayDriftAlarmStatus,
        pause_view: impl FnOnce() -> TrackingPauseView,
    ) -> Result<(), String> {
        let mut latest = self
            .0
            .lock()
            .map_err(|_| "tray drift alarm state lock poisoned".to_string())?;
        // Sample intent under the cache guard. An IPC waiting for this lock
        // must not apply an inactive snapshot from before a newer Pause.
        let pause = pause_view();
        if pause.snapshot.is_active() {
            status.set_tracker_running(pause.running_hint(latest.tracker_running()));
        }
        *latest = status;
        Ok(())
    }

    pub(crate) fn mark_pause_requested(
        &self,
        pause_view: impl FnOnce() -> TrackingPauseView,
    ) -> Result<(), String> {
        let mut latest = self
            .0
            .lock()
            .map_err(|_| "tray drift alarm state lock poisoned".to_string())?;
        let pause = pause_view();
        if pause.snapshot.is_active() {
            // Read/filter/write in one transaction, before any UI dispatch.
            let hint = pause.running_hint(latest.tracker_running());
            latest.set_tracker_running(hint);
        }
        Ok(())
    }

    fn set_tracker_running(&self, running: Option<bool>) {
        if let Ok(mut latest) = self.0.lock() {
            latest.set_tracker_running(running);
        }
    }

    pub(crate) fn tracker_running(&self) -> Option<bool> {
        self.0.lock().ok().and_then(|latest| latest.tracker_running())
    }
}

#[derive(Default)]
pub struct TrayIconStyleState(Mutex<TrayIconStyle>);

#[derive(Clone, Copy, Default)]
struct TrayDisplaySnapshot {
    mode: TrayDisplayMode,
    focus_seconds: f64,
}

#[derive(Default)]
pub struct TrayDisplayState(Mutex<TrayDisplaySnapshot>);

pub struct TrayRefreshWorker {
    lifecycle: Mutex<TrayRefreshWorkerLifecycle>,
}

enum TrayRefreshWorkerLifecycle {
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

impl Default for TrayRefreshWorker {
    fn default() -> Self {
        Self {
            lifecycle: Mutex::new(TrayRefreshWorkerLifecycle::NotStarted),
        }
    }
}

impl TrayRefreshWorker {
    pub(crate) fn start(
        &self,
        refresh: impl Fn(&Arc<AtomicBool>) + Send + 'static,
    ) -> std::io::Result<bool> {
        let mut lifecycle = self
            .lifecycle
            .lock()
            .expect("tray refresh worker lifecycle should not be poisoned");
        if !matches!(&*lifecycle, TrayRefreshWorkerLifecycle::NotStarted) {
            return Ok(false);
        }

        let (stop_tx, stop_rx) = mpsc::channel();
        let stopping = Arc::new(AtomicBool::new(false));
        let failed = Arc::new(AtomicBool::new(false));
        let worker_stopping = Arc::clone(&stopping);
        let worker_failed = Arc::clone(&failed);
        let join = std::thread::Builder::new()
            .name("drifty-tray-refresh".into())
            .spawn(move || {
                while !worker_stopping.load(Ordering::Acquire) {
                    if panic::catch_unwind(AssertUnwindSafe(|| refresh(&worker_stopping))).is_err()
                    {
                        worker_failed.store(true, Ordering::Release);
                        worker_stopping.store(true, Ordering::Release);
                        eprintln!("[tray] Refresh worker panicked and stopped");
                        break;
                    }

                    if worker_stopping.load(Ordering::Acquire) {
                        break;
                    }

                    match stop_rx.recv_timeout(TRAY_REFRESH_INTERVAL) {
                        Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
                        Err(mpsc::RecvTimeoutError::Timeout) => {}
                    }
                }
            })?;

        *lifecycle = TrayRefreshWorkerLifecycle::Running {
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
                .expect("tray refresh worker lifecycle should not be poisoned");
            let previous = std::mem::replace(&mut *lifecycle, TrayRefreshWorkerLifecycle::Stopping);
            match previous {
                TrayRefreshWorkerLifecycle::Running {
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
            eprintln!("[tray] Refresh worker thread terminated with a panic");
        }

        let refresh_failed = failed.load(Ordering::Acquire) || join_failed;
        let mut lifecycle = self
            .lifecycle
            .lock()
            .expect("tray refresh worker lifecycle should not be poisoned");
        if matches!(&*lifecycle, TrayRefreshWorkerLifecycle::Stopping) {
            *lifecycle = TrayRefreshWorkerLifecycle::Stopped;
        }
        refresh_failed
    }
}

pub(crate) fn shutdown_tray_refresh_worker(app: &AppHandle) {
    if let Some(worker) = app.try_state::<TrayRefreshWorker>() {
        worker.shutdown();
    }
}

#[tauri::command]
pub fn tray_update_productivity_icon(
    app: AppHandle,
    state: State<'_, TrayProductivityState>,
    focus: f64,
    drift: f64,
    neutral: f64,
) -> Result<(), String> {
    update_tray_productivity_mix(&state, focus, drift, neutral)?;
    update_tray_icon(&app);
    Ok(())
}

#[tauri::command]
pub async fn tray_update_drift_alarm_status(
    app: AppHandle,
    state: State<'_, TrayDriftAlarmState>,
    status: TrayDriftAlarmStatus,
) -> Result<(), String> {
    state.publish_renderer_status(status, || app.state::<TrackingPauseState>().view())?;

    run_menu_update(app, refresh_tray_menu_on_main_thread).await
}

#[tauri::command]
pub fn tray_update_icon_style(
    app: AppHandle,
    state: State<'_, TrayIconStyleState>,
    style: TrayIconStyle,
) -> Result<(), String> {
    let mut latest = state
        .0
        .lock()
        .map_err(|_| "tray icon style state lock poisoned".to_string())?;
    *latest = style;
    drop(latest);

    update_tray_icon(&app);
    Ok(())
}

#[tauri::command]
pub fn tray_update_display_mode(
    app: AppHandle,
    state: State<'_, TrayDisplayState>,
    mode: TrayDisplayMode,
    focus_seconds: f64,
) -> Result<(), String> {
    let snapshot = TrayDisplaySnapshot {
        mode,
        focus_seconds: finite_non_negative(focus_seconds),
    };
    let mut latest = state
        .0
        .lock()
        .map_err(|_| "tray display state lock poisoned".to_string())?;
    *latest = snapshot;
    drop(latest);

    apply_tray_display_title(&app, snapshot, latest_tray_language(&app));
    update_tray_icon(&app);
    Ok(())
}

pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    if app.try_state::<TrayMenuState>().is_some() {
        return Ok(());
    }
    let menu = TrayMenu::new(app, tray_menu_rows(&tray_menu_plan(app)))?;

    #[cfg(target_os = "windows")]
    let (initial_rgba, iw, ih) = donut_icon::render_windows_tray_badge(windows_tray_icon_size());
    #[cfg(not(target_os = "windows"))]
    let (initial_rgba, iw, ih) = donut_icon::render(DonutIconRenderInput {
        focus: 0.0,
        drift: 0.0,
        neutral: 0.0,
        is_dark: is_dark_mode(),
        style: latest_tray_icon_style(app),
    });
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(Image::new_owned(initial_rgba, iw, ih))
        .icon_as_template(false)
        .tooltip("Drifty")
        .show_menu_on_left_click(true)
        .menu(&menu.menu)
        .on_menu_event(|app, event| {
            let Some(action) = ShellAction::from_tray_menu_id(event.id().as_ref()) else {
                return;
            };

            shell_action::dispatch(app, action);
        })
        .build(app)?;

    // Keep the root and every potential child alive, even while hidden.
    app.manage(TrayMenuState(Mutex::new(menu)));
    let app_handle = app.clone();
    let _ = app
        .state::<TrayRefreshWorker>()
        .start(move |stopping| refresh_tray_icon_on_worker(&app_handle, stopping))?;

    Ok(())
}

/// One snapshot of the values rendered by the tray menu.
#[derive(Clone, Debug, Eq, PartialEq)]
struct TrayMenuPlan {
    korean: bool,
    show_pause_options: bool,
    tracking_action: &'static str,
    pause_status: Option<String>,
    drift_alerts_status: String,
    drift_summary: Option<String>,
    app_info: String,
}

struct TrayMenuState(Mutex<TrayMenu<tauri::Wry>>);

fn tray_menu_plan(app: &AppHandle) -> TrayMenuPlan {
    let mut drift_status = latest_tray_drift_alarm_status(app);
    let pause = app.state::<TrackingPauseState>().view();
    // A new generation becomes unconfirmed as soon as its marker is saved,
    // including the interval before its early cache refresh runs.
    drift_status.set_tracker_running(pause.running_hint(drift_status.tracker_running()));
    let lang = latest_tray_language(app);
    let ko = lang.is_korean();

    tray_menu_plan_from(
        lang,
        drift_status.tracker_running(),
        pause.snapshot,
        drift_alerts_status_label(&drift_status, ko),
        drift_summary_label(&drift_status, ko),
        &app.package_info().version.to_string(),
    )
}

fn tray_menu_plan_from(
    lang: TrayLanguage,
    tracker_running: Option<bool>,
    pause_snapshot: TrackingPauseSnapshot,
    drift_alerts_status: String,
    drift_summary: Option<String>,
    version: &str,
) -> TrayMenuPlan {
    TrayMenuPlan {
        korean: lang.is_korean(),
        show_pause_options: pause_options_visible(tracker_running, pause_snapshot),
        tracking_action: tracking_action_label(tracker_running, pause_snapshot, lang),
        pause_status: pause_status_label(pause_snapshot, tracker_running, lang),
        drift_alerts_status,
        drift_summary,
        app_info: app_version_label(version),
    }
}

fn tray_menu_rows(plan: &TrayMenuPlan) -> Vec<MenuRow> {
    let ko = plan.korean;
    let pause = plan.show_pause_options;
    vec![
        MenuRow::item(
            tray_menu_id::PAUSE_HEADER,
            if ko {
                "활동 기록 일시 정지"
            } else {
                "Pause Tracking"
            },
            false,
            pause,
        ),
        MenuRow::item(
            tray_menu_id::PAUSE_FOR_15,
            if ko { "15분 동안" } else { "15 Minutes" },
            pause,
            pause,
        ),
        MenuRow::item(
            tray_menu_id::PAUSE_FOR_30,
            if ko { "30분 동안" } else { "30 Minutes" },
            pause,
            pause,
        ),
        MenuRow::item(
            tray_menu_id::PAUSE_FOR_60,
            if ko { "1시간 동안" } else { "1 Hour" },
            pause,
            pause,
        ),
        MenuRow::item(
            tray_menu_id::PAUSE_FOREVER,
            if ko {
                "직접 다시 시작할 때까지"
            } else {
                "Forever"
            },
            pause,
            pause,
        ),
        MenuRow::item(
            tray_menu_id::TRACKING_TOGGLE,
            plan.tracking_action,
            !pause,
            !pause,
        ),
        MenuRow::item(
            tray_menu_id::PAUSE_STATUS,
            plan.pause_status.as_deref().unwrap_or(""),
            false,
            plan.pause_status.is_some(),
        ),
        MenuRow::separator("tracking-separator"),
        MenuRow::item(
            tray_menu_id::DRIFT_ALERTS_STATUS,
            &plan.drift_alerts_status,
            false,
            true,
        ),
        MenuRow::item(
            tray_menu_id::DRIFT_SUMMARY,
            plan.drift_summary.as_deref().unwrap_or(""),
            false,
            plan.drift_summary.is_some(),
        ),
        MenuRow::separator("drift-separator"),
        MenuRow::item(
            tray_menu_id::OPEN_DASHBOARD,
            if ko {
                "대시보드 열기"
            } else {
                "Open Dashboard"
            },
            true,
            true,
        ),
        MenuRow::item(
            tray_menu_id::SETTINGS,
            if ko { "설정" } else { "Settings" },
            true,
            true,
        ),
        MenuRow::separator("app-info-separator"),
        MenuRow::item(tray_menu_id::APP_INFO, &plan.app_info, false, true),
        MenuRow::item(
            tray_menu_id::UPDATE_STATUS,
            if ko {
                "업데이트 확인…"
            } else {
                UPDATE_STATUS_LABEL
            },
            true,
            true,
        ),
        MenuRow::separator("quit-separator"),
        MenuRow::item(
            tray_menu_id::QUIT,
            if ko { "Drifty 종료" } else { "Quit" },
            true,
            true,
        ),
    ]
}

fn refresh_tray_menu(app: &AppHandle) -> tauri::Result<()> {
    let callback_app = app.clone();
    // Queue the entire read/apply transaction. Never hold a worker-side menu
    // lock while a Tauri setter waits for the main thread.
    app.run_on_main_thread(move || {
        if let Err(error) = refresh_tray_menu_on_main_thread(&callback_app) {
            eprintln!("[tray] Could not refresh menu: {error}");
        }
    })
}

fn refresh_tray_menu_on_main_thread(app: &AppHandle) -> tauri::Result<()> {
    let Some(state) = app.try_state::<TrayMenuState>() else {
        return Ok(());
    };
    let rows = tray_menu_rows(&tray_menu_plan(app));
    let mut menu = state
        .0
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    menu.apply(rows)
}

fn app_version_label(version: &str) -> String {
    format!("Drifty {version}")
}

fn tracking_action_label(
    running: Option<bool>,
    pause_snapshot: TrackingPauseSnapshot,
    lang: TrayLanguage,
) -> &'static str {
    let ko = lang.is_korean();
    if pause_snapshot.is_active() {
        if ko { "활동 기록 다시 시작" } else { "Resume Tracking" }
    } else if running.unwrap_or(false) {
        if ko { "활동 기록 일시 정지" } else { "Pause Tracking" }
    } else {
        if ko { "활동 기록 시작" } else { "Start Tracking" }
    }
}

fn pause_options_visible(running: Option<bool>, pause_snapshot: TrackingPauseSnapshot) -> bool {
    !pause_snapshot.is_active() && running == Some(true)
}

fn pause_status_label(
    pause_snapshot: TrackingPauseSnapshot,
    tracker_running: Option<bool>,
    lang: TrayLanguage,
) -> Option<String> {
    let ko = lang.is_korean();
    if pause_snapshot.is_active() {
        if tracker_running == Some(true) {
            return Some(if ko {
                "일시 정지 요청됨 · 아직 기록 중, 재시도 중"
            } else {
                "Pause requested · still tracking, retrying"
            }
            .to_string());
        }
        if tracker_running.is_none() {
            return Some(if ko {
                "일시 정지 요청됨 · 기록 상태 확인 불가"
            } else {
                "Pause requested · tracking status unavailable"
            }
            .to_string());
        }
    }
    match pause_snapshot {
        TrackingPauseSnapshot::Inactive => None,
        TrackingPauseSnapshot::Indefinite => Some(
            if ko { "일시 정지됨 · 직접 다시 시작 필요" } else { "Paused until you resume" }.to_string()
        ),
        TrackingPauseSnapshot::Timed {
            resumes_at_unix_seconds,
        } => {
            let time = local_clock_label(resumes_at_unix_seconds);
            Some(if ko {
                format!("일시 정지됨 · {time}에 다시 시작")
            } else {
                format!("Paused · resumes at {time}")
            })
        }
        TrackingPauseSnapshot::ResumeFailed { .. } => {
            Some(
                if ko { "일시 정지됨 · 자동 재개 실패" } else { "Paused · automatic resume failed" }.to_string()
            )
        }
    }
}

fn local_clock_label(unix_seconds: i64) -> String {
    let Some(utc) = DateTime::<Utc>::from_timestamp(unix_seconds, 0) else {
        return "unknown time".to_string();
    };
    let label = utc.with_timezone(&Local).format("%I:%M %p").to_string();
    label.strip_prefix('0').unwrap_or(&label).to_string()
}

static TRAY_TOGGLE_PENDING: AtomicBool = AtomicBool::new(false);

struct ClearTrayTogglePending;

impl Drop for ClearTrayTogglePending {
    fn drop(&mut self) {
        TRAY_TOGGLE_PENDING.store(false, Ordering::Release);
    }
}

pub(crate) fn toggle_tracking(app: &AppHandle) {
    // A queued Pause already changed intent. Let its newer Resume through even
    // while the old toggle worker is waiting for a slow Start to release RPCs.
    let is_resume = tracking_pause::snapshot(app).is_active();
    if !is_resume
        && TRAY_TOGGLE_PENDING
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
    {
        return;
    }
    let pending = (!is_resume).then(|| ClearTrayTogglePending);
    // This is the action the visible menu offers. Record it before dispatching
    // a worker so an old queued toggle cannot reinterpret a new Pause as Resume.
    let wants_pause = !is_resume && cached_tracker_running(app) == Some(true);
    let intent = if wants_pause {
        tracking_pause::prepare_indefinite_pause(app).map(Some)
    } else {
        tracking_pause::prepare_manual_start(app, true)
    };
    let intent = match intent {
        Ok(Some(intent)) => intent,
        Ok(None) => return,
        Err(error) => {
            eprintln!("[tracking-pause] Refusing tray action without durable intent: {error}");
            return;
        }
    };
    if wants_pause {
        queue_pause_requested_refresh(app);
    } else {
        queue_tracking_controls_ui_refresh(app);
    }
    let worker_app = app.clone();
    let _ = tauri::async_runtime::spawn_blocking(move || {
        let _pending = pending;
        if wants_pause {
            if let Err(error) = finish_pause_tracking_forever_blocking(&worker_app, intent) {
                eprintln!("[tracking-pause] Could not pause tracking from tray: {error}");
            }
        } else {
            let pause_state = worker_app.state::<TrackingPauseState>();
            let _operation = pause_state.lock_operation();
            start_tracking_from_tray(
                &worker_app,
                &worker_app.state::<TrackerController>(),
                intent,
            );
        }
    });
}

fn start_tracking_from_tray(
    app: &AppHandle,
    controller: &TrackerController,
    intent: tracking_pause::TrackingIntent,
) {
    if !tracking_pause::start_intent_is_current(app, intent.generation) {
        return;
    }
    let startup_state = app.state::<TrackerStartupState>();
    let generation = intent.startup_generation;
    match controller.start_with_recovery(app, intent.generation) {
        Ok(status) if status.running => {
            if startup_state.complete_start_success(generation)
                || tracking_pause::snapshot(app).is_active()
            {
                queue_tracking_controls_refresh(app, Some(true));
            }
        }
        Ok(status) => {
            let error = TrackerError::TrackerReturnedError(
                "tracker did not report running after tray start".to_string(),
            );
            if startup_state.record_start_failure(generation, &error) {
                queue_tracking_controls_refresh(app, Some(status.running));
            }
        }
        Err(error) => {
            if startup_state.record_start_failure(generation, &error) {
                eprintln!("[tracker] Could not start tracking from tray: {error}");
                queue_tracking_controls_refresh(app, None);
            }
        }
    }
}

pub(crate) fn pause_tracking_forever(app: &AppHandle) {
    let intent = match tracking_pause::prepare_indefinite_pause(app) {
        Ok(intent) => intent,
        Err(error) => {
            eprintln!("[tracking-pause] Refusing an unpersisted indefinite pause: {error}");
            return;
        }
    };
    queue_pause_requested_refresh(app);
    let worker_app = app.clone();
    let _ = tauri::async_runtime::spawn_blocking(move || {
        if let Err(error) = finish_pause_tracking_forever_blocking(&worker_app, intent) {
            eprintln!("[tracking-pause] Could not pause tracking: {error}");
        }
    });
}

pub(crate) fn pause_tracking_forever_blocking(app: &AppHandle) -> Result<(), String> {
    let intent = tracking_pause::prepare_indefinite_pause(app)
        .map_err(|error| format!("Could not save the pause before stopping tracking: {error}"))?;
    queue_pause_requested_refresh(app);
    finish_pause_tracking_forever_blocking(app, intent)
}

fn finish_pause_tracking_forever_blocking(
    app: &AppHandle,
    intent: tracking_pause::TrackingIntent,
) -> Result<(), String> {
    let pause_state = app.state::<TrackingPauseState>();
    let controller = app.state::<TrackerController>();
    let _operation = pause_state.lock_operation();
    if !pause_state.generation_is_current(intent.generation) {
        return Ok(());
    }
    let outcome = tracking_pause::finish_indefinite_pause_stop(
        app, &controller, intent, controller.stop(app),
    );
    if !pause_state.generation_is_current(intent.generation) {
        return Ok(());
    }
    match outcome {
        tracking_pause::IndefinitePauseStopOutcome::Paused(_status) => {
            app.state::<TrackerStartupState>()
                .complete_stop_success(intent.startup_generation);
            queue_tracking_controls_refresh(app, Some(false));
            Ok(())
        }
        tracking_pause::IndefinitePauseStopOutcome::StillRunning(status) => {
            queue_tracking_controls_refresh(app, Some(status.running));
            Err("The tracker still reports that it is running.".to_string())
        }
        tracking_pause::IndefinitePauseStopOutcome::Ambiguous(error) => {
            eprintln!(
                "[tracking-pause] Preserving indefinite pause after an ambiguous stop: {error}"
            );
            queue_tracking_controls_refresh(app, None);
            Ok(())
        }
    }
}

fn refresh_tracking_controls(app: &AppHandle) {
    let _ = refresh_tray_menu(app);
    update_tray_icon(app);
}

pub(crate) fn queue_tracking_controls_refresh(app: &AppHandle, running: Option<bool>) {
    // Record native observations before dispatch. An older UI callback must
    // not replay its captured observation over a newer Pause or status reply.
    // Generic false hints (including a failed Start) do not confirm Stop.
    // Only native Stop/status readers confirm their observed generation.
    if running != Some(false) {
        let pause_state = app.state::<TrackingPauseState>();
        pause_state.invalidate_stopped_confirmation(pause_state.current_generation());
    }
    update_cached_tracker_running(app, running);
    queue_tracking_controls_ui_refresh(app);
}

pub(crate) fn queue_tracking_controls_ui_refresh(app: &AppHandle) {
    let callback_app = app.clone();
    if let Err(error) = app.run_on_main_thread(move || {
        refresh_tracking_controls(&callback_app);
    }) {
        eprintln!("[tray] Could not queue tracking-control refresh: {error}");
    }
}

pub(crate) fn pause_requested_running_hint(last_known_running: Option<bool>) -> Option<bool> {
    // A stopped cache may predate a Start whose reply is still pending. Keep
    // last-known running evidence, but require a new status/Stop confirmation
    // before a newly requested Pause can be displayed as actually stopped.
    last_known_running.filter(|running| *running)
}

pub(crate) fn queue_pause_requested_refresh(app: &AppHandle) {
    if let Some(state) = app.try_state::<TrayDriftAlarmState>() {
        if let Err(error) = state.mark_pause_requested(|| app.state::<TrackingPauseState>().view()) {
            eprintln!("[tray] Could not record the requested pause: {error}");
        }
    }
    queue_tracking_controls_ui_refresh(app);
}

fn update_cached_tracker_running(app: &AppHandle, running: Option<bool>) {
    if let Some(state) = app.try_state::<TrayDriftAlarmState>() {
        state.set_tracker_running(running);
    }
}

pub(crate) fn cached_tracker_running(app: &AppHandle) -> Option<bool> {
    let running = app.try_state::<TrayDriftAlarmState>()
        .and_then(|state| state.tracker_running());
    app.state::<TrackingPauseState>().view().running_hint(running)
}

/// Equality key over everything that feeds the tray icon rasterizer. The 60s
/// worker prepares a new icon off-thread, then queues only the final tray
/// mutation onto the main thread; request generations discard stale callbacks.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct TrayIconRenderKey {
    focus_bits: u64,
    drift_bits: u64,
    neutral_bits: u64,
    is_dark: bool,
    style: TrayIconStyle,
    display_mode: TrayDisplayMode,
    pixel_size: u32,
}

impl TrayIconRenderKey {
    fn new(
        focus: f64,
        drift: f64,
        neutral: f64,
        is_dark: bool,
        style: TrayIconStyle,
        display_mode: TrayDisplayMode,
        pixel_size: u32,
    ) -> Self {
        Self {
            focus_bits: focus.to_bits(),
            drift_bits: drift.to_bits(),
            neutral_bits: neutral.to_bits(),
            is_dark,
            style,
            display_mode,
            pixel_size,
        }
    }
}

struct PreparedTrayIcon {
    request_generation: u64,
    key: TrayIconRenderKey,
    rgba: Vec<u8>,
    width: u32,
    height: u32,
}

#[derive(Default)]
struct TrayIconRenderState {
    latest_requested_generation: u64,
    last_applied_key: Option<TrayIconRenderKey>,
}

impl TrayIconRenderState {
    fn claim_request(&mut self) -> u64 {
        self.latest_requested_generation = self.latest_requested_generation.saturating_add(1);
        self.latest_requested_generation
    }

    fn is_current_key(&self, key: TrayIconRenderKey) -> bool {
        self.last_applied_key == Some(key)
    }

    fn should_apply(&self, request_generation: u64, key: TrayIconRenderKey) -> bool {
        request_generation == self.latest_requested_generation && !self.is_current_key(key)
    }

    fn record_applied(&mut self, key: TrayIconRenderKey) {
        self.last_applied_key = Some(key);
    }
}

static TRAY_ICON_RENDER_STATE: Mutex<TrayIconRenderState> = Mutex::new(TrayIconRenderState {
    latest_requested_generation: 0,
    last_applied_key: None,
});

fn update_tray_icon(app: &AppHandle) {
    if app.tray_by_id(TRAY_ID).is_none() {
        return;
    }

    let request_generation = claim_tray_icon_render_request();
    if let Some(icon) = prepare_tray_icon(app, request_generation) {
        apply_prepared_tray_icon(app, icon);
    }
}

fn refresh_tray_icon_on_worker(app: &AppHandle, stopping: &Arc<AtomicBool>) {
    if stopping.load(Ordering::Acquire) {
        return;
    }

    let request_generation = claim_tray_icon_render_request();
    let Some(icon) = prepare_tray_icon(app, request_generation) else {
        return;
    };

    let scheduler = app.clone();
    let callback_app = app.clone();
    if let Err(error) = enqueue_main_thread_mutation(
        stopping,
        move |callback| scheduler.run_on_main_thread(callback),
        move || apply_prepared_tray_icon(&callback_app, icon),
    ) {
        if !stopping.load(Ordering::Acquire) {
            eprintln!("[tray] Could not queue refresh icon update: {error}");
        }
    }
}

fn enqueue_main_thread_mutation<E>(
    stopping: &Arc<AtomicBool>,
    enqueue: impl FnOnce(Box<dyn FnOnce() + Send + 'static>) -> Result<(), E>,
    mutation: impl FnOnce() + Send + 'static,
) -> Result<bool, E> {
    if stopping.load(Ordering::Acquire) {
        return Ok(false);
    }

    let callback_stopping = Arc::clone(stopping);
    enqueue(Box::new(move || {
        if !callback_stopping.load(Ordering::Acquire) {
            mutation();
        }
    }))?;
    Ok(true)
}

fn prepare_tray_icon(app: &AppHandle, request_generation: u64) -> Option<PreparedTrayIcon> {
    let mix = latest_tray_productivity_mix(app).or_else(|| {
        let controller = app.try_state::<TrackerController>()?;
        let (focus, drift, neutral) = controller.get_daily_stats(app);
        TrayProductivityMix::from_values(focus, drift, neutral)
    });
    let (focus, drift, neutral) = match mix {
        Some(value) => (value.focus, value.drift, value.neutral),
        None => (0.0, 0.0, 0.0),
    };
    let dark = is_dark_mode();
    let style = latest_tray_icon_style(app);
    let display = latest_tray_display(app);
    let pixel_size = tray_icon_pixel_size();
    let key = TrayIconRenderKey::new(
        focus,
        drift,
        neutral,
        dark,
        style,
        display.mode,
        pixel_size,
    );

    if tray_icon_render_key_is_current(key) {
        return None;
    }

    let (rgba, width, height) = render_tray_display_icon(
        display.mode,
        focus,
        drift,
        neutral,
        dark,
        style,
        pixel_size,
    );
    Some(PreparedTrayIcon {
        request_generation,
        key,
        rgba,
        width,
        height,
    })
}

fn render_tray_display_icon(
    mode: TrayDisplayMode,
    focus: f64,
    drift: f64,
    neutral: f64,
    dark: bool,
    style: TrayIconStyle,
    pixel_size: u32,
) -> (Vec<u8>, u32, u32) {
    #[cfg(target_os = "windows")]
    {
        // Keep the branded mark theme-independent: the Windows overflow panel
        // can be light even when the taskbar is dark.
        let _ = (mode, focus, drift, neutral, dark, style);
        return donut_icon::render_windows_tray_badge(pixel_size);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = pixel_size;
        match mode {
            TrayDisplayMode::Donut => donut_icon::render(DonutIconRenderInput {
                focus,
                drift,
                neutral,
                is_dark: dark,
                style,
            }),
            TrayDisplayMode::FocusTime => {
                add_trailing_icon_space(donut_icon::render_focus_dot(dark), 4)
            }
            /* This mode replaces the Focus-time dot, so it deliberately keeps the
            compact 18px ring even if the legacy tray icon style is Expanded. */
            TrayDisplayMode::DonutFocusTime => add_trailing_icon_space(
                donut_icon::render(DonutIconRenderInput {
                    focus,
                    drift,
                    neutral,
                    is_dark: dark,
                    style: TrayIconStyle::Compact,
                }),
                4,
            ),
        }
    }
}

fn add_trailing_icon_space(
    (pixels, width, height): (Vec<u8>, u32, u32),
    trailing_space: u32,
) -> (Vec<u8>, u32, u32) {
    if trailing_space == 0 {
        return (pixels, width, height);
    }
    let source_width = width as usize;
    let target_width = (width + trailing_space) as usize;
    let height = height as usize;
    let mut padded = vec![0; target_width * height * 4];
    for row in 0..height {
        let source_start = row * source_width * 4;
        let target_start = row * target_width * 4;
        padded[target_start..target_start + source_width * 4]
            .copy_from_slice(&pixels[source_start..source_start + source_width * 4]);
    }
    (padded, target_width as u32, height as u32)
}

fn claim_tray_icon_render_request() -> u64 {
    let mut state = match TRAY_ICON_RENDER_STATE.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    state.claim_request()
}

fn tray_icon_render_key_is_current(key: TrayIconRenderKey) -> bool {
    let state = match TRAY_ICON_RENDER_STATE.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    state.is_current_key(key)
}

fn apply_prepared_tray_icon(app: &AppHandle, icon: PreparedTrayIcon) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    let mut render_state = match TRAY_ICON_RENDER_STATE.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    if !render_state.should_apply(icon.request_generation, icon.key) {
        return;
    }

    if tray
        .set_icon(Some(Image::new_owned(icon.rgba, icon.width, icon.height)))
        .is_ok()
    {
        render_state.record_applied(icon.key);
    }
}

fn latest_tray_icon_style(app: &AppHandle) -> TrayIconStyle {
    app.try_state::<TrayIconStyleState>()
        .and_then(|state| state.0.lock().ok().map(|latest| *latest))
        .unwrap_or_default()
}

fn latest_tray_display(app: &AppHandle) -> TrayDisplaySnapshot {
    app.try_state::<TrayDisplayState>()
        .and_then(|state| state.0.lock().ok().map(|latest| *latest))
        .unwrap_or_default()
}

fn apply_tray_display_title(app: &AppHandle, display: TrayDisplaySnapshot, lang: TrayLanguage) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    let ko = lang.is_korean();
    match display.mode {
        TrayDisplayMode::Donut => {
            let _ = tray.set_title(Some(""));
            let _ = tray.set_tooltip(Some("Drifty"));
        }
        TrayDisplayMode::FocusTime => {
            let focused = format_focus_time(display.focus_seconds);
            let title = if ko {
                format!("{focused} 집중")
            } else {
                format!("{focused} focused")
            };
            let _ = tray.set_title(Some(&title));
            apply_tray_title_typography(&tray, title, lang);
            let _ = tray.set_tooltip(Some(if ko {
                format!("Drifty · 오늘 {focused} 집중")
            } else {
                format!("Drifty · {focused} focused today")
            }));
        }
        TrayDisplayMode::DonutFocusTime => {
            let focused = format_focus_time(display.focus_seconds);
            let title = if ko {
                format!("{focused} 집중")
            } else {
                format!("{focused} focused")
            };
            let _ = tray.set_title(Some(&title));
            apply_tray_title_typography(&tray, title, lang);
            let _ = tray.set_tooltip(Some(if ko {
                format!("Drifty · 오늘 {focused} 집중 · 생산성 비율")
            } else {
                format!("Drifty · {focused} focused today · productivity mix")
            }));
        }
    }
}

#[cfg(target_os = "macos")]
fn apply_tray_title_typography(tray: &tauri::tray::TrayIcon, title: String, lang: TrayLanguage) {
    let _ = tray.with_inner_tray_icon(move |inner| {
        let Some(status_item) = inner.ns_status_item() else {
            return;
        };
        let font_size = scaled_tray_title_size(NSFont::systemFontSize());
        let font = NSFont::systemFontOfSize_weight(
            font_size,
            reduced_tray_title_weight(unsafe { NSFontWeightSemibold }),
        );
        let color = NSColor::labelColor();
        let attributes = NSDictionary::from_retained_objects(
            &[unsafe { NSFontAttributeName }, unsafe {
                NSForegroundColorAttributeName
            }],
            &[
                font.into_super().into_super(),
                color.into_super().into_super(),
            ],
        );
        let title = NSString::from_str(&title);
        let attributed = unsafe { NSAttributedString::new_with_attributes(&title, &attributes) };
        let attributed = NSMutableAttributedString::from_attributed_nsstring(&attributed);
        let suffix = if lang.is_korean() { "집중" } else { "focused" };
        if let Some(label_start) = focused_label_start_utf16(&title.to_string(), suffix) {
            let secondary_color = NSColor::colorWithCalibratedWhite_alpha(0.88, 0.92)
                .into_super()
                .into_super();
            let extra_spacing = NSNumber::numberWithDouble(2.0).into_super().into_super();
            unsafe {
                attributed.addAttribute_value_range(
                    NSForegroundColorAttributeName,
                    &secondary_color,
                    NSRange::new(label_start, suffix.encode_utf16().count()),
                );
                attributed.addAttribute_value_range(
                    NSKernAttributeName,
                    &extra_spacing,
                    NSRange::new(label_start.saturating_sub(1), 1),
                );
            }
        }
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let Some(button) = status_item.button(mtm) else {
            return;
        };
        button.setAttributedTitle(&attributed);
    });
}

#[cfg(not(target_os = "macos"))]
fn apply_tray_title_typography(_tray: &tauri::tray::TrayIcon, _title: String, _lang: TrayLanguage) {}

fn scaled_tray_title_size(system_size: f64) -> f64 {
    system_size * TRAY_TITLE_SCALE
}

fn reduced_tray_title_weight(weight: f64) -> f64 {
    weight * 0.96
}

fn focused_label_start_utf16(title: &str, suffix: &str) -> Option<usize> {
    let prefix = title.strip_suffix(suffix)?;
    Some(prefix.encode_utf16().count())
}

fn format_focus_time(focus_seconds: f64) -> String {
    let total_minutes = (finite_non_negative(focus_seconds) / 60.0).floor() as u64;
    format!("{}:{:02}", total_minutes / 60, total_minutes % 60)
}

fn finite_non_negative(value: f64) -> f64 {
    if value.is_finite() {
        value.max(0.0)
    } else {
        0.0
    }
}

fn latest_tray_drift_alarm_status(app: &AppHandle) -> TrayDriftAlarmStatus {
    app.try_state::<TrayDriftAlarmState>()
        .and_then(|state| state.0.lock().ok().map(|latest| latest.clone()))
        .unwrap_or_default()
}

#[cfg(target_os = "macos")]
fn is_dark_mode() -> bool {
    std::process::Command::new("defaults")
        .args(["read", "-g", "AppleInterfaceStyle"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim() == "Dark")
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
fn is_dark_mode() -> bool {
    // The Windows badge is deliberately theme-independent. Keep this stable
    // input only for the shared render key used by every platform.
    false
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn is_dark_mode() -> bool {
    false
}

#[cfg(target_os = "windows")]
fn windows_tray_icon_size() -> u32 {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXSMICON};

    let size = unsafe { GetSystemMetrics(SM_CXSMICON) };
    u32::try_from(size).ok().filter(|value| *value > 0).unwrap_or(16)
}

#[cfg(target_os = "windows")]
fn tray_icon_pixel_size() -> u32 {
    windows_tray_icon_size()
}

#[cfg(not(target_os = "windows"))]
const fn tray_icon_pixel_size() -> u32 {
    18
}
