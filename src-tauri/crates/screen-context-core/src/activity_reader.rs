//! Dedicated optional local reader. It never shares the ordinary tracker serve
//! mutex, starts a daemon, mutates tracking or falls back to another runtime.
use crate::{
    native::WindowTitleDigest, process::session::Session, Error, LocalActivityRecordRef,
    MAX_ACTIVITY_REFS,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeSet,
    ffi::OsString,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};
use uuid::Uuid;
use zeroize::Zeroizing;

pub const ACTIVITY_LOOKUP_DEADLINE: Duration = Duration::from_millis(200);
pub const ACTIVITY_READER_PREPARATION: Duration = Duration::from_secs(2);
const MAX_REQUEST_BYTES: usize = 2048;
const MAX_IDLE: Duration = Duration::from_secs(90);

#[derive(Clone)]
pub struct CapturedActivityHint {
    pub app_key: String,
    pub title_digest: WindowTitleDigest,
    pub observed_at_ms: i64,
}
impl std::fmt::Debug for CapturedActivityHint {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("CapturedActivityHint([redacted])")
    }
}
impl Drop for CapturedActivityHint {
    fn drop(&mut self) {
        use zeroize::Zeroize;
        self.app_key.zeroize();
    }
}

pub trait ActivityResolver: Send + Sync + 'static {
    fn resolve_capture(
        &self,
        hint: &CapturedActivityHint,
        current: &dyn Fn() -> bool,
    ) -> Result<Option<LocalActivityRecordRef>, Error>;
    fn read_current(
        &self,
        ids: &[String],
        current: &dyn Fn() -> bool,
    ) -> Result<Vec<LocalActivityRecordRef>, Error>;
    fn reset(&self);
    fn maintain_idle(&self) {}
}

struct Worker {
    process: Session,
    jobs: u8,
    last_used: Instant,
}
pub struct NativeActivityReader {
    executable: PathBuf,
    base_args: Vec<OsString>,
    database: PathBuf,
    producer_runtime: Option<PathBuf>,
    worker: Mutex<Option<Worker>>,
    fence: AtomicU64,
    closed: AtomicBool,
}
fn trusted_file(path: &Path) -> Result<PathBuf, Error> {
    if !path.is_absolute() {
        return Err(Error::Invalid("activity reader resource"));
    }
    let path = path.canonicalize()?;
    let m = std::fs::symlink_metadata(&path)?;
    if !m.is_file() || m.file_type().is_symlink() {
        return Err(Error::Invalid("activity reader resource"));
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if m.file_attributes() & 0x400 != 0 {
            return Err(Error::Invalid("activity reader resource"));
        }
    }
    Ok(path)
}
impl NativeActivityReader {
    /// Build a separate explicit preparer from these same native-selected
    /// resources. Merely constructing either object starts no child or DB.
    pub fn preparation(&self) -> crate::NativeActivityPreparer {
        crate::NativeActivityPreparer {
            executable: self.executable.clone(),
            base_args: self.base_args.clone(),
            database: self.database.clone(),
            producer_runtime: self.producer_runtime.clone(),
            busy: Mutex::new(()),
        }
    }
    /// Native app resource resolution supplies these paths. No WebView/provider
    /// may select an executable, source script, DB path, mode or argument list.
    pub fn from_packaged_runtime(executable: &Path, database: &Path) -> Result<Self, Error> {
        Self::new(executable, Vec::new(), database)
    }
    /// A dedicated installed onedir helper uses the selected tracker executable
    /// for producer compatibility. It never substitutes its own binary digest.
    pub fn from_packaged_activity_helper(
        helper: &Path,
        producer: &Path,
        database: &Path,
    ) -> Result<Self, Error> {
        let mut reader = Self::new(helper, Vec::new(), database)?;
        let producer = trusted_file(producer)?;
        // Rust canonicalization adds a Windows verbatim prefix. The frozen
        // producer fingerprints its ordinary executable spelling, so passing
        // that prefix to the separate preparer would reject the same file.
        // Simplify only when safe, after the existing native resource checks.
        #[cfg(windows)]
        let producer = dunce::simplified(&producer).to_path_buf();
        reader.producer_runtime = Some(producer);
        Ok(reader)
    }
    /// Development/isolated QA only; production keeps its packaged runtime.
    pub fn from_source_runtime(
        python: &Path,
        main_script: &Path,
        database: &Path,
    ) -> Result<Self, Error> {
        Self::new(
            python,
            vec!["-I".into(), trusted_file(main_script)?.into_os_string()],
            database,
        )
    }
    fn new(executable: &Path, base_args: Vec<OsString>, database: &Path) -> Result<Self, Error> {
        if !database.is_absolute() {
            return Err(Error::Invalid("activity reader database"));
        }
        Ok(Self {
            executable: trusted_file(executable)?,
            base_args,
            database: database.to_owned(),
            producer_runtime: None,
            worker: Mutex::new(None),
            fence: AtomicU64::new(0),
            closed: AtomicBool::new(false),
        })
    }
    fn request(
        &self,
        operation: Operation<'_>,
        current: &dyn Fn() -> bool,
    ) -> Result<Vec<LocalActivityRecordRef>, Error> {
        let epoch = self.fence.load(Ordering::Acquire);
        let current = || {
            current()
                && !self.closed.load(Ordering::Acquire)
                && epoch == self.fence.load(Ordering::Acquire)
        };
        if !current() {
            return Err(Error::Invalidated);
        }
        // One optional in-flight query. Contention returns no optional work;
        // ordinary capture/tracker callers never wait behind this mutex.
        let mut slot = self
            .worker
            .try_lock()
            .map_err(|_| Error::WorkerUnavailable)?;
        let request_id = Uuid::new_v4();
        let request = Request {
            protocol_version: 2,
            request_id,
            operation,
        };
        let bytes = Zeroizing::new(
            serde_json::to_vec(&request).map_err(|_| Error::Invalid("activity reader request"))?,
        );
        if bytes.len() > MAX_REQUEST_BYTES {
            return Err(Error::Invalid("activity reader request"));
        }
        let mut packet = Zeroizing::new((bytes.len() as u32).to_be_bytes().to_vec());
        packet.extend_from_slice(&bytes);
        let mut worker = slot.take().filter(|w| {
            w.jobs < 64 && w.last_used.elapsed() < MAX_IDLE && w.process.can_send(packet.len())
        });
        let cancelled = || !current();
        if worker
            .as_mut()
            .is_some_and(|w| !w.process.alive().unwrap_or(false))
        {
            worker = None;
        }
        if worker.is_none() {
            if !current() {
                return Err(Error::Invalidated);
            }
            let mut command = Command::new(&self.executable);
            command
                .args(&self.base_args)
                .arg("screen-context-activity-reader-v2")
                .arg("--db")
                .arg(&self.database);
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                command.creation_flags(0x08000000);
            }
            let mut process = Session::spawn_activity_reader(&mut command)
                .map_err(|_| Error::WorkerUnavailable)?;
            let ready = process
                .read(4, Instant::now() + ACTIVITY_READER_PREPARATION, &cancelled)
                .map_err(|_| Error::WorkerUnavailable)?;
            if ready.as_slice() != b"SBR2" {
                return Err(Error::Invalidated);
            }
            process.boundary().map_err(|_| Error::Invalidated)?;
            worker = Some(Worker {
                process,
                jobs: 0,
                last_used: Instant::now(),
            });
        }
        let mut worker = worker.expect("prepared reader");
        let deadline = Instant::now() + ACTIVITY_LOOKUP_DEADLINE;
        worker.process.boundary().map_err(|_| Error::Invalidated)?;
        if !current() {
            return Err(Error::Invalidated);
        }
        worker
            .process
            .send(&packet)
            .map_err(|_| Error::WorkerUnavailable)?;
        let reply = worker
            .process
            .packet(deadline, &cancelled)
            .map_err(|_| Error::WorkerUnavailable)?;
        let parsed: Reply = serde_json::from_slice(&reply).map_err(|_| Error::Invalidated)?;
        if parsed.protocol_version != 2
            || parsed.request_id != request_id
            || parsed.records.len() > MAX_ACTIVITY_REFS
            || parsed.proof_version != 1
        {
            return Err(Error::Invalidated);
        }
        let footer = worker
            .process
            .read(40, deadline, &cancelled)
            .map_err(|_| Error::WorkerUnavailable)?;
        if &footer[..4] != b"SBE2" || footer[4..] != *request_id.to_string().as_bytes() {
            return Err(Error::Invalidated);
        }
        worker.process.boundary().map_err(|_| Error::Invalidated)?;
        let mut seen = BTreeSet::new();
        if parsed.records.iter().any(|r| !seen.insert(r.record_id())) || !current() {
            return Err(Error::Invalidated);
        }
        match &request.operation {
            Operation::Resolve { observed_at_ms, .. } => {
                if parsed.records.len() > 1
                    || parsed.records.iter().any(|r| !r.contains(*observed_at_ms))
                {
                    return Err(Error::Invalidated);
                }
            }
            Operation::Read { record_ids } => {
                let mut previous = None;
                if parsed.records.iter().any(|r| {
                    let index = record_ids.iter().position(|id| id == r.record_id());
                    let invalid = index.is_none()
                        || previous.is_some_and(|prior| index.is_some_and(|i| i <= prior));
                    previous = index;
                    invalid
                }) {
                    return Err(Error::Invalidated);
                }
            }
        }
        worker.jobs += 1;
        worker.last_used = Instant::now();
        *slot = Some(worker);
        Ok(parsed.records)
    }
}
impl ActivityResolver for NativeActivityReader {
    fn resolve_capture(
        &self,
        hint: &CapturedActivityHint,
        current: &dyn Fn() -> bool,
    ) -> Result<Option<LocalActivityRecordRef>, Error> {
        if hint.app_key.trim().is_empty()
            || hint.app_key.len() > 256
            || hint.app_key.chars().any(|c| c < ' ' || c == '\u{7f}')
            || hint.observed_at_ms < 0
        {
            return Err(Error::Invalid("activity reader hint"));
        }
        Ok(self
            .request(
                Operation::Resolve {
                    app_key: &hint.app_key,
                    title_digest: hint.title_digest.as_str(),
                    observed_at_ms: hint.observed_at_ms,
                },
                current,
            )?
            .pop())
    }
    fn read_current(
        &self,
        ids: &[String],
        current: &dyn Fn() -> bool,
    ) -> Result<Vec<LocalActivityRecordRef>, Error> {
        if ids.is_empty() || ids.len() > MAX_ACTIVITY_REFS {
            return Err(Error::Invalid("activity reader IDs"));
        }
        let mut seen = BTreeSet::new();
        if ids.iter().any(|id| {
            id.parse::<i64>()
                .ok()
                .is_none_or(|n| n <= 0 || n.to_string() != *id)
                || !seen.insert(id)
        }) {
            return Err(Error::Invalid("activity reader IDs"));
        }
        self.request(Operation::Read { record_ids: ids }, current)
    }
    fn reset(&self) {
        if self
            .fence
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |n| n.checked_add(1))
            .is_err()
        {
            self.closed.store(true, Ordering::Release);
        }
        if let Ok(mut slot) = self.worker.try_lock() {
            *slot = None;
        }
    }
    fn maintain_idle(&self) {
        if let Ok(mut slot) = self.worker.try_lock() {
            if slot
                .as_ref()
                .is_some_and(|w| w.last_used.elapsed() >= MAX_IDLE)
            {
                *slot = None;
            }
        }
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Request<'a> {
    protocol_version: u32,
    request_id: Uuid,
    operation: Operation<'a>,
}
#[derive(Serialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
enum Operation<'a> {
    Resolve {
        app_key: &'a str,
        title_digest: &'a str,
        observed_at_ms: i64,
    },
    Read {
        record_ids: &'a [String],
    },
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Reply {
    protocol_version: u32,
    proof_version: u8,
    request_id: Uuid,
    records: Vec<LocalActivityRecordRef>,
}
