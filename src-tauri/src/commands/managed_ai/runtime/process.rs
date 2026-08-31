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
use super::args::runtime_args;
use super::memory::process_memory_usage_bytes;
#[cfg(windows)]
use super::RUNTIME_PORT_NUMBER;
use super::{RUNTIME_HOST, RUNTIME_PORT};

const START_READY_GRACE: Duration = Duration::from_millis(1_500);
const START_FAILURE_TIMEOUT: Duration = Duration::from_secs(120);
const HEALTH_TIMEOUT: Duration = Duration::from_millis(400);

static RUNTIME_CHILD: LazyLock<Mutex<Option<ManagedRuntimeChild>>> =
    LazyLock::new(|| Mutex::new(None));

struct ManagedRuntimeChild {
    model_id: &'static str,
    child: Child,
    started_at: Instant,
}

pub(super) fn start_child(
    root: &Path,
    runtime_path: &Path,
    model_path: &Path,
    spec: ManagedAiModelSpec,
) -> Result<(), ManagedAiError> {
    let mut guard = runtime_guard()?;
    if let Some(runtime) = guard.as_mut() {
        if runtime.model_id == spec.id {
            if runtime.child.try_wait()?.is_none() {
                // The entire check lives under the process-slot lock. Two
                // callers can pass start_runtime's optimistic checks together,
                // but only the first one may create the child; later callers
                // adopt that same in-flight load instead of restarting it.
                return Ok(());
            }
            *guard = None;
        }
    }
    stop_child_in_guard(&mut guard)?;
    let child = spawn_runtime(root, runtime_path, model_path, spec)?;
    *guard = Some(ManagedRuntimeChild {
        model_id: spec.id,
        child,
        started_at: Instant::now(),
    });
    Ok(())
}

pub(super) fn stop_child_if_start_timed_out(model_id: &str) -> Result<bool, ManagedAiError> {
    let mut guard = runtime_guard()?;
    let Some(runtime) = guard.as_mut() else {
        return Ok(false);
    };
    if runtime.model_id != model_id {
        return Ok(false);
    }
    if runtime.child.try_wait()?.is_some() {
        *guard = None;
        return Ok(false);
    }
    if runtime.started_at.elapsed() < START_FAILURE_TIMEOUT {
        return Ok(false);
    }
    stop_child_in_guard(&mut guard)?;
    Ok(true)
}

pub(super) fn wait_for_ready(runtime_path: &Path, spec: ManagedAiModelSpec) -> bool {
    let deadline = Instant::now() + START_READY_GRACE;
    while Instant::now() < deadline {
        if server_has_model(runtime_path, spec) {
            return true;
        }
        thread::sleep(Duration::from_millis(100));
    }
    false
}

pub(super) fn server_has_model(runtime_path: &Path, spec: ManagedAiModelSpec) -> bool {
    if !runtime_listener_matches(runtime_path) {
        return false;
    }

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

pub(super) fn server_memory_usage_bytes(runtime_path: &Path) -> Option<u64> {
    let pids = runtime_listener_pids().ok()?;
    pids.into_iter()
        .find_map(|pid| match process_executable_matches(pid, runtime_path) {
            Ok(true) => process_memory_usage_bytes(pid),
            Ok(false) | Err(_) => None,
        })
}

fn runtime_listener_matches(runtime_path: &Path) -> bool {
    let Ok(pids) = runtime_listener_pids() else {
        return false;
    };
    for pid in pids {
        match process_executable_matches(pid, runtime_path) {
            Ok(true) => return true,
            Ok(false) | Err(_) => {}
        }
    }
    false
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

pub(super) fn stop_stale_runtime_server(runtime_path: &Path) -> Result<(), ManagedAiError> {
    // The tracked child is stopped through its handle; only untracked servers
    // (for example one adopted from a previous app run) are reaped here.
    let tracked_pid = tracked_child_pid();
    for pid in runtime_listener_pids()? {
        if tracked_pid == Some(pid) {
            continue;
        }
        if process_executable_matches(pid, runtime_path)? {
            kill_process(pid, runtime_path)?;
        }
    }
    Ok(())
}

fn tracked_child_pid() -> Option<u32> {
    RUNTIME_CHILD
        .lock()
        .ok()?
        .as_ref()
        .map(|runtime| runtime.child.id())
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

#[cfg(test)]
static TEST_RUNTIME_LISTENER_PIDS: Mutex<Option<Vec<u32>>> = Mutex::new(None);

#[cfg(test)]
pub(super) fn set_runtime_listener_pids_for_tests(pids: Option<Vec<u32>>) {
    if let Ok(mut guard) = TEST_RUNTIME_LISTENER_PIDS.lock() {
        *guard = pids;
    }
}

#[cfg(test)]
pub(super) fn age_tracked_child_for_tests(age: Duration) {
    if let Ok(mut guard) = RUNTIME_CHILD.lock() {
        if let Some(runtime) = guard.as_mut() {
            runtime.started_at = Instant::now().checked_sub(age).unwrap_or_else(Instant::now);
        }
    }
}

fn runtime_listener_pids() -> Result<Vec<u32>, ManagedAiError> {
    #[cfg(test)]
    if let Ok(guard) = TEST_RUNTIME_LISTENER_PIDS.lock() {
        if let Some(pids) = guard.as_ref() {
            return Ok(pids.clone());
        }
    }
    real_runtime_listener_pids()
}

fn real_runtime_listener_pids() -> Result<Vec<u32>, ManagedAiError> {
    #[cfg(windows)]
    {
        return windows_listener_pids_for_port(RUNTIME_PORT_NUMBER);
    }
    #[cfg(not(windows))]
    {
        let output = match Command::new("lsof")
            .arg("-nP")
            .arg(format!("-iTCP:{RUNTIME_PORT}"))
            .arg("-sTCP:LISTEN")
            .arg("-t")
            .output()
        {
            Ok(output) => output,
            Err(_) => return Ok(Vec::new()),
        };
        if !output.status.success() {
            return Ok(Vec::new());
        }
        let text = String::from_utf8_lossy(&output.stdout);
        Ok(text
            .lines()
            .filter_map(|line| line.trim().parse::<u32>().ok())
            .collect())
    }
}

#[cfg(windows)]
fn windows_listener_pids_for_port(port: u16) -> Result<Vec<u32>, ManagedAiError> {
    use std::{ffi::c_void, mem::size_of, ptr};
    use windows_sys::Win32::{
        Foundation::{ERROR_INSUFFICIENT_BUFFER, NO_ERROR},
        NetworkManagement::IpHelper::{
            GetExtendedTcpTable, MIB_TCPROW_OWNER_PID, TCP_TABLE_OWNER_PID_LISTENER,
        },
        Networking::WinSock::AF_INET,
    };

    let mut byte_count = 0_u32;
    let first_result = unsafe {
        GetExtendedTcpTable(
            ptr::null_mut(),
            &mut byte_count,
            0,
            u32::from(AF_INET),
            TCP_TABLE_OWNER_PID_LISTENER,
            0,
        )
    };
    if first_result != ERROR_INSUFFICIENT_BUFFER && first_result != NO_ERROR {
        return Err(ManagedAiError::RuntimeFailed(format!(
            "Unable to size the Windows TCP listener table (error {first_result})."
        )));
    }
    if byte_count < size_of::<u32>() as u32 {
        return Ok(Vec::new());
    }

    // A u32 backing allocation gives the table and every row the alignment
    // required by MIB_TCPTABLE_OWNER_PID while still honoring the byte count
    // returned by Windows.
    for _attempt in 0..4 {
        let word_count = (byte_count as usize).div_ceil(size_of::<u32>());
        let mut storage = vec![0_u32; word_count];
        let result = unsafe {
            GetExtendedTcpTable(
                storage.as_mut_ptr().cast::<c_void>(),
                &mut byte_count,
                0,
                u32::from(AF_INET),
                TCP_TABLE_OWNER_PID_LISTENER,
                0,
            )
        };
        if result == ERROR_INSUFFICIENT_BUFFER {
            continue;
        }
        if result != NO_ERROR {
            return Err(ManagedAiError::RuntimeFailed(format!(
                "Unable to read the Windows TCP listener table (error {result})."
            )));
        }

        let row_count = storage[0] as usize;
        let required_bytes = size_of::<u32>()
            .checked_add(row_count.saturating_mul(size_of::<MIB_TCPROW_OWNER_PID>()))
            .ok_or_else(|| {
                ManagedAiError::RuntimeFailed("Windows TCP listener table overflowed.".into())
            })?;
        if required_bytes > byte_count as usize {
            return Err(ManagedAiError::RuntimeFailed(
                "Windows TCP listener table was truncated.".into(),
            ));
        }

        let rows = unsafe {
            std::slice::from_raw_parts(
                storage.as_ptr().cast::<u8>().add(size_of::<u32>()) as *const MIB_TCPROW_OWNER_PID,
                row_count,
            )
        };
        let mut pids = rows
            .iter()
            .filter(|row| u16::from_be(row.dwLocalPort as u16) == port)
            .map(|row| row.dwOwningPid)
            .collect::<Vec<_>>();
        pids.sort_unstable();
        pids.dedup();
        return Ok(pids);
    }

    Err(ManagedAiError::RuntimeFailed(
        "Windows TCP listener table kept growing during four bounded reads.".into(),
    ))
}

fn process_executable_matches(pid: u32, expected: &Path) -> Result<bool, ManagedAiError> {
    #[cfg(windows)]
    {
        return windows_process_executable_matches(pid, expected);
    }
    #[cfg(not(windows))]
    {
        let output = Command::new("ps")
            .arg("-p")
            .arg(pid.to_string())
            .arg("-o")
            .arg("command=")
            .output()
            .map_err(|error| ManagedAiError::RuntimeFailed(error.to_string()))?;
        if !output.status.success() {
            return Ok(false);
        }
        let command = String::from_utf8_lossy(&output.stdout);
        Ok(command.contains(&expected.to_string_lossy().to_string()))
    }
}

fn kill_process(pid: u32, _expected: &Path) -> Result<(), ManagedAiError> {
    #[cfg(windows)]
    {
        return windows_kill_process(pid, _expected);
    }
    #[cfg(not(windows))]
    {
        let status = Command::new("kill")
            .arg("-KILL")
            .arg(pid.to_string())
            .status()
            .map_err(|error| ManagedAiError::RuntimeFailed(error.to_string()))?;
        if status.success() {
            Ok(())
        } else {
            Err(ManagedAiError::RuntimeFailed(format!(
                "Failed to stop stale managed local AI runtime process {pid}."
            )))
        }
    }
}

#[cfg(windows)]
fn windows_process_executable_matches(pid: u32, expected: &Path) -> Result<bool, ManagedAiError> {
    use windows_sys::Win32::System::Threading::PROCESS_QUERY_LIMITED_INFORMATION;

    let Some(process) = WindowsProcessHandle::open(pid, PROCESS_QUERY_LIMITED_INFORMATION) else {
        return Ok(false);
    };
    Ok(process.executable_matches(expected))
}

#[cfg(windows)]
fn windows_kill_process(pid: u32, expected: &Path) -> Result<(), ManagedAiError> {
    use windows_sys::Win32::System::Threading::{
        TerminateProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE,
    };

    // Query and terminate through one handle. If the original PID exits and
    // Windows reuses its number, this handle still refers to the original
    // process object and cannot terminate the replacement.
    let Some(process) =
        WindowsProcessHandle::open(pid, PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE)
    else {
        return Ok(());
    };
    if !process.executable_matches(expected) {
        return Ok(());
    }
    if unsafe { TerminateProcess(process.0, 1) } != 0 {
        Ok(())
    } else {
        Err(ManagedAiError::RuntimeFailed(format!(
            "Failed to stop stale managed local AI runtime process {pid}."
        )))
    }
}

#[cfg(windows)]
struct WindowsProcessHandle(windows_sys::Win32::Foundation::HANDLE);

#[cfg(windows)]
impl WindowsProcessHandle {
    fn open(pid: u32, access: u32) -> Option<Self> {
        use windows_sys::Win32::System::Threading::OpenProcess;
        let handle = unsafe { OpenProcess(access, 0, pid) };
        (!handle.is_null()).then_some(Self(handle))
    }

    fn executable_matches(&self, expected: &Path) -> bool {
        self.executable_path().is_some_and(|actual| {
            normalize_windows_executable_path(&actual)
                == normalize_windows_executable_path(expected)
        })
    }

    fn executable_path(&self) -> Option<std::path::PathBuf> {
        use windows_sys::Win32::System::Threading::QueryFullProcessImageNameW;
        let mut buffer = vec![0_u16; 32_768];
        let mut length = buffer.len() as u32;
        if unsafe { QueryFullProcessImageNameW(self.0, 0, buffer.as_mut_ptr(), &mut length) } == 0 {
            return None;
        }
        buffer.truncate(length as usize);
        Some(std::path::PathBuf::from(String::from_utf16_lossy(&buffer)))
    }
}

#[cfg(windows)]
impl Drop for WindowsProcessHandle {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0);
        }
    }
}

#[cfg(windows)]
fn normalize_windows_executable_path(path: &Path) -> String {
    let canonical = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    canonical
        .to_string_lossy()
        .replace('/', "\\")
        .trim_start_matches(r"\\?\")
        .to_ascii_lowercase()
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

    let mut command = Command::new(runtime_path);
    command
        .args(runtime_args(model_path, spec))
        .stdin(Stdio::null())
        .stdout(Stdio::from(log_file))
        .stderr(Stdio::from(stderr));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
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

#[cfg(all(test, windows))]
mod windows_tests {
    use super::*;
    use std::net::TcpListener;

    #[test]
    fn listener_table_finds_the_current_process_for_an_ephemeral_port() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind listener");
        let port = listener.local_addr().expect("listener address").port();

        let pids = windows_listener_pids_for_port(port).expect("read listener table");

        assert!(pids.contains(&std::process::id()));
    }

    #[test]
    fn process_identity_uses_the_exact_executable_path() {
        let current_exe = std::env::current_exe().expect("current executable");
        assert!(
            windows_process_executable_matches(std::process::id(), &current_exe)
                .expect("query current executable")
        );
        assert!(!windows_process_executable_matches(
            std::process::id(),
            &current_exe.with_file_name("llama-server-lookalike.exe"),
        )
        .expect("reject different executable"));
    }
}
