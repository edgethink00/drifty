//! Windows custom endpoint API key storage backed by the Credential Manager.

use keyring::{Entry, Error as KeyringError};

const CUSTOM_ENDPOINT_API_KEY_SERVICE: &str = "so.drifty.custom-endpoint-api-key";
const CUSTOM_ENDPOINT_API_KEY_ACCOUNT: &str = "desktop";

fn credential_entry() -> Result<Entry, String> {
    Entry::new(
        CUSTOM_ENDPOINT_API_KEY_SERVICE,
        CUSTOM_ENDPOINT_API_KEY_ACCOUNT,
    )
    .map_err(|error| format!("Unable to open custom endpoint API key credential: {error}"))
}

pub fn load_api_key() -> Result<Option<String>, String> {
    match credential_entry()?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(format!(
            "Unable to read custom endpoint API key from Credential Manager: {error}"
        )),
    }
}

pub fn save_api_key(value: &str) -> Result<(), String> {
    let trimmed_value = value.trim();
    if trimmed_value.is_empty() {
        return clear_api_key();
    }

    credential_entry()?
        .set_password(trimmed_value)
        .map_err(|error| {
            format!("Unable to save custom endpoint API key in Credential Manager: {error}")
        })
}

pub fn clear_api_key() -> Result<(), String> {
    match credential_entry()?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(error) => Err(format!(
            "Unable to clear custom endpoint API key from Credential Manager: {error}"
        )),
    }
}
