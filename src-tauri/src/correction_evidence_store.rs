use chrono::DateTime;
use serde_json::Value;
use std::{
    fs::{self, File, OpenOptions},
    io::{ErrorKind, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

const EVIDENCE_DIRECTORY_NAME: &str = "correction-evidence";
const EVIDENCE_FILE_NAME: &str = "corrections.jsonl";
const EVIDENCE_SCHEMA: &str = "drifty.correction-evidence/v1";
const MAX_RECORD_BYTES: usize = 32 * 1024;
const MAX_RECORDS: usize = 512;
const MAX_EXISTING_JOURNAL_BYTES: u64 = 20 * 1024 * 1024;
static TEMPORARY_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

pub(crate) fn append_correction_evidence(
    app_data_dir: &Path,
    scope: &str,
    record_json: &str,
) -> Result<(), String> {
    validate_scope(scope)?;
    validate_record(record_json)?;
    let path = correction_evidence_path(app_data_dir, scope);
    let parent = path
        .parent()
        .ok_or_else(|| "Correction evidence path has no parent directory.".to_string())?;
    fs::create_dir_all(parent).map_err(|error| {
        format!(
            "Unable to create correction evidence directory at {}: {error}",
            parent.display()
        )
    })?;
    reject_symlink_directory(&app_data_dir.join(EVIDENCE_DIRECTORY_NAME))?;
    reject_symlink_directory(parent)?;
    restrict_directory_permissions(&app_data_dir.join(EVIDENCE_DIRECTORY_NAME))?;
    restrict_directory_permissions(parent)?;

    let mut records = read_existing_records(&path)?;
    records.push(record_json.to_string());
    if records.len() > MAX_RECORDS {
        records.drain(..records.len() - MAX_RECORDS);
    }
    let contents = format!("{}\n", records.join("\n"));
    atomic_write(&path, &contents)
}

fn read_existing_records(path: &Path) -> Result<Vec<String>, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err("Correction evidence path must be a regular file.".to_string());
            }
            if metadata.len() > MAX_EXISTING_JOURNAL_BYTES {
                return Err("Correction evidence journal exceeds its safety limit.".to_string());
            }
        }
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(format!("Unable to inspect correction evidence: {error}")),
    }
    let contents = fs::read_to_string(path)
        .map_err(|error| format!("Unable to read correction evidence: {error}"))?;
    let records = contents
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    for record in &records {
        validate_record(record)?;
    }
    Ok(records)
}

fn validate_record(record_json: &str) -> Result<(), String> {
    if record_json.is_empty() || record_json.len() > MAX_RECORD_BYTES {
        return Err(format!(
            "Correction evidence record must be 1-{MAX_RECORD_BYTES} bytes."
        ));
    }
    if record_json.contains('\n') || record_json.contains('\r') {
        return Err("Correction evidence record must occupy one JSONL line.".to_string());
    }
    let value: Value = serde_json::from_str(record_json)
        .map_err(|_| "Correction evidence record must be valid JSON.".to_string())?;
    let record = value
        .as_object()
        .ok_or_else(|| "Correction evidence record must be an object.".to_string())?;
    if record.get("schema").and_then(Value::as_str) != Some(EVIDENCE_SCHEMA) {
        return Err("Correction evidence schema is invalid.".to_string());
    }
    validate_hash_field(record.get("eventId"), "eventId")?;
    let recorded_at = record
        .get("recordedAt")
        .and_then(Value::as_str)
        .ok_or_else(|| "Correction evidence recordedAt is missing.".to_string())?;
    DateTime::parse_from_rfc3339(recorded_at)
        .map_err(|_| "Correction evidence recordedAt is invalid.".to_string())?;
    let activity_keys = record
        .get("activityKeys")
        .and_then(Value::as_object)
        .ok_or_else(|| "Correction evidence activityKeys are missing.".to_string())?;
    validate_hash_field(activity_keys.get("surface"), "activityKeys.surface")?;
    validate_hash_field(activity_keys.get("detail"), "activityKeys.detail")?;
    reject_forbidden_fields(&value, "record")?;
    Ok(())
}

fn reject_forbidden_fields(value: &Value, path: &str) -> Result<(), String> {
    match value {
        Value::Array(items) => {
            for (index, item) in items.iter().enumerate() {
                reject_forbidden_fields(item, &format!("{path}[{index}]"))?;
            }
        }
        Value::Object(record) => {
            for (key, nested) in record {
                if matches!(
                    key.as_str(),
                    "contextSegments"
                        | "endedAt"
                        | "rawHistory"
                        | "segmentId"
                        | "sourceSegmentId"
                        | "startedAt"
                ) {
                    return Err(format!(
                        "Correction evidence field {path}.{key} is forbidden."
                    ));
                }
                reject_forbidden_fields(nested, &format!("{path}.{key}"))?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn validate_hash_field(value: Option<&Value>, label: &str) -> Result<(), String> {
    let value = value
        .and_then(Value::as_str)
        .ok_or_else(|| format!("Correction evidence {label} is missing."))?;
    let valid = value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte));
    if valid {
        Ok(())
    } else {
        Err(format!(
            "Correction evidence {label} must be a lowercase SHA-256 digest."
        ))
    }
}

fn atomic_write(path: &Path, contents: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Correction evidence path has no parent directory.".to_string())?;
    let temporary_path = parent.join(temporary_file_name());
    let write_result = (|| -> Result<(), String> {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary_path)
            .map_err(|error| format!("Unable to create temporary correction evidence: {error}"))?;
        restrict_file_permissions(&file)?;
        file.write_all(contents.as_bytes())
            .map_err(|error| format!("Unable to write correction evidence: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("Unable to flush correction evidence: {error}"))?;
        fs::rename(&temporary_path, path)
            .map_err(|error| format!("Unable to replace correction evidence: {error}"))?;
        File::open(parent)
            .and_then(|directory| directory.sync_all())
            .map_err(|error| format!("Unable to flush correction evidence directory: {error}"))?;
        Ok(())
    })();
    if write_result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }
    write_result
}

fn correction_evidence_path(app_data_dir: &Path, scope: &str) -> PathBuf {
    app_data_dir
        .join(EVIDENCE_DIRECTORY_NAME)
        .join(scope)
        .join(EVIDENCE_FILE_NAME)
}

fn validate_scope(scope: &str) -> Result<(), String> {
    let valid = scope.len() == 64
        && scope
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte));
    if valid {
        Ok(())
    } else {
        Err("Correction evidence scope must be a lowercase SHA-256 digest.".to_string())
    }
}

fn reject_symlink_directory(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("Unable to inspect correction evidence directory: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        Err("Correction evidence directory must be a real directory.".to_string())
    } else {
        Ok(())
    }
}

#[cfg(unix)]
fn restrict_directory_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .map_err(|error| format!("Unable to restrict correction evidence directory: {error}"))
}

#[cfg(not(unix))]
fn restrict_directory_permissions(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(unix)]
fn restrict_file_permissions(file: &File) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    file.set_permissions(fs::Permissions::from_mode(0o600))
        .map_err(|error| format!("Unable to restrict correction evidence file: {error}"))
}

#[cfg(not(unix))]
fn restrict_file_permissions(_file: &File) -> Result<(), String> {
    Ok(())
}

fn temporary_file_name() -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let sequence = TEMPORARY_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!(
        ".{EVIDENCE_FILE_NAME}.{}.{timestamp}.{sequence}.tmp",
        std::process::id()
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::TempDir;

    const SCOPE: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    fn record(index: usize) -> String {
        json!({
            "schema": EVIDENCE_SCHEMA,
            "eventId": format!("{:064x}", index + 1),
            "recordedAt": "2026-08-16T00:00:00.000Z",
            "activityKeys": {
                "surface": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                "detail": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
            },
            "privacy": {},
            "promptInput": {},
            "predictionBeforeFeedback": {},
            "feedback": {}
        })
        .to_string()
    }

    #[test]
    fn appends_records_in_order_with_private_permissions() {
        let root = TempDir::new().expect("temp dir");
        append_correction_evidence(root.path(), SCOPE, &record(0)).expect("first append");
        append_correction_evidence(root.path(), SCOPE, &record(1)).expect("second append");
        let path = correction_evidence_path(root.path(), SCOPE);
        let lines = fs::read_to_string(&path).expect("read");
        assert_eq!(lines.lines().count(), 2);
        assert!(lines
            .lines()
            .next()
            .expect("first")
            .contains(&format!("{:064x}", 1)));

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(path).expect("metadata").permissions().mode() & 0o777,
                0o600
            );
        }
    }

    #[test]
    fn rejects_unsafe_scope_and_raw_identifiers_without_changing_the_journal() {
        let root = TempDir::new().expect("temp dir");
        append_correction_evidence(root.path(), SCOPE, &record(0)).expect("stable append");
        assert!(append_correction_evidence(root.path(), "../escape", &record(1)).is_err());
        let unsafe_record = record(1).replace(
            "\"promptInput\":{}",
            "\"promptInput\":{\"segmentId\":\"raw\"}",
        );
        assert!(append_correction_evidence(root.path(), SCOPE, &unsafe_record).is_err());
        let path = correction_evidence_path(root.path(), SCOPE);
        assert_eq!(fs::read_to_string(path).expect("read").lines().count(), 1);
    }

    #[test]
    fn retains_only_the_newest_bounded_records() {
        let root = TempDir::new().expect("temp dir");
        for index in 0..(MAX_RECORDS + 2) {
            append_correction_evidence(root.path(), SCOPE, &record(index)).expect("append");
        }
        let path = correction_evidence_path(root.path(), SCOPE);
        let lines = fs::read_to_string(path)
            .expect("read")
            .lines()
            .map(str::to_string)
            .collect::<Vec<_>>();
        assert_eq!(lines.len(), MAX_RECORDS);
        assert!(lines[0].contains(&format!("{:064x}", 3)));
        assert!(lines[MAX_RECORDS - 1].contains(&format!("{:064x}", MAX_RECORDS + 2)));
    }
}
