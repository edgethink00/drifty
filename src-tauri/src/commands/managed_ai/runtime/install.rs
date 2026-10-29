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

const RUNTIME_ARCHIVE_TIMEOUT_SECS: u64 = 120;

// Concurrent managed_ai_start calls (gate classification, live classification,
// connection tests) must not race the download/unpack: each install wipes the
// shared staging dir, so two interleaved installs destroy each other's files.
static RUNTIME_INSTALL_LOCK: Mutex<()> = Mutex::new(());

struct RuntimeArchive {
    os: &'static str,
    arch: &'static str,
    url: &'static str,
    sha256: &'static str,
    expected_size_bytes: u64,
    format: RuntimeArchiveFormat,
    payload_dir: Option<&'static str>,
    runtime_file_name: &'static str,
    required_files: &'static [&'static str],
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RuntimeArchiveFormat {
    TarGz,
    Zip,
}

const RUNTIME_ARCHIVES: &[RuntimeArchive] = &[
    RuntimeArchive {
        os: "macos",
        arch: "aarch64",
        // The upstream b9690 arm64 artifact is built with a macOS 26.0
        // deployment target. This rebuild uses the exact b9690 source commit
        // with a macOS 13.0 target so it can honor Drifty's supported OS range.
        // Runtime archives are versioned independently from app releases; keep
        // reusing these hash- and size-pinned bytes until the runtime changes.
        url: "https://github.com/edgethink00/drifty_releases/releases/download/1.9.4/llama-b9690-drifty-bin-macos-arm64-macos13.tar.gz",
        sha256: "ed5c2580fbd32be0878db83d3a6fe5364fcce26cdc7ed48db71e1f83642308ce",
        expected_size_bytes: 7_334_981,
        format: RuntimeArchiveFormat::TarGz,
        payload_dir: Some("llama-b9690"),
        runtime_file_name: "llama-server",
        required_files: &[
            "llama-server",
            "DRIFTY_RUNTIME_MACOS13",
            "libllama-server-impl.dylib",
            "libllama-common.0.dylib",
            "libmtmd.0.dylib",
            "libllama.0.dylib",
            "libggml.0.dylib",
            "libggml-cpu.0.dylib",
            "libggml-metal.0.dylib",
            "libggml-base.0.dylib",
        ],
    },
    RuntimeArchive {
        os: "macos",
        arch: "x86_64",
        url: "https://github.com/ggml-org/llama.cpp/releases/download/b9690/llama-b9690-bin-macos-x64.tar.gz",
        sha256: "9311257e3787ea8162bd7c3809c8ea79145ecc1afc1f4349a9567eb2c9fa2c77",
        expected_size_bytes: 11_204_002,
        format: RuntimeArchiveFormat::TarGz,
        payload_dir: Some("llama-b9690"),
        runtime_file_name: "llama-server",
        required_files: &["llama-server"],
    },
    RuntimeArchive {
        os: "windows",
        arch: "x86_64",
        url: "https://github.com/ggml-org/llama.cpp/releases/download/b9690/llama-b9690-bin-win-cpu-x64.zip",
        sha256: "d50b9c2e801b2d91e8d6bd915e3484f6282d3220a7d31163cff4f5ce82831020",
        expected_size_bytes: 17_237_515,
        format: RuntimeArchiveFormat::Zip,
        payload_dir: None,
        runtime_file_name: "llama-server.exe",
        required_files: &[
            "llama-server.exe",
            "llama-server-impl.dll",
            "llama-common.dll",
            "llama.dll",
            "ggml.dll",
            "ggml-base.dll",
            "ggml-rpc.dll",
            "libomp140.x86_64.dll",
            "ggml-cpu-alderlake.dll",
            "ggml-cpu-cannonlake.dll",
            "ggml-cpu-cascadelake.dll",
            "ggml-cpu-cooperlake.dll",
            "ggml-cpu-haswell.dll",
            "ggml-cpu-icelake.dll",
            "ggml-cpu-ivybridge.dll",
            "ggml-cpu-piledriver.dll",
            "ggml-cpu-sandybridge.dll",
            "ggml-cpu-sapphirerapids.dll",
            "ggml-cpu-skylakex.dll",
            "ggml-cpu-sse42.dll",
            "ggml-cpu-x64.dll",
            "ggml-cpu-zen4.dll",
        ],
    },
];

pub(super) fn require_runtime_path(root: &Path) -> Result<PathBuf, ManagedAiError> {
    if let Some(env_path) = debug_env_runtime_path() {
        return Ok(env_path);
    }

    let _install_guard = RUNTIME_INSTALL_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    let archive = runtime_archive_for_current_arch()?;
    let runtime_path = runtime_path(root);
    if runtime_install_complete(root, archive) {
        ensure_runtime_executable(&runtime_path)?;
        return Ok(runtime_path);
    }

    install_runtime(root)?;
    if runtime_install_complete(root, archive) {
        return Ok(runtime_path);
    }

    Err(ManagedAiError::RuntimeMissing(format!(
        "{} was not found after runtime install at {}.",
        RUNTIME_FILE_NAME,
        runtime_path.display()
    )))
}

#[cfg(not(drifty_screen_context_excluded))]
pub(super) fn screen_runtime_archive_pin() -> Option<&'static str> {
    runtime_archive_for_current_arch().ok().map(|archive| archive.sha256)
}

pub(super) fn expected_runtime_path(root: &Path) -> PathBuf {
    debug_env_runtime_path().unwrap_or_else(|| runtime_path(root))
}

pub(super) fn runtime_assets_ready(root: &Path) -> Result<bool, ManagedAiError> {
    if debug_env_runtime_path().is_some() {
        return Ok(true);
    }
    Ok(runtime_install_complete(
        root,
        runtime_archive_for_current_arch()?,
    ))
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
    install_runtime_from_archive(root, &bytes, archive)
}

fn download_runtime_archive(archive: &RuntimeArchive) -> Result<Vec<u8>, ManagedAiError> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(RUNTIME_ARCHIVE_TIMEOUT_SECS))
        .user_agent("Drifty managed local AI runtime installer")
        .build()
        .map_err(|error| ManagedAiError::RuntimeDownloadFailed(error.to_string()))?;
    let mut response = client
        .get(archive.url)
        .send()
        .and_then(reqwest::blocking::Response::error_for_status)
        .map_err(|error| ManagedAiError::RuntimeDownloadFailed(error.to_string()))?;
    if let Some(content_length) = response.content_length() {
        if content_length != archive.expected_size_bytes {
            return Err(ManagedAiError::RuntimeDownloadFailed(format!(
                "runtime archive size mismatch: expected {} bytes, server declared {content_length}",
                archive.expected_size_bytes
            )));
        }
    }
    read_archive_bytes(&mut response, archive.expected_size_bytes)
}

fn read_archive_bytes(
    reader: &mut impl Read,
    expected_size_bytes: u64,
) -> Result<Vec<u8>, ManagedAiError> {
    let mut bytes = Vec::with_capacity(expected_size_bytes as usize);
    reader
        .take(expected_size_bytes.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|error| ManagedAiError::RuntimeDownloadFailed(error.to_string()))?;
    if bytes.len() as u64 != expected_size_bytes {
        return Err(ManagedAiError::RuntimeDownloadFailed(format!(
            "runtime archive size mismatch: expected {expected_size_bytes} bytes, received {}",
            bytes.len()
        )));
    }
    Ok(bytes)
}

fn install_runtime_from_archive(
    root: &Path,
    bytes: &[u8],
    archive: &RuntimeArchive,
) -> Result<(), ManagedAiError> {
    let runtime_dir = root.join("runtime");
    let staging_dir = root.join("runtime.staging");
    if staging_dir.exists() {
        fs::remove_dir_all(&staging_dir)?;
    }
    fs::create_dir_all(&staging_dir)?;
    match archive.format {
        RuntimeArchiveFormat::TarGz => {
            let mut tar = Archive::new(GzDecoder::new(Cursor::new(bytes)));
            tar.unpack(&staging_dir)?;
        }
        RuntimeArchiveFormat::Zip => {
            let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|error| {
                ManagedAiError::RuntimeFailed(format!("runtime zip is invalid: {error}"))
            })?;
            zip.extract(&staging_dir).map_err(|error| {
                ManagedAiError::RuntimeFailed(format!("runtime zip extraction failed: {error}"))
            })?;
        }
    }

    let extracted_dir = archive
        .payload_dir
        .map(|directory| staging_dir.join(directory))
        .unwrap_or_else(|| staging_dir.clone());
    if let Some(missing) = archive
        .required_files
        .iter()
        .find(|file_name| !extracted_dir.join(file_name).is_file())
    {
        return Err(ManagedAiError::RuntimeMissing(format!(
            "{missing} missing inside downloaded runtime archive."
        )));
    }
    if runtime_dir.exists() {
        fs::remove_dir_all(&runtime_dir)?;
    }
    fs::rename(extracted_dir, &runtime_dir)?;
    if staging_dir.exists() {
        fs::remove_dir_all(staging_dir)?;
    }
    ensure_runtime_executable(&runtime_dir.join(archive.runtime_file_name))?;
    Ok(())
}

fn runtime_archive_for_current_arch() -> Result<&'static RuntimeArchive, ManagedAiError> {
    runtime_archive_for(std::env::consts::OS, std::env::consts::ARCH).ok_or_else(|| {
        ManagedAiError::RuntimeMissing(format!(
            "llama.cpp managed runtime is not available for {} {}.",
            std::env::consts::OS,
            std::env::consts::ARCH,
        ))
    })
}

fn runtime_archive_for(os: &str, arch: &str) -> Option<&'static RuntimeArchive> {
    RUNTIME_ARCHIVES
        .iter()
        .find(|archive| archive.os == os && archive.arch == arch)
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
        Err(ManagedAiError::RuntimeDownloadFailed(format!(
            "runtime checksum mismatch: expected {expected}, got {actual}"
        )))
    }
}

fn runtime_path(root: &Path) -> PathBuf {
    root.join("runtime").join(RUNTIME_FILE_NAME)
}

fn runtime_install_complete(root: &Path, archive: &RuntimeArchive) -> bool {
    let runtime_dir = root.join("runtime");
    archive
        .required_files
        .iter()
        .all(|file_name| runtime_dir.join(file_name).is_file())
}

#[cfg(test)]
pub(super) fn write_runtime_completion_fixture(root: &Path) -> Result<(), ManagedAiError> {
    let archive = runtime_archive_for_current_arch()?;
    let runtime_dir = root.join("runtime");
    fs::create_dir_all(&runtime_dir)?;
    for file_name in archive.required_files {
        let path = runtime_dir.join(file_name);
        if !path.exists() {
            fs::write(path, b"test runtime dependency")?;
        }
    }
    Ok(())
}

fn ensure_runtime_executable(path: &Path) -> Result<(), ManagedAiError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = File::open(path)?.metadata()?.permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(path, permissions)?;
    }
    #[cfg(not(unix))]
    {
        // Windows has no executable permission bit; opening the file still
        // catches a missing or inaccessible runtime before start-up.
        let _file = File::open(path)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    #[test]
    fn runtime_manifest_selects_supported_desktop_targets() {
        assert!(runtime_archive_for("macos", "aarch64").is_some());
        assert!(runtime_archive_for("macos", "x86_64").is_some());
        assert!(runtime_archive_for("windows", "aarch64").is_none());
        assert!(runtime_archive_for("windows", "x86_64").is_some());
        assert!(runtime_archive_for("windows", "armv7").is_none());
        assert!(runtime_archive_for("linux", "x86_64").is_none());
    }

    #[test]
    fn macos_arm_runtime_uses_a_drifty_owned_pinned_release_and_compatibility_marker() {
        let archive = runtime_archive_for("macos", "aarch64").expect("arm64 runtime archive");

        assert!(archive
            .url
            .starts_with("https://github.com/edgethink00/drifty_releases/releases/download/"));
        assert!(!archive.url.contains("/releases/latest/"));
        assert!(archive.required_files.contains(&"DRIFTY_RUNTIME_MACOS13"));
    }

    #[test]
    fn runtime_checksum_rejects_modified_archive_bytes() {
        let archive = runtime_archive_for("macos", "aarch64").expect("arm64 runtime archive");
        let result = verify_archive_sha256(b"not a runtime", archive.sha256);
        assert!(matches!(
            result,
            Err(ManagedAiError::RuntimeDownloadFailed(_))
        ));
    }

    #[test]
    fn windows_zip_install_keeps_the_server_and_sibling_dlls_together() {
        let root = tempfile::tempdir().expect("create runtime root");
        let cursor = Cursor::new(Vec::new());
        let mut writer = zip::ZipWriter::new(cursor);
        let options = SimpleFileOptions::default();
        writer
            .start_file("llama-server.exe", options)
            .expect("start server entry");
        writer.write_all(b"server").expect("write server entry");
        writer
            .start_file("ggml.dll", options)
            .expect("start DLL entry");
        writer.write_all(b"dll").expect("write DLL entry");
        let bytes = writer.finish().expect("finish zip").into_inner();
        let archive = RuntimeArchive {
            os: "windows",
            arch: "x86_64",
            url: "https://example.invalid/runtime.zip",
            sha256: "unused",
            expected_size_bytes: bytes.len() as u64,
            format: RuntimeArchiveFormat::Zip,
            payload_dir: None,
            runtime_file_name: "llama-server.exe",
            required_files: &["llama-server.exe", "ggml.dll"],
        };

        install_runtime_from_archive(root.path(), &bytes, &archive).expect("install runtime zip");

        assert!(root.path().join("runtime/llama-server.exe").is_file());
        assert!(root.path().join("runtime/ggml.dll").is_file());
        assert!(!root.path().join("runtime.staging").exists());
        assert!(runtime_install_complete(root.path(), &archive));

        fs::remove_file(root.path().join("runtime/ggml.dll")).expect("remove required DLL");
        assert!(!runtime_install_complete(root.path(), &archive));
    }

    #[test]
    fn archive_reader_rejects_short_and_oversized_bodies() {
        assert_eq!(
            read_archive_bytes(&mut Cursor::new(b"1234"), 4).expect("exact body"),
            b"1234"
        );
        assert!(matches!(
            read_archive_bytes(&mut Cursor::new(b"123"), 4),
            Err(ManagedAiError::RuntimeDownloadFailed(_))
        ));
        assert!(matches!(
            read_archive_bytes(&mut Cursor::new(b"12345"), 4),
            Err(ManagedAiError::RuntimeDownloadFailed(_))
        ));
    }

    #[cfg(unix)]
    #[test]
    fn complete_runtime_reapplies_executable_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let root = tempfile::tempdir().expect("create runtime root");
        write_runtime_completion_fixture(root.path()).expect("write runtime fixture");
        let path = runtime_path(root.path());
        let mut permissions = fs::metadata(&path).expect("runtime metadata").permissions();
        permissions.set_mode(0o644);
        fs::set_permissions(&path, permissions).expect("remove executable permission");

        let required = require_runtime_path(root.path()).expect("repair complete runtime");
        let mode = fs::metadata(required)
            .expect("repaired metadata")
            .permissions()
            .mode();

        assert_ne!(mode & 0o111, 0);
    }

    #[cfg(target_os = "windows")]
    #[test]
    #[ignore = "downloads and launches the pinned official llama.cpp Windows runtime"]
    fn windows_pinned_runtime_downloads_installs_and_launches() {
        let root = tempfile::tempdir().expect("create runtime root");
        let archive = runtime_archive_for_current_arch().expect("select Windows runtime archive");
        let bytes = download_runtime_archive(archive).expect("download pinned Windows runtime");
        verify_archive_sha256(&bytes, archive.sha256).expect("verify Windows runtime checksum");
        install_runtime_from_archive(root.path(), &bytes, archive)
            .expect("install pinned Windows runtime");

        let runtime_path = root.path().join("runtime").join(archive.runtime_file_name);
        let output = std::process::Command::new(&runtime_path)
            .arg("--version")
            .output()
            .expect("launch installed llama-server");

        assert!(
            output.status.success(),
            "llama-server --version failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
