use super::CaptureFailure;
use std::time::{Duration, Instant};

const RETRY_DELAYS: [Duration; 3] = [
    Duration::from_secs(60),
    Duration::from_secs(120),
    Duration::from_secs(300),
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CaptureRecoveryStatus {
    Permission,
    Accessibility,
    Retrying,
    Stopped,
}

#[derive(Default)]
pub(super) struct CaptureRecovery {
    status: Option<CaptureRecoveryStatus>,
    retry_at: Option<Instant>,
    failures: usize,
}

impl CaptureRecovery {
    pub(super) fn status(&self) -> Option<CaptureRecoveryStatus> {
        self.status
    }

    pub(super) fn allows_sample(&self, now: Instant) -> bool {
        match self.status {
            None => true,
            Some(CaptureRecoveryStatus::Retrying) => self.retry_at.is_some_and(|at| now >= at),
            Some(
                CaptureRecoveryStatus::Permission
                | CaptureRecoveryStatus::Accessibility
                | CaptureRecoveryStatus::Stopped,
            ) => false,
        }
    }

    pub(super) fn observe(&mut self, now: Instant, result: Result<(), CaptureFailure>) {
        match result {
            Ok(()) => *self = Self::default(),
            Err(CaptureFailure::Permission) => {
                self.status = Some(CaptureRecoveryStatus::Permission);
                self.retry_at = None;
            }
            Err(CaptureFailure::AccessibilityPermission) => {
                self.status = Some(CaptureRecoveryStatus::Accessibility);
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
    use super::*;
    use crate::{
        unix_millis, Cancellation, CaptureBackend, CapturePolicy, NativeCapture,
        ScreenContextService,
    };
    use std::{collections::BTreeSet, sync::Arc, thread};

    struct MissingPermission;

    impl CaptureBackend for MissingPermission {
        fn capture(
            &self,
            _: &CapturePolicy,
            _: &Cancellation,
        ) -> Result<NativeCapture, CaptureFailure> {
            Err(CaptureFailure::Permission)
        }
    }

    #[test]
    fn worker_refusal_blocks_later_requests_until_user_resume() {
        let directory = tempfile::tempdir().unwrap();
        let store = crate::tests::open(&directory.path().join("evidence"), unix_millis().unwrap());
        let service = ScreenContextService::new(Arc::new(MissingPermission)).unwrap();
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
        assert!(service.request_sample());
        let deadline = Instant::now() + Duration::from_secs(2);
        while service.status().recovery.is_none() {
            assert!(Instant::now() < deadline);
            thread::sleep(Duration::from_millis(1));
        }
        assert_eq!(
            service.status().recovery,
            Some(CaptureRecoveryStatus::Permission)
        );
        assert!(!service.request_sample());
        assert!(service.list_page(None, 20).unwrap().records.is_empty());
        service.resume_capture().unwrap();
        assert!(service.request_sample());
    }

    #[test]
    fn retries_only_after_each_delay_then_waits_for_explicit_resume() {
        let mut recover = CaptureRecovery::default();
        let mut now = Instant::now();
        for delay in [60, 120, 300] {
            assert!(recover.allows_sample(now));
            recover.observe(now, Err(CaptureFailure::CaptureService));
            assert_eq!(recover.status(), Some(CaptureRecoveryStatus::Retrying));
            assert!(!recover.allows_sample(now + Duration::from_secs(delay - 1)));
            now += Duration::from_secs(delay);
        }
        assert!(recover.allows_sample(now));
        recover.observe(now, Err(CaptureFailure::Deadline));
        assert_eq!(recover.status(), Some(CaptureRecoveryStatus::Stopped));
        assert!(!recover.allows_sample(now + Duration::from_secs(3600)));
    }

    #[test]
    fn successful_capture_resets_delay_and_missing_permission_halts_capture() {
        let mut recover = CaptureRecovery::default();
        let start = Instant::now();
        recover.observe(start, Err(CaptureFailure::CaptureService));
        let resumed = start + Duration::from_secs(60);
        recover.observe(resumed, Err(CaptureFailure::Excluded));
        assert_eq!(recover.status(), Some(CaptureRecoveryStatus::Retrying));
        recover.observe(resumed, Ok(()));
        recover.observe(resumed, Err(CaptureFailure::CaptureService));
        let next = resumed + Duration::from_secs(60);
        assert!(recover.allows_sample(next));
        recover.observe(next, Err(CaptureFailure::Permission));
        assert_eq!(recover.status(), Some(CaptureRecoveryStatus::Permission));
        assert!(!recover.allows_sample(next + Duration::from_secs(3600)));
    }
}
