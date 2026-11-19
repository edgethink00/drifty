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
    pub(crate) const FOCUS_SUBMENU: &str = "menu-focus-start";
    pub(crate) const FOCUS_START_30: &str = "menu-focus-start-30";
    pub(crate) const FOCUS_START_60: &str = "menu-focus-start-60";
    pub(crate) const FOCUS_START_120: &str = "menu-focus-start-120";
    pub(crate) const FOCUS_START_240: &str = "menu-focus-start-240";
    pub(crate) const FOCUS_START_CUSTOM: &str = "menu-focus-start-custom";
    pub(crate) const FOCUS_POMODORO_HEADER: &str = "menu-focus-pomodoro-header";
    pub(crate) const FOCUS_START_POMODORO: &str = "menu-focus-start-pomodoro";
    pub(crate) const FOCUS_START_POMODORO_50: &str = "menu-focus-start-pomodoro-50";
    pub(crate) const FOCUS_START_POMODORO_CUSTOM: &str = "menu-focus-start-pomodoro-custom";
    pub(crate) const FOCUS_STATUS: &str = "menu-focus-status";
    pub(crate) const FOCUS_SKIP_BREAK: &str = "menu-focus-skip-break";
    pub(crate) const FOCUS_END: &str = "menu-focus-end";
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
    /// A focus session from the menu bar; the renderer starts or ends it.
    StartFocusSession(FocusPreset),
    /// A pomodoro break's Skip break, for when its card has closed.
    SkipFocusBreak,
    EndFocusSession,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum FocusPreset {
    Minutes30,
    Minutes60,
    Minutes120,
    Minutes240,
    /// Opens the main window's dialog for a length the user types.
    Custom,
    Pomodoro,
    Pomodoro50,
    /// Opens the main window's dialog for focus, break and rounds.
    PomodoroCustom,
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
            tray_menu_id::FOCUS_START_30 => Some(Self::StartFocusSession(FocusPreset::Minutes30)),
            tray_menu_id::FOCUS_START_60 => Some(Self::StartFocusSession(FocusPreset::Minutes60)),
            tray_menu_id::FOCUS_START_120 => Some(Self::StartFocusSession(FocusPreset::Minutes120)),
            tray_menu_id::FOCUS_START_240 => Some(Self::StartFocusSession(FocusPreset::Minutes240)),
            tray_menu_id::FOCUS_START_CUSTOM => Some(Self::StartFocusSession(FocusPreset::Custom)),
            tray_menu_id::FOCUS_START_POMODORO => Some(Self::StartFocusSession(FocusPreset::Pomodoro)),
            tray_menu_id::FOCUS_START_POMODORO_50 => Some(Self::StartFocusSession(FocusPreset::Pomodoro50)),
            tray_menu_id::FOCUS_START_POMODORO_CUSTOM => Some(Self::StartFocusSession(FocusPreset::PomodoroCustom)),
            tray_menu_id::FOCUS_SKIP_BREAK => Some(Self::SkipFocusBreak),
            tray_menu_id::FOCUS_END => Some(Self::EndFocusSession),
            _ => None,
        }
    }
}

const EVENT_OPEN_SETTINGS: &str = "tray-open-settings";
const EVENT_CHECK_FOR_UPDATES: &str = "tray-check-for-updates";
const EVENT_TOGGLE_DEV_MODE: &str = "app-menu-toggle-dev-mode";
const EVENT_CHECK_LATEST_BUILD: &str = "app-menu-check-latest-build";
const EVENT_OPEN_WHATS_NEW: &str = "app-menu-open-whats-new";

/// The update check is the one main-window event sent without revealing the
/// window first. When WebView2 could not create that window, nothing received
/// it and the menu item did nothing. Give it the open request's recovery
/// instead: one more creation attempt, then the native guidance.
#[cfg(any(test, target_os = "windows"))]
fn update_check_needs_window_recovery(event: &str, main_window_available: bool) -> bool {
    event == EVENT_CHECK_FOR_UPDATES && !main_window_available
}

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
            Self::StartFocusSession(FocusPreset::Minutes30) => &[
                ShellActionEffect::EmitMainWindowEvent("tray-focus-session-start-30"),
            ],
            Self::StartFocusSession(FocusPreset::Minutes60) => &[
                ShellActionEffect::EmitMainWindowEvent("tray-focus-session-start-60"),
            ],
            Self::StartFocusSession(FocusPreset::Minutes120) => &[
                ShellActionEffect::EmitMainWindowEvent("tray-focus-session-start-120"),
            ],
            Self::StartFocusSession(FocusPreset::Minutes240) => &[
                ShellActionEffect::EmitMainWindowEvent("tray-focus-session-start-240"),
            ],
            // The custom rows ask in the main window, so it comes forward first.
            Self::StartFocusSession(FocusPreset::Custom) => &[
                ShellActionEffect::RevealMainWindow,
                ShellActionEffect::EmitMainWindowEvent("tray-focus-session-start-custom"),
            ],
            Self::StartFocusSession(FocusPreset::Pomodoro) => &[
                ShellActionEffect::EmitMainWindowEvent("tray-focus-session-start-pomodoro"),
            ],
            Self::StartFocusSession(FocusPreset::Pomodoro50) => &[
                ShellActionEffect::EmitMainWindowEvent("tray-focus-session-start-pomodoro-50"),
            ],
            Self::StartFocusSession(FocusPreset::PomodoroCustom) => &[
                ShellActionEffect::RevealMainWindow,
                ShellActionEffect::EmitMainWindowEvent("tray-focus-session-start-pomodoro-custom"),
            ],
            Self::SkipFocusBreak => &[
                ShellActionEffect::EmitMainWindowEvent("tray-focus-session-skip-break"),
            ],
            Self::EndFocusSession => &[
                ShellActionEffect::EmitMainWindowEvent("tray-focus-session-end"),
            ],
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
        #[cfg(target_os = "windows")]
        if update_check_needs_window_recovery(event, crate::main_window_is_available(self.app)) {
            request_main_window(self.app);
            return;
        }
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

    #[test]
    fn only_a_windowless_update_check_falls_back_to_window_recovery() {
        assert!(update_check_needs_window_recovery(EVENT_CHECK_FOR_UPDATES, false));
        assert!(!update_check_needs_window_recovery(EVENT_CHECK_FOR_UPDATES, true));
        // The other events already reveal (and so recover) the window first.
        for event in [
            EVENT_OPEN_SETTINGS,
            EVENT_OPEN_WHATS_NEW,
            EVENT_TOGGLE_DEV_MODE,
            EVENT_CHECK_LATEST_BUILD,
        ] {
            assert!(!update_check_needs_window_recovery(event, false), "{event}");
        }
    }

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

    #[test]
    fn focus_session_rows_hand_the_choice_to_the_main_window_without_opening_it() {
        for (id, event) in [
            (tray_menu_id::FOCUS_START_30, "tray-focus-session-start-30"),
            (tray_menu_id::FOCUS_START_60, "tray-focus-session-start-60"),
            (tray_menu_id::FOCUS_START_120, "tray-focus-session-start-120"),
            (tray_menu_id::FOCUS_START_240, "tray-focus-session-start-240"),
            (tray_menu_id::FOCUS_START_POMODORO, "tray-focus-session-start-pomodoro"),
            (tray_menu_id::FOCUS_START_POMODORO_50, "tray-focus-session-start-pomodoro-50"),
            (tray_menu_id::FOCUS_SKIP_BREAK, "tray-focus-session-skip-break"),
            (tray_menu_id::FOCUS_END, "tray-focus-session-end"),
        ] {
            let action = ShellAction::from_tray_menu_id(id).expect(id);
            assert_eq!(ShellAction::from_app_menu_id(id), None, "{id}");
            let mut target = FakeTarget::default();
            dispatch_to_target(action, &mut target);
            assert_eq!(target.effects, [ShellActionEffect::EmitMainWindowEvent(event)], "{id}");
        }
        for (id, event) in [
            (tray_menu_id::FOCUS_START_CUSTOM, "tray-focus-session-start-custom"),
            (tray_menu_id::FOCUS_START_POMODORO_CUSTOM, "tray-focus-session-start-pomodoro-custom"),
        ] {
            let mut target = FakeTarget::default();
            dispatch_to_target(ShellAction::from_tray_menu_id(id).expect(id), &mut target);
            assert_eq!(
                target.effects,
                [ShellActionEffect::RevealMainWindow, ShellActionEffect::EmitMainWindowEvent(event)],
                "{id}"
            );
        }
        for label in [tray_menu_id::FOCUS_SUBMENU, tray_menu_id::FOCUS_STATUS, tray_menu_id::FOCUS_POMODORO_HEADER] {
            assert_eq!(ShellAction::from_tray_menu_id(label), None, "{label}");
        }
    }
}
