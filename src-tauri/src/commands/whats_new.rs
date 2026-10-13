//! The in-app What's new dialog shows the public drifty.so changelog. The
//! production WebView CSP does not allow drifty.so, so the renderer reads the
//! page through this command. Only the two fixed changelog pages can be
//! fetched; the renderer parses text out of them and never renders the HTML.

use std::time::Duration;

const CHANGELOG_EN_URL: &str = "https://drifty.so/changelog/";
const CHANGELOG_KO_URL: &str = "https://drifty.so/ko/changelog/";
const CHANGELOG_FETCH_TIMEOUT: Duration = Duration::from_secs(8);
const CHANGELOG_MAX_BYTES: usize = 1024 * 1024;

pub(crate) fn changelog_url(language: &str) -> &'static str {
    if language == "ko" {
        CHANGELOG_KO_URL
    } else {
        CHANGELOG_EN_URL
    }
}

/// Returns the changelog page HTML, or `None` when the site answers without
/// success. Transport failures are errors so the renderer can keep its cached
/// copy.
#[tauri::command]
pub async fn whats_new_changelog_fetch(language: String) -> Result<Option<String>, String> {
    let response = reqwest::Client::builder()
        .user_agent("Drifty-whats-new")
        .timeout(CHANGELOG_FETCH_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?
        .get(changelog_url(&language))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Ok(None);
    }
    if response
        .content_length()
        .is_some_and(|length| length > CHANGELOG_MAX_BYTES as u64)
    {
        return Err("Changelog is too large".into());
    }
    let body = response.bytes().await.map_err(|e| e.to_string())?;
    if body.len() > CHANGELOG_MAX_BYTES {
        return Err("Changelog is too large".into());
    }
    String::from_utf8(body.to_vec())
        .map(Some)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_two_public_changelog_pages_are_reachable() {
        assert_eq!(changelog_url("ko"), "https://drifty.so/ko/changelog/");
        assert_eq!(changelog_url("en"), "https://drifty.so/changelog/");
        assert_eq!(changelog_url("../../admin"), "https://drifty.so/changelog/");
    }
}
