use keyring::{Entry, Error as KeyringError};
use serde::Serialize;
use std::process::Command;
use uuid::Uuid;

const CLOUD_DEVICE_KEYCHAIN_SERVICE: &str = "so.drifty.cloud-device";
const CLOUD_DEVICE_KEYCHAIN_ACCOUNT: &str = "desktop-install";

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

pub fn load_or_create_install_id() -> Result<String, String> {
    let entry = keychain_entry()?;
    match entry.get_password() {
        Ok(value) if is_valid_install_id(&value) => Ok(value),
        Ok(_) | Err(KeyringError::NoEntry) => {
            let install_id = Uuid::new_v4().to_string();
            entry
                .set_password(&install_id)
                .map_err(|error| format!("Unable to save Cloud device id in Keychain: {error}"))?;
            Ok(install_id)
        }
        Err(error) => Err(format!(
            "Unable to read Cloud device id from Keychain: {error}"
        )),
    }
}

pub fn load_or_create_identity() -> Result<CloudDeviceIdentity, String> {
    Ok(CloudDeviceIdentity {
        install_id: load_or_create_install_id()?,
        label: cloud_device_label(),
    })
}

fn is_valid_install_id(value: &str) -> bool {
    Uuid::parse_str(value.trim()).is_ok()
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
}
