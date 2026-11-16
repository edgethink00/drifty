//! Windows OpenRouter API key storage backed by the Credential Manager.
//!
//! `keyring` maps a (service, account) pair onto a Credential Manager generic
//! credential, the same crate and pattern `auth_session_store` and
//! `cloud_device_store` already use in this crate. Service and account strings
//! match the macOS implementation so the two platforms describe the same
//! logical secret, even though the stores are independent.

use keyring::{Entry, Error as KeyringError};

const OPENROUTER_API_KEY_SERVICE: &str = "so.drifty.openrouter-api-key";
const OPENROUTER_API_KEY_ACCOUNT: &str = "desktop";

fn credential_entry(identifier: &str) -> Result<Entry, String> {
    Entry::new(
        &crate::credential_namespace::service_for_app(
            OPENROUTER_API_KEY_SERVICE,
            identifier,
            cfg!(debug_assertions),
        ),
        OPENROUTER_API_KEY_ACCOUNT,
    )
    .map_err(|error| format!("Unable to open OpenRouter API key credential: {error}"))
}

pub fn load_api_key(identifier: &str) -> Result<Option<String>, String> {
    match credential_entry(identifier)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(format!(
            "Unable to read OpenRouter API key from Credential Manager: {error}"
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
            format!("Unable to save OpenRouter API key in Credential Manager: {error}")
        })
}

pub fn clear_api_key(identifier: &str) -> Result<(), String> {
    match credential_entry(identifier)?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(error) => Err(format!(
            "Unable to clear OpenRouter API key from Credential Manager: {error}"
        )),
    }
}
