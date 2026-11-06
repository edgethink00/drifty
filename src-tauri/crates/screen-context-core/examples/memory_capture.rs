//! Explicit personal dogfood adapter. Not registered as product IPC or bundled.
//! Uses the same native admission, encrypted evidence and deletion as the app.
//! Private stdio is owned by dogfood.py; never start with a terminal as stdout.
use drifty_screen_context_core::{
    key_store::NativeProfileKeys, native::PreparedNativeHelperBackend, store::EvidenceStore, *,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::BTreeSet,
    io::{self, BufRead, Read, Write},
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant},
};
use uuid::Uuid;

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
enum Request {
    Configure {
        enabled: bool,
        apps: Vec<String>,
        retention_hours: i64,
    },
    Sample,
    Snapshot {
        #[serde(default)]
        preferred: Option<Uuid>,
    },
    Forget {
        ids: Vec<Uuid>,
    },
    Purge,
    Stop,
}

fn configure(
    service: &ScreenContextService,
    enabled: bool,
    apps: Vec<String>,
) -> Result<(), Error> {
    if apps.is_empty()
        || apps.len() > 11
        || apps.iter().any(|a| {
            !matches!(
                a.as_str(),
                "com.apple.TextEdit"
                    | "com.apple.Preview"
                    | "com.microsoft.VSCode"
                    | "com.todesktop.230313mzl4w4u92"
                    | "com.tinyspeck.slackmacgap"
                    | "com.hnc.Discord"
                    | "com.openai.codex"
                    | "com.cmuxterm.app"
                    | "com.microsoft.Powerpoint"
                    | "at.studio.AsideBrowser"
                    | "com.google.Chrome"
            )
        })
    {
        return Err(Error::Invalid("memory app allowlist"));
    }
    service.set_policy(CapturePolicy {
        enabled,
        replay_enabled: false,
        visible_text_enabled: true,
        ocr_enabled: true,
        allowed_apps: apps.into_iter().collect::<BTreeSet<_>>(),
        ..CapturePolicy::default()
    })?;
    if enabled {
        service.resume_capture()?;
    }
    Ok(())
}

fn trim_catalog(service: &ScreenContextService, apps: &[String], hours: i64) -> Result<(), Error> {
    if !(1..=24).contains(&hours) {
        return Err(Error::Invalid("memory retention"));
    }
    let now = unix_millis()?;
    let mut remove = Vec::new();
    let mut cursor = None;
    loop {
        let page = service.list_page(cursor, 100)?;
        for row in page.records {
            if let Some(m) = service.read_metadata(row.id)? {
                let chosen = drifty_screen_context_core::memory_document(&m).is_some_and(|s| apps.contains(&s.app_id));
                if !chosen || m.observed_at_ms + hours * 3600000 <= now {
                    remove.push(row.id);
                }
            }
        }
        cursor = page.next_cursor;
        if cursor.is_none() {
            break;
        }
    }
    // The existing encrypted-store time/byte/record bounds still apply. The
    // memory input limit selects representative text; it does not delete raw
    // observations merely because repeated captures fill 500 slots.
    for id in remove {
        service.delete_record(id)?;
    }
    Ok(())
}

fn observation(m: &store::EvidenceMetadata, hours: i64) -> Value {
    // This dogfood example captures chosen apps only, so every row is a document.
    let (app, document) = drifty_screen_context_core::memory_document(m)
        .map_or(("", ""), |s| (s.app_id.as_str(), s.document_id.as_str()));
    json!({"source_id":m.id.to_string(), "app":app,
        "document":document, "source_type":m.text.source(),
        "text":m.text.as_str(), "observed_at_ms":m.observed_at_ms,
        "expires_at_ms":m.expires_at_ms.min(m.observed_at_ms + hours * 3600000)})
}

fn snapshot(service: &ScreenContextService, apps: &[String], hours: i64, preferred: Option<Uuid>) -> Result<Value, Error> {
    trim_catalog(service, apps, hours)?;
    let lease = service.observation_lease();
    let mut cursor = None;
    let mut pages = Vec::new();
    let mut selection = MemorySourceSelection::new(apps.iter().cloned().collect(), hours as u32)?;
    if let Some(id) = preferred {
        pages.push(service.read_memory_selection_source(id, &mut selection)?
            .try_map(|item| Ok(item.iter().map(|v| observation(&v.metadata, hours)).collect::<Vec<_>>()))?);
    }
    loop {
        let page = service.read_memory_selection_page(cursor.take(), &mut selection)?
            .try_map(|page| {
                cursor = page.next_cursor;
                Ok(page.records.iter().map(|m| observation(m, hours)).collect::<Vec<_>>())
            })?;
        pages.push(page);
        if cursor.is_none() || selection.is_full() {
            break;
        }
    }
    let checked = serde_json::to_value(lease.reply(pages)?).map_err(|_| Error::Invalidated)?;
    let pages: Vec<Vec<Value>> = serde_json::from_value(checked).map_err(|_| Error::Invalidated)?;
    Ok(json!({"ok":true, "observations":pages.into_iter().flatten().collect::<Vec<_>>()}))
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args_os().collect();
    if args.len() != 4 {
        return Err("expected fixed helper, private evidence root, scope".into());
    }
    // This is a native personal harness, not access to an existing app account.
    let helper = PathBuf::from(&args[1]);
    let root = PathBuf::from(&args[2]);
    let scope = args[3].to_str().ok_or("invalid scope")?;
    let backend = Arc::new(PreparedNativeHelperBackend::from_source_resource(&helper)?);
    let mut service = ScreenContextService::new(backend)?;
    let mut keys = NativeProfileKeys::new("so.drifty.memory-dogfood")?;
    let store = EvidenceStore::open_with_key_provider(
        &root,
        ScopeId::from_profile(scope)?,
        &mut keys,
        Retention {
            ttl: Duration::from_secs(86400),
            max_bytes: 64 * 1024 * 1024,
        },
        unix_millis()?,
    )?;
    service.replace_store(Some(store))?;
    configure(&service, false, vec!["com.apple.TextEdit".into()])?;
    let mut active_apps = vec!["com.apple.TextEdit".to_string()];
    let mut retention_hours = 24;
    let stdin = io::stdin();
    let mut input = stdin.lock();
    loop {
        let mut line = String::new();
        if (&mut input).take(16385).read_line(&mut line)? == 0 {
            break;
        }
        if line.len() > 16384 {
            return Err("request limit".into());
        }
        let request: Request = serde_json::from_str(&line)?;
        let stop = matches!(request, Request::Stop);
        let reply: Result<Value, Error> = match request {
            Request::Configure {
                enabled,
                apps,
                retention_hours: hours,
            } => {
                configure(&service, false, apps.clone())?;
                trim_catalog(&service, &apps, hours)?;
                configure(&service, enabled, apps.clone())?;
                active_apps = apps;
                retention_hours = hours;
                Ok(json!({"ok":true}))
            }
            Request::Snapshot { preferred } => snapshot(&service, &active_apps, retention_hours, preferred),
            Request::Sample => {
                let before = service.status();
                service.request_sample();
                let start = Instant::now();
                while service.status().running || service.status().pending {
                    if start.elapsed()
                        > PREPARATION_DEADLINE + OCR_CAPTURE_DEADLINE + Duration::from_secs(1)
                    {
                        service.invalidate_observations_now();
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(20));
                }
                let after = service.status();
                Ok(json!({"ok":true, "accepted":after.accepted-before.accepted,
                    "dropped":after.dropped-before.dropped,
                    "failure":after.last_failure.map(|x| format!("{x:?}"))}))
            }
            Request::Forget { ids } => {
                if ids.len() > 500 {
                    Err(Error::Invalid("memory deletion limit"))
                } else {
                    ids.into_iter()
                        .try_for_each(|id| service.delete_record(id).map(|_| ()))
                        .map(|_| json!({"ok":true}))
                }
            }
            Request::Purge => service.purge().map(|_| json!({"ok":true})),
            Request::Stop => {
                service.stop_now();
                Ok(json!({"ok":true}))
            }
        };
        let reply = reply.unwrap_or_else(
            |_| json!({"ok":false,"error":"native memory observation unavailable"}),
        );
        println!("{}", serde_json::to_string(&reply)?);
        io::stdout().flush()?;
        if stop {
            break;
        }
    }
    if !service.shutdown(Duration::from_millis(1100)) {
        return Err("capture worker did not stop".into());
    }
    Ok(())
}

fn main() {
    if run().is_err() {
        eprintln!("native memory adapter unavailable");
        std::process::exit(1);
    }
}
