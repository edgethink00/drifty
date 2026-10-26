//! Existing one-second native clock invalidates activity-linked content that
//! is already visible when the tracker later trims/deletes/replaces its row.
//! The existing two-second view status poll renews observation; an abandoned
//! view loses its guard after5s and receives invalidation before checks stop.
//! Only two opaque guards are held: the visible page and the visible detail.
use super::*;
use drifty_screen_context_core::ActivityVisibilityGuard;
use tauri::Emitter;

const VISIBLE_FOR: Duration = Duration::from_secs(5);
#[cfg(test)]
mod tests;

#[derive(Default)]
pub(super) struct VisibleEvidence {
    generation: u64,
    page: Option<ActivityVisibilityGuard>,
    detail: Option<ActivityVisibilityGuard>,
    until: Option<Instant>,
}
impl VisibleEvidence {
    fn clear(&mut self) {
        self.page = None;
        self.detail = None;
        self.until = None;
    }
    fn has_guard(&self) -> bool {
        self.page.is_some() || self.detail.is_some()
    }
    fn discard_if_stale(&mut self, now: Instant, generation: u64) -> bool {
        if self.generation != generation {
            self.clear();
            self.generation = generation;
            return false;
        }
        if !self.has_guard() {
            return false;
        }
        let expired = self.until.is_none_or(|until| now >= until);
        let changed = expired
            || self.page.as_ref().is_some_and(|guard| !guard.is_current())
            || self
                .detail
                .as_ref()
                .is_some_and(|guard| !guard.is_current());
        if changed {
            self.clear();
        }
        changed
    }
}
impl ScreenContextRuntime {
    /// The initiating client has already cleared content (or receives the
    /// mutation's existing invalidation event). Mark obsolete watches without
    /// blocking its native admission path or sending a second late event.
    pub(super) fn forget_visibility_now(&self) {
        self.visibility_generation.fetch_add(1, Ordering::AcqRel);
    }
    pub(super) fn clear_visibility(&self) {
        self.forget_visibility_now();
        match self.visibility.lock() {
            Ok(mut visible) => visible.clear(),
            Err(error) => error.into_inner().clear(),
        }
    }
    pub(super) fn watch_page<T>(&self, reply: &ActivityReadReply<T>) -> Result<(), String> {
        let mut visible = self.visibility.lock().map_err(|_| UNAVAILABLE.to_owned())?;
        let guard = reply.visibility_guard();
        if guard
            .as_ref()
            .is_some_and(|guard| !guard.is_observation_current())
        {
            return Err(CHANGED.to_owned());
        }
        let generation = self.visibility_generation.load(Ordering::Acquire);
        if visible.generation != generation {
            visible.clear();
            visible.generation = generation;
        }
        visible.page = guard;
        visible.until = Some(Instant::now() + VISIBLE_FOR);
        Ok(())
    }
    pub(super) fn watch_detail<T>(&self, reply: &ActivityReadReply<T>) -> Result<(), String> {
        let mut visible = self.visibility.lock().map_err(|_| UNAVAILABLE.to_owned())?;
        let guard = reply.visibility_guard();
        if guard
            .as_ref()
            .is_some_and(|guard| !guard.is_observation_current())
        {
            return Err(CHANGED.to_owned());
        }
        let generation = self.visibility_generation.load(Ordering::Acquire);
        if visible.generation != generation {
            visible.clear();
            visible.generation = generation;
        }
        visible.detail = guard;
        visible.until = Some(Instant::now() + VISIBLE_FOR);
        Ok(())
    }
    pub(super) fn touch_visibility(&self) {
        if let Ok(mut visible) = self.visibility.lock() {
            if visible.has_guard() {
                visible.until = Some(Instant::now() + VISIBLE_FOR);
            }
        }
    }
    pub(super) fn tick_visibility(&self, app: &AppHandle) {
        let changed = {
            let mut visible = match self.visibility.lock() {
                Ok(value) => value,
                Err(error) => {
                    let mut value = error.into_inner();
                    let changed = value.has_guard();
                    value.clear();
                    drop(value);
                    if changed {
                        let _ = app.emit_to("main", "screen-context-invalidated", ());
                    }
                    return;
                }
            };
            let generation = self.visibility_generation.load(Ordering::Acquire);
            let changed = visible.discard_if_stale(Instant::now(), generation);
            // A deliberate mutation can cancel a lookup while it is running.
            // Its own notification owns that transition, including slow OS
            // consent/delete operations and their non-content acknowledgment.
            changed && generation == self.visibility_generation.load(Ordering::Acquire)
        };
        if changed {
            let _ = app.emit_to("main", "screen-context-invalidated", ());
        }
    }
}
