use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{async_runtime, AppHandle, Manager};
use thiserror::Error;

mod catalog;
mod download;
mod runtime;
mod status;
#[cfg(test)]
mod tests;

use catalog::{catalog_model, ManagedAiCatalogModel, ManagedAiModelSpec, MANAGED_MODELS};
use download::download_model_artifact;
use status::{
    default_status, read_status, status_for_download_progress, status_for_global_error,
    status_for_model_error, status_for_spec, status_with_installed_models, write_status,
    ManagedAiStatusErrorKind,
};
pub use status::{ManagedAiDownloadProgress, ManagedAiStatus};

const MANAGED_BASE_URL: &str = "http://127.0.0.1:39217/v1";
const MANAGED_ASSETS_MISSING_MESSAGE: &str =
    "Managed local model files are missing. Download again when model assets are available.";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ManagedAiInstallState {
    NotInstalled,
    Installing,
    Installed,
    Starting,
    Running,
    Error,
}

#[derive(Debug, Error)]
enum ManagedAiError {
    #[error("Managed local AI app data directory is unavailable: {0}")]
    AppData(String),
    #[error("Unknown managed local AI model: {0}")]
    UnknownModel(String),
    #[error("Managed local AI storage failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("Managed local AI status is not readable: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Managed local model download failed: {0}")]
    Http(#[from] reqwest::Error),
    #[error("Managed local model download failed: {0}")]
    DownloadFailed(String),
    #[error("Managed local AI runtime is missing: {0}")]
    RuntimeMissing(String),
    #[error("Managed local AI runtime failed: {0}")]
    RuntimeFailed(String),
}

#[tauri::command]
pub fn managed_ai_catalog() -> Vec<ManagedAiCatalogModel> {
    MANAGED_MODELS.iter().copied().map(catalog_model).collect()
}

#[tauri::command]
pub async fn managed_ai_status(app: AppHandle) -> Result<ManagedAiStatus, String> {
    let root = managed_ai_root(&app).map_err(error_message)?;
    async_runtime::spawn_blocking(move || read_status(&root))
        .await
        .map_err(|error| error.to_string())?
        .map_err(error_message)
}

#[tauri::command]
pub async fn managed_ai_install(
    app: AppHandle,
    model_id: String,
) -> Result<ManagedAiStatus, String> {
    let root = managed_ai_root(&app).map_err(error_message)?;
    let model_id = model_id.trim().to_string();
    async_runtime::spawn_blocking(move || install_model_at_root(&root, &model_id))
        .await
        .map_err(|error| error.to_string())?
        .map_err(error_message)
}

#[tauri::command]
pub async fn managed_ai_start(app: AppHandle, model_id: String) -> Result<ManagedAiStatus, String> {
    let root = managed_ai_root(&app).map_err(error_message)?;
    let model_id = model_id.trim().to_string();
    async_runtime::spawn_blocking(move || start_model_at_root(&root, &model_id))
        .await
        .map_err(|error| error.to_string())?
        .map_err(error_message)
}

#[tauri::command]
pub async fn managed_ai_delete(
    app: AppHandle,
    model_id: String,
) -> Result<ManagedAiStatus, String> {
    let root = managed_ai_root(&app).map_err(error_message)?;
    let model_id = model_id.trim().to_string();
    async_runtime::spawn_blocking(move || delete_model_at_root(&root, &model_id))
        .await
        .map_err(|error| error.to_string())?
        .map_err(error_message)
}

pub(crate) fn managed_ai_stop_runtime_for_app_exit(app: &AppHandle) {
    let _ = runtime::stop_runtime(managed_ai_root(app).ok().as_deref());
}

fn install_model_at_root(root: &Path, model_id: &str) -> Result<ManagedAiStatus, ManagedAiError> {
    install_model_at_root_with_downloader(root, model_id, download_model_artifact)
}

fn install_model_at_root_with_downloader(
    root: &Path,
    model_id: &str,
    downloader: impl FnOnce(
        &Path,
        ManagedAiModelSpec,
        &mut dyn FnMut(ManagedAiDownloadProgress) -> Result<(), ManagedAiError>,
    ) -> Result<PathBuf, ManagedAiError>,
) -> Result<ManagedAiStatus, ManagedAiError> {
    let spec = require_model(model_id)?;
    let installing = status_with_installed_models(
        root,
        status_for_spec(
            ManagedAiInstallState::Installing,
            spec,
            None,
            "Downloading managed local model...",
        ),
    )?;
    write_status(root, &installing)?;

    let mut progress_gate = DownloadProgressWriteGate::default();
    let mut report_progress = |progress: ManagedAiDownloadProgress| {
        if !progress_gate.should_write(progress.percent) {
            return Ok(());
        }
        let status =
            status_with_installed_models(root, status_for_download_progress(spec, progress))?;
        write_status(root, &status)
    };

    let artifact_dir = match downloader(root, spec, &mut report_progress) {
        Ok(path) => path,
        Err(error) => {
            let status = match model_retry_error_kind(&error) {
                Some(error_kind) => {
                    status_for_model_error(spec, None, &error.to_string(), error_kind)
                }
                None => status_for_global_error(&error.to_string()),
            };
            let status = status_with_installed_models(root, status)?;
            write_status(root, &status)?;
            return Ok(status);
        }
    };
    let status = status_with_installed_models(
        root,
        status_for_spec(
            ManagedAiInstallState::Installed,
            spec,
            Some(artifact_dir),
            "Managed local model downloaded.",
        ),
    )?;
    write_status(root, &status)?;
    Ok(status)
}

/// Decides which download progress reports get persisted to status.json.
/// The downloader reports every 64KB chunk (~49k times for a 3GB model), so
/// only integer-percent changes are written; the final 100% always differs
/// from the previous percent and is therefore always written.
#[derive(Default)]
struct DownloadProgressWriteGate {
    last_written_percent: Option<u8>,
}

impl DownloadProgressWriteGate {
    fn should_write(&mut self, percent: u8) -> bool {
        if self.last_written_percent == Some(percent) {
            return false;
        }
        self.last_written_percent = Some(percent);
        true
    }
}

fn start_model_at_root(root: &Path, model_id: &str) -> Result<ManagedAiStatus, ManagedAiError> {
    let spec = require_model(model_id)?;
    let artifact_dir = status_artifact_dir(root, spec)?;
    let Some(artifact_dir) = artifact_dir else {
        let status = status_with_installed_models(
            root,
            status_for_model_error(
                spec,
                None,
                MANAGED_ASSETS_MISSING_MESSAGE,
                ManagedAiStatusErrorKind::ModelArtifactMissing,
            ),
        )?;
        write_status(root, &status)?;
        return Ok(status);
    };

    let status = match runtime::start_runtime(root, spec, &artifact_dir) {
        Ok(status) => status,
        Err(error) => status_for_spec(
            ManagedAiInstallState::Error,
            spec,
            Some(artifact_dir),
            &error_message(error),
        ),
    };
    let status = status_with_installed_models(root, status)?;
    write_status(root, &status)?;
    Ok(status)
}

fn delete_model_at_root(root: &Path, model_id: &str) -> Result<ManagedAiStatus, ManagedAiError> {
    let spec = require_model(model_id)?;
    runtime::stop_runtime_for_model(root, spec.id)?;
    let model_path = model_dir(root, spec.id);
    if model_path.exists() {
        fs::remove_dir_all(model_path)?;
    }
    let status = status_with_installed_models(root, default_status())?;
    write_status(root, &status)?;
    Ok(status)
}

fn model_dir(root: &Path, model_id: &str) -> PathBuf {
    root.join("models").join(model_id)
}

fn status_artifact_dir(
    root: &Path,
    spec: ManagedAiModelSpec,
) -> Result<Option<PathBuf>, ManagedAiError> {
    let path = model_dir(root, spec.id);
    if model_dir_has_artifacts(&path)? {
        Ok(Some(path))
    } else {
        Ok(None)
    }
}

fn model_dir_has_artifacts(path: &Path) -> Result<bool, ManagedAiError> {
    if !path.is_dir() {
        return Ok(false);
    }
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let metadata = entry.metadata()?;
        if metadata.is_file()
            && metadata.len() > 0
            && entry
                .path()
                .extension()
                .is_some_and(|extension| extension == "gguf")
        {
            return Ok(true);
        }
    }
    Ok(false)
}

fn require_model(model_id: &str) -> Result<ManagedAiModelSpec, ManagedAiError> {
    MANAGED_MODELS
        .iter()
        .copied()
        .find(|spec| spec.id == model_id)
        .ok_or_else(|| ManagedAiError::UnknownModel(model_id.to_string()))
}

fn managed_ai_root(app: &AppHandle) -> Result<PathBuf, ManagedAiError> {
    #[cfg(debug_assertions)]
    if let Ok(path) = std::env::var("DRIFTY_MANAGED_AI_ROOT") {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }

    app.path()
        .app_data_dir()
        .map(|path| path.join("managed-ai"))
        .map_err(|error| ManagedAiError::AppData(error.to_string()))
}

fn error_message(error: ManagedAiError) -> String {
    error.to_string()
}

fn model_retry_error_kind(error: &ManagedAiError) -> Option<ManagedAiStatusErrorKind> {
    match error {
        ManagedAiError::Http(_) | ManagedAiError::DownloadFailed(_) => {
            Some(ManagedAiStatusErrorKind::DownloadFailed)
        }
        ManagedAiError::AppData(_)
        | ManagedAiError::UnknownModel(_)
        | ManagedAiError::Io(_)
        | ManagedAiError::Json(_)
        | ManagedAiError::RuntimeMissing(_)
        | ManagedAiError::RuntimeFailed(_) => None,
    }
}
