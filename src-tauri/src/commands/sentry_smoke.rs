use serde::Serialize;
use std::collections::BTreeMap;
use std::time::Duration;

const SMOKE_ID_PREFIX: &str = "drifty-sentry-smoke-native-";
const RELEASE_CHANNEL: Option<&str> = option_env!("VITE_DRIFTY_CHANNEL");

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSentrySmokeResponse {
    smoke_id: String,
    accepted_by_sdk: bool,
    flush_completed: bool,
}

fn smoke_diagnostics_enabled(channel: Option<&str>, debug_build: bool) -> bool {
    let normalized_channel = channel.map(str::trim).map(str::to_ascii_lowercase);
    if normalized_channel.as_deref() == Some("production") {
        return false;
    }
    debug_build
        || normalized_channel.as_deref().is_some_and(|value| {
            matches!(
                value,
                "development" | "dev" | "internal" | "staging" | "preview"
            )
        })
}

fn valid_smoke_id(value: &str) -> bool {
    value.starts_with(SMOKE_ID_PREFIX)
        && value.len() <= 96
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
}

#[tauri::command]
pub fn sentry_capture_native_smoke(smoke_id: String) -> Result<NativeSentrySmokeResponse, String> {
    if !smoke_diagnostics_enabled(RELEASE_CHANNEL, cfg!(debug_assertions)) {
        return Err("Sentry smoke diagnostics are disabled in production builds.".to_string());
    }
    if !valid_smoke_id(&smoke_id) {
        return Err("Invalid Sentry smoke ID.".to_string());
    }

    let mut tags = BTreeMap::new();
    tags.insert("component".to_string(), "desktop-native".to_string());
    tags.insert("diagnostic".to_string(), "sentry-smoke".to_string());
    tags.insert("smoke_id".to_string(), smoke_id.clone());

    let event_id = sentry::capture_event(sentry::protocol::Event {
        level: sentry::Level::Error,
        message: Some(smoke_id.clone()),
        tags,
        ..Default::default()
    });
    let accepted_by_sdk = !event_id.is_nil();
    let flush_completed = sentry::Hub::current()
        .client()
        .is_some_and(|client| client.flush(Some(Duration::from_secs(2))));

    Ok(NativeSentrySmokeResponse {
        smoke_id,
        accepted_by_sdk,
        flush_completed,
    })
}

#[cfg(test)]
mod tests {
    use super::{smoke_diagnostics_enabled, valid_smoke_id};

    #[test]
    fn disables_smoke_diagnostics_for_production_channel() {
        assert!(!smoke_diagnostics_enabled(Some("production"), true));
        assert!(!smoke_diagnostics_enabled(Some(" PRODUCTION "), false));
        assert!(smoke_diagnostics_enabled(Some("development"), false));
        assert!(smoke_diagnostics_enabled(None, true));
        assert!(!smoke_diagnostics_enabled(None, false));
        assert!(!smoke_diagnostics_enabled(Some("typo"), false));
    }

    #[test]
    fn accepts_only_bounded_native_smoke_ids() {
        assert!(valid_smoke_id(
            "drifty-sentry-smoke-native-1234567890abcdef12345678"
        ));
        assert!(!valid_smoke_id("renderer-smoke"));
        assert!(!valid_smoke_id("drifty-sentry-smoke-native-id with spaces"));
    }
}
