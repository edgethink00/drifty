use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    thread,
    time::{Duration, Instant},
};

use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
use windows_sys::core::BOOL;
use windows_sys::Win32::{
    Foundation::{CloseHandle, HANDLE, HWND, LPARAM, WAIT_OBJECT_0},
    Storage::Packaging::Appx::GetApplicationUserModelId,
    System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, TerminateProcess, WaitForSingleObject,
        PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE,
    },
    UI::WindowsAndMessaging::{EnumWindows, GetWindowThreadProcessId, PostMessageW, WM_CLOSE},
};

use super::ExtremeNudgeError;

const SYNCHRONIZE_ACCESS: u32 = 0x0010_0000;
const GRACEFUL_WAIT: Duration = Duration::from_millis(800);
const FORCE_WAIT: Duration = Duration::from_millis(250);
const POLL_INTERVAL: Duration = Duration::from_millis(25);
const SYSTEM32_MARKER: &str = r"\windows\system32\";
const SYSTEM32_ALLOWLIST: &[&str] = &["notepad.exe", "mspaint.exe", "calc.exe", "charmap.exe"];
const PROTECTED_EXE_NAMES: &[&str] = &[
    "drifty.exe",
    "explorer.exe",
    "winlogon.exe",
    "csrss.exe",
    "dwm.exe",
    "svchost.exe",
    "lsass.exe",
    "services.exe",
    "smss.exe",
    "wininit.exe",
    "systemsettings.exe",
];
const PROTECTED_AUMID_FRAGMENTS: &[&str] = &[
    "windows.immersivecontrolpanel",
    "shellexperiencehost",
    "startmenuexperiencehost",
];

pub(super) fn is_protected_identity(identity: &str) -> bool {
    let key = normalize_identity(identity);
    if key.is_empty() {
        return true;
    }
    if PROTECTED_AUMID_FRAGMENTS
        .iter()
        .any(|fragment| key.contains(fragment))
    {
        return true;
    }
    let exe_name = key.rsplit('\\').next().unwrap_or(&key);
    if PROTECTED_EXE_NAMES.contains(&exe_name) {
        return true;
    }
    if key.contains(SYSTEM32_MARKER) && !SYSTEM32_ALLOWLIST.contains(&exe_name) {
        return true;
    }
    std::env::current_exe()
        .ok()
        .is_some_and(|current| normalize_path(&current) == key)
}

pub(super) fn terminate_app_by_identity(identity: &str) -> Result<(), ExtremeNudgeError> {
    if is_protected_identity(identity) {
        return Err(ExtremeNudgeError::ProtectedBundle(identity.to_string()));
    }
    let target = normalize_identity(identity);
    let target_is_aumid = is_aumid(&target);
    let excluded = self_and_ancestor_pids();
    let mut system = System::new();
    system.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet),
    );

    let access = PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE | SYNCHRONIZE_ACCESS;
    let mut processes = Vec::new();
    for pid in system.processes().keys().map(|pid| pid.as_u32()) {
        if excluded.contains(&pid) {
            continue;
        }
        let Some(process) = WindowsTargetProcess::open(pid, access) else {
            continue;
        };
        if process.matches_identity(&target, target_is_aumid) {
            processes.push(process);
        }
    }
    if processes.is_empty() {
        return Err(ExtremeNudgeError::AppNotRunning(identity.to_string()));
    }

    let pids = processes
        .iter()
        .map(|process| process.pid)
        .collect::<HashSet<_>>();
    post_close_to_top_level_windows(&pids);
    wait_until_exit(&processes, GRACEFUL_WAIT);
    let survivors = processes
        .iter()
        .filter(|process| !process.has_exited())
        .collect::<Vec<_>>();
    if survivors.is_empty() {
        return Ok(());
    }

    for process in &survivors {
        if unsafe { TerminateProcess(process.handle, 1) } == 0 {
            return Err(ExtremeNudgeError::AppTerminateFailed(identity.to_string()));
        }
    }
    wait_until_exit(&processes, FORCE_WAIT);
    if processes.iter().all(WindowsTargetProcess::has_exited) {
        Ok(())
    } else {
        Err(ExtremeNudgeError::AppTerminateFailed(identity.to_string()))
    }
}

fn self_and_ancestor_pids() -> HashSet<u32> {
    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::All, true);
    let mut protected = HashSet::new();
    let mut cursor = Some(sysinfo::Pid::from_u32(std::process::id()));
    while let Some(pid) = cursor {
        if !protected.insert(pid.as_u32()) {
            break;
        }
        cursor = system.process(pid).and_then(|process| process.parent());
    }
    protected
}

fn wait_until_exit(processes: &[WindowsTargetProcess], timeout: Duration) {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if processes.iter().all(WindowsTargetProcess::has_exited) {
            return;
        }
        thread::sleep(POLL_INTERVAL);
    }
}

fn post_close_to_top_level_windows(pids: &HashSet<u32>) {
    unsafe extern "system" fn visit_window(hwnd: HWND, state: LPARAM) -> BOOL {
        let pids = &*(state as *const HashSet<u32>);
        let mut pid = 0_u32;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pids.contains(&pid) {
            let _ = PostMessageW(hwnd, WM_CLOSE, 0, 0);
        }
        1
    }

    unsafe {
        let _ = EnumWindows(Some(visit_window), pids as *const HashSet<u32> as LPARAM);
    }
}

struct WindowsTargetProcess {
    pid: u32,
    handle: HANDLE,
}

impl WindowsTargetProcess {
    fn open(pid: u32, access: u32) -> Option<Self> {
        let handle = unsafe { OpenProcess(access, 0, pid) };
        (!handle.is_null()).then_some(Self { pid, handle })
    }

    fn executable_path(&self) -> Option<PathBuf> {
        let mut buffer = vec![0_u16; 32_768];
        let mut length = buffer.len() as u32;
        if unsafe { QueryFullProcessImageNameW(self.handle, 0, buffer.as_mut_ptr(), &mut length) }
            == 0
        {
            return None;
        }
        buffer.truncate(length as usize);
        Some(PathBuf::from(String::from_utf16_lossy(&buffer)))
    }

    fn aumid(&self) -> Option<String> {
        let mut buffer = vec![0_u16; 1024];
        let mut length = buffer.len() as u32;
        if unsafe { GetApplicationUserModelId(self.handle, &mut length, buffer.as_mut_ptr()) } != 0
        {
            return None;
        }
        let used = length.saturating_sub(1) as usize;
        buffer.truncate(used.min(buffer.len()));
        Some(String::from_utf16_lossy(&buffer))
    }

    fn matches_identity(&self, target: &str, target_is_aumid: bool) -> bool {
        if target_is_aumid {
            return self
                .aumid()
                .is_some_and(|aumid| normalize_identity(&aumid) == target);
        }
        self.executable_path()
            .is_some_and(|path| normalize_path(&path) == target)
    }

    fn has_exited(&self) -> bool {
        unsafe { WaitForSingleObject(self.handle, 0) == WAIT_OBJECT_0 }
    }
}

impl Drop for WindowsTargetProcess {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.handle);
        }
    }
}

fn is_aumid(identity: &str) -> bool {
    identity.contains('!') && !identity.contains('\\')
}

fn normalize_identity(identity: &str) -> String {
    identity.trim().replace('/', "\\").to_ascii_lowercase()
}

fn normalize_path(path: &Path) -> String {
    std::fs::canonicalize(path)
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .replace('/', "\\")
        .trim_start_matches(r"\\?\")
        .to_ascii_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        os::windows::process::CommandExt,
        process::{Child, Command},
    };

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    struct ChildCleanup(Child);

    impl Drop for ChildCleanup {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }

    #[test]
    fn protects_shell_system_and_drifty_targets() {
        assert!(is_protected_identity(r"C:\Program Files\Drifty\drifty.exe"));
        assert!(is_protected_identity(r"C:\Windows\explorer.exe"));
        assert!(is_protected_identity(r"C:\Windows\System32\cmd.exe"));
        assert!(is_protected_identity(
            "Microsoft.Windows.ImmersiveControlPanel_8wekyb3d8bbwe!App"
        ));
    }

    #[test]
    fn allows_normal_apps_and_explicit_system32_utilities() {
        assert!(!is_protected_identity(r"C:\Windows\System32\notepad.exe"));
        assert!(!is_protected_identity(r"C:\Apps\Editor\editor.exe"));
    }

    #[test]
    fn current_process_is_always_protected() {
        let current = std::env::current_exe().expect("current exe");
        assert!(is_protected_identity(&current.to_string_lossy()));
    }

    #[test]
    fn terminates_only_the_exact_executable_path() {
        let system_root = std::env::var_os("SystemRoot").expect("SystemRoot");
        let ping = PathBuf::from(system_root).join("System32").join("ping.exe");
        let temp = tempfile::tempdir().expect("tempdir");
        let target_dir = temp.path().join("target");
        let bystander_dir = temp.path().join("bystander");
        std::fs::create_dir_all(&target_dir).expect("target dir");
        std::fs::create_dir_all(&bystander_dir).expect("bystander dir");
        let target_path = target_dir.join("same-name.exe");
        let bystander_path = bystander_dir.join("same-name.exe");
        std::fs::copy(&ping, &target_path).expect("copy target executable");
        std::fs::copy(&ping, &bystander_path).expect("copy bystander executable");

        let mut target = ChildCleanup(
            Command::new(&target_path)
                .args(["-n", "30", "127.0.0.1"])
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .expect("spawn target"),
        );
        let mut bystander = ChildCleanup(
            Command::new(&bystander_path)
                .args(["-n", "30", "127.0.0.1"])
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .expect("spawn bystander"),
        );
        thread::sleep(Duration::from_millis(100));

        terminate_app_by_identity(&target_path.to_string_lossy()).expect("terminate exact target");

        assert!(target.0.try_wait().expect("target status").is_some());
        assert!(
            bystander.0.try_wait().expect("bystander status").is_none(),
            "a same-named process at a different path must remain running"
        );
    }
}
