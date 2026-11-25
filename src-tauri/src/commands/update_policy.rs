//! Release notification policy (`update-policy.json`) is updater metadata.
//! The production WebView CSP intentionally excludes GitHub, so the renderer
//! reads it through this command, the same way the native updater reads
//! `latest.json`. Without it every policy request is refused and each release
//! silently degrades to the manual 72-hour fallback (#653).

use std::time::Duration;

use super::windows_update_feed::{release_bases, LEGACY_RELEASES, PUBLIC_RELEASES};

#[derive(serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PolicyRepository {
    Drifty,
    DriftyReleases,
}

impl PolicyRepository {
    fn release_base(&self) -> &'static str {
        match self {
            Self::Drifty => PUBLIC_RELEASES,
            Self::DriftyReleases => LEGACY_RELEASES,
        }
    }
}

const POLICY_FETCH_TIMEOUT: Duration = Duration::from_secs(4);
const POLICY_MAX_BYTES: usize = 16 * 1024;

/// Only stable version tags (`1.11.21`) and their Windows twins
/// (`1.11.21-win`) carry a policy file. Anything else is refused before any
/// request, so the renderer cannot turn this into a general GitHub fetch.
pub(crate) fn valid_policy_tag(tag: &str) -> bool {
    let version = tag.strip_suffix("-win").unwrap_or(tag);
    let parts: Vec<&str> = version.split('.').collect();
    parts.len() == 3
        && parts.iter().all(|part| {
            !part.is_empty() && part.len() <= 6 && part.bytes().all(|b| b.is_ascii_digit())
        })
}

fn policy_url(base: &str, tag: &str) -> String {
    format!("{base}/{tag}/update-policy.json")
}

/// Returns the release's policy JSON, or `None` when the release does not
/// publish one. Transport failures are errors so the caller can try its next
/// candidate and then fall back to the safe manual policy.
#[tauri::command]
pub async fn update_policy_fetch(
    app: tauri::AppHandle,
    tag: String,
    repository: Option<PolicyRepository>,
) -> Result<Option<serde_json::Value>, String> {
    if !valid_policy_tag(&tag) {
        return Err("Invalid update policy tag".into());
    }
    let bases = release_bases(&app)?;
    let base = if bases.len() == 1 {
        bases[0] // Isolated Windows updater QA uses its own fixed origin.
    } else {
        repository
            .unwrap_or(PolicyRepository::DriftyReleases)
            .release_base()
    };
    let response = reqwest::Client::builder()
        .user_agent("Drifty-update-policy")
        .timeout(POLICY_FETCH_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?
        .get(policy_url(base, &tag))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Ok(None);
    }
    if response
        .content_length()
        .is_some_and(|length| length > POLICY_MAX_BYTES as u64)
    {
        return Err("Update policy is too large".into());
    }
    let body = response.bytes().await.map_err(|e| e.to_string())?;
    if body.len() > POLICY_MAX_BYTES {
        return Err("Update policy is too large".into());
    }
    serde_json::from_slice(&body)
        .map(Some)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_stable_release_tags() {
        for tag in ["1.11.21", "1.11.21-win", "10.0.0"] {
            assert!(valid_policy_tag(tag), "{tag} should be accepted");
        }
        for tag in [
            "",
            "latest",
            "1.11",
            "1.11.21.1",
            "1.11.21-winbeta.7",
            "1.11.21-rc.1",
            "1.11.21-win-win",
            "../1.11.21",
            "1.11.21/../x",
            "1..21",
            " 1.11.21",
            "1.11.x",
        ] {
            assert!(!valid_policy_tag(tag), "{tag:?} should be refused");
        }
    }

    #[test]
    fn reads_the_immutable_release_asset() {
        assert_eq!(
            policy_url(PolicyRepository::DriftyReleases.release_base(), "1.11.21-win"),
            "https://github.com/edgethink00/drifty_releases/releases/download/1.11.21-win/update-policy.json"
        );
        assert_eq!(
            policy_url(PolicyRepository::Drifty.release_base(), "1.11.21-win"),
            "https://github.com/edgethink00/drifty/releases/download/1.11.21-win/update-policy.json"
        );
        assert!(serde_json::from_str::<PolicyRepository>(r#""other""#).is_err());
    }
}
