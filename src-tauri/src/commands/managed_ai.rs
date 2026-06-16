use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use thiserror::Error;

mod catalog;

use catalog::{catalog_model, ManagedAiCatalogModel, ManagedAiModelSpec, MANAGED_MODELS};

const STATUS_FILE_NAME: &str = "status.json";
const MANAGED_BASE_URL: &str = "http://127.0.0.1:39217/v1";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ManagedAiInstallState {
    NotInstalled,
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
pub fn managed_ai_install(app: AppHandle, model_id: String) -> Result<ManagedAiStatus, String> {
    let root = managed_ai_root(&app).map_err(error_message)?;
    install_model_at_root(&root, model_id.trim()).map_err(error_message)
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
    let spec = require_model(model_id)?;
    fs::create_dir_all(root.join("models").join(spec.id))?;
    fs::create_dir_all(root.join("runtime"))?;
    let status = status_for_spec(
        ManagedAiInstallState::Installed,
        spec,
        root,
        "Model metadata is staged. Runtime/model asset downloads will use the Drifty manifest when production assets are published.",
    );
    write_status(root, &status)?;
    Ok(status)
}

fn start_model_at_root(root: &Path, model_id: &str) -> Result<ManagedAiStatus, ManagedAiError> {
    let spec = require_model(model_id)?;
    let runtime_path = root.join("runtime").join("llama-server");
    let model_path = root.join("models").join(spec.id);
    let state = if runtime_path.exists() && model_path.exists() {
        ManagedAiInstallState::Running
    } else {
        ManagedAiInstallState::Error
    };
    let message = match state {
        ManagedAiInstallState::Running => "Managed local AI runtime is running.",
        ManagedAiInstallState::Error => "Runtime assets are not installed yet. Download from the Drifty managed manifest before starting local AI.",
        ManagedAiInstallState::Installed | ManagedAiInstallState::NotInstalled => "Managed local AI runtime is not running.",
    };
    let status = status_for_spec(state, spec, root, message);
    write_status(root, &status)?;
    Ok(status)
}

fn delete_model_at_root(root: &Path, model_id: &str) -> Result<ManagedAiStatus, ManagedAiError> {
    let spec = require_model(model_id)?;
    let model_path = root.join("models").join(spec.id);
    if model_path.exists() {
        fs::remove_dir_all(model_path)?;
    }
    let status = default_status(root);
    write_status(root, &status)?;
    Ok(status)
}

fn status_for_spec(
    state: ManagedAiInstallState,
    spec: ManagedAiModelSpec,
    root: &Path,
    message: &str,
) -> ManagedAiStatus {
    ManagedAiStatus {
        state,
        selected_model_id: Some(spec.id.to_string()),
        base_url: Some(MANAGED_BASE_URL.to_string()),
        model: Some(spec.runtime_model.to_string()),
        message: message.to_string(),
        artifact_dir: Some(root.to_string_lossy().into_owned()),
    }
}

fn read_status(root: &Path) -> Result<ManagedAiStatus, ManagedAiError> {
    let status_path = root.join(STATUS_FILE_NAME);
    if !status_path.exists() {
        return Ok(default_status(root));
    }
    Ok(serde_json::from_str(&fs::read_to_string(status_path)?)?)
}

fn write_status(root: &Path, status: &ManagedAiStatus) -> Result<(), ManagedAiError> {
    fs::create_dir_all(root)?;
    fs::write(
        root.join(STATUS_FILE_NAME),
        serde_json::to_vec_pretty(status)?,
    )?;
    Ok(())
}

fn default_status(root: &Path) -> ManagedAiStatus {
    ManagedAiStatus {
        state: ManagedAiInstallState::NotInstalled,
        selected_model_id: None,
        base_url: None,
        model: None,
        message: "Choose a local model and Drifty will download it inside the app.".to_string(),
        artifact_dir: Some(root.to_string_lossy().into_owned()),
    }
}

fn require_model(model_id: &str) -> Result<ManagedAiModelSpec, ManagedAiError> {
    MANAGED_MODELS
        .iter()
        .copied()
        .find(|spec| spec.id == model_id)
        .ok_or_else(|| ManagedAiError::UnknownModel(model_id.to_string()))
}

fn managed_ai_root(app: &AppHandle) -> Result<PathBuf, ManagedAiError> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("managed-ai"))
        .map_err(|error| ManagedAiError::AppData(error.to_string()))
}

fn error_message(error: ManagedAiError) -> String {
    error.to_string()
}

#[cfg(test)]
mod tests {
    use super::{
        install_model_at_root, managed_ai_catalog, start_model_at_root, ManagedAiInstallState,
    };

    #[test]
    fn catalog_uses_current_local_models() {
        let labels = managed_ai_catalog()
            .into_iter()
            .map(|model| model.label)
            .collect::<Vec<_>>();

        assert_eq!(
            labels,
            vec!["Qwen 3.5 2B", "Qwen 3.5 4B", "Gemma 4 12B", "Qwen 3.6 27B"]
        );
    }

    #[test]
    fn install_stages_selected_model_metadata() {
        let root = tempfile::tempdir().expect("create temp root");
        let status =
            install_model_at_root(root.path(), "drifty-qwen3-5-4b-default").expect("install model");

        assert!(matches!(status.state, ManagedAiInstallState::Installed));
        assert_eq!(
            status.selected_model_id.as_deref(),
            Some("drifty-qwen3-5-4b-default")
        );
        assert_eq!(status.model.as_deref(), Some("drifty-qwen3.5-4b-local"));
        assert!(root
            .path()
            .join("models/drifty-qwen3-5-4b-default")
            .exists());
    }

    #[test]
    fn start_requires_runtime_assets() {
        let root = tempfile::tempdir().expect("create temp root");
        let status =
            start_model_at_root(root.path(), "drifty-qwen3-5-4b-default").expect("start status");

        assert!(matches!(status.state, ManagedAiInstallState::Error));
    }
}
