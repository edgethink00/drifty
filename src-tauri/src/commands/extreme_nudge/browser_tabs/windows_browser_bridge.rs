use std::{
    env,
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use url::Url;

use super::super::ExtremeNudgeError;

const PROTOCOL_VERSION: u8 = 1;
const SNAPSHOT_MAX_AGE_MS: u128 = 5_000;
const COMMAND_TIMEOUT: Duration = Duration::from_secs(7);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BridgeSnapshot {
    version: u8,
    received_at_epoch_ms: u128,
    browser_family: String,
    tab: BridgeTab,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BridgeTab {
    id: u64,
    url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PendingCommand<'a> {
    version: u8,
    r#type: &'static str,
    request_id: &'a str,
    tab_id: u64,
    expected_url: &'a str,
    issued_at_epoch_ms: u128,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommandResult {
    version: u8,
    request_id: String,
    ok: bool,
    error: Option<String>,
    received_at_epoch_ms: u128,
}

struct CommandLock(PathBuf);

impl Drop for CommandLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

pub(super) fn is_supported_browser(browser_name: &str) -> bool {
    matches!(browser_name.trim(), "Firefox" | "Firefox Developer Edition")
}

/// Everything a close command needs that can be checked before issuing it.
struct PreparedClose {
    directory: PathBuf,
    expected_url: String,
    snapshot: BridgeSnapshot,
}

fn prepare_close(
    browser_name: &str,
    browser_identity: Option<&str>,
    site_url: Option<&str>,
) -> Result<PreparedClose, ExtremeNudgeError> {
    let directory = bridge_directory().map_err(browser_bridge_error)?;
    prepare_close_in(&directory, browser_name, browser_identity, site_url)
}

fn prepare_close_in(
    directory: &Path,
    browser_name: &str,
    browser_identity: Option<&str>,
    site_url: Option<&str>,
) -> Result<PreparedClose, ExtremeNudgeError> {
    validate_browser_identity(browser_name, browser_identity)?;
    let expected_url = normalized_http_url(site_url.unwrap_or("")).ok_or_else(|| {
        ExtremeNudgeError::BrowserTabNotFound {
            diagnostic: "windows_browser_bridge_exact_url_required".to_string(),
        }
    })?;
    let snapshot = read_snapshot(&directory.join("active-tab.json"), &expected_url)
        .map_err(browser_bridge_error)?;
    Ok(PreparedClose {
        directory: directory.to_path_buf(),
        expected_url,
        snapshot,
    })
}

/// The bridge accepts a close only for the tab its extension reported within
/// the last few seconds. When the extension is not installed or not running,
/// no snapshot exists and every close fails; Pet Mode checks this first so
/// the cat does not act out a close that cannot happen.
pub(super) fn preflight_close(
    browser_name: &str,
    browser_identity: Option<&str>,
    site_url: Option<&str>,
) -> Result<(), ExtremeNudgeError> {
    prepare_close(browser_name, browser_identity, site_url).map(|_| ())
}

pub(super) fn close_browser_tab(
    browser_name: &str,
    browser_identity: Option<&str>,
    site_url: Option<&str>,
) -> Result<String, ExtremeNudgeError> {
    let PreparedClose {
        directory,
        expected_url,
        snapshot,
    } = prepare_close(browser_name, browser_identity, site_url)?;
    let lock_path = directory.join("pending-command.lock");
    fs::create_dir_all(&directory).map_err(|_| browser_bridge_error("directory_unavailable"))?;
    let _lock = acquire_command_lock(&lock_path).map_err(browser_bridge_error)?;

    let request_id = uuid::Uuid::new_v4().to_string();
    let pending_path = directory.join("pending-command.json");
    let result_path = directory.join("command-result.json");
    remove_if_present(&result_path).map_err(browser_bridge_error)?;
    write_json_atomic(
        &pending_path,
        &PendingCommand {
            version: PROTOCOL_VERSION,
            r#type: "close-tab",
            request_id: &request_id,
            tab_id: snapshot.tab.id,
            expected_url: &expected_url,
            issued_at_epoch_ms: current_epoch_ms().map_err(browser_bridge_error)?,
        },
    )
    .map_err(browser_bridge_error)?;

    let deadline = Instant::now() + COMMAND_TIMEOUT;
    let outcome = loop {
        if Instant::now() >= deadline {
            break Err(browser_bridge_error("command_timeout"));
        }
        match read_command_result(&result_path, &request_id) {
            Ok(Some(result)) if result.ok => {
                break Ok("windows_browser_bridge_exact_tab_id".to_string())
            }
            Ok(Some(result)) => {
                let diagnostic = result
                    .error
                    .filter(|value| !value.trim().is_empty() && value.len() <= 64)
                    .unwrap_or_else(|| "command_rejected".to_string());
                break Err(browser_bridge_error(&diagnostic));
            }
            Ok(None) => thread::sleep(Duration::from_millis(50)),
            Err(diagnostic) => break Err(browser_bridge_error(&diagnostic)),
        }
    };
    remove_owned_request(&pending_path, &request_id);
    remove_owned_request(&result_path, &request_id);
    outcome
}

fn browser_bridge_error(diagnostic: &str) -> ExtremeNudgeError {
    ExtremeNudgeError::BrowserTabNotFound {
        diagnostic: format!("windows_browser_bridge_{diagnostic}"),
    }
}

fn bridge_directory() -> Result<PathBuf, &'static str> {
    if let Some(value) = env::var_os("DRIFTY_BROWSER_BRIDGE_DIR") {
        return Ok(PathBuf::from(value));
    }
    let root = env::var_os("LOCALAPPDATA").ok_or("local_app_data_unavailable")?;
    Ok(PathBuf::from(root)
        .join("so.drifty.windows")
        .join("browser-bridge"))
}

fn validate_browser_identity(
    browser_name: &str,
    browser_identity: Option<&str>,
) -> Result<(), ExtremeNudgeError> {
    if !is_supported_browser(browser_name) {
        return Err(browser_bridge_error("unsupported_browser"));
    }
    let identity = browser_identity
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or(ExtremeNudgeError::MissingBrowserIdentity)?;
    let path = Path::new(identity);
    let is_firefox = path
        .file_name()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("firefox.exe"));
    if !path.is_absolute() || !is_firefox {
        return Err(browser_bridge_error("invalid_browser_identity"));
    }
    Ok(())
}

fn normalized_http_url(value: &str) -> Option<String> {
    let parsed = Url::parse(value).ok()?;
    matches!(parsed.scheme(), "http" | "https").then(|| parsed.to_string())
}

fn current_epoch_ms() -> Result<u128, &'static str> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .map_err(|_| "clock_unavailable")
}

fn read_snapshot(path: &Path, expected_url: &str) -> Result<BridgeSnapshot, &'static str> {
    let bytes = fs::read(path).map_err(|_| "snapshot_unavailable")?;
    if bytes.is_empty() || bytes.len() > 32 * 1024 {
        return Err("snapshot_invalid");
    }
    let snapshot: BridgeSnapshot =
        serde_json::from_slice(&bytes).map_err(|_| "snapshot_invalid")?;
    let now = current_epoch_ms()?;
    if snapshot.version != PROTOCOL_VERSION
        || snapshot.browser_family != "firefox"
        || snapshot.tab.id > i64::MAX as u64
        || normalized_http_url(&snapshot.tab.url).as_deref() != Some(expected_url)
        || snapshot.received_at_epoch_ms > now.saturating_add(2_000)
        || now.saturating_sub(snapshot.received_at_epoch_ms) > SNAPSHOT_MAX_AGE_MS
    {
        return Err("snapshot_mismatch");
    }
    Ok(snapshot)
}

fn acquire_command_lock(path: &Path) -> Result<CommandLock, &'static str> {
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|_| "command_busy")?;
    Ok(CommandLock(path.to_path_buf()))
}

fn write_json_atomic(path: &Path, value: &impl Serialize) -> Result<(), &'static str> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let parent = path.parent().ok_or("command_path_invalid")?;
    fs::create_dir_all(parent).map_err(|_| "command_write_failed")?;
    let temporary = parent.join(format!(".pending-command-{}.tmp", std::process::id()));
    let mut file = File::create(&temporary).map_err(|_| "command_write_failed")?;
    serde_json::to_writer(&mut file, value).map_err(|_| "command_write_failed")?;
    file.write_all(b"\n")
        .and_then(|()| file.sync_all())
        .map_err(|_| "command_write_failed")?;
    let source: Vec<u16> = temporary
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let destination: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    if unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    } == 0
    {
        let _ = fs::remove_file(&temporary);
        return Err("command_write_failed");
    }
    Ok(())
}

fn read_command_result(
    path: &Path,
    request_id: &str,
) -> Result<Option<CommandResult>, &'static str> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("result_read_failed"),
    };
    if bytes.is_empty() || bytes.len() > 4 * 1024 {
        return Err("result_invalid");
    }
    let result: CommandResult = serde_json::from_slice(&bytes).map_err(|_| "result_invalid")?;
    let now = current_epoch_ms()?;
    if result.version != PROTOCOL_VERSION
        || result.request_id != request_id
        || result.received_at_epoch_ms > now.saturating_add(2_000)
        || now.saturating_sub(result.received_at_epoch_ms) > 10_000
    {
        return Err("result_mismatch");
    }
    Ok(Some(result))
}

fn remove_if_present(path: &Path) -> Result<(), &'static str> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("cleanup_failed"),
    }
}

fn remove_owned_request(path: &Path, request_id: &str) {
    let is_owned = fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .and_then(|value| {
            value
                .get("requestId")
                .and_then(|id| id.as_str())
                .map(str::to_owned)
        })
        .as_deref()
        == Some(request_id);
    if is_owned {
        let _ = fs::remove_file(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_explicit_firefox_products_use_the_bridge() {
        assert!(is_supported_browser("Firefox"));
        assert!(is_supported_browser("Firefox Developer Edition"));
        assert!(!is_supported_browser("Google Chrome"));
        assert!(!is_supported_browser("Floorp"));
    }

    #[test]
    fn exact_url_normalization_rejects_non_web_schemes() {
        assert_eq!(
            normalized_http_url("https://EXAMPLE.com"),
            Some("https://example.com/".to_string())
        );
        assert_eq!(normalized_http_url("about:privatebrowsing"), None);
    }

    #[test]
    fn fresh_snapshot_requires_firefox_and_the_exact_url() {
        let directory = tempfile::tempdir().expect("temp dir");
        let path = directory.path().join("active-tab.json");
        let snapshot = serde_json::json!({
            "version": 1,
            "receivedAtEpochMs": current_epoch_ms().expect("clock"),
            "browserFamily": "firefox",
            "tab": {
                "id": 17,
                "url": "https://example.com/expected"
            }
        });
        fs::write(&path, serde_json::to_vec(&snapshot).expect("serialize")).expect("snapshot");
        assert!(read_snapshot(&path, "https://example.com/expected").is_ok());
        assert!(read_snapshot(&path, "https://example.com/other").is_err());
    }

    const FIREFOX_IDENTITY: &str = r"C:\Program Files\Mozilla Firefox\firefox.exe";

    #[test]
    fn preflight_rejects_a_missing_bridge_before_any_command_is_written() {
        let directory = tempfile::tempdir().expect("temp dir");
        let result = prepare_close_in(
            directory.path(),
            "Firefox",
            Some(FIREFOX_IDENTITY),
            Some("https://www.youtube.com/watch?v=drift"),
        );
        assert!(matches!(
            result,
            Err(ExtremeNudgeError::BrowserTabNotFound { ref diagnostic })
                if diagnostic == "windows_browser_bridge_snapshot_unavailable"
        ));
        assert!(!directory.path().join("pending-command.json").exists());
    }

    #[test]
    fn preflight_accepts_only_a_fresh_snapshot_of_the_exact_page() {
        let directory = tempfile::tempdir().expect("temp dir");
        let snapshot = serde_json::json!({
            "version": 1,
            "receivedAtEpochMs": current_epoch_ms().expect("clock"),
            "browserFamily": "firefox",
            "tab": { "id": 17, "url": "https://www.youtube.com/watch?v=drift" }
        });
        fs::write(
            directory.path().join("active-tab.json"),
            serde_json::to_vec(&snapshot).expect("serialize"),
        )
        .expect("snapshot");
        let prepared = prepare_close_in(
            directory.path(),
            "Firefox",
            Some(FIREFOX_IDENTITY),
            Some("https://www.youtube.com/watch?v=drift"),
        )
        .expect("fresh exact snapshot");
        assert_eq!(prepared.snapshot.tab.id, 17);
        assert!(matches!(
            prepare_close_in(
                directory.path(),
                "Firefox",
                Some(FIREFOX_IDENTITY),
                Some("https://www.youtube.com/watch?v=other"),
            ),
            Err(ExtremeNudgeError::BrowserTabNotFound { ref diagnostic })
                if diagnostic == "windows_browser_bridge_snapshot_mismatch"
        ));
    }
}
