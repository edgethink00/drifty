//! The on-device search model memory embeds with, downloaded by the app before
//! memory starts so the start can finish both downloads before it asks for the
//! screen recording permission (owner decision 2026-11-15). Files are fetched
//! from Hugging Face at the exact revisions and SHA-256 digests the engine pins
//! (scripts/memory-pilot/model_assets.py; memory_models.json is its copy and a
//! test keeps them equal) into the cache layout the engine reads, so the engine
//! finds them in place and downloads nothing. No account, credential, activity
//! or memory text takes part.
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};
use tauri::{AppHandle, Manager, WebviewWindow};

use super::memory_runtime::Progress;

const ERROR: &str = "memory_models_unavailable";
const SPEC: &str = include_str!("memory_models.json");
const MAX_FILE: u64 = 400 * 1024 * 1024;
static INSTALL: Mutex<()> = Mutex::new(());
static PROGRESS: Mutex<Option<Progress>> = Mutex::new(None);

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Asset {
    repo: String,
    revision: String,
    files: BTreeMap<String, File>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct File {
    sha256: String,
    bytes: u64,
}

fn safe_name(value: &str) -> bool {
    !value.is_empty()
        && value != "."
        && value != ".."
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_'))
}
fn assets() -> Result<Vec<Asset>, String> {
    let parsed: BTreeMap<String, Asset> = serde_json::from_str(SPEC).map_err(|_| ERROR)?;
    let assets: Vec<Asset> = parsed.into_values().collect();
    for asset in &assets {
        let parts: Vec<&str> = asset.repo.split('/').collect();
        if parts.len() != 2
            || !parts.iter().all(|part| safe_name(part))
            || asset.revision.len() != 40
            || !asset.revision.bytes().all(|b| b.is_ascii_hexdigit())
            || asset.files.is_empty()
            || asset.files.iter().any(|(name, file)| {
                !safe_name(name)
                    || name.starts_with('.')
                    || file.bytes == 0
                    || file.bytes > MAX_FILE
                    || file.sha256.len() != 64
                    || !file.sha256.bytes().all(|b| b.is_ascii_hexdigit())
            })
        {
            return Err(ERROR.into());
        }
    }
    Ok(assets)
}
fn total(assets: &[Asset]) -> u64 {
    assets
        .iter()
        .flat_map(|asset| asset.files.values())
        .map(|file| file.bytes)
        .sum()
}
/// Where huggingface_hub's snapshot_download(cache_dir=<models>/hf) keeps a pinned revision.
fn snapshot(models: &Path, asset: &Asset) -> PathBuf {
    models
        .join("hf")
        .join(format!("models--{}", asset.repo.replace('/', "--")))
        .join("snapshots")
        .join(&asset.revision)
}
/// A file the engine already downloaded is a link into its blob store; follow it.
fn present(path: &Path, file: &File) -> bool {
    fs::metadata(path).is_ok_and(|m| m.is_file() && m.len() == file.bytes)
}
fn ready_in(models: &Path, assets: &[Asset]) -> bool {
    assets.iter().all(|asset| {
        let folder = snapshot(models, asset);
        asset
            .files
            .iter()
            .all(|(name, file)| present(&folder.join(name), file))
    })
}

/// Shared with the engine: one copy for every profile in the app's cache folder.
pub(super) fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let models = app
        .path()
        .app_cache_dir()
        .map_err(|_| ERROR)?
        .join("memory-models");
    fs::create_dir_all(&models).map_err(|_| ERROR)?;
    private(&models)?;
    Ok(models)
}
fn private(path: &Path) -> Result<(), String> {
    if !fs::symlink_metadata(path).is_ok_and(|m| m.is_dir() && !m.file_type().is_symlink()) {
        return Err(ERROR.into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|_| ERROR)?;
    }
    Ok(())
}
/// Creates each missing folder below models owner-only, refusing links on the way.
fn private_tree(models: &Path, target: &Path) -> Result<(), String> {
    let relative = target.strip_prefix(models).map_err(|_| ERROR)?;
    let mut path = models.to_path_buf();
    for part in relative.components() {
        path.push(part);
        if !path.exists() {
            fs::create_dir(&path).map_err(|_| ERROR)?;
        }
        private(&path)?;
    }
    Ok(())
}

fn progress(phase: &'static str, received: u64, total: u64) {
    if let Ok(mut state) = PROGRESS.lock() {
        *state = Some(Progress::new(phase, received, total));
    }
}

fn allowed_host(host: Option<&str>) -> bool {
    host.is_some_and(|h| h == "huggingface.co" || h.ends_with(".hf.co"))
}
fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        // The model is about 255 MB; allow a slow connection to finish it.
        .timeout(Duration::from_secs(3600))
        .https_only(true)
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() < 5
                && attempt.url().scheme() == "https"
                && allowed_host(attempt.url().host_str())
            {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .build()
        .map_err(|_| ERROR.into())
}

type Fetch<'a> = dyn FnMut(&Asset, &str) -> Result<Box<dyn Read>, String> + 'a;

fn install_into(models: &Path, assets: &[Asset], fetch: &mut Fetch<'_>) -> Result<(), String> {
    let total = total(assets);
    let mut received: u64 = assets
        .iter()
        .flat_map(|asset| {
            let folder = snapshot(models, asset);
            asset
                .files
                .iter()
                .filter(move |(name, file)| present(&folder.join(name), file))
                .map(|(_, file)| file.bytes)
        })
        .sum();
    progress("downloading", received, total);
    for asset in assets {
        let folder = snapshot(models, asset);
        private_tree(models, &folder)?;
        for (name, file) in &asset.files {
            let target = folder.join(name);
            if present(&target, file) {
                continue;
            }
            // A wrong-sized leftover (or a link to one) is replaced; nothing else is touched.
            if fs::symlink_metadata(&target).is_ok() {
                fs::remove_file(&target).map_err(|_| ERROR)?;
            }
            let part = folder.join(format!(".{name}.part"));
            if fs::symlink_metadata(&part).is_ok() {
                fs::remove_file(&part).map_err(|_| ERROR)?;
            }
            let outcome = (|| {
                let mut source = fetch(asset, name)?;
                let mut output = fs::OpenOptions::new()
                    .create_new(true)
                    .write(true)
                    .open(&part)
                    .map_err(|_| ERROR)?;
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    fs::set_permissions(&part, fs::Permissions::from_mode(0o600))
                        .map_err(|_| ERROR)?;
                }
                let mut hash = Sha256::new();
                let mut written = 0_u64;
                let mut buffer = [0_u8; 65536];
                loop {
                    let n = source.read(&mut buffer).map_err(|_| ERROR)?;
                    if n == 0 {
                        break;
                    }
                    written += n as u64;
                    if written > file.bytes {
                        return Err(ERROR.to_owned());
                    }
                    output.write_all(&buffer[..n]).map_err(|_| ERROR)?;
                    hash.update(&buffer[..n]);
                    progress("downloading", received + written, total);
                }
                if written != file.bytes || format!("{:x}", hash.finalize()) != file.sha256 {
                    return Err(ERROR.to_owned());
                }
                output.sync_all().map_err(|_| ERROR)?;
                fs::rename(&part, &target).map_err(|_| ERROR)?;
                Ok(())
            })();
            if outcome.is_err() {
                let _ = fs::remove_file(&part);
                return outcome;
            }
            received += file.bytes;
        }
    }
    Ok(())
}

fn install(app: &AppHandle) -> Result<(), String> {
    let _guard = INSTALL.try_lock().map_err(|_| ERROR)?;
    let assets = assets()?;
    let total = total(&assets);
    let outcome = (|| {
        super::memory_runtime::supported()?;
        let models = models_dir(app)?;
        if ready_in(&models, &assets) {
            return Ok(());
        }
        let client = client()?;
        install_into(&models, &assets, &mut |asset, name| {
            let url = format!(
                "https://huggingface.co/{}/resolve/{}/{}",
                asset.repo, asset.revision, name
            );
            let response = client
                .get(url)
                .send()
                .and_then(|r| r.error_for_status())
                .map_err(|_| ERROR)?;
            Ok(Box::new(response) as Box<dyn Read>)
        })
    })();
    progress(if outcome.is_ok() { "ready" } else { "failed" }, 0, total);
    outcome
}

#[tauri::command]
pub fn memory_models_status(app: AppHandle, window: WebviewWindow) -> Result<Progress, String> {
    if window.label() != "main" {
        return Err(ERROR.into());
    }
    if let Some(value) = PROGRESS.lock().map_err(|_| ERROR)?.clone() {
        if value.phase() != "ready" {
            return Ok(value);
        }
    }
    let assets = assets()?;
    let total = total(&assets);
    let phase = if super::memory_runtime::supported().is_err() {
        "unsupported"
    } else if models_dir(&app).is_ok_and(|models| ready_in(&models, &assets)) {
        "ready"
    } else {
        "missing"
    };
    Ok(Progress::new(phase, 0, total))
}
#[tauri::command]
pub async fn memory_models_install(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err(ERROR.into());
    }
    tauri::async_runtime::spawn_blocking(move || install(&app))
        .await
        .map_err(|_| ERROR)?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn spec(files: &[(&str, &[u8])]) -> Vec<Asset> {
        vec![Asset {
            repo: "Qdrant/bm25".into(),
            revision: "22b8d2af71a76161e18dd432d2cee0eefa66e412".into(),
            files: files
                .iter()
                .map(|(name, bytes)| {
                    (
                        (*name).to_owned(),
                        File {
                            sha256: format!("{:x}", Sha256::digest(bytes)),
                            bytes: bytes.len() as u64,
                        },
                    )
                })
                .collect(),
        }]
    }

    #[test]
    fn the_pinned_list_is_valid_and_about_255_mb() {
        let assets = assets().unwrap();
        assert_eq!(assets.len(), 2);
        assert_eq!(total(&assets), 266_984_674);
    }

    #[test]
    fn downloads_into_the_engine_cache_layout_and_skips_what_is_there() {
        let dir = tempfile::tempdir().unwrap();
        let assets = spec(&[("english.txt", b"the\nand\n"), ("config.json", b"{}")]);
        let mut fetched = Vec::new();
        install_into(dir.path(), &assets, &mut |_, name| {
            fetched.push(name.to_owned());
            Ok(Box::new(Cursor::new(if name == "english.txt" {
                b"the\nand\n".to_vec()
            } else {
                b"{}".to_vec()
            })))
        })
        .unwrap();
        let folder = dir
            .path()
            .join("hf/models--Qdrant--bm25/snapshots/22b8d2af71a76161e18dd432d2cee0eefa66e412");
        assert_eq!(fs::read(folder.join("english.txt")).unwrap(), b"the\nand\n");
        assert!(ready_in(dir.path(), &assets));
        assert_eq!(fetched.len(), 2);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(dir.path().join("hf"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o700
            );
            assert_eq!(
                fs::metadata(folder.join("config.json"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
        // A second run downloads nothing.
        install_into(dir.path(), &assets, &mut |_, _| panic!("downloaded again")).unwrap();
    }

    #[test]
    fn a_corrupted_or_oversized_download_is_discarded_and_retried_later() {
        let dir = tempfile::tempdir().unwrap();
        let assets = spec(&[("english.txt", b"the\nand\n")]);
        for body in [
            b"the\nant\n".to_vec(),
            b"the\nand\nmore".to_vec(),
            b"the".to_vec(),
        ] {
            assert!(
                install_into(dir.path(), &assets, &mut |_, _| Ok(Box::new(Cursor::new(
                    body.clone()
                ))))
                .is_err()
            );
            assert!(!ready_in(dir.path(), &assets));
            let folder = dir
                .path()
                .join("hf/models--Qdrant--bm25/snapshots/22b8d2af71a76161e18dd432d2cee0eefa66e412");
            assert_eq!(
                fs::read_dir(&folder).unwrap().count(),
                0,
                "no file or part left behind"
            );
        }
        install_into(dir.path(), &assets, &mut |_, _| {
            Ok(Box::new(Cursor::new(b"the\nand\n".to_vec())))
        })
        .unwrap();
        assert!(ready_in(dir.path(), &assets));
    }

    #[test]
    fn follows_only_hugging_face_hosts() {
        assert!(allowed_host(Some("huggingface.co")));
        assert!(allowed_host(Some("us.aws.cdn.hf.co")));
        assert!(allowed_host(Some("cas-bridge.xethub.hf.co")));
        for host in [
            "evilhf.co",
            "huggingface.co.example.com",
            "github.com",
            "hf.co.evil.com",
        ] {
            assert!(!allowed_host(Some(host)), "{host}");
        }
        assert!(!allowed_host(None));
    }

    #[test]
    #[ignore = "downloads the pinned search model (about 255 MB) from Hugging Face"]
    fn published_model_downloads_into_the_engine_cache() {
        // DRIFTY_MODELS_QA_DIR keeps the folder so the engine's own loader can be run on it.
        let kept = std::env::var_os("DRIFTY_MODELS_QA_DIR").map(PathBuf::from);
        let temp = tempfile::tempdir().unwrap();
        let models = kept.unwrap_or_else(|| temp.path().to_path_buf());
        fs::create_dir_all(&models).unwrap();
        let assets = assets().unwrap();
        let client = client().unwrap();
        install_into(&models, &assets, &mut |asset, name| {
            let url = format!(
                "https://huggingface.co/{}/resolve/{}/{}",
                asset.repo, asset.revision, name
            );
            Ok(Box::new(
                client
                    .get(url)
                    .send()
                    .and_then(|r| r.error_for_status())
                    .map_err(|_| ERROR)?,
            ) as Box<dyn Read>)
        })
        .unwrap();
        assert!(ready_in(&models, &assets));
    }
}
