use std::sync::Mutex;

use tauri::{AppHandle, Manager, State};

use crate::{tracking_pause, tray};

#[cfg(target_os = "macos")]
use objc2::{rc::autoreleasepool, MainThreadMarker, MainThreadOnly};
#[cfg(target_os = "macos")]
use objc2_app_kit::{
    NSAlert, NSAlertFirstButtonReturn, NSAlertSecondButtonReturn, NSAlertStyle,
    NSAlertThirdButtonReturn, NSApplication, NSApplicationActivationPolicy, NSView,
};
#[cfg(target_os = "macos")]
use objc2_foundation::{NSPoint, NSRect, NSSize, NSString};

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
enum QuitConfirmationLanguage {
    #[default]
    English,
    Korean,
    Spanish,
}

impl QuitConfirmationLanguage {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "en" => Ok(Self::English),
            "ko" => Ok(Self::Korean),
            "es" => Ok(Self::Spanish),
            _ => Err(format!("Unsupported quit confirmation language: {value}")),
        }
    }

    fn copy(self) -> QuitConfirmationCopy {
        match self {
            Self::English => QuitConfirmationCopy {
                title: "Quit Drifty and stop tracking?",
                body: "Drifty automatically stops recording while your Mac sleeps. If you quit, no new activity is recorded until you open Drifty again.",
                keep_tracking: "Keep Tracking",
                pause_instead: "Pause Instead",
                quit_drifty: "Quit Drifty",
                pause_failed_title: "Tracking could not be paused",
                pause_failed_body: "Drifty could not confirm the pause, so tracking may still be active. Try pausing again from the menu, or quit Drifty to stop recording.",
                dismiss: "OK",
            },
            Self::Korean => QuitConfirmationCopy {
                title: "Drifty를 종료하고 활동 기록을 멈출까요?",
                body: "Mac이 잠들면 Drifty는 자동으로 기록을 멈춥니다. Drifty를 종료하면 다시 열 때까지 새 활동이 기록되지 않습니다.",
                keep_tracking: "계속 기록",
                pause_instead: "대신 일시 정지",
                quit_drifty: "Drifty 종료",
                pause_failed_title: "활동 기록을 일시 정지하지 못했습니다",
                pause_failed_body: "일시 정지를 확인하지 못해 활동 기록이 계속되고 있을 수 있습니다. 메뉴에서 다시 일시 정지하거나, 기록을 멈추려면 Drifty를 종료해 주세요.",
                dismiss: "확인",
            },
            Self::Spanish => QuitConfirmationCopy {
                title: "¿Salir de Drifty y dejar de registrar la actividad?",
                body: "Drifty deja de registrar la actividad cuando el Mac entra en reposo. Si sales, no se registrará nueva actividad hasta que vuelvas a abrir Drifty.",
                keep_tracking: "Seguir registrando",
                pause_instead: "Pausar en su lugar",
                quit_drifty: "Salir de Drifty",
                pause_failed_title: "No se pudo pausar el registro",
                pause_failed_body: "No se pudo confirmar la pausa. Es posible que la actividad siga registrándose. Intenta pausarla de nuevo desde el menú o sal de Drifty para detener el registro.",
                dismiss: "Aceptar",
            },
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct QuitConfirmationCopy {
    title: &'static str,
    body: &'static str,
    keep_tracking: &'static str,
    pause_instead: &'static str,
    quit_drifty: &'static str,
    pause_failed_title: &'static str,
    pause_failed_body: &'static str,
    dismiss: &'static str,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum QuitDecision {
    KeepTracking,
    PauseInstead,
    Quit,
}

#[derive(Debug, Default)]
struct QuitConfirmationLifecycle {
    language: QuitConfirmationLanguage,
    prompt_open: bool,
}

#[derive(Debug, Default)]
pub(crate) struct QuitConfirmationState {
    lifecycle: Mutex<QuitConfirmationLifecycle>,
}

impl QuitConfirmationState {
    fn set_language(&self, language: QuitConfirmationLanguage) {
        let mut lifecycle = self
            .lifecycle
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        lifecycle.language = language;
    }

    fn begin_prompt(&self) -> Option<QuitConfirmationLanguage> {
        let mut lifecycle = self
            .lifecycle
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if lifecycle.prompt_open {
            return None;
        }
        lifecycle.prompt_open = true;
        Some(lifecycle.language)
    }

    fn finish_prompt(&self) {
        let mut lifecycle = self
            .lifecycle
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        lifecycle.prompt_open = false;
    }
}

#[tauri::command]
pub(crate) fn quit_confirmation_set_language(
    state: State<'_, QuitConfirmationState>,
    language: String,
) -> Result<(), String> {
    state.set_language(QuitConfirmationLanguage::parse(&language)?);
    Ok(())
}

fn should_confirm_quit(tracking_is_paused: bool, tracker_running: Option<bool>) -> bool {
    !tracking_is_paused && tracker_running == Some(true)
}

pub(crate) fn request_quit(app: &AppHandle) {
    #[cfg(not(target_os = "macos"))]
    {
        app.exit(0);
    }

    #[cfg(target_os = "macos")]
    {
        let tracking_is_paused = tracking_pause::snapshot(app).is_active();
        let tracker_running = if tracking_is_paused {
            Some(false)
        } else {
            tray::cached_tracker_running(app)
        };

        if !should_confirm_quit(tracking_is_paused, tracker_running) {
            app.exit(0);
            return;
        }

        let state = app.state::<QuitConfirmationState>();
        let Some(language) = state.begin_prompt() else {
            return;
        };
        let decision = show_native_quit_confirmation(language);

        match decision {
            Ok(QuitDecision::KeepTracking) => state.finish_prompt(),
            Ok(QuitDecision::PauseInstead) => pause_instead(app, language),
            Ok(QuitDecision::Quit) => {
                state.finish_prompt();
                app.exit(0);
            }
            Err(error) => {
                state.finish_prompt();
                eprintln!("[quit-confirmation] Unable to show native prompt: {error}");
                app.exit(0);
            }
        }
    }
}

#[cfg(target_os = "macos")]
fn pause_instead(app: &AppHandle, language: QuitConfirmationLanguage) {
    let worker_app = app.clone();
    let _ = tauri::async_runtime::spawn_blocking(move || {
        let result = tray::pause_tracking_forever_blocking(&worker_app);
        let Err(error) = result else {
            worker_app.state::<QuitConfirmationState>().finish_prompt();
            return;
        };
        eprintln!("[quit-confirmation] Pause Instead failed: {error}");

        let alert_app = worker_app.clone();
        if let Err(schedule_error) = worker_app.run_on_main_thread(move || {
            if let Err(alert_error) = show_native_pause_failure(language) {
                eprintln!("[quit-confirmation] Unable to show pause failure prompt: {alert_error}");
            }
            alert_app.state::<QuitConfirmationState>().finish_prompt();
        }) {
            worker_app.state::<QuitConfirmationState>().finish_prompt();
            eprintln!(
                "[quit-confirmation] Unable to schedule pause failure prompt: {schedule_error}"
            );
        }
    });
}

#[cfg(target_os = "macos")]
fn show_native_quit_confirmation(
    language: QuitConfirmationLanguage,
) -> Result<QuitDecision, String> {
    autoreleasepool(|_| {
        let Some(mtm) = MainThreadMarker::new() else {
            return Err("Quit confirmation must run on the macOS main thread.".to_string());
        };
        let copy = language.copy();
        let alert = NSAlert::init(NSAlert::alloc(mtm));
        alert.setAlertStyle(NSAlertStyle::Informational);
        alert.setMessageText(&NSString::from_str(copy.title));
        alert.setInformativeText(&NSString::from_str(copy.body));

        // NSAlert otherwise chooses a very narrow layout for three short
        // buttons, forcing the explanatory copy and actions into a tall stack.
        // A transparent accessory view gives the system layout a readable
        // minimum width while preserving native spacing, typography, and input.
        let layout_spacer = NSView::initWithFrame(
            NSView::alloc(mtm),
            NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(400.0, 1.0)),
        );
        alert.setAccessoryView(Some(&layout_spacer));

        let keep_tracking = alert.addButtonWithTitle(&NSString::from_str(copy.keep_tracking));
        alert.addButtonWithTitle(&NSString::from_str(copy.pause_instead));
        alert.addButtonWithTitle(&NSString::from_str(copy.quit_drifty));
        alert.layout();
        // Set Escape after native layout so the safe action keeps its intended
        // leading position instead of being visually reordered as a cancel row.
        keep_tracking.setKeyEquivalent(&NSString::from_str("\u{1b}"));

        let application = NSApplication::sharedApplication(mtm);
        let alert_window = alert.window();
        alert_window.center();
        if application.activationPolicy() != NSApplicationActivationPolicy::Prohibited {
            crate::macos_activation::activate_application(&application);
            alert_window.makeKeyAndOrderFront(None);
        } else {
            alert_window.orderFrontRegardless();
        }

        decision_from_modal_response(alert.runModal())
            .ok_or_else(|| "Quit confirmation returned an unknown modal response.".to_string())
    })
}

#[cfg(target_os = "macos")]
fn show_native_pause_failure(language: QuitConfirmationLanguage) -> Result<(), String> {
    autoreleasepool(|_| {
        let Some(mtm) = MainThreadMarker::new() else {
            return Err("Pause failure prompt must run on the macOS main thread.".to_string());
        };
        let copy = language.copy();
        let alert = NSAlert::init(NSAlert::alloc(mtm));
        alert.setAlertStyle(NSAlertStyle::Critical);
        alert.setMessageText(&NSString::from_str(copy.pause_failed_title));
        alert.setInformativeText(&NSString::from_str(copy.pause_failed_body));
        alert.addButtonWithTitle(&NSString::from_str(copy.dismiss));

        let application = NSApplication::sharedApplication(mtm);
        let alert_window = alert.window();
        alert_window.center();
        if application.activationPolicy() != NSApplicationActivationPolicy::Prohibited {
            crate::macos_activation::activate_application(&application);
            alert_window.makeKeyAndOrderFront(None);
        } else {
            alert_window.orderFrontRegardless();
        }
        alert.runModal();
        Ok(())
    })
}

#[cfg(target_os = "macos")]
fn decision_from_modal_response(response: isize) -> Option<QuitDecision> {
    if response == NSAlertFirstButtonReturn {
        Some(QuitDecision::KeepTracking)
    } else if response == NSAlertSecondButtonReturn {
        Some(QuitDecision::PauseInstead)
    } else if response == NSAlertThirdButtonReturn {
        Some(QuitDecision::Quit)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn confirmation_is_reserved_for_active_tracking() {
        assert!(should_confirm_quit(false, Some(true)));
        assert!(!should_confirm_quit(true, Some(true)));
        assert!(!should_confirm_quit(false, Some(false)));
        assert!(!should_confirm_quit(false, None));
    }

    #[test]
    fn prompt_state_prevents_duplicates_and_recovers_after_dismissal() {
        let state = QuitConfirmationState::default();

        assert_eq!(
            state.begin_prompt(),
            Some(QuitConfirmationLanguage::English)
        );
        assert_eq!(state.begin_prompt(), None);
        state.finish_prompt();
        assert_eq!(
            state.begin_prompt(),
            Some(QuitConfirmationLanguage::English)
        );
    }

    #[test]
    fn language_parser_and_copy_cover_supported_locales() {
        assert_eq!(
            QuitConfirmationLanguage::parse("en")
                .expect("English should parse")
                .copy()
                .keep_tracking,
            "Keep Tracking"
        );
        assert_eq!(
            QuitConfirmationLanguage::parse("ko")
                .expect("Korean should parse")
                .copy()
                .pause_instead,
            "대신 일시 정지"
        );
        assert_eq!(
            QuitConfirmationLanguage::parse("es")
                .expect("Spanish should parse")
                .copy()
                .pause_instead,
            "Pausar en su lugar"
        );
        assert_eq!(
            QuitConfirmationLanguage::English.copy().pause_failed_title,
            "Tracking could not be paused"
        );
        assert_eq!(QuitConfirmationLanguage::Korean.copy().dismiss, "확인");
        assert!(QuitConfirmationLanguage::parse("ja").is_err());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn native_button_order_maps_to_safe_pause_and_quit_actions() {
        assert_eq!(
            decision_from_modal_response(NSAlertFirstButtonReturn),
            Some(QuitDecision::KeepTracking)
        );
        assert_eq!(
            decision_from_modal_response(NSAlertSecondButtonReturn),
            Some(QuitDecision::PauseInstead)
        );
        assert_eq!(
            decision_from_modal_response(NSAlertThirdButtonReturn),
            Some(QuitDecision::Quit)
        );
    }
}
