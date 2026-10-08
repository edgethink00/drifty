//! Windows relaunch handoff between a retiring Drifty process and its replacement.
//!
//! WebView2 shares one browser process per user data folder. Closing the
//! controllers at a committed exit starts that browser's orderly shutdown, which
//! outlives the host process: its renderers, GPU and crashpad helpers retire on
//! their own schedule. A replacement Drifty that opens the same user data folder
//! while that shutdown is still running attaches to a browser that is already
//! going away, and its WebView creation can wait indefinitely for completions
//! that never arrive (observed as a main window that stays hidden after an
//! update restart or an immediate same-profile reopen).
//!
//! The retiring process therefore records its own PID and the browser PIDs it
//! owned. The next launch waits, bounded, for those exact processes to exit
//! before creating any WebView. PID reuse is excluded by image name and by the
//! process creation time, so an unrelated process can never delay startup.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
#[cfg(target_os = "windows")]
use std::time::Duration;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

pub(crate) const HANDOFF_FILE_NAME: &str = "windows-previous-instance.json";

/// Total bound for waiting on the previous instance. Browser shutdown normally
/// finishes within a few seconds; a stuck browser must not block the app.
#[cfg(target_os = "windows")]
pub(crate) const MAX_WAIT: Duration = Duration::from_secs(60);

/// A process created more than this long after the handoff was written is a
/// reused PID, never the recorded instance.
const CREATION_TOLERANCE_MS: u64 = 2_000;

const WAITED_IMAGE_NAMES: [&str; 2] = ["drifty.exe", "msedgewebview2.exe"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct PreviousInstance {
    pub(crate) host_pid: u32,
    pub(crate) browser_pids: Vec<u32>,
    pub(crate) written_at_unix_ms: u64,
}

pub(crate) fn handoff_path(app_local_data_dir: &Path) -> PathBuf {
    app_local_data_dir.join(HANDOFF_FILE_NAME)
}

fn now_unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

/// Record the retiring process and the browser processes it owned. Written
/// atomically so a crash during exit never leaves a partial file.
pub(crate) fn record(
    app_local_data_dir: &Path,
    host_pid: u32,
    browser_pids: Vec<u32>,
) -> io::Result<()> {
    let mut browser_pids = browser_pids;
    browser_pids.sort_unstable();
    browser_pids.dedup();
    let instance = PreviousInstance {
        host_pid,
        browser_pids,
        written_at_unix_ms: now_unix_ms(),
    };
    fs::create_dir_all(app_local_data_dir)?;
    let path = handoff_path(app_local_data_dir);
    let temp_path = app_local_data_dir.join(format!(".{HANDOFF_FILE_NAME}.{host_pid}.tmp"));
    let body = serde_json::to_vec(&instance).map_err(io::Error::other)?;
    fs::write(&temp_path, body)?;
    if let Err(error) = fs::rename(&temp_path, &path) {
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }
    Ok(())
}

/// Read and remove the handoff. A missing or unreadable file means there is
/// nothing to wait for; it is removed either way so one launch consumes it.
pub(crate) fn take(app_local_data_dir: &Path) -> Option<PreviousInstance> {
    let path = handoff_path(app_local_data_dir);
    let body = fs::read(&path).ok();
    let _ = fs::remove_file(&path);
    serde_json::from_slice(&body?).ok()
}

/// Whether a live process with this image and creation time is the recorded
/// instance rather than a reused PID.
pub(crate) fn is_recorded_instance(
    image_path: &str,
    created_at_unix_ms: Option<u64>,
    written_at_unix_ms: u64,
) -> bool {
    let image_name = image_path
        .rsplit(['\\', '/'])
        .next()
        .unwrap_or(image_path)
        .to_ascii_lowercase();
    if !WAITED_IMAGE_NAMES.contains(&image_name.as_str()) {
        return false;
    }
    match created_at_unix_ms {
        // The recorded process existed before the handoff was written.
        Some(created) => created <= written_at_unix_ms.saturating_add(CREATION_TOLERANCE_MS),
        // Creation time unavailable: the image name alone is the best evidence.
        None => true,
    }
}

#[cfg(target_os = "windows")]
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub(crate) struct WaitOutcome {
    pub(crate) waited_pids: Vec<u32>,
    pub(crate) skipped_pids: Vec<u32>,
    pub(crate) timed_out_pids: Vec<u32>,
    pub(crate) elapsed_ms: u128,
}

#[cfg(target_os = "windows")]
pub(crate) fn wait_for_previous_instance(app_local_data_dir: &Path) -> Option<WaitOutcome> {
    let instance = take(app_local_data_dir)?;
    let mut pids = Vec::with_capacity(instance.browser_pids.len() + 1);
    pids.push(instance.host_pid);
    pids.extend(instance.browser_pids.iter().copied());
    pids.retain(|pid| *pid != std::process::id());
    Some(windows::wait_for_pids(
        &pids,
        instance.written_at_unix_ms,
        MAX_WAIT,
    ))
}

#[cfg(target_os = "windows")]
mod windows {
    use super::{is_recorded_instance, WaitOutcome};
    use std::time::{Duration, Instant};
    use windows_sys::Win32::Foundation::{CloseHandle, FILETIME, HANDLE, WAIT_OBJECT_0};
    use windows_sys::Win32::System::Threading::{
        GetProcessTimes, OpenProcess, QueryFullProcessImageNameW, WaitForSingleObject,
        PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE,
    };

    struct Process {
        handle: HANDLE,
    }

    impl Process {
        fn open(pid: u32) -> Option<Self> {
            let handle = unsafe {
                OpenProcess(
                    PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
                    0,
                    pid,
                )
            };
            (!handle.is_null()).then_some(Self { handle })
        }

        fn image_path(&self) -> Option<String> {
            let mut buffer = vec![0_u16; 32_768];
            let mut length = buffer.len() as u32;
            let read = unsafe {
                QueryFullProcessImageNameW(self.handle, 0, buffer.as_mut_ptr(), &mut length)
            };
            if read == 0 {
                return None;
            }
            buffer.truncate(length as usize);
            Some(String::from_utf16_lossy(&buffer))
        }

        fn created_at_unix_ms(&self) -> Option<u64> {
            let empty = FILETIME {
                dwLowDateTime: 0,
                dwHighDateTime: 0,
            };
            let (mut created, mut exited, mut kernel, mut user) = (empty, empty, empty, empty);
            let read = unsafe {
                GetProcessTimes(
                    self.handle,
                    &mut created,
                    &mut exited,
                    &mut kernel,
                    &mut user,
                )
            };
            if read == 0 {
                return None;
            }
            // FILETIME counts 100 ns intervals since 1601-01-01.
            let intervals =
                (u64::from(created.dwHighDateTime) << 32) | u64::from(created.dwLowDateTime);
            const UNIX_EPOCH_INTERVALS: u64 = 116_444_736_000_000_000;
            Some(intervals.saturating_sub(UNIX_EPOCH_INTERVALS) / 10_000)
        }

        fn has_exited(&self) -> bool {
            unsafe { WaitForSingleObject(self.handle, 0) == WAIT_OBJECT_0 }
        }

        fn wait(&self, timeout: Duration) -> bool {
            let millis = timeout.as_millis().min(u128::from(u32::MAX - 1)) as u32;
            unsafe { WaitForSingleObject(self.handle, millis) == WAIT_OBJECT_0 }
        }
    }

    impl Drop for Process {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.handle);
            }
        }
    }

    pub(super) fn wait_for_pids(
        pids: &[u32],
        written_at_unix_ms: u64,
        max_wait: Duration,
    ) -> WaitOutcome {
        let started = Instant::now();
        let mut outcome = WaitOutcome::default();
        for pid in pids {
            let Some(process) = Process::open(*pid) else {
                // Already gone, or not ours to inspect; either way nothing to wait on.
                outcome.skipped_pids.push(*pid);
                continue;
            };
            if process.has_exited() {
                outcome.skipped_pids.push(*pid);
                continue;
            }
            let image_path = process.image_path().unwrap_or_default();
            if !is_recorded_instance(
                &image_path,
                process.created_at_unix_ms(),
                written_at_unix_ms,
            ) {
                outcome.skipped_pids.push(*pid);
                continue;
            }
            let remaining = max_wait.saturating_sub(started.elapsed());
            if remaining.is_zero() || !process.wait(remaining) {
                outcome.timed_out_pids.push(*pid);
            } else {
                outcome.waited_pids.push(*pid);
            }
        }
        outcome.elapsed_ms = started.elapsed().as_millis();
        outcome
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn record_then_take_round_trips_and_consumes_the_file() {
        let dir = tempfile::tempdir().unwrap();
        record(dir.path(), 4_321, vec![900, 800, 900]).unwrap();
        let taken = take(dir.path()).expect("handoff recorded");
        assert_eq!(taken.host_pid, 4_321);
        assert_eq!(taken.browser_pids, vec![800, 900]);
        assert!(taken.written_at_unix_ms > 0);
        assert!(!handoff_path(dir.path()).exists());
        assert!(take(dir.path()).is_none());
    }

    #[test]
    fn unreadable_handoff_is_discarded() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(handoff_path(dir.path()), b"{not json").unwrap();
        assert!(take(dir.path()).is_none());
        assert!(!handoff_path(dir.path()).exists());
    }

    #[test]
    fn only_the_recorded_drifty_or_browser_image_is_waited_on() {
        let written = 1_700_000_000_000;
        assert!(is_recorded_instance(
            r"C:\Program Files\Drifty\drifty.exe",
            Some(written - 10_000),
            written
        ));
        assert!(is_recorded_instance(
            r"C:\Program Files (x86)\Microsoft\EdgeWebView\Application\1.0\msedgewebview2.exe",
            Some(written - 10_000),
            written
        ));
        assert!(is_recorded_instance(
            "C:/Apps/Drifty/DRIFTY.EXE",
            None,
            written
        ));
        assert!(!is_recorded_instance(
            r"C:\Windows\System32\svchost.exe",
            Some(written - 10_000),
            written
        ));
        assert!(!is_recorded_instance(
            r"C:\Program Files\Microsoft\Teams\msedgewebview2.exe",
            Some(written + 5_000),
            written
        ));
    }
}
