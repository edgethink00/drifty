use std::{ffi::OsString, path::Path};

#[cfg(target_os = "macos")]
use objc2_foundation::NSProcessInfo;

use super::super::ManagedAiModelSpec;
use super::{RUNTIME_HOST, RUNTIME_PORT};

const RUNTIME_CONTEXT_SIZE: &str = "4096";
const RUNTIME_PARALLEL_SLOTS: &str = "1";
const RUNTIME_PROMPT_CACHE_MIB: &str = "256";

pub(super) fn runtime_args(model_path: &Path, spec: ManagedAiModelSpec) -> Vec<OsString> {
    runtime_args_for_platform(model_path, spec, legacy_macos_cpu_fallback())
}

fn runtime_args_for_platform(
    model_path: &Path,
    spec: ManagedAiModelSpec,
    force_cpu: bool,
) -> Vec<OsString> {
    let mut args = Vec::from([
        OsString::from("-m"),
        model_path.as_os_str().to_owned(),
        OsString::from("--host"),
        OsString::from(RUNTIME_HOST),
        OsString::from("--port"),
        OsString::from(RUNTIME_PORT),
        OsString::from("--alias"),
        OsString::from(spec.runtime_model),
        OsString::from("--ctx-size"),
        OsString::from(RUNTIME_CONTEXT_SIZE),
        OsString::from("--parallel"),
        OsString::from(RUNTIME_PARALLEL_SLOTS),
        OsString::from("--cache-ram"),
        OsString::from(RUNTIME_PROMPT_CACHE_MIB),
        OsString::from("--reasoning"),
        OsString::from("off"),
        OsString::from("--reasoning-format"),
        OsString::from("none"),
        OsString::from("--reasoning-budget"),
        OsString::from("0"),
    ]);
    if force_cpu {
        args.extend([OsString::from("--device"), OsString::from("none")]);
    }
    args
}

#[cfg(target_os = "macos")]
fn legacy_macos_cpu_fallback() -> bool {
    // Starting a subprocess here can block model startup indefinitely if the
    // OS stalls the child before sw_vers exits. Foundation already has the
    // current version in process, so this check needs no external command.
    let major = NSProcessInfo::processInfo()
        .operatingSystemVersion()
        .majorVersion;
    legacy_macos_cpu_fallback_for_major(major)
}

#[cfg(target_os = "macos")]
fn legacy_macos_cpu_fallback_for_major(major: isize) -> bool {
    major < 26
}

#[cfg(not(target_os = "macos"))]
fn legacy_macos_cpu_fallback() -> bool {
    false
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;

    #[test]
    fn runtime_args_limit_context_slots_and_prompt_cache() {
        let spec = super::super::super::require_model("drifty-qwen3-5-4b-default")
            .expect("known managed model");
        let args = runtime_args(Path::new("/tmp/Qwen3.5-4B-Q4_K_M.gguf"), spec)
            .into_iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect::<Vec<_>>();

        assert!(args.windows(2).any(|pair| pair == ["--ctx-size", "4096"]));
        assert!(args.windows(2).any(|pair| pair == ["--parallel", "1"]));
        assert!(args.windows(2).any(|pair| pair == ["--cache-ram", "256"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--alias", "drifty-qwen3.5-4b-local"]));
    }

    #[test]
    fn legacy_macos_runtime_disables_metal() {
        let spec = super::super::super::require_model("drifty-qwen3-5-2b-economy")
            .expect("known managed model");
        let args = runtime_args_for_platform(Path::new("/tmp/Qwen3.5-2B-Q4_K_M.gguf"), spec, true)
            .into_iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect::<Vec<_>>();

        assert!(args.windows(2).any(|pair| pair == ["--device", "none"]));
    }

    #[test]
    fn current_macos_runtime_keeps_accelerated_device_selection() {
        let spec = super::super::super::require_model("drifty-qwen3-5-2b-economy")
            .expect("known managed model");
        let args = runtime_args_for_platform(Path::new("/tmp/Qwen3.5-2B-Q4_K_M.gguf"), spec, false)
            .into_iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect::<Vec<_>>();

        assert!(!args.windows(2).any(|pair| pair == ["--device", "none"]));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn legacy_cpu_fallback_stops_at_macos_26() {
        assert!(legacy_macos_cpu_fallback_for_major(15));
        assert!(!legacy_macos_cpu_fallback_for_major(26));
    }
}
