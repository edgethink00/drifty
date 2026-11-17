//! Provider credentials keep existing login-Keychain read ACLs and item identity.
use core_foundation::base::TCFType;
use security_framework::{
    base::Error,
    os::macos::{
        keychain::{SecKeychain, SecPreferencesDomain},
        passwords::find_generic_password,
    },
};
use security_framework_sys::{base::errSecItemNotFound, keychain_item::SecKeychainItemDelete};

fn failure(error: Error) -> String {
    format!(
        "Provider credential operation failed (OS status {}).",
        error.code()
    )
}

pub fn access(
    service: &str,
    account: &str,
    value: Option<&str>,
    allow_interaction: bool,
) -> Result<Option<String>, String> {
    access_using(None, service, account, value, allow_interaction)
}

fn access_using(
    keychains: Option<&[SecKeychain]>,
    service: &str,
    account: &str,
    value: Option<&str>,
    allow_interaction: bool,
) -> Result<Option<String>, String> {
    crate::credential_namespace::with_keychain_interaction(allow_interaction, || {
        let value = value.map(str::trim);
        match find_generic_password(keychains, service, account) {
            Ok((password, mut item)) => match value {
                None => String::from_utf8(password.to_owned())
                    .map(Some)
                    .map_err(|_| "Invalid provider credential encoding.".to_owned()),
                Some("") => {
                    // Read authorization above must succeed before update or delete.
                    let status = unsafe { SecKeychainItemDelete(item.as_concrete_TypeRef()) };
                    if status == 0 || status == errSecItemNotFound {
                        Ok(None)
                    } else {
                        Err(failure(Error::from_code(status)))
                    }
                }
                Some(value) => {
                    item.set_password(value.as_bytes()).map_err(failure)?;
                    Ok(Some(value.to_owned()))
                }
            },
            Err(error) if error.code() == errSecItemNotFound => match value {
                Some(value) if !value.is_empty() => {
                    let keychain = match keychains.and_then(|keys| keys.first()) {
                        Some(keychain) => keychain.clone(),
                        None => SecKeychain::default_for_domain(SecPreferencesDomain::User)
                            .map_err(failure)?,
                    };
                    keychain
                        .add_generic_password(service, account, value.as_bytes())
                        .map_err(failure)?;
                    Ok(Some(value.to_owned()))
                }
                _ => Ok(None),
            },
            Err(error) => Err(failure(error)),
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use security_framework::os::macos::keychain::CreateOptions;
    use security_framework_sys::base::SecKeychainRef;
    use std::{path::PathBuf, process::Command};

    #[link(name = "Security", kind = "framework")]
    extern "C" {
        fn SecKeychainLock(keychain: SecKeychainRef) -> i32;
        fn SecKeychainDelete(keychain: SecKeychainRef) -> i32;
    }

    struct Fixture {
        keychain: SecKeychain,
        directory: PathBuf,
        deleted: bool,
    }
    impl Fixture {
        fn delete(&mut self) {
            assert_eq!(
                unsafe { SecKeychainDelete(self.keychain.as_concrete_TypeRef()) },
                0
            );
            self.deleted = true;
            std::fs::remove_dir_all(&self.directory).unwrap();
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            if !self.deleted {
                unsafe {
                    SecKeychainDelete(self.keychain.as_concrete_TypeRef());
                }
                let _ = std::fs::remove_dir_all(&self.directory);
            }
        }
    }
    fn host_selection() -> Vec<Vec<u8>> {
        [
            vec!["list-keychains", "-d", "user"],
            vec!["default-keychain", "-d", "user"],
        ]
        .iter()
        .map(|args| {
            let result = Command::new("/usr/bin/security")
                .args(args)
                .output()
                .unwrap();
            assert!(result.status.success());
            [result.stdout, result.stderr].concat()
        })
        .collect()
    }
    fn call(
        keychain: &SecKeychain,
        value: Option<&str>,
        interactive: bool,
    ) -> Result<Option<String>, String> {
        access_using(
            Some(std::slice::from_ref(keychain)),
            "example.provider-recovery",
            "fixture",
            value,
            interactive,
        )
    }

    #[test]
    #[ignore = "explicit isolated macOS Keychain fixture; no real credentials or login-Keychain lock"]
    fn isolated_native_lock_recovery_preserves_latest_and_host_selection() {
        let before = host_selection();
        let initial_ui = SecKeychain::user_interaction_allowed().unwrap();
        let directory = std::env::temp_dir().join(format!(
            "provider-credential-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&directory).unwrap();
        let keychain = CreateOptions::new()
            .password("synthetic-fixture-password")
            .prompt_user(false)
            .create(directory.join("fixture.keychain"))
            .unwrap();
        let mut fixture = Fixture {
            keychain,
            directory,
            deleted: false,
        };
        assert_eq!(call(&fixture.keychain, None, false).unwrap(), None);
        // Use the previous SecItem-based setter, scoped to the disposable keychain.
        crate::credential_namespace::with_keychain_interaction(false, || {
            use core_foundation::string::CFString;
            use security_framework::passwords::{set_generic_password_options, PasswordOptions};
            use security_framework_sys::item::kSecUseKeychain;
            let mut options =
                PasswordOptions::new_generic_password("example.provider-recovery", "fixture");
            // PasswordOptions exposes no public setter for this macOS-only scope.
            #[allow(deprecated)]
            options.query.push((
                unsafe { CFString::wrap_under_get_rule(kSecUseKeychain) },
                fixture.keychain.as_CFType(),
            ));
            set_generic_password_options(b"synthetic-original", options).map_err(failure)
        })
        .unwrap();
        assert_eq!(
            call(&fixture.keychain, None, false).unwrap().as_deref(),
            Some("synthetic-original")
        );
        assert_eq!(
            unsafe { SecKeychainLock(fixture.keychain.as_concrete_TypeRef()) },
            0
        );
        assert!(call(&fixture.keychain, None, false).is_err());
        assert!(call(&fixture.keychain, Some("synthetic-denied"), false).is_err());
        assert!(call(&fixture.keychain, Some(""), false).is_err());
        fixture
            .keychain
            .unlock(Some("synthetic-fixture-password"))
            .unwrap();
        assert_eq!(
            call(&fixture.keychain, None, false).unwrap().as_deref(),
            Some("synthetic-original")
        );
        // Interactive mode is exercised only after this disposable keychain was unlocked;
        // the system consent dialog itself is a separate signed-app GUI check.
        assert_eq!(
            call(&fixture.keychain, Some("synthetic-latest"), true)
                .unwrap()
                .as_deref(),
            Some("synthetic-latest")
        );
        assert_eq!(
            call(&fixture.keychain, None, false).unwrap().as_deref(),
            Some("synthetic-latest")
        );
        assert_eq!(call(&fixture.keychain, Some(""), true).unwrap(), None);
        assert_eq!(call(&fixture.keychain, None, false).unwrap(), None);
        fixture.delete();
        assert!(
            before == host_selection(),
            "host Keychain selection changed"
        );
        assert_eq!(SecKeychain::user_interaction_allowed().unwrap(), initial_ui);
        println!("isolated native fixture: 3 locked denials; original preserved; latest confirmed; clear confirmed; host selection/UI mode restored");
    }
}
