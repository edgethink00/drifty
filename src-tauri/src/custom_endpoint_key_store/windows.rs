//! Windows custom endpoint API key storage backed by the Credential Manager.

use keyring::{Entry, Error as KeyringError};

const CUSTOM_ENDPOINT_API_KEY_SERVICE: &str = "so.drifty.custom-endpoint-api-key";
const CUSTOM_ENDPOINT_API_KEY_ACCOUNT: &str = "desktop";

fn credential_entry(identifier: &str) -> Result<Entry, String> {
    Entry::new(
        &crate::credential_namespace::service_for_app(
            CUSTOM_ENDPOINT_API_KEY_SERVICE,
            identifier,
            cfg!(debug_assertions),
        ),
        CUSTOM_ENDPOINT_API_KEY_ACCOUNT,
    )
    .map_err(|error| format!("Unable to open custom endpoint API key credential: {error}"))
}

pub fn load_api_key(identifier: &str) -> Result<Option<String>, String> {
    match credential_entry(identifier)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(format!(
            "Unable to read custom endpoint API key from Credential Manager: {error}"
        )),
    }
}

pub fn save_api_key(identifier: &str, value: &str) -> Result<(), String> {
    let trimmed_value = value.trim();
    if trimmed_value.is_empty() {
        return clear_api_key(identifier);
    }

    credential_entry(identifier)?
        .set_password(trimmed_value)
        .map_err(|error| {
            format!("Unable to save custom endpoint API key in Credential Manager: {error}")
        })
}

pub fn clear_api_key(identifier: &str) -> Result<(), String> {
    match credential_entry(identifier)?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(error) => Err(format!(
            "Unable to clear custom endpoint API key from Credential Manager: {error}"
        )),
    }
}

/// Windows has no Keychain dialog; recovery uses the same serialized native store.
pub fn recover_api_key(identifier: &str, value: Option<&str>) -> Result<Option<String>, String> {
    if let Some(value) = value {
        save_api_key(identifier, value)?;
    }
    load_api_key(identifier)
}
