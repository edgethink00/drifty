//! Post-storage OCR on the existing owned worker. No extra recorder/thread or
//! unbounded queue. A newer capture request cancels this optional work first.
use super::*;
use crate::{SceneRegion, TextSource};
use zeroize::Zeroizing;

pub(super) struct Job {
    pub id: Uuid,
    pub frame: Frame,
    pub region: SceneRegion,
    pub generation: u64,
    pub epoch: u64,
    pub account: Option<AccountReadLease>,
}
pub(super) fn process(shared: &Shared, backend: &dyn CaptureBackend, job: Job) {
    let cancel = {
        let mut state = lock(shared);
        if state.closed
            || state.pending.is_some()
            || state.epoch != job.epoch
            || !authorized(&state)
            || !state.policy.enabled
            || !state.policy.ocr_enabled
            || state.policy.paused
        {
            return;
        }
        let flag = Arc::new(AtomicBool::new(false));
        state.deferred_active = Some(Arc::clone(&flag));
        flag
    };
    let cancellation = Cancellation {
        flag: cancel,
        fence: Arc::clone(&shared.fence),
        expected_epoch: job.epoch,
        stopping: Arc::clone(&shared.stopping),
        deadline: Instant::now() + CAPTURE_DEADLINE,
        account: job.account,
    };
    {
        let mut state = lock(shared);
        // Consume the hint even on a miss/failure. Only a successful commit in
        // this job can nominate the next source, and an epoch change rejects it.
        let previous = state.previous_scene_ocr.take();
        if !state.closed && authorized(&state) && !cancellation.is_cancelled() {
            let reused = previous
                .filter(|(epoch, _)| *epoch == job.epoch && state.epoch == job.epoch)
                .and_then(|(_, id)| {
                    let now = unix_millis().ok()?;
                    state
                        .store
                        .as_mut()?
                        .reuse_scene_ocr_if_current(
                            job.generation,
                            job.id,
                            id,
                            &job.frame,
                            job.region,
                            now,
                            &|| !cancellation.is_cancelled(),
                        )
                        .ok()
                })
                .unwrap_or(false);
            if reused {
                state.previous_scene_ocr = Some((job.epoch, job.id));
                state.deferred_active = None;
                return;
            }
        }
    }
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        backend.recognize_scene(&job.frame, job.region, &cancellation)
    }))
    .unwrap_or(Err(CaptureFailure::Unavailable));
    lock(shared).deferred_active = None;
    // Deadline/cancellation is never permission to write a late result. Replay
    // remains readable even when no enrichment can be committed.
    if cancellation.is_cancelled() {
        return;
    }
    let text = match result {
        Ok(text) if text.source() == TextSource::Ocr => text,
        Err(CaptureFailure::Cancelled | CaptureFailure::Invalidated) => return,
        _ => match TextEvidence::new(
            TextSource::Ocr,
            TextState::Unavailable,
            Zeroizing::new(String::new()),
        ) {
            Ok(text) => text,
            Err(_) => return,
        },
    };
    let mut state = lock(shared);
    if state.closed
        || state.epoch != job.epoch
        || !authorized(&state)
        || cancellation.is_cancelled()
    {
        return;
    }
    let Some(store) = state.store.as_mut() else {
        return;
    };
    let Ok(now) = unix_millis() else {
        return;
    };
    let reusable = matches!(text.state(), TextState::Recognized | TextState::NoText);
    let committed = store
        .enrich_scene_ocr_if_current(
            job.generation,
            job.id,
            job.frame.sha256(),
            job.region,
            text,
            now,
            &|| !cancellation.is_cancelled(),
        )
        .unwrap_or(false);
    if committed && reusable {
        state.previous_scene_ocr = Some((job.epoch, job.id));
    }
}

#[cfg(test)]
mod tests;
