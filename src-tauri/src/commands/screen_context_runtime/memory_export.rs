//! Markdown copies of the work wiki, kept with the rest of memory so people who
//! keep notes as files (Obsidian, any editor or another AI tool) can open them.
//! The app renders each page from the wiki (never from original screens); this
//! writes the files into the profile's own memory folder, `markdown/` beside its
//! state in Drifty's app data. iCloud Drive and OneDrive do not sync that folder
//! and macOS asks no folder permission for it, so the copies stay on this
//! computer like the memories themselves. Only copies it wrote before are
//! removed. The WebView sends plain file names, never paths.
use super::*;
use serde_json::{json, Value};
use std::{collections::HashSet, path::Path};

const EXPORT_UNAVAILABLE: &str = "memory_export_unavailable";
const FOLDER: &str = "markdown";
const MANIFEST: &str = ".drifty-memory-export.json";
const MAX_FILES: usize = 260;
const MAX_NAME_CHARS: usize = 120;
const MAX_FILE_BYTES: usize = 256 * 1024;
const MAX_TOTAL_BYTES: usize = 16 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MemoryExportFile {
    name: String,
    text: String,
}

fn export_dir(app: &AppHandle, lease: &AccountReadLease) -> Result<PathBuf, String> {
    super::memory::profile_root(app, lease)
        .map(|root| root.join(FOLDER))
        .map_err(|_| EXPORT_UNAVAILABLE.into())
}

/// A plain Markdown file name: no folders, no hidden files, no control characters.
fn valid_name(name: &str) -> bool {
    let Some(stem) = name.strip_suffix(".md") else {
        return false;
    };
    !stem.trim().is_empty()
        && name.chars().count() <= MAX_NAME_CHARS
        && !name.starts_with('.')
        && !name.chars().any(|c| matches!(c, '/' | '\\' | ':') || c.is_control())
}

/// The folder itself, never a symlink or a file in its place.
fn usable_dir(dir: &Path, create: bool) -> Result<bool, String> {
    match fs::symlink_metadata(dir) {
        Ok(meta) if meta.is_dir() && !meta.file_type().is_symlink() => Ok(true),
        Ok(_) => Err(EXPORT_UNAVAILABLE.into()),
        Err(_) if create => {
            fs::create_dir_all(dir).map_err(|_| EXPORT_UNAVAILABLE)?;
            Ok(true)
        }
        Err(_) => Ok(false),
    }
}

fn written_before(dir: &Path) -> Vec<String> {
    fs::read(dir.join(MANIFEST))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Vec<String>>(&bytes).ok())
        .unwrap_or_default()
        .into_iter()
        .filter(|name| valid_name(name))
        .collect()
}

fn is_plain_file(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|meta| meta.is_file())
}

fn write_atomic(dir: &Path, name: &str, bytes: &[u8]) -> Result<(), String> {
    let temporary = dir.join(format!(".{}.tmp", Uuid::new_v4()));
    if fs::write(&temporary, bytes).is_err() || fs::rename(&temporary, dir.join(name)).is_err() {
        let _ = fs::remove_file(&temporary);
        return Err(EXPORT_UNAVAILABLE.into());
    }
    Ok(())
}

fn validate(files: &[MemoryExportFile]) -> Result<(), String> {
    let mut names = HashSet::new();
    let mut total = 0;
    for file in files {
        total += file.text.len();
        // File systems on the Mac usually ignore case, so names must differ beyond it.
        if !valid_name(&file.name) || file.text.len() > MAX_FILE_BYTES || !names.insert(file.name.to_lowercase()) {
            return Err(EXPORT_UNAVAILABLE.into());
        }
    }
    if files.len() > MAX_FILES || total > MAX_TOTAL_BYTES {
        return Err(EXPORT_UNAVAILABLE.into());
    }
    Ok(())
}

/// Writes the files and removes the copies an earlier export wrote that are no
/// longer in the wiki. A file of the same name the person made is left alone.
fn write_export(dir: &Path, files: &[MemoryExportFile]) -> Result<Value, String> {
    validate(files)?;
    // An empty wiki makes no folder; one that emptied still clears its old copies.
    if files.is_empty() && !usable_dir(dir, false)? {
        return Ok(json!({"written": 0, "removed": 0, "skipped": 0}));
    }
    usable_dir(dir, true)?;
    let before = written_before(dir);
    let ours: HashSet<String> = before.iter().map(|name| name.to_lowercase()).collect();
    let mut written = Vec::new();
    let mut skipped = 0;
    for file in files {
        let path = dir.join(&file.name);
        if fs::symlink_metadata(&path).is_ok() && (!ours.contains(&file.name.to_lowercase()) || !is_plain_file(&path)) {
            skipped += 1;
            continue;
        }
        write_atomic(dir, &file.name, file.text.as_bytes())?;
        written.push(file.name.clone());
    }
    let keep: HashSet<String> = written.iter().map(|name| name.to_lowercase()).collect();
    let mut removed = 0;
    for name in before.iter().filter(|name| !keep.contains(&name.to_lowercase())) {
        let path = dir.join(name);
        if is_plain_file(&path) && fs::remove_file(&path).is_ok() {
            removed += 1;
        }
    }
    write_atomic(dir, MANIFEST, &serde_json::to_vec(&written).map_err(|_| EXPORT_UNAVAILABLE)?)?;
    Ok(json!({"written": written.len(), "removed": removed, "skipped": skipped}))
}

/// Removes every copy an export wrote, then the folder when nothing else is in it.
fn clear_export(dir: &Path) -> Result<Value, String> {
    if !usable_dir(dir, false)? {
        return Ok(json!({"removed": 0}));
    }
    let mut removed = 0;
    for name in written_before(dir) {
        let path = dir.join(name);
        if is_plain_file(&path) && fs::remove_file(&path).is_ok() {
            removed += 1;
        }
    }
    let _ = fs::remove_file(dir.join(MANIFEST));
    let _ = fs::remove_dir(dir);
    Ok(json!({"removed": removed}))
}

#[tauri::command]
pub async fn memory_export_markdown(
    app: AppHandle,
    lease_id: AccountLeaseId,
    files: Vec<MemoryExportFile>,
) -> Result<AccountReply<Value>, String> {
    validate(&files)?;
    tauri::async_runtime::spawn_blocking(move || {
        authorized(&app, lease_id, |_, lease| write_export(&export_dir(&app, lease)?, &files))
    })
    .await
    .map_err(|_| EXPORT_UNAVAILABLE.to_owned())?
}

#[tauri::command]
pub async fn memory_export_clear(
    app: AppHandle,
    lease_id: AccountLeaseId,
) -> Result<AccountReply<Value>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        authorized(&app, lease_id, |_, lease| clear_export(&export_dir(&app, lease)?))
    })
    .await
    .map_err(|_| EXPORT_UNAVAILABLE.to_owned())?
}

/// Shows the profile's Markdown folder in Finder once an export has made it.
#[tauri::command]
pub async fn memory_export_open(
    app: AppHandle,
    lease_id: AccountLeaseId,
) -> Result<AccountReply<bool>, String> {
    use tauri_plugin_opener::OpenerExt;
    tauri::async_runtime::spawn_blocking(move || {
        authorized(&app, lease_id, |_, lease| {
            let dir = export_dir(&app, lease)?;
            if !usable_dir(&dir, false)? {
                return Err(EXPORT_UNAVAILABLE.into());
            }
            app.opener()
                .open_path(dir.to_string_lossy(), None::<&str>)
                .map(|_| true)
                .map_err(|_| EXPORT_UNAVAILABLE.into())
        })
    })
    .await
    .map_err(|_| EXPORT_UNAVAILABLE.to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(name: &str, text: &str) -> MemoryExportFile {
        MemoryExportFile { name: name.into(), text: text.into() }
    }

    #[test]
    fn names_are_plain_markdown_files() {
        for name in ["Juniper release.md", "지금.md", "Mira (person).md"] {
            assert!(valid_name(name), "{name}");
        }
        for name in ["../x.md", "a/b.md", ".hidden.md", "x.txt", " .md", "a:b.md", "a\u{0}.md", &format!("{}.md", "x".repeat(118))] {
            assert!(!valid_name(name), "{name}");
        }
        assert!(validate(&[file("A.md", ""), file("a.md", "")]).is_err());
    }

    #[test]
    fn writes_keeps_the_persons_files_and_removes_only_its_own_old_copies() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join(FOLDER);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("Mine.md"), "the person's file").unwrap();
        let first = write_export(&dir, &[file("Juniper.md", "one"), file("Mine.md", "ours"), file("Harbor.md", "two")]).unwrap();
        assert_eq!(first, json!({"written": 2, "removed": 0, "skipped": 1}));
        assert_eq!(fs::read_to_string(dir.join("Mine.md")).unwrap(), "the person's file");
        let second = write_export(&dir, &[file("Juniper.md", "updated")]).unwrap();
        assert_eq!(second, json!({"written": 1, "removed": 1, "skipped": 0}));
        assert_eq!(fs::read_to_string(dir.join("Juniper.md")).unwrap(), "updated");
        assert!(!dir.join("Harbor.md").exists());
        assert_eq!(clear_export(&dir).unwrap(), json!({"removed": 1}));
        assert!(dir.join("Mine.md").exists() && !dir.join("Juniper.md").exists() && !dir.join(MANIFEST).exists());
        fs::remove_file(dir.join("Mine.md")).unwrap();
        clear_export(&dir).unwrap();
        assert!(!dir.exists());
    }

    #[test]
    fn an_empty_wiki_makes_no_folder_but_clears_old_copies() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join(FOLDER);
        assert_eq!(write_export(&dir, &[]).unwrap(), json!({"written": 0, "removed": 0, "skipped": 0}));
        assert!(!dir.exists());
        write_export(&dir, &[file("Juniper.md", "one")]).unwrap();
        assert_eq!(write_export(&dir, &[]).unwrap(), json!({"written": 0, "removed": 1, "skipped": 0}));
        assert!(!dir.join("Juniper.md").exists());
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_symlinked_folder() {
        let root = tempfile::tempdir().unwrap();
        let elsewhere = root.path().join("elsewhere");
        fs::create_dir_all(&elsewhere).unwrap();
        std::os::unix::fs::symlink(&elsewhere, root.path().join(FOLDER)).unwrap();
        assert!(write_export(&root.path().join(FOLDER), &[file("A.md", "x")]).is_err());
        assert!(fs::read_dir(&elsewhere).unwrap().next().is_none());
    }
}

