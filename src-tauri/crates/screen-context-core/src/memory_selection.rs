//! Per-snapshot selection only. No persistent index, model work or new retention.
use crate::{store::EvidenceMetadata, Error, EvidenceSurface, SurfaceIdentity, TextSource, TextState};
use ring::digest;
use std::collections::BTreeSet;

pub const MAX_MEMORY_SOURCES: usize = 500;

/// Scan newest-first pages and keep the newest currently supported observation
/// for each exact (app, document, text source, text) group. This matches the
/// Python worker's grouping fields without sharing a persistent hash format.
/// A failed read poisons this selection; the next snapshot must start afresh.
pub struct MemorySourceSelection {
    allowed: BTreeSet<String>,
    hours: u32,
    groups: BTreeSet<[u8; 32]>,
    pub(crate) failed: bool,
}

impl MemorySourceSelection {
    pub fn new(allowed: BTreeSet<String>, hours: u32) -> Result<Self, Error> {
        if allowed.is_empty() || allowed.len() > 64 || !(1..=24).contains(&hours) {
            return Err(Error::Invalid("memory selection settings"));
        }
        Ok(Self {
            allowed,
            hours,
            groups: BTreeSet::new(),
            failed: false,
        })
    }

    pub fn is_full(&self) -> bool {
        self.groups.len() >= MAX_MEMORY_SOURCES
    }

    pub(crate) fn expires_at(&self, row: &EvidenceMetadata) -> i64 {
        row.expires_at_ms.min(
            row.observed_at_ms
                .saturating_add(i64::from(self.hours) * 3_600_000),
        )
    }

    pub(crate) fn candidate(&self, row: &EvidenceMetadata, now: i64) -> bool {
        !self.failed
            && !self.is_full()
            && document(row).is_some_and(|surface| self.allowed.contains(&surface.app_id))
            && row.text.state() == TextState::Recognized
            && self.expires_at(row) > now
            && !self.groups.contains(&group(row))
    }

    // Called only after the current-activity check, so an unsupported latest
    // observation cannot suppress an older valid observation of the same text.
    pub(crate) fn select(&mut self, row: &EvidenceMetadata) -> bool {
        !self.failed && !self.is_full() && self.groups.insert(group(row))
    }
}

/// Automatic memory reads the chosen apps' documents. A general display scene
/// spans several windows, so it is never a memory source.
pub fn document(row: &EvidenceMetadata) -> Option<&SurfaceIdentity> {
    match &row.surface {
        EvidenceSurface::Document(surface) => Some(surface),
        EvidenceSurface::ActiveDisplayScene(_) => None,
    }
}

fn group(row: &EvidenceMetadata) -> [u8; 32] {
    let (app, document_id) = document(row).map_or(("", ""), |s| (s.app_id.as_str(), s.document_id.as_str()));
    let source: &[u8] = match row.text.source() {
        TextSource::None => b"none",
        TextSource::Ocr => b"ocr",
        TextSource::Accessibility => b"accessibility",
    };
    let mut hash = digest::Context::new(&digest::SHA256);
    for part in [
        app.as_bytes(),
        document_id.as_bytes(),
        source,
        row.text.as_str().as_bytes(),
    ] {
        hash.update(&(part.len() as u64).to_be_bytes());
        hash.update(part);
    }
    hash.finish().as_ref().try_into().expect("SHA256 size")
}
