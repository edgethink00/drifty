use serde::Serialize;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};

const PET_MODE_STARTUP_EVENT: &str = "pet-mode-native-startup-state";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PetModeStartupPhase {
    Pending,
    Ready,
    Failed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct PetModeStartupSnapshot {
    phase: PetModeStartupPhase,
    revision: u64,
}

#[derive(Clone)]
pub struct PetModeStartupState(Arc<Mutex<PetModeStartupSnapshot>>);

impl Default for PetModeStartupState {
    fn default() -> Self {
        Self(Arc::new(Mutex::new(PetModeStartupSnapshot {
            phase: PetModeStartupPhase::Pending,
            revision: 0,
        })))
    }
}

impl PetModeStartupState {
    fn snapshot(&self) -> PetModeStartupSnapshot {
        *self.0.lock().expect("pet startup state")
    }

    fn complete(&self, phase: PetModeStartupPhase) -> Option<PetModeStartupSnapshot> {
        let mut snapshot = self.0.lock().expect("pet startup state");
        if snapshot.phase != PetModeStartupPhase::Pending {
            return None;
        }
        snapshot.phase = phase;
        snapshot.revision += 1;
        Some(*snapshot)
    }
}

type OwnerTask = Box<dyn FnOnce() + Send>;

fn complete_setup(
    state: PetModeStartupState,
    succeeded: bool,
    queue_owner: impl FnOnce(OwnerTask) -> Result<(), ()>,
    notify: impl Fn(PetModeStartupSnapshot) + Send + Sync + 'static,
) {
    let notify = Arc::new(notify);
    if !succeeded {
        if let Some(snapshot) = state.complete(PetModeStartupPhase::Failed) {
            notify(snapshot);
        }
        return;
    }
    let queued_state = state.clone();
    let queued_notify = notify.clone();
    if queue_owner(Box::new(move || {
        if let Some(snapshot) = queued_state.complete(PetModeStartupPhase::Ready) {
            queued_notify(snapshot);
        }
    }))
    .is_err()
    {
        if let Some(snapshot) = state.complete(PetModeStartupPhase::Failed) {
            notify(snapshot);
        }
    }
}

/// Called before auxiliary-window recovery can swallow a failed pet setup.
pub(crate) fn finish_pet_mode_startup(app: &tauri::AppHandle, succeeded: bool) {
    let state = app.state::<PetModeStartupState>().inner().clone();
    let notify_app = app.clone();
    let notify = move |snapshot| {
        // The snapshot is already stored; a missed notification cannot lose it.
        let _ = notify_app.emit(PET_MODE_STARTUP_EVENT, snapshot);
    };
    if !succeeded {
        complete_setup(state, false, |_| Ok(()), notify);
        return;
    }
    let app = app.clone();
    // on_window_event enqueues AddEventListener. Queue from a worker after
    // registration so this completion follows it on the owner queue. Calling
    // run_on_main_thread inline in setup would not provide that boundary.
    drop(tauri::async_runtime::spawn_blocking(move || {
        complete_setup(
            state,
            true,
            |task| app.run_on_main_thread(task).map_err(|_| ()),
            notify,
        );
    }));
}

#[tauri::command]
pub fn pet_mode_get_startup_state(
    state: tauri::State<'_, PetModeStartupState>,
) -> PetModeStartupSnapshot {
    // Never wait for setup on the owner thread, or mutate/reveal a window.
    state.snapshot()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;

    #[test]
    fn ready_is_published_only_after_the_queued_listener_boundary() {
        let state = PetModeStartupState::default();
        let registered = Arc::new(Mutex::new(false));
        let listener_flag = registered.clone();
        let mut owner_queue: VecDeque<OwnerTask> = VecDeque::new();
        owner_queue.push_back(Box::new(move || *listener_flag.lock().unwrap() = true));
        let events = Arc::new(Mutex::new(Vec::new()));
        let observed = events.clone();
        let callback_state = state.clone();
        complete_setup(
            state.clone(),
            true,
            |task| {
                owner_queue.push_back(task);
                Ok(())
            },
            move |snapshot| {
                assert!(*registered.lock().unwrap());
                assert_eq!(callback_state.snapshot(), snapshot);
                observed.lock().unwrap().push(snapshot);
            },
        );
        assert_eq!(state.snapshot().phase, PetModeStartupPhase::Pending);
        assert!(events.lock().unwrap().is_empty());
        owner_queue.pop_front().unwrap()();
        assert_eq!(state.snapshot().phase, PetModeStartupPhase::Pending);
        owner_queue.pop_front().unwrap()();
        assert_eq!(state.snapshot().phase, PetModeStartupPhase::Ready);
        assert_eq!(events.lock().unwrap().len(), 1);
    }

    #[test]
    fn setup_failure_and_queue_failure_are_terminal_without_a_ready_event() {
        for succeeded in [false, true] {
            let state = PetModeStartupState::default();
            let events = Arc::new(Mutex::new(Vec::new()));
            let observed = events.clone();
            complete_setup(
                state.clone(),
                succeeded,
                |_| Err(()),
                move |snapshot| {
                    observed.lock().unwrap().push(snapshot);
                },
            );
            assert_eq!(state.snapshot().phase, PetModeStartupPhase::Failed);
            assert_eq!(state.snapshot().revision, 1);
            assert_eq!(events.lock().unwrap().len(), 1);
            assert!(state.complete(PetModeStartupPhase::Ready).is_none());
        }
    }
}
