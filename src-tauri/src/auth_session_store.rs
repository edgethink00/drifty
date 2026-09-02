use std::fs;
use std::path::PathBuf;

use keyring::{Entry, Error as KeyringError};
use tauri::{AppHandle, Manager};

const AUTH_SESSION_FILE_NAME: &str = "auth-session.json";
const AUTH_SESSION_KEYCHAIN_SERVICE: &str = "so.drifty.auth-session";
const AUTH_SESSION_KEYCHAIN_ACCOUNT: &str = "desktop";
const AUTH_SESSION_KEYCHAIN_SERVICE_OVERRIDE: &str = "DRIFTY_AUTH_SESSION_KEYCHAIN_SERVICE";

fn auth_session_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    Ok(dir.join(AUTH_SESSION_FILE_NAME))
}

fn resolve_keychain_service(override_value: Option<&str>, debug_build: bool) -> String {
    if debug_build {
        if let Some(value) = override_value.map(str::trim).filter(|value| {
            value.starts_with("so.drifty.auth-session.")
                && value.len() <= 255
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-'))
        }) {
            return value.to_string();
        }
    }

    AUTH_SESSION_KEYCHAIN_SERVICE.to_string()
}

fn keychain_service() -> String {
    resolve_keychain_service(
        std::env::var(AUTH_SESSION_KEYCHAIN_SERVICE_OVERRIDE)
            .ok()
            .as_deref(),
        cfg!(debug_assertions),
    )
}

fn keychain_entry() -> Result<Entry, String> {
    Entry::new(&keychain_service(), AUTH_SESSION_KEYCHAIN_ACCOUNT)
        .map_err(|error| format!("Unable to open auth session credential: {error}"))
}

fn remove_legacy_session_file(app: &AppHandle) -> Result<(), String> {
    match fs::remove_file(auth_session_path(app)?) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

fn load_legacy_session(app: &AppHandle, entry: &Entry) -> Result<Option<String>, String> {
    let legacy_value = match fs::read_to_string(auth_session_path(app)?) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };

    entry.set_password(&legacy_value).map_err(|error| {
        format!("Unable to migrate auth session into the OS credential store: {error}")
    })?;
    remove_legacy_session_file(app)?;

    Ok(Some(legacy_value))
}

pub fn load_saved_session(app: &AppHandle) -> Result<Option<String>, String> {
    let entry = keychain_entry()?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(KeyringError::NoEntry) => load_legacy_session(app, &entry),
        Err(error) => Err(format!(
            "Unable to read auth session from the OS credential store: {error}"
        )),
    }
}

pub fn save_session(value: &str) -> Result<(), String> {
    keychain_entry()?
        .set_password(value)
        .map_err(|error| format!("Unable to save auth session in the OS credential store: {error}"))
}

pub fn clear_saved_session(app: &AppHandle) -> Result<(), String> {
    let keychain_result = match keychain_entry()?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(error) => Err(format!(
            "Unable to clear auth session from the OS credential store: {error}"
        )),
    };

    let legacy_result = remove_legacy_session_file(app);

    keychain_result?;
    legacy_result
}

#[cfg(test)]
mod tests {
    use super::{resolve_keychain_service, AUTH_SESSION_KEYCHAIN_SERVICE};

    #[test]
    fn isolates_debug_auth_sessions_without_changing_release_storage() {
        let isolated = "so.drifty.auth-session.so.drifty.mac.wt-calendar-qa";
        assert_eq!(resolve_keychain_service(Some(isolated), true), isolated);
        assert_eq!(
            resolve_keychain_service(Some(isolated), false),
            AUTH_SESSION_KEYCHAIN_SERVICE
        );
    }

    #[test]
    fn rejects_unscoped_or_malformed_debug_auth_session_overrides() {
        for value in ["other.service", "so.drifty.auth-session.bad/value", ""] {
            assert_eq!(
                resolve_keychain_service(Some(value), true),
                AUTH_SESSION_KEYCHAIN_SERVICE
            );
        }
    }
}
