//! Native-only preparation of separately consented AI inputs. No network,
//! WebView command, provider endpoint or telemetry lives here. Durable choices
//! are separately explicit in ai_consent, never an active request capability.
//! A future native provider adapter must check its actual route revision,
//! cancel queued/in-flight work on revocation and validate before result commit.
//! A check cannot retract bytes a transport has already accepted.
use crate::{
    lease::AccountReadLease, ActivityReadReply, ActivityVisibilityGuard, Error, Frame, TextSource,
    TextState, MAX_ACTIVITY_REFS,
};
use serde::{Deserialize, Serialize, Serializer};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant, SystemTime},
};
use uuid::Uuid;
use zeroize::Zeroizing;

pub const MAX_AI_EVIDENCE: usize = 5;
pub const MAX_AI_IMAGES: usize = 3;
pub const MAX_AI_TEXT_EXCERPT: usize = 600;
pub const MAX_AI_TOTAL_TEXT: usize = 1600;
pub const MAX_AI_JSON_BYTES: usize = 16 * 1024;
pub const MAX_AI_TOTAL_IMAGE_BYTES: usize = 2 * 1024 * 1024;
const MAX_REQUEST_WINDOW_MS: i64 = 3 * 60 * 60 * 1000;
const MAX_INPUT_AGE: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiPurpose {
    Classification,
    ProjectAssignment,
    TimelineCards,
}

/// Independent of capture, replay, existing AI privacy and device-sync flags.
/// Native authenticated settings must obtain these explicit choices; there is
/// deliberately no Deserialize, automatic migration or inferred authorization.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AiSourceChoices {
    pub accessibility_text: bool,
    pub ocr_text: bool,
    pub images: bool,
    pub purposes: BTreeSet<AiPurpose>,
}

struct UseState {
    epoch: u64,
    provider_revision: Option<Uuid>,
    choices: AiSourceChoices,
}
struct UseGate {
    account: AccountReadLease,
    state: Mutex<UseState>,
    closed: AtomicBool,
}

/// One verified native account capability; a login/profile ABA cannot inherit
/// it even when the new account has the same scope string. Starts fully OFF.
pub struct AiUseGate(Arc<UseGate>);
impl AiUseGate {
    pub fn new(account: AccountReadLease) -> Result<Self, Error> {
        if !account.is_current() {
            return Err(Error::Invalidated);
        }
        Ok(Self(Arc::new(UseGate {
            account,
            state: Mutex::new(UseState {
                epoch: 0,
                provider_revision: None,
                choices: AiSourceChoices::default(),
            }),
            closed: AtomicBool::new(false),
        })))
    }

    /// The revision identifies the complete effective native provider route,
    /// including model/endpoint/processing changes. It is not a URL from a
    /// WebView and is never sent in the screen payload. This prototype stores
    /// nothing; production settings/confirmation and dispatch are still absent.
    pub fn configure(
        &self,
        authority: &AccountReadLease,
        provider_revision: Option<Uuid>,
        choices: AiSourceChoices,
    ) -> Result<(), Error> {
        if !self.0.account.same_capability(authority)
            || !authority.is_current()
            || !self.0.account.is_current()
            || provider_revision.is_some_and(|value| value.is_nil())
        {
            return Err(Error::Invalidated);
        }
        self.update(provider_revision, choices)
    }

    /// Closing a source must remain possible after account expiry.
    pub fn revoke(&self) -> Result<(), Error> {
        self.update(None, AiSourceChoices::default())
    }

    pub(crate) fn revoke_for_account(&self, account: &AccountReadLease) -> Result<(), Error> {
        if !self.0.account.same_capability(account) || !account.is_current() {
            return Err(Error::Invalidated);
        }
        self.revoke()
    }

    fn update(&self, provider: Option<Uuid>, choices: AiSourceChoices) -> Result<(), Error> {
        let mut state = self.0.state.lock().map_err(|_| {
            self.0.closed.store(true, Ordering::Release);
            Error::Invalidated
        })?;
        if self.0.closed.load(Ordering::Acquire) {
            return Err(Error::Invalidated);
        }
        let Some(epoch) = state.epoch.checked_add(1) else {
            self.0.closed.store(true, Ordering::Release);
            return Err(Error::Invalidated);
        };
        state.epoch = epoch;
        state.provider_revision = provider;
        state.choices = choices;
        Ok(())
    }

    pub fn begin(
        &self,
        provider_revision: Uuid,
        purpose: AiPurpose,
        provider_supports_images: bool,
    ) -> Result<AiUseLease, Error> {
        let state = self.0.state.lock().map_err(|_| Error::Invalidated)?;
        if self.0.closed.load(Ordering::Acquire)
            || !self.0.account.is_current()
            || state.provider_revision != Some(provider_revision)
            || !state.choices.purposes.contains(&purpose)
            || !(state.choices.accessibility_text || state.choices.ocr_text || state.choices.images)
        {
            return Err(Error::Invalidated);
        }
        Ok(AiUseLease {
            gate: Arc::clone(&self.0),
            epoch: state.epoch,
            choices: state.choices.clone(),
            purpose,
            provider_supports_images,
            started: Instant::now(),
            wall_started: SystemTime::now(),
            invalidated: AtomicBool::new(false),
        })
    }
}

pub struct AiUseLease {
    gate: Arc<UseGate>,
    epoch: u64,
    pub(crate) choices: AiSourceChoices,
    pub(crate) purpose: AiPurpose,
    pub(crate) provider_supports_images: bool,
    started: Instant,
    wall_started: SystemTime,
    invalidated: AtomicBool,
}
impl AiUseLease {
    pub fn validate(&self) -> Result<(), Error> {
        let valid = !self.invalidated.load(Ordering::Acquire)
            && !self.gate.closed.load(Ordering::Acquire)
            && self.gate.account.is_current()
            && self.started.elapsed() < MAX_INPUT_AGE
            && self
                .wall_started
                .elapsed()
                .is_ok_and(|age| age < MAX_INPUT_AGE)
            && self
                .gate
                .state
                .lock()
                .is_ok_and(|state| state.epoch == self.epoch);
        if !valid {
            self.invalidated.store(true, Ordering::Release);
            return Err(Error::Invalidated);
        }
        Ok(())
    }
    pub(crate) fn validate_account(&self, account: Option<&AccountReadLease>) -> Result<(), Error> {
        self.validate()?;
        if !account.is_some_and(|account| self.gate.account.same_capability(account)) {
            return Err(Error::Invalidated);
        }
        Ok(())
    }
    pub(crate) fn permits_text(&self, source: TextSource) -> bool {
        match source {
            TextSource::Accessibility => self.choices.accessibility_text,
            TextSource::Ocr => self.choices.ocr_text,
            TextSource::None => false,
        }
    }
}

/// Bounded native selection, not a proof or collection authority. Both the
/// existing current activity proof and this additional real request window/ID
/// filter are applied. Unbound/remote/expired evidence cannot be substituted.
pub struct AiInputSelection {
    pub(crate) record_ids: BTreeSet<String>,
    pub(crate) evidence_ids: Vec<Uuid>,
    pub(crate) window: [i64; 2],
}
impl AiInputSelection {
    pub fn new(
        record_ids: Vec<String>,
        evidence_ids: Vec<Uuid>,
        window: [i64; 2],
    ) -> Result<Self, Error> {
        if record_ids.is_empty()
            || record_ids.len() > MAX_ACTIVITY_REFS
            || record_ids.iter().any(|id| {
                id.parse::<i64>()
                    .ok()
                    .is_none_or(|n| n <= 0 || n.to_string() != *id)
            })
            || record_ids.iter().collect::<BTreeSet<_>>().len() != record_ids.len()
            || evidence_ids.is_empty()
            || evidence_ids.len() > MAX_AI_EVIDENCE
            || evidence_ids.iter().any(Uuid::is_nil)
            || evidence_ids.iter().collect::<BTreeSet<_>>().len() != evidence_ids.len()
            || window[0] < 0
            || window[0] >= window[1]
            || window[1] > 253_402_300_799_999
            || window[1] - window[0] > MAX_REQUEST_WINDOW_MS
        {
            return Err(Error::Invalid("AI input selection"));
        }
        Ok(Self {
            record_ids: record_ids.into_iter().collect(),
            evidence_ids,
            window,
        })
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiPayload {
    schema_version: &'static str,
    policy_revision: u8,
    purpose: AiPurpose,
    request_ref: &'static str,
    window_duration_millis: i64,
    record_refs: Vec<String>,
    evidence: Vec<AiEvidence>,
    attachments: Vec<ImageDescriptor>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AiEvidence {
    #[serde(rename = "ref")]
    reference: String,
    record_ref: String,
    offset_millis: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<AiText>,
    #[serde(skip_serializing_if = "Option::is_none")]
    image: Option<AiImage>,
}
#[derive(Serialize)]
struct AiText {
    source: TextSource,
    state: TextState,
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "serialize_excerpt"
    )]
    excerpt: Option<Zeroizing<String>>,
    truncated: bool,
}
fn serialize_excerpt<S: Serializer>(
    value: &Option<Zeroizing<String>>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    value
        .as_deref()
        .map(|text| text.as_str())
        .serialize(serializer)
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AiImage {
    state: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    image_ref: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImageDescriptor {
    #[serde(rename = "ref")]
    reference: String,
    mime_type: &'static str,
    width: u32,
    height: u32,
}

/// Binary parts never enter the JSON, file paths, data URLs or a WebView DTO.
pub struct AiImagePart {
    reference: String,
    frame: Frame,
}
impl AiImagePart {
    pub fn reference(&self) -> &str {
        &self.reference
    }
    pub fn png(&self) -> &[u8] {
        self.frame.bytes()
    }
}

pub(crate) struct PayloadBuilder {
    payload: AiPayload,
    images: Vec<AiImagePart>,
    local_refs: BTreeMap<String, Zeroizing<String>>,
    total_text: usize,
    total_image_bytes: usize,
}
impl PayloadBuilder {
    pub(crate) fn new(lease: &AiUseLease, window: [i64; 2]) -> Self {
        Self {
            payload: AiPayload {
                schema_version: "drifty.screen-context.v2",
                policy_revision: 2,
                purpose: lease.purpose,
                request_ref: "q1",
                window_duration_millis: window[1] - window[0],
                record_refs: Vec::new(),
                evidence: Vec::new(),
                attachments: Vec::new(),
            },
            images: Vec::new(),
            local_refs: BTreeMap::new(),
            total_text: 0,
            total_image_bytes: 0,
        }
    }
    pub(crate) fn append(
        &mut self,
        evidence: crate::BoundActivityEvidence,
        lease: &AiUseLease,
        window: [i64; 2],
    ) -> Result<(), Error> {
        if self.payload.evidence.len() >= MAX_AI_EVIDENCE {
            return Err(Error::Invalid("AI evidence limit"));
        }
        let metadata = &evidence.metadata;
        let local_id = metadata
            .activity_binding
            .as_ref()
            .ok_or(Error::Invalidated)?
            .record_id();
        let text = lease.permits_text(metadata.text.source()).then(|| {
            let count = metadata.text.as_str().chars().count();
            let limit = MAX_AI_TEXT_EXCERPT.min(MAX_AI_TOTAL_TEXT - self.total_text);
            let excerpt = (count > 0 && limit > 0).then(|| {
                Zeroizing::new(
                    metadata
                        .text
                        .as_str()
                        .chars()
                        .take(limit)
                        .collect::<String>(),
                )
            });
            self.total_text += count.min(limit);
            AiText {
                source: metadata.text.source(),
                state: metadata.text.state(),
                excerpt,
                truncated: count > limit,
            }
        });
        let image = lease.choices.images.then(|| {
            if !lease.provider_supports_images {
                return AiImage {
                    state: "provider_unsupported",
                    image_ref: None,
                };
            }
            let Some(frame) = evidence.frame else {
                return AiImage {
                    state: "not_retained",
                    image_ref: None,
                };
            };
            if self.images.len() >= MAX_AI_IMAGES
                || frame.bytes().len() > MAX_AI_TOTAL_IMAGE_BYTES - self.total_image_bytes
            {
                return AiImage {
                    state: "budget",
                    image_ref: None,
                };
            }
            let reference = format!("img{}", self.images.len() + 1);
            self.total_image_bytes += frame.bytes().len();
            self.payload.attachments.push(ImageDescriptor {
                reference: reference.clone(),
                mime_type: "image/png",
                width: frame.width(),
                height: frame.height(),
            });
            self.images.push(AiImagePart {
                reference: reference.clone(),
                frame,
            });
            AiImage {
                state: "included",
                image_ref: Some(reference),
            }
        });
        if text.is_none() && image.is_none() {
            return Ok(());
        }
        let record_ref = self
            .local_refs
            .iter()
            .find(|(_, id)| id.as_str() == local_id)
            .map(|(reference, _)| reference.clone())
            .unwrap_or_else(|| {
                let reference = format!("r{}", self.local_refs.len() + 1);
                self.local_refs
                    .insert(reference.clone(), Zeroizing::new(local_id.to_owned()));
                self.payload.record_refs.push(reference.clone());
                reference
            });
        self.payload.evidence.push(AiEvidence {
            reference: format!("e{}", self.payload.evidence.len() + 1),
            record_ref,
            offset_millis: metadata.observed_at_ms - window[0],
            text,
            image,
        });
        Ok(())
    }
    pub(crate) fn is_empty(&self) -> bool {
        self.payload.evidence.is_empty()
    }
    pub(crate) fn finish(
        self,
        lease: AiUseLease,
        wrap: impl FnOnce(AiPayload) -> Result<ActivityReadReply<AiPayload>, Error>,
    ) -> Result<PreparedAiInput, Error> {
        let reply = wrap(self.payload)?;
        let guard = reply.visibility_guard().ok_or(Error::Invalidated)?;
        lease.validate()?;
        Ok(PreparedAiInput {
            reply,
            guard,
            lease,
            images: self.images,
            local_refs: self.local_refs,
        })
    }
}

/// No Serialize/Clone/content Debug implementation. All content access keeps
/// the policy/account/current-point proof. Screen text may itself contain
/// private paths/URLs: removing local metadata fields is not content redaction.
pub struct PreparedAiInput {
    reply: ActivityReadReply<AiPayload>,
    guard: ActivityVisibilityGuard,
    lease: AiUseLease,
    images: Vec<AiImagePart>,
    local_refs: BTreeMap<String, Zeroizing<String>>,
}
struct JsonBuffer(Zeroizing<Vec<u8>>);
impl std::io::Write for JsonBuffer {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if bytes.len() > MAX_AI_JSON_BYTES - self.0.len() {
            return Err(std::io::Error::other("AI input limit"));
        }
        self.0.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
impl PreparedAiInput {
    pub fn validate_for_commit(&self) -> Result<(), Error> {
        self.lease.validate()?;
        if !self.guard.is_current() {
            return Err(Error::Invalidated);
        }
        self.lease.validate()
    }

    /// Synchronous native boundary only, not an async dispatch/rollback
    /// guarantee. A future transport must preserve the proof through its own
    /// queue/send/response lifecycle and must never log or learn from parts.
    pub fn with_current_parts<T>(
        &self,
        use_parts: impl FnOnce(&[u8], &[AiImagePart]) -> Result<T, Error>,
    ) -> Result<T, Error> {
        self.validate_for_commit()?;
        // Fixed capacity avoids reallocating plaintext JSON as it grows. An
        // unexpected serialization expansion refuses before exposing any part.
        let mut json = JsonBuffer(Zeroizing::new(Vec::with_capacity(MAX_AI_JSON_BYTES)));
        serde_json::to_writer(&mut json, &self.reply).map_err(|_| Error::Invalidated)?;
        self.lease.validate()?;
        let result = use_parts(&json.0, &self.images)?;
        self.validate_for_commit()?;
        Ok(result)
    }

    /// Result references resolve locally only after another full proof check.
    /// Unknown/duplicate refs refuse the entire proposed result; no model text
    /// or classification result is accepted/committed by this primitive.
    pub fn resolve_record_refs(
        &self,
        references: &[String],
    ) -> Result<Vec<Zeroizing<String>>, Error> {
        self.validate_for_commit()?;
        if references.is_empty()
            || references.len() > MAX_ACTIVITY_REFS
            || references.iter().collect::<BTreeSet<_>>().len() != references.len()
        {
            return Err(Error::Invalid("AI result references"));
        }
        let result = references
            .iter()
            .map(|reference| {
                self.local_refs
                    .get(reference)
                    .cloned()
                    .ok_or(Error::Invalid("AI result references"))
            })
            .collect::<Result<_, _>>()?;
        self.validate_for_commit()?;
        Ok(result)
    }
}

#[cfg(test)]
mod tests;
