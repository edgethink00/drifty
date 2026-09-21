use std::{
    env,
    ffi::c_void,
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

use serde::Deserialize;
use tauri::Monitor;
use windows_sys::core::BOOL;
use windows_sys::Win32::Foundation::{CloseHandle, HWND, LPARAM, RECT};
use windows_sys::Win32::Graphics::Dwm::{
    DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS,
};
use windows_sys::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows_sys::Win32::UI::HiDpi::GetDpiForWindow;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetForegroundWindow, GetWindowLongPtrW, GetWindowRect, GetWindowThreadProcessId,
    IsIconic, IsWindowVisible, GWL_EXSTYLE, GWL_STYLE, WS_EX_TOOLWINDOW, WS_MAXIMIZEBOX,
    WS_MINIMIZEBOX, WS_SYSMENU,
};

use super::{
    calculate_windows_caption_close_point, fallback_target_point,
    should_resolve_windows_app_window_close, windows_app_name_matches, PetModeInterventionTarget,
    PetModeTargetConfidence, PetModeTargetKind, PetModeTargetPoint,
};

const DWMWA_CAPTION_BUTTON_BOUNDS: u32 = 5;
const MIN_WINDOW_WIDTH: i32 = 80;
const MIN_WINDOW_HEIGHT: i32 = 48;
const WINDOWS_TAB_CLOSE_SCRIPT: &str =
    include_str!("extreme_nudge/browser_tabs/windows_tab_close.ps1");
// Firefox exposes a different accessibility tree from Chromium. Its packaged
// native-message bridge performs the close itself, while this already-proven
// locate-only UIA path supplies the exact visible tab close-button geometry.
const FIREFOX_GEOMETRY_TIMEOUT: Duration = Duration::from_secs(7);
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const MAX_OUTPUT_BYTES: usize = 64 * 1024;

struct TemporaryPowerShellScript {
    path: PathBuf,
}

impl TemporaryPowerShellScript {
    fn create() -> Result<Self, std::io::Error> {
        let path = env::temp_dir().join(format!(
            "drifty-firefox-tab-geometry-{}-{}.ps1",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)?;
        if let Err(error) = file
            .write_all(WINDOWS_TAB_CLOSE_SCRIPT.as_bytes())
            .and_then(|_| file.sync_all())
        {
            drop(file);
            let _ = fs::remove_file(&path);
            return Err(error);
        }
        Ok(Self { path })
    }
}

impl Drop for TemporaryPowerShellScript {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WindowsTabGeometryResult {
    located: bool,
    x: Option<f64>,
    y: Option<f64>,
    diagnostic: Option<String>,
    error: Option<String>,
}

struct Candidate {
    hwnd: HWND,
    area: i64,
    foreground: bool,
}

pub(super) fn resolve_window_close_target(
    monitor: &Monitor,
    target: &PetModeInterventionTarget,
) -> Option<PetModeTargetPoint> {
    if !should_resolve_windows_app_window_close(target) {
        return Some(resolve_browser_tab_close_target(monitor, target));
    }
    let hwnd = find_target_hwnd(&target.app_name)?;
    let scale = window_scale_factor(hwnd, monitor.scale_factor());
    let (window_x, window_y, window_width, caption) = window_metrics(hwnd, scale)?;
    let (confidence, diagnostic) = if caption.is_some() {
        (
            PetModeTargetConfidence::High,
            "windows_dwm_caption_close_button",
        )
    } else {
        (
            PetModeTargetConfidence::Medium,
            "windows_window_close_fallback",
        )
    };
    let (x, y) = calculate_windows_caption_close_point(window_x, window_y, window_width, caption);
    Some(PetModeTargetPoint {
        x,
        y,
        kind: PetModeTargetKind::WindowClose,
        confidence,
        diagnostic: diagnostic.to_string(),
    })
}

fn resolve_browser_tab_close_target(
    monitor: &Monitor,
    target: &PetModeInterventionTarget,
) -> PetModeTargetPoint {
    let browser_name = target.browser_name.as_deref().unwrap_or_default();
    let Some(process_name) = browser_process_name(browser_name) else {
        return fallback_target_point(monitor, "windows_uia_unsupported_browser");
    };
    let Some(browser_identity) = normalized_browser_identity(
        target.browser_identity.as_deref(),
        browser_name,
        process_name,
    ) else {
        return fallback_target_point(monitor, "windows_uia_missing_browser_identity");
    };
    let site_url = target.site_url.as_deref().unwrap_or_default().trim();
    let site_domain = target.site_domain.as_deref().unwrap_or_default().trim();
    if site_url.is_empty() && site_domain.is_empty() {
        return fallback_target_point(monitor, "windows_uia_missing_target");
    }

    let located = if process_name == "firefox" {
        locate_firefox_tab_close(process_name, &browser_identity, site_url, site_domain)
    } else {
        super::super::windows_browser_uia::locate_foreground_tab_close(
            process_name,
            &browser_identity,
            site_url,
            site_domain,
        )
        .map(|result| WindowsTabGeometryResult {
            located: true,
            x: Some(result.x),
            y: Some(result.y),
            diagnostic: Some(result.diagnostic),
            error: None,
        })
    };

    match located {
        Ok(result) => {
            if !result.located {
                return fallback_target_point(
                    monitor,
                    result
                        .diagnostic
                        .as_deref()
                        .filter(|value| !value.trim().is_empty())
                        .or(result.error.as_deref())
                        .unwrap_or("windows_uia_geometry_unavailable"),
                );
            }
            let (Some(x), Some(y)) = (result.x, result.y) else {
                return fallback_target_point(monitor, "windows_uia_invalid_geometry");
            };
            if !x.is_finite() || !y.is_finite() {
                return fallback_target_point(monitor, "windows_uia_invalid_geometry");
            }
            PetModeTargetPoint {
                x,
                y,
                kind: PetModeTargetKind::BrowserTabClose,
                confidence: PetModeTargetConfidence::High,
                diagnostic: result
                    .diagnostic
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or_else(|| "windows_uia_browser_tab_close_button".to_string()),
            }
        }
        Err(diagnostic) => fallback_target_point(monitor, &diagnostic),
    }
}

fn locate_firefox_tab_close(
    process_name: &str,
    browser_identity: &str,
    site_url: &str,
    site_domain: &str,
) -> Result<WindowsTabGeometryResult, String> {
    use std::os::windows::process::CommandExt;

    // The locate-only PowerShell path cannot call GetForegroundWindow itself:
    // it consumes the foreground identity captured by the parent immediately
    // before spawning so the later UIA lookup stays bound to that exact HWND.
    // Keep all three values together; omitting them makes the helper safely
    // reject every Firefox target as `windows_uia_geometry_no_foreground`.
    let foreground_hwnd = unsafe { GetForegroundWindow() };
    if foreground_hwnd.is_null() {
        return Err("windows_uia_geometry_no_foreground".to_string());
    }
    let mut foreground_pid = 0_u32;
    unsafe {
        GetWindowThreadProcessId(foreground_hwnd, &mut foreground_pid);
    }
    if foreground_pid == 0 {
        return Err("windows_uia_geometry_no_foreground".to_string());
    }
    let foreground_dpi = unsafe { GetDpiForWindow(foreground_hwnd) };

    let powershell = trusted_powershell_path()?;
    let script = TemporaryPowerShellScript::create()
        .map_err(|_| "windows_uia_geometry_script_create_failed".to_string())?;
    let mut command = Command::new(powershell);
    command
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
        ])
        .arg(&script.path)
        .env("DRIFTY_NUDGE_OPERATION", "locate")
        .env("DRIFTY_NUDGE_BROWSER_PROCESS", process_name)
        .env("DRIFTY_NUDGE_BROWSER_IDENTITY", browser_identity)
        .env("DRIFTY_NUDGE_SITE_URL", site_url)
        .env("DRIFTY_NUDGE_SITE_DOMAIN", site_domain)
        .env(
            "DRIFTY_NUDGE_FOREGROUND_HWND",
            (foreground_hwnd as isize).to_string(),
        )
        .env("DRIFTY_NUDGE_FOREGROUND_PID", foreground_pid.to_string())
        .env("DRIFTY_NUDGE_FOREGROUND_DPI", foreground_dpi.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(CREATE_NO_WINDOW);
    let mut child = command
        .spawn()
        .map_err(|_| "windows_uia_geometry_spawn_failed".to_string())?;
    let deadline = Instant::now() + FIREFOX_GEOMETRY_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(25)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("windows_uia_geometry_timeout".to_string());
            }
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("windows_uia_geometry_wait_failed".to_string());
            }
        }
    }

    let mut stdout = Vec::new();
    if let Some(pipe) = child.stdout.take() {
        let _ = pipe.take(MAX_OUTPUT_BYTES as u64).read_to_end(&mut stdout);
    }
    serde_json::from_slice::<WindowsTabGeometryResult>(&stdout)
        .map_err(|_| "windows_uia_geometry_invalid_response".to_string())
}

fn trusted_powershell_path() -> Result<PathBuf, String> {
    let system_root = env::var_os("SystemRoot")
        .ok_or_else(|| "windows_uia_system_root_unavailable".to_string())?;
    let root = PathBuf::from(system_root);
    if !root.is_absolute() {
        return Err("windows_uia_system_root_not_absolute".to_string());
    }
    let candidate = root
        .join("System32")
        .join("WindowsPowerShell")
        .join("v1.0")
        .join("powershell.exe");
    if !candidate.is_file() {
        return Err("windows_uia_trusted_powershell_unavailable".to_string());
    }
    Ok(candidate)
}

fn browser_process_name(browser_name: &str) -> Option<&'static str> {
    match browser_name.trim() {
        "Google Chrome" | "Google Chrome Beta" | "Google Chrome Dev" | "Google Chrome Canary" => {
            Some("chrome")
        }
        "Microsoft Edge" => Some("msedge"),
        "Brave Browser" => Some("brave"),
        "Firefox" | "Firefox Developer Edition" => Some("firefox"),
        _ => None,
    }
}

fn normalized_browser_identity(
    browser_identity: Option<&str>,
    browser_name: &str,
    process_name: &str,
) -> Option<String> {
    let identity = browser_identity?.trim();
    if identity.is_empty() {
        return None;
    }
    let path = Path::new(identity);
    let expected_file_name = format!("{process_name}.exe");
    let matches_process = path
        .file_name()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case(&expected_file_name));
    let normalized = identity.replace('/', "\\").to_ascii_lowercase();
    let matches_channel = match browser_name.trim() {
        "Google Chrome Beta" => normalized.ends_with(r"\google\chrome beta\application\chrome.exe"),
        "Google Chrome Dev" => normalized.ends_with(r"\google\chrome dev\application\chrome.exe"),
        "Google Chrome Canary" => {
            normalized.ends_with(r"\google\chrome sxs\application\chrome.exe")
        }
        "Google Chrome" => ![
            r"\google\chrome beta\application\chrome.exe",
            r"\google\chrome dev\application\chrome.exe",
            r"\google\chrome sxs\application\chrome.exe",
        ]
        .iter()
        .any(|suffix| normalized.ends_with(suffix)),
        "Brave Browser" => {
            normalized.ends_with(r"\bravesoftware\brave-browser\application\brave.exe")
        }
        _ => true,
    };
    (path.is_absolute() && matches_process && matches_channel).then(|| identity.to_string())
}

fn find_target_hwnd(app_name: &str) -> Option<HWND> {
    if app_name.trim().is_empty() {
        return None;
    }
    struct Context {
        app_name: String,
        foreground: HWND,
        best: Option<Candidate>,
    }

    unsafe extern "system" fn visit(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let context = unsafe { &mut *(lparam as *mut Context) };
        if !is_usable_top_level(hwnd) {
            return 1;
        }
        let mut pid = 0_u32;
        unsafe {
            GetWindowThreadProcessId(hwnd, &mut pid);
        }
        let owner = read_owner(pid);
        if owner.eq_ignore_ascii_case("drifty") || is_skipped_owner(&owner) {
            return 1;
        }
        if !windows_app_name_matches(&owner, &context.app_name) {
            return 1;
        }
        let Some(bounds) = read_bounds(hwnd) else {
            return 1;
        };
        let width = bounds.right.saturating_sub(bounds.left);
        let height = bounds.bottom.saturating_sub(bounds.top);
        if width < MIN_WINDOW_WIDTH || height < MIN_WINDOW_HEIGHT {
            return 1;
        }
        let candidate = Candidate {
            hwnd,
            area: i64::from(width) * i64::from(height),
            foreground: hwnd == context.foreground,
        };
        let take = match &context.best {
            None => true,
            Some(current) => {
                (candidate.foreground && !current.foreground)
                    || (candidate.foreground == current.foreground && candidate.area > current.area)
            }
        };
        if take {
            context.best = Some(candidate);
        }
        1
    }

    let mut context = Context {
        app_name: app_name.to_string(),
        foreground: unsafe { GetForegroundWindow() },
        best: None,
    };
    if unsafe { EnumWindows(Some(visit), (&mut context as *mut Context) as LPARAM) } == 0 {
        return None;
    }
    context.best.map(|candidate| candidate.hwnd)
}

fn is_usable_top_level(hwnd: HWND) -> bool {
    if unsafe { IsWindowVisible(hwnd) } == 0 || unsafe { IsIconic(hwnd) } != 0 {
        return false;
    }
    let ex_style = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) } as u32;
    ex_style & WS_EX_TOOLWINDOW as u32 == 0
}

fn is_skipped_owner(owner: &str) -> bool {
    matches!(
        owner.to_ascii_lowercase().as_str(),
        "explorer"
            | "shellexperiencehost"
            | "searchhost"
            | "startmenuexperiencehost"
            | "textinputhost"
            | "applicationframehost"
    )
}

fn read_owner(pid: u32) -> String {
    let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if process.is_null() {
        return String::new();
    }
    let mut buffer = vec![0_u16; 32_768];
    let mut length = buffer.len() as u32;
    let read =
        unsafe { QueryFullProcessImageNameW(process, 0, buffer.as_mut_ptr(), &mut length) } != 0;
    unsafe {
        CloseHandle(process);
    }
    if !read {
        return String::new();
    }
    let path = String::from_utf16_lossy(&buffer[..length as usize]);
    path.rsplit(['\\', '/'])
        .next()
        .unwrap_or_default()
        .trim_end_matches(".exe")
        .trim_end_matches(".EXE")
        .to_string()
}

fn read_bounds(hwnd: HWND) -> Option<RECT> {
    let mut cloaked = 0_u32;
    let cloak_result = unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED as u32,
            (&mut cloaked as *mut u32).cast::<c_void>(),
            std::mem::size_of::<u32>() as u32,
        )
    };
    if cloak_result >= 0 && cloaked != 0 {
        return None;
    }
    let mut bounds = RECT::default();
    let extended_result = unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS as u32,
            (&mut bounds as *mut RECT).cast::<c_void>(),
            std::mem::size_of::<RECT>() as u32,
        )
    };
    if extended_result < 0 && unsafe { GetWindowRect(hwnd, &mut bounds) } == 0 {
        return None;
    }
    Some(bounds)
}

fn read_window_rect(hwnd: HWND) -> Option<RECT> {
    let mut bounds = RECT::default();
    if unsafe { GetWindowRect(hwnd, &mut bounds) } == 0 {
        return None;
    }
    Some(bounds)
}

fn read_close_button_bounds(hwnd: HWND) -> Option<RECT> {
    let mut bounds = RECT::default();
    let result = unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_CAPTION_BUTTON_BOUNDS,
            (&mut bounds as *mut RECT).cast::<c_void>(),
            std::mem::size_of::<RECT>() as u32,
        )
    };
    if result < 0 || bounds.right <= bounds.left || bounds.bottom <= bounds.top {
        return None;
    }

    // DWMWA_CAPTION_BUTTON_BOUNDS covers the whole native caption-button
    // strip, not only Close. Split it using the buttons enabled by the window
    // style, then return the rightmost (Close) segment. This keeps the pet on
    // the glyph center instead of near the window edge on the common
    // minimize/maximize/close layout.
    let style = unsafe { GetWindowLongPtrW(hwnd, GWL_STYLE) } as u32;
    if style & WS_SYSMENU as u32 == 0 {
        return None;
    }
    let mut button_count = 1_i32;
    if style & WS_MINIMIZEBOX as u32 != 0 {
        button_count += 1;
    }
    if style & WS_MAXIMIZEBOX as u32 != 0 {
        button_count += 1;
    }
    let strip_width = bounds.right - bounds.left;
    let close_width = (strip_width / button_count).max(1);
    bounds.left = bounds.right - close_width;
    Some(bounds)
}

fn window_scale_factor(hwnd: HWND, fallback: f64) -> f64 {
    let dpi = unsafe { GetDpiForWindow(hwnd) };
    if dpi == 0 {
        fallback.max(0.5)
    } else {
        f64::from(dpi) / 96.0
    }
}

fn window_metrics(hwnd: HWND, scale: f64) -> Option<(f64, f64, f64, Option<(f64, f64, f64, f64)>)> {
    let visible_bounds = read_bounds(hwnd)?;
    let scale = scale.max(0.5);
    let caption = read_close_button_bounds(hwnd).map(|rect| {
        (
            f64::from(rect.left) / scale,
            f64::from(rect.top) / scale,
            f64::from(rect.right) / scale,
            f64::from(rect.bottom) / scale,
        )
    });
    // DWM reports caption buttons in window-relative coordinates, while its
    // extended frame bounds are in screen coordinates. Use GetWindowRect as
    // the origin for a measured caption strip so invisible resize borders do
    // not shift the paw away from the real X. The visible DWM frame remains the
    // more accurate fallback for custom titlebars without caption metadata.
    let coordinate_bounds = if caption.is_some() {
        read_window_rect(hwnd).unwrap_or(visible_bounds)
    } else {
        visible_bounds
    };
    let window_x = f64::from(coordinate_bounds.left) / scale;
    let window_y = f64::from(coordinate_bounds.top) / scale;
    let window_width = f64::from(coordinate_bounds.right - coordinate_bounds.left) / scale;
    Some((window_x, window_y, window_width, caption))
}
