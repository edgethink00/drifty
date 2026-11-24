//! Experimental prepared protocol. Native helpers must explicitly implement
//! --worker-v1; a legacy helper is refused, with no automatic fallback.
use super::*;
use crate::process::session::Session;
use std::{sync::Mutex, time::Duration};

const MAX_JOBS: u8 = 8;
const MAX_IDLE: Duration = Duration::from_secs(60);
struct Worker {
    process: Session,
    mode: u8,
    jobs: u8,
    last_used: Instant,
}

pub struct PreparedNativeHelperBackend {
    resource: NativeHelperBackend,
    worker: Mutex<Option<Worker>>,
    version: u32,
}
impl PreparedNativeHelperBackend {
    pub fn from_app_resource(path: &Path) -> Result<Self, crate::Error> {
        Ok(Self {
            resource: NativeHelperBackend::from_app_resource(path)?,
            worker: Mutex::new(None),
            version: NATIVE_PROTOCOL_VERSION,
        })
    }
    /// Explicit v2 selection. There is no negotiation/downgrade to the
    /// OCR-only v1 helper when this fixed resource lacks source-aware support.
    pub fn from_source_resource(path: &Path) -> Result<Self, crate::Error> {
        let mut backend = Self::from_app_resource(path)?;
        backend.version = SOURCE_PROTOCOL_VERSION;
        Ok(backend)
    }
    /// Explicit v3 selection through the trusted native factory. A missing v3
    /// resource is refused; no readiness/result downgrade is attempted.
    pub fn from_activity_resource(path: &Path) -> Result<Self, crate::Error> {
        let mut backend = Self::from_app_resource(path)?;
        backend.version = ACTIVITY_PROTOCOL_VERSION;
        Ok(backend)
    }
    pub fn require_document(mut self, fingerprint: String) -> Result<Self, crate::Error> {
        self.resource = self.resource.require_document(fingerprint)?;
        Ok(self)
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

impl CaptureBackend for PreparedNativeHelperBackend {
    fn needs_idle_preparation(&self) -> bool {
        self.worker
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .as_ref()
            .is_some_and(|worker| worker.jobs >= MAX_JOBS)
    }

    fn prepare(
        &self,
        policy: &CapturePolicy,
        cancellation: &Cancellation,
    ) -> Result<(), CaptureFailure> {
        if self.version == NATIVE_PROTOCOL_VERSION && policy.visible_text_enabled {
            self.reset();
            return Err(CaptureFailure::Unsupported);
        }
        if cancellation.is_cancelled() {
            return Err(CaptureFailure::Cancelled);
        }
        let mode = u8::from(policy.ocr_enabled) | (u8::from(policy.visible_text_enabled) << 1);
        let mut slot = self.worker.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(worker) = slot.as_mut() {
            if worker.mode == mode
                && worker.jobs < MAX_JOBS
                && worker.last_used.elapsed() < MAX_IDLE
                && worker.process.alive().map_err(failure)?
            {
                return Ok(());
            }
        }
        *slot = None;
        let mut command = Command::new(&self.resource.executable);
        if self.version == NATIVE_PROTOCOL_VERSION {
            command.args([
                "--worker-v1",
                "--ocr",
                if policy.ocr_enabled { "on" } else { "off" },
            ]);
        } else {
            let text_mode = match mode {
                0 => "off",
                1 => "ocr",
                2 => "accessibility",
                _ => "accessibility-or-ocr",
            };
            command.arg(format!("--worker-v{}", self.version));
            command.args(["--text", text_mode]);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command
                .creation_flags(0x08000000)
                .env("OMP_THREAD_LIMIT", "2")
                .env("OMP_NUM_THREADS", "2");
        }
        let mut process = Session::spawn(&mut command).map_err(failure)?;
        let ready = process
            .read(4, cancellation.deadline(), &|| cancellation.is_cancelled())
            .map_err(failure)?;
        if ready.as_slice()
            != if self.version == NATIVE_PROTOCOL_VERSION {
                b"RDY1"
            } else if self.version == SOURCE_PROTOCOL_VERSION {
                b"RDY2"
            } else {
                b"RDY3"
            }
        {
            return Err(CaptureFailure::Invalidated);
        }
        process.boundary().map_err(failure)?;
        if cancellation.is_cancelled() {
            return Err(CaptureFailure::Cancelled);
        }
        *slot = Some(Worker {
            process,
            mode,
            jobs: 0,
            last_used: Instant::now(),
        });
        Ok(())
    }

    fn reset(&self) {
        *self.worker.lock().unwrap_or_else(|p| p.into_inner()) = None;
    }

    fn capture(
        &self,
        policy: &CapturePolicy,
        cancellation: &Cancellation,
    ) -> Result<NativeCapture, CaptureFailure> {
        if self.version == NATIVE_PROTOCOL_VERSION && policy.visible_text_enabled {
            self.reset();
            return Err(CaptureFailure::Unsupported);
        }
        let mut worker = self
            .worker
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .take()
            .ok_or(CaptureFailure::Unavailable)?;
        if cancellation.is_cancelled()
            || worker.mode
                != u8::from(policy.ocr_enabled) | (u8::from(policy.visible_text_enabled) << 1)
            || worker.jobs >= MAX_JOBS
        {
            return Err(CaptureFailure::Cancelled);
        }
        let result = transact(
            &mut worker.process,
            &self.resource,
            self.version,
            policy,
            cancellation,
        )?;
        if cancellation.is_cancelled() {
            return Err(CaptureFailure::Cancelled);
        }
        worker.jobs += 1;
        worker.last_used = Instant::now();
        *self.worker.lock().unwrap_or_else(|p| p.into_inner()) = Some(worker);
        Ok(result)
    }
}

fn transact(
    process: &mut Session,
    resource: &NativeHelperBackend,
    version: u32,
    policy: &CapturePolicy,
    cancellation: &Cancellation,
) -> Result<NativeCapture, CaptureFailure> {
    let deadline = cancellation.deadline();
    let cancelled = || cancellation.is_cancelled();
    process.boundary().map_err(failure)?;
    if cancelled() {
        return Err(CaptureFailure::Cancelled);
    }
    let request = Uuid::new_v4();
    let mut command = if version == NATIVE_PROTOCOL_VERSION {
        b"JOB1"
    } else if version == SOURCE_PROTOCOL_VERSION {
        b"JOB2"
    } else {
        b"JOB3"
    }
    .to_vec();
    command.extend_from_slice(request.to_string().as_bytes());
    command.push(u8::from(policy.ocr_enabled) | (u8::from(policy.visible_text_enabled) << 1));
    process.send(&command).map_err(failure)?;
    let header = process.packet(deadline, &cancelled).map_err(failure)?;
    if let Ok(refused) = serde_json::from_slice::<NativeRefusal>(&header) {
        if refused.protocol_version != version || refused.request_id != request {
            return Err(CaptureFailure::Invalidated);
        }
        return Err(refused.refusal.failure());
    }
    let (preflight, activity_hint) = if version == ACTIVITY_PROTOCOL_VERSION {
        let parsed: NativeActivityPreflight =
            serde_json::from_slice(&header).map_err(|_| CaptureFailure::Invalidated)?;
        (
            NativePreflight {
                protocol_version: parsed.protocol_version,
                request_id: parsed.request_id,
                facts: parsed.facts,
            },
            Some(parsed.activity_hint),
        )
    } else {
        (
            serde_json::from_slice::<NativePreflight>(&header)
                .map_err(|_| CaptureFailure::Invalidated)?,
            None,
        )
    };
    if preflight.protocol_version != version || preflight.request_id != request {
        return Err(CaptureFailure::Invalidated);
    }
    if !preflight.facts.permission {
        return Err(CaptureFailure::Permission);
    }
    let title = activity_hint.as_ref().and_then(|h| h.window_title_digest.as_ref());
    let ordinary = policy.admits(&preflight.facts);
    let site_admitted = !ordinary && policy.admits_browser(&preflight.facts, title, &|| !cancelled());
    if !(ordinary || site_admitted)
        || resource
            .required_document
            .as_ref()
            .is_some_and(|d| d != &preflight.facts.identity.document_id)
    {
        return Err(CaptureFailure::Excluded);
    }
    process.boundary().map_err(failure)?; // No pixels before GO.
    if cancelled() {
        return Err(CaptureFailure::Cancelled);
    }
    process.grant().map_err(failure)?;
    let header = process.packet(deadline, &cancelled).map_err(failure)?;
    if let Ok(refused) = serde_json::from_slice::<NativeRefusal>(&header) {
        if refused.protocol_version != version || refused.request_id != request {
            return Err(CaptureFailure::Invalidated);
        }
        return Err(refused.refusal.failure());
    }
    let (result_request, frame_bytes) = if version == NATIVE_PROTOCOL_VERSION {
        let parsed: NativeResult =
            serde_json::from_slice(&header).map_err(|_| CaptureFailure::Invalidated)?;
        (parsed.request_id, parsed.frame.png_bytes)
    } else if version == ACTIVITY_PROTOCOL_VERSION {
        let parsed: NativeActivityResult =
            serde_json::from_slice(&header).map_err(|_| CaptureFailure::Invalidated)?;
        (parsed.request_id, parsed.frame.png_bytes)
    } else {
        let parsed: NativeTextResult =
            serde_json::from_slice(&header).map_err(|_| CaptureFailure::Invalidated)?;
        (parsed.request_id, parsed.frame.png_bytes)
    };
    if result_request != request || frame_bytes == 0 || frame_bytes > MAX_FRAME_BYTES {
        return Err(CaptureFailure::Invalidated);
    }
    let pixels = process
        .read(frame_bytes, deadline, &cancelled)
        .map_err(failure)?;
    let done = process.read(40, deadline, &cancelled).map_err(failure)?;
    let end = if version == NATIVE_PROTOCOL_VERSION {
        b"END1"
    } else if version == SOURCE_PROTOCOL_VERSION {
        b"END2"
    } else {
        b"END3"
    };
    if done[..4] != *end || done[4..] != *request.to_string().as_bytes() {
        return Err(CaptureFailure::Invalidated);
    }
    process.boundary().map_err(failure)?;
    process.complete();
    let mut bytes = Zeroizing::new(Vec::with_capacity(4 + header.len() + pixels.len()));
    bytes.extend_from_slice(&(header.len() as u32).to_be_bytes());
    bytes.extend_from_slice(&header);
    bytes.extend_from_slice(&pixels);
    // The tab may have navigated during capture. Re-confirm the site before
    // the result can be accepted; the helper already proved equal facts/title.
    if site_admitted
        && !policy.admits_browser(&preflight.facts, title, &|| !cancelled())
    {
        return Err(CaptureFailure::Excluded);
    }
    if let Some(hint) = activity_hint {
        activity::decode_activity_result(&mut bytes.as_slice(), &preflight, &hint, policy, site_admitted)
    } else {
        decode_result(&mut bytes.as_slice(), &preflight, policy)
    }
}
