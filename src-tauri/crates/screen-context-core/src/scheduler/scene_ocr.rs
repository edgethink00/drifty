//! Post-storage OCR on the existing owned worker. No extra recorder/thread or
//! unbounded queue. A newer capture request cancels this optional work first.
use super::*;
use crate::{SceneRegion, TextSource};
use zeroize::Zeroizing;

/// The window a scene's text came from: process, window and, when known, the
/// title digest, so a new page or document in the same window counts as new.
#[derive(Clone, PartialEq, Eq)]
pub(super) struct Surface {
    pid: u32,
    process_birth: u64,
    window_id: u64,
    title: Option<String>,
}
impl Surface {
    pub(super) fn of(
        foreground: &crate::SceneForeground,
        title: Option<&crate::native::WindowTitleDigest>,
    ) -> Self {
        Self {
            pid: foreground.pid,
            process_birth: foreground.process_birth,
            window_id: foreground.window_id,
            title: title.map(|digest| digest.as_str().to_owned()),
        }
    }
}

pub(super) struct Job {
    pub id: Uuid,
    pub frame: Frame,
    pub region: SceneRegion,
    pub surface: Surface,
    pub generation: u64,
    pub epoch: u64,
    pub account: Option<AccountReadLease>,
}
pub(super) fn process(shared: &Shared, backend: &dyn CaptureBackend, job: Job) {
    let (cancel, policy) = {
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
        let Some(policy) = effective_policy(&state) else {
            return;
        };
        let flag = Arc::new(AtomicBool::new(false));
        state.deferred_active = Some(Arc::clone(&flag));
        (flag, policy)
    };
    let mut cancellation = Cancellation {
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
                drop(state);
                // An unchanged scene needs no warm model between samples.
                // Only the owned worker touches the backend; reset cannot spawn.
                backend.reset();
                return;
            }
            // A changed screen of the window recognized moments ago keeps its
            // stored image without text. The earlier source stays the reuse
            // hint, so returning to that exact screen still reuses its text.
            let recent = state
                .last_fresh_scene_ocr
                .as_ref()
                .is_some_and(|(epoch, surface, at)| {
                    *epoch == job.epoch
                        && *surface == job.surface
                        && at.elapsed() < state.same_surface_ocr_interval
                });
            if recent {
                state.previous_scene_ocr = previous.filter(|(epoch, _)| *epoch == job.epoch);
                state.deferred_active = None;
                drop(state);
                backend.reset();
                return;
            }
        }
    }
    if cancellation.is_cancelled() {
        lock(shared).deferred_active = None;
        backend.reset();
        return;
    }
    // The image is already readable. Prepare only on a reuse miss, under the
    // same flag/account/epoch as recognition, without extending its deadline.
    cancellation.deadline = Instant::now() + PREPARATION_DEADLINE;
    let prepared = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        backend.prepare_scene_ocr(&policy, &cancellation)
    }))
    .unwrap_or(Err(CaptureFailure::Unavailable));
    if prepared.is_err() || cancellation.is_cancelled() {
        lock(shared).deferred_active = None;
        backend.reset();
        return;
    }
    cancellation.deadline = Instant::now() + CAPTURE_DEADLINE;
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
        state.last_fresh_scene_ocr = Some((job.epoch, job.surface, Instant::now()));
    }
}

#[cfg(test)]
mod tests;
