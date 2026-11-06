//! Native resource routing and global-pause fence for both capture protocols.
use super::*;
use drifty_screen_context_core::{
    native::PreparedNativeHelperBackend, Frame, NativeSceneCapture, SceneRegion,
};
use std::path::Path;

pub(super) fn from_resource(path: &Path) -> Result<Arc<dyn CaptureBackend>, Error> {
    let legacy = PreparedNativeHelperBackend::from_activity_resource(path)?;
    #[cfg(target_os = "macos")]
    {
        Ok(Arc::new(MacBackend {
            legacy,
            scene: drifty_screen_context_core::native::NativeSceneHelperBackend::from_app_resource(
                path,
            )?
            .with_deferred_ocr(),
            general: AtomicBool::new(false),
        }))
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(Arc::new(legacy))
    }
}
#[cfg(target_os = "macos")]
struct MacBackend {
    legacy: PreparedNativeHelperBackend,
    scene: drifty_screen_context_core::native::NativeSceneHelperBackend,
    general: AtomicBool,
}
#[cfg(target_os = "macos")]
impl CaptureBackend for MacBackend {
    fn supports_scene_capture(&self) -> bool {
        true
    }
    fn supports_deferred_scene_ocr(&self) -> bool {
        true
    }
    fn needs_idle_preparation(&self) -> bool {
        !self.general.load(Ordering::Acquire) && self.legacy.needs_idle_preparation()
    }
    fn prepare(&self, policy: &CapturePolicy, cancel: &Cancellation) -> Result<(), CaptureFailure> {
        let general = policy.scope == drifty_screen_context_core::CaptureScope::ActiveDisplayScene;
        if self.general.swap(general, Ordering::AcqRel) != general {
            self.legacy.reset();
            self.scene.reset();
        }
        if general {
            self.scene.prepare(policy, cancel)
        } else {
            self.legacy.prepare(policy, cancel)
        }
    }
    fn capture(
        &self,
        policy: &CapturePolicy,
        cancel: &Cancellation,
    ) -> Result<NativeCapture, CaptureFailure> {
        self.legacy.capture(policy, cancel)
    }
    fn capture_scene(
        &self,
        policy: &CapturePolicy,
        cancel: &Cancellation,
    ) -> Result<NativeSceneCapture, CaptureFailure> {
        self.scene.capture_scene(policy, cancel)
    }
    fn recognize_scene(
        &self,
        frame: &Frame,
        region: SceneRegion,
        cancel: &Cancellation,
    ) -> Result<TextEvidence, CaptureFailure> {
        self.scene.recognize_scene(frame, region, cancel)
    }
    fn reset(&self) {
        self.legacy.reset();
        self.scene.reset();
    }
}

pub(super) struct GuardedBackend {
    pub inner: Arc<dyn CaptureBackend>,
    pub suspended: Arc<AtomicBool>,
}
impl GuardedBackend {
    fn check(&self) -> Result<(), CaptureFailure> {
        if self.suspended.load(Ordering::Acquire) {
            Err(CaptureFailure::Protected)
        } else {
            Ok(())
        }
    }
}
impl CaptureBackend for GuardedBackend {
    fn supports_scene_capture(&self) -> bool {
        self.inner.supports_scene_capture()
    }
    fn supports_deferred_scene_ocr(&self) -> bool {
        self.inner.supports_deferred_scene_ocr()
    }
    fn needs_idle_preparation(&self) -> bool {
        self.check().is_ok() && self.inner.needs_idle_preparation()
    }
    fn prepare(&self, policy: &CapturePolicy, cancel: &Cancellation) -> Result<(), CaptureFailure> {
        self.check()?;
        self.inner.prepare(policy, cancel)?;
        self.check()
    }
    fn capture(
        &self,
        policy: &CapturePolicy,
        cancel: &Cancellation,
    ) -> Result<NativeCapture, CaptureFailure> {
        self.check()?;
        let value = self.inner.capture(policy, cancel)?;
        self.check()?;
        Ok(value)
    }
    fn capture_scene(
        &self,
        policy: &CapturePolicy,
        cancel: &Cancellation,
    ) -> Result<NativeSceneCapture, CaptureFailure> {
        self.check()?;
        let value = self.inner.capture_scene(policy, cancel)?;
        self.check()?;
        Ok(value)
    }
    fn recognize_scene(
        &self,
        frame: &Frame,
        region: SceneRegion,
        cancel: &Cancellation,
    ) -> Result<TextEvidence, CaptureFailure> {
        self.check()?;
        let value = self.inner.recognize_scene(frame, region, cancel)?;
        self.check()?;
        Ok(value)
    }
    fn reset(&self) {
        self.inner.reset();
    }
}
