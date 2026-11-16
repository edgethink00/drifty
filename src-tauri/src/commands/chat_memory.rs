//! Read-only local bridges to automatic memory. The agent never receives the engine's keys.
//!
//! Chat opens one per turn. The agent listener serves the `drifty memory` CLI that the
//! installed agent skill runs: one fixed socket while the app is open, and every request
//! re-checks the signed-in account and the memory switch, so turning memory off or
//! signing out stops it at the next call.
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use tauri::AppHandle;
use uuid::Uuid;

pub(crate) const TOOLS: [&str; 4] = ["memory_search", "memory_source", "memory_recent", "memory_wiki"];

// A query allows 1,600 Unicode characters, not bytes. Leave room for UTF-8,
// JSON escaping and the envelope while keeping untrusted socket reads bounded.
#[cfg(unix)]
const MAX_REQUEST_BYTES: u64 = 16 * 1024;

#[cfg(unix)]
fn read_request(reader: impl std::io::Read) -> Result<serde_json::Value, ()> {
    use std::io::{BufRead, BufReader, Read};
    let mut text = String::new();
    BufReader::new(reader)
        .take(MAX_REQUEST_BYTES + 1)
        .read_line(&mut text)
        .map_err(|_| ())?;
    if text.len() as u64 > MAX_REQUEST_BYTES || !text.ends_with('\n') {
        return Err(());
    }
    serde_json::from_str(&text).map_err(|_| ())
}

pub(crate) struct MemoryBridge {
    pub(crate) socket: PathBuf,
    stopped: Arc<AtomicBool>,
    #[cfg(not(drifty_screen_context_excluded))]
    app: AppHandle,
    #[cfg(not(drifty_screen_context_excluded))]
    session: Uuid,
}
impl MemoryBridge {
    pub(crate) fn current(&self) -> bool {
        #[cfg(drifty_screen_context_excluded)]
        {
            false
        }
        #[cfg(not(drifty_screen_context_excluded))]
        {
            use tauri::Manager;
            !self.stopped.load(Ordering::Acquire)
                && self
                    .app
                    .state::<super::ScreenContextAccount>()
                    .runtime
                    .memory_chat_current(self.session)
        }
    }
}
impl std::fmt::Debug for MemoryBridge {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("MemoryBridge([private])")
    }
}
impl Drop for MemoryBridge {
    fn drop(&mut self) {
        self.stopped.store(true, Ordering::Release);
        let _ = std::fs::remove_file(&self.socket);
    }
}

#[cfg(all(unix, not(drifty_screen_context_excluded)))]
pub(crate) fn open(app: &AppHandle, session: Uuid) -> Result<Arc<MemoryBridge>, String> {
    use std::{
        fs,
        io::Write,
        os::unix::{
            fs::{MetadataExt, PermissionsExt},
            net::UnixListener,
        },
        time::Duration,
    };
    use tauri::Manager;
    let unavailable = "memory_unavailable";
    if !app
        .state::<super::ScreenContextAccount>()
        .runtime
        .memory_chat_current(session)
    {
        return Err(unavailable.into());
    }
    let uid = unsafe { libc::geteuid() };
    let root = PathBuf::from(format!("/tmp/drifty-memory-chat-{uid}"));
    match fs::create_dir(&root) {
        Ok(()) => fs::set_permissions(&root, fs::Permissions::from_mode(0o700))
            .map_err(|_| unavailable)?,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(_) => return Err(unavailable.into()),
    }
    let metadata = fs::symlink_metadata(&root).map_err(|_| unavailable)?;
    if !metadata.is_dir() || metadata.uid() != uid || metadata.mode() & 0o077 != 0 {
        return Err(unavailable.into());
    }
    let socket = root.join(format!("{}.sock", Uuid::new_v4()));
    let listener = UnixListener::bind(&socket).map_err(|_| unavailable)?;
    fs::set_permissions(&socket, fs::Permissions::from_mode(0o600)).map_err(|_| unavailable)?;
    listener.set_nonblocking(true).map_err(|_| unavailable)?;
    let stopped = Arc::new(AtomicBool::new(false));
    let bridge = Arc::new(MemoryBridge {
        socket,
        stopped: Arc::clone(&stopped),
        app: app.clone(),
        session,
    });
    let app = app.clone();
    std::thread::spawn(move || {
        while !stopped.load(Ordering::Acquire) {
            let (mut stream, _) = match listener.accept() {
                Ok(value) => value,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(50));
                    continue;
                }
                Err(_) => break,
            };
            let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
            let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
            let result = (|| {
                let request = read_request(&mut stream)?;
                let name = request["name"]
                    .as_str()
                    .filter(|name| TOOLS.contains(name))
                    .ok_or(())?;
                let result = app
                    .state::<super::ScreenContextAccount>()
                    .runtime
                    .memory_chat_tool(&app, session, name, &request["arguments"])
                    .map_err(|_| ())?;
                if stopped.load(Ordering::Acquire)
                    || !app
                        .state::<super::ScreenContextAccount>()
                        .runtime
                        .memory_chat_current(session)
                {
                    return Err(());
                }
                Ok(result)
            })();
            let reply = match result {
                Ok(value) => serde_json::json!({"ok":true,"result":value}),
                Err(()) => {
                    serde_json::json!({"ok":false,"error":"Memory is off, expired or unavailable."})
                }
            };
            if let Ok(body) = serde_json::to_string(&reply) {
                let _ = writeln!(stream, "{body}");
            }
        }
    });
    Ok(bridge)
}

#[cfg(any(not(unix), drifty_screen_context_excluded))]
pub(crate) fn open(_: &AppHandle, _: Uuid) -> Result<Arc<MemoryBridge>, String> {
    Err("memory_unavailable".into())
}

/// Answer one agent request. `begin` admits a request only while memory is on for the
/// signed-in account; anything outside the four read-only tools is refused before it.
#[cfg_attr(any(not(unix), drifty_screen_context_excluded), allow(dead_code))]
fn agent_reply(
    request: Result<serde_json::Value, ()>,
    begin: impl FnOnce() -> Result<Option<Uuid>, String>,
    call: impl FnOnce(Uuid, &str, &serde_json::Value) -> Result<serde_json::Value, String>,
    end: impl FnOnce(Uuid),
) -> serde_json::Value {
    let refuse = |code: &str| serde_json::json!({"ok": false, "code": code});
    let Ok(request) = request else {
        return refuse("invalid_request");
    };
    let Some(name) = request["name"].as_str().filter(|name| TOOLS.contains(name)) else {
        return refuse("invalid_request");
    };
    let arguments = if request["arguments"].is_null() {
        serde_json::json!({})
    } else {
        request["arguments"].clone()
    };
    let id = match begin() {
        Ok(Some(id)) => id,
        Ok(None) => return refuse("memory_off"),
        Err(_) => return refuse("memory_unavailable"),
    };
    let result = call(id, name, &arguments);
    end(id);
    match result {
        Ok(value) => serde_json::json!({"ok": true, "result": value}),
        Err(_) => refuse("memory_unavailable"),
    }
}

#[cfg(all(unix, not(drifty_screen_context_excluded)))]
static AGENT_LISTENER: std::sync::Mutex<Option<(PathBuf, Arc<AtomicBool>)>> = std::sync::Mutex::new(None);

/// The fixed path the `drifty memory` CLI connects to; keep in sync with
/// services/tracker-python/app/cli/memory.py `agent_socket`.
#[cfg(unix)]
#[cfg_attr(drifty_screen_context_excluded, allow(dead_code))]
pub(crate) fn agent_socket_path() -> PathBuf {
    let uid = unsafe { libc::geteuid() };
    PathBuf::from(format!("/tmp/drifty-memory-agent-{uid}/agent.sock"))
}

/// Start serving the agent skill's memory commands. Cheap while memory is off: each
/// request is refused with `memory_off` until the person turns memory on.
#[cfg(all(unix, not(drifty_screen_context_excluded)))]
pub(crate) fn start_agent_listener(app: &AppHandle) {
    use std::{
        fs,
        io::Write,
        os::unix::{
            fs::{FileTypeExt, MetadataExt, PermissionsExt},
            net::{UnixListener, UnixStream},
        },
        time::Duration,
    };
    use tauri::Manager;
    let Ok(mut current) = AGENT_LISTENER.lock() else {
        return;
    };
    if current.is_some() {
        return;
    }
    let socket = agent_socket_path();
    let Some(root) = socket.parent().map(PathBuf::from) else {
        return;
    };
    let uid = unsafe { libc::geteuid() };
    match fs::create_dir(&root) {
        Ok(()) => {
            if fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).is_err() {
                return;
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(_) => return,
    }
    let Ok(metadata) = fs::symlink_metadata(&root) else {
        return;
    };
    if !metadata.is_dir() || metadata.uid() != uid || metadata.mode() & 0o077 != 0 {
        return;
    }
    if let Ok(existing) = fs::symlink_metadata(&socket) {
        // Another running Drifty (a second build) already serves it; a socket left
        // by a crash refuses connections and is replaced.
        if !existing.file_type().is_socket() || UnixStream::connect(&socket).is_ok() {
            return;
        }
        if fs::remove_file(&socket).is_err() {
            return;
        }
    }
    let Ok(listener) = UnixListener::bind(&socket) else {
        return;
    };
    if fs::set_permissions(&socket, fs::Permissions::from_mode(0o600)).is_err()
        || listener.set_nonblocking(true).is_err()
    {
        let _ = fs::remove_file(&socket);
        return;
    }
    let stopped = Arc::new(AtomicBool::new(false));
    *current = Some((socket, Arc::clone(&stopped)));
    drop(current);
    let app = app.clone();
    std::thread::spawn(move || {
        while !stopped.load(Ordering::Acquire) {
            let (mut stream, _) = match listener.accept() {
                Ok(value) => value,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(100));
                    continue;
                }
                Err(_) => break,
            };
            let _ = stream.set_nonblocking(false);
            let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
            let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
            let runtime = &app.state::<super::ScreenContextAccount>().runtime;
            let reply = agent_reply(
                read_request(&mut stream),
                || {
                    if stopped.load(Ordering::Acquire) {
                        return Ok(None);
                    }
                    runtime.begin_memory_chat(&app)
                },
                |id, name, arguments| runtime.memory_chat_tool(&app, id, name, arguments),
                |id| runtime.end_memory_chat(id),
            );
            if let Ok(body) = serde_json::to_string(&reply) {
                let _ = writeln!(stream, "{body}");
            }
        }
    });
}

#[cfg(any(not(unix), drifty_screen_context_excluded))]
pub(crate) fn start_agent_listener(_: &AppHandle) {}

/// Stop serving and remove the socket, so the CLI reports that Drifty is not open.
pub(crate) fn stop_agent_listener() {
    #[cfg(all(unix, not(drifty_screen_context_excluded)))]
    if let Some((socket, stopped)) = AGENT_LISTENER.lock().ok().and_then(|mut current| current.take()) {
        stopped.store(true, Ordering::Release);
        let _ = std::fs::remove_file(socket);
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::{agent_reply, read_request};
    use serde_json::json;
    use std::cell::Cell;
    use uuid::Uuid;

    #[test]
    fn agent_requests_need_memory_on_and_a_read_only_tool() {
        let id = Uuid::new_v4();
        // Off, paused or signed out: begin admits nothing and no tool runs.
        let called = Cell::new(false);
        let off = agent_reply(
            Ok(json!({"name":"memory_recent","arguments":{}})),
            || Ok(None),
            |_, _, _| {
                called.set(true);
                Ok(json!(null))
            },
            |_| {},
        );
        assert_eq!(off, json!({"ok":false,"code":"memory_off"}));
        assert!(!called.get());
        // Write or unknown operations are refused before memory is consulted.
        for name in ["sync", "wiki_pages", "memory_configure", "purge"] {
            let begun = Cell::new(false);
            let reply = agent_reply(
                Ok(json!({"name":name,"arguments":{}})),
                || {
                    begun.set(true);
                    Ok(Some(id))
                },
                |_, _, _| Ok(json!(null)),
                |_| {},
            );
            assert_eq!(reply, json!({"ok":false,"code":"invalid_request"}));
            assert!(!begun.get(), "{name} reached memory");
        }
        assert_eq!(
            agent_reply(Err(()), || Ok(Some(id)), |_, _, _| Ok(json!(1)), |_| {}),
            json!({"ok":false,"code":"invalid_request"})
        );
    }

    #[test]
    fn agent_request_ends_its_admission_even_when_the_account_changes() {
        let id = Uuid::new_v4();
        let ended = Cell::new(None);
        let reply = agent_reply(
            Ok(json!({"name":"memory_search","arguments":{"query":"Kestrel"}})),
            || Ok(Some(id)),
            |got, name, arguments| {
                assert_eq!((got, name), (id, "memory_search"));
                assert_eq!(arguments, &json!({"query":"Kestrel"}));
                Err("memory_changed".into())
            },
            |got| ended.set(Some(got)),
        );
        assert_eq!(reply, json!({"ok":false,"code":"memory_unavailable"}));
        assert_eq!(ended.get(), Some(id));
        let ok = agent_reply(
            Ok(json!({"name":"memory_recent"})),
            || Ok(Some(id)),
            |_, _, arguments| {
                assert_eq!(arguments, &json!({}));
                Ok(json!({"items":[]}))
            },
            |_| {},
        );
        assert_eq!(ok, json!({"ok":true,"result":{"items":[]}}));
    }

    #[test]
    fn accepts_full_length_unicode_and_escaped_queries() {
        for query in [
            "한".repeat(1600),
            "🧠".repeat(1600),
            "\u{0001}".repeat(1600),
        ] {
            let expected = json!({"name":"memory_search","arguments":{"query":query}});
            let wire = format!("{expected}\n");
            assert!(
                wire.len() > 4096,
                "regression: the former byte limit rejected this query"
            );
            assert_eq!(read_request(wire.as_bytes()).unwrap(), expected);
        }
    }

    #[test]
    fn rejects_oversized_truncated_and_invalid_requests() {
        let oversized = format!("{}\n", json!({"arguments":{"query":"a".repeat(16 * 1024)}}));
        assert!(read_request(oversized.as_bytes()).is_err());
        assert!(read_request(b"{\"name\":\"memory_search\"}".as_slice()).is_err());
        assert!(read_request(b"not json\n".as_slice()).is_err());
    }
}
