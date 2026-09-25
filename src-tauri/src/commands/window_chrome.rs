use std::sync::{Mutex, OnceLock};

use serde::Serialize;
use tauri::{AppHandle, LogicalSize, Manager, State, Theme};

#[cfg(target_os = "windows")]
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
#[cfg(target_os = "windows")]
use std::time::Duration;
#[cfg(target_os = "windows")]
use tauri::{PhysicalPosition, PhysicalSize, Runtime, WebviewWindow};

#[cfg(target_os = "windows")]
unsafe extern "C" {
    fn drifty_windows_blur_start(ui_window: *mut std::ffi::c_void) -> bool;
    fn drifty_windows_blur_sync() -> bool;
    fn drifty_windows_blur_is_healthy() -> bool;
    fn drifty_windows_blur_stop();
}

#[cfg(target_os = "windows")]
static WINDOWS_NATIVE_BLUR_IO: Mutex<()> = Mutex::new(());
#[cfg(target_os = "windows")]
static WINDOWS_NATIVE_BLUR_MONITOR_STARTED: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static WINDOWS_NATIVE_BLUR_GENERATION: AtomicU64 = AtomicU64::new(0);
#[cfg(target_os = "windows")]
static WINDOWS_NATIVE_BLUR_FAILED: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static WINDOWS_NATIVE_BLUR_SHUTTING_DOWN: AtomicBool = AtomicBool::new(false);

#[cfg(target_os = "windows")]
pub(crate) fn start_windows_native_blur<R: Runtime>(window: &WebviewWindow<R>) -> bool {
    if WINDOWS_NATIVE_BLUR_FAILED.load(Ordering::Acquire)
        || WINDOWS_NATIVE_BLUR_SHUTTING_DOWN.load(Ordering::Acquire)
    {
        return false;
    }
    let is_translucent = window
        .app_handle()
        .state::<MainWindowMaterialState>()
        .read()
        .kind
        == MainWindowMaterialKind::Translucent;
    if is_translucent {
        if let Ok(hwnd) = window.hwnd() {
            // Safety: the revealed Tauri main window owns this live HWND.
            let started = {
                let _guard = WINDOWS_NATIVE_BLUR_IO
                    .lock()
                    .expect("Windows blur lock poisoned");
                unsafe { drifty_windows_blur_start(hwnd.0) }
            };
            if started {
                // Only the successful native-blur path may use the lighter tint.
                // A failed opt-in and the ordinary transparent fallback retain
                // their stronger tint so desktop detail does not show sharply.
                if let Err(error) =
                    window.eval("document.documentElement.dataset.windowsNativeBlur = 'active'; document.documentElement.dataset.windowMaterial = 'translucent'")
                {
                    eprintln!("could not reveal the experimental Windows blur tint: {error}");
                }
                if !WINDOWS_NATIVE_BLUR_MONITOR_STARTED.swap(true, Ordering::AcqRel) {
                    let generation = WINDOWS_NATIVE_BLUR_GENERATION.fetch_add(1, Ordering::AcqRel) + 1;
                    let monitored_window = (*window).clone();
                    std::thread::spawn(move || {
                        while !WINDOWS_NATIVE_BLUR_SHUTTING_DOWN.load(Ordering::Acquire)
                            && WINDOWS_NATIVE_BLUR_GENERATION.load(Ordering::Acquire) == generation
                        {
                            std::thread::sleep(Duration::from_millis(100));
                            if WINDOWS_NATIVE_BLUR_SHUTTING_DOWN.load(Ordering::Acquire)
                                || WINDOWS_NATIVE_BLUR_GENERATION.load(Ordering::Acquire) != generation
                            {
                                break;
                            }
                            let healthy = {
                                let _guard = WINDOWS_NATIVE_BLUR_IO
                                    .lock()
                                    .expect("Windows blur lock poisoned");
                                // Safety: the native health flag is atomic and the FFI lock
                                // serializes this check with start, sync, and shutdown.
                                unsafe { drifty_windows_blur_is_healthy() }
                            };
                            if healthy || WINDOWS_NATIVE_BLUR_SHUTTING_DOWN.load(Ordering::Acquire)
                                || WINDOWS_NATIVE_BLUR_GENERATION.load(Ordering::Acquire) != generation
                            {
                                continue;
                            }
                            WINDOWS_NATIVE_BLUR_FAILED.store(true, Ordering::Release);
                            monitored_window.app_handle().state::<MainWindowMaterialState>()
                                .replace(MainWindowMaterialStatus::windows(MainWindowMaterialKind::Solid));
                            if let Err(error) = monitored_window.eval(
                                "document.documentElement.dataset.windowMaterial = 'solid'; document.documentElement.removeAttribute('data-windows-native-blur')",
                            ) {
                                eprintln!("could not restore the Windows blur fallback tint: {error}");
                            }
                            eprintln!("Windows blur stopped after startup; restored opaque shell");
                            let _guard = WINDOWS_NATIVE_BLUR_IO
                                .lock()
                                .expect("Windows blur lock poisoned");
                            // Safety: this monitor owns the failed opt-in surface until exit.
                            unsafe { drifty_windows_blur_stop() };
                            break;
                        }
                    });
                }
                return true;
            } else {
                eprintln!("could not activate Windows native blur; restoring opaque shell");
                window.app_handle().state::<MainWindowMaterialState>()
                    .replace(MainWindowMaterialStatus::windows(MainWindowMaterialKind::Solid));
                let _ = window.eval("document.documentElement.dataset.windowMaterial = 'solid'; document.documentElement.removeAttribute('data-windows-native-blur')");
                let _guard = WINDOWS_NATIVE_BLUR_IO.lock().expect("Windows blur lock poisoned");
                // Safety: a failed native start can leave worker handles that must be released.
                unsafe { drifty_windows_blur_stop() };
            }
        }
    }
    false
}

#[cfg(target_os = "windows")]
pub(crate) fn sync_windows_native_blur() {
    if !WINDOWS_NATIVE_BLUR_FAILED.load(Ordering::Acquire)
        && !WINDOWS_NATIVE_BLUR_SHUTTING_DOWN.load(Ordering::Acquire)
    {
        let _guard = WINDOWS_NATIVE_BLUR_IO
            .lock()
            .expect("Windows blur lock poisoned");
        // Safety: the native helper owns its HWNDs and checks their lifetime.
        let _ = unsafe { drifty_windows_blur_sync() };
    }
}

#[cfg(target_os = "windows")]
pub(crate) fn stop_windows_native_blur() {
    WINDOWS_NATIVE_BLUR_SHUTTING_DOWN.store(true, Ordering::Release);
    WINDOWS_NATIVE_BLUR_GENERATION.fetch_add(1, Ordering::AcqRel);
    let _guard = WINDOWS_NATIVE_BLUR_IO.lock().expect("Windows blur lock poisoned");
    // Safety: called by the Tauri event loop before process shutdown.
    unsafe { drifty_windows_blur_stop() };
}

#[cfg(target_os = "windows")]
use windows_sys::Win32::{
    Foundation::{HWND, POINT},
    Graphics::Dwm::{
        DwmSetWindowAttribute, DWMSBT_NONE, DWMWA_SYSTEMBACKDROP_TYPE,
        DWMWA_USE_IMMERSIVE_DARK_MODE,
    },
    UI::WindowsAndMessaging::{
        GetCursorPos, GetSystemMenu, PostMessageW, SetForegroundWindow, TrackPopupMenu,
        TPM_RETURNCMD, TPM_RIGHTBUTTON, WM_NULL, WM_SYSCOMMAND,
    },
};

#[cfg(target_os = "macos")]
use objc2_app_kit::{NSWindow, NSWindowButton};

use crate::MAIN_WINDOW_LABEL;

/// `DWM_SYSTEMBACKDROP_TYPE` became a documented, supported API in Windows 11
/// 22H2. On supported builds Drifty disables an opaque system backdrop so the
/// transparent WebView can transmit real desktop pixels through the tinted
/// shell. Older releases keep the existing solid shell.
#[cfg(any(target_os = "windows", test))]
const WINDOWS_TRANSLUCENT_SHELL_MIN_BUILD: u32 = 22_621;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum MainWindowMaterialKind {
    Native,
    Solid,
    Translucent,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MainWindowMaterialStatus {
    kind: MainWindowMaterialKind,
}

impl MainWindowMaterialStatus {
    const fn native() -> Self {
        Self {
            kind: MainWindowMaterialKind::Native,
        }
    }

    #[cfg(target_os = "windows")]
    const fn windows(kind: MainWindowMaterialKind) -> Self {
        Self { kind }
    }
}

pub struct MainWindowMaterialState(Mutex<MainWindowMaterialStatus>);

impl Default for MainWindowMaterialState {
    fn default() -> Self {
        Self(Mutex::new(MainWindowMaterialStatus::native()))
    }
}

impl MainWindowMaterialState {
    fn read(&self) -> MainWindowMaterialStatus {
        self.0
            .lock()
            .map(|status| *status)
            .unwrap_or_else(|poisoned| *poisoned.into_inner())
    }

    #[cfg(target_os = "windows")]
    fn replace(&self, status: MainWindowMaterialStatus) {
        match self.0.lock() {
            Ok(mut current) => *current = status,
            Err(poisoned) => *poisoned.into_inner() = status,
        }
    }
}

#[cfg(any(target_os = "windows", test))]
fn windows_material_kind_for_build(build: u32) -> MainWindowMaterialKind {
    if build >= WINDOWS_TRANSLUCENT_SHELL_MIN_BUILD {
        MainWindowMaterialKind::Translucent
    } else {
        MainWindowMaterialKind::Solid
    }
}

#[cfg(any(target_os = "windows", test))]
fn windows_blur_preview_requested(build: u32, enabled: bool, failed: bool) -> bool {
    enabled && !failed && windows_material_kind_for_build(build) == MainWindowMaterialKind::Translucent
}

#[cfg(any(target_os = "windows", test))]
fn resolved_windows_material_kind(
    requested: MainWindowMaterialKind,
    activation_succeeded: bool,
) -> MainWindowMaterialKind {
    if requested == MainWindowMaterialKind::Translucent && activation_succeeded {
        MainWindowMaterialKind::Translucent
    } else {
        MainWindowMaterialKind::Solid
    }
}

#[cfg(target_os = "windows")]
fn set_dwm_window_attribute<T>(hwnd: HWND, attribute: u32, value: &T) -> Result<(), String> {
    // Safety: `hwnd` belongs to the live main window. DWM copies exactly
    // `size_of::<T>()` bytes during this call and retains no pointer.
    let result = unsafe {
        DwmSetWindowAttribute(
            hwnd,
            attribute,
            std::ptr::from_ref(value).cast(),
            std::mem::size_of::<T>() as u32,
        )
    };
    if result < 0 {
        Err(format!(
            "DwmSetWindowAttribute({attribute}) failed with HRESULT 0x{:08X}",
            result as u32
        ))
    } else {
        Ok(())
    }
}

#[cfg(target_os = "windows")]
fn apply_windows_translucent_shell<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    set_dwm_window_attribute(hwnd.0, DWMWA_SYSTEMBACKDROP_TYPE as u32, &DWMSBT_NONE)
}

#[cfg(target_os = "windows")]
fn set_windows_backdrop_theme<R: Runtime>(
    window: &WebviewWindow<R>,
    dark: bool,
) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    let use_dark_mode = u32::from(dark);
    set_dwm_window_attribute(hwnd.0, DWMWA_USE_IMMERSIVE_DARK_MODE as u32, &use_dark_mode)
}

/// The native window may be transparent, but the renderer starts with an
/// opaque CSS shell. Only an explicit per-install Preview opt-in may activate
/// the blur helper and reveal the translucent tint.
#[cfg(target_os = "windows")]
pub(crate) fn configure_main_window_material(app: &AppHandle) {
    app.state::<MainWindowMaterialState>()
        .replace(MainWindowMaterialStatus::windows(MainWindowMaterialKind::Solid));
}

/// Logical size of the v2.1 onboarding card. In compact mode the whole window
/// shrinks to this so the card itself reads as the macOS window.
const ONBOARDING_CARD_WIDTH: f64 = 720.0;
const ONBOARDING_CARD_HEIGHT: f64 = 540.0;
/// Minimum window size from tauri.conf.json, restored once onboarding exits.
#[cfg(not(target_os = "windows"))]
const DEFAULT_MIN_WIDTH: f64 = 960.0;
#[cfg(not(target_os = "windows"))]
const DEFAULT_MIN_HEIGHT: f64 = 680.0;
/// Default sizes on either side of the dashboard's 804px compact boundary.
const DEFAULT_MAIN_WINDOW_WIDTH: f64 = 1254.0;
const DEFAULT_MAIN_WINDOW_COMPACT_HEIGHT: f64 = 800.0;
const DEFAULT_MAIN_WINDOW_ROOMY_HEIGHT: f64 = 809.0;
/// A roomy default should not merely fit: it should leave about 80 logical
/// pixels on both sides of each axis when centered. This separates spacious
/// work areas from tighter ones without relying on model names or physical
/// diagonal size.
const DEFAULT_MAIN_WINDOW_ROOMY_HEADROOM: f64 = 160.0;

fn work_area_supports_roomy_default(work_area_width: f64, work_area_height: f64) -> bool {
    work_area_width >= DEFAULT_MAIN_WINDOW_WIDTH + DEFAULT_MAIN_WINDOW_ROOMY_HEADROOM
        && work_area_height >= DEFAULT_MAIN_WINDOW_ROOMY_HEIGHT + DEFAULT_MAIN_WINDOW_ROOMY_HEADROOM
}

fn calibrated_main_window_size(work_area_width: f64, work_area_height: f64) -> LogicalSize<f64> {
    let preferred_height = if work_area_supports_roomy_default(work_area_width, work_area_height) {
        DEFAULT_MAIN_WINDOW_ROOMY_HEIGHT
    } else {
        DEFAULT_MAIN_WINDOW_COMPACT_HEIGHT
    };

    LogicalSize::new(
        DEFAULT_MAIN_WINDOW_WIDTH.min(work_area_width.max(DEFAULT_MIN_WIDTH)),
        preferred_height.min(work_area_height.max(DEFAULT_MIN_HEIGHT)),
    )
}

/// Fit the hidden main window to the monitor's current safe work area before
/// it is revealed. This is intentionally a launch-time default, not a listener:
/// moving displays or resizing the window remains fully under user control.
pub(crate) fn calibrate_main_window_to_work_area(app: &AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
            return Ok(());
        };
        let monitor = match window.current_monitor() {
            Ok(Some(monitor)) => Some(monitor),
            Ok(None) | Err(_) => window
                .primary_monitor()
                .map_err(|error| error.to_string())?,
        };
        let Some(monitor) = monitor else {
            return Ok(());
        };
        let work_area = monitor
            .work_area()
            .size
            .to_logical::<f64>(monitor.scale_factor());
        let target = calibrated_main_window_size(work_area.width, work_area.height);
        let scale = window.scale_factor().map_err(|error| error.to_string())?;
        let current = window
            .inner_size()
            .map_err(|error| error.to_string())?
            .to_logical::<f64>(scale);

        if (current.width - target.width).abs() > 0.5
            || (current.height - target.height).abs() > 0.5
        {
            window.set_size(target).map_err(|error| error.to_string())?;
        }
    }

    #[cfg(not(target_os = "macos"))]
    let _ = app;

    Ok(())
}

/// Windows keeps a smaller normal floor so the client titlebar and taskbar fit
/// on common 1366x768 laptops and high-DPI 1080p displays.
#[cfg(target_os = "windows")]
const DEFAULT_MIN_WIDTH: f64 = 900.0;
#[cfg(target_os = "windows")]
const DEFAULT_MIN_HEIGHT: f64 = 600.0;

#[cfg(any(target_os = "windows", test))]
#[derive(Clone, Copy, Debug)]
struct WindowFitInput {
    requested_inner: (u32, u32),
    current_inner: (u32, u32),
    current_outer: (u32, u32),
    current_outer_position: (i32, i32),
    work_area_position: (i32, i32),
    work_area_size: (u32, u32),
    scale_factor: f64,
    minimum_inner: (f64, f64),
}

#[cfg(any(target_os = "windows", test))]
#[derive(Clone, Copy, Debug)]
struct WindowFit {
    inner_width: u32,
    inner_height: u32,
    minimum_width: f64,
    minimum_height: f64,
    outer_x: i32,
    outer_y: i32,
}

#[cfg(any(target_os = "windows", test))]
fn resolve_window_fit(input: WindowFitInput) -> WindowFit {
    let scale_factor = if input.scale_factor.is_finite() && input.scale_factor > 0.0 {
        input.scale_factor
    } else {
        1.0
    };
    let frame_width = input.current_outer.0.saturating_sub(input.current_inner.0);
    let frame_height = input.current_outer.1.saturating_sub(input.current_inner.1);
    let max_inner_width = input.work_area_size.0.saturating_sub(frame_width).max(1);
    let max_inner_height = input.work_area_size.1.saturating_sub(frame_height).max(1);
    let minimum_width = input
        .minimum_inner
        .0
        .min(max_inner_width as f64 / scale_factor);
    let minimum_height = input
        .minimum_inner
        .1
        .min(max_inner_height as f64 / scale_factor);
    let minimum_physical_width =
        ((minimum_width * scale_factor).round() as u32).clamp(1, max_inner_width);
    let minimum_physical_height =
        ((minimum_height * scale_factor).round() as u32).clamp(1, max_inner_height);
    let inner_width = input
        .requested_inner
        .0
        .clamp(minimum_physical_width, max_inner_width);
    let inner_height = input
        .requested_inner
        .1
        .clamp(minimum_physical_height, max_inner_height);
    let outer_width = inner_width.saturating_add(frame_width);
    let outer_height = inner_height.saturating_add(frame_height);

    let clamp_position = |position: i32, origin: i32, work_extent: u32, outer_extent: u32| {
        let minimum = i64::from(origin);
        let maximum = minimum + i64::from(work_extent.saturating_sub(outer_extent));
        i64::from(position).clamp(minimum, maximum) as i32
    };

    WindowFit {
        inner_width,
        inner_height,
        minimum_width,
        minimum_height,
        outer_x: clamp_position(
            input.current_outer_position.0,
            input.work_area_position.0,
            input.work_area_size.0,
            outer_width,
        ),
        outer_y: clamp_position(
            input.current_outer_position.1,
            input.work_area_position.1,
            input.work_area_size.1,
            outer_height,
        ),
    }
}

#[cfg(target_os = "windows")]
fn fit_windows_window<R: Runtime>(
    window: &WebviewWindow<R>,
    requested_logical_size: Option<LogicalSize<f64>>,
) -> Result<(), String> {
    let monitor = match window
        .current_monitor()
        .map_err(|error| error.to_string())?
    {
        Some(monitor) => Some(monitor),
        None => window
            .primary_monitor()
            .map_err(|error| error.to_string())?,
    };
    let Some(monitor) = monitor else {
        return Ok(());
    };
    let scale_factor = monitor.scale_factor();
    let current_inner = window.inner_size().map_err(|error| error.to_string())?;
    let current_outer = window.outer_size().map_err(|error| error.to_string())?;
    let current_outer_position = window.outer_position().map_err(|error| error.to_string())?;
    let work_area = monitor.work_area();
    let requested_inner = requested_logical_size
        .map(|size| {
            (
                (size.width * scale_factor).round().max(1.0) as u32,
                (size.height * scale_factor).round().max(1.0) as u32,
            )
        })
        .unwrap_or((current_inner.width, current_inner.height));
    let fit = resolve_window_fit(WindowFitInput {
        requested_inner,
        current_inner: (current_inner.width, current_inner.height),
        current_outer: (current_outer.width, current_outer.height),
        current_outer_position: (current_outer_position.x, current_outer_position.y),
        work_area_position: (work_area.position.x, work_area.position.y),
        work_area_size: (work_area.size.width, work_area.size.height),
        scale_factor,
        minimum_inner: (DEFAULT_MIN_WIDTH, DEFAULT_MIN_HEIGHT),
    });

    window
        .set_min_size(Some(LogicalSize::new(
            fit.minimum_width,
            fit.minimum_height,
        )))
        .map_err(|error| error.to_string())?;
    if (fit.inner_width, fit.inner_height) != (current_inner.width, current_inner.height) {
        window
            .set_size(PhysicalSize::new(fit.inner_width, fit.inner_height))
            .map_err(|error| error.to_string())?;
    }
    if (fit.outer_x, fit.outer_y) != (current_outer_position.x, current_outer_position.y) {
        window
            .set_position(PhysicalPosition::new(fit.outer_x, fit.outer_y))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(target_os = "windows")]
pub fn fit_main_window_to_current_work_area<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return Ok(());
    };
    if window.is_minimized().map_err(|error| error.to_string())?
        || !window.is_resizable().map_err(|error| error.to_string())?
        || window.is_maximized().map_err(|error| error.to_string())?
    {
        return Ok(());
    }
    fit_windows_window(&window, None)
}

/// Remembers the window size from before compact onboarding so it can be
/// restored afterwards.
fn saved_window_size() -> &'static Mutex<Option<LogicalSize<f64>>> {
    static SAVED: OnceLock<Mutex<Option<LogicalSize<f64>>>> = OnceLock::new();
    SAVED.get_or_init(|| Mutex::new(None))
}

/// Drive the main window's onboarding presentation.
///
/// `active` hides the macOS traffic lights so the flow reads as a clean window.
/// When `compact` is also set, the window shrinks and centers to the card size
/// so the onboarding card becomes the window itself; the prior size is restored
/// when onboarding exits.
#[tauri::command]
pub fn window_set_onboarding_presentation(
    app: AppHandle,
    active: bool,
    compact: bool,
) -> Result<(), String> {
    set_titlebar_controls_visible(&app, !active)?;

    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return Ok(());
    };

    if active && compact {
        let scale = window.scale_factor().map_err(|error| error.to_string())?;
        let current = window
            .inner_size()
            .map_err(|error| error.to_string())?
            .to_logical::<f64>(scale);
        if let Ok(mut saved) = saved_window_size().lock() {
            saved.get_or_insert(current);
        }
        window
            .set_resizable(false)
            .map_err(|error| error.to_string())?;
        window
            .set_min_size(Some(LogicalSize::new(
                ONBOARDING_CARD_WIDTH,
                ONBOARDING_CARD_HEIGHT,
            )))
            .map_err(|error| error.to_string())?;
        window
            .set_size(LogicalSize::new(
                ONBOARDING_CARD_WIDTH,
                ONBOARDING_CARD_HEIGHT,
            ))
            .map_err(|error| error.to_string())?;
        window.center().map_err(|error| error.to_string())?;
    } else if !active {
        let restore = saved_window_size().lock().ok().and_then(|mut s| s.take());
        window
            .set_resizable(true)
            .map_err(|error| error.to_string())?;

        #[cfg(target_os = "windows")]
        {
            fit_windows_window(&window, restore)?;
            if restore.is_some() {
                window.center().map_err(|error| error.to_string())?;
                fit_windows_window(&window, None)?;
            }
        }

        #[cfg(not(target_os = "windows"))]
        {
            window
                .set_min_size(Some(LogicalSize::new(
                    DEFAULT_MIN_WIDTH,
                    DEFAULT_MIN_HEIGHT,
                )))
                .map_err(|error| error.to_string())?;
            if let Some(size) = restore {
                window.set_size(size).map_err(|error| error.to_string())?;
                window.center().map_err(|error| error.to_string())?;
            }
        }
    }

    Ok(())
}

#[cfg(target_os = "macos")]
fn set_titlebar_controls_visible(app: &AppHandle, visible: bool) -> Result<(), String> {
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let Some(window) = handle.get_webview_window(MAIN_WINDOW_LABEL) else {
            return;
        };
        let Ok(ptr) = window.ns_window() else {
            return;
        };
        // Safe: dispatched onto the macOS main thread, where touching the
        // NSWindow returned by Tauri is sound for the window's lifetime.
        let ns_window: &NSWindow = unsafe { &*ptr.cast::<NSWindow>() };
        for kind in [
            NSWindowButton::CloseButton,
            NSWindowButton::MiniaturizeButton,
            NSWindowButton::ZoomButton,
        ] {
            if let Some(button) = ns_window.standardWindowButton(kind) {
                button.setHidden(!visible);
            }
        }
    })
    .map_err(|error| error.to_string())
}

#[cfg(not(target_os = "macos"))]
fn set_titlebar_controls_visible(_app: &AppHandle, _visible: bool) -> Result<(), String> {
    Ok(())
}

/// Pin the main window's appearance to the app's own theme.
///
/// The native shell material renders in the window's effective appearance. When
/// the app runs its dark theme on a light system (or the reverse), an unpinned
/// window draws the wrong native material under the app tint, which reads as a
/// flat opaque slab instead of glass.
#[tauri::command]
pub fn window_set_theme_appearance(
    app: AppHandle,
    material_state: State<'_, MainWindowMaterialState>,
    dark: bool,
    windows_blur_preview_enabled: bool,
) -> Result<MainWindowMaterialStatus, String> {
    #[cfg(target_os = "windows")]
    {
        let window = app
            .get_webview_window(MAIN_WINDOW_LABEL)
            .ok_or_else(|| "main window is unavailable".to_string())?;
        let requested = windows_blur_preview_requested(
            windows_version::OsVersion::current().build,
            windows_blur_preview_enabled,
            WINDOWS_NATIVE_BLUR_FAILED.load(Ordering::Acquire),
        );
        if requested {
            if let Err(error) = apply_windows_translucent_shell(&window)
                .and_then(|_| set_windows_backdrop_theme(&window, dark))
            {
                eprintln!("could not activate Windows blur Preview; using opaque shell: {error}");
                material_state.replace(MainWindowMaterialStatus::windows(MainWindowMaterialKind::Solid));
            } else {
                material_state.replace(MainWindowMaterialStatus::windows(MainWindowMaterialKind::Translucent));
                if window.is_visible().unwrap_or(false) && !start_windows_native_blur(&window) {
                    material_state.replace(MainWindowMaterialStatus::windows(MainWindowMaterialKind::Solid));
                }
            }
        } else {
            // The renderer makes the shell opaque synchronously before IPC.
            // Remove native blur only after its replacement is in place.
            material_state.replace(MainWindowMaterialStatus::windows(MainWindowMaterialKind::Solid));
            WINDOWS_NATIVE_BLUR_GENERATION.fetch_add(1, Ordering::AcqRel);
            WINDOWS_NATIVE_BLUR_MONITOR_STARTED.store(false, Ordering::Release);
            let _ = window.eval("document.documentElement.dataset.windowMaterial = 'solid'; document.documentElement.removeAttribute('data-windows-native-blur')");
            let _guard = WINDOWS_NATIVE_BLUR_IO.lock().expect("Windows blur lock poisoned");
            // Safety: the disabled Preview has no remaining native blur owner.
            unsafe { drifty_windows_blur_stop() };
        }
    }

    #[cfg(not(target_os = "windows"))]
    let _ = windows_blur_preview_enabled;

    let handle = app.clone();
    app.run_on_main_thread(move || {
        let Some(window) = handle.get_webview_window(MAIN_WINDOW_LABEL) else {
            return;
        };
        // Appearance is cosmetic; a failure must not take down theming.
        let _ = window.set_theme(Some(if dark { Theme::Dark } else { Theme::Light }));
    })
    .map_err(|error| error.to_string())?;
    #[cfg(target_os = "windows")]
    {
        let status = material_state.read();
        if status.kind == MainWindowMaterialKind::Translucent {
            let visible = app.get_webview_window(MAIN_WINDOW_LABEL)
                .and_then(|window| window.is_visible().ok())
                .unwrap_or(false);
            if !visible {
                return Ok(MainWindowMaterialStatus::windows(MainWindowMaterialKind::Solid));
            }
        }
        Ok(status)
    }
    #[cfg(not(target_os = "windows"))]
    Ok(material_state.read())
}

#[cfg(target_os = "windows")]
fn show_windows_system_menu_at_cursor(hwnd: HWND) {
    let mut cursor = POINT { x: 0, y: 0 };

    // Safety: hwnd belongs to the live main window and this runs on its UI
    // thread. Windows owns the menu and no borrowed pointer escapes.
    unsafe {
        let menu = GetSystemMenu(hwnd, 0);
        if menu.is_null() || GetCursorPos(&mut cursor) == 0 {
            return;
        }
        SetForegroundWindow(hwnd);
        let command = TrackPopupMenu(
            menu,
            TPM_RETURNCMD | TPM_RIGHTBUTTON,
            cursor.x,
            cursor.y,
            0,
            hwnd,
            std::ptr::null(),
        );
        if command != 0 {
            let _ = PostMessageW(hwnd, WM_SYSCOMMAND, command as usize, 0);
        }
        let _ = PostMessageW(hwnd, WM_NULL, 0, 0);
    }
}

/// Opens the native Windows system menu for the client-drawn titlebar.
#[tauri::command]
pub fn window_show_system_menu(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let handle = app.clone();
        return app
            .run_on_main_thread(move || {
                let Some(window) = handle.get_webview_window(MAIN_WINDOW_LABEL) else {
                    return;
                };
                let Ok(hwnd) = window.hwnd() else {
                    return;
                };
                show_windows_system_menu_at_cursor(hwnd.0);
            })
            .map_err(|error| error.to_string());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_size(actual: LogicalSize<f64>, width: f64, height: f64) {
        assert_eq!(actual.width, width);
        assert_eq!(actual.height, height);
    }

    #[test]
    fn roomy_work_areas_use_the_six_rank_default() {
        assert_size(calibrated_main_window_size(1680.0, 1084.0), 1254.0, 809.0);
        assert_size(calibrated_main_window_size(1920.0, 1080.0), 1254.0, 809.0);
        assert_size(calibrated_main_window_size(1414.0, 969.0), 1254.0, 809.0);
    }

    #[test]
    fn either_missing_headroom_keeps_the_five_rank_default() {
        assert_size(calibrated_main_window_size(1413.0, 1084.0), 1254.0, 800.0);
        assert_size(calibrated_main_window_size(1680.0, 968.0), 1254.0, 800.0);
    }

    #[test]
    fn compact_work_areas_use_the_safe_area_without_creating_avoidable_scroll() {
        assert_size(calibrated_main_window_size(1280.0, 800.0), 1254.0, 800.0);
        assert_size(calibrated_main_window_size(1100.0, 760.0), 1100.0, 760.0);
    }

    #[test]
    fn undersized_work_areas_never_break_the_existing_minimum() {
        assert_size(calibrated_main_window_size(980.0, 700.0), 980.0, 700.0);
        assert_size(calibrated_main_window_size(900.0, 640.0), 960.0, 680.0);
        assert_size(calibrated_main_window_size(0.0, 0.0), 960.0, 680.0);
    }

    #[test]
    fn keeps_the_windows_default_inside_a_1080p_125_percent_work_area() {
        let fit = resolve_window_fit(WindowFitInput {
            requested_inner: (1375, 875),
            current_inner: (1375, 875),
            current_outer: (1393, 922),
            current_outer_position: (50, 50),
            work_area_position: (0, 0),
            work_area_size: (1920, 1032),
            scale_factor: 1.25,
            minimum_inner: (900.0, 600.0),
        });
        assert_eq!((fit.inner_width, fit.inner_height), (1375, 875));
        assert_eq!((fit.outer_x, fit.outer_y), (50, 50));
        assert_eq!((fit.minimum_width, fit.minimum_height), (900.0, 600.0));
    }

    #[test]
    fn clamps_a_tall_window_below_the_windows_taskbar() {
        let fit = resolve_window_fit(WindowFitInput {
            requested_inner: (1568, 1011),
            current_inner: (1568, 1011),
            current_outer: (1586, 1058),
            current_outer_position: (20, 20),
            work_area_position: (0, 0),
            work_area_size: (1920, 1032),
            scale_factor: 1.25,
            minimum_inner: (900.0, 600.0),
        });
        assert_eq!((fit.inner_width, fit.inner_height), (1568, 985));
        assert_eq!((fit.outer_x, fit.outer_y), (20, 0));
    }

    #[test]
    fn clamps_size_and_position_on_a_1366_by_768_laptop() {
        let fit = resolve_window_fit(WindowFitInput {
            requested_inner: (1100, 700),
            current_inner: (1100, 700),
            current_outer: (1116, 739),
            current_outer_position: (400, 100),
            work_area_position: (0, 0),
            work_area_size: (1366, 728),
            scale_factor: 1.0,
            minimum_inner: (900.0, 600.0),
        });
        assert_eq!((fit.inner_width, fit.inner_height), (1100, 689));
        assert_eq!((fit.outer_x, fit.outer_y), (250, 0));
    }

    #[test]
    fn reduces_the_minimum_when_the_work_area_is_smaller_than_the_normal_floor() {
        let fit = resolve_window_fit(WindowFitInput {
            requested_inner: (1650, 1050),
            current_inner: (1650, 1050),
            current_outer: (1668, 1097),
            current_outer_position: (0, 0),
            work_area_position: (0, 0),
            work_area_size: (1024, 700),
            scale_factor: 1.5,
            minimum_inner: (900.0, 600.0),
        });
        assert_eq!((fit.inner_width, fit.inner_height), (1006, 653));
        assert!((fit.minimum_width - 670.666_666_666_666_6).abs() < 0.001);
        assert!((fit.minimum_height - 435.333_333_333_333_3).abs() < 0.001);
    }

    #[test]
    fn translucent_shell_requires_the_documented_windows_11_dwm_api() {
        assert!(!windows_blur_preview_requested(26_200, false, false));
        assert!(!windows_blur_preview_requested(22_000, true, false));
        assert!(!windows_blur_preview_requested(26_200, true, true));
        assert!(windows_blur_preview_requested(26_200, true, false));
        assert_eq!(
            windows_material_kind_for_build(22_000),
            MainWindowMaterialKind::Solid
        );
        assert_eq!(
            windows_material_kind_for_build(WINDOWS_TRANSLUCENT_SHELL_MIN_BUILD - 1),
            MainWindowMaterialKind::Solid
        );
        assert_eq!(
            windows_material_kind_for_build(WINDOWS_TRANSLUCENT_SHELL_MIN_BUILD),
            MainWindowMaterialKind::Translucent
        );
        assert_eq!(
            windows_material_kind_for_build(26_200),
            MainWindowMaterialKind::Translucent
        );
        assert_eq!(
            resolved_windows_material_kind(MainWindowMaterialKind::Translucent, true),
            MainWindowMaterialKind::Translucent
        );
        assert_eq!(
            resolved_windows_material_kind(MainWindowMaterialKind::Translucent, false),
            MainWindowMaterialKind::Solid
        );
        assert_eq!(
            resolved_windows_material_kind(MainWindowMaterialKind::Solid, true),
            MainWindowMaterialKind::Solid
        );
    }
}
