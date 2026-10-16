use std::sync::Mutex;

use tauri::menu::{CheckMenuItem, Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Manager, Runtime};

use crate::shell_action::{self, app_menu_id, ShellAction};
use crate::tray::{latest_tray_language, TrayLanguage};

struct LocalizedItem {
    item: MenuItemKind<tauri::Wry>,
    english: &'static str,
    korean: &'static str,
    spanish: &'static str,
}

/// The menu bar is installed once. Keeping its tree and changing labels in
/// place preserves both muda's click targets and the Dev Mode check state.
struct AppMenu {
    _menu: Menu<tauri::Wry>,
    localized: Vec<LocalizedItem>,
    language: Option<TrayLanguage>,
}

struct AppMenuState(Mutex<AppMenu>);

impl AppMenu {
    fn set_language(&mut self, language: TrayLanguage) -> tauri::Result<()> {
        if self.language == Some(language) {
            return Ok(());
        }
        self.language = None;
        for item in &self.localized {
            let text = language.pick(item.english, item.korean, item.spanish);
            match &item.item {
                MenuItemKind::MenuItem(item) => item.set_text(text)?,
                MenuItemKind::Predefined(item) => item.set_text(text)?,
                _ => unreachable!("only text and predefined items are localized"),
            }
        }
        self.language = Some(language);
        Ok(())
    }
}

/// Startup and language refresh both run on the main thread. No worker may
/// hold AppMenuState while a native setter waits for that thread.
pub(crate) fn setup_app_menu(app: &AppHandle) -> tauri::Result<()> {
    // Windows WebView2 surfaces Menu::default() as a native menubar.
    // The product chrome already lives in the renderer.
    if cfg!(windows) {
        return Ok(());
    }

    let language = latest_tray_language(app);
    if let Some(state) = app.try_state::<AppMenuState>() {
        return state
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .set_language(language);
    }

    let menu = Menu::default(app)?;
    if !menu.items()?.is_empty() {
        let _ = menu.remove_at(0)?;
    }
    let (app_submenu, localized) = build_app_submenu(app, language)?;
    menu.insert(&app_submenu, 0)?;
    menu.set_as_app_menu()?;
    app.manage(AppMenuState(Mutex::new(AppMenu {
        _menu: menu,
        localized,
        language: Some(language),
    })));
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

fn build_app_submenu(
    app: &AppHandle,
    language: TrayLanguage,
) -> tauri::Result<(Submenu<tauri::Wry>, Vec<LocalizedItem>)> {
    // Use AppKit's bundle-backed About panel.
    let about = PredefinedMenuItem::about(app, Some(language.pick("About Drifty", "Drifty에 관하여", "Acerca de Drifty")), None)?;
    let whats_new = MenuItem::with_id(
        app,
        app_menu_id::WHATS_NEW,
        language.pick("What’s New…", "새로운 기능…", "Novedades…"),
        true,
        None::<&str>,
    )?;
    let check_updates = MenuItem::with_id(
        app,
        app_menu_id::CHECK_FOR_UPDATES,
        language.pick("Check for Updates...", "업데이트 확인…", "Buscar actualizaciones…"),
        true,
        None::<&str>,
    )?;
    let settings = MenuItem::with_id(
        app,
        app_menu_id::SETTINGS,
        language.pick("Settings...", "설정…", "Configuración…"),
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
    let services = PredefinedMenuItem::services(app, Some(language.pick("Services", "서비스", "Servicios")))?;
    let hide = PredefinedMenuItem::hide(app, Some(language.pick("Hide Drifty", "Drifty 가리기", "Ocultar Drifty")))?;
    let hide_others = PredefinedMenuItem::hide_others(app, Some(language.pick("Hide Others", "기타 가리기", "Ocultar las demás")))?;
    let show_all = PredefinedMenuItem::show_all(app, Some(language.pick("Show All", "모두 보기", "Mostrar todo")))?;
    let quit = MenuItem::with_id(
        app,
        app_menu_id::QUIT,
        language.pick("Quit Drifty", "Drifty 종료", "Salir de Drifty"),
        true,
        Some("CmdOrCtrl+Q"),
    )?;

    let submenu = Submenu::with_id_and_items(
        app,
        app_menu_id::ROOT,
        "Drifty",
        true,
        &[
            &about,
            &whats_new,
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
    )?;
    let localized = vec![
        LocalizedItem {
            item: MenuItemKind::Predefined(about),
            english: "About Drifty",
            korean: "Drifty에 관하여",
            spanish: "Acerca de Drifty",
        },
        LocalizedItem {
            item: MenuItemKind::MenuItem(whats_new),
            english: "What’s New…",
            korean: "새로운 기능…",
            spanish: "Novedades…",
        },
        LocalizedItem {
            item: MenuItemKind::MenuItem(check_updates),
            english: "Check for Updates...",
            korean: "업데이트 확인…",
            spanish: "Buscar actualizaciones…",
        },
        LocalizedItem {
            item: MenuItemKind::MenuItem(settings),
            english: "Settings...",
            korean: "설정…",
            spanish: "Configuración…",
        },
        LocalizedItem {
            item: MenuItemKind::Predefined(services),
            english: "Services",
            korean: "서비스",
            spanish: "Servicios",
        },
        LocalizedItem {
            item: MenuItemKind::Predefined(hide),
            english: "Hide Drifty",
            korean: "Drifty 가리기",
            spanish: "Ocultar Drifty",
        },
        LocalizedItem {
            item: MenuItemKind::Predefined(hide_others),
            english: "Hide Others",
            korean: "기타 가리기",
            spanish: "Ocultar las demás",
        },
        LocalizedItem {
            item: MenuItemKind::Predefined(show_all),
            english: "Show All",
            korean: "모두 보기",
            spanish: "Mostrar todo",
        },
        LocalizedItem {
            item: MenuItemKind::MenuItem(quit),
            english: "Quit Drifty",
            korean: "Drifty 종료",
            spanish: "Salir de Drifty",
        },
    ];
    Ok((submenu, localized))
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
