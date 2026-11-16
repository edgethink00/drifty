use security_framework::passwords::{
    delete_generic_password, get_generic_password, set_generic_password,
};
use security_framework_sys::base::errSecItemNotFound;

const OPENROUTER_API_KEY_SERVICE: &str = "so.drifty.openrouter-api-key";
const OPENROUTER_API_KEY_ACCOUNT: &str = "desktop";

pub fn load_api_key(identifier: &str) -> Result<Option<String>, String> {
    crate::credential_namespace::with_keychain_interaction(false, || {
        match get_generic_password(
            &crate::credential_namespace::service_for_app(
                OPENROUTER_API_KEY_SERVICE,
                identifier,
                cfg!(debug_assertions),
            ),
            OPENROUTER_API_KEY_ACCOUNT,
        ) {
            Ok(value) => String::from_utf8(value).map(Some).map_err(|error| {
                format!("Unable to decode OpenRouter API key from Keychain: {error}")
            }),
            Err(error) if error.code() == errSecItemNotFound => Ok(None),
            Err(error) => Err(format!(
                "Unable to read OpenRouter API key from Keychain: {error}"
            )),
        }
    })
}

pub fn save_api_key(identifier: &str, value: &str) -> Result<(), String> {
    crate::credential_namespace::with_keychain_interaction(true, || {
        let trimmed_value = value.trim();
        if trimmed_value.is_empty() {
            return clear_api_key_unlocked(identifier);
        }

        set_generic_password(
            &crate::credential_namespace::service_for_app(
                OPENROUTER_API_KEY_SERVICE,
                identifier,
                cfg!(debug_assertions),
            ),
            OPENROUTER_API_KEY_ACCOUNT,
            trimmed_value.as_bytes(),
        )
        .map_err(|error| format!("Unable to save OpenRouter API key in Keychain: {error}"))
    })
}

pub fn clear_api_key(identifier: &str) -> Result<(), String> {
    crate::credential_namespace::with_keychain_interaction(true, || {
        clear_api_key_unlocked(identifier)
    })
}

fn clear_api_key_unlocked(identifier: &str) -> Result<(), String> {
    match delete_generic_password(
        &crate::credential_namespace::service_for_app(
            OPENROUTER_API_KEY_SERVICE,
            identifier,
            cfg!(debug_assertions),
        ),
        OPENROUTER_API_KEY_ACCOUNT,
    ) {
        Ok(()) => Ok(()),
        Err(error) if error.code() == errSecItemNotFound => Ok(()),
        Err(error) => Err(format!(
            "Unable to clear OpenRouter API key from Keychain: {error}"
        )),
    }
}
