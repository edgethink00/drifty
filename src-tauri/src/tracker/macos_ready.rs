//! Observe an already-started Mac worker without launching Python or opening
//! its database. The worker publishes this handshake only after DB preparation.
use std::{
    fs::{File, Metadata},
    io::{self, Read},
    os::{fd::AsRawFd, unix::fs::MetadataExt},
    path::{Path, PathBuf},
    process::Command,
    time::{Duration, Instant},
};

use serde::Deserialize;
use sha2::{Digest, Sha256};

use super::{TrackerError, TrackerRuntime, TrackerStatus};

const RECORD_LIMIT: u64 = 4096;
const POLL_INTERVAL: Duration = Duration::from_millis(100);

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Ready {
    pid: u32,
    birth: u64,
    parent_pid: u32,
    parent_birth: u64,
    fingerprint: String,
    start_token: Option<String>,
    database_path: PathBuf,
    database_device: u64,
    database_inode: u64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Pending {
    pid: u32,
    birth: u64,
    fingerprint: String,
    start_token: String,
}

#[derive(Clone)]
struct Snapshot {
    pid: u32,
    ready: Ready,
    pending: Option<Pending>,
}

struct ReadLock(File);
impl Drop for ReadLock {
    fn drop(&mut self) {
        unsafe {
            libc::flock(self.0.as_raw_fd(), libc::LOCK_UN);
        }
    }
}

fn failure(message: &str) -> TrackerError {
    TrackerError::CommandFailed(message.into())
}

fn small_file(path: &Path) -> Result<Vec<u8>, TrackerError> {
    let mut bytes = Vec::new();
    File::open(path)
        .and_then(|f| f.take(RECORD_LIMIT + 1).read_to_end(&mut bytes))
        .map_err(|_| failure("tracker readiness record unavailable"))?;
    if bytes.len() as u64 > RECORD_LIMIT {
        return Err(failure("tracker readiness record exceeded limit"));
    }
    Ok(bytes)
}

fn read_snapshot(db: &Path) -> Result<Option<Snapshot>, TrackerError> {
    let state = db
        .parent()
        .ok_or_else(|| failure("tracker database has no parent"))?
        .join(".state");
    let file = match File::open(state.join("tracker.pid.lock")) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(failure("tracker readiness lock unavailable")),
    };
    if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_SH | libc::LOCK_NB) } != 0 {
        return if io::Error::last_os_error().kind() == io::ErrorKind::WouldBlock {
            Ok(None)
        } else {
            Err(failure("tracker readiness lock unavailable"))
        };
    }
    let _lock = ReadLock(file);
    let ready_path = state.join("tracker.ready.json");
    if !ready_path.exists() || !state.join("tracker.pid").exists() {
        return Ok(None);
    }
    let pid = String::from_utf8(small_file(&state.join("tracker.pid"))?)
        .ok()
        .and_then(|raw| raw.trim().parse::<u32>().ok());
    let ready = serde_json::from_slice::<Ready>(&small_file(&ready_path)?).ok();
    let (Some(pid), Some(ready)) = (pid, ready) else {
        return Ok(None);
    };
    let pending_path = state.join("tracker.start.json");
    let pending = if pending_path.exists() {
        Some(
            serde_json::from_slice(&small_file(&pending_path)?)
                .map_err(|_| failure("invalid tracker start record"))?,
        )
    } else {
        None
    };
    Ok(Some(Snapshot {
        pid,
        ready,
        pending,
    }))
}

fn identity(pid: u32) -> Result<(u64, u32), TrackerError> {
    if pid == 0 || pid > i32::MAX as u32 {
        return Err(failure("invalid tracker process identity"));
    }
    let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of_val(&info) as i32;
    let read = unsafe {
        libc::proc_pidinfo(
            pid as i32,
            libc::PROC_PIDTBSDINFO,
            0,
            &mut info as *mut _ as *mut libc::c_void,
            size,
        )
    };
    if read != size
        || info.pbi_pid != pid
        || info.pbi_flags & 4 != 0
        || info.pbi_start_tvusec >= 1_000_000
    {
        return Err(failure("tracker process identity unavailable"));
    }
    let birth = info
        .pbi_start_tvsec
        .checked_mul(1_000_000)
        .and_then(|seconds| seconds.checked_add(info.pbi_start_tvusec))
        .filter(|birth| *birth > 0)
        .ok_or_else(|| failure("invalid tracker process birth time"))?;
    Ok((birth, info.pbi_ppid))
}

fn file_identity(metadata: &Metadata) -> (u64, u64, u64, i64, i64) {
    (
        metadata.dev(),
        metadata.ino(),
        metadata.len(),
        metadata.mtime(),
        metadata.mtime_nsec(),
    )
}

fn hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn namespace_command(command: &str, db: &Path) -> bool {
    let suffix = format!(" daemon --db {}", db.to_string_lossy());
    let Some(prefix) = command.strip_suffix(&suffix) else {
        return false;
    };
    let name = Path::new(prefix)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");
    name == "drifty-tracker"
        || name.starts_with("drifty-tracker-")
        || (prefix.ends_with("/services/tracker-python/app/main.py")
            && prefix
                .split_whitespace()
                .next()
                .is_some_and(|exe| exe.to_ascii_lowercase().contains("python")))
}

fn verified(
    snapshot: &Snapshot,
    executable: &Path,
    db: &Path,
    canonical_db: &Path,
    fingerprint: &str,
    processes: &[(u32, String)],
    mut native_identity: impl FnMut(u32) -> Result<(u64, u32), TrackerError>,
) -> bool {
    let ready = &snapshot.ready;
    if snapshot.pid != ready.pid
        || ready.pid == 0
        || ready.parent_pid == 0
        || ready.birth == 0
        || ready.parent_birth == 0
        || ready.parent_birth > ready.birth
        || ready.database_path != canonical_db
        || !hex(&ready.fingerprint, 64)
        || ready.fingerprint != fingerprint
    {
        return false;
    }
    if native_identity(ready.pid).ok() != Some((ready.birth, ready.parent_pid))
        || native_identity(ready.parent_pid)
            .ok()
            .map(|(birth, _)| birth)
            != Some(ready.parent_birth)
    {
        return false;
    }
    match (&snapshot.pending, &ready.start_token) {
        (Some(pending), Some(token))
            if hex(token, 32)
                && pending.start_token == *token
                && pending.fingerprint == fingerprint
                && ((pending.pid, pending.birth) == (ready.pid, ready.birth)
                    || (pending.pid, pending.birth) == (ready.parent_pid, ready.parent_birth)) => {}
        (None, None) => {} // A directly launched standalone daemon has no Start token.
        _ => return false,
    }
    let mut matching: Vec<_> = processes
        .iter()
        .filter(|(_, command)| namespace_command(command, db))
        .collect();
    let child_command = matching
        .iter()
        .find(|(pid, _)| *pid == ready.pid)
        .map(|(_, command)| command.as_str());
    if child_command
        != Some(format!("{} daemon --db {}", executable.display(), db.display()).as_str())
    {
        return false;
    }
    // Only this worker's verified, same-command parent can be a onefile supervisor.
    matching.retain(|(pid, command)| {
        *pid != ready.parent_pid || Some(command.as_str()) != child_command
    });
    matching.len() == 1
        && matching[0].0 == ready.pid
        && native_identity(ready.pid).ok() == Some((ready.birth, ready.parent_pid))
}

fn poll<F: FnMut() -> bool>(
    deadline: Instant,
    mut continue_read: F,
    mut read: impl FnMut(&mut F, Duration) -> Result<Option<TrackerStatus>, TrackerError>,
) -> Result<TrackerStatus, TrackerError> {
    loop {
        if !continue_read() {
            return Err(super::superseded_start_error());
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(failure("tracker readiness was not confirmed"));
        }
        let status = read(&mut continue_read, remaining)?;
        if !continue_read() {
            return Err(super::superseded_start_error());
        }
        if let Some(status) = status {
            return Ok(status);
        }
        std::thread::sleep(POLL_INTERVAL.min(deadline.saturating_duration_since(Instant::now())));
    }
}

pub(super) fn wait(
    runtime: &TrackerRuntime,
    db: &Path,
    budget: Duration,
    mut continue_read: impl FnMut() -> bool,
) -> Result<TrackerStatus, TrackerError> {
    let deadline = Instant::now() + budget;
    if !continue_read() {
        return Err(super::superseded_start_error());
    }
    let executable = runtime
        .executable_path
        .canonicalize()
        .map_err(|_| failure("tracker executable unavailable"))?;
    let canonical_db = db
        .canonicalize()
        .map_err(|_| failure("tracker database unavailable"))?;
    let mut file =
        File::open(&executable).map_err(|_| failure("tracker executable unavailable"))?;
    let original_file = file_identity(
        &file
            .metadata()
            .map_err(|_| failure("tracker executable metadata unavailable"))?,
    );
    let mut digest = Sha256::new();
    digest.update(b"frozen\0");
    digest.update(executable.to_string_lossy().as_bytes());
    digest.update(b"\0");
    let mut buffer = [0; 64 * 1024];
    loop {
        if !continue_read() {
            return Err(super::superseded_start_error());
        }
        if Instant::now() >= deadline {
            return Err(failure("tracker identity read exceeded recovery budget"));
        }
        let count = file
            .read(&mut buffer)
            .map_err(|_| failure("tracker executable unreadable"))?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    let fingerprint = format!("{:x}", digest.finalize());
    poll(deadline, continue_read, |continue_read, remaining| {
        let Some(snapshot) = read_snapshot(db)? else {
            return Ok(None);
        };
        let mut command = Command::new("/bin/ps");
        command.args(["-axww", "-o", "pid=", "-o", "command="]);
        let output = crate::bounded_process::output_cancellable(
            &mut command,
            remaining.min(Duration::from_secs(1)),
            &mut *continue_read,
        )
        .map_err(|error| {
            if error.kind() == io::ErrorKind::Interrupted {
                super::superseded_start_error()
            } else {
                failure("tracker process inspection unavailable")
            }
        })?;
        if !output.status.success() {
            return Err(failure("tracker process inspection failed"));
        }
        let table = String::from_utf8(output.stdout)
            .map_err(|_| failure("invalid tracker process table"))?;
        let processes: Vec<_> = table
            .lines()
            .filter_map(|line| {
                let line = line.trim();
                let split = line.find(char::is_whitespace)?;
                Some((
                    line[..split].parse::<u32>().ok()?,
                    line[split..].trim().to_string(),
                ))
            })
            .collect();
        if !verified(
            &snapshot,
            &runtime.executable_path,
            db,
            &canonical_db,
            &fingerprint,
            &processes,
            identity,
        ) {
            return Ok(None);
        }
        let unchanged = executable.metadata().ok().map(|m| file_identity(&m))
            == Some(original_file)
            && db.canonicalize().ok().as_deref() == Some(canonical_db.as_path());
        if !unchanged {
            return Err(failure(
                "tracker runtime or database changed during readiness observation",
            ));
        }
        let db_identity = db.metadata().ok().map(|m| (m.dev(), m.ino()));
        if db_identity
            != Some((
                snapshot.ready.database_device,
                snapshot.ready.database_inode,
            ))
        {
            return Err(failure(
                "tracker database file changed after readiness publication",
            ));
        }
        Ok(Some(TrackerStatus {
            running: true,
            tracking_paused: false,
            accessibility_granted: super::merged_accessibility_granted(
                false,
                super::current_process_accessibility_trusted(),
            ),
            last_event_at: None,
            database_path: Some(db.to_string_lossy().into_owned()),
            tracker_mode: None,
            idle_seconds: None,
            idle_detection_available: None,
            storage_free_bytes: None,
            capture_health: None,
            capture_failure_reason: None,
            status_issue: None,
            message: Some("Tracker running.".into()),
        }))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };

    fn snapshot() -> Snapshot {
        Snapshot {
            pid: 2002,
            ready: Ready {
                pid: 2002,
                birth: 222,
                parent_pid: 2001,
                parent_birth: 111,
                fingerprint: "a".repeat(64),
                start_token: Some("b".repeat(32)),
                database_path: PathBuf::from("/task/tracker.sqlite3"),
                database_device: 1,
                database_inode: 2,
            },
            pending: Some(Pending {
                pid: 2002,
                birth: 222,
                fingerprint: "a".repeat(64),
                start_token: "b".repeat(32),
            }),
        }
    }

    fn native(pid: u32) -> Result<(u64, u32), TrackerError> {
        match pid {
            2001 => Ok((111, 100)),
            2002 => Ok((222, 2001)),
            _ => Err(failure("not live")),
        }
    }

    fn check(snapshot: &Snapshot, processes: &[(u32, String)]) -> bool {
        verified(
            snapshot,
            Path::new("/App/drifty-tracker"),
            Path::new("/task/tracker.sqlite3"),
            Path::new("/task/tracker.sqlite3"),
            &"a".repeat(64),
            processes,
            native,
        )
    }

    fn command(exe: &str, db: &str) -> String {
        format!("{exe} daemon --db {db}")
    }

    #[test]
    fn ready_requires_exact_runtime_database_and_live_generation() {
        let processes = [(
            2002,
            command("/App/drifty-tracker", "/task/tracker.sqlite3"),
        )];
        assert!(check(&snapshot(), &processes));
        for field in [
            "pid",
            "birth",
            "parent",
            "parentBirth",
            "database",
            "fingerprint",
            "token",
            "pendingBirth",
            "pendingFingerprint",
        ] {
            let mut value = snapshot();
            match field {
                "pid" => value.pid = 999,
                "birth" => value.ready.birth = 999,
                "parent" => value.ready.parent_pid = 999,
                "parentBirth" => value.ready.parent_birth = 999,
                "database" => value.ready.database_path = PathBuf::from("/other/tracker.sqlite3"),
                "fingerprint" => value.ready.fingerprint = "c".repeat(64),
                "token" => value.pending.as_mut().unwrap().start_token = "c".repeat(32),
                "pendingBirth" => value.pending.as_mut().unwrap().birth = 999,
                "pendingFingerprint" => {
                    value.pending.as_mut().unwrap().fingerprint = "c".repeat(64)
                }
                _ => unreachable!(),
            }
            assert!(!check(&value, &processes), "must reject {field}");
        }
        assert!(!check(
            &snapshot(),
            &[(
                2002,
                command("/Old/drifty-tracker", "/task/tracker.sqlite3")
            )]
        ));
        assert!(!check(
            &snapshot(),
            &[(
                2002,
                command("/App/drifty-tracker", "/other/tracker.sqlite3")
            )]
        ));
        assert!(!verified(
            &snapshot(),
            Path::new("/App/drifty-tracker"),
            Path::new("/task/tracker.sqlite3"),
            Path::new("/task/tracker.sqlite3"),
            &"a".repeat(64),
            &processes,
            |_| Err(failure("unreadable"))
        ));
    }

    #[test]
    fn only_verified_same_command_supervisor_can_collapse() {
        let cmd = command("/App/drifty-tracker", "/task/tracker.sqlite3");
        let mut pair = vec![(2001, cmd.clone()), (2002, cmd.clone())];
        let mut value = snapshot();
        value.pending.as_mut().unwrap().pid = 2001;
        value.pending.as_mut().unwrap().birth = 111;
        assert!(check(&value, &pair));
        pair.push((
            3002,
            command("/Old/drifty-tracker", "/task/tracker.sqlite3"),
        ));
        assert!(!check(&value, &pair));
        pair.pop();
        pair.push((
            3002,
            command(
                "/usr/bin/python3 /repo/services/tracker-python/app/main.py",
                "/task/tracker.sqlite3",
            ),
        ));
        assert!(!check(&value, &pair));
        pair.pop();
        pair.push((
            3002,
            command("/App/drifty-tracker", "/other/tracker.sqlite3"),
        ));
        assert!(check(&value, &pair));
    }

    #[test]
    fn missing_or_contended_records_never_create_or_write_state() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("tracker.sqlite3");
        assert!(read_snapshot(&db).unwrap().is_none());
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
        let state = dir.path().join(".state");
        std::fs::create_dir(&state).unwrap();
        let lock = File::create(state.join("tracker.pid.lock")).unwrap();
        assert_eq!(
            unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) },
            0
        );
        let started = Instant::now();
        assert!(read_snapshot(&db).unwrap().is_none());
        assert!(started.elapsed() < Duration::from_millis(250));
        assert_eq!(std::fs::read_dir(&state).unwrap().count(), 1);
        unsafe {
            libc::flock(lock.as_raw_fd(), libc::LOCK_UN);
        }
        std::fs::write(state.join("tracker.pid"), "2002").unwrap();
        std::fs::write(state.join("tracker.ready.json"), "x".repeat(4097)).unwrap();
        assert!(read_snapshot(&db).is_err());
        assert_eq!(
            std::fs::read(state.join("tracker.ready.json"))
                .unwrap()
                .len(),
            4097
        );
    }

    fn running() -> TrackerStatus {
        TrackerStatus {
            running: true,
            tracking_paused: false,
            accessibility_granted: false,
            last_event_at: None,
            database_path: None,
            tracker_mode: None,
            idle_seconds: None,
            idle_detection_available: None,
            storage_free_bytes: None,
            capture_health: None,
            capture_failure_reason: None,
            status_issue: None,
            message: None,
        }
    }

    #[test]
    fn late_ready_succeeds_without_replaying_start_or_waiting_for_full_budget() {
        let started = Instant::now();
        let mut reads = 0;
        let result = poll(
            started + Duration::from_secs(10),
            || true,
            |_, _| {
                reads += 1;
                Ok((reads == 3).then(running))
            },
        )
        .unwrap();
        assert!(result.running);
        assert_eq!(reads, 3);
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn pause_during_stalled_process_inspection_releases_control_promptly() {
        let current = Arc::new(AtomicBool::new(true));
        let cancel = Arc::clone(&current);
        let thread = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(50));
            cancel.store(false, Ordering::SeqCst);
        });
        let started = Instant::now();
        let result = poll(
            started + Duration::from_secs(10),
            || current.load(Ordering::SeqCst),
            |continue_read, remaining| {
                let mut command = Command::new("/bin/sleep");
                command.arg("5");
                crate::bounded_process::output_cancellable(&mut command, remaining, continue_read)
                    .map(|_| Some(running()))
                    .map_err(|_| super::super::superseded_start_error())
            },
        );
        thread.join().unwrap();
        assert!(result.is_err());
        assert!(started.elapsed() < Duration::from_millis(500));
    }

    #[test]
    fn cancelled_or_expired_observation_never_reads_or_accepts_status() {
        assert!(poll(
            Instant::now() + Duration::from_secs(1),
            || false,
            |_, _| panic!("cancelled read must not run")
        )
        .is_err());
        assert!(poll(
            Instant::now(),
            || true,
            |_, _| panic!("expired read must not run")
        )
        .is_err());
    }

    struct LiveChild(std::process::Child);
    impl Drop for LiveChild {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }

    /// Run explicitly in a task-owned Mac guest, against that build's bundled
    /// onefile sidecar. Ordinary unit tests never launch a real activity daemon.
    #[test]
    #[ignore = "requires disposable Mac guest and DRIFTY_PACKAGED_TRACKER_QA"]
    fn packaged_worker_recovers_delayed_readiness_and_cancels_observation() {
        use super::super::{
            invoke_one_shot_with_timeout, serve_request, SidecarCommandRetrySafety,
        };
        use std::{io::Write, process::Stdio};

        struct Fixture(TrackerRuntime, PathBuf);
        impl Drop for Fixture {
            fn drop(&mut self) {
                let _ = invoke_one_shot_with_timeout(
                    &self.0,
                    &self.1,
                    &serde_json::json!({"command":"stop_tracking", "payload":{}}),
                    Duration::from_secs(10),
                );
            }
        }
        let executable = PathBuf::from(
            std::env::var_os("DRIFTY_PACKAGED_TRACKER_QA").expect("explicit guest sidecar path"),
        );
        let dir = tempfile::Builder::new()
            .prefix("drifty packaged ready ")
            .tempdir()
            .unwrap();
        let db = dir.path().join("tracker.sqlite3");
        let runtime = TrackerRuntime::packaged_sidecar(executable);
        let _cleanup = Fixture(runtime.clone(), db.clone());
        let rpc = |name: &str| {
            let raw = serve_request(
                &runtime,
                &db,
                &serde_json::json!({"command":name, "payload":{}}),
                SidecarCommandRetrySafety::Mutation,
            )
            .expect("packaged serve round trip");
            serde_json::from_str::<serde_json::Value>(&raw).unwrap()
        };
        let stop = || {
            let value = rpc("stop_tracking");
            assert_eq!(value["ok"], true, "{value}");
            assert_eq!(value["data"]["running"], false, "{value}");
        };
        let delayed_writer = |name: &str| {
            let marker = dir.path().join(name);
            let mut child = LiveChild(
                Command::new("/usr/bin/sqlite3")
                    .arg(&db)
                    .stdin(Stdio::piped())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .spawn()
                    .unwrap(),
            );
            write!(
                child.0.stdin.take().unwrap(),
                "BEGIN IMMEDIATE;\n.shell touch '{}'\n.shell sleep 5\nCOMMIT;\n.quit\n",
                marker.display()
            )
            .unwrap();
            let deadline = Instant::now() + Duration::from_secs(2);
            while !marker.exists() {
                assert!(
                    Instant::now() < deadline,
                    "SQLite writer did not acquire its lock"
                );
                std::thread::sleep(Duration::from_millis(10));
            }
            child
        };

        rpc("start_tracking");
        assert!(
            wait(&runtime, &db, Duration::from_secs(10), || true)
                .unwrap()
                .running
        );
        stop();

        let mut writer = delayed_writer("delayed-ready");
        let reply = rpc("start_tracking");
        assert_eq!(
            reply["ok"], false,
            "delay must exercise Start recovery: {reply}"
        );
        let started = Instant::now();
        assert!(
            wait(&runtime, &db, Duration::from_secs(10), || true)
                .unwrap()
                .running
        );
        println!(
            "packaged_delayed_recovery_ms={}",
            started.elapsed().as_millis()
        );
        assert!(writer.0.wait().unwrap().success());

        let replacement_dir = dir.path().join("replacement");
        std::fs::create_dir(&replacement_dir).unwrap();
        let replacement = replacement_dir.join("drifty-tracker");
        std::fs::copy(&runtime.executable_path, &replacement).unwrap();
        assert!(wait(
            &TrackerRuntime::packaged_sidecar(replacement),
            &db,
            Duration::from_millis(500),
            || true
        )
        .is_err());
        stop();

        let mut writer = delayed_writer("cancel-ready");
        assert_eq!(rpc("start_tracking")["ok"], false);
        let started = Instant::now();
        let result = wait(&runtime, &db, Duration::from_secs(10), || {
            started.elapsed() < Duration::from_millis(100)
        });
        assert!(result.is_err());
        assert!(started.elapsed() < Duration::from_secs(1));
        println!("packaged_cancel_ms={}", started.elapsed().as_millis());
        stop();
        assert!(writer.0.wait().unwrap().success());
        assert!(read_snapshot(&db).unwrap().is_none());
    }

    #[test]
    fn real_native_observation_uses_no_python_or_sqlite_and_rejects_replaced_db() {
        use std::process::Stdio;
        let dir = tempfile::tempdir().unwrap();
        let executable = dir.path().join("drifty-tracker");
        // A task-owned helper stays asleep and accepts the real daemon argv.
        // It never captures activity, opens SQLite, or launches an app.
        let source = dir.path().join("fixture.c");
        std::fs::write(
            &source,
            "#include <unistd.h>\nint main(void) { for (;;) pause(); }\n",
        )
        .unwrap();
        let compiled = Command::new("/usr/bin/clang")
            .arg(&source)
            .arg("-o")
            .arg(&executable)
            .output()
            .unwrap();
        assert!(
            compiled.status.success(),
            "fixture compile failed: {}",
            String::from_utf8_lossy(&compiled.stderr)
        );
        let db = dir.path().join("tracker.sqlite3");
        std::fs::write(&db, b"sentinel: SQLite must never be opened").unwrap();
        let child = LiveChild(
            Command::new(&executable)
                .arg("daemon")
                .arg("--db")
                .arg(&db)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .unwrap(),
        );
        // Publish readiness only after exec, as the real Python daemon does.
        // A post-spawn PID can still describe the fork/exec transition.
        let expected = format!("{} daemon --db {}", executable.display(), db.display());
        let admission = Instant::now() + Duration::from_secs(1);
        loop {
            let output = Command::new("/bin/ps")
                .args(["-p", &child.0.id().to_string(), "-o", "command="])
                .output()
                .unwrap();
            if String::from_utf8_lossy(&output.stdout).trim() == expected {
                break;
            }
            assert!(
                Instant::now() < admission,
                "fixture did not exec its expected command: {}",
                String::from_utf8_lossy(&output.stdout)
            );
            std::thread::sleep(Duration::from_millis(5));
        }
        let (birth, parent) = identity(child.0.id()).unwrap();
        let (parent_birth, _) = identity(parent).unwrap();
        let canonical_exe = executable.canonicalize().unwrap();
        let mut digest = Sha256::new();
        digest.update(b"frozen\0");
        digest.update(canonical_exe.to_string_lossy().as_bytes());
        digest.update(b"\0");
        digest.update(std::fs::read(&executable).unwrap());
        let fingerprint = format!("{:x}", digest.finalize());
        let state = dir.path().join(".state");
        std::fs::create_dir(&state).unwrap();
        File::create(state.join("tracker.pid.lock")).unwrap();
        std::fs::write(state.join("tracker.pid"), child.0.id().to_string()).unwrap();
        let db_meta = db.metadata().unwrap();
        let ready = serde_json::json!({ "pid": child.0.id(), "birth": birth, "parentPid": parent,
            "parentBirth": parent_birth, "fingerprint": fingerprint, "startToken": null,
            "databasePath": db.canonicalize().unwrap(), "databaseDevice": db_meta.dev(), "databaseInode": db_meta.ino() });
        std::fs::write(state.join("tracker.ready.json"), ready.to_string()).unwrap();
        let runtime = TrackerRuntime::packaged_sidecar(executable);
        let started = Instant::now();
        assert!(
            wait(&runtime, &db, Duration::from_secs(2), || true)
                .unwrap()
                .running
        );
        assert!(started.elapsed() < Duration::from_secs(1));
        assert_eq!(
            std::fs::read(&db).unwrap(),
            b"sentinel: SQLite must never be opened"
        );
        let replacement = dir.path().join("replacement");
        std::fs::write(&replacement, "new database").unwrap();
        std::fs::rename(&replacement, &db).unwrap();
        assert!(wait(&runtime, &db, Duration::from_secs(1), || true).is_err());
    }
}
