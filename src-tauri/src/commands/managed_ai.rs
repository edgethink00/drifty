use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    LazyLock, Mutex,
};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{async_runtime, AppHandle, Emitter, Manager};
use thiserror::Error;

mod catalog;
mod download;
mod hardware;
mod runtime;
mod status;
#[cfg(test)]
mod tests;

use catalog::{
    catalog_model_for_machine, recommended_model_id, ManagedAiCatalogModel, ManagedAiModelSpec,
    MANAGED_MODELS,
};
use download::download_model_artifact;
use status::{
    default_status, read_status, reconcile_status, status_for_download_progress,
    status_for_global_error, status_for_model_error, status_for_spec, status_with_installed_models,
    write_status, ManagedAiStatusErrorKind,
};
pub use status::{ManagedAiDownloadProgress, ManagedAiStatus};

pub(super) const MANAGED_BASE_URL: &str = "http://127.0.0.1:39217/v1";
pub(super) const MANAGED_CONTEXT_TOKENS: u32 = 4096;
const MANAGED_ASSETS_MISSING_MESSAGE: &str =
    "Managed local model files are missing. Download again when model assets are available.";
const MANAGED_AI_STATUS_EVENT: &str = "managed-ai-status";
const RUNTIME_STATUS_POLL_INTERVAL: Duration = Duration::from_millis(500);

static ACTIVE_INSTALLS: LazyLock<Mutex<HashMap<PathBuf, ActiveInstall>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static ACTIVE_RUNTIME_MONITORS: LazyLock<Mutex<HashMap<PathBuf, u64>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static RUNTIME_LIFECYCLE_LOCK: Mutex<()> = Mutex::new(());
static NEXT_RUNTIME_MONITOR_GENERATION: AtomicU64 = AtomicU64::new(1);

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
    #[error("Managed local AI runtime download failed: {0}")]
    RuntimeDownloadFailed(String),
    #[error("Managed local AI port is unavailable: {0}")]
    RuntimePortConflict(String),
    #[error("Managed local AI runtime failed: {0}")]
    RuntimeFailed(String),
}

#[cfg(not(drifty_screen_context_excluded))]
pub(super) use runtime::ScreenRecipientObservation;

#[cfg(not(drifty_screen_context_excluded))]
pub(super) fn observe_screen_recipient(app: &AppHandle) -> Option<ScreenRecipientObservation> {
    let root = managed_ai_root(app).ok()?;
    runtime::observe_screen_recipient(&root)
}

#[tauri::command]
pub fn managed_ai_catalog() -> Vec<ManagedAiCatalogModel> {
    catalog_for_machine(hardware::machine_memory_bytes())
}

fn catalog_for_machine(machine_memory_bytes: Option<u64>) -> Vec<ManagedAiCatalogModel> {
    let recommended_id = machine_memory_bytes.and_then(recommended_model_id);
    MANAGED_MODELS
        .iter()
        .copied()
        .map(|spec| catalog_model_for_machine(spec, machine_memory_bytes, recommended_id))
        .collect()
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
    async_runtime::spawn_blocking(move || install_model_at_root(&root, &model_id, Some(&app)))
        .await
        .map_err(|error| error.to_string())?
        .map_err(error_message)
}

#[tauri::command]
pub async fn managed_ai_start(app: AppHandle, model_id: String) -> Result<ManagedAiStatus, String> {
    let root = managed_ai_root(&app).map_err(error_message)?;
    let model_id = model_id.trim().to_string();
    require_model(&model_id).map_err(error_message)?;
    // Claim lifecycle ownership before the blocking start begins, so the
    // previous model's monitor cannot publish over this newer start attempt.
    let monitor_generation = begin_runtime_status_monitor(&root);
    let start_root = root.clone();
    let start_model_id = model_id.clone();
    let start_app = app.clone();
    let start_result = async_runtime::spawn_blocking(move || {
        start_model_at_root_for_generation(
            &start_root,
            &start_model_id,
            Some(&start_app),
            Some(monitor_generation),
        )
    })
    .await;
    let status = match start_result {
        Ok(Ok(status)) => status,
        Ok(Err(error)) => {
            finish_runtime_status_monitor(&root, monitor_generation);
            return Err(error_message(error));
        }
        Err(error) => {
            finish_runtime_status_monitor(&root, monitor_generation);
            return Err(error.to_string());
        }
    };

    if matches!(status.state, ManagedAiInstallState::Starting) {
        spawn_runtime_status_monitor(root, model_id, monitor_generation, app);
    } else {
        finish_runtime_status_monitor(&root, monitor_generation);
    }
    Ok(status)
}

#[tauri::command]
pub async fn managed_ai_delete(
    app: AppHandle,
    model_id: String,
) -> Result<ManagedAiStatus, String> {
    let root = managed_ai_root(&app).map_err(error_message)?;
    let model_id = model_id.trim().to_string();
    require_model(&model_id).map_err(error_message)?;
    invalidate_runtime_status_monitor(&root);
    async_runtime::spawn_blocking(move || delete_model_at_root(&root, &model_id, Some(&app)))
        .await
        .map_err(|error| error.to_string())?
        .map_err(error_message)
}

/// `wait_for_exit` keeps Quit and update handoffs waiting until the runtime has
/// released its files. At a Windows session end the termination request is
/// enough: waiting for a loaded model to unload held the end-session handler.
pub(crate) fn managed_ai_stop_runtime_for_app_exit(app: &AppHandle, wait_for_exit: bool) {
    let root = managed_ai_root(app).ok();
    if let Some(root) = root.as_deref() {
        invalidate_runtime_status_monitor(root);
    }
    let _ = runtime::stop_runtime(root.as_deref(), wait_for_exit);
}

fn install_model_at_root(
    root: &Path,
    model_id: &str,
    app: Option<&AppHandle>,
) -> Result<ManagedAiStatus, ManagedAiError> {
    let spec = require_model(model_id)?;
    install_model_at_root_with_components(
        root,
        model_id,
        |needs_model_download| model_resource_error_status(root, spec, needs_model_download, app),
        download_model_artifact,
        runtime::prepare_runtime,
        app,
    )
}

#[cfg(test)]
fn install_model_at_root_with_downloader(
    root: &Path,
    model_id: &str,
    downloader: impl FnOnce(
        &Path,
        ManagedAiModelSpec,
        &mut dyn FnMut(ManagedAiDownloadProgress) -> Result<(), ManagedAiError>,
    ) -> Result<PathBuf, ManagedAiError>,
    app: Option<&AppHandle>,
) -> Result<ManagedAiStatus, ManagedAiError> {
    install_model_at_root_with_components(
        root,
        model_id,
        |_| Ok(None),
        downloader,
        runtime::write_runtime_completion_fixture,
        app,
    )
}

#[cfg(test)]
fn install_model_at_root_with_preflight_and_downloader(
    root: &Path,
    model_id: &str,
    preflight: impl FnOnce(bool) -> Result<Option<ManagedAiStatus>, ManagedAiError>,
    downloader: impl FnOnce(
        &Path,
        ManagedAiModelSpec,
        &mut dyn FnMut(ManagedAiDownloadProgress) -> Result<(), ManagedAiError>,
    ) -> Result<PathBuf, ManagedAiError>,
    app: Option<&AppHandle>,
) -> Result<ManagedAiStatus, ManagedAiError> {
    install_model_at_root_with_components(
        root,
        model_id,
        preflight,
        downloader,
        runtime::write_runtime_completion_fixture,
        app,
    )
}

#[cfg(test)]
fn install_model_at_root_with_runtime_preparer(
    root: &Path,
    model_id: &str,
    downloader: impl FnOnce(
        &Path,
        ManagedAiModelSpec,
        &mut dyn FnMut(ManagedAiDownloadProgress) -> Result<(), ManagedAiError>,
    ) -> Result<PathBuf, ManagedAiError>,
    runtime_preparer: impl FnOnce(&Path) -> Result<(), ManagedAiError>,
) -> Result<ManagedAiStatus, ManagedAiError> {
    install_model_at_root_with_components(
        root,
        model_id,
        |_| Ok(None),
        downloader,
        runtime_preparer,
        None,
    )
}

fn install_model_at_root_with_components(
    root: &Path,
    model_id: &str,
    preflight: impl FnOnce(bool) -> Result<Option<ManagedAiStatus>, ManagedAiError>,
    downloader: impl FnOnce(
        &Path,
        ManagedAiModelSpec,
        &mut dyn FnMut(ManagedAiDownloadProgress) -> Result<(), ManagedAiError>,
    ) -> Result<PathBuf, ManagedAiError>,
    runtime_preparer: impl FnOnce(&Path) -> Result<(), ManagedAiError>,
    app: Option<&AppHandle>,
) -> Result<ManagedAiStatus, ManagedAiError> {
    let spec = require_model(model_id)?;
    // Own the root before preflight can write a resource error over another
    // model's in-flight progress. status.json is shared by all local models.
    let active_install = match ActiveInstallGuard::acquire(root, spec.id) {
        Ok(guard) => guard,
        Err(active) => return status_for_active_install(root, &active),
    };
    // Installing and starting share one persisted status document. Claim the
    // operation before waiting for the lifecycle lock, then supersede any
    // queued start monitor. A child that has not yet become ready must also be
    // stopped so the install cannot strand an unmonitored cold start.
    invalidate_runtime_status_monitor(root);
    let existing_artifact_dir = {
        let _lifecycle_guard = RUNTIME_LIFECYCLE_LOCK
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        runtime::stop_unready_runtime(root)?;
        let existing_artifact_dir = status_artifact_dir(root, spec)?;
        let needs_model_download = existing_artifact_dir.is_none();
        if let Some(status) = preflight(needs_model_download)? {
            return Ok(status);
        }
        let installing = status_with_installed_models(
            root,
            status_for_spec(
                ManagedAiInstallState::Installing,
                spec,
                existing_artifact_dir.clone(),
                if needs_model_download {
                    "Downloading managed local model..."
                } else {
                    "Preparing managed local AI runtime..."
                },
            ),
        )?;
        write_and_emit_status(root, &installing, app)?;
        active_install.mark_status_ready();
        existing_artifact_dir
    };
    let reused_existing_artifact = existing_artifact_dir.is_some();

    let mut progress_gate = DownloadProgressWriteGate::default();
    let mut report_progress = |progress: ManagedAiDownloadProgress| {
        if !progress_gate.should_write(progress.percent) {
            return Ok(());
        }
        let status =
            status_with_installed_models(root, status_for_download_progress(spec, progress))?;
        // Progress snapshots are advisory: the next percent or the terminal
        // status rewrites status.json, so one refused write must not abort a
        // multi-gigabyte download.
        if let Err(error) = write_status(root, &status) {
            eprintln!("Managed local AI progress was not persisted: {error}");
        }
        if let Some(app) = app {
            let _ = app.emit(MANAGED_AI_STATUS_EVENT, status.clone());
        }
        Ok(())
    };

    let artifact_dir = if let Some(artifact_dir) = existing_artifact_dir {
        artifact_dir
    } else {
        match downloader(root, spec, &mut report_progress) {
            Ok(path) => path,
            Err(error) => {
                let status = match model_retry_error_kind(&error) {
                    Some(error_kind) => {
                        status_for_model_error(spec, None, &error.to_string(), error_kind)
                    }
                    None => status_for_global_error(&error.to_string()),
                };
                let status = status_with_installed_models(root, status)?;
                write_and_emit_status(root, &status, app)?;
                return Ok(status);
            }
        }
    };

    if !reused_existing_artifact {
        let preparing = status_with_installed_models(
            root,
            status_for_spec(
                ManagedAiInstallState::Installing,
                spec,
                Some(artifact_dir.clone()),
                "Preparing managed local AI runtime...",
            ),
        )?;
        write_and_emit_status(root, &preparing, app)?;
    }

    if let Err(error) = runtime_preparer(root) {
        let error_kind = runtime_error_kind(&error);
        let status = status_with_installed_models(
            root,
            status_for_model_error(spec, Some(artifact_dir), &error.to_string(), error_kind),
        )?;
        write_and_emit_status(root, &status, app)?;
        return Ok(status);
    }

    let status = status_with_installed_models(
        root,
        status_for_spec(
            ManagedAiInstallState::Installed,
            spec,
            Some(artifact_dir),
            "Managed local AI is ready to start.",
        ),
    )?;
    write_and_emit_status(root, &status, app)?;
    Ok(status)
}

#[derive(Clone)]
struct ActiveInstall {
    model_id: String,
    status_ready: bool,
}

struct ActiveInstallGuard {
    key: (PathBuf, String),
}

impl ActiveInstallGuard {
    fn acquire(root: &Path, model_id: &str) -> Result<Self, ActiveInstall> {
        let root = root.to_path_buf();
        let mut active = ACTIVE_INSTALLS
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if let Some(existing) = active.get(&root) {
            return Err(existing.clone());
        }
        active.insert(
            root.clone(),
            ActiveInstall {
                model_id: model_id.to_string(),
                status_ready: false,
            },
        );
        Ok(Self {
            key: (root, model_id.to_string()),
        })
    }

    fn mark_status_ready(&self) {
        let mut active = ACTIVE_INSTALLS
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if let Some(install) = active.get_mut(&self.key.0) {
            if install.model_id == self.key.1 {
                install.status_ready = true;
            }
        }
    }
}

impl Drop for ActiveInstallGuard {
    fn drop(&mut self) {
        let mut active = ACTIVE_INSTALLS
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let remove = active
            .get(&self.key.0)
            .map(|install| install.model_id == self.key.1)
            .unwrap_or(false);
        if remove {
            active.remove(&self.key.0);
        }
    }
}

fn is_install_active(root: &Path, model_id: &str) -> bool {
    active_install(root)
        .map(|install| install.model_id == model_id)
        .unwrap_or(false)
}

fn active_install(root: &Path) -> Option<ActiveInstall> {
    ACTIVE_INSTALLS
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .get(root)
        .cloned()
}

fn status_for_active_install(
    root: &Path,
    active: &ActiveInstall,
) -> Result<ManagedAiStatus, ManagedAiError> {
    if active.status_ready {
        return read_status(root);
    }
    let spec = require_model(&active.model_id)?;
    let artifact_dir = status_artifact_dir(root, spec)?;
    let message = if artifact_dir.is_some() {
        "Preparing managed local AI runtime..."
    } else {
        "Downloading managed local model..."
    };
    status_with_installed_models(
        root,
        status_for_spec(
            ManagedAiInstallState::Installing,
            spec,
            artifact_dir,
            message,
        ),
    )
}

fn write_and_emit_status(
    root: &Path,
    status: &ManagedAiStatus,
    app: Option<&AppHandle>,
) -> Result<(), ManagedAiError> {
    write_status(root, status)?;
    if let Some(app) = app {
        let _ = app.emit(MANAGED_AI_STATUS_EVENT, status.clone());
    }
    Ok(())
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

#[cfg(test)]
fn start_model_at_root(
    root: &Path,
    model_id: &str,
    app: Option<&AppHandle>,
) -> Result<ManagedAiStatus, ManagedAiError> {
    start_model_at_root_for_generation(root, model_id, app, None)
}

fn start_model_at_root_for_generation(
    root: &Path,
    model_id: &str,
    app: Option<&AppHandle>,
    monitor_generation: Option<u64>,
) -> Result<ManagedAiStatus, ManagedAiError> {
    // Serialize the whole start/status transaction. The process slot itself is
    // protected in runtime::process, but without this outer lock two different
    // models can finish their readiness waits out of order and persist a stale
    // model as the active status after the newer start already won.
    let _lifecycle_guard = RUNTIME_LIFECYCLE_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    // Generation is claimed before entering the blocking pool. Re-check it
    // after acquiring the lifecycle lock so scheduling cannot let an older
    // queued start run after and overwrite the newer request.
    if monitor_generation
        .is_some_and(|generation| !runtime_status_monitor_is_current(root, generation))
    {
        return read_status(root);
    }
    if let Some(active) = active_install(root) {
        return status_for_active_install(root, &active);
    }
    let spec = require_model(model_id)?;
    if let Some(status) = model_resource_error_status(root, spec, false, app)? {
        return Ok(status);
    }
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
        write_and_emit_status(root, &status, app)?;
        return Ok(status);
    };

    let status = match runtime::start_runtime(root, spec, &artifact_dir) {
        Ok(status) => status,
        Err(error) => {
            let error_kind = runtime_error_kind(&error);
            let message = error_message(error);
            status_for_model_error(spec, Some(artifact_dir), &message, error_kind)
        }
    };
    let status = status_with_installed_models(root, status)?;
    write_and_emit_status(root, &status, app)?;
    Ok(status)
}

fn spawn_runtime_status_monitor(root: PathBuf, model_id: String, generation: u64, app: AppHandle) {
    async_runtime::spawn_blocking(move || loop {
        thread::sleep(RUNTIME_STATUS_POLL_INTERVAL);
        match poll_runtime_status_monitor(&root, &model_id, generation, Some(&app)) {
            Ok(RuntimeStatusMonitorPoll::Continue) => {}
            Ok(RuntimeStatusMonitorPoll::Finished) | Err(_) => return,
        }
    });
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RuntimeStatusMonitorPoll {
    Continue,
    Finished,
}

fn poll_runtime_status_monitor(
    root: &Path,
    model_id: &str,
    generation: u64,
    app: Option<&AppHandle>,
) -> Result<RuntimeStatusMonitorPoll, ManagedAiError> {
    poll_runtime_status_monitor_with_before_publish(root, model_id, generation, app, || {})
}

fn poll_runtime_status_monitor_with_before_publish(
    root: &Path,
    model_id: &str,
    generation: u64,
    app: Option<&AppHandle>,
    before_publish: impl FnOnce(),
) -> Result<RuntimeStatusMonitorPoll, ManagedAiError> {
    // Reconciliation and publication are one lifecycle transaction. If a
    // newer install/start/delete invalidates this generation while waiting,
    // this poll observes that before touching status.json. If invalidation
    // happens after the final check, the newer operation cannot publish until
    // this guard is released, so its status necessarily wins last.
    let _lifecycle_guard = RUNTIME_LIFECYCLE_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    if !runtime_status_monitor_is_current(root, generation) {
        return Ok(RuntimeStatusMonitorPoll::Finished);
    }

    let status = match reconcile_status(root) {
        Ok(status) => status,
        Err(error) => {
            finish_runtime_status_monitor(root, generation);
            return Err(error);
        }
    };
    if !runtime_status_monitor_is_current(root, generation) {
        return Ok(RuntimeStatusMonitorPoll::Finished);
    }
    if status.selected_model_id.as_deref() != Some(model_id) {
        finish_runtime_status_monitor(root, generation);
        return Ok(RuntimeStatusMonitorPoll::Finished);
    }
    if matches!(status.state, ManagedAiInstallState::Starting) {
        return Ok(RuntimeStatusMonitorPoll::Continue);
    }

    before_publish();
    if let Err(error) = write_and_emit_status(root, &status, app) {
        finish_runtime_status_monitor(root, generation);
        return Err(error);
    }
    finish_runtime_status_monitor(root, generation);
    Ok(RuntimeStatusMonitorPoll::Finished)
}

fn begin_runtime_status_monitor(root: &Path) -> u64 {
    let generation = NEXT_RUNTIME_MONITOR_GENERATION.fetch_add(1, Ordering::Relaxed);
    ACTIVE_RUNTIME_MONITORS
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .insert(root.to_path_buf(), generation);
    generation
}

fn runtime_status_monitor_is_current(root: &Path, generation: u64) -> bool {
    ACTIVE_RUNTIME_MONITORS
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .get(root)
        .is_some_and(|current| *current == generation)
}

fn finish_runtime_status_monitor(root: &Path, generation: u64) {
    let mut monitors = ACTIVE_RUNTIME_MONITORS
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    if monitors
        .get(root)
        .is_some_and(|current| *current == generation)
    {
        monitors.remove(root);
    }
}

fn invalidate_runtime_status_monitor(root: &Path) {
    ACTIVE_RUNTIME_MONITORS
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .remove(root);
}

fn model_resource_error_status(
    root: &Path,
    spec: ManagedAiModelSpec,
    check_storage: bool,
    app: Option<&AppHandle>,
) -> Result<Option<ManagedAiStatus>, ManagedAiError> {
    let memory_bytes = hardware::machine_memory_bytes();
    let storage_bytes = check_storage
        .then(|| hardware::available_storage_bytes(root))
        .flatten();
    let Some(failure) = model_resource_failure(spec, memory_bytes, storage_bytes) else {
        return Ok(None);
    };
    let mut error_status = status_for_model_error(spec, None, &failure.message, failure.error_kind);
    error_status.required_resource_bytes = Some(failure.required_bytes);
    error_status.available_resource_bytes = Some(failure.available_bytes);
    let status = status_with_installed_models(root, error_status)?;
    write_and_emit_status(root, &status, app)?;
    Ok(Some(status))
}

struct ModelResourceFailure {
    error_kind: ManagedAiStatusErrorKind,
    message: String,
    required_bytes: u64,
    available_bytes: u64,
}

fn model_resource_failure(
    spec: ManagedAiModelSpec,
    memory_bytes: Option<u64>,
    storage_bytes: Option<u64>,
) -> Option<ModelResourceFailure> {
    if let Some(available_bytes) =
        memory_bytes.filter(|available| *available < spec.min_memory_bytes)
    {
        return Some(ModelResourceFailure {
            error_kind: ManagedAiStatusErrorKind::InsufficientMemory,
            message: "Selected local model requires more memory than this computer has."
                .to_string(),
            required_bytes: spec.min_memory_bytes,
            available_bytes,
        });
    }
    if let Some(available_bytes) =
        storage_bytes.filter(|available| *available < spec.disk_required_bytes)
    {
        return Some(ModelResourceFailure {
            error_kind: ManagedAiStatusErrorKind::InsufficientStorage,
            message: "Not enough free storage to download the selected local model.".to_string(),
            required_bytes: spec.disk_required_bytes,
            available_bytes,
        });
    }
    None
}

fn delete_model_at_root(
    root: &Path,
    model_id: &str,
    app: Option<&AppHandle>,
) -> Result<ManagedAiStatus, ManagedAiError> {
    // Deletion and startup both own the process slot and persisted runtime
    // status. Keeping them in one transaction prevents an older start from
    // restoring `starting` after a newer delete has removed the artifact.
    let _lifecycle_guard = RUNTIME_LIFECYCLE_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    if let Some(active) = active_install(root) {
        return status_for_active_install(root, &active);
    }
    let spec = require_model(model_id)?;
    runtime::stop_runtime_for_model(root, spec.id)?;
    let model_path = model_dir(root, spec.id);
    if model_path.exists() {
        fs::remove_dir_all(model_path)?;
    }
    let status = status_with_installed_models(root, default_status())?;
    write_and_emit_status(root, &status, app)?;
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
    if model_dir_has_artifact(&path, spec)? {
        Ok(Some(path))
    } else {
        Ok(None)
    }
}

fn model_dir_has_artifact(path: &Path, spec: ManagedAiModelSpec) -> Result<bool, ManagedAiError> {
    if !path.is_dir() {
        return Ok(false);
    }
    match fs::metadata(path.join(spec.file_name)) {
        Ok(metadata) => Ok(metadata.is_file() && metadata.len() == spec.expected_size_bytes),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.into()),
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
        ManagedAiError::Io(error) if is_storage_full_error(error) => {
            Some(ManagedAiStatusErrorKind::InsufficientStorage)
        }
        ManagedAiError::AppData(_)
        | ManagedAiError::UnknownModel(_)
        | ManagedAiError::Io(_)
        | ManagedAiError::Json(_)
        | ManagedAiError::RuntimeMissing(_)
        | ManagedAiError::RuntimeDownloadFailed(_)
        | ManagedAiError::RuntimePortConflict(_)
        | ManagedAiError::RuntimeFailed(_) => None,
    }
}

fn runtime_error_kind(error: &ManagedAiError) -> ManagedAiStatusErrorKind {
    match error {
        ManagedAiError::RuntimeMissing(_) => ManagedAiStatusErrorKind::RuntimeMissing,
        ManagedAiError::RuntimeDownloadFailed(_) => ManagedAiStatusErrorKind::RuntimeDownloadFailed,
        ManagedAiError::RuntimePortConflict(_) => ManagedAiStatusErrorKind::RuntimePortConflict,
        ManagedAiError::Io(error) if is_storage_full_error(error) => {
            ManagedAiStatusErrorKind::InsufficientStorage
        }
        ManagedAiError::AppData(_)
        | ManagedAiError::UnknownModel(_)
        | ManagedAiError::Io(_)
        | ManagedAiError::Json(_)
        | ManagedAiError::Http(_)
        | ManagedAiError::DownloadFailed(_)
        | ManagedAiError::RuntimeFailed(_) => ManagedAiStatusErrorKind::RuntimeFailed,
    }
}

fn is_storage_full_error(error: &std::io::Error) -> bool {
    // ENOSPC is 28 on macOS, the only production target for this command.
    error.raw_os_error() == Some(28)
}
