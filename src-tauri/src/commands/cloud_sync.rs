use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

const DEFAULT_SYNC_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudSyncHttpPostRequest {
    pub url: String,
    pub bearer_token: Option<String>,
    pub apikey: Option<String>,
    pub body_json: serde_json::Value,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudSyncHttpPostResponse {
    pub status: u16,
    pub body: String,
    pub latency_ms: u128,
}

// Device-sync payloads ride native HTTP because WKWebView aborts long
// response-less fetches (same constraint as the cloud AI passes).
#[tauri::command]
pub async fn cloud_sync_http_post(
    request: CloudSyncHttpPostRequest,
) -> Result<CloudSyncHttpPostResponse, String> {
    tauri::async_runtime::spawn_blocking(move || post_cloud_sync(request))
        .await
        .map_err(|error| error.to_string())?
}

fn post_cloud_sync(request: CloudSyncHttpPostRequest) -> Result<CloudSyncHttpPostResponse, String> {
    let url = request.url.trim();
    validate_sync_url(url)?;

    let timeout = request
        .timeout_ms
        .filter(|value| *value > 0)
        .map(Duration::from_millis)
        .unwrap_or(DEFAULT_SYNC_TIMEOUT);
    let client = reqwest::blocking::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|error| error.to_string())?;

    let mut builder = client
        .post(url)
        .header(reqwest::header::CONTENT_TYPE, "application/json");

    if let Some(token) = request
        .bearer_token
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        builder = builder.bearer_auth(token);
    }
    if let Some(apikey) = request
        .apikey
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        builder = builder.header("apikey", apikey);
    }

    let started_at = Instant::now();
    let response = builder
        .json(&request.body_json)
        .send()
        .map_err(|error| error.to_string())?;
    let status = response.status().as_u16();
    let body = response.text().map_err(|error| error.to_string())?;

    Ok(CloudSyncHttpPostResponse {
        status,
        body,
        latency_ms: started_at.elapsed().as_millis(),
    })
}

// This command carries the user's session token, so it only talks to Supabase
// edge functions: hosted `*.supabase.co` over https, or localhost during
// development against `supabase start`.
fn validate_sync_url(url: &str) -> Result<(), String> {
    let parsed = reqwest::Url::parse(url).map_err(|error| error.to_string())?;
    let host = parsed.host_str().unwrap_or_default();
    let is_localhost = host == "localhost" || host == "127.0.0.1";
    let scheme_ok = match parsed.scheme() {
        "https" => true,
        "http" => is_localhost,
        _ => false,
    };
    if !scheme_ok {
        return Err("cloud sync URL must use https".to_string());
    }
    let host_ok = is_localhost || host.ends_with(".supabase.co");
    if !host_ok {
        return Err("cloud sync URL host is not an allowed Supabase origin".to_string());
    }
    if !parsed.path().starts_with("/functions/v1/") {
        return Err("cloud sync URL must target a Supabase edge function".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_sync_url;

    #[test]
    fn accepts_hosted_supabase_function_url() {
        assert!(validate_sync_url("https://abc.supabase.co/functions/v1/sync-activity").is_ok());
    }

    #[test]
    fn accepts_local_supabase_over_http() {
        assert!(validate_sync_url("http://127.0.0.1:54321/functions/v1/sync-activity").is_ok());
        assert!(validate_sync_url("http://localhost:54321/functions/v1/sync-activity").is_ok());
    }

    #[test]
    fn rejects_non_supabase_hosts_and_paths() {
        assert!(validate_sync_url("https://example.com/functions/v1/sync-activity").is_err());
        assert!(validate_sync_url("http://abc.supabase.co/functions/v1/sync-activity").is_err());
        assert!(validate_sync_url("https://abc.supabase.co/rest/v1/anything").is_err());
    }
}
