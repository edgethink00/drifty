//! Account-bound automatic memory. Capture stays owned by ScreenContextRuntime.
use super::*;
use drifty_screen_context_core::CaptureScope;
use serde_json::{json, Value};
use std::path::Path;
use zeroize::Zeroizing;

#[path = "memory_process.rs"]
mod process;
#[path = "memory_redact.rs"]
mod redact;
#[path = "memory_reply.rs"]
mod reply;
/// The one credential filter for screen text that leaves this computer, shared
/// by memory and activity classification.
pub(super) fn redact_screen_text(text: &str) -> String {
    redact::redact_secrets(text)
}
const MEMORY_UNAVAILABLE: &str = "memory_unavailable";
/// Drifty Cloud's memory function: https://<20-character project>.supabase.co/functions/v1/memory-cloud.
fn valid_cloud_url(url: &str) -> bool {
    let Some((host, path)) = url.strip_prefix("https://").and_then(|rest| rest.split_once('/')) else {
        return false;
    };
    let Some(project) = host.strip_suffix(".supabase.co") else {
        return false;
    };
    path == "functions/v1/memory-cloud"
        && project.len() == 20
        && project.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
}

/// The signed-in session the app hands over while the account has a trial or
/// Pro. Memory's Haiku calls then go through Drifty Cloud and spend its
/// credits; without one they use the user's own Anthropic key. Never saved.
#[derive(Clone)]
pub(super) struct CloudSession {
    url: String,
    token: Zeroizing<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemoryCloudSession {
    url: String,
    access_token: String,
}

/// The only projection of evidence text for the worker, providers and Chat.
/// Only a chosen app's document is a memory source, never a general display scene.
fn memory_observation(m: &drifty_screen_context_core::store::EvidenceMetadata, hours: u32) -> Option<Value> {
    let surface = drifty_screen_context_core::memory_document(m)?;
    Some(json!({"source_id":m.id.to_string(),"app":surface.app_id,"document":surface.document_id,
        "source_type":m.text.source(),"text":redact::redact_secrets(m.text.as_str()),"observed_at_ms":m.observed_at_ms,
        "expires_at_ms":m.expires_at_ms.min(m.observed_at_ms + i64::from(hours) * 3_600_000)}))
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemoryPreferences {
    pub enabled: bool,
    pub retention_hours: u32,
    /// Lowercase site names (as the tracker records them) where a selected
    /// browser may be captured. Empty refuses every browser window.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub work_sites: Vec<String>,
    /// Supported app ids whose visible text memory reads. While memory is on,
    /// screen recording keeps to these apps instead of the general display
    /// scene. Empty means every supported app (owner decision 2026-11-12:
    /// memory asks for no app choice; exclusions still apply).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub apps: Vec<String>,
}
impl Default for MemoryPreferences {
    fn default() -> Self {
        Self {
            enabled: false,
            retention_hours: 24,
            work_sites: Vec::new(),
            apps: Vec::new(),
        }
    }
}
const MAX_WORK_SITES: usize = 32;
fn valid_site(site: &str) -> bool {
    (1..=253).contains(&site.len())
        && site
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'.' || b == b'-')
        && !site.starts_with('.')
        && !site.ends_with('.')
}
fn valid_preferences(value: &MemoryPreferences) -> bool {
    let supported = supported_apps();
    (1..=24).contains(&value.retention_hours)
        && value.apps.len() <= supported.len()
        && value.apps.iter().all(|id| supported.iter().any(|a| a.id == id))
        && value.apps.iter().collect::<std::collections::BTreeSet<_>>().len() == value.apps.len()
        && value.work_sites.len() <= MAX_WORK_SITES
        && value.work_sites.iter().all(|s| valid_site(s))
        && value.work_sites.iter().collect::<std::collections::BTreeSet<_>>().len()
            == value.work_sites.len()
}
/// Same versioned digest the tracker reader returns for the current row.
pub(super) fn site_digest(site: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hash = Sha256::new();
    hash.update(b"drifty-site-v1\0");
    hash.update(site.as_bytes());
    format!("{:x}", hash.finalize())
}
/// While memory is on it keeps recording on its chosen apps, so the silent
/// upgrade to general display capture waits until memory is off. An unreadable
/// memory setting also waits: the upgrade is never urgent.
pub(super) fn holds_capture(app: &AppHandle, lease: &AccountReadLease) -> bool {
    profile_root(app, lease)
        .and_then(|root| preferences(&root))
        .map_or(true, |prefs| prefs.enabled)
}
/// Chosen work sites take effect only while memory is on for this profile.
pub(super) fn work_site_digests(
    app: &AppHandle,
    lease: &AccountReadLease,
) -> std::collections::BTreeSet<String> {
    profile_root(app, lease)
        .and_then(|root| preferences(&root))
        .ok()
        .filter(|prefs| prefs.enabled)
        .map(|prefs| prefs.work_sites.iter().map(|s| site_digest(s)).collect())
        .unwrap_or_default()
}

#[derive(Default)]
pub(super) struct MemoryRuntime {
    generation: AtomicU64,
    process: Mutex<Option<(ScopeId, String, Arc<process::MemoryProcess>)>>,
    busy: AtomicBool,
    mutation: Mutex<()>,
    next: Mutex<Option<Instant>>,
    status: Mutex<Value>,
    chats: Mutex<std::collections::HashMap<Uuid, (AccountReadLease, u64)>>,
    cloud: Mutex<Option<CloudSession>>,
}
impl MemoryRuntime {
    pub(super) fn invalidate(&self) {
        self.generation.fetch_add(1, Ordering::AcqRel);
        if let Ok(mut chats) = self.chats.lock() {
            chats.clear();
        }
        if let Ok(mut slot) = self.process.try_lock() {
            if let Some((_, _, process)) = slot.take() {
                process.stop();
            }
        }
        if let Ok(mut status) = self.status.lock() {
            *status = Value::Null;
        }
    }
    pub(super) fn tick(&self, app: &AppHandle) {
        let Ok(mut next) = self.next.try_lock() else {
            return;
        };
        if next.is_some_and(|at| Instant::now() < at) || self.busy.swap(true, Ordering::AcqRel) {
            return;
        }
        *next = Some(Instant::now() + Duration::from_secs(5));
        let app = app.clone();
        std::thread::spawn(move || {
            let runtime = &app.state::<ScreenContextAccount>().runtime;
            if let Ok(lease) = runtime.memory_lease() {
                let epoch = runtime.memory.generation.load(Ordering::Acquire);
                if let Err(error) = runtime.memory_request(&app, &lease, "sync", &json!({})) {
                    if let Ok(mut status) = runtime.memory.status.lock() {
                        if lease.is_current()
                            && epoch == runtime.memory.generation.load(Ordering::Acquire)
                        {
                            *status = json!({"active":false,"error": if error == "memory_credentials_required" { error.as_str() } else { MEMORY_UNAVAILABLE }});
                        }
                    }
                }
            }
            runtime.memory.busy.store(false, Ordering::Release);
        });
    }
}

pub(super) fn profile_root(app: &AppHandle, lease: &AccountReadLease) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|_| MEMORY_UNAVAILABLE)?
        .join("memory-v1")
        .join(lease.scope().storage_namespace()))
}

fn preferences(root: &Path) -> Result<MemoryPreferences, String> {
    let file = root.join("settings.json");
    if !file.exists() {
        return Ok(MemoryPreferences::default());
    }
    if fs::symlink_metadata(&file)
        .map_err(|_| MEMORY_UNAVAILABLE)?
        .file_type()
        .is_symlink()
    {
        return Err(MEMORY_UNAVAILABLE.into());
    }
    let bytes = fs::read(file).map_err(|_| MEMORY_UNAVAILABLE)?;
    if bytes.len() > 16 * 1024 {
        return Err(MEMORY_UNAVAILABLE.into());
    }
    let value: MemoryPreferences =
        serde_json::from_slice(&bytes).map_err(|_| MEMORY_UNAVAILABLE)?;
    if !valid_preferences(&value) {
        return Err(MEMORY_UNAVAILABLE.into());
    }
    Ok(value)
}

fn private_directory(path: &Path) -> Result<(), String> {
    for ancestor in path.ancestors() {
        if let Ok(meta) = fs::symlink_metadata(ancestor) {
            if meta.file_type().is_symlink() || !meta.is_dir() {
                return Err(MEMORY_UNAVAILABLE.into());
            }
        }
    }
    fs::create_dir_all(path).map_err(|_| MEMORY_UNAVAILABLE)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|_| MEMORY_UNAVAILABLE)?;
    }
    Ok(())
}

fn save_preferences(root: &Path, value: &MemoryPreferences) -> Result<(), String> {
    if !valid_preferences(value) {
        return Err(MEMORY_UNAVAILABLE.into());
    }
    private_directory(root)?;
    let temporary = root.join(format!(".settings-{}", Uuid::new_v4()));
    let result = (|| {
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary).map_err(|_| MEMORY_UNAVAILABLE)?;
        file.write_all(&serde_json::to_vec(value).map_err(|_| MEMORY_UNAVAILABLE)?)
            .map_err(|_| MEMORY_UNAVAILABLE)?;
        file.sync_all().map_err(|_| MEMORY_UNAVAILABLE)?;
        fs::rename(&temporary, root.join("settings.json")).map_err(|_| MEMORY_UNAVAILABLE)?;
        Ok(())
    })();
    let _ = fs::remove_file(temporary);
    result
}

/// The apps memory reads: a list saved by an earlier version, or every
/// supported app. Excluded apps and sites are skipped by the capture policy.
fn memory_apps(prefs: &MemoryPreferences) -> Vec<String> {
    if !prefs.apps.is_empty() {
        return prefs.apps.clone();
    }
    supported_apps().iter().map(|app| app.id.to_owned()).collect()
}
/// Memory reads the chosen apps' documents. A general display scene spans every
/// window and site, so while memory is on recording keeps to those apps.
fn capture_for_memory(mut value: CapturePreferences, apps: &[String]) -> CapturePreferences {
    value.scope = CaptureScope::SelectedApps;
    value.general_notice_pending = false;
    value.allowed_apps = apps.iter().cloned().collect();
    value.visible_text_enabled = true;
    value.ocr_enabled = true;
    value.interval_seconds = 30;
    value
}
fn restore_memory_fields(
    mut current: CapturePreferences,
    previous: &CapturePreferences,
) -> CapturePreferences {
    // Recording that was general before memory returns to general. Its app list
    // was memory's, so nothing chosen for recording itself is lost.
    if previous.scope == CaptureScope::ActiveDisplayScene && current.scope == CaptureScope::SelectedApps {
        return CapturePreferences {
            enabled: current.enabled,
            ..previous.clone()
        };
    }
    // App/replay choices made while memory was on belong to the user. Restore
    // only unchanged fields that this feature enabled, including after restart.
    if current.visible_text_enabled {
        current.visible_text_enabled = previous.visible_text_enabled;
    }
    if current.ocr_enabled {
        current.ocr_enabled = previous.ocr_enabled;
    }
    if current.interval_seconds == 30 {
        current.interval_seconds = previous.interval_seconds;
    }
    current
}
fn restore_capture(
    runtime: &ScreenContextRuntime,
    app: &AppHandle,
    lease: &AccountReadLease,
    root: &Path,
) -> Result<(), String> {
    let journal = root.join("capture-before.json");
    if !journal.exists() {
        return Ok(());
    }
    let metadata = fs::symlink_metadata(&journal).map_err(|_| MEMORY_UNAVAILABLE)?;
    if !metadata.is_file() || metadata.len() > 16_384 {
        return Err(MEMORY_UNAVAILABLE.into());
    }
    let previous: CapturePreferences =
        serde_json::from_slice(&fs::read(&journal).map_err(|_| MEMORY_UNAVAILABLE)?)
            .map_err(|_| MEMORY_UNAVAILABLE)?;
    let current = runtime.with_state(lease, |state| Ok(state.preferences.clone()))?;
    let mut restored = restore_memory_fields(current.clone(), &previous);
    if restored.scope == CaptureScope::ActiveDisplayScene && !runtime.general_supported() {
        // General capture became unavailable meanwhile: keep the apps, drop memory's text.
        restored = restore_memory_fields(current.clone(), &CapturePreferences {
            scope: CaptureScope::SelectedApps,
            ..previous.clone()
        });
    }
    if restored != current {
        runtime.configure_with_exclusions(app, lease, restored, false)?;
    }
    fs::remove_file(journal).map_err(|_| MEMORY_UNAVAILABLE)?;
    Ok(())
}

impl ScreenContextRuntime {
    pub(crate) fn memory_credentials_changed(&self) {
        self.memory.invalidate();
    }
    pub(crate) fn begin_memory_chat(&self, app: &AppHandle) -> Result<Option<Uuid>, String> {
        if process::invocation(app).is_none() || globally_paused(app) {
            return Ok(None);
        }
        let Ok(lease) = self.memory_lease() else {
            return Ok(None);
        };
        if !preferences(&profile_root(app, &lease)?)?.enabled {
            return Ok(None);
        }
        let epoch = self.memory.generation.load(Ordering::Acquire);
        let mut chats = self.memory.chats.lock().map_err(|_| MEMORY_UNAVAILABLE)?;
        chats.retain(|_, (lease, generation)| lease.is_current() && *generation == epoch);
        if chats.len() >= 32 {
            return Err(MEMORY_UNAVAILABLE.into());
        }
        let id = Uuid::new_v4();
        chats.insert(id, (lease, epoch));
        Ok(Some(id))
    }
    pub(crate) fn end_memory_chat(&self, id: Uuid) {
        if let Ok(mut chats) = self.memory.chats.lock() {
            chats.remove(&id);
        }
    }
    pub(crate) fn memory_chat_current(&self, id: Uuid) -> bool {
        self.memory.chats.lock().is_ok_and(|chats| {
            chats.get(&id).is_some_and(|(lease, epoch)| {
                lease.is_current() && *epoch == self.memory.generation.load(Ordering::Acquire)
            })
        })
    }
    pub(crate) fn memory_chat_tool(
        &self,
        app: &AppHandle,
        id: Uuid,
        name: &str,
        arguments: &Value,
    ) -> Result<Value, String> {
        let lease = self
            .memory
            .chats
            .lock()
            .map_err(|_| MEMORY_UNAVAILABLE)?
            .get(&id)
            .filter(|(lease, epoch)| {
                lease.is_current() && *epoch == self.memory.generation.load(Ordering::Acquire)
            })
            .map(|(lease, _)| lease.clone())
            .ok_or(CHANGED)?;
        if !matches!(name, "memory_search" | "memory_source" | "memory_recent" | "memory_wiki") {
            return Err(MEMORY_UNAVAILABLE.into());
        }
        let result = self.memory_request(app, &lease, name, arguments)?;
        if !self.memory_chat_current(id) {
            return Err(CHANGED.into());
        }
        Ok(result)
    }
    pub(crate) fn memory_lease(&self) -> Result<AccountReadLease, String> {
        let state = self.state.lock().map_err(|_| MEMORY_UNAVAILABLE)?;
        state
            .lease
            .clone()
            .filter(|lease| lease.is_current() && !self.stopping())
            .ok_or(CHANGED.into())
    }

    fn memory_snapshot(
        &self,
        app: &AppHandle,
        lease: &AccountReadLease,
        hours: u32,
        preferred: &[Uuid],
    ) -> Result<(Value, Vec<String>), String> {
        if globally_paused(app) || self.stopping() {
            return Err(MEMORY_UNAVAILABLE.into());
        }
        self.refresh_exclusions(app)?;
        let (service, allowed) = self.with_state(lease, |state| {
            self.ensure_store(app, state, lease, false)?;
            if !state.opened || !state.preferences.enabled {
                return Err(MEMORY_UNAVAILABLE.into());
            }
            let service = Arc::clone(self.service(app, lease)?);
            if service.status().paused {
                return Err(MEMORY_UNAVAILABLE.into());
            }
            Ok((service, policy_for(&state.preferences)?.allowed_apps))
        })?;
        let observation = service.observation_lease();
        let mut cursor = None;
        let mut details = Vec::new();
        let mut selection = drifty_screen_context_core::MemorySourceSelection::new(allowed.clone(), hours)
            .map_err(error_code)?;
        if preferred.len() > 4 { return Err(MEMORY_UNAVAILABLE.into()); }
        for id in preferred {
            details.push(service.read_memory_selection_source(*id, &mut selection)
                .map_err(error_code)?.try_map(|item| {
                    Ok(item.iter().filter_map(|v| memory_observation(&v.metadata, hours)).collect::<Vec<_>>())
                }).map_err(error_code)?);
        }
        loop {
            let page = service
                .read_memory_selection_page(cursor.take(), &mut selection)
                .map_err(error_code)?
                .try_map(|page| {
                    cursor = page.next_cursor;
                    let now = unix_millis()?;
                    Ok(page.records.iter().filter_map(|m| {
                        let expires = m.expires_at_ms.min(m.observed_at_ms + i64::from(hours) * 3_600_000);
                        let app = &drifty_screen_context_core::memory_document(m)?.app_id;
                        if !allowed.contains(app) || m.text.as_str().is_empty() || expires <= now { return None; }
                        memory_observation(m, hours)
                    }).collect::<Vec<_>>())
                })
                .map_err(error_code)?;
            details.push(page);
            if cursor.is_none() || selection.is_full() {
                break;
            }
        }
        // All original activity guards are checked together at dispatch time.
        let checked = observation.reply(details).map_err(error_code)?;
        let values: Vec<Vec<Value>> =
            serde_json::from_value(serde_json::to_value(checked).map_err(|_| MEMORY_UNAVAILABLE)?)
                .map_err(|_| MEMORY_UNAVAILABLE)?;
        if !lease.is_current() {
            return Err(CHANGED.into());
        }
        Ok((
            Value::Array(values.into_iter().flatten().collect()),
            allowed.into_iter().collect(),
        ))
    }

    pub(crate) fn memory_request(
        &self,
        app: &AppHandle,
        lease: &AccountReadLease,
        op: &str,
        arguments: &Value,
    ) -> Result<Value, String> {
        let _mutation = self
            .memory
            .mutation
            .lock()
            .map_err(|_| MEMORY_UNAVAILABLE)?;
        self.memory_request_locked(app, lease, op, arguments)
    }

    fn memory_request_locked(
        &self,
        app: &AppHandle,
        lease: &AccountReadLease,
        op: &str,
        arguments: &Value,
    ) -> Result<Value, String> {
        if !matches!(op, "sync" | "memory_search" | "memory_source" | "memory_recent" | "memory_wiki" | "wiki_pages")
            || !arguments.is_object()
        {
            return Err(MEMORY_UNAVAILABLE.into());
        }
        let epoch = self.memory.generation.load(Ordering::Acquire);
        let current = || {
            lease.is_current()
                && !self.stopping()
                && epoch == self.memory.generation.load(Ordering::Acquire)
        };
        if !current() {
            return Err(CHANGED.into());
        }
        let root = profile_root(app, lease)?;
        let prefs = preferences(&root)?;
        if !prefs.enabled {
            return Err(MEMORY_UNAVAILABLE.into());
        }
        let mut preferred = reply::preferred_sources(op, arguments).ok_or(MEMORY_UNAVAILABLE)?;
        if matches!(op, "sync" | "memory_search") {
            let slot = self.memory.process.lock().map_err(|_| MEMORY_UNAVAILABLE)?;
            if let Some((scope, _, process)) = slot.as_ref() {
                if scope == lease.scope() { preferred.extend(process.pending_source()?); }
            }
        }
        let (sources, apps) = self.memory_snapshot(app, lease, prefs.retention_hours, &preferred)?;
        // Drifty Cloud while the app holds a session for a trial or Pro, otherwise the user's own key.
        // The route is part of the process identity: switching it starts a new engine.
        let cloud = self.memory.cloud.lock().map_err(|_| MEMORY_UNAVAILABLE)?.clone();
        let provider = match &cloud {
            Some(session) => json!({"llm_model":"claude-haiku-5-5","llm_route":"cloud",
                "llm_key_env":"DRIFTY_MEMORY_CLOUD_TOKEN","cloud_url":session.url}),
            None => json!({"llm_model":"claude-haiku-5-5","llm_route":"own","llm_key_env":"ANTHROPIC_API_KEY"}),
        };
        let config = json!({"version":1,"enabled":true,"allow_external_text":true,
            "scope":format!("app:{}",lease.scope().storage_namespace()),"allowed_apps":apps,
            "capture_seconds":30,"settle_seconds":30,"retention_hours":prefs.retention_hours,
            "writes_per_hour":12,"writes_per_day":60,"queries_per_hour":30,
            "provider":provider});
        let process = {
            let mut slot = self.memory.process.lock().map_err(|_| MEMORY_UNAVAILABLE)?;
            let identity = config.to_string();
            if slot
                .as_ref()
                .is_some_and(|(scope, old, _)| scope != lease.scope() || *old != identity)
            {
                if let Some((_, _, process)) = slot.take() {
                    process.stop();
                }
            }
            if slot.is_none() {
                if !current() {
                    return Err(CHANGED.into());
                }
                private_directory(&root)?;
                let credential = match &cloud {
                    Some(session) => session.token.clone(),
                    None => Zeroizing::new(
                        super::super::analysis_provider_load_api_key(app.clone(), "anthropic".into())?
                            .filter(|key| !key.trim().is_empty())
                            .ok_or("memory_credentials_required")?,
                    ),
                };
                // The on-device embedding model is downloaded once and shared by every profile.
                let models = super::memory_models::models_dir(app).map_err(|_| MEMORY_UNAVAILABLE)?;
                let process = Arc::new(process::MemoryProcess::start(
                    app,
                    json!({"state":root.join("state"),"config":config,
                    "credential":credential.as_str(),"models":models}),
                    credential,
                )?);
                if !current() {
                    process.stop();
                    return Err(CHANGED.into());
                }
                *slot = Some((lease.scope().clone(), identity, process));
            }
            Arc::clone(&slot.as_ref().ok_or(MEMORY_UNAVAILABLE)?.2)
        };
        if let Some(session) = &cloud {
            // A refreshed session reaches the running engine before its next model call.
            if let Err(error) = process.refresh_credential(&session.token) {
                let mut slot = self.memory.process.lock().map_err(|_| MEMORY_UNAVAILABLE)?;
                if slot.as_ref().is_some_and(|(_, _, active)| Arc::ptr_eq(active, &process)) {
                    slot.take();
                }
                return Err(error);
            }
        }
        let mut request = arguments.clone();
        request["op"] = json!(op);
        request["sources"] = sources;
        // Memory is Dev-only. A capable engine asks for one exact original
        // before starting extraction; older installed engines retain text-only
        // operation. No pixels enter state, wiki, embeddings or Chat replies.
        if process.supports_images() {
            request["screen_images_enabled"] = json!(true);
            if let Some(id) = process.pending_image_source()? {
                let supplied = request["sources"].as_array().is_some_and(|items|
                    items.iter().any(|source| source["source_id"].as_str() == Some(&id.to_string())));
                let image = if supplied {
                    let service = self.service(app, lease)?;
                    service.read_review_evidence_strict(id, true).map_err(error_code)?
                        .try_map(|original| Ok(original.as_ref()
                            .filter(|e| drifty_screen_context_core::memory_document(&e.metadata).is_some())
                            .and_then(super::activity_input::image))).map_err(error_code)?
                } else {
                    // A vanished original is reconciled away before the child
                    // could start or commit a model call.
                    let service = self.service(app, lease)?;
                    service.read_review_evidence_strict(id, false).map_err(error_code)?
                        .try_map(|_| Ok(None)).map_err(error_code)?
                };
                let picture = serde_json::to_value(image).map_err(|_| MEMORY_UNAVAILABLE)?;
                request["screen_image"] = json!({"source_id":id.to_string(),"image":picture});
            }
        }
        if !current() {
            return Err(CHANGED.into());
        }
        let result = match process.call(request) {
            Ok(value) => value,
            Err(error) => {
                let mut slot = self.memory.process.lock().map_err(|_| MEMORY_UNAVAILABLE)?;
                if slot
                    .as_ref()
                    .is_some_and(|(_, _, active)| Arc::ptr_eq(active, &process))
                {
                    slot.take();
                }
                return Err(error);
            }
        };
        if !current() {
            process.stop();
            return Err(CHANGED.into());
        }
        if op == "sync" {
            if let Ok(mut status) = self.memory.status.lock() {
                if !current() {
                    return Err(CHANGED.into());
                }
                *status = result.clone();
            }
            return Ok(result);
        }
        if matches!(op, "memory_wiki" | "wiki_pages") {
            // Wiki lines are remembered summaries that outlive their originals.
            // No model call ran; the worker marked each line's original from
            // the snapshot it just reconciled. Opening one still goes through
            // memory_source and its full native revalidation.
            if !current() || !preferences(&root)?.enabled {
                return Err(CHANGED.into());
            }
            return Ok(result);
        }
        // A model call can outlive source deletion, exclusion or expiry.
        let preferred = reply::result_sources(op, &result).ok_or(MEMORY_UNAVAILABLE)?;
        let (live, _) = self.memory_snapshot(app, lease, prefs.retention_hours, &preferred)?;
        let sources = live.as_array().ok_or(MEMORY_UNAVAILABLE)?;
        let result = reply::verified_reply(op, &result, sources).ok_or(MEMORY_UNAVAILABLE)?;
        if !current() || !preferences(&root)?.enabled {
            return Err(CHANGED.into());
        }
        Ok(result)
    }
}

#[tauri::command]
pub async fn chat_memory_session(app: AppHandle) -> Result<Option<Uuid>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<ScreenContextAccount>()
            .runtime
            .begin_memory_chat(&app)
    })
    .await
    .map_err(|_| MEMORY_UNAVAILABLE.to_owned())?
}

#[tauri::command]
pub fn chat_memory_end(app: AppHandle, session_id: Uuid) {
    app.state::<ScreenContextAccount>()
        .runtime
        .end_memory_chat(session_id);
}

#[tauri::command]
pub async fn memory_get_status(
    app: AppHandle,
    lease_id: AccountLeaseId,
    include_credentials: Option<bool>,
) -> Result<AccountReply<Value>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        authorized(&app, lease_id, |runtime, lease| {
            let prefs = preferences(&profile_root(&app, lease)?)?;
            let mut reply = json!({"supported":process::invocation(&app).is_some(),"preferences":prefs,
            "generation":runtime.memory.generation.load(Ordering::Acquire),
            "status":runtime.memory.status.lock().map_err(|_| MEMORY_UNAVAILABLE)?.clone()});
            // Settings asks how memory would reach its model so it can say what is
            // missing before memory is switched on: a Drifty Cloud session (trial or
            // Pro) or the user's own Anthropic key. Only presence leaves this process.
            if include_credentials == Some(true) {
                let anthropic = super::super::analysis_provider_load_api_key(app.clone(), "anthropic".into())
                    .ok()
                    .flatten()
                    .is_some_and(|key| !key.trim().is_empty());
                let cloud = runtime.memory.cloud.lock().map_err(|_| MEMORY_UNAVAILABLE)?.is_some();
                reply["credentials"] = json!({"anthropic":anthropic,"cloud":cloud});
            }
            Ok(reply)
        })
    })
    .await
    .map_err(|_| MEMORY_UNAVAILABLE.to_owned())?
}

/// The app sets the signed-in Drifty Cloud session while the account has a
/// trial or Pro (and after each refresh), and clears it otherwise. Held in
/// memory only; the next model call of a running engine uses the new session.
#[tauri::command]
pub fn memory_set_cloud_session(app: AppHandle, session: Option<MemoryCloudSession>) -> Result<(), String> {
    let next = match session {
        None => None,
        Some(MemoryCloudSession { url, access_token }) => {
            let token = Zeroizing::new(access_token);
            if !valid_cloud_url(&url)
                || token.is_empty()
                || token.len() > 8192
                || !token.bytes().all(|b| b.is_ascii_graphic())
            {
                return Err(MEMORY_UNAVAILABLE.into());
            }
            Some(CloudSession { url, token })
        }
    };
    *app.state::<ScreenContextAccount>()
        .runtime
        .memory
        .cloud
        .lock()
        .map_err(|_| MEMORY_UNAVAILABLE)? = next;
    Ok(())
}

#[tauri::command]
pub async fn memory_configure(
    app: AppHandle,
    lease_id: AccountLeaseId,
    preferences: MemoryPreferences,
    acknowledge_external_text: bool,
) -> Result<AccountReply<Value>, String> {
    app.state::<ScreenContextAccount>()
        .gate
        .read(lease_id)
        .map_err(error_code)?;
    app.state::<ScreenContextAccount>()
        .runtime
        .memory
        .invalidate();
    tauri::async_runtime::spawn_blocking(move || {
        authorized(&app, lease_id, |runtime, lease| {
            let mut preferences = preferences.clone();
            let _mutation = runtime
                .memory
                .mutation
                .lock()
                .map_err(|_| MEMORY_UNAVAILABLE)?;
            // Join any spawn that raced the initial revocation before changing files.
            if let Some((_, _, process)) = runtime
                .memory
                .process
                .lock()
                .map_err(|_| MEMORY_UNAVAILABLE)?
                .take()
            {
                process.stop();
            }
            if preferences.enabled
                && (!acknowledge_external_text || process::invocation(&app).is_none())
            {
                return Err(MEMORY_UNAVAILABLE.into());
            }
            let root = profile_root(&app, lease)?;
            if preferences.enabled {
                let capture = runtime.with_state(lease, |state| {
                    if !state.preferences.enabled
                        || globally_paused(&app)
                        || runtime.service(&app, lease)?.status().paused
                    {
                        return Err("memory_recording_required".into());
                    }
                    Ok(state.preferences.clone())
                })?;
                preferences.apps = memory_apps(&preferences);
                if preferences.apps.is_empty() {
                    return Err("memory_apps_required".into());
                }
                private_directory(&root)?;
                let journal = root.join("capture-before.json");
                if !journal.exists() {
                    let mut options = fs::OpenOptions::new();
                    options.write(true).create_new(true);
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::OpenOptionsExt;
                        options.mode(0o600);
                    }
                    let mut file = options.open(journal).map_err(|_| MEMORY_UNAVAILABLE)?;
                    file.write_all(&serde_json::to_vec(&capture).map_err(|_| MEMORY_UNAVAILABLE)?)
                        .map_err(|_| MEMORY_UNAVAILABLE)?;
                    file.sync_all().map_err(|_| MEMORY_UNAVAILABLE)?;
                }
                runtime.configure_with_exclusions(
                    &app,
                    lease,
                    capture_for_memory(capture, &preferences.apps),
                    false,
                )?;
            }
            if !lease.is_current() {
                return Err(CHANGED.into());
            }
            save_preferences(&root, &preferences)?;
            if !preferences.enabled {
                restore_capture(runtime, &app, lease, &root)?;
            } else {
                // Work sites are read from the saved memory settings.
                runtime.reapply_capture_policy(&app, lease)?;
            }
            if preferences.enabled {
                if let Err(error) = runtime.memory_request_locked(&app, lease, "sync", &json!({})) {
                    #[cfg(debug_assertions)]
                    eprintln!("[memory] Enable failed: {error}");
                    runtime.memory.invalidate();
                    save_preferences(
                        &root,
                        &MemoryPreferences {
                            enabled: false,
                            ..preferences
                        },
                    )?;
                    restore_capture(runtime, &app, lease, &root)?;
                    return Err(error);
                }
            }
            Ok(json!({"saved":true}))
        })
    })
    .await
    .map_err(|_| MEMORY_UNAVAILABLE.to_owned())?
}

/// Keyless local edit of the encrypted state. No model process may write while
/// it runs, so any running engine is stopped first.
fn maintenance(
    runtime: &ScreenContextRuntime,
    app: &AppHandle,
    lease: &AccountReadLease,
    request: Value,
    invalidate: bool,
) -> Result<Value, String> {
    let _mutation = runtime.memory.mutation.lock().map_err(|_| MEMORY_UNAVAILABLE)?;
    if invalidate {
        // Join any request that raced revocation before the content changes.
        runtime.memory.invalidate();
    }
    if let Some((_, _, process)) = runtime.memory.process.lock().map_err(|_| MEMORY_UNAVAILABLE)?.take() {
        process.stop();
    }
    if !lease.is_current() { return Err(CHANGED.into()); }
    let root = profile_root(app, lease)?;
    private_directory(&root)?;
    let process = process::MemoryProcess::start(app, json!({
        "state":root.join("state"), "scope":format!("app:{}", lease.scope().storage_namespace()), "maintenance":true
    }), Zeroizing::new(String::new()))?;
    let result = process.call(request);
    process.stop();
    if !lease.is_current() { return Err(CHANGED.into()); }
    result
}

/// Every wiki page with its lines, for the settings view.
#[tauri::command]
pub async fn memory_wiki_pages(
    app: AppHandle,
    lease_id: AccountLeaseId,
) -> Result<AccountReply<Value>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        authorized(&app, lease_id, |runtime, lease| {
            if preferences(&profile_root(&app, lease)?)?.enabled {
                // The running engine owns the state; reading through it keeps
                // in-flight extraction and Chat sessions intact.
                return runtime.memory_request(&app, lease, "wiki_pages", &json!({}));
            }
            if !profile_root(&app, lease)?.join("state").exists() {
                return Ok(json!({"pages":[]}));
            }
            maintenance(runtime, &app, lease, json!({"op":"wiki_pages"}), false)
        })
    })
    .await
    .map_err(|_| MEMORY_UNAVAILABLE.to_owned())?
}

/// Delete one wiki page, or one line of it. Originals and activity stay intact.
#[tauri::command]
pub async fn memory_wiki_delete(
    app: AppHandle,
    lease_id: AccountLeaseId,
    page_id: String,
    line_id: Option<String>,
) -> Result<AccountReply<Value>, String> {
    let valid = |value: &str| !value.is_empty() && value.len() <= 64 && value.bytes().all(|b| b.is_ascii_alphanumeric());
    if !valid(&page_id) || line_id.as_deref().is_some_and(|id| !valid(id)) {
        return Err(MEMORY_UNAVAILABLE.into());
    }
    app.state::<ScreenContextAccount>()
        .gate
        .read(lease_id)
        .map_err(error_code)?;
    app.state::<ScreenContextAccount>().runtime.memory.invalidate();
    tauri::async_runtime::spawn_blocking(move || {
        authorized(&app, lease_id, |runtime, lease| {
            let mut request = json!({"op":"wiki_delete","page_id":page_id});
            if let Some(line) = line_id {
                request["line_id"] = json!(line);
            }
            maintenance(runtime, &app, lease, request, true)
        })
    })
    .await
    .map_err(|_| MEMORY_UNAVAILABLE.to_owned())?
}

/// Set or clear the person's own note on a wiki page. Rewrites never touch it
/// and no model reads it.
#[tauri::command]
pub async fn memory_wiki_note(
    app: AppHandle,
    lease_id: AccountLeaseId,
    page_id: String,
    text: String,
) -> Result<AccountReply<Value>, String> {
    if page_id.is_empty() || page_id.len() > 64 || !page_id.bytes().all(|b| b.is_ascii_alphanumeric())
        || text.chars().count() > 2000 || text.len() > 8192
    {
        return Err(MEMORY_UNAVAILABLE.into());
    }
    app.state::<ScreenContextAccount>()
        .gate
        .read(lease_id)
        .map_err(error_code)?;
    app.state::<ScreenContextAccount>().runtime.memory.invalidate();
    tauri::async_runtime::spawn_blocking(move || {
        authorized(&app, lease_id, |runtime, lease| {
            maintenance(runtime, &app, lease, json!({"op":"wiki_note","page_id":page_id,"text":text}), true)
        })
    })
    .await
    .map_err(|_| MEMORY_UNAVAILABLE.to_owned())?
}

#[tauri::command]
pub async fn memory_forget_source(
    app: AppHandle,
    lease_id: AccountLeaseId,
    record_id: Uuid,
) -> Result<AccountReply<Value>, String> {
    app.state::<ScreenContextAccount>()
        .gate
        .read(lease_id)
        .map_err(error_code)?;
    app.state::<ScreenContextAccount>()
        .runtime
        .memory
        .invalidate();
    tauri::async_runtime::spawn_blocking(move || {
        authorized(&app, lease_id, |runtime, lease| {
            // Original screen evidence, capture settings and activity stay intact.
            // Wiki lines learned only from this original are removed with it.
            maintenance(runtime, &app, lease, json!({"op":"forget", "id":record_id.to_string()}), true)
        })
    }).await.map_err(|_| MEMORY_UNAVAILABLE.to_owned())?
}

#[tauri::command]
pub async fn memory_purge(
    app: AppHandle,
    lease_id: AccountLeaseId,
) -> Result<AccountReply<Value>, String> {
    app.state::<ScreenContextAccount>()
        .gate
        .read(lease_id)
        .map_err(error_code)?;
    app.state::<ScreenContextAccount>()
        .runtime
        .memory
        .invalidate();
    tauri::async_runtime::spawn_blocking(move || {
        authorized(&app, lease_id, |runtime, lease| {
            let root = profile_root(&app, lease)?;
            let _mutation = runtime
                .memory
                .mutation
                .lock()
                .map_err(|_| MEMORY_UNAVAILABLE)?;
            if let Some((_, _, process)) = runtime
                .memory
                .process
                .lock()
                .map_err(|_| MEMORY_UNAVAILABLE)?
                .take()
            {
                process.stop();
            }
            save_preferences(&root, &MemoryPreferences::default())?;
            restore_capture(runtime, &app, lease, &root)?;
            runtime.with_state(lease, |state| {
                runtime.ensure_store(&app, state, lease, false)?;
                if state.opened {
                    runtime.service(&app, lease)?.purge().map_err(error_code)?;
                }
                Ok(())
            })?;
            let state = root.join("state");
            if state.exists() {
                if fs::symlink_metadata(&state)
                    .map_err(|_| MEMORY_UNAVAILABLE)?
                    .file_type()
                    .is_symlink()
                {
                    return Err(MEMORY_UNAVAILABLE.into());
                }
                fs::remove_dir_all(state).map_err(|_| MEMORY_UNAVAILABLE)?;
            }
            // The plain-text Markdown copies go with the memories, not in a
            // second call that could fail on its own. A symlink in their place
            // is refused there and never followed.
            let _ = super::memory_export::clear_profile_export(&root);
            Ok(json!({"purged":true,"paused":true}))
        })
    })
    .await
    .map_err(|_| MEMORY_UNAVAILABLE.to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use drifty_screen_context_core::lease::AccountGate;
    #[test]
    fn drifty_cloud_memory_calls_go_only_to_a_hosted_memory_function() {
        assert!(valid_cloud_url("https://abcdefghijklmnopqrst.supabase.co/functions/v1/memory-cloud"));
        for url in [
            "http://abcdefghijklmnopqrst.supabase.co/functions/v1/memory-cloud",
            "https://abcdefghijklmnopqrst.supabase.co/functions/v1/chat-cloud",
            "https://abcdefghijklmnopqrst.supabase.co/functions/v1/memory-cloud/v1/messages",
            "https://abc.supabase.co/functions/v1/memory-cloud",
            "https://ABCDEFGHIJKLMNOPQRST.supabase.co/functions/v1/memory-cloud",
            "https://abcdefghijklmnopqrst.supabase.co.evil.example/functions/v1/memory-cloud",
            "https://example.com/functions/v1/memory-cloud",
        ] {
            assert!(!valid_cloud_url(url), "{url}");
        }
    }
    #[test]
    fn memory_sessions_close_on_account_revocation_off_and_expiry() {
        for mode in ["account", "off", "expired"] {
            let gate = AccountGate::default();
            let id = gate
                .bind_verified(
                    gate.begin_transition().unwrap(),
                    ScopeId::from_profile("memory-test").unwrap(),
                    Instant::now()
                        + Duration::from_millis(if mode == "expired" { 5 } else { 1000 }),
                )
                .unwrap();
            let runtime = ScreenContextRuntime::default();
            let chat = Uuid::new_v4();
            runtime
                .memory
                .chats
                .lock()
                .unwrap()
                .insert(chat, (gate.read(id).unwrap(), 0));
            assert!(runtime.memory_chat_current(chat));
            match mode {
                "account" => {
                    gate.begin_transition().unwrap();
                }
                "off" => runtime.memory.invalidate(),
                _ => std::thread::sleep(Duration::from_millis(10)),
            }
            assert!(!runtime.memory_chat_current(chat));
        }
    }
    #[test]
    fn off_restores_text_collection_after_the_user_changes_apps() {
        let original = CapturePreferences {
            enabled: true,
            replay_enabled: true,
            allowed_apps: ["textedit".into()].into_iter().collect(),
            ..CapturePreferences::default()
        };
        let mut active = capture_for_memory(original.clone(), &["textedit".into()]);
        active.allowed_apps.insert("slack".into());
        let restored = restore_memory_fields(active, &original);
        assert!(!restored.visible_text_enabled && !restored.ocr_enabled);
        assert!(restored.replay_enabled && restored.allowed_apps.contains("slack"));
        assert_eq!(restored.interval_seconds, original.interval_seconds);
    }
    #[test]
    fn memory_keeps_general_recording_to_its_apps_and_returns_it_when_off() {
        let app = supported_apps()[0].id.to_owned();
        let general = CapturePreferences {
            scope: CaptureScope::ActiveDisplayScene,
            enabled: true,
            replay_enabled: true,
            ocr_enabled: true,
            ..CapturePreferences::default()
        };
        general.validate().unwrap();
        // Without a saved list memory reads every supported app.
        assert_eq!(
            memory_apps(&MemoryPreferences::default()),
            supported_apps().iter().map(|a| a.id.to_owned()).collect::<Vec<_>>()
        );
        let active = capture_for_memory(general.clone(), std::slice::from_ref(&app));
        active.validate().unwrap();
        assert_eq!(active.scope, CaptureScope::SelectedApps);
        assert!(active.visible_text_enabled && active.allowed_apps.contains(&app));
        let restored = restore_memory_fields(active, &general);
        assert!(restored == general);
        // A list saved by an earlier version is kept.
        let saved = MemoryPreferences {
            apps: vec![app.clone()],
            ..MemoryPreferences::default()
        };
        assert_eq!(memory_apps(&saved), [app]);
    }
    #[test]
    fn memory_settings_default_off_and_refuse_redirected_storage() {
        let temporary = tempfile::tempdir().unwrap();
        let canonical = temporary.path().canonicalize().unwrap();
        let root = canonical.as_path();
        assert!(!preferences(root).unwrap().enabled);
        save_preferences(
            root,
            &MemoryPreferences {
                enabled: true,
                retention_hours: 6,
                work_sites: vec!["github.com".into(), "localhost".into()],
                apps: vec![supported_apps()[0].id.into()],
            },
        )
        .unwrap();
        assert_eq!(preferences(root).unwrap().retention_hours, 6);
        assert_eq!(preferences(root).unwrap().work_sites, ["github.com", "localhost"]);
        assert_eq!(preferences(root).unwrap().apps, [supported_apps()[0].id]);
        for apps in [vec!["not-a-supported-app".to_owned()], vec![supported_apps()[0].id.into(); 2]] {
            assert!(save_preferences(root, &MemoryPreferences { enabled: true, retention_hours: 6, work_sites: vec![], apps }).is_err());
        }
        for (hours, sites) in [
            (25, vec![]),
            (6, vec!["GitHub.com".to_owned()]),
            (6, vec!["https://github.com".to_owned()]),
            (6, vec!["github.com".to_owned(), "github.com".to_owned()]),
            (6, (0..33).map(|i| format!("s{i}.example")).collect()),
        ] {
            assert!(save_preferences(
                root,
                &MemoryPreferences {
                    enabled: true,
                    retention_hours: hours,
                    work_sites: sites,
                    apps: vec![],
                }
            )
            .is_err());
        }
        // The tracker reader hashes the same normalized name.
        assert_eq!(
            site_digest("github.com"),
            "ea277496f3b4daacebdb10728ca4b533c98c07bd83e8338170f54e8eb9858db1"
        );
        #[cfg(unix)]
        {
            let alias = root.join("alias");
            std::os::unix::fs::symlink(root, &alias).unwrap();
            assert!(private_directory(&alias.join("nested")).is_err());
        }
    }
}
