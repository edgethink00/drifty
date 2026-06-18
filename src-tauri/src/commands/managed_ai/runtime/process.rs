use std::{
    fs::{self, OpenOptions},
    path::Path,
    process::{Child, Command, Stdio},
    sync::{LazyLock, Mutex, MutexGuard},
    thread,
    time::{Duration, Instant},
};

use serde_json::Value;

use super::super::{ManagedAiError, ManagedAiModelSpec, MANAGED_BASE_URL};
use super::{RUNTIME_HOST, RUNTIME_PORT};

const START_READY_GRACE: Duration = Duration::from_millis(1_500);
const HEALTH_TIMEOUT: Duration = Duration::from_millis(400);

static RUNTIME_CHILD: LazyLock<Mutex<Option<ManagedRuntimeChild>>> =
    LazyLock::new(|| Mutex::new(None));

struct ManagedRuntimeChild {
    model_id: &'static str,
    child: Child,
}

pub(super) fn start_child(
    root: &Path,
    runtime_path: &Path,
    model_path: &Path,
    spec: ManagedAiModelSpec,
) -> Result<(), ManagedAiError> {
    let child = spawn_runtime(root, runtime_path, model_path, spec)?;
    let mut guard = runtime_guard()?;
    stop_child_in_guard(&mut guard)?;
    *guard = Some(ManagedRuntimeChild {
        model_id: spec.id,
        child,
    });
    Ok(())
}

pub(super) fn wait_for_ready(spec: ManagedAiModelSpec) -> bool {
    let deadline = Instant::now() + START_READY_GRACE;
    while Instant::now() < deadline {
        if server_has_model(spec) {
            return true;
        }
        thread::sleep(Duration::from_millis(100));
    }
    false
}

pub(super) fn server_has_model(spec: ManagedAiModelSpec) -> bool {
    let Ok(client) = reqwest::blocking::Client::builder()
        .timeout(HEALTH_TIMEOUT)
        .build()
    else {
        return false;
    };
    let health_ok = ["/health", "/v1/health"].iter().any(|path| {
        client
            .get(format!("http://{RUNTIME_HOST}:{RUNTIME_PORT}{path}"))
            .send()
            .is_ok_and(|response| response.status().is_success())
    });
    if !health_ok {
        return false;
    }

    client
        .get(format!("{MANAGED_BASE_URL}/models"))
        .send()
        .ok()
        .filter(|response| response.status().is_success())
        .and_then(|response| response.json::<Value>().ok())
        .and_then(|value| value.get("data").and_then(Value::as_array).cloned())
        .is_some_and(|models| {
            models.iter().any(|model| {
                model
                    .get("id")
                    .and_then(Value::as_str)
                    .is_some_and(|id| id == spec.runtime_model)
            })
        })
}

pub(super) fn child_alive_for_model(model_id: &str) -> Result<bool, ManagedAiError> {
    let mut guard = runtime_guard()?;
    let Some(runtime) = guard.as_mut() else {
        return Ok(false);
    };
    if runtime.model_id != model_id {
        return Ok(false);
    }
    match runtime.child.try_wait()? {
        Some(_) => {
            *guard = None;
            Ok(false)
        }
        None => Ok(true),
    }
}

pub(super) fn stop_unrelated_child(model_id: &str) -> Result<(), ManagedAiError> {
    let mut guard = runtime_guard()?;
    let should_stop = guard
        .as_ref()
        .is_some_and(|runtime| runtime.model_id != model_id);
    if should_stop {
        stop_child_in_guard(&mut guard)?;
    }
    Ok(())
}

pub(super) fn stop_runtime_for_model(model_id: &str) -> Result<(), ManagedAiError> {
    let mut guard = runtime_guard()?;
    let should_stop = guard
        .as_ref()
        .is_some_and(|runtime| runtime.model_id == model_id);
    if should_stop {
        stop_child_in_guard(&mut guard)?;
    }
    Ok(())
}

pub(super) fn stop_runtime() -> Result<(), ManagedAiError> {
    let mut guard = runtime_guard()?;
    stop_child_in_guard(&mut guard)
}

#[cfg(test)]
pub(super) fn stop_runtime_for_tests() {
    if let Ok(mut guard) = RUNTIME_CHILD.lock() {
        if let Some(mut runtime) = guard.take() {
            let _ = runtime.child.kill();
            let _ = runtime.child.wait();
        }
    }
}

fn spawn_runtime(
    root: &Path,
    runtime_path: &Path,
    model_path: &Path,
    spec: ManagedAiModelSpec,
) -> Result<Child, ManagedAiError> {
    let log_dir = root.join("logs");
    fs::create_dir_all(&log_dir)?;
    let log_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_dir.join("llama-server.log"))?;
    let stderr = log_file.try_clone()?;

    Command::new(runtime_path)
        .arg("-m")
        .arg(model_path)
        .arg("--host")
        .arg(RUNTIME_HOST)
        .arg("--port")
        .arg(RUNTIME_PORT)
        .arg("--alias")
        .arg(spec.runtime_model)
        .arg("--reasoning")
        .arg("off")
        .arg("--reasoning-format")
        .arg("none")
        .arg("--reasoning-budget")
        .arg("0")
        .stdin(Stdio::null())
        .stdout(Stdio::from(log_file))
        .stderr(Stdio::from(stderr))
        .spawn()
        .map_err(|error| ManagedAiError::RuntimeFailed(error.to_string()))
}

fn stop_child_in_guard(
    guard: &mut MutexGuard<'_, Option<ManagedRuntimeChild>>,
) -> Result<(), ManagedAiError> {
    if let Some(mut runtime) = guard.take() {
        runtime.child.kill()?;
        let _status = runtime.child.wait()?;
    }
    Ok(())
}

fn runtime_guard() -> Result<MutexGuard<'static, Option<ManagedRuntimeChild>>, ManagedAiError> {
    RUNTIME_CHILD
        .lock()
        .map_err(|error| ManagedAiError::RuntimeFailed(error.to_string()))
}
