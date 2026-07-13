use tauri::{AppHandle, Emitter, Manager};

use crate::{reveal_main_window, tray, MAIN_WINDOW_LABEL};

pub(crate) mod app_menu_id {
    pub(crate) const ROOT: &str = "drifty-app-menu";
    pub(crate) const DEVELOPER_SUBMENU: &str = "drifty-app-menu-developer";
    pub(crate) const CHECK_FOR_UPDATES: &str = "drifty-app-menu-check-for-updates";
    pub(crate) const SETTINGS: &str = "drifty-app-menu-settings";
    pub(crate) const DEV_MODE: &str = "drifty-app-menu-dev-mode";
    pub(crate) const CHECK_LATEST_BUILD: &str = "drifty-app-menu-check-latest-build";
    pub(crate) const BUILD_INFO: &str = "drifty-app-menu-build-info";
}

pub(crate) mod tray_menu_id {
    pub(crate) const APP_INFO: &str = "menu-app-info";
    pub(crate) const UPDATE_STATUS: &str = "menu-update-status";
    pub(crate) const OPEN_DASHBOARD: &str = "menu-open-dashboard";
    pub(crate) const TRACKING_TOGGLE: &str = "menu-tracking-toggle";
    pub(crate) const DRIFT_ALERTS_STATUS: &str = "menu-drift-alerts-status";
    pub(crate) const DRIFT_LAST_CHECK: &str = "menu-drift-last-check";
    pub(crate) const DRIFT_RESULT: &str = "menu-drift-result";
    pub(crate) const DRIFT_DETAIL: &str = "menu-drift-detail";
    pub(crate) const TOGGLE_THEME: &str = "menu-toggle-theme";
    pub(crate) const SETTINGS: &str = "menu-settings";
    pub(crate) const QUIT: &str = "menu-quit";
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ShellAction {
    OpenDashboard,
    ToggleTracking,
    ToggleTheme,
    Settings,
    CheckForUpdates,
    ToggleDevMode,
    CheckLatestBuild,
    Quit,
}

impl ShellAction {
    pub(crate) fn from_app_menu_id(id: &str) -> Option<Self> {
        match id {
            app_menu_id::CHECK_FOR_UPDATES => Some(Self::CheckForUpdates),
            app_menu_id::SETTINGS => Some(Self::Settings),
            app_menu_id::DEV_MODE => Some(Self::ToggleDevMode),
            app_menu_id::CHECK_LATEST_BUILD => Some(Self::CheckLatestBuild),
            _ => None,
        }
    }

    pub(crate) fn from_tray_menu_id(id: &str) -> Option<Self> {
        match id {
            tray_menu_id::OPEN_DASHBOARD => Some(Self::OpenDashboard),
            tray_menu_id::TRACKING_TOGGLE => Some(Self::ToggleTracking),
            tray_menu_id::TOGGLE_THEME => Some(Self::ToggleTheme),
            tray_menu_id::SETTINGS => Some(Self::Settings),
            tray_menu_id::UPDATE_STATUS => Some(Self::CheckForUpdates),
            tray_menu_id::QUIT => Some(Self::Quit),
            _ => None,
        }
    }
}

const EVENT_TOGGLE_THEME: &str = "tray-toggle-theme";
const EVENT_OPEN_SETTINGS: &str = "tray-open-settings";
const EVENT_CHECK_FOR_UPDATES: &str = "tray-check-for-updates";
const EVENT_TOGGLE_DEV_MODE: &str = "app-menu-toggle-dev-mode";
const EVENT_CHECK_LATEST_BUILD: &str = "app-menu-check-latest-build";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ShellActionEffect {
    RevealMainWindow,
    ToggleTracking,
    EmitMainWindowEvent(&'static str),
    ExitApp(i32),
}

impl ShellAction {
    const fn effects(self) -> &'static [ShellActionEffect] {
        match self {
            Self::OpenDashboard => &[ShellActionEffect::RevealMainWindow],
            Self::ToggleTracking => &[ShellActionEffect::ToggleTracking],
            Self::ToggleTheme => &[
                ShellActionEffect::RevealMainWindow,
                ShellActionEffect::EmitMainWindowEvent(EVENT_TOGGLE_THEME),
            ],
            Self::Settings => &[
                ShellActionEffect::RevealMainWindow,
                ShellActionEffect::EmitMainWindowEvent(EVENT_OPEN_SETTINGS),
            ],
            Self::CheckForUpdates => &[
                ShellActionEffect::RevealMainWindow,
                ShellActionEffect::EmitMainWindowEvent(EVENT_CHECK_FOR_UPDATES),
            ],
            Self::ToggleDevMode => &[
                ShellActionEffect::RevealMainWindow,
                ShellActionEffect::EmitMainWindowEvent(EVENT_TOGGLE_DEV_MODE),
            ],
            Self::CheckLatestBuild => &[
                ShellActionEffect::RevealMainWindow,
                ShellActionEffect::EmitMainWindowEvent(EVENT_CHECK_LATEST_BUILD),
            ],
            Self::Quit => &[ShellActionEffect::ExitApp(0)],
        }
    }
}

trait ShellActionTarget {
    fn reveal_main_window(&mut self);
    fn toggle_tracking(&mut self);
    fn emit_main_window_event(&mut self, event: &'static str);
    fn exit_app(&mut self, exit_code: i32);
}

pub(crate) fn dispatch(app: &AppHandle, action: ShellAction) {
    let mut target = TauriShellActionTarget { app };
    dispatch_to_target(action, &mut target);
}

fn dispatch_to_target(action: ShellAction, target: &mut impl ShellActionTarget) {
    for &effect in action.effects() {
        match effect {
            ShellActionEffect::RevealMainWindow => target.reveal_main_window(),
            ShellActionEffect::ToggleTracking => target.toggle_tracking(),
            ShellActionEffect::EmitMainWindowEvent(event) => target.emit_main_window_event(event),
            ShellActionEffect::ExitApp(exit_code) => target.exit_app(exit_code),
        }
    }
}

struct TauriShellActionTarget<'a> {
    app: &'a AppHandle,
}

impl ShellActionTarget for TauriShellActionTarget<'_> {
    fn reveal_main_window(&mut self) {
        reveal_main_window(self.app);
    }

    fn toggle_tracking(&mut self) {
        tray::toggle_tracking(self.app);
    }

    fn emit_main_window_event(&mut self, event: &'static str) {
        if let Some(window) = self.app.get_webview_window(MAIN_WINDOW_LABEL) {
            let _ = window.emit(event, ());
        }
    }

    fn exit_app(&mut self, exit_code: i32) {
        self.app.exit(exit_code);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct FakeTarget {
        effects: Vec<ShellActionEffect>,
    }

    impl ShellActionTarget for FakeTarget {
        fn reveal_main_window(&mut self) {
            self.effects.push(ShellActionEffect::RevealMainWindow);
        }

        fn toggle_tracking(&mut self) {
            self.effects.push(ShellActionEffect::ToggleTracking);
        }

        fn emit_main_window_event(&mut self, event: &'static str) {
            self.effects
                .push(ShellActionEffect::EmitMainWindowEvent(event));
        }

        fn exit_app(&mut self, exit_code: i32) {
            self.effects.push(ShellActionEffect::ExitApp(exit_code));
        }
    }

    #[test]
    fn app_menu_and_tray_shared_actions_map_to_the_same_variants() {
        assert_eq!(
            ShellAction::from_app_menu_id(app_menu_id::SETTINGS),
            ShellAction::from_tray_menu_id(tray_menu_id::SETTINGS),
        );
        assert_eq!(
            ShellAction::from_app_menu_id(app_menu_id::CHECK_FOR_UPDATES),
            ShellAction::from_tray_menu_id(tray_menu_id::UPDATE_STATUS),
        );
    }

    #[test]
    fn source_parsers_map_all_action_ids() {
        for (id, action) in [
            (app_menu_id::CHECK_FOR_UPDATES, ShellAction::CheckForUpdates),
            (app_menu_id::SETTINGS, ShellAction::Settings),
            (app_menu_id::DEV_MODE, ShellAction::ToggleDevMode),
            (
                app_menu_id::CHECK_LATEST_BUILD,
                ShellAction::CheckLatestBuild,
            ),
        ] {
            assert_eq!(ShellAction::from_app_menu_id(id), Some(action));
        }

        for (id, action) in [
            (tray_menu_id::OPEN_DASHBOARD, ShellAction::OpenDashboard),
            (tray_menu_id::TRACKING_TOGGLE, ShellAction::ToggleTracking),
            (tray_menu_id::TOGGLE_THEME, ShellAction::ToggleTheme),
            (tray_menu_id::SETTINGS, ShellAction::Settings),
            (tray_menu_id::UPDATE_STATUS, ShellAction::CheckForUpdates),
            (tray_menu_id::QUIT, ShellAction::Quit),
        ] {
            assert_eq!(ShellAction::from_tray_menu_id(id), Some(action));
        }
    }

    #[test]
    fn actionable_ids_are_rejected_by_the_opposite_source_parser() {
        for id in [
            app_menu_id::CHECK_FOR_UPDATES,
            app_menu_id::SETTINGS,
            app_menu_id::DEV_MODE,
            app_menu_id::CHECK_LATEST_BUILD,
        ] {
            assert_eq!(ShellAction::from_tray_menu_id(id), None, "{id}");
        }

        for id in [
            tray_menu_id::OPEN_DASHBOARD,
            tray_menu_id::TRACKING_TOGGLE,
            tray_menu_id::TOGGLE_THEME,
            tray_menu_id::SETTINGS,
            tray_menu_id::UPDATE_STATUS,
            tray_menu_id::QUIT,
        ] {
            assert_eq!(ShellAction::from_app_menu_id(id), None, "{id}");
        }
    }

    #[test]
    fn dual_global_listeners_resolve_each_action_exactly_once() {
        let cases = [
            (app_menu_id::CHECK_FOR_UPDATES, ShellAction::CheckForUpdates),
            (app_menu_id::SETTINGS, ShellAction::Settings),
            (app_menu_id::DEV_MODE, ShellAction::ToggleDevMode),
            (
                app_menu_id::CHECK_LATEST_BUILD,
                ShellAction::CheckLatestBuild,
            ),
            (tray_menu_id::OPEN_DASHBOARD, ShellAction::OpenDashboard),
            (tray_menu_id::TRACKING_TOGGLE, ShellAction::ToggleTracking),
            (tray_menu_id::TOGGLE_THEME, ShellAction::ToggleTheme),
            (tray_menu_id::SETTINGS, ShellAction::Settings),
            (tray_menu_id::UPDATE_STATUS, ShellAction::CheckForUpdates),
            (tray_menu_id::QUIT, ShellAction::Quit),
        ];

        for (id, expected) in cases {
            let resolved = [
                ShellAction::from_app_menu_id(id),
                ShellAction::from_tray_menu_id(id),
            ]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>();
            assert_eq!(resolved, vec![expected], "{id}");
        }

        for id in [
            app_menu_id::ROOT,
            app_menu_id::DEVELOPER_SUBMENU,
            app_menu_id::BUILD_INFO,
            tray_menu_id::APP_INFO,
            tray_menu_id::DRIFT_ALERTS_STATUS,
            tray_menu_id::DRIFT_LAST_CHECK,
            tray_menu_id::DRIFT_RESULT,
            tray_menu_id::DRIFT_DETAIL,
            "quit",
            "unknown",
        ] {
            assert!(
                ShellAction::from_app_menu_id(id).is_none()
                    && ShellAction::from_tray_menu_id(id).is_none(),
                "{id}"
            );
        }
    }

    #[test]
    fn source_parsers_ignore_unknown_and_status_only_ids() {
        assert_eq!(ShellAction::from_app_menu_id(app_menu_id::ROOT), None);
        assert_eq!(
            ShellAction::from_app_menu_id(app_menu_id::DEVELOPER_SUBMENU),
            None,
        );
        assert_eq!(ShellAction::from_app_menu_id(app_menu_id::BUILD_INFO), None);
        assert_eq!(ShellAction::from_app_menu_id("unknown"), None);

        for id in [
            tray_menu_id::APP_INFO,
            tray_menu_id::DRIFT_ALERTS_STATUS,
            tray_menu_id::DRIFT_LAST_CHECK,
            tray_menu_id::DRIFT_RESULT,
            tray_menu_id::DRIFT_DETAIL,
            "unknown",
        ] {
            assert_eq!(ShellAction::from_tray_menu_id(id), None);
        }
    }

    #[test]
    fn unknown_ids_do_not_dispatch() {
        let mut target = FakeTarget::default();

        for action in [
            ShellAction::from_app_menu_id("unknown"),
            ShellAction::from_tray_menu_id("unknown"),
        ] {
            if let Some(action) = action {
                dispatch_to_target(action, &mut target);
            }
        }

        assert!(target.effects.is_empty());
    }

    #[test]
    fn dispatcher_preserves_every_action_side_effect() {
        let cases = [
            (
                ShellAction::OpenDashboard,
                &[ShellActionEffect::RevealMainWindow][..],
            ),
            (
                ShellAction::ToggleTracking,
                &[ShellActionEffect::ToggleTracking][..],
            ),
            (
                ShellAction::ToggleTheme,
                &[
                    ShellActionEffect::RevealMainWindow,
                    ShellActionEffect::EmitMainWindowEvent(EVENT_TOGGLE_THEME),
                ][..],
            ),
            (
                ShellAction::Settings,
                &[
                    ShellActionEffect::RevealMainWindow,
                    ShellActionEffect::EmitMainWindowEvent(EVENT_OPEN_SETTINGS),
                ][..],
            ),
            (
                ShellAction::CheckForUpdates,
                &[
                    ShellActionEffect::RevealMainWindow,
                    ShellActionEffect::EmitMainWindowEvent(EVENT_CHECK_FOR_UPDATES),
                ][..],
            ),
            (
                ShellAction::ToggleDevMode,
                &[
                    ShellActionEffect::RevealMainWindow,
                    ShellActionEffect::EmitMainWindowEvent(EVENT_TOGGLE_DEV_MODE),
                ][..],
            ),
            (
                ShellAction::CheckLatestBuild,
                &[
                    ShellActionEffect::RevealMainWindow,
                    ShellActionEffect::EmitMainWindowEvent(EVENT_CHECK_LATEST_BUILD),
                ][..],
            ),
            (ShellAction::Quit, &[ShellActionEffect::ExitApp(0)][..]),
        ];

        for (action, expected_effects) in cases {
            let mut target = FakeTarget::default();
            dispatch_to_target(action, &mut target);
            assert_eq!(target.effects, expected_effects, "{action:?}");
        }
    }
}
