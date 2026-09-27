//! Forward Drifty's own macOS crash reports to Sentry on the next launch.
//!
//! The Rust SDK only sees panics. An uncaught AppKit exception, an abort after
//! a panic inside an Objective-C callback, or a memory fault ends the process
//! before Rust can report anything, so macOS's DiagnosticReports entry is the
//! only record. On the next launch this module reads Drifty's recent reports
//! and sends the exception, termination reason, and the crashed code addresses
//! and symbols. It never sends memory, register state, other threads, process
//! paths, or device identifiers, so no activity data can travel with a crash.

// Only macOS writes these reports; other platforms keep the parser for tests.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use crate::observability::{redact_user_home, release_for_app_version};
use sentry::protocol::{
    Addr, Context, DebugImage, DebugMeta, Event, Exception, Frame, Level, Mechanism, OsContext,
    Stacktrace, SymbolicDebugImage,
};
use serde_json::Value;
use std::borrow::Cow;
use std::collections::{BTreeMap, VecDeque};
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::time::{Duration, SystemTime};

const CRASH_BUG_TYPE: &str = "309";
const BUNDLE_IDENTIFIER: &str = "so.drifty.mac";
const REPORT_FILE_PREFIX: &str = "drifty";
const MAX_REPORT_AGE: Duration = Duration::from_secs(14 * 24 * 60 * 60);
const MAX_REPORT_BYTES: u64 = 4 * 1024 * 1024;
const MAX_FORWARDED_PER_LAUNCH: usize = 5;
const MAX_FRAMES: usize = 128;
const MAX_VALUE_CHARS: usize = 1_000;
const REMEMBERED_INCIDENTS: usize = 64;
const STATE_FILE_NAME: &str = "native-crash-reports.json";
const MECHANISM: &str = "macos_crash_report";

/// One Drifty crash parsed from a macOS `.ips` report.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct CrashReport {
    pub incident_id: String,
    pub app_version: Option<String>,
    pub os_version: Option<String>,
    pub exception_type: String,
    pub exception_value: Option<String>,
    /// Caller first, as Sentry expects.
    pub frames: Vec<Frame>,
    pub images: Vec<DebugImage>,
    pub from_exception_backtrace: bool,
}

/// Parses an `.ips` crash report and returns it only when it is a crash of
/// Drifty itself. Hangs, other processes, and unreadable files return None.
pub(crate) fn parse_crash_report(text: &str) -> Option<CrashReport> {
    let (header_line, body_text) = text.split_once('\n')?;
    let header: Value = serde_json::from_str(header_line).ok()?;
    let body: Value = serde_json::from_str(body_text).ok()?;
    if header.get("bug_type").and_then(Value::as_str) != Some(CRASH_BUG_TYPE) {
        return None;
    }
    let bundle_identifier = header.get("bundleID").and_then(Value::as_str).or_else(|| {
        body.pointer("/bundleInfo/CFBundleIdentifier")
            .and_then(Value::as_str)
    });
    if bundle_identifier != Some(BUNDLE_IDENTIFIER) {
        return None;
    }
    let incident_id = header
        .get("incident_id")
        .and_then(Value::as_str)
        .or_else(|| body.get("incident").and_then(Value::as_str))
        .filter(|id| !id.trim().is_empty())?
        .to_string();

    let used_images = body
        .get("usedImages")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default();
    let process_name = body.get("procName").and_then(Value::as_str);

    let exception_backtrace = body
        .get("lastExceptionBacktrace")
        .and_then(Value::as_array)
        .filter(|frames| !frames.is_empty());
    let crashed_thread_frames = || {
        let threads = body.get("threads").and_then(Value::as_array)?;
        let crashed = threads
            .iter()
            .find(|thread| thread.get("triggered").and_then(Value::as_bool) == Some(true))
            .or_else(|| {
                let index = body.get("faultingThread").and_then(Value::as_u64)?;
                threads.get(usize::try_from(index).ok()?)
            })?;
        crashed.get("frames").and_then(Value::as_array)
    };
    let from_exception_backtrace = exception_backtrace.is_some();
    let raw_frames = exception_backtrace
        .or_else(crashed_thread_frames)
        .map(Vec::as_slice)
        .unwrap_or_default();

    let mut referenced_images = BTreeMap::new();
    let mut frames: Vec<Frame> = raw_frames
        .iter()
        .take(MAX_FRAMES)
        .filter_map(|frame| {
            let image_index = usize::try_from(frame.get("imageIndex")?.as_u64()?).ok()?;
            let image = used_images.get(image_index)?;
            let base = image.get("base")?.as_u64()?;
            let offset = frame.get("imageOffset")?.as_u64()?;
            let name = image_name(image);
            if let Some(debug_image) = debug_image(image, &name, base) {
                referenced_images.entry(image_index).or_insert(debug_image);
            }
            let symbol = frame
                .get("symbol")
                .and_then(Value::as_str)
                .map(str::to_string);
            let symbol_location = frame.get("symbolLocation").and_then(Value::as_u64);
            Some(Frame {
                function: symbol.clone(),
                symbol,
                package: Some(name.clone()),
                in_app: Some(process_name == Some(name.as_str())),
                image_addr: Some(Addr(base)),
                instruction_addr: Some(Addr(base.checked_add(offset)?)),
                symbol_addr: symbol_location
                    .and_then(|location| base.checked_add(offset)?.checked_sub(location))
                    .map(Addr),
                ..Default::default()
            })
        })
        .collect();
    // macOS lists the crashing frame first; Sentry expects the caller first.
    frames.reverse();

    Some(CrashReport {
        incident_id,
        app_version: non_empty(header.get("app_version"))
            .or_else(|| non_empty(body.pointer("/bundleInfo/CFBundleShortVersionString"))),
        os_version: non_empty(header.get("os_version")),
        exception_type: exception_type(&body),
        exception_value: exception_value(&body),
        frames,
        images: referenced_images.into_values().collect(),
        from_exception_backtrace,
    })
}

fn non_empty(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

/// The file name only: the full path can name the user's home directory.
fn image_name(image: &Value) -> String {
    image
        .get("name")
        .and_then(Value::as_str)
        .or_else(|| {
            image
                .get("path")
                .and_then(Value::as_str)
                .and_then(|path| path.rsplit('/').next())
        })
        .filter(|name| !name.is_empty())
        .unwrap_or("<unknown>")
        .to_string()
}

fn debug_image(image: &Value, name: &str, base: u64) -> Option<DebugImage> {
    let id = sentry::types::DebugId::from_str(image.get("uuid")?.as_str()?).ok()?;
    Some(
        SymbolicDebugImage {
            name: name.to_string(),
            arch: image
                .get("arch")
                .and_then(Value::as_str)
                .map(str::to_string),
            image_addr: Addr(base),
            image_size: image.get("size").and_then(Value::as_u64).unwrap_or(0),
            image_vmaddr: Addr(0),
            id,
            code_id: None,
            debug_file: None,
        }
        .into(),
    )
}

fn exception_type(body: &Value) -> String {
    let kind = non_empty(body.pointer("/exception/type"));
    let signal = non_empty(body.pointer("/exception/signal"));
    match (kind, signal) {
        (Some(kind), Some(signal)) => format!("{kind} ({signal})"),
        (Some(kind), None) => kind,
        (None, Some(signal)) => signal,
        (None, None) => "macOS crash".to_string(),
    }
}

/// Prefer the application-specific information: for an uncaught
/// NSException it carries the exception name and reason, and for an abort it
/// names the caller. Fall back to the termination indicator.
fn exception_value(body: &Value) -> Option<String> {
    let mut parts = Vec::new();
    if let Some(asi) = body.get("asi").and_then(Value::as_object) {
        for lines in asi.values() {
            for line in lines.as_array().map(Vec::as_slice).unwrap_or_default() {
                if let Some(line) = line.as_str().map(str::trim).filter(|line| !line.is_empty()) {
                    parts.push(line.to_string());
                }
            }
        }
    }
    if parts.is_empty() {
        parts.extend(non_empty(body.pointer("/exception/subtype")));
        parts.extend(non_empty(body.pointer("/termination/indicator")));
    }
    if parts.is_empty() {
        return None;
    }
    let joined = redact_user_home(&parts.join("\n"));
    Some(joined.chars().take(MAX_VALUE_CHARS).collect())
}

pub(crate) fn crash_event(report: &CrashReport, timestamp: SystemTime) -> Event<'static> {
    let mut tags = BTreeMap::new();
    tags.insert(
        "crash.source".to_string(),
        "macos-diagnostic-report".to_string(),
    );
    tags.insert("crash.incident".to_string(), report.incident_id.clone());
    if report.from_exception_backtrace {
        tags.insert(
            "crash.stack".to_string(),
            "last-exception-backtrace".to_string(),
        );
    }
    let mut contexts = BTreeMap::new();
    if let Some(os_version) = &report.os_version {
        let (version, build) = split_os_version(os_version);
        contexts.insert(
            "os".to_string(),
            Context::Os(Box::new(OsContext {
                name: Some("macOS".to_string()),
                version,
                build,
                ..Default::default()
            })),
        );
    }
    Event {
        level: Level::Fatal,
        platform: Cow::Borrowed("native"),
        timestamp,
        release: Some(Cow::Owned(release_for_app_version(
            report.app_version.as_deref(),
        ))),
        exception: vec![Exception {
            ty: report.exception_type.clone(),
            value: report.exception_value.clone(),
            stacktrace: (!report.frames.is_empty()).then(|| Stacktrace {
                frames: report.frames.clone(),
                ..Default::default()
            }),
            mechanism: Some(Mechanism {
                ty: MECHANISM.to_string(),
                handled: Some(false),
                ..Default::default()
            }),
            ..Default::default()
        }]
        .into(),
        debug_meta: Cow::Owned(DebugMeta {
            images: report.images.clone(),
            ..Default::default()
        }),
        tags: tags.into_iter().collect(),
        contexts: contexts.into_iter().collect(),
        ..Default::default()
    }
}

/// "macOS 26.6 (25G72)" becomes ("26.6", "25G72").
fn split_os_version(value: &str) -> (Option<String>, Option<String>) {
    let value = value.trim().trim_start_matches("macOS").trim();
    match value.split_once('(') {
        Some((version, build)) => (
            Some(version.trim().to_string()).filter(|version| !version.is_empty()),
            Some(build.trim_end_matches(')').trim().to_string()).filter(|build| !build.is_empty()),
        ),
        None => (
            Some(value.to_string()).filter(|value| !value.is_empty()),
            None,
        ),
    }
}

#[derive(Debug, Default, serde::Serialize, serde::Deserialize)]
struct ForwardedState {
    incidents: VecDeque<String>,
}

fn read_state(path: &Path) -> ForwardedState {
    std::fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn write_state(path: &Path, state: &ForwardedState) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let temporary = path.with_extension("json.tmp");
    std::fs::write(
        &temporary,
        serde_json::to_vec(state).map_err(std::io::Error::other)?,
    )?;
    std::fs::rename(temporary, path)
}

/// Recent candidate report files, newest first.
fn candidate_reports(report_dirs: &[PathBuf], now: SystemTime) -> Vec<(PathBuf, SystemTime)> {
    let mut candidates: Vec<(PathBuf, SystemTime)> = report_dirs
        .iter()
        .filter_map(|dir| std::fs::read_dir(dir).ok())
        .flatten()
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name();
            let name = name.to_str()?;
            if !name.starts_with(REPORT_FILE_PREFIX) || !name.ends_with(".ips") {
                return None;
            }
            let metadata = entry.metadata().ok()?;
            if !metadata.is_file() || metadata.len() > MAX_REPORT_BYTES {
                return None;
            }
            let modified = metadata.modified().ok()?;
            let age = now.duration_since(modified).unwrap_or_default();
            (age <= MAX_REPORT_AGE).then(|| (entry.path(), modified))
        })
        .collect();
    candidates.sort_by(|left, right| right.1.cmp(&left.1));
    candidates
}

/// Sends each not-yet-forwarded Drifty crash through `send` and records it.
/// Returns how many reports were forwarded.
pub(crate) fn forward_new_reports(
    report_dirs: &[PathBuf],
    state_path: &Path,
    now: SystemTime,
    mut send: impl FnMut(Event<'static>),
) -> usize {
    let mut state = read_state(state_path);
    let mut forwarded = 0;
    for (path, modified) in candidate_reports(report_dirs, now) {
        if forwarded >= MAX_FORWARDED_PER_LAUNCH {
            break;
        }
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        let Some(report) = parse_crash_report(&text) else {
            continue;
        };
        if state.incidents.contains(&report.incident_id) {
            continue;
        }
        send(crash_event(&report, modified));
        state.incidents.push_back(report.incident_id);
        while state.incidents.len() > REMEMBERED_INCIDENTS {
            state.incidents.pop_front();
        }
        forwarded += 1;
    }
    if forwarded > 0 {
        if let Err(error) = write_state(state_path, &state) {
            eprintln!("[crash-reports] could not record forwarded crash reports: {error}");
        }
    }
    forwarded
}

/// Starts a background pass that forwards crashes from earlier sessions.
/// It waits so it never competes with launch, and does nothing when Sentry is
/// not configured for this build.
#[cfg(target_os = "macos")]
pub fn forward_previous_crashes(app: &tauri::AppHandle) {
    use tauri::Manager;

    const LAUNCH_SETTLE_DELAY: Duration = Duration::from_secs(20);

    if sentry::Hub::current().client().is_none() {
        return;
    }
    let (Ok(home), Ok(app_data)) = (app.path().home_dir(), app.path().app_data_dir()) else {
        return;
    };
    let reports = home.join("Library/Logs/DiagnosticReports");
    let report_dirs = vec![reports.join("Retired"), reports];
    let state_path = app_data.join(STATE_FILE_NAME);
    let spawned = std::thread::Builder::new()
        .name("crash-report-forwarder".to_string())
        .spawn(move || {
            std::thread::sleep(LAUNCH_SETTLE_DELAY);
            let forwarded =
                forward_new_reports(&report_dirs, &state_path, SystemTime::now(), |event| {
                    sentry::capture_event(event);
                });
            if forwarded > 0 {
                eprintln!("[crash-reports] forwarded {forwarded} earlier crash report(s)");
            }
        });
    if let Err(error) = spawned {
        eprintln!("[crash-reports] could not start the crash report forwarder: {error}");
    }
}

#[cfg(not(target_os = "macos"))]
pub fn forward_previous_crashes(_app: &tauri::AppHandle) {}

#[cfg(test)]
#[path = "native_crash_reports_tests.rs"]
mod tests;
