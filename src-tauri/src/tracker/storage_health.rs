use super::{
    degraded_tracker_status, tracker_status_error_message, TrackerError, TrackerStatus,
    TrackerStatusIssue,
};
use std::{
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
};

const DATABASE_UNAVAILABLE_CODE: &str = "tracker_database_unavailable";

fn is_database_unavailable(error: &TrackerError) -> bool {
    matches!(error, TrackerError::TrackerReturnedError(message) if matches!(
        message.as_str(),
        "Tracker database is unavailable while tracker activity is running or unconfirmed."
            | "Tracker database is unavailable at its expected location."
    ))
}

pub(crate) fn activity_read_error(error: TrackerError) -> String {
    if is_database_unavailable(&error) {
        DATABASE_UNAVAILABLE_CODE.into()
    } else {
        error.to_string()
    }
}

pub(crate) fn failed_storage_status(
    error: &TrackerError,
    tracking_paused: bool,
    available_bytes: impl FnOnce() -> Option<u64>,
) -> Option<TrackerStatus> {
    if tracking_paused {
        return None;
    }
    let database_unavailable = is_database_unavailable(error);
    if !database_unavailable
        && !matches!(error, TrackerError::TrackerReturnedError(message) if matches!(
            message.as_str(), "disk I/O error" | "database or disk is full" | "unable to open database file"
        ))
    {
        return None;
    }
    let available = available_bytes();
    let mut status = degraded_tracker_status(tracker_status_error_message());
    if available == Some(0) {
        status.storage_free_bytes = available;
    } else if database_unavailable {
        // A live worker may still be recording to the original file. The
        // database failure supplies no observation of whether it has stopped.
        status.tracker_mode = Some("unavailable".into());
        status.status_issue = Some(TrackerStatusIssue::DatabaseUnavailable);
    } else {
        return None;
    }
    Some(status)
}

// A dangling link or inaccessible path gives no evidence about the DB's volume.
#[cfg(any(unix, windows))]
fn database_volume_directory(database: &Path) -> Option<PathBuf> {
    match fs::symlink_metadata(database) {
        Ok(_) => Some(fs::canonicalize(database).ok()?.parent()?.to_path_buf()),
        Err(error) if error.kind() == ErrorKind::NotFound => {
            fs::canonicalize(database.parent()?).ok()
        }
        Err(_) => None,
    }
}

#[cfg(unix)]
pub(crate) fn available_bytes_on_database_volume(database: &Path) -> Option<u64> {
    use std::{ffi::CString, mem::MaybeUninit, os::unix::ffi::OsStrExt};
    let directory = database_volume_directory(database)?;
    let path = CString::new(directory.as_os_str().as_bytes()).ok()?;
    let mut stat = MaybeUninit::<libc::statvfs>::uninit();
    // SAFETY: path is terminated and statvfs initializes stat on success.
    if unsafe { libc::statvfs(path.as_ptr(), stat.as_mut_ptr()) } != 0 {
        return None;
    }
    let stat = unsafe { stat.assume_init() };
    if stat.f_frsize == 0 {
        return None;
    }
    (stat.f_bavail as u64).checked_mul(stat.f_frsize as u64)
}

#[cfg(windows)]
pub(crate) fn available_bytes_on_database_volume(database: &Path) -> Option<u64> {
    use std::{os::windows::ffi::OsStrExt, ptr};
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;

    let directory = database_volume_directory(database)?;
    let mut name: Vec<u16> = directory.as_os_str().encode_wide().collect();
    if name.last() != Some(&(b'\\' as u16)) {
        name.push(b'\\' as u16);
    }
    name.push(0);
    let mut available = 0;
    // The path is NUL-terminated, and the output points to a writable u64.
    let ok = unsafe {
        GetDiskFreeSpaceExW(
            name.as_ptr(),
            &mut available,
            ptr::null_mut(),
            ptr::null_mut(),
        )
    };
    (ok != 0).then_some(available)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sqlite_status_error_requires_observed_zero_bytes_to_report_full_volume() {
        let error = TrackerError::TrackerReturnedError("disk I/O error".into());
        let status = failed_storage_status(&error, false, || Some(0)).unwrap();
        assert_eq!(status.storage_free_bytes, Some(0));
        assert_eq!(status.tracker_mode.as_deref(), Some("degraded"));
        assert!(!status.running);
        assert!(status.database_path.is_none());
        assert_eq!(
            status.message.as_deref(),
            Some(tracker_status_error_message().as_str())
        );
        for bytes in [None, Some(1), Some(100_000_000)] {
            assert!(failed_storage_status(&error, false, || bytes).is_none());
        }
    }

    #[test]
    fn pause_and_non_storage_errors_do_not_probe_the_volume() {
        let storage_error = TrackerError::TrackerReturnedError("disk I/O error".into());
        assert!(failed_storage_status(&storage_error, true, || panic!("paused")).is_none());
        for error in [
            TrackerError::TrackerReturnedError("attempt to write a readonly database".into()),
            TrackerError::TrackerReturnedError("database is locked".into()),
            TrackerError::MissingData,
        ] {
            assert!(failed_storage_status(&error, false, || panic!("unrelated")).is_none());
        }
    }

    #[test]
    fn guarded_database_read_distinguishes_uncertainty_from_confirmed_full() {
        for message in [
            "Tracker database is unavailable while tracker activity is running or unconfirmed.",
            "Tracker database is unavailable at its expected location.",
        ] {
            let error = TrackerError::TrackerReturnedError(message.into());
            let status = failed_storage_status(&error, false, || Some(0)).unwrap();
            assert_eq!(status.storage_free_bytes, Some(0));
            assert!(!status.running);
            assert_eq!(status.tracker_mode.as_deref(), Some("degraded"));
            assert_eq!(status.status_issue, None);
            for bytes in [None, Some(1), Some(100_000_000)] {
                let status = failed_storage_status(&error, false, || bytes).unwrap();
                assert_eq!(status.storage_free_bytes, None);
                assert_eq!(status.tracker_mode.as_deref(), Some("unavailable"));
                assert_eq!(
                    serde_json::to_value(status).unwrap()["statusIssue"],
                    "databaseUnavailable",
                );
            }
            assert_eq!(
                activity_read_error(TrackerError::TrackerReturnedError(message.into())),
                DATABASE_UNAVAILABLE_CODE
            );
            assert!(failed_storage_status(&error, true, || panic!("paused")).is_none());
        }
    }
}
