use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use super::{ManagedAiDownloadProgress, ManagedAiError, ManagedAiModelSpec};

const DOWNLOAD_BUFFER_SIZE: usize = 64 * 1024;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
const USER_AGENT: &str = "Drifty managed local AI downloader";

pub(super) fn download_model_artifact(
    root: &Path,
    spec: ManagedAiModelSpec,
    progress: &mut dyn FnMut(ManagedAiDownloadProgress) -> Result<(), ManagedAiError>,
) -> Result<PathBuf, ManagedAiError> {
    let staging_dir = root.join("downloads").join(spec.id);
    let artifact_dir = root.join("models").join(spec.id);
    reset_dir(&staging_dir)?;

    let staged_file = staging_dir.join(spec.file_name);
    let bytes_written = download_to_path(
        spec.download_url,
        spec.expected_size_bytes,
        &staged_file,
        progress,
    )?;
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

fn download_to_path(
    url: &str,
    total_bytes: u64,
    path: &Path,
    progress: &mut dyn FnMut(ManagedAiDownloadProgress) -> Result<(), ManagedAiError>,
) -> Result<u64, ManagedAiError> {
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .user_agent(USER_AGENT)
        .build()?;
    let mut response = client.get(url).send()?.error_for_status()?;
    let mut file = File::create(path)?;
    let mut bytes_written = 0_u64;
    let mut buffer = [0_u8; DOWNLOAD_BUFFER_SIZE];
    loop {
        let bytes_read = read_download_chunk(&mut response, &mut buffer)?;
        if bytes_read == 0 {
            break;
        }
        file.write_all(&buffer[..bytes_read])?;
        let chunk_size = u64::try_from(bytes_read).map_err(|_| {
            ManagedAiError::DownloadFailed("download chunk size overflowed".to_string())
        })?;
        bytes_written = bytes_written.saturating_add(chunk_size);
        progress(ManagedAiDownloadProgress::from_counts(
            bytes_written,
            total_bytes,
        ))?;
    }
    file.sync_all()?;
    Ok(bytes_written)
}

fn read_download_chunk(reader: &mut dyn Read, buffer: &mut [u8]) -> Result<usize, ManagedAiError> {
    reader
        .read(buffer)
        .map_err(|error| ManagedAiError::DownloadFailed(error.to_string()))
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

#[cfg(test)]
mod tests {
    use std::io::{Error, ErrorKind, Read};

    use super::{read_download_chunk, ManagedAiError};

    #[test]
    fn response_read_errors_are_download_failures() {
        let mut reader = FailingReader;
        let mut buffer = [0_u8; 8];
        let error = read_download_chunk(&mut reader, &mut buffer).expect_err("download read fails");

        assert!(matches!(
            error,
            ManagedAiError::DownloadFailed(message)
                if message.contains("error decoding response body")
        ));
    }

    struct FailingReader;

    impl Read for FailingReader {
        fn read(&mut self, _buffer: &mut [u8]) -> std::io::Result<usize> {
            Err(Error::new(
                ErrorKind::InvalidData,
                "error decoding response body",
            ))
        }
    }
}
