use std::{ffi::OsString, path::Path};
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

use super::{TrackerRuntime, TrackerRuntimeKind};

pub(super) fn daemon_matches(pid: u32, runtime: &TrackerRuntime, db: &Path) -> bool {
    let system_pid = Pid::from_u32(pid);
    let mut system = System::new();
    system.refresh_processes_specifics(
        ProcessesToUpdate::Some(&[system_pid]),
        true,
        ProcessRefreshKind::nothing().with_cmd(UpdateKind::OnlyIfNotSet),
    );
    system
        .process(system_pid)
        .is_some_and(|process| arguments_match(process.cmd(), runtime, db))
}

fn same_path(actual: &OsString, expected: &Path) -> bool {
    // Tauri canonicalizes its resource directory to \\?\C:\...; PyInstaller
    // reports sys.executable as C:\... when it starts the daemon. Simplify
    // only paths that are safe in both forms (not reserved names or devices).
    // Keep exact path identity rather than accepting an executable suffix.
    dunce::simplified(Path::new(actual)) == dunce::simplified(expected)
}

fn arguments_match(arguments: &[OsString], runtime: &TrackerRuntime, db: &Path) -> bool {
    let prefix_len = match runtime.kind {
        TrackerRuntimeKind::PackagedSidecar => {
            if arguments.len() != 4 || !same_path(&arguments[0], &runtime.executable_path) {
                return false;
            }
            1
        }
        TrackerRuntimeKind::SourcePython => {
            if arguments.len() != 5
                || runtime.base_args.len() != 1
                || !same_path(&arguments[1], Path::new(&runtime.base_args[0]))
            {
                return false;
            }
            2
        }
    };
    arguments[prefix_len] == "daemon"
        && arguments[prefix_len + 1] == "--db"
        && same_path(&arguments[prefix_len + 2], db)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn args(parts: &[&str]) -> Vec<OsString> {
        parts.iter().map(OsString::from).collect()
    }

    #[test]
    fn packaged_daemon_accepts_tauri_verbatim_paths_and_spaces() {
        let runtime = TrackerRuntime::packaged_sidecar(PathBuf::from(
            r"\\?\C:\Program Files\Drifty\drifty-tracker\drifty-tracker.exe",
        ));
        let db = Path::new(r"C:\Users\QA User\AppData\Local\Drifty\tracker.sqlite3");
        let arguments = args(&[
            r"C:\Program Files\Drifty\drifty-tracker\drifty-tracker.exe",
            "daemon",
            "--db",
            r"\\?\C:\Users\QA User\AppData\Local\Drifty\tracker.sqlite3",
        ]);
        assert!(arguments_match(&arguments, &runtime, db));
        let normal_runtime = TrackerRuntime::packaged_sidecar(PathBuf::from(&arguments[0]));
        let mut verbatim_exe = arguments.clone();
        verbatim_exe[0] = runtime.executable_path.as_os_str().into();
        assert!(arguments_match(&verbatim_exe, &normal_runtime, db));
    }

    #[test]
    fn packaged_daemon_rejects_other_executable_database_mode_and_extra_args() {
        let exe = r"C:\Drifty\drifty-tracker.exe";
        let runtime = TrackerRuntime::packaged_sidecar(PathBuf::from(exe));
        let db = Path::new(r"C:\QA\tracker.sqlite3");
        let valid = args(&[exe, "daemon", "--db", r"C:\QA\tracker.sqlite3"]);
        assert!(arguments_match(&valid, &runtime, db));
        for (index, replacement) in [
            (0, r"C:\Other\drifty-tracker.exe"),
            (0, r"C:\Other\prefixC:\Drifty\drifty-tracker.exe"),
            (1, "serve"),
            (2, "--other"),
            (3, r"C:\Other\tracker.sqlite3"),
        ] {
            let mut invalid = valid.clone();
            invalid[index] = replacement.into();
            assert!(!arguments_match(&invalid, &runtime, db));
        }
        let mut extra = valid.clone();
        extra.push("--extra".into());
        assert!(!arguments_match(&extra, &runtime, db));
        for length in 0..valid.len() {
            assert!(!arguments_match(&valid[..length], &runtime, db));
        }
    }

    #[test]
    fn source_daemon_matches_script_and_database_as_separate_arguments() {
        let runtime = TrackerRuntime::source_python(
            PathBuf::from(r"C:\Python\python.exe"),
            PathBuf::from(r"\\?\C:\QA repo\app\main.py"),
        );
        let db = Path::new(r"C:\QA\tracker.sqlite3");
        let mut arguments = args(&[
            r"C:\Python\python.exe",
            r"C:\QA repo\app\main.py",
            "daemon",
            "--db",
            r"C:\QA\tracker.sqlite3",
        ]);
        assert!(arguments_match(&arguments, &runtime, db));
        arguments[1] = r"C:\Other\app\main.py".into();
        assert!(!arguments_match(&arguments, &runtime, db));
    }

    #[test]
    fn reserved_verbatim_paths_are_not_simplified_into_other_files() {
        assert!(!same_path(
            &OsString::from(r"\\?\C:\QA\CON"),
            Path::new(r"C:\QA\CON"),
        ));
    }
}
