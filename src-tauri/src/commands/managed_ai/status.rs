use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::{
    is_install_active, require_model, runtime, status_artifact_dir, ManagedAiError,
    ManagedAiInstallState, ManagedAiModelSpec, MANAGED_ASSETS_MISSING_MESSAGE, MANAGED_BASE_URL,
    MANAGED_MODELS,
};

const STATUS_FILE_NAME: &str = "status.json";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedAiDownloadProgress {
    pub(super) percent: u8,
    pub(super) downloaded_bytes: u64,
    pub(super) total_bytes: u64,
}

impl ManagedAiDownloadProgress {
    pub(super) fn from_counts(downloaded_bytes: u64, total_bytes: u64) -> Self {
        let percent = if total_bytes > 0 {
            let bounded = downloaded_bytes.saturating_mul(100) / total_bytes;
            match u8::try_from(bounded.min(100)) {
                Ok(value) => value,
                Err(_) => 100,
            }
        } else {
            0
        };
        Self {
            percent,
            downloaded_bytes,
            total_bytes,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedAiInstalledModel {
    pub(super) id: String,
    pub(super) artifact_dir: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ManagedAiStatusErrorKind {
    DownloadFailed,
    ModelArtifactMissing,
    InsufficientMemory,
    InsufficientStorage,
    RuntimeMissing,
    RuntimeFailed,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedAiStatus {
    pub(super) state: ManagedAiInstallState,
    pub(super) selected_model_id: Option<String>,
    #[serde(default)]
    pub(super) installed_models: Vec<ManagedAiInstalledModel>,
    pub(super) base_url: Option<String>,
    pub(super) model: Option<String>,
    pub(super) message: String,
    pub(super) artifact_dir: Option<String>,
    pub(super) progress: Option<ManagedAiDownloadProgress>,
    #[serde(default)]
    pub(super) error_kind: Option<ManagedAiStatusErrorKind>,
    #[serde(default)]
    pub(super) memory_usage_bytes: Option<u64>,
    #[serde(default)]
    pub(super) required_resource_bytes: Option<u64>,
    #[serde(default)]
    pub(super) available_resource_bytes: Option<u64>,
}

pub(super) fn status_for_spec(
    state: ManagedAiInstallState,
    spec: ManagedAiModelSpec,
    artifact_dir: Option<PathBuf>,
    message: &str,
) -> ManagedAiStatus {
    ManagedAiStatus {
        state,
        selected_model_id: Some(spec.id.to_string()),
        installed_models: Vec::new(),
        base_url: Some(MANAGED_BASE_URL.to_string()),
        model: Some(spec.runtime_model.to_string()),
        message: message.to_string(),
        artifact_dir: artifact_dir.map(|path| path.to_string_lossy().into_owned()),
        progress: None,
        error_kind: None,
        memory_usage_bytes: None,
        required_resource_bytes: None,
        available_resource_bytes: None,
    }
}

pub(super) fn status_for_model_error(
    spec: ManagedAiModelSpec,
    artifact_dir: Option<PathBuf>,
    message: &str,
    error_kind: ManagedAiStatusErrorKind,
) -> ManagedAiStatus {
    ManagedAiStatus {
        state: ManagedAiInstallState::Error,
        selected_model_id: Some(spec.id.to_string()),
        installed_models: Vec::new(),
        base_url: Some(MANAGED_BASE_URL.to_string()),
        model: Some(spec.runtime_model.to_string()),
        message: message.to_string(),
        artifact_dir: artifact_dir.map(|path| path.to_string_lossy().into_owned()),
        progress: None,
        error_kind: Some(error_kind),
        memory_usage_bytes: None,
        required_resource_bytes: None,
        available_resource_bytes: None,
    }
}

pub(super) fn status_for_global_error(message: &str) -> ManagedAiStatus {
    ManagedAiStatus {
        state: ManagedAiInstallState::Error,
        selected_model_id: None,
        installed_models: Vec::new(),
        base_url: None,
        model: None,
        message: message.to_string(),
        artifact_dir: None,
        progress: None,
        error_kind: None,
        memory_usage_bytes: None,
        required_resource_bytes: None,
        available_resource_bytes: None,
    }
}

pub(super) fn status_for_download_progress(
    spec: ManagedAiModelSpec,
    progress: ManagedAiDownloadProgress,
) -> ManagedAiStatus {
    ManagedAiStatus {
        state: ManagedAiInstallState::Installing,
        selected_model_id: Some(spec.id.to_string()),
        installed_models: Vec::new(),
        base_url: Some(MANAGED_BASE_URL.to_string()),
        model: Some(spec.runtime_model.to_string()),
        message: format!("Downloading managed local model... ({}%)", progress.percent),
        artifact_dir: None,
        progress: Some(progress),
        error_kind: None,
        memory_usage_bytes: None,
        required_resource_bytes: None,
        available_resource_bytes: None,
    }
}

pub(super) fn read_status(root: &Path) -> Result<ManagedAiStatus, ManagedAiError> {
    read_status_with_runtime_reconciliation(root, false)
}

pub(super) fn reconcile_status(root: &Path) -> Result<ManagedAiStatus, ManagedAiError> {
    read_status_with_runtime_reconciliation(root, true)
}

fn read_status_with_runtime_reconciliation(
    root: &Path,
    reconcile_runtime: bool,
) -> Result<ManagedAiStatus, ManagedAiError> {
    let status_path = root.join(STATUS_FILE_NAME);
    if !status_path.exists() {
        return status_with_installed_models(root, default_status());
    }
    let status = serde_json::from_str(&fs::read_to_string(status_path)?)?;
    normalize_status_artifact_dir(root, status, reconcile_runtime)
}

pub(super) fn write_status(root: &Path, status: &ManagedAiStatus) -> Result<(), ManagedAiError> {
    fs::create_dir_all(root)?;
    let status_path = root.join(STATUS_FILE_NAME);
    let temp_path = root.join(format!("{STATUS_FILE_NAME}.tmp"));
    fs::write(&temp_path, serde_json::to_vec_pretty(status)?)?;
    fs::rename(temp_path, status_path)?;
    Ok(())
}

pub(super) fn default_status() -> ManagedAiStatus {
    ManagedAiStatus {
        state: ManagedAiInstallState::NotInstalled,
        selected_model_id: None,
        installed_models: Vec::new(),
        base_url: None,
        model: None,
        message: "Choose a local model and Drifty will download it inside the app.".to_string(),
        artifact_dir: None,
        progress: None,
        error_kind: None,
        memory_usage_bytes: None,
        required_resource_bytes: None,
        available_resource_bytes: None,
    }
}

pub(super) fn status_with_installed_models(
    root: &Path,
    mut status: ManagedAiStatus,
) -> Result<ManagedAiStatus, ManagedAiError> {
    status.installed_models = installed_models(root)?;
    Ok(status)
}

fn normalize_status_artifact_dir(
    root: &Path,
    status: ManagedAiStatus,
    reconcile_runtime: bool,
) -> Result<ManagedAiStatus, ManagedAiError> {
    normalize_status_with_artifact_lookup_and_runtime_mode(
        root,
        status,
        status_artifact_dir,
        reconcile_runtime,
    )
}

#[cfg(test)]
pub(super) fn normalize_status_with_artifact_lookup(
    root: &Path,
    status: ManagedAiStatus,
    artifact_lookup: impl FnOnce(&Path, ManagedAiModelSpec) -> Result<Option<PathBuf>, ManagedAiError>,
) -> Result<ManagedAiStatus, ManagedAiError> {
    normalize_status_with_artifact_lookup_and_runtime_mode(root, status, artifact_lookup, false)
}

fn normalize_status_with_artifact_lookup_and_runtime_mode(
    root: &Path,
    mut status: ManagedAiStatus,
    artifact_lookup: impl FnOnce(&Path, ManagedAiModelSpec) -> Result<Option<PathBuf>, ManagedAiError>,
    reconcile_runtime: bool,
) -> Result<ManagedAiStatus, ManagedAiError> {
    if let Some(model_id) = status.selected_model_id.as_deref() {
        let spec = require_model(model_id)?;
        // Observe ownership before the artifact snapshot: completion may promote
        // the file and release its guard immediately after an absent-file read.
        let install_was_active = matches!(status.state, ManagedAiInstallState::Installing)
            && is_install_active(root, model_id);
        let artifact_dir = artifact_lookup(root, spec)?;
        status.artifact_dir = artifact_dir
            .as_ref()
            .map(|path| path.to_string_lossy().into_owned());
        if matches!(status.state, ManagedAiInstallState::Installing) && !install_was_active {
            status.progress = None;
            if status.artifact_dir.is_some() {
                status.state = ManagedAiInstallState::Installed;
                status.message = "Managed local model downloaded.".to_string();
                status.error_kind = None;
            } else {
                status.state = ManagedAiInstallState::Error;
                status.message =
                    "Managed local AI download was interrupted. Try downloading again.".to_string();
                status.error_kind = Some(ManagedAiStatusErrorKind::DownloadFailed);
            }
        }
        if status.artifact_dir.is_none()
            && matches!(
                status.state,
                ManagedAiInstallState::Installed
                    | ManagedAiInstallState::Starting
                    | ManagedAiInstallState::Running
            )
        {
            status.state = ManagedAiInstallState::Error;
            status.message = MANAGED_ASSETS_MISSING_MESSAGE.to_string();
            status.error_kind = Some(ManagedAiStatusErrorKind::ModelArtifactMissing);
        }
        if matches!(
            status.state,
            ManagedAiInstallState::Starting | ManagedAiInstallState::Running
        ) {
            status = if reconcile_runtime {
                runtime::reconcile_runtime_status(root, spec, artifact_dir, status)?
            } else {
                runtime::normalize_runtime_status(root, spec, artifact_dir, status)?
            };
        }
    } else {
        status.artifact_dir = None;
    }
    status_with_installed_models(root, status)
}

fn installed_models(root: &Path) -> Result<Vec<ManagedAiInstalledModel>, ManagedAiError> {
    MANAGED_MODELS
        .iter()
        .copied()
        .filter_map(|spec| match status_artifact_dir(root, spec) {
            Ok(Some(path)) => Some(Ok(ManagedAiInstalledModel {
                id: spec.id.to_string(),
                artifact_dir: path.to_string_lossy().into_owned(),
            })),
            Ok(None) => None,
            Err(error) => Some(Err(error)),
        })
        .collect()
}
