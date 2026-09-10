use serde::Serialize;
use thiserror::Error;

const BACKEND_SM_APP_SERVICE: &str = "smAppService";
#[cfg(target_os = "windows")]
const BACKEND_REGISTRY_RUN_KEY: &str = "registryRunKey";
#[cfg(target_os = "windows")]
const WINDOWS_BACKGROUND_ARG: &str = "--background";
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
const BACKEND_UNSUPPORTED: &str = "unsupported";

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StartupOpenAtLoginStatus {
    Enabled,
    NotRegistered,
    RequiresApproval,
    NotFound,
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    Unsupported,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupOpenAtLoginResponse {
    success: bool,
    enabled: bool,
    status: StartupOpenAtLoginStatus,
    backend: &'static str,
}

#[derive(Debug, Error)]
enum StartupOpenAtLoginError {
    #[cfg(target_os = "macos")]
    #[error("SMAppService {operation} failed: {message} (code {code})")]
    ServiceManagement {
        operation: &'static str,
        message: String,
        code: u32,
    },
    #[cfg(target_os = "windows")]
    #[error("registry Run key {operation} failed: {message}")]
    Registry {
        operation: &'static str,
        message: String,
    },
}

#[tauri::command]
pub fn startup_get_open_at_login_status() -> Result<StartupOpenAtLoginResponse, String> {
    Ok(current_open_at_login_response())
}

#[tauri::command]
pub fn startup_set_open_at_login_enabled(
    enabled: bool,
) -> Result<StartupOpenAtLoginResponse, String> {
    set_open_at_login_enabled(enabled).map_err(|err| err.to_string())
}

#[cfg(target_os = "macos")]
fn current_open_at_login_response() -> StartupOpenAtLoginResponse {
    let service = startup_service();
    sm_app_service_response(service.status())
}

#[cfg(target_os = "windows")]
fn current_open_at_login_response() -> StartupOpenAtLoginResponse {
    let status = windows_run_key::status();
    StartupOpenAtLoginResponse {
        success: true,
        enabled: status == StartupOpenAtLoginStatus::Enabled,
        status,
        backend: BACKEND_REGISTRY_RUN_KEY,
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn current_open_at_login_response() -> StartupOpenAtLoginResponse {
    unsupported_response()
}

#[cfg(target_os = "macos")]
fn set_open_at_login_enabled(
    enabled: bool,
) -> Result<StartupOpenAtLoginResponse, StartupOpenAtLoginError> {
    use smappservice_rs::{ServiceManagementError, ServiceStatus};

    let service = startup_service();
    let current_status = service.status();

    if enabled {
        match current_status {
            ServiceStatus::Enabled | ServiceStatus::RequiresApproval => {}
            ServiceStatus::NotRegistered | ServiceStatus::NotFound => {
                if let Err(error) = service.register() {
                    if error != ServiceManagementError::AlreadyRegistered {
                        return Err(service_management_error("register", error));
                    }
                }
            }
        }
    } else {
        match current_status {
            ServiceStatus::Enabled | ServiceStatus::RequiresApproval => {
                if let Err(error) = service.unregister() {
                    if error != ServiceManagementError::JobNotFound {
                        return Err(service_management_error("unregister", error));
                    }
                }
            }
            ServiceStatus::NotRegistered | ServiceStatus::NotFound => {}
        }
    }

    Ok(sm_app_service_response(service.status()))
}

#[cfg(target_os = "windows")]
fn set_open_at_login_enabled(
    enabled: bool,
) -> Result<StartupOpenAtLoginResponse, StartupOpenAtLoginError> {
    if enabled {
        windows_run_key::register()?;
    } else {
        windows_run_key::unregister()?;
    }
    Ok(current_open_at_login_response())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn set_open_at_login_enabled(
    _enabled: bool,
) -> Result<StartupOpenAtLoginResponse, StartupOpenAtLoginError> {
    Ok(unsupported_response())
}

#[cfg(target_os = "macos")]
fn startup_service() -> smappservice_rs::AppService {
    smappservice_rs::AppService::new(smappservice_rs::ServiceType::MainApp)
}

#[cfg(target_os = "macos")]
fn sm_app_service_response(status: smappservice_rs::ServiceStatus) -> StartupOpenAtLoginResponse {
    let status = startup_status_from_service_status(status);
    StartupOpenAtLoginResponse {
        success: true,
        enabled: status == StartupOpenAtLoginStatus::Enabled,
        status,
        backend: BACKEND_SM_APP_SERVICE,
    }
}

#[cfg(target_os = "macos")]
fn startup_status_from_service_status(
    status: smappservice_rs::ServiceStatus,
) -> StartupOpenAtLoginStatus {
    match status {
        smappservice_rs::ServiceStatus::Enabled => StartupOpenAtLoginStatus::Enabled,
        smappservice_rs::ServiceStatus::NotRegistered => StartupOpenAtLoginStatus::NotRegistered,
        smappservice_rs::ServiceStatus::RequiresApproval => {
            StartupOpenAtLoginStatus::RequiresApproval
        }
        smappservice_rs::ServiceStatus::NotFound => StartupOpenAtLoginStatus::NotFound,
    }
}

#[cfg(target_os = "macos")]
fn service_management_error(
    operation: &'static str,
    error: smappservice_rs::ServiceManagementError,
) -> StartupOpenAtLoginError {
    StartupOpenAtLoginError::ServiceManagement {
        operation,
        code: error.code(),
        message: error.to_string(),
    }
}

#[cfg(target_os = "windows")]
pub(crate) fn windows_background_launch_requested() -> bool {
    std::env::args_os().any(|arg| arg == WINDOWS_BACKGROUND_ARG)
}

/// Windows login items are values under HKCU\...\CurrentVersion\Run - no
/// service registration, no admin, and the same user-visible surface as
/// SMAppService (Task Manager's Startup tab instead of System Settings).
/// A user can also disable an item in Task Manager without deleting it;
/// that state lives in Explorer\StartupApproved and maps to
/// RequiresApproval, the same status macOS uses for "registered but off".
#[cfg(target_os = "windows")]
mod windows_run_key {
    use super::{StartupOpenAtLoginError, StartupOpenAtLoginStatus, WINDOWS_BACKGROUND_ARG};
    use std::path::Path;
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_SET_VALUE};
    use winreg::RegKey;

    const RUN_SUBKEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
    const STARTUP_APPROVED_SUBKEY: &str =
        r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";
    const VALUE_NAME: &str = "drifty";

    // First byte of the 12-byte REG_BINARY Task Manager writes: 0x03 marks a
    // user-disabled item; 0x02 (or an absent value) means enabled.
    const STARTUP_APPROVED_DISABLED: u8 = 0x03;

    pub fn status() -> StartupOpenAtLoginStatus {
        status_for(VALUE_NAME)
    }

    pub fn register() -> Result<(), StartupOpenAtLoginError> {
        register_for(VALUE_NAME)
    }

    pub fn unregister() -> Result<(), StartupOpenAtLoginError> {
        unregister_for(VALUE_NAME)
    }

    fn status_for(value_name: &str) -> StartupOpenAtLoginStatus {
        let run_key =
            RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(RUN_SUBKEY, KEY_READ);
        let Ok(run_key) = run_key else {
            return StartupOpenAtLoginStatus::NotRegistered;
        };
        let Ok(command) = run_key.get_value::<String, _>(value_name) else {
            return StartupOpenAtLoginStatus::NotRegistered;
        };
        let Ok(current_exe) = std::env::current_exe() else {
            return StartupOpenAtLoginStatus::NotFound;
        };
        if !registered_target_matches(&command, &current_exe) {
            return StartupOpenAtLoginStatus::NotFound;
        }
        if startup_approved_disabled(read_startup_approved(value_name).as_deref()) {
            return StartupOpenAtLoginStatus::RequiresApproval;
        }
        StartupOpenAtLoginStatus::Enabled
    }

    fn register_for(value_name: &str) -> Result<(), StartupOpenAtLoginError> {
        let exe =
            std::env::current_exe().map_err(|error| registry_error("locate current exe", error))?;
        let (run_key, _) = RegKey::predef(HKEY_CURRENT_USER)
            .create_subkey(RUN_SUBKEY)
            .map_err(|error| registry_error("open Run key", error))?;
        run_key
            .set_value(value_name, &quoted_exe_command(&exe))
            .map_err(|error| registry_error("write login item", error))?;
        // A stale Task Manager "disabled" flag would silently keep the item
        // off after an in-app re-enable, so start fresh on every register.
        clear_startup_approved(value_name);
        Ok(())
    }

    fn unregister_for(value_name: &str) -> Result<(), StartupOpenAtLoginError> {
        let exe =
            std::env::current_exe().map_err(|error| registry_error("locate current exe", error))?;
        let run_key = RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey_with_flags(RUN_SUBKEY, KEY_READ | KEY_SET_VALUE);
        let run_key = match run_key {
            Ok(key) => key,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                clear_startup_approved(value_name);
                return Ok(());
            }
            Err(error) => return Err(registry_error("open Run key", error)),
        };
        match run_key.get_value::<String, _>(value_name) {
            Ok(command) if registered_target_matches(&command, &exe) => {
                run_key
                    .delete_value(value_name)
                    .map_err(|error| registry_error("delete login item", error))?;
                clear_startup_approved(value_name);
            }
            // The fixed value name can belong to another side-by-side or moved
            // Drifty installation. Never delete a startup item we do not own.
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                clear_startup_approved(value_name);
            }
            Err(error) => return Err(registry_error("read login item", error)),
        };
        Ok(())
    }

    fn registry_error(operation: &'static str, error: std::io::Error) -> StartupOpenAtLoginError {
        StartupOpenAtLoginError::Registry {
            operation,
            message: error.to_string(),
        }
    }

    /// Run values are command lines: an unquoted path containing spaces would
    /// be misparsed, so the exe path is always stored quoted.
    fn quoted_exe_command(exe: &Path) -> String {
        format!("\"{}\" {WINDOWS_BACKGROUND_ARG}", exe.display())
    }

    /// Extract the exe path back out of a stored command. Only our own
    /// quoted shape is understood; anything else counts as not found rather
    /// than guessing at a foreign value's quoting.
    fn registered_target_matches(command: &str, expected_exe: &Path) -> bool {
        let trimmed = command.trim();
        let Some(rest) = trimmed.strip_prefix('\"') else {
            return false;
        };
        let Some((path, args)) = rest.split_once('\"') else {
            return false;
        };
        if args.trim() != WINDOWS_BACKGROUND_ARG {
            return false;
        }
        windows_paths_match(Path::new(path), expected_exe)
    }

    fn windows_paths_match(actual: &Path, expected: &Path) -> bool {
        let normalize = |path: &Path| {
            std::fs::canonicalize(path)
                .unwrap_or_else(|_| path.to_path_buf())
                .to_string_lossy()
                .replace('/', "\\")
                .trim_start_matches(r"\\?\")
                .to_ascii_lowercase()
        };
        normalize(actual) == normalize(expected)
    }

    fn read_startup_approved(value_name: &str) -> Option<Vec<u8>> {
        let key = RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey_with_flags(STARTUP_APPROVED_SUBKEY, KEY_READ)
            .ok()?;
        let raw = key.get_raw_value(value_name).ok()?;
        Some(raw.bytes.into_owned())
    }

    fn startup_approved_disabled(bytes: Option<&[u8]>) -> bool {
        bytes
            .and_then(|value| value.first())
            .is_some_and(|first| *first == STARTUP_APPROVED_DISABLED)
    }

    fn clear_startup_approved(value_name: &str) {
        if let Ok(key) = RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey_with_flags(STARTUP_APPROVED_SUBKEY, KEY_SET_VALUE)
        {
            let _ = key.delete_value(value_name);
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        fn unique_value_name(label: &str) -> String {
            format!("drifty-test-{}-{}", std::process::id(), label)
        }

        #[test]
        fn quoted_exe_command_wraps_the_path_in_quotes() {
            let quoted = quoted_exe_command(Path::new("C:\\Program Files\\drifty\\drifty.exe"));
            assert_eq!(
                quoted,
                "\"C:\\Program Files\\drifty\\drifty.exe\" --background"
            );
        }

        #[test]
        fn registered_target_matches_only_the_current_exe_and_owned_argument() {
            let exe = std::env::current_exe().expect("current exe");
            let command = quoted_exe_command(&exe);
            assert!(registered_target_matches(&command, &exe));
            assert!(!registered_target_matches(&exe.display().to_string(), &exe));
            assert!(!registered_target_matches(
                &format!("\"{}\" --foreign", exe.display()),
                &exe,
            ));
            assert!(!registered_target_matches(
                "\"C:\\Windows\\notepad.exe\" --background",
                &exe,
            ));
        }

        #[test]
        fn startup_approved_disabled_reads_only_the_first_byte() {
            assert!(!startup_approved_disabled(None));
            assert!(!startup_approved_disabled(Some(&[])));
            assert!(!startup_approved_disabled(Some(&[0x02, 0, 0, 0])));
            assert!(startup_approved_disabled(Some(&[0x03, 0, 0, 0])));
        }

        #[test]
        fn register_status_unregister_round_trip_with_a_scoped_value_name() {
            let name = unique_value_name("round-trip");
            unregister_for(&name).expect("pre-clean");
            assert_eq!(status_for(&name), StartupOpenAtLoginStatus::NotRegistered);

            register_for(&name).expect("register");
            assert_eq!(status_for(&name), StartupOpenAtLoginStatus::Enabled);

            unregister_for(&name).expect("unregister");
            assert_eq!(status_for(&name), StartupOpenAtLoginStatus::NotRegistered);
        }

        #[test]
        fn task_manager_disable_maps_to_requires_approval() {
            let name = unique_value_name("disabled");
            register_for(&name).expect("register");

            let approved = RegKey::predef(HKEY_CURRENT_USER)
                .create_subkey(STARTUP_APPROVED_SUBKEY)
                .expect("open StartupApproved")
                .0;
            approved
                .set_raw_value(
                    &name,
                    &winreg::RegValue {
                        bytes: std::borrow::Cow::Owned(vec![0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
                        vtype: winreg::enums::RegType::REG_BINARY,
                    },
                )
                .expect("write disabled flag");
            assert_eq!(
                status_for(&name),
                StartupOpenAtLoginStatus::RequiresApproval
            );

            // Re-registering in-app must clear the user's disabled flag.
            register_for(&name).expect("re-register");
            assert_eq!(status_for(&name), StartupOpenAtLoginStatus::Enabled);

            unregister_for(&name).expect("cleanup");
        }

        #[test]
        fn unregister_preserves_a_foreign_run_value_and_approval_state() {
            let name = unique_value_name("foreign");
            let foreign_command = r#""C:\Program Files\Other Drifty\drifty.exe" --background"#;
            let run_key = RegKey::predef(HKEY_CURRENT_USER)
                .create_subkey(RUN_SUBKEY)
                .expect("open Run key")
                .0;
            run_key
                .set_value(&name, &foreign_command)
                .expect("write foreign Run value");
            let approved = RegKey::predef(HKEY_CURRENT_USER)
                .create_subkey(STARTUP_APPROVED_SUBKEY)
                .expect("open StartupApproved")
                .0;
            approved
                .set_raw_value(
                    &name,
                    &winreg::RegValue {
                        bytes: std::borrow::Cow::Owned(vec![0x03, 0, 0, 0]),
                        vtype: winreg::enums::RegType::REG_BINARY,
                    },
                )
                .expect("write foreign approval state");

            unregister_for(&name).expect("foreign value must be preserved");

            assert_eq!(
                run_key
                    .get_value::<String, _>(&name)
                    .expect("foreign Run value"),
                foreign_command
            );
            assert!(approved.get_raw_value(&name).is_ok());

            run_key.delete_value(&name).expect("cleanup Run value");
            approved
                .delete_value(&name)
                .expect("cleanup approval state");
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn unsupported_response() -> StartupOpenAtLoginResponse {
    StartupOpenAtLoginResponse {
        success: false,
        enabled: false,
        status: StartupOpenAtLoginStatus::Unsupported,
        backend: BACKEND_UNSUPPORTED,
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StartupInstallLocation {
    Applications,
    UserApplications,
    Translocated,
    RemovableVolume,
    Other,
    Unknown,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupInstallLocationResponse {
    location: StartupInstallLocation,
}

/// Reports where the running bundle lives so open-at-login results can be read
/// against a location that survives a restart.
#[tauri::command]
pub fn startup_get_install_location() -> StartupInstallLocationResponse {
    StartupInstallLocationResponse {
        location: current_install_location(),
    }
}

#[cfg(target_os = "macos")]
fn current_install_location() -> StartupInstallLocation {
    let Ok(executable) = std::env::current_exe() else {
        return StartupInstallLocation::Unknown;
    };
    let home = std::env::var("HOME").ok();
    classify_install_location(&executable.to_string_lossy(), home.as_deref())
}

/// Only macOS relocates a bundle behind the user's back, so other platforms
/// report Unknown instead of forcing every install into Other.
#[cfg(not(target_os = "macos"))]
fn current_install_location() -> StartupInstallLocation {
    StartupInstallLocation::Unknown
}

/// Gatekeeper runs an app that was never moved out of its disk image from a
/// randomized read-only `AppTranslocation` path. A login item registered from
/// there points at a path that no longer exists at the next login, so the app
/// silently fails to reopen even though registration reported success.
/// Running straight from a mounted `/Volumes` image has the same effect.
fn classify_install_location(executable_path: &str, home: Option<&str>) -> StartupInstallLocation {
    if executable_path.contains("/AppTranslocation/") {
        return StartupInstallLocation::Translocated;
    }
    if let Some(home) = home {
        if !home.is_empty() && executable_path.starts_with(&format!("{home}/Applications/")) {
            return StartupInstallLocation::UserApplications;
        }
    }
    if executable_path.starts_with("/Applications/") {
        return StartupInstallLocation::Applications;
    }
    if executable_path.starts_with("/Volumes/") {
        return StartupInstallLocation::RemovableVolume;
    }
    StartupInstallLocation::Other
}

#[cfg(all(test, not(target_os = "windows")))]
mod tests {
    use super::*;

    #[test]
    fn classify_install_location_flags_translocated_and_volume_paths() {
        assert_eq!(
            classify_install_location(
                "/private/var/folders/ab/AppTranslocation/1E2/d/Drifty.app/Contents/MacOS/Drifty",
                Some("/Users/example"),
            ),
            StartupInstallLocation::Translocated
        );
        assert_eq!(
            classify_install_location("/Volumes/Drifty/Drifty.app/Contents/MacOS/Drifty", None),
            StartupInstallLocation::RemovableVolume
        );
    }

    #[test]
    fn classify_install_location_separates_system_and_user_applications() {
        assert_eq!(
            classify_install_location(
                "/Applications/Drifty.app/Contents/MacOS/Drifty",
                Some("/Users/example"),
            ),
            StartupInstallLocation::Applications
        );
        assert_eq!(
            classify_install_location(
                "/Users/example/Applications/Drifty.app/Contents/MacOS/Drifty",
                Some("/Users/example"),
            ),
            StartupInstallLocation::UserApplications
        );
    }

    #[test]
    fn classify_install_location_falls_back_to_other() {
        assert_eq!(
            classify_install_location(
                "/Users/example/Downloads/Drifty.app/Contents/MacOS/Drifty",
                Some("/Users/example"),
            ),
            StartupInstallLocation::Other
        );
        assert_eq!(
            classify_install_location("/Applications/Drifty.app/Contents/MacOS/Drifty", Some("")),
            StartupInstallLocation::Applications
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn startup_status_from_service_status_maps_smappservice_statuses() {
        assert_eq!(
            startup_status_from_service_status(smappservice_rs::ServiceStatus::Enabled),
            StartupOpenAtLoginStatus::Enabled
        );
        assert_eq!(
            startup_status_from_service_status(smappservice_rs::ServiceStatus::NotRegistered),
            StartupOpenAtLoginStatus::NotRegistered
        );
        assert_eq!(
            startup_status_from_service_status(smappservice_rs::ServiceStatus::RequiresApproval),
            StartupOpenAtLoginStatus::RequiresApproval
        );
        assert_eq!(
            startup_status_from_service_status(smappservice_rs::ServiceStatus::NotFound),
            StartupOpenAtLoginStatus::NotFound
        );
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    #[test]
    fn unsupported_response_is_not_successful() {
        assert_eq!(
            unsupported_response(),
            StartupOpenAtLoginResponse {
                success: false,
                enabled: false,
                status: StartupOpenAtLoginStatus::Unsupported,
                backend: BACKEND_UNSUPPORTED,
            }
        );
    }
}
