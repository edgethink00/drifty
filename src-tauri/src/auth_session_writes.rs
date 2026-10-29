//! Ordinary credential write coordination for a build without screen runtime.
//! No account binding, evidence revocation, profile/key access or screen state.
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Mutex,
};

#[derive(Default)]
pub(crate) struct AuthSessionWrites {
    epoch: AtomicU64,
    closed: AtomicBool,
    io: Mutex<()>,
}

impl AuthSessionWrites {
    pub(crate) fn close(&self) {
        self.closed.store(true, Ordering::Release);
    }

    pub(crate) fn change<T>(
        &self,
        change: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        let epoch = self
            .epoch
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |v| v.checked_add(1))
            .map_err(|_| {
                self.close();
                "auth_session_changed".to_owned()
            })?
            + 1;
        let _io = self
            .io
            .lock()
            .map_err(|_| "auth_session_unavailable".to_owned())?;
        self.require_current(epoch)?;
        let result = change()?;
        self.require_current(epoch)?;
        Ok(result)
    }

    fn require_current(&self, epoch: u64) -> Result<(), String> {
        if self.closed.load(Ordering::Acquire) || self.epoch.load(Ordering::Acquire) != epoch {
            Err("auth_session_changed".into())
        } else {
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{mpsc, Arc};

    #[test]
    fn newer_write_serializes_after_old_io_and_only_new_acknowledgement_succeeds() {
        let writes = Arc::new(AuthSessionWrites::default());
        let (entered_tx, entered_rx) = mpsc::channel();
        let (resume_tx, resume_rx) = mpsc::channel();
        let first = Arc::clone(&writes);
        let old = std::thread::spawn(move || {
            first.change(|| {
                entered_tx.send(()).unwrap();
                resume_rx.recv().unwrap();
                Ok("old")
            })
        });
        entered_rx.recv().unwrap();
        let next = Arc::clone(&writes);
        let new = std::thread::spawn(move || next.change(|| Ok("new")));
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        while writes.epoch.load(Ordering::Acquire) < 2 {
            assert!(std::time::Instant::now() < deadline);
            std::thread::yield_now();
        }
        resume_tx.send(()).unwrap();
        assert_eq!(old.join().unwrap(), Err("auth_session_changed".into()));
        assert_eq!(new.join().unwrap(), Ok("new"));
    }

    #[test]
    fn failure_is_propagated_and_exit_refuses_new_credential_io() {
        let writes = AuthSessionWrites::default();
        assert_eq!(
            writes.change::<()>(|| Err("storage unavailable".into())),
            Err("storage unavailable".into())
        );
        assert_eq!(writes.change(|| Ok(7)), Ok(7));
        writes.close();
        assert_eq!(
            writes.change::<()>(|| panic!("closed writes must not access credentials")),
            Err("auth_session_changed".into())
        );
    }
}
