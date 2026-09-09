//! Explicit, signed version selection from the public Drifty release repository.
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tauri_plugin_updater::UpdaterExt;

const API: &str = "https://api.github.com/repos/edgethink00/drifty_releases/releases";
const DOWNLOAD: &str = "https://github.com/edgethink00/drifty_releases/releases/download/";
static INSTALLING: AtomicBool = AtomicBool::new(false);
struct InstallGuard;
impl Drop for InstallGuard {
    fn drop(&mut self) {
        INSTALLING.store(false, Ordering::SeqCst);
    }
}
#[derive(Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
}
#[derive(Deserialize)]
struct Release {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    published_at: Option<String>,
    assets: Vec<Asset>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListedRelease {
    tag: String,
    version: String,
    prerelease: bool,
    published_at: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseList {
    current_version: String,
    releases: Vec<ListedRelease>,
    has_more: bool,
    install_unavailable_reason: Option<String>,
    backup_directory: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    backup_path: Option<String>,
    version: String,
}
fn valid_tag(tag: &str) -> bool {
    !tag.is_empty()
        && tag.len() <= 100
        && tag
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b".-_".contains(&b))
}
fn official_asset(url: &str, tag: &str) -> bool {
    let prefix = format!("{DOWNLOAD}{tag}/");
    url.strip_prefix(&prefix)
        .is_some_and(|name| !name.is_empty() && !name.contains(['/', '?', '#', '%', '\\']))
}
fn manifest(release: &Release) -> Option<&Asset> {
    if release.draft || !valid_tag(&release.tag_name) {
        return None;
    }
    let name = if release.prerelease {
        "latest-prerelease.json"
    } else {
        "latest.json"
    };
    release
        .assets
        .iter()
        .find(|a| a.name == name && official_asset(&a.browser_download_url, &release.tag_name))
}
fn install_unavailable(app: &AppHandle) -> Option<String> {
    if !cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        return Some("Version switching currently supports Apple silicon Macs only.".into());
    }
    if cfg!(debug_assertions) || app.config().identifier != "so.drifty.mac" {
        return Some("Install a packaged production Drifty app to switch versions. Development and isolated apps cannot replace themselves with a public release.".into());
    }
    None
}
fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("Drifty-version-testing")
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())
}
async fn fetch_release(tag: &str) -> Result<Release, String> {
    if !valid_tag(tag) {
        return Err("Invalid release tag".into());
    }
    client()?
        .get(format!("{API}/tags/{tag}"))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn developer_list_releases(app: AppHandle) -> Result<ReleaseList, String> {
    let all: Vec<Release> = client()?
        .get(format!("{API}?per_page=100"))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| format!("Could not load releases: {e}"))?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let has_more = all.len() == 100;
    let releases = all
        .into_iter()
        .filter(|r| {
            manifest(r).is_some()
                && r.assets.iter().any(|a| a.name.ends_with("_aarch64.dmg"))
                && r.assets.iter().any(|a| {
                    a.name.ends_with(".app.tar.gz")
                        && official_asset(&a.browser_download_url, &r.tag_name)
                        && r.assets
                            .iter()
                            .any(|signature| signature.name == format!("{}.sig", a.name))
                })
        })
        .map(|r| ListedRelease {
            // Public RC tags can intentionally carry a stable CFBundleShortVersionString.
            version: r
                .tag_name
                .trim_start_matches('v')
                .split("-rc.")
                .next()
                .unwrap_or(&r.tag_name)
                .into(),
            tag: r.tag_name,
            prerelease: r.prerelease,
            published_at: r.published_at,
        })
        .collect();
    Ok(ReleaseList {
        current_version: app.package_info().version.to_string(),
        releases,
        has_more,
        install_unavailable_reason: install_unavailable(&app),
        backup_directory: app
            .path()
            .app_local_data_dir()
            .map_err(|e| e.to_string())?
            .join("database-backups")
            .display()
            .to_string(),
    })
}
#[tauri::command]
pub async fn developer_install_release(
    app: AppHandle,
    tag: String,
) -> Result<InstallResult, String> {
    if let Some(reason) = install_unavailable(&app) {
        return Err(reason);
    }
    INSTALLING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .map_err(|_| "A version installation is already running".to_string())?;
    let _guard = InstallGuard;
    let release = fetch_release(&tag).await?;
    if release.tag_name != tag {
        return Err("Release tag mismatch".into());
    }
    let manifest =
        manifest(&release).ok_or("This public release has no supported updater manifest")?;
    let endpoint = manifest
        .browser_download_url
        .parse()
        .map_err(|_| "Invalid manifest URL")?;
    let updater = app
        .updater_builder()
        .target("darwin-aarch64")
        .endpoints(vec![endpoint])
        .map_err(|e| e.to_string())?
        .version_comparator(|_, _| true)
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;
    let mut update = updater
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or("Release has no compatible update")?;
    if update.signature.trim().is_empty()
        || !official_asset(update.download_url.as_str(), &tag)
        || !release.assets.iter().any(|a| {
            a.browser_download_url == update.download_url.as_str()
                && a.name.ends_with(".app.tar.gz")
        })
    {
        return Err("Release updater asset or signature is invalid".into());
    }
    let expected_version = tag
        .trim_start_matches('v')
        .split("-rc.")
        .next()
        .unwrap_or(&tag);
    if update.version != expected_version {
        return Err("Release manifest version does not match its tag".into());
    }
    update.timeout = Some(Duration::from_secs(300));
    // Tauri verifies the signature during download, before touching the tracker or app.
    let bytes = update
        .download(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    let backup_app = app.clone();
    let backup_path = tauri::async_runtime::spawn_blocking(move || {
        backup_app
            .state::<crate::tracker::TrackerController>()
            .backup_for_version_switch(&backup_app)
    })
    .await
    .map_err(|e| e.to_string())??;
    update.install(bytes).map_err(|e| {
        format!(
            "Installation failed; tracker backup retained at {}: {e}",
            backup_path.as_deref().unwrap_or("no database")
        )
    })?;
    Ok(InstallResult {
        backup_path,
        version: update.version,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tags_and_assets_stay_in_release_namespace() {
        for bad in ["", "../latest", "1.0?x", "1%2f0", "a/b"] {
            assert!(!valid_tag(bad));
        }
        assert!(valid_tag("1.11.1-rc.1"));
        assert!(official_asset(
            &format!("{DOWNLOAD}1.0/a.app.tar.gz"),
            "1.0"
        ));
        for bad in [
            format!("{DOWNLOAD}1.0/../evil"),
            format!("{DOWNLOAD}1.0/a%2fb"),
            format!("{DOWNLOAD}1.0/a?x"),
            format!("{DOWNLOAD}2.0/a"),
            "https://evil.example/a".into(),
        ] {
            assert!(!official_asset(&bad, "1.0"));
        }
    }
    #[test]
    fn install_guard_releases_after_error_scope() {
        INSTALLING.store(false, Ordering::SeqCst);
        {
            INSTALLING
                .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                .unwrap();
            let _guard = InstallGuard;
            assert!(INSTALLING
                .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                .is_err());
        }
        assert!(!INSTALLING.load(Ordering::SeqCst));
    }
    #[test]
    fn rejects_drafts_and_wrong_channel_manifests() {
        let mut r = Release {
            tag_name: "1.0".into(),
            draft: false,
            prerelease: false,
            published_at: None,
            assets: vec![Asset {
                name: "latest.json".into(),
                browser_download_url: format!("{DOWNLOAD}1.0/latest.json"),
            }],
        };
        assert!(manifest(&r).is_some());
        r.draft = true;
        assert!(manifest(&r).is_none());
        r.draft = false;
        r.prerelease = true;
        assert!(manifest(&r).is_none());
    }
}
