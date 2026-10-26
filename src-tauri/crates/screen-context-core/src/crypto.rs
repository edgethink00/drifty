use crate::Error;
use ring::{
    aead, hkdf,
    rand::{SecureRandom, SystemRandom},
};
use std::sync::atomic::{AtomicU64, Ordering};
use zeroize::Zeroizing;

const VERSION: u8 = 1;
const PREFIX: usize = 1 + 16 + 12;

/// A fresh HKDF salt/key on every open makes counter nonces independent of
/// database restore and crash recovery. The counter is shared, never cloned.
/// Limits each derived GCM key to fewer than 2^32 invocations.
pub(crate) struct CryptoBox {
    master: Zeroizing<[u8; 32]>,
    salt: [u8; 16],
    key: aead::LessSafeKey,
    counter: AtomicU64,
}

fn derive(master: &[u8], salt: &[u8]) -> Result<aead::LessSafeKey, Error> {
    let prk = hkdf::Salt::new(hkdf::HKDF_SHA256, salt).extract(master);
    let info = [b"drifty.screen-evidence.data.v1".as_slice()];
    let mut bytes = Zeroizing::new([0u8; 32]);
    prk.expand(&info, hkdf::HKDF_SHA256)
        .map_err(|_| Error::Cryptography)?
        .fill(bytes.as_mut())
        .map_err(|_| Error::Cryptography)?;
    let key = aead::UnboundKey::new(&aead::AES_256_GCM, bytes.as_ref())
        .map_err(|_| Error::Cryptography)?;
    Ok(aead::LessSafeKey::new(key))
}

impl CryptoBox {
    pub(crate) fn new(master: Zeroizing<[u8; 32]>) -> Result<Self, Error> {
        let mut salt = [0; 16];
        SystemRandom::new()
            .fill(&mut salt)
            .map_err(|_| Error::Cryptography)?;
        let key = derive(master.as_ref(), &salt)?;
        Ok(Self {
            master,
            salt,
            key,
            counter: AtomicU64::new(0),
        })
    }

    pub(crate) fn seal(&self, aad: &[u8], bytes: &[u8]) -> Result<Vec<u8>, Error> {
        let counter = self
            .counter
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |n| {
                (n < u32::MAX as u64).then_some(n + 1)
            })
            .map_err(|_| Error::Cryptography)?;
        let mut nonce = [0; 12];
        nonce[8..].copy_from_slice(&(counter as u32).to_be_bytes());
        let mut result = Vec::with_capacity(PREFIX + bytes.len() + aead::MAX_TAG_LEN);
        result.push(VERSION);
        result.extend_from_slice(&self.salt);
        result.extend_from_slice(&nonce);
        result.extend_from_slice(bytes);
        self.key
            .seal_in_place_separate_tag(
                aead::Nonce::assume_unique_for_key(nonce),
                aead::Aad::from(aad),
                &mut result[PREFIX..],
            )
            .map(|tag| result.extend_from_slice(tag.as_ref()))
            .map_err(|_| Error::Cryptography)?;
        Ok(result)
    }

    pub(crate) fn open(&self, aad: &[u8], sealed: &[u8]) -> Result<Zeroizing<Vec<u8>>, Error> {
        if sealed.len() < PREFIX + aead::MAX_TAG_LEN || sealed[0] != VERSION {
            return Err(Error::Authentication);
        }
        let key = derive(self.master.as_ref(), &sealed[1..17])?;
        let nonce: [u8; 12] = sealed[17..PREFIX]
            .try_into()
            .map_err(|_| Error::Authentication)?;
        let mut clear = Zeroizing::new(sealed[PREFIX..].to_vec());
        let len = key
            .open_in_place(
                aead::Nonce::assume_unique_for_key(nonce),
                aead::Aad::from(aad),
                &mut clear,
            )
            .map_err(|_| Error::Authentication)?
            .len();
        clear.truncate(len);
        Ok(clear)
    }
}
