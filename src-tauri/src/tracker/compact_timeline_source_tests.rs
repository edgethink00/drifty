// Included in tracker::tests so the actual transport shares its serve test lock.
#[cfg(unix)]
#[test]
fn compact_timeline_uses_real_python_sqlite_and_native_response_parser() {
    let _guard = SERVE_TEST_LOCK
        .lock()
        .expect("serialize source protocol test");
    let directory = tempfile::tempdir().unwrap();
    let db = directory.path().join("synthetic.sqlite3");
    let service = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../services/tracker-python");
    let bootstrap = r#"
import sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
from app.storage.db import TrackerDatabase
db = TrackerDatabase(Path(sys.argv[2]), perform_maintenance=False)
try:
    with db.connect() as conn:
        conn.execute("INSERT INTO youtube_video_metadata(video_id,category,description,status) VALUES(?,?,?,?)",
                     ('synthetic','People & Blogs','music '+chr(0xac00)*1000,'ready'))
        for i in range(2):
            conn.execute("""INSERT INTO activity_segments
                (started_at,ended_at,duration_seconds,app_name,segment_uid,youtube_video_id,platform,source)
                VALUES(?,?,?,?,?,?,?,?)""",
                ('2026-11-10T00:00:00+00:00','2026-11-10T00:01:00+00:00',60,
                 'QA browser','synthetic-'+str(i),'synthetic','windows','accessibility'))
finally:
    db.close()
"#;
    let prepared = std::process::Command::new("/usr/bin/python3")
        .args(["-c", bootstrap])
        .arg(&service)
        .arg(&db)
        .output()
        .unwrap();
    assert!(
        prepared.status.success(),
        "{}",
        String::from_utf8_lossy(&prepared.stderr)
    );
    let wrapper = directory.path().join("source_serve.py");
    let source = r#"
import socket,sys
sys.path.insert(0, SERVICE_ROOT)
def no_network(*args,**kwargs):
    raise AssertionError('Network disabled for native source protocol QA')
socket.socket.connect = no_network
socket.socket.connect_ex = no_network
socket.getaddrinfo = no_network
from app import main
main.init_tracker_sentry = lambda *args,**kwargs: False
main.main()
"#
    .replace("SERVICE_ROOT", &serde_json::to_string(&service).unwrap());
    std::fs::write(&wrapper, source).unwrap();
    let runtime = TrackerRuntime::source_python(PathBuf::from("/usr/bin/python3"), wrapper);
    let mut process = spawn_serve_process(&runtime, &db).unwrap();
    let replies = (|| -> Result<(String, String), TrackerError> {
        let compact = serve_round_trip(
            &mut process,
            &json!({"id":1,"command":"get_compact_timeline","payload":{
                "start":"2026-11-10T00:00:00+00:00","end":"2026-11-11T00:00:00+00:00"
            }})
            .to_string(),
            ServeInvocationBudget::new(),
        )?;
        let full = serve_round_trip(
            &mut process,
            &json!({"id":2,"command":"get_timeline","payload":{
                "start":"2026-11-10T00:00:00+00:00","end":"2026-11-11T00:00:00+00:00"
            }})
            .to_string(),
            ServeInvocationBudget::new(),
        )?;
        Ok((compact, full))
    })();
    // Reap the owned source server before assertions/temporary directory cleanup.
    kill_serve_process(process);
    let (compact, full) = replies.unwrap();
    let raw: Box<serde_json::value::RawValue> = parse_envelope(compact.as_bytes()).unwrap();
    let packet: Value = serde_json::from_str(raw.get()).unwrap();
    let expected: Vec<Value> = parse_envelope(full.as_bytes()).unwrap();
    assert_eq!(packet["items"].as_array().unwrap().len(), 2);
    assert_eq!(packet["youtubeMetadata"].as_array().unwrap().len(), 1);
    let restored: Vec<Value> = packet["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| {
            let mut item = item.as_object().unwrap().clone();
            let index = item
                .remove("youtubeMetadataIndex")
                .unwrap()
                .as_u64()
                .unwrap() as usize;
            item.extend(
                packet["youtubeMetadata"][index]
                    .as_object()
                    .unwrap()
                    .clone(),
            );
            Value::Object(item)
        })
        .collect();
    assert_eq!(restored, expected);
    assert!(compact.len() < full.len());
    assert_eq!(
        sidecar_command_retry_safety("get_compact_timeline"),
        SidecarCommandRetrySafety::SafeRead
    );
}
