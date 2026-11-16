//! Keep the existing login keychain and its ACLs; background I/O never opens UI.
use core_foundation::base::TCFType;
use security_framework::{
    base::Error,
    os::macos::keychain::{SecKeychain, SecPreferencesDomain},
};
use security_framework_sys::{
    base::{errSecAuthFailed, errSecItemNotFound},
    keychain_item::SecKeychainItemDelete,
};

fn failure(error: Error) -> String {
    match error.code() {
        // errSecInteractionNotAllowed (-25308), errSecUserCanceled (-128).
        code if code == errSecAuthFailed || code == -25308 || code == -128 => {
            "AUTH_SESSION_ACCESS_DENIED".to_owned()
        }
        code => format!("Auth session credential operation failed (OS status {code})."),
    }
}

fn keychain() -> Result<SecKeychain, String> {
    SecKeychain::default_for_domain(SecPreferencesDomain::User).map_err(failure)
}

pub fn load(service: &str, account: &str) -> Result<Option<String>, String> {
    load_using(keychain, service, account)
}

pub(super) fn load_using(
    source: impl FnOnce() -> Result<SecKeychain, String>,
    service: &str,
    account: &str,
) -> Result<Option<String>, String> {
    crate::credential_namespace::with_keychain_interaction(false, || {
        match source()?.find_generic_password(service, account) {
            Ok((password, _)) => String::from_utf8(password.to_owned())
                .map(Some)
                .map_err(|_| "Invalid saved auth session encoding.".to_owned()),
            Err(error) if error.code() == errSecItemNotFound => Ok(None),
            Err(error) => Err(failure(error)),
        }
    })
}

pub fn save(
    service: &str,
    account: &str,
    value: &str,
    allow_interaction: bool,
) -> Result<(), String> {
    save_using(keychain, service, account, value, allow_interaction)
}

pub(super) fn save_using(
    source: impl FnOnce() -> Result<SecKeychain, String>,
    service: &str,
    account: &str,
    value: &str,
    allow_interaction: bool,
) -> Result<(), String> {
    crate::credential_namespace::with_keychain_interaction(allow_interaction, || {
        let keychain = source()?;
        match keychain.find_generic_password(service, account) {
            // Keep the original read authorization and stable item reference.
            // SecItemUpdate alone can modify a legacy item whose read ACL was
            // denied. Never widen that existing authorization boundary.
            Ok((_password, mut item)) => item.set_password(value.as_bytes()).map_err(failure),
            // Add only after a real not-found. keyring's catch-all fallback
            // turned denied reads into misleading duplicate-item errors.
            Err(error) if error.code() == errSecItemNotFound => keychain
                .add_generic_password(service, account, value.as_bytes())
                .map_err(failure),
            Err(error) => Err(failure(error)),
        }
    })
}

pub fn clear(service: &str, account: &str, allow_interaction: bool) -> Result<(), String> {
    clear_using(keychain, service, account, allow_interaction)
}

pub(super) fn clear_using(
    source: impl FnOnce() -> Result<SecKeychain, String>,
    service: &str,
    account: &str,
    allow_interaction: bool,
) -> Result<(), String> {
    crate::credential_namespace::with_keychain_interaction(allow_interaction, || {
        match source()?.find_generic_password(service, account) {
            Ok((_password, item)) => {
                // Unlike keyring's void delete wrapper, verify the OS result
                // before reporting successful logout.
                let status = unsafe { SecKeychainItemDelete(item.as_concrete_TypeRef()) };
                if status == 0 || status == errSecItemNotFound {
                    Ok(())
                } else {
                    Err(failure(Error::from_code(status)))
                }
            }
            Err(error) if error.code() == errSecItemNotFound => Ok(()),
            Err(error) => Err(failure(error)),
        }
    })
}
