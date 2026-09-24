use security_framework::passwords::{
    delete_generic_password, get_generic_password, set_generic_password,
};
use security_framework_sys::base::errSecItemNotFound;

const CUSTOM_ENDPOINT_API_KEY_SERVICE: &str = "so.drifty.custom-endpoint-api-key";
const CUSTOM_ENDPOINT_API_KEY_ACCOUNT: &str = "desktop";

pub fn load_api_key() -> Result<Option<String>, String> {
    match get_generic_password(
        CUSTOM_ENDPOINT_API_KEY_SERVICE,
        CUSTOM_ENDPOINT_API_KEY_ACCOUNT,
    ) {
        Ok(value) => String::from_utf8(value).map(Some).map_err(|error| {
            format!("Unable to decode custom endpoint API key from Keychain: {error}")
        }),
        Err(error) if error.code() == errSecItemNotFound => Ok(None),
        Err(error) => Err(format!(
            "Unable to read custom endpoint API key from Keychain: {error}"
        )),
    }
}

pub fn save_api_key(value: &str) -> Result<(), String> {
    let trimmed_value = value.trim();
    if trimmed_value.is_empty() {
        return clear_api_key();
    }

    set_generic_password(
        CUSTOM_ENDPOINT_API_KEY_SERVICE,
        CUSTOM_ENDPOINT_API_KEY_ACCOUNT,
        trimmed_value.as_bytes(),
    )
    .map_err(|error| format!("Unable to save custom endpoint API key in Keychain: {error}"))
}

pub fn clear_api_key() -> Result<(), String> {
    match delete_generic_password(
        CUSTOM_ENDPOINT_API_KEY_SERVICE,
        CUSTOM_ENDPOINT_API_KEY_ACCOUNT,
    ) {
        Ok(()) => Ok(()),
        Err(error) if error.code() == errSecItemNotFound => Ok(()),
        Err(error) => Err(format!(
            "Unable to clear custom endpoint API key from Keychain: {error}"
        )),
    }
}
