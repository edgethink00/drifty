//! Computer-local generic credentials. The keyring crate's enterprise
//! persistence default is inappropriate for this device's screen evidence.
use crate::Error;
use std::ptr;
#[cfg(test)]
use windows_sys::Win32::Security::Credentials::CredDeleteW;
use windows_sys::Win32::{
    Foundation::{GetLastError, ERROR_NOT_FOUND},
    Security::Credentials::{
        CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_MAX_CREDENTIAL_BLOB_SIZE,
        CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
    },
};
use zeroize::{Zeroize, Zeroizing};

struct ReadCredential(*mut CREDENTIALW);
impl Drop for ReadCredential {
    fn drop(&mut self) {
        // CredRead returns one caller-owned allocation. Erase its copied key
        // before CredFree; this does not mutate the saved OS credential.
        unsafe {
            let value = &*self.0;
            if !value.CredentialBlob.is_null()
                && value.CredentialBlobSize <= CRED_MAX_CREDENTIAL_BLOB_SIZE
            {
                std::slice::from_raw_parts_mut(
                    value.CredentialBlob,
                    value.CredentialBlobSize as usize,
                )
                .zeroize();
            }
            CredFree(self.0.cast());
        }
    }
}

pub(super) struct OsEntry {
    target: Vec<u16>,
    account: Vec<u16>,
}

impl OsEntry {
    pub(super) fn new(service: &str, account: &str) -> Result<Self, Error> {
        if service.contains('\0') || account.contains('\0') {
            return Err(Error::Invalid("native credential identity"));
        }
        // Keep the original private prototype's target mapping. An existing
        // nonlocal entry is refused and preserved, never silently replaced.
        Ok(Self {
            target: format!("{account}.{service}")
                .encode_utf16()
                .chain([0])
                .collect(),
            account: account.encode_utf16().chain([0]).collect(),
        })
    }

    pub(super) fn get_secret(&self) -> Result<Option<Zeroizing<Vec<u8>>>, Error> {
        let mut raw = ptr::null_mut();
        if unsafe { CredReadW(self.target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut raw) } == 0 {
            let code = unsafe { GetLastError() };
            #[cfg(test)]
            if code != ERROR_NOT_FOUND {
                eprintln!("owned_key_store:read_error={code}");
            }
            return if code == ERROR_NOT_FOUND {
                Ok(None)
            } else {
                Err(Error::Storage)
            };
        }
        if raw.is_null() {
            return Err(Error::Storage);
        }
        let owned = ReadCredential(raw);
        let value = unsafe { &*owned.0 };
        if value.Type != CRED_TYPE_GENERIC
            || value.Persist != CRED_PERSIST_LOCAL_MACHINE
            || value.CredentialBlobSize > CRED_MAX_CREDENTIAL_BLOB_SIZE
            || (value.CredentialBlobSize != 0 && value.CredentialBlob.is_null())
        {
            return Err(Error::Authentication);
        }
        let bytes = if value.CredentialBlobSize == 0 {
            Vec::new()
        } else {
            unsafe {
                std::slice::from_raw_parts(value.CredentialBlob, value.CredentialBlobSize as usize)
            }
            .to_vec()
        };
        Ok(Some(Zeroizing::new(bytes)))
    }

    pub(super) fn set_secret(&self, secret: &[u8]) -> Result<(), Error> {
        self.write(secret, CRED_PERSIST_LOCAL_MACHINE)
    }

    fn write(&self, secret: &[u8], persistence: u32) -> Result<(), Error> {
        if secret.len() > CRED_MAX_CREDENTIAL_BLOB_SIZE as usize {
            return Err(Error::Invalid("native key size"));
        }
        let value = CREDENTIALW {
            Type: CRED_TYPE_GENERIC,
            TargetName: self.target.as_ptr().cast_mut(),
            UserName: self.account.as_ptr().cast_mut(),
            CredentialBlobSize: secret.len() as u32,
            CredentialBlob: secret.as_ptr().cast_mut(),
            Persist: persistence,
            ..CREDENTIALW::default()
        };
        if unsafe { CredWriteW(&value, 0) } == 0 {
            Err(Error::Storage)
        } else {
            Ok(())
        }
    }

    #[cfg(test)]
    pub(super) fn delete_credential(&self) -> Result<(), Error> {
        // The negative fixture deliberately writes two persistence scopes.
        // Windows can reveal the local copy after deleting the enterprise copy.
        // This cleanup exists only in the unique-namespace native QA test.
        for _ in 0..4 {
            if unsafe { CredDeleteW(self.target.as_ptr(), CRED_TYPE_GENERIC, 0) } != 0 {
                continue;
            }
            let code = unsafe { GetLastError() };
            if code == ERROR_NOT_FOUND {
                return Ok(());
            }
            eprintln!("owned_key_store:delete_error={code}");
            return Err(Error::Storage);
        }
        Err(Error::Storage)
    }

    #[cfg(test)]
    pub(super) fn set_nonlocal_for_test(&self, secret: &[u8]) -> Result<(), Error> {
        self.write(
            secret,
            windows_sys::Win32::Security::Credentials::CRED_PERSIST_ENTERPRISE,
        )
    }

    #[cfg(test)]
    pub(super) fn delete_once_for_test(&self) -> Result<(), Error> {
        if unsafe { CredDeleteW(self.target.as_ptr(), CRED_TYPE_GENERIC, 0) } != 0 {
            Ok(())
        } else {
            Err(Error::Storage)
        }
    }
}
