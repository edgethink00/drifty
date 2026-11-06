use super::*;
use crate::CapturePreferences;
use rusqlite::OptionalExtension;
const MAX_PREFERENCES_BYTES: usize = 8192;

impl EvidenceStore {
    /// No catalog/key creation. Used to keep a first visit default-OFF without
    /// touching the OS credential store. Existing paths must be regular.
    pub fn exists_for_profile(root: &Path, scope: &ScopeId) -> Result<bool, Error> {
        if !root.is_absolute() {
            return Err(Error::Invalid("store path"));
        }
        for path in [root.to_path_buf(), root.join(scope.path_component())] {
            let metadata = match fs::symlink_metadata(&path) {
                Ok(value) => value,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
                Err(error) => return Err(error.into()),
            };
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                if metadata.file_attributes() & 0x400 != 0 {
                    return Err(Error::Storage);
                }
            }
            if !metadata.is_dir() || metadata.file_type().is_symlink() {
                return Err(Error::Storage);
            }
        }
        let catalog = root.join(scope.path_component()).join(CATALOG);
        Ok(regular(&catalog)? && fs::metadata(catalog)?.len() > 0)
    }

    pub fn read_preferences(&mut self, now: i64) -> Result<CapturePreferences, Error> {
        self.maintenance(now)?;
        let exists: bool = self.db.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='capture_preferences')", [], |r| r.get(0))?;
        if !exists {
            return Ok(CapturePreferences::default());
        }
        let sealed: Option<Vec<u8>> = self
            .db
            .query_row(
                "SELECT value FROM capture_preferences WHERE id=1",
                [],
                |r| r.get(0),
            )
            .optional()?;
        let Some(sealed) = sealed else {
            return Ok(CapturePreferences::default());
        };
        if sealed.len() > MAX_PREFERENCES_BYTES + 64 {
            return Err(Error::Authentication);
        }
        let clear = self.crypto.open(
            format!("preferences:{}", self.scope.path_component()).as_bytes(),
            &sealed,
        )?;
        let value: CapturePreferences =
            serde_json::from_slice(&clear).map_err(|_| Error::Authentication)?;
        value.validate()?;
        Ok(value)
    }

    pub(crate) fn save_preferences(
        &mut self,
        value: &CapturePreferences,
        now: i64,
        current: &dyn Fn() -> bool,
    ) -> Result<(), Error> {
        value.validate()?;
        self.maintenance(now)?;
        if !current() {
            return Err(Error::Invalidated);
        }
        let clear = Zeroizing::new(
            serde_json::to_vec(value).map_err(|_| Error::Invalid("capture preferences"))?,
        );
        if clear.len() > MAX_PREFERENCES_BYTES {
            return Err(Error::Invalid("capture preferences size"));
        }
        let sealed = self.crypto.seal(
            format!("preferences:{}", self.scope.path_component()).as_bytes(),
            &clear,
        )?;
        let tx = self.db.transaction()?;
        // Optional additive table; old v2 readers preserve it. No existing
        // evidence table, key-check or catalog version is rewritten.
        tx.execute_batch("CREATE TABLE IF NOT EXISTS capture_preferences (id INTEGER PRIMARY KEY CHECK(id=1), value BLOB NOT NULL);")?;
        tx.execute("INSERT INTO capture_preferences(id,value) VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET value=excluded.value",[sealed])?;
        if !current() {
            return Err(Error::Invalidated);
        }
        tx.commit()?;
        if !current() {
            // A revoked late write cannot enable capture after reopening.
            let cleanup = self
                .db
                .execute("DELETE FROM capture_preferences WHERE id=1", []);
            let paused = self.pause_capture();
            if cleanup.is_err() || paused.is_err() {
                self.poisoned = true;
                return Err(Error::Storage);
            }
            return Err(Error::Invalidated);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn preferences() -> CapturePreferences {
        CapturePreferences {
            enabled: true,
            replay_enabled: true,
            allowed_apps: std::collections::BTreeSet::from(["owned.editor".into()]),
            ..CapturePreferences::default()
        }
    }
    #[test]
    fn choices_are_encrypted_survive_reopen_and_cannot_clear_a_deletion_pause() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("evidence");
        let scope = ScopeId::from_profile("owned-test-profile").unwrap();
        assert!(!EvidenceStore::exists_for_profile(&root, &scope).unwrap());
        assert!(!root.exists());
        let now = crate::unix_millis().unwrap();
        let mut store = crate::tests::open(&root, now);
        assert_eq!(
            store.read_preferences(now).unwrap(),
            CapturePreferences::default()
        );
        let choice = preferences();
        store.save_preferences(&choice, now, &|| true).unwrap();
        let path = root.join(scope.path_component()).join(CATALOG);
        assert!(!fs::read(path)
            .unwrap()
            .windows(b"owned.editor".len())
            .any(|w| w == b"owned.editor"));
        drop(store);
        let mut store = crate::tests::open(&root, now + 1);
        assert_eq!(store.read_preferences(now + 1).unwrap(), choice);
        store.purge().unwrap();
        assert_eq!(store.read_preferences(now + 1).unwrap(), choice);
        struct NoCapture;
        impl crate::CaptureBackend for NoCapture {
            fn capture(
                &self,
                _: &crate::CapturePolicy,
                _: &crate::Cancellation,
            ) -> Result<crate::NativeCapture, crate::CaptureFailure> {
                panic!("durable pause must prevent capture");
            }
        }
        let service = crate::ScreenContextService::new(Arc::new(NoCapture)).unwrap();
        service.replace_store(Some(store)).unwrap();
        service.set_policy(choice.policy().unwrap()).unwrap();
        assert!(service.status().paused);
        assert!(!service.request_sample());
    }
    #[test]
    fn automatic_expansion_and_notice_survive_reopen_and_acknowledgement_preserves_off() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("evidence");
        let mut store = crate::tests::open(&root, 1000);
        let mut old = preferences();
        old.visible_text_enabled = true;
        store.save_preferences(&old, 1000, &|| true).unwrap();
        drop(store);
        let mut store = crate::tests::open(&root, 1001);
        let mut upgraded = store.read_preferences(1001).unwrap();
        assert!(upgraded.upgrade_general_recording(true));
        store.save_preferences(&upgraded, 1001, &|| true).unwrap();
        drop(store);
        let mut store = crate::tests::open(&root, 1002);
        let mut current = store.read_preferences(1002).unwrap();
        assert_eq!(current, upgraded);
        assert!(!current.general_notice_pending);
        current.enabled = false;
        store.save_preferences(&current, 1002, &|| true).unwrap();
        let mut acknowledgement = store.read_preferences(1003).unwrap();
        acknowledgement.general_notice_pending = false;
        store
            .save_preferences(&acknowledgement, 1003, &|| true)
            .unwrap();
        drop(store);
        let mut store = crate::tests::open(&root, 1004);
        let current = store.read_preferences(1004).unwrap();
        assert!(!current.enabled && !current.general_notice_pending);
        assert_eq!(current.scope, crate::CaptureScope::ActiveDisplayScene);
    }
    #[test]
    fn a_committed_late_choice_is_removed_and_paused_before_it_can_enable_a_reopen() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("evidence");
        let mut store = crate::tests::open(&root, 1000);
        let path = store.directory.join(CATALOG);
        let revoked = std::cell::Cell::new(false);
        let current = || {
            if revoked.get() {
                return false;
            }
            let reader =
                Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
                    .unwrap();
            let committed: bool = reader
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name='capture_preferences')",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            // Another connection can see the additive table only after the
            // real SQLite commit; this does not depend on a call counter.
            if committed {
                revoked.set(true);
                false
            } else {
                true
            }
        };
        assert!(matches!(
            store.save_preferences(&preferences(), 1000, &current),
            Err(Error::Invalidated)
        ));
        assert!(revoked.get());
        assert!(store.capture_paused());
        drop(store);
        let mut store = crate::tests::open(&root, 1001);
        assert_eq!(
            store.read_preferences(1001).unwrap(),
            CapturePreferences::default()
        );
        assert!(store.capture_paused());
    }
    #[test]
    fn preferences_cannot_cross_scope_and_unknown_authenticated_choices_are_preserved() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("evidence");
        let mut a = crate::tests::open(&root, 1000);
        a.save_preferences(&preferences(), 1000, &|| true).unwrap();
        let sealed: Vec<u8> =
            a.db.query_row(
                "SELECT value FROM capture_preferences WHERE id=1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        drop(a);
        let mut b = EvidenceStore::open(
            &root,
            ScopeId::from_profile("owned-other").unwrap(),
            Zeroizing::new([7; 32]),
            Retention::default(),
            1000,
        )
        .unwrap();
        b.db.execute_batch(
            "CREATE TABLE capture_preferences(id INTEGER PRIMARY KEY,value BLOB NOT NULL)",
        )
        .unwrap();
        b.db.execute("INSERT INTO capture_preferences VALUES(1,?1)", [sealed])
            .unwrap();
        assert!(matches!(
            b.read_preferences(1000),
            Err(Error::Authentication)
        ));
        let mut future = serde_json::to_value(preferences()).unwrap();
        future["unknownFutureConsent"] = true.into();
        let unknown = b
            .crypto
            .seal(
                format!("preferences:{}", b.scope.path_component()).as_bytes(),
                future.to_string().as_bytes(),
            )
            .unwrap();
        b.db.execute("UPDATE capture_preferences SET value=?1", [&unknown])
            .unwrap();
        assert!(matches!(
            b.read_preferences(1000),
            Err(Error::Authentication)
        ));
        let after: Vec<u8> =
            b.db.query_row(
                "SELECT value FROM capture_preferences WHERE id=1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(after, unknown);
    }
}
