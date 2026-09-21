use serde::{Deserialize, Serialize};
use std::{
    env,
    fs::{self, File},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use url::Url;

const PROTOCOL_VERSION: u8 = 1;
const MAX_MESSAGE_BYTES: usize = 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
enum IncomingMessage {
    ActiveTab {
        version: u8,
        sequence: u64,
        #[serde(rename = "observedAt")]
        observed_at: String,
        #[serde(rename = "browserFamily")]
        browser_family: BrowserFamily,
        tab: ActiveTab,
    },
    ActiveTabCleared {
        version: u8,
        sequence: u64,
        #[serde(rename = "observedAt")]
        observed_at: String,
        reason: String,
    },
    CommandResult {
        version: u8,
        #[serde(rename = "requestId")]
        request_id: String,
        ok: bool,
        error: Option<String>,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum BrowserFamily {
    Chromium,
    Firefox,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ActiveTab {
    id: u64,
    window_id: u64,
    url: String,
    domain: String,
    title: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredSnapshot<'a> {
    version: u8,
    sequence: u64,
    observed_at: &'a str,
    received_at_epoch_ms: u128,
    browser_family: BrowserFamily,
    tab: &'a ActiveTab,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "kebab-case")]
struct Ack {
    version: u8,
    r#type: &'static str,
    sequence: u64,
    ok: bool,
    error: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PendingCommand {
    version: u8,
    r#type: String,
    request_id: String,
    tab_id: u64,
    expected_url: String,
    issued_at_epoch_ms: u128,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredCommandResult<'a> {
    version: u8,
    request_id: &'a str,
    ok: bool,
    error: Option<&'a str>,
    received_at_epoch_ms: u128,
}

struct BridgePaths {
    snapshot: PathBuf,
    pending_command: PathBuf,
    command_result: PathBuf,
}

fn bridge_paths() -> io::Result<BridgePaths> {
    let directory = if let Some(value) = env::var_os("DRIFTY_BROWSER_BRIDGE_DIR") {
        PathBuf::from(value)
    } else {
        let root = env::var_os("LOCALAPPDATA").ok_or_else(|| {
            io::Error::new(io::ErrorKind::NotFound, "LOCALAPPDATA is not available")
        })?;
        PathBuf::from(root)
            .join("so.drifty.windows")
            .join("browser-bridge")
    };
    Ok(BridgePaths {
        snapshot: directory.join("active-tab.json"),
        pending_command: directory.join("pending-command.json"),
        command_result: directory.join("command-result.json"),
    })
}

fn validate_tab(tab: &ActiveTab) -> Result<(), String> {
    if tab.title.len() > 512 || tab.domain.is_empty() || tab.domain.len() > 253 {
        return Err("invalid tab metadata bounds".into());
    }
    let url = Url::parse(&tab.url).map_err(|_| "invalid tab URL")?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("unsupported tab URL scheme".into());
    }
    let hostname = url.host_str().ok_or("tab URL has no host")?;
    if hostname
        .trim_start_matches("www.")
        .eq_ignore_ascii_case(&tab.domain)
    {
        Ok(())
    } else {
        Err("tab domain does not match URL".into())
    }
}

fn write_json_atomic(path: &Path, value: &impl Serialize) -> io::Result<()> {
    let parent = path.parent().ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidInput, "snapshot path has no parent")
    })?;
    fs::create_dir_all(parent)?;
    let temporary = parent.join(format!(".active-tab-{}.tmp", std::process::id()));
    let mut file = File::create(&temporary)?;
    serde_json::to_writer(&mut file, value)?;
    file.write_all(b"\n")?;
    file.sync_all()?;

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        };
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
            let error = io::Error::last_os_error();
            let _ = fs::remove_file(&temporary);
            return Err(error);
        }
    }
    #[cfg(not(target_os = "windows"))]
    fs::rename(&temporary, path)?;
    Ok(())
}

fn clear_snapshot(path: &Path) -> io::Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

fn current_epoch_ms() -> Result<u128, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .map_err(|error| error.to_string())
}

fn read_pending_command(path: &Path) -> io::Result<Option<PendingCommand>> {
    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    if metadata.len() == 0 || metadata.len() > 4 * 1024 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "pending command size is outside the allowed range",
        ));
    }
    let command: PendingCommand = serde_json::from_reader(File::open(path)?)?;
    let now = current_epoch_ms().map_err(io::Error::other)?;
    let valid = command.version == PROTOCOL_VERSION
        && matches!(command.r#type.as_str(), "activate-tab" | "close-tab")
        && !command.request_id.is_empty()
        && command.request_id.len() <= 128
        && command.tab_id <= i64::MAX as u64
        && validate_tab(&ActiveTab {
            id: command.tab_id,
            window_id: 0,
            domain: Url::parse(&command.expected_url)
                .ok()
                .and_then(|url| url.host_str().map(str::to_owned))
                .unwrap_or_default()
                .trim_start_matches("www.")
                .to_string(),
            url: command.expected_url.clone(),
            title: String::new(),
        })
        .is_ok()
        && command.issued_at_epoch_ms <= now.saturating_add(2_000)
        && now.saturating_sub(command.issued_at_epoch_ms) <= 10_000;
    if !valid {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "pending command failed validation",
        ));
    }
    Ok(Some(command))
}

fn handle_message(paths: &BridgePaths, raw: &[u8], last_sequence: &mut u64) -> Ack {
    let parsed = serde_json::from_slice::<IncomingMessage>(raw);
    let sequence = match &parsed {
        Ok(IncomingMessage::ActiveTab { sequence, .. })
        | Ok(IncomingMessage::ActiveTabCleared { sequence, .. }) => *sequence,
        Ok(IncomingMessage::CommandResult { .. }) => 0,
        Err(_) => 0,
    };
    let result = match parsed {
        Ok(IncomingMessage::ActiveTab {
            version,
            sequence,
            observed_at,
            browser_family,
            tab,
        }) => {
            if version != PROTOCOL_VERSION {
                Err("unsupported protocol version".into())
            } else if sequence <= *last_sequence {
                Err("stale sequence".into())
            } else if observed_at.len() > 64 {
                Err("invalid observation timestamp".into())
            } else {
                validate_tab(&tab).and_then(|()| {
                    let received_at_epoch_ms = current_epoch_ms()?;
                    write_json_atomic(
                        &paths.snapshot,
                        &StoredSnapshot {
                            version,
                            sequence,
                            observed_at: &observed_at,
                            received_at_epoch_ms,
                            browser_family,
                            tab: &tab,
                        },
                    )
                    .map_err(|error| error.to_string())
                })
            }
        }
        Ok(IncomingMessage::ActiveTabCleared {
            version,
            sequence,
            observed_at,
            reason,
        }) => {
            if version != PROTOCOL_VERSION {
                Err("unsupported protocol version".into())
            } else if sequence <= *last_sequence {
                Err("stale sequence".into())
            } else if observed_at.len() > 64 || reason.len() > 64 {
                Err("invalid clear metadata bounds".into())
            } else {
                clear_snapshot(&paths.snapshot).map_err(|error| error.to_string())
            }
        }
        Ok(IncomingMessage::CommandResult {
            version,
            request_id,
            ok,
            error,
        }) => {
            if version != PROTOCOL_VERSION
                || request_id.is_empty()
                || request_id.len() > 128
                || error.as_ref().is_some_and(|value| value.len() > 128)
            {
                Err("invalid command result".into())
            } else {
                (|| -> Result<(), String> {
                    let pending = read_pending_command(&paths.pending_command)
                        .map_err(|read_error| read_error.to_string())?
                        .ok_or_else(|| "command result has no pending request".to_string())?;
                    if pending.request_id != request_id {
                        return Err("command result request does not match".into());
                    }
                    let received_at_epoch_ms = current_epoch_ms()?;
                    write_json_atomic(
                        &paths.command_result,
                        &StoredCommandResult {
                            version,
                            request_id: &request_id,
                            ok,
                            error: error.as_deref(),
                            received_at_epoch_ms,
                        },
                    )
                    .and_then(|()| {
                        fs::remove_file(&paths.pending_command).or_else(|remove_error| {
                            if remove_error.kind() == io::ErrorKind::NotFound {
                                Ok(())
                            } else {
                                Err(remove_error)
                            }
                        })
                    })
                    .map_err(|write_error| write_error.to_string())
                })()
            }
        }
        Err(error) => Err(format!("invalid message: {error}")),
    };

    if result.is_ok() && sequence > 0 {
        *last_sequence = sequence;
    }
    Ack {
        version: PROTOCOL_VERSION,
        r#type: "ack",
        sequence,
        ok: result.is_ok(),
        error: result.err(),
    }
}

fn read_frame(input: &mut impl Read) -> io::Result<Option<Vec<u8>>> {
    let mut size_bytes = [0_u8; 4];
    match input.read_exact(&mut size_bytes) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(error) => return Err(error),
    }
    let size = u32::from_le_bytes(size_bytes) as usize;
    if size == 0 || size > MAX_MESSAGE_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "native message size is outside the allowed range",
        ));
    }
    let mut payload = vec![0_u8; size];
    input.read_exact(&mut payload)?;
    Ok(Some(payload))
}

fn write_frame(output: &mut impl Write, value: &impl Serialize) -> io::Result<()> {
    let payload = serde_json::to_vec(value)?;
    let size = u32::try_from(payload.len())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "response is too large"))?;
    output.write_all(&size.to_le_bytes())?;
    output.write_all(&payload)?;
    output.flush()
}

fn run() -> io::Result<()> {
    let paths = bridge_paths()?;
    let mut input = io::stdin().lock();
    let mut output = io::stdout().lock();
    let mut last_sequence = 0;
    let mut last_dispatched_request_id: Option<String> = None;
    while let Some(payload) = read_frame(&mut input)? {
        let ack = handle_message(&paths, &payload, &mut last_sequence);
        write_frame(&mut output, &ack)?;
        match read_pending_command(&paths.pending_command) {
            Ok(Some(command))
                if last_dispatched_request_id.as_deref() != Some(&command.request_id) =>
            {
                write_frame(&mut output, &command)?;
                last_dispatched_request_id = Some(command.request_id);
            }
            Ok(_) => {}
            Err(error) => eprintln!("Ignoring invalid pending browser command: {error}"),
        }
    }
    clear_snapshot(&paths.snapshot)
}

fn main() {
    if let Err(error) = run() {
        eprintln!("Drifty Browser Bridge host failed: {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_paths(directory: &Path) -> BridgePaths {
        BridgePaths {
            snapshot: directory.join("active-tab.json"),
            pending_command: directory.join("pending-command.json"),
            command_result: directory.join("command-result.json"),
        }
    }

    fn active_message(sequence: u64, url: &str, domain: &str) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({
            "version": 1,
            "type": "active-tab",
            "sequence": sequence,
            "observedAt": "2026-09-04T10:00:00.000Z",
            "browserFamily": "firefox",
            "tab": {
                "id": 17,
                "windowId": 3,
                "url": url,
                "domain": domain,
                "title": "Example"
            }
        }))
        .expect("serialize")
    }

    #[test]
    fn stores_a_valid_tab_and_rejects_replay() {
        let directory = tempfile::tempdir().expect("temp dir");
        let paths = test_paths(directory.path());
        let mut sequence = 0;
        let accepted = handle_message(
            &paths,
            &active_message(2, "https://www.example.com/docs", "example.com"),
            &mut sequence,
        );
        assert!(accepted.ok);
        assert_eq!(sequence, 2);
        assert!(paths.snapshot.exists());

        let replay = handle_message(
            &paths,
            &active_message(2, "https://example.com/changed", "example.com"),
            &mut sequence,
        );
        assert!(!replay.ok);
        assert_eq!(sequence, 2);
    }

    #[test]
    fn rejects_a_domain_that_does_not_match_the_url() {
        let directory = tempfile::tempdir().expect("temp dir");
        let paths = test_paths(directory.path());
        let mut sequence = 0;
        let ack = handle_message(
            &paths,
            &active_message(1, "https://example.com/", "attacker.test"),
            &mut sequence,
        );
        assert!(!ack.ok);
        assert!(!paths.snapshot.exists());
    }

    #[test]
    fn stores_a_command_result_and_removes_the_matching_pending_command() {
        let directory = tempfile::tempdir().expect("temp dir");
        let paths = test_paths(directory.path());
        fs::write(
            &paths.pending_command,
            serde_json::to_vec(&serde_json::json!({
                "version": 1,
                "type": "close-tab",
                "requestId": "request-1",
                "tabId": 17,
                "expectedUrl": "https://example.com/",
                "issuedAtEpochMs": current_epoch_ms().expect("clock")
            }))
            .expect("serialize pending command"),
        )
        .expect("pending command");
        let mut sequence = 9;
        let ack = handle_message(
            &paths,
            &serde_json::to_vec(&serde_json::json!({
                "version": 1,
                "type": "command-result",
                "requestId": "request-1",
                "ok": true
            }))
            .expect("serialize"),
            &mut sequence,
        );
        assert!(ack.ok);
        assert_eq!(sequence, 9);
        assert!(!paths.pending_command.exists());
        let result: serde_json::Value = serde_json::from_slice(
            &fs::read(&paths.command_result).expect("stored command result"),
        )
        .expect("parse stored command result");
        assert_eq!(result["requestId"], "request-1");
        assert_eq!(result["ok"], true);
    }

    #[test]
    fn native_frames_are_little_endian_length_prefixed_json() {
        let ack = Ack {
            version: 1,
            r#type: "ack",
            sequence: 8,
            ok: true,
            error: None,
        };
        let mut encoded = Vec::new();
        write_frame(&mut encoded, &ack).expect("encode");
        let expected_size = u32::from_le_bytes(encoded[..4].try_into().expect("prefix"));
        assert_eq!(expected_size as usize, encoded.len() - 4);
        let mut cursor = io::Cursor::new(encoded);
        assert!(read_frame(&mut cursor).expect("read").is_some());
    }
}
