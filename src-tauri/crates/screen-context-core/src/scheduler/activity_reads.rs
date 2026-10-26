use super::*;
use crate::{
    activity_read::{ActivityProof, CurrentActivityGuard},
    activity_reader::ActivityResolver,
    ActivityReadReply, BoundActivityEvidence,
};
#[cfg(test)]
mod review_tests;

struct ReadContext {
    observation: ObservationLease,
    account: Option<AccountReadLease>,
    reader: Arc<dyn ActivityResolver>,
}
mod ai_input;

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
        let mut context = self.read_context(true)?;
        let (mut page, metadata) = self.with_store_policy(|store, now, policy| {
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
                context.observation.limit_until(value.expires_at_ms);
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
            context
                .reader
                .read_current(&ids, &|| context.current())
                .unwrap_or_default()
        };
        let mut proofs = Vec::new();
        page.records.retain(|row| {
            let value = &metadata[&row.id];
            let Some(binding) = value.activity_binding.as_ref() else {
                return true;
            };
            if !current
                .iter()
                .any(|reference| binding.matches(reference, value.observed_at_ms))
            {
                return false;
            }
            // A binding exists in this branch, so proof construction is total.
            proofs.push(ActivityProof::from_metadata(value).expect("bound review metadata"));
            true
        });
        context.reply(page, proofs)
    }

    /// Every bound detail uses current ID/UID/identity/point checks, including
    /// reads entered from Settings. Raw native data has no Serialize impl.
    pub fn read_review_evidence(
        &self,
        id: Uuid,
        include_frame: bool,
    ) -> Result<ActivityReadReply<Option<crate::ReviewEvidence>>, Error> {
        let mut context = self.read_context(true)?;
        let Some(metadata) = self.read_metadata(id)? else {
            return context.reply(None, Vec::new());
        };
        context.observation.limit_until(metadata.expires_at_ms);
        let reference = if let Some(binding) = metadata.activity_binding.as_ref() {
            let ids = [binding.record_id().to_owned()];
            let current = context
                .reader
                .read_current(&ids, &|| context.current())
                .unwrap_or_default();
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
                current.filter(|row| !policy.excluded_apps.contains(&row.surface.app_id))
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
            if policy.excluded_apps.contains(&metadata.surface.app_id) {
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
