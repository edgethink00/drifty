//! Alternate Dock icons, chosen in Settings > Appearance on macOS.
//!
//! A choice only replaces `NSApplication.applicationIconImage` while Drifty
//! runs, which covers the Dock tile and the app switcher. Writing the icon into
//! the bundle with `NSWorkspace setIcon:forFile:` would also reach Finder, but it
//! adds an `Icon\r` file to the bundle root, which fails strict code-signature
//! verification, and every update replaces the bundle anyway. Finder,
//! Launchpad, Spotlight and a pinned tile while Drifty is closed therefore keep
//! the bundle icon.
//!
//! The choice is stored per device in the app's local data directory and read
//! when the app is ready, before any WebView has loaded. It never syncs.

use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

const APP_ICON_FILE_NAME: &str = "app-icon";

/// Keep in step with `APP_ICON_VARIANTS` in scripts/generate-app-icon-variants.mjs
/// and `APP_ICON_VARIANT_IDS` in apps/desktop/src/lib/api/appIconClient.ts.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum AppIconVariant {
    Classic,
    Midnight,
    Plum,
    Flow,
    Retro,
    Peek,
    Omega,
    Window,
    CatIvory,
    CatCharcoal,
    CatPlum,
}

impl AppIconVariant {
    pub(crate) const ALL: [Self; 11] = [
        Self::Classic,
        Self::Midnight,
        Self::Plum,
        Self::Flow,
        Self::Retro,
        Self::Peek,
        Self::Omega,
        Self::Window,
        Self::CatIvory,
        Self::CatCharcoal,
        Self::CatPlum,
    ];

    pub(crate) fn id(self) -> &'static str {
        match self {
            Self::Classic => "classic",
            Self::Midnight => "midnight",
            Self::Plum => "plum",
            Self::Flow => "flow",
            Self::Retro => "retro",
            Self::Peek => "peek",
            Self::Omega => "omega",
            Self::Window => "window",
            Self::CatIvory => "cat-ivory",
            Self::CatCharcoal => "cat-charcoal",
            Self::CatPlum => "cat-plum",
        }
    }

    pub(crate) fn from_id(id: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|variant| variant.id() == id)
    }

    /// The 1024px Dock image. `Classic` has none: it restores the bundle icon.
    #[cfg(target_os = "macos")]
    fn dock_image_png(self) -> Option<&'static [u8]> {
        match self {
            Self::Classic => None,
            Self::Midnight => Some(include_bytes!("../../icons/app-icon-variants/midnight.png")),
            Self::Plum => Some(include_bytes!("../../icons/app-icon-variants/plum.png")),
            Self::Flow => Some(include_bytes!("../../icons/app-icon-variants/flow.png")),
            Self::Retro => Some(include_bytes!("../../icons/app-icon-variants/retro.png")),
            Self::Peek => Some(include_bytes!("../../icons/app-icon-variants/peek.png")),
            Self::Omega => Some(include_bytes!("../../icons/app-icon-variants/omega.png")),
            Self::Window => Some(include_bytes!("../../icons/app-icon-variants/window.png")),
            Self::CatIvory => Some(include_bytes!(
                "../../icons/app-icon-variants/cat-ivory.png"
            )),
            Self::CatCharcoal => Some(include_bytes!(
                "../../icons/app-icon-variants/cat-charcoal.png"
            )),
            Self::CatPlum => Some(include_bytes!("../../icons/app-icon-variants/cat-plum.png")),
        }
    }
}

fn preference_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|directory| directory.join(APP_ICON_FILE_NAME))
        .map_err(|error| format!("Could not resolve the app icon preference path: {error}"))
}

/// A missing, unreadable or unknown preference means the bundle icon.
fn read_preference(path: &Path) -> AppIconVariant {
    fs::read_to_string(path)
        .ok()
        .and_then(|text| AppIconVariant::from_id(text.trim()))
        .unwrap_or(AppIconVariant::Classic)
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn write_preference(path: &Path, variant: AppIconVariant) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "The app icon preference path has no parent directory".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not create the app icon preference directory: {error}"))?;
    let temp_path = parent.join(format!(".{APP_ICON_FILE_NAME}.{}.tmp", std::process::id()));
    fs::write(&temp_path, variant.id())
        .map_err(|error| format!("Could not write the app icon preference: {error}"))?;
    fs::rename(&temp_path, path).map_err(|error| {
        let _ = fs::remove_file(&temp_path);
        format!("Could not save the app icon preference: {error}")
    })
}

#[tauri::command]
pub fn app_icon_get(app: AppHandle) -> Result<String, String> {
    Ok(read_preference(&preference_path(&app)?).id().to_string())
}

#[tauri::command]
pub fn app_icon_set(app: AppHandle, variant: String) -> Result<String, String> {
    let variant =
        AppIconVariant::from_id(&variant).ok_or_else(|| format!("Unknown app icon: {variant}"))?;
    #[cfg(target_os = "macos")]
    {
        write_preference(&preference_path(&app)?, variant)?;
        dock::apply_on_main_thread(&app, variant);
        Ok(variant.id().to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, variant);
        Err("The app icon can only be changed on macOS".to_string())
    }
}

/// What a preview request shows: the requested icon, or the saved choice when
/// the preview ends. It never touches the saved preference.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn preview_target(requested: Option<&str>, saved: &Path) -> Result<AppIconVariant, String> {
    match requested {
        Some(id) => AppIconVariant::from_id(id).ok_or_else(|| format!("Unknown app icon: {id}")),
        None => Ok(read_preference(saved)),
    }
}

/// Tries an icon on in the Dock without saving it (Settings shows a locked Pro
/// icon this way while its bubble is open). `None` puts the saved choice
/// back; quitting ends a preview because nothing was written.
#[tauri::command]
pub fn app_icon_preview(app: AppHandle, variant: Option<String>) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        let shown = preview_target(variant.as_deref(), &preference_path(&app)?)?;
        dock::apply_on_main_thread(&app, shown);
        Ok(shown.id().to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, variant);
        Err("The app icon can only be changed on macOS".to_string())
    }
}

/// Runs from `RunEvent::Ready`, after Tauri has set its own development icon.
#[cfg(target_os = "macos")]
pub(crate) fn apply_saved_app_icon(app: &AppHandle) {
    dock::remember_launch_icon();
    let Ok(path) = preference_path(app) else {
        return;
    };
    let variant = read_preference(&path);
    if variant != AppIconVariant::Classic {
        dock::apply_on_main_thread(app, variant);
    }
}

#[cfg(target_os = "macos")]
mod dock {
    use super::AppIconVariant;
    use objc2::rc::Retained;
    use objc2::{AllocAnyThread, MainThreadMarker};
    use objc2_app_kit::{NSApplication, NSImage};
    use objc2_foundation::NSData;
    use std::cell::RefCell;
    use tauri::AppHandle;

    thread_local! {
        // Development builds have no bundle icon to fall back to, so Classic
        // restores the icon Tauri set at launch instead of the generic one.
        static LAUNCH_ICON: RefCell<Option<Retained<NSImage>>> = const { RefCell::new(None) };
    }

    pub(super) fn remember_launch_icon() {
        if !cfg!(dev) {
            return;
        }
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let icon = NSApplication::sharedApplication(mtm).applicationIconImage();
        LAUNCH_ICON.with(|slot| *slot.borrow_mut() = icon);
    }

    pub(super) fn decode(png: &[u8]) -> Option<Retained<NSImage>> {
        NSImage::initWithData(NSImage::alloc(), &NSData::with_bytes(png))
    }

    pub(super) fn apply_on_main_thread(app: &AppHandle, variant: AppIconVariant) {
        if let Some(mtm) = MainThreadMarker::new() {
            apply(mtm, variant);
            return;
        }
        let _ = app.run_on_main_thread(move || {
            if let Some(mtm) = MainThreadMarker::new() {
                apply(mtm, variant);
            }
        });
    }

    fn apply(mtm: MainThreadMarker, variant: AppIconVariant) {
        let application = NSApplication::sharedApplication(mtm);
        let image = match variant.dock_image_png() {
            Some(png) => match decode(png) {
                Some(image) => Some(image),
                None => {
                    eprintln!(
                        "[app-icon] could not decode the {} Dock image",
                        variant.id()
                    );
                    return;
                }
            },
            None => LAUNCH_ICON.with(|slot| slot.borrow().clone()),
        };
        // SAFETY: called on the main thread; `None` restores the bundle icon.
        unsafe { application.setApplicationIconImage(image.as_deref()) };
        eprintln!("[app-icon] Dock icon set to {}", variant.id());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn ids_round_trip_and_unknown_ids_are_rejected() {
        for variant in AppIconVariant::ALL {
            assert_eq!(AppIconVariant::from_id(variant.id()), Some(variant));
        }
        assert_eq!(AppIconVariant::from_id("Midnight"), None);
        assert_eq!(AppIconVariant::from_id(""), None);
    }

    #[test]
    fn a_missing_or_unknown_preference_keeps_the_bundle_icon() {
        let directory = tempdir().unwrap();
        let path = directory.path().join(APP_ICON_FILE_NAME);
        assert_eq!(read_preference(&path), AppIconVariant::Classic);
        fs::write(&path, "neon").unwrap();
        assert_eq!(read_preference(&path), AppIconVariant::Classic);
    }

    #[test]
    fn a_saved_choice_survives_a_relaunch() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("nested").join(APP_ICON_FILE_NAME);
        write_preference(&path, AppIconVariant::CatCharcoal).unwrap();
        assert_eq!(read_preference(&path), AppIconVariant::CatCharcoal);
        write_preference(&path, AppIconVariant::Classic).unwrap();
        assert_eq!(read_preference(&path), AppIconVariant::Classic);
    }

    #[test]
    fn a_failed_save_leaves_no_temporary_file_behind() {
        let directory = tempdir().unwrap();
        let path = directory.path().join(APP_ICON_FILE_NAME);
        fs::create_dir(&path).unwrap();
        assert!(write_preference(&path, AppIconVariant::Plum).is_err());
        let leftovers: Vec<_> = fs::read_dir(directory.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .filter(|name| name != APP_ICON_FILE_NAME)
            .collect();
        assert!(leftovers.is_empty(), "{leftovers:?}");
    }

    #[test]
    fn a_preview_shows_the_requested_icon_and_ends_on_the_saved_one_without_saving() {
        let directory = tempdir().unwrap();
        let path = directory.path().join(APP_ICON_FILE_NAME);
        write_preference(&path, AppIconVariant::Midnight).unwrap();

        assert_eq!(preview_target(Some("cat-plum"), &path), Ok(AppIconVariant::CatPlum));
        assert!(preview_target(Some("neon"), &path).is_err());
        assert_eq!(preview_target(None, &path), Ok(AppIconVariant::Midnight));
        assert_eq!(read_preference(&path), AppIconVariant::Midnight);

        let missing = directory.path().join("missing");
        assert_eq!(preview_target(None, &missing), Ok(AppIconVariant::Classic));
        assert!(!missing.exists());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn every_alternate_icon_decodes_at_dock_resolution() {
        for variant in AppIconVariant::ALL {
            let Some(png) = variant.dock_image_png() else {
                assert_eq!(variant, AppIconVariant::Classic);
                continue;
            };
            let image = dock::decode(png).unwrap_or_else(|| panic!("{} must decode", variant.id()));
            let size = image.size();
            assert_eq!(
                (size.width, size.height),
                (1024.0, 1024.0),
                "{}",
                variant.id()
            );
        }
    }
}
