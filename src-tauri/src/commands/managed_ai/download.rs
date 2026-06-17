use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};
use std::time::Duration;

use super::{ManagedAiError, ManagedAiModelSpec};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
const USER_AGENT: &str = "Drifty managed local AI downloader";

pub(super) fn download_model_artifact(
    root: &Path,
    spec: ManagedAiModelSpec,
) -> Result<PathBuf, ManagedAiError> {
    let staging_dir = root.join("downloads").join(spec.id);
    let artifact_dir = root.join("models").join(spec.id);
    reset_dir(&staging_dir)?;

    let staged_file = staging_dir.join(spec.file_name);
    let bytes_written = download_to_path(spec.download_url, &staged_file)?;
    verify_download_size(spec, bytes_written, &staged_file)?;

    if artifact_dir.exists() {
        fs::remove_dir_all(&artifact_dir)?;
    }
    fs::create_dir_all(root.join("models"))?;
    fs::rename(staging_dir, &artifact_dir)?;
    Ok(artifact_dir)
}

fn reset_dir(path: &Path) -> Result<(), ManagedAiError> {
    if path.exists() {
        fs::remove_dir_all(path)?;
    }
    fs::create_dir_all(path)?;
    Ok(())
}

fn download_to_path(url: &str, path: &Path) -> Result<u64, ManagedAiError> {
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .user_agent(USER_AGENT)
        .build()?;
    let mut response = client.get(url).send()?.error_for_status()?;
    let mut file = File::create(path)?;
    let bytes_written = io::copy(&mut response, &mut file)?;
    file.sync_all()?;
    Ok(bytes_written)
}

fn verify_download_size(
    spec: ManagedAiModelSpec,
    bytes_written: u64,
    path: &Path,
) -> Result<(), ManagedAiError> {
    if bytes_written == 0 {
        let _ = fs::remove_file(path);
        return Err(ManagedAiError::DownloadFailed(
            "downloaded model file was empty".to_string(),
        ));
    }
    if bytes_written != spec.expected_size_bytes {
        let _ = fs::remove_file(path);
        return Err(ManagedAiError::DownloadFailed(format!(
            "downloaded {bytes_written} bytes, expected {} bytes",
            spec.expected_size_bytes
        )));
    }
    Ok(())
}
