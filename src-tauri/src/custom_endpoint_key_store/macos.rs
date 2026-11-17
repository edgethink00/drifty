const SERVICE: &str = "so.drifty.custom-endpoint-api-key";
const ACCOUNT: &str = "desktop";

fn access(
    identifier: &str,
    value: Option<&str>,
    allow_interaction: bool,
) -> Result<Option<String>, String> {
    crate::provider_keychain::access(
        &crate::credential_namespace::service_for_app(SERVICE, identifier, cfg!(debug_assertions)),
        ACCOUNT,
        value,
        allow_interaction,
    )
}

pub fn load_api_key(identifier: &str) -> Result<Option<String>, String> {
    access(identifier, None, false)
}
pub fn save_api_key(identifier: &str, value: &str) -> Result<(), String> {
    access(identifier, Some(value), false).map(|_| ())
}
pub fn clear_api_key(identifier: &str) -> Result<(), String> {
    access(identifier, Some(""), false).map(|_| ())
}

/// Only an explicit recovery action may let macOS ask for access.
pub fn recover_api_key(identifier: &str, value: Option<&str>) -> Result<Option<String>, String> {
    access(identifier, value, true)
}
