use std::path::{Path, PathBuf};

use super::{
    status_for_model_error, status_for_spec, ManagedAiError, ManagedAiInstallState,
    ManagedAiModelSpec, ManagedAiStatus, ManagedAiStatusErrorKind,
};

mod install;
mod process;

const RUNTIME_FILE_NAME: &str = "llama-server";
const RUNTIME_HOST: &str = "127.0.0.1";
const RUNTIME_PORT: &str = "39217";

pub(super) fn start_runtime(
    root: &Path,
    spec: ManagedAiModelSpec,
    artifact_dir: &Path,
) -> Result<ManagedAiStatus, ManagedAiError> {
    process::stop_unrelated_child(spec.id)?;
    let runtime_path = install::require_runtime_path(root)?;
    if process::server_has_model(&runtime_path, spec) {
        return Ok(running_status(&runtime_path, spec, artifact_dir));
    }

    process::stop_stale_runtime_server(&runtime_path)?;
    let model_path = artifact_dir.join(spec.file_name);
    if !model_path.is_file() {
        return Ok(status_for_model_error(
            spec,
            Some(artifact_dir.to_path_buf()),
            "Managed local model artifact is missing. Download the model again.",
            ManagedAiStatusErrorKind::ModelArtifactMissing,
        ));
    }

    process::start_child(root, &runtime_path, &model_path, spec)?;
    if process::wait_for_ready(&runtime_path, spec) {
        Ok(running_status(&runtime_path, spec, artifact_dir))
    } else {
        Ok(status_for_spec(
            ManagedAiInstallState::Starting,
            spec,
            Some(artifact_dir.to_path_buf()),
            "Managed local AI runtime is starting.",
        ))
    }
}

pub(super) fn normalize_runtime_status(
    root: &Path,
    spec: ManagedAiModelSpec,
    artifact_dir: Option<PathBuf>,
    status: ManagedAiStatus,
) -> Result<ManagedAiStatus, ManagedAiError> {
    let runtime_path = install::expected_runtime_path(root);
    if process::server_has_model(&runtime_path, spec) {
        let mut running = status_for_spec(
            ManagedAiInstallState::Running,
            spec,
            artifact_dir,
            "Managed local AI runtime is running.",
        );
        running.memory_usage_bytes = process::server_memory_usage_bytes(&runtime_path);
        return Ok(running);
    }

    if process::child_alive_for_model(spec.id)? {
        return Ok(status_for_spec(
            ManagedAiInstallState::Starting,
            spec,
            artifact_dir,
            "Managed local AI runtime is starting.",
        ));
    }

    if matches!(
        status.state,
        ManagedAiInstallState::Starting | ManagedAiInstallState::Running
    ) {
        return Ok(status_for_spec(
            ManagedAiInstallState::Error,
            spec,
            artifact_dir,
            "Managed local AI runtime is not running.",
        ));
    }

    Ok(status)
}

pub(super) fn stop_runtime_for_model(model_id: &str) -> Result<(), ManagedAiError> {
    process::stop_runtime_for_model(model_id)
}

pub(super) fn stop_runtime() -> Result<(), ManagedAiError> {
    process::stop_runtime()
}

fn running_status(
    runtime_path: &Path,
    spec: ManagedAiModelSpec,
    artifact_dir: &Path,
) -> ManagedAiStatus {
    let mut status = status_for_spec(
        ManagedAiInstallState::Running,
        spec,
        Some(artifact_dir.to_path_buf()),
        "Managed local AI runtime is running.",
    );
    status.memory_usage_bytes = process::server_memory_usage_bytes(runtime_path);
    status
}

#[cfg(test)]
pub(super) fn stop_runtime_for_tests() {
    process::stop_runtime_for_tests();
}
