use crate::Error;
use ring::digest;
use serde::{Deserialize, Serialize};
use std::{collections::BTreeSet, io::Cursor, time::Duration};
use zeroize::Zeroizing;

pub const MAX_FRAME_BYTES: usize = 2 * 1024 * 1024;
pub const MAX_FRAME_EDGE: u32 = 1920;
pub const MAX_TEXT_CODEPOINTS: usize = 1600;
pub const MAX_RETENTION: Duration = Duration::from_secs(24 * 60 * 60);
pub const MAX_STORE_BYTES: u64 = 1024 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TextState {
    NotRequested,
    Recognized,
    NoText,
    Deadline,
    Unavailable,
}

/// Protocol-v1 calls this OCR state. New evidence records use the explicit
/// source/state/text contract; this alias exists only for legacy wire readers.
pub type OcrState = TextState;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
/// Provenance only. This tag grants no consent and proves no visibility facts.
pub enum TextSource {
    None,
    Ocr,
    Accessibility,
}

/// Immutable and validated at deserialization as well as construction. A
/// missing source is never interpreted as permission to read accessibility.
#[derive(Clone)]
pub struct TextEvidence {
    source: TextSource,
    state: TextState,
    value: Zeroizing<String>,
}

impl TextEvidence {
    pub fn not_requested() -> Self {
        Self {
            source: TextSource::None,
            state: TextState::NotRequested,
            value: Zeroizing::new(String::new()),
        }
    }
    pub fn new(
        source: TextSource,
        state: TextState,
        value: Zeroizing<String>,
    ) -> Result<Self, Error> {
        if (source == TextSource::None) != (state == TextState::NotRequested)
            || value.chars().count() > MAX_TEXT_CODEPOINTS
            || (state == TextState::Recognized) != !value.trim().is_empty()
            || (state != TextState::Recognized && !value.is_empty())
        {
            return Err(Error::Invalid("text evidence"));
        }
        Ok(Self {
            source,
            state,
            value,
        })
    }
    pub(crate) fn legacy_ocr(state: OcrState, value: Zeroizing<String>) -> Result<Self, Error> {
        let source = if state == TextState::NotRequested {
            TextSource::None
        } else {
            TextSource::Ocr
        };
        Self::new(source, state, value)
    }
    pub fn source(&self) -> TextSource {
        self.source
    }
    pub fn state(&self) -> TextState {
        self.state
    }
    pub fn as_str(&self) -> &str {
        &self.value
    }
}

impl std::fmt::Debug for TextEvidence {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("TextEvidence([redacted])")
    }
}
impl std::ops::Deref for TextEvidence {
    type Target = str;
    fn deref(&self) -> &Self::Target {
        self.as_str()
    }
}
impl Serialize for TextEvidence {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut object = serializer.serialize_struct("TextEvidence", 3)?;
        object.serialize_field("source", &self.source)?;
        object.serialize_field("state", &self.state)?;
        object.serialize_field("text", self.as_str())?;
        object.end()
    }
}
impl<'de> Deserialize<'de> for TextEvidence {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Wire {
            source: TextSource,
            state: TextState,
            text: String,
        }
        let wire = Wire::deserialize(deserializer)?;
        Self::new(wire.source, wire.state, Zeroizing::new(wire.text))
            .map_err(serde::de::Error::custom)
    }
}

#[cfg(test)]
mod text_contract_tests {
    use super::*;
    #[test]
    fn explicit_sources_round_trip_and_inconsistent_or_missing_sources_refuse() {
        let text = TextEvidence::new(
            TextSource::Accessibility,
            TextState::Recognized,
            Zeroizing::new("owned visible text".into()),
        )
        .unwrap();
        assert!(!format!("{text:?}").contains("owned visible text"));
        let json = serde_json::to_value(&text).unwrap();
        let restored: TextEvidence = serde_json::from_value(json.clone()).unwrap();
        assert_eq!(restored.source(), TextSource::Accessibility);
        assert_eq!(restored.as_str(), "owned visible text");
        for value in [
            serde_json::json!({"state":"recognized","text":"owned visible text"}),
            serde_json::json!({"source":"none","state":"recognized","text":"owned"}),
            serde_json::json!({"source":"ocr","state":"not_requested","text":""}),
            serde_json::json!({"source":"accessibility","state":"unavailable","text":"partial secret"}),
            serde_json::json!({"source":"accessibility","state":"recognized","text":" "}),
            serde_json::json!({"source":"unknown","state":"recognized","text":"owned"}),
            serde_json::json!({"source":"accessibility","state":"recognized","text":"owned","permission":true}),
        ] {
            assert!(serde_json::from_value::<TextEvidence>(value).is_err());
        }
    }
}

#[derive(Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct ScopeId(String);

impl ScopeId {
    /// Opaque local storage namespace for other native account-owned stores.
    /// This is not an account identifier or a read capability.
    pub fn storage_namespace(&self) -> &str {
        &self.0
    }
    /// Local-only namespace; the account identifier is never used as a path.
    pub fn from_profile(profile: &str) -> Result<Self, Error> {
        if profile.is_empty() || profile.len() > 256 {
            return Err(Error::Invalid("profile"));
        }
        let digest = digest::digest(&digest::SHA256, profile.as_bytes());
        Ok(Self(
            digest.as_ref().iter().map(|b| format!("{b:02x}")).collect(),
        ))
    }
    pub(crate) fn path_component(&self) -> &str {
        &self.0
    }
    pub(crate) fn from_path_component(value: &str) -> Option<Self> {
        (value.len() == 64
            && value
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)))
        .then(|| Self(value.to_owned()))
    }
}

impl std::fmt::Debug for ScopeId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ScopeId([redacted])")
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Visibility {
    Visible,
    Hidden,
    Unknown,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Privacy {
    Normal,
    NotBrowser,
    Private,
    Unknown,
    /// A verified browser whose private state the helper cannot know. Only a
    /// site gate backed by the tracker's current row may admit it.
    Browser,
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SurfaceIdentity {
    pub pid: u32,
    pub process_birth: u64,
    pub window_id: u64,
    pub app_id: String,
    pub document_id: String,
    pub document_generation: u64,
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SurfaceFacts {
    pub identity: SurfaceIdentity,
    pub permission: bool,
    pub foreground: bool,
    pub interactive: bool,
    pub protected: bool,
    pub visibility: Visibility,
    pub privacy: Privacy,
    /// The app's display name as macOS shows it. Every-app memory matches
    /// name-only exclusion rules (for example synced from Windows) against it;
    /// without one, any name rule refuses the window.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app_name: Option<String>,
}

impl SurfaceFacts {
    pub fn admissible(
        &self,
        allowed_apps: &BTreeSet<String>,
        excluded_apps: &BTreeSet<String>,
    ) -> bool {
        matches!(self.privacy, Privacy::Normal | Privacy::NotBrowser)
            && self.admissible_surface(allowed_apps, excluded_apps)
    }
    /// Every admission condition except privacy; callers must decide privacy.
    pub(crate) fn admissible_surface(
        &self,
        allowed_apps: &BTreeSet<String>,
        excluded_apps: &BTreeSet<String>,
    ) -> bool {
        self.surface_ok()
            && allowed_apps.contains(&self.identity.app_id)
            && !excluded_apps.contains(&self.identity.app_id)
    }
    /// Every admission condition except privacy, for any app the person has
    /// not excluded by bundle identifier or display name (owner decision
    /// 2026-11-24: automatic memory reads every app but the exclusions).
    pub(crate) fn admissible_surface_any_app(&self, excluded: &BTreeSet<String>) -> bool {
        self.surface_ok() && !self.excluded_by(excluded)
    }
    fn excluded_by(&self, excluded: &BTreeSet<String>) -> bool {
        let mut keys = BTreeSet::from([self.identity.app_id.to_lowercase()]);
        match self.app_name.as_deref().map(str::trim).filter(|name| !name.is_empty()) {
            Some(name) => keys.insert(format!("name:{}", name.to_lowercase())),
            None => keys.insert("scene:unknown-names".to_owned()),
        };
        crate::scene::exclusion_keys_match(&keys, excluded)
    }
    fn surface_ok(&self) -> bool {
        let i = &self.identity;
        self.permission
            && self.foreground
            && self.interactive
            && !self.protected
            && self.visibility == Visibility::Visible
            && i.pid > 0
            && i.process_birth > 0
            && i.window_id > 0
            && !i.app_id.is_empty()
            && i.app_id.len() <= 256
            && !i.document_id.is_empty()
            && i.document_id.len() <= 512
            && i.document_generation > 0
            && self
                .app_name
                .as_ref()
                .is_none_or(|name| name.len() <= 256 && !name.chars().any(char::is_control))
    }
}

pub struct Frame {
    bytes: Zeroizing<Vec<u8>>,
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) sha256: String,
}

impl std::fmt::Debug for Frame {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Frame([redacted])")
    }
}

impl Frame {
    pub(crate) fn copy_for_processing(&self) -> Self {
        Self {
            bytes: self.bytes.clone(),
            width: self.width,
            height: self.height,
            sha256: self.sha256.clone(),
        }
    }

    /// Decode the complete bounded static PNG; header-only dimension claims are
    /// insufficient. Do not accept an animation or retain unbounded metadata.
    pub fn from_png(bytes: Vec<u8>) -> Result<Self, Error> {
        if bytes.is_empty() || bytes.len() > MAX_FRAME_BYTES {
            return Err(Error::Invalid("frame bytes"));
        }
        let mut decoder = png::Decoder::new(Cursor::new(&bytes));
        decoder.set_limits(png::Limits {
            bytes: 32 * 1024 * 1024,
        });
        let mut reader = decoder.read_info().map_err(|_| Error::Invalid("PNG"))?;
        let info = reader.info();
        let (width, height) = (info.width, info.height);
        if width == 0
            || height == 0
            || width > MAX_FRAME_EDGE
            || height > MAX_FRAME_EDGE
            || info.animation_control.is_some()
        {
            return Err(Error::Invalid("frame geometry"));
        }
        let size = reader
            .output_buffer_size()
            .ok_or(Error::Invalid("frame allocation"))?;
        if size > 32 * 1024 * 1024 {
            return Err(Error::Invalid("frame allocation"));
        }
        let mut decoded = Zeroizing::new(vec![0; size]);
        reader
            .next_frame(&mut decoded)
            .map_err(|_| Error::Invalid("PNG pixels"))?;
        reader.finish().map_err(|_| Error::Invalid("PNG end"))?;
        let sha256 = digest::digest(&digest::SHA256, &bytes)
            .as_ref()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        Ok(Self {
            bytes: Zeroizing::new(bytes),
            width,
            height,
            sha256,
        })
    }
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }
    pub fn width(&self) -> u32 {
        self.width
    }
    pub fn height(&self) -> u32 {
        self.height
    }
    pub fn sha256(&self) -> &str {
        &self.sha256
    }
}

#[derive(Clone)]
pub struct Retention {
    pub ttl: Duration,
    pub max_bytes: u64,
}
impl Default for Retention {
    fn default() -> Self {
        Self {
            ttl: MAX_RETENTION,
            max_bytes: MAX_STORE_BYTES,
        }
    }
}
impl Retention {
    pub fn validate(&self) -> Result<(), Error> {
        if self.ttl < Duration::from_secs(1)
            || self.ttl > MAX_RETENTION
            || self.max_bytes < 256 * 1024
            || self.max_bytes > MAX_STORE_BYTES
        {
            return Err(Error::Invalid("retention policy"));
        }
        Ok(())
    }
}
