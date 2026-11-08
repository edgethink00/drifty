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
        })
    }
}
impl NativeSceneHelperBackend {
    /// Native caller opts in only after the fixed helper's image-only OCR
    /// protocol is installed/qualified. This grants no provider consent.
    pub fn with_deferred_ocr(mut self) -> Self {
        self.deferred_ocr = true;
        self
    }
}
impl CaptureBackend for NativeSceneHelperBackend {
    fn prepare(&self, policy: &CapturePolicy, cancel: &Cancellation) -> Result<(), CaptureFailure> {
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
        {
            self.ocr_worker
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .take();
        }
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
            &mut |bytes| {
                if let Ok(refused) = serde_json::from_slice::<NativeRefusal>(bytes) {
                    if refused.protocol_version != SCENE_PROTOCOL_VERSION
                        || refused.request_id != request_id
                    {
                        return Err(io::ErrorKind::InvalidData.into());
                    }
                    rejection = refused.refusal.failure();
                    return Err(io::ErrorKind::PermissionDenied.into());
                }
                let packet: NativeScenePreflight =
                    serde_json::from_slice(bytes).map_err(|_| io::ErrorKind::InvalidData)?;
                if packet.protocol_version != SCENE_PROTOCOL_VERSION
                    || packet.request_id != request_id
                {
                    return Err(io::ErrorKind::InvalidData.into());
                }
                if !packet.facts.permission {
                    rejection = CaptureFailure::Permission;
                } else if !policy.admits_scene(&packet.facts) {
                    rejection = CaptureFailure::Excluded;
                } else {
                    preflight = Some(packet);
                    return Ok(());
                }
                Err(io::ErrorKind::PermissionDenied.into())
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

fn decode_result(
    remaining: &mut &[u8],
    preflight: &NativeScenePreflight,
    policy: &CapturePolicy,
) -> Result<NativeSceneCapture, CaptureFailure> {
    let header = packet(remaining)?;
    if let Ok(refused) = serde_json::from_slice::<NativeRefusal>(header) {
        if refused.protocol_version != SCENE_PROTOCOL_VERSION
            || refused.request_id != preflight.request_id
            || !remaining.is_empty()
        {
            return Err(CaptureFailure::Invalidated);
        }
        return Err(refused.refusal.failure());
    }
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
        || remaining.len() != result.frame.png_bytes
    {
        return Err(CaptureFailure::Invalidated);
    }
    let frame = Frame::from_png(remaining.to_vec()).map_err(|_| CaptureFailure::Invalidated)?;
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
    *remaining = &[];
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
