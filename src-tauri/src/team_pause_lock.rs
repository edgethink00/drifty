//! Managed team tracking (owner decision 2026-10-17): during a managed team's
//! recording hours its members cannot pause. The app sends the spans of time
//! when that holds, already turned from the team's hours and time zone into
//! Unix seconds. They are kept on disk so the rule holds after a restart, and
//! every pause path asks here first.

use std::{
    fs, io,
    path::{Path, PathBuf},
    sync::Mutex,
};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

const LOCK_FILE_NAME: &str = "team-pause-lock.json";
const MAX_SPANS: usize = 400;
const MAX_TEAM_NAME_CHARS: usize = 120;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PauseLockSpan {
    pub(crate) team_name: String,
    pub(crate) starts_at: i64,
    pub(crate) ends_at: i64,
}

#[derive(Default)]
pub(crate) struct TeamPauseLockState(Mutex<Vec<PauseLockSpan>>);

/// The span holding `now`, the one ending last when teams overlap.
pub(crate) fn active_span(spans: &[PauseLockSpan], now: i64) -> Option<&PauseLockSpan> {
    spans
        .iter()
        .filter(|span| span.starts_at <= now && now < span.ends_at)
        .max_by_key(|span| span.ends_at)
}

fn validate(spans: Vec<PauseLockSpan>) -> Result<Vec<PauseLockSpan>, String> {
    if spans.len() > MAX_SPANS {
        return Err(format!(
            "At most {MAX_SPANS} pause-lock spans are accepted."
        ));
    }
    for span in &spans {
        let name = span.team_name.trim();
        if name.is_empty() || name.chars().count() > MAX_TEAM_NAME_CHARS {
            return Err("A pause-lock span needs a team name.".to_string());
        }
        if span.ends_at <= span.starts_at {
            return Err("A pause-lock span must end after it starts.".to_string());
        }
    }
    Ok(spans)
}

fn lock_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|directory| directory.join(LOCK_FILE_NAME))
        .map_err(|error| format!("Could not resolve the team pause-lock path: {error}"))
}

fn write_spans(path: &Path, spans: &[PauseLockSpan]) -> Result<(), String> {
    if spans.is_empty() {
        return match fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!("Could not clear the team pause lock: {error}")),
        };
    }
    let parent = path
        .parent()
        .ok_or_else(|| "The team pause-lock path has no parent directory".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not create the team pause-lock directory: {error}"))?;
    let temp_path = parent.join(format!(".{LOCK_FILE_NAME}.{}.tmp", std::process::id()));
    let bytes = serde_json::to_vec(spans)
        .map_err(|error| format!("Could not encode the team pause lock: {error}"))?;
    fs::write(&temp_path, bytes)
        .map_err(|error| format!("Could not write the team pause lock: {error}"))?;
    fs::rename(&temp_path, path)
        .map_err(|error| format!("Could not install the team pause lock: {error}"))
}

fn read_spans(path: &Path) -> Vec<PauseLockSpan> {
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Vec<PauseLockSpan>>(&bytes).ok())
        .and_then(|spans| validate(spans).ok())
        .unwrap_or_default()
}

/// Why a pause is refused right now, or `None` when pausing is allowed.
pub(crate) fn refusal(app: &AppHandle) -> Option<String> {
    let state = app.try_state::<TeamPauseLockState>()?;
    let spans = state.0.lock().ok()?;
    active_span(&spans, Utc::now().timestamp()).map(|span| {
        format!(
            "{} keeps tracking on during its work hours.",
            span.team_name.trim()
        )
    })
}

/// Loads the spans saved before the app last quit.
pub(crate) fn restore(app: &AppHandle) {
    let Ok(path) = lock_path(app) else {
        return;
    };
    let spans = read_spans(&path);
    if let Ok(mut current) = app.state::<TeamPauseLockState>().0.lock() {
        *current = spans;
    }
}

/// Says, from a menu that has no window of its own, why the pause did not happen.
pub(crate) fn notify_refusal(app: &AppHandle) {
    let language = crate::tray::latest_tray_language(app);
    let _ = app
        .notification()
        .builder()
        .title(language.pick(
            "Tracking stays on",
            "기록이 계속돼요",
            "El registro sigue activo",
        ))
        .body(language.pick(
            "Your team keeps tracking on during its work hours.",
            "팀 업무 시간에는 기록을 멈출 수 없어요.",
            "Tu equipo mantiene el registro activo durante su horario laboral.",
        ))
        .show();
}

#[tauri::command]
pub fn tracker_set_team_pause_lock(
    app: AppHandle,
    spans: Vec<PauseLockSpan>,
) -> Result<(), String> {
    let spans = validate(spans)?;
    write_spans(&lock_path(&app)?, &spans)?;
    let state = app.state::<TeamPauseLockState>();
    let mut current = state
        .0
        .lock()
        .map_err(|_| "The team pause lock is unavailable.".to_string())?;
    *current = spans;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn span(team_name: &str, starts_at: i64, ends_at: i64) -> PauseLockSpan {
        PauseLockSpan {
            team_name: team_name.to_string(),
            starts_at,
            ends_at,
        }
    }

    #[test]
    fn finds_the_span_holding_now_and_ignores_the_rest() {
        let spans = vec![
            span("Sales", 100, 200),
            span("Ops", 150, 300),
            span("Later", 400, 500),
        ];
        assert_eq!(active_span(&spans, 99), None);
        assert_eq!(
            active_span(&spans, 120).map(|span| span.team_name.as_str()),
            Some("Sales")
        );
        assert_eq!(
            active_span(&spans, 160).map(|span| span.team_name.as_str()),
            Some("Ops")
        );
        assert_eq!(active_span(&spans, 300), None);
    }

    #[test]
    fn refuses_malformed_spans() {
        assert!(validate(vec![span("Sales", 200, 200)]).is_err());
        assert!(validate(vec![span("  ", 100, 200)]).is_err());
        assert!(validate(vec![span("Sales", 100, 200)]).is_ok());
        assert!(validate(
            (0..=MAX_SPANS as i64)
                .map(|index| span("Sales", index, index + 1))
                .collect()
        )
        .is_err());
    }

    #[test]
    fn keeps_spans_across_a_restart_and_clears_the_file_when_none_remain() {
        let directory =
            std::env::temp_dir().join(format!("drifty-team-pause-lock-{}", std::process::id()));
        let path = directory.join(LOCK_FILE_NAME);
        let spans = vec![span("Sales", 100, 200)];
        write_spans(&path, &spans).unwrap();
        assert_eq!(read_spans(&path), spans);
        write_spans(&path, &[]).unwrap();
        assert!(!path.exists());
        assert!(read_spans(&path).is_empty());
        fs::write(&path, b"not json").unwrap();
        assert!(read_spans(&path).is_empty());
        let _ = fs::remove_dir_all(&directory);
    }
}
