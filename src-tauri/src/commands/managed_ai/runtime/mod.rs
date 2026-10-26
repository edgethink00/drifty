use std::path::{Path, PathBuf};

use super::{
    status_for_model_error, status_for_spec, ManagedAiError, ManagedAiInstallState,
    ManagedAiModelSpec, ManagedAiStatus, ManagedAiStatusErrorKind,
};

mod args;
mod install;
mod memory;
mod process;
#[cfg(test)]
pub(super) use process::screen_recipient::install_fixture as install_screen_recipient_fixture;
pub(in crate::commands) use process::screen_recipient::{
    observe as observe_screen_recipient, ScreenRecipientObservation,
};

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

pub(super) fn prepare_runtime(root: &Path) -> Result<(), ManagedAiError> {
    install::require_runtime_path(root).map(|_| ())
}

pub(super) fn runtime_assets_ready(root: &Path) -> Result<bool, ManagedAiError> {
    install::runtime_assets_ready(root)
}

pub(super) fn stop_unready_runtime(root: &Path) -> Result<(), ManagedAiError> {
    process::stop_unready_child(root)
}

pub(super) fn start_runtime(
    root: &Path,
    spec: ManagedAiModelSpec,
    artifact_dir: &Path,
) -> Result<ManagedAiStatus, ManagedAiError> {
    process::stop_unrelated_child(root, spec.id)?;
    let runtime_path = install::require_runtime_path(root)?;
    if process::server_has_model(&runtime_path, spec) {
        process::mark_child_ready(root, spec.id)?;
        return Ok(running_status(&runtime_path, spec, artifact_dir));
    }

    // Starting the same model is idempotent. Connection probes, the first-day
    // gate, and background classification can all ask for the runtime while its
    // initial model load is still in flight. Restarting that tracked child on
    // every request resets the warm-up clock and can leave the UI oscillating
    // between "connecting" and "not running" indefinitely.
    if !process::stop_child_if_start_timed_out(root, spec.id)? {
        match process::child_state_for_model(root, spec.id)? {
            process::TrackedChildState::Alive {
                became_ready: false,
                ..
            } => {
                return Ok(status_for_spec(
                    ManagedAiInstallState::Starting,
                    spec,
                    Some(artifact_dir.to_path_buf()),
                    "Managed local AI runtime is starting.",
                ));
            }
            process::TrackedChildState::Alive {
                became_ready: true, ..
            } => {
                // A previously healthy child gets a bounded second chance for
                // a transient health-probe miss. If it stays unavailable,
                // restart that task-owned child instead of returning Starting
                // forever on every explicit reconnect request.
                if process::wait_for_ready(&runtime_path, spec) {
                    process::mark_child_ready(root, spec.id)?;
                    return Ok(running_status(&runtime_path, spec, artifact_dir));
                }
                process::stop_runtime_for_model(root, spec.id)?;
            }
            process::TrackedChildState::Missing | process::TrackedChildState::Exited { .. } => {}
        }
    }

    process::prepare_runtime_port(&runtime_path)?;
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
        process::mark_child_ready(root, spec.id)?;
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
    observed_runtime_status(root, spec, artifact_dir, status, false)
}

pub(super) fn reconcile_runtime_status(
    root: &Path,
    spec: ManagedAiModelSpec,
    artifact_dir: Option<PathBuf>,
    status: ManagedAiStatus,
) -> Result<ManagedAiStatus, ManagedAiError> {
    observed_runtime_status(root, spec, artifact_dir, status, true)
}

fn observed_runtime_status(
    root: &Path,
    spec: ManagedAiModelSpec,
    artifact_dir: Option<PathBuf>,
    status: ManagedAiStatus,
    enforce_start_timeout: bool,
) -> Result<ManagedAiStatus, ManagedAiError> {
    let runtime_path = install::expected_runtime_path(root);
    if process::server_has_model(&runtime_path, spec) {
        process::mark_child_ready(root, spec.id)?;
        let mut running = status_for_spec(
            ManagedAiInstallState::Running,
            spec,
            artifact_dir,
            "Managed local AI runtime is running.",
        );
        running.memory_usage_bytes = process::server_memory_usage_bytes(&runtime_path);
        return Ok(running);
    }

    // Ordinary status reads are observations and must never kill a process.
    // The native lifecycle monitor is the single owner that enforces the
    // cold-start deadline and publishes the resulting terminal state.
    if enforce_start_timeout && process::stop_child_if_start_timed_out(root, spec.id)? {
        return Ok(status_for_model_error(
            spec,
            artifact_dir,
            "Managed local AI runtime did not become ready within two minutes.",
            ManagedAiStatusErrorKind::RuntimeFailed,
        ));
    }

    match process::child_state_after_failed_health_probe(root, spec.id)? {
        process::TrackedChildState::Alive {
            became_ready,
            health_degraded,
        } => {
            if health_degraded {
                return Ok(status_for_model_error(
                    spec,
                    artifact_dir,
                    "Managed local AI runtime stopped responding after repeated health checks.",
                    ManagedAiStatusErrorKind::RuntimeFailed,
                ));
            }
            return Ok(status_for_spec(
                if became_ready {
                    // Keep one failed 400 ms probe from flashing a healthy,
                    // previously-ready runtime back to Starting. Explicit
                    // reconnect requests perform a bounded retry/restart, and
                    // a real child exit remains observable below.
                    ManagedAiInstallState::Running
                } else {
                    ManagedAiInstallState::Starting
                },
                spec,
                artifact_dir,
                if became_ready {
                    "Managed local AI runtime is running."
                } else {
                    "Managed local AI runtime is starting."
                },
            ));
        }
        process::TrackedChildState::Exited {
            became_ready,
            status: exit_status,
        } => {
            let phase = if became_ready {
                "stopped unexpectedly"
            } else {
                "exited before it became ready"
            };
            return Ok(status_for_model_error(
                spec,
                artifact_dir,
                &format!("Managed local AI runtime {phase} ({exit_status})."),
                ManagedAiStatusErrorKind::RuntimeFailed,
            ));
        }
        process::TrackedChildState::Missing => {}
    }

    if matches!(
        status.state,
        ManagedAiInstallState::Starting | ManagedAiInstallState::Running
    ) {
        if enforce_start_timeout {
            return Ok(status_for_model_error(
                spec,
                artifact_dir,
                "Managed local AI runtime is not running.",
                ManagedAiStatusErrorKind::RuntimeFailed,
            ));
        }
        // Runtime processes intentionally stop with the app. A persisted
        // Running/Starting state from the previous app session therefore means
        // the verified files are dormant and ready to start, not that startup
        // failed in this session.
        return Ok(status_for_spec(
            ManagedAiInstallState::Installed,
            spec,
            artifact_dir,
            "Managed local AI is ready to start.",
        ));
    }

    Ok(status)
}

fn start_timeout_message() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "Managed local AI runtime did not become ready within five minutes."
    }
    #[cfg(not(target_os = "windows"))]
    {
        "Managed local AI runtime did not become ready within two minutes."
    }
}

pub(super) fn stop_runtime_for_model(root: &Path, model_id: &str) -> Result<(), ManagedAiError> {
    process::stop_runtime_for_model(root, model_id)?;
    // Windows can safely reap an exact untracked executable through one stable
    // process handle. Unix leaves every untracked listener untouched because a
    // numeric PID can be reused between inspection and signaling.
    process::stop_stale_runtime_server(&install::expected_runtime_path(root))
}

pub(super) fn stop_runtime(root: Option<&Path>, wait_for_exit: bool) -> Result<(), ManagedAiError> {
    process::stop_runtime(wait_for_exit)?;
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
pub(super) fn override_runtime_listener_pids_for_tests(
    pids: Option<Vec<u32>>,
) -> process::RuntimeListenerPidsOverride {
    process::override_runtime_listener_pids_for_tests(pids)
}

#[cfg(test)]
pub(super) fn age_tracked_child_for_tests(root: &Path, age: std::time::Duration) {
    process::age_tracked_child_for_tests(root, age);
}

#[cfg(test)]
pub(super) fn age_ready_health_failure_for_tests(root: &Path, age: std::time::Duration) {
    process::age_ready_health_failure_for_tests(root, age);
}

#[cfg(test)]
pub(super) fn mark_tracked_child_ready_for_tests(root: &Path, model_id: &str) {
    process::mark_child_ready(root, model_id).expect("mark tracked child ready");
}

#[cfg(test)]
pub(super) fn terminate_tracked_child_for_tests(root: &Path) {
    process::terminate_tracked_child_for_tests(root);
}

#[cfg(test)]
pub(super) fn tracked_child_model_id_for_tests(root: &Path) -> Option<&'static str> {
    process::tracked_child_model_id_for_tests(root)
}
