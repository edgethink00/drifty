use tauri::menu::{CheckMenuItem, Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Runtime};

use crate::shell_action::{self, app_menu_id, ShellAction};

pub(crate) fn setup_app_menu(app: &AppHandle) -> tauri::Result<()> {
    // Windows WebView2 surfaces Menu::default() as a native menubar
    // (File/Edit/Window/Help). The product chrome already lives in the
    // renderer, so attaching that menu makes a Mac app look pasted on.
    if cfg!(windows) {
        return Ok(());
    }

    let menu = Menu::default(app)?;
    if !menu.items()?.is_empty() {
        let _ = menu.remove_at(0)?;
    }
    let app_submenu = build_app_submenu(app)?;
    menu.insert(&app_submenu, 0)?;
    menu.set_as_app_menu()?;
    Ok(())
}

pub(crate) fn handle_app_menu_event(app: &AppHandle, id: &str) {
    let Some(action) = ShellAction::from_app_menu_id(id) else {
        return;
    };

    shell_action::dispatch(app, action);
}

#[tauri::command]
pub(crate) fn app_menu_set_dev_mode_checked(app: AppHandle, checked: bool) -> Result<(), String> {
    let Some(menu) = app.menu() else {
        return Ok(());
    };
    let Some(dev_mode) = find_check_menu_item(
        menu.items().map_err(|error| error.to_string())?,
        app_menu_id::DEV_MODE,
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
    // Use AppKit's bundle-backed About panel directly, avoiding the custom
    // options path implicated in the observed native icon-encoding crash.
    let about = PredefinedMenuItem::about(app, Some("About Drifty"), None)?;
    let check_updates = MenuItem::with_id(
        app,
        app_menu_id::CHECK_FOR_UPDATES,
        "Check for Updates...",
        true,
        None::<&str>,
    )?;
    let settings = MenuItem::with_id(
        app,
        app_menu_id::SETTINGS,
        "Settings...",
        true,
        Some("CmdOrCtrl+,"),
    )?;
    let dev_mode = CheckMenuItem::with_id(
        app,
        app_menu_id::DEV_MODE,
        "Dev Mode",
        true,
        false,
        None::<&str>,
    )?;
    let latest_build = MenuItem::with_id(
        app,
        app_menu_id::CHECK_LATEST_BUILD,
        "Check Latest Build...",
        true,
        None::<&str>,
    )?;
    let build_info = MenuItem::with_id(
        app,
        app_menu_id::BUILD_INFO,
        format!("Build: {}", build_short_commit()),
        false,
        None::<&str>,
    )?;
    let developer_separator = PredefinedMenuItem::separator(app)?;
    let developer = Submenu::with_id_and_items(
        app,
        app_menu_id::DEVELOPER_SUBMENU,
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
        app_menu_id::ROOT,
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
