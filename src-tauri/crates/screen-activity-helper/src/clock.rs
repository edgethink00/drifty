//! Exact integer clock rules for the pinned macOS tracker.
use chrono::NaiveDate;

fn decimal(s: &str) -> Option<u32> {
    (!s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()))
        .then(|| s.parse().ok())
        .flatten()
}
fn clock_parts(s: &str) -> Option<[u32; 4]> {
    // Pinned Python 3.9 HH[:MM[:SS[.fff[fff]]]] grammar.
    let (clock, fraction) = match s.split_once('.') {
        Some((a, b)) => (a, Some(b)),
        None => (s, None),
    };
    let parts = clock.split(':').collect::<Vec<_>>();
    if !(1..=3).contains(&parts.len()) || parts.iter().any(|p| p.len() != 2) {
        return None;
    }
    let mut result = [0; 4];
    for (i, part) in parts.iter().enumerate() {
        result[i] = decimal(part)?;
    }
    if let Some(frac) = fraction {
        if parts.len() != 3 || ![3, 6].contains(&frac.len()) {
            return None;
        }
        result[3] = decimal(frac)? * if frac.len() == 3 { 1000 } else { 1 };
    }
    Some(result)
}
pub(crate) fn timestamp_micros(value: &str) -> Option<i64> {
    if value.chars().count() > 64 {
        return None;
    }
    let mut text = value
        .strip_suffix('Z')
        .map_or_else(|| value.to_owned(), |s| format!("{s}+00:00"));
    let date = text.get(..10)?;
    if date.get(4..5)? != "-" || date.get(7..8)? != "-" {
        return None;
    }
    let year = decimal(date.get(..4)?)?;
    if !(1..=9999).contains(&year) {
        return None;
    }
    let day = NaiveDate::from_ymd_opt(
        year as i32,
        decimal(date.get(5..7)?)?,
        decimal(date.get(8..10)?)?,
    )?;
    let separator = text.get(10..)?.chars().next()?;
    let start = 10 + separator.len_utf8();
    // Match the tracker normalizer: only T/space HH:MM:SS fractions are
    // truncated/padded, and only when immediately followed by an offset/end.
    if matches!(separator, 'T' | ' ') && text.get(start + 8..start + 9) == Some(".") {
        let from = start + 9;
        let count = text
            .get(from..)?
            .bytes()
            .take_while(u8::is_ascii_digit)
            .count();
        let end = from + count;
        if count > 0
            && (end == text.len() || matches!(text.as_bytes().get(end), Some(b'+') | Some(b'-')))
        {
            let mut fraction = text.get(from..end)?.chars().take(6).collect::<String>();
            while fraction.len() < 6 {
                fraction.push('0');
            }
            text.replace_range(from..end, &fraction);
        }
    }
    let time = text.get(start..)?;
    let offset_at = time.bytes().position(|b| b == b'+' || b == b'-')?;
    let clock = clock_parts(time.get(..offset_at)?)?;
    let offset_text = time.get(offset_at + 1..)?;
    if ![5, 8, 15].contains(&offset_text.len()) {
        return None;
    }
    let offset = clock_parts(offset_text)?;
    let offset_us =
        ((i64::from(offset[0]) * 3600 + i64::from(offset[1]) * 60 + i64::from(offset[2]))
            * 1_000_000)
            + i64::from(offset[3]);
    if offset_us >= 86_400_000_000 {
        return None;
    }
    let local = day
        .and_hms_micro_opt(clock[0], clock[1], clock[2], clock[3])?
        .and_utc()
        .timestamp_micros();
    let result = if time.as_bytes()[offset_at] == b'-' {
        local.checked_add(offset_us)?
    } else {
        local.checked_sub(offset_us)?
    };
    (-62_135_596_800_000_000..=253_402_300_799_999_999)
        .contains(&result)
        .then_some(result)
}
pub(crate) fn ceil_ms(micros: i64) -> i64 {
    micros.div_euclid(1000) + i64::from(micros.rem_euclid(1000) != 0)
}
