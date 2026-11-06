//! A turn-scoped, read-only local bridge. The agent never receives the engine's keys.
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

#[cfg(all(test, unix))]
mod tests {
    use super::read_request;
    use serde_json::json;

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
