//! A native-owned recipient observation, never a transport or AI-use grant.
//! The eventual sender must verify its established connection before writing
//! content; a listener observation alone cannot close the connect/send race.
use super::*;
use drifty_screen_context_core::ai_consent::AiRecipientRevision;
use serde::{Serialize, Serializer};
use std::{
    ffi::OsString,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

pub(in crate::commands) struct ScreenRecipientObservation {
    root: PathBuf,
    identity: Arc<()>,
    revision: AiRecipientRevision,
    invalidated: AtomicBool,
    preview: Preview,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Preview {
    policy_version: u8,
    model_id: &'static str,
    model_label: &'static str,
    processing: &'static str,
    images_supported: bool,
}

pub(super) fn configuration(
    root: &Path,
    runtime_path: &Path,
    spec: ManagedAiModelSpec,
    args: &[OsString],
    current_dir: Option<&Path>,
) -> Option<Vec<u8>> {
    // A debug environment override is not the installed managed recipient.
    if runtime_path != root.join("runtime").join(super::super::RUNTIME_FILE_NAME) {
        return None;
    }
    let args = args
        .iter()
        .map(|arg| arg.to_str())
        .collect::<Option<Vec<_>>>()?;
    let current_dir = match current_dir {
        Some(path) => Some(path.to_str()?),
        None => None,
    };
    let archive_pin = super::super::install::screen_runtime_archive_pin()?;
    // Fixed-order native configuration includes the exact spawned arguments,
    // model/runtime pins and processing policy. Never includes keys/content.
    serde_json::to_vec(&(
        "drifty-owned-screen-recipient-v2",
        MANAGED_BASE_URL,
        runtime_path.to_str()?,
        spec.id,
        spec.runtime_model,
        spec.expected_sha256,
        archive_pin,
        args,
        current_dir,
        "app-owned-local-process;os-network-isolation-not-attested",
        "text-only;screen-input-policy-v2",
    ))
    .ok()
    .filter(|bytes| bytes.len() <= 16 * 1024)
}

pub(in crate::commands) fn observe(root: &Path) -> Option<ScreenRecipientObservation> {
    let mut guard = RUNTIME_CHILD.try_lock().ok()?;
    let runtime = guard.as_mut()?;
    if runtime.root != root || !eligible(runtime) {
        return None;
    }
    let spec = super::super::super::require_model(runtime.model_id).ok()?;
    let revision =
        AiRecipientRevision::from_native_configuration(runtime.screen_configuration.as_deref()?)
            .ok()?;
    Some(ScreenRecipientObservation {
        root: root.to_owned(),
        identity: Arc::clone(&runtime.screen_identity),
        revision,
        invalidated: AtomicBool::new(false),
        preview: Preview {
            policy_version: 1,
            model_id: spec.id,
            model_label: spec.label,
            processing: "app_owned_local_runtime",
            images_supported: false,
        },
    })
}

fn eligible(runtime: &mut ManagedRuntimeChild) -> bool {
    if !runtime.became_ready
        || runtime.consecutive_health_failures != 0
        || runtime.health_failure_started_at.is_some()
        || !matches!(runtime.child.try_wait(), Ok(None))
    {
        return false;
    }
    let Some(pids) = listener_pids() else {
        return false;
    };
    let pid = runtime.child.id();
    let expected = runtime
        .root
        .join("runtime")
        .join(super::super::RUNTIME_FILE_NAME);
    // Refuse missing/ambiguous/foreign listeners, even another process running
    // the same executable. Only this exact still-live Child is eligible.
    pids == [pid]
        && process_executable_matches(pid, &expected).unwrap_or(false)
        && matches!(runtime.child.try_wait(), Ok(None))
}

fn listener_pids() -> Option<Vec<u32>> {
    #[cfg(test)]
    if let Some(pids) = TEST_RUNTIME_LISTENER_PIDS.with(|current| current.borrow().clone()) {
        return Some(pids);
    }
    #[cfg(windows)]
    {
        real_runtime_listener_pids().ok()
    }
    #[cfg(not(windows))]
    {
        let mut command = Command::new("/usr/sbin/lsof");
        command.args([
            "-nP",
            "-a",
            &format!("-iTCP:{RUNTIME_PORT}"),
            "-sTCP:LISTEN",
            "-t",
        ]);
        let output =
            crate::bounded_process::output(&mut command, Duration::from_millis(200)).ok()?;
        if !output.status.success() || output.stdout.len() > 4096 {
            return None;
        }
        let mut pids = std::str::from_utf8(&output.stdout)
            .ok()?
            .lines()
            .map(|line| line.trim().parse::<u32>())
            .collect::<Result<Vec<_>, _>>()
            .ok()?;
        pids.sort_unstable();
        pids.dedup();
        Some(pids)
    }
}

impl ScreenRecipientObservation {
    fn is_current(&self) -> bool {
        if self.invalidated.load(Ordering::Acquire) {
            return false;
        }
        let valid = (|| {
            let mut guard = RUNTIME_CHILD.try_lock().ok()?;
            let runtime = guard.as_mut()?;
            if runtime.root != self.root
                || !Arc::ptr_eq(&self.identity, &runtime.screen_identity)
                || !eligible(runtime)
            {
                return None;
            }
            let current = AiRecipientRevision::from_native_configuration(
                runtime.screen_configuration.as_deref()?,
            )
            .ok()?;
            (current == self.revision).then_some(())
        })()
        .is_some();
        if !valid {
            self.invalidated.store(true, Ordering::Release);
        }
        valid
    }
}

impl drifty_screen_context_core::ai_consent::NativeAiRecipient for ScreenRecipientObservation {
    fn revision(&self) -> &AiRecipientRevision {
        &self.revision
    }
    fn is_current(&self) -> bool {
        self.is_current()
    }
    fn supports_images(&self) -> bool {
        false
    }
}

// Only this content-free display may cross IPC. The opaque process/configuration
// identity never implements Deserialize/Clone/Debug and is not a renderer token.
impl Serialize for ScreenRecipientObservation {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        if self.is_current() {
            Some(&self.preview).serialize(serializer)
        } else {
            Option::<&Preview>::None.serialize(serializer)
        }
    }
}

#[cfg(test)]
pub(in crate::commands::managed_ai) fn install_fixture(
    root: &Path,
    child: Child,
    spec: ManagedAiModelSpec,
) {
    let runtime_path = root.join("runtime").join(super::super::RUNTIME_FILE_NAME);
    let model_path = root.join(spec.file_name);
    let location = runtime_model_location(&model_path);
    let args = runtime_args(location.argument, spec);
    *RUNTIME_CHILD.lock().expect("fixture slot") = Some(ManagedRuntimeChild {
        root: root.to_owned(),
        screen_identity: Arc::new(()),
        screen_configuration: configuration(root, &runtime_path, spec, &args, location.current_dir),
        model_id: spec.id,
        child,
        started_at: Instant::now(),
        became_ready: false,
        consecutive_health_failures: 0,
        health_failure_started_at: None,
    });
}
#[cfg(test)]
impl ScreenRecipientObservation {
    pub(in crate::commands::managed_ai) fn is_current_for_tests(&self) -> bool {
        self.is_current()
    }
}

#[cfg(test)]
mod policy_tests {
    use super::*;
    #[test]
    fn screen_recipient_revision_covers_model_processing_and_exact_spawn_arguments() {
        let root = Path::new("/native-managed-root");
        let path = root
            .join("runtime")
            .join(super::super::super::RUNTIME_FILE_NAME);
        let spec = super::super::super::super::require_model("drifty-qwen3-5-4b-default").unwrap();
        let args = runtime_args(&root.join(spec.file_name), spec);
        let config = configuration(root, &path, spec, &args, None).expect("native config");
        let revision = AiRecipientRevision::from_native_configuration(&config).unwrap();
        let mut other_args = args.clone();
        other_args.push("--different-policy".into());
        let different = configuration(root, &path, spec, &other_args, None).unwrap();
        assert_ne!(
            revision,
            AiRecipientRevision::from_native_configuration(&different).unwrap()
        );
        let other_spec =
            super::super::super::super::require_model("drifty-qwen3-5-2b-economy").unwrap();
        let different = configuration(root, &path, other_spec, &args, None).unwrap();
        assert_ne!(
            revision,
            AiRecipientRevision::from_native_configuration(&different).unwrap()
        );
        assert!(configuration(root, &root.join("debug-runtime"), spec, &args, None).is_none());
        // On Windows, a relative model argument is resolved against the
        // selected model directory. Identical argv in another directory must
        // invalidate the recipient observation too.
        let relative = runtime_args(Path::new(spec.file_name), spec);
        let directory = root.join("models");
        let with_directory = configuration(root, &path, spec, &relative, Some(&directory)).unwrap();
        let changed_directory = root.join("different-models");
        let different_directory =
            configuration(root, &path, spec, &relative, Some(&changed_directory)).unwrap();
        let inherited_directory = configuration(root, &path, spec, &relative, None).unwrap();
        let revision_for =
            |bytes: &[u8]| AiRecipientRevision::from_native_configuration(bytes).unwrap();
        assert_ne!(
            revision_for(&with_directory),
            revision_for(&different_directory)
        );
        assert_ne!(
            revision_for(&with_directory),
            revision_for(&inherited_directory)
        );
        let json = String::from_utf8(config).unwrap();
        assert!(json.contains(spec.expected_sha256));
        assert!(json.contains("os-network-isolation-not-attested"));
        assert!(json.contains("text-only;screen-input-policy-v2"));
    }
}
