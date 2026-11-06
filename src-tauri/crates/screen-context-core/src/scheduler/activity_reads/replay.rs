//! Replay means screens from the selected local activity intervals. This route
//! never creates a document binding or an AI input capability.
use super::*;
use crate::{LocalActivityRecordRef, MAX_ACTIVITY_REFS};

fn point_proof(rows: &[LocalActivityRecordRef], point: i64) -> Result<ActivityProof, Error> {
    ActivityProof::replay(
        rows.iter()
            .find(|r| r.contains(point))
            .ok_or(Error::Invalidated)?,
        point,
    )
}
fn validate_windows(windows: &[[i64; 2]]) -> Result<(), Error> {
    if windows.is_empty()
        || windows.len() > 64
        || windows
            .iter()
            .any(|w| w[0] < 0 || w[0] >= w[1] || w[1] > 253_402_300_799_999)
        || windows.windows(2).any(|w| w[0][1] >= w[1][0])
    {
        return Err(Error::Invalid("replay windows"));
    }
    Ok(())
}
impl ScreenContextService {
    pub fn list_replay_evidence_in_windows(
        &self,
        ids: &[String],
        cursor: Option<PageCursor>,
        limit: usize,
        windows: &[[i64; 2]],
    ) -> Result<ActivityReadReply<EvidencePage>, Error> {
        validate_windows(windows)?;
        let mut context = self.activity_read_context()?;
        let rows = context
            .reader
            .read_replay_current(ids, &|| context.current())?;
        let mut page = self.with_store_policy(|store, now, policy| {
            store.list_replay_page(
                &rows,
                cursor,
                limit.min(MAX_ACTIVITY_REFS / 2),
                &policy.ok_or(Error::Invalidated)?.excluded_apps,
                windows,
                now,
            )
        })?;
        // Preserve the scan cursor if a formerly bound record is now hidden.
        let mut visible = Vec::new();
        let mut proofs = Vec::new();
        for row in page.records {
            let Some(metadata) = self.read_metadata(row.id)? else {
                continue;
            };
            if metadata.activity_binding.is_some() {
                match self.read_bound_evidence(&mut context, row.id, false) {
                    Ok(Some(_)) => {}
                    // A stale binding hides this screen only. The page's final
                    // account/observation guard still rejects a revoked context.
                    Ok(None) | Err(Error::Invalidated) => continue,
                    Err(error) => return Err(error),
                }
                proofs.push(ActivityProof::from_metadata(&metadata)?);
            }
            proofs.push(point_proof(&rows, row.observed_at_ms)?);
            context.observation.limit_until(metadata.expires_at_ms);
            visible.push(row);
        }
        page.records = visible;
        context.reply(page, proofs)
    }

    pub fn read_replay_evidence_in_windows(
        &self,
        id: Uuid,
        include_frame: bool,
        ids: &[String],
        windows: &[[i64; 2]],
    ) -> Result<ActivityReadReply<Option<crate::ReviewEvidence>>, Error> {
        validate_windows(windows)?;
        let mut context = self.activity_read_context()?;
        let rows = context
            .reader
            .read_replay_current(ids, &|| context.current())?;
        let Some(metadata) = self.read_metadata(id)? else {
            return context.reply(None, vec![]);
        };
        let point = metadata.observed_at_ms;
        if !windows.iter().any(|w| w[0] <= point && point < w[1])
            || !rows.iter().any(|r| r.contains(point))
        {
            return context.reply(None, vec![]);
        }
        let mut proofs = vec![point_proof(&rows, point)?];
        let value = if metadata.activity_binding.is_some() {
            let Some(bound) = self.read_bound_evidence(&mut context, id, include_frame)? else {
                return context.reply(None, vec![]);
            };
            proofs.push(ActivityProof::from_metadata(&bound.metadata)?);
            crate::ReviewEvidence {
                metadata: bound.metadata,
                frame: bound.frame,
            }
        } else {
            self.with_store_policy(|store, now, policy| {
                let metadata = store.read_metadata(id, now)?.ok_or(Error::Invalidated)?;
                if metadata.activity_binding.is_some()
                    || metadata
                        .surface
                        .is_excluded(&policy.ok_or(Error::Invalidated)?.excluded_apps)
                {
                    return Err(Error::Invalidated);
                }
                let frame = if include_frame && metadata.frame_retained {
                    store.read_frame(id, now)?
                } else {
                    None
                };
                Ok(crate::ReviewEvidence { metadata, frame })
            })?
        };
        context
            .observation
            .limit_until(value.metadata.expires_at_ms);
        context.reply(Some(value), proofs)
    }
}
