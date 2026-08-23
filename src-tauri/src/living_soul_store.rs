use chrono::DateTime;
use std::{
    collections::HashMap,
    fs::{self, OpenOptions},
    io::{ErrorKind, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

#[cfg(unix)]
use std::fs::File;

const SOUL_DIRECTORY_NAME: &str = "living-souls";
const SOUL_FILE_NAME: &str = "Soul.md";
const MAX_SOUL_BYTES: usize = 32 * 1024;
static TEMPORARY_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

pub(crate) fn read_living_soul(app_data_dir: &Path, scope: &str) -> Result<Option<String>, String> {
    let path = living_soul_path(app_data_dir, scope)?;
    match fs::read_to_string(&path) {
        Ok(markdown) => {
            if markdown.len() > MAX_SOUL_BYTES {
                return Err(format!(
                    "Living Soul at {} exceeds the {} byte limit.",
                    path.display(),
                    MAX_SOUL_BYTES
                ));
            }
            Ok(Some(markdown))
        }
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!(
            "Unable to read Living Soul at {}: {error}",
            path.display()
        )),
    }
}

pub(crate) fn write_living_soul(
    app_data_dir: &Path,
    scope: &str,
    markdown: &str,
) -> Result<(), String> {
    if markdown.len() > MAX_SOUL_BYTES {
        return Err(format!(
            "Living Soul exceeds the {MAX_SOUL_BYTES} byte limit."
        ));
    }
    validate_living_soul_markdown(markdown)?;

    let path = living_soul_path(app_data_dir, scope)?;
    let parent = path
        .parent()
        .ok_or_else(|| "Living Soul path has no parent directory.".to_string())?;
    fs::create_dir_all(parent).map_err(|error| {
        format!(
            "Unable to create Living Soul directory at {}: {error}",
            parent.display()
        )
    })?;
    restrict_directory_permissions(parent)?;
    if let Some(soul_root) = parent.parent() {
        restrict_directory_permissions(soul_root)?;
    }

    let temporary_path = parent.join(temporary_file_name());
    let write_result = (|| -> Result<(), String> {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary_path)
            .map_err(|error| format!("Unable to create temporary Living Soul: {error}"))?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            file.set_permissions(fs::Permissions::from_mode(0o600))
                .map_err(|error| format!("Unable to restrict Living Soul permissions: {error}"))?;
        }

        file.write_all(markdown.as_bytes())
            .map_err(|error| format!("Unable to write temporary Living Soul: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("Unable to flush temporary Living Soul: {error}"))?;
        fs::rename(&temporary_path, &path).map_err(|error| {
            format!(
                "Unable to atomically replace Living Soul at {}: {error}",
                path.display()
            )
        })?;
        sync_parent_directory(parent)?;
        Ok(())
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }
    write_result
}

#[cfg(unix)]
fn sync_parent_directory(parent: &Path) -> Result<(), String> {
    File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| format!("Unable to flush Living Soul directory: {error}"))
}

#[cfg(not(unix))]
fn sync_parent_directory(_parent: &Path) -> Result<(), String> {
    // std::fs cannot open a Windows directory with the backup-semantics flag
    // required for a metadata flush. The temporary file itself is synced
    // before the same-volume atomic rename, which is the strongest portable
    // durability guarantee available here.
    Ok(())
}

fn validate_living_soul_markdown(markdown: &str) -> Result<(), String> {
    let frontmatter_and_body = markdown
        .strip_prefix("---\n")
        .and_then(|value| value.split_once("\n---\n"))
        .ok_or_else(|| "Living Soul frontmatter is invalid.".to_string())?;
    let mut metadata = HashMap::new();
    for line in frontmatter_and_body.0.lines() {
        let (key, value) = line
            .split_once(':')
            .ok_or_else(|| "Living Soul frontmatter entry is invalid.".to_string())?;
        if metadata.insert(key.trim(), value.trim()).is_some() {
            return Err("Living Soul frontmatter contains a duplicate key.".to_string());
        }
    }
    if metadata.get("schema") != Some(&"drifty.soul/v1") {
        return Err("Living Soul schema is invalid.".to_string());
    }
    let revision = metadata
        .get("revision")
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0)
        .ok_or_else(|| "Living Soul revision is invalid.".to_string())?;
    let _ = revision;
    for key in ["created_at", "updated_at"] {
        validate_timestamp(
            metadata
                .get(key)
                .ok_or_else(|| format!("Living Soul {key} is missing."))?,
        )?;
    }
    let last_feedback_at = metadata
        .get("last_feedback_at")
        .ok_or_else(|| "Living Soul last_feedback_at is missing.".to_string())?;
    if *last_feedback_at != "null" {
        validate_timestamp(last_feedback_at)?;
    }

    let body = frontmatter_and_body.1;
    if !body.starts_with("# Living Soul\n") {
        return Err("Living Soul document heading is invalid.".to_string());
    }
    validate_declared_section(markdown_section(body, "Declared work context")?)?;
    for heading in [
        "Learned work-support patterns",
        "Learned drift patterns",
        "Ambiguities",
    ] {
        validate_pattern_section(markdown_section(body, heading)?)?;
    }
    Ok(())
}

fn validate_timestamp(value: &str) -> Result<(), String> {
    DateTime::parse_from_rfc3339(value)
        .map(|_| ())
        .map_err(|_| "Living Soul timestamp is invalid.".to_string())
}

fn markdown_section<'a>(markdown: &'a str, heading: &str) -> Result<&'a str, String> {
    let marker = format!("## {heading}\n");
    if markdown.matches(&marker).count() != 1 {
        return Err(format!(
            "Living Soul section {heading} is missing or duplicated."
        ));
    }
    let rest = markdown
        .split_once(&marker)
        .map(|(_, value)| value)
        .ok_or_else(|| format!("Living Soul section {heading} is missing."))?;
    Ok(rest
        .split_once("\n## ")
        .map_or(rest, |(section, _)| section))
}

fn validate_declared_section(section: &str) -> Result<(), String> {
    let lines = section
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>();
    let labels = ["Work activities", "Work domain", "Drifty purpose"];
    if lines.len() != labels.len() {
        return Err("Living Soul declared context contains unexpected lines.".to_string());
    }
    for (line, label) in lines.iter().zip(labels) {
        let prefix = format!("- {label}: ");
        if line
            .strip_prefix(&prefix)
            .is_none_or(|value| value.trim().is_empty())
        {
            return Err(format!("Living Soul declared field {label} is invalid."));
        }
    }
    Ok(())
}

fn validate_pattern_section(section: &str) -> Result<(), String> {
    let lines = section
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>();
    if lines == ["- None yet."] {
        return Ok(());
    }
    if lines.is_empty() {
        return Err("Living Soul pattern section is empty.".to_string());
    }
    for line in lines {
        let rest = line
            .strip_prefix("- [confidence=")
            .ok_or_else(|| "Living Soul pattern prefix is invalid.".to_string())?;
        let (confidence, rest) = rest
            .split_once("; evidence=")
            .ok_or_else(|| "Living Soul pattern confidence is invalid.".to_string())?;
        if !matches!(confidence, "low" | "medium" | "high") {
            return Err("Living Soul pattern confidence is invalid.".to_string());
        }
        let (evidence, rest) = rest
            .split_once("; last=")
            .ok_or_else(|| "Living Soul pattern evidence is invalid.".to_string())?;
        let evidence = evidence
            .parse::<u8>()
            .ok()
            .filter(|value| (1..=99).contains(value))
            .ok_or_else(|| "Living Soul pattern evidence is invalid.".to_string())?;
        let _ = evidence;
        let (last_observed_at, summary) = rest
            .split_once("] ")
            .ok_or_else(|| "Living Soul pattern timestamp is invalid.".to_string())?;
        validate_timestamp(last_observed_at)?;
        if summary.trim().is_empty() || summary.chars().count() > 240 {
            return Err("Living Soul pattern summary is invalid.".to_string());
        }
    }
    Ok(())
}

#[cfg(unix)]
fn restrict_directory_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|error| {
        format!(
            "Unable to restrict Living Soul directory at {}: {error}",
            path.display()
        )
    })
}

#[cfg(not(unix))]
fn restrict_directory_permissions(_path: &Path) -> Result<(), String> {
    Ok(())
}

fn living_soul_path(app_data_dir: &Path, scope: &str) -> Result<PathBuf, String> {
    validate_scope(scope)?;
    Ok(app_data_dir
        .join(SOUL_DIRECTORY_NAME)
        .join(scope)
        .join(SOUL_FILE_NAME))
}

fn validate_scope(scope: &str) -> Result<(), String> {
    let valid = scope.len() == 64
        && scope
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte));
    if valid {
        Ok(())
    } else {
        Err("Living Soul scope must be a lowercase SHA-256 digest.".to_string())
    }
}

fn temporary_file_name() -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let sequence = TEMPORARY_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!(
        ".{SOUL_FILE_NAME}.{}.{timestamp}.{sequence}.tmp",
        std::process::id()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCOPE: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    fn temporary_root() -> PathBuf {
        std::env::temp_dir().join(format!("drifty-living-soul-test-{}", temporary_file_name()))
    }

    fn soul_markdown(revision: u64) -> String {
        format!(
            "---\nschema: drifty.soul/v1\nrevision: {revision}\ncreated_at: 2026-08-14T00:00:00.000Z\nupdated_at: 2026-08-14T01:00:00.000Z\nlast_feedback_at: null\n---\n# Living Soul\n\n## Declared work context\n- Work activities: Engineering\n- Work domain: AI productivity\n- Drifty purpose: Protect focus\n\n## Learned work-support patterns\n- None yet.\n\n## Learned drift patterns\n- None yet.\n\n## Ambiguities\n- None yet.\n"
        )
    }

    #[test]
    fn rejects_scopes_that_could_escape_the_soul_directory() {
        assert!(living_soul_path(Path::new("/tmp/drifty"), "../other").is_err());
        assert!(living_soul_path(Path::new("/tmp/drifty"), &"A".repeat(64)).is_err());
    }

    #[test]
    fn writes_and_replaces_one_canonical_markdown_file() {
        let root = temporary_root();
        let revision_one = soul_markdown(1);
        let revision_two = soul_markdown(2);
        write_living_soul(&root, SCOPE, &revision_one).expect("first write");
        write_living_soul(&root, SCOPE, &revision_two).expect("replacement write");

        assert_eq!(
            read_living_soul(&root, SCOPE).expect("read"),
            Some(revision_two)
        );
        let parent = living_soul_path(&root, SCOPE)
            .expect("path")
            .parent()
            .expect("parent")
            .to_path_buf();
        let file_names = fs::read_dir(&parent)
            .expect("directory")
            .map(|entry| entry.expect("entry").file_name())
            .collect::<Vec<_>>();
        assert_eq!(file_names, vec![SOUL_FILE_NAME]);

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let file_mode = fs::metadata(living_soul_path(&root, SCOPE).expect("path"))
                .expect("file metadata")
                .permissions()
                .mode();
            let directory_mode = fs::metadata(&parent)
                .expect("directory metadata")
                .permissions()
                .mode();
            assert_eq!(file_mode & 0o777, 0o600);
            assert_eq!(directory_mode & 0o777, 0o700);
        }

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn keeps_the_previous_revision_when_an_oversized_write_is_rejected() {
        let root = temporary_root();
        let stable = soul_markdown(1);
        write_living_soul(&root, SCOPE, &stable).expect("first write");
        let oversized = "x".repeat(MAX_SOUL_BYTES + 1);

        assert!(write_living_soul(&root, SCOPE, &oversized).is_err());
        assert_eq!(read_living_soul(&root, SCOPE).expect("read"), Some(stable));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn keeps_the_previous_revision_when_invalid_markdown_is_rejected() {
        let root = temporary_root();
        let stable = soul_markdown(1);
        write_living_soul(&root, SCOPE, &stable).expect("first write");

        assert!(write_living_soul(&root, SCOPE, "# not a Living Soul").is_err());
        let malformed_declared = soul_markdown(2).replace(
            "- Drifty purpose: Protect focus\n\n## Learned",
            "- Drifty purpose: Protect focus\ngarbage\n\n## Learned",
        );
        assert!(write_living_soul(&root, SCOPE, &malformed_declared).is_err());
        assert_eq!(read_living_soul(&root, SCOPE).expect("read"), Some(stable));

        let _ = fs::remove_dir_all(root);
    }
}
