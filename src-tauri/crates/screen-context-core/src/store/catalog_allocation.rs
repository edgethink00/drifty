//! Windows catalog ownership and content-preserving allocation recovery.
use super::{allocated_estimate, Error};
use std::{
    fs::{File, OpenOptions},
    os::windows::{fs::OpenOptionsExt, io::AsRawHandle},
    path::Path,
};
use windows_sys::Win32::Storage::FileSystem::{
    FileAllocationInfo, FileIdInfo, FileStandardInfo, GetFileInformationByHandleEx,
    SetFileInformationByHandle, FILE_ALLOCATION_INFO, FILE_ATTRIBUTE_REPARSE_POINT,
    FILE_FLAG_OPEN_REPARSE_POINT, FILE_ID_INFO, FILE_SHARE_READ, FILE_SHARE_WRITE,
    FILE_STANDARD_INFO,
};

#[derive(PartialEq, Eq)]
struct Identity {
    volume: u64,
    file: [u8; 16],
}

pub(super) struct CatalogFile {
    // Denying delete sharing pins the pathname while SQLite uses it. Recovery
    // operates on this handle, never on a newly resolved write pathname.
    file: File,
    identity: Option<Identity>,
}

fn information(file: &File) -> Result<FILE_STANDARD_INFO, Error> {
    let mut info: FILE_STANDARD_INFO = unsafe { std::mem::zeroed() };
    let ok = unsafe {
        GetFileInformationByHandleEx(
            file.as_raw_handle(),
            FileStandardInfo,
            (&mut info as *mut FILE_STANDARD_INFO).cast(),
            std::mem::size_of::<FILE_STANDARD_INFO>() as u32,
        )
    };
    if ok == 0
        || !file.metadata()?.is_file()
        || info.NumberOfLinks != 1
        || info.DeletePending
        || info.Directory
        || info.AllocationSize < 0
        || info.EndOfFile < 0
    {
        return Err(Error::Storage);
    }
    use std::os::windows::fs::MetadataExt;
    if file.metadata()?.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err(Error::Storage);
    }
    Ok(info)
}

fn identity(file: &File) -> Result<Option<Identity>, Error> {
    let mut info: FILE_ID_INFO = unsafe { std::mem::zeroed() };
    let ok = unsafe {
        GetFileInformationByHandleEx(
            file.as_raw_handle(),
            FileIdInfo,
            (&mut info as *mut FILE_ID_INFO).cast(),
            std::mem::size_of::<FILE_ID_INFO>() as u32,
        )
    };
    if ok == 0 {
        // A filesystem without stable IDs retains ordinary storage behavior;
        // allocation recovery stays disabled there.
        return match std::io::Error::last_os_error().raw_os_error() {
            Some(1 | 50 | 87) => Ok(None), // invalid function / unsupported / invalid parameter
            _ => Err(Error::Storage),
        };
    }
    if info.FileId.Identifier == [0; 16] {
        return Ok(None);
    }
    Ok(Some(Identity {
        volume: info.VolumeSerialNumber,
        file: info.FileId.Identifier,
    }))
}

impl CatalogFile {
    pub(super) fn open(path: &Path) -> Result<Self, Error> {
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
            .open(path)?;
        information(&file)?;
        let identity = identity(&file)?;
        Ok(Self { file, identity })
    }

    pub(super) fn validate_path(&self, path: &Path) -> Result<(), Error> {
        let file = OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
            .open(path)?;
        information(&file)?;
        if self.identity.is_some() && identity(&file)? != self.identity {
            return Err(Error::Storage);
        }
        Ok(())
    }

    pub(super) fn trim_unused(&self, unit: u64, max_logical: u64) -> Result<bool, Error> {
        let Some(expected) = &self.identity else {
            return Ok(false);
        };
        if identity(&self.file)?.as_ref() != Some(expected) {
            return Err(Error::Storage);
        }
        let before = information(&self.file)?;
        let logical = before.EndOfFile as u64;
        if logical == 0 || logical > max_logical {
            return Ok(false);
        }
        let target = allocated_estimate(logical, unit);
        if target >= before.AllocationSize as u64 {
            return Ok(false);
        }
        // FileAllocationInfo below EOF would truncate data. The rounded target
        // is always >= EOF, and the writer mutex excludes concurrent SQLite IO.
        let allocation = FILE_ALLOCATION_INFO {
            AllocationSize: i64::try_from(target).map_err(|_| Error::Storage)?,
        };
        let ok = unsafe {
            SetFileInformationByHandle(
                self.file.as_raw_handle(),
                FileAllocationInfo,
                (&allocation as *const FILE_ALLOCATION_INFO).cast(),
                std::mem::size_of::<FILE_ALLOCATION_INFO>() as u32,
            )
        };
        if ok == 0 {
            return Err(Error::Storage);
        }
        let after = information(&self.file)?;
        if after.EndOfFile != before.EndOfFile || identity(&self.file)?.as_ref() != Some(expected) {
            return Err(Error::Storage);
        }
        Ok(after.AllocationSize < before.AllocationSize)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{store::EvidenceStore, Frame, Retention, ScopeId};
    use std::fs;
    use zeroize::Zeroizing;

    fn allocate(file: &File, bytes: i64) {
        let info = FILE_ALLOCATION_INFO {
            AllocationSize: bytes,
        };
        assert_ne!(
            unsafe {
                SetFileInformationByHandle(
                    file.as_raw_handle(),
                    FileAllocationInfo,
                    (&info as *const FILE_ALLOCATION_INFO).cast(),
                    std::mem::size_of::<FILE_ALLOCATION_INFO>() as u32,
                )
            },
            0
        );
    }

    fn frame() -> Frame {
        let mut bytes = Vec::new();
        let mut state = 7u32;
        let pixels: Vec<_> = (0..64 * 64 * 4)
            .map(|_| {
                state ^= state << 13;
                state ^= state >> 17;
                state ^= state << 5;
                state as u8
            })
            .collect();
        {
            let mut encoder = png::Encoder::new(&mut bytes, 64, 64);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            encoder
                .write_header()
                .unwrap()
                .write_image_data(&pixels)
                .unwrap();
        }
        Frame::from_png(bytes).unwrap()
    }

    #[test]
    fn preallocation_recovers_under_the_original_quota_and_reopens() {
        let temp = tempfile::tempdir().unwrap();
        let scope = ScopeId::from_profile("catalog-allocation-quota").unwrap();
        let retention = Retention {
            max_bytes: 256 * 1024,
            ..Retention::default()
        };
        let mut store = EvidenceStore::open(
            temp.path(),
            scope.clone(),
            Zeroizing::new([7; 32]),
            retention.clone(),
            1000,
        )
        .unwrap();
        let catalog = store.directory.join(super::super::CATALOG);
        let before = fs::read(&catalog).unwrap();
        allocate(&store.catalog_file.file, 64 * 1024);
        assert_eq!(fs::read(&catalog).unwrap(), before);
        assert_eq!(
            information(&store.catalog_file.file)
                .unwrap()
                .AllocationSize,
            64 * 1024
        );
        let mut input = crate::tests::evidence(1001);
        input.frame = frame();
        let expected = input.frame.sha256.clone();
        let id = store.append(store.generation(), input, true, 1001).unwrap();
        assert!(store.disk_bytes().unwrap() <= retention.max_bytes);
        assert_eq!(
            store.read_frame(id, 1001).unwrap().unwrap().sha256,
            expected
        );
        drop(store);
        let mut reopened = EvidenceStore::open(
            temp.path(),
            scope,
            Zeroizing::new([7; 32]),
            retention.clone(),
            1002,
        )
        .unwrap();
        assert_eq!(
            reopened.read_frame(id, 1002).unwrap().unwrap().sha256,
            expected
        );
        assert!(reopened.disk_bytes().unwrap() <= retention.max_bytes);
        let check: String = reopened
            .db
            .query_row("PRAGMA quick_check", [], |r| r.get(0))
            .unwrap();
        assert_eq!(check, "ok");
    }

    #[test]
    fn allocation_trim_preserves_bytes_and_honors_logical_limit() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("catalog");
        let bytes = vec![0x5a; 24 * 1024];
        fs::write(&path, &bytes).unwrap();
        let pin = CatalogFile::open(&path).unwrap();
        allocate(&pin.file, 64 * 1024);
        assert!(!pin.trim_unused(4096, 16 * 1024).unwrap());
        assert_eq!(information(&pin.file).unwrap().AllocationSize, 64 * 1024);
        assert!(pin.trim_unused(4096, 64 * 1024).unwrap());
        assert_eq!(
            information(&pin.file).unwrap().EndOfFile,
            bytes.len() as i64
        );
        assert_eq!(fs::read(path).unwrap(), bytes);
    }

    #[test]
    fn pinned_catalog_refuses_replacement_until_closed() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("catalog");
        fs::write(&path, b"owned").unwrap();
        let pin = CatalogFile::open(&path).unwrap();
        assert!(fs::rename(&path, temp.path().join("moved")).is_err());
        assert!(fs::remove_file(&path).is_err());
        pin.validate_path(&path).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"owned");
        drop(pin);
        fs::rename(path, temp.path().join("moved")).unwrap();
    }

    #[test]
    fn catalog_pin_refuses_hardlinks_and_directories() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("catalog");
        fs::write(&path, b"owned").unwrap();
        fs::hard_link(&path, temp.path().join("alias")).unwrap();
        assert!(CatalogFile::open(&path).is_err());
        assert_eq!(fs::read(path).unwrap(), b"owned");
        let directory = temp.path().join("directory");
        fs::create_dir(&directory).unwrap();
        assert!(CatalogFile::open(&directory).is_err());
    }
}
