//! Internal authenticated frame references. Timeline metadata stays independent;
//! a file ID never grants access to another record's activity, text or consent.
use super::*;

#[derive(Deserialize)]
#[serde(untagged)]
enum StoredHeader {
    Shared(SharedHeader),
    Original(EvidenceMetadata),
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SharedHeader {
    storage_version: u8,
    frame_id: Uuid,
    metadata: EvidenceMetadata,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SharedHeaderRef<'a> {
    storage_version: u8,
    frame_id: Uuid,
    metadata: &'a EvidenceMetadata,
}

pub(super) fn decode_header(clear: &[u8]) -> Result<(EvidenceMetadata, Uuid), Error> {
    let stored: StoredHeader = serde_json::from_slice(clear).map_err(|_| Error::Authentication)?;
    match stored {
        StoredHeader::Original(metadata) => {
            let id = metadata.id;
            Ok((metadata, id))
        }
        StoredHeader::Shared(shared) => {
            if shared.storage_version != 1
                || shared.frame_id.is_nil()
                || shared.frame_id == shared.metadata.id
                || !shared.metadata.frame_retained
            {
                return Err(Error::Authentication);
            }
            Ok((shared.metadata, shared.frame_id))
        }
    }
}

pub(super) fn encode_header(
    metadata: &EvidenceMetadata,
    frame_id: Uuid,
) -> Result<Zeroizing<Vec<u8>>, Error> {
    let bytes = if frame_id == metadata.id {
        serde_json::to_vec(metadata)
    } else {
        if frame_id.is_nil() || !metadata.frame_retained {
            return Err(Error::Authentication);
        }
        serde_json::to_vec(&SharedHeaderRef {
            storage_version: 1,
            frame_id,
            metadata,
        })
    };
    Ok(Zeroizing::new(
        bytes.map_err(|_| Error::Invalid("metadata"))?,
    ))
}

/// Authenticate all descriptors before recovery can interpret file ownership.
/// Different records referencing one file must agree on its content and size.
pub(super) fn validate_references(index: &BTreeMap<Uuid, Indexed>) -> Result<(), Error> {
    let mut frames = BTreeMap::new();
    for row in index.values().filter(|row| row.frame_bytes > 0) {
        let descriptor = (
            row.frame_bytes,
            &row.frame_sha256,
            row.frame_width,
            row.frame_height,
        );
        if frames
            .insert(row.frame_id, descriptor)
            .is_some_and(|old| old != descriptor)
        {
            return Err(Error::Authentication);
        }
    }
    Ok(())
}

impl EvidenceStore {
    pub(super) fn referenced_frames(&self) -> BTreeSet<Uuid> {
        self.index
            .values()
            .filter(|row| row.frame_bytes > 0)
            .map(|row| row.frame_id)
            .collect()
    }

    pub(super) fn frame_referenced(&self, id: Uuid) -> bool {
        self.index
            .values()
            .any(|row| row.frame_bytes > 0 && row.frame_id == id)
    }

    pub(super) fn used_frame_bytes(&self) -> u64 {
        self.index
            .values()
            .filter(|row| row.frame_bytes > 0)
            .map(|row| (row.frame_id, row.frame_bytes))
            .collect::<BTreeMap<_, _>>()
            .values()
            .sum()
    }

    pub(super) fn read_frame_bytes(
        &self,
        id: Uuid,
        size: u64,
    ) -> Result<Zeroizing<Vec<u8>>, Error> {
        let path = self.frame_path(id);
        if size == 0
            || size > crate::MAX_FRAME_BYTES as u64 + 64
            || !regular(&path)?
            || fs::metadata(&path)?.len() != size
        {
            return Err(Error::Authentication);
        }
        let mut bytes = Vec::new();
        File::open(path)?.take(size + 1).read_to_end(&mut bytes)?;
        if bytes.len() as u64 != size {
            return Err(Error::Authentication);
        }
        self.crypto.open(&self.aad("frame", id), &bytes)
    }

    /// A digest only finds a candidate. Authenticate/decrypt it and compare the
    /// entire PNG before sharing; no cache of plaintext pixels survives here.
    pub(super) fn matching_frame(&self, frame: &Frame) -> Result<Option<Uuid>, Error> {
        let candidate = self.index.values().find(|row| {
            row.frame_bytes > 0
                && row.frame_sha256 == frame.sha256
                && row.frame_width == frame.width
                && row.frame_height == frame.height
        });
        let Some(row) = candidate else {
            return Ok(None);
        };
        let bytes = self.read_frame_bytes(row.frame_id, row.frame_bytes)?;
        if bytes.as_slice() != frame.bytes() {
            return Err(Error::Authentication);
        }
        Ok(Some(row.frame_id))
    }

    pub(super) fn encode_updated_header(
        &self,
        metadata: &EvidenceMetadata,
    ) -> Result<Zeroizing<Vec<u8>>, Error> {
        let row = self.index.get(&metadata.id).ok_or(Error::Authentication)?;
        encode_header(metadata, row.frame_id)
    }
}

#[cfg(test)]
mod tests;
