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
use super::args::{runtime_args, runtime_model_location};
use super::memory::process_memory_usage_bytes;
#[cfg(windows)]
use super::RUNTIME_PORT_NUMBER;
use super::{RUNTIME_HOST, RUNTIME_PORT};

const START_READY_GRACE: Duration = Duration::from_millis(1_500);
#[cfg(windows)]
const START_FAILURE_TIMEOUT: Duration = Duration::from_secs(300);
#[cfg(not(windows))]
const START_FAILURE_TIMEOUT: Duration = Duration::from_secs(120);
const HEALTH_TIMEOUT: Duration = Duration::from_millis(400);
const READY_HEALTH_FAILURE_LIMIT: u8 = 3;
const READY_HEALTH_FAILURE_GRACE: Duration = Duration::from_secs(8);
const RUNTIME_LOG_MAX_BYTES: u64 = 5 * 1024 * 1024;
const RUNTIME_LOG_FILE_NAME: &str = "llama-server.log";
const PREVIOUS_RUNTIME_LOG_FILE_NAME: &str = "llama-server.previous.log";

static RUNTIME_CHILD: LazyLock<Mutex<Option<ManagedRuntimeChild>>> =
    LazyLock::new(|| Mutex::new(None));

struct ManagedRuntimeChild {
    root: std::path::PathBuf,
    model_id: &'static str,
    child: Child,
    started_at: Instant,
    became_ready: bool,
    consecutive_health_failures: u8,
    health_failure_started_at: Option<Instant>,
}

pub(super) enum TrackedChildState {
    Missing,
    Alive {
        became_ready: bool,
        health_degraded: bool,
    },
    Exited {
        became_ready: bool,
        status: String,
    },
}

pub(super) fn start_child(
    root: &Path,
    runtime_path: &Path,
    model_path: &Path,
    spec: ManagedAiModelSpec,
) -> Result<(), ManagedAiError> {
    let mut guard = runtime_guard()?;
    if let Some(runtime) = guard.as_mut() {
        if runtime.root == root && runtime.model_id == spec.id {
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
        root: root.to_path_buf(),
        model_id: spec.id,
        child,
        started_at: Instant::now(),
        became_ready: false,
        consecutive_health_failures: 0,
        health_failure_started_at: None,
    });
    Ok(())
}

pub(super) fn stop_child_if_start_timed_out(
    root: &Path,
    model_id: &str,
) -> Result<bool, ManagedAiError> {
    let mut guard = runtime_guard()?;
    let Some(runtime) = guard.as_mut() else {
        return Ok(false);
    };
    if runtime.root != root || runtime.model_id != model_id {
        return Ok(false);
    }
    if runtime.child.try_wait()?.is_some() {
        return Ok(false);
    }
    // The two-minute deadline governs only the initial model load. Once this
    // child has proven healthy, a later slow/failed health probe must not kill
    // an otherwise valid long-lived runtime merely because its process age is
    // greater than the cold-start allowance.
    if runtime.became_ready {
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

pub(super) fn child_state_for_model(
    root: &Path,
    model_id: &str,
) -> Result<TrackedChildState, ManagedAiError> {
    let mut guard = runtime_guard()?;
    let Some(runtime) = guard.as_mut() else {
        return Ok(TrackedChildState::Missing);
    };
    if runtime.root != root || runtime.model_id != model_id {
        return Ok(TrackedChildState::Missing);
    }
    match runtime.child.try_wait()? {
        Some(status) => Ok(TrackedChildState::Exited {
            became_ready: runtime.became_ready,
            status: status.to_string(),
        }),
        None => Ok(TrackedChildState::Alive {
            became_ready: runtime.became_ready,
            health_degraded: false,
        }),
    }
}

pub(super) fn child_state_after_failed_health_probe(
    root: &Path,
    model_id: &str,
) -> Result<TrackedChildState, ManagedAiError> {
    let mut guard = runtime_guard()?;
    let Some(runtime) = guard.as_mut() else {
        return Ok(TrackedChildState::Missing);
    };
    if runtime.root != root || runtime.model_id != model_id {
        return Ok(TrackedChildState::Missing);
    }
    match runtime.child.try_wait()? {
        Some(status) => Ok(TrackedChildState::Exited {
            became_ready: runtime.became_ready,
            status: status.to_string(),
        }),
        None => {
            let health_degraded = if runtime.became_ready {
                if runtime.health_failure_started_at.is_none() {
                    runtime.health_failure_started_at = Some(Instant::now());
                }
                runtime.consecutive_health_failures =
                    runtime.consecutive_health_failures.saturating_add(1);
                runtime.consecutive_health_failures >= READY_HEALTH_FAILURE_LIMIT
                    && runtime.health_failure_started_at.is_some_and(|started_at| {
                        started_at.elapsed() >= READY_HEALTH_FAILURE_GRACE
                    })
            } else {
                false
            };
            Ok(TrackedChildState::Alive {
                became_ready: runtime.became_ready,
                health_degraded,
            })
        }
    }
}

pub(super) fn mark_child_ready(root: &Path, model_id: &str) -> Result<(), ManagedAiError> {
    let mut guard = runtime_guard()?;
    if let Some(runtime) = guard
        .as_mut()
        .filter(|runtime| runtime.root == root && runtime.model_id == model_id)
    {
        if runtime.child.try_wait()?.is_none() {
            runtime.became_ready = true;
            runtime.consecutive_health_failures = 0;
            runtime.health_failure_started_at = None;
        }
    }
    Ok(())
}

pub(super) fn stop_unrelated_child(root: &Path, model_id: &str) -> Result<(), ManagedAiError> {
    let mut guard = runtime_guard()?;
    let should_stop = guard
        .as_ref()
        .is_some_and(|runtime| runtime.root != root || runtime.model_id != model_id);
    if should_stop {
        stop_child_in_guard(&mut guard)?;
    }
    Ok(())
}

pub(super) fn stop_unready_child(root: &Path) -> Result<(), ManagedAiError> {
    let mut guard = runtime_guard()?;
    let should_stop = guard
        .as_ref()
        .is_some_and(|runtime| runtime.root == root && !runtime.became_ready);
    if should_stop {
        stop_child_in_guard(&mut guard)?;
    }
    Ok(())
}

pub(super) fn stop_stale_runtime_server(runtime_path: &Path) -> Result<(), ManagedAiError> {
    reconcile_runtime_port(runtime_path, false)
}

pub(super) fn prepare_runtime_port(runtime_path: &Path) -> Result<(), ManagedAiError> {
    reconcile_runtime_port(runtime_path, true)
}

fn reconcile_runtime_port(
    runtime_path: &Path,
    reject_foreign_listener: bool,
) -> Result<(), ManagedAiError> {
    // The tracked child is stopped through its stable Child handle. An
    // untracked Unix PID cannot be terminated with the same guarantee: it may
    // be reused between identity inspection and a numeric signal. Treat every
    // such listener as foreign. Windows can safely inspect and terminate the
    // same process object through one handle, so only that platform reaps an
    // exact executable match here.
    let tracked_pid = tracked_live_child_pid(runtime_path)?;
    let mut foreign_listener_pids = Vec::new();
    for pid in runtime_listener_pids()? {
        if tracked_pid == Some(pid) {
            continue;
        }
        #[cfg(windows)]
        {
            if process_executable_matches(pid, runtime_path)? {
                kill_process(pid, runtime_path)?;
                continue;
            }
        }
        #[cfg(not(windows))]
        let _ = runtime_path;
        foreign_listener_pids.push(pid);
    }
    if reject_foreign_listener && !foreign_listener_pids.is_empty() {
        return Err(ManagedAiError::RuntimePortConflict(format!(
            "port {RUNTIME_PORT} is already used by another process"
        )));
    }
    Ok(())
}

fn tracked_live_child_pid(runtime_path: &Path) -> Result<Option<u32>, ManagedAiError> {
    let mut guard = runtime_guard()?;
    let Some(runtime) = guard.as_mut() else {
        return Ok(None);
    };
    if runtime.root.join("runtime").join(super::RUNTIME_FILE_NAME) != runtime_path {
        return Ok(None);
    }
    // Keep an exited child in the slot so status reconciliation can still
    // report its real exit, but never exempt its reusable numeric PID from
    // listener ownership checks.
    live_child_pid(&mut runtime.child)
}

fn live_child_pid(child: &mut Child) -> Result<Option<u32>, ManagedAiError> {
    Ok(child.try_wait()?.is_none().then(|| child.id()))
}

pub(super) fn stop_runtime_for_model(root: &Path, model_id: &str) -> Result<(), ManagedAiError> {
    let mut guard = runtime_guard()?;
    let should_stop = guard
        .as_ref()
        .is_some_and(|runtime| runtime.root == root && runtime.model_id == model_id);
    if should_stop {
        stop_child_in_guard(&mut guard)?;
    }
    Ok(())
}

pub(super) fn stop_runtime(wait_for_exit: bool) -> Result<(), ManagedAiError> {
    let mut guard = runtime_guard()?;
    if wait_for_exit {
        return stop_child_in_guard(&mut guard);
    }
    if let Some(mut runtime) = guard.take() {
        if runtime.child.try_wait()?.is_none() {
            runtime.child.kill()?;
        }
    }
    Ok(())
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
thread_local! {
    // Listener discovery is an OS-global operation, but Rust tests execute in
    // parallel. A thread-local override keeps one test's real/custom listener
    // view from leaking into another test while defaulting every test thread
    // to an isolated empty listener set.
    static TEST_RUNTIME_LISTENER_PIDS: std::cell::RefCell<Option<Vec<u32>>> =
        const { std::cell::RefCell::new(Some(Vec::new())) };
}

#[cfg(test)]
pub(in crate::commands::managed_ai) struct RuntimeListenerPidsOverride {
    previous: Option<Vec<u32>>,
    _not_send: std::marker::PhantomData<std::rc::Rc<()>>,
}

#[cfg(test)]
pub(super) fn override_runtime_listener_pids_for_tests(
    pids: Option<Vec<u32>>,
) -> RuntimeListenerPidsOverride {
    RuntimeListenerPidsOverride {
        previous: TEST_RUNTIME_LISTENER_PIDS
            .with(|current| std::mem::replace(&mut *current.borrow_mut(), pids)),
        _not_send: std::marker::PhantomData,
    }
}

#[cfg(test)]
impl Drop for RuntimeListenerPidsOverride {
    fn drop(&mut self) {
        TEST_RUNTIME_LISTENER_PIDS.with(|current| {
            *current.borrow_mut() = self.previous.take();
        });
    }
}

#[cfg(test)]
pub(super) fn age_tracked_child_for_tests(root: &Path, age: Duration) {
    if let Ok(mut guard) = RUNTIME_CHILD.lock() {
        if let Some(runtime) = guard.as_mut().filter(|runtime| runtime.root == root) {
            runtime.started_at = Instant::now().checked_sub(age).unwrap_or_else(Instant::now);
        }
    }
}

#[cfg(test)]
pub(super) fn age_ready_health_failure_for_tests(root: &Path, age: Duration) {
    if let Ok(mut guard) = RUNTIME_CHILD.lock() {
        if let Some(runtime) = guard.as_mut().filter(|runtime| runtime.root == root) {
            runtime.health_failure_started_at = Instant::now().checked_sub(age);
        }
    }
}

#[cfg(test)]
pub(super) fn terminate_tracked_child_for_tests(root: &Path) {
    if let Ok(mut guard) = RUNTIME_CHILD.lock() {
        if let Some(runtime) = guard.as_mut().filter(|runtime| runtime.root == root) {
            let _ = runtime.child.kill();
            let _ = runtime.child.wait();
        }
    }
}

#[cfg(test)]
pub(super) fn tracked_child_model_id_for_tests(root: &Path) -> Option<&'static str> {
    RUNTIME_CHILD
        .lock()
        .ok()?
        .as_ref()
        .filter(|runtime| runtime.root == root)
        .map(|runtime| runtime.model_id)
}

fn runtime_listener_pids() -> Result<Vec<u32>, ManagedAiError> {
    #[cfg(test)]
    if let Some(pids) = TEST_RUNTIME_LISTENER_PIDS.with(|current| current.borrow().clone()) {
        return Ok(pids);
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
        unix_listener_pids_for_port(RUNTIME_PORT)
    }
}

#[cfg(not(windows))]
fn unix_listener_pids_for_port(port: &str) -> Result<Vec<u32>, ManagedAiError> {
    let output = match Command::new("lsof")
        .arg("-nP")
        .arg(format!("-iTCP:{port}"))
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
        let Some(actual) = unix_process_executable_path(pid)? else {
            return Ok(false);
        };
        let actual = fs::canonicalize(&actual).unwrap_or(actual);
        let expected = fs::canonicalize(expected).unwrap_or_else(|_| expected.to_path_buf());
        Ok(actual == expected)
    }
}

#[cfg(target_os = "macos")]
fn unix_process_executable_path(pid: u32) -> Result<Option<std::path::PathBuf>, ManagedAiError> {
    use std::os::unix::ffi::OsStringExt;

    #[link(name = "proc")]
    extern "C" {
        fn proc_pidpath(pid: i32, buffer: *mut std::ffi::c_void, buffer_size: u32) -> i32;
    }

    const PROC_PIDPATHINFO_MAXSIZE: usize = 4096;
    let mut buffer = vec![0_u8; PROC_PIDPATHINFO_MAXSIZE];
    let length =
        unsafe { proc_pidpath(pid as i32, buffer.as_mut_ptr().cast(), buffer.len() as u32) };
    if length <= 0 {
        return Ok(None);
    }
    buffer.truncate(length as usize);
    if let Some(nul) = buffer.iter().position(|byte| *byte == 0) {
        buffer.truncate(nul);
    }
    Ok(Some(std::path::PathBuf::from(
        std::ffi::OsString::from_vec(buffer),
    )))
}

#[cfg(target_os = "linux")]
fn unix_process_executable_path(pid: u32) -> Result<Option<std::path::PathBuf>, ManagedAiError> {
    match fs::read_link(format!("/proc/{pid}/exe")) {
        Ok(path) => Ok(Some(path)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(ManagedAiError::RuntimeFailed(error.to_string())),
    }
}

#[cfg(all(not(windows), not(target_os = "macos"), not(target_os = "linux")))]
fn unix_process_executable_path(pid: u32) -> Result<Option<std::path::PathBuf>, ManagedAiError> {
    let output = Command::new("ps")
        .arg("-p")
        .arg(pid.to_string())
        .arg("-o")
        .arg("comm=")
        .output()
        .map_err(|error| ManagedAiError::RuntimeFailed(error.to_string()))?;
    if !output.status.success() {
        return Ok(None);
    }
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok((!path.is_empty()).then(|| std::path::PathBuf::from(path)))
}

#[cfg(windows)]
fn kill_process(pid: u32, expected: &Path) -> Result<(), ManagedAiError> {
    windows_kill_process(pid, expected)
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
    let log_path = log_dir.join(RUNTIME_LOG_FILE_NAME);
    // Log retention must never become a new reason the runtime cannot start.
    // If another process still has the previous file open (notably on
    // Windows), keep appending and try the bounded rotation again next start.
    let _ = rotate_runtime_log_if_needed(&log_path);
    let log_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)?;
    let stderr = log_file.try_clone()?;

    #[cfg(all(test, unix))]
    let mut command = runtime_command_for_tests(runtime_path);
    #[cfg(not(all(test, unix)))]
    let mut command = Command::new(runtime_path);
    let model_location = runtime_model_location(model_path);
    command
        .args(runtime_args(model_location.argument, spec))
        .stdin(Stdio::null())
        .stdout(Stdio::from(log_file))
        .stderr(Stdio::from(stderr));
    if let Some(directory) = model_location.current_dir {
        command.current_dir(directory);
    }
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

#[cfg(all(test, unix))]
fn runtime_command_for_tests(runtime_path: &Path) -> Command {
    // Executing a freshly-written script directly makes macOS route the test
    // fixture through Gatekeeper. On a loaded shared QA host that assessment
    // can stall before the script's interpreter starts, producing a false
    // runtime-start timeout. Production and native-binary test paths still
    // execute the runtime itself; only the Unix shell fixtures use /bin/sh.
    let is_shell_fixture = (|| -> std::io::Result<bool> {
        use std::io::Read;

        let mut file = fs::File::open(runtime_path)?;
        let mut prefix = [0_u8; 9];
        let read = file.read(&mut prefix)?;
        Ok(prefix[..read].starts_with(b"#!/bin/sh"))
    })()
    .unwrap_or(false);

    if is_shell_fixture {
        let mut command = Command::new("/bin/sh");
        command.arg(runtime_path);
        command
    } else {
        Command::new(runtime_path)
    }
}

fn rotate_runtime_log_if_needed(log_path: &Path) -> Result<(), ManagedAiError> {
    let Ok(metadata) = fs::metadata(log_path) else {
        return Ok(());
    };
    if metadata.len() < RUNTIME_LOG_MAX_BYTES {
        return Ok(());
    }
    let previous_path = log_path.with_file_name(PREVIOUS_RUNTIME_LOG_FILE_NAME);
    if previous_path.exists() {
        fs::remove_file(&previous_path)?;
    }
    fs::rename(log_path, previous_path)?;
    Ok(())
}

fn stop_child_in_guard(
    guard: &mut MutexGuard<'_, Option<ManagedRuntimeChild>>,
) -> Result<(), ManagedAiError> {
    if let Some(mut runtime) = guard.take() {
        if runtime.child.try_wait()?.is_none() {
            runtime.child.kill()?;
        }
        let _status = runtime.child.wait()?;
    }
    Ok(())
}

fn runtime_guard() -> Result<MutexGuard<'static, Option<ManagedRuntimeChild>>, ManagedAiError> {
    RUNTIME_CHILD
        .lock()
        .map_err(|error| ManagedAiError::RuntimeFailed(error.to_string()))
}

#[cfg(test)]
mod process_tests {
    use super::*;

    #[cfg(not(windows))]
    #[test]
    fn an_exited_child_pid_is_never_treated_as_a_live_tracked_listener() {
        let mut child = Command::new("/usr/bin/true")
            .spawn()
            .expect("spawn short-lived child");
        child.wait().expect("wait for child exit");

        assert_eq!(live_child_pid(&mut child).expect("inspect child"), None);
    }

    #[test]
    fn oversized_runtime_log_rotates_to_one_bounded_previous_file() {
        let root = tempfile::tempdir().expect("create log root");
        let log_path = root.path().join(RUNTIME_LOG_FILE_NAME);
        let previous_path = root.path().join(PREVIOUS_RUNTIME_LOG_FILE_NAME);
        let file = fs::File::create(&log_path).expect("create current log");
        file.set_len(RUNTIME_LOG_MAX_BYTES)
            .expect("size current log");
        fs::write(&previous_path, b"older log").expect("write old previous log");

        rotate_runtime_log_if_needed(&log_path).expect("rotate log");

        assert!(!log_path.exists());
        assert_eq!(
            fs::metadata(previous_path).expect("rotated metadata").len(),
            RUNTIME_LOG_MAX_BYTES
        );
    }

    #[cfg(unix)]
    #[test]
    fn shell_runtime_fixture_uses_the_system_shell_without_changing_native_paths() {
        let root = tempfile::tempdir().expect("create runtime root");
        let script = root.path().join("llama-server-script");
        fs::write(&script, b"#!/bin/sh\nexit 0\n").expect("write shell fixture");

        let shell_command = runtime_command_for_tests(&script);
        assert_eq!(shell_command.get_program(), "/bin/sh");
        assert_eq!(shell_command.get_args().next(), Some(script.as_os_str()));

        let native_command = runtime_command_for_tests(Path::new("/bin/sleep"));
        assert_eq!(native_command.get_program(), "/bin/sleep");
        assert!(native_command.get_args().next().is_none());
    }

    #[cfg(not(windows))]
    #[test]
    fn unix_process_identity_uses_the_exact_executable_path() {
        let current_exe = std::env::current_exe().expect("current executable");
        assert!(process_executable_matches(std::process::id(), &current_exe)
            .expect("query current executable"));
        assert!(!process_executable_matches(
            std::process::id(),
            &current_exe.with_file_name("llama-server-lookalike"),
        )
        .expect("reject different executable"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn unix_listener_discovery_finds_the_current_process_on_an_ephemeral_port() {
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).expect("bind listener");
        let port = listener.local_addr().expect("listener address").port();

        let pids = unix_listener_pids_for_port(&port.to_string()).expect("read listener owners");

        assert!(pids.contains(&std::process::id()));
    }

    #[cfg(not(windows))]
    #[test]
    fn an_untracked_exact_runtime_executable_is_a_conflict_and_is_never_killed() {
        let root = tempfile::tempdir().expect("create process root");
        let expected = root.path().join("runtime").join("llama-server");
        fs::create_dir_all(expected.parent().expect("runtime parent")).expect("create runtime dir");
        fs::copy("/bin/sleep", &expected).expect("copy native executable");
        let mut untracked = Command::new(&expected)
            .arg("30")
            .spawn()
            .expect("spawn untracked exact runtime");
        let _listeners = override_runtime_listener_pids_for_tests(Some(vec![untracked.id()]));

        let result = prepare_runtime_port(&expected);

        assert!(matches!(
            result,
            Err(ManagedAiError::RuntimePortConflict(_))
        ));
        assert!(matches!(untracked.try_wait(), Ok(None)));
        let _ = untracked.kill();
        let _ = untracked.wait();
    }
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
