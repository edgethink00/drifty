//! A focus session the user started: 30 minutes, 1, 2 or 4 hours or a length
//! the user typed, or a pomodoro (25 + 5 or 50 + 10 minutes × 4, or the
//! user's own focus, break and rounds).
//!
//! The session lives in the main window's renderer. It sends the shell a copy
//! with every phase already laid out, so the menu bar can show the time left
//! beside the icon and a status row without asking the WebView every second,
//! and the pet window can sleep through a pomodoro break. The menu bar's start
//! and end choices go back to the renderer as main-window events
//! (shell_action.rs). Nothing here is persisted: after a relaunch the
//! renderer sends its session again.

use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex,
};
use std::time::Duration;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

pub(crate) const CHANGED_EVENT: &str = "focus-session://changed";
/// The longest session the renderer accepts (a day) plus a moment for its
/// clock to run ahead; a stale renderer cannot hold the menu bar longer.
const MAX_SESSION_MS: i64 = (24 * 60 + 1) * 60 * 1000;
const MAX_PHASES: usize = 16;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum FocusPhaseKind {
    Focus,
    Break,
}

#[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FocusSessionPhase {
    pub(crate) kind: FocusPhaseKind,
    pub(crate) round: u32,
    pub(crate) rounds: u32,
    pub(crate) start_ms: i64,
    pub(crate) end_ms: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeFocusSession {
    pub(crate) id: String,
    pub(crate) mode: String,
    pub(crate) started_at_ms: i64,
    pub(crate) ends_at_ms: i64,
    pub(crate) phases: Vec<FocusSessionPhase>,
}

impl NativeFocusSession {
    pub(crate) fn is_pomodoro(&self) -> bool {
        self.mode == "pomodoro"
    }

    pub(crate) fn phase_at(&self, now_ms: i64) -> Option<&FocusSessionPhase> {
        if now_ms < self.started_at_ms || now_ms >= self.ends_at_ms {
            return None;
        }
        self.phases
            .iter()
            .find(|phase| now_ms >= phase.start_ms && now_ms < phase.end_ms)
    }
}

/// What the menu bar shows for a running session.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct FocusTrayView {
    pub(crate) on_break: bool,
    pub(crate) pomodoro: bool,
    pub(crate) round: u32,
    pub(crate) rounds: u32,
    /// Seconds left in the current phase, rounded up.
    pub(crate) phase_seconds_left: i64,
    /// The current phase's whole length in seconds.
    pub(crate) phase_seconds_total: i64,
    pub(crate) ends_at_unix_seconds: i64,
}

pub(crate) fn tray_view_at(session: &NativeFocusSession, now_ms: i64) -> Option<FocusTrayView> {
    let phase = session.phase_at(now_ms)?;
    Some(FocusTrayView {
        on_break: phase.kind == FocusPhaseKind::Break,
        pomodoro: session.is_pomodoro(),
        round: phase.round,
        rounds: phase.rounds,
        phase_seconds_left: ((phase.end_ms - now_ms) + 999) / 1000,
        phase_seconds_total: ((phase.end_ms - phase.start_ms) + 999) / 1000,
        ends_at_unix_seconds: session.ends_at_ms.div_euclid(1000),
    })
}

fn validated(session: Option<NativeFocusSession>, now_ms: i64) -> Result<Option<NativeFocusSession>, String> {
    let Some(session) = session else {
        return Ok(None);
    };
    if session.ends_at_ms <= now_ms {
        return Ok(None);
    }
    if session.ends_at_ms <= session.started_at_ms || session.ends_at_ms - now_ms > MAX_SESSION_MS {
        return Err("A focus session must end within a day.".to_string());
    }
    if session.phases.is_empty() || session.phases.len() > MAX_PHASES {
        return Err("A focus session needs between one and sixteen phases.".to_string());
    }
    let mut cursor = session.started_at_ms;
    for phase in &session.phases {
        if phase.start_ms < cursor || phase.end_ms <= phase.start_ms || phase.end_ms > session.ends_at_ms {
            return Err("Focus session phases must run in order inside the session.".to_string());
        }
        cursor = phase.end_ms;
    }
    if session.id.len() > 120 || session.mode.len() > 20 {
        return Err("Focus session id or mode is too long.".to_string());
    }
    Ok(Some(session))
}

#[derive(Debug, Default)]
pub(crate) struct FocusSessionState {
    session: Mutex<Option<NativeFocusSession>>,
    generation: AtomicU64,
}

impl FocusSessionState {
    fn snapshot(&self) -> Option<NativeFocusSession> {
        self.session
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }
}

fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

/// The running session's menu bar view, if one runs now.
pub(crate) fn current_tray_view(app: &AppHandle) -> Option<FocusTrayView> {
    let session = app.try_state::<FocusSessionState>()?.snapshot()?;
    tray_view_at(&session, now_ms())
}

#[tauri::command]
pub(crate) fn focus_session_set(
    app: AppHandle,
    state: State<'_, FocusSessionState>,
    session: Option<NativeFocusSession>,
) -> Result<(), String> {
    let session = validated(session, now_ms())?;
    {
        let mut latest = state
            .session
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if *latest == session {
            return Ok(());
        }
        *latest = session.clone();
    }
    let generation = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    let _ = app.emit(CHANGED_EVENT, session.clone());
    crate::tray::refresh_focus_session(&app);
    if session.is_some() {
        start_ticker(app, generation);
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn focus_session_get(state: State<'_, FocusSessionState>) -> Option<NativeFocusSession> {
    state.snapshot().filter(|session| session.ends_at_ms > now_ms())
}

/// How much of the current phase has passed, in sixtieths; the countdown ring
/// redraws only when this changes.
pub(crate) fn ring_step(view: FocusTrayView) -> u16 {
    if view.phase_seconds_total <= 0 {
        return 0;
    }
    let elapsed = (view.phase_seconds_total - view.phase_seconds_left).clamp(0, view.phase_seconds_total);
    ((elapsed * 60) / view.phase_seconds_total) as u16
}

/// Refreshes the menu bar title every second while this session runs, and
/// the menu at each phase boundary and at the end.
fn start_ticker(app: AppHandle, generation: u64) {
    let spawned = std::thread::Builder::new()
        .name("focus-session-tray".to_string())
        .spawn(move || {
            let mut last_phase: Option<(FocusPhaseKind, u32)> = None;
            let mut last_ring_step: Option<u16> = None;
            loop {
                let millis_to_next_second = 1000 - now_ms().rem_euclid(1000);
                std::thread::sleep(Duration::from_millis(millis_to_next_second as u64 + 5));
                let Some(state) = app.try_state::<FocusSessionState>() else {
                    return;
                };
                if state.generation.load(Ordering::SeqCst) != generation {
                    return;
                }
                let view = state
                    .snapshot()
                    .and_then(|session| session.phase_at(now_ms()).map(|phase| (phase.kind, phase.round)));
                if view.is_none() {
                    crate::tray::refresh_focus_session(&app);
                    return;
                }
                let ring = current_tray_view(&app).map(ring_step);
                if view != last_phase {
                    last_phase = view;
                    last_ring_step = ring;
                    crate::tray::refresh_focus_session(&app);
                } else if ring != last_ring_step {
                    last_ring_step = ring;
                    crate::tray::refresh_focus_session_icon(&app);
                    crate::tray::refresh_focus_session_title(&app);
                } else {
                    crate::tray::refresh_focus_session_title(&app);
                }
            }
        });
    if let Err(error) = spawned {
        eprintln!("[focus-session] Could not start the menu bar timer: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pomodoro(start: i64) -> NativeFocusSession {
        let minute = 60_000;
        let mut phases = Vec::new();
        let mut cursor = start;
        for round in 1..=4 {
            phases.push(FocusSessionPhase { kind: FocusPhaseKind::Focus, round, rounds: 4, start_ms: cursor, end_ms: cursor + 25 * minute });
            cursor += 25 * minute;
            if round < 4 {
                phases.push(FocusSessionPhase { kind: FocusPhaseKind::Break, round, rounds: 4, start_ms: cursor, end_ms: cursor + 5 * minute });
                cursor += 5 * minute;
            }
        }
        NativeFocusSession { id: "focus-a".into(), mode: "pomodoro".into(), started_at_ms: start, ends_at_ms: cursor, phases }
    }

    #[test]
    fn reads_the_phase_and_time_left_of_a_pomodoro() {
        let session = pomodoro(0);
        let view = tray_view_at(&session, 26 * 60_000 + 500).unwrap();
        assert!(view.on_break);
        assert_eq!((view.round, view.rounds), (1, 4));
        assert_eq!(view.phase_seconds_left, 4 * 60);
        let view = tray_view_at(&session, 31 * 60_000).unwrap();
        assert!(!view.on_break);
        assert_eq!(view.round, 2);
        assert!(tray_view_at(&session, 115 * 60_000).is_none());
    }

    #[test]
    fn accepts_a_session_in_order_and_drops_an_ended_one() {
        assert!(validated(Some(pomodoro(0)), 1_000).unwrap().is_some());
        assert!(validated(Some(pomodoro(0)), 200 * 60_000).unwrap().is_none());
        assert!(validated(None, 0).unwrap().is_none());
    }

    #[test]
    fn refuses_overlong_or_disordered_sessions() {
        let mut long = pomodoro(0);
        long.ends_at_ms = 25 * 60 * 60_000;
        assert!(validated(Some(long), 0).is_err());
        let mut disordered = pomodoro(0);
        disordered.phases.swap(0, 1);
        assert!(validated(Some(disordered), 0).is_err());
        let mut empty = pomodoro(0);
        empty.phases.clear();
        assert!(validated(Some(empty), 0).is_err());
    }
}
