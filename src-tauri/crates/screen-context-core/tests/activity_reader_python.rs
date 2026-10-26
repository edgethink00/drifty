//! Temporary real TrackerDatabase + actual isolated Python reader + Rust store.
//! The capture backend is an explicit synthetic native fixture, not an OS/GUI
//! permission claim. Normal5s sampling extends the row; lookups never flush it.
#![cfg(any(target_os = "macos", target_os = "windows"))]
use drifty_screen_context_core::{
    activity_reader::{ActivityResolver, CapturedActivityHint, NativeActivityReader},
    native::WindowTitleDigest,
    store::EvidenceStore,
    *,
};
use std::{
    collections::BTreeSet,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

struct FixtureCapture {
    digest: WindowTitleDigest,
}
impl CaptureBackend for FixtureCapture {
    fn capture(
        &self,
        _: &CapturePolicy,
        _: &Cancellation,
    ) -> Result<NativeCapture, CaptureFailure> {
        let facts = SurfaceFacts {
            identity: SurfaceIdentity {
                pid: 7,
                process_birth: 123,
                window_id: 8,
                app_id: "owned.editor".into(),
                document_id: "owned-interop-fixture".into(),
                document_generation: 1,
            },
            permission: true,
            foreground: true,
            interactive: true,
            protected: false,
            visibility: Visibility::Visible,
            privacy: Privacy::NotBrowser,
        };
        let mut png = Vec::new();
        let mut encoder = png::Encoder::new(&mut png, 2, 2);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder
            .write_header()
            .unwrap()
            .write_image_data(&[42; 16])
            .unwrap();
        Ok(NativeCapture {
            before: facts.clone(),
            after: facts,
            observed_at_ms: unix_millis().unwrap(),
            text: TextEvidence::not_requested(),
            frame: Frame::from_png(png).unwrap(),
            activity_hint: Some(self.digest.clone()),
        })
    }
}
fn python() -> PathBuf {
    if let Some(path) = std::env::var_os("DRIFTY_SCREEN_CONTEXT_TEST_PYTHON") {
        return PathBuf::from(path);
    }
    let command = if cfg!(windows) { "python" } else { "python3" };
    let out = Command::new(command)
        .args(["-I", "-c", "import sys;print(sys.executable)"])
        .output()
        .expect("Python is required for tracker interop");
    assert!(out.status.success());
    PathBuf::from(String::from_utf8(out.stdout).unwrap().trim())
}
struct OwnedFixture(std::process::Child);
impl Drop for OwnedFixture {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

// Keep synthetic interop failures diagnosable without production logging or
// changing retry/deadline behavior. No activity content is recorded here.
struct ObservedReader {
    reader: Arc<NativeActivityReader>,
    outcomes: Mutex<Vec<String>>,
}
impl ActivityResolver for ObservedReader {
    fn resolve_capture(
        &self,
        hint: &CapturedActivityHint,
        current: &dyn Fn() -> bool,
    ) -> Result<Option<LocalActivityRecordRef>, Error> {
        let started = Instant::now();
        let result = self.reader.resolve_capture(hint, current);
        self.outcomes.lock().unwrap().push(format!(
            "{:?} after {:?}",
            result.as_ref().map(|row| row.is_some()),
            started.elapsed()
        ));
        result
    }
    fn read_current(
        &self,
        ids: &[String],
        current: &dyn Fn() -> bool,
    ) -> Result<Vec<LocalActivityRecordRef>, Error> {
        self.reader.read_current(ids, current)
    }
    fn reset(&self) {
        self.reader.reset();
    }
    fn maintain_idle(&self) {
        self.reader.maintain_idle();
    }
}

#[test]
fn actual_reader_links_after_normal_sampling_without_changing_tracker_time_or_using_serve() {
    let temp = tempfile::tempdir().unwrap();
    let db = temp.path().join("tracker.sqlite3");
    let python = python();
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)
        .unwrap();
    let main = root.join("services/tracker-python/app/main.py");
    let setup = r#"import sys,json
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from datetime import datetime,timezone
from app.storage.db import TrackerDatabase
from app.storage.screen_activity_binding import window_title_digest
from app.tracker.capture_contract import Snapshot
source='win32-foreground' if sys.platform=='win32' else 'accessibility'
db=TrackerDatabase(Path(sys.argv[2]),perform_maintenance=False)
from app.storage.screen_activity_fence import prepare
with db.connect() as conn:
 conn.execute('BEGIN IMMEDIATE')
 prepare(conn)
title='한글 owned interop document'
def tick():
 now=datetime.now(timezone.utc).isoformat()
 return db.record_snapshot(Snapshot(now,'Owned Editor','owned.editor',title,source),5)
try:
 first=tick()
 print(json.dumps({'uid':first.after.segment_uid,'titleDigest':window_title_digest(title)}),flush=True)
 if sys.stdin.readline().strip()!='normal-tick':raise RuntimeError('fixture command')
 second=tick()
 row=db.connect().execute('SELECT id,segment_uid,started_at,ended_at,duration_seconds FROM activity_segments').fetchone()
 print(json.dumps({'uid':second.after.segment_uid,'recordId':str(row[0]),'duration':row[4]}),flush=True)
 original=dict(db.connect().execute('SELECT * FROM activity_segments WHERE id=?',(row[0],)).fetchone())
 for command in sys.stdin:
  command=command.strip()
  if command=='delete-record':
   db.delete_activity_segments([str(row[0])])
  elif command=='restore-record':
   with db.connect() as connection:
    connection.execute('INSERT INTO activity_segments ('+','.join(original)+') VALUES ('+','.join('?' for _ in original)+')',tuple(original.values()))
  else:raise RuntimeError('fixture command')
  print(json.dumps({'done':command}),flush=True)
finally:db.close()
"#;
    let mut child = OwnedFixture(
        Command::new(&python)
            .args(["-I", "-c", setup])
            .arg(root.join("services/tracker-python"))
            .arg(&db)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap(),
    );
    let mut input = child.0.stdin.take().unwrap();
    let stdout = child.0.stdout.take().unwrap();
    let (sender, lines) = std::sync::mpsc::sync_channel(2);
    let fixture_output = std::thread::spawn(move || {
        let output = BufReader::new(stdout);
        for line in output.lines() {
            if sender.send(line).is_err() {
                break;
            }
        }
    });
    let first = lines.recv_timeout(Duration::from_secs(5)).unwrap().unwrap();
    let first: serde_json::Value = serde_json::from_str(&first).expect("fixture readiness");
    // A private CLI build can exercise the same interop/lifecycle with the
    // shipped runtime shape. This environment selector exists only in tests.
    let reader = Arc::new(
        if let Some(executable) = std::env::var_os("DRIFTY_SCREEN_CONTEXT_TEST_PACKAGED_TRACKER") {
            let producer = PathBuf::from(executable);
            if let Some(helper) = std::env::var_os("DRIFTY_SCREEN_CONTEXT_TEST_ACTIVITY_HELPER") {
                NativeActivityReader::from_packaged_activity_helper(
                    &PathBuf::from(helper),
                    &producer,
                    &db,
                )
            } else {
                NativeActivityReader::from_packaged_runtime(&producer, &db)
            }
        } else {
            NativeActivityReader::from_source_runtime(&python, &main, &db)
        }
        .unwrap(),
    );
    let observed = Arc::new(ObservedReader {
        reader: reader.clone(),
        outcomes: Mutex::new(Vec::new()),
    });
    let backend = Arc::new(FixtureCapture {
        digest: WindowTitleDigest::parse(first["titleDigest"].as_str().unwrap().into()).unwrap(),
    });
    let mut service =
        ScreenContextService::new_with_activity_resolver(backend, observed.clone()).unwrap();
    service
        .replace_store(Some(
            EvidenceStore::open(
                &temp.path().join("evidence"),
                ScopeId::from_profile("owned-interop").unwrap(),
                zeroize::Zeroizing::new([7; 32]),
                Retention::default(),
                unix_millis().unwrap(),
            )
            .unwrap(),
        ))
        .unwrap();
    service
        .set_policy(CapturePolicy {
            enabled: true,
            replay_enabled: true,
            allowed_apps: BTreeSet::from(["owned.editor".into()]),
            ..CapturePolicy::default()
        })
        .unwrap();
    assert!(service.request_sample());
    let deadline = Instant::now() + Duration::from_secs(3);
    while service.status().accepted == 0 {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(2));
    }
    let id = service.list_page(None, 10).unwrap().records[0].id;
    assert!(service
        .read_metadata(id)
        .unwrap()
        .unwrap()
        .activity_binding
        .is_none());
    std::thread::sleep(Duration::from_secs(5)); // One real normal sampler interval.
    input.write_all(b"normal-tick\n").unwrap();
    input.flush().unwrap();
    let second = lines.recv_timeout(Duration::from_secs(5)).unwrap().unwrap();
    let second: serde_json::Value = serde_json::from_str(&second).expect("normal tick result");
    assert_eq!(first["uid"], second["uid"]);
    assert_eq!(second["duration"], 10);
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        let metadata = service.read_metadata(id).unwrap().unwrap();
        if let Some(binding) = &metadata.activity_binding {
            assert_eq!(binding.record_id(), second["recordId"].as_str().unwrap());
            break;
        }
        assert!(
            Instant::now() < deadline,
            "normal tracking was not associated: {:?}",
            observed.outcomes.lock().unwrap()
        );
        std::thread::sleep(Duration::from_millis(20));
    }
    let before = std::fs::read(&db).unwrap();
    let row = reader
        .read_current(&[second["recordId"].as_str().unwrap().to_owned()], &|| true)
        .unwrap();
    assert_eq!(row.len(), 1);
    assert_eq!(std::fs::read(&db).unwrap(), before);
    let metadata = service.read_metadata(id).unwrap().unwrap();
    assert!(metadata
        .activity_binding
        .as_ref()
        .unwrap()
        .matches(&row[0], metadata.observed_at_ms));
    assert!(metadata.tracker_record_id.is_none());
    let record_ids = [second["recordId"].as_str().unwrap().to_owned()];
    let page = service
        .list_activity_evidence(&record_ids, None, 20)
        .unwrap();
    let page = serde_json::to_value(&page).unwrap();
    assert_eq!(page["records"].as_array().unwrap().len(), 1);
    let protected=service.read_activity_evidence(id,true).unwrap().try_map(|evidence|{
        let evidence=evidence.ok_or(Error::Invalidated)?;
        assert!(evidence.frame.is_some());
        Ok(serde_json::json!({"id":evidence.metadata.id,"point":evidence.metadata.observed_at_ms}))
    }).unwrap();
    assert_eq!(
        serde_json::to_value(&protected).unwrap()["id"],
        id.to_string()
    );
    input.write_all(b"delete-record\n").unwrap();
    input.flush().unwrap();
    let done = lines.recv_timeout(Duration::from_secs(5)).unwrap().unwrap();
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&done).unwrap()["done"],
        "delete-record"
    );
    assert!(serde_json::to_value(&protected).is_err());
    input.write_all(b"restore-record\n").unwrap();
    input.flush().unwrap();
    let done = lines.recv_timeout(Duration::from_secs(5)).unwrap().unwrap();
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&done).unwrap()["done"],
        "restore-record"
    );
    assert_eq!(reader.read_current(&record_ids, &|| true).unwrap().len(), 1);
    assert!(serde_json::to_value(&protected).is_err()); // Old reply cannot revive.
    assert!(service.read_activity_evidence(id, true).is_err()); // Fresh reply also refuses restored UID.
    let page = service
        .list_activity_evidence(&record_ids, None, 20)
        .unwrap();
    assert!(serde_json::to_value(&page).unwrap()["records"]
        .as_array()
        .unwrap()
        .is_empty());
    assert!(service.shutdown(Duration::from_millis(1100)));
    drop(input);
    assert!(child.0.wait().unwrap().success());
    fixture_output.join().unwrap();
}
