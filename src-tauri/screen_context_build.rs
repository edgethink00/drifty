//! Build-only mode and capability selection. Also compiled into focused contract tests.
use std::{ffi::OsStr, fs, path::Path};

pub fn excluded(value: Option<&OsStr>) -> Result<bool, &'static str> {
    match value.and_then(OsStr::to_str) {
        None if value.is_none() => Ok(false),
        Some("included") => Ok(false),
        Some("excluded") => Ok(true),
        _ => Err("DRIFTY_SCREEN_CONTEXT_MODE must be exactly included or excluded (or unset)"),
    }
}

pub fn is_screen_command(command: &str) -> bool {
    command.starts_with("screen_context_")
        || command.starts_with("memory_")
        || command.starts_with("chat_memory_")
}

fn is_screen_permission(identifier: &str) -> bool {
    identifier
        .strip_prefix("allow-")
        .or_else(|| identifier.strip_prefix("deny-"))
        .is_some_and(|command| is_screen_command(&command.replace('-', "_")))
}

pub fn write_excluded_capabilities(
    source: &Path,
    output: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    // OUT_DIR only; remove stale generated files, never the checked-in sources.
    if output.exists() {
        fs::remove_dir_all(output)?;
    }
    fs::create_dir_all(output)?;
    copy_capabilities(source, output)
}

fn copy_capabilities(source: &Path, output: &Path) -> Result<(), Box<dyn std::error::Error>> {
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let path = entry.path();
        if entry.file_type()?.is_dir() {
            let child = output.join(entry.file_name());
            fs::create_dir_all(&child)?;
            copy_capabilities(&path, &child)?;
        } else if path.extension() == Some(OsStr::new("json")) {
            let mut capability: serde_json::Value = serde_json::from_slice(&fs::read(&path)?)?;
            let permissions = capability
                .get_mut("permissions")
                .and_then(serde_json::Value::as_array_mut)
                .ok_or("capability must have a permissions array")?;
            permissions.retain(|permission| {
                let identifier = permission.as_str().or_else(|| {
                    permission
                        .get("identifier")
                        .and_then(serde_json::Value::as_str)
                });
                !identifier.is_some_and(is_screen_permission)
            });
            fs::write(
                output.join(entry.file_name()),
                serde_json::to_vec_pretty(&capability)?,
            )?;
        } else {
            return Err(format!("unexpected capability format: {}", path.display()).into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_mode_is_required_and_absence_preserves_included() {
        assert_eq!(excluded(None), Ok(false));
        assert_eq!(excluded(Some(OsStr::new("included"))), Ok(false));
        assert_eq!(excluded(Some(OsStr::new("excluded"))), Ok(true));
        for invalid in ["", "false", "0", "Excluded", " excluded", "excluded "] {
            assert!(excluded(Some(OsStr::new(invalid))).is_err());
        }
        #[cfg(unix)]
        {
            use std::os::unix::ffi::OsStrExt;
            assert!(excluded(Some(OsStr::from_bytes(&[0xff]))).is_err());
        }
    }

    #[test]
    fn every_capability_loses_screen_grants_without_changing_other_permissions() {
        let temp = tempfile::tempdir().unwrap();
        let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("capabilities");
        let output = temp.path().join("selected");
        fs::create_dir(&output).unwrap();
        fs::write(output.join("stale.json"), b"stale").unwrap();
        write_excluded_capabilities(&source, &output).unwrap();
        assert!(!output.join("stale.json").exists());
        let mut removed = 0;
        for entry in fs::read_dir(source).unwrap() {
            let path = entry.unwrap().path();
            let original: serde_json::Value =
                serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
            let actual: serde_json::Value =
                serde_json::from_slice(&fs::read(output.join(path.file_name().unwrap())).unwrap())
                    .unwrap();
            let mut expected = original.clone();
            expected["permissions"].as_array_mut().unwrap().retain(|p| {
                let screen = p
                    .as_str()
                    .is_some_and(is_screen_permission);
                removed += usize::from(screen);
                !screen
            });
            assert_eq!(actual, expected);
        }
        assert_eq!(removed, 40);
    }
}
