//! Drag-to-grant guide beside System Settings (macOS).
//!
//! Packaged Mac builds carry `permission-guide/drifty-permission-guide`, a
//! small helper built from the vendored PermissionFlow package in
//! `src-tauri/native/permission-guide`. When Drifty asks for Accessibility
//! and does not have it yet, the helper opens the privacy pane and shows a
//! floating panel next to the System Settings window with Drifty's app icon,
//! which the person drags into the list. Without the helper (development
//! builds, Windows) or outside an installed app bundle, callers keep their
//! plain System Settings path.
//!
//! Accessibility and Screen Recording use it. On clean macOS 14 and 26 guests
//! (2026-10-29), Drifty's own trust check had already listed it under
//! Accessibility switched off, and dropping Drifty onto the list asked for an
//! administrator and switched that row on. Screen Recording followed on
//! 2026-11-02: on a macOS 27 Mac, Drifty's screen-capture request did not add
//! it to that list at all, so the person had nothing to switch on without the
//! panel. Full Disk Access opens plainly until a drop is checked on its page.
//!
//! The helper exits by itself when its panel closes or System Settings quits.
//! Drifty additionally stops it when the permission is granted, when the
//! person comes back to Drifty's window, when a newer guide starts, or after
//! [`GUIDE_LIFETIME`]. Its stdin is a pipe held here, so it also ends when
//! Drifty exits.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use std::path::{Path, PathBuf};
use std::process::Child;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};

/// Bundle-relative location of the helper, written by
/// `scripts/build-screen-context-release.mjs`.
pub(crate) const HELPER_RESOURCE: &str = "permission-guide/drifty-permission-guide";
/// A guide nobody finished must not stay on screen indefinitely.
const GUIDE_LIFETIME: Duration = Duration::from_secs(15 * 60);
const WATCH_INTERVAL: Duration = Duration::from_millis(500);
/// Drifty is still frontmost for a moment after the click that opened the
/// guide; only a return after System Settings took over counts.
const RETURN_GRACE: Duration = Duration::from_millis(1500);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum GuidePane {
    Accessibility,
    ScreenRecording,
}

impl GuidePane {
    pub(crate) fn helper_argument(self) -> &'static str {
        match self {
            Self::Accessibility => "accessibility",
            Self::ScreenRecording => "screenRecording",
        }
    }
}

struct GuideRun {
    child: Child,
    generation: u64,
}

#[derive(Default)]
pub struct PermissionGuideState {
    current: Mutex<Option<GuideRun>>,
    generation: Mutex<u64>,
}

/// The installed `.app` that holds this executable, if Drifty runs from one
/// that can be dragged into a privacy list. A Gatekeeper-translocated copy
/// lives at a random read-only path, and a development binary has no bundle.
pub(crate) fn draggable_app_bundle(executable: &Path) -> Option<PathBuf> {
    let macos_dir = executable.parent()?;
    let contents_dir = macos_dir.parent()?;
    let bundle = contents_dir.parent()?;
    let is_bundle = macos_dir.file_name()? == "MacOS"
        && contents_dir.file_name()? == "Contents"
        && bundle
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("app"));
    if !is_bundle || bundle.to_string_lossy().contains("/AppTranslocation/") {
        return None;
    }
    Some(bundle.to_path_buf())
}

pub(crate) fn helper_arguments(pane: GuidePane, app_bundle: &Path, language: &str) -> Vec<String> {
    vec![
        "--pane".to_string(),
        pane.helper_argument().to_string(),
        "--app".to_string(),
        app_bundle.to_string_lossy().into_owned(),
        "--locale".to_string(),
        language.to_string(),
    ]
}

/// The bundled helper and the installed app bundle to drag, when this install
/// has both.
fn launch_inputs(app: &AppHandle) -> Option<(PathBuf, PathBuf)> {
    let helper = app
        .path()
        .resolve(HELPER_RESOURCE, tauri::path::BaseDirectory::Resource)
        .ok()
        .filter(|path| path.is_file())?;
    let bundle = std::env::current_exe()
        .ok()
        .and_then(|executable| draggable_app_bundle(&executable))?;
    Some((helper, bundle))
}

/// Shows the guide for `pane` and returns true, or returns false when this
/// install cannot show it so the caller opens System Settings itself.
/// `granted` lets the guide close and bring Drifty back once the permission
/// is on.
#[cfg(target_os = "macos")]
pub(crate) fn open(app: &AppHandle, pane: GuidePane, granted: Option<fn() -> bool>) -> bool {
    use std::process::{Command, Stdio};

    // Already allowed: the caller opens System Settings for whatever else the
    // person wants to change there.
    if granted.is_some_and(|granted| granted()) {
        return false;
    }
    let Some((helper, bundle)) = launch_inputs(app) else {
        return false;
    };
    let Some(state) = app.try_state::<PermissionGuideState>() else {
        return false;
    };
    let language = crate::tray::latest_tray_language(app).tag();
    stop_current(app);
    let generation = {
        let Ok(mut generation) = state.generation.lock() else {
            return false;
        };
        *generation += 1;
        *generation
    };
    let Ok(mut current) = state.current.lock() else {
        return false;
    };
    let child = match Command::new(&helper)
        .args(helper_arguments(pane, &bundle, language))
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(child) => child,
        Err(error) => {
            eprintln!("could not start the permission guide: {error}");
            return false;
        }
    };
    *current = Some(GuideRun { child, generation });
    drop(current);
    let watched = app.clone();
    std::thread::spawn(move || watch(watched, generation, granted));
    true
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn open(_app: &AppHandle, _pane: GuidePane, _granted: Option<fn() -> bool>) -> bool {
    false
}

/// Stops the guide on screen, if any.
pub(crate) fn stop_current(app: &AppHandle) {
    let Some(state) = app.try_state::<PermissionGuideState>() else {
        return;
    };
    let run = state
        .current
        .lock()
        .ok()
        .and_then(|mut current| current.take());
    if let Some(mut run) = run {
        end_child(&mut run.child);
    }
}

fn end_child(child: &mut Child) {
    // Closing stdin asks the helper to finish; a helper that does not answer
    // within a second is killed.
    drop(child.stdin.take());
    for _ in 0..10 {
        if matches!(child.try_wait(), Ok(Some(_))) {
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    let _ = child.kill();
    let _ = child.wait();
}

enum WatchOutcome {
    Continue,
    Finished,
    Close { reveal_drifty: bool },
}

fn watch(app: AppHandle, generation: u64, granted: Option<fn() -> bool>) {
    let started = Instant::now();
    let mut left_drifty = false;
    loop {
        std::thread::sleep(WATCH_INTERVAL);
        let Some(state) = app.try_state::<PermissionGuideState>() else {
            return;
        };
        let outcome = {
            let Ok(mut current) = state.current.lock() else {
                return;
            };
            match current.as_mut() {
                Some(run) if run.generation == generation => match run.child.try_wait() {
                    Ok(None) => WatchOutcome::Continue,
                    _ => {
                        current.take();
                        WatchOutcome::Finished
                    }
                },
                // Stopped, or replaced by a newer guide that has its own watch.
                _ => WatchOutcome::Finished,
            }
        };
        if matches!(outcome, WatchOutcome::Finished) {
            return;
        }
        let main_focused = app
            .get_webview_window(crate::MAIN_WINDOW_LABEL)
            .and_then(|window| window.is_focused().ok())
            .unwrap_or(false);
        if !main_focused {
            left_drifty = true;
        }
        let outcome = if granted.is_some_and(|granted| granted()) {
            WatchOutcome::Close {
                reveal_drifty: true,
            }
        } else if left_drifty && main_focused && started.elapsed() > RETURN_GRACE {
            WatchOutcome::Close {
                reveal_drifty: false,
            }
        } else if started.elapsed() > GUIDE_LIFETIME {
            WatchOutcome::Close {
                reveal_drifty: false,
            }
        } else {
            WatchOutcome::Continue
        };
        if let WatchOutcome::Close { reveal_drifty } = outcome {
            let run = state.current.lock().ok().and_then(|mut current| {
                if current
                    .as_ref()
                    .is_some_and(|run| run.generation == generation)
                {
                    current.take()
                } else {
                    None
                }
            });
            if let Some(mut run) = run {
                end_child(&mut run.child);
                if reveal_drifty {
                    let main_thread_app = app.clone();
                    let _ =
                        app.run_on_main_thread(move || crate::reveal_main_window(&main_thread_app));
                }
            }
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_installed_app_bundle_can_be_dragged() {
        assert_eq!(
            draggable_app_bundle(Path::new("/Applications/drifty.app/Contents/MacOS/drifty")),
            Some(PathBuf::from("/Applications/drifty.app"))
        );
        assert_eq!(
            draggable_app_bundle(Path::new(
                "/Users/me/Applications/Drifty.APP/Contents/MacOS/drifty"
            )),
            Some(PathBuf::from("/Users/me/Applications/Drifty.APP"))
        );
    }

    #[test]
    fn translocated_copies_and_development_binaries_fall_back() {
        assert_eq!(
            draggable_app_bundle(Path::new(
                "/private/var/folders/ab/T/AppTranslocation/1E2/d/drifty.app/Contents/MacOS/drifty"
            )),
            None
        );
        assert_eq!(
            draggable_app_bundle(Path::new("/repo/src-tauri/target/debug/drifty")),
            None
        );
        assert_eq!(
            draggable_app_bundle(Path::new("/tmp/drifty.app/Contents/Resources/drifty")),
            None
        );
    }

    #[test]
    fn helper_receives_the_pane_bundle_and_display_language() {
        assert_eq!(
            helper_arguments(
                GuidePane::Accessibility,
                Path::new("/Applications/drifty.app"),
                "pt-BR"
            ),
            vec![
                "--pane",
                "accessibility",
                "--app",
                "/Applications/drifty.app",
                "--locale",
                "pt-BR"
            ]
        );
        assert_eq!(
            helper_arguments(
                GuidePane::ScreenRecording,
                Path::new("/Applications/drifty.app"),
                "ko"
            )[..2],
            ["--pane", "screenRecording"]
        );
    }
}
