//! Real temporary tracker preparation through the private native CLI. This
//! grants no screen/account authority and starts no tracker daemon or capture.
use drifty_screen_context_core::{activity_reader::NativeActivityReader, ActivityPreparation};
use std::{
    path::{Path, PathBuf},
    process::Command,
};

fn python() -> PathBuf {
    if let Some(value) = std::env::var_os("DRIFTY_SCREEN_CONTEXT_TEST_PYTHON") {
        return value.into();
    }
    let command = if cfg!(windows) { "python" } else { "python3" };
    let result = Command::new(command)
        .args(["-I", "-c", "import sys;print(sys.executable)"])
        .output()
        .unwrap();
    assert!(result.status.success());
    PathBuf::from(String::from_utf8(result.stdout).unwrap().trim())
}
fn fixture(
    python: &Path,
    root: &Path,
    db: &Path,
    operation: &str,
    packaged: Option<&Path>,
) -> serde_json::Value {
    let code = r#"import sys,json,hashlib
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from app.storage.db import TrackerDatabase
from app.storage.screen_activity_prepare import runtime_fingerprint
from app.storage.screen_activity_fence import read_state
path=Path(sys.argv[2]);operation=sys.argv[3]
db=TrackerDatabase(path,perform_maintenance=False)
try:
 if operation=='producer':
  executable=Path(sys.argv[4]) if len(sys.argv)>4 else Path(sys.executable)
  fingerprint=runtime_fingerprint(Path(sys.argv[1])/'app',executable,len(sys.argv)>4)
  db.set_meta('tracker_runtime_fingerprint',fingerprint)
 if operation=='future':
  with db.connect() as conn:conn.execute('CREATE TABLE screen_context_activity_future(value TEXT)')
 names=[row[0] for row in db.connect().execute("SELECT name FROM sqlite_master WHERE name LIKE 'screen_context_activity_%'")]
 epoch=read_state(db.connect(),()).epoch if len(names)==4 else None
 count=db.connect().execute('SELECT COUNT(*) FROM activity_segments').fetchone()[0]
 print(json.dumps({'schemaObjects':len(names),'epoch':epoch,'activityRows':count}))
finally:db.close()
"#;
    let mut command = Command::new(python);
    command
        .args(["-I", "-c", code])
        .arg(root.join("services/tracker-python"))
        .arg(db)
        .arg(operation);
    if let Some(executable) = packaged {
        command.arg(executable);
    }
    let result = command.output().unwrap();
    assert!(
        result.status.success(),
        "synthetic preparation fixture failed"
    );
    serde_json::from_slice(&result.stdout).unwrap()
}

#[test]
fn actual_preparation_requires_a_current_producer_is_idempotent_and_preserves_unknown_schema() {
    let temp = tempfile::tempdir().unwrap();
    let db = temp.path().join("tracker.sqlite3");
    let python = python();
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)
        .unwrap();
    let main = root.join("services/tracker-python/app/main.py");
    let packaged =
        std::env::var_os("DRIFTY_SCREEN_CONTEXT_TEST_PACKAGED_TRACKER").map(PathBuf::from);
    let helper = std::env::var_os("DRIFTY_SCREEN_CONTEXT_TEST_ACTIVITY_HELPER").map(PathBuf::from);
    let reader = if let (Some(helper), Some(producer)) = (&helper, &packaged) {
        NativeActivityReader::from_packaged_activity_helper(helper, producer, &db)
    } else if let Some(executable) = &packaged {
        NativeActivityReader::from_packaged_runtime(executable, &db)
    } else {
        NativeActivityReader::from_source_runtime(&python, &main, &db)
    }
    .unwrap();
    let preparer = reader.preparation();
    assert_eq!(
        preparer.prepare(&|| true).unwrap(),
        ActivityPreparation::MissingDatabase
    );
    assert!(!db.exists());
    let initial = fixture(&python, root, &db, "initial", packaged.as_deref());
    assert_eq!(initial["schemaObjects"], 0);
    let before = std::fs::read(&db).unwrap();
    assert_eq!(
        preparer.prepare(&|| true).unwrap(),
        ActivityPreparation::WriterNotReady
    );
    assert_eq!(std::fs::read(&db).unwrap(), before);
    fixture(&python, root, &db, "producer", packaged.as_deref());
    assert_eq!(
        preparer.prepare(&|| true).unwrap(),
        ActivityPreparation::Ready
    );
    let first = fixture(&python, root, &db, "inspect", packaged.as_deref());
    assert_eq!(first["schemaObjects"], 4);
    assert_eq!(first["activityRows"], 0);
    assert_eq!(
        preparer.prepare(&|| true).unwrap(),
        ActivityPreparation::Ready
    );
    let second = fixture(&python, root, &db, "inspect", packaged.as_deref());
    assert_eq!(first, second);
    fixture(&python, root, &db, "future", packaged.as_deref());
    let before = std::fs::read(&db).unwrap();
    assert_eq!(
        preparer.prepare(&|| true).unwrap(),
        ActivityPreparation::Unavailable
    );
    assert_eq!(std::fs::read(&db).unwrap(), before);
}
