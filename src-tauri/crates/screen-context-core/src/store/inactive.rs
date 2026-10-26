//! Expiry-only maintenance of existing inactive profiles under the device lock.
//! No key generation, profile activation or content is returned by this API.
use super::*;

/// Aggregate status only: no profile path, key, document, text, pixel or record ID.
#[derive(Debug, Default)]
pub struct InactiveMaintenance {
    pub processed_profiles: usize,
    pub unavailable_profiles: usize,
    pub clock_invalidated_profiles: usize,
    pub removed_records: usize,
    pub pending_files: usize,
    pub next_expiry_ms: Option<i64>,
}

const MAX_PROFILES_PER_PASS: usize = 64;

/// Expiry-only ownership of an existing evidence root, independent of login.
/// This handle exposes no reads, key creation, profile activation or append.
/// A native owner must exclude its attached active store from each pass and
/// serialize passes with profile replacement. Dropping the last store/handle
/// releases the one original device lock.
pub struct InactiveProfileMaintenance {
    pub(super) root: PathBuf,
    pub(super) lock: Arc<File>,
}

impl InactiveProfileMaintenance {
    /// Startup after a previous opt-in. A missing root stays missing; no
    /// profile or key is created, and symlink/reparse roots are refused.
    pub fn open_existing(root: &Path) -> Result<Option<Self>, Error> {
        if !root.is_absolute() {
            return Err(Error::Invalid("store path"));
        }
        let metadata = match fs::symlink_metadata(root) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(Error::Storage),
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
        Ok(Some(Self {
            root: root.to_owned(),
            lock: device_lock(root)?,
        }))
    }

    pub fn maintain(
        &mut self,
        active_scope: Option<&ScopeId>,
        keys: &mut dyn crate::key_store::ProfileKeyProvider,
        now_ms: i64,
    ) -> Result<InactiveMaintenance, Error> {
        if now_ms < 0 {
            return Err(Error::Invalid("store clock"));
        }
        maintain_profiles(&self.root, &self.lock, active_scope, keys, now_ms)
    }
}

impl EvidenceStore {
    pub fn inactive_maintenance_handle(&self) -> InactiveProfileMaintenance {
        InactiveProfileMaintenance {
            root: self.root.clone(),
            lock: Arc::clone(&self._lock),
        }
    }

    /// Native maintenance only. The caller supplies the trusted key provider;
    /// it is always queried with may_create=false. The active profile/policy
    /// stays attached to this store, and the device lock outlives every profile
    /// opened here. Call again at next_expiry_ms (or a bounded retry on failure).
    /// No timer or OS key access is started by constructing an EvidenceStore.
    pub fn maintain_inactive_profiles(
        &mut self,
        keys: &mut dyn crate::key_store::ProfileKeyProvider,
        now_ms: i64,
    ) -> Result<InactiveMaintenance, Error> {
        self.check_clock(now_ms)?;
        self.inactive_maintenance_handle()
            .maintain(Some(&self.scope), keys, now_ms)
    }
}

fn maintain_profiles(
    root: &Path,
    lock: &Arc<File>,
    active_scope: Option<&ScopeId>,
    keys: &mut dyn crate::key_store::ProfileKeyProvider,
    now_ms: i64,
) -> Result<InactiveMaintenance, Error> {
    let scopes = profile_scopes(root, active_scope)?;
    maintain_scopes(root, lock, keys, now_ms, scopes)
}

pub(super) fn profile_scopes(
    root: &Path,
    active_scope: Option<&ScopeId>,
) -> Result<Vec<ScopeId>, Error> {
    let mut scopes = Vec::new();
    for (count, entry) in fs::read_dir(root)?.enumerate() {
        if count >= MAX_RECORDS + 512 {
            return Err(Error::StorageFull);
        }
        let entry = entry?;
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        let Some(scope) = ScopeId::from_path_component(&name) else {
            continue; // Unknown files/directories are not owned evidence.
        };
        if active_scope != Some(&scope) {
            scopes.push(scope);
            if scopes.len() > MAX_PROFILES_PER_PASS {
                // No partial pass or permanent first-page starvation.
                return Err(Error::StorageFull);
            }
        }
    }
    // Complete enumeration before opening/deleting any inactive record.
    scopes.sort();
    Ok(scopes)
}

fn maintain_scopes(
    root: &Path,
    lock: &Arc<File>,
    keys: &mut dyn crate::key_store::ProfileKeyProvider,
    now_ms: i64,
    scopes: Vec<ScopeId>,
) -> Result<InactiveMaintenance, Error> {
    let mut report = InactiveMaintenance::default();
    for scope in scopes {
        // Expire stored per-record TTLs independently of the currently
        // active profile's smaller quota. No records are appended here.
        let profile = EvidenceStore::open_locked(
            root,
            scope,
            keys,
            Retention::default(),
            now_ms,
            Arc::clone(lock),
            OpenPurpose::Maintenance,
        );
        let Ok(mut profile) = profile else {
            // Missing keys, unknown/corrupt versions, symlinks/reparse
            // points and unreadable profiles stay preserved. Continue
            // independent profiles without replacing or exporting a key.
            report.unavailable_profiles += 1;
            continue;
        };
        let rollback = profile.clock_rolled_back(now_ms);
        let removal = if rollback {
            // Same preexisting privacy barrier as an active profile:
            // purge and pause instead of extending retention on rollback.
            profile.invalidate_clock_rollback()
        } else {
            profile.maintenance(now_ms)
        };
        match removal {
            Ok(removal) => {
                report.processed_profiles += 1;
                report.clock_invalidated_profiles += usize::from(rollback);
                report.removed_records += removal.removed.len();
                report.pending_files += removal.pending_files;
                if let Some(next) = profile.next_expiry_ms() {
                    report.next_expiry_ms =
                        Some(report.next_expiry_ms.map_or(next, |at| at.min(next)));
                }
            }
            Err(_) => report.unavailable_profiles += 1,
        }
        // Drop profile DB/key/index; the active Arc keeps the device lock.
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::key_store::ProfileKeyProvider;
    use std::time::Duration;

    struct Keys {
        root: PathBuf,
        values: BTreeMap<ScopeId, [u8; 32]>,
        calls: Vec<ScopeId>,
    }
    impl ProfileKeyProvider for Keys {
        fn profile_key(
            &mut self,
            scope: &ScopeId,
            may_create: bool,
        ) -> Result<Zeroizing<[u8; 32]>, Error> {
            assert!(!may_create, "maintenance must never create a key");
            // Real file locking, including after a previous inactive DB drops.
            assert!(matches!(
                EvidenceStore::open(
                    &self.root,
                    scope.clone(),
                    Zeroizing::new([99; 32]),
                    Retention::default(),
                    2_000,
                ),
                Err(Error::Storage)
            ));
            self.calls.push(scope.clone());
            self.values
                .get(scope)
                .copied()
                .map(Zeroizing::new)
                .ok_or(Error::Authentication)
        }
    }
    fn seed(root: &Path, name: &str, key: u8, ttl: u64, now: i64) -> (ScopeId, Uuid) {
        let scope = ScopeId::from_profile(name).unwrap();
        let mut store = EvidenceStore::open(
            root,
            scope.clone(),
            Zeroizing::new([key; 32]),
            Retention {
                ttl: Duration::from_secs(ttl),
                ..Retention::default()
            },
            now,
        )
        .unwrap();
        let id = store
            .append(store.generation(), crate::tests::evidence(now), true, now)
            .unwrap();
        (scope, id)
    }

    #[test]
    fn signed_out_maintenance_expires_all_profiles_without_creating_a_local_profile() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("evidence");
        assert!(InactiveProfileMaintenance::open_existing(&root)
            .unwrap()
            .is_none());
        assert!(!root.exists());
        let (expired, id) = seed(&root, "signed-out-old", 7, 1, 1_000);
        let (live, live_id) = seed(&root, "signed-out-live", 9, 60, 1_000);
        let mut owner = InactiveProfileMaintenance::open_existing(&root)
            .unwrap()
            .unwrap();
        let mut keys = Keys {
            root: root.clone(),
            values: BTreeMap::from([(expired.clone(), [7; 32]), (live.clone(), [9; 32])]),
            calls: Vec::new(),
        };
        let names_before: BTreeSet<_> = fs::read_dir(&root)
            .unwrap()
            .map(|p| p.unwrap().file_name())
            .collect();
        let report = owner.maintain(None, &mut keys, 2_000).unwrap();
        assert_eq!(report.processed_profiles, 2);
        assert_eq!(report.removed_records, 1);
        assert_eq!(report.next_expiry_ms, Some(61_000));
        assert_eq!(keys.calls.len(), 2);
        assert!(!root
            .join(expired.path_component())
            .join(format!("frame-{id}.bin"))
            .exists());
        assert!(root
            .join(live.path_component())
            .join(format!("frame-{live_id}.bin"))
            .is_file());
        assert_eq!(
            names_before,
            fs::read_dir(&root)
                .unwrap()
                .map(|p| p.unwrap().file_name())
                .collect()
        );
        assert!(InactiveProfileMaintenance::open_existing(&root).is_err());
        drop(owner);
        assert!(InactiveProfileMaintenance::open_existing(&root)
            .unwrap()
            .is_some());
    }

    #[test]
    fn shared_maintenance_owner_survives_account_store_drop_and_preserves_active_generation() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("evidence");
        let (inactive, inactive_id) = seed(&root, "other-account", 7, 1, 1_000);
        let (scope, id) = seed(&root, "attached-account", 9, 1, 1_000);
        let active = EvidenceStore::open(
            &root,
            scope.clone(),
            Zeroizing::new([9; 32]),
            Retention::default(),
            1_001,
        )
        .unwrap();
        let generation = active.generation();
        let mut owner = active.inactive_maintenance_handle();
        let mut keys = Keys {
            root: root.clone(),
            values: BTreeMap::from([(inactive.clone(), [7; 32]), (scope.clone(), [9; 32])]),
            calls: Vec::new(),
        };
        let report = owner.maintain(Some(&scope), &mut keys, 2_000).unwrap();
        assert_eq!(report.removed_records, 1);
        assert_eq!(active.generation(), generation);
        assert_eq!(keys.calls, vec![inactive.clone()]);
        assert!(!root
            .join(inactive.path_component())
            .join(format!("frame-{inactive_id}.bin"))
            .exists());
        assert!(root
            .join(scope.path_component())
            .join(format!("frame-{id}.bin"))
            .is_file());
        // Sign-out releases the active DB but retains expiry-only lock ownership.
        drop(active);
        let report = owner.maintain(None, &mut keys, 2_001).unwrap();
        assert_eq!(report.removed_records, 1);
        assert!(!root
            .join(scope.path_component())
            .join(format!("frame-{id}.bin"))
            .exists());
    }

    #[test]
    fn inactive_expiry_preserves_live_profile_missing_keys_and_unknown_files() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("evidence");
        let (expired, expired_id) = seed(&root, "inactive-expired", 7, 1, 1_000);
        let (live, live_id) = seed(&root, "inactive-live", 9, 60, 1_000);
        let (lost, lost_id) = seed(&root, "inactive-key-missing", 11, 1, 1_000);
        let lost_catalog = root.join(lost.path_component()).join(CATALOG);
        let lost_before = fs::read(&lost_catalog).unwrap();
        let unknown = root.join("user-note.txt");
        fs::write(&unknown, b"preserve unrelated owned data").unwrap();
        let incomplete = root.join("e".repeat(64));
        directory(&incomplete).unwrap();
        fs::write(incomplete.join(CATALOG), b"").unwrap();
        let mut active = crate::tests::open(&root, 1_999);
        active.pause_capture().unwrap();
        let generation = active.generation();
        let mut keys = Keys {
            root: root.clone(),
            values: BTreeMap::from([(expired.clone(), [7; 32]), (live.clone(), [9; 32])]),
            calls: Vec::new(),
        };
        let report = active.maintain_inactive_profiles(&mut keys, 2_000).unwrap();
        assert_eq!(report.processed_profiles, 2);
        assert_eq!(report.unavailable_profiles, 2); // missing key + incomplete catalog
        assert_eq!(report.removed_records, 1);
        assert_eq!(report.pending_files, 0);
        assert_eq!(report.next_expiry_ms, Some(61_000));
        assert!(active.capture_paused());
        assert_eq!(active.generation(), generation);
        assert_eq!(keys.calls.len(), 3);
        assert!(!keys.calls.contains(&active.scope));
        assert_eq!(fs::read(&lost_catalog).unwrap(), lost_before);
        assert!(root
            .join(lost.path_component())
            .join(format!("frame-{lost_id}.bin"))
            .is_file());
        assert!(!root
            .join(expired.path_component())
            .join(format!("frame-{expired_id}.bin"))
            .exists());
        assert!(root
            .join(live.path_component())
            .join(format!("frame-{live_id}.bin"))
            .is_file());
        assert_eq!(fs::read(unknown).unwrap(), b"preserve unrelated owned data");
        assert_eq!(fs::metadata(incomplete.join(CATALOG)).unwrap().len(), 0);
        assert!(matches!(
            EvidenceStore::open(
                &root,
                live.clone(),
                Zeroizing::new([9; 32]),
                Retention::default(),
                2_000
            ),
            Err(Error::Storage)
        )); // final inactive drop did not unlock the active store
        drop(active);
        let mut reopened = EvidenceStore::open(
            &root,
            live,
            Zeroizing::new([9; 32]),
            Retention::default(),
            2_001,
        )
        .unwrap();
        assert!(reopened.read_metadata(live_id, 2_001).unwrap().is_some());
    }

    #[test]
    fn inactive_clock_rollback_keeps_the_existing_purge_barrier_and_profile_cap_is_atomic() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("evidence");
        let (future, id) = seed(&root, "future-clock-profile", 7, 1, 5_000);
        let (live, live_id) = seed(&root, "live-clock-profile", 9, 600, 1_000);
        let mut active = crate::tests::open(&root, 1_000);
        let mut keys = Keys {
            root: root.clone(),
            values: BTreeMap::from([(future.clone(), [7; 32]), (live.clone(), [9; 32])]),
            calls: Vec::new(),
        };
        let report = active.maintain_inactive_profiles(&mut keys, 2_000).unwrap();
        assert_eq!(report.processed_profiles, 2);
        assert_eq!(report.unavailable_profiles, 0);
        assert_eq!(report.clock_invalidated_profiles, 1);
        assert_eq!(report.removed_records, 1);
        assert!(!root
            .join(future.path_component())
            .join(format!("frame-{id}.bin"))
            .exists());
        assert!(root
            .join(live.path_component())
            .join(format!("frame-{live_id}.bin"))
            .is_file());
        for n in 0..MAX_PROFILES_PER_PASS {
            // Plus real profiles makes this exceed the cap.
            directory(&root.join(format!("{n:064x}"))).unwrap();
        }
        let calls = keys.calls.len();
        assert!(matches!(
            active.maintain_inactive_profiles(&mut keys, 2_001),
            Err(Error::StorageFull)
        ));
        assert_eq!(keys.calls.len(), calls); // enumeration gate precedes all inactive opens
        assert!(root
            .join(live.path_component())
            .join(format!("frame-{live_id}.bin"))
            .is_file());
    }
    #[cfg(unix)]
    #[test]
    fn inactive_symlink_is_preserved_without_resolving_its_key_or_target() {
        use std::os::unix::fs::symlink;
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("evidence");
        let target = temp.path().join("unrelated-source");
        fs::create_dir(&target).unwrap();
        fs::write(target.join(CATALOG), b"unrelated catalog bytes").unwrap();
        let mut active = crate::tests::open(&root, 1_000);
        let link = root.join("a".repeat(64));
        symlink(&target, &link).unwrap();
        let mut keys = Keys {
            root: root.clone(),
            values: BTreeMap::new(),
            calls: Vec::new(),
        };
        let report = active.maintain_inactive_profiles(&mut keys, 1_001).unwrap();
        assert_eq!(report.unavailable_profiles, 1);
        assert_eq!(report.processed_profiles, 0);
        assert!(keys.calls.is_empty());
        assert!(fs::symlink_metadata(link).unwrap().file_type().is_symlink());
        assert_eq!(
            fs::read(target.join(CATALOG)).unwrap(),
            b"unrelated catalog bytes"
        );
    }
    #[test]
    fn small_active_quota_still_expires_a_larger_inactive_catalog() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("evidence");
        let small = Retention {
            max_bytes: 256 * 1024,
            ..Retention::default()
        };
        let active_scope = ScopeId::from_profile("small-active").unwrap();
        drop(
            EvidenceStore::open(
                &root,
                active_scope.clone(),
                Zeroizing::new([9; 32]),
                small.clone(),
                1_000,
            )
            .unwrap(),
        );
        let old_scope = ScopeId::from_profile("larger-inactive").unwrap();
        let mut old = EvidenceStore::open(
            &root,
            old_scope.clone(),
            Zeroizing::new([7; 32]),
            Retention {
                ttl: Duration::from_secs(1),
                ..Retention::default()
            },
            1_000,
        )
        .unwrap();
        for _ in 0..20 {
            let mut evidence = crate::tests::evidence(1_000);
            evidence.text = TextEvidence::new(
                TextSource::Ocr,
                TextState::Recognized,
                Zeroizing::new("한".repeat(1600)),
            )
            .unwrap();
            old.append(old.generation(), evidence, false, 1_000)
                .unwrap();
        }
        drop(old);
        assert!(
            fs::metadata(root.join(old_scope.path_component()).join(CATALOG))
                .unwrap()
                .len()
                > 64 * 1024
        );
        let mut active =
            EvidenceStore::open(&root, active_scope, Zeroizing::new([9; 32]), small, 2_000)
                .unwrap();
        let mut keys = Keys {
            root: root.clone(),
            values: BTreeMap::from([(old_scope, [7; 32])]),
            calls: Vec::new(),
        };
        let report = active.maintain_inactive_profiles(&mut keys, 2_000).unwrap();
        assert_eq!(report.processed_profiles, 1);
        assert_eq!(report.unavailable_profiles, 0);
        assert_eq!(report.removed_records, 20);
    }

    #[test]
    fn unsupported_inactive_catalog_is_unchanged_before_any_write_pragma() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("evidence");
        let (scope, _) = seed(&root, "unsupported-old-format", 7, 1, 1_000);
        let catalog = root.join(scope.path_component()).join(CATALOG);
        {
            let db = Connection::open(&catalog).unwrap();
            db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA user_version=1;")
                .unwrap();
        }
        let before = fs::read(&catalog).unwrap();
        let names = || {
            let mut names: Vec<_> = fs::read_dir(catalog.parent().unwrap())
                .unwrap()
                .map(|r| r.unwrap().file_name())
                .collect();
            names.sort();
            names
        };
        let files_before = names();
        let mut active = crate::tests::open(&root, 2_000);
        let mut keys = Keys {
            root: root.clone(),
            values: BTreeMap::from([(scope, [7; 32])]),
            calls: Vec::new(),
        };
        let report = active.maintain_inactive_profiles(&mut keys, 2_000).unwrap();
        assert_eq!(report.unavailable_profiles, 1);
        assert_eq!(report.processed_profiles, 0);
        assert_eq!(names(), files_before);
        assert_eq!(fs::read(catalog).unwrap(), before);
    }
}
