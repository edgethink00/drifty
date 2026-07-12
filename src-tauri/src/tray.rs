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

use tauri::image::Image;
use tauri::menu::{Menu, MenuBuilder, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, State};

use self::drift_alarm_status::{
    drift_alerts_status_label, drift_detail_label, drift_last_check_label, drift_result_label,
    TrayDriftAlarmStatus,
};
use self::productivity_icon::{
    latest_tray_productivity_mix, update_tray_productivity_mix, TrayProductivityMix,
};

pub use self::productivity_icon::TrayProductivityState;
use crate::donut_icon::{self, DonutIconRenderInput, TrayIconStyle};
use crate::tracker::TrackerController;
use crate::{reveal_main_window, MAIN_WINDOW_LABEL};

const TRAY_ID: &str = "drifty-menu";
const MENU_APP_INFO: &str = "menu-app-info";
const MENU_UPDATE_STATUS: &str = "menu-update-status";
const MENU_OPEN: &str = "menu-open-dashboard";
const MENU_TRACKING_TOGGLE: &str = "menu-tracking-toggle";
const MENU_DRIFT_ALERTS_STATUS: &str = "menu-drift-alerts-status";
const MENU_DRIFT_LAST_CHECK: &str = "menu-drift-last-check";
const MENU_DRIFT_RESULT: &str = "menu-drift-result";
const MENU_DRIFT_DETAIL: &str = "menu-drift-detail";
const MENU_TOGGLE_THEME: &str = "menu-toggle-theme";
const MENU_SETTINGS: &str = "menu-settings";
const MENU_QUIT: &str = "menu-quit";
const UPDATE_STATUS_LABEL: &str = "Check for Updates...";
const TRAY_REFRESH_INTERVAL: Duration = Duration::from_secs(60);

#[derive(Default)]
pub struct TrayDriftAlarmState(Mutex<TrayDriftAlarmStatus>);

#[derive(Default)]
pub struct TrayIconStyleState(Mutex<TrayIconStyle>);

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
        .on_menu_event(|app, event| match event.id() {
            id if id == MENU_OPEN => {
                reveal_main_window(app);
            }
            id if id == MENU_TRACKING_TOGGLE => {
                let controller = app.state::<TrackerController>();
                let is_running = controller
                    .get_status(app)
                    .map(|status| status.running)
                    .unwrap_or(false);
                let next_status = if is_running {
                    controller.stop(app)
                } else {
                    controller.start(app)
                };
                if let Ok(status) = next_status {
                    update_cached_tracker_running(app, Some(status.running));
                }
                let _ = refresh_tray_menu(app);
                update_tray_icon(app);
            }
            id if id == MENU_TOGGLE_THEME => {
                reveal_main_window(app);
                if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                    let _ = window.emit("tray-toggle-theme", ());
                }
            }
            id if id == MENU_SETTINGS => {
                reveal_main_window(app);
                if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                    let _ = window.emit("tray-open-settings", ());
                }
            }
            id if id == MENU_UPDATE_STATUS => {
                reveal_main_window(app);
                if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                    let _ = window.emit("tray-check-for-updates", ());
                }
            }
            id if id == MENU_QUIT => {
                app.exit(0);
            }
            _ => {}
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
    let app_info = MenuItem::with_id(
        app,
        MENU_APP_INFO,
        app_version_label(&version),
        false,
        None::<&str>,
    )?;
    let update_status = MenuItem::with_id(
        app,
        MENU_UPDATE_STATUS,
        update_status_label(),
        true,
        None::<&str>,
    )?;
    let drift_alerts_status = MenuItem::with_id(
        app,
        MENU_DRIFT_ALERTS_STATUS,
        drift_alerts_status_label(&drift_status),
        false,
        None::<&str>,
    )?;
    let drift_last_check = MenuItem::with_id(
        app,
        MENU_DRIFT_LAST_CHECK,
        drift_last_check_label(&drift_status),
        false,
        None::<&str>,
    )?;
    let drift_result = MenuItem::with_id(
        app,
        MENU_DRIFT_RESULT,
        drift_result_label(&drift_status),
        false,
        None::<&str>,
    )?;
    let drift_detail = drift_detail_label(&drift_status)
        .map(|label| MenuItem::with_id(app, MENU_DRIFT_DETAIL, label, false, None::<&str>))
        .transpose()?;

    let mut builder = MenuBuilder::new(app)
        .text(MENU_OPEN, "Open Dashboard")
        .text(
            MENU_TRACKING_TOGGLE,
            tracking_action_label(drift_status.tracker_running()),
        )
        .separator()
        .items(&[&drift_alerts_status, &drift_last_check, &drift_result]);

    if let Some(detail) = &drift_detail {
        builder = builder.item(detail);
    }

    builder
        .separator()
        .text(MENU_TOGGLE_THEME, "Toggle Theme")
        .text(MENU_SETTINGS, "Settings")
        .separator()
        .items(&[&app_info, &update_status])
        .separator()
        .text(MENU_QUIT, "Quit")
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

fn tracking_action_label(running: Option<bool>) -> &'static str {
    if running.unwrap_or(false) {
        "Pause Tracking"
    } else {
        "Start Tracking"
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
}

impl TrayIconRenderKey {
    fn new(focus: f64, drift: f64, neutral: f64, is_dark: bool, style: TrayIconStyle) -> Self {
        Self {
            focus_bits: focus.to_bits(),
            drift_bits: drift.to_bits(),
            neutral_bits: neutral.to_bits(),
            is_dark,
            style,
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
    let key = TrayIconRenderKey::new(focus, drift, neutral, dark, style);

    if tray_icon_render_key_is_current(key) {
        return None;
    }

    let (rgba, width, height) = donut_icon::render(DonutIconRenderInput {
        focus,
        drift,
        neutral,
        is_dark: dark,
        style,
    });
    Some(PreparedTrayIcon {
        request_generation,
        key,
        rgba,
        width,
        height,
    })
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
