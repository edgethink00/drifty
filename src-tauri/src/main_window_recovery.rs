use std::sync::Mutex;

#[derive(Default)]
struct RecoveryActivity {
    startup_complete: bool,
    open_requested_during_startup: bool,
    recovery_open: bool,
}

#[derive(Default)]
pub(crate) struct MainWindowRecoveryState {
    activity: Mutex<RecoveryActivity>,
}

impl MainWindowRecoveryState {
    fn begin_recovery(&self) -> bool {
        let mut activity = self.activity.lock().expect("main-window recovery state");
        if !activity.startup_complete {
            // A single-instance/auth open may arrive while WebView2 pumps the
            // startup message loop. Wait until pause/tray/tracker setup is done.
            activity.open_requested_during_startup = true;
            return false;
        }
        if activity.recovery_open {
            return false;
        }
        activity.recovery_open = true;
        true
    }

    fn finish_recovery(&self) {
        self.activity
            .lock()
            .expect("main-window recovery state")
            .recovery_open = false;
    }

    pub(crate) fn on_ready(&self) -> bool {
        let mut activity = self.activity.lock().expect("main-window recovery state");
        activity.startup_complete = true;
        std::mem::take(&mut activity.open_requested_during_startup)
    }
}

#[cfg(target_os = "windows")]
fn create_main_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::Manager;

    if crate::main_window_is_available(app) {
        return Ok(());
    }
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|config| config.label == crate::MAIN_WINDOW_LABEL)
        .ok_or(tauri::Error::WindowNotFound)?;
    // Tauri 2.12 returns a native creation error before attaching the label.
    // Preserve the configured URL, data directory, sizing and window flags.
    // WebView2 pumps startup messages while building the window, so the
    // renderer can already submit its appearance preference. Initialize the
    // opaque shell first and preserve any request handled during creation.
    crate::configure_main_window_material(app);
    tauri::WebviewWindowBuilder::from_config(app, config)?.build()?;
    if let Err(error) = crate::calibrate_main_window_to_work_area(app) {
        eprintln!("could not calibrate initial main-window size: {error}");
    }
    Ok(())
}

#[cfg(target_os = "windows")]
pub(crate) fn create_initial_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    // Unlike Tauri's default configured-window setup, a UI failure must not
    // return from app setup before the tray and activated tracker can start.
    let started = std::time::Instant::now();
    eprintln!("[windows-startup] preparing main");
    let result = create_main_window(app);
    eprintln!(
        "[windows-startup] prepared main: success={}, elapsed_ms={}",
        result.is_ok(),
        started.elapsed().as_millis()
    );
    if let Err(error) = &result {
        let report = format!("Main window setup failed: {error}");
        eprintln!("[startup] {report}");
        sentry::capture_message(&report, sentry::Level::Error);
    }
    result
}

/// Tauri 2.12 caches runtime availability when it creates the event loop.
/// Further WebViews cannot succeed after this particular creation failure and
/// each release-mode attempt would show another native installation dialog.
/// Other main-window errors must still permit independent auxiliary setup.
#[cfg(any(test, target_os = "windows"))]
pub(crate) fn auxiliary_setup_is_available(initial: &tauri::Result<()>) -> bool {
    match initial {
        Err(tauri::Error::Runtime(error)) => !missing_runtime_message(&error.to_string()),
        _ => true,
    }
}

#[cfg(any(test, target_os = "windows"))]
fn missing_runtime_message(message: &str) -> bool {
    // Exact Display value of tauri-runtime 2.12's WebviewRuntimeNotInstalled.
    // Avoid grouping native-handle, access, or other WebView creation errors
    // into a missing-runtime diagnosis.
    message == "Could not find the webview runtime, make sure it is installed"
}

#[cfg(target_os = "windows")]
pub(crate) fn recover_on_open(app: &tauri::AppHandle) {
    use tauri::Manager;

    let state = app.state::<MainWindowRecoveryState>();
    if !state.begin_recovery() {
        return;
    }
    let korean = crate::tray::latest_tray_language(app).is_korean();
    let app = app.clone();
    // One creation attempt per explicit open, shared by concurrent requests.
    // Creating WebView2 from a synchronous Windows event can deadlock. Keep
    // creation and the fallback dialog off the Tauri event-loop thread.
    let _ = tauri::async_runtime::spawn_blocking(move || {
        match create_main_window(&app) {
            Ok(()) => crate::reveal_main_window(&app),
            Err(error) => {
                eprintln!("[main-window] Recovery attempt failed: {error}");
                show_native_guidance(korean);
            }
        }
        app.state::<MainWindowRecoveryState>().finish_recovery();
    });
}

#[cfg(target_os = "windows")]
fn show_native_guidance(korean: bool) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        MessageBoxW, MB_ICONWARNING, MB_OK, MB_SETFOREGROUND,
    };

    let message = if korean {
        "Drifty 화면을 열지 못했습니다.\n\n활동 기록은 계속 실행 중일 수 있습니다. Windows 알림 영역의 Drifty 메뉴에서 'Drifty 종료'를 선택한 다음 Drifty를 다시 열어 주세요.\n\nDrifty가 종료되어 있는 동안에는 활동 기록이 멈춥니다."
    } else {
        "Drifty couldn't open its window.\n\nActivity tracking may still be running. To try again, choose 'Quit' from the Drifty tray menu, then open Drifty again.\n\nTracking stops while Drifty is closed."
    };
    let message: Vec<u16> = message.encode_utf16().chain(Some(0)).collect();
    let title: Vec<u16> = "Drifty".encode_utf16().chain(Some(0)).collect();
    // SAFETY: Both buffers are NUL-terminated and live for the entire call.
    // There is no usable main HWND to own the dialog after this failure.
    let result = unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            message.as_ptr(),
            title.as_ptr(),
            MB_OK | MB_ICONWARNING | MB_SETFOREGROUND,
        )
    };
    if result == 0 {
        eprintln!(
            "[main-window] Could not show recovery guidance: {}",
            std::io::Error::last_os_error()
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_known_runtime_error_blocks_auxiliary_setup() {
        assert!(missing_runtime_message(
            "Could not find the webview runtime, make sure it is installed"
        ));
        for message in [
            "the underlying handle is not available",
            "failed to create webview: WebView2 error: 0x8007139F",
            "access is denied",
            "Could not find the webview runtime",
        ] {
            assert!(!missing_runtime_message(message), "{message}");
        }
        assert!(auxiliary_setup_is_available(&Ok(())));
        assert!(auxiliary_setup_is_available(&Err(
            tauri::Error::InvalidWindowHandle
        )));
        // A message from an unrelated error family is not runtime evidence.
        assert!(auxiliary_setup_is_available(&Err(tauri::Error::Io(
            std::io::Error::other("Could not find the webview runtime, make sure it is installed")
        ))));
    }

    #[test]
    fn concurrent_open_requests_share_one_recovery_and_can_retry_after_completion() {
        let state = MainWindowRecoveryState::default();
        assert!(!state.on_ready());
        let barrier = std::sync::Barrier::new(8);
        let opened = std::sync::atomic::AtomicUsize::new(0);
        std::thread::scope(|scope| {
            for _ in 0..8 {
                scope.spawn(|| {
                    barrier.wait();
                    if state.begin_recovery() {
                        opened.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    }
                });
            }
        });
        assert_eq!(opened.load(std::sync::atomic::Ordering::Relaxed), 1);
        assert!(!state.begin_recovery());
        state.finish_recovery();
        assert!(state.begin_recovery());
    }

    #[test]
    fn early_foreground_open_waits_for_setup_and_is_consumed_once() {
        let state = MainWindowRecoveryState::default();
        assert!(!state.begin_recovery());
        assert!(!state.begin_recovery());
        assert!(state.on_ready());
        assert!(!state.on_ready());
        assert!(state.begin_recovery());
    }

    #[test]
    fn quiet_startup_does_not_schedule_a_recovery() {
        let state = MainWindowRecoveryState::default();
        assert!(!state.on_ready());
        assert!(state.begin_recovery());
    }
}
