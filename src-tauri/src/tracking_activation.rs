//! Device-scoped record of whether the user has ever started tracking here.
//!
//! This is deliberately separate from both authentication and the pause state:
//!
//! - Authentication controls cloud access. Local capture must survive sign-out,
//!   offline launches, and transient session-refresh failures.
//! - The pause state records an explicit user decision to stop. A first run that
//!   has never been activated is not paused, and must not be reported as paused.
//!
//! Startup therefore starts the daemon only when tracking has been activated on
//! this device and no pause is active.

use std::{
    fs, io,
    path::{Path, PathBuf},
};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const ACTIVATION_STATE_FILE_NAME: &str = "tracking-activation.json";
const ACTIVATION_STATE_VERSION: u8 = 1;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedActivation {
    version: u8,
    activated_at_unix_seconds: i64,
}

impl PersistedActivation {
    fn new(activated_at_unix_seconds: i64) -> Self {
        Self {
            version: ACTIVATION_STATE_VERSION,
            activated_at_unix_seconds,
        }
    }

    fn is_valid(self) -> bool {
        self.version == ACTIVATION_STATE_VERSION
    }
}

fn activation_state_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|directory| directory.join(ACTIVATION_STATE_FILE_NAME))
        .map_err(|error| format!("Could not resolve tracking-activation state path: {error}"))
}

fn write_activation(path: &Path, activation: PersistedActivation) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Tracking-activation state path has no parent directory".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not create tracking-activation directory: {error}"))?;
    let temp_path = parent.join(format!(
        ".{ACTIVATION_STATE_FILE_NAME}.{}.tmp",
        std::process::id()
    ));
    let bytes = serde_json::to_vec(&activation)
        .map_err(|error| format!("Could not encode tracking-activation state: {error}"))?;
    fs::write(&temp_path, bytes)
        .map_err(|error| format!("Could not write tracking-activation state: {error}"))?;
    // Rename so a crash mid-write cannot leave a half-written activation record.
    fs::rename(&temp_path, path)
        .map_err(|error| format!("Could not install tracking-activation state: {error}"))?;
    Ok(())
}

fn read_activation(path: &Path) -> Result<bool, String> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(format!("Could not read tracking-activation state: {error}")),
    };
    match serde_json::from_slice::<PersistedActivation>(&bytes) {
        Ok(activation) if activation.is_valid() => Ok(true),
        Ok(_) => Err("Tracking-activation state is invalid".to_string()),
        Err(error) => Err(format!("Could not decode tracking-activation state: {error}")),
    }
}

/// Evidence that this device was tracking before activation was introduced.
///
/// A tracker database alone is not sufficient. Drifty 1.10.8 started capture at
/// launch, so a user who merely opened it once also has a database, and adopting
/// that as prior use would preserve exactly the behavior this change removes.
/// The database must therefore predate the first release that gates capture.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct PriorUseEvidence {
    /// The tracker database exists on disk.
    pub(crate) tracker_database_exists: bool,
    /// The database was created before capture became gated. `None` when the
    /// creation time is unavailable, which some filesystems do not report.
    pub(crate) tracker_database_predates_gating: Option<bool>,
    /// A pause was recorded, which only an explicit user action can create.
    pub(crate) has_pause_state: bool,
}

impl PriorUseEvidence {
    pub(crate) fn indicates_prior_use(self) -> bool {
        // A pause is an unambiguous user decision to stop tracking that was
        // already running, so it establishes prior use on its own.
        if self.has_pause_state {
            return true;
        }
        if !self.tracker_database_exists {
            return false;
        }
        // Without a creation time the database cannot be dated. Adopt it rather
        // than silently stopping an established user; the cost of the opposite
        // error is losing real tracking for someone who never asked to stop.
        self.tracker_database_predates_gating.unwrap_or(true)
    }
}

/// Unix seconds for 2026-09-06T00:00:00Z, the day 1.10.8 shipped.
///
/// A database created on or after this instant may be the 1.10.8 pre-onboarding
/// capture rather than genuine prior use, so it does not establish activation.
pub(crate) const CAPTURE_GATING_RELEASE_UNIX_SECONDS: i64 = 1_788_652_800;

/// Collect prior-use evidence for this device.
pub(crate) fn collect_prior_use_evidence(
    tracker_database_path: &Path,
    pause_state_path: &Path,
) -> PriorUseEvidence {
    let metadata = fs::metadata(tracker_database_path).ok();
    let tracker_database_predates_gating = metadata.as_ref().and_then(|metadata| {
        let created = metadata.created().ok()?;
        let seconds = created
            .duration_since(std::time::UNIX_EPOCH)
            .ok()?
            .as_secs() as i64;
        Some(seconds < CAPTURE_GATING_RELEASE_UNIX_SECONDS)
    });
    PriorUseEvidence {
        tracker_database_exists: metadata.is_some(),
        tracker_database_predates_gating,
        has_pause_state: pause_state_path.exists(),
    }
}

/// Whether this device has ever started tracking.
///
/// An unreadable or malformed record is treated as not activated so a genuinely
/// new install cannot capture before the user starts it. Existing installs are
/// recognized by migrate_existing_install, which runs before this check.
pub(crate) fn is_activated(app: &AppHandle) -> bool {
    let Ok(path) = activation_state_path(app) else {
        return false;
    };
    match read_activation(&path) {
        Ok(activated) => activated,
        Err(error) => {
            eprintln!("[tracker] {error}; treating this device as not activated");
            false
        }
    }
}

/// Record that the user has started tracking on this device.
///
/// Callers must treat a failure as fatal to the start attempt: starting without a
/// durable record would silently return to the ambiguous earlier behavior on the
/// next launch.
pub(crate) fn activate(app: &AppHandle) -> Result<(), String> {
    let path = activation_state_path(app)?;
    if read_activation(&path).unwrap_or(false) {
        return Ok(());
    }
    write_activation(&path, PersistedActivation::new(Utc::now().timestamp()))
}

/// Adopt installs that were already tracking before activation existed.
///
/// Without this, upgrading users would silently stop being tracked until they
/// pressed start again. Prior use is inferred from the tracker database, which
/// only exists once the daemon has recorded something.
pub(crate) fn migrate_existing_install(app: &AppHandle, evidence: PriorUseEvidence) {
    if !evidence.indicates_prior_use() {
        return;
    }
    let Ok(path) = activation_state_path(app) else {
        return;
    };
    if read_activation(&path).unwrap_or(false) {
        return;
    }
    if let Err(error) = write_activation(&path, PersistedActivation::new(Utc::now().timestamp())) {
        eprintln!("[tracker] Could not adopt existing install as activated: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn evidence(
        tracker_database_exists: bool,
        tracker_database_predates_gating: Option<bool>,
        has_pause_state: bool,
    ) -> PriorUseEvidence {
        PriorUseEvidence {
            tracker_database_exists,
            tracker_database_predates_gating,
            has_pause_state,
        }
    }

    #[test]
    fn a_database_from_before_gating_indicates_prior_use() {
        assert!(evidence(true, Some(true), false).indicates_prior_use());
    }

    #[test]
    fn a_database_created_after_gating_does_not_indicate_prior_use() {
        // This is the 1.10.8 pre-onboarding capture: adopting it would preserve
        // the behavior this change exists to remove.
        assert!(!evidence(true, Some(false), false).indicates_prior_use());
    }

    #[test]
    fn a_pause_indicates_prior_use_even_without_a_datable_database() {
        // Only an explicit user action writes a pause, so tracking was running.
        assert!(evidence(true, Some(false), true).indicates_prior_use());
        assert!(evidence(false, None, true).indicates_prior_use());
    }

    #[test]
    fn an_undatable_database_is_adopted_rather_than_stopping_a_real_user() {
        assert!(evidence(true, None, false).indicates_prior_use());
    }

    #[test]
    fn a_fresh_install_does_not_indicate_prior_use() {
        assert!(!evidence(false, None, false).indicates_prior_use());
    }

    #[test]
    fn collected_evidence_reflects_missing_files() {
        let directory = tempfile::tempdir().expect("temp dir");
        let collected = collect_prior_use_evidence(
            &directory.path().join("tracker.sqlite3"),
            &directory.path().join("tracking-pause.json"),
        );
        assert!(!collected.tracker_database_exists);
        assert!(!collected.has_pause_state);
        assert!(!collected.indicates_prior_use());
    }

    #[test]
    fn collected_evidence_dates_a_newly_created_database_as_after_gating() {
        let directory = tempfile::tempdir().expect("temp dir");
        let database = directory.path().join("tracker.sqlite3");
        fs::write(&database, b"").expect("write");
        let collected = collect_prior_use_evidence(&database, &directory.path().join("tracking-pause.json"));
        assert!(collected.tracker_database_exists);
        // A file created during this test is necessarily after the release date.
        assert_eq!(collected.tracker_database_predates_gating, Some(false));
        assert!(!collected.indicates_prior_use());
    }

    #[test]
    fn missing_state_reads_as_not_activated() {
        let directory = tempfile::tempdir().expect("temp dir");
        let path = directory.path().join(ACTIVATION_STATE_FILE_NAME);
        assert_eq!(read_activation(&path), Ok(false));
    }

    #[test]
    fn written_state_reads_back_as_activated() {
        let directory = tempfile::tempdir().expect("temp dir");
        let path = directory.path().join(ACTIVATION_STATE_FILE_NAME);
        write_activation(&path, PersistedActivation::new(1_700_000_000)).expect("write");
        assert_eq!(read_activation(&path), Ok(true));
    }

    #[test]
    fn unknown_version_is_rejected_rather_than_assumed_active() {
        let directory = tempfile::tempdir().expect("temp dir");
        let path = directory.path().join(ACTIVATION_STATE_FILE_NAME);
        fs::write(
            &path,
            serde_json::to_vec(&serde_json::json!({
                "version": ACTIVATION_STATE_VERSION + 1,
                "activatedAtUnixSeconds": 1_700_000_000,
            }))
            .expect("encode"),
        )
        .expect("write");
        assert!(read_activation(&path).is_err());
    }

    #[test]
    fn corrupt_state_is_rejected_rather_than_assumed_active() {
        let directory = tempfile::tempdir().expect("temp dir");
        let path = directory.path().join(ACTIVATION_STATE_FILE_NAME);
        fs::write(&path, b"not json").expect("write");
        assert!(read_activation(&path).is_err());
    }
}
