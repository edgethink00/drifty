use serde::Serialize;

#[cfg(any(target_os = "windows", test))]
const MAX_OWNED_CHILD_FRAMES: usize = 8;

/// Passive, bounded geometry for the pet's own window tree only.
/// No native handle, class/title, process identity or pointer history is exported.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowsPetSurfaceBounds {
    client_width: i32,
    client_height: i32,
    webview_x: i32,
    webview_y: i32,
    webview_width: u32,
    webview_height: u32,
    cursor_client_x: f64,
    cursor_client_y: f64,
    point_target_inside_pet: bool,
    webview_scale: Option<WebviewScaleObservation>,
    children: Vec<OwnedChildFrame>,
    children_truncated: bool,
    child_bounds_read_failures: u8,
    layered_alpha: Option<u8>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct WebviewScaleObservation {
    rasterization_scale: Option<f64>,
    bounds_mode: Option<i32>,
    detects_monitor_scale_changes: Option<bool>,
    zoom_factor: Option<f64>,
    background_alpha: Option<u8>,
    parent_matches_pet: Option<bool>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OwnedChildFrame {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    dpi: Option<u32>,
    visible: bool,
    enabled: bool,
    point_in_rect: bool,
}

#[cfg(any(target_os = "windows", test))]
#[derive(Default)]
struct ChildFrames {
    frames: Vec<OwnedChildFrame>,
    visited: usize,
    truncated: bool,
    read_failures: u8,
}

#[cfg(any(target_os = "windows", test))]
impl ChildFrames {
    fn admit(&mut self) -> bool {
        if self.visited >= MAX_OWNED_CHILD_FRAMES {
            self.truncated = true;
            return false;
        }
        self.visited += 1;
        true
    }
}

#[cfg(any(target_os = "windows", test))]
fn observed_positive_scale(value: f64, read_succeeded: bool) -> Option<f64> {
    (read_succeeded && value.is_finite() && value > 0.0).then_some(value)
}

#[cfg(target_os = "windows")]
fn read_webview_scale(window: &tauri::WebviewWindow) -> Option<WebviewScaleObservation> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Controller2, ICoreWebView2Controller3, COREWEBVIEW2_BOUNDS_MODE,
        COREWEBVIEW2_COLOR,
    };
    use windows_core::{Interface, BOOL};

    // The caller checks the owner thread. Pinned Tauri's with_webview dispatch
    // is inline there. Never wait/pump on that thread: if a future dispatcher
    // queues the closure, this optional observation remains unavailable.
    let owned_hwnd = window.hwnd().ok()?.0 as usize;
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    window
        .with_webview(move |webview| {
            let controller = webview.controller();
            let mut result = WebviewScaleObservation::default();
            let mut zoom = 0.0;
            let read_zoom = unsafe { controller.ZoomFactor(&mut zoom) }.is_ok();
            result.zoom_factor = observed_positive_scale(zoom, read_zoom);
            let mut parent = unsafe { std::mem::zeroed() };
            if unsafe { controller.ParentWindow(&mut parent) }.is_ok() {
                result.parent_matches_pet = Some(parent.0 as usize == owned_hwnd);
            }
            if let Ok(controller3) = controller.cast::<ICoreWebView2Controller3>() {
                let mut scale = 0.0;
                let read_scale = unsafe { controller3.RasterizationScale(&mut scale) }.is_ok();
                result.rasterization_scale = observed_positive_scale(scale, read_scale);
                let mut mode = COREWEBVIEW2_BOUNDS_MODE(0);
                if unsafe { controller3.BoundsMode(&mut mode) }.is_ok() {
                    result.bounds_mode = Some(mode.0);
                }
                let mut detect = BOOL(0);
                if unsafe { controller3.ShouldDetectMonitorScaleChanges(&mut detect) }.is_ok() {
                    result.detects_monitor_scale_changes = Some(detect.0 != 0);
                }
            }
            if let Ok(controller2) = controller.cast::<ICoreWebView2Controller2>() {
                let mut color = COREWEBVIEW2_COLOR::default();
                if unsafe { controller2.DefaultBackgroundColor(&mut color) }.is_ok() {
                    result.background_alpha = Some(color.A);
                }
            }
            let _ = sender.send(result);
        })
        .ok()?;
    receiver.try_recv().ok()
}

#[cfg(target_os = "windows")]
struct OwnedChildRead {
    parent: windows_sys::Win32::Foundation::HWND,
    origin: windows_sys::Win32::Foundation::POINT,
    pointer: windows_sys::Win32::Foundation::POINT,
    snapshot: ChildFrames,
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn observe_child_frame(
    hwnd: windows_sys::Win32::Foundation::HWND,
    data: windows_sys::Win32::Foundation::LPARAM,
) -> i32 {
    use windows_sys::Win32::Foundation::RECT;
    use windows_sys::Win32::UI::{
        HiDpi::GetDpiForWindow,
        Input::KeyboardAndMouse::IsWindowEnabled,
        WindowsAndMessaging::{GetWindowRect, IsChild, IsWindowVisible},
    };
    if data == 0 {
        return 0;
    }
    crate::panic_guard::contain_panic("pet_surface::owned_child", || {
        // EnumChildWindows invokes this synchronously while this stack context
        // lives. Recheck the parent relation before reading a possibly destroyed child.
        let context = unsafe { &mut *(data as *mut OwnedChildRead) };
        if !context.snapshot.admit() {
            return 0;
        }
        let mut rect = RECT::default();
        if unsafe { IsChild(context.parent, hwnd) } == 0
            || unsafe { GetWindowRect(hwnd, &mut rect) } == 0
        {
            context.snapshot.read_failures = context.snapshot.read_failures.saturating_add(1);
            return 1;
        }
        let dpi = unsafe { GetDpiForWindow(hwnd) };
        context.snapshot.frames.push(OwnedChildFrame {
            x: rect.left - context.origin.x,
            y: rect.top - context.origin.y,
            width: rect.right - rect.left,
            height: rect.bottom - rect.top,
            dpi: (dpi != 0).then_some(dpi),
            visible: unsafe { IsWindowVisible(hwnd) } != 0,
            enabled: unsafe { IsWindowEnabled(hwnd) } != 0,
            point_in_rect: context.pointer.x >= rect.left
                && context.pointer.x < rect.right
                && context.pointer.y >= rect.top
                && context.pointer.y < rect.bottom,
        });
        1
    })
    .unwrap_or(0)
}

#[cfg(target_os = "windows")]
pub(super) fn read_windows_pet_surface_bounds(
    window: &tauri::WebviewWindow,
) -> Result<WindowsPetSurfaceBounds, String> {
    use windows_sys::Win32::Foundation::{POINT, RECT};
    use windows_sys::Win32::Graphics::Gdi::ClientToScreen;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumChildWindows, GetClientRect, GetLayeredWindowAttributes, IsChild, WindowFromPoint,
        LWA_ALPHA,
    };
    if !super::pet_mode::pet_native_thread_is_current(window)? {
        return Err("Pet surface diagnostics require the owner thread".to_string());
    }
    let hwnd = window.hwnd().map_err(|error| error.to_string())?.0;
    let mut client = RECT::default();
    if unsafe { GetClientRect(hwnd, &mut client) } == 0 {
        return Err("Could not read the owned Pet client bounds".to_string());
    }
    let webview: &tauri::Webview = window.as_ref();
    let bounds = webview.bounds().map_err(|error| error.to_string())?;
    let scale = super::pet_cursor_windows::window_scale_factor(window)?;
    let webview_position = bounds.position.to_physical::<i32>(scale);
    let webview_size = bounds.size.to_physical::<u32>(scale);
    let pointer = super::pet_cursor_windows::cursor_position()?;
    let mut origin = POINT::default();
    if unsafe { ClientToScreen(hwnd, &mut origin) } == 0 {
        return Err("Could not read the owned Pet client origin".to_string());
    }
    let point = POINT {
        x: pointer.x as i32,
        y: pointer.y as i32,
    };
    let target = unsafe { WindowFromPoint(point) };
    let point_target_inside_pet =
        target == hwnd || (!target.is_null() && unsafe { IsChild(hwnd, target) } != 0);
    let mut children = OwnedChildRead {
        parent: hwnd,
        origin,
        pointer: point,
        snapshot: ChildFrames::default(),
    };
    // Descendant frames only; neither identities nor handles survive this read.
    unsafe {
        EnumChildWindows(
            hwnd,
            Some(observe_child_frame),
            &mut children as *mut _ as isize,
        );
    }
    let mut color_key = 0;
    let mut alpha = 0;
    let mut flags = 0;
    let read_layered =
        unsafe { GetLayeredWindowAttributes(hwnd, &mut color_key, &mut alpha, &mut flags) } != 0;
    let layered_alpha = (read_layered && flags & LWA_ALPHA != 0).then_some(alpha);
    Ok(WindowsPetSurfaceBounds {
        client_width: client.right - client.left,
        client_height: client.bottom - client.top,
        webview_x: webview_position.x,
        webview_y: webview_position.y,
        webview_width: webview_size.width,
        webview_height: webview_size.height,
        cursor_client_x: (pointer.x - origin.x as f64) / scale,
        cursor_client_y: (pointer.y - origin.y as f64) / scale,
        point_target_inside_pet,
        webview_scale: read_webview_scale(window),
        children: children.snapshot.frames,
        children_truncated: children.snapshot.truncated,
        child_bounds_read_failures: children.snapshot.read_failures,
        layered_alpha,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn optional_com_read_failure_and_invalid_scales_remain_unknown() {
        for value in [0.0, -1.0, f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            assert_eq!(observed_positive_scale(value, true), None);
        }
        assert_eq!(observed_positive_scale(2.25, false), None);
        assert_eq!(observed_positive_scale(2.25, true), Some(2.25));
        let json = serde_json::to_value(WebviewScaleObservation::default()).unwrap();
        assert!(json["rasterizationScale"].is_null());
        assert!(json["detectsMonitorScaleChanges"].is_null());
        assert!(json["parentMatchesPet"].is_null());
    }
    #[test]
    fn a_large_owned_child_tree_stops_after_eight_reads() {
        let mut state = ChildFrames::default();
        for _ in 0..100 {
            if !state.admit() {
                break;
            }
        }
        assert_eq!(state.visited, MAX_OWNED_CHILD_FRAMES);
        assert!(state.truncated);
        let fresh = ChildFrames::default();
        assert!(!fresh.truncated);
        assert_eq!(fresh.visited, 0);
        assert!(fresh.frames.is_empty());
        assert_eq!(fresh.read_failures, 0);
    }
}
