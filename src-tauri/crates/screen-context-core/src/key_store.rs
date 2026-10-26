//! Trusted native key boundary. No key, profile name, or credential-store
//! service name belongs in a WebView command or settings JSON.
use crate::{Error, ScopeId};
use zeroize::Zeroizing;

#[cfg(all(feature = "native-key-store", target_os = "windows"))]
mod windows;

pub trait ProfileKeyProvider {
    /// Called while the evidence root's exclusive writer lock is held.
    /// `may_create` is false if this profile already contains evidence.
    fn profile_key(
        &mut self,
        scope: &ScopeId,
        may_create: bool,
    ) -> Result<Zeroizing<[u8; 32]>, Error>;
}

pub(crate) struct SuppliedKey(pub Option<Zeroizing<[u8; 32]>>);
impl ProfileKeyProvider for SuppliedKey {
    fn profile_key(&mut self, _: &ScopeId, _: bool) -> Result<Zeroizing<[u8; 32]>, Error> {
        self.0.take().ok_or(Error::Authentication)
    }
}

#[cfg(all(
    feature = "native-key-store",
    any(target_os = "macos", target_os = "windows")
))]
mod native {
    #[cfg(target_os = "windows")]
    use super::windows::OsEntry;
    use super::*;
    use ring::rand::{SecureRandom, SystemRandom};

    #[cfg(target_os = "macos")]
    struct OsEntry(keyring::Entry);
    #[cfg(target_os = "macos")]
    impl OsEntry {
        fn new(service: &str, account: &str) -> Result<Self, Error> {
            keyring::Entry::new(service, account)
                .map(Self)
                .map_err(|_| Error::Storage)
        }
        fn get_secret(&self) -> Result<Option<Zeroizing<Vec<u8>>>, Error> {
            match self.0.get_secret() {
                Ok(bytes) => Ok(Some(Zeroizing::new(bytes))),
                Err(keyring::Error::NoEntry) => Ok(None),
                Err(_) => Err(Error::Storage),
            }
        }
        fn set_secret(&self, secret: &[u8]) -> Result<(), Error> {
            self.0.set_secret(secret).map_err(|_| Error::Storage)
        }
        #[cfg(test)]
        fn delete_credential(&self) -> Result<(), Error> {
            match self.0.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(_) => Err(Error::Storage),
            }
        }
    }

    /// Construct only from the native application's trusted bundle identifier.
    /// Development/QA identifiers keep their keys separate from production.
    pub struct NativeProfileKeys {
        service: String,
    }

    impl NativeProfileKeys {
        pub fn new(app_identifier: &str) -> Result<Self, Error> {
            if !(3..=160).contains(&app_identifier.len())
                || !app_identifier.contains('.')
                || !app_identifier
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b".-".contains(&c))
            {
                return Err(Error::Invalid("native app identifier"));
            }
            Ok(Self {
                service: format!("{app_identifier}.screen-evidence-key.v1"),
            })
        }

        fn entry(&self, scope: &ScopeId) -> Result<OsEntry, Error> {
            OsEntry::new(&self.service, scope.path_component())
        }
    }

    fn decode(bytes: Zeroizing<Vec<u8>>) -> Result<Zeroizing<[u8; 32]>, Error> {
        if bytes.len() != 32 {
            return Err(Error::Authentication);
        }
        let mut key = Zeroizing::new([0; 32]);
        key.copy_from_slice(&bytes);
        Ok(key)
    }

    impl ProfileKeyProvider for NativeProfileKeys {
        fn profile_key(
            &mut self,
            scope: &ScopeId,
            may_create: bool,
        ) -> Result<Zeroizing<[u8; 32]>, Error> {
            let entry = self.entry(scope)?;
            match entry.get_secret()? {
                Some(bytes) => decode(bytes),
                None if may_create => {
                    let mut key = Zeroizing::new([0; 32]);
                    SystemRandom::new()
                        .fill(key.as_mut())
                        .map_err(|_| Error::Cryptography)?;
                    entry.set_secret(key.as_ref())?;
                    let persisted = decode(entry.get_secret()?.ok_or(Error::Storage)?)?;
                    if *persisted != *key {
                        return Err(Error::Authentication);
                    }
                    Ok(persisted)
                }
                None => Err(Error::Authentication),
            }
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        #[ignore = "explicit owned guest OS key-store smoke; creates only unique QA entries"]
        fn native_profile_key_round_trip_and_missing_key_never_overwrites() {
            let id = format!("so.drifty.qa.screenkeys.{}", uuid::Uuid::new_v4());
            eprintln!("owned_key_store:qa_identity={id}");
            let mut provider = NativeProfileKeys::new(&id).unwrap();
            let a = ScopeId::from_profile("qa-profile-a").unwrap();
            let b = ScopeId::from_profile("qa-profile-b").unwrap();
            let c = ScopeId::from_profile("qa-profile-c").unwrap();
            let entries = [
                provider.entry(&a).unwrap(),
                provider.entry(&b).unwrap(),
                provider.entry(&c).unwrap(),
            ];
            let mut stage = "missing-key";
            let result = (|| -> Result<(), Error> {
                if !matches!(provider.profile_key(&a, false), Err(Error::Authentication)) {
                    return Err(Error::Authentication);
                }
                stage = "create-a";
                let key = provider.profile_key(&a, true)?;
                stage = "read-a";
                if *key != *provider.profile_key(&a, false)? {
                    return Err(Error::Authentication);
                }
                stage = "create-b";
                if *key == *provider.profile_key(&b, true)? {
                    return Err(Error::Authentication);
                }
                stage = "malformed-update";
                entries[0]
                    .set_secret(b"malformed-owned-qa-key")
                    .map_err(|_| Error::Storage)?;
                stage = "malformed-read";
                if !matches!(provider.profile_key(&a, true), Err(Error::Authentication)) {
                    return Err(Error::Authentication);
                }
                if entries[0].get_secret()?.ok_or(Error::Storage)?.as_slice()
                    != b"malformed-owned-qa-key"
                {
                    return Err(Error::Authentication);
                }
                #[cfg(target_os = "windows")]
                {
                    stage = "nonlocal-key-refused";
                    // Model a preexisting nonlocal key, without changing the
                    // persistence mode of an existing local credential.
                    entries[2].set_nonlocal_for_test(key.as_ref())?;
                    if !matches!(provider.profile_key(&c, true), Err(Error::Authentication)) {
                        return Err(Error::Authentication);
                    }
                    if !matches!(entries[2].get_secret(), Err(Error::Authentication)) {
                        return Err(Error::Authentication);
                    }
                    // Removing that one nonlocal fixture must reveal no local
                    // replacement written behind it by the failed open.
                    entries[2].delete_once_for_test()?;
                    if entries[2].get_secret()?.is_some() {
                        return Err(Error::Authentication);
                    }
                }
                Ok(())
            })();
            // Clean task-owned items even if the operation returned an error.
            let cleared: Vec<_> = entries
                .iter()
                .map(|entry| entry.delete_credential().is_ok())
                .collect();
            let absent: Vec<_> = entries
                .iter()
                .map(|entry| entry.get_secret().map(|value| value.is_none()))
                .collect();
            assert!(cleared.iter().all(|v| *v) && absent.iter().all(|v| matches!(v, Ok(true))),
                "owned QA key cleanup failed: delete={cleared:?} absent={absent:?} phase={stage} status={result:?}");
            assert!(
                result.is_ok(),
                "native key-store phase={stage} status={result:?}"
            );
        }
    }
}

#[cfg(all(
    feature = "native-key-store",
    any(target_os = "macos", target_os = "windows")
))]
pub use native::NativeProfileKeys;
