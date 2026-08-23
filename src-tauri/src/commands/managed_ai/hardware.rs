use std::path::{Path, PathBuf};
#[cfg(not(windows))]
use std::process::Command;
use std::sync::OnceLock;

#[cfg(test)]
use std::sync::Mutex;

pub(super) fn machine_memory_bytes() -> Option<u64> {
    #[cfg(test)]
    if let Ok(guard) = TEST_MACHINE_MEMORY_BYTES.lock() {
        if let Some(bytes) = *guard {
            return Some(bytes);
        }
    }
    static MEMSIZE: OnceLock<Option<u64>> = OnceLock::new();
    *MEMSIZE.get_or_init(read_machine_memory_bytes)
}

#[cfg(test)]
static TEST_MACHINE_MEMORY_BYTES: Mutex<Option<u64>> = Mutex::new(None);

#[cfg(test)]
pub(super) fn set_machine_memory_bytes_for_tests(bytes: Option<u64>) {
    if let Ok(mut guard) = TEST_MACHINE_MEMORY_BYTES.lock() {
        *guard = bytes;
    }
}

pub(super) fn available_storage_bytes(path: &Path) -> Option<u64> {
    let target = nearest_existing_path(path)?;
    #[cfg(windows)]
    {
        return windows_available_storage_bytes(&target);
    }
    #[cfg(not(windows))]
    {
        let output = Command::new("df").arg("-Pk").arg(target).output().ok()?;
        if !output.status.success() {
            return None;
        }
        parse_available_storage_bytes(&String::from_utf8_lossy(&output.stdout))
    }
}

#[cfg(windows)]
fn windows_available_storage_bytes(path: &Path) -> Option<u64> {
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetDiskFreeSpaceExW(
            directory: *const u16,
            free_bytes_available: *mut u64,
            total_bytes: *mut u64,
            total_free_bytes: *mut u64,
        ) -> i32;
    }

    let mut wide: Vec<u16> = path.as_os_str().encode_wide().collect();
    wide.push(0);
    let mut available = 0_u64;
    let ok = unsafe {
        GetDiskFreeSpaceExW(
            wide.as_ptr(),
            &mut available,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    (ok != 0 && available > 0).then_some(available)
}

fn nearest_existing_path(path: &Path) -> Option<PathBuf> {
    let mut candidate = path.to_path_buf();
    loop {
        if candidate.exists() {
            return Some(candidate);
        }
        if !candidate.pop() {
            return None;
        }
    }
}

fn parse_available_storage_bytes(text: &str) -> Option<u64> {
    let available_kib = text
        .lines()
        .rev()
        .find(|line| !line.trim().is_empty())?
        .split_whitespace()
        .nth(3)?
        .parse::<u64>()
        .ok()?;
    available_kib.checked_mul(1024)
}

fn read_machine_memory_bytes() -> Option<u64> {
    #[cfg(windows)]
    {
        use sysinfo::{MemoryRefreshKind, System};
        let mut system = System::new();
        system.refresh_memory_specifics(MemoryRefreshKind::nothing().with_ram());
        let bytes = system.total_memory();
        return (bytes > 0).then_some(bytes);
    }
    #[cfg(not(windows))]
    {
        let output = Command::new("sysctl")
            .arg("-n")
            .arg("hw.memsize")
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        parse_memsize(&String::from_utf8_lossy(&output.stdout))
    }
}

fn parse_memsize(text: &str) -> Option<u64> {
    let bytes = text.trim().parse::<u64>().ok()?;
    (bytes > 0).then_some(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_memsize_reads_sysctl_output() {
        assert_eq!(parse_memsize("17179869184\n"), Some(17_179_869_184));
    }

    #[test]
    fn parse_memsize_rejects_non_numeric_and_zero_output() {
        assert_eq!(parse_memsize("hw.memsize: 17179869184\n"), None);
        assert_eq!(parse_memsize("0\n"), None);
        assert_eq!(parse_memsize(""), None);
    }

    #[test]
    fn parse_available_storage_reads_posix_df_output() {
        let output = "Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk3s1 994662584 223334400 760842184 23% /System/Volumes/Data\n";
        assert_eq!(
            parse_available_storage_bytes(output),
            Some(760_842_184 * 1024)
        );
    }

    #[test]
    fn available_storage_reports_positive_space_for_temp_directory() {
        let root = tempfile::tempdir().expect("create temp root");
        let available =
            available_storage_bytes(root.path()).expect("available storage is readable");
        assert!(available > 0);
    }

    #[test]
    fn machine_memory_bytes_reports_positive_memory() {
        let memory = machine_memory_bytes().expect("machine memory is readable");
        assert!(memory >= 4 * 1024 * 1024 * 1024);
    }
}
