use keyring::{Entry, Error as KeyringError};
use uuid::Uuid;

const CLOUD_DEVICE_KEYCHAIN_SERVICE: &str = "so.drifty.cloud-device";
const CLOUD_DEVICE_KEYCHAIN_ACCOUNT: &str = "desktop-install";

fn keychain_entry() -> Result<Entry, String> {
    Entry::new(
        CLOUD_DEVICE_KEYCHAIN_SERVICE,
        CLOUD_DEVICE_KEYCHAIN_ACCOUNT,
    )
    .map_err(|error| format!("Unable to open Cloud device Keychain entry: {error}"))
}

pub fn load_or_create_install_id() -> Result<String, String> {
    let entry = keychain_entry()?;
    match entry.get_password() {
        Ok(value) if is_valid_install_id(&value) => Ok(value),
        Ok(_) | Err(KeyringError::NoEntry) => {
            let install_id = Uuid::new_v4().to_string();
            entry
                .set_password(&install_id)
                .map_err(|error| format!("Unable to save Cloud device id in Keychain: {error}"))?;
            Ok(install_id)
        }
        Err(error) => Err(format!("Unable to read Cloud device id from Keychain: {error}")),
    }
}

fn is_valid_install_id(value: &str) -> bool {
    Uuid::parse_str(value.trim()).is_ok()
}
