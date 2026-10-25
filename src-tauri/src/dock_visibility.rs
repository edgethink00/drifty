//! Whether Drifty shows in the Dock, chosen in Settings > Appearance on macOS.
//!
//! Drifty keeps running in the menu bar after its window closes, so some people
//! do not want a Dock tile for it. "While open" shows the tile only while the
//! main window is visible. There is deliberately no fully hidden mode: it would
//! also drop Drifty from the app switcher and leave the menu bar icon as the
//! only way back. The choice is stored per device beside the app icon choice
//! and read before the window is revealed.
//!
//! The isolated development runner keeps its background-only policy for the
//! whole session, so this module never changes it there.

use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager, Runtime};

const DOCK_VISIBILITY_FILE_NAME: &str = "dock-visibility";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum DockVisibility {
    Always,
    WhileOpen,
}

impl DockVisibility {
    pub(crate) fn id(self) -> &'static str {
        match self {
            Self::Always => "always",
            Self::WhileOpen => "while-open",
        }
    }

    pub(crate) fn from_id(id: &str) -> Option<Self> {
        [Self::Always, Self::WhileOpen]
            .into_iter()
            .find(|mode| mode.id() == id)
    }

    /// True when the Dock tile (and the app switcher entry) should show.
    pub(crate) fn shows_dock_tile(self, main_window_visible: bool) -> bool {
        match self {
            Self::Always => true,
            Self::WhileOpen => main_window_visible,
        }
    }
}

fn preference_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|directory| directory.join(DOCK_VISIBILITY_FILE_NAME))
        .map_err(|error| format!("Could not resolve the Dock preference path: {error}"))
}

/// A missing, unreadable or unknown preference keeps the Dock tile.
fn read_preference(path: &Path) -> DockVisibility {
    fs::read_to_string(path)
        .ok()
        .and_then(|text| DockVisibility::from_id(text.trim()))
        .unwrap_or(DockVisibility::Always)
}

fn write_preference(path: &Path, mode: DockVisibility) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "The Dock preference path has no parent directory".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not create the Dock preference directory: {error}"))?;
    let temp_path = parent.join(format!(".{DOCK_VISIBILITY_FILE_NAME}.{}.tmp", std::process::id()));
    fs::write(&temp_path, mode.id())
        .map_err(|error| format!("Could not write the Dock preference: {error}"))?;
    fs::rename(&temp_path, path).map_err(|error| {
        let _ = fs::remove_file(&temp_path);
        format!("Could not save the Dock preference: {error}")
    })
}

pub(crate) fn saved<R: Runtime>(app: &AppHandle<R>) -> DockVisibility {
    preference_path(app)
        .map(|path| read_preference(&path))
        .unwrap_or(DockVisibility::Always)
}

/// Applies the saved choice for the main window's visibility.
pub(crate) fn apply<R: Runtime>(app: &AppHandle<R>, main_window_visible: bool) {
    #[cfg(target_os = "macos")]
    {
        if crate::should_use_isolated_dev_activation_policy(
            std::env::var_os("DRIFTY_ISOLATED_DEV").as_deref(),
            cfg!(debug_assertions),
        ) {
            return;
        }
        let show = saved(app).shows_dock_tile(main_window_visible);
        let _ = app.set_activation_policy(if show {
            tauri::ActivationPolicy::Regular
        } else {
            tauri::ActivationPolicy::Accessory
        });
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, main_window_visible);
    }
}

fn main_window_visible<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.get_webview_window(crate::MAIN_WINDOW_LABEL)
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false)
}

#[tauri::command]
pub(crate) fn dock_visibility_get(app: AppHandle) -> Result<String, String> {
    Ok(read_preference(&preference_path(&app)?).id().to_string())
}

#[tauri::command]
pub(crate) fn dock_visibility_set(app: AppHandle, mode: String) -> Result<String, String> {
    let mode = DockVisibility::from_id(&mode).ok_or_else(|| format!("Unknown Dock choice: {mode}"))?;
    #[cfg(target_os = "macos")]
    {
        write_preference(&preference_path(&app)?, mode)?;
        let visible = main_window_visible(&app);
        let handle = app.clone();
        app.run_on_main_thread(move || apply(&handle, visible))
            .map_err(|error| error.to_string())?;
        Ok(mode.id().to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, mode);
        Err("The Dock choice is only available on macOS.".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_round_trip_and_unknown_ids_are_rejected() {
        for mode in [DockVisibility::Always, DockVisibility::WhileOpen] {
            assert_eq!(DockVisibility::from_id(mode.id()), Some(mode));
        }
        assert_eq!(DockVisibility::from_id("sometimes"), None);
        assert_eq!(DockVisibility::from_id("hidden"), None);
    }

    #[test]
    fn the_tile_follows_the_window_only_while_open() {
        assert!(DockVisibility::Always.shows_dock_tile(false));
        assert!(DockVisibility::WhileOpen.shows_dock_tile(true));
        assert!(!DockVisibility::WhileOpen.shows_dock_tile(false));
    }

    #[test]
    fn a_missing_or_unknown_preference_keeps_the_tile_and_a_choice_survives_a_relaunch() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("nested").join(DOCK_VISIBILITY_FILE_NAME);
        assert_eq!(read_preference(&path), DockVisibility::Always);
        write_preference(&path, DockVisibility::WhileOpen).unwrap();
        assert_eq!(read_preference(&path), DockVisibility::WhileOpen);
        fs::write(&path, "unknown").unwrap();
        assert_eq!(read_preference(&path), DockVisibility::Always);
    }
}
