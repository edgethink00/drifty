use tauri::{AppHandle, Emitter, Manager};

use crate::{request_main_window, tray, MAIN_WINDOW_LABEL};

pub(crate) mod app_menu_id {
    pub(crate) const ROOT: &str = "drifty-app-menu";
    pub(crate) const DEVELOPER_SUBMENU: &str = "drifty-app-menu-developer";
    pub(crate) const WHATS_NEW: &str = "drifty-app-menu-whats-new";
    pub(crate) const CHECK_FOR_UPDATES: &str = "drifty-app-menu-check-for-updates";
    pub(crate) const SETTINGS: &str = "drifty-app-menu-settings";
    pub(crate) const DEV_MODE: &str = "drifty-app-menu-dev-mode";
    pub(crate) const CHECK_LATEST_BUILD: &str = "drifty-app-menu-check-latest-build";
    pub(crate) const BUILD_INFO: &str = "drifty-app-menu-build-info";
    pub(crate) const QUIT: &str = "drifty-app-menu-quit";
}

pub(crate) mod tray_menu_id {
    pub(crate) const TRIAL_STATUS: &str = "menu-trial-status";
    pub(crate) const APP_INFO: &str = "menu-app-info";
    pub(crate) const UPDATE_STATUS: &str = "menu-update-status";
    pub(crate) const OPEN_DASHBOARD: &str = "menu-open-dashboard";
    pub(crate) const TRACKING_TOGGLE: &str = "menu-tracking-toggle";
    pub(crate) const PAUSE_HEADER: &str = "menu-pause-header";
    pub(crate) const PAUSE_FOR_15: &str = "menu-pause-for-15";
    pub(crate) const PAUSE_FOR_30: &str = "menu-pause-for-30";
    pub(crate) const PAUSE_FOR_60: &str = "menu-pause-for-60";
    pub(crate) const PAUSE_FOREVER: &str = "menu-pause-forever";
    pub(crate) const PAUSE_STATUS: &str = "menu-pause-status";
    pub(crate) const DRIFT_ALERTS_STATUS: &str = "menu-drift-alerts-status";
    pub(crate) const DRIFT_SUMMARY: &str = "menu-drift-summary";
    pub(crate) const SETTINGS: &str = "menu-settings";
    pub(crate) const QUIT: &str = "menu-quit";
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ShellAction {
    OpenDashboard,
    AccountSettings,
    ToggleTracking,
    PauseTrackingFor(u64),
    PauseTrackingForever,
    Settings,
    WhatsNew,
    CheckForUpdates,
    ToggleDevMode,
    CheckLatestBuild,
    Quit,
}

impl ShellAction {
    pub(crate) fn from_app_menu_id(id: &str) -> Option<Self> {
        match id {
            app_menu_id::WHATS_NEW => Some(Self::WhatsNew),
            app_menu_id::CHECK_FOR_UPDATES => Some(Self::CheckForUpdates),
            app_menu_id::SETTINGS => Some(Self::Settings),
            app_menu_id::DEV_MODE => Some(Self::ToggleDevMode),
            app_menu_id::CHECK_LATEST_BUILD => Some(Self::CheckLatestBuild),
            app_menu_id::QUIT => Some(Self::Quit),
            _ => None,
        }
    }

    pub(crate) fn from_tray_menu_id(id: &str) -> Option<Self> {
        match id {
            tray_menu_id::TRIAL_STATUS => Some(Self::AccountSettings),
            tray_menu_id::OPEN_DASHBOARD => Some(Self::OpenDashboard),
            tray_menu_id::TRACKING_TOGGLE => Some(Self::ToggleTracking),
            tray_menu_id::PAUSE_FOR_15 => Some(Self::PauseTrackingFor(15)),
            tray_menu_id::PAUSE_FOR_30 => Some(Self::PauseTrackingFor(30)),
            tray_menu_id::PAUSE_FOR_60 => Some(Self::PauseTrackingFor(60)),
            tray_menu_id::PAUSE_FOREVER => Some(Self::PauseTrackingForever),
            tray_menu_id::SETTINGS => Some(Self::Settings),
            tray_menu_id::UPDATE_STATUS => Some(Self::CheckForUpdates),
            tray_menu_id::QUIT => Some(Self::Quit),
            _ => None,
        }
    }
}

const EVENT_OPEN_SETTINGS: &str = "tray-open-settings";
const EVENT_CHECK_FOR_UPDATES: &str = "tray-check-for-updates";
const EVENT_TOGGLE_DEV_MODE: &str = "app-menu-toggle-dev-mode";
const EVENT_CHECK_LATEST_BUILD: &str = "app-menu-check-latest-build";
const EVENT_OPEN_WHATS_NEW: &str = "app-menu-open-whats-new";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ShellActionEffect {
    RevealMainWindow,
    ToggleTracking,
    PauseTrackingFor(u64),
    PauseTrackingForever,
    EmitMainWindowEvent(&'static str),
    RequestQuit,
}

impl ShellAction {
    const fn effects(self) -> &'static [ShellActionEffect] {
        match self {
            Self::OpenDashboard => &[ShellActionEffect::RevealMainWindow],
            Self::AccountSettings => &[
                ShellActionEffect::RevealMainWindow,
                ShellActionEffect::EmitMainWindowEvent("tray-open-account-settings"),
            ],
            Self::ToggleTracking => &[ShellActionEffect::ToggleTracking],
            Self::PauseTrackingFor(15) => &[ShellActionEffect::PauseTrackingFor(15)],
            Self::PauseTrackingFor(30) => &[ShellActionEffect::PauseTrackingFor(30)],
            Self::PauseTrackingFor(60) => &[ShellActionEffect::PauseTrackingFor(60)],
            Self::PauseTrackingFor(_) => &[],
            Self::PauseTrackingForever => &[ShellActionEffect::PauseTrackingForever],
            Self::Settings => &[
                ShellActionEffect::RevealMainWindow,
                ShellActionEffect::EmitMainWindowEvent(EVENT_OPEN_SETTINGS),
            ],
            Self::CheckForUpdates => &[
                ShellActionEffect::EmitMainWindowEvent(EVENT_CHECK_FOR_UPDATES),
            ],
            Self::WhatsNew => &[
                ShellActionEffect::RevealMainWindow,
                ShellActionEffect::EmitMainWindowEvent(EVENT_OPEN_WHATS_NEW),
            ],
            Self::ToggleDevMode => &[
                ShellActionEffect::RevealMainWindow,
                ShellActionEffect::EmitMainWindowEvent(EVENT_TOGGLE_DEV_MODE),
            ],
            Self::CheckLatestBuild => &[
                ShellActionEffect::RevealMainWindow,
                ShellActionEffect::EmitMainWindowEvent(EVENT_CHECK_LATEST_BUILD),
            ],
            Self::Quit => &[ShellActionEffect::RequestQuit],
        }
    }
}

trait ShellActionTarget {
    fn reveal_main_window(&mut self);
    fn toggle_tracking(&mut self);
    fn pause_tracking_for(&mut self, minutes: u64);
    fn pause_tracking_forever(&mut self);
    fn emit_main_window_event(&mut self, event: &'static str);
    fn request_quit(&mut self);
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
            ShellActionEffect::PauseTrackingFor(minutes) => target.pause_tracking_for(minutes),
            ShellActionEffect::PauseTrackingForever => target.pause_tracking_forever(),
            ShellActionEffect::EmitMainWindowEvent(event) => target.emit_main_window_event(event),
            ShellActionEffect::RequestQuit => target.request_quit(),
        }
    }
}

struct TauriShellActionTarget<'a> {
    app: &'a AppHandle,
}

impl ShellActionTarget for TauriShellActionTarget<'_> {
    fn reveal_main_window(&mut self) {
        request_main_window(self.app);
    }

    fn toggle_tracking(&mut self) {
        tray::toggle_tracking(self.app);
    }

    fn pause_tracking_for(&mut self, minutes: u64) {
        crate::tracking_pause::pause_tracking_for(self.app, minutes);
    }

    fn pause_tracking_forever(&mut self) {
        tray::pause_tracking_forever(self.app);
    }

    fn emit_main_window_event(&mut self, event: &'static str) {
        if let Some(window) = self.app.get_webview_window(MAIN_WINDOW_LABEL) {
            let _ = window.emit(event, ());
        }
    }

    fn request_quit(&mut self) {
        crate::quit_confirmation::request_quit(self.app);
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

        fn pause_tracking_for(&mut self, minutes: u64) {
            self.effects
                .push(ShellActionEffect::PauseTrackingFor(minutes));
        }

        fn pause_tracking_forever(&mut self) {
            self.effects.push(ShellActionEffect::PauseTrackingForever);
        }

        fn emit_main_window_event(&mut self, event: &'static str) {
            self.effects
                .push(ShellActionEffect::EmitMainWindowEvent(event));
        }

        fn request_quit(&mut self) {
            self.effects.push(ShellActionEffect::RequestQuit);
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
        assert_eq!(
            ShellAction::from_app_menu_id(app_menu_id::QUIT),
            ShellAction::from_tray_menu_id(tray_menu_id::QUIT),
        );
    }

    #[test]
    fn source_parsers_map_all_action_ids() {
        for (id, action) in [
            (app_menu_id::WHATS_NEW, ShellAction::WhatsNew),
            (app_menu_id::CHECK_FOR_UPDATES, ShellAction::CheckForUpdates),
            (app_menu_id::SETTINGS, ShellAction::Settings),
            (app_menu_id::DEV_MODE, ShellAction::ToggleDevMode),
            (
                app_menu_id::CHECK_LATEST_BUILD,
                ShellAction::CheckLatestBuild,
            ),
            (app_menu_id::QUIT, ShellAction::Quit),
        ] {
            assert_eq!(ShellAction::from_app_menu_id(id), Some(action));
        }

        for (id, action) in [
            (tray_menu_id::OPEN_DASHBOARD, ShellAction::OpenDashboard),
            (tray_menu_id::TRACKING_TOGGLE, ShellAction::ToggleTracking),
            (
                tray_menu_id::PAUSE_FOR_15,
                ShellAction::PauseTrackingFor(15),
            ),
            (
                tray_menu_id::PAUSE_FOR_30,
                ShellAction::PauseTrackingFor(30),
            ),
            (
                tray_menu_id::PAUSE_FOR_60,
                ShellAction::PauseTrackingFor(60),
            ),
            (
                tray_menu_id::PAUSE_FOREVER,
                ShellAction::PauseTrackingForever,
            ),
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
            app_menu_id::WHATS_NEW,
            app_menu_id::CHECK_FOR_UPDATES,
            app_menu_id::SETTINGS,
            app_menu_id::DEV_MODE,
            app_menu_id::CHECK_LATEST_BUILD,
            app_menu_id::QUIT,
        ] {
            assert_eq!(ShellAction::from_tray_menu_id(id), None, "{id}");
        }

        for id in [
            tray_menu_id::OPEN_DASHBOARD,
            tray_menu_id::TRACKING_TOGGLE,
            tray_menu_id::PAUSE_FOR_15,
            tray_menu_id::PAUSE_FOR_30,
            tray_menu_id::PAUSE_FOR_60,
            tray_menu_id::PAUSE_FOREVER,
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
            (app_menu_id::WHATS_NEW, ShellAction::WhatsNew),
            (app_menu_id::CHECK_FOR_UPDATES, ShellAction::CheckForUpdates),
            (app_menu_id::SETTINGS, ShellAction::Settings),
            (app_menu_id::DEV_MODE, ShellAction::ToggleDevMode),
            (
                app_menu_id::CHECK_LATEST_BUILD,
                ShellAction::CheckLatestBuild,
            ),
            (app_menu_id::QUIT, ShellAction::Quit),
            (tray_menu_id::OPEN_DASHBOARD, ShellAction::OpenDashboard),
            (tray_menu_id::TRACKING_TOGGLE, ShellAction::ToggleTracking),
            (
                tray_menu_id::PAUSE_FOR_15,
                ShellAction::PauseTrackingFor(15),
            ),
            (
                tray_menu_id::PAUSE_FOR_30,
                ShellAction::PauseTrackingFor(30),
            ),
            (
                tray_menu_id::PAUSE_FOR_60,
                ShellAction::PauseTrackingFor(60),
            ),
            (
                tray_menu_id::PAUSE_FOREVER,
                ShellAction::PauseTrackingForever,
            ),
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
            tray_menu_id::DRIFT_SUMMARY,
            tray_menu_id::PAUSE_HEADER,
            tray_menu_id::PAUSE_STATUS,
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
            tray_menu_id::DRIFT_SUMMARY,
            tray_menu_id::PAUSE_HEADER,
            tray_menu_id::PAUSE_STATUS,
            "unknown",
        ] {
            assert_eq!(ShellAction::from_tray_menu_id(id), None);
        }

        assert_eq!(
            ShellAction::from_tray_menu_id("menu-toggle-theme"),
            None,
            "the removed tray-only theme shortcut must not remain dispatchable"
        );
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
    fn trial_menu_opens_account_settings_once() {
        let mut target = FakeTarget::default();
        assert!(ShellAction::from_app_menu_id(tray_menu_id::TRIAL_STATUS).is_none());
        dispatch_to_target(ShellAction::from_tray_menu_id(tray_menu_id::TRIAL_STATUS).unwrap(), &mut target);
        assert_eq!(target.effects, vec![ShellActionEffect::RevealMainWindow, ShellActionEffect::EmitMainWindowEvent("tray-open-account-settings")]);
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
                ShellAction::PauseTrackingFor(15),
                &[ShellActionEffect::PauseTrackingFor(15)][..],
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
            (
                ShellAction::WhatsNew,
                &[
                    ShellActionEffect::RevealMainWindow,
                    ShellActionEffect::EmitMainWindowEvent(EVENT_OPEN_WHATS_NEW),
                ][..],
            ),
            (ShellAction::Quit, &[ShellActionEffect::RequestQuit][..]),
        ];

        for (action, expected_effects) in cases {
            let mut target = FakeTarget::default();
            dispatch_to_target(action, &mut target);
            assert_eq!(target.effects, expected_effects, "{action:?}");
        }
    }
}
