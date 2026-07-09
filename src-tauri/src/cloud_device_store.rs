use keyring::{Entry, Error as KeyringError};
use serde::Serialize;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

const CLOUD_DEVICE_KEYCHAIN_SERVICE: &str = "so.drifty.cloud-device";
const CLOUD_DEVICE_KEYCHAIN_ACCOUNT: &str = "desktop-install";
const CLOUD_DEVICE_INSTALL_ID_FILE: &str = "cloud-device-install-id";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudDeviceIdentity {
    install_id: String,
    label: String,
}

fn keychain_entry() -> Result<Entry, String> {
    Entry::new(CLOUD_DEVICE_KEYCHAIN_SERVICE, CLOUD_DEVICE_KEYCHAIN_ACCOUNT)
        .map_err(|error| format!("Unable to open Cloud device Keychain entry: {error}"))
}

pub fn load_or_create_install_id(app: &AppHandle) -> Result<String, String> {
    // Two-instance QA on one machine: the Keychain item is machine-global, so a
    // second dev instance would otherwise register as the same cloud device.
    // Debug builds only — release binaries always use the Keychain identity.
    #[cfg(debug_assertions)]
    if let Ok(override_id) = std::env::var("DRIFTY_CLOUD_DEVICE_INSTALL_ID") {
        if let Some(install_id) = normalized_install_id(&override_id) {
            return Ok(install_id);
        }
    }

    let backup_path = install_id_file_path(app)?;
    let entry = match keychain_entry() {
        Ok(entry) => entry,
        Err(error) => return read_backup_install_id(&backup_path)?.ok_or(error),
    };

    match entry.get_password() {
        Ok(value) if normalized_install_id(&value).is_some() => {
            let install_id = normalized_install_id(&value)
                .ok_or_else(|| "Unable to normalize Cloud device id from Keychain.".to_string())?;
            let _ = save_backup_install_id(&backup_path, &install_id);
            Ok(install_id)
        }
        Ok(_) | Err(KeyringError::NoEntry) => {
            if let Some(install_id) = read_backup_install_id(&backup_path)? {
                let _ = entry.set_password(&install_id);
                return Ok(install_id);
            }

            let install_id = Uuid::new_v4().to_string();
            entry
                .set_password(&install_id)
                .map_err(|error| format!("Unable to save Cloud device id in Keychain: {error}"))?;
            let _ = save_backup_install_id(&backup_path, &install_id);
            Ok(install_id)
        }
        Err(error) => read_backup_install_id(&backup_path)?
            .ok_or_else(|| format!("Unable to read Cloud device id from Keychain: {error}")),
    }
}

pub fn load_or_create_identity(app: &AppHandle) -> Result<CloudDeviceIdentity, String> {
    Ok(CloudDeviceIdentity {
        install_id: load_or_create_install_id(app)?,
        label: cloud_device_label(),
    })
}

fn install_id_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join(CLOUD_DEVICE_INSTALL_ID_FILE))
        .map_err(|error| format!("Unable to resolve Cloud device id backup path: {error}"))
}

fn read_backup_install_id(path: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(path) {
        Ok(value) => Ok(normalized_install_id(&value)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!(
            "Unable to read Cloud device id backup at {}: {error}",
            path.display()
        )),
    }
}

fn save_backup_install_id(path: &Path, install_id: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Unable to create Cloud device id backup directory at {}: {error}",
                parent.display()
            )
        })?;
    }
    fs::write(path, install_id).map_err(|error| {
        format!(
            "Unable to save Cloud device id backup at {}: {error}",
            path.display()
        )
    })?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(|error| {
            format!(
                "Unable to restrict Cloud device id backup permissions at {}: {error}",
                path.display()
            )
        })?;
    }

    Ok(())
}

fn normalized_install_id(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if Uuid::parse_str(trimmed).is_ok() {
        Some(trimmed.to_string())
    } else {
        None
    }
}

fn cloud_device_label() -> String {
    let profile = read_hardware_profile();
    let model_identifier = command_stdout("/usr/sbin/sysctl", &["-n", "hw.model"]);
    let chip = profile
        .chip
        .or_else(|| command_stdout("/usr/sbin/sysctl", &["-n", "machdep.cpu.brand_string"]));

    cloud_device_label_from_parts(
        profile.model_name.as_deref(),
        model_identifier.as_deref(),
        chip.as_deref(),
    )
}

#[derive(Default)]
struct HardwareProfile {
    model_name: Option<String>,
    chip: Option<String>,
}

fn read_hardware_profile() -> HardwareProfile {
    let Some(output) = command_stdout("/usr/sbin/system_profiler", &["SPHardwareDataType"]) else {
        return HardwareProfile::default();
    };

    let mut profile = HardwareProfile::default();
    for line in output.lines() {
        if profile.model_name.is_none() {
            profile.model_name = profile_field(line, "Model Name");
        }
        if profile.chip.is_none() {
            profile.chip = profile_field(line, "Chip");
        }
    }
    profile
}

fn profile_field(line: &str, key: &str) -> Option<String> {
    let value = line.trim().strip_prefix(key)?.strip_prefix(':')?.trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

fn command_stdout(program: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(program).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }

    let value = String::from_utf8(output.stdout).ok()?;
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn cloud_device_label_from_parts(
    model_name: Option<&str>,
    model_identifier: Option<&str>,
    chip: Option<&str>,
) -> String {
    let model = model_label(model_name, model_identifier);
    match clean_field(chip) {
        Some(chip_name) => format!("{model} ({chip_name})"),
        None => model,
    }
}

fn model_label(model_name: Option<&str>, model_identifier: Option<&str>) -> String {
    if let Some(value) = clean_field(model_name) {
        return value.to_string();
    }

    if let Some(value) = model_identifier.and_then(model_name_from_identifier) {
        return value.to_string();
    }

    "Mac".to_string()
}

fn clean_field(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

fn model_name_from_identifier(identifier: &str) -> Option<&'static str> {
    let value = identifier.trim();
    if value.starts_with("MacBookPro") {
        Some("MacBook Pro")
    } else if value.starts_with("MacBookAir") {
        Some("MacBook Air")
    } else if value.starts_with("MacBook") {
        Some("MacBook")
    } else if value.starts_with("Macmini") {
        Some("Mac mini")
    } else if value.starts_with("MacStudio") {
        Some("Mac Studio")
    } else if value.starts_with("MacPro") {
        Some("Mac Pro")
    } else if value.starts_with("iMacPro") {
        Some("iMac Pro")
    } else if value.starts_with("iMac") {
        Some("iMac")
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cloud_device_label_uses_profile_model_name_and_chip_when_available() {
        let label = cloud_device_label_from_parts(
            Some("MacBook Pro"),
            Some("MacBookPro18,1"),
            Some("Apple M1 Pro"),
        );

        assert_eq!(label, "MacBook Pro (Apple M1 Pro)");
    }

    #[test]
    fn cloud_device_label_falls_back_to_model_identifier_family() {
        let label = cloud_device_label_from_parts(None, Some("MacBookAir10,1"), Some("Apple M1"));

        assert_eq!(label, "MacBook Air (Apple M1)");
    }

    #[test]
    fn cloud_device_label_omits_empty_chip_and_unknown_identifier() {
        let label = cloud_device_label_from_parts(None, Some("Mac15,6"), Some("   "));

        assert_eq!(label, "Mac");
    }

    #[test]
    fn backup_install_id_roundtrips_valid_uuid() {
        let dir = tempfile::tempdir().expect("create temp dir");
        let path = dir.path().join("nested").join(CLOUD_DEVICE_INSTALL_ID_FILE);
        let install_id = "11111111-1111-4111-8111-111111111111";

        save_backup_install_id(&path, install_id).expect("save backup id");

        assert_eq!(
            read_backup_install_id(&path).expect("read backup id"),
            Some(install_id.to_string())
        );
    }

    #[test]
    fn backup_install_id_ignores_invalid_values() {
        let dir = tempfile::tempdir().expect("create temp dir");
        let path = dir.path().join(CLOUD_DEVICE_INSTALL_ID_FILE);

        fs::write(&path, "not-a-uuid").expect("write invalid backup id");

        assert_eq!(read_backup_install_id(&path).expect("read backup id"), None);
    }

    #[test]
    fn normalized_install_id_trims_keychain_values() {
        assert_eq!(
            normalized_install_id("  22222222-2222-4222-8222-222222222222\n"),
            Some("22222222-2222-4222-8222-222222222222".to_string())
        );
    }
}
