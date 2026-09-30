use std::{ffi::c_void, path::Path, thread, time::Duration};

use tauri::Monitor;
use windows_sys::core::BOOL;
use windows_sys::Win32::Foundation::{CloseHandle, HWND, LPARAM, RECT};
use windows_sys::Win32::Graphics::Dwm::{
    DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS,
};
use windows_sys::Win32::System::Threading::{
    AttachThreadInput, GetCurrentThreadId, OpenProcess, QueryFullProcessImageNameW,
    PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows_sys::Win32::UI::HiDpi::GetDpiForWindow;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    BringWindowToTop, EnumWindows, GetForegroundWindow, GetWindowLongPtrW, GetWindowRect,
    GetWindowThreadProcessId, IsIconic, IsWindowVisible, SetForegroundWindow, ShowWindow,
    GWL_EXSTYLE, GWL_STYLE, SW_RESTORE, WS_EX_TOOLWINDOW, WS_MAXIMIZEBOX, WS_MINIMIZEBOX,
    WS_SYSMENU,
};

use super::{
    calculate_windows_caption_close_point, fallback_target_point,
    should_resolve_windows_app_window_close, windows_app_name_matches, PetModeInterventionTarget,
    PetModeTargetConfidence, PetModeTargetKind, PetModeTargetPoint,
};

const DWMWA_CAPTION_BUTTON_BOUNDS: u32 = 5;
const MIN_WINDOW_WIDTH: i32 = 80;
const MIN_WINDOW_HEIGHT: i32 = 48;

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

    // The paw points at the exact control the close will press. Both come from
    // the same UIA resolver, so a close it would refuse is never acted out.
    match super::super::windows_browser_uia::locate_foreground_tab_close(
        process_name,
        &browser_identity,
        site_url,
        site_domain,
    ) {
        Ok(result) => {
            if !result.x.is_finite() || !result.y.is_finite() {
                return fallback_target_point(monitor, "windows_uia_invalid_geometry");
            }
            PetModeTargetPoint {
                x: result.x,
                y: result.y,
                kind: PetModeTargetKind::BrowserTabClose,
                confidence: PetModeTargetConfidence::High,
                diagnostic: result.diagnostic,
            }
        }
        Err(diagnostic) => fallback_target_point(monitor, &diagnostic),
    }
}

fn browser_process_name(browser_name: &str) -> Option<&'static str> {
    match browser_name.trim() {
        "Google Chrome" | "Google Chrome Beta" | "Google Chrome Dev" | "Google Chrome Canary" => {
            Some("chrome")
        }
        "Microsoft Edge" => Some("msedge"),
        "Brave Browser" => Some("brave"),
        "Firefox" | "Firefox Developer Edition" => Some("firefox"),
        "Floorp" => Some("floorp"),
        "Waterfox" => Some("waterfox"),
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
        "Firefox" | "Firefox Developer Edition" => {
            !normalized.ends_with(r"\tor browser\browser\firefox.exe")
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

const LAB_BROWSER_FOREGROUND_SETTLE: Duration = Duration::from_millis(150);

/// Brings the last observed browser forward so the foreground-only UI
/// Automation close can see it. Dev settings leave Drifty in front, and the
/// Lab must not fall through to the window caption Close button.
pub(super) fn activate_lab_browser(target: &PetModeInterventionTarget) -> Result<(), String> {
    let browser_name = target.browser_name.as_deref().unwrap_or("").trim();
    let process_name = browser_process_name(browser_name)
        .ok_or_else(|| "windows_uia_unsupported_browser".to_string())?;
    let identity = normalized_browser_identity(
        target.browser_identity.as_deref(),
        browser_name,
        process_name,
    )
    .ok_or_else(|| "windows_uia_missing_browser_identity".to_string())?;
    let site_url = target.site_url.as_deref().unwrap_or("").trim();
    let site_domain = target.site_domain.as_deref().unwrap_or("").trim();
    if site_url.is_empty() && site_domain.is_empty() {
        return Err("windows_uia_missing_target".to_string());
    }
    let hwnd = find_lab_browser_hwnd(&identity)
        .ok_or_else(|| "windows_lab_browser_window_unavailable".to_string())?;
    focus_lab_browser_window(hwnd)
}

fn find_lab_browser_hwnd(identity: &str) -> Option<HWND> {
    struct Search {
        identity: String,
        iconic: Vec<bool>,
        hwnds: Vec<HWND>,
    }

    unsafe extern "system" fn visit(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let search = unsafe { &mut *(lparam as *mut Search) };
        if is_tool_window(hwnd) || is_cloaked_window(hwnd) || unsafe { IsWindowVisible(hwnd) } == 0
        {
            return 1;
        }
        let mut pid = 0_u32;
        unsafe {
            GetWindowThreadProcessId(hwnd, &mut pid);
        }
        let Some(image) = read_process_image(pid) else {
            return 1;
        };
        if !windows_image_paths_equal(&image, &search.identity) {
            return 1;
        }
        let iconic = unsafe { IsIconic(hwnd) } != 0;
        if !iconic {
            let Some(bounds) = read_bounds(hwnd) else {
                return 1;
            };
            let width = bounds.right.saturating_sub(bounds.left);
            let height = bounds.bottom.saturating_sub(bounds.top);
            if width < MIN_WINDOW_WIDTH || height < MIN_WINDOW_HEIGHT {
                return 1;
            }
        }
        search.iconic.push(iconic);
        search.hwnds.push(hwnd);
        1
    }

    let mut search = Search {
        identity: identity.to_string(),
        iconic: Vec::new(),
        hwnds: Vec::new(),
    };
    if unsafe { EnumWindows(Some(visit), (&mut search as *mut Search) as LPARAM) } == 0 {
        return None;
    }
    let index = super::select_lab_browser_window_index(&search.iconic)?;
    search.hwnds.get(index).copied()
}

fn focus_lab_browser_window(hwnd: HWND) -> Result<(), String> {
    let focused = unsafe {
        if IsIconic(hwnd) != 0 {
            ShowWindow(hwnd, SW_RESTORE);
        }
        let foreground = GetForegroundWindow();
        let current_thread = GetCurrentThreadId();
        let foreground_thread = GetWindowThreadProcessId(foreground, std::ptr::null_mut());
        let target_thread = GetWindowThreadProcessId(hwnd, std::ptr::null_mut());
        let attached_foreground = foreground_thread != 0
            && foreground_thread != current_thread
            && AttachThreadInput(current_thread, foreground_thread, 1) != 0;
        let attached_target = target_thread != 0
            && target_thread != current_thread
            && target_thread != foreground_thread
            && AttachThreadInput(current_thread, target_thread, 1) != 0;
        let _ = BringWindowToTop(hwnd);
        let raised = SetForegroundWindow(hwnd) != 0;
        if attached_target {
            let _ = AttachThreadInput(current_thread, target_thread, 0);
        }
        if attached_foreground {
            let _ = AttachThreadInput(current_thread, foreground_thread, 0);
        }
        raised || GetForegroundWindow() == hwnd
    };
    if !focused {
        return Err("windows_lab_browser_not_foreground".to_string());
    }
    thread::sleep(LAB_BROWSER_FOREGROUND_SETTLE);
    if unsafe { GetForegroundWindow() } != hwnd {
        return Err("windows_lab_browser_not_foreground".to_string());
    }
    Ok(())
}

fn is_tool_window(hwnd: HWND) -> bool {
    let ex_style = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) } as u32;
    ex_style & WS_EX_TOOLWINDOW as u32 != 0
}

fn is_cloaked_window(hwnd: HWND) -> bool {
    let mut cloaked = 0_u32;
    let result = unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED as u32,
            (&mut cloaked as *mut u32).cast::<c_void>(),
            std::mem::size_of::<u32>() as u32,
        )
    };
    result >= 0 && cloaked != 0
}

fn read_process_image(pid: u32) -> Option<String> {
    if pid == 0 {
        return None;
    }
    let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if process.is_null() {
        return None;
    }
    let mut buffer = vec![0_u16; 32_768];
    let mut length = buffer.len() as u32;
    let read =
        unsafe { QueryFullProcessImageNameW(process, 0, buffer.as_mut_ptr(), &mut length) } != 0;
    unsafe {
        CloseHandle(process);
    }
    if !read {
        return None;
    }
    Some(String::from_utf16_lossy(&buffer[..length as usize]))
}

fn windows_image_paths_equal(observed: &str, expected: &str) -> bool {
    normalize_windows_image_path(observed) == normalize_windows_image_path(expected)
}

fn normalize_windows_image_path(value: &str) -> String {
    value.trim().replace('/', "\\").to_ascii_lowercase()
}

#[cfg(test)]
fn qa_window_process_image(hwnd: HWND) -> Option<String> {
    let mut pid = 0_u32;
    unsafe {
        GetWindowThreadProcessId(hwnd, &mut pid);
    }
    read_process_image(pid)
}

/// Opt-in console QA for the Dev Lab sequence. The runner leaves the browser
/// minimized behind another window, so this has to raise that window itself
/// and only then close the active tab.
#[test]
#[ignore = "raises a background browser window, then closes its foreground tab"]
fn qa_windows_lab_activates_then_closes_browser_tab() {
    const ENV_OPT_IN: &str = "DRIFTY_NATIVE_QA_WINDOWS_TAB_CLOSE";
    assert_eq!(
        std::env::var(ENV_OPT_IN).as_deref(),
        Ok("1"),
        "set {ENV_OPT_IN}=1 to confirm this native UI action"
    );
    let browser_name =
        std::env::var("DRIFTY_NATIVE_QA_BROWSER").expect("set DRIFTY_NATIVE_QA_BROWSER");
    let browser_identity = std::env::var("DRIFTY_NATIVE_QA_BROWSER_IDENTITY")
        .expect("set DRIFTY_NATIVE_QA_BROWSER_IDENTITY");
    let url = std::env::var("DRIFTY_NATIVE_QA_URL").expect("set DRIFTY_NATIVE_QA_URL");
    assert!(
        url.starts_with("http://127.0.0.1:") && url.contains("drifty_browser_qa="),
        "QA may only target a marked loopback page: {url}"
    );
    let result_path =
        std::env::var("DRIFTY_NATIVE_QA_RESULT_PATH").expect("set DRIFTY_NATIVE_QA_RESULT_PATH");

    let before = qa_window_process_image(unsafe { GetForegroundWindow() });
    let was_already_foreground = before
        .as_deref()
        .is_some_and(|image| windows_image_paths_equal(image, &browser_identity));
    let activation = if was_already_foreground {
        Err("windows_lab_browser_already_foreground".to_string())
    } else {
        activate_lab_browser(&PetModeInterventionTarget {
            id: "windows-lab-browser-qa".to_string(),
            app_name: browser_name.clone(),
            browser_name: Some(browser_name.clone()),
            browser_identity: Some(browser_identity.clone()),
            site_domain: None,
            site_url: Some(url.clone()),
            preview: false,
            lab_target: Some(super::PetModeLabTargetKind::BrowserTabX),
        })
    };
    let after = qa_window_process_image(unsafe { GetForegroundWindow() });
    let foreground_matches = after
        .as_deref()
        .is_some_and(|image| windows_image_paths_equal(image, &browser_identity));
    let activate_ok = activation.is_ok() && foreground_matches;
    let activate_diagnostic = if was_already_foreground {
        "windows_lab_browser_already_foreground".to_string()
    } else if let Err(error) = &activation {
        error.clone()
    } else if !foreground_matches {
        "windows_lab_browser_not_foreground".to_string()
    } else {
        "activated".to_string()
    };
    let close = if activate_ok {
        crate::commands::extreme_nudge::close_browser_tab_for_lab(
            &browser_name,
            Some(&browser_identity),
            Some(&url),
            None,
        )
    } else {
        Err("not_closed".to_string())
    };
    let result = serde_json::json!({
        "activate": {
            "ok": activate_ok,
            "diagnostic": activate_diagnostic,
            "wasAlreadyForeground": was_already_foreground,
            "foregroundMatches": foreground_matches,
        },
        "close": match &close {
            Ok(diagnostic) => serde_json::json!({ "ok": true, "diagnostic": diagnostic }),
            Err(diagnostic) => serde_json::json!({ "ok": false, "diagnostic": diagnostic }),
        }
    });
    std::fs::write(
        &result_path,
        serde_json::to_vec_pretty(&result).expect("serialize result"),
    )
    .expect("write QA result");
}
