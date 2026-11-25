//! Per-snapshot selection only. No persistent index, model work or new retention.
use crate::{store::EvidenceMetadata, Error, EvidenceSurface, SurfaceIdentity, TextSource, TextState};
use ring::digest;
use std::collections::BTreeSet;

pub const MAX_MEMORY_SOURCES: usize = 500;
/// Memory's text retention reaches "until deleted": about a hundred years in hours.
pub const MAX_MEMORY_HOURS: u32 = 876_000;

/// Scan newest-first pages and keep the newest currently supported observation
/// for each exact (app, document, text source, text) group. This matches the
/// Python worker's grouping fields without sharing a persistent hash format.
/// A failed read poisons this selection; the next snapshot must start afresh.
pub struct MemorySourceSelection {
    apps: MemoryApps,
    hours: u32,
    groups: BTreeSet<[u8; 32]>,
    pub(crate) failed: bool,
}

/// The listed app identifiers, or every app except the excluded ones
/// (lowercase bundle identifiers, as the tracker exclusions are mapped).
enum MemoryApps {
    Listed(BTreeSet<String>),
    Every { excluded: BTreeSet<String> },
}
impl MemoryApps {
    fn admits(&self, app_id: &str) -> bool {
        match self {
            Self::Listed(allowed) => allowed.contains(app_id),
            Self::Every { excluded } => !excluded.contains(&app_id.to_lowercase()),
        }
    }
}

impl MemorySourceSelection {
    pub fn new(allowed: BTreeSet<String>, hours: u32) -> Result<Self, Error> {
        if allowed.is_empty() || allowed.len() > 64 || !(1..=MAX_MEMORY_HOURS).contains(&hours) {
            return Err(Error::Invalid("memory selection settings"));
        }
        Ok(Self {
            apps: MemoryApps::Listed(allowed),
            hours,
            groups: BTreeSet::new(),
            failed: false,
        })
    }

    /// Every app's documents except those the person excluded. Exclusions are
    /// compared case-insensitively by bundle identifier.
    pub fn every_app(excluded: &BTreeSet<String>, hours: u32) -> Result<Self, Error> {
        if excluded.len() > 2048 || !(1..=MAX_MEMORY_HOURS).contains(&hours) {
            return Err(Error::Invalid("memory selection settings"));
        }
        Ok(Self {
            apps: MemoryApps::Every {
                excluded: excluded.iter().map(|app| app.to_lowercase()).collect(),
            },
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
            && document(row).is_some_and(|surface| self.apps.admits(&surface.app_id))
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

#[cfg(test)]
mod every_app_tests {
    use super::*;

    #[test]
    fn every_app_selection_skips_excluded_apps_without_case() {
        let excluded = BTreeSet::from(["com.1Password.1password".to_owned(), "name:kakaotalk".to_owned()]);
        let every = MemorySourceSelection::every_app(&excluded, 24).unwrap();
        assert!(every.apps.admits("notion.id"));
        assert!(!every.apps.admits("COM.1PASSWORD.1PASSWORD"));
        assert!(MemorySourceSelection::every_app(&excluded, 0).is_err());
        let listed = MemorySourceSelection::new(BTreeSet::from(["com.apple.TextEdit".to_owned()]), 24).unwrap();
        assert!(listed.apps.admits("com.apple.TextEdit") && !listed.apps.admits("notion.id"));
    }
}
