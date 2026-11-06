//! Expiry-only work remains independent of an active account capability. The
//! runtime mutex serializes this owner with attaching/replacing the active DB.
use super::*;
use drifty_screen_context_core::{
    key_store::ProfileKeyProvider,
    store::{InactiveMaintenance, InactiveProfileMaintenance},
};

const MAX_MAINTENANCE_INTERVAL: Duration = Duration::from_secs(60);

#[derive(Default)]
pub(super) struct RuntimeRetention {
    owner: Option<InactiveProfileMaintenance>,
    next: Option<Instant>,
}

impl RuntimeRetention {
    pub(super) fn take_for_activity_deletion(&mut self) -> Option<InactiveProfileMaintenance> {
        self.next = None;
        self.owner.take()
    }
    pub(super) fn before_store_open(&mut self) {
        // The previous active DB has already dropped on account replacement.
        // Release our last handle before the new store acquires the device lock.
        self.owner = None;
        self.next = None;
    }

    pub(super) fn attach(&mut self, store: &EvidenceStore) {
        self.owner = Some(store.inactive_maintenance_handle());
        self.next = None;
    }

    fn maintain(
        &mut self,
        root: &std::path::Path,
        active: Option<&ScopeId>,
        keys: &mut dyn ProfileKeyProvider,
        now_ms: i64,
        now: Instant,
    ) -> Result<Option<InactiveMaintenance>, Error> {
        if self.next.is_some_and(|at| now < at) {
            return Ok(None);
        }
        // Establish backoff before any fallible filesystem/OS-key operation.
        self.next = Some(now + MAX_MAINTENANCE_INTERVAL);
        if self.owner.is_none() {
            self.owner = InactiveProfileMaintenance::open_existing(root)?;
        }
        let Some(owner) = self.owner.as_mut() else {
            return Ok(None);
        };
        let report = owner.maintain(active, keys, now_ms)?;
        if let Some(expiry) = report.next_expiry_ms {
            let delay = Duration::from_millis(expiry.saturating_sub(now_ms).max(1_000) as u64);
            self.next = Some(now + delay.min(MAX_MAINTENANCE_INTERVAL));
        }
        Ok(Some(report))
    }
}

impl ScreenContextRuntime {
    pub(crate) fn start_retention(&self, app: &AppHandle) -> Result<(), String> {
        // No worker, OS key lookup or evidence root is created before opt-in.
        if configured(app) {
            self.start_ticker(app)?;
        }
        Ok(())
    }

    pub(super) fn tick_retention(&self, app: &AppHandle) {
        let Ok(mut state) = self.state.try_lock() else {
            return;
        };
        if state.retention.next.is_some_and(|at| Instant::now() < at) || !configured(app) {
            return;
        }
        let Ok(root) = app.path().app_local_data_dir() else {
            return;
        };
        let Ok(mut keys) = NativeProfileKeys::new(&app.config().identifier) else {
            return;
        };
        let Ok(now_ms) = unix_millis() else {
            return;
        };
        let active = state.opened.then(|| state.scope.clone()).flatten();
        // No account verification or content read is needed for authenticated
        // expiry-only deletion. Keys are always queried with may_create=false.
        let _ = state.retention.maintain(
            &root.join("screen-evidence-v1"),
            active.as_ref(),
            &mut keys,
            now_ms,
            Instant::now(),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use zeroize::Zeroizing;

    struct NoKeys(usize);
    impl ProfileKeyProvider for NoKeys {
        fn profile_key(
            &mut self,
            _: &ScopeId,
            may_create: bool,
        ) -> Result<Zeroizing<[u8; 32]>, Error> {
            assert!(!may_create);
            self.0 += 1;
            Err(Error::Authentication)
        }
    }

    #[test]
    fn signed_out_timer_honors_expiry_without_an_account_or_capture_job() {
        use drifty_screen_context_core::{
            Frame, Privacy, SurfaceFacts, SurfaceIdentity, Visibility,
        };
        struct OwnedFixture;
        impl CaptureBackend for OwnedFixture {
            fn capture(
                &self,
                _: &CapturePolicy,
                _: &Cancellation,
            ) -> Result<NativeCapture, CaptureFailure> {
                let facts = SurfaceFacts {
                    identity: SurfaceIdentity {
                        pid: 7,
                        process_birth: 1,
                        window_id: 8,
                        app_id: "owned.editor".into(),
                        document_id: "owned-document".into(),
                        document_generation: 1,
                    },
                    permission: true,
                    foreground: true,
                    interactive: true,
                    protected: false,
                    visibility: Visibility::Visible,
                    privacy: Privacy::NotBrowser,
                };
                Ok(NativeCapture { before: facts.clone(), after: facts, observed_at_ms: unix_millis().unwrap(),
                    text: TextEvidence::not_requested(),
                    activity_hint: None,
                    site_admitted: false,
                    frame: Frame::from_png(STANDARD.decode("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAADklEQVR4nGPQggIGGAMAF7ICochlLlkAAAAASUVORK5CYII=").unwrap()).unwrap(),
                })
            }
        }
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("evidence");
        let scope = ScopeId::from_profile("owned-signed-out-timer").unwrap();
        let store = EvidenceStore::open(
            &root,
            scope.clone(),
            Zeroizing::new([7; 32]),
            Retention {
                ttl: Duration::from_secs(60),
                ..Retention::default()
            },
            unix_millis().unwrap(),
        )
        .unwrap();
        // Seed through the public bounded service; do not expose the core's
        // private append or profile-path APIs just for this app-level test.
        let service = ScreenContextService::new(Arc::new(OwnedFixture)).unwrap();
        service.replace_store(Some(store)).unwrap();
        service
            .set_policy(CapturePolicy {
                enabled: true,
                replay_enabled: true,
                allowed_apps: std::collections::BTreeSet::from(["owned.editor".into()]),
                ..CapturePolicy::default()
            })
            .unwrap();
        assert!(service.request_sample());
        let deadline = Instant::now() + Duration::from_secs(2);
        while service.status().accepted == 0 {
            assert!(
                Instant::now() < deadline,
                "owned fixture did not save: {:?}",
                service.status()
            );
            std::thread::sleep(Duration::from_millis(2));
        }
        service.replace_store(None).unwrap();
        let frames: Vec<_> = std::fs::read_dir(&root)
            .unwrap()
            .filter_map(|p| p.ok().filter(|p| p.path().is_dir()))
            .flat_map(|p| std::fs::read_dir(p.path()).unwrap())
            .map(|p| p.unwrap().path())
            .filter(|p| {
                p.file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with("frame-")
            })
            .collect();
        assert_eq!(frames.len(), 1);
        struct Keys(usize);
        impl ProfileKeyProvider for Keys {
            fn profile_key(
                &mut self,
                _: &ScopeId,
                may_create: bool,
            ) -> Result<Zeroizing<[u8; 32]>, Error> {
                assert!(!may_create);
                self.0 += 1;
                Ok(Zeroizing::new([7; 32]))
            }
        }
        let mut keys = Keys(0);
        let mut retention = RuntimeRetention::default();
        let start = Instant::now();
        let wall = unix_millis().unwrap();
        let report = retention
            .maintain(&root, None, &mut keys, wall, start)
            .unwrap()
            .unwrap();
        assert_eq!(report.removed_records, 0);
        let expiry = report.next_expiry_ms.unwrap();
        let delay = Duration::from_millis((expiry - wall) as u64);
        assert!(delay > Duration::from_secs(1) && delay <= MAX_MAINTENANCE_INTERVAL);
        assert!(retention
            .maintain(
                &root,
                None,
                &mut keys,
                expiry,
                start + delay - Duration::from_millis(1)
            )
            .unwrap()
            .is_none());
        assert!(frames[0].is_file());
        let report = retention
            .maintain(&root, None, &mut keys, expiry, start + delay)
            .unwrap()
            .unwrap();
        assert_eq!(report.removed_records, 1);
        assert!(!frames[0].exists());
        assert_eq!(keys.0, 2);
        retention.before_store_open();
        let reopened = EvidenceStore::open(
            &root,
            scope,
            Zeroizing::new([7; 32]),
            Retention::default(),
            expiry + 1,
        )
        .unwrap();
        retention.attach(&reopened);
        assert!(!reopened.capture_paused());
    }

    #[test]
    fn unavailable_root_has_bounded_monotonic_retry_and_never_creates_a_key() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("not-a-directory");
        std::fs::write(&path, b"preserve").unwrap();
        let start = Instant::now();
        let mut retention = RuntimeRetention::default();
        let mut keys = NoKeys(0);
        assert!(retention
            .maintain(&path, None, &mut keys, 1_000, start)
            .is_err());
        // A different wall clock cannot bypass the monotonic failure backoff.
        assert!(retention
            .maintain(
                &path,
                None,
                &mut keys,
                500_000,
                start + Duration::from_secs(59)
            )
            .unwrap()
            .is_none());
        assert!(retention
            .maintain(
                &path,
                None,
                &mut keys,
                61_000,
                start + Duration::from_secs(60)
            )
            .is_err());
        assert_eq!(keys.0, 0);
        assert_eq!(std::fs::read(path).unwrap(), b"preserve");
    }
}
