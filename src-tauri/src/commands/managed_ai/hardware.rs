use std::process::Command;
use std::sync::OnceLock;

pub(super) fn machine_memory_bytes() -> Option<u64> {
    static MEMSIZE: OnceLock<Option<u64>> = OnceLock::new();
    *MEMSIZE.get_or_init(read_machine_memory_bytes)
}

fn read_machine_memory_bytes() -> Option<u64> {
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
    fn machine_memory_bytes_reports_positive_memory_on_macos() {
        let memory = machine_memory_bytes().expect("hw.memsize is readable on macOS");
        assert!(memory >= 4 * 1024 * 1024 * 1024);
    }
}
