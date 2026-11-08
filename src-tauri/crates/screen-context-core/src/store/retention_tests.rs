use super::*;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

fn elapsed_store(root: &Path, ttl: u64) -> (EvidenceStore, Arc<AtomicU64>) {
    let mut store = EvidenceStore::open(
        root,
        ScopeId::from_profile("elapsed-fixture").unwrap(),
        Zeroizing::new([7; 32]),
        Retention {
            ttl: Duration::from_secs(ttl),
            ..Retention::default()
        },
        100_000,
    )
    .unwrap();
    let tick = Arc::new(AtomicU64::new(0));
    store.expiry_clock = Some(RetentionClock::fixture(100_000, tick.clone()));
    (store, tick)
}

#[test]
fn corrections_keep_pixels_and_capture_times_but_never_extend_elapsed_expiry() {
    let temp = tempfile::tempdir().unwrap();
    let (mut store, tick) = elapsed_store(&temp.path().join("evidence"), 10);
    let id = store
        .append(
            store.generation(),
            crate::tests::evidence(100_000),
            true,
            100_000,
        )
        .unwrap();
    let file = store.frame_path(id);
    let bytes = fs::read(&file).unwrap();
    let generation = store.generation();
    tick.store(2_000_000_000, Ordering::SeqCst);
    store.maintenance(102_000).unwrap();
    tick.store(4_000_000_000, Ordering::SeqCst);
    let metadata = store.read_metadata(id, 99_988).unwrap().unwrap();
    assert_eq!(metadata.observed_at_ms, 100_000);
    assert_eq!(metadata.expires_at_ms, 110_000);
    assert_eq!(fs::read(&file).unwrap(), bytes);
    assert_eq!(store.generation(), generation);
    assert!(!store.capture_paused());
    // A subsequent capture at the corrected wall timestamp is still admitted.
    let second = store
        .append(generation, crate::tests::evidence(99_988), true, 99_988)
        .unwrap();
    assert!(store.read_frame(second, 99_988).unwrap().is_some());
    // Repeated backsteps/frozen wall time cannot renew the first record.
    tick.store(9_999_000_000, Ordering::SeqCst);
    assert!(store.read_frame(id, 90_000).unwrap().is_some());
    tick.store(10_000_000_000, Ordering::SeqCst);
    assert!(store.read_frame(id, 80_000).unwrap().is_none());
    assert!(!file.exists());
    assert_eq!(store.list_page(None, 100, 80_000).unwrap().records.len(), 0);
}

#[test]
fn sleeping_time_counts_towards_the_full_24_hour_limit() {
    let temp = tempfile::tempdir().unwrap();
    let (mut store, tick) = elapsed_store(&temp.path().join("evidence"), 86_400);
    let id = store
        .append(
            store.generation(),
            crate::tests::evidence(100_000),
            true,
            100_000,
        )
        .unwrap();
    // Sleep-inclusive native ticks advance without any maintenance during sleep.
    tick.store(86_400_000_000_000, Ordering::SeqCst);
    assert!(store.read_metadata(id, 99_999).unwrap().is_none());
    assert!(!store.frame_path(id).exists());
}

#[test]
fn missing_or_reversed_elapsed_clock_retains_the_conservative_purge() {
    let temp = tempfile::tempdir().unwrap();
    let (mut store, tick) = elapsed_store(&temp.path().join("evidence"), 10);
    let id = store
        .append(
            store.generation(),
            crate::tests::evidence(100_000),
            true,
            100_000,
        )
        .unwrap();
    tick.store(2_000_000_000, Ordering::SeqCst);
    store.maintenance(103_000).unwrap(); // moves the elapsed anchor forward
    tick.store(1_000_000_000, Ordering::SeqCst);
    assert!(matches!(
        store.maintenance(103_000),
        Err(Error::ClockRollback)
    ));
    assert!(!store.frame_path(id).exists());
    assert!(store.capture_paused());
}

#[test]
fn failed_continuation_write_stops_access_without_deleting_existing_frames() {
    let temp = tempfile::tempdir().unwrap();
    let (mut store, _) = elapsed_store(&temp.path().join("evidence"), 10);
    let id = store
        .append(
            store.generation(),
            crate::tests::evidence(100_000),
            true,
            100_000,
        )
        .unwrap();
    let bytes = fs::read(store.frame_path(id)).unwrap();
    store.db.execute_batch("PRAGMA query_only=ON").unwrap();
    assert!(matches!(store.read_frame(id, 99_999), Err(Error::Storage)));
    assert!(store.poisoned);
    assert!(matches!(store.read_frame(id, 100_001), Err(Error::Storage)));
    assert_eq!(fs::read(store.frame_path(id)).unwrap(), bytes);
}

#[test]
fn adjusted_store_reopens_only_with_its_same_process_time_proof() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("evidence");
    let mut store = crate::tests::open(&root, 100_000);
    store.enable_elapsed_retention(100_000).unwrap();
    let id = store
        .append(
            store.generation(),
            crate::tests::evidence(100_000),
            true,
            100_000,
        )
        .unwrap();
    store.maintenance(99_999).unwrap();
    let sealed: Vec<u8> = store
        .db
        .query_row("SELECT key_check FROM control", [], |r| r.get(0))
        .unwrap();
    let aad = format!("control:{}", store.scope.path_component());
    let clear = store.crypto.open(aad.as_bytes(), &sealed).unwrap();
    assert_ne!(clear.as_slice(), b"drifty-evidence-key-v1"); // old reader refuses
    drop(store);
    let mut same_process = crate::tests::open(&root, 99_999);
    assert!(same_process.read_frame(id, 99_999).unwrap().is_some());
    assert!(!same_process.capture_paused());
    // Authenticate a fixture from a different process epoch, even with a wall
    // clock that has since caught up. Reopening must not regain expired time.
    let sealed: Vec<u8> = same_process
        .db
        .query_row("SELECT key_check FROM control", [], |r| r.get(0))
        .unwrap();
    let mut stamp: serde_json::Value =
        serde_json::from_slice(&same_process.crypto.open(aad.as_bytes(), &sealed).unwrap())
            .unwrap();
    stamp["process"] = serde_json::json!(Uuid::new_v4());
    let sealed = same_process
        .crypto
        .seal(aad.as_bytes(), &serde_json::to_vec(&stamp).unwrap())
        .unwrap();
    same_process
        .db
        .execute("UPDATE control SET key_check=?1", [sealed])
        .unwrap();
    drop(same_process);
    let mut next_process = crate::tests::open(&root, 100_001);
    assert!(next_process.read_frame(id, 100_001).unwrap().is_none());
    assert!(next_process.capture_paused());
    next_process.resume_capture(100_001).unwrap();
    next_process.enable_elapsed_retention(100_001).unwrap();
    assert!(next_process
        .append(
            next_process.generation(),
            crate::tests::evidence(100_001),
            true,
            100_001
        )
        .is_ok());
}
