use super::CaptureFailure;
use std::time::{Duration, Instant};

const RETRY_DELAYS: [Duration; 3] = [
    Duration::from_secs(60),
    Duration::from_secs(120),
    Duration::from_secs(300),
];
const PERMISSION_RECHECK_DELAYS: [Duration; 3] = [
    Duration::from_secs(5),
    Duration::from_secs(15),
    Duration::from_secs(30),
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CaptureRecoveryStatus {
    Permission,
    Accessibility,
    Retrying,
    Stopped,
    Declined,
}

#[derive(Default)]
pub(super) struct CaptureRecovery {
    status: Option<CaptureRecoveryStatus>,
    retry_at: Option<Instant>,
    failures: usize,
    permission_checks: usize,
}

impl CaptureRecovery {
    pub(super) fn status(&self) -> Option<CaptureRecoveryStatus> {
        self.status
    }

    pub(super) fn allows_request(&self, now: Instant) -> bool {
        self.status.is_none() || self.retry_at.is_some_and(|at| now >= at)
    }

    pub(super) fn checking_permission(&self) -> bool {
        matches!(
            self.status,
            Some(CaptureRecoveryStatus::Permission | CaptureRecoveryStatus::Accessibility)
        )
    }

    fn wait_for_permission(&mut self, now: Instant, status: CaptureRecoveryStatus) {
        self.status = Some(status);
        self.retry_at = PERMISSION_RECHECK_DELAYS
            .get(self.permission_checks)
            .map(|delay| now + *delay);
    }

    pub(super) fn observe_permission_check(
        &mut self,
        now: Instant,
        result: Result<(), CaptureFailure>,
    ) {
        // Keep the budget until capture succeeds. A positive status query
        // followed by another capture refusal must not restart it.
        self.permission_checks += 1;
        match result {
            Ok(()) => {
                self.status = None;
                self.retry_at = None;
            }
            Err(failure) => {
                let status = match failure {
                    CaptureFailure::Permission => CaptureRecoveryStatus::Permission,
                    CaptureFailure::AccessibilityPermission => CaptureRecoveryStatus::Accessibility,
                    _ => self.status.expect("permission recheck in progress"),
                };
                self.wait_for_permission(now, status);
            }
        }
    }

    pub(super) fn observe(&mut self, now: Instant, result: Result<(), CaptureFailure>) {
        match result {
            Ok(()) => *self = Self::default(),
            Err(CaptureFailure::Permission) => {
                self.wait_for_permission(now, CaptureRecoveryStatus::Permission);
            }
            Err(CaptureFailure::AccessibilityPermission) => {
                self.wait_for_permission(now, CaptureRecoveryStatus::Accessibility);
            }
            Err(CaptureFailure::CaptureDeclined) => {
                self.status = Some(CaptureRecoveryStatus::Declined);
                self.retry_at = None;
            }
            Err(CaptureFailure::CaptureService | CaptureFailure::Deadline) => {
                self.retry_at = RETRY_DELAYS.get(self.failures).map(|delay| now + *delay);
                self.status = Some(if self.retry_at.is_some() {
                    self.failures += 1;
                    CaptureRecoveryStatus::Retrying
                } else {
                    CaptureRecoveryStatus::Stopped
                });
            }
            // Excluded windows, focus changes and cancellation say nothing
            // about the health of the system capture service.
            Err(_) => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::{lock, CAPTURE_DEADLINE};
    use super::*;
    use crate::{
        unix_millis, Cancellation, CaptureBackend, CapturePolicy, NativeCapture,
        ScreenContextService,
    };
    use std::{
        collections::BTreeSet,
        sync::{
            atomic::{AtomicUsize, Ordering},
            mpsc, Arc, Mutex,
        },
        thread,
    };

    struct RefusingCapture(CaptureFailure);

    impl CaptureBackend for RefusingCapture {
        fn capture(
            &self,
            _: &CapturePolicy,
            _: &Cancellation,
        ) -> Result<NativeCapture, CaptureFailure> {
            Err(self.0)
        }
    }

    fn active_service(
        backend: Arc<dyn CaptureBackend>,
    ) -> (tempfile::TempDir, ScreenContextService) {
        let directory = tempfile::tempdir().unwrap();
        let store = crate::tests::open(&directory.path().join("evidence"), unix_millis().unwrap());
        let service = ScreenContextService::new(backend).unwrap();
        service.enable_capture_recovery();
        service.replace_store(Some(store)).unwrap();
        service
            .set_policy(CapturePolicy {
                enabled: true,
                replay_enabled: true,
                allowed_apps: BTreeSet::from(["owned.editor".into()]),
                ..CapturePolicy::default()
            })
            .unwrap();
        service.resume_capture().unwrap();
        (directory, service)
    }

    fn wait_for(mut condition: impl FnMut() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(4);
        while !condition() {
            assert!(Instant::now() < deadline);
            thread::sleep(Duration::from_millis(1));
        }
    }

    fn make_permission_recheck_due(service: &ScreenContextService) {
        lock(&service.shared).recovery.as_mut().unwrap().retry_at = Some(Instant::now());
    }

    #[test]
    fn worker_refusal_with_unavailable_checks_stays_paused_until_user_resume() {
        let (_directory, service) =
            active_service(Arc::new(RefusingCapture(CaptureFailure::Permission)));
        assert!(service.request_sample());
        wait_for(|| service.status().recovery.is_some());
        assert_eq!(
            service.status().recovery,
            Some(CaptureRecoveryStatus::Permission)
        );
        assert!(!service.request_sample());
        for expected in 1..=PERMISSION_RECHECK_DELAYS.len() {
            make_permission_recheck_due(&service);
            assert!(service.request_sample());
            wait_for(|| {
                lock(&service.shared)
                    .recovery
                    .as_ref()
                    .unwrap()
                    .permission_checks
                    == expected
            });
            assert_eq!(
                service.status().dropped,
                1,
                "permission checks must not capture"
            );
        }
        assert!(!service.request_sample());
        assert!(service.list_page(None, 20).unwrap().records.is_empty());
        service.resume_capture().unwrap();
        assert!(service.request_sample());
    }

    #[test]
    fn capture_declined_with_a_grant_requires_explicit_reconnect() {
        let (_directory, service) =
            active_service(Arc::new(RefusingCapture(CaptureFailure::CaptureDeclined)));
        assert!(service.request_sample());
        wait_for(|| service.status().recovery == Some(CaptureRecoveryStatus::Declined));
        assert!(!service.request_sample());
        {
            let state = lock(&service.shared);
            let recovery = state.recovery.as_ref().unwrap();
            assert!(!recovery.checking_permission());
            assert!(!recovery.allows_request(Instant::now() + Duration::from_secs(3600)));
        }
        service.resume_capture().unwrap();
        assert!(service.request_sample());
    }

    #[derive(Default)]
    struct TransientRefusal(AtomicUsize);
    impl CaptureBackend for TransientRefusal {
        fn check_capture_permissions(&self, _: &Cancellation) -> Result<(), CaptureFailure> {
            Ok(())
        }

        fn capture(
            &self,
            _: &CapturePolicy,
            _: &Cancellation,
        ) -> Result<NativeCapture, CaptureFailure> {
            match self.0.fetch_add(1, Ordering::Relaxed) {
                0 => Err(CaptureFailure::AccessibilityPermission),
                _ => Err(CaptureFailure::Excluded),
            }
        }
    }

    #[test]
    fn worker_rechecks_permission_before_resuming_the_normal_capture_path() {
        let (_directory, service) = active_service(Arc::new(TransientRefusal::default()));
        assert!(service.request_sample());
        wait_for(|| service.status().recovery == Some(CaptureRecoveryStatus::Accessibility));
        assert!(!service.request_sample());
        make_permission_recheck_due(&service);
        service.set_capture_suspended(true).unwrap();
        assert!(!service.request_sample());
        service.set_capture_suspended(false).unwrap();
        assert!(service.request_sample());
        wait_for(|| service.status().last_failure == Some(CaptureFailure::Excluded));
        assert_eq!(service.status().recovery, None);
    }

    struct LateCapture {
        started: mpsc::Sender<Instant>,
        release: Mutex<mpsc::Receiver<()>>,
        calls: AtomicUsize,
    }
    impl CaptureBackend for LateCapture {
        fn capture(
            &self,
            _: &CapturePolicy,
            cancel: &Cancellation,
        ) -> Result<NativeCapture, CaptureFailure> {
            if self.calls.fetch_add(1, Ordering::Relaxed) == 0 {
                self.started.send(cancel.deadline()).unwrap();
                self.release
                    .lock()
                    .unwrap()
                    .recv_timeout(CAPTURE_DEADLINE + Duration::from_secs(3))
                    .unwrap();
                return Err(CaptureFailure::Deadline);
            }
            Err(CaptureFailure::Excluded)
        }
    }

    #[test]
    fn stale_deadline_after_lock_preserves_the_pending_capture_after_unlock() {
        let (started, capturing) = mpsc::channel();
        let (release, finish) = mpsc::channel();
        let (_directory, service) = active_service(Arc::new(LateCapture {
            started,
            release: Mutex::new(finish),
            calls: AtomicUsize::new(0),
        }));
        assert!(service.request_sample());
        let deadline = capturing.recv_timeout(Duration::from_secs(2)).unwrap();
        service.set_capture_suspended(true).unwrap();
        service.set_capture_suspended(false).unwrap();
        assert!(service.request_sample());
        wait_for(|| Instant::now() >= deadline);
        release.send(()).unwrap();
        wait_for(|| service.status().last_failure == Some(CaptureFailure::Excluded));
        assert_eq!(service.status().recovery, None);
    }

    #[test]
    fn permission_checks_are_bounded_even_when_the_check_and_capture_disagree() {
        let mut recovery = CaptureRecovery::default();
        let mut now = Instant::now();
        for delay in PERMISSION_RECHECK_DELAYS {
            recovery.observe(now, Err(CaptureFailure::Permission));
            assert!(recovery.checking_permission());
            assert!(!recovery.allows_request(now + delay - Duration::from_millis(1)));
            now += delay;
            assert!(recovery.allows_request(now));
            recovery.observe_permission_check(now, Ok(()));
            assert!(!recovery.checking_permission());
            assert!(recovery.allows_request(now));
        }
        recovery.observe(now, Err(CaptureFailure::AccessibilityPermission));
        assert_eq!(
            recovery.status(),
            Some(CaptureRecoveryStatus::Accessibility)
        );
        assert!(!recovery.allows_request(now + Duration::from_secs(3600)));
    }

    #[test]
    fn retries_only_after_each_delay_then_waits_for_explicit_resume() {
        let mut recover = CaptureRecovery::default();
        let mut now = Instant::now();
        for delay in [60, 120, 300] {
            assert!(recover.allows_request(now));
            recover.observe(now, Err(CaptureFailure::CaptureService));
            assert_eq!(recover.status(), Some(CaptureRecoveryStatus::Retrying));
            assert!(!recover.allows_request(now + Duration::from_secs(delay - 1)));
            now += Duration::from_secs(delay);
        }
        assert!(recover.allows_request(now));
        recover.observe(now, Err(CaptureFailure::Deadline));
        assert_eq!(recover.status(), Some(CaptureRecoveryStatus::Stopped));
        assert!(!recover.allows_request(now + Duration::from_secs(3600)));
    }

    #[test]
    fn successful_capture_resets_delay_and_missing_permission_pauses_requests() {
        let mut recover = CaptureRecovery::default();
        let start = Instant::now();
        recover.observe(start, Err(CaptureFailure::CaptureService));
        let resumed = start + Duration::from_secs(60);
        recover.observe(resumed, Err(CaptureFailure::Excluded));
        assert_eq!(recover.status(), Some(CaptureRecoveryStatus::Retrying));
        recover.observe(resumed, Ok(()));
        recover.observe(resumed, Err(CaptureFailure::CaptureService));
        let next = resumed + Duration::from_secs(60);
        assert!(recover.allows_request(next));
        recover.observe(next, Err(CaptureFailure::Permission));
        assert_eq!(recover.status(), Some(CaptureRecoveryStatus::Permission));
        assert!(!recover.allows_request(next));
    }
}
