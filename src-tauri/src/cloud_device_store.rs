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
    platform: &'static str,
}

fn keychain_entry(app: &AppHandle) -> Result<Entry, String> {
    Entry::new(
        &crate::credential_namespace::service_for_app(
            CLOUD_DEVICE_KEYCHAIN_SERVICE,
            &app.config().identifier,
            cfg!(debug_assertions),
        ),
        CLOUD_DEVICE_KEYCHAIN_ACCOUNT,
    )
    .map_err(|error| format!("Unable to open Cloud device credential: {error}"))
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
    let entry = match keychain_entry(app) {
        Ok(entry) => entry,
        Err(error) => return read_backup_install_id(&backup_path)?.ok_or(error),
    };

    with_device_credential_io(|| match entry.get_password() {
        Ok(value) if normalized_install_id(&value).is_some() => {
            let install_id = normalized_install_id(&value).ok_or_else(|| {
                "Unable to normalize Cloud device id from the OS credential store.".to_string()
            })?;
            let _ = save_backup_install_id(&backup_path, &install_id);
            Ok(install_id)
        }
        Ok(_) | Err(KeyringError::NoEntry) => {
            if let Some(install_id) = read_backup_install_id(&backup_path)? {
                let _ = entry.set_password(&install_id);
                return Ok(install_id);
            }

            let install_id = Uuid::new_v4().to_string();
            entry.set_password(&install_id).map_err(|error| {
                format!("Unable to save Cloud device id in the OS credential store: {error}")
            })?;
            let _ = save_backup_install_id(&backup_path, &install_id);
            Ok(install_id)
        }
        Err(error) => read_backup_install_id(&backup_path)?.ok_or_else(|| {
            format!("Unable to read Cloud device id from the OS credential store: {error}")
        }),
    })
}

pub fn load_or_create_identity(app: &AppHandle) -> Result<CloudDeviceIdentity, String> {
    Ok(CloudDeviceIdentity {
        install_id: load_or_create_install_id(app)?,
        label: cloud_device_label(),
        platform: cloud_device_platform(),
    })
}

fn cloud_device_platform() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "macos"
    }
    #[cfg(target_os = "windows")]
    {
        "windows"
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        "other"
    }
}

fn install_id_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    // Old QA builds may have backed up production's shared device ID. Preserve
    // that file, but never import it into the newly isolated QA credential.
    let file = if !cfg!(debug_assertions)
        && crate::credential_namespace::is_production_identifier(&app.config().identifier)
    {
        CLOUD_DEVICE_INSTALL_ID_FILE.to_owned()
    } else {
        format!("{CLOUD_DEVICE_INSTALL_ID_FILE}.isolated-v1")
    };
    app.path()
        .app_data_dir()
        .map(|path| path.join(file))
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
    #[cfg(target_os = "macos")]
    {
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
    #[cfg(target_os = "windows")]
    {
        windows_cloud_device_label()
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        "Computer".to_string()
    }
}

#[cfg(target_os = "windows")]
fn windows_cloud_device_label() -> String {
    // These registry values are maintained by Windows and firmware discovery.
    // Read them in-process: spawning PowerShell/CIM here can block an otherwise
    // local identity command indefinitely while Windows servicing is active.
    let manufacturer =
        windows_registry_string(r"HARDWARE\DESCRIPTION\System\BIOS", "SystemManufacturer");
    let model = windows_registry_string(r"HARDWARE\DESCRIPTION\System\BIOS", "SystemProductName");
    let cpu = windows_registry_string(
        r"HARDWARE\DESCRIPTION\System\CentralProcessor\0",
        "ProcessorNameString",
    );
    windows_device_label_from_parts(manufacturer.as_deref(), model.as_deref(), cpu.as_deref())
}

#[cfg(target_os = "windows")]
fn windows_registry_string(path: &str, value_name: &str) -> Option<String> {
    use winreg::enums::{HKEY_LOCAL_MACHINE, KEY_READ};
    use winreg::RegKey;

    let key = RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey_with_flags(path, KEY_READ)
        .ok()?;
    let value: String = key.get_value(value_name).ok()?;
    clean_field(Some(&value)).map(str::to_string)
}

fn windows_device_label_from_parts(
    manufacturer: Option<&str>,
    model: Option<&str>,
    cpu: Option<&str>,
) -> String {
    let manufacturer = clean_field(manufacturer).filter(|value| {
        !value.eq_ignore_ascii_case("System manufacturer")
            && !value.eq_ignore_ascii_case("To be filled by O.E.M.")
    });
    let model = clean_field(model).filter(|value| {
        !value.eq_ignore_ascii_case("System Product Name")
            && !value.eq_ignore_ascii_case("To be filled by O.E.M.")
    });
    let body = match (manufacturer, model) {
        (Some(maker), Some(model_name)) if !model_already_names_maker(model_name, maker) => {
            format!("{maker} {model_name}")
        }
        (_, Some(model_name)) => model_name.to_string(),
        (Some(maker), None) => maker.to_string(),
        (None, None) => "Windows PC".to_string(),
    };
    match clean_field(cpu) {
        Some(chip_name) => format!("{body} ({chip_name})"),
        None => body,
    }
}

fn model_already_names_maker(model_name: &str, maker: &str) -> bool {
    let model_tokens = maker_tokens(model_name);
    let tokens: Vec<String> = maker_tokens(maker);
    tokens
        .iter()
        .any(|token| model_tokens.iter().any(|model_token| model_token == token))
}

fn maker_tokens(maker: &str) -> Vec<String> {
    const SKIP: &[&str] = &[
        "inc",
        "inc.",
        "co",
        "co.",
        "ltd",
        "ltd.",
        "corp",
        "corp.",
        "corporation",
        "electronics",
        "computer",
        "computers",
    ];
    maker
        .split(|ch: char| !ch.is_ascii_alphanumeric())
        .filter(|part| !part.is_empty())
        .map(|part| part.to_ascii_lowercase())
        .filter(|part| !SKIP.contains(&part.as_str()) && part.len() > 1)
        .collect()
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
    fn cloud_device_platform_matches_the_native_target() {
        #[cfg(target_os = "macos")]
        assert_eq!(cloud_device_platform(), "macos");
        #[cfg(target_os = "windows")]
        assert_eq!(cloud_device_platform(), "windows");
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        assert_eq!(cloud_device_platform(), "other");
    }

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

    #[test]
    fn windows_device_label_joins_maker_and_model_and_cpu() {
        assert_eq!(
            windows_device_label_from_parts(
                Some("LG Electronics"),
                Some("16Z90Q-G.AA5BK"),
                Some("12th Gen Intel(R) Core(TM) i5-1240P")
            ),
            "LG Electronics 16Z90Q-G.AA5BK (12th Gen Intel(R) Core(TM) i5-1240P)"
        );
    }

    #[test]
    fn windows_device_label_drops_oem_placeholders() {
        assert_eq!(
            windows_device_label_from_parts(
                Some("To be filled by O.E.M."),
                Some("System Product Name"),
                Some("   ")
            ),
            "Windows PC"
        );
    }

    #[test]
    fn windows_device_label_does_not_repeat_the_maker_when_the_model_already_contains_it() {
        assert_eq!(
            windows_device_label_from_parts(Some("Dell Inc."), Some("Dell XPS 13 9310"), None),
            "Dell XPS 13 9310"
        );
    }

    #[test]
    fn windows_device_label_does_not_drop_a_short_maker_on_a_substring_match() {
        assert_eq!(
            windows_device_label_from_parts(Some("HP"), Some("GraphPad Workstation"), None),
            "HP GraphPad Workstation"
        );
    }
}

fn with_device_credential_io<T>(
    operation: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    #[cfg(target_os = "macos")]
    return crate::credential_namespace::with_keychain_interaction(false, operation);
    #[cfg(not(target_os = "macos"))]
    operation()
}
