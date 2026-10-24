use tauri::WebviewWindow;

#[cfg(any(target_os = "windows", test))]
use std::sync::Arc;
#[cfg(target_os = "windows")]
use std::sync::Mutex;

/// One pending owner-thread request per live pet instance. A real broadcast
/// arriving during the apply gets one follow-up; a failed apply never retries
/// itself. This state does not contain a DPI, position, or visibility value.
#[cfg(any(target_os = "windows", test))]
#[derive(Default)]
struct PetDpiReevaluationQueue {
    closed: bool,
    scheduled: bool,
    dirty: bool,
}

#[cfg(any(target_os = "windows", test))]
impl PetDpiReevaluationQueue {
    fn request(&mut self) -> bool {
        if self.closed {
            return false;
        }
        self.dirty = true;
        if self.scheduled {
            return false;
        }
        self.scheduled = true;
        true
    }

    fn begin(&mut self) -> bool {
        if self.closed || !self.scheduled {
            return false;
        }
        self.dirty = false;
        true
    }

    fn finish(&mut self) -> bool {
        if self.closed {
            return false;
        }
        if self.dirty {
            return true;
        }
        self.scheduled = false;
        false
    }

    fn abandon(&mut self) {
        self.scheduled = false;
        self.dirty = false;
    }

    fn close(&mut self) {
        self.closed = true;
        self.abandon();
    }
}

#[cfg(any(target_os = "windows", test))]
fn apply_current_pet_dpi_frame(
    current_instance: bool,
    owner_thread: bool,
    read_current_origin: impl FnOnce() -> Result<(i32, i32), String>,
    request_frame: impl FnOnce(i32, i32) -> Result<(), String>,
) -> Result<bool, String> {
    if !current_instance {
        return Ok(false);
    }
    if !owner_thread {
        return Err("Pet DPI reevaluation requires its owner thread".to_string());
    }
    let (x, y) = read_current_origin()?;
    request_frame(x, y)?;
    Ok(true)
}

#[cfg(any(target_os = "windows", test))]
fn same_pet_dpi_instance<T>(current: Option<&Arc<T>>, expected: &Arc<T>) -> bool {
    current.is_some_and(|current| Arc::ptr_eq(current, expected))
}

#[cfg(target_os = "windows")]
struct PetDpiReevaluationTarget {
    hwnd: usize,
    window: WebviewWindow,
    queue: Mutex<PetDpiReevaluationQueue>,
}

#[cfg(target_os = "windows")]
static PET_DPI_REEVALUATION_TARGET: Mutex<Option<Arc<PetDpiReevaluationTarget>>> = Mutex::new(None);

#[cfg(target_os = "windows")]
fn register_pet_dpi_reevaluation_target(window: &WebviewWindow, hwnd: usize) {
    let target = Arc::new(PetDpiReevaluationTarget {
        hwnd,
        window: window.clone(),
        queue: Mutex::new(PetDpiReevaluationQueue::default()),
    });
    let previous = PET_DPI_REEVALUATION_TARGET
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .replace(target);
    if let Some(previous) = previous {
        previous
            .queue
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .close();
    }
}

#[cfg(target_os = "windows")]
fn cancel_pet_dpi_reevaluation_target(hwnd: Option<usize>) {
    let previous = {
        let mut current = PET_DPI_REEVALUATION_TARGET
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if hwnd.is_none()
            || current
                .as_ref()
                .is_some_and(|target| Some(target.hwnd) == hwnd)
        {
            current.take()
        } else {
            None
        }
    };
    if let Some(previous) = previous {
        previous
            .queue
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .close();
    }
}

/// Release the registered queue capability before committed shutdown waits.
#[cfg(target_os = "windows")]
pub(crate) fn stop_windows_pet_dpi_reevaluation() {
    cancel_pet_dpi_reevaluation_target(None);
}

#[cfg(target_os = "windows")]
fn schedule_pet_dpi_reevaluation(target: Arc<PetDpiReevaluationTarget>) {
    let on_failure = target.clone();
    // run_on_main_thread executes inline on the owner thread. Enqueue from a
    // worker only after DefSubclassProc has finished the original broadcast.
    let worker = std::thread::Builder::new()
        .name("pet-dpi-reevaluation".into())
        .spawn(move || {
            let owned = target.clone();
            let queued = crate::panic_guard::contain_panic("pet_dpi::enqueue", || {
                target.window.run_on_main_thread(move || {
                    if crate::panic_guard::contain_panic("pet_dpi::reevaluate", || {
                        run_pet_dpi_reevaluation(&owned);
                    })
                    .is_none()
                    {
                        owned
                            .queue
                            .lock()
                            .unwrap_or_else(|error| error.into_inner())
                            .abandon();
                    }
                })
            });
            if !matches!(queued, Some(Ok(()))) {
                target
                    .queue
                    .lock()
                    .unwrap_or_else(|error| error.into_inner())
                    .abandon();
                eprintln!("Could not enqueue Pet DPI reevaluation");
            }
        });
    if worker.is_err() {
        on_failure
            .queue
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .abandon();
        eprintln!("Could not start Pet DPI reevaluation worker");
    }
}

#[cfg(target_os = "windows")]
fn pet_dpi_target_for_hwnd(hwnd: usize) -> Option<Arc<PetDpiReevaluationTarget>> {
    PET_DPI_REEVALUATION_TARGET
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .as_ref()
        .filter(|target| target.hwnd == hwnd)
        .cloned()
}

#[cfg(target_os = "windows")]
fn request_pet_dpi_reevaluation(target: Arc<PetDpiReevaluationTarget>) {
    if !same_pet_dpi_instance(
        PET_DPI_REEVALUATION_TARGET
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .as_ref(),
        &target,
    ) {
        return;
    }
    let enqueue = target
        .queue
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .request();
    if enqueue {
        schedule_pet_dpi_reevaluation(target);
    }
}

#[cfg(target_os = "windows")]
fn run_pet_dpi_reevaluation(target: &Arc<PetDpiReevaluationTarget>) {
    use windows_sys::Win32::Foundation::RECT;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowRect, SetWindowPos, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOSIZE, SWP_NOZORDER,
    };

    if !target
        .queue
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .begin()
    {
        return;
    }
    // Arc identity distinguishes a destroyed/replaced pet even if Windows
    // recycles its numeric HWND. No registry or queue lock enters Win32.
    let current_instance = same_pet_dpi_instance(
        PET_DPI_REEVALUATION_TARGET
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .as_ref(),
        target,
    );
    let result = (|| {
        if !current_instance {
            return Ok(false);
        }
        let owner = super::pet_mode::pet_native_thread_is_current(&target.window)?;
        let hwnd = target.hwnd as windows_sys::Win32::Foundation::HWND;
        apply_current_pet_dpi_frame(
            current_instance,
            owner,
            || {
                let current_hwnd = target.window.hwnd().map_err(|error| error.to_string())?.0;
                if current_hwnd != hwnd {
                    return Err("Pet DPI reevaluation window changed".to_string());
                }
                let mut rect = RECT::default();
                if unsafe { GetWindowRect(hwnd, &mut rect) } == 0 {
                    return Err(windows_error("failed to read current Pet DPI origin").to_string());
                }
                // Read on the owner thread immediately before the native call.
                // Keep signed screen coordinates, including off-screen padding.
                Ok((rect.left, rect.top))
            },
            |x, y| {
                // Count only an actual SetWindowPos attempt, not a failed read.
                super::pet_mode::record_windows_pet_policy_frame_change();
                // Request the exact current origin through Windows' position
                // path: NOMOVE would discard x/y. No nudge, show, style reset,
                // explicit DPI override or synthetic WM_DPICHANGED is used.
                // Whether this produces a real DPI event is still native-QA
                // unproven; FRAMECHANGED alone only guarantees NCCALCSIZE.
                if unsafe {
                    SetWindowPos(
                        hwnd,
                        std::ptr::null_mut(),
                        x,
                        y,
                        0,
                        0,
                        SWP_FRAMECHANGED | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOZORDER,
                    )
                } == 0
                {
                    return Err(windows_error("failed to reevaluate Pet DPI frame").to_string());
                }
                Ok(())
            },
        )
    })();
    if let Err(error) = result {
        eprintln!("Could not reevaluate Pet DPI frame: {error}");
    }
    let follow_up = target
        .queue
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .finish();
    if follow_up {
        schedule_pet_dpi_reevaluation(target.clone());
    }
}

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

/// Reconcile only the native pointer bit. Logical mask state is not evidence
/// of the last applied HWND style, especially after a pose/reset publication.
#[cfg(any(target_os = "windows", test))]
pub(super) fn update_windows_overlay_pointer_policy(
    owner_thread: bool,
    ignore: bool,
    transparent_bit: u32,
    read_style: impl FnOnce() -> Result<u32, String>,
    write_style: impl FnOnce(u32) -> Result<(), String>,
) -> Result<bool, String> {
    if !owner_thread {
        return Err("Windows overlay pointer policy requires its owner thread".to_string());
    }
    let current = read_style()?;
    let desired = if ignore {
        current | transparent_bit
    } else {
        current & !transparent_bit
    };
    if desired == current {
        return Ok(false);
    }
    write_style(desired)?;
    Ok(true)
}

#[cfg(target_os = "windows")]
const DRIFTY_OVERLAY_SUBCLASS_ID: usize = 0x4452_4654;

#[cfg(target_os = "windows")]
const PET_DPI_OBSERVER_REFERENCE: usize = 1;

#[cfg(target_os = "windows")]
unsafe extern "system" fn overlay_subclass_proc(
    hwnd: windows_sys::Win32::Foundation::HWND,
    message: u32,
    wparam: windows_sys::Win32::Foundation::WPARAM,
    lparam: windows_sys::Win32::Foundation::LPARAM,
    subclass_id: usize,
    reference_data: usize,
) -> windows_sys::Win32::Foundation::LRESULT {
    use windows_sys::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        MA_NOACTIVATE, WM_DISPLAYCHANGE, WM_DPICHANGED, WM_MOUSEACTIVATE, WM_NCDESTROY,
        WM_SETTINGCHANGE,
    };

    // Capture this instance before the original proc can destroy it or create
    // another pet with the same numeric HWND. Never look up a new instance on
    // behalf of a broadcast belonging to the old one.
    let dpi_target = if reference_data == PET_DPI_OBSERVER_REFERENCE
        && matches!(message, WM_SETTINGCHANGE | WM_DISPLAYCHANGE)
    {
        crate::panic_guard::contain_panic("pet_dpi::capture_instance", || {
            pet_dpi_target_for_hwnd(hwnd as usize)
        })
        .flatten()
    } else {
        None
    };

    if reference_data == PET_DPI_OBSERVER_REFERENCE {
        // Observe this owned pet's ingress before forwarding the original
        // message unchanged. Initial creation before subclass installation is
        // outside this diagnostic's coverage. No HWND or LPARAM is retained.
        match message {
            WM_DPICHANGED => super::pet_mode::record_windows_pet_dpi_message(wparam),
            WM_SETTINGCHANGE => super::pet_mode::record_windows_pet_setting_change(wparam),
            WM_DISPLAYCHANGE => super::pet_mode::record_windows_pet_display_change(),
            _ => {}
        }
    }
    if message == WM_MOUSEACTIVATE {
        return MA_NOACTIVATE as isize;
    }
    if message == WM_NCDESTROY {
        if reference_data == PET_DPI_OBSERVER_REFERENCE {
            let _ = crate::panic_guard::contain_panic("pet_dpi::destroy", || {
                cancel_pet_dpi_reevaluation_target(Some(hwnd as usize));
            });
        }
        // SAFETY: this callback was installed with the same function and id on
        // this HWND. Removing it during WM_NCDESTROY prevents a recycled HWND
        // from inheriting Drifty's activation policy.
        unsafe {
            RemoveWindowSubclass(hwnd, Some(overlay_subclass_proc), subclass_id);
        }
    }
    // SAFETY: all unhandled messages must continue through the comctl32
    // subclass chain for Tauri/Tao to retain ownership of the native window.
    let result = unsafe { DefSubclassProc(hwnd, message, wparam, lparam) };
    if let Some(target) = dpi_target {
        let _ = crate::panic_guard::contain_panic("pet_dpi::broadcast", || {
            request_pet_dpi_reevaluation(target);
        });
    }
    result
}

#[cfg(target_os = "windows")]
fn windows_error(context: &str) -> tauri::Error {
    tauri::Error::Io(std::io::Error::new(
        std::io::ErrorKind::Other,
        format!("{context}: {}", std::io::Error::last_os_error()),
    ))
}

#[cfg(target_os = "windows")]
fn read_windows_overlay_extended_style(
    hwnd: windows_sys::Win32::Foundation::HWND,
) -> Result<u32, String> {
    use windows_sys::Win32::Foundation::{GetLastError, SetLastError, ERROR_SUCCESS};
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetWindowLongPtrW, GWL_EXSTYLE};
    unsafe {
        SetLastError(ERROR_SUCCESS);
        let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        if style == 0 && GetLastError() != ERROR_SUCCESS {
            return Err(windows_error("failed to read Windows overlay styles").to_string());
        }
        Ok(style as u32)
    }
}

#[cfg(target_os = "windows")]
fn apply_windows_overlay_pointer_policy(
    window: &WebviewWindow,
    ignore: bool,
) -> Result<(), String> {
    use windows_sys::Win32::Foundation::{GetLastError, SetLastError, ERROR_SUCCESS};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE,
        SWP_NOSIZE, SWP_NOZORDER, WS_EX_TRANSPARENT,
    };

    let owner_thread = super::pet_mode::pet_native_thread_is_current(window)?;
    let hwnd = window.hwnd().map_err(|error| error.to_string())?.0;
    update_windows_overlay_pointer_policy(
        owner_thread,
        ignore,
        WS_EX_TRANSPARENT,
        || read_windows_overlay_extended_style(hwnd),
        |desired| {
            // The subclass and no-activation/layered setup remain installed.
            // Change only the pointer bit, retaining visibility and all other
            // extended styles. No show, focus, move, resize, or z-order change.
            unsafe {
                SetLastError(ERROR_SUCCESS);
                let previous = SetWindowLongPtrW(hwnd, GWL_EXSTYLE, desired as isize);
                if previous == 0 && GetLastError() != ERROR_SUCCESS {
                    return Err(
                        windows_error("failed to update Windows overlay pointer policy")
                            .to_string(),
                    );
                }
                if window.label() == super::pet_mode::PET_MODE_WINDOW_LABEL {
                    // Count the actual call attempt, not reconciliation polls.
                    // Release the receipt lock before Win32 can reenter DPI.
                    super::pet_mode::record_windows_pet_policy_frame_change();
                }
                if SetWindowPos(
                    hwnd,
                    std::ptr::null_mut(),
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
                ) == 0
                {
                    let error = windows_error("failed to refresh Windows overlay pointer policy")
                        .to_string();
                    // Keep a failed frame refresh retryable: reading the new
                    // style must not turn its next reconciliation into a no-op.
                    let _ = SetWindowLongPtrW(hwnd, GWL_EXSTYLE, previous);
                    return Err(error);
                }
            }
            Ok(())
        },
    )?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn apply_native_overlay_policy(
    window: &WebviewWindow,
    mode: WindowsOverlayInputMode,
) -> tauri::Result<()> {
    use windows_sys::Win32::Foundation::{GetLastError, SetLastError, ERROR_SUCCESS};
    use windows_sys::Win32::UI::Shell::SetWindowSubclass;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SetLayeredWindowAttributes, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, HWND_TOPMOST,
        LWA_ALPHA, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, WS_EX_APPWINDOW,
        WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT,
    };

    if !super::pet_mode::pet_native_thread_is_current(window)
        .map_err(|error| tauri::Error::Io(std::io::Error::other(error)))?
    {
        return Err(tauri::Error::Io(std::io::Error::other(
            "Windows overlay setup requires its owner thread",
        )));
    }
    let hwnd = window.hwnd()?.0;
    let reference_data = if window.label() == super::pet_mode::PET_MODE_WINDOW_LABEL {
        PET_DPI_OBSERVER_REFERENCE
    } else {
        0
    };
    // SAFETY: hwnd is the live top-level window owned by this WebviewWindow.
    // The setup path runs on Tauri's window thread before the surface is shown.
    unsafe {
        let current = read_windows_overlay_extended_style(hwnd)
            .map_err(|error| tauri::Error::Io(std::io::Error::other(error)))?;
        let mut desired = current | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW;
        if reference_data == PET_DPI_OBSERVER_REFERENCE {
            // Establish WebView composition with the first native reveal
            // before adding Layered. Adding it while this pet is still hidden
            // makes body input miss after live DPI increases on Windows.
            // The reveal commits Layered in the same owner-thread transaction.
            desired &= !WS_EX_LAYERED;
        } else {
            desired |= WS_EX_LAYERED;
        }
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
        // A layered window that never received layered attributes is
        // hit-tested as fully transparent: the Companion drift card showed,
        // yet every click on it (X, Take a break, Open dashboard) reached the
        // window behind, at 125% scaling on Windows 11 (2026-10-25). Opaque
        // alpha draws nothing differently; WS_EX_TRANSPARENT stays the only
        // pointer policy. The pet adds Layered later, on its first reveal.
        if desired & WS_EX_LAYERED != 0 && SetLayeredWindowAttributes(hwnd, 0, 255, LWA_ALPHA) == 0
        {
            return Err(windows_error(
                "failed to make the Windows overlay accept input",
            ));
        }
        if SetWindowSubclass(
            hwnd,
            Some(overlay_subclass_proc),
            DRIFTY_OVERLAY_SUBCLASS_ID,
            reference_data,
        ) == 0
        {
            return Err(windows_error(
                "failed to install Windows overlay activation guard",
            ));
        }
        if reference_data == PET_DPI_OBSERVER_REFERENCE {
            register_pet_dpi_reevaluation_target(window, hwnd as usize);
            super::pet_mode::record_windows_pet_policy_frame_change();
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
            if reference_data == PET_DPI_OBSERVER_REFERENCE {
                cancel_pet_dpi_reevaluation_target(Some(hwnd as usize));
            }
            return Err(windows_error(
                "failed to position Windows overlay without activation",
            ));
        }
    }
    Ok(())
}

#[cfg(any(target_os = "windows", test))]
fn reveal_windows_pet_surface(
    initialize_layered: bool,
    show: impl FnOnce(),
    initialize: impl FnOnce() -> Result<(), String>,
    position: impl FnOnce() -> Result<(), String>,
    conceal: impl FnOnce(),
) -> Result<(), String> {
    show();
    let result = (|| {
        if initialize_layered {
            initialize()?;
        }
        position()
    })();
    if result.is_err() {
        conceal();
    }
    result
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
        super::pet_mode::run_pet_native_transaction(
            window,
            "windows_overlay::configure",
            move |window| {
                apply_native_overlay_policy(&window, mode).map_err(|error| error.to_string())
            },
        )
        .map_err(|error| tauri::Error::Io(std::io::Error::other(error)))?;
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
        return super::pet_mode::run_pet_native_transaction(
            window,
            "windows_overlay::set_pointer_policy",
            move |window| apply_windows_overlay_pointer_policy(&window, ignore),
        );
    }
    #[cfg(not(target_os = "windows"))]
    {
        window
            .set_ignore_cursor_events(ignore)
            .map_err(|error| error.to_string())
    }
}

#[cfg(target_os = "windows")]
pub(super) fn windows_overlay_ignores_cursor_events(
    window: &WebviewWindow,
) -> Result<bool, String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::WS_EX_TRANSPARENT;
    if !super::pet_mode::pet_native_thread_is_current(window)? {
        return Err("Windows overlay input diagnostics require its owner thread".to_string());
    }
    let hwnd = window.hwnd().map_err(|error| error.to_string())?.0;
    Ok(read_windows_overlay_extended_style(hwnd)? & WS_EX_TRANSPARENT != 0)
}

/// Read shown/hidden state, not occlusion by another window. Tao's Windows
/// visibility getter also reads this native bit; its style setters have a
/// separate cached VISIBLE flag that our no-activation setup must not rebuild.
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
    use windows_sys::Win32::Foundation::{GetLastError, SetLastError, ERROR_SUCCESS};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SetWindowLongPtrW, SetWindowPos, ShowWindow, GWL_EXSTYLE, HWND_TOPMOST, SWP_FRAMECHANGED,
        SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW, SW_HIDE, SW_SHOWNOACTIVATE,
        WS_EX_LAYERED,
    };

    if window.label() == super::pet_mode::PET_MODE_WINDOW_LABEL {
        if !super::pet_mode::pet_native_thread_is_current(window)? {
            return Err("Windows pet reveal requires its owner thread".into());
        }
        let hwnd = window.hwnd().map_err(|error| error.to_string())?.0;
        let current = read_windows_overlay_extended_style(hwnd)?;
        let initialize_layered = current & WS_EX_LAYERED == 0;
        // The existing presentation gates have already prepared the scene,
        // mask, position, and pointer policy. There is no sleep or event-loop
        // hop between this no-activation reveal and its Layered commit. Retain
        // every pointer/style bit, and never reset Layered on DPI or re-show.
        return reveal_windows_pet_surface(
            initialize_layered,
            || unsafe {
                ShowWindow(hwnd, SW_SHOWNOACTIVATE);
            },
            || unsafe {
                SetLastError(ERROR_SUCCESS);
                let previous =
                    SetWindowLongPtrW(hwnd, GWL_EXSTYLE, (current | WS_EX_LAYERED) as isize);
                if previous == 0 && GetLastError() != ERROR_SUCCESS {
                    return Err(
                        windows_error("failed to initialize Windows pet composition").to_string(),
                    );
                }
                Ok(())
            },
            || unsafe {
                let frame = if initialize_layered {
                    SWP_FRAMECHANGED
                } else {
                    0
                };
                if SetWindowPos(
                    hwnd,
                    HWND_TOPMOST,
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW | frame,
                ) == 0
                {
                    return Err(
                        windows_error("failed to reveal Windows pet without activation")
                            .to_string(),
                    );
                }
                Ok(())
            },
            || unsafe {
                // A failed first commit stays hidden and retryable; restoring
                // the original style also retains its current pointer policy.
                ShowWindow(hwnd, SW_HIDE);
                if initialize_layered {
                    SetWindowLongPtrW(hwnd, GWL_EXSTYLE, current as isize);
                }
            },
        );
    }
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
    fn pet_first_reveal_commits_layered_after_show_and_reshow_does_not_reset_it() {
        use std::cell::RefCell;
        for first in [true, false] {
            let calls = RefCell::new(Vec::new());
            reveal_windows_pet_surface(
                first,
                || calls.borrow_mut().push("show_noactivate"),
                || {
                    calls.borrow_mut().push("layered");
                    Ok(())
                },
                || {
                    calls.borrow_mut().push("position_noactivate");
                    Ok(())
                },
                || panic!("successful reveal must not conceal the pet"),
            )
            .unwrap();
            assert_eq!(
                *calls.borrow(),
                if first {
                    vec!["show_noactivate", "layered", "position_noactivate"]
                } else {
                    vec!["show_noactivate", "position_noactivate"]
                }
            );
        }
    }

    #[test]
    fn failed_pet_reveal_conceals_without_reporting_or_continuing_success() {
        use std::cell::RefCell;
        for fail_init in [true, false] {
            let calls = RefCell::new(Vec::new());
            let result = reveal_windows_pet_surface(
                true,
                || calls.borrow_mut().push("show"),
                || {
                    calls.borrow_mut().push("layered");
                    if fail_init {
                        Err("style failed".into())
                    } else {
                        Ok(())
                    }
                },
                || {
                    calls.borrow_mut().push("position");
                    Err("position failed".into())
                },
                || calls.borrow_mut().push("conceal"),
            );
            assert_eq!(
                result.unwrap_err(),
                if fail_init {
                    "style failed"
                } else {
                    "position failed"
                }
            );
            assert_eq!(
                *calls.borrow(),
                if fail_init {
                    vec!["show", "layered", "conceal"]
                } else {
                    vec!["show", "layered", "position", "conceal"]
                }
            );
        }
    }

    #[test]
    fn dpi_reevaluation_coalesces_broadcasts_before_the_owner_apply() {
        use std::cell::Cell;
        let frames = Cell::new(0);
        let mut queue = PetDpiReevaluationQueue::default();
        assert!(queue.request());
        assert!(!queue.request());
        assert!(!queue.request());
        assert!(queue.begin());
        assert!(apply_current_pet_dpi_frame(
            true,
            true,
            || Ok((0, 0)),
            |_, _| {
                frames.set(frames.get() + 1);
                Ok(())
            }
        )
        .unwrap());
        assert!(!queue.finish());
        assert!(!queue.begin());
        assert_eq!(frames.get(), 1);
    }

    #[test]
    fn dpi_reevaluation_keeps_one_real_broadcast_arriving_during_apply() {
        let mut queue = PetDpiReevaluationQueue::default();
        assert!(queue.request());
        assert!(queue.begin());
        assert!(!queue.request());
        assert!(!queue.request());
        assert!(queue.finish());
        assert!(queue.begin());
        assert!(!queue.finish());
        assert!(!queue.begin());
    }

    #[test]
    fn dpi_reevaluation_native_failure_does_not_retry_without_a_new_broadcast() {
        use std::cell::Cell;
        let attempts = Cell::new(0);
        let mut queue = PetDpiReevaluationQueue::default();
        assert!(queue.request());
        assert!(queue.begin());
        let result = apply_current_pet_dpi_frame(
            true,
            true,
            || Ok((-1920, -68)),
            |x, y| {
                assert_eq!((x, y), (-1920, -68));
                attempts.set(attempts.get() + 1);
                Err("native frame failed".into())
            },
        );
        assert_eq!(result.unwrap_err(), "native frame failed");
        assert_eq!(attempts.get(), 1);
        assert!(!queue.finish());
        assert!(!queue.begin());
        assert!(queue.request());
    }

    #[test]
    fn dpi_reevaluation_enqueue_failure_allows_only_a_new_broadcast_to_schedule() {
        let mut queue = PetDpiReevaluationQueue::default();
        assert!(queue.request());
        queue.abandon();
        assert!(!queue.begin());
        assert!(queue.request());
        assert!(queue.begin());
        assert!(!queue.finish());
    }

    #[test]
    fn dpi_reevaluation_destroy_cancels_queued_and_in_flight_work() {
        for in_flight in [false, true] {
            let mut queue = PetDpiReevaluationQueue::default();
            assert!(queue.request());
            if in_flight {
                assert!(queue.begin());
                assert!(!queue.request());
            }
            queue.close();
            assert!(!queue.begin());
            assert!(!queue.finish());
            assert!(!queue.request());
        }
    }

    #[test]
    fn dpi_reevaluation_recycled_hwnd_cannot_apply_an_old_instance() {
        let old = Arc::new(42_usize);
        let new = Arc::new(42_usize);
        assert_eq!(*old, *new);
        assert!(!same_pet_dpi_instance(Some(&new), &old));
        assert!(!same_pet_dpi_instance(None, &old));
        let result = apply_current_pet_dpi_frame(
            same_pet_dpi_instance(Some(&new), &old),
            true,
            || panic!("recycled HWND must not read the new window's origin"),
            |_, _| panic!("recycled HWND must not receive the old frame request"),
        );
        assert_eq!(result.unwrap(), false);
        assert!(same_pet_dpi_instance(Some(&old), &old));
    }

    #[test]
    fn dpi_reevaluation_owner_guard_precedes_the_native_frame_request() {
        let result = apply_current_pet_dpi_frame(
            true,
            false,
            || panic!("must not read the window from a worker"),
            |_, _| panic!("must not touch the window from a worker"),
        );
        assert!(result.unwrap_err().contains("owner thread"));
        let result = apply_current_pet_dpi_frame(
            false,
            false,
            || panic!("stale work must not read any current window"),
            |_, _| panic!("stale work must not touch any current window"),
        );
        assert_eq!(result.unwrap(), false);
    }

    #[test]
    fn dpi_reevaluation_uses_the_fresh_signed_origin_without_replaying_a_queued_position() {
        use std::cell::{Cell, RefCell};
        for origin in [(1579, -68), (-1920, -68), (-2048, 421)] {
            let queued_origin = (1579, -67);
            let live_origin = Cell::new(queued_origin);
            let reads = Cell::new(0);
            let requests = RefCell::new(Vec::new());
            let mut queue = PetDpiReevaluationQueue::default();
            assert!(queue.request());
            // Another owner action can change position while the request waits.
            live_origin.set(origin);
            assert!(queue.begin());
            assert!(apply_current_pet_dpi_frame(
                true,
                true,
                || {
                    reads.set(reads.get() + 1);
                    Ok(live_origin.get())
                },
                |x, y| {
                    requests.borrow_mut().push((x, y));
                    Ok(())
                },
            )
            .unwrap());
            assert_eq!(reads.get(), 1);
            assert_eq!(*requests.borrow(), vec![origin]);
            assert_ne!(origin, queued_origin);
            assert!(!queue.finish());
            assert!(!queue.begin());
        }
    }

    #[test]
    fn dpi_reevaluation_origin_failure_skips_the_native_attempt_and_does_not_self_retry() {
        use std::cell::Cell;
        let reads = Cell::new(0);
        let attempts = Cell::new(0);
        let mut queue = PetDpiReevaluationQueue::default();
        assert!(queue.request());
        assert!(queue.begin());
        let result = apply_current_pet_dpi_frame(
            true,
            true,
            || {
                reads.set(reads.get() + 1);
                Err("current origin unavailable".into())
            },
            |_, _| {
                attempts.set(attempts.get() + 1);
                Ok(())
            },
        );
        assert_eq!(result.unwrap_err(), "current origin unavailable");
        assert_eq!(reads.get(), 1);
        assert_eq!(attempts.get(), 0);
        assert!(!queue.finish());
        assert!(!queue.begin());
        assert!(queue.request());
    }

    #[test]
    fn passive_and_interactive_modes_have_opposite_pointer_policy() {
        assert!(WindowsOverlayInputMode::Passive.ignores_pointer());
        assert!(!WindowsOverlayInputMode::Interactive.ignores_pointer());
    }

    #[test]
    fn pointer_policy_owner_guard_precedes_even_the_native_style_read() {
        use std::cell::Cell;
        let reads = Cell::new(0);
        let writes = Cell::new(0);
        let result = update_windows_overlay_pointer_policy(
            false,
            true,
            0x20,
            || {
                reads.set(reads.get() + 1);
                Ok(0)
            },
            |_| {
                writes.set(writes.get() + 1);
                Ok(())
            },
        );
        assert!(result.unwrap_err().contains("owner thread"));
        assert_eq!(reads.get(), 0);
        assert_eq!(writes.get(), 0);
    }

    #[test]
    fn pointer_policy_changes_only_the_transparent_bit_and_skips_repeated_applies() {
        use std::cell::Cell;
        let native_style = Cell::new(0x0808_0080_u32);
        let original = native_style.get();
        let writes = Cell::new(0);
        for ignore in [true, true, false, false, true] {
            update_windows_overlay_pointer_policy(
                true,
                ignore,
                0x20,
                || Ok(native_style.get()),
                |desired| {
                    native_style.set(desired);
                    writes.set(writes.get() + 1);
                    Ok(())
                },
            )
            .unwrap();
            assert_eq!(native_style.get() & !0x20, original);
            assert_eq!(native_style.get() & 0x20 != 0, ignore);
        }
        assert_eq!(writes.get(), 3);
    }

    #[test]
    fn failed_native_policy_read_cannot_write_or_report_success() {
        let result = update_windows_overlay_pointer_policy(
            true,
            true,
            0x20,
            || Err("native style unavailable".to_string()),
            |_| panic!("must not write without a verified owned style"),
        );
        assert_eq!(result.unwrap_err(), "native style unavailable");
        let result = update_windows_overlay_pointer_policy(
            true,
            true,
            0x20,
            || Ok(0),
            |_| Err("native style apply failed".to_string()),
        );
        assert_eq!(result.unwrap_err(), "native style apply failed");
    }
}
