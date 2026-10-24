use std::{ffi::OsString, path::Path};

#[cfg(target_os = "macos")]
use objc2_foundation::NSProcessInfo;

use super::super::ManagedAiModelSpec;
use super::{RUNTIME_HOST, RUNTIME_PORT};

const RUNTIME_CONTEXT_SIZE: &str = "4096";
const RUNTIME_PARALLEL_SLOTS: &str = "1";
const RUNTIME_PROMPT_CACHE_MIB: &str = "256";

/// Where the runtime finds its model: the value passed to `-m` and the working
/// directory it starts in.
pub(super) struct RuntimeModelLocation<'a> {
    pub(super) argument: &'a Path,
    pub(super) current_dir: Option<&'a Path>,
}

/// The Windows llama.cpp build cannot open a model whose path contains
/// characters such as Korean, even on a Korean-locale Windows: given
/// `C:\Users\<Korean name>\...\model.gguf` it exits 1 before loading, so every
/// local model failed to start for people with such a user folder. It opens the
/// same file when started in the model's folder with the ASCII file name, so
/// Windows passes the name and sets the working directory instead.
pub(super) fn runtime_model_location(model_path: &Path) -> RuntimeModelLocation<'_> {
    runtime_model_location_for_platform(model_path, cfg!(windows))
}

fn runtime_model_location_for_platform(
    model_path: &Path,
    relative_to_model_dir: bool,
) -> RuntimeModelLocation<'_> {
    let whole_path = RuntimeModelLocation {
        argument: model_path,
        current_dir: None,
    };
    if !relative_to_model_dir {
        return whole_path;
    }
    let Some(directory) = model_path
        .parent()
        .filter(|directory| !directory.as_os_str().is_empty())
    else {
        return whole_path;
    };
    let Some(file_name) = model_path
        .file_name()
        .filter(|name| name.to_str().is_some_and(|name| name.is_ascii()))
    else {
        return whole_path;
    };
    RuntimeModelLocation {
        argument: Path::new(file_name),
        current_dir: Some(directory),
    }
}

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

    /// A Korean user folder (measured with llama.cpp b9690 on Windows) must
    /// reach the runtime only as its working directory.
    #[test]
    fn windows_runtime_starts_in_the_model_folder_with_the_file_name() {
        let model =
            Path::new("/Users/한글사용자/AppData/Roaming/drifty/managed-ai/models/qwen.gguf");
        let location = runtime_model_location_for_platform(model, true);
        assert_eq!(location.argument, Path::new("qwen.gguf"));
        assert_eq!(
            location.current_dir,
            Some(Path::new(
                "/Users/한글사용자/AppData/Roaming/drifty/managed-ai/models"
            )),
        );

        let other_platform = runtime_model_location_for_platform(model, false);
        assert_eq!(other_platform.argument, model);
        assert_eq!(other_platform.current_dir, None);

        // A file name the runtime could not read either keeps the whole path,
        // as does a bare name with no folder to start in.
        let unicode_name = Path::new("/models/모델.gguf");
        assert_eq!(
            runtime_model_location_for_platform(unicode_name, true).argument,
            unicode_name
        );
        let bare = Path::new("qwen.gguf");
        let bare_location = runtime_model_location_for_platform(bare, true);
        assert_eq!(bare_location.argument, bare);
        assert_eq!(bare_location.current_dir, None);
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
