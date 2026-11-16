use std::{
    collections::{HashMap, HashSet},
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::{DateTime, NaiveDate, Utc};
use keyring::{Entry, Error as KeyringError};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;
use url::Url;
use uuid::Uuid;

const GOOGLE_AUTHORIZATION_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_ENDPOINT: &str = "https://openidconnect.googleapis.com/v1/userinfo";
const GOOGLE_CALENDAR_EVENTS_ENDPOINT: &str =
    "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const GOOGLE_CALENDAR_READ_SCOPE: &str =
    "https://www.googleapis.com/auth/calendar.events.owned.readonly";
const GOOGLE_CALENDAR_KEYCHAIN_SERVICE: &str = "so.drifty.google-calendar";
const PRODUCTION_APP_IDENTIFIER: &str = "so.drifty.mac";
const OAUTH_CALLBACK_PATH: &str = "/oauth2/callback";
const OAUTH_CALLBACK_TIMEOUT: Duration = Duration::from_secs(120);
const OAUTH_HTTP_READ_TIMEOUT: Duration = Duration::from_secs(2);
const OAUTH_POLL_INTERVAL: Duration = Duration::from_millis(40);
const OAUTH_REQUEST_MAX_BYTES: usize = 8 * 1024;
const PENDING_CREDENTIAL_TTL: Duration = Duration::from_secs(5 * 60);
const CALENDAR_REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_CALENDAR_RANGE_DAYS: i64 = 31;
const MAX_CALENDAR_PAGES: usize = 4;
const MAX_CALENDAR_EVENTS: usize = 500;
const MAX_CALENDAR_EVENT_ID_BYTES: usize = 256;
const MAX_CALENDAR_EVENT_TITLE_BYTES: usize = 4_096;
const MAX_CALENDAR_EVENT_TIME_BYTES: usize = 128;
const MAX_CALENDAR_PAGE_TOKEN_BYTES: usize = 4_096;

#[derive(Default)]
pub struct GoogleCalendarState {
    pending_credentials: Mutex<HashMap<String, PendingGoogleCredential>>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GoogleCalendarAuthPurpose {
    SignIn,
    Connect,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleCalendarCapability {
    configured: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleCalendarAuthorizationResult {
    attempt_id: String,
    purpose: GoogleCalendarAuthPurpose,
    calendar_granted: bool,
    calendar_credential_ready: bool,
    connected_email: Option<String>,
    google_subject: Option<String>,
    id_token: Option<String>,
    access_token: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct GoogleCalendarCredential {
    refresh_token: String,
    connected_email: Option<String>,
    google_subject: Option<String>,
    granted_scopes: Vec<String>,
}

struct PendingGoogleCredential {
    purpose: GoogleCalendarAuthPurpose,
    credential: Option<GoogleCalendarCredential>,
    expires_at: Instant,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleCalendarStatus {
    configured: bool,
    connected: bool,
    connected_email: Option<String>,
    granted_scopes: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleCalendarEvent {
    id: String,
    title: String,
    start: String,
    end: String,
    all_day: bool,
}

#[derive(Deserialize)]
struct GoogleTokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    scope: Option<String>,
    id_token: Option<String>,
}

#[derive(Deserialize)]
struct GoogleRefreshResponse {
    access_token: String,
}

#[derive(Deserialize)]
struct GoogleUserInfoResponse {
    sub: Option<String>,
    email: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoogleCalendarEventsResponse {
    next_page_token: Option<String>,
    #[serde(default)]
    items: Vec<GoogleCalendarEventWire>,
}

#[derive(Deserialize)]
struct GoogleCalendarEventWire {
    id: Option<String>,
    status: Option<String>,
    summary: Option<String>,
    start: Option<GoogleCalendarEventTimeWire>,
    end: Option<GoogleCalendarEventTimeWire>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoogleCalendarEventTimeWire {
    date_time: Option<String>,
    date: Option<String>,
}

#[derive(Eq, PartialEq)]
enum OAuthCallback {
    Code(String),
    Cancelled,
}

fn configured_client_id() -> Option<&'static str> {
    option_env!("GOOGLE_CALENDAR_DESKTOP_CLIENT_ID")
        .map(str::trim)
        .filter(|value| is_valid_google_client_id(value))
}

/// Google's installed-application token endpoint still requires the client
/// secret even though desktop clients cannot keep it confidential. The value is
/// a distributed application identifier rather than a server credential; PKCE
/// remains the actual proof of possession for the authorization code.
fn configured_client_secret() -> Option<&'static str> {
    option_env!("GOOGLE_CALENDAR_DESKTOP_CLIENT_SECRET")
        .map(str::trim)
        .filter(|value| is_valid_google_client_secret(value))
}

fn is_valid_google_client_secret(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

/// The capability is only usable when both build-time values are present, so
/// every configured check reports readiness of the whole credential pair.
fn is_configured() -> bool {
    configured_client_id().is_some() && configured_client_secret().is_some()
}

fn is_valid_google_client_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && value.ends_with(".apps.googleusercontent.com")
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.'))
}

fn oauth_random_value() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}

fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

fn authorization_url(
    client_id: &str,
    redirect_uri: &str,
    state: &str,
    verifier: &str,
) -> Result<Url, String> {
    let mut url = Url::parse(GOOGLE_AUTHORIZATION_ENDPOINT)
        .map_err(|_| "GOOGLE_CALENDAR_CONFIGURATION_ERROR".to_string())?;
    url.query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("response_type", "code")
        .append_pair(
            "scope",
            &["openid", "email", "profile", GOOGLE_CALENDAR_READ_SCOPE].join(" "),
        )
        .append_pair("code_challenge", &pkce_challenge(verifier))
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", state)
        .append_pair("access_type", "offline")
        .append_pair("enable_granular_consent", "true")
        .append_pair("prompt", "consent select_account");
    Ok(url)
}

fn write_loopback_response(stream: &mut TcpStream, status: &str, body: &str) {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn parse_loopback_request(
    request: &str,
    expected_state: &str,
) -> Result<Option<OAuthCallback>, String> {
    let Some(request_line) = request.lines().next() else {
        return Ok(None);
    };
    let mut parts = request_line.split_whitespace();
    if parts.next() != Some("GET") {
        return Ok(None);
    }
    let Some(target) = parts.next() else {
        return Ok(None);
    };
    if target.len() > 4_096 {
        return Ok(None);
    }
    let parsed = Url::parse(&format!("http://127.0.0.1{target}"))
        .map_err(|_| "GOOGLE_CALENDAR_CALLBACK_INVALID".to_string())?;
    if parsed.path() != OAUTH_CALLBACK_PATH {
        return Ok(None);
    }

    let state_values: Vec<_> = parsed
        .query_pairs()
        .filter(|(key, _)| key == "state")
        .map(|(_, value)| value.into_owned())
        .collect();
    if state_values.len() != 1 || state_values[0] != expected_state {
        return Err("GOOGLE_CALENDAR_CALLBACK_STATE_MISMATCH".to_string());
    }

    let error_values: Vec<_> = parsed
        .query_pairs()
        .filter(|(key, _)| key == "error")
        .map(|(_, value)| value.into_owned())
        .collect();
    if error_values.len() > 1 {
        return Err("GOOGLE_CALENDAR_CALLBACK_ERROR_INVALID".to_string());
    }
    if error_values.first().map(String::as_str) == Some("access_denied") {
        return Ok(Some(OAuthCallback::Cancelled));
    }
    if !error_values.is_empty() {
        return Err("GOOGLE_CALENDAR_AUTHORIZATION_FAILED".to_string());
    }

    let code_values: Vec<_> = parsed
        .query_pairs()
        .filter(|(key, _)| key == "code")
        .map(|(_, value)| value.into_owned())
        .collect();
    if code_values.len() != 1 || code_values[0].is_empty() || code_values[0].len() > 4_096 {
        return Err("GOOGLE_CALENDAR_CALLBACK_CODE_INVALID".to_string());
    }
    Ok(Some(OAuthCallback::Code(code_values[0].clone())))
}

fn wait_for_oauth_callback(
    listener: TcpListener,
    expected_state: &str,
    timeout: Duration,
) -> Result<OAuthCallback, String> {
    listener
        .set_nonblocking(true)
        .map_err(|_| "GOOGLE_CALENDAR_CALLBACK_LISTENER_FAILED".to_string())?;
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        match listener.accept() {
            Ok((mut stream, _)) => {
                // The listener polls in non-blocking mode, and on macOS the
                // accepted socket inherits that flag. Reading it directly
                // returns WouldBlock before the browser's request arrives, so
                // restore blocking behaviour and let the read timeout bound it.
                if stream.set_nonblocking(false).is_err() {
                    write_loopback_response(
                        &mut stream,
                        "500 Internal Server Error",
                        "<h1>Unable to read this sign-in response.</h1>",
                    );
                    continue;
                }
                let _ = stream.set_read_timeout(Some(OAUTH_HTTP_READ_TIMEOUT));
                let mut buffer = [0_u8; OAUTH_REQUEST_MAX_BYTES];
                // A single read can return a partial request line, so keep
                // reading until the header block is complete, the buffer is
                // full, or the read timeout fires.
                let mut bytes_read = 0_usize;
                loop {
                    match stream.read(&mut buffer[bytes_read..]) {
                        Ok(0) => break,
                        Ok(value) => {
                            bytes_read += value;
                            let received = &buffer[..bytes_read];
                            if received
                                .windows(4)
                                .any(|window| window == b"\r\n\r\n")
                                || received.windows(2).any(|window| window == b"\n\n")
                                || bytes_read == buffer.len()
                            {
                                break;
                            }
                        }
                        Err(_) => break,
                    }
                }
                if bytes_read == 0 {
                    write_loopback_response(
                        &mut stream,
                        "400 Bad Request",
                        "<h1>Unable to read this sign-in response.</h1>",
                    );
                    continue;
                }
                let request = String::from_utf8_lossy(&buffer[..bytes_read]);
                match parse_loopback_request(&request, expected_state) {
                    Ok(Some(OAuthCallback::Code(code))) => {
                        write_loopback_response(
                            &mut stream,
                            "200 OK",
                            "<style>body{font:16px system-ui;padding:40px;color:#1f2937}</style><h1>Connected to Drifty</h1><p>You can close this tab and return to the app.</p>",
                        );
                        return Ok(OAuthCallback::Code(code));
                    }
                    Ok(Some(OAuthCallback::Cancelled)) => {
                        write_loopback_response(
                            &mut stream,
                            "200 OK",
                            "<style>body{font:16px system-ui;padding:40px;color:#1f2937}</style><h1>Sign-in cancelled</h1><p>You can close this tab and return to Drifty.</p>",
                        );
                        return Ok(OAuthCallback::Cancelled);
                    }
                    Ok(None) => {
                        write_loopback_response(&mut stream, "404 Not Found", "<h1>Not found</h1>");
                    }
                    Err(error) if error == "GOOGLE_CALENDAR_CALLBACK_STATE_MISMATCH" => {
                        write_loopback_response(
                            &mut stream,
                            "400 Bad Request",
                            "<h1>This sign-in response was not expected.</h1>",
                        );
                    }
                    Err(error) => {
                        write_loopback_response(
                            &mut stream,
                            "400 Bad Request",
                            "<h1>Google sign-in could not be completed.</h1>",
                        );
                        return Err(error);
                    }
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(OAUTH_POLL_INTERVAL);
            }
            Err(_) => return Err("GOOGLE_CALENDAR_CALLBACK_LISTENER_FAILED".to_string()),
        }
    }
    Err("GOOGLE_CALENDAR_AUTHORIZATION_TIMEOUT".to_string())
}

fn http_client() -> Result<Client, String> {
    Client::builder()
        .timeout(CALENDAR_REQUEST_TIMEOUT)
        .build()
        .map_err(|_| "GOOGLE_CALENDAR_HTTP_CLIENT_FAILED".to_string())
}

fn exchange_authorization_code(
    client: &Client,
    client_id: &str,
    client_secret: &str,
    redirect_uri: &str,
    code: &str,
    verifier: &str,
) -> Result<GoogleTokenResponse, String> {
    let response = client
        .post(GOOGLE_TOKEN_ENDPOINT)
        .form(&[
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("code", code),
            ("code_verifier", verifier),
            ("grant_type", "authorization_code"),
            ("redirect_uri", redirect_uri),
        ])
        .send()
        .map_err(|_| "GOOGLE_CALENDAR_TOKEN_EXCHANGE_FAILED".to_string())?;
    if !response.status().is_success() {
        return Err("GOOGLE_CALENDAR_TOKEN_EXCHANGE_FAILED".to_string());
    }
    response
        .json::<GoogleTokenResponse>()
        .map_err(|_| "GOOGLE_CALENDAR_TOKEN_RESPONSE_INVALID".to_string())
}

fn fetch_user_info(client: &Client, access_token: &str) -> Option<GoogleUserInfoResponse> {
    client
        .get(GOOGLE_USERINFO_ENDPOINT)
        .bearer_auth(access_token)
        .send()
        .ok()?
        .error_for_status()
        .ok()?
        .json::<GoogleUserInfoResponse>()
        .ok()
}

fn granted_scope_set(scope: Option<&str>) -> HashSet<&str> {
    scope.unwrap_or_default().split_whitespace().collect()
}

fn pending_credential_expiry() -> Instant {
    Instant::now() + PENDING_CREDENTIAL_TTL
}

fn purge_expired_pending_credentials(pending: &mut HashMap<String, PendingGoogleCredential>) {
    let now = Instant::now();
    pending.retain(|_, value| value.expires_at > now);
}

fn validate_user_id(user_id: &str) -> Result<String, String> {
    let parsed = Uuid::parse_str(user_id.trim())
        .map_err(|_| "GOOGLE_CALENDAR_USER_ID_INVALID".to_string())?;
    Ok(parsed.to_string())
}

fn keychain_service_for_identifier(identifier: &str) -> String {
    let identifier = identifier.trim();
    if identifier == PRODUCTION_APP_IDENTIFIER {
        return GOOGLE_CALENDAR_KEYCHAIN_SERVICE.to_string();
    }

    // Keep production credentials on the original service for upgrade
    // compatibility, while isolating worktree and staging builds. Ad-hoc dev
    // signatures otherwise collide with an existing item's Keychain ACL and
    // can neither read nor update it without an interactive prompt.
    format!("{GOOGLE_CALENDAR_KEYCHAIN_SERVICE}.{identifier}")
}

fn keychain_entry(app: &AppHandle, user_id: &str) -> Result<Entry, String> {
    let normalized = validate_user_id(user_id)?;
    Entry::new(
        &keychain_service_for_identifier(&app.config().identifier),
        &format!("supabase-user:{normalized}"),
    )
    .map_err(|_| "GOOGLE_CALENDAR_CREDENTIAL_STORE_UNAVAILABLE".to_string())
}

fn load_credential(
    app: &AppHandle,
    user_id: &str,
) -> Result<Option<GoogleCalendarCredential>, String> {
    with_calendar_credential_io(false, || {
        match keychain_entry(app, user_id)?.get_password() {
            Ok(value) => serde_json::from_str(&value)
                .map(Some)
                .map_err(|_| "GOOGLE_CALENDAR_CREDENTIAL_INVALID".to_string()),
            Err(KeyringError::NoEntry) => Ok(None),
            Err(_) => Err("GOOGLE_CALENDAR_CREDENTIAL_READ_FAILED".to_string()),
        }
    })
}

fn save_credential(
    app: &AppHandle,
    user_id: &str,
    credential: &GoogleCalendarCredential,
) -> Result<(), String> {
    with_calendar_credential_io(true, || {
        let value = serde_json::to_string(credential)
            .map_err(|_| "GOOGLE_CALENDAR_CREDENTIAL_INVALID".to_string())?;
        keychain_entry(app, user_id)?
            .set_password(&value)
            .map_err(|_| "GOOGLE_CALENDAR_CREDENTIAL_SAVE_FAILED".to_string())
    })
}

fn delete_credential(app: &AppHandle, user_id: &str) -> Result<(), String> {
    with_calendar_credential_io(true, || {
        match keychain_entry(app, user_id)?.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(_) => Err("GOOGLE_CALENDAR_CREDENTIAL_DELETE_FAILED".to_string()),
        }
    })
}

fn disconnected_status() -> GoogleCalendarStatus {
    GoogleCalendarStatus {
        configured: is_configured(),
        connected: false,
        connected_email: None,
        granted_scopes: Vec::new(),
    }
}

fn status_from_credential(credential: Option<GoogleCalendarCredential>) -> GoogleCalendarStatus {
    match credential {
        Some(value) => GoogleCalendarStatus {
            configured: is_configured(),
            connected: true,
            connected_email: value.connected_email,
            granted_scopes: value.granted_scopes,
        },
        None => disconnected_status(),
    }
}

fn validate_pending_purpose(
    actual: GoogleCalendarAuthPurpose,
    expected: GoogleCalendarAuthPurpose,
) -> Result<(), String> {
    if actual == expected {
        Ok(())
    } else {
        Err("GOOGLE_CALENDAR_ATTEMPT_PURPOSE_MISMATCH".to_string())
    }
}

fn bounded_trimmed(value: String, max_bytes: usize) -> Option<String> {
    let value = value.trim();
    (!value.is_empty() && value.len() <= max_bytes).then(|| value.to_string())
}

fn truncate_utf8(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_string();
    }
    let mut end = max_bytes;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].to_string()
}

fn normalize_calendar_event(item: GoogleCalendarEventWire) -> Option<GoogleCalendarEvent> {
    if item.status.as_deref() == Some("cancelled") {
        return None;
    }
    let id = bounded_trimmed(item.id?, MAX_CALENDAR_EVENT_ID_BYTES)?;
    let start_value = item.start?;
    let end_value = item.end?;
    let (start, end, all_day) = match (
        start_value.date_time,
        start_value.date,
        end_value.date_time,
        end_value.date,
    ) {
        (Some(start), _, Some(end), _) => {
            if start.len() > MAX_CALENDAR_EVENT_TIME_BYTES
                || end.len() > MAX_CALENDAR_EVENT_TIME_BYTES
            {
                return None;
            }
            let parsed_start = DateTime::parse_from_rfc3339(&start).ok()?;
            let parsed_end = DateTime::parse_from_rfc3339(&end).ok()?;
            if parsed_end <= parsed_start {
                return None;
            }
            (start, end, false)
        }
        (_, Some(start), _, Some(end)) => {
            if start.len() > MAX_CALENDAR_EVENT_TIME_BYTES
                || end.len() > MAX_CALENDAR_EVENT_TIME_BYTES
            {
                return None;
            }
            let parsed_start = NaiveDate::parse_from_str(&start, "%Y-%m-%d").ok()?;
            let parsed_end = NaiveDate::parse_from_str(&end, "%Y-%m-%d").ok()?;
            if parsed_end <= parsed_start {
                return None;
            }
            (start, end, true)
        }
        _ => return None,
    };
    let title = item
        .summary
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| truncate_utf8(value, MAX_CALENDAR_EVENT_TITLE_BYTES))
        .unwrap_or_else(|| "Busy".to_string());

    Some(GoogleCalendarEvent {
        id,
        title,
        start,
        end,
        all_day,
    })
}

fn refresh_access_token(
    client: &Client,
    client_id: &str,
    client_secret: &str,
    refresh_token: &str,
) -> Result<String, String> {
    let response = client
        .post(GOOGLE_TOKEN_ENDPOINT)
        .form(&[
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("refresh_token", refresh_token),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .map_err(|_| "GOOGLE_CALENDAR_REFRESH_FAILED".to_string())?;
    if !response.status().is_success() {
        return Err("GOOGLE_CALENDAR_RECONNECT_REQUIRED".to_string());
    }
    let token = response
        .json::<GoogleRefreshResponse>()
        .map_err(|_| "GOOGLE_CALENDAR_REFRESH_FAILED".to_string())?
        .access_token;
    if token.is_empty() {
        return Err("GOOGLE_CALENDAR_REFRESH_FAILED".to_string());
    }
    Ok(token)
}

fn validate_calendar_range(start: &str, end: &str) -> Result<(), String> {
    let start = DateTime::parse_from_rfc3339(start)
        .map_err(|_| "GOOGLE_CALENDAR_RANGE_INVALID".to_string())?
        .with_timezone(&Utc);
    let end = DateTime::parse_from_rfc3339(end)
        .map_err(|_| "GOOGLE_CALENDAR_RANGE_INVALID".to_string())?
        .with_timezone(&Utc);
    if end <= start || end.signed_duration_since(start).num_days() > MAX_CALENDAR_RANGE_DAYS {
        return Err("GOOGLE_CALENDAR_RANGE_INVALID".to_string());
    }
    Ok(())
}

fn fetch_calendar_events(
    client: &Client,
    access_token: &str,
    start: &str,
    end: &str,
) -> Result<Vec<GoogleCalendarEvent>, String> {
    validate_calendar_range(start, end)?;
    let mut events = Vec::new();
    let mut next_page_token: Option<String> = None;

    for _ in 0..MAX_CALENDAR_PAGES {
        let mut url = Url::parse(GOOGLE_CALENDAR_EVENTS_ENDPOINT)
            .map_err(|_| "GOOGLE_CALENDAR_CONFIGURATION_ERROR".to_string())?;
        {
            let mut query = url.query_pairs_mut();
            query
                .append_pair("timeMin", start)
                .append_pair("timeMax", end)
                .append_pair("singleEvents", "true")
                .append_pair("orderBy", "startTime")
                .append_pair("maxResults", "250")
                .append_pair(
                    "fields",
                    "nextPageToken,items(id,status,summary,start(date,dateTime),end(date,dateTime))",
                );
            if let Some(token) = next_page_token.as_deref() {
                query.append_pair("pageToken", token);
            }
        }

        let response = client
            .get(url)
            .bearer_auth(access_token)
            .send()
            .map_err(|_| "GOOGLE_CALENDAR_EVENTS_FAILED".to_string())?;
        if response.status().as_u16() == 401 || response.status().as_u16() == 403 {
            return Err("GOOGLE_CALENDAR_RECONNECT_REQUIRED".to_string());
        }
        if !response.status().is_success() {
            return Err("GOOGLE_CALENDAR_EVENTS_FAILED".to_string());
        }
        let page = response
            .json::<GoogleCalendarEventsResponse>()
            .map_err(|_| "GOOGLE_CALENDAR_EVENTS_RESPONSE_INVALID".to_string())?;

        for item in page.items {
            let Some(event) = normalize_calendar_event(item) else {
                continue;
            };
            events.push(event);
            if events.len() >= MAX_CALENDAR_EVENTS {
                return Ok(events);
            }
        }

        if page
            .next_page_token
            .as_ref()
            .is_some_and(|token| token.len() > MAX_CALENDAR_PAGE_TOKEN_BYTES)
        {
            return Err("GOOGLE_CALENDAR_EVENTS_RESPONSE_INVALID".to_string());
        }
        next_page_token = page.next_page_token;
        if next_page_token.is_none() {
            break;
        }
    }
    Ok(events)
}

#[tauri::command]
pub fn google_calendar_capability() -> GoogleCalendarCapability {
    GoogleCalendarCapability {
        configured: is_configured(),
    }
}

#[tauri::command]
pub async fn google_calendar_authorize(
    app: AppHandle,
    state: State<'_, GoogleCalendarState>,
    purpose: GoogleCalendarAuthPurpose,
) -> Result<GoogleCalendarAuthorizationResult, String> {
    let client_id = configured_client_id()
        .ok_or_else(|| "GOOGLE_CALENDAR_NOT_CONFIGURED".to_string())?
        .to_string();
    let client_secret = configured_client_secret()
        .ok_or_else(|| "GOOGLE_CALENDAR_NOT_CONFIGURED".to_string())?
        .to_string();
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|_| "GOOGLE_CALENDAR_CALLBACK_LISTENER_FAILED".to_string())?;
    let port = listener
        .local_addr()
        .map_err(|_| "GOOGLE_CALENDAR_CALLBACK_LISTENER_FAILED".to_string())?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}{OAUTH_CALLBACK_PATH}");
    let oauth_state = oauth_random_value();
    let verifier = oauth_random_value();
    let url = authorization_url(&client_id, &redirect_uri, &oauth_state, &verifier)?;

    app.opener()
        .open_url(url.as_str(), None::<&str>)
        .map_err(|_| "GOOGLE_CALENDAR_BROWSER_OPEN_FAILED".to_string())?;

    let token_result = tauri::async_runtime::spawn_blocking(move || {
        let callback = wait_for_oauth_callback(listener, &oauth_state, OAUTH_CALLBACK_TIMEOUT)?;
        let OAuthCallback::Code(code) = callback else {
            return Err("GOOGLE_CALENDAR_AUTHORIZATION_CANCELLED".to_string());
        };
        let client = http_client()?;
        let token =
            exchange_authorization_code(
                &client,
                &client_id,
                &client_secret,
                &redirect_uri,
                &code,
                &verifier,
            )?;
        let user_info = fetch_user_info(&client, &token.access_token);
        Ok::<_, String>((token, user_info))
    })
    .await
    .map_err(|_| "GOOGLE_CALENDAR_AUTHORIZATION_FAILED".to_string())??;

    let (token, user_info) = token_result;
    let scopes = granted_scope_set(token.scope.as_deref());
    let calendar_granted = scopes.contains(GOOGLE_CALENDAR_READ_SCOPE);
    let mut granted_scopes: Vec<String> = scopes.into_iter().map(ToString::to_string).collect();
    granted_scopes.sort();
    let connected_email = user_info.as_ref().and_then(|value| value.email.clone());
    let google_subject = user_info.and_then(|value| value.sub);
    let calendar_credential_ready = calendar_granted && token.refresh_token.is_some();
    let credential = if calendar_credential_ready {
        token
            .refresh_token
            .clone()
            .map(|refresh_token| GoogleCalendarCredential {
                refresh_token,
                connected_email: connected_email.clone(),
                google_subject: google_subject.clone(),
                granted_scopes: granted_scopes.clone(),
            })
    } else {
        None
    };
    let attempt_id = oauth_random_value();
    {
        let mut pending = state
            .pending_credentials
            .lock()
            .map_err(|_| "GOOGLE_CALENDAR_STATE_UNAVAILABLE".to_string())?;
        purge_expired_pending_credentials(&mut pending);
        pending.insert(
            attempt_id.clone(),
            PendingGoogleCredential {
                purpose,
                credential,
                expires_at: pending_credential_expiry(),
            },
        );
    }

    Ok(GoogleCalendarAuthorizationResult {
        attempt_id,
        purpose,
        calendar_granted,
        calendar_credential_ready,
        connected_email,
        google_subject,
        id_token: (purpose == GoogleCalendarAuthPurpose::SignIn)
            .then_some(token.id_token)
            .flatten(),
        access_token: (purpose == GoogleCalendarAuthPurpose::SignIn).then_some(token.access_token),
    })
}

#[tauri::command]
pub fn google_calendar_finalize(
    app: AppHandle,
    state: State<'_, GoogleCalendarState>,
    user_id: String,
    attempt_id: String,
    purpose: GoogleCalendarAuthPurpose,
) -> Result<GoogleCalendarStatus, String> {
    let normalized_user_id = validate_user_id(&user_id)?;
    let pending = {
        let mut credentials = state
            .pending_credentials
            .lock()
            .map_err(|_| "GOOGLE_CALENDAR_STATE_UNAVAILABLE".to_string())?;
        purge_expired_pending_credentials(&mut credentials);
        credentials.remove(attempt_id.trim())
    }
    .ok_or_else(|| "GOOGLE_CALENDAR_ATTEMPT_EXPIRED".to_string())?;

    validate_pending_purpose(pending.purpose, purpose)?;
    if let Some(credential) = pending.credential {
        save_credential(&app, &normalized_user_id, &credential)?;
        return Ok(status_from_credential(Some(credential)));
    }
    Ok(disconnected_status())
}

#[tauri::command]
pub fn google_calendar_discard_pending(
    state: State<'_, GoogleCalendarState>,
    attempt_id: String,
) -> Result<(), String> {
    let mut pending = state
        .pending_credentials
        .lock()
        .map_err(|_| "GOOGLE_CALENDAR_STATE_UNAVAILABLE".to_string())?;
    pending.remove(attempt_id.trim());
    purge_expired_pending_credentials(&mut pending);
    Ok(())
}

#[tauri::command]
pub fn google_calendar_status(
    app: AppHandle,
    user_id: String,
) -> Result<GoogleCalendarStatus, String> {
    Ok(status_from_credential(load_credential(&app, &user_id)?))
}

#[tauri::command]
pub async fn google_calendar_events(
    app: AppHandle,
    user_id: String,
    start: String,
    end: String,
) -> Result<Vec<GoogleCalendarEvent>, String> {
    validate_calendar_range(&start, &end)?;
    let credential = load_credential(&app, &user_id)?
        .ok_or_else(|| "GOOGLE_CALENDAR_NOT_CONNECTED".to_string())?;
    let client_id = configured_client_id()
        .ok_or_else(|| "GOOGLE_CALENDAR_NOT_CONFIGURED".to_string())?
        .to_string();
    let client_secret = configured_client_secret()
        .ok_or_else(|| "GOOGLE_CALENDAR_NOT_CONFIGURED".to_string())?
        .to_string();

    tauri::async_runtime::spawn_blocking(move || {
        let client = http_client()?;
        let access_token = refresh_access_token(
            &client,
            &client_id,
            &client_secret,
            &credential.refresh_token,
        )?;
        fetch_calendar_events(&client, &access_token, &start, &end)
    })
    .await
    .map_err(|_| "GOOGLE_CALENDAR_EVENTS_FAILED".to_string())?
}

#[tauri::command]
pub fn google_calendar_disconnect(
    app: AppHandle,
    user_id: String,
) -> Result<GoogleCalendarStatus, String> {
    delete_credential(&app, &user_id)?;
    Ok(disconnected_status())
}

#[cfg(test)]
mod tests {
    use super::{
        authorization_url, granted_scope_set, is_valid_google_client_id,
        keychain_service_for_identifier, normalize_calendar_event, parse_loopback_request,
        pkce_challenge, validate_calendar_range, validate_pending_purpose,
        GoogleCalendarAuthPurpose, GoogleCalendarEventTimeWire, GoogleCalendarEventWire,
        OAuthCallback, GOOGLE_CALENDAR_KEYCHAIN_SERVICE, GOOGLE_CALENDAR_READ_SCOPE,
    };

    #[test]
    fn preserves_production_keychain_service_and_isolates_non_production_bundles() {
        assert_eq!(
            keychain_service_for_identifier("so.drifty.mac"),
            GOOGLE_CALENDAR_KEYCHAIN_SERVICE
        );
        assert_eq!(
            keychain_service_for_identifier("so.drifty.mac.wt-calendar-qa"),
            "so.drifty.google-calendar.so.drifty.mac.wt-calendar-qa"
        );
    }

    #[test]
    fn validates_google_desktop_client_ids() {
        assert!(is_valid_google_client_id(
            "123-example.apps.googleusercontent.com"
        ));
        assert!(!is_valid_google_client_id(""));
        assert!(!is_valid_google_client_id("https://example.com"));
        assert!(!is_valid_google_client_id(
            "123-example.apps.googleusercontent.com/path"
        ));
    }

    #[test]
    fn builds_least_privilege_pkce_authorization_url() {
        let url = authorization_url(
            "123-example.apps.googleusercontent.com",
            "http://127.0.0.1:43123/oauth2/callback",
            "expected-state",
            "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_",
        )
        .expect("authorization URL should build");
        let query: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(query.get("response_type").map(String::as_str), Some("code"));
        assert_eq!(
            query.get("access_type").map(String::as_str),
            Some("offline")
        );
        assert_eq!(
            query.get("code_challenge_method").map(String::as_str),
            Some("S256")
        );
        assert_eq!(
            query.get("enable_granular_consent").map(String::as_str),
            Some("true")
        );
        assert_eq!(
            query.get("code_challenge").map(String::as_str),
            Some(
                pkce_challenge("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_")
                    .as_str()
            )
        );
        let scopes = granted_scope_set(query.get("scope").map(String::as_str));
        assert!(scopes.contains("openid"));
        assert!(scopes.contains("email"));
        assert!(scopes.contains("profile"));
        assert!(scopes.contains(GOOGLE_CALENDAR_READ_SCOPE));
        assert!(
            !scopes
                .iter()
                .any(|scope| scope.contains("calendar.events")
                    && *scope != GOOGLE_CALENDAR_READ_SCOPE)
        );
    }

    #[test]
    fn accepts_matching_loopback_callback_and_rejects_mismatched_state() {
        let accepted = parse_loopback_request(
            "GET /oauth2/callback?code=abc123&state=expected HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n",
            "expected",
        )
        .expect("callback should parse");
        assert!(accepted == Some(OAuthCallback::Code("abc123".to_string())));

        let mismatch = parse_loopback_request(
            "GET /oauth2/callback?code=abc123&state=wrong HTTP/1.1\r\n\r\n",
            "expected",
        );
        assert!(matches!(
            mismatch,
            Err(error) if error == "GOOGLE_CALENDAR_CALLBACK_STATE_MISMATCH"
        ));
    }

    #[test]
    fn treats_google_access_denied_as_cancellation() {
        let callback = parse_loopback_request(
            "GET /oauth2/callback?error=access_denied&state=expected HTTP/1.1\r\n\r\n",
            "expected",
        )
        .expect("callback should parse");
        assert!(callback == Some(OAuthCallback::Cancelled));
    }

    #[test]
    fn accepts_a_real_google_success_callback_with_extra_parameters() {
        // Google returns iss, scope, authuser, and prompt alongside the code.
        // The parser must ignore them instead of rejecting the whole request.
        let request = concat!(
            "GET /oauth2/callback?state=expected",
            "&iss=https://accounts.google.com",
            "&code=4/0ATsMZqExampleAuthorizationCodeValue",
            "&scope=email%20profile%20https://www.googleapis.com/auth/calendar.events.owned.readonly",
            "%20https://www.googleapis.com/auth/userinfo.profile",
            "%20https://www.googleapis.com/auth/userinfo.email%20openid",
            "&authuser=1&prompt=consent HTTP/1.1\r\n",
            "Host: 127.0.0.1:49961\r\n",
            "User-Agent: Mozilla/5.0\r\n\r\n",
        );
        let callback = parse_loopback_request(request, "expected").expect("callback should parse");
        assert!(matches!(
            callback,
            Some(OAuthCallback::Code(ref code))
                if code == "4/0ATsMZqExampleAuthorizationCodeValue"
        ));
    }

    #[test]
    fn rejects_duplicate_or_missing_callback_values() {
        assert!(parse_loopback_request(
            "GET /oauth2/callback?code=a&code=b&state=expected HTTP/1.1\r\n\r\n",
            "expected",
        )
        .is_err());
        assert!(
            parse_loopback_request("GET /oauth2/callback?code=a HTTP/1.1\r\n\r\n", "expected",)
                .is_err()
        );
        assert!(parse_loopback_request(
            "GET /oauth2/callback?error=access_denied&error=server_error&state=expected HTTP/1.1\r\n\r\n",
            "expected",
        )
        .is_err());
        assert!(parse_loopback_request("GET /favicon.ico HTTP/1.1\r\n\r\n", "expected")
            .expect("unrelated paths should be ignored")
            .is_none());
    }

    #[test]
    fn enforces_bounded_calendar_ranges() {
        assert!(validate_calendar_range("2026-09-01T00:00:00Z", "2026-09-08T00:00:00Z").is_ok());
        assert!(validate_calendar_range("2026-09-08T00:00:00Z", "2026-09-01T00:00:00Z").is_err());
        assert!(validate_calendar_range("2026-09-01T00:00:00Z", "2026-10-08T00:00:00Z").is_err());
        assert!(validate_calendar_range("not-a-date", "2026-09-08T00:00:00Z").is_err());
    }

    #[test]
    fn auth_purpose_uses_expected_wire_names() {
        assert_eq!(
            serde_json::to_string(&GoogleCalendarAuthPurpose::SignIn).unwrap(),
            "\"signIn\""
        );
        assert_eq!(
            serde_json::to_string(&GoogleCalendarAuthPurpose::Connect).unwrap(),
            "\"connect\""
        );
        assert!(validate_pending_purpose(
            GoogleCalendarAuthPurpose::SignIn,
            GoogleCalendarAuthPurpose::SignIn,
        )
        .is_ok());
        assert_eq!(
            validate_pending_purpose(
                GoogleCalendarAuthPurpose::SignIn,
                GoogleCalendarAuthPurpose::Connect,
            ),
            Err("GOOGLE_CALENDAR_ATTEMPT_PURPOSE_MISMATCH".to_string())
        );
    }

    #[test]
    fn normalizes_bounded_calendar_events_and_drops_malformed_rows() {
        let valid = normalize_calendar_event(GoogleCalendarEventWire {
            id: Some(" event-1 ".to_string()),
            status: Some("confirmed".to_string()),
            summary: Some(format!("  {}  ", "계획".repeat(2_000))),
            start: Some(GoogleCalendarEventTimeWire {
                date_time: Some("2026-09-02T01:00:00Z".to_string()),
                date: None,
            }),
            end: Some(GoogleCalendarEventTimeWire {
                date_time: Some("2026-09-02T02:00:00Z".to_string()),
                date: None,
            }),
        })
        .expect("valid event should survive normalization");
        assert_eq!(valid.id, "event-1");
        assert!(valid.title.len() <= 4_096);
        assert!(!valid.all_day);

        assert!(normalize_calendar_event(GoogleCalendarEventWire {
            id: Some("event-2".to_string()),
            status: None,
            summary: None,
            start: Some(GoogleCalendarEventTimeWire {
                date_time: Some("2026-09-02T02:00:00Z".to_string()),
                date: None,
            }),
            end: Some(GoogleCalendarEventTimeWire {
                date_time: Some("2026-09-02T01:00:00Z".to_string()),
                date: None,
            }),
        })
        .is_none());

        assert!(normalize_calendar_event(GoogleCalendarEventWire {
            id: Some("x".repeat(257)),
            status: None,
            summary: None,
            start: Some(GoogleCalendarEventTimeWire {
                date_time: None,
                date: Some("2026-09-02".to_string()),
            }),
            end: Some(GoogleCalendarEventTimeWire {
                date_time: None,
                date: Some("2026-09-03".to_string()),
            }),
        })
        .is_none());
    }
}

fn with_calendar_credential_io<T>(
    allow: bool,
    operation: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    #[cfg(target_os = "macos")]
    return crate::credential_namespace::with_keychain_interaction(allow, operation);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = allow;
        operation()
    }
}
