//! Optional engine installed only by an explicit Settings action. No account,
//! credentials, observation or provider call participates in artifact delivery.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::Duration,
};
use tauri::{AppHandle, Manager, WebviewWindow};

const ERROR: &str = "memory_runtime_unavailable";
const APP: &str = "Drifty Memory Engine.app";
const PROGRAM: &str = "Contents/Resources/memory-runtime/drifty-memory";
const MAX_EXPANDED: u64 = 400 * 1024 * 1024;
const SPEC: &str = include_str!("memory_runtime.json");
static INSTALL: Mutex<()> = Mutex::new(());
static PROGRESS: Mutex<Option<Progress>> = Mutex::new(None);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Artifact {
    version: String,
    url: String,
    sha256: String,
    bytes: u64,
    team: String,
    identifier: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    phase: &'static str,
    received: u64,
    total: u64,
}
impl Progress {
    pub(super) fn new(phase: &'static str, received: u64, total: u64) -> Self {
        Self { phase, received, total }
    }
    pub(super) fn phase(&self) -> &'static str {
        self.phase
    }
}
/// Whether this Mac can run the engine (Apple silicon, macOS 14 or later).
pub(super) fn supported() -> Result<(), String> {
    artifact().map(|_| ())
}

fn artifact() -> Result<Artifact, String> {
    if !cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        return Err(ERROR.into());
    }
    static OS: OnceLock<bool> = OnceLock::new();
    if !*OS.get_or_init(|| {
        std::process::Command::new("/usr/bin/sw_vers")
            .arg("-productVersion")
            .output()
            .is_ok_and(|r| r.status.success() && compatible_os(&String::from_utf8_lossy(&r.stdout)))
    }) {
        return Err(ERROR.into());
    }
    let spec: Artifact = serde_json::from_str(SPEC).map_err(|_| ERROR)?;
    if spec.version.is_empty()
        || !spec
            .version
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
        || spec.bytes == 0
        || spec.bytes > 160 * 1024 * 1024
        || spec.sha256.len() != 64
        || !spec.sha256.bytes().all(|b| b.is_ascii_hexdigit())
        || !spec.url.starts_with(
            "https://github.com/edgethink00/drifty_releases/releases/download/memory-engine-",
        )
        || spec.team != "242W5PXR2L"
        || spec.identifier != "so.drifty.memory-engine"
    {
        return Err(ERROR.into());
    }
    Ok(spec)
}

fn compatible_os(version: &str) -> bool {
    // The pinned ONNX Runtime wheel has LC_BUILD_VERSION minos 14.0.
    version
        .trim()
        .split('.')
        .next()
        .and_then(|v| v.parse::<u32>().ok())
        .is_some_and(|major| major >= 14)
}
fn private_dir(path: &Path) -> Result<(), String> {
    if path.exists() {
        if !fs::symlink_metadata(path).is_ok_and(|m| m.is_dir() && !m.file_type().is_symlink()) {
            return Err(ERROR.into());
        }
    } else {
        fs::create_dir(path).map_err(|_| ERROR)?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|_| ERROR)?;
    }
    Ok(())
}
fn root(app: &AppHandle) -> Result<PathBuf, String> {
    let data = app.path().app_local_data_dir().map_err(|_| ERROR)?;
    fs::create_dir_all(&data).map_err(|_| ERROR)?;
    // Refuse redirected app data and engine stores before writing.
    if data.canonicalize().map_err(|_| ERROR)? != data {
        return Err(ERROR.into());
    }
    let root = data.join("memory-engines");
    private_dir(&root)?;
    Ok(root)
}
pub(super) fn program(app: &AppHandle) -> Option<PathBuf> {
    let spec = artifact().ok()?;
    let path = root(app).ok()?.join(spec.version).join(APP).join(PROGRAM);
    if !path.is_file() || path.canonicalize().ok()? != path {
        return None;
    }
    Some(path)
}
fn verify(bundle: &Path, spec: &Artifact) -> Result<(), String> {
    if !cfg!(target_os = "macos") {
        return Err(ERROR.into());
    }
    let requirement = format!(
        "=anchor apple generic and identifier \"{}\" and certificate leaf[subject.OU] = \"{}\"",
        spec.identifier, spec.team
    );
    for (tool, args) in [
        (
            "/usr/bin/codesign",
            vec!["--verify", "--deep", "--strict", "-R", &requirement],
        ),
        ("/usr/sbin/spctl", vec!["--assess", "--type", "execute"]),
    ] {
        let result = std::process::Command::new(tool)
            .args(args)
            .arg(bundle)
            .output()
            .map_err(|_| ERROR)?;
        if !result.status.success() {
            return Err(ERROR.into());
        }
    }
    Ok(())
}
pub(super) fn verify_program(path: &Path) -> Result<(), String> {
    // Called immediately before each new worker, never merely trusted on install.
    verify(
        path.parent()
            .and_then(Path::parent)
            .and_then(Path::parent)
            .and_then(Path::parent)
            .ok_or(ERROR)?,
        &artifact()?,
    )
}
fn progress(phase: &'static str, received: u64, total: u64) {
    if let Ok(mut state) = PROGRESS.lock() {
        *state = Some(Progress {
            phase,
            received,
            total,
        });
    }
}
fn extract(archive: &Path, output: &Path) -> Result<(), String> {
    let mut zip =
        zip::ZipArchive::new(fs::File::open(archive).map_err(|_| ERROR)?).map_err(|_| ERROR)?;
    if zip.len() > 5000 {
        return Err(ERROR.into());
    }
    let mut total = 0_u64;
    for index in 0..zip.len() {
        let entry = zip.by_index(index).map_err(|_| ERROR)?;
        let executable = entry.unix_mode().unwrap_or(0) & 0o111 != 0;
        let relative = entry.enclosed_name().ok_or(ERROR)?.to_path_buf();
        if relative
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
            || !relative.starts_with(APP)
            || entry.is_symlink()
        {
            return Err(ERROR.into());
        }
        total = total
            .checked_add(entry.size())
            .filter(|v| *v <= MAX_EXPANDED)
            .ok_or(ERROR)?;
        let path = output.join(relative);
        let parent = path.parent().ok_or(ERROR)?;
        fs::create_dir_all(parent).map_err(|_| ERROR)?;
        if entry.is_dir() {
            private_dir(&path)?;
            continue;
        }
        let mut file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&path)
            .map_err(|_| ERROR)?;
        let expected = entry.size();
        let copied = std::io::copy(&mut entry.take(expected + 1), &mut file).map_err(|_| ERROR)?;
        if copied != expected {
            return Err(ERROR.into());
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(
                &path,
                fs::Permissions::from_mode(if executable { 0o700 } else { 0o600 }),
            )
            .map_err(|_| ERROR)?;
        }
    }
    Ok(())
}
fn install(app: &AppHandle) -> Result<(), String> {
    let _guard = INSTALL.try_lock().map_err(|_| ERROR)?;
    let spec = artifact()?;
    let store = root(app)?;
    install_into(&store, &spec)
}
fn install_into(store: &Path, spec: &Artifact) -> Result<(), String> {
    if store.join(&spec.version).join(APP).join(PROGRAM).is_file()
        && verify(&store.join(&spec.version).join(APP), spec).is_ok()
    {
        return Ok(());
    }
    progress("downloading", 0, spec.bytes);
    let outcome = (|| {
        let stage = tempfile::Builder::new()
            .prefix(".install-")
            .tempdir_in(store)
            .map_err(|_| ERROR)?;
        let archive = stage.path().join("engine.zip");
        let client = reqwest::blocking::Client::builder()
            .connect_timeout(Duration::from_secs(20))
            .timeout(Duration::from_secs(600))
            .https_only(true)
            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                if attempt.previous().len() < 5
                    && attempt.url().scheme() == "https"
                    && matches!(
                        attempt.url().host_str(),
                        Some(
                            "github.com"
                                | "release-assets.githubusercontent.com"
                                | "objects.githubusercontent.com"
                        )
                    )
                {
                    attempt.follow()
                } else {
                    attempt.stop()
                }
            }))
            .build()
            .map_err(|_| ERROR)?;
        let mut response = client
            .get(&spec.url)
            .send()
            .and_then(|r| r.error_for_status())
            .map_err(|_| ERROR)?;
        let mut file = fs::File::create(&archive).map_err(|_| ERROR)?;
        let mut hash = Sha256::new();
        let mut received = 0_u64;
        let mut buffer = [0_u8; 65536];
        loop {
            let n = response.read(&mut buffer).map_err(|_| ERROR)?;
            if n == 0 {
                break;
            }
            received += n as u64;
            if received > spec.bytes {
                return Err(ERROR.to_owned());
            }
            file.write_all(&buffer[..n]).map_err(|_| ERROR)?;
            hash.update(&buffer[..n]);
            progress("downloading", received, spec.bytes);
        }
        if received != spec.bytes || format!("{:x}", hash.finalize()) != spec.sha256 {
            return Err(ERROR.into());
        }
        file.sync_all().map_err(|_| ERROR)?;
        progress("verifying", received, spec.bytes);
        let unpacked = stage.path().join("unpacked");
        private_dir(&unpacked)?;
        extract(&archive, &unpacked)?;
        verify(&unpacked.join(APP), spec)?;
        let target = store.join(&spec.version);
        if target.exists() {
            // Only this pinned code version's cache is replaced; memory is elsewhere.
            if target.canonicalize().map_err(|_| ERROR)? != target {
                return Err(ERROR.into());
            }
            fs::remove_dir_all(&target).map_err(|_| ERROR)?;
        }
        fs::rename(&unpacked, &target).map_err(|_| ERROR)?;
        Ok(())
    })();
    progress(
        if outcome.is_ok() { "ready" } else { "failed" },
        0,
        spec.bytes,
    );
    outcome
}
#[tauri::command]
pub fn memory_runtime_status(app: AppHandle, window: WebviewWindow) -> Result<Progress, String> {
    if window.label() != "main" {
        return Err(ERROR.into());
    }
    if let Some(value) = PROGRESS.lock().map_err(|_| ERROR)?.clone() {
        return Ok(value);
    }
    Ok(Progress {
        phase: if program(&app).is_some() {
            "ready"
        } else if artifact().is_ok() {
            "missing"
        } else {
            "unsupported"
        },
        received: 0,
        total: artifact().map(|s| s.bytes).unwrap_or(0),
    })
}
#[tauri::command]
pub async fn memory_runtime_install(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err(ERROR.into());
    }
    tauri::async_runtime::spawn_blocking(move || install(&app))
        .await
        .map_err(|_| ERROR)?
}

#[cfg(test)]
mod tests;
