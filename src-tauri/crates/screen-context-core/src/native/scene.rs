//! A distinct, parent-admitted scene protocol. No document or legacy fallback.
//! Native app resource routing qualifies the fixed helper; renderer input cannot select it.
use super::*;
use crate::{NativeSceneCapture, SceneCaptureFacts};

pub const SCENE_PROTOCOL_VERSION: u32 = 4;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeScenePreflight {
    pub protocol_version: u32,
    pub request_id: Uuid,
    pub facts: SceneCaptureFacts,
    pub activity_hint: NativeActivityObservation,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeSceneResult {
    pub protocol_version: u32,
    pub request_id: Uuid,
    pub before: SceneCaptureFacts,
    pub after: SceneCaptureFacts,
    pub activity_hint_before: NativeActivityObservation,
    pub activity_hint_after: NativeActivityObservation,
    pub observed_at_ms: i64,
    pub text_evidence: TextEvidence,
    pub frame: NativeFrameHeader,
}

pub struct NativeSceneHelperBackend {
    executable: PathBuf,
    deferred_ocr: bool,
    #[cfg(target_os = "macos")]
    ocr_worker: std::sync::Mutex<Option<ocr::Prepared>>,
    #[cfg(target_os = "macos")]
    scene_worker: Option<std::sync::Mutex<Option<worker::Prepared>>>,
}
impl NativeSceneHelperBackend {
    /// Only native resource resolution may call this. This is not a signature
    /// check and does not make an experimental helper safe for product capture.
    pub fn from_app_resource(path: &Path) -> Result<Self, crate::Error> {
        let validated = NativeHelperBackend::from_app_resource(path)?;
        Ok(Self {
            executable: validated.executable,
            deferred_ocr: false,
            #[cfg(target_os = "macos")]
            ocr_worker: std::sync::Mutex::new(None),
            #[cfg(target_os = "macos")]
            scene_worker: None,
        })
    }

    #[cfg(target_os = "macos")]
    pub fn check_capture_permissions(&self, cancel: &Cancellation) -> Result<(), CaptureFailure> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Capabilities {
            protocol_version: u32,
            screen_capture_granted: bool,
            accessibility_granted: bool,
        }

        // Use the same executable as capture so the OS checks the same
        // responsible app and code identity. This mode only reads TCC status.
        let output = process::output_cancellable(
            Command::new(&self.executable).arg("--capabilities"),
            cancel.deadline().saturating_duration_since(Instant::now()),
            || !cancel.is_cancelled(),
        )
        .map_err(|_| CaptureFailure::Unavailable)?;
        if !output.status.success() {
            return Err(CaptureFailure::Unavailable);
        }
        let status: Capabilities =
            serde_json::from_slice(&output.stdout).map_err(|_| CaptureFailure::Unavailable)?;
        match status {
            Capabilities {
                protocol_version, ..
            } if protocol_version != NATIVE_PROTOCOL_VERSION => Err(CaptureFailure::Unavailable),
            Capabilities {
                screen_capture_granted: false,
                ..
            } => Err(CaptureFailure::Permission),
            Capabilities {
                accessibility_granted: false,
                ..
            } => Err(CaptureFailure::AccessibilityPermission),
            _ => Ok(()),
        }
    }
}
impl NativeSceneHelperBackend {
    /// Native caller opts in only after the fixed helper's image-only OCR
    /// protocol is installed/qualified. This grants no provider consent.
    pub fn with_deferred_ocr(mut self) -> Self {
        self.deferred_ocr = true;
        self
    }

    /// Select the bundled scene worker only when the native caller owns the
    /// matching helper resource. Each frame still needs fresh parent admission.
    #[cfg(target_os = "macos")]
    pub fn with_scene_worker(mut self) -> Self {
        self.scene_worker = Some(std::sync::Mutex::new(None));
        self
    }
}
impl CaptureBackend for NativeSceneHelperBackend {
    fn prepare_scene_ocr(
        &self,
        policy: &CapturePolicy,
        cancel: &Cancellation,
    ) -> Result<(), CaptureFailure> {
        #[cfg(target_os = "macos")]
        {
            let mut slot = self.ocr_worker.lock().unwrap_or_else(|p| p.into_inner());
            if self.deferred_ocr && policy.ocr_enabled {
                if cancel.is_cancelled() {
                    *slot = None;
                    return Err(CaptureFailure::Cancelled);
                }
                if slot.as_mut().is_some_and(ocr::Prepared::reusable) {
                    return Ok(());
                }
                *slot = None;
                // Fixed synthetic warm-up only: no screen pixels before admission.
                // Optional OCR preparation failure must not suppress Replay.
                *slot = ocr::Prepared::start(&self.executable, cancel).ok();
            } else {
                *slot = None;
            }
        }
        #[cfg(not(target_os = "macos"))]
        let _ = policy;
        if cancel.is_cancelled() {
            Err(CaptureFailure::Cancelled)
        } else {
            Ok(())
        }
    }
    fn reset(&self) {
        #[cfg(target_os = "macos")]
        if let Some(worker) = &self.scene_worker {
            worker.lock().unwrap_or_else(|p| p.into_inner()).take();
        }
        self.reset_scene_ocr();
    }
    fn reset_scene_ocr(&self) {
        #[cfg(target_os = "macos")]
        self.ocr_worker
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .take();
    }
    fn capture(
        &self,
        _: &CapturePolicy,
        _: &Cancellation,
    ) -> Result<NativeCapture, CaptureFailure> {
        Err(CaptureFailure::Unsupported)
    }
    fn supports_deferred_scene_ocr(&self) -> bool {
        self.deferred_ocr && cfg!(target_os = "macos")
    }
    fn recognize_scene(
        &self,
        frame: &Frame,
        region: crate::SceneRegion,
        cancel: &Cancellation,
    ) -> Result<TextEvidence, CaptureFailure> {
        if !self.supports_deferred_scene_ocr() {
            return Err(CaptureFailure::Unsupported);
        }
        #[cfg(target_os = "macos")]
        {
            let mut slot = self.ocr_worker.lock().unwrap_or_else(|p| p.into_inner());
            let result = slot
                .as_mut()
                .ok_or(CaptureFailure::Unavailable)?
                .recognize(frame, region, cancel);
            if result.is_err()
                || cancel.is_cancelled()
                || !slot.as_mut().is_some_and(ocr::Prepared::reusable)
            {
                *slot = None;
            }
            result
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = (frame, region, cancel);
            Err(CaptureFailure::Unsupported)
        }
    }
    fn supports_scene_capture(&self) -> bool {
        true
    }
    fn capture_scene(
        &self,
        policy: &CapturePolicy,
        cancellation: &Cancellation,
    ) -> Result<NativeSceneCapture, CaptureFailure> {
        // This first bridge captures images only. OCR will enrich the exact
        // stored image separately; it must not extend the one-second capture gate.
        if (policy.ocr_enabled && !self.supports_deferred_scene_ocr())
            || policy.visible_text_enabled
        {
            return Err(CaptureFailure::Unsupported);
        }
        if cancellation.is_cancelled() {
            return Err(CaptureFailure::Cancelled);
        }
        #[cfg(target_os = "macos")]
        if let Some(worker) = &self.scene_worker {
            let mut slot = worker.lock().unwrap_or_else(|p| p.into_inner());
            let mut session = match slot.take() {
                Some(mut session) => {
                    if session.reusable() {
                        session
                    } else {
                        drop(session);
                        worker::Prepared::start(&self.executable, cancellation)?
                    }
                }
                None => worker::Prepared::start(&self.executable, cancellation)?,
            };
            let result = session.capture(policy, cancellation)?;
            if session.reusable() {
                *slot = Some(session);
            }
            return Ok(result);
        }
        let request_id = Uuid::new_v4();
        let mut command = Command::new(&self.executable);
        command.args(["--scene-protocol-v4", "--request", &request_id.to_string()]);
        let mut preflight: Option<NativeScenePreflight> = None;
        let mut rejection = CaptureFailure::Invalidated;
        let output = process::admitted_output(
            &mut command,
            cancellation
                .deadline()
                .saturating_duration_since(Instant::now()),
            8 + 2 * MAX_NATIVE_HEADER_BYTES + MAX_FRAME_BYTES,
            16 * 1024,
            &|| cancellation.is_cancelled(),
            &mut |bytes| match admit_preflight(bytes, request_id, policy) {
                Ok(packet) => {
                    preflight = Some(packet);
                    Ok(())
                }
                Err(error) => {
                    rejection = error;
                    Err(io::ErrorKind::PermissionDenied.into())
                }
            },
        )
        .map_err(|error| match error.kind() {
            io::ErrorKind::TimedOut => CaptureFailure::Deadline,
            io::ErrorKind::Interrupted => CaptureFailure::Cancelled,
            io::ErrorKind::PermissionDenied => rejection,
            io::ErrorKind::InvalidData | io::ErrorKind::UnexpectedEof => {
                CaptureFailure::Invalidated
            }
            _ => CaptureFailure::Unavailable,
        })?;
        let bytes = Zeroizing::new(output.stdout);
        let _diagnostics = Zeroizing::new(output.stderr);
        if !output.status.success() {
            return Err(CaptureFailure::Unavailable);
        }
        let preflight = preflight.ok_or(CaptureFailure::Invalidated)?;
        let mut remaining = bytes.as_slice();
        let echoed: NativeScenePreflight = serde_json::from_slice(packet(&mut remaining)?)
            .map_err(|_| CaptureFailure::Invalidated)?;
        if echoed.protocol_version != SCENE_PROTOCOL_VERSION
            || echoed.request_id != request_id
            || echoed.facts != preflight.facts
            || echoed.activity_hint != preflight.activity_hint
        {
            return Err(CaptureFailure::Invalidated);
        }
        let result = decode_result(&mut remaining, &preflight, policy)?;
        if cancellation.is_cancelled() {
            return Err(CaptureFailure::Cancelled);
        }
        Ok(result)
    }
}

fn admit_preflight(
    bytes: &[u8],
    request_id: Uuid,
    policy: &CapturePolicy,
) -> Result<NativeScenePreflight, CaptureFailure> {
    if let Some(refusal) = decode_refusal(bytes, request_id) {
        return Err(refusal);
    }
    let packet: NativeScenePreflight =
        serde_json::from_slice(bytes).map_err(|_| CaptureFailure::Invalidated)?;
    if packet.protocol_version != SCENE_PROTOCOL_VERSION || packet.request_id != request_id {
        return Err(CaptureFailure::Invalidated);
    }
    if !packet.facts.permission {
        return Err(CaptureFailure::Permission);
    }
    if !policy.admits_scene(&packet.facts) {
        return Err(CaptureFailure::Excluded);
    }
    Ok(packet)
}

fn decode_refusal(bytes: &[u8], request_id: Uuid) -> Option<CaptureFailure> {
    let refusal: NativeRefusal = serde_json::from_slice(bytes).ok()?;
    Some(
        if refusal.protocol_version == SCENE_PROTOCOL_VERSION && refusal.request_id == request_id {
            refusal.refusal.failure()
        } else {
            CaptureFailure::Invalidated
        },
    )
}

fn decode_result(
    remaining: &mut &[u8],
    preflight: &NativeScenePreflight,
    policy: &CapturePolicy,
) -> Result<NativeSceneCapture, CaptureFailure> {
    let header = packet(remaining)?;
    if let Some(refusal) = decode_refusal(header, preflight.request_id) {
        if !remaining.is_empty() {
            return Err(CaptureFailure::Invalidated);
        }
        return Err(refusal);
    }
    let result = decode_result_header(header, preflight, policy)?;
    let capture = decode_frame(result, remaining, preflight)?;
    *remaining = &[];
    Ok(capture)
}

fn decode_result_header(
    header: &[u8],
    preflight: &NativeScenePreflight,
    policy: &CapturePolicy,
) -> Result<NativeSceneResult, CaptureFailure> {
    let result: NativeSceneResult =
        serde_json::from_slice(header).map_err(|_| CaptureFailure::Invalidated)?;
    if preflight.protocol_version != SCENE_PROTOCOL_VERSION
        || result.protocol_version != SCENE_PROTOCOL_VERSION
        || result.request_id != preflight.request_id
        || result.before != preflight.facts
        || result.after != preflight.facts
        || result.activity_hint_before != preflight.activity_hint
        || result.activity_hint_after != preflight.activity_hint
        || !policy.admits_scene(&result.after)
        || result.text_evidence.state() != crate::TextState::NotRequested
        || result.observed_at_ms < 0
        || result.frame.png_bytes == 0
        || result.frame.png_bytes > MAX_FRAME_BYTES
    {
        return Err(CaptureFailure::Invalidated);
    }
    Ok(result)
}

fn decode_frame(
    result: NativeSceneResult,
    bytes: &[u8],
    preflight: &NativeScenePreflight,
) -> Result<NativeSceneCapture, CaptureFailure> {
    if bytes.len() != result.frame.png_bytes {
        return Err(CaptureFailure::Invalidated);
    }
    let frame = Frame::from_png(bytes.to_vec()).map_err(|_| CaptureFailure::Invalidated)?;
    if frame.width() != result.frame.width
        || frame.height() != result.frame.height
        || frame.sha256() != result.frame.sha256
        || result
            .after
            .identity
            .validate(frame.width(), frame.height(), &result.text_evidence)
            .is_err()
    {
        return Err(CaptureFailure::Invalidated);
    }
    Ok(NativeSceneCapture {
        before: result.before,
        after: result.after,
        observed_at_ms: result.observed_at_ms,
        text: result.text_evidence,
        frame,
        activity_hint: preflight.activity_hint.window_title_digest.clone(),
    })
}

#[cfg(test)]
mod tests;

#[cfg(target_os = "macos")]
mod ocr;
#[cfg(target_os = "macos")]
mod worker;
