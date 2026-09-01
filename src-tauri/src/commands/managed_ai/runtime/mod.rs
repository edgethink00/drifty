use std::path::{Path, PathBuf};

use super::{
    status_for_model_error, status_for_spec, ManagedAiError, ManagedAiInstallState,
    ManagedAiModelSpec, ManagedAiStatus, ManagedAiStatusErrorKind,
};

mod args;
mod install;
mod memory;
mod process;

#[cfg(target_os = "windows")]
const RUNTIME_FILE_NAME: &str = "llama-server.exe";
#[cfg(not(target_os = "windows"))]
const RUNTIME_FILE_NAME: &str = "llama-server";
const RUNTIME_HOST: &str = "127.0.0.1";
const RUNTIME_PORT: &str = "39217";
#[cfg(target_os = "windows")]
const RUNTIME_PORT_NUMBER: u16 = 39_217;

#[cfg(test)]
pub(super) fn write_runtime_completion_fixture(root: &Path) -> Result<(), ManagedAiError> {
    install::write_runtime_completion_fixture(root)
}

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

    // Starting the same model is idempotent. Connection probes, the first-day
    // gate, and background classification can all ask for the runtime while its
    // initial model load is still in flight. Restarting that tracked child on
    // every request resets the warm-up clock and can leave the UI oscillating
    // between "connecting" and "not running" indefinitely.
    if !process::stop_child_if_start_timed_out(spec.id)? && process::child_alive_for_model(spec.id)?
    {
        return Ok(status_for_spec(
            ManagedAiInstallState::Starting,
            spec,
            Some(artifact_dir.to_path_buf()),
            "Managed local AI runtime is starting.",
        ));
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

    if process::stop_child_if_start_timed_out(spec.id)? {
        return Ok(status_for_model_error(
            spec,
            artifact_dir,
            "Managed local AI runtime did not become ready within two minutes.",
            ManagedAiStatusErrorKind::RuntimeFailed,
        ));
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
        return Ok(status_for_model_error(
            spec,
            artifact_dir,
            "Managed local AI runtime is not running.",
            ManagedAiStatusErrorKind::RuntimeFailed,
        ));
    }

    Ok(status)
}

pub(super) fn stop_runtime_for_model(root: &Path, model_id: &str) -> Result<(), ManagedAiError> {
    process::stop_runtime_for_model(model_id)?;
    // An adopted server (already listening when the app launched) is never in
    // RUNTIME_CHILD, so it must be reaped by port + command-line match.
    process::stop_stale_runtime_server(&install::expected_runtime_path(root))
}

pub(super) fn stop_runtime(root: Option<&Path>) -> Result<(), ManagedAiError> {
    process::stop_runtime()?;
    if let Some(root) = root {
        process::stop_stale_runtime_server(&install::expected_runtime_path(root))?;
    }
    Ok(())
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

#[cfg(test)]
pub(super) fn set_runtime_listener_pids_for_tests(pids: Option<Vec<u32>>) {
    process::set_runtime_listener_pids_for_tests(pids);
}

#[cfg(test)]
pub(super) fn age_tracked_child_for_tests(age: std::time::Duration) {
    process::age_tracked_child_for_tests(age);
}
