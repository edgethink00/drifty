//! Explicit native opt-in preparation, separate from read-only activity IPC.
//! The app must check account/consent and current producer before activation.
use crate::{process::session::Session, Error};
use std::{
    ffi::OsString,
    path::PathBuf,
    process::Command,
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ActivityPreparation {
    Ready,
    WriterNotReady,
    MissingDatabase,
    Unavailable,
}

pub struct NativeActivityPreparer {
    pub(crate) executable: PathBuf,
    pub(crate) base_args: Vec<OsString>,
    pub(crate) database: PathBuf,
    pub(crate) producer_runtime: Option<PathBuf>,
    pub(crate) busy: Mutex<()>,
}

impl NativeActivityPreparer {
    /// Only native configuration supplies this fixed runtime/DB. This never
    /// starts tracking, captures a screen or creates a missing activity DB.
    pub fn prepare(&self, current: &dyn Fn() -> bool) -> Result<ActivityPreparation, Error> {
        if !current() {
            return Err(Error::Invalidated);
        }
        let _busy = self.busy.try_lock().map_err(|_| Error::WorkerUnavailable)?;
        let mut command = Command::new(&self.executable);
        command
            .args(&self.base_args)
            .arg("screen-context-activity-prepare-v1")
            .arg("--db")
            .arg(&self.database);
        if let Some(producer) = &self.producer_runtime {
            command.arg("--producer-runtime").arg(producer);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let deadline = Instant::now() + crate::activity_reader::ACTIVITY_READER_PREPARATION;
        let mut process =
            Session::spawn_activity_reader(&mut command).map_err(|_| Error::WorkerUnavailable)?;
        process.finish_input();
        let cancelled = || !current();
        let reply = process
            .read(5, deadline, &cancelled)
            .map_err(|_| Error::WorkerUnavailable)?;
        let state = match reply.as_slice() {
            b"SBP1\0" => ActivityPreparation::Ready,
            b"SBP1\x01" => ActivityPreparation::WriterNotReady,
            b"SBP1\x02" => ActivityPreparation::MissingDatabase,
            b"SBP1\x03" => ActivityPreparation::Unavailable,
            _ => return Err(Error::Invalidated),
        };
        loop {
            if !current() {
                return Err(Error::Invalidated);
            }
            if Instant::now() >= deadline {
                return Err(Error::WorkerUnavailable);
            }
            match process
                .exit_success()
                .map_err(|_| Error::WorkerUnavailable)?
            {
                Some(true) => break,
                Some(false) => return Err(Error::WorkerUnavailable),
                None => thread::sleep(Duration::from_millis(2)),
            }
        }
        // Child exit and a clean boundary are required. A valid-looking
        // prefix followed by diagnostics/trailing bytes is never success.
        process.quiet_boundary().map_err(|_| Error::Invalidated)?;
        if !current() {
            return Err(Error::Invalidated);
        }
        Ok(state)
    }
}
