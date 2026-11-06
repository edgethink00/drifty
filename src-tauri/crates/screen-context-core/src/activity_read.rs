//! Native current-activity proof around read and response serialization. This
//! module grants no capture or WebView-supplied identity authority. The caller
//! must still serialize on an owned blocking task, and route every activity
//! mutation through the durable deletion/identity fence before activation.
use crate::{
    activity_reader::ActivityResolver, lease::AccountReadLease, store::EvidenceMetadata,
    ActivityBinding, Error, Frame, ObservationLease, MAX_ACTIVITY_REFS,
};
use serde::{Serialize, Serializer};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

pub struct BoundActivityEvidence {
    pub metadata: EvidenceMetadata,
    pub frame: Option<Frame>,
}

/// Native-only Settings projection input. Legacy unbound history is permitted;
/// bound records retain the same current-activity proof as activity consumers.
pub struct ReviewEvidence {
    pub metadata: EvidenceMetadata,
    pub frame: Option<Frame>,
}

/// Native-only text projection for one bounded memory page. It deliberately
/// has no Serialize implementation: current activity proofs must wrap any
/// projection that leaves the core, just as they wrap an individual detail.
pub struct MemoryEvidencePage {
    pub records: Vec<EvidenceMetadata>,
    pub next_cursor: Option<crate::store::PageCursor>,
}

pub(crate) struct ActivityProof {
    replay: bool,
    binding: ActivityBinding,
    observed_at_ms: i64,
}
impl ActivityProof {
    pub(crate) fn replay(row: &crate::LocalActivityRecordRef, point: i64) -> Result<Self, Error> {
        Ok(Self {
            replay: true,
            binding: ActivityBinding::for_capture(row, point).ok_or(Error::Invalidated)?,
            observed_at_ms: point,
        })
    }
    pub(crate) fn from_metadata(metadata: &EvidenceMetadata) -> Result<Self, Error> {
        Ok(Self {
            replay: false,
            binding: metadata
                .activity_binding
                .clone()
                .ok_or(Error::Invalidated)?,
            observed_at_ms: metadata.observed_at_ms,
        })
    }
}

pub(crate) struct CurrentActivityGuard {
    observation: ObservationLease,
    account: Option<AccountReadLease>,
    reader: Arc<dyn ActivityResolver>,
    proofs: Vec<ActivityProof>,
    invalidated: AtomicBool,
}
impl CurrentActivityGuard {
    pub(crate) fn new(
        observation: ObservationLease,
        account: Option<AccountReadLease>,
        reader: Arc<dyn ActivityResolver>,
        proofs: Vec<ActivityProof>,
    ) -> Result<Self, Error> {
        if proofs.len() > MAX_ACTIVITY_REFS {
            return Err(Error::Invalid("activity read proof limit"));
        }
        Ok(Self {
            observation,
            account,
            reader,
            proofs,
            invalidated: AtomicBool::new(false),
        })
    }
    fn current(&self) -> bool {
        !self.invalidated.load(Ordering::Acquire)
            && self.observation.is_current()
            && self.account.as_ref().is_none_or(|lease| lease.is_current())
    }
    pub(crate) fn validate(&self) -> Result<(), Error> {
        let result = (|| {
            if !self.current() {
                return Err(Error::Invalidated);
            }
            if self.proofs.is_empty() {
                return Ok(());
            }
            for replay in [false, true] {
                let ids = self
                    .proofs
                    .iter()
                    .filter(|proof| proof.replay == replay)
                    .map(|proof| proof.binding.record_id().to_owned())
                    .collect::<BTreeSet<_>>()
                    .into_iter()
                    .collect::<Vec<_>>();
                // The ordinary tracker serve mutex is never held here. The reader
                // retains its real fixed input/output/query/preparation limits.
                if ids.is_empty() {
                    continue;
                }
                let rows = if replay {
                    self.reader.read_replay_current(&ids, &|| self.current())?
                } else {
                    self.reader.read_current(&ids, &|| self.current())?
                };
                let current = rows
                    .iter()
                    .map(|row| (row.record_id(), row))
                    .collect::<BTreeMap<_, _>>();
                if current.len() != rows.len()
                    || current.len() != ids.len()
                    || self
                        .proofs
                        .iter()
                        .filter(|proof| proof.replay == replay)
                        .any(|proof| {
                            current
                                .get(proof.binding.record_id())
                                .is_none_or(|row| !proof.binding.matches(row, proof.observed_at_ms))
                        })
                    || !self.current()
                {
                    return Err(Error::Invalidated);
                }
            }
            Ok(())
        })();
        if result.is_err() {
            self.invalidated.store(true, Ordering::Release);
        }
        result
    }
}

/// A native projection keeps its current proof through the eventual IPC JSON
/// serialization. A failed check latches: restoration/retry cannot revive this
/// old response. Only the fixed error reaches the serializer, never IDs/text.
pub struct ActivityReadReply<T> {
    value: T,
    guard: Arc<CurrentActivityGuard>,
}
/// Opaque native visibility check for an already issued activity-bound result.
/// No IDs/content can be extracted or constructed from an IPC payload. Call on
/// an owned background task: validation retains the existing reader deadlines.
#[derive(Clone)]
pub struct ActivityVisibilityGuard(Arc<CurrentActivityGuard>);
impl ActivityVisibilityGuard {
    /// Cheap native account/observation/expiry check; starts no reader query.
    pub fn is_observation_current(&self) -> bool {
        self.0.current()
    }
    pub fn is_current(&self) -> bool {
        self.0.validate().is_ok()
    }
}
impl<T> ActivityReadReply<T> {
    pub(crate) fn new(value: T, guard: CurrentActivityGuard) -> Result<Self, Error> {
        guard.validate()?;
        Ok(Self {
            value,
            guard: Arc::new(guard),
        })
    }
    pub fn visibility_guard(&self) -> Option<ActivityVisibilityGuard> {
        (!self.guard.proofs.is_empty()).then(|| ActivityVisibilityGuard(Arc::clone(&self.guard)))
    }
    pub fn try_map<U>(
        self,
        project: impl FnOnce(T) -> Result<U, Error>,
    ) -> Result<ActivityReadReply<U>, Error> {
        self.guard.validate()?;
        let value = project(self.value)?;
        self.guard.validate()?;
        Ok(ActivityReadReply {
            value,
            guard: self.guard,
        })
    }
}
impl<T: Serialize> Serialize for ActivityReadReply<T> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::Error as _;
        self.guard
            .validate()
            .map_err(|_| S::Error::custom("screen context activity invalidated"))?;
        let result = self.value.serialize(serializer).map_err(|_| {
            self.guard.invalidated.store(true, Ordering::Release);
            S::Error::custom("screen context activity invalidated")
        })?;
        self.guard
            .validate()
            .map_err(|_| S::Error::custom("screen context activity invalidated"))?;
        Ok(result)
    }
}

#[cfg(test)]
mod tests;
