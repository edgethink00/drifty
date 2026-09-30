use std::process::Command;

pub(super) fn process_memory_usage_bytes(pid: u32) -> Option<u64> {
    // Activity Monitor's Memory column is the physical-footprint ledger, not
    // resident size. Resident size counts reclaimable model-file cache and
    // drops compressed pages. macOS therefore never substitutes it when the
    // ledger cannot be read. Other platforms keep their working-set reading.
    #[cfg(target_os = "macos")]
    {
        return macos_physical_footprint_bytes(pid).or_else(|| process_footprint_bytes(pid));
    }
    #[cfg(not(target_os = "macos"))]
    {
        process_resident_memory_bytes(pid)
    }
}

#[cfg(target_os = "macos")]
fn macos_physical_footprint_bytes(pid: u32) -> Option<u64> {
    // RUSAGE_INFO_V0 already carries ri_phys_footprint. libSystem resolves
    // proc_pid_rusage, so a status poll does not spawn the footprint tool.
    #[repr(C)]
    struct RusageInfoV0 {
        _uuid: [u8; 16],
        _user_time: u64,
        _system_time: u64,
        _pkg_idle_wkups: u64,
        _interrupt_wkups: u64,
        _pageins: u64,
        _wired_size: u64,
        _resident_size: u64,
        phys_footprint: u64,
        _proc_start_abstime: u64,
        _proc_exit_abstime: u64,
    }

    const _: () = assert!(std::mem::size_of::<RusageInfoV0>() == 96);
    const _: () = assert!(std::mem::align_of::<RusageInfoV0>() == 8);

    extern "C" {
        fn proc_pid_rusage(pid: i32, flavor: i32, buffer: *mut RusageInfoV0) -> i32;
    }

    let pid = i32::try_from(pid).ok()?;
    let mut info = std::mem::MaybeUninit::<RusageInfoV0>::zeroed();
    // proc_pid_rusage writes a fully initialized rusage_info_v0 into info.
    let status = unsafe { proc_pid_rusage(pid, 0, info.as_mut_ptr()) };
    if status != 0 {
        return None;
    }
    let footprint = unsafe { info.assume_init() }.phys_footprint;
    (footprint > 0).then_some(footprint)
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn process_footprint_bytes(pid: u32) -> Option<u64> {
    let output = Command::new("footprint")
        .arg("-p")
        .arg(pid.to_string())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    parse_footprint_bytes(&String::from_utf8_lossy(&output.stdout))
}

fn parse_footprint_bytes(text: &str) -> Option<u64> {
    parse_labeled_byte_count(text, "phys_footprint:")
        .or_else(|| parse_labeled_byte_count(text, "Footprint:"))
}

fn parse_labeled_byte_count(text: &str, label: &str) -> Option<u64> {
    text.lines().find_map(|line| {
        line.split_once(label)
            .and_then(|(_, value)| parse_byte_count(value))
    })
}

fn parse_byte_count(value: &str) -> Option<u64> {
    let mut parts = value.split_whitespace();
    let amount = parts.next()?.trim_end_matches(',');
    let unit = parts.next().unwrap_or("B");
    let multiplier = byte_unit_multiplier(unit)?;
    parse_decimal_scaled(amount, multiplier)
}

fn parse_decimal_scaled(amount: &str, multiplier: u64) -> Option<u64> {
    let (whole, fraction) = amount.split_once('.').unwrap_or((amount, ""));
    if whole.is_empty() && fraction.is_empty() {
        return None;
    }
    if !whole.is_empty() && !whole.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    if !fraction.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }

    let whole_value = if whole.is_empty() {
        0
    } else {
        whole.parse::<u64>().ok()?
    };
    let whole_bytes = whole_value.checked_mul(multiplier)?;
    if fraction.is_empty() {
        return Some(whole_bytes);
    }

    let scale = 10_u64.checked_pow(u32::try_from(fraction.len()).ok()?)?;
    let fraction_value = fraction.parse::<u64>().ok()?;
    let rounded_fraction_bytes = fraction_value
        .checked_mul(multiplier)?
        .checked_add(scale / 2)?
        .checked_div(scale)?;
    whole_bytes.checked_add(rounded_fraction_bytes)
}

fn byte_unit_multiplier(unit: &str) -> Option<u64> {
    match unit.trim_matches(|char: char| !char.is_ascii_alphabetic()) {
        "B" | "bytes" => Some(1),
        "K" | "KB" | "KiB" => Some(1024),
        "M" | "MB" | "MiB" => Some(1024 * 1024),
        "G" | "GB" | "GiB" => Some(1024 * 1024 * 1024),
        _ => None,
    }
}

fn process_resident_memory_bytes(pid: u32) -> Option<u64> {
    #[cfg(windows)]
    {
        return windows_resident_memory_bytes(pid);
    }
    #[cfg(not(windows))]
    {
        let output = Command::new("ps")
            .arg("-p")
            .arg(pid.to_string())
            .arg("-o")
            .arg("rss=")
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let text = String::from_utf8_lossy(&output.stdout);
        let resident_kib = parse_resident_kib(&text)?;
        resident_kib.checked_mul(1024)
    }
}

#[cfg(windows)]
fn windows_resident_memory_bytes(pid: u32) -> Option<u64> {
    use sysinfo::{MemoryRefreshKind, Pid, ProcessRefreshKind, ProcessesToUpdate, System};

    let system_pid = Pid::from_u32(pid);
    let mut system = System::new();
    system.refresh_memory_specifics(MemoryRefreshKind::nothing().with_ram());
    system.refresh_processes_specifics(
        ProcessesToUpdate::Some(&[system_pid]),
        true,
        ProcessRefreshKind::nothing().with_memory(),
    );
    system.process(system_pid).map(|process| process.memory())
}

fn parse_resident_kib(text: &str) -> Option<u64> {
    text.split_whitespace().next()?.parse::<u64>().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_footprint_bytes_prefers_physical_footprint_auxiliary_value() {
        let output = "\
======================================================================
llama-server [7838]: 64-bit    Footprint: 18 MB (16384 bytes per page)
======================================================================
Auxiliary data:
    phys_footprint: 8858 MB
";

        assert_eq!(parse_footprint_bytes(output), Some(8_858 * 1024 * 1024));
    }

    #[test]
    fn parse_footprint_bytes_uses_header_when_auxiliary_value_is_missing() {
        let output = "llama-server [7838]: 64-bit    Footprint: 512 MB (16384 bytes per page)";

        assert_eq!(parse_footprint_bytes(output), Some(512 * 1024 * 1024));
    }

    #[test]
    fn parse_byte_count_supports_common_binary_units() {
        assert_eq!(parse_byte_count("42 KB"), Some(42 * 1024));
        assert_eq!(parse_byte_count("7 GB"), Some(7 * 1024 * 1024 * 1024));
    }

    #[test]
    fn parse_byte_count_supports_fractional_units() {
        assert_eq!(parse_byte_count("8.5 MB"), Some(8_912_896));
    }

    #[test]
    fn parse_resident_kib_reads_ps_rss_output() {
        assert_eq!(parse_resident_kib("17792\n"), Some(17_792));
    }

    #[test]
    fn missing_process_has_no_memory_reading() {
        assert_eq!(process_memory_usage_bytes(2_000_000_001), None);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn process_memory_matches_activity_monitor_ledger() {
        let pid = std::process::id();
        let charged = process_memory_usage_bytes(pid).expect("charged memory");
        let ledger = process_footprint_bytes(pid).expect("footprint ledger");
        let resident = process_resident_memory_bytes(pid).expect("resident memory");
        let ledger_delta = charged.abs_diff(ledger);
        assert!(
            ledger_delta < 4 * 1024 * 1024,
            "charged {charged} should track phys_footprint {ledger}, not resident {resident}"
        );
        if resident.abs_diff(ledger) > 8 * 1024 * 1024 {
            assert!(
                charged.abs_diff(ledger) < charged.abs_diff(resident),
                "charged {charged} followed resident {resident} instead of ledger {ledger}"
            );
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn process_memory_tracks_requested_process_ledger() {
        let Ok(raw_pid) = std::env::var("DRIFTY_MEMORY_QA_PID") else {
            return;
        };
        let pid = raw_pid.parse::<u32>().expect("DRIFTY_MEMORY_QA_PID");
        let charged = process_memory_usage_bytes(pid).expect("charged memory");
        let ledger = process_footprint_bytes(pid).expect("footprint ledger");
        let resident = process_resident_memory_bytes(pid).expect("resident memory");
        eprintln!("pid {pid} charged {charged} ledger {ledger} resident {resident}");
        assert!(
            charged.abs_diff(ledger) < 32 * 1024 * 1024,
            "charged {charged} ledger {ledger} resident {resident}"
        );
        if resident.abs_diff(ledger) > 64 * 1024 * 1024 {
            assert!(
                charged.abs_diff(ledger) * 4 < charged.abs_diff(resident),
                "charged {charged} stayed near resident {resident} instead of ledger {ledger}"
            );
        }
    }
}
