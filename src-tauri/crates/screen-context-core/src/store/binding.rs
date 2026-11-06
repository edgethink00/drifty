//! Optional native-only association writes. Callers supply a just-resolved
//! local row and the capture's generation/account/policy/deletion predicate.
//! No tracker query, timer, duration change or IPC is started by these methods.
use super::*;
use crate::{
    activity_binding::MAX_BIND_AGE_MS, ActivityBinding, LocalActivityRecordRef, MAX_ACTIVITY_REFS,
};
#[cfg(test)]
mod lifecycle_tests;
#[cfg(test)]
mod tests;

impl EvidenceStore {
    /// Attach only to an existing recent capture. The caller must have resolved
    /// `record` from the capture's native app/title/point hint, outside the store
    /// lock. This method cannot establish that native authority from an ID.
    ///
    /// No quota eviction occurs for optional binding. Cancellation restores the
    /// previous encrypted header and preserves its valid frame. An uncertain
    /// write/restore failure poisons this writer instead of serving partial data.
    pub fn bind_activity_if_current(
        &mut self,
        expected_generation: u64,
        id: Uuid,
        record: &LocalActivityRecordRef,
        now: i64,
        current: &dyn Fn() -> bool,
    ) -> Result<Option<ActivityBinding>, Error> {
        if !current() {
            return Err(Error::Invalidated);
        }
        self.maintenance(now)?;
        if expected_generation != self.generation || self.capture_paused || !current() {
            return Err(Error::Invalidated);
        }
        let Some(mut metadata) = self.load_metadata(id)? else {
            return Ok(None);
        };
        if now < metadata.observed_at_ms || now - metadata.observed_at_ms > MAX_BIND_AGE_MS {
            return Ok(None);
        }
        let Some(binding) = ActivityBinding::for_capture(record, metadata.observed_at_ms) else {
            return Ok(None);
        };
        if metadata.tracker_record_id.is_some() {
            return Err(Error::Invalidated);
        }
        if let Some(existing) = &metadata.activity_binding {
            return if *existing == binding && current() {
                Ok(Some(binding))
            } else {
                Err(Error::Invalidated)
            };
        }
        let previous: Vec<u8> = self.db.query_row(
            "SELECT header FROM evidence WHERE id=?1",
            [id.to_string()],
            |r| r.get(0),
        )?;
        metadata.activity_binding = Some(binding.clone());
        validate_metadata(&metadata)?;
        let clear = Zeroizing::new(
            serde_json::to_vec(&metadata).map_err(|_| Error::Invalid("binding metadata"))?,
        );
        if clear.len() > MAX_HEADER_BYTES {
            return Err(Error::Invalid("binding metadata size"));
        }
        let sealed = self.crypto.seal(&self.aad("metadata", id), &clear)?;
        let growth = allocated_estimate(sealed.len() as u64 + 24 * 1024, 4096);
        if self.catalog_used_bytes()?.saturating_add(growth) > self.catalog_budget
            || self
                .disk_bytes()?
                .saturating_add(allocated_estimate(64 * 1024, self.allocation_unit))
                .saturating_add(self.journal_reserve)
                > self.retention.max_bytes
        {
            return Err(Error::StorageFull);
        }
        let revision = self.revision.checked_add(1).ok_or(Error::Storage)?;
        if !current() {
            return Err(Error::Invalidated);
        }
        let result = (|| -> Result<(), Error> {
            let tx = self.db.transaction()?;
            if tx.execute(
                "UPDATE evidence SET header=?1 WHERE id=?2 AND header=?3",
                params![sealed, id.to_string(), previous],
            )? != 1
            {
                return Err(Error::Authentication);
            }
            if !current() {
                tx.rollback()?;
                return Err(Error::Invalidated);
            }
            tx.commit()?;
            Ok(())
        })();
        if let Err(error) = result {
            if !matches!(error, Error::Invalidated) {
                self.poisoned = true;
            }
            return Err(error);
        }
        self.revision = revision;
        if !current() {
            // Never remove an older valid capture to undo an optional link.
            let restore = (|| -> Result<(), Error> {
                let tx = self.db.transaction()?;
                if tx.execute(
                    "UPDATE evidence SET header=?1 WHERE id=?2 AND header=?3",
                    params![previous, id.to_string(), sealed],
                )? != 1
                {
                    return Err(Error::Authentication);
                }
                tx.commit()?;
                Ok(())
            })();
            if let Err(error) = restore {
                self.poisoned = true;
                return Err(error);
            }
            return Err(Error::Invalidated);
        }
        self.index
            .get_mut(&id)
            .ok_or(Error::Authentication)?
            .activity_binding = Some(binding.clone());
        Ok(Some(binding))
    }

    /// A guarded consumer must resolve this row afresh, then apply its native
    /// account/exclusion/deletion fence before and after this read/serialization.
    pub fn read_bound_metadata(
        &mut self,
        id: Uuid,
        current: &LocalActivityRecordRef,
        now: i64,
    ) -> Result<Option<EvidenceMetadata>, Error> {
        Ok(self.read_metadata(id, now)?.filter(|m| {
            m.activity_binding
                .as_ref()
                .is_some_and(|b| b.matches(current, m.observed_at_ms))
        }))
    }
    pub fn read_bound_frame(
        &mut self,
        id: Uuid,
        current: &LocalActivityRecordRef,
        now: i64,
    ) -> Result<Option<Frame>, Error> {
        if self.read_bound_metadata(id, current, now)?.is_none() {
            return Ok(None);
        }
        self.read_frame(id, now)
    }

    /// Current local references filter before pagination. Legacy/unbound rows
    /// cannot enter via a matching time or an old tracker_record_id string.
    pub fn list_bound_page(
        &mut self,
        current: &[LocalActivityRecordRef],
        cursor: Option<PageCursor>,
        limit: usize,
        excluded: &BTreeSet<String>,
        now: i64,
    ) -> Result<EvidencePage, Error> {
        self.list_bound_page_in_windows(current, cursor, limit, excluded, None, now)
    }

    /// Native current references still authorize each result. Windows are
    /// additional half-open view filters, never activity/provenance authority.
    pub fn list_bound_page_in_windows(
        &mut self,
        current: &[LocalActivityRecordRef],
        cursor: Option<PageCursor>,
        limit: usize,
        excluded: &BTreeSet<String>,
        windows: Option<&[[i64; 2]]>,
        now: i64,
    ) -> Result<EvidencePage, Error> {
        self.list_activity_page(current, cursor, limit, excluded, windows, now, false)
    }
    pub(crate) fn list_replay_page(
        &mut self,
        current: &[LocalActivityRecordRef],
        cursor: Option<PageCursor>,
        limit: usize,
        excluded: &BTreeSet<String>,
        windows: &[[i64; 2]],
        now: i64,
    ) -> Result<EvidencePage, Error> {
        self.list_activity_page(current, cursor, limit, excluded, Some(windows), now, true)
    }
    #[allow(clippy::too_many_arguments)]
    fn list_activity_page(
        &mut self,
        current: &[LocalActivityRecordRef],
        cursor: Option<PageCursor>,
        limit: usize,
        excluded: &BTreeSet<String>,
        windows: Option<&[[i64; 2]]>,
        now: i64,
        replay: bool,
    ) -> Result<EvidencePage, Error> {
        if windows.is_some_and(|windows| {
            windows.is_empty()
                || windows.len() > 64
                || windows
                    .iter()
                    .any(|r| r[0] < 0 || r[0] >= r[1] || r[1] > 253_402_300_799_999)
                || windows.windows(2).any(|r| r[0][1] >= r[1][0])
        }) {
            return Err(Error::Invalid("activity view window"));
        }
        if current.len() > MAX_ACTIVITY_REFS || !(1..=MAX_PAGE_RECORDS).contains(&limit) {
            return Err(Error::Invalid("activity page limit"));
        }
        let mut refs = BTreeMap::new();
        for record in current {
            if refs.insert(record.record_id(), record).is_some() {
                return Err(Error::Invalid("duplicate activity reference"));
            }
        }
        self.maintenance(now)?;
        if cursor.as_ref().is_some_and(|c| {
            c.instance != self.instance
                || c.revision != self.revision
                || c.order != PageOrder::OldestFirst
        }) {
            return Err(Error::Invalidated);
        }
        let mut rows: Vec<_> = self
            .index
            .iter()
            .filter(|(_, r)| !crate::scene::exclusion_keys_match(&r.exclusion_keys, excluded))
            .filter(|(_, r)| {
                windows.is_none_or(|ranges| {
                    ranges
                        .iter()
                        .any(|range| range[0] <= r.observed_at_ms && r.observed_at_ms < range[1])
                })
            })
            .filter(|(_, r)| {
                if replay {
                    current.iter().any(|row| row.contains(r.observed_at_ms))
                } else {
                    r.activity_binding.as_ref().is_some_and(|b| {
                        refs.get(b.record_id())
                            .is_some_and(|r2| b.matches(r2, r.observed_at_ms))
                    })
                }
            })
            .filter(|(id, r)| {
                cursor
                    .as_ref()
                    .is_none_or(|c| (r.observed_at_ms, **id) > (c.observed_at_ms, c.id))
            })
            .collect();
        rows.sort_unstable_by_key(|(id, r)| (r.observed_at_ms, **id));
        let more = rows.len() > limit;
        let records: Vec<_> = rows
            .into_iter()
            .take(limit)
            .map(|(id, r)| EvidenceSummary {
                id: *id,
                observed_at_ms: r.observed_at_ms,
                expires_at_ms: r.expires_at_ms,
                text_source: r.text_source,
                text_state: r.text_state,
                frame_retained: r.frame_bytes > 0,
            })
            .collect();
        let next_cursor = records.last().filter(|_| more).map(|r| PageCursor {
            instance: self.instance,
            revision: self.revision,
            observed_at_ms: r.observed_at_ms,
            id: r.id,
            order: PageOrder::OldestFirst,
        });
        Ok(EvidencePage {
            records,
            next_cursor,
        })
    }
}
