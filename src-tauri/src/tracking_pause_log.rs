//! Pause outcomes on disk, next to the tracker database.
//!
//! Drifty's stderr is discarded in a packaged app, so a pause that misbehaved
//! used to leave no trace. The app and the tracker append one line per outcome
//! here (counts and timings only, never activity), keeping two files of at
//! most 256 KiB.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;

use chrono::{DateTime, SecondsFormat, Utc};
use tauri::AppHandle;

const LOG_FILE_NAME: &str = "tracking-pause.log";
const ROLLED_LOG_FILE_NAME: &str = "tracking-pause.log.1";
const LOG_MAX_BYTES: u64 = 256 * 1024;
const FIELD_MAX_CHARS: usize = 200;

pub(crate) fn record(app: &AppHandle, event: &str, fields: &[(&str, String)]) {
    let db_path = crate::tracker::resolve_db_path(app);
    if let Some(directory) = db_path.parent() {
        record_in(directory, event, fields, Utc::now(), LOG_MAX_BYTES);
    }
}

fn record_in(
    directory: &Path,
    event: &str,
    fields: &[(&str, String)],
    now: DateTime<Utc>,
    max_bytes: u64,
) {
    let path = directory.join(LOG_FILE_NAME);
    if fs::metadata(&path).map(|metadata| metadata.len() > max_bytes).unwrap_or(false) {
        let _ = fs::rename(&path, directory.join(ROLLED_LOG_FILE_NAME));
    }
    let mut line = format!(
        "{} app {event}",
        now.to_rfc3339_opts(SecondsFormat::Millis, false)
    );
    for (key, value) in fields {
        let value: String = value
            .chars()
            .map(|character| if character.is_control() { ' ' } else { character })
            .take(FIELD_MAX_CHARS)
            .collect();
        line.push_str(&format!(" {key}={value}"));
    }
    line.push('\n');
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = file.write_all(line.as_bytes());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use tempfile::tempdir;

    #[test]
    fn appends_one_line_per_outcome_and_rolls_over_when_large() {
        let directory = tempdir().expect("tempdir");
        let now = Utc.with_ymd_and_hms(2026, 11, 23, 0, 24, 25).unwrap();
        record_in(
            directory.path(),
            "stop_still_running",
            &[("pause", "indefinite".into()), ("error", "line\nbreak".into())],
            now,
            120,
        );
        let log = fs::read_to_string(directory.path().join(LOG_FILE_NAME)).expect("log");
        assert_eq!(
            log,
            "2026-11-23T00:24:25.000+00:00 app stop_still_running pause=indefinite error=line break\n"
        );
        record_in(directory.path(), "stop_confirmed", &[], now, 120);
        record_in(directory.path(), "stop_confirmed", &[], now, 120);
        assert!(directory.path().join(ROLLED_LOG_FILE_NAME).exists());
        assert_eq!(
            fs::read_to_string(directory.path().join(LOG_FILE_NAME)).expect("log"),
            "2026-11-23T00:24:25.000+00:00 app stop_confirmed\n"
        );
    }

    #[test]
    fn a_missing_directory_never_fails_the_caller() {
        let directory = tempdir().expect("tempdir");
        record_in(&directory.path().join("missing"), "stop_confirmed", &[], Utc::now(), LOG_MAX_BYTES);
    }
}
