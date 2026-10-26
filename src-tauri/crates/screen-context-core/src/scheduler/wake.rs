//! One retained wake token per owned actor. Stop sets its atomic fence without
//! waiting for the store mutex, so notification must also survive the interval
//! between the actor checking that fence and actually parking.
use std::{
    sync::OnceLock,
    thread::{self, Thread},
};

#[derive(Default)]
pub(super) struct WorkerWake(OnceLock<Thread>);
impl WorkerWake {
    pub(super) fn bind_current(&self) {
        self.0
            .set(thread::current())
            .expect("one owned actor per wake");
    }
    pub(super) fn notify_all(&self) {
        if let Some(worker) = self.0.get() {
            worker.unpark();
        }
    }
    pub(super) fn notify_one(&self) {
        self.notify_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        sync::{
            atomic::{AtomicBool, Ordering},
            mpsc, Arc,
        },
        time::{Duration, Instant},
    };

    #[test]
    fn a_stop_notification_before_the_worker_actually_waits_is_retained() {
        let wake = Arc::new(WorkerWake::default());
        let actor = wake.clone();
        let (ready, registered) = mpsc::channel();
        let start = Arc::new(AtomicBool::new(false));
        let release = start.clone();
        let child = thread::spawn(move || {
            actor.bind_current();
            ready.send(()).unwrap();
            // mpsc::recv itself uses park/unpark and would consume the token
            // under test. Between the actual actor's final state check and
            // park there is no other blocking operation either.
            while !start.load(Ordering::Acquire) {
                thread::yield_now();
            }
            let now = Instant::now();
            thread::park_timeout(Duration::from_secs(1));
            now.elapsed()
        });
        registered.recv().unwrap();
        // Deliberately notify before allowing the actor to begin its wait.
        wake.notify_all();
        release.store(true, Ordering::Release);
        assert!(child.join().unwrap() < Duration::from_millis(50));
    }
}
