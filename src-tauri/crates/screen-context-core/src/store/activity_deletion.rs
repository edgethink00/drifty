//! Native-only activity deletion, including inactive account profiles. An
//! interrupted/unverifiable operation leaves content-free recovery markers;
//! opening that profile purges its old evidence before any read or append.
use super::*;
use crate::key_store::ProfileKeyProvider;
#[cfg(test)]
mod tests;

const MAX_DELETED_RECORD_IDS: usize = 262_144;

/// Only the native tracker transaction supplies this receipt. Shape checks
/// grant deletion selection, never permission to read or associate evidence.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", try_from = "EffectsWire")]
pub struct ActivityDeletionEffects {
    ids: BTreeSet<String>,
    overflow: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EffectsWire {
    version: u32,
    record_ids: Vec<String>,
    overflow: bool,
}
impl TryFrom<EffectsWire> for ActivityDeletionEffects {
    type Error = Error;
    fn try_from(value: EffectsWire) -> Result<Self, Error> {
        if value.version != 1
            || value.record_ids.len() > MAX_DELETED_RECORD_IDS
            || (value.overflow && !value.record_ids.is_empty())
        {
            return Err(Error::Invalid("activity deletion receipt"));
        }
        let mut ids = BTreeSet::new();
        for id in value.record_ids {
            if id
                .parse::<i64>()
                .ok()
                .is_none_or(|n| n <= 0 || n.to_string() != id)
                || !ids.insert(id)
            {
                return Err(Error::Invalid("activity deletion receipt"));
            }
        }
        Ok(Self {
            ids,
            overflow: value.overflow,
        })
    }
}
impl std::fmt::Debug for ActivityDeletionEffects {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ActivityDeletionEffects([redacted])")
    }
}
impl Drop for ActivityDeletionEffects {
    fn drop(&mut self) {
        for mut id in std::mem::take(&mut self.ids) {
            id.zeroize();
        }
    }
}

#[derive(Debug, Default)]
pub struct ActivityDeletionReport {
    pub processed_profiles: usize,
    pub unavailable_profiles: usize,
    pub removed_records: usize,
    pub pending_files: usize,
}

fn marker(root: &Path, scope: &ScopeId) -> PathBuf {
    root.join(format!(
        "activity-delete-pending-{}.marker",
        scope.path_component()
    ))
}
fn pending(root: &Path, scope: &ScopeId) -> Result<bool, Error> {
    let path = marker(root, scope);
    if !regular(&path)? {
        return Ok(false);
    }
    if fs::metadata(path)?.len() != 0 {
        return Err(Error::Storage);
    }
    Ok(true)
}
fn sync_root(root: &Path) -> Result<(), Error> {
    #[cfg(unix)]
    File::open(root)?.sync_all()?;
    let _ = root;
    Ok(())
}
fn clear(root: &Path, scope: &ScopeId) -> Result<(), Error> {
    if !pending(root, scope)? {
        return Err(Error::Storage);
    }
    fs::remove_file(marker(root, scope))?;
    sync_root(root)
}

pub(super) fn recover_pending(store: &mut EvidenceStore) -> Result<(), Error> {
    if pending(&store.root, &store.scope)? {
        store.purge()?;
        clear(&store.root, &store.scope)?;
    }
    Ok(())
}

/// Owns the sole device lock while the ordinary tracker commits its mutation.
/// Drop deliberately preserves markers; no failure or lost reply can revive
/// evidence when a deleted row/old backup later reappears.
pub struct PendingActivityDeletion {
    owner: InactiveProfileMaintenance,
    scopes: Vec<ScopeId>,
    interrupted: BTreeSet<ScopeId>,
}
impl InactiveProfileMaintenance {
    /// Content-free status only. This never creates a root, profile or key.
    pub fn activity_deletion_pending(root: &Path) -> Result<bool, Error> {
        if !root.is_absolute() {
            return Err(Error::Invalid("activity deletion root"));
        }
        let metadata = match fs::symlink_metadata(root) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(_) => return Err(Error::Storage),
        };
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err(Error::Storage);
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if metadata.file_attributes() & 0x400 != 0 {
                return Err(Error::Storage);
            }
        }
        for (count, entry) in fs::read_dir(root)?.enumerate() {
            if count >= MAX_RECORDS + 512 {
                return Err(Error::StorageFull);
            }
            let entry = entry?;
            if let Some(scope) = entry
                .file_name()
                .to_str()
                .and_then(|name| name.strip_prefix("activity-delete-pending-"))
                .and_then(|name| name.strip_suffix(".marker"))
                .and_then(ScopeId::from_path_component)
            {
                if pending(root, &scope)? {
                    return Ok(true);
                }
            }
        }
        Ok(false)
    }
    /// Detach the active store and release its maintenance handles first. No
    /// key, profile or root is created, and no content is returned by this API.
    pub fn begin_activity_deletion(self) -> Result<PendingActivityDeletion, Error> {
        if Arc::strong_count(&self.lock) != 1 {
            return Err(Error::Storage);
        }
        let scopes = super::inactive::profile_scopes(&self.root, None)?;
        let mut interrupted = BTreeSet::new();
        for scope in &scopes {
            if pending(&self.root, scope)? {
                interrupted.insert(scope.clone());
            } else {
                open_private(&marker(&self.root, scope), true)?.sync_all()?;
            }
        }
        sync_root(&self.root)?; // Before the tracker may mutate any activity.
        Ok(PendingActivityDeletion {
            owner: self,
            scopes,
            interrupted,
        })
    }
}

impl PendingActivityDeletion {
    pub fn finish(
        self,
        effects: &ActivityDeletionEffects,
        keys: &mut dyn ProfileKeyProvider,
        now_ms: i64,
    ) -> Result<ActivityDeletionReport, Error> {
        if now_ms < 0 {
            return Err(Error::Invalid("activity deletion clock"));
        }
        let mut report = ActivityDeletionReport::default();
        for scope in &self.scopes {
            let interrupted = self.interrupted.contains(scope);
            if !interrupted && !effects.overflow && effects.ids.is_empty() {
                // A no-op activity mutation cannot remove valid evidence or
                // resolve keys merely to clear this operation's fresh marker.
                clear(&self.owner.root, scope)?;
                continue;
            }
            let profile = EvidenceStore::open_locked(
                &self.owner.root,
                scope.clone(),
                keys,
                Retention::default(),
                now_ms,
                Arc::clone(&self.owner.lock),
                OpenPurpose::ActivityDeletion,
            );
            let Ok(mut profile) = profile else {
                report.unavailable_profiles += 1;
                continue; // Keep marker; no replacement key or partial read.
            };
            let removal = if interrupted || effects.overflow {
                profile.purge()
            } else {
                // Unbound evidence cannot establish that it is unrelated to a
                // deleted activity. Remove it too; keep other proven bindings.
                let ids = profile
                    .index
                    .iter()
                    .filter(|(_, record)| {
                        record
                            .activity_binding
                            .as_ref()
                            .is_none_or(|binding| effects.ids.contains(binding.record_id()))
                    })
                    .map(|(id, _)| *id)
                    .collect::<Vec<_>>();
                profile.remove_ids(&ids, true)
            };
            match removal {
                Ok(removal) => {
                    report.processed_profiles += 1;
                    report.removed_records += removal.removed.len();
                    report.pending_files += removal.pending_files;
                    clear(&self.owner.root, scope)?;
                }
                Err(_) => report.unavailable_profiles += 1,
            }
        }
        Ok(report)
    }
}
