use std::fs;
use std::path::PathBuf;

use keyring::{Entry, Error as KeyringError};
use tauri::{AppHandle, Manager};

const AUTH_SESSION_FILE_NAME: &str = "auth-session.json";
const AUTH_SESSION_KEYCHAIN_SERVICE: &str = "so.drifty.auth-session";
const AUTH_SESSION_KEYCHAIN_ACCOUNT: &str = "desktop";

fn auth_session_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    Ok(dir.join(AUTH_SESSION_FILE_NAME))
}

fn keychain_entry() -> Result<Entry, String> {
    Entry::new(AUTH_SESSION_KEYCHAIN_SERVICE, AUTH_SESSION_KEYCHAIN_ACCOUNT)
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
