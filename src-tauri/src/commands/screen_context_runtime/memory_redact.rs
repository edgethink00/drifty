//! Credential redaction for memory text that can leave this computer.
//!
//! Automatic memory sends source text to the extraction provider, keeps it in
//! the encrypted memory state and attaches it to Chat replies. Terminal and AI
//! work apps can show credentials, so every one of those paths uses this single
//! projection. The local screen viewer keeps the original evidence. This is a
//! best-effort filter for common credential shapes, not a guarantee that no
//! sensitive value remains.
use regex::{Captures, Regex};
use std::sync::LazyLock;

pub(super) const REDACTED: &str = "[redacted]";
const MAX_MEMORY_TEXT_CHARS: usize = 1600;

static PRIVATE_KEY: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?s)-----BEGIN[A-Z0-9 ]*PRIVATE KEY-----.*?(?:-----END[A-Z0-9 ]*PRIVATE KEY-----|\z)",
    )
    .expect("private key pattern")
});
// Provider-issued token shapes. Each requires a distinctive prefix and enough
// length that ordinary words, commit ids and file names do not match.
static TOKENS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(concat!(
        r"\b(?:",
        r"sk-[A-Za-z0-9][A-Za-z0-9_\-]{15,}",
        r"|gh[pousr]_[A-Za-z0-9]{30,}",
        r"|github_pat_[A-Za-z0-9_]{20,}",
        r"|glpat-[A-Za-z0-9_\-]{20,}",
        r"|(?:AKIA|ASIA)[0-9A-Z]{16}",
        r"|xox[abprse]-[A-Za-z0-9\-]{10,}",
        r"|AIza[0-9A-Za-z_\-]{30,}",
        r"|[rs]k_(?:live|test)_[0-9A-Za-z]{16,}",
        r"|sbp_[0-9a-f]{20,}",
        r"|sb_secret_[A-Za-z0-9_\-]{16,}",
        r"|npm_[A-Za-z0-9]{30,}",
        r"|hf_[A-Za-z0-9]{30,}",
        r"|eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}",
        r")"
    ))
    .expect("token pattern")
});
static BEARER: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(bearer|basic)(\s+)[A-Za-z0-9._~+/\-]{16,}=*").expect("bearer pattern")
});
// Keep the label so a memory can still say a key was set, never its value.
static ASSIGNMENT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(concat!(
        r"(?i)\b((?:[A-Za-z0-9]+[_\-])*",
        r"(?:api[_\-]?key|secret|token|password|passwd|pwd|access[_\-]?key|private[_\-]?key|client[_\-]?secret|authorization)",
        r"(?:[_\-][A-Za-z0-9]+)*)\b",
        r#"(\s*[:=]\s*)("[^"
]{6,}"|'[^'
]{6,}'|[^\s"']{6,})"#
    ))
    .expect("assignment pattern")
});
static URL_PASSWORD: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b([a-z][a-z0-9+.\-]*://[^\s:/@]+):([^\s@/]+)@").expect("url pattern")
});

/// Deterministic, so search/source replies stay identical to the worker's copy.
pub(super) fn redact_secrets(text: &str) -> String {
    let text = PRIVATE_KEY.replace_all(text, REDACTED);
    let text = TOKENS.replace_all(&text, REDACTED);
    let text = BEARER.replace_all(&text, |c: &Captures| {
        format!("{}{}{REDACTED}", &c[1], &c[2])
    });
    let text = ASSIGNMENT.replace_all(&text, |c: &Captures| {
        let value = &c[3];
        if value.eq_ignore_ascii_case("bearer") {
            return c[0].to_owned();
        }
        let quote = match value.chars().next() {
            Some(q @ ('"' | '\'')) => q.to_string(),
            _ => String::new(),
        };
        format!("{}{}{quote}{REDACTED}{quote}", &c[1], &c[2])
    });
    let text = URL_PASSWORD.replace_all(&text, |c: &Captures| format!("{}:{REDACTED}@", &c[1]));
    match text.char_indices().nth(MAX_MEMORY_TEXT_CHARS) {
        Some((end, _)) => text[..end].to_owned(),
        None => text.into_owned(),
    }
}

// Fixtures live under tests/ so the commit guard treats them as test data.
#[cfg(test)]
#[path = "tests/memory_redact.rs"]
mod tests;
