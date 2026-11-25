//! Deletions of saved screens that automatic memory must hear about (owner decision 2026-11-26).
//!
//! Memory keeps an extracted window's text after its screen leaves the snapshot, so a
//! screen missing from the snapshot no longer means a deleted one. Every deletion of saved
//! screens is written here first, and each memory engine receives the entries it has not
//! applied with its next request, including maintenance while memory is off. The file
//! holds ids and times only, like the activity history beside it, never screen content.
use super::*;

const FILE: &str = "deletions.json";
/// Older entries are dropped past these bounds; an engine that missed them drops every
/// kept window instead (see the engine's apply_deletions).
const MAX_ENTRIES: usize = 256;
const MAX_IDS: usize = 20_000;

#[derive(Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Ledger {
    next: u64,
    entries: Vec<Value>,
}

/// The device's memory folder, when memory has been used on this computer.
fn folder(app: &AppHandle) -> Option<PathBuf> {
    let path = app.path().app_local_data_dir().ok()?.join("memory-v1");
    let metadata = fs::symlink_metadata(&path).ok()?;
    (metadata.is_dir() && !metadata.file_type().is_symlink()).then_some(path)
}

fn read(folder: &Path) -> Result<Ledger, String> {
    let path = folder.join(FILE);
    match fs::symlink_metadata(&path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Ledger::default()),
        Err(_) => return Err(MEMORY_UNAVAILABLE.into()),
        Ok(metadata) if !metadata.is_file() || metadata.len() > 8 * 1024 * 1024 => return Err(MEMORY_UNAVAILABLE.into()),
        Ok(_) => {}
    }
    serde_json::from_slice(&fs::read(&path).map_err(|_| MEMORY_UNAVAILABLE)?).map_err(|_| MEMORY_UNAVAILABLE.into())
}

fn write(folder: &Path, ledger: &Ledger) -> Result<(), String> {
    let temporary = folder.join(format!(".deletions-{}", Uuid::new_v4()));
    let result = (|| {
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary).map_err(|_| MEMORY_UNAVAILABLE)?;
        file.write_all(&serde_json::to_vec(ledger).map_err(|_| MEMORY_UNAVAILABLE)?)
            .map_err(|_| MEMORY_UNAVAILABLE)?;
        file.sync_all().map_err(|_| MEMORY_UNAVAILABLE)?;
        fs::rename(&temporary, folder.join(FILE)).map_err(|_| MEMORY_UNAVAILABLE)?;
        Ok(())
    })();
    let _ = fs::remove_file(temporary);
    result
}

fn ids(entry: &Value) -> usize {
    entry["ids"].as_array().map_or(0, Vec::len)
}

/// Record one deletion before it happens. None when memory was never used here.
pub(crate) fn record(app: &AppHandle, mut entry: Value) -> Result<Option<u64>, String> {
    let Some(folder) = folder(app) else { return Ok(None) };
    let mut ledger = read(&folder)?;
    ledger.next += 1;
    entry["seq"] = json!(ledger.next);
    ledger.entries.push(entry);
    while ledger.entries.len() > MAX_ENTRIES || ledger.entries.iter().map(ids).sum::<usize>() > MAX_IDS {
        if ledger.entries.len() == 1 {
            // One receipt too large to list counts as everything.
            let seq = ledger.next;
            ledger.entries[0] = json!({"seq": seq, "kind": "all"});
            break;
        }
        ledger.entries.remove(0);
    }
    write(&folder, &ledger)?;
    Ok(Some(ledger.next))
}

/// Replace a pending entry with what was actually deleted.
pub(crate) fn complete(app: &AppHandle, seq: u64, mut entry: Value) -> Result<(), String> {
    let Some(folder) = folder(app) else { return Ok(()) };
    let mut ledger = read(&folder)?;
    if ids(&entry) > MAX_IDS {
        entry = json!({"kind": "all"});
    }
    entry["seq"] = json!(seq);
    if let Some(slot) = ledger.entries.iter_mut().find(|e| e["seq"].as_u64() == Some(seq)) {
        *slot = entry;
        write(&folder, &ledger)?;
    }
    Ok(())
}

/// The entries newer than the given one, for an engine request. None when there are none.
pub(crate) fn since(app: &AppHandle, applied: u64) -> Result<Option<Value>, String> {
    let Some(folder) = folder(app) else { return Ok(None) };
    let ledger = read(&folder)?;
    let entries: Vec<&Value> = ledger.entries.iter().filter(|e| e["seq"].as_u64().is_some_and(|s| s > applied)).collect();
    if entries.is_empty() {
        return Ok(None);
    }
    let oldest = ledger.entries.first().and_then(|e| e["seq"].as_u64()).unwrap_or(ledger.next + 1);
    Ok(Some(json!({"oldest": oldest, "entries": entries})))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_ledger_keeps_order_bounds_and_completes_pending_entries() {
        let temporary = tempfile::tempdir().unwrap();
        let folder = temporary.path();
        let mut ledger = Ledger::default();
        for n in 0..(MAX_ENTRIES + 3) {
            ledger.next += 1;
            ledger.entries.push(json!({"seq": ledger.next, "kind": "record", "id": format!("r{n}")}));
        }
        ledger.entries.drain(..3);
        write(folder, &ledger).unwrap();
        let back = read(folder).unwrap();
        assert_eq!(back.entries.len(), MAX_ENTRIES);
        assert_eq!(back.entries[0]["seq"], 4);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(folder.join(FILE)).unwrap().permissions().mode() & 0o777, 0o600);
        }
        assert!(read(&folder.join("missing")).unwrap().entries.is_empty());
    }
}
