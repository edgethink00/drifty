//! Parent side of the fixed native helper protocol. The executable is resolved
//! by native app resource code, never by a WebView argument, PATH, or a shell.
use crate::{
    process, Cancellation, CaptureBackend, CaptureFailure, CapturePolicy, Frame, NativeCapture,
    OcrState, SurfaceFacts, TextEvidence, MAX_FRAME_BYTES, MAX_TEXT_CODEPOINTS,
};
use serde::{Deserialize, Serialize};
use std::{
    io,
    path::{Path, PathBuf},
    process::Command,
    time::Instant,
};
use uuid::Uuid;
use zeroize::Zeroizing;

mod scene;
pub use scene::{
    NativeSceneHelperBackend, NativeScenePreflight, NativeSceneResult, SCENE_PROTOCOL_VERSION,
};
mod worker;
pub use worker::PreparedNativeHelperBackend;
mod activity;
pub use activity::{
    NativeActivityObservation, NativeActivityPreflight, NativeActivityResult, WindowTitleDigest,
    ACTIVITY_PROTOCOL_VERSION,
};

pub const NATIVE_PROTOCOL_VERSION: u32 = 1;
pub const SOURCE_PROTOCOL_VERSION: u32 = 2;
pub const MAX_NATIVE_HEADER_BYTES: usize = 16 * 1024;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativePreflight {
    pub protocol_version: u32,
    pub request_id: Uuid,
    pub facts: SurfaceFacts,
}

#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NativeRefusalCode {
    Permission,
    AccessibilityPermission,
    CaptureService,
    Unsupported,
    Visibility,
    Protected,
    Changed,
    Deadline,
    Unavailable,
}
impl NativeRefusalCode {
    fn failure(self) -> CaptureFailure {
        match self {
            Self::Permission => CaptureFailure::Permission,
            Self::AccessibilityPermission => CaptureFailure::AccessibilityPermission,
            Self::CaptureService => CaptureFailure::CaptureService,
            Self::Unsupported => CaptureFailure::Unsupported,
            Self::Visibility => CaptureFailure::Visibility,
            Self::Protected => CaptureFailure::Protected,
            Self::Changed => CaptureFailure::Invalidated,
            Self::Deadline => CaptureFailure::Deadline,
            Self::Unavailable => CaptureFailure::Unavailable,
        }
    }
}

/// Fixed codes only. A helper refusal contains no window title, OCR, image,
/// command arguments, or free-form framework diagnostic.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeRefusal {
    pub protocol_version: u32,
    pub request_id: Uuid,
    pub refusal: NativeRefusalCode,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeFrameHeader {
    pub png_bytes: usize,
    pub width: u32,
    pub height: u32,
    pub sha256: String,
}

/// Source-aware protocol. The source is mandatory inside textEvidence; a v1
/// result cannot be silently substituted when this protocol was requested.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeTextResult {
    pub protocol_version: u32,
    pub request_id: Uuid,
    pub before: SurfaceFacts,
    pub after: SurfaceFacts,
    pub observed_at_ms: i64,
    pub text_evidence: TextEvidence,
    pub frame: NativeFrameHeader,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeResult {
    pub protocol_version: u32,
    pub request_id: Uuid,
    pub before: SurfaceFacts,
    pub after: SurfaceFacts,
    pub observed_at_ms: i64,
    pub text: String,
    pub ocr_state: OcrState,
    pub frame: NativeFrameHeader,
}

impl Drop for NativeResult {
    fn drop(&mut self) {
        use zeroize::Zeroize;
        self.text.zeroize();
        self.before.identity.app_id.zeroize();
        self.before.identity.document_id.zeroize();
        self.after.identity.app_id.zeroize();
        self.after.identity.document_id.zeroize();
    }
}

pub struct NativeHelperBackend {
    executable: PathBuf,
    required_document: Option<String>,
}

impl NativeHelperBackend {
    /// Caller must resolve this from the installed, trusted app resource. This
    /// constructor does not verify a package signature or grant OS permission.
    pub fn from_app_resource(path: &Path) -> Result<Self, crate::Error> {
        if !path.is_absolute() {
            return Err(crate::Error::Invalid("helper path"));
        }
        let metadata = std::fs::symlink_metadata(path)?;
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err(crate::Error::Invalid("helper file"));
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if metadata.file_attributes() & 0x400 != 0 {
                return Err(crate::Error::Invalid("helper reparse point"));
            }
        }
        Ok(Self {
            executable: path.canonicalize()?,
            required_document: None,
        })
    }

    /// Further narrow native admission to a trusted document fingerprint. This
    /// is useful for an owned-fixture QA run. It never bypasses app admission.
    pub fn require_document(mut self, fingerprint: String) -> Result<Self, crate::Error> {
        if fingerprint.len() != 64 || !fingerprint.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(crate::Error::Invalid("document fingerprint"));
        }
        self.required_document = Some(fingerprint);
        Ok(self)
    }
}

impl CaptureBackend for NativeHelperBackend {
    fn capture(
        &self,
        policy: &CapturePolicy,
        cancellation: &Cancellation,
    ) -> Result<NativeCapture, CaptureFailure> {
        // A legacy OCR helper cannot satisfy an accessibility request. Never
        // silently substitute one collection source for another consent.
        if policy.visible_text_enabled {
            return Err(CaptureFailure::Unsupported);
        }
        if cancellation.is_cancelled() {
            return Err(CaptureFailure::Cancelled);
        }
        let request_id = Uuid::new_v4();
        let mut command = Command::new(&self.executable);
        command.args([
            "--protocol-v1",
            "--request",
            &request_id.to_string(),
            "--ocr",
            if policy.ocr_enabled { "on" } else { "off" },
        ]);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            // A capture helper has no console or UI of its own. WGC's normal
            // system capture indicator remains controlled by the native API.
            command.creation_flags(0x08000000); // CREATE_NO_WINDOW
                                                // Inherit the bound before native CRT/DLL initialization. A helper
                                                // changing only its Win32 environment after startup is insufficient
                                                // for runtimes whose getenv view was already initialized.
            command
                .env("OMP_THREAD_LIMIT", "2")
                .env("OMP_NUM_THREADS", "2");
        }
        let mut preflight: Option<NativePreflight> = None;
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
                    if refused.protocol_version != NATIVE_PROTOCOL_VERSION
                        || refused.request_id != request_id
                    {
                        return Err(io::ErrorKind::InvalidData.into());
                    }
                    rejection = refused.refusal.failure();
                    return Err(io::ErrorKind::PermissionDenied.into());
                }
                let packet: NativePreflight =
                    serde_json::from_slice(bytes).map_err(|_| io::ErrorKind::InvalidData)?;
                if packet.protocol_version != NATIVE_PROTOCOL_VERSION
                    || packet.request_id != request_id
                {
                    return Err(io::ErrorKind::InvalidData.into());
                }
                if !packet.facts.permission {
                    rejection = CaptureFailure::Permission;
                } else if !policy.admits(&packet.facts)
                    || self
                        .required_document
                        .as_ref()
                        .is_some_and(|expected| expected != &packet.facts.identity.document_id)
                {
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
        let _diagnostics = Zeroizing::new(output.stderr); // never forward native diagnostics to UI/telemetry
        if !output.status.success() {
            return Err(CaptureFailure::Unavailable);
        }
        let preflight = preflight.ok_or(CaptureFailure::Invalidated)?;
        let mut remaining = bytes.as_slice();
        let first = packet(&mut remaining)?;
        // Parse the first packet again so even an inconsistent collector result
        // cannot attach a later response to the admitted identity.
        let echoed: NativePreflight =
            serde_json::from_slice(first).map_err(|_| CaptureFailure::Invalidated)?;
        if echoed.protocol_version != preflight.protocol_version
            || echoed.request_id != request_id
            || echoed.facts != preflight.facts
        {
            return Err(CaptureFailure::Invalidated);
        }
        let capture = decode_result(&mut remaining, &preflight, policy)?;
        if cancellation.is_cancelled() {
            return Err(CaptureFailure::Cancelled);
        }
        Ok(capture)
    }
}

fn packet<'a>(remaining: &mut &'a [u8]) -> Result<&'a [u8], CaptureFailure> {
    if remaining.len() < 4 {
        return Err(CaptureFailure::Invalidated);
    }
    let length = u32::from_be_bytes(remaining[..4].try_into().expect("four bytes")) as usize;
    if length == 0 || length > MAX_NATIVE_HEADER_BYTES || remaining.len() < 4 + length {
        return Err(CaptureFailure::Invalidated);
    }
    let body = &remaining[4..4 + length];
    *remaining = &remaining[4 + length..];
    Ok(body)
}

fn decode_result(
    remaining: &mut &[u8],
    preflight: &NativePreflight,
    policy: &CapturePolicy,
) -> Result<NativeCapture, CaptureFailure> {
    let header = packet(remaining)?;
    if preflight.protocol_version == SOURCE_PROTOCOL_VERSION {
        return decode_text_result(header, remaining, preflight, policy);
    }
    if preflight.protocol_version != NATIVE_PROTOCOL_VERSION {
        return Err(CaptureFailure::Invalidated);
    }
    if let Ok(refused) = serde_json::from_slice::<NativeRefusal>(header) {
        if refused.protocol_version != NATIVE_PROTOCOL_VERSION
            || refused.request_id != preflight.request_id
            || !remaining.is_empty()
        {
            return Err(CaptureFailure::Invalidated);
        }
        return Err(refused.refusal.failure());
    }
    let mut result: NativeResult =
        serde_json::from_slice(header).map_err(|_| CaptureFailure::Invalidated)?;
    if result.protocol_version != NATIVE_PROTOCOL_VERSION
        || result.request_id != preflight.request_id
        || result.before != preflight.facts
        || result.after != preflight.facts
        || !policy.admits(&result.after)
        || result.observed_at_ms < 0
        || result.text.chars().count() > MAX_TEXT_CODEPOINTS
        || (result.ocr_state == OcrState::Recognized) != !result.text.trim().is_empty()
        || (result.ocr_state != OcrState::Recognized && !result.text.is_empty())
        || (!policy.ocr_enabled && result.ocr_state != OcrState::NotRequested)
        || (policy.ocr_enabled && result.ocr_state == OcrState::NotRequested)
        || result.frame.png_bytes == 0
        || result.frame.png_bytes > MAX_FRAME_BYTES
        || remaining.len() != result.frame.png_bytes
    {
        return Err(CaptureFailure::Invalidated);
    }
    let text = TextEvidence::legacy_ocr(
        result.ocr_state,
        Zeroizing::new(std::mem::take(&mut result.text)),
    )
    .map_err(|_| CaptureFailure::Invalidated)?;
    if !policy.permits_text(&text) {
        return Err(CaptureFailure::Invalidated);
    }
    let frame = Frame::from_png(remaining.to_vec()).map_err(|_| CaptureFailure::Invalidated)?;
    if frame.width() != result.frame.width
        || frame.height() != result.frame.height
        || frame.sha256() != result.frame.sha256
    {
        return Err(CaptureFailure::Invalidated);
    }
    *remaining = &[];
    Ok(NativeCapture {
        before: result.before.clone(),
        after: result.after.clone(),
        observed_at_ms: result.observed_at_ms,
        text,
        frame,
        activity_hint: None,
        site_admitted: false,
    })
}

fn decode_text_result(
    header: &[u8],
    remaining: &mut &[u8],
    preflight: &NativePreflight,
    policy: &CapturePolicy,
) -> Result<NativeCapture, CaptureFailure> {
    if let Ok(refused) = serde_json::from_slice::<NativeRefusal>(header) {
        if refused.protocol_version != SOURCE_PROTOCOL_VERSION
            || refused.request_id != preflight.request_id
            || !remaining.is_empty()
        {
            return Err(CaptureFailure::Invalidated);
        }
        return Err(refused.refusal.failure());
    }
    let result: NativeTextResult =
        serde_json::from_slice(header).map_err(|_| CaptureFailure::Invalidated)?;
    accept_text_result(
        result,
        SOURCE_PROTOCOL_VERSION,
        remaining,
        preflight,
        policy,
        None,
        false,
    )
}

fn accept_text_result(
    result: NativeTextResult,
    version: u32,
    remaining: &mut &[u8],
    preflight: &NativePreflight,
    policy: &CapturePolicy,
    activity_hint: Option<WindowTitleDigest>,
    site_admitted: bool,
) -> Result<NativeCapture, CaptureFailure> {
    if result.protocol_version != version
        || result.request_id != preflight.request_id
        || result.before != preflight.facts
        || result.after != preflight.facts
        || !policy.admits_capture(&result.after, site_admitted)
        || !policy.permits_text(&result.text_evidence)
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
    {
        return Err(CaptureFailure::Invalidated);
    }
    *remaining = &[];
    Ok(NativeCapture {
        before: result.before,
        after: result.after,
        observed_at_ms: result.observed_at_ms,
        text: result.text_evidence,
        frame,
        activity_hint,
        site_admitted,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Privacy, SurfaceIdentity, Visibility};
    use std::collections::BTreeSet;

    fn fixture() -> (NativePreflight, CapturePolicy, Vec<u8>) {
        let facts = SurfaceFacts {
            identity: SurfaceIdentity {
                pid: 7,
                process_birth: 123,
                window_id: 8,
                app_id: "owned.editor".into(),
                document_id: "owned-doc".into(),
                document_generation: 1,
            },
            permission: true,
            foreground: true,
            interactive: true,
            protected: false,
            visibility: Visibility::Visible,
            privacy: Privacy::NotBrowser,
            app_name: None,
        };
        let mut png = Vec::new();
        let mut encoder = png::Encoder::new(&mut png, 2, 2);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder
            .write_header()
            .unwrap()
            .write_image_data(&[42; 16])
            .unwrap();
        (
            NativePreflight {
                protocol_version: 1,
                request_id: Uuid::new_v4(),
                facts,
            },
            CapturePolicy {
                enabled: true,
                ocr_enabled: true,
                allowed_apps: BTreeSet::from(["owned.editor".into()]),
                ..CapturePolicy::default()
            },
            png,
        )
    }
    fn wire(
        pre: &NativePreflight,
        png: &[u8],
        change: impl FnOnce(&mut serde_json::Value),
    ) -> Vec<u8> {
        let frame = Frame::from_png(png.to_vec()).unwrap();
        let mut header = serde_json::json!({"protocolVersion":1,"requestId":pre.request_id,"before":pre.facts,"after":pre.facts,"observedAtMs":1000,"text":"캐시 만료 검사","ocrState":"recognized","frame":{"pngBytes":png.len(),"width":frame.width(),"height":frame.height(),"sha256":frame.sha256()}});
        change(&mut header);
        let json = serde_json::to_vec(&header).unwrap();
        let mut out = (json.len() as u32).to_be_bytes().to_vec();
        out.extend(json);
        out.extend(png);
        out
    }
    #[test]
    fn source_aware_results_cannot_downgrade_or_bypass_their_source_policy() {
        let (mut pre, mut policy, png) = fixture();
        pre.protocol_version = SOURCE_PROTOCOL_VERSION;
        policy.ocr_enabled = false;
        policy.visible_text_enabled = true;
        let source_wire = |change: fn(&mut serde_json::Value)| {
            self::wire(&pre, &png, |header| {
                header["protocolVersion"] = serde_json::json!(2);
                header.as_object_mut().unwrap().remove("text");
                header.as_object_mut().unwrap().remove("ocrState");
                header["textEvidence"] = serde_json::json!({"source":"accessibility", "state":"recognized", "text":"owned source-aware text"});
                change(header);
            })
        };
        let good = source_wire(|_| {});
        let result = decode_result(&mut good.as_slice(), &pre, &policy).unwrap();
        assert_eq!(result.text.source(), crate::TextSource::Accessibility);
        assert_eq!(result.text.as_str(), "owned source-aware text");
        let mut ocr_only = policy.clone();
        ocr_only.ocr_enabled = true;
        ocr_only.visible_text_enabled = false;
        assert!(decode_result(&mut good.as_slice(), &pre, &ocr_only).is_err());
        let legacy = self::wire(&pre, &png, |_| {});
        assert!(decode_result(&mut legacy.as_slice(), &pre, &policy).is_err());
        for change in [
            (|h: &mut serde_json::Value| {
                h["textEvidence"].as_object_mut().unwrap().remove("source");
            }) as fn(&mut serde_json::Value),
            |h| h["textEvidence"]["source"] = serde_json::json!("ocr"),
            |h| h["textEvidence"]["state"] = serde_json::json!("unavailable"),
            |h| h["after"]["identity"]["documentGeneration"] = serde_json::json!(2),
            |h| h["frame"]["sha256"] = serde_json::json!("0".repeat(64)),
            |h| h["text"] = serde_json::json!("mixed legacy field"),
        ] {
            let bad = source_wire(change);
            assert!(decode_result(&mut bad.as_slice(), &pre, &policy).is_err());
        }
    }
    #[test]
    fn typed_refusal_is_request_bound_and_cannot_smuggle_pixels() {
        let (pre, policy, png) = fixture();
        for (code, expected) in [
            (NativeRefusalCode::Visibility, CaptureFailure::Visibility),
            (NativeRefusalCode::Changed, CaptureFailure::Invalidated),
        ] {
            let refusal = NativeRefusal {
                protocol_version: 1,
                request_id: pre.request_id,
                refusal: code,
            };
            let bytes = serde_json::to_vec(&refusal).unwrap();
            let mut out = (bytes.len() as u32).to_be_bytes().to_vec();
            out.extend(bytes);
            assert!(matches!(
                decode_result(&mut out.as_slice(), &pre, &policy),
                Err(failure) if failure == expected
            ));
            let mut wrong_request = NativePreflight {
                protocol_version: 1,
                request_id: Uuid::new_v4(),
                facts: pre.facts.clone(),
            };
            assert!(matches!(
                decode_result(&mut out.as_slice(), &wrong_request, &policy),
                Err(CaptureFailure::Invalidated)
            ));
            wrong_request.request_id = pre.request_id;
            out.extend(&png);
            assert!(matches!(
                decode_result(&mut out.as_slice(), &wrong_request, &policy),
                Err(CaptureFailure::Invalidated)
            ));
        }
    }

    #[test]
    fn response_binds_request_document_pixels_and_collection_state() {
        let (pre, policy, png) = fixture();
        let wire = wire(&pre, &png, |_| {});
        assert_eq!(
            decode_result(&mut wire.as_slice(), &pre, &policy)
                .unwrap()
                .text
                .as_str(),
            "캐시 만료 검사"
        );
        for (field, value) in [
            ("requestId", serde_json::json!(Uuid::new_v4())),
            ("ocrState", serde_json::json!("no_text")),
            ("unexpected", serde_json::json!(true)),
        ] {
            let out = self::wire(&pre, &png, |header| header[field] = value);
            assert!(decode_result(&mut out.as_slice(), &pre, &policy).is_err());
        }
        for change in [0, 1, 2, 3] {
            let out = self::wire(&pre, &png, |header| match change {
                0 => header["after"]["identity"]["documentGeneration"] = serde_json::json!(2),
                1 => header["frame"]["sha256"] = serde_json::json!("0".repeat(64)),
                2 => header["text"] = serde_json::json!("한".repeat(1601)),
                _ => header["frame"]["pngBytes"] = serde_json::json!(png.len() + 1),
            });
            assert!(decode_result(&mut out.as_slice(), &pre, &policy).is_err());
        }
        let mut extra = wire.clone();
        extra.push(0);
        assert!(decode_result(&mut extra.as_slice(), &pre, &policy).is_err());
        assert!(decode_result(&mut wire[..wire.len() - 1].as_ref(), &pre, &policy).is_err());
    }
}
