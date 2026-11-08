//! Separate local catalog and encrypted frame files. No activity DB, provider,
//! telemetry, sync, or public query path is used here. One OS file lock owns a
//! profile at a time. Capture times and all content live in encrypted headers.
use crate::{
    crypto::CryptoBox, DisplaySceneIdentity, Error, EvidenceSurface, Frame, Retention, ScopeId,
    SurfaceIdentity, TextEvidence, TextSource, TextState, MAX_RETENTION,
};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Arc,
};
use uuid::Uuid;
use zeroize::{Zeroize, Zeroizing};

const CATALOG: &str = "catalog.sqlite3";
const MAX_RECORDS: usize = 10_000;
const MAX_HEADER_BYTES: usize = 12 * 1024;
const MAX_CATALOG_BYTES: u64 = 16 * 1024 * 1024;
const MAX_CLOCK_SKEW_MS: i64 = 0;
mod activity_deletion;
mod binding;
pub use activity_deletion::{
    ActivityDeletionEffects, ActivityDeletionReport, PendingActivityDeletion,
};
mod ai_consent;
#[cfg(windows)]
mod catalog_allocation;
mod inactive;
mod metadata_wire;
mod preferences;
mod scene_ocr;
mod shared_frames;
pub use inactive::{InactiveMaintenance, InactiveProfileMaintenance};

#[derive(Clone, Copy, PartialEq, Eq)]
enum OpenPurpose {
    Ordinary,
    Maintenance,
    ActivityDeletion,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "metadata_wire::MetadataWire")]
pub struct EvidenceMetadata {
    pub id: Uuid,
    pub tracker_record_id: Option<String>,
    pub activity_binding: Option<crate::ActivityBinding>,
    pub surface: EvidenceSurface,
    pub observed_at_ms: i64,
    pub expires_at_ms: i64,
    #[serde(rename = "textEvidence")]
    pub text: TextEvidence,
    pub frame_retained: bool,
    pub frame_width: u32,
    pub frame_height: u32,
    pub frame_sha256: String,
}

impl std::fmt::Debug for EvidenceMetadata {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("EvidenceMetadata([redacted])")
    }
}

impl Drop for EvidenceMetadata {
    fn drop(&mut self) {
        if let Some(value) = &mut self.tracker_record_id {
            value.zeroize();
        }
    }
}

pub struct NewEvidence {
    pub tracker_record_id: Option<String>,
    pub surface: SurfaceIdentity,
    pub observed_at_ms: i64,
    pub text: TextEvidence,
    pub frame: Frame,
}

#[derive(Default, Debug)]
pub struct Removal {
    pub removed: Vec<Uuid>,
    pub pending_files: usize,
}

/// Aggregate local deletion estimate. No IDs, titles, text or frame content.
/// Image bytes exclude the shared SQLite catalog and filesystem allocation.
#[derive(Default, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletionPreview {
    pub record_count: usize,
    pub image_bytes: u64,
}

#[derive(Clone)]
struct Indexed {
    exclusion_keys: BTreeSet<String>,
    observed_at_ms: i64,
    expires_at_ms: i64,
    text_source: TextSource,
    text_state: TextState,
    frame_bytes: u64,
    frame_id: Uuid,
    frame_sha256: String,
    frame_width: u32,
    frame_height: u32,
    activity_binding: Option<crate::ActivityBinding>,
}

impl Indexed {
    fn new(metadata: &EvidenceMetadata, frame_bytes: u64, frame_id: Uuid) -> Self {
        Self {
            exclusion_keys: metadata.surface.exclusion_keys(),
            observed_at_ms: metadata.observed_at_ms,
            expires_at_ms: metadata.expires_at_ms,
            text_source: metadata.text.source(),
            text_state: metadata.text.state(),
            frame_bytes,
            frame_id,
            frame_sha256: metadata.frame_sha256.clone(),
            frame_width: metadata.frame_width,
            frame_height: metadata.frame_height,
            activity_binding: metadata.activity_binding.clone(),
        }
    }
}
impl Drop for Indexed {
    fn drop(&mut self) {
        self.frame_sha256.zeroize();
        for mut app in std::mem::take(&mut self.exclusion_keys) {
            app.zeroize();
        }
    }
}

/// Timeline pages contain no OCR text, document identity, or pixel data. A
/// caller explicitly reads one record when it needs the sensitive content.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceSummary {
    pub id: Uuid,
    pub observed_at_ms: i64,
    pub expires_at_ms: i64,
    pub text_source: TextSource,
    pub text_state: TextState,
    pub frame_retained: bool,
}

#[derive(Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum PageOrder {
    #[default]
    OldestFirst,
    NewestFirst,
}

impl PageOrder {
    fn is_oldest_first(&self) -> bool {
        *self == Self::OldestFirst
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PageCursor {
    instance: Uuid,
    revision: u64,
    observed_at_ms: i64,
    id: Uuid,
    #[serde(default, skip_serializing_if = "PageOrder::is_oldest_first")]
    order: PageOrder,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidencePage {
    pub records: Vec<EvidenceSummary>,
    pub next_cursor: Option<PageCursor>,
}

pub const MAX_PAGE_RECORDS: usize = 100;

pub struct EvidenceStore {
    // Close SQLite and its pinned catalog before releasing the writer lock.
    db: Connection,
    #[cfg(windows)]
    catalog_file: catalog_allocation::CatalogFile,
    _lock: Arc<File>,
    directory: PathBuf,
    root: PathBuf,
    scope: ScopeId,
    crypto: CryptoBox,
    retention: Retention,
    frame_budget: u64,
    catalog_budget: u64,
    journal_reserve: u64,
    allocation_unit: u64,
    index: BTreeMap<Uuid, Indexed>,
    instance: Uuid,
    revision: u64,
    generation: u64,
    high_water_ms: i64,
    poisoned: bool,
    capture_paused: bool,
}

fn regular(path: &Path) -> Result<bool, Error> {
    match fs::symlink_metadata(path) {
        Ok(meta) => {
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                if meta.file_attributes() & 0x400 != 0 {
                    return Err(Error::Storage);
                }
            }
            if meta.file_type().is_symlink() || !meta.is_file() {
                return Err(Error::Storage);
            }
            Ok(true)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(_) => Err(Error::Storage),
    }
}

fn directory(path: &Path) -> Result<(), Error> {
    match fs::symlink_metadata(path) {
        Ok(meta) => {
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                if meta.file_attributes() & 0x400 != 0 {
                    return Err(Error::Storage);
                }
            }
            if meta.file_type().is_symlink() || !meta.is_dir() {
                return Err(Error::Storage);
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => fs::create_dir(path)?,
        Err(_) => return Err(Error::Storage),
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

fn open_private(path: &Path, create_new: bool) -> Result<File, Error> {
    if !create_new {
        regular(path)?;
    }
    let mut options = OpenOptions::new();
    options.read(true).write(true);
    if create_new {
        options.create_new(true);
    } else {
        options.create(true);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    Ok(options.open(path)?)
}

fn device_lock(root: &Path) -> Result<Arc<File>, Error> {
    let lock = open_private(&root.join("device-writer.lock"), false)?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(50);
    loop {
        match lock.try_lock() {
            Ok(()) => return Ok(Arc::new(lock)),
            Err(std::fs::TryLockError::WouldBlock) if std::time::Instant::now() < deadline => {
                std::thread::sleep(std::time::Duration::from_millis(2));
            }
            Err(_) => return Err(Error::Storage),
        }
    }
}

fn allocated_bytes(path: &Path, meta: &fs::Metadata) -> Result<u64, Error> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let _ = path;
        Ok(meta.len().max(meta.blocks().saturating_mul(512)))
    }
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::{
            FileStandardInfo, GetFileInformationByHandleEx, FILE_STANDARD_INFO,
        };
        let file = File::open(path)?;
        let mut info: FILE_STANDARD_INFO = unsafe { std::mem::zeroed() };
        let ok = unsafe {
            GetFileInformationByHandleEx(
                file.as_raw_handle(),
                FileStandardInfo,
                (&mut info as *mut FILE_STANDARD_INFO).cast(),
                std::mem::size_of::<FILE_STANDARD_INFO>() as u32,
            )
        };
        if ok == 0 {
            return Err(Error::Storage);
        }
        Ok(meta
            .len()
            .max(u64::try_from(info.AllocationSize).map_err(|_| Error::Storage)?))
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = path;
        Ok(meta.len())
    }
}

fn allocation_unit(root: &Path) -> Result<u64, Error> {
    #[cfg(unix)]
    let unit = {
        use std::os::unix::ffi::OsStrExt;
        let path =
            std::ffi::CString::new(root.as_os_str().as_bytes()).map_err(|_| Error::Storage)?;
        let mut info: libc::statvfs = unsafe { std::mem::zeroed() };
        if unsafe { libc::statvfs(path.as_ptr(), &mut info) } != 0 {
            return Err(Error::Storage);
        }
        #[allow(clippy::unnecessary_cast)] // c_ulong differs between supported ABIs.
        let unit = if info.f_frsize != 0 {
            info.f_frsize
        } else {
            info.f_bsize
        } as u64;
        unit
    };
    #[cfg(windows)]
    let unit = {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{GetDiskFreeSpaceW, GetVolumePathNameW};
        let path: Vec<u16> = root.as_os_str().encode_wide().chain(Some(0)).collect();
        let mut volume = vec![0u16; 32768];
        if unsafe { GetVolumePathNameW(path.as_ptr(), volume.as_mut_ptr(), volume.len() as u32) }
            == 0
        {
            return Err(Error::Storage);
        }
        let (mut sectors, mut bytes, mut free, mut total) = (0, 0, 0, 0);
        if unsafe {
            GetDiskFreeSpaceW(
                volume.as_ptr(),
                &mut sectors,
                &mut bytes,
                &mut free,
                &mut total,
            )
        } == 0
        {
            return Err(Error::Storage);
        }
        u64::from(sectors) * u64::from(bytes)
    };
    #[cfg(not(any(unix, windows)))]
    let unit = 4096u64;
    if !(512..=16 * 1024 * 1024).contains(&unit) || !unit.is_power_of_two() {
        return Err(Error::Storage);
    }
    Ok(unit)
}

fn allocated_estimate(bytes: u64, unit: u64) -> u64 {
    bytes.div_ceil(unit).saturating_mul(unit)
}

fn root_bytes(root: &Path) -> Result<u64, Error> {
    let mut bytes = 0u64;
    let mut count = 0usize;
    let mut directories = vec![(root.to_path_buf(), 0)];
    while let Some((directory, depth)) = directories.pop() {
        for entry in fs::read_dir(directory)? {
            count += 1;
            if count > MAX_RECORDS + 512 {
                return Err(Error::StorageFull);
            }
            let path = entry?.path();
            let meta = fs::symlink_metadata(&path)?;
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                if meta.file_attributes() & 0x400 != 0 {
                    return Err(Error::Storage);
                }
            }
            if meta.file_type().is_symlink() {
                return Err(Error::Storage);
            }
            if meta.is_dir() {
                if depth != 0 {
                    return Err(Error::Storage);
                }
                #[cfg(unix)]
                {
                    bytes = bytes
                        .checked_add(allocated_bytes(&path, &meta)?)
                        .ok_or(Error::StorageFull)?;
                }
                directories.push((path, depth + 1));
            } else if meta.is_file() {
                bytes = bytes
                    .checked_add(allocated_bytes(&path, &meta)?)
                    .ok_or(Error::StorageFull)?;
            } else {
                return Err(Error::Storage);
            }
        }
    }
    Ok(bytes)
}

impl EvidenceStore {
    /// Native account ownership check; never expose this namespace over IPC.
    pub fn scope(&self) -> &ScopeId {
        &self.scope
    }

    pub fn open(
        root: &Path,
        scope: ScopeId,
        key: Zeroizing<[u8; 32]>,
        retention: Retention,
        now_ms: i64,
    ) -> Result<Self, Error> {
        Self::open_with_key_provider(
            root,
            scope,
            &mut crate::key_store::SuppliedKey(Some(key)),
            retention,
            now_ms,
        )
    }

    /// Resolve the profile key only after acquiring the device writer lock.
    /// The provider must never replace a missing key for existing evidence.
    pub fn open_with_key_provider(
        root: &Path,
        scope: ScopeId,
        keys: &mut dyn crate::key_store::ProfileKeyProvider,
        retention: Retention,
        now_ms: i64,
    ) -> Result<Self, Error> {
        retention.validate()?;
        if !root.is_absolute() || now_ms < 0 {
            return Err(Error::Invalid("store path or clock"));
        }
        directory(root)?;
        // A device-wide writer owns profile switching and quota accounting;
        // profiles never concurrently race the same computer's 1 GiB budget.
        Self::open_locked(
            root,
            scope,
            keys,
            retention,
            now_ms,
            device_lock(root)?,
            OpenPurpose::Ordinary,
        )
    }

    // The shared Arc retains the SAME OS lock handle while an inactive profile
    // is maintained. No duplicated handle or second lock acquisition is used.
    fn open_locked(
        root: &Path,
        scope: ScopeId,
        keys: &mut dyn crate::key_store::ProfileKeyProvider,
        retention: Retention,
        now_ms: i64,
        lock: Arc<File>,
        purpose: OpenPurpose,
    ) -> Result<Self, Error> {
        let existing_only = purpose != OpenPurpose::Ordinary;
        let path = root.join(scope.path_component());
        if existing_only {
            // Inactive maintenance never initializes a profile or a new key.
            // Inspect before directory() can create anything.
            let metadata = fs::symlink_metadata(&path)?;
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                if metadata.file_attributes() & 0x400 != 0 {
                    return Err(Error::Storage);
                }
            }
            if !metadata.is_dir() || metadata.file_type().is_symlink() {
                return Err(Error::Storage);
            }
            if !regular(&path.join(CATALOG))? || fs::metadata(path.join(CATALOG))?.len() == 0 {
                return Err(Error::Storage);
            }
            if fs::metadata(path.join(CATALOG))?.len() > MAX_CATALOG_BYTES {
                return Err(Error::StorageFull);
            }
            // A SQLite read-only connection can still create WAL/SHM files.
            // Check the fixed format prefix WITHOUT opening SQLite first.
            // https://sqlite.org/fileformat.html#the_database_header
            // Our catalog is page-size4096, DELETE journal, user_version2.
            // A different/hot-journal format stays untouched for recovery by
            // its owning version; the prefix is not an authentication proof.
            let mut prefix = [0u8; 100];
            File::open(path.join(CATALOG))?.read_exact(&mut prefix)?;
            if &prefix[..16] != b"SQLite format 3\0"
                || u16::from_be_bytes([prefix[16], prefix[17]]) != 4096
                || prefix[18] != 1
                || prefix[19] != 1
                || u32::from_be_bytes(prefix[60..64].try_into().expect("fixed header")) != 2
            {
                return Err(Error::Storage);
            }
        } else {
            directory(&path)?;
        }
        let db_path = path.join(CATALOG);
        let existing = regular(&db_path)? && fs::metadata(&db_path)?.len() != 0;
        // A failed/crashed initial open may leave an empty catalog. Anything
        // else in this profile is preserved and prevents generating a new key.
        let may_create = !existing_only
            && !existing
            && fs::read_dir(&path)?
                .all(|entry| entry.is_ok_and(|entry| entry.file_name() == CATALOG));
        let key = keys.profile_key(&scope, may_create)?;
        let crypto = CryptoBox::new(key)?;
        let aad = format!("control:{}", scope.path_component());
        if existing_only {
            // Authenticate an existing inactive catalog READ ONLY before any
            // journal/page/version/permission mutation. Unknown older/future
            // formats and wrong keys are preserved byte-for-byte.
            let check =
                Connection::open_with_flags(&db_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
            check.busy_timeout(std::time::Duration::from_millis(50))?;
            check.execute_batch("PRAGMA trusted_schema=OFF;")?;
            if check.query_row("PRAGMA user_version", [], |r| r.get::<_, u32>(0))? != 2 {
                return Err(Error::Storage);
            }
            let sealed: Vec<u8> =
                check.query_row("SELECT key_check FROM control WHERE id=1", [], |r| r.get(0))?;
            if sealed.len() > MAX_HEADER_BYTES + 64
                || crypto.open(aad.as_bytes(), &sealed)?.as_slice() != b"drifty-evidence-key-v1"
            {
                return Err(Error::Authentication);
            }
            directory(&path)?;
        }
        #[cfg(windows)]
        let catalog_file = catalog_allocation::CatalogFile::open(&db_path)?;
        #[cfg(not(windows))]
        drop(open_private(&db_path, false)?);
        let mut db = Connection::open(&db_path)?;
        #[cfg(windows)]
        catalog_file.validate_path(&db_path)?;
        db.busy_timeout(std::time::Duration::from_millis(50))?;
        if !existing {
            db.execute_batch("PRAGMA page_size=4096;")?;
        }
        if db.query_row("PRAGMA page_size", [], |r| r.get::<_, u32>(0))? != 4096 {
            return Err(Error::Storage);
        }
        let index_budget = (retention.max_bytes / 8).clamp(64 * 1024, MAX_CATALOG_BYTES);
        let allocation_unit = allocation_unit(root)?;
        if allocation_unit > retention.max_bytes / 8 {
            return Err(Error::StorageFull);
        }
        if fs::metadata(&db_path)?.len() > index_budget {
            return Err(Error::StorageFull);
        }
        let frame_budget = retention
            .max_bytes
            .checked_sub(index_budget * 2 + 64 * 1024)
            .ok_or(Error::Invalid("quota reserve"))?;
        let journal_reserve = allocated_estimate(index_budget + 64 * 1024, allocation_unit);
        if !existing && root_bytes(root)? + index_budget * 2 + 64 * 1024 > retention.max_bytes {
            return Err(Error::StorageFull);
        }
        // DELETE journal contains only encrypted headers and opaque IDs/sizes.
        // Reserve the entire catalog plus its rollback journal outside media.
        db.execute_batch(&format!("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF; PRAGMA secure_delete=ON; PRAGMA max_page_count={};", index_budget / 4096))?;
        if !existing {
            let tx = db.transaction()?;
            tx.execute_batch("CREATE TABLE control (id INTEGER PRIMARY KEY CHECK(id=1), generation INTEGER NOT NULL, high_water_ms INTEGER NOT NULL, key_check BLOB NOT NULL, capture_paused INTEGER NOT NULL CHECK(capture_paused IN (0,1))); CREATE TABLE evidence (id TEXT PRIMARY KEY, header BLOB NOT NULL, frame_bytes INTEGER NOT NULL CHECK(frame_bytes>=0)); CREATE TABLE pending_files (id TEXT PRIMARY KEY, ownership BLOB NOT NULL); PRAGMA user_version=2;")?;
            tx.execute(
                "INSERT INTO control VALUES (1,0,?1,?2,0)",
                params![
                    now_ms,
                    crypto.seal(aad.as_bytes(), b"drifty-evidence-key-v1")?
                ],
            )?;
            tx.commit()?;
        } else if db.query_row("PRAGMA user_version", [], |r| r.get::<_, u32>(0))? != 2 {
            return Err(Error::Storage);
        }
        let (generation, high_water_ms, check, capture_paused): (i64, i64, Vec<u8>, bool) = db
            .query_row(
            "SELECT generation, high_water_ms, key_check, capture_paused FROM control WHERE id=1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )?;
        let generation = u64::try_from(generation).map_err(|_| Error::Authentication)?;
        if crypto.open(aad.as_bytes(), &check)?.as_slice() != b"drifty-evidence-key-v1" {
            return Err(Error::Authentication);
        }
        let mut index = BTreeMap::new();
        {
            let mut query = db.prepare("SELECT id,header,frame_bytes FROM evidence LIMIT 10001")?;
            let rows = query.query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Vec<u8>>(1)?,
                    r.get::<_, i64>(2)?,
                ))
            })?;
            for row in rows {
                let (id, sealed, frame_bytes) = row?;
                let frame_bytes = u64::try_from(frame_bytes).map_err(|_| Error::Authentication)?;
                if frame_bytes > crate::MAX_FRAME_BYTES as u64 + 64 {
                    return Err(Error::Authentication);
                }
                let id = Uuid::parse_str(&id).map_err(|_| Error::Storage)?;
                if sealed.len() > MAX_HEADER_BYTES + 64 || index.len() >= MAX_RECORDS {
                    return Err(Error::Storage);
                }
                let clear = crypto.open(
                    format!("metadata:{}:{id}", scope.path_component()).as_bytes(),
                    &sealed,
                )?;
                let (metadata, frame_id) = shared_frames::decode_header(&clear)?;
                validate_metadata(&metadata)?;
                if metadata.id != id || metadata.frame_retained != (frame_bytes > 0) {
                    return Err(Error::Authentication);
                }
                index.insert(id, Indexed::new(&metadata, frame_bytes, frame_id));
            }
        }
        shared_frames::validate_references(&index)?;
        let next = generation
            .checked_add(1)
            .filter(|n| *n < i64::MAX as u64)
            .ok_or(Error::Storage)?;
        db.execute("UPDATE control SET generation=?1 WHERE id=1", [next as i64])?;
        let mut store = Self {
            db,
            #[cfg(windows)]
            catalog_file,
            _lock: lock,
            directory: path,
            root: root.to_path_buf(),
            scope,
            crypto,
            retention,
            frame_budget,
            catalog_budget: index_budget,
            journal_reserve,
            allocation_unit,
            index,
            instance: Uuid::new_v4(),
            revision: 0,
            generation: next,
            high_water_ms,
            poisoned: false,
            capture_paused,
        };
        // An interrupted activity deletion must be resolved before any content
        // can be read or capture resumed, including after signed-out startup.
        if purpose != OpenPurpose::ActivityDeletion {
            activity_deletion::recover_pending(&mut store)?;
        }
        // Inactive maintenance obtains its own aggregate removal receipt; it
        // must not run invisibly before that caller can count the removals.
        if existing_only {
            return Ok(store);
        }
        // On a clock rollback, do not decrypt/show or extend the lifetime of
        // previously stored observations. Explicit cleanup can still purge them.
        match store.maintenance(now_ms) {
            // Return the empty, clock-blocked store so explicit purge and disk
            // cleanup remain possible while capture/read stay blocked.
            Err(Error::ClockRollback) | Ok(_) => {}
            Err(error) => return Err(error),
        }
        Ok(store)
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }
    pub fn capture_paused(&self) -> bool {
        self.capture_paused
    }

    pub(crate) fn pause_capture(&mut self) -> Result<(), Error> {
        // Same durable generation barrier as deletion, including an empty range.
        self.remove_ids(&[], true)?;
        Ok(())
    }

    pub(crate) fn resume_capture(&mut self, now_ms: i64) -> Result<(), Error> {
        self.maintenance(now_ms)?;
        if let Err(error) = self
            .db
            .execute("UPDATE control SET capture_paused=0 WHERE id=1", [])
        {
            self.poisoned = true;
            return Err(error.into());
        }
        self.capture_paused = false;
        Ok(())
    }

    pub fn next_expiry_ms(&self) -> Option<i64> {
        self.index.values().map(|row| row.expires_at_ms).min()
    }
    fn frame_path(&self, id: Uuid) -> PathBuf {
        self.directory.join(format!("frame-{id}.bin"))
    }
    fn aad(&self, kind: &str, id: Uuid) -> Vec<u8> {
        format!("{kind}:{}:{id}", self.scope.path_component()).into_bytes()
    }

    fn clock_rolled_back(&self, now_ms: i64) -> bool {
        now_ms < 0 || now_ms < self.high_water_ms.saturating_sub(MAX_CLOCK_SKEW_MS)
    }

    fn invalidate_clock_rollback(&mut self) -> Result<Removal, Error> {
        // Retention is an upper bound, not a promise to retain until TTL.
        // An untrustworthy wall clock must not extend old observations.
        let ids: Vec<_> = self.index.keys().copied().collect();
        self.remove_ids(&ids, true)
    }

    fn check_clock(&mut self, now_ms: i64) -> Result<(), Error> {
        if self.poisoned {
            return Err(Error::Storage);
        }
        if self.clock_rolled_back(now_ms) {
            self.invalidate_clock_rollback()?;
            return Err(Error::ClockRollback);
        }
        self.high_water_ms = self.high_water_ms.max(now_ms);
        self.db.execute(
            "UPDATE control SET high_water_ms=?1 WHERE id=1",
            [self.high_water_ms],
        )?;
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn append(
        &mut self,
        expected_generation: u64,
        evidence: NewEvidence,
        retain_image: bool,
        now_ms: i64,
    ) -> Result<Uuid, Error> {
        self.append_if_current(expected_generation, evidence, retain_image, now_ms, &|| {
            true
        })
    }

    pub(crate) fn append_if_current(
        &mut self,
        expected_generation: u64,
        evidence: NewEvidence,
        retain_image: bool,
        now_ms: i64,
        current: &dyn Fn() -> bool,
    ) -> Result<Uuid, Error> {
        self.append_surface_if_current(
            expected_generation,
            evidence.tracker_record_id,
            EvidenceSurface::Document(evidence.surface),
            evidence.observed_at_ms,
            evidence.text,
            evidence.frame,
            retain_image,
            now_ms,
            current,
        )
    }

    /// Native-only scene storage; no runtime calls this until native scene
    /// admission, explicit general-recording consent and lifecycle QA are ready.
    #[allow(clippy::too_many_arguments)]
    pub fn append_scene_if_current(
        &mut self,
        expected_generation: u64,
        scene: DisplaySceneIdentity,
        observed_at_ms: i64,
        text: TextEvidence,
        frame: Frame,
        retain_image: bool,
        now_ms: i64,
        current: &dyn Fn() -> bool,
    ) -> Result<Uuid, Error> {
        self.append_surface_if_current(
            expected_generation,
            None,
            EvidenceSurface::ActiveDisplayScene(scene),
            observed_at_ms,
            text,
            frame,
            retain_image,
            now_ms,
            current,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn append_surface_if_current(
        &mut self,
        expected_generation: u64,
        tracker_record_id: Option<String>,
        surface: EvidenceSurface,
        observed_at_ms: i64,
        text: TextEvidence,
        frame: Frame,
        retain_image: bool,
        now_ms: i64,
        current: &dyn Fn() -> bool,
    ) -> Result<Uuid, Error> {
        if !current() {
            return Err(Error::Invalidated);
        }
        self.check_clock(now_ms)?;
        if expected_generation != self.generation || self.capture_paused {
            return Err(Error::Invalidated);
        }
        let expires_at_ms = observed_at_ms
            .checked_add(self.retention.ttl.as_millis() as i64)
            .ok_or(Error::Invalid("expiry"))?;
        if observed_at_ms > now_ms || expires_at_ms <= self.high_water_ms {
            return Err(Error::Invalid("capture time"));
        }
        self.maintenance(now_ms)?;
        let id = Uuid::new_v4();
        let frame_id = if retain_image {
            self.matching_frame(&frame)?.unwrap_or(id)
        } else {
            id
        };
        let metadata = EvidenceMetadata {
            id,
            tracker_record_id,
            activity_binding: None,
            surface,
            observed_at_ms,
            expires_at_ms,
            text,
            frame_retained: retain_image,
            frame_width: frame.width,
            frame_height: frame.height,
            frame_sha256: frame.sha256.clone(),
        };
        validate_metadata(&metadata)?;
        let clear = shared_frames::encode_header(&metadata, frame_id)?;
        if clear.len() > MAX_HEADER_BYTES {
            return Err(Error::Invalid("metadata size"));
        }
        let header = self.crypto.seal(&self.aad("metadata", id), &clear)?;
        let frame = if retain_image {
            self.crypto
                .seal(&self.aad("frame", frame_id), frame.bytes())?
        } else {
            Vec::new()
        };
        if frame.len() as u64 > self.frame_budget {
            return Err(Error::StorageFull);
        }
        let mut incoming_disk = if self.frame_referenced(frame_id) {
            0
        } else {
            allocated_estimate(frame.len() as u64, self.allocation_unit)
        };
        let metadata_growth = allocated_estimate(64 * 1024, self.allocation_unit);
        // Reserve catalog pages too: a text-only workload can fill SQLite
        // before the media/device quota. Freed pages are reused without VACUUM.
        // This is conservative admission headroom; real I/O/SQLite FULL still
        // follows the failure/recovery path rather than claiming persistence.
        let catalog_growth = allocated_estimate(header.len() as u64 + 24 * 1024, 4096);
        #[cfg(windows)]
        let mut catalog_trim_attempted = false;
        while self.catalog_used_bytes()?.saturating_add(catalog_growth) > self.catalog_budget
            || self.index.len() >= MAX_RECORDS
            || self.used_frame_bytes()
                + if self.frame_referenced(frame_id) {
                    0
                } else {
                    frame.len() as u64
                }
                > self.frame_budget
            || self.disk_bytes()? + incoming_disk + metadata_growth + self.journal_reserve
                > self.retention.max_bytes
        {
            let Some(oldest) = self
                .index
                .iter()
                .min_by_key(|(id, r)| (r.observed_at_ms, **id))
                .map(|(id, _)| *id)
            else {
                // NTFS can reserve more catalog clusters than SQLite's EOF.
                // Once no frames remain, recover that unused allocation once;
                // keep the original catalog, journal and device quota reserves.
                #[cfg(windows)]
                if !catalog_trim_attempted
                    && self.catalog_used_bytes()?.saturating_add(catalog_growth)
                        <= self.catalog_budget
                    && self.disk_bytes()? + incoming_disk + metadata_growth + self.journal_reserve
                        > self.retention.max_bytes
                {
                    catalog_trim_attempted = true;
                    if !current() {
                        return Err(Error::Invalidated);
                    }
                    match self
                        .catalog_file
                        .trim_unused(self.allocation_unit, self.catalog_budget)
                    {
                        Ok(true) => continue,
                        Ok(false) => {}
                        Err(error) => {
                            self.poisoned = true;
                            return Err(error);
                        }
                    }
                }
                return Err(Error::StorageFull);
            };
            self.remove_ids(&[oldest], false)?;
            // Eviction may remove the last reference to the candidate. Admit
            // and write its payload again instead of publishing a dangling ref.
            incoming_disk = if self.frame_referenced(frame_id) {
                0
            } else {
                allocated_estimate(frame.len() as u64, self.allocation_unit)
            };
        }
        // A false condition has just scanned the device root. Evictions and
        // catalog trims re-enter that condition before admitting this write.
        if !current() {
            return Err(Error::Invalidated);
        }
        let frame_path = self.frame_path(frame_id);
        if retain_image && !self.frame_referenced(frame_id) {
            let mut file = open_private(&frame_path, true)?;
            let ownership = self
                .crypto
                .seal(&self.aad("pending", frame_id), b"owned-file-v1")?;
            if let Err(error) = self.db.execute(
                "INSERT INTO pending_files VALUES (?1,?2)",
                params![frame_id.to_string(), ownership],
            ) {
                drop(file);
                let _ = fs::remove_file(&frame_path);
                self.poisoned = true;
                return Err(error.into());
            }
            if let Err(error) = file.write_all(&frame).and_then(|_| file.sync_all()) {
                drop(file);
                let _ = fs::remove_file(&frame_path);
                return Err(error.into());
            }
        }
        if !current() {
            self.cleanup_orphans()?;
            return Err(Error::Invalidated);
        }
        let result = (|| -> Result<(), Error> {
            let tx = self.db.transaction()?;
            tx.execute(
                "INSERT INTO evidence VALUES (?1,?2,?3)",
                params![id.to_string(), header, frame.len() as i64],
            )?;
            tx.execute(
                "DELETE FROM pending_files WHERE id=?1",
                [frame_id.to_string()],
            )?;
            if !current() {
                tx.rollback()?;
                return Err(Error::Invalidated);
            }
            tx.commit()?;
            Ok(())
        })();
        if let Err(error) = result {
            if matches!(error, Error::Invalidated) {
                self.cleanup_orphans()?;
                return Err(error);
            }
            // A commit error is not proof the commit did not take effect. Keep
            // the owned blob; reopen reconciles committed rows and pending work.
            self.poisoned = true;
            return Err(error);
        }
        self.index
            .insert(id, Indexed::new(&metadata, frame.len() as u64, frame_id));
        self.revision = self.revision.checked_add(1).ok_or(Error::Storage)?;
        if !current() {
            self.remove_ids(&[id], false)?;
            return Err(Error::Invalidated);
        }
        Ok(id)
    }

    fn catalog_used_bytes(&self) -> Result<u64, Error> {
        let pages: u32 = self
            .db
            .query_row("PRAGMA page_count", [], |row| row.get(0))?;
        let free: u32 = self
            .db
            .query_row("PRAGMA freelist_count", [], |row| row.get(0))?;
        pages
            .checked_sub(free)
            .map(|used| u64::from(used) * 4096)
            .ok_or(Error::Storage)
    }

    pub(crate) fn invalidate_cursors(&mut self) -> Result<(), Error> {
        self.revision = self.revision.checked_add(1).ok_or(Error::Storage)?;
        Ok(())
    }

    pub fn list_page(
        &mut self,
        cursor: Option<PageCursor>,
        limit: usize,
        now_ms: i64,
    ) -> Result<EvidencePage, Error> {
        self.list_page_excluding(cursor, limit, now_ms, &BTreeSet::new())
    }

    /// Filter before pagination so excluded records neither leak summaries nor
    /// consume the page. The index derives app identity from authenticated headers.
    pub(crate) fn list_page_excluding(
        &mut self,
        cursor: Option<PageCursor>,
        limit: usize,
        now_ms: i64,
        excluded: &BTreeSet<String>,
    ) -> Result<EvidencePage, Error> {
        self.list_page_excluding_in_order(cursor, limit, now_ms, excluded, PageOrder::OldestFirst)
    }

    /// Settings opens the newest evidence first and pages toward older records.
    /// Keep chronological activity/AI reads on their existing ordering.
    pub(crate) fn list_recent_page_excluding(
        &mut self,
        cursor: Option<PageCursor>,
        limit: usize,
        now_ms: i64,
        excluded: &BTreeSet<String>,
    ) -> Result<EvidencePage, Error> {
        self.list_page_excluding_in_order(cursor, limit, now_ms, excluded, PageOrder::NewestFirst)
    }

    fn list_page_excluding_in_order(
        &mut self,
        cursor: Option<PageCursor>,
        limit: usize,
        now_ms: i64,
        excluded: &BTreeSet<String>,
        order: PageOrder,
    ) -> Result<EvidencePage, Error> {
        if !(1..=MAX_PAGE_RECORDS).contains(&limit) {
            return Err(Error::Invalid("page limit"));
        }
        self.maintenance(now_ms)?;
        if cursor.as_ref().is_some_and(|c| {
            c.instance != self.instance || c.revision != self.revision || c.order != order
        }) {
            return Err(Error::Invalidated);
        }
        let mut rows: Vec<_> = self
            .index
            .iter()
            .filter(|(_, row)| !crate::scene::exclusion_keys_match(&row.exclusion_keys, excluded))
            .filter(|(id, row)| {
                cursor.as_ref().is_none_or(|c| match order {
                    PageOrder::OldestFirst => (row.observed_at_ms, **id) > (c.observed_at_ms, c.id),
                    PageOrder::NewestFirst => (row.observed_at_ms, **id) < (c.observed_at_ms, c.id),
                })
            })
            .collect();
        rows.sort_unstable_by_key(|(id, row)| (row.observed_at_ms, **id));
        if order == PageOrder::NewestFirst {
            rows.reverse();
        }
        let more = rows.len() > limit;
        let records: Vec<_> = rows
            .into_iter()
            .take(limit)
            .map(|(id, row)| EvidenceSummary {
                id: *id,
                observed_at_ms: row.observed_at_ms,
                expires_at_ms: row.expires_at_ms,
                text_source: row.text_source,
                text_state: row.text_state,
                frame_retained: row.frame_bytes > 0,
            })
            .collect();
        let next_cursor = records.last().filter(|_| more).map(|last| PageCursor {
            instance: self.instance,
            revision: self.revision,
            observed_at_ms: last.observed_at_ms,
            id: last.id,
            order,
        });
        Ok(EvidencePage {
            records,
            next_cursor,
        })
    }

    pub fn read_metadata(
        &mut self,
        id: Uuid,
        now_ms: i64,
    ) -> Result<Option<EvidenceMetadata>, Error> {
        self.maintenance(now_ms)?;
        self.load_metadata(id)
    }

    fn load_metadata(&self, id: Uuid) -> Result<Option<EvidenceMetadata>, Error> {
        let Some(row) = self.index.get(&id) else {
            return Ok(None);
        };
        // The connection is private to this writer; no stale plaintext content
        // is cached for the lifetime of a profile or cloned by a list request.
        let sealed: Vec<u8> = self.db.query_row(
            "SELECT header FROM evidence WHERE id=?1",
            [id.to_string()],
            |r| r.get(0),
        )?;
        if sealed.len() > MAX_HEADER_BYTES + 64 {
            return Err(Error::Authentication);
        }
        let clear = self.crypto.open(&self.aad("metadata", id), &sealed)?;
        let (metadata, frame_id) = shared_frames::decode_header(&clear)?;
        validate_metadata(&metadata)?;
        if metadata.id != id
            || frame_id != row.frame_id
            || metadata.frame_sha256 != row.frame_sha256
            || metadata.frame_width != row.frame_width
            || metadata.frame_height != row.frame_height
            || metadata.observed_at_ms != row.observed_at_ms
            || metadata.expires_at_ms != row.expires_at_ms
            || metadata.text.source() != row.text_source
            || metadata.text.state() != row.text_state
            || metadata.frame_retained != (row.frame_bytes > 0)
            || metadata.activity_binding != row.activity_binding
        {
            return Err(Error::Authentication);
        }
        Ok(Some(metadata))
    }

    pub fn read_frame(&mut self, id: Uuid, now_ms: i64) -> Result<Option<Frame>, Error> {
        self.maintenance(now_ms)?;
        let Some(row) = self.index.get(&id) else {
            return Ok(None);
        };
        if row.frame_bytes == 0 {
            return Ok(None);
        }
        let metadata = self.load_metadata(id)?.ok_or(Error::Authentication)?;
        let clear = self.read_frame_bytes(row.frame_id, row.frame_bytes)?;
        let frame = Frame::from_png(clear.to_vec())?;
        if frame.sha256 != metadata.frame_sha256
            || frame.width != metadata.frame_width
            || frame.height != metadata.frame_height
        {
            return Err(Error::Authentication);
        }
        Ok(Some(frame))
    }

    pub fn preview_deletion(
        &self,
        start_ms: Option<i64>,
        end_ms: Option<i64>,
    ) -> Result<DeletionPreview, Error> {
        let range = match (start_ms, end_ms) {
            (None, None) => None,
            (Some(start), Some(end)) if start >= 0 && end > start => Some(start..end),
            _ => return Err(Error::Invalid("delete range")),
        };
        if self.poisoned {
            return Err(Error::Storage);
        }
        let mut preview = DeletionPreview::default();
        let mut selected_frames = BTreeMap::new();
        let mut kept_frames = BTreeSet::new();
        for row in self.index.values() {
            if range
                .as_ref()
                .is_none_or(|r| r.contains(&row.observed_at_ms))
            {
                preview.record_count += 1;
                if row.frame_bytes > 0 {
                    selected_frames.insert(row.frame_id, row.frame_bytes);
                }
            } else if row.frame_bytes > 0 {
                kept_frames.insert(row.frame_id);
            }
        }
        preview.image_bytes = selected_frames
            .iter()
            .filter(|(id, _)| !kept_frames.contains(id))
            .map(|(_, size)| size)
            .sum();
        Ok(preview)
    }

    pub fn delete_range(&mut self, start_ms: i64, end_ms: i64) -> Result<Removal, Error> {
        if start_ms < 0 || end_ms <= start_ms {
            return Err(Error::Invalid("delete range"));
        }
        let ids: Vec<_> = self
            .index
            .iter()
            .filter(|(_, r)| (start_ms..end_ms).contains(&r.observed_at_ms))
            .map(|(id, _)| *id)
            .collect();
        self.remove_ids(&ids, true)
    }

    /// Delete one opaque screen record. It invalidates in-flight work but keeps
    /// capture running; only range and full deletion pause (owner decision
    /// 2026-10-26). This never mutates its linked activity row, credited time
    /// or classification.
    pub fn delete_record(&mut self, id: Uuid, now_ms: i64) -> Result<Removal, Error> {
        self.maintenance(now_ms)?;
        let ids = if self.index.contains_key(&id) {
            vec![id]
        } else {
            Vec::new()
        };
        self.remove_ids_and_pause(&ids, true, false)
    }

    pub fn purge(&mut self) -> Result<Removal, Error> {
        let ids: Vec<_> = self.index.keys().copied().collect();
        self.remove_ids(&ids, true)
    }

    fn remove_ids(&mut self, ids: &[Uuid], invalidate: bool) -> Result<Removal, Error> {
        self.remove_ids_and_pause(ids, invalidate, invalidate)
    }

    fn remove_ids_and_pause(
        &mut self,
        ids: &[Uuid],
        invalidate: bool,
        pause: bool,
    ) -> Result<Removal, Error> {
        if self.poisoned {
            return Err(Error::Storage);
        }
        let next = if invalidate {
            self.generation
                .checked_add(1)
                .filter(|n| *n < i64::MAX as u64)
                .ok_or(Error::Storage)?
        } else {
            self.generation
        };
        let removed_ids: BTreeSet<_> = ids.iter().copied().collect();
        let retained_frames: BTreeSet<_> = self
            .index
            .iter()
            .filter(|(id, row)| !removed_ids.contains(id) && row.frame_bytes > 0)
            .map(|(_, row)| row.frame_id)
            .collect();
        let mut ownership = BTreeMap::new();
        for id in ids {
            if let Some(row) = self
                .index
                .get(id)
                .filter(|row| row.frame_bytes > 0 && !retained_frames.contains(&row.frame_id))
            {
                if let std::collections::btree_map::Entry::Vacant(entry) =
                    ownership.entry(row.frame_id)
                {
                    entry.insert(
                        self.crypto
                            .seal(&self.aad("pending", row.frame_id), b"owned-file-v1")?,
                    );
                }
            }
        }
        let result = (|| -> Result<(), Error> {
            let tx = self.db.transaction()?;
            for id in ids {
                tx.execute("DELETE FROM evidence WHERE id=?1", [id.to_string()])?;
            }
            for (frame_id, proof) in &ownership {
                tx.execute(
                    "INSERT OR REPLACE INTO pending_files VALUES (?1,?2)",
                    params![frame_id.to_string(), proof],
                )?;
            }
            tx.execute("UPDATE control SET generation=?1, capture_paused=CASE WHEN ?2 THEN 1 ELSE capture_paused END WHERE id=1", params![next as i64, pause])?;
            tx.commit()?;
            Ok(())
        })();
        if let Err(error) = result {
            self.poisoned = true;
            return Err(error);
        }
        self.generation = next;
        self.capture_paused |= pause;
        if invalidate || !ids.is_empty() {
            self.revision = self.revision.checked_add(1).ok_or(Error::Storage)?;
        }
        for id in ids {
            self.index.remove(id);
        }
        let pending_files = self.cleanup_orphans()?;
        Ok(Removal {
            removed: ids.to_vec(),
            pending_files,
        })
    }

    pub fn maintenance(&mut self, now_ms: i64) -> Result<Removal, Error> {
        self.check_clock(now_ms)?;
        let ids: Vec<_> = self
            .index
            .iter()
            .filter(|(_, r)| r.expires_at_ms <= self.high_water_ms)
            .map(|(id, _)| *id)
            .collect();
        if !ids.is_empty() {
            self.remove_ids(&ids, false)
        } else {
            Ok(Removal {
                removed: Vec::new(),
                pending_files: self.cleanup_orphans()?,
            })
        }
    }

    fn cleanup_orphans(&self) -> Result<usize, Error> {
        let referenced = self.referenced_frames();
        let mut pending = 0;
        let mut owned = BTreeMap::new();
        {
            let mut query = self
                .db
                .prepare("SELECT id,ownership FROM pending_files LIMIT 10129")?;
            let rows = query.query_map([], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, Vec<u8>>(1)?))
            })?;
            for row in rows {
                let (id, proof) = row?;
                let id = Uuid::parse_str(&id).map_err(|_| Error::Authentication)?;
                if owned.len() > MAX_RECORDS + 128
                    || proof.len() > 128
                    || referenced.contains(&id)
                    || self
                        .crypto
                        .open(&self.aad("pending", id), &proof)?
                        .as_slice()
                        != b"owned-file-v1"
                {
                    return Err(Error::Authentication);
                }
                owned.insert(id, ());
            }
        }
        for (count, entry) in fs::read_dir(&self.directory)?.enumerate() {
            if count > MAX_RECORDS + 128 {
                return Err(Error::Storage);
            }
            let entry = entry?;
            let name = entry.file_name();
            let name = name.to_string_lossy();
            let Some(id) = name
                .strip_prefix("frame-")
                .and_then(|s| s.strip_suffix(".bin"))
                .and_then(|s| Uuid::parse_str(s).ok())
            else {
                continue;
            };
            if referenced.contains(&id) {
                continue;
            }
            if regular(&entry.path())? {
                let size = fs::metadata(entry.path())?.len();
                if size > crate::MAX_FRAME_BYTES as u64 + 64 {
                    pending += 1;
                    continue;
                }
                if !owned.contains_key(&id) {
                    let sealed = fs::read(entry.path())?;
                    if self.crypto.open(&self.aad("frame", id), &sealed).is_err() {
                        // A matching filename is not ownership. Preserve unknown
                        // data instead of deleting it during crash recovery.
                        pending += 1;
                        continue;
                    }
                }
                if fs::remove_file(entry.path()).is_err() {
                    pending += 1;
                } else {
                    owned.remove(&id);
                    self.db
                        .execute("DELETE FROM pending_files WHERE id=?1", [id.to_string()])?;
                }
            }
        }
        for id in owned.keys() {
            if !regular(&self.frame_path(*id))? {
                self.db
                    .execute("DELETE FROM pending_files WHERE id=?1", [id.to_string()])?;
            }
        }
        Ok(pending)
    }

    pub fn disk_bytes(&self) -> Result<u64, Error> {
        root_bytes(&self.root)
    }
}

fn validate_metadata(value: &EvidenceMetadata) -> Result<(), Error> {
    value
        .surface
        .validate(value.frame_width, value.frame_height, &value.text)?;
    if value.id.is_nil()
        || (value.activity_binding.is_some() && value.tracker_record_id.is_some())
        || value
            .tracker_record_id
            .as_ref()
            .is_some_and(|s| s.is_empty() || s.len() > 128)
        || value.observed_at_ms < 0
        || value.expires_at_ms <= value.observed_at_ms
        || value.expires_at_ms - value.observed_at_ms > MAX_RETENTION.as_millis() as i64
        || value.frame_width == 0
        || value.frame_height == 0
        || value.frame_width > crate::MAX_FRAME_EDGE
        || value.frame_height > crate::MAX_FRAME_EDGE
        || value.frame_sha256.len() != 64
        || !value.frame_sha256.bytes().all(|c| c.is_ascii_hexdigit())
    {
        return Err(Error::Invalid("evidence metadata"));
    }
    Ok(())
}

#[cfg(test)]
mod fault_tests {
    use super::*;

    #[test]
    fn encrypted_legacy_ocr_and_new_accessibility_headers_reopen_without_relabeling() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("screen-context");
        let mut store = crate::tests::open(&root, 1_000);
        let old_id = store
            .append(
                store.generation(),
                crate::tests::evidence(1_000),
                true,
                1_000,
            )
            .unwrap();
        let mut legacy =
            serde_json::to_value(store.read_metadata(old_id, 1_000).unwrap().unwrap()).unwrap();
        legacy.as_object_mut().unwrap().remove("textEvidence");
        legacy["text"] = serde_json::json!("legacy owned OCR");
        legacy["ocrState"] = serde_json::json!("recognized");
        let clear = Zeroizing::new(serde_json::to_vec(&legacy).unwrap());
        let sealed = store
            .crypto
            .seal(&store.aad("metadata", old_id), &clear)
            .unwrap();
        store
            .db
            .execute(
                "UPDATE evidence SET header=?1 WHERE id=?2",
                params![sealed, old_id.to_string()],
            )
            .unwrap();
        drop(store);
        let mut store = crate::tests::open(&root, 1_001);
        let old = store.read_metadata(old_id, 1_001).unwrap().unwrap();
        assert_eq!(old.text.source(), TextSource::Ocr);
        assert_eq!(old.text.as_str(), "legacy owned OCR");
        let mut new = crate::tests::evidence(1_001);
        new.text = TextEvidence::new(
            TextSource::Accessibility,
            TextState::Recognized,
            Zeroizing::new("new owned visible text".into()),
        )
        .unwrap();
        let new_id = store.append(store.generation(), new, false, 1_001).unwrap();
        let mut mixed =
            serde_json::to_value(store.read_metadata(new_id, 1_001).unwrap().unwrap()).unwrap();
        mixed["text"] = serde_json::json!("fake legacy text");
        mixed["ocrState"] = serde_json::json!("recognized");
        assert!(serde_json::from_value::<EvidenceMetadata>(mixed).is_err());
        drop(store);
        let mut store = crate::tests::open(&root, 1_002);
        assert_eq!(
            store
                .read_metadata(old_id, 1_002)
                .unwrap()
                .unwrap()
                .text
                .source(),
            TextSource::Ocr
        );
        assert_eq!(
            store
                .read_metadata(new_id, 1_002)
                .unwrap()
                .unwrap()
                .text
                .source(),
            TextSource::Accessibility
        );
        assert!(store.read_frame(old_id, 1_002).unwrap().is_some());
        assert!(store.read_frame(new_id, 1_002).unwrap().is_none());
    }

    #[test]
    fn real_sqlite_full_rolls_back_new_metadata_and_recovers_owned_partial_frame() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("screen-context");
        let mut store = crate::tests::open(&root, 1_000);
        let keep = store
            .append(
                store.generation(),
                crate::tests::evidence(1_000),
                true,
                1_000,
            )
            .unwrap();
        let count: u32 = store
            .db
            .query_row("PRAGMA page_count", [], |row| row.get(0))
            .unwrap();
        store
            .db
            .execute_batch(&format!("PRAGMA max_page_count={count}"))
            .unwrap();
        let mut incoming = crate::tests::evidence(1_001);
        incoming.text = TextEvidence::legacy_ocr(
            crate::OcrState::Recognized,
            Zeroizing::new("\u{d55c}".repeat(1600)),
        )
        .unwrap();
        assert!(matches!(
            store.append(store.generation(), incoming, true, 1_001),
            Err(Error::StorageFull)
        ));
        assert!(store.poisoned);
        drop(store);
        let mut reopened = crate::tests::open(&root, 1_002);
        assert_eq!(
            reopened
                .list_page(None, 100, 1_002)
                .unwrap()
                .records
                .iter()
                .map(|r| r.id)
                .collect::<Vec<_>>(),
            vec![keep]
        );
        assert!(reopened.read_frame(keep, 1_002).unwrap().is_some());
        assert_eq!(
            reopened
                .db
                .query_row("SELECT COUNT(*) FROM pending_files", [], |row| row
                    .get::<_, u32>(0))
                .unwrap(),
            0
        );
        let frames = fs::read_dir(&reopened.directory)
            .unwrap()
            .filter(|item| {
                item.as_ref()
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .starts_with("frame-")
            })
            .count();
        assert_eq!(frames, 1);
    }
}
