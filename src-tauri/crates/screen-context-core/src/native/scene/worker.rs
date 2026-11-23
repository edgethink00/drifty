//! Bounded scene helper session. Ready processes hold no admission between jobs.
use super::*;
use crate::process::session::Session;
use std::time::Duration;

const MAX_JOBS: u8 = 8;
const MAX_IDLE: Duration = Duration::from_secs(60);

pub(super) struct Prepared {
    process: Session,
    jobs: u8,
    last_used: Instant,
}

impl Prepared {
    pub(super) fn start(path: &Path, cancel: &Cancellation) -> Result<Self, CaptureFailure> {
        if cancel.is_cancelled() {
            return Err(CaptureFailure::Cancelled);
        }
        let mut process =
            Session::spawn(Command::new(path).arg("--scene-worker-v4")).map_err(failure)?;
        let ready = process
            .read(4, cancel.deadline(), &|| cancel.is_cancelled())
            .map_err(failure)?;
        if ready.as_slice() != b"RDY4" {
            return Err(CaptureFailure::Invalidated);
        }
        process.boundary().map_err(failure)?;
        Ok(Self {
            process,
            jobs: 0,
            last_used: Instant::now(),
        })
    }

    pub(super) fn reusable(&mut self) -> bool {
        self.jobs < MAX_JOBS
            && self.last_used.elapsed() < MAX_IDLE
            && self.process.alive().unwrap_or(false)
    }

    pub(super) fn capture(
        &mut self,
        policy: &CapturePolicy,
        cancel: &Cancellation,
    ) -> Result<NativeSceneCapture, CaptureFailure> {
        let deadline = cancel.deadline();
        let cancelled = || cancel.is_cancelled();
        self.process.boundary().map_err(failure)?;
        check_deadline(cancel)?;
        let request = Uuid::new_v4();
        let uuid = request.to_string();
        let mut job = [0; 41];
        job[..4].copy_from_slice(b"JOB4");
        job[4..40].copy_from_slice(uuid.as_bytes());
        self.process.send(&job).map_err(failure)?;

        let bytes = self.process.packet(deadline, &cancelled).map_err(failure)?;
        self.process.boundary().map_err(failure)?;
        let preflight = admit_preflight(&bytes, request, policy)?;
        check_deadline(cancel)?;
        self.process.send(&[1]).map_err(failure)?;

        let header = self.process.packet(deadline, &cancelled).map_err(failure)?;
        if let Some(refusal) = decode_refusal(&header, request) {
            self.process.boundary().map_err(failure)?;
            return Err(refusal);
        }
        let result = decode_result_header(&header, &preflight, policy)?;
        let pixels = self
            .process
            .read(result.frame.png_bytes, deadline, &cancelled)
            .map_err(failure)?;
        let end = self
            .process
            .read(40, deadline, &cancelled)
            .map_err(failure)?;
        if end[..4] != *b"END4" || end[4..] != *uuid.as_bytes() {
            return Err(CaptureFailure::Invalidated);
        }
        self.process.boundary().map_err(failure)?;
        let capture = decode_frame(result, &pixels, &preflight)?;
        check_deadline(cancel)?;
        self.jobs += 1;
        self.last_used = Instant::now();
        Ok(capture)
    }
}

fn check_deadline(cancel: &Cancellation) -> Result<(), CaptureFailure> {
    if Instant::now() >= cancel.deadline() {
        Err(CaptureFailure::Deadline)
    } else if cancel.is_cancelled() {
        Err(CaptureFailure::Cancelled)
    } else {
        Ok(())
    }
}

fn failure(error: io::Error) -> CaptureFailure {
    match error.kind() {
        io::ErrorKind::TimedOut => CaptureFailure::Deadline,
        io::ErrorKind::Interrupted => CaptureFailure::Cancelled,
        io::ErrorKind::InvalidData | io::ErrorKind::UnexpectedEof => CaptureFailure::Invalidated,
        _ => CaptureFailure::Unavailable,
    }
}
