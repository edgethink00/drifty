//! Optional exact-image OCR enrichment. It cannot create or replace pixels,
//! extend retention, bind tracker rows, or authorize an AI recipient.
use super::*;
use crate::{SceneRegion, SceneTextScope};

impl EvidenceStore {
    /// Reuse a completed OCR computation only after authenticating the exact
    /// newly captured PNG and foreground region. No plaintext cache, model
    /// change, timestamp reuse, activity binding, or consent is carried over.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn reuse_scene_ocr_if_current(
        &mut self,
        expected_generation: u64,
        id: Uuid,
        previous: Uuid,
        frame: &Frame,
        region: SceneRegion,
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
        if id == previous {
            return Ok(false);
        }
        let Some(target) = self.load_metadata(id)? else {
            return Ok(false);
        };
        let Some(source) = self.load_metadata(previous)? else {
            return Ok(false);
        };
        if source.text.source() != TextSource::Ocr
            || !matches!(
                source.text.state(),
                TextState::Recognized | TextState::NoText
            )
            || source.frame_sha256 != frame.sha256()
            || source.frame_width != frame.width()
            || source.frame_height != frame.height()
        {
            return Ok(false);
        }
        let (EvidenceSurface::ActiveDisplayScene(old), EvidenceSurface::ActiveDisplayScene(new)) =
            (&source.surface, &target.surface)
        else {
            return Ok(false);
        };
        if old.text_scope != SceneTextScope::ForegroundWindowRegion
            || old.foreground_region != Some(region)
            || new.foreground_region != Some(region)
            || old.foreground != new.foreground
            || old.display_id != new.display_id
            || old.visible_apps != new.visible_apps
            || old.exclusion_inventory != new.exclusion_inventory
        {
            return Ok(false);
        }
        // A digest is only a candidate selector. Never reuse text if its
        // retained image is missing, unauthenticated, or byte-different.
        let Some(pixels) = self.read_frame(previous, now)? else {
            return Ok(false);
        };
        if pixels.bytes() != frame.bytes() {
            return Err(Error::Authentication);
        }
        self.enrich_scene_ocr_if_current(
            expected_generation,
            id,
            frame.sha256(),
            region,
            source.text.clone(),
            now,
            current,
        )
    }

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
    fn scene_record(store: &mut EvidenceStore, at: i64, text: TextEvidence, keep: bool) -> Uuid {
        let mut scene = crate::scene::tests::scene();
        if text.state() == TextState::NotRequested {
            scene.text_scope = SceneTextScope::None;
        }
        store
            .append_scene_if_current(
                store.generation(),
                scene,
                at,
                text,
                crate::tests::evidence(at).frame,
                keep,
                at,
                &|| true,
            )
            .unwrap()
    }

    #[test]
    fn repeated_pixels_reuse_text_but_keep_new_times_and_independent_deletion() {
        for state in [TextState::Recognized, TextState::NoText] {
            let temp = tempfile::tempdir().unwrap();
            let mut store = crate::tests::open(&temp.path().join("ocr"), 1000);
            let text = TextEvidence::new(
                TextSource::Ocr,
                state,
                Zeroizing::new(if state == TextState::Recognized {
                    "same pixels".into()
                } else {
                    String::new()
                }),
            )
            .unwrap();
            let first = scene_record(&mut store, 1000, text, true);
            let next = scene_record(&mut store, 2000, TextEvidence::not_requested(), true);
            let before = store.read_metadata(next, 2000).unwrap().unwrap();
            let frame = crate::tests::evidence(2000).frame;
            let region = crate::scene::tests::scene().foreground_region.unwrap();
            assert!(store
                .reuse_scene_ocr_if_current(
                    store.generation(),
                    next,
                    first,
                    &frame,
                    region,
                    2001,
                    &|| true
                )
                .unwrap());
            let after = store.read_metadata(next, 2001).unwrap().unwrap();
            assert_eq!(after.text.state(), state);
            assert_eq!(after.observed_at_ms, before.observed_at_ms);
            assert_eq!(after.expires_at_ms, before.expires_at_ms);
            assert_eq!(after.activity_binding, before.activity_binding);
            store.delete_record(first, 2002).unwrap();
            assert_eq!(
                store
                    .read_metadata(next, 2002)
                    .unwrap()
                    .unwrap()
                    .text
                    .state(),
                state
            );
            assert_eq!(
                store.read_frame(next, 2002).unwrap().unwrap().bytes(),
                frame.bytes()
            );
        }
    }

    #[test]
    fn reuse_requires_current_authenticated_retained_pixels_and_matching_region() {
        for case in [
            "region",
            "window",
            "display",
            "no_frame",
            "unavailable",
            "deleted",
            "cancelled",
            "generation",
            "tampered",
        ] {
            let temp = tempfile::tempdir().unwrap();
            let mut store = crate::tests::open(&temp.path().join("ocr"), 1000);
            let text = if case == "unavailable" {
                TextEvidence::new(
                    TextSource::Ocr,
                    TextState::Unavailable,
                    Zeroizing::new(String::new()),
                )
                .unwrap()
            } else {
                ocr()
            };
            let first = scene_record(&mut store, 1000, text, case != "no_frame");
            let mut scene = crate::scene::tests::scene();
            scene.text_scope = SceneTextScope::None;
            match case {
                "region" => scene.foreground_region.as_mut().unwrap().width = 2,
                "window" => scene.foreground.window_id += 1,
                "display" => scene.display_id += 1,
                _ => {}
            }
            let region = scene.foreground_region.unwrap();
            let next = store
                .append_scene_if_current(
                    store.generation(),
                    scene,
                    2000,
                    TextEvidence::not_requested(),
                    crate::tests::evidence(2000).frame,
                    true,
                    2000,
                    &|| true,
                )
                .unwrap();
            let generation = store.generation();
            if case == "deleted" {
                store.delete_record(first, 2000).unwrap();
            }
            if case == "tampered" {
                let row = &store.index[&first];
                let path = store.frame_path(row.frame_id);
                let mut bytes = std::fs::read(&path).unwrap();
                bytes[0] ^= 1;
                std::fs::write(path, bytes).unwrap();
            }
            let result = store.reuse_scene_ocr_if_current(
                generation + u64::from(case == "generation"),
                next,
                first,
                &crate::tests::evidence(2000).frame,
                region,
                2001,
                &|| case != "cancelled",
            );
            assert!(!result.unwrap_or(false), "{case}");
            assert_eq!(
                store
                    .read_metadata(next, 2001)
                    .unwrap()
                    .unwrap()
                    .text
                    .state(),
                TextState::NotRequested
            );
        }
    }

    #[test]
    fn changed_pixels_and_a_forged_digest_never_reuse_text() {
        for forged_digest in [false, true] {
            let temp = tempfile::tempdir().unwrap();
            let mut store = crate::tests::open(&temp.path().join("ocr"), 1000);
            let first = scene_record(&mut store, 1000, ocr(), true);
            let mut bytes = Vec::new();
            {
                let mut encoder = png::Encoder::new(&mut bytes, 2, 2);
                encoder.set_color(png::ColorType::Rgba);
                encoder.set_depth(png::BitDepth::Eight);
                encoder
                    .write_header()
                    .unwrap()
                    .write_image_data(&[99; 16])
                    .unwrap();
            }
            let mut frame = Frame::from_png(bytes).unwrap();
            let mut scene = crate::scene::tests::scene();
            scene.text_scope = SceneTextScope::None;
            let region = scene.foreground_region.unwrap();
            let next = store
                .append_scene_if_current(
                    store.generation(),
                    scene,
                    2000,
                    TextEvidence::not_requested(),
                    frame.copy_for_processing(),
                    true,
                    2000,
                    &|| true,
                )
                .unwrap();
            if forged_digest {
                frame.sha256 = crate::tests::evidence(1000).frame.sha256;
            }
            assert!(!store
                .reuse_scene_ocr_if_current(
                    store.generation(),
                    next,
                    first,
                    &frame,
                    region,
                    2001,
                    &|| true
                )
                .unwrap_or(false));
            assert_eq!(
                store
                    .read_metadata(next, 2001)
                    .unwrap()
                    .unwrap()
                    .text
                    .state(),
                TextState::NotRequested
            );
        }
    }

    #[test]
    fn expired_source_does_not_supply_text_to_a_fresh_capture() {
        let temp = tempfile::tempdir().unwrap();
        let mut store = crate::tests::open(&temp.path().join("ocr"), 1000);
        let first = scene_record(&mut store, 1000, ocr(), true);
        let later = 1000 + crate::MAX_RETENTION.as_millis() as i64;
        let next = scene_record(&mut store, later, TextEvidence::not_requested(), true);
        assert!(!store
            .reuse_scene_ocr_if_current(
                store.generation(),
                next,
                first,
                &crate::tests::evidence(later).frame,
                crate::scene::tests::scene().foreground_region.unwrap(),
                later,
                &|| true
            )
            .unwrap());
        assert!(store.read_metadata(first, later).unwrap().is_none());
    }

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
