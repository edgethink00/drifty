//! Windows-only pointer adapter for the bounded, opt-in pet interaction.
//! Never changes activation, input desktops, pointer clipping, or privileges.
use std::{
    mem::size_of,
    ptr, thread,
    time::{Duration, Instant},
};
use tauri::{PhysicalPosition, WebviewWindow};
use windows_sys::Win32::{
    Foundation::{CloseHandle, HWND, POINT},
    Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONULL},
    Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY},
    System::Threading::{OpenProcess, OpenProcessToken, PROCESS_QUERY_LIMITED_INFORMATION},
    UI::{
        HiDpi::GetDpiForWindow,
        Input::KeyboardAndMouse::{
            GetAsyncKeyState, VK_ESCAPE, VK_LBUTTON, VK_MBUTTON, VK_RBUTTON, VK_XBUTTON1,
            VK_XBUTTON2,
        },
        WindowsAndMessaging::{
            GetForegroundWindow, GetPhysicalCursorPos, GetSystemMetrics, GetWindowThreadProcessId,
            SetPhysicalCursorPos, SM_SWAPBUTTON,
        },
    },
};

pub(super) fn cursor_position() -> Result<PhysicalPosition<f64>, String> {
    let mut point = POINT::default();
    // Physical pixels match the native panel and monitor geometry even when
    // the thread's DPI context differs. Failure never becomes a (0, 0) sample.
    if unsafe { GetPhysicalCursorPos(&mut point) } == 0 {
        return Err(format!(
            "Could not read Windows cursor: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(PhysicalPosition::new(point.x as f64, point.y as f64))
}

/// Match pointer coordinates to the HWND's current physical rendering scale.
/// Tao's cached scale can retain the launch DPI after a live display change.
pub(super) fn window_scale_factor(window: &WebviewWindow) -> Result<f64, String> {
    let hwnd = window.hwnd().map_err(|error| error.to_string())?.0;
    let dpi = unsafe { GetDpiForWindow(hwnd) };
    if dpi == 0 {
        return Err("Pet display DPI is unavailable".into());
    }
    Ok(dpi as f64 / 96.0)
}

pub(super) fn pointer_pressed() -> bool {
    // Only the high bit is current state. The low, since-last-call bit is not
    // reliable across processes. Either physical mouse button cancels, also
    // covering swapped primary buttons. Escape is an additional release path.
    [
        VK_LBUTTON,
        VK_RBUTTON,
        VK_MBUTTON,
        VK_XBUTTON1,
        VK_XBUTTON2,
        VK_ESCAPE,
    ]
    .into_iter()
    .any(|key| unsafe { GetAsyncKeyState(key as i32) } < 0)
}

#[derive(Clone, Copy, Debug)]
pub(super) struct PrimaryPointerState {
    pub held: bool,
    pub cancelled: bool,
}

/// Follow the user's swapped primary button and distinguish its release from
/// Escape cancellation. Both still end the boolean held state.
pub(super) fn primary_pointer_state() -> PrimaryPointerState {
    let escape = unsafe { GetAsyncKeyState(VK_ESCAPE as i32) };
    if escape < 0 {
        return PrimaryPointerState {
            held: false,
            cancelled: true,
        };
    }
    // SAFETY: SM_SWAPBUTTON is a documented read-only system metric.
    let swapped = unsafe { GetSystemMetrics(SM_SWAPBUTTON) } != 0;
    let primary = if swapped { VK_RBUTTON } else { VK_LBUTTON };
    let state = unsafe { GetAsyncKeyState(primary as i32) };
    PrimaryPointerState {
        held: state < 0,
        cancelled: false,
    }
}

// Preserve the boolean helper for callers that only need the held state;
// completed-drag classification also needs the cancellation reason.
#[allow(dead_code)]
pub(super) fn primary_pointer_held() -> bool {
    primary_pointer_state().held
}

fn physical_target(point: (f64, f64)) -> Result<(i32, i32), String> {
    let valid =
        |value: f64| value.is_finite() && value >= i32::MIN as f64 && value <= i32::MAX as f64;
    if !valid(point.0) || !valid(point.1) {
        return Err("Pet cursor target is outside physical coordinate bounds".into());
    }
    Ok((point.0.round() as i32, point.1.round() as i32))
}

// Small immediate readback differences need confirmation, not another write.
// This is a bounded product policy, not an OS timing guarantee. A persistent
// four-pixel clip still fails at the deadline; successful movement keeps the
// one-pixel bound. Windows can expose the previous frame's cursor position for
// one observer tick even after SetPhysicalCursorPos succeeds.
const CURSOR_READBACK_GRACE: Duration = Duration::from_millis(32);
const CURSOR_TRANSIENT_DISTANCE: f64 = 4.0;

fn confirm_cursor_position(
    target: (i32, i32),
    cursor_escape_origin: (f64, f64),
    cursor_escape_distance: f64,
    mut read: impl FnMut() -> Result<PhysicalPosition<f64>, String>,
    mut interrupted: impl FnMut() -> Option<CursorMoveOutcome>,
    mut elapsed: impl FnMut() -> Duration,
    mut pause: impl FnMut(),
) -> Result<CursorMoveOutcome, String> {
    loop {
        if let Some(outcome) = interrupted() {
            return Ok(outcome);
        }
        let actual = read()?;
        let distance = (actual.x - target.0 as f64).hypot(actual.y - target.1 as f64);
        if distance <= 1.0 {
            return Ok(CursorMoveOutcome::Moved);
        }
        // A real yank can land after SetPhysicalCursorPos succeeds but before
        // its immediate readback. Classify only a request-sized displacement
        // as an escaped cursor; small persistent clipping remains an error.
        let escape_distance =
            (actual.x - cursor_escape_origin.0).hypot(actual.y - cursor_escape_origin.1);
        if escape_distance.is_finite() && escape_distance >= cursor_escape_distance {
            return Ok(CursorMoveOutcome::CursorEscaped);
        }
        if !distance.is_finite()
            || distance > CURSOR_TRANSIENT_DISTANCE
            || elapsed() >= CURSOR_READBACK_GRACE
        {
            return Err(format!(
                "Windows cursor movement was clipped or interrupted (target {},{}; observed {},{})",
                target.0, target.1, actual.x, actual.y
            ));
        }
        // Read-only grace: never reassert the target over another input source.
        pause();
    }
}

fn move_cursor(
    point: (f64, f64),
    cursor_escape_origin: (f64, f64),
    cursor_escape_distance: f64,
    interrupted: impl FnMut() -> Option<CursorMoveOutcome>,
) -> Result<CursorMoveOutcome, String> {
    let (x, y) = physical_target(point)?;
    if unsafe { SetPhysicalCursorPos(x, y) } == 0 {
        return Err(format!(
            "Could not move Windows pet cursor: {}",
            std::io::Error::last_os_error()
        ));
    }
    let started = Instant::now();
    confirm_cursor_position(
        (x, y),
        cursor_escape_origin,
        cursor_escape_distance,
        cursor_position,
        interrupted,
        || started.elapsed(),
        || thread::sleep(Duration::from_millis(2)),
    )
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct MonitorStamp {
    monitor: usize,
    bounds: [i32; 8],
    dpi: u32,
}

fn monitor_stamp(window: &WebviewWindow) -> Result<MonitorStamp, String> {
    let hwnd = window.hwnd().map_err(|error| error.to_string())?.0;
    let monitor = unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONULL) };
    let mut info = MONITORINFO {
        cbSize: size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    if monitor.is_null() || unsafe { GetMonitorInfoW(monitor, &mut info) } == 0 {
        return Err("Pet display is no longer available".into());
    }
    let dpi = unsafe { GetDpiForWindow(hwnd) };
    if dpi == 0 {
        return Err("Pet display DPI is unavailable".into());
    }
    Ok(MonitorStamp {
        monitor: monitor as usize,
        bounds: [
            info.rcMonitor.left,
            info.rcMonitor.top,
            info.rcMonitor.right,
            info.rcMonitor.bottom,
            info.rcWork.left,
            info.rcWork.top,
            info.rcWork.right,
            info.rcWork.bottom,
        ],
        dpi,
    })
}

fn foreground_is_not_elevated(hwnd: HWND) -> bool {
    let mut pid = 0;
    if unsafe { GetWindowThreadProcessId(hwnd, &mut pid) } == 0 || pid == 0 {
        return false;
    }
    // Query only elevation, never credentials or token privileges. Unknown or
    // elevated foreground processes are outside this optional interaction.
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if process.is_null() {
            return false;
        }
        let mut token = ptr::null_mut();
        let opened = OpenProcessToken(process, TOKEN_QUERY, &mut token);
        CloseHandle(process);
        if opened == 0 {
            return false;
        }
        let mut elevation = TOKEN_ELEVATION::default();
        let mut returned = 0;
        let ok = GetTokenInformation(
            token,
            TokenElevation,
            (&mut elevation as *mut TOKEN_ELEVATION).cast(),
            size_of::<TOKEN_ELEVATION>() as u32,
            &mut returned,
        );
        CloseHandle(token);
        ok != 0 && returned == size_of::<TOKEN_ELEVATION>() as u32 && elevation.TokenIsElevated == 0
    }
}

pub(super) struct InteractionContext {
    foreground: usize,
    monitor: MonitorStamp,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum CursorMoveOutcome {
    Moved,
    Cancelled,
    PointerPressed,
    CursorEscaped,
}

fn movement_interruption(current: bool, pressed: bool) -> Option<CursorMoveOutcome> {
    if !current {
        Some(CursorMoveOutcome::Cancelled)
    } else if pressed {
        Some(CursorMoveOutcome::PointerPressed)
    } else {
        None
    }
}

impl InteractionContext {
    pub(super) fn move_cursor(
        &self,
        window: &WebviewWindow,
        point: (f64, f64),
        cursor_escape_origin: (f64, f64),
        cursor_escape_distance: f64,
    ) -> Result<CursorMoveOutcome, String> {
        // Recheck immediately before the shared cursor mutation, not only at
        // the beginning of a frame that also moves/emits events to the panel.
        if let Some(outcome) = movement_interruption(self.is_current(window), pointer_pressed()) {
            return Ok(outcome);
        }
        move_cursor(point, cursor_escape_origin, cursor_escape_distance, || {
            movement_interruption(self.is_current(window), pointer_pressed())
        })
    }

    pub(super) fn capture(window: &WebviewWindow) -> Result<Self, String> {
        let foreground = unsafe { GetForegroundWindow() };
        if foreground.is_null() || !foreground_is_not_elevated(foreground) {
            return Err("Pet cursor interaction requires a non-elevated foreground window".into());
        }
        cursor_position()?;
        Ok(Self {
            foreground: foreground as usize,
            monitor: monitor_stamp(window)?,
        })
    }

    pub(super) fn is_current(&self, window: &WebviewWindow) -> bool {
        let foreground = unsafe { GetForegroundWindow() } as usize;
        foreground != 0
            && foreground == self.foreground
            && monitor_stamp(window).is_ok_and(|stamp| stamp == self.monitor)
            && cursor_position().is_ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounded_readback_lag_is_confirmed_without_writing_again() {
        let mut reads = [
            PhysicalPosition::new(104.0, 50.0),
            PhysicalPosition::new(100.0, 50.0),
        ]
        .into_iter();
        let mut pauses = 0;
        let outcome = confirm_cursor_position(
            (100, 50),
            (100.0, 50.0),
            34.0,
            || Ok(reads.next().unwrap()),
            || None,
            || Duration::from_millis(16),
            || pauses += 1,
        )
        .unwrap();
        assert_eq!(outcome, CursorMoveOutcome::Moved);
        assert_eq!(pauses, 1);
        assert!(reads.next().is_none());
    }

    #[test]
    fn persistent_four_pixel_clip_still_fails_at_the_deadline() {
        let mut times = [Duration::ZERO, CURSOR_READBACK_GRACE].into_iter();
        let mut pauses = 0;
        let result = confirm_cursor_position(
            (100, 50),
            (100.0, 50.0),
            34.0,
            || Ok(PhysicalPosition::new(104.0, 50.0)),
            || None,
            || times.next().unwrap(),
            || pauses += 1,
        );
        assert!(result
            .unwrap_err()
            .contains("target 100,50; observed 104,50"));
        assert_eq!(pauses, 1);
    }

    #[test]
    fn larger_or_invalid_readback_never_enters_the_grace_period() {
        for actual in [
            PhysicalPosition::new(105.0, 50.0),
            PhysicalPosition::new(104.0, 53.0),
            PhysicalPosition::new(f64::NAN, 50.0),
        ] {
            assert!(confirm_cursor_position(
                (100, 50),
                (100.0, 50.0),
                34.0,
                || Ok(actual),
                || None,
                || Duration::ZERO,
                || panic!("Large deviation must not wait"),
            )
            .is_err());
        }
    }

    #[test]
    fn input_during_readback_grace_stops_before_another_read() {
        for stop in [
            CursorMoveOutcome::Cancelled,
            CursorMoveOutcome::PointerPressed,
        ] {
            let mut checks = [None, Some(stop)].into_iter();
            let mut reads = 0;
            assert_eq!(
                confirm_cursor_position(
                    (100, 50),
                    (100.0, 50.0),
                    34.0,
                    || {
                        reads += 1;
                        Ok(PhysicalPosition::new(102.0, 50.0))
                    },
                    || checks.next().unwrap(),
                    || Duration::ZERO,
                    || {},
                )
                .unwrap(),
                stop
            );
            assert_eq!(reads, 1);
        }
    }

    #[test]
    fn readback_failure_is_not_an_accepted_move() {
        assert_eq!(
            confirm_cursor_position(
                (100, 50),
                (100.0, 50.0),
                34.0,
                || Err("read unavailable".into()),
                || None,
                || Duration::ZERO,
                || panic!("Read failure must not wait"),
            )
            .unwrap_err(),
            "read unavailable"
        );
    }

    #[test]
    fn input_state_maps_to_typed_stop_outcomes() {
        assert_eq!(
            movement_interruption(false, false),
            Some(CursorMoveOutcome::Cancelled)
        );
        assert_eq!(
            movement_interruption(false, true),
            Some(CursorMoveOutcome::Cancelled)
        );
        assert_eq!(
            movement_interruption(true, true),
            Some(CursorMoveOutcome::PointerPressed)
        );
        assert_eq!(movement_interruption(true, false), None);
    }

    #[test]
    fn request_sized_readback_displacement_is_a_typed_cursor_escape() {
        assert_eq!(
            confirm_cursor_position(
                (100, 50),
                (100.0, 50.0),
                34.0,
                || Ok(PhysicalPosition::new(134.0, 50.0)),
                || None,
                || Duration::ZERO,
                || panic!("A cursor escape must not enter the grace period"),
            )
            .unwrap(),
            CursorMoveOutcome::CursorEscaped
        );
    }

    #[test]
    fn physical_targets_preserve_negative_display_origins_and_round_once() {
        assert_eq!(physical_target((-1919.6, 1079.6)).unwrap(), (-1920, 1080));
        assert_eq!(physical_target((0.0, 0.0)).unwrap(), (0, 0));
    }

    #[test]
    fn physical_targets_reject_non_finite_and_overflowing_coordinates() {
        for point in [
            (f64::NAN, 0.0),
            (0.0, f64::INFINITY),
            (i32::MAX as f64 + 1.0, 0.0),
            (0.0, i32::MIN as f64 - 1.0),
        ] {
            assert!(physical_target(point).is_err());
        }
    }
}
