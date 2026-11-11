//! The app owns the browser content permit independently of tracker SQLite.
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use uuid::Uuid;

const PERMIT_PATH_ENV: &str = "DRIFTY_BROWSER_CONTENT_PERMIT_PATH";
pub(super) const SESSION_ENV: &str = "DRIFTY_BROWSER_CONTENT_SESSION";

static LOCATION: OnceLock<PathBuf> = OnceLock::new();

/// Keep the gate outside the replaceable app data directory, on both desktop OSes.
pub(super) fn configure(local_data: &Path, identifier: &str) {
    if local_data.is_absolute() {
        let _ = LOCATION.set(local_data.join(format!(".{identifier}.browser-content-permit.v1")));
    }
}

pub(super) fn location() -> io::Result<&'static Path> {
    LOCATION.get().map(PathBuf::as_path).ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::NotFound,
            "browser content permit directory unavailable",
        )
    })
}

pub(super) fn configure_command(command: &mut Command) {
    command.env(SESSION_ENV, permit().session());
    match location() {
        Ok(path) => {
            command.env(PERMIT_PATH_ENV, path);
        }
        // The tracker must never reuse a path inherited from the app's parent.
        Err(_) => {
            command.env_remove(PERMIT_PATH_ENV);
        }
    }
}

pub(super) struct BrowserContentPermit {
    session: String,
    choice: Mutex<Option<(String, bool)>>,
}

pub(super) fn permit() -> &'static BrowserContentPermit {
    static PERMIT: OnceLock<BrowserContentPermit> = OnceLock::new();
    PERMIT.get_or_init(BrowserContentPermit::new)
}

impl BrowserContentPermit {
    fn new() -> Self {
        Self {
            session: Uuid::new_v4().simple().to_string(),
            choice: Mutex::new(None),
        }
    }

    pub(super) fn session(&self) -> &str {
        &self.session
    }

    /// Revoke independently of the tracker RPC queue. OFF needs no file creation.
    pub(super) fn choose(&self, target: &Path, enabled: bool) -> io::Result<String> {
        let mut choice = self
            .choice
            .lock()
            .map_err(|_| io::Error::other("browser content permit unavailable"))?;
        let generation = Uuid::new_v4().simple().to_string();
        // Invalidate an earlier ON confirmation even when revocation itself fails.
        *choice = Some((generation.clone(), enabled));
        match fs::remove_file(target) {
            Ok(()) => Ok(generation),
            Err(error)
                if error.kind() == io::ErrorKind::NotFound
                    && target.parent().is_some_and(Path::is_dir) =>
            {
                Ok(generation)
            }
            Err(error) => Err(error),
        }
    }

    /// Only the app's current ON intent can grant, after SQLite confirms it.
    pub(super) fn confirm_on(&self, target: &Path, generation: &str) -> io::Result<()> {
        let choice = self
            .choice
            .lock()
            .map_err(|_| io::Error::other("browser content permit unavailable"))?;
        if !matches!(choice.as_ref(), Some((id, true)) if id == generation) {
            return Ok(());
        }
        let parent = target
            .parent()
            .ok_or_else(|| io::Error::other("browser content permit directory unavailable"))?;
        let body = format!("v1:{}:{}\n", self.session, generation);
        if fs::symlink_metadata(target).is_ok_and(|metadata| metadata.is_file()) {
            let mut current = Vec::new();
            if fs::File::open(target)
                .and_then(|file| file.take(70).read_to_end(&mut current))
                .is_ok()
                && current == body.as_bytes()
            {
                return Ok(());
            }
        }
        let mut staged = tempfile::NamedTempFile::new_in(parent)?;
        staged.write_all(body.as_bytes())?;
        staged.as_file().sync_all()?;
        staged.persist(target).map_err(|error| error.error)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn off_revokes_without_sqlite_and_rejects_stale_on_completion() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("never-opened.sqlite3");
        let target = dir.path().join(".so.drifty.qa.browser-content-permit.v1");
        let gate = BrowserContentPermit::new();
        let original = gate.choose(&target, true).unwrap();
        gate.confirm_on(&target, &original).unwrap();
        assert!(target.exists());

        let awaiting_on = gate.choose(&target, true).unwrap();
        let off = gate.choose(&target, false).unwrap();
        gate.confirm_on(&target, &awaiting_on).unwrap();
        gate.confirm_on(&target, &off).unwrap();
        assert!(!target.exists());

        let new_on = gate.choose(&target, true).unwrap();
        assert!(!target.exists());
        gate.confirm_on(&target, &new_on).unwrap();
        assert_eq!(
            fs::read_to_string(target).unwrap(),
            format!("v1:{}:{}\n", gate.session(), new_on)
        );
        assert!(!db.exists());
    }

    #[test]
    fn off_surfaces_a_revocation_failure_and_a_new_app_has_a_new_session() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join(".so.drifty.qa.browser-content-permit.v1");
        fs::create_dir(&target).unwrap();
        let gate = BrowserContentPermit::new();
        assert!(gate.choose(&target, false).is_err());
        assert!(target.is_dir());
        let unavailable = dir.path().join("unavailable").join("permit");
        assert!(gate.choose(&unavailable, false).is_err());
        assert_ne!(gate.session(), BrowserContentPermit::new().session());
    }
}
