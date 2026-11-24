//! Fixed local activity IPC. No capture, account, network or telemetry setup.
//! Native callers own the selected absolute database and producer paths.

use chrono::{DateTime, Utc};
mod clock;
use clock::{ceil_ms, timestamp_micros};
use rusqlite::{
    functions::FunctionFlags, params_from_iter, types::ValueRef, Connection, OpenFlags,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    io::{Read, Write},
    path::Path,
    sync::OnceLock,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

const MAX_MS: i64 = 253_402_300_799_999;
const COLUMNS: &str = "id,segment_uid,started_at,ended_at,platform,source,bundle_id,window_title,origin_device_id,exclusion_source,engagement_evidence,confidence,site_domain,site_source";
/// Safari reports no private mode to scripting, so its private windows are
/// found by their title label on every path. Its address-bar read takes the
/// focused window's title and address in one accessibility pass, so a row
/// from it (confidence 0.8, never while the field is being edited) vouches
/// like a scripted tab. Same rule as the Python reader.
const ADDRESS_BAR_VOUCHED_BUNDLES: [&str; 2] = ["com.apple.Safari", "com.apple.SafariTechnologyPreview"];
type Result<T> = std::result::Result<T, ()>;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    protocol_version: u8,
    request_id: String,
    operation: Box<serde_json::value::RawValue>,
}
enum Operation {
    Read {
        replay: bool,
        record_ids: Vec<String>,
    },
    Resolve {
        app_key: String,
        title_digest: String,
        observed_at_ms: Box<serde_json::value::RawValue>,
    },
}
fn parse_operation(raw: &serde_json::value::RawValue) -> Result<Operation> {
    #[derive(Deserialize)]
    struct Kind {
        kind: String,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct ReadOperation {
        kind: String,
        record_ids: Vec<String>,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct ResolveOperation {
        kind: String,
        app_key: String,
        title_digest: String,
        observed_at_ms: Box<serde_json::value::RawValue>,
    }
    let kind: Kind = serde_json::from_str(raw.get()).map_err(|_| ())?;
    match kind.kind.as_str() {
        "read" | "read_replay" => {
            let value: ReadOperation = serde_json::from_str(raw.get()).map_err(|_| ())?;
            if value.kind != kind.kind {
                return Err(());
            }
            Ok(Operation::Read {
                replay: value.kind == "read_replay",
                record_ids: value.record_ids,
            })
        }
        "resolve" => {
            let value: ResolveOperation = serde_json::from_str(raw.get()).map_err(|_| ())?;
            if value.kind != "resolve" {
                return Err(());
            }
            Ok(Operation::Resolve {
                app_key: value.app_key,
                title_digest: value.title_digest,
                observed_at_ms: value.observed_at_ms,
            })
        }
        _ => Err(()),
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Response {
    protocol_version: u8,
    proof_version: u8,
    request_id: String,
    records: Vec<Reference>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Reference {
    record_id: String,
    segment_uid: String,
    identity_digest: String,
    started_at_ms: i64,
    ended_at_ms: i64,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    revoked_ranges: Vec<[i64; 2]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    site_digest: Option<String>,
}
impl Reference {
    fn contains(&self, point: i64) -> bool {
        self.started_at_ms <= point
            && point < self.ended_at_ms
            && !self
                .revoked_ranges
                .iter()
                .any(|r| r[0] <= point && point < r[1])
    }
}
struct RawRecord {
    id: Option<String>,
    uid: Option<String>,
    start: Option<String>,
    end: Option<String>,
    platform: Option<String>,
    source: Option<String>,
    app: Option<String>,
    title: Option<String>,
    local: bool,
    confidence: Option<f64>,
    site: Option<String>,
    site_source: Option<String>,
}
struct Fence {
    epoch: String,
    ranges: BTreeMap<String, Vec<[i64; 2]>>,
}

fn uuid_ok(value: &str) -> bool {
    value.len() == 36
        && Uuid::parse_str(value)
            .is_ok_and(|id| !id.is_nil() && id.hyphenated().to_string() == value)
}
fn record_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 19
        && !value.starts_with('0')
        && value.bytes().all(|b| b.is_ascii_digit())
        && value.parse::<i64>().is_ok_and(|v| v > 0)
}
fn bounded(value: &str, limit: usize) -> bool {
    value.len() <= limit
        && !value.trim().is_empty()
        && !value.chars().any(|c| (c as u32) < 32 || c == '\u{7f}')
}
fn hex(value: &str, size: usize) -> bool {
    value.len() == size
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
/// Same versioned digest as the Python reader; the domain never crosses IPC.
fn site_digest(site: &str) -> Option<String> {
    (bounded(site, 253) && site.is_ascii()).then(|| {
        let mut hash = Sha256::new();
        hash.update(b"drifty-site-v1\0");
        hash.update(site.trim().to_ascii_lowercase().as_bytes());
        format!("{:x}", hash.finalize())
    })
}
/// Rows carry no private-window flag. Only the tracker's skip policy makes a
/// matching row imply a normal window, so only then may a site be vouched for.
fn private_windows_skipped(connection: &Connection) -> Result<bool> {
    let value: Option<Option<String>> = connection
        .query_row(
            "SELECT value FROM tracker_meta WHERE key='capture_policy_private_windows'",
            [],
            |row| row.get(0),
        )
        .map(Some)
        .or_else(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            _ => Err(()),
        })?;
    Ok(matches!(value, None | Some(None)) || value == Some(Some("skip".into())))
}
fn title_digest(title: &str) -> Option<String> {
    bounded(title, 2048).then(|| {
        let mut hash = Sha256::new();
        hash.update(b"drifty-window-title-v1\0");
        hash.update(title.as_bytes());
        format!("{:x}", hash.finalize())
    })
}
fn platform() -> Option<(&'static str, &'static str)> {
    cfg!(target_os = "macos").then_some(("macos", "accessibility"))
}

fn regular(path: &Path) -> bool {
    if !path.is_absolute() {
        return false;
    }
    let Ok(m) = std::fs::symlink_metadata(path) else {
        return false;
    };
    if !m.is_file() || m.file_type().is_symlink() {
        return false;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if m.file_attributes() & 0x400 != 0 {
            return false;
        }
    }
    true
}
fn connect(path: &Path) -> Result<(Connection, Instant)> {
    if !regular(path) {
        return Err(());
    }
    let deadline = Instant::now() + Duration::from_millis(50);
    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|_| ())?;
    connection
        .execute_batch("PRAGMA query_only=ON; PRAGMA busy_timeout=50;")
        .map_err(|_| ())?;
    connection
        .progress_handler(1000, Some(move || Instant::now() >= deadline))
        .map_err(|_| ())?;
    connection
        .create_scalar_function(
            "screen_title_digest",
            1,
            FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC,
            |ctx| match ctx.get_raw(0) {
                ValueRef::Text(bytes) => std::str::from_utf8(bytes)
                    .map(title_digest)
                    .map_err(|e| rusqlite::Error::UserFunctionError(Box::new(e))),
                _ => Ok(None),
            },
        )
        .map_err(|_| ())?;
    connection.execute_batch("BEGIN").map_err(|_| ())?;
    Ok((connection, deadline))
}
fn text(row: &rusqlite::Row<'_>, index: usize) -> Result<Option<String>> {
    match row.get_ref(index).map_err(|_| ())? {
        ValueRef::Text(value) => Ok(Some(std::str::from_utf8(value).map_err(|_| ())?.to_owned())),
        _ => Ok(None),
    }
}
fn raw(row: &rusqlite::Row<'_>) -> Result<RawRecord> {
    let id = match row.get_ref(0).map_err(|_| ())? {
        ValueRef::Integer(v) => Some(v.to_string()),
        ValueRef::Text(v) => Some(std::str::from_utf8(v).map_err(|_| ())?.to_owned()),
        _ => None,
    };
    let confidence = match row.get_ref(11).map_err(|_| ())? {
        ValueRef::Real(v) => Some(v),
        ValueRef::Integer(v) => Some(v as f64),
        _ => None,
    };
    Ok(RawRecord {
        id,
        uid: text(row, 1)?,
        start: text(row, 2)?,
        end: text(row, 3)?,
        platform: text(row, 4)?,
        source: text(row, 5)?,
        app: text(row, 6)?,
        title: text(row, 7)?,
        local: (8..=10).all(|i| matches!(row.get_ref(i), Ok(ValueRef::Null))),
        confidence,
        site: text(row, 12)?,
        site_source: text(row, 13)?,
    })
}
fn query(
    connection: &Connection,
    sql: &str,
    params: &[rusqlite::types::Value],
) -> Result<Vec<RawRecord>> {
    let mut statement = connection.prepare(sql).map_err(|_| ())?;
    let mut rows = statement
        .query(params_from_iter(params.iter()))
        .map_err(|_| ())?;
    let mut result = Vec::new();
    while let Some(row) = rows.next().map_err(|_| ())? {
        result.push(raw(row)?);
    }
    Ok(result)
}
fn schema() -> Option<&'static Vec<(String, String)>> {
    static SCHEMA: OnceLock<Option<Vec<(String, String)>>> = OnceLock::new();
    SCHEMA
        .get_or_init(|| serde_json::from_str(include_str!("fence-schema-v1.json")).ok())
        .as_ref()
}
fn fence(connection: &Connection, rows: &[RawRecord]) -> Result<Fence> {
    let mut statement = connection
        .prepare("SELECT name,sql FROM sqlite_master WHERE name LIKE 'screen_context_activity_%'")
        .map_err(|_| ())?;
    let objects = statement
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|_| ())?
        .collect::<std::result::Result<BTreeMap<_, _>, _>>()
        .map_err(|_| ())?;
    let expected = schema().ok_or(())?;
    if objects.len() != expected.len()
        || expected
            .iter()
            .any(|(key, sql)| objects.get(key).is_none_or(|v| v.trim() != sql.trim()))
    {
        return Err(());
    }
    let mut meta = connection
        .prepare("SELECT id,version,epoch FROM screen_context_activity_meta")
        .map_err(|_| ())?;
    let values = meta
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .map_err(|_| ())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|_| ())?;
    if values.len() != 1 || values[0].0 != 1 || values[0].1 != 1 || !hex(&values[0].2, 32) {
        return Err(());
    }
    let uids = rows
        .iter()
        .filter_map(|r| r.uid.clone())
        .collect::<BTreeSet<_>>();
    if uids.len() > 64 {
        return Err(());
    }
    let mut ranges: BTreeMap<String, Vec<[i64; 2]>> = BTreeMap::new();
    if !uids.is_empty() {
        let placeholders = vec!["?"; uids.len()].join(",");
        let sql = format!("SELECT segment_uid,from_ms,to_ms FROM screen_context_activity_revocations WHERE segment_uid IN ({placeholders}) ORDER BY segment_uid,from_ms,to_ms LIMIT 4097");
        let mut statement = connection.prepare(&sql).map_err(|_| ())?;
        let points = statement
            .query_map(params_from_iter(uids.iter()), |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, i64>(2)?,
                ))
            })
            .map_err(|_| ())?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|_| ())?;
        if points.len() > 4096 {
            return Err(());
        }
        for (uid, start, end) in points {
            if !(0 <= start && start < end && end <= MAX_MS) {
                return Err(());
            }
            let values = ranges.entry(uid).or_default();
            if let Some(last) = values.last_mut().filter(|last| start <= last[1]) {
                last[1] = last[1].max(end);
            } else {
                values.push([start, end]);
            }
            if values.len() > 64 {
                return Err(());
            }
        }
    }
    Ok(Fence {
        epoch: values[0].2.clone(),
        ranges,
    })
}
fn reference(row: &RawRecord, fence: &Fence, sites: bool) -> Option<Reference> {
    reference_for(row, fence, sites, false)
}
fn vouched(row: &RawRecord) -> bool {
    row.confidence == Some(1.0)
        || (row.confidence == Some(0.8)
            && row.site_source.as_deref() == Some("accessibility-address-bar")
            && row
                .app
                .as_deref()
                .is_some_and(|app| ADDRESS_BAR_VOUCHED_BUNDLES.contains(&app)))
}
fn reference_for(row: &RawRecord, fence: &Fence, sites: bool, replay: bool) -> Option<Reference> {
    let (expected_platform, expected_source) = platform()?;
    if !row.local
        || (!replay && !vouched(row))
        || (replay
            && row
                .confidence
                .is_none_or(|v| !v.is_finite() || !(0.0..=1.0).contains(&v)))
        || row.platform.as_deref() != Some(expected_platform)
        || !(row.source.as_deref() == Some(expected_source)
            || (replay
                && expected_platform == "macos"
                && matches!(row.source.as_deref(), Some("nsworkspace" | "lsappinfo"))))
    {
        return None;
    }
    let id = row.id.as_ref()?;
    let uid = row.uid.as_ref()?;
    let app = row.app.as_ref()?;
    if !record_id(id) || !uuid_ok(uid) || !bounded(app, 2048) {
        return None;
    }
    let title = if replay {
        // No content inference: a stable opaque identity for this local row.
        digest(&serde_json::to_vec(&(&row.title, &row.source, row.confidence)).ok()?)
    } else {
        title_digest(row.title.as_ref()?)?
    };
    let start = timestamp_micros(row.start.as_ref()?)?;
    let end = timestamp_micros(row.end.as_ref()?)?;
    let (start_ms, end_ms) = (ceil_ms(start), ceil_ms(end));
    if end <= start || start_ms < 0 || end_ms > MAX_MS || end_ms <= start_ms {
        return None;
    }
    let identity = serde_json::to_vec(&[
        if replay {
            "tracker-replay-record-v1"
        } else {
            "tracker-local-record-v1"
        },
        id,
        uid,
        expected_platform,
        row.source.as_deref()?,
        app,
        &title,
        "point-fence-v1",
        &fence.epoch,
    ])
    .ok()?;
    Some(Reference {
        record_id: id.clone(),
        segment_uid: uid.clone(),
        identity_digest: digest(&identity),
        started_at_ms: start_ms,
        ended_at_ms: end_ms,
        revoked_ranges: fence.ranges.get(uid).cloned().unwrap_or_default(),
        site_digest: if sites {
            row.site.as_deref().and_then(site_digest)
        } else {
            None
        },
    })
}
fn current_ms() -> Option<i64> {
    i64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .ok()?
            .as_millis(),
    )
    .ok()
}
fn resolve(path: &Path, app: &str, title: &str, point: i64, now: i64) -> Result<Vec<Reference>> {
    if !(0 <= point && point <= now && now <= MAX_MS) || now - point > 10_000 {
        return Ok(Vec::new());
    }
    let (connection, deadline) = connect(path)?;
    if Instant::now() >= deadline {
        return Err(());
    }
    let iso = DateTime::<Utc>::from_timestamp_millis(point)
        .ok_or(())?
        .to_rfc3339();
    let sql = format!("SELECT {COLUMNS} FROM activity_segments WHERE origin_device_id IS NULL AND platform=? AND bundle_id=? AND datetime(started_at)<=datetime(?) AND datetime(ended_at)>=datetime(?) AND CASE WHEN length(window_title)<=2048 THEN screen_title_digest(window_title) END=? LIMIT ?");
    let params = vec![
        platform().ok_or(())?.0.to_owned().into(),
        app.to_owned().into(),
        iso.clone().into(),
        iso.into(),
        title.to_owned().into(),
        65_i64.into(),
    ];
    let rows = query(&connection, &sql, &params)?;
    if rows.len() > 64 || Instant::now() >= deadline {
        return Err(());
    }
    let fence = fence(&connection, &rows)?;
    let sites = private_windows_skipped(&connection)?;
    let matches = rows
        .iter()
        .filter_map(|r| reference(r, &fence, sites))
        .filter(|r| r.contains(point))
        .collect::<Vec<_>>();
    if Instant::now() >= deadline {
        return Err(());
    }
    Ok(if matches.len() == 1 {
        matches
    } else {
        Vec::new()
    })
}
fn read_refs(path: &Path, ids: &[String], replay: bool) -> Result<Vec<Reference>> {
    let (connection, deadline) = connect(path)?;
    let sql = format!(
        "SELECT {COLUMNS} FROM activity_segments WHERE id IN ({})",
        vec!["?"; ids.len()].join(",")
    );
    let params = ids
        .iter()
        .map(|s| {
            s.parse::<i64>()
                .map(rusqlite::types::Value::Integer)
                .map_err(|_| ())
        })
        .collect::<Result<Vec<_>>>()?;
    if Instant::now() >= deadline {
        return Err(());
    }
    let rows = query(&connection, &sql, &params)?;
    if Instant::now() >= deadline {
        return Err(());
    }
    let fence = fence(&connection, &rows)?;
    let mut refs = rows
        .iter()
        .filter_map(|r| reference_for(r, &fence, false, replay))
        .map(|r| (r.record_id.clone(), r))
        .collect::<BTreeMap<_, _>>();
    if Instant::now() >= deadline {
        return Err(());
    }
    Ok(ids.iter().filter_map(|id| refs.remove(id)).collect())
}
fn dispatch(path: &Path, bytes: &[u8]) -> Result<Response> {
    let request: Request = serde_json::from_slice(bytes).map_err(|_| ())?;
    if request.protocol_version != 2 || !uuid_ok(&request.request_id) {
        return Err(());
    }
    let records = match parse_operation(&request.operation)? {
        Operation::Read { record_ids, replay } => {
            if record_ids.is_empty()
                || record_ids.len() > 64
                || record_ids.iter().any(|id| !record_id(id))
                || record_ids.iter().collect::<BTreeSet<_>>().len() != record_ids.len()
            {
                return Err(());
            }
            // An unavailable reader cannot grant an authoritative empty
            // snapshot: memory reconciliation would mistake it for deletion.
            read_refs(path, &record_ids, replay)?
        }
        Operation::Resolve {
            app_key,
            title_digest,
            observed_at_ms,
        } => {
            let integer = observed_at_ms.get();
            if !bounded(&app_key, 256)
                || !hex(&title_digest, 64)
                || !integer
                    .strip_prefix('-')
                    .unwrap_or(integer)
                    .bytes()
                    .all(|b| b.is_ascii_digit())
            {
                return Err(());
            }
            match (integer.parse::<i64>().ok(), current_ms()) {
                (Some(point), Some(now)) => {
                    resolve(path, &app_key, &title_digest, point, now).unwrap_or_default()
                }
                _ => Vec::new(),
            }
        }
    };
    Ok(Response {
        protocol_version: 2,
        proof_version: 1,
        request_id: request.request_id,
        records,
    })
}
fn reader(path: &Path) -> u8 {
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut input = stdin.lock();
    let mut output = stdout.lock();
    if output
        .write_all(b"SBR2")
        .and_then(|_| output.flush())
        .is_err()
    {
        return 2;
    }
    for _ in 0..64 {
        let mut header = [0; 4];
        if let Err(error) = input.read_exact(&mut header) {
            return if error.kind() == std::io::ErrorKind::UnexpectedEof {
                0
            } else {
                2
            };
        }
        let size = u32::from_be_bytes(header) as usize;
        if !(1..=2048).contains(&size) {
            return 2;
        }
        let mut bytes = vec![0; size];
        if let Err(error) = input.read_exact(&mut bytes) {
            return if error.kind() == std::io::ErrorKind::UnexpectedEof {
                0
            } else {
                2
            };
        }
        let Ok(response) = dispatch(path, &bytes) else {
            return 2;
        };
        let Ok(encoded) = serde_json::to_vec(&response) else {
            return 2;
        };
        if encoded.len() > 16 * 1024 {
            return 2;
        }
        if output
            .write_all(&(encoded.len() as u32).to_be_bytes())
            .and_then(|_| output.write_all(&encoded))
            .and_then(|_| output.write_all(b"SBE2"))
            .and_then(|_| output.write_all(response.request_id.as_bytes()))
            .and_then(|_| output.flush())
            .is_err()
        {
            return 2;
        }
    }
    0
}
fn objects_exist(connection: &Connection) -> Result<bool> {
    connection.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name LIKE 'screen_context_activity_%')", [], |row| row.get(0)).map_err(|_| ())
}
fn sql_equal(a: ValueRef<'_>, b: ValueRef<'_>) -> bool {
    match (a, b) {
        (ValueRef::Integer(a), ValueRef::Real(b)) | (ValueRef::Real(b), ValueRef::Integer(a)) => {
            b.is_finite() && b.fract() == 0.0 && b as i128 == a as i128
        }
        _ => a == b,
    }
}
fn sql_clock(value: ValueRef<'_>) -> Option<i64> {
    let ValueRef::Text(bytes) = value else {
        return None;
    };
    let value = ceil_ms(timestamp_micros(std::str::from_utf8(bytes).ok()?)?);
    (0..=MAX_MS).contains(&value).then_some(value)
}
fn register_clock(connection: &Connection) -> Result<()> {
    let flags = FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC;
    connection
        .create_scalar_function("screen_ceil_ms", 1, flags, |ctx| {
            Ok(sql_clock(ctx.get_raw(0)))
        })
        .map_err(|_| ())?;
    connection
        .create_scalar_function("screen_end_shrunk", 2, flags, |ctx| {
            let (a, b) = (ctx.get_raw(0), ctx.get_raw(1));
            Ok(!sql_equal(a, b)
                && match (sql_clock(a), sql_clock(b)) {
                    (Some(before), Some(after)) => after < before,
                    _ => true,
                })
        })
        .map_err(|_| ())?;
    Ok(())
}
fn fingerprint(producer: &Path) -> Result<String> {
    if !regular(producer) {
        return Err(());
    }
    let normalized = producer.components().collect::<std::path::PathBuf>();
    let name = normalized.to_str().ok_or(())?.to_owned();
    #[cfg(unix)]
    let name = if producer.as_os_str().as_encoded_bytes().starts_with(b"//")
        && !producer.as_os_str().as_encoded_bytes().starts_with(b"///")
    {
        format!("/{name}")
    } else {
        name
    };
    let mut hash = Sha256::new();
    hash.update(b"frozen\0");
    hash.update(name.as_bytes());
    hash.update(b"\0");
    let mut file = std::fs::File::open(producer).map_err(|_| ())?;
    let mut bytes = [0; 128 * 1024];
    loop {
        let count = file.read(&mut bytes).map_err(|_| ())?;
        if count == 0 {
            break;
        }
        hash.update(&bytes[..count]);
    }
    Ok(format!("{:x}", hash.finalize()))
}
fn prepare_transaction(path: &Path, fingerprint: &str) -> Result<u8> {
    let deadline = Instant::now() + Duration::from_millis(200);
    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|_| ())?;
    connection
        .execute_batch("PRAGMA busy_timeout=50")
        .map_err(|_| ())?;
    connection
        .progress_handler(1000, Some(move || Instant::now() >= deadline))
        .map_err(|_| ())?;
    connection.execute_batch("BEGIN").map_err(|_| ())?;
    if objects_exist(&connection)? {
        fence(&connection, &[])?;
        connection.execute_batch("ROLLBACK").map_err(|_| ())?;
        return Ok(0);
    }
    connection
        .execute_batch("ROLLBACK;BEGIN IMMEDIATE")
        .map_err(|_| ())?;
    if objects_exist(&connection)? {
        fence(&connection, &[])?;
        connection.execute_batch("ROLLBACK").map_err(|_| ())?;
        return Ok(0);
    }
    let mut statement = connection
        .prepare("SELECT value FROM tracker_meta WHERE key='tracker_runtime_fingerprint'")
        .map_err(|_| ())?;
    let mut rows = statement.query([]).map_err(|_| ())?;
    let matches = match rows.next().map_err(|_| ())? {
        Some(row) => match row.get_ref(0).map_err(|_| ())? {
            ValueRef::Text(value) => value == fingerprint.as_bytes(),
            _ => false,
        },
        None => false,
    };
    drop(rows);
    drop(statement);
    if !matches {
        connection.execute_batch("ROLLBACK").map_err(|_| ())?;
        return Ok(1);
    }
    register_clock(&connection)?;
    for (_, sql) in schema().ok_or(())? {
        connection.execute(sql, []).map_err(|_| ())?;
    }
    connection
        .execute(
            "INSERT INTO screen_context_activity_meta VALUES(1,1,lower(hex(randomblob(16))))",
            [],
        )
        .map_err(|_| ())?;
    fence(&connection, &[])?;
    if Instant::now() >= deadline {
        return Err(());
    }
    connection.execute_batch("COMMIT").map_err(|_| ())?;
    Ok(0)
}
fn prepare(path: &Path, producer: &Path) -> u8 {
    let Ok(fingerprint) = fingerprint(producer) else {
        return 3;
    };
    if !path.is_absolute() {
        return 3;
    }
    match std::fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return 2,
        Err(_) => return 3,
        _ => {}
    }
    if !regular(path) {
        return 3;
    }
    prepare_transaction(path, &fingerprint).unwrap_or(3)
}
pub fn run(args: &[std::ffi::OsString]) -> u8 {
    // Windows retains its existing packaged Python reader. This candidate
    // follows the macOS tracker's pinned Python 3.9 timestamp grammar.
    if !cfg!(target_os = "macos") {
        return 2;
    }
    if args.len() == 3 && args[0] == "screen-context-activity-reader-v2" && args[1] == "--db" {
        let path = Path::new(&args[2]);
        if path.is_absolute() {
            return reader(path);
        }
    }
    if args.len() == 5
        && args[0] == "screen-context-activity-prepare-v1"
        && args[1] == "--db"
        && args[3] == "--producer-runtime"
    {
        let state = prepare(Path::new(&args[2]), Path::new(&args[4]));
        let mut output = std::io::stdout().lock();
        return if output
            .write_all(b"SBP1")
            .and_then(|_| output.write_all(&[state]))
            .and_then(|_| output.flush())
            .is_ok()
        {
            0
        } else {
            2
        };
    }
    2
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn timestamp_fraction_offsets_and_integer_lattice() {
        assert_eq!(timestamp_micros("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(timestamp_micros("1970-01-01T09:00:00+09:00"), Some(0));
        assert_eq!(
            timestamp_micros("1970-01-01 00:00:00.0005009+00:00"),
            Some(500)
        );
        assert_eq!(ceil_ms(500), 1);
        assert_eq!(ceil_ms(-500), 0);
        assert_eq!(timestamp_micros("2026-01-01T00:00:00"), None);
        assert_eq!(timestamp_micros("2026-01-01T00:00:00+24:00"), None);
    }
    #[test]
    fn malformed_wire_has_no_db_path_or_sql_extension() {
        for input in [
            r#"{"protocolVersion":2,"requestId":"00000000-0000-0000-0000-000000000000","operation":{"kind":"read","recordIds":["1"]}}"#,
            r#"{"protocolVersion":2,"requestId":"bde04722-6ec7-4d55-bf3c-9b4ee750860d","operation":{"kind":"read","recordIds":["1"]},"dbPath":"/forbidden"}"#,
            r#"{"protocolVersion":2,"requestId":"bde04722-6ec7-4d55-bf3c-9b4ee750860d","operation":{"kind":"query","sql":"SELECT 1"}}"#,
            r#"{"protocolVersion":2,"protocolVersion":2,"requestId":"bde04722-6ec7-4d55-bf3c-9b4ee750860d","operation":{"kind":"read","recordIds":["1"]}}"#,
        ] {
            assert!(dispatch(Path::new("/synthetic-missing"), input.as_bytes()).is_err());
        }
    }
}
