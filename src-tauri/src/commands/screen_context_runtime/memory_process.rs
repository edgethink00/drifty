//! One app-owned engine. Its stdin is private, and it never receives capture authority.
use serde_json::Value;
use std::{
    io::{BufRead, BufReader, Read, Write},
    path::PathBuf,
    process::{Child, ChildStdin, Command, Stdio},
    sync::{mpsc, Mutex, atomic::{AtomicBool, Ordering}},
    time::Duration,
};
use tauri::{AppHandle, Manager};
use zeroize::Zeroizing;
use uuid::Uuid;

const UNAVAILABLE: &str = "memory_unavailable";
const LIMIT: usize = 8 * 1024 * 1024;

// A hint only: every use rereads the exact native original with current proofs.
fn pending_source(response: &Value) -> Result<Option<Uuid>, String> {
    match response.get("pending_source_id") {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(id)) => Uuid::parse_str(id).map(Some).map_err(|_| UNAVAILABLE.into()),
        _ => Err(UNAVAILABLE.into()),
    }
}

pub(super) fn invocation(app: &AppHandle) -> Option<(PathBuf, Vec<PathBuf>)> {
    if !cfg!(target_os = "macos") {
        return None;
    }
    let installed = app
        .path()
        .resource_dir()
        .ok()?
        .join("memory-runtime/drifty-memory");
    if installed.is_file() {
        return Some((installed, Vec::new()));
    }
    if let Some(installed) = super::super::memory_runtime::program(app) {
        return Some((installed, Vec::new()));
    }
    if cfg!(debug_assertions) {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()?
            .to_path_buf();
        let python = root.join(".venv/bin/python");
        let worker = root.join("scripts/memory-pilot/app_worker.py");
        if python.is_file() && worker.is_file() {
            return Some((python, vec![worker]));
        }
    }
    None
}

pub(super) struct MemoryProcess {
    child: Mutex<Child>,
    input: Mutex<ChildStdin>,
    output: Mutex<mpsc::Receiver<Result<Value, ()>>>,
    request: Mutex<()>,
    pending_source: Mutex<Option<Uuid>>,
    needs_image: Mutex<bool>,
    visual_capable: AtomicBool,
    /// The credential the engine holds: the user's key or the Drifty Cloud session.
    credential: Mutex<Zeroizing<String>>,
}

impl MemoryProcess {
    pub(super) fn start(app: &AppHandle, initial: Value, credential: Zeroizing<String>) -> Result<Self, String> {
        let (program, args) = invocation(app).ok_or(UNAVAILABLE)?;
        if program.components().any(|c| c.as_os_str() == "memory-engines") {
            super::super::memory_runtime::verify_program(&program)?;
        }
        let mut command = Command::new(program);
        command
            .args(args)
            .env_clear()
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        for name in [
            "PATH", "HOME", "TMPDIR", "USER", "LOGNAME", "LANG", "LC_ALL",
        ] {
            if let Some(value) = std::env::var_os(name) {
                command.env(name, value);
            }
        }
        let mut child = command.spawn().map_err(|_| UNAVAILABLE)?;
        let input = child.stdin.take().ok_or(UNAVAILABLE)?;
        let output = child.stdout.take().ok_or(UNAVAILABLE)?;
        let (tx, rx) = mpsc::sync_channel(1);
        std::thread::spawn(move || {
            let mut reader = BufReader::new(output);
            loop {
                let mut line = String::new();
                let parsed = match (&mut reader).take((LIMIT + 1) as u64).read_line(&mut line) {
                    Ok(0) | Err(_) => break,
                    Ok(_) if line.len() > LIMIT || !line.ends_with('\n') => Err(()),
                    Ok(_) => serde_json::from_str(&line).map_err(|_| ()),
                };
                let stop = parsed.is_err();
                if tx.send(parsed).is_err() || stop {
                    break;
                }
            }
        });
        let process = Self {
            child: Mutex::new(child),
            input: Mutex::new(input),
            output: Mutex::new(rx),
            request: Mutex::new(()),
            pending_source: Mutex::new(None),
            needs_image: Mutex::new(false),
            visual_capable: AtomicBool::new(false),
            credential: Mutex::new(credential),
        };
        let ready = process.call(initial)?;
        process.visual_capable.store(ready["screenImages"].as_bool().unwrap_or(false), Ordering::Release);
        Ok(process)
    }

    /// Hands a refreshed Drifty Cloud session to the engine when it changed.
    pub(super) fn refresh_credential(&self, credential: &Zeroizing<String>) -> Result<(), String> {
        if *self.credential.lock().map_err(|_| UNAVAILABLE)? == *credential {
            return Ok(());
        }
        self.call(serde_json::json!({"op":"auth","credential":credential.as_str()}))?;
        *self.credential.lock().map_err(|_| UNAVAILABLE)? = credential.clone();
        Ok(())
    }

    pub(super) fn call(&self, value: Value) -> Result<Value, String> {
        let _request = self.request.lock().map_err(|_| UNAVAILABLE)?;
        let mut body = Zeroizing::new(serde_json::to_string(&value).map_err(|_| UNAVAILABLE)?);
        if body.len() > LIMIT - 1 {
            return Err(UNAVAILABLE.into());
        }
        body.push('\n');
        self.input
            .lock()
            .map_err(|_| UNAVAILABLE)?
            .write_all(body.as_bytes())
            .map_err(|_| UNAVAILABLE)?;
        let response = self
            .output
            .lock()
            .map_err(|_| UNAVAILABLE)?
            .recv_timeout(Duration::from_secs(45));
        match response {
            Ok(Ok(value)) if value["ok"] == true => {
                let pending = match pending_source(&value) {
                    Ok(pending) => pending,
                    Err(error) => { self.stop(); return Err(error); }
                };
                *self.pending_source.lock().map_err(|_| UNAVAILABLE)? = pending;
                let needs = match value.get("needs_source_image") {
                    None => false,
                    Some(Value::Bool(value)) => *value,
                    _ => { self.stop(); return Err(UNAVAILABLE.into()); }
                };
                if needs && pending.is_none() { self.stop(); return Err(UNAVAILABLE.into()); }
                *self.needs_image.lock().map_err(|_| UNAVAILABLE)? = needs;
                Ok(value["result"].clone())
            }
            _ => {
                self.stop();
                Err(UNAVAILABLE.into())
            }
        }
    }

    pub(super) fn pending_source(&self) -> Result<Option<Uuid>, String> {
        self.pending_source.lock().map(|source| *source).map_err(|_| UNAVAILABLE.into())
    }
    pub(super) fn supports_images(&self) -> bool {
        self.visual_capable.load(Ordering::Acquire)
    }
    pub(super) fn pending_image_source(&self) -> Result<Option<Uuid>, String> {
        if *self.needs_image.lock().map_err(|_| UNAVAILABLE)? { self.pending_source() } else { Ok(None) }
    }

    /// Does not wait for the request mutex: OFF/account revocation interrupts I/O.
    pub(super) fn stop(&self) {
        self.visual_capable.store(false, Ordering::Release);
        if let Ok(mut pending) = self.pending_source.lock() { *pending = None; }
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn pending_hint_is_one_uuid_never_a_source_payload_or_path() {
        let id = Uuid::new_v4();
        assert_eq!(pending_source(&json!({"pending_source_id":id})).unwrap(), Some(id));
        for value in [json!({}), json!({"pending_source_id":null})] {
            assert_eq!(pending_source(&value).unwrap(), None);
        }
        for value in [json!("/path"), json!([id]), json!({"source_id":id}), json!(1)] {
            assert!(pending_source(&json!({"pending_source_id":value})).is_err());
        }
    }
}
impl Drop for MemoryProcess {
    fn drop(&mut self) {
        self.stop();
    }
}
