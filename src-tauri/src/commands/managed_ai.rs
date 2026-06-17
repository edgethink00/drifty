use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{async_runtime, AppHandle, Manager};
use thiserror::Error;

mod catalog;
mod download;
#[cfg(test)]
mod tests;

use catalog::{catalog_model, ManagedAiCatalogModel, ManagedAiModelSpec, MANAGED_MODELS};
use download::download_model_artifact;

const STATUS_FILE_NAME: &str = "status.json";
const MANAGED_BASE_URL: &str = "http://127.0.0.1:39217/v1";
const MANAGED_ASSETS_MISSING_MESSAGE: &str =
    "Managed local model files are missing. Download again when model assets are available.";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ManagedAiInstallState {
    NotInstalled,
    Installing,
    Installed,
    Running,
    Error,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedAiStatus {
    state: ManagedAiInstallState,
    selected_model_id: Option<String>,
    base_url: Option<String>,
    model: Option<String>,
    message: String,
    artifact_dir: Option<String>,
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
}

#[tauri::command]
pub fn managed_ai_catalog() -> Vec<ManagedAiCatalogModel> {
    MANAGED_MODELS.iter().copied().map(catalog_model).collect()
}

#[tauri::command]
pub fn managed_ai_status(app: AppHandle) -> Result<ManagedAiStatus, String> {
    let root = managed_ai_root(&app).map_err(error_message)?;
    read_status(&root).map_err(error_message)
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
pub fn managed_ai_start(app: AppHandle, model_id: String) -> Result<ManagedAiStatus, String> {
    let root = managed_ai_root(&app).map_err(error_message)?;
    start_model_at_root(&root, model_id.trim()).map_err(error_message)
}

#[tauri::command]
pub fn managed_ai_delete(app: AppHandle, model_id: String) -> Result<ManagedAiStatus, String> {
    let root = managed_ai_root(&app).map_err(error_message)?;
    delete_model_at_root(&root, model_id.trim()).map_err(error_message)
}

fn install_model_at_root(root: &Path, model_id: &str) -> Result<ManagedAiStatus, ManagedAiError> {
    install_model_at_root_with_downloader(root, model_id, download_model_artifact)
}

fn install_model_at_root_with_downloader(
    root: &Path,
    model_id: &str,
    downloader: impl FnOnce(&Path, ManagedAiModelSpec) -> Result<PathBuf, ManagedAiError>,
) -> Result<ManagedAiStatus, ManagedAiError> {
    let spec = require_model(model_id)?;
    let installing = status_for_spec(
        ManagedAiInstallState::Installing,
        spec,
        None,
        "Downloading managed local model...",
    );
    write_status(root, &installing)?;

    let artifact_dir = match downloader(root, spec) {
        Ok(path) => path,
        Err(error) => {
            let status = status_for_spec(
                ManagedAiInstallState::Error,
                spec,
                None,
                &error_message(error),
            );
            write_status(root, &status)?;
            return Ok(status);
        }
    };
    let status = status_for_spec(
        ManagedAiInstallState::Installed,
        spec,
        Some(artifact_dir),
        "Managed local model downloaded.",
    );
    write_status(root, &status)?;
    Ok(status)
}

fn start_model_at_root(root: &Path, model_id: &str) -> Result<ManagedAiStatus, ManagedAiError> {
    let spec = require_model(model_id)?;
    let runtime_path = root.join("runtime").join("llama-server");
    let artifact_dir = status_artifact_dir(root, spec)?;
    let state = if runtime_path.exists() && artifact_dir.is_some() {
        ManagedAiInstallState::Running
    } else {
        ManagedAiInstallState::Error
    };
    let message = match state {
        ManagedAiInstallState::Running => "Managed local AI runtime is running.",
        ManagedAiInstallState::Error => "Runtime assets are not installed yet. Download from the Drifty managed manifest before starting local AI.",
        ManagedAiInstallState::Installed
        | ManagedAiInstallState::Installing
        | ManagedAiInstallState::NotInstalled => "Managed local AI runtime is not running.",
    };
    let status = status_for_spec(state, spec, artifact_dir, message);
    write_status(root, &status)?;
    Ok(status)
}

fn delete_model_at_root(root: &Path, model_id: &str) -> Result<ManagedAiStatus, ManagedAiError> {
    let spec = require_model(model_id)?;
    let model_path = model_dir(root, spec.id);
    if model_path.exists() {
        fs::remove_dir_all(model_path)?;
    }
    let status = default_status();
    write_status(root, &status)?;
    Ok(status)
}

fn status_for_spec(
    state: ManagedAiInstallState,
    spec: ManagedAiModelSpec,
    artifact_dir: Option<PathBuf>,
    message: &str,
) -> ManagedAiStatus {
    ManagedAiStatus {
        state,
        selected_model_id: Some(spec.id.to_string()),
        base_url: Some(MANAGED_BASE_URL.to_string()),
        model: Some(spec.runtime_model.to_string()),
        message: message.to_string(),
        artifact_dir: artifact_dir.map(|path| path.to_string_lossy().into_owned()),
    }
}

fn read_status(root: &Path) -> Result<ManagedAiStatus, ManagedAiError> {
    let status_path = root.join(STATUS_FILE_NAME);
    if !status_path.exists() {
        return Ok(default_status());
    }
    let status = serde_json::from_str(&fs::read_to_string(status_path)?)?;
    normalize_status_artifact_dir(root, status)
}

fn write_status(root: &Path, status: &ManagedAiStatus) -> Result<(), ManagedAiError> {
    fs::create_dir_all(root)?;
    fs::write(
        root.join(STATUS_FILE_NAME),
        serde_json::to_vec_pretty(status)?,
    )?;
    Ok(())
}

fn default_status() -> ManagedAiStatus {
    ManagedAiStatus {
        state: ManagedAiInstallState::NotInstalled,
        selected_model_id: None,
        base_url: None,
        model: None,
        message: "Choose a local model and Drifty will download it inside the app.".to_string(),
        artifact_dir: None,
    }
}

fn normalize_status_artifact_dir(
    root: &Path,
    mut status: ManagedAiStatus,
) -> Result<ManagedAiStatus, ManagedAiError> {
    if let Some(model_id) = status.selected_model_id.as_deref() {
        let spec = require_model(model_id)?;
        let artifact_dir = status_artifact_dir(root, spec)?;
        status.artifact_dir = artifact_dir.map(|path| path.to_string_lossy().into_owned());
        if status.artifact_dir.is_none()
            && matches!(
                status.state,
                ManagedAiInstallState::Installed | ManagedAiInstallState::Running
            )
        {
            status.state = ManagedAiInstallState::Error;
            status.message = MANAGED_ASSETS_MISSING_MESSAGE.to_string();
        }
    } else {
        status.artifact_dir = None;
    }
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
