use std::process::Command;

pub(super) fn process_memory_usage_bytes(pid: u32) -> Option<u64> {
    process_footprint_bytes(pid).or_else(|| process_resident_memory_bytes(pid))
}

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
}
