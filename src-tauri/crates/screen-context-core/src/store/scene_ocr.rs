//! Optional exact-image OCR enrichment. It cannot create or replace pixels,
//! extend retention, bind tracker rows, or authorize an AI recipient.
use super::*;
use crate::{SceneRegion, SceneTextScope};

impl EvidenceStore {
    /// Native caller must own the image/region job under the current recording
    /// account and generation. Failure preserves the already stored Replay.
    #[allow(clippy::too_many_arguments)]
    pub fn enrich_scene_ocr_if_current(
        &mut self,
        expected_generation: u64,
        id: Uuid,
        image_sha256: &str,
        region: SceneRegion,
        text: TextEvidence,
        now: i64,
        current: &dyn Fn() -> bool,
    ) -> Result<bool, Error> {
        if !current() {
            return Err(Error::Invalidated);
        }
        self.maintenance(now)?;
        if self.generation != expected_generation || self.capture_paused || !current() {
            return Err(Error::Invalidated);
        }
        let Some(mut metadata) = self.load_metadata(id)? else {
            return Ok(false);
        };
        if now < metadata.observed_at_ms
            || now - metadata.observed_at_ms > 10_000
            || metadata.frame_sha256 != image_sha256
            || text.source() != TextSource::Ocr
            || metadata.text.state() != TextState::NotRequested
        {
            return Ok(false);
        }
        let EvidenceSurface::ActiveDisplayScene(scene) = &mut metadata.surface else {
            return Ok(false);
        };
        if scene.foreground_region != Some(region) || scene.text_scope != SceneTextScope::None {
            return Ok(false);
        }
        scene.text_scope = SceneTextScope::ForegroundWindowRegion;
        metadata.text = text;
        validate_metadata(&metadata)?;
        let clear = self.encode_updated_header(&metadata)?;
        if clear.len() > MAX_HEADER_BYTES {
            return Err(Error::Invalid("scene OCR metadata size"));
        }
        let previous: Vec<u8> = self.db.query_row(
            "SELECT header FROM evidence WHERE id=?1",
            [id.to_string()],
            |r| r.get(0),
        )?;
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
        let indexed = self.index.get_mut(&id).ok_or(Error::Authentication)?;
        indexed.text_source = metadata.text.source();
        indexed.text_state = metadata.text.state();
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn ocr() -> TextEvidence {
        TextEvidence::new(
            TextSource::Ocr,
            TextState::Recognized,
            Zeroizing::new("owned foreground text".into()),
        )
        .unwrap()
    }
    #[test]
    fn exact_image_enrichment_preserves_pixels_time_expiry_and_excludes_late_wrong_or_deleted_jobs()
    {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("ocr");
        let mut store = crate::tests::open(&root, 1000);
        let mut scene = crate::scene::tests::scene();
        scene.text_scope = SceneTextScope::None;
        let region = scene.foreground_region.unwrap();
        let input = crate::tests::evidence(1000);
        let hash = input.frame.sha256().to_owned();
        let id = store
            .append_scene_if_current(
                store.generation(),
                scene,
                1000,
                TextEvidence::not_requested(),
                input.frame,
                true,
                1000,
                &|| true,
            )
            .unwrap();
        let before = store.read_metadata(id, 1000).unwrap().unwrap();
        assert!(!store
            .enrich_scene_ocr_if_current(
                store.generation(),
                id,
                &"f".repeat(64),
                region,
                ocr(),
                1001,
                &|| true
            )
            .unwrap());
        assert!(!store
            .enrich_scene_ocr_if_current(
                store.generation(),
                id,
                &hash,
                SceneRegion { width: 2, ..region },
                ocr(),
                1001,
                &|| true
            )
            .unwrap());
        assert!(store
            .enrich_scene_ocr_if_current(
                store.generation(),
                id,
                &hash,
                region,
                ocr(),
                1001,
                &|| false
            )
            .is_err());
        assert!(store
            .enrich_scene_ocr_if_current(
                store.generation() + 1,
                id,
                &hash,
                region,
                ocr(),
                1001,
                &|| true
            )
            .is_err());
        assert!(store
            .enrich_scene_ocr_if_current(
                store.generation(),
                id,
                &hash,
                region,
                ocr(),
                1002,
                &|| true
            )
            .unwrap());
        assert!(!store
            .enrich_scene_ocr_if_current(
                store.generation(),
                id,
                &hash,
                region,
                ocr(),
                1002,
                &|| true
            )
            .unwrap());
        drop(store);
        let mut store = crate::tests::open(&root, 1003);
        let after = store.read_metadata(id, 1003).unwrap().unwrap();
        assert_eq!(after.text.as_str(), "owned foreground text");
        assert_eq!(
            (
                after.observed_at_ms,
                after.expires_at_ms,
                after.frame_sha256.as_str()
            ),
            (
                before.observed_at_ms,
                before.expires_at_ms,
                before.frame_sha256.as_str()
            )
        );
        assert_eq!(store.read_frame(id, 1003).unwrap().unwrap().sha256(), hash);
        store.delete_record(id, 1003).unwrap();
        assert!(!store
            .enrich_scene_ocr_if_current(
                store.generation(),
                id,
                &hash,
                region,
                ocr(),
                1004,
                &|| true
            )
            .unwrap());
        assert!(store.read_frame(id, 1004).unwrap().is_none());
    }
    #[test]
    fn late_ocr_preserves_original_and_text_only_capture_does_not_gain_a_retained_frame() {
        for late in [false, true] {
            let temp = tempfile::tempdir().unwrap();
            let mut store = crate::tests::open(&temp.path().join("ocr"), 1000);
            let mut scene = crate::scene::tests::scene();
            scene.text_scope = SceneTextScope::None;
            let region = scene.foreground_region.unwrap();
            let input = crate::tests::evidence(1000);
            let hash = input.frame.sha256().to_owned();
            let id = store
                .append_scene_if_current(
                    store.generation(),
                    scene,
                    1000,
                    TextEvidence::not_requested(),
                    input.frame,
                    false,
                    1000,
                    &|| true,
                )
                .unwrap();
            let now = if late { 11001 } else { 1001 };
            assert_eq!(
                store
                    .enrich_scene_ocr_if_current(
                        store.generation(),
                        id,
                        &hash,
                        region,
                        ocr(),
                        now,
                        &|| true
                    )
                    .unwrap(),
                !late
            );
            assert!(store.read_frame(id, now).unwrap().is_none());
            let metadata = store.read_metadata(id, now).unwrap().unwrap();
            assert!(!metadata.frame_retained);
            assert_eq!(
                metadata.text.state(),
                if late {
                    TextState::NotRequested
                } else {
                    TextState::Recognized
                }
            );
        }
    }
}
