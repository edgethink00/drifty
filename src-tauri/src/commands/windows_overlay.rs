use tauri::WebviewWindow;

/// Native input policy shared by Drifty's transparent Windows surfaces.
///
/// The policy is intentionally smaller than any one feature: pet, companion,
/// and watcher windows all need the same no-activation invariant even though
/// they choose different initial pointer behavior.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub enum WindowsOverlayInputMode {
    Passive,
    Interactive,
}

impl WindowsOverlayInputMode {
    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    fn ignores_pointer(self) -> bool {
        self == Self::Passive
    }
}

#[cfg(target_os = "windows")]
const DRIFTY_OVERLAY_SUBCLASS_ID: usize = 0x4452_4654;

#[cfg(target_os = "windows")]
unsafe extern "system" fn overlay_subclass_proc(
    hwnd: windows_sys::Win32::Foundation::HWND,
    message: u32,
    wparam: windows_sys::Win32::Foundation::WPARAM,
    lparam: windows_sys::Win32::Foundation::LPARAM,
    subclass_id: usize,
    _reference_data: usize,
) -> windows_sys::Win32::Foundation::LRESULT {
    use windows_sys::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        MA_NOACTIVATE, WM_MOUSEACTIVATE, WM_NCDESTROY,
    };

    if message == WM_MOUSEACTIVATE {
        return MA_NOACTIVATE as isize;
    }
    if message == WM_NCDESTROY {
        // SAFETY: this callback was installed with the same function and id on
        // this HWND. Removing it during WM_NCDESTROY prevents a recycled HWND
        // from inheriting Drifty's activation policy.
        unsafe {
            RemoveWindowSubclass(hwnd, Some(overlay_subclass_proc), subclass_id);
        }
    }
    // SAFETY: all unhandled messages must continue through the comctl32
    // subclass chain for Tauri/Tao to retain ownership of the native window.
    unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
}

#[cfg(target_os = "windows")]
fn windows_error(context: &str) -> tauri::Error {
    tauri::Error::Io(std::io::Error::new(
        std::io::ErrorKind::Other,
        format!("{context}: {}", std::io::Error::last_os_error()),
    ))
}

#[cfg(target_os = "windows")]
fn apply_native_overlay_policy(
    window: &WebviewWindow,
    mode: WindowsOverlayInputMode,
) -> tauri::Result<()> {
    use windows_sys::Win32::Foundation::{GetLastError, SetLastError, ERROR_SUCCESS};
    use windows_sys::Win32::UI::Shell::SetWindowSubclass;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, HWND_TOPMOST,
        SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, WS_EX_APPWINDOW, WS_EX_LAYERED,
        WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT,
    };

    let hwnd = window.hwnd()?.0;
    // SAFETY: hwnd is the live top-level window owned by this WebviewWindow.
    // The setup path runs on Tauri's window thread before the surface is shown.
    unsafe {
        let current = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        let mut desired = current | WS_EX_LAYERED | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW;
        desired &= !WS_EX_APPWINDOW;
        if mode.ignores_pointer() {
            desired |= WS_EX_TRANSPARENT;
        } else {
            desired &= !WS_EX_TRANSPARENT;
        }

        SetLastError(ERROR_SUCCESS);
        let previous = SetWindowLongPtrW(hwnd, GWL_EXSTYLE, desired as isize);
        if previous == 0 && GetLastError() != ERROR_SUCCESS {
            return Err(windows_error("failed to apply Windows overlay styles"));
        }
        if SetWindowSubclass(
            hwnd,
            Some(overlay_subclass_proc),
            DRIFTY_OVERLAY_SUBCLASS_ID,
            0,
        ) == 0
        {
            return Err(windows_error(
                "failed to install Windows overlay activation guard",
            ));
        }
        if SetWindowPos(
            hwnd,
            HWND_TOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_FRAMECHANGED,
        ) == 0
        {
            return Err(windows_error(
                "failed to position Windows overlay without activation",
            ));
        }
    }
    Ok(())
}

pub fn configure_windows_overlay(
    window: &WebviewWindow,
    mode: WindowsOverlayInputMode,
) -> tauri::Result<()> {
    #[cfg(target_os = "windows")]
    {
        // The overlay is shown with Win32's SW_SHOWNOACTIVATE so Tao's cached
        // VISIBLE flag intentionally remains false. Calling Tauri's
        // set_ignore_cursor_events later rebuilds the complete style from that
        // stale cache and removes WS_VISIBLE. Own the Windows extended style
        // here instead; WS_EX_TRANSPARENT is the native pointer policy.
        apply_native_overlay_policy(window, mode)?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (window, mode);
    }
    Ok(())
}

pub fn set_windows_overlay_click_through(
    window: &WebviewWindow,
    ignore: bool,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        return apply_native_overlay_policy(
            window,
            if ignore {
                WindowsOverlayInputMode::Passive
            } else {
                WindowsOverlayInputMode::Interactive
            },
        )
        .map_err(|error| error.to_string());
    }
    #[cfg(not(target_os = "windows"))]
    {
        window
            .set_ignore_cursor_events(ignore)
            .map_err(|error| error.to_string())
    }
}

/// Read the native visibility bit, not Tao's stale overlay visibility cache.
/// This reports shown/hidden state, not occlusion by another window.
pub fn is_windows_overlay_visible(window: &WebviewWindow) -> bool {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::IsWindowVisible;
        window
            .hwnd()
            .is_ok_and(|hwnd| unsafe { IsWindowVisible(hwnd.0) != 0 })
    }
    #[cfg(not(target_os = "windows"))]
    {
        window.is_visible().unwrap_or(false)
    }
}

/// Hide an overlay revealed by `SW_SHOWNOACTIVATE` without Tao's cached flag.
pub fn hide_windows_overlay(window: &WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{IsWindowVisible, ShowWindow, SW_HIDE};

        let hwnd = window.hwnd().map_err(|error| error.to_string())?.0;
        // ShowWindow's return value reports the previous visibility state, not
        // success. IsWindowVisible verifies the requested postcondition.
        unsafe {
            ShowWindow(hwnd, SW_HIDE);
            if IsWindowVisible(hwnd) != 0 {
                return Err("failed to hide Windows overlay".to_string());
            }
        }
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        window.hide().map_err(|error| error.to_string())
    }
}

#[cfg(target_os = "windows")]
pub fn show_windows_overlay(window: &WebviewWindow) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, ShowWindow, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
        SWP_SHOWWINDOW, SW_SHOWNOACTIVATE,
    };

    let hwnd = window.hwnd().map_err(|error| error.to_string())?.0;
    // ShowWindow returning zero only means the window was previously hidden.
    // SetWindowPos is the operation whose failure is actionable.
    unsafe {
        ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        if SetWindowPos(
            hwnd,
            HWND_TOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
        ) == 0
        {
            return Err(format!(
                "failed to show Windows overlay without activation: {}",
                std::io::Error::last_os_error()
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passive_and_interactive_modes_have_opposite_pointer_policy() {
        assert!(WindowsOverlayInputMode::Passive.ignores_pointer());
        assert!(!WindowsOverlayInputMode::Interactive.ignores_pointer());
    }
}
