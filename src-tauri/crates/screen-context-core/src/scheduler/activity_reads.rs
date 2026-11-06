use super::*;
use crate::{
    activity_read::{ActivityProof, CurrentActivityGuard},
    activity_reader::ActivityResolver,
    ActivityReadReply, BoundActivityEvidence,
};
#[cfg(test)]
mod review_tests;
#[cfg(test)]
mod selection_tests;

struct ReadContext {
    observation: ObservationLease,
    account: Option<AccountReadLease>,
    reader: Arc<dyn ActivityResolver>,
}
mod ai_input;
mod replay;

struct UnavailableReader;
impl ActivityResolver for UnavailableReader {
    fn resolve_capture(
        &self,
        _: &crate::activity_reader::CapturedActivityHint,
        _: &dyn Fn() -> bool,
    ) -> Result<Option<crate::LocalActivityRecordRef>, Error> {
        Err(Error::WorkerUnavailable)
    }
    fn read_current(
        &self,
        _: &[String],
        _: &dyn Fn() -> bool,
    ) -> Result<Vec<crate::LocalActivityRecordRef>, Error> {
        Err(Error::WorkerUnavailable)
    }
    fn reset(&self) {}
}
impl ReadContext {
    fn current(&self) -> bool {
        self.observation.is_current()
            && self.account.as_ref().is_none_or(|lease| lease.is_current())
    }
    fn reply<T>(self, value: T, proofs: Vec<ActivityProof>) -> Result<ActivityReadReply<T>, Error> {
        ActivityReadReply::new(
            value,
            CurrentActivityGuard::new(self.observation, self.account, self.reader, proofs)?,
        )
    }
}

impl ScreenContextService {
    fn activity_read_context(&self) -> Result<ReadContext, Error> {
        self.read_context(false)
    }

    fn read_context(&self, allow_legacy_review: bool) -> Result<ReadContext, Error> {
        let state = lock(&self.shared);
        if !authorized(&state) || state.epoch != self.shared.fence.load(Ordering::Acquire) {
            return Err(Error::Invalidated);
        }
        let context = ReadContext {
            observation: self.observation_lease(),
            account: state.account.clone(),
            reader: match self.activity_reader.clone() {
                Some(reader) => reader,
                None if allow_legacy_review => Arc::new(UnavailableReader),
                None => return Err(Error::WorkerUnavailable),
            },
        };
        if !context.current() {
            return Err(Error::Invalidated);
        }
        Ok(context)
    }

    /// Settings reviews newest evidence first, including legacy unbound history.
    /// Bound summaries are shown only while their current activity still
    /// supports their captured point.
    /// A page scans at most64 entries and preserves its original cursor even
    /// when invalid bound entries are filtered. No store lock spans a query.
    pub fn list_review_evidence(
        &self,
        cursor: Option<PageCursor>,
        limit: usize,
    ) -> Result<ActivityReadReply<EvidencePage>, Error> {
        self.review_evidence_page(cursor, limit, false, None, |page, _| page)
    }

    /// Memory reconciliation must not interpret a busy/unavailable activity
    /// reader as deletion. Fail the whole snapshot while preserving its guard.
    pub fn list_memory_evidence(
        &self,
        cursor: Option<PageCursor>,
        limit: usize,
    ) -> Result<ActivityReadReply<EvidencePage>, Error> {
        self.review_evidence_page(cursor, limit, true, None, |page, _| page)
    }

    /// Resolve current activity once per bounded page, retaining its proof
    /// through projection and final serialization. No image bytes are read.
    pub fn read_memory_page(
        &self,
        cursor: Option<PageCursor>,
        limit: usize,
    ) -> Result<ActivityReadReply<crate::MemoryEvidencePage>, Error> {
        self.review_evidence_page(cursor, limit, true, None, |page, records| {
            crate::MemoryEvidencePage {
                records,
                next_cursor: page.next_cursor,
            }
        })
    }

    /// Page through the bounded encrypted catalog, charging the memory limit
    /// to distinct supported text groups, not repeated raw captures. Already
    /// represented groups need no activity query; selected records keep the
    /// ordinary current-activity proof through projection and serialization.
    pub fn read_memory_selection_page(
        &self,
        cursor: Option<PageCursor>,
        selection: &mut crate::MemorySourceSelection,
    ) -> Result<ActivityReadReply<crate::MemoryEvidencePage>, Error> {
        if selection.failed || selection.is_full() {
            return Err(Error::Invalid("memory selection finished"));
        }
        let result = self.review_evidence_page(
            cursor, crate::MAX_ACTIVITY_REFS, true, Some(selection),
            |page, records| crate::MemoryEvidencePage { records, next_cursor: page.next_cursor },
        );
        if result.is_err() {
            selection.failed = true;
        }
        result
    }

    fn review_evidence_page<T>(
        &self,
        cursor: Option<PageCursor>,
        limit: usize,
        strict: bool,
        mut selection: Option<&mut crate::MemorySourceSelection>,
        project: impl FnOnce(EvidencePage, Vec<crate::store::EvidenceMetadata>) -> T,
    ) -> Result<ActivityReadReply<T>, Error> {
        let mut context = self.read_context(true)?;
        let (mut page, mut metadata) = self.with_store_policy(|store, now, policy| {
            let policy = policy.ok_or(Error::Invalidated)?;
            let page = store.list_recent_page_excluding(
                cursor,
                limit.min(crate::MAX_ACTIVITY_REFS),
                now,
                &policy.excluded_apps,
            )?;
            let mut metadata = std::collections::BTreeMap::new();
            for row in &page.records {
                let value = store
                    .read_metadata(row.id, now)?
                    .ok_or(Error::Invalidated)?;
                if selection.as_ref().is_some_and(|s| !s.candidate(&value, now)) {
                    continue;
                }
                context.observation.limit_until(selection.as_ref()
                    .map_or(value.expires_at_ms, |s| s.expires_at(&value)));
                metadata.insert(row.id, value);
            }
            Ok((page, metadata))
        })?;
        let ids = metadata
            .values()
            .filter_map(|row| {
                row.activity_binding
                    .as_ref()
                    .map(|b| b.record_id().to_owned())
            })
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        // Reader failure hides bound entries; it cannot turn a bound entry
        // into legacy history. Existing unbound local review remains available.
        let current = if ids.is_empty() {
            Vec::new()
        } else {
            let result = context.reader.read_current(&ids, &|| context.current());
            if strict {
                result?
            } else {
                result.unwrap_or_default()
            }
        };
        let mut proofs = Vec::new();
        page.records.retain(|row| {
            let Some(value) = metadata.get(&row.id) else {
                return false;
            };
            if value.activity_binding.as_ref().is_some_and(|binding| !current
                .iter().any(|reference| binding.matches(reference, value.observed_at_ms))) {
                return false;
            }
            if selection.as_mut().is_some_and(|s| !s.select(value)) {
                return false;
            }
            if value.activity_binding.is_some() {
                proofs.push(ActivityProof::from_metadata(value).expect("bound review metadata"));
            }
            true
        });
        let records = page
            .records
            .iter()
            .filter_map(|row| metadata.remove(&row.id))
            .collect();
        context.reply(project(page, records), proofs)
    }

    /// Every bound detail uses current ID/UID/identity/point checks, including
    /// reads entered from Settings. Raw native data has no Serialize impl.
    pub fn read_review_evidence(
        &self,
        id: Uuid,
        include_frame: bool,
    ) -> Result<ActivityReadReply<Option<crate::ReviewEvidence>>, Error> {
        self.review_evidence_detail(id, include_frame, false, None)
    }

    /// Strict original lookup for an authoritative memory snapshot.
    pub fn read_memory_evidence(
        &self,
        id: Uuid,
    ) -> Result<ActivityReadReply<Option<crate::ReviewEvidence>>, Error> {
        self.review_evidence_detail(id, false, true, None)
    }

    /// An original-screen request needs a distinct unavailable result when
    /// the activity reader is busy. Only confirmed missing evidence is null.
    pub fn read_review_evidence_strict(
        &self,
        id: Uuid,
        include_frame: bool,
    ) -> Result<ActivityReadReply<Option<crate::ReviewEvidence>>, Error> {
        self.review_evidence_detail(id, include_frame, true, None)
    }

    /// Prefer a previously cited exact source for this request only. It gets
    /// the same live proof and effective expiry as a selected page. This does
    /// not cache permission or make an absent/deleted source selectable.
    pub fn read_memory_selection_source(
        &self,
        id: Uuid,
        selection: &mut crate::MemorySourceSelection,
    ) -> Result<ActivityReadReply<Option<crate::ReviewEvidence>>, Error> {
        if selection.failed || selection.is_full() {
            return Err(Error::Invalid("memory selection finished"));
        }
        let result = self.review_evidence_detail(id, false, true, Some(selection));
        if result.is_err() { selection.failed = true; }
        result
    }

    fn review_evidence_detail(
        &self,
        id: Uuid,
        include_frame: bool,
        strict: bool,
        mut selection: Option<&mut crate::MemorySourceSelection>,
    ) -> Result<ActivityReadReply<Option<crate::ReviewEvidence>>, Error> {
        let mut context = self.read_context(true)?;
        let Some(metadata) = self.read_metadata(id)? else {
            return context.reply(None, Vec::new());
        };
        let now = unix_millis()?;
        if selection.as_ref().is_some_and(|s| !s.candidate(&metadata, now)) {
            return context.reply(None, Vec::new());
        }
        context.observation.limit_until(selection.as_ref()
            .map_or(metadata.expires_at_ms, |s| s.expires_at(&metadata)));
        let reference = if let Some(binding) = metadata.activity_binding.as_ref() {
            let ids = [binding.record_id().to_owned()];
            let result = context.reader.read_current(&ids, &|| context.current());
            let current = if strict {
                result?
            } else {
                result.unwrap_or_default()
            };
            let Some(row) = current
                .into_iter()
                .find(|row| binding.matches(row, metadata.observed_at_ms))
            else {
                return context.reply(None, Vec::new());
            };
            Some(row)
        } else {
            None
        };
        let value = self.with_store_policy(|store, now, policy| {
            let policy = policy.ok_or(Error::Invalidated)?;
            let current = match reference.as_ref() {
                Some(row) => store.read_bound_metadata(id, row, now)?,
                None => store
                    .read_metadata(id, now)?
                    .filter(|row| row.activity_binding.is_none()),
            };
            let Some(metadata) =
                current.filter(|row| !row.surface.is_excluded(&policy.excluded_apps))
            else {
                return Ok(None);
            };
            let frame = if include_frame && metadata.frame_retained {
                match reference.as_ref() {
                    Some(row) => store.read_bound_frame(id, row, now)?,
                    None => store.read_frame(id, now)?,
                }
            } else {
                None
            };
            Ok(Some(crate::ReviewEvidence { metadata, frame }))
        })?;
        if let (Some(selection), Some(value)) = (selection.as_mut(), value.as_ref()) {
            if !selection.select(&value.metadata) { return context.reply(None, Vec::new()); }
        }
        let proofs = match value.as_ref() {
            Some(value) if value.metadata.activity_binding.is_some() => {
                vec![ActivityProof::from_metadata(&value.metadata)?]
            }
            _ => Vec::new(),
        };
        context.reply(value, proofs)
    }

    /// IDs select activities; native resolution supplies all identity/range
    /// proof. Unbound, reused, remote, excluded or no-longer-current rows never
    /// enter this route. No store/capture/tracker mutex spans a reader query.
    pub fn list_activity_evidence(
        &self,
        record_ids: &[String],
        cursor: Option<PageCursor>,
        limit: usize,
    ) -> Result<ActivityReadReply<EvidencePage>, Error> {
        self.list_activity_evidence_in_windows(record_ids, cursor, limit, None)
    }

    pub fn list_activity_evidence_in_windows(
        &self,
        record_ids: &[String],
        cursor: Option<PageCursor>,
        limit: usize,
        windows: Option<&[[i64; 2]]>,
    ) -> Result<ActivityReadReply<EvidencePage>, Error> {
        let mut context = self.activity_read_context()?;
        let current = context
            .reader
            .read_current(record_ids, &|| context.current())?;
        let (page, proofs) = self.with_store_policy(|store, now, policy| {
            let policy = policy.ok_or(Error::Invalidated)?;
            let page = store.list_bound_page_in_windows(
                &current,
                cursor,
                limit,
                &policy.excluded_apps,
                windows,
                now,
            )?;
            let mut proofs = Vec::with_capacity(page.records.len());
            for row in &page.records {
                let metadata = store
                    .read_metadata(row.id, now)?
                    .ok_or(Error::Invalidated)?;
                let proof = ActivityProof::from_metadata(&metadata)?;
                context.observation.limit_until(metadata.expires_at_ms);
                proofs.push(proof);
            }
            Ok((page, proofs))
        })?;
        context.reply(page, proofs)
    }

    /// Read private native data for one bound capture; the native app projects
    /// only its public detail fields through try_map(), retaining this proof
    /// until serialization completes. The WebView cannot supply the binding.
    pub fn read_activity_evidence(
        &self,
        id: Uuid,
        include_frame: bool,
    ) -> Result<ActivityReadReply<Option<BoundActivityEvidence>>, Error> {
        let mut context = self.activity_read_context()?;
        let evidence = self.read_bound_evidence(&mut context, id, include_frame)?;
        let proofs = evidence
            .as_ref()
            .map(|evidence| ActivityProof::from_metadata(&evidence.metadata))
            .transpose()?
            .into_iter()
            .collect();
        context.reply(evidence, proofs)
    }

    fn read_bound_evidence(
        &self,
        context: &mut ReadContext,
        id: Uuid,
        include_frame: bool,
    ) -> Result<Option<BoundActivityEvidence>, Error> {
        let Some(metadata) = self.read_metadata(id)? else {
            return Ok(None);
        };
        let Some(binding) = metadata.activity_binding.as_ref() else {
            return Ok(None);
        };
        context.observation.limit_until(metadata.expires_at_ms);
        let ids = [binding.record_id().to_owned()];
        let current = context.reader.read_current(&ids, &|| context.current())?;
        let Some(reference) = current
            .first()
            .filter(|row| binding.matches(row, metadata.observed_at_ms))
        else {
            return Err(Error::Invalidated);
        };
        let evidence = self.with_store_policy(|store, now, policy| {
            let policy = policy.ok_or(Error::Invalidated)?;
            let metadata = store
                .read_bound_metadata(id, reference, now)?
                .ok_or(Error::Invalidated)?;
            if metadata.surface.is_excluded(&policy.excluded_apps) {
                return Err(Error::Invalidated);
            }
            let frame = if include_frame && metadata.frame_retained {
                store.read_bound_frame(id, reference, now)?
            } else {
                None
            };
            Ok(BoundActivityEvidence { metadata, frame })
        })?;
        context
            .observation
            .limit_until(evidence.metadata.expires_at_ms);
        Ok(Some(evidence))
    }
}
