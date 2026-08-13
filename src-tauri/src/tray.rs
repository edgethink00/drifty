mod drift_alarm_status;
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
use tauri::menu::{Menu, MenuBuilder, MenuItem};
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
use self::productivity_icon::{
    latest_tray_productivity_mix, update_tray_productivity_mix, TrayProductivityMix,
};

pub use self::productivity_icon::TrayProductivityState;
use crate::donut_icon::{self, DonutIconRenderInput, TrayDisplayMode, TrayIconStyle};
use crate::shell_action::{self, tray_menu_id, ShellAction};
use crate::tracker::TrackerController;
use crate::tracking_pause::{self, TrackingPauseSnapshot, TrackingPauseState};

const TRAY_ID: &str = "drifty-menu";
const UPDATE_STATUS_LABEL: &str = "Check for Updates...";
const TRAY_REFRESH_INTERVAL: Duration = Duration::from_secs(60);
const TRAY_TITLE_SCALE: f64 = 1.03;

pub(crate) fn tray_icon_rect(app: &AppHandle) -> Option<tauri::Rect> {
    app.tray_by_id(TRAY_ID)
        .and_then(|tray| tray.rect().ok().flatten())
}

#[derive(Default)]
pub struct TrayDriftAlarmState(Mutex<TrayDriftAlarmStatus>);

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
pub fn tray_update_drift_alarm_status(
    app: AppHandle,
    state: State<'_, TrayDriftAlarmState>,
    status: TrayDriftAlarmStatus,
) -> Result<(), String> {
    let mut latest = state
        .0
        .lock()
        .map_err(|_| "tray drift alarm state lock poisoned".to_string())?;
    *latest = status;
    drop(latest);

    refresh_tray_menu(&app).map_err(|error| error.to_string())
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

    apply_tray_display_title(&app, snapshot);
    update_tray_icon(&app);
    Ok(())
}

pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_tray_menu(app)?;

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
        .menu(&menu)
        .on_menu_event(|app, event| {
            let Some(action) = ShellAction::from_tray_menu_id(event.id().as_ref()) else {
                return;
            };

            shell_action::dispatch(app, action);
        })
        .build(app)?;

    let app_handle = app.clone();
    let _ = app
        .state::<TrayRefreshWorker>()
        .start(move |stopping| refresh_tray_icon_on_worker(&app_handle, stopping))?;

    Ok(())
}

fn build_tray_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let version = app.package_info().version.to_string();
    let drift_status = latest_tray_drift_alarm_status(app);
    let pause_snapshot = tracking_pause::snapshot(app);
    let tracker_running = drift_status.tracker_running();
    let app_info = MenuItem::with_id(
        app,
        tray_menu_id::APP_INFO,
        app_version_label(&version),
        false,
        None::<&str>,
    )?;
    let update_status = MenuItem::with_id(
        app,
        tray_menu_id::UPDATE_STATUS,
        update_status_label(),
        true,
        None::<&str>,
    )?;
    let drift_alerts_status = MenuItem::with_id(
        app,
        tray_menu_id::DRIFT_ALERTS_STATUS,
        drift_alerts_status_label(&drift_status),
        false,
        None::<&str>,
    )?;
    let drift_summary = drift_summary_label(&drift_status)
        .map(|label| {
            MenuItem::with_id(app, tray_menu_id::DRIFT_SUMMARY, label, false, None::<&str>)
        })
        .transpose()?;
    let show_pause_options = pause_options_visible(tracker_running, pause_snapshot);
    let pause_header = MenuItem::with_id(
        app,
        tray_menu_id::PAUSE_HEADER,
        "Pause Tracking",
        false,
        None::<&str>,
    )?;
    let pause_15 = MenuItem::with_id(
        app,
        tray_menu_id::PAUSE_FOR_15,
        "15 Minutes",
        show_pause_options,
        None::<&str>,
    )?;
    let pause_30 = MenuItem::with_id(
        app,
        tray_menu_id::PAUSE_FOR_30,
        "30 Minutes",
        show_pause_options,
        None::<&str>,
    )?;
    let pause_60 = MenuItem::with_id(
        app,
        tray_menu_id::PAUSE_FOR_60,
        "1 Hour",
        show_pause_options,
        None::<&str>,
    )?;
    let pause_forever = MenuItem::with_id(
        app,
        tray_menu_id::PAUSE_FOREVER,
        "Forever",
        show_pause_options,
        None::<&str>,
    )?;
    let pause_status = pause_status_label(pause_snapshot)
        .map(|label| MenuItem::with_id(app, tray_menu_id::PAUSE_STATUS, label, false, None::<&str>))
        .transpose()?;

    let mut builder = MenuBuilder::new(app);

    if show_pause_options {
        builder = builder.items(&[
            &pause_header,
            &pause_15,
            &pause_30,
            &pause_60,
            &pause_forever,
        ]);
    } else {
        builder = builder.text(
            tray_menu_id::TRACKING_TOGGLE,
            tracking_action_label(tracker_running, pause_snapshot),
        );
    }

    if let Some(status) = &pause_status {
        builder = builder.item(status);
    }

    let mut builder = builder.separator().item(&drift_alerts_status);

    if let Some(summary) = &drift_summary {
        builder = builder.item(summary);
    }

    builder
        .separator()
        .text(tray_menu_id::OPEN_DASHBOARD, "Open Dashboard")
        .text(tray_menu_id::SETTINGS, "Settings")
        .separator()
        .items(&[&app_info, &update_status])
        .separator()
        .text(tray_menu_id::QUIT, "Quit")
        .build()
}

fn refresh_tray_menu(app: &AppHandle) -> tauri::Result<()> {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_menu(Some(build_tray_menu(app)?))?;
    }

    Ok(())
}

fn app_version_label(version: &str) -> String {
    format!("Drifty {version}")
}

fn update_status_label() -> &'static str {
    UPDATE_STATUS_LABEL
}

fn tracking_action_label(
    running: Option<bool>,
    pause_snapshot: TrackingPauseSnapshot,
) -> &'static str {
    if pause_snapshot.is_active() {
        "Resume Tracking"
    } else if running.unwrap_or(false) {
        "Pause Tracking"
    } else {
        "Start Tracking"
    }
}

fn pause_options_visible(running: Option<bool>, pause_snapshot: TrackingPauseSnapshot) -> bool {
    !pause_snapshot.is_active() && running == Some(true)
}

fn pause_status_label(pause_snapshot: TrackingPauseSnapshot) -> Option<String> {
    match pause_snapshot {
        TrackingPauseSnapshot::Inactive => None,
        TrackingPauseSnapshot::Indefinite => Some("Paused until you resume".to_string()),
        TrackingPauseSnapshot::Timed {
            resumes_at_unix_seconds,
        } => Some(format!(
            "Paused · resumes at {}",
            local_clock_label(resumes_at_unix_seconds)
        )),
        TrackingPauseSnapshot::ResumeFailed { .. } => {
            Some("Paused · automatic resume failed".to_string())
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

pub(crate) fn toggle_tracking(app: &AppHandle) {
    let pause_state = app.state::<TrackingPauseState>();
    let _operation = pause_state.lock_operation();
    let controller = app.state::<TrackerController>();
    let pause_active = pause_state.snapshot().is_active();
    let is_running = controller
        .get_status(app)
        .map(|status| status.running)
        .unwrap_or(false);

    if pause_active {
        if let Err(error) = tracking_pause::clear_for_manual_start(app) {
            eprintln!("[tracking-pause] Refusing Resume while its durable pause remains: {error}");
            return;
        }
        match controller.start(app) {
            Ok(status) => refresh_tracking_controls(app, Some(status.running)),
            Err(error) => {
                eprintln!("[tracking-pause] Could not resume tracking: {error}");
                let _ = refresh_tray_menu(app);
                update_tray_icon(app);
            }
        }
        return;
    }

    if is_running {
        if let Err(error) = tracking_pause::prepare_indefinite_pause(app) {
            eprintln!("[tracking-pause] Refusing an unpersisted indefinite pause: {error}");
            return;
        }
    } else if let Err(error) = tracking_pause::clear_for_manual_start(app) {
        eprintln!("[tracking-pause] Refusing Resume while its durable pause remains: {error}");
        return;
    }
    if is_running {
        match tracking_pause::finish_indefinite_pause_stop(app, &controller, controller.stop(app)) {
            tracking_pause::IndefinitePauseStopOutcome::Paused(status) => {
                refresh_tracking_controls(app, Some(status.running));
            }
            tracking_pause::IndefinitePauseStopOutcome::StillRunning(status) => {
                refresh_tracking_controls(app, Some(status.running));
            }
            tracking_pause::IndefinitePauseStopOutcome::Ambiguous(error) => {
                eprintln!(
                    "[tracking-pause] Preserving tray pause after an ambiguous stop: {error}"
                );
                refresh_tracking_controls(app, Some(false));
            }
        }
        return;
    }

    let next_status = controller.start(app);
    if let Ok(status) = next_status {
        refresh_tracking_controls(app, Some(status.running));
        return;
    }
    let _ = refresh_tray_menu(app);
    update_tray_icon(app);
}

pub(crate) fn pause_tracking_forever(app: &AppHandle) {
    let pause_state = app.state::<TrackingPauseState>();
    let _operation = pause_state.lock_operation();
    let controller = app.state::<TrackerController>();
    let is_running = controller
        .get_status(app)
        .map(|status| status.running)
        .unwrap_or(false);
    if !is_running {
        return;
    }
    if let Err(error) = tracking_pause::prepare_indefinite_pause(app) {
        eprintln!("[tracking-pause] Refusing an unpersisted indefinite pause: {error}");
        return;
    }
    match tracking_pause::finish_indefinite_pause_stop(app, &controller, controller.stop(app)) {
        tracking_pause::IndefinitePauseStopOutcome::Paused(_status) => {
            refresh_tracking_controls(app, Some(false));
        }
        tracking_pause::IndefinitePauseStopOutcome::StillRunning(status) => {
            refresh_tracking_controls(app, Some(status.running));
        }
        tracking_pause::IndefinitePauseStopOutcome::Ambiguous(error) => {
            eprintln!(
                "[tracking-pause] Preserving timed-menu pause after an ambiguous stop: {error}"
            );
            refresh_tracking_controls(app, Some(false));
        }
    }
}

pub(crate) fn refresh_tracking_controls(app: &AppHandle, running: Option<bool>) {
    update_cached_tracker_running(app, running);
    let _ = refresh_tray_menu(app);
    update_tray_icon(app);
}

pub(crate) fn queue_tracking_controls_refresh(app: &AppHandle, running: Option<bool>) {
    let callback_app = app.clone();
    if let Err(error) = app.run_on_main_thread(move || {
        refresh_tracking_controls(&callback_app, running);
    }) {
        eprintln!("[tray] Could not queue tracking-control refresh: {error}");
    }
}

fn update_cached_tracker_running(app: &AppHandle, running: Option<bool>) {
    if let Some(state) = app.try_state::<TrayDriftAlarmState>() {
        if let Ok(mut latest) = state.0.lock() {
            latest.set_tracker_running(running);
        }
    }
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
}

impl TrayIconRenderKey {
    fn new(
        focus: f64,
        drift: f64,
        neutral: f64,
        is_dark: bool,
        style: TrayIconStyle,
        display_mode: TrayDisplayMode,
    ) -> Self {
        Self {
            focus_bits: focus.to_bits(),
            drift_bits: drift.to_bits(),
            neutral_bits: neutral.to_bits(),
            is_dark,
            style,
            display_mode,
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
    let key = TrayIconRenderKey::new(focus, drift, neutral, dark, style, display.mode);

    if tray_icon_render_key_is_current(key) {
        return None;
    }

    let (rgba, width, height) =
        render_tray_display_icon(display.mode, focus, drift, neutral, dark, style);
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
) -> (Vec<u8>, u32, u32) {
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

fn apply_tray_display_title(app: &AppHandle, display: TrayDisplaySnapshot) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    match display.mode {
        TrayDisplayMode::Donut => {
            let _ = tray.set_title(Some(""));
            let _ = tray.set_tooltip(Some("Drifty"));
        }
        TrayDisplayMode::FocusTime => {
            let focused = format_focus_time(display.focus_seconds);
            let title = format!("{focused} focused");
            let _ = tray.set_title(Some(&title));
            apply_tray_title_typography(&tray, title);
            let _ = tray.set_tooltip(Some(format!("Drifty · {focused} focused today")));
        }
        TrayDisplayMode::DonutFocusTime => {
            let focused = format_focus_time(display.focus_seconds);
            let title = format!("{focused} focused");
            let _ = tray.set_title(Some(&title));
            apply_tray_title_typography(&tray, title);
            let _ = tray.set_tooltip(Some(format!(
                "Drifty · {focused} focused today · productivity mix"
            )));
        }
    }
}

#[cfg(target_os = "macos")]
fn apply_tray_title_typography(tray: &tauri::tray::TrayIcon, title: String) {
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
        if let Some(label_start) = focused_label_start_utf16(&title.to_string()) {
            let secondary_color = NSColor::colorWithCalibratedWhite_alpha(0.88, 0.92)
                .into_super()
                .into_super();
            let extra_spacing = NSNumber::numberWithDouble(2.0).into_super().into_super();
            unsafe {
                attributed.addAttribute_value_range(
                    NSForegroundColorAttributeName,
                    &secondary_color,
                    NSRange::new(label_start, "focused".len()),
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
fn apply_tray_title_typography(_tray: &tauri::tray::TrayIcon, _title: String) {}

fn scaled_tray_title_size(system_size: f64) -> f64 {
    system_size * TRAY_TITLE_SCALE
}

fn reduced_tray_title_weight(weight: f64) -> f64 {
    weight * 0.96
}

fn focused_label_start_utf16(title: &str) -> Option<usize> {
    let prefix = title.strip_suffix("focused")?;
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

fn is_dark_mode() -> bool {
    std::process::Command::new("defaults")
        .args(["read", "-g", "AppleInterfaceStyle"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim() == "Dark")
        .unwrap_or(false)
}
