//! Global local-activity deletion also owns screen evidence in inactive
//! accounts. Invalidate before tracker I/O, detach every active read/store,
//! and never replay the tracker mutation if its completion reply is lost.
use super::*;
use crate::tracker::TrackerError;
use drifty_screen_context_core::store::{ActivityDeletionEffects, InactiveProfileMaintenance};
use tauri::Emitter;

fn unavailable() -> TrackerError {
    TrackerError::CommandFailed("screen_context_activity_cleanup_unavailable".into())
}

struct PolicyReady<'a>(&'a AppHandle);
impl Drop for PolicyReady<'_> {
    fn drop(&mut self) {
        let _ = self.0.emit_to("main", "screen-context-policy-ready", ());
    }
}

impl ScreenContextRuntime {
    pub(crate) fn with_activity_deletion<T>(
        &self,
        app: &AppHandle,
        change: impl FnOnce(bool) -> Result<(T, Option<ActivityDeletionEffects>), TrackerError>,
    ) -> Result<T, TrackerError> {
        let _ready = PolicyReady(app);
        let root = app
            .path()
            .app_local_data_dir()
            .map_err(|_| unavailable())?
            .join("screen-evidence-v1");
        self.forget_visibility_now();
        self.invalidate_now();
        let _ = app.emit_to("main", "screen-context-invalidated", ());
        let mut state = self.state.lock().map_err(|_| unavailable())?;
        self.invalidate_now();
        // Serialize the missing-root check with configure/profile replacement;
        // a concurrent opt-in must not create evidence during tracker deletion.
        // A permission error is never interpreted as an absent evidence root.
        match fs::symlink_metadata(&root) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return change(false).map(|(data, _)| data);
            }
            Err(_) => return Err(unavailable()),
            Ok(_) => {}
        }
        if let Some(service) = self.service.get() {
            service.replace_store(None).map_err(|_| unavailable())?;
        }
        state.opened = false;
        state.last_request = None;
        // Keep the same exclusive device lock across signed-out cleanup and
        // profile replacement. No account capability/key is created here.
        let owner = match state.retention.take_for_activity_deletion() {
            Some(owner) => Some(owner),
            None => InactiveProfileMaintenance::open_existing(&root).map_err(|_| unavailable())?,
        };
        let Some(owner) = owner else {
            return change(false).map(|(data, _)| data);
        };
        let pending = owner.begin_activity_deletion().map_err(|_| unavailable())?;
        let (data, effects) = change(true)?;
        let cleanup_complete = effects
            .and_then(|effects| {
                let mut keys = NativeProfileKeys::new(&app.config().identifier).ok()?;
                pending
                    .finish(&effects, &mut keys, unix_millis().ok()?)
                    .ok()
            })
            .is_some_and(|report| report.unavailable_profiles == 0);
        // A completed activity deletion stays completed even if keys/files or
        // an older tracker cannot confirm screen cleanup. Durable markers then
        // force authenticated recovery/purge before any affected profile read.
        // Successful deletion pauses screen recording until explicit resume.
        let _ = app.emit_to("main", "screen-context-invalidated", ());
        let _ = app.emit_to("main", "screen-context-activity-cleanup", cleanup_complete);
        Ok(data)
    }
}
