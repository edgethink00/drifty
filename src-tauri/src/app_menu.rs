use tauri::menu::{
    AboutMetadata, CheckMenuItem, Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu,
};
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::{reveal_main_window, MAIN_WINDOW_LABEL};

const MENU_CHECK_FOR_UPDATES: &str = "drifty-app-menu-check-for-updates";
const MENU_SETTINGS: &str = "drifty-app-menu-settings";
const MENU_DEV_MODE: &str = "drifty-app-menu-dev-mode";
const MENU_CHECK_LATEST_BUILD: &str = "drifty-app-menu-check-latest-build";
const MENU_BUILD_INFO: &str = "drifty-app-menu-build-info";
const EVENT_TOGGLE_DEV_MODE: &str = "app-menu-toggle-dev-mode";
const EVENT_CHECK_LATEST_BUILD: &str = "app-menu-check-latest-build";

pub(crate) fn setup_app_menu(app: &AppHandle) -> tauri::Result<()> {
    let menu = Menu::default(app)?;
    if !menu.items()?.is_empty() {
        let _ = menu.remove_at(0)?;
    }
    let app_submenu = build_app_submenu(app)?;
    menu.insert(&app_submenu, 0)?;
    menu.set_as_app_menu()?;
    Ok(())
}

pub(crate) fn handle_app_menu_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    match id {
        MENU_CHECK_FOR_UPDATES => emit_main_window_event(app, "tray-check-for-updates"),
        MENU_SETTINGS => emit_main_window_event(app, "tray-open-settings"),
        MENU_DEV_MODE => emit_main_window_event(app, EVENT_TOGGLE_DEV_MODE),
        MENU_CHECK_LATEST_BUILD => emit_main_window_event(app, EVENT_CHECK_LATEST_BUILD),
        _ => {}
    }
}

#[tauri::command]
pub(crate) fn app_menu_set_dev_mode_checked(app: AppHandle, checked: bool) -> Result<(), String> {
    let Some(menu) = app.menu() else {
        return Ok(());
    };
    let Some(dev_mode) = find_check_menu_item(
        menu.items().map_err(|error| error.to_string())?,
        MENU_DEV_MODE,
    )
    .map_err(|error| error.to_string())?
    else {
        return Err("Dev Mode menu item is not checkable".to_string());
    };

    dev_mode
        .set_checked(checked)
        .map_err(|error| error.to_string())
}

fn find_check_menu_item<R: Runtime>(
    items: Vec<MenuItemKind<R>>,
    id: &str,
) -> tauri::Result<Option<CheckMenuItem<R>>> {
    for item in items {
        if item.id() == id {
            return Ok(item.as_check_menuitem().cloned());
        }

        if let Some(submenu) = item.as_submenu() {
            if let Some(found) = find_check_menu_item(submenu.items()?, id)? {
                return Ok(Some(found));
            }
        }
    }

    Ok(None)
}

fn build_app_submenu(app: &AppHandle) -> tauri::Result<Submenu<tauri::Wry>> {
    let about = PredefinedMenuItem::about(
        app,
        Some("About Drifty"),
        Some(AboutMetadata {
            name: Some("Drifty".into()),
            version: Some(app.package_info().version.to_string()),
            ..Default::default()
        }),
    )?;
    let check_updates = MenuItem::with_id(
        app,
        MENU_CHECK_FOR_UPDATES,
        "Check for Updates...",
        true,
        None::<&str>,
    )?;
    let settings = MenuItem::with_id(app, MENU_SETTINGS, "Settings...", true, Some("CmdOrCtrl+,"))?;
    let dev_mode =
        CheckMenuItem::with_id(app, MENU_DEV_MODE, "Dev Mode", true, false, None::<&str>)?;
    let latest_build = MenuItem::with_id(
        app,
        MENU_CHECK_LATEST_BUILD,
        "Check Latest Build...",
        true,
        None::<&str>,
    )?;
    let build_info = MenuItem::with_id(
        app,
        MENU_BUILD_INFO,
        format!("Build: {}", build_short_commit()),
        false,
        None::<&str>,
    )?;
    let developer_separator = PredefinedMenuItem::separator(app)?;
    let developer = Submenu::with_id_and_items(
        app,
        "drifty-app-menu-developer",
        "Developer",
        true,
        &[&dev_mode, &latest_build, &developer_separator, &build_info],
    )?;
    let app_primary_separator = PredefinedMenuItem::separator(app)?;
    let app_services_separator = PredefinedMenuItem::separator(app)?;
    let app_hide_separator = PredefinedMenuItem::separator(app)?;
    let app_quit_separator = PredefinedMenuItem::separator(app)?;
    let services = PredefinedMenuItem::services(app, Some("Services"))?;
    let hide = PredefinedMenuItem::hide(app, Some("Hide Drifty"))?;
    let hide_others = PredefinedMenuItem::hide_others(app, Some("Hide Others"))?;
    let show_all = PredefinedMenuItem::show_all(app, Some("Show All"))?;
    let quit = PredefinedMenuItem::quit(app, Some("Quit Drifty"))?;

    Submenu::with_id_and_items(
        app,
        "drifty-app-menu",
        "Drifty",
        true,
        &[
            &about,
            &app_primary_separator,
            &check_updates,
            &settings,
            &developer,
            &app_services_separator,
            &services,
            &app_hide_separator,
            &hide,
            &hide_others,
            &show_all,
            &app_quit_separator,
            &quit,
        ],
    )
}

fn build_short_commit() -> String {
    let commit = match option_env!("DRIFTY_BUILD_COMMIT") {
        Some(value) => value.trim(),
        None => "unknown",
    };
    if commit.is_empty() || commit == "unknown" {
        return "unknown".to_string();
    }
    commit.chars().take(12).collect()
}

fn emit_main_window_event<R: Runtime>(app: &AppHandle<R>, event: &str) {
    reveal_main_window(app);
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.emit(event, ());
    }
}
