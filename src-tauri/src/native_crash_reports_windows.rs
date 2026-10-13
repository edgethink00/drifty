//! Forward Drifty's own Windows Error Reporting (WER) crash records to Sentry
//! on the next launch.
//!
//! The Rust SDK only sees panics. Heap corruption, a fail-fast abort, an access
//! violation inside a system DLL, or a crash of the tracker or browser host ends
//! the process before any Rust code can report it, so the `Report.wer` file that
//! Windows writes is the only record. On the next launch this module reads
//! Drifty's recent reports and sends the event type, exception code, faulting
//! module with its version and offset, and the Windows version. It never sends
//! the report's process path, loaded-module list, OS inventory, consent keys or
//! any other field, so no activity data or account identity can travel with a
//! crash. Reports from a copy installed elsewhere, such as a QA build next to
//! the installed app, are skipped.

// Only Windows writes these reports; other platforms keep the parser for tests.
#![cfg_attr(not(windows), allow(dead_code))]

use super::{
    read_state, write_state, ForwardedState, RecentCrashSummary, MAX_FORWARDED_PER_LAUNCH,
    MAX_REPORT_AGE, MAX_REPORT_BYTES, MAX_SUMMARIZED_CRASHES, REMEMBERED_INCIDENTS,
};
use crate::observability::release_for_app_version;
use sentry::protocol::{
    Addr, Context, DebugImage, DebugMeta, Event, Exception, Frame, Level, Mechanism, OsContext,
    Stacktrace, SymbolicDebugImage,
};
use std::borrow::Cow;
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub(super) const STATE_FILE_NAME: &str = "windows-crash-reports.json";
const MECHANISM: &str = "windows_error_report";
const REPORT_FILE_NAME: &str = "Report.wer";
/// Executables a Drifty install contains. WER names each report after the
/// executable that crashed.
const DRIFTY_PROCESSES: [&str; 3] = [
    "drifty.exe",
    "drifty-tracker.exe",
    "drifty-browser-host.exe",
];
/// `tauri.windows.conf.json` installs the onedir tracker in this folder below
/// the install directory; the app and browser host sit in the directory itself.
const TRACKER_INSTALL_FOLDER: &str = "drifty-tracker";
/// Seconds between 1601-01-01 (FILETIME) and 1970-01-01 (Unix).
const FILETIME_UNIX_OFFSET_SECONDS: u64 = 11_644_473_600;
const MAX_FIELD_CHARS: usize = 120;

/// One Drifty crash parsed from a WER `Report.wer`.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct WerCrash {
    pub incident_id: String,
    pub event_type: String,
    pub process: String,
    /// Directory of the crashed executable. Used only to skip other installs;
    /// it contains the account name and is never sent.
    pub process_dir: Option<String>,
    pub app_version: Option<String>,
    pub fault_module: Option<String>,
    pub fault_module_version: Option<String>,
    pub fault_module_timestamp: Option<String>,
    pub exception_code: Option<u32>,
    pub exception_offset: Option<String>,
    pub os_version: Option<String>,
    pub event_time: Option<SystemTime>,
}

/// Parses a `Report.wer` and returns it only when it records a crash of one of
/// Drifty's executables. Hangs, other applications and unreadable files return
/// None. Signature names are localized, so values are read by position.
pub(crate) fn parse_report_wer(bytes: &[u8]) -> Option<WerCrash> {
    let text = decode_report(bytes);
    let mut fields: HashMap<&str, &str> = HashMap::new();
    for line in text.lines() {
        if let Some((key, value)) = line.split_once('=') {
            fields.entry(key.trim()).or_insert(value.trim());
        }
    }
    let value = |key: &str| {
        fields
            .get(key)
            .copied()
            .filter(|value| !value.is_empty())
            .map(|value| value.chars().take(MAX_FIELD_CHARS).collect::<String>())
    };
    let sig = |index: usize| value(&format!("Sig[{index}].Value"));

    let event_type = value("EventType")?.to_ascii_uppercase();
    // APPCRASH lists the exception code before its offset; the buffer-overrun
    // (fail-fast) reports BEX/BEX64 list the offset first.
    let (code_index, offset_index) = match event_type.as_str() {
        "APPCRASH" => (6, 7),
        "BEX" | "BEX64" => (7, 6),
        _ => return None,
    };
    let process = sig(0)?.to_ascii_lowercase();
    if !DRIFTY_PROCESSES.contains(&process.as_str()) {
        return None;
    }
    let incident_id = value("ReportIdentifier").filter(|id| is_report_identifier(id))?;

    Some(WerCrash {
        incident_id: incident_id.to_ascii_lowercase(),
        event_type,
        process,
        process_dir: value("AppPath").and_then(|path| parent_dir(&path)),
        app_version: sig(1),
        fault_module: sig(3),
        fault_module_version: sig(4),
        fault_module_timestamp: sig(5).filter(|timestamp| is_hex(timestamp)),
        exception_code: sig(code_index)
            .and_then(|code| parse_hex(&code))
            .map(|code| code as u32),
        exception_offset: sig(offset_index),
        os_version: value("DynamicSig[1].Value").and_then(|version| windows_version(&version)),
        event_time: value("EventTime").and_then(|time| filetime(&time)),
    })
}

fn decode_report(bytes: &[u8]) -> String {
    let utf16 = |bytes: &[u8], little_endian: bool| {
        let units: Vec<u16> = bytes
            .chunks_exact(2)
            .map(|pair| {
                if little_endian {
                    u16::from_le_bytes([pair[0], pair[1]])
                } else {
                    u16::from_be_bytes([pair[0], pair[1]])
                }
            })
            .collect();
        String::from_utf16_lossy(&units)
    };
    match bytes {
        [0xFF, 0xFE, rest @ ..] => utf16(rest, true),
        [0xFE, 0xFF, rest @ ..] => utf16(rest, false),
        [0xEF, 0xBB, 0xBF, rest @ ..] => String::from_utf8_lossy(rest).into_owned(),
        _ => String::from_utf8_lossy(bytes).into_owned(),
    }
}

fn is_report_identifier(value: &str) -> bool {
    value.len() == 36 && value.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

fn is_hex(value: &str) -> bool {
    !value.is_empty() && value.len() <= 16 && value.chars().all(|c| c.is_ascii_hexdigit())
}

fn parse_hex(value: &str) -> Option<u64> {
    let digits = value.trim_start_matches("0x").trim_start_matches("0X");
    is_hex(digits)
        .then(|| u64::from_str_radix(digits, 16).ok())
        .flatten()
}

fn parent_dir(path: &str) -> Option<String> {
    let normalized = normalize_dir(path);
    normalized
        .rsplit_once('\\')
        .map(|(dir, _)| dir.to_string())
        .filter(|dir| !dir.is_empty())
}

/// Where this install places `process`, given its normalized install directory.
fn installed_process_dir(process: &str, install_dir: &str) -> String {
    if process == "drifty-tracker.exe" {
        format!("{install_dir}\\{TRACKER_INSTALL_FOLDER}")
    } else {
        install_dir.to_string()
    }
}

/// Lowercases and unifies separators so a WER path and a Tauri path compare
/// equal; drops the verbatim `\\?\\` prefix and trailing separators.
fn normalize_dir(path: &str) -> String {
    let unified = path.trim().replace('/', "\\").to_ascii_lowercase();
    let without_verbatim = unified.strip_prefix("\\\\?\\").unwrap_or(&unified);
    without_verbatim.trim_end_matches('\\').to_string()
}

/// "10.0.26200.2.0.0.768.101" becomes "10.0.26200".
fn windows_version(value: &str) -> Option<String> {
    let parts: Vec<&str> = value.split('.').take(3).collect();
    (parts.len() == 3
        && parts
            .iter()
            .all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit())))
    .then(|| parts.join("."))
}

/// WER writes EventTime as a decimal FILETIME (100 ns ticks since 1601).
fn filetime(value: &str) -> Option<SystemTime> {
    let ticks: u64 = value.parse().ok()?;
    let seconds = (ticks / 10_000_000).checked_sub(FILETIME_UNIX_OFFSET_SECONDS)?;
    let nanos = (ticks % 10_000_000) * 100;
    UNIX_EPOCH.checked_add(Duration::new(seconds, nanos as u32))
}

/// "1.12.2.0" becomes "1.12.2", the version the app reports elsewhere. The
/// PyInstaller tracker carries no version resource, so WER records it as
/// 0.0.0.0; such a crash belongs to this install and uses the running release.
fn app_release_version(version: &str) -> Option<&str> {
    if version
        .split('.')
        .all(|part| !part.is_empty() && part.chars().all(|c| c == '0'))
    {
        return None;
    }
    let parts: Vec<&str> = version.split('.').collect();
    if parts.len() == 4 && parts[3] == "0" {
        let end = version.len() - 2;
        Some(&version[..end])
    } else {
        Some(version)
    }
}

fn exception_name(code: u32) -> Option<&'static str> {
    Some(match code {
        0xC000_0005 => "EXCEPTION_ACCESS_VIOLATION",
        0xC000_001D => "EXCEPTION_ILLEGAL_INSTRUCTION",
        0xC000_0094 => "EXCEPTION_INT_DIVIDE_BY_ZERO",
        0xC000_00FD => "EXCEPTION_STACK_OVERFLOW",
        0xC000_0374 => "STATUS_HEAP_CORRUPTION",
        0xC000_0409 => "STATUS_STACK_BUFFER_OVERRUN",
        0xC000_0602 => "STATUS_FAIL_FAST_EXCEPTION",
        0x8000_0003 => "EXCEPTION_BREAKPOINT",
        0xE06D_7363 => "MSVC_CPP_EXCEPTION",
        _ => return None,
    })
}

fn file_name(path: &str) -> &str {
    path.rsplit(['\\', '/']).next().unwrap_or(path)
}

/// The image in this process that is byte-identical to the crashed module,
/// recognized by name plus the PE timestamp WER records for it. A Windows code
/// id starts with that same timestamp, so a module that has since been updated
/// or was never loaded here does not match.
fn matching_image(crash: &WerCrash, images: &[DebugImage]) -> Option<SymbolicDebugImage> {
    let module = crash.fault_module.as_deref()?;
    let timestamp = crash.fault_module_timestamp.as_deref()?;
    let timestamp = format!("{:0>8}", timestamp.to_ascii_lowercase());
    images.iter().find_map(|image| match image {
        DebugImage::Symbolic(image)
            if file_name(&image.name).eq_ignore_ascii_case(module)
                && image.code_id.as_ref().is_some_and(|code_id| {
                    code_id
                        .as_str()
                        .to_ascii_lowercase()
                        .starts_with(&timestamp)
                }) =>
        {
            Some(SymbolicDebugImage {
                name: file_name(&image.name).to_string(),
                debug_file: image
                    .debug_file
                    .as_deref()
                    .map(|file| file_name(file).to_string()),
                ..image.clone()
            })
        }
        _ => None,
    })
}

pub(crate) fn wer_crash_event(
    crash: &WerCrash,
    images: &[DebugImage],
    fallback_time: SystemTime,
) -> Event<'static> {
    let code = crash.exception_code;
    let ty = code
        .and_then(exception_name)
        .map(str::to_string)
        .or_else(|| code.map(|code| format!("0x{code:08x}")))
        .unwrap_or_else(|| crash.event_type.clone());
    let mut value = format!(
        "{} {}",
        crash.process,
        crash.app_version.as_deref().unwrap_or("unknown")
    );
    if let Some(code) = code {
        value.push_str(&format!(" stopped with 0x{code:08x}"));
    }
    if let Some(module) = &crash.fault_module {
        value.push_str(&format!(" in {module}"));
        if let Some(version) = &crash.fault_module_version {
            value.push_str(&format!(" {version}"));
        }
    }
    if let Some(offset) = &crash.exception_offset {
        value.push_str(&format!(" at {offset}"));
    }

    let offset = crash.exception_offset.as_deref().and_then(parse_hex);
    let image = offset.and_then(|_| matching_image(crash, images));
    let frames: Vec<Frame> = match (&image, offset) {
        (Some(image), Some(offset)) => vec![Frame {
            instruction_addr: Some(Addr(image.image_addr.0.wrapping_add(offset))),
            package: Some(image.name.clone()),
            ..Default::default()
        }],
        _ => Vec::new(),
    };

    let mut tags = BTreeMap::new();
    tags.insert(
        "crash.source".to_string(),
        "windows-error-report".to_string(),
    );
    tags.insert("crash.incident".to_string(), crash.incident_id.clone());
    tags.insert("crash.event_type".to_string(), crash.event_type.clone());
    tags.insert("crash.process".to_string(), crash.process.clone());
    if let Some(module) = &crash.fault_module {
        tags.insert("crash.module".to_string(), module.clone());
    }
    if let Some(code) = code {
        tags.insert("crash.exception_code".to_string(), format!("0x{code:08x}"));
    }
    let mut contexts = BTreeMap::new();
    if let Some(version) = &crash.os_version {
        contexts.insert(
            "os".to_string(),
            Context::Os(Box::new(OsContext {
                name: Some("Windows".to_string()),
                version: Some(version.clone()),
                ..Default::default()
            })),
        );
    }

    Event {
        level: Level::Fatal,
        platform: Cow::Borrowed("native"),
        timestamp: crash.event_time.unwrap_or(fallback_time),
        release: Some(Cow::Owned(release_for_app_version(
            crash.app_version.as_deref().and_then(app_release_version),
        ))),
        exception: vec![Exception {
            ty,
            value: Some(value),
            stacktrace: (!frames.is_empty()).then(|| Stacktrace {
                frames,
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
        // An explicit (possibly empty) list keeps the SDK from attaching every
        // module of this process, whose paths include the account name.
        debug_meta: Cow::Owned(DebugMeta {
            images: image.into_iter().map(DebugImage::Symbolic).collect(),
            ..Default::default()
        }),
        tags: tags.into_iter().collect(),
        contexts: contexts.into_iter().collect(),
        ..Default::default()
    }
}

/// Recent `Report.wer` files of report folders named after a Drifty
/// executable, newest first.
fn candidate_reports(report_dirs: &[PathBuf], now: SystemTime) -> Vec<(PathBuf, SystemTime)> {
    let mut candidates: Vec<(PathBuf, SystemTime)> = report_dirs
        .iter()
        .filter_map(|dir| std::fs::read_dir(dir).ok())
        .flatten()
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name();
            if !name.to_str()?.to_ascii_lowercase().contains("_drifty") {
                return None;
            }
            let report = entry.path().join(REPORT_FILE_NAME);
            let metadata = std::fs::metadata(&report).ok()?;
            if !metadata.is_file() || metadata.len() > MAX_REPORT_BYTES {
                return None;
            }
            let modified = metadata.modified().ok()?;
            let age = now.duration_since(modified).unwrap_or_default();
            (age <= MAX_REPORT_AGE).then_some((report, modified))
        })
        .collect();
    candidates.sort_by(|left, right| right.1.cmp(&left.1));
    candidates
}

/// Sends each not-yet-forwarded crash of this install through `send` and
/// records it. Returns how many reports were forwarded.
pub(crate) fn forward_new_reports(
    report_dirs: &[PathBuf],
    install_dir: &Path,
    images: &[DebugImage],
    state_path: &Path,
    now: SystemTime,
    mut send: impl FnMut(Event<'static>),
) -> usize {
    let install_dir = normalize_dir(&install_dir.to_string_lossy());
    let mut state: ForwardedState = read_state(state_path);
    let mut forwarded = 0;
    for (path, modified) in candidate_reports(report_dirs, now) {
        if forwarded >= MAX_FORWARDED_PER_LAUNCH {
            break;
        }
        let Ok(bytes) = std::fs::read(&path) else {
            continue;
        };
        let Some(crash) = parse_report_wer(&bytes) else {
            continue;
        };
        if crash.process_dir.as_deref()
            != Some(installed_process_dir(&crash.process, &install_dir).as_str())
        {
            continue;
        }
        if state.incidents.contains(&crash.incident_id) {
            continue;
        }
        send(wer_crash_event(&crash, images, modified));
        state.incidents.push_back(crash.incident_id);
        while state.incidents.len() > REMEMBERED_INCIDENTS {
            state.incidents.pop_front();
        }
        forwarded += 1;
    }
    if forwarded > 0 {
        if let Err(error) = write_state(state_path, &state) {
            eprintln!("[crash-reports] could not record forwarded Windows crash reports: {error}");
        }
    }
    forwarded
}

/// Crashes of this install's executables from the last 14 days, newest
/// first. The kind names the process, so a tracker or browser-host crash is
/// distinguishable from the app itself, and the faulting module the Sentry
/// event already carries.
pub(crate) fn summarize_recent_reports(
    report_dirs: &[PathBuf],
    install_dir: &Path,
    now: SystemTime,
) -> Vec<RecentCrashSummary> {
    let install_dir = normalize_dir(&install_dir.to_string_lossy());
    candidate_reports(report_dirs, now)
        .into_iter()
        .filter_map(|(path, modified)| {
            let bytes = std::fs::read(&path).ok()?;
            let crash = parse_report_wer(&bytes)?;
            if crash.process_dir.as_deref()
                != Some(installed_process_dir(&crash.process, &install_dir).as_str())
            {
                return None;
            }
            let mut kind = format!("{} {}", crash.process, crash.event_type);
            if let Some(code) = crash.exception_code {
                kind.push_str(&format!(" 0x{code:08x}"));
            }
            if let Some(module) = &crash.fault_module {
                kind.push_str(&format!(" in {module}"));
            }
            let occurred_at = crash.event_time.unwrap_or(modified);
            Some(RecentCrashSummary {
                incident_id: crash.incident_id,
                kind,
                app_version: crash.app_version,
                occurred_at_ms: occurred_at
                    .duration_since(UNIX_EPOCH)
                    .map(|elapsed| u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX))
                    .unwrap_or(0),
            })
        })
        .take(MAX_SUMMARIZED_CRASHES)
        .collect()
}

/// Per-user crashes are filed in the machine store with an ACL for the
/// crashing account; some configurations use the per-user store instead.
#[cfg(windows)]
fn wer_report_dirs() -> Vec<PathBuf> {
    ["ProgramData", "LOCALAPPDATA"]
        .iter()
        .filter_map(|name| std::env::var_os(name).map(PathBuf::from))
        .flat_map(|base| {
            let wer = base.join("Microsoft").join("Windows").join("WER");
            [wer.join("ReportArchive"), wer.join("ReportQueue")]
        })
        .collect()
}

#[cfg(windows)]
pub(super) fn recent_crash_summaries() -> Vec<RecentCrashSummary> {
    let Some(install_dir) = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
    else {
        return Vec::new();
    };
    summarize_recent_reports(&wer_report_dirs(), &install_dir, SystemTime::now())
}

/// Starts a background pass that forwards WER crash records of earlier
/// sessions. It waits so it never competes with launch, and does nothing when
/// Sentry is not configured for this build.
#[cfg(windows)]
pub(super) fn forward_previous_crashes(app: &tauri::AppHandle) {
    use tauri::Manager;

    const LAUNCH_SETTLE_DELAY: Duration = Duration::from_secs(20);

    if sentry::Hub::current().client().is_none() {
        return;
    }
    let Ok(app_data) = app.path().app_data_dir() else {
        return;
    };
    let Some(install_dir) = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
    else {
        return;
    };
    let report_dirs = wer_report_dirs();
    let state_path = app_data.join(STATE_FILE_NAME);
    let spawned = std::thread::Builder::new()
        .name("wer-crash-report-forwarder".to_string())
        .spawn(move || {
            std::thread::sleep(LAUNCH_SETTLE_DELAY);
            let images = sentry::integrations::debug_images::debug_images();
            let forwarded = forward_new_reports(
                &report_dirs,
                &install_dir,
                &images,
                &state_path,
                SystemTime::now(),
                |event| {
                    sentry::capture_event(event);
                },
            );
            if forwarded > 0 {
                eprintln!("[crash-reports] forwarded {forwarded} earlier Windows crash report(s)");
            }
        });
    if let Err(error) = spawned {
        eprintln!("[crash-reports] could not start the Windows crash report forwarder: {error}");
    }
}

#[cfg(test)]
#[path = "native_crash_reports_windows_tests.rs"]
mod tests;
