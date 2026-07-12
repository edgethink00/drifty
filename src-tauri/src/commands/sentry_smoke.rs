use serde::Serialize;
use std::collections::BTreeMap;
use std::time::Duration;

const SMOKE_ID_PREFIX: &str = "drifty-sentry-smoke-native-";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSentrySmokeResponse {
    smoke_id: String,
    accepted_by_sdk: bool,
    flush_completed: bool,
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
    use super::valid_smoke_id;

    #[test]
    fn accepts_only_bounded_native_smoke_ids() {
        assert!(valid_smoke_id(
            "drifty-sentry-smoke-native-1234567890abcdef12345678"
        ));
        assert!(!valid_smoke_id("renderer-smoke"));
        assert!(!valid_smoke_id("drifty-sentry-smoke-native-id with spaces"));
    }
}
