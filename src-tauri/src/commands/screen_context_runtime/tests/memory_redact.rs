//! Synthetic credential shapes only; none of these values is a real secret.
use super::*;

#[test]
fn provider_tokens_and_assigned_values_are_removed() {
    let cases = [
        (
            "export ANTHROPIC_API_KEY=sk-ant-api03-AbCdEf0123456789xyz",
            "export ANTHROPIC_API_KEY=[redacted]",
        ),
        (
            "key sk-or-v1-0123456789abcdef0123 used",
            "key [redacted] used",
        ),
        (
            "token ghp_abcdefghijklmnopqrstuvwxyz0123456789",
            "token [redacted]",
        ),
        ("AWS AKIAABCDEFGHIJKLMNOP done", "AWS [redacted] done"),
        ("slack xoxb-1234567890-abcdefghij", "slack [redacted]"),
        (
            "Authorization: Bearer abcdefghijklmnop.qrstuvwx",
            "Authorization: Bearer [redacted]",
        ),
        ("password: hunter2-secret", "password: [redacted]"),
        ("DB_PASSWORD='correct horse'", "DB_PASSWORD='[redacted]'"),
        (
            r#"client_secret = "abc def ghi""#,
            r#"client_secret = "[redacted]""#,
        ),
        (
            "postgres://admin:s3cretpass@db.example.com/app",
            "postgres://admin:[redacted]@db.example.com/app",
        ),
        (
            "jwt eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0NTY3.SflKxwRJSMeKKF2QT4fw",
            "jwt [redacted]",
        ),
        (
            "supabase sbp_0123456789abcdef0123456789abcdef01234567",
            "supabase [redacted]",
        ),
    ];
    for (input, expected) in cases {
        assert_eq!(redact_secrets(input), expected, "{input}");
    }
}

#[test]
fn private_key_blocks_are_removed_even_when_ocr_cuts_the_end() {
    let complete = "before\n-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk\n-----END OPENSSH PRIVATE KEY-----\nafter";
    assert_eq!(redact_secrets(complete), "before\n[redacted]\nafter");
    let cut = "id_rsa\n-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA";
    assert_eq!(redact_secrets(cut), "id_rsa\n[redacted]");
}

#[test]
fn ordinary_work_text_is_preserved() {
    for text in [
        "Merged 54be1141ec08fffd14df3ac470cfc63bf64b11c8 into main",
        "Review moved from Monday 14:30 to Tuesday 09:00. Mina owns it.",
        "tokens_in=4555 tokens_out=1470; the token budget is 12/hour",
        "secretary: Minsoo Park; author: Alex",
        "Password reset email sent to the customer",
        "https://github.com/edgethink00/drifty/pull/2252",
        "risk-assessment and task-runner notes",
    ] {
        assert_eq!(redact_secrets(text), text, "{text}");
    }
}

#[test]
fn output_is_stable_and_bounded() {
    let once = redact_secrets("api_key=abcdefgh1234 and sk-ant-0123456789abcdefgh");
    assert_eq!(redact_secrets(&once), once);
    let long = "password=abcdef ".repeat(400);
    assert!(redact_secrets(&long).chars().count() <= MAX_MEMORY_TEXT_CHARS);
}
