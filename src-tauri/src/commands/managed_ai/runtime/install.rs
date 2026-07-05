use std::{
    fs::{self, File},
    io::{Cursor, Read},
    path::{Path, PathBuf},
    sync::Mutex,
};

use flate2::read::GzDecoder;
use sha2::{Digest, Sha256};
use tar::Archive;

use super::super::ManagedAiError;
use super::RUNTIME_FILE_NAME;

const RUNTIME_RELEASE_DIR: &str = "llama-b9690";
const RUNTIME_ARCHIVE_TIMEOUT_SECS: u64 = 120;

// Concurrent managed_ai_start calls (gate classification, live classification,
// connection tests) must not race the download/unpack: each install wipes the
// shared staging dir, so two interleaved installs destroy each other's files.
static RUNTIME_INSTALL_LOCK: Mutex<()> = Mutex::new(());

struct RuntimeArchive {
    arch: &'static str,
    url: &'static str,
    sha256: &'static str,
}

const RUNTIME_ARCHIVES: &[RuntimeArchive] = &[
    RuntimeArchive {
        arch: "aarch64",
        url: "https://github.com/ggml-org/llama.cpp/releases/download/b9690/llama-b9690-bin-macos-arm64.tar.gz",
        sha256: "2a6369266a8e349ee282cd98b39ddb2cf23f57860d2225d20c791aa5a3f3a44b",
    },
    RuntimeArchive {
        arch: "x86_64",
        url: "https://github.com/ggml-org/llama.cpp/releases/download/b9690/llama-b9690-bin-macos-x64.tar.gz",
        sha256: "9311257e3787ea8162bd7c3809c8ea79145ecc1afc1f4349a9567eb2c9fa2c77",
    },
];

pub(super) fn require_runtime_path(root: &Path) -> Result<PathBuf, ManagedAiError> {
    if let Some(env_path) = debug_env_runtime_path() {
        return Ok(env_path);
    }

    let _install_guard = RUNTIME_INSTALL_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    let runtime_path = runtime_path(root);
    if runtime_path.is_file() {
        return Ok(runtime_path);
    }

    install_runtime(root)?;
    if runtime_path.is_file() {
        return Ok(runtime_path);
    }

    Err(ManagedAiError::RuntimeMissing(format!(
        "{} was not found after runtime install at {}.",
        RUNTIME_FILE_NAME,
        runtime_path.display()
    )))
}

pub(super) fn expected_runtime_path(root: &Path) -> PathBuf {
    debug_env_runtime_path().unwrap_or_else(|| runtime_path(root))
}

fn debug_env_runtime_path() -> Option<PathBuf> {
    #[cfg(debug_assertions)]
    {
        let Ok(path) = std::env::var("DRIFTY_LLAMA_SERVER_PATH") else {
            return None;
        };
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            let env_path = PathBuf::from(trimmed);
            if env_path.is_file() {
                return Some(env_path);
            }
        }
    }
    None
}

fn install_runtime(root: &Path) -> Result<(), ManagedAiError> {
    let archive = runtime_archive_for_current_arch()?;
    let bytes = download_runtime_archive(archive)?;
    verify_archive_sha256(&bytes, archive.sha256)?;
    install_runtime_from_archive(root, &bytes)
}

fn download_runtime_archive(archive: &RuntimeArchive) -> Result<Vec<u8>, ManagedAiError> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(RUNTIME_ARCHIVE_TIMEOUT_SECS))
        .user_agent("Drifty managed local AI runtime installer")
        .build()?;
    let mut response = client.get(archive.url).send()?.error_for_status()?;
    let mut bytes = Vec::new();
    response.read_to_end(&mut bytes)?;
    Ok(bytes)
}

fn install_runtime_from_archive(root: &Path, bytes: &[u8]) -> Result<(), ManagedAiError> {
    let runtime_dir = root.join("runtime");
    let staging_dir = root.join("runtime.staging");
    if staging_dir.exists() {
        fs::remove_dir_all(&staging_dir)?;
    }
    fs::create_dir_all(&staging_dir)?;
    let mut archive = Archive::new(GzDecoder::new(Cursor::new(bytes)));
    archive.unpack(&staging_dir)?;

    let extracted_dir = staging_dir.join(RUNTIME_RELEASE_DIR);
    if !extracted_dir.join(RUNTIME_FILE_NAME).is_file() {
        return Err(ManagedAiError::RuntimeMissing(format!(
            "{} missing inside downloaded runtime archive.",
            RUNTIME_FILE_NAME
        )));
    }
    if runtime_dir.exists() {
        fs::remove_dir_all(&runtime_dir)?;
    }
    fs::rename(extracted_dir, &runtime_dir)?;
    fs::remove_dir_all(staging_dir)?;
    ensure_runtime_executable(&runtime_dir.join(RUNTIME_FILE_NAME))?;
    Ok(())
}

fn runtime_archive_for_current_arch() -> Result<&'static RuntimeArchive, ManagedAiError> {
    if std::env::consts::OS != "macos" {
        return Err(ManagedAiError::RuntimeMissing(format!(
            "llama.cpp managed runtime is not available for {}.",
            std::env::consts::OS
        )));
    }
    runtime_archive_for_arch(std::env::consts::ARCH).ok_or_else(|| {
        ManagedAiError::RuntimeMissing(format!(
            "llama.cpp managed runtime is not available for {}.",
            std::env::consts::ARCH
        ))
    })
}

fn runtime_archive_for_arch(arch: &str) -> Option<&'static RuntimeArchive> {
    RUNTIME_ARCHIVES.iter().find(|archive| archive.arch == arch)
}

fn verify_archive_sha256(bytes: &[u8], expected: &str) -> Result<(), ManagedAiError> {
    let digest = Sha256::digest(bytes);
    let actual = digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    if actual == expected {
        Ok(())
    } else {
        Err(ManagedAiError::RuntimeFailed(format!(
            "runtime checksum mismatch: expected {expected}, got {actual}"
        )))
    }
}

fn runtime_path(root: &Path) -> PathBuf {
    root.join("runtime").join(RUNTIME_FILE_NAME)
}

fn ensure_runtime_executable(path: &Path) -> Result<(), ManagedAiError> {
    let mut permissions = File::open(path)?.metadata()?.permissions();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        permissions.set_mode(0o755);
    }
    fs::set_permissions(path, permissions)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_manifest_selects_supported_macos_arches() {
        assert!(runtime_archive_for_arch("aarch64").is_some());
        assert!(runtime_archive_for_arch("x86_64").is_some());
        assert!(runtime_archive_for_arch("armv7").is_none());
    }

    #[test]
    fn runtime_checksum_rejects_modified_archive_bytes() {
        let archive = runtime_archive_for_arch("aarch64").expect("arm64 runtime archive");
        let result = verify_archive_sha256(b"not a runtime", archive.sha256);
        assert!(result.is_err());
    }
}
