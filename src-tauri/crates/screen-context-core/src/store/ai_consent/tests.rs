use super::*;
use crate::{
    ai_consent::AiRecipientRevision,
    ai_input::{AiPurpose, AiSourceChoices},
};

fn choices() -> (AiRecipientRevision, AiConsentPreferences) {
    let recipient =
        AiRecipientRevision::from_native_configuration(b"owned-recipient/model/location-policy")
            .unwrap();
    let mut value = AiConsentPreferences::default();
    value
        .confirm(
            recipient.clone(),
            AiSourceChoices {
                accessibility_text: true,
                purposes: BTreeSet::from([AiPurpose::Classification]),
                ..Default::default()
            },
        )
        .unwrap();
    (recipient, value)
}

type Snapshot = (
    Vec<(String, Option<String>)>,
    Vec<Vec<rusqlite::types::Value>>,
);
fn snapshot(store: &EvidenceStore) -> Snapshot {
    let schema=store.db.prepare("SELECT type,sql FROM sqlite_master WHERE name='screen_ai_consent' OR tbl_name='screen_ai_consent' ORDER BY type,name").unwrap().query_map([],|row|Ok((row.get(0)?,row.get(1)?))).unwrap().collect::<Result<Vec<_>,_>>().unwrap();
    let mut statement = store.db.prepare("SELECT * FROM screen_ai_consent").unwrap();
    let columns = statement.column_count();
    let rows = statement
        .query_map([], |row| {
            (0..columns)
                .map(|n| row.get(n))
                .collect::<Result<Vec<rusqlite::types::Value>, _>>()
        })
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    (schema, rows)
}

#[test]
fn first_read_creates_no_table_and_encrypted_consent_survives_reopen_without_capture_inheritance() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("store");
    let mut store = crate::tests::open(&root, 1000);
    assert_eq!(
        store.read_ai_consent_preferences(1000).unwrap(),
        AiConsentPreferences::default()
    );
    assert!(!store.ai_consent_table_exists().unwrap());
    let (recipient, value) = choices();
    store
        .save_ai_consent_preferences(&value, 1000, &|| true)
        .unwrap();
    assert_eq!(
        store.read_preferences(1000).unwrap(),
        crate::CapturePreferences::default()
    );
    let sealed: Vec<u8> = store
        .db
        .query_row(
            "SELECT value FROM screen_ai_consent WHERE id=1",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(!sealed
        .windows(b"recipientRevision".len())
        .any(|w| w == b"recipientRevision"));
    assert!(!sealed
        .windows(b"accessibilityText".len())
        .any(|w| w == b"accessibilityText"));
    drop(store);
    let mut reopened = crate::tests::open(&root, 1001);
    assert_eq!(reopened.read_ai_consent_preferences(1001).unwrap(), value);
    reopened.purge().unwrap();
    assert!(reopened.capture_paused());
    assert!(
        reopened
            .read_ai_consent_preferences(1001)
            .unwrap()
            .choices_for(&recipient)
            .accessibility_text
    );
    assert!(!reopened.read_preferences(1001).unwrap().enabled);
}

#[test]
fn committed_pending_barrier_refuses_reopen_and_explicit_empty_save_can_recover_it() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("store");
    let mut store = crate::tests::open(&root, 1000);
    let (_, value) = choices();
    let path = store.directory.join(CATALOG);
    let revoked = std::cell::Cell::new(false);
    let current = || {
        if revoked.get() {
            return false;
        }
        let reader =
            Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        let exists: bool = reader
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name='screen_ai_consent')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        if exists {
            revoked.set(true);
            false
        } else {
            true
        }
    };
    assert!(matches!(
        store.save_ai_consent_preferences(&value, 1000, &current),
        Err(Error::Invalidated)
    ));
    assert!(revoked.get());
    assert!(store.read_ai_consent_preferences(1000).is_err());
    drop(store);
    let mut store = crate::tests::open(&root, 1001);
    assert!(store.read_ai_consent_preferences(1001).is_err());
    store
        .save_ai_consent_preferences(&AiConsentPreferences::default(), 1001, &|| true)
        .unwrap();
    assert_eq!(
        store.read_ai_consent_preferences(1001).unwrap(),
        AiConsentPreferences::default()
    );
}

#[test]
fn cancellation_after_real_grant_commit_keeps_the_pending_barrier_on_reopen() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("store");
    let mut store = crate::tests::open(&root, 1000);
    let (_, value) = choices();
    store
        .save_ai_consent_preferences(&AiConsentPreferences::default(), 1000, &|| true)
        .unwrap();
    let old: Vec<u8> = store
        .db
        .query_row(
            "SELECT value FROM screen_ai_consent WHERE id=1",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let path = store.directory.join(CATALOG);
    let saw = std::cell::Cell::new(false);
    let current = || {
        let reader =
            Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        let (sealed, pending): (Vec<u8>, i64) = reader
            .query_row(
                "SELECT value,pending FROM screen_ai_consent WHERE id=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        if sealed != old && pending == 1 {
            saw.set(true);
            false
        } else {
            !saw.get()
        }
    };
    assert!(matches!(
        store.save_ai_consent_preferences(&value, 1000, &current),
        Err(Error::Invalidated)
    ));
    assert!(saw.get());
    drop(store);
    let mut reopened = crate::tests::open(&root, 1001);
    assert!(reopened.read_ai_consent_preferences(1001).is_err());
    reopened
        .save_ai_consent_preferences(&AiConsentPreferences::default(), 1001, &|| true)
        .unwrap();
    assert_eq!(
        reopened.read_ai_consent_preferences(1001).unwrap(),
        AiConsentPreferences::default()
    );
}

#[test]
fn future_schema_triggers_or_encrypted_versions_are_preserved_even_when_saving_off() {
    for case in ["future-table", "extra-trigger", "future-value"] {
        let temp = tempfile::tempdir().unwrap();
        let mut store = crate::tests::open(&temp.path().join("store"), 1000);
        let (_, value) = choices();
        if case == "future-table" {
            store.db.execute_batch("CREATE TABLE screen_ai_consent(future TEXT);INSERT INTO screen_ai_consent VALUES('preserve');").unwrap();
        } else {
            store
                .save_ai_consent_preferences(&value, 1000, &|| true)
                .unwrap();
            if case == "extra-trigger" {
                store.db.execute_batch("CREATE TRIGGER future_ai AFTER UPDATE ON screen_ai_consent BEGIN SELECT 1; END").unwrap();
            } else {
                let sealed = store
                    .crypto
                    .seal(
                        format!("screen-ai-consent:{}", store.scope.path_component()).as_bytes(),
                        br#"{"version":2,"grants":[]}"#,
                    )
                    .unwrap();
                store
                    .db
                    .execute("UPDATE screen_ai_consent SET value=?1", [sealed])
                    .unwrap();
            }
        }
        let before = snapshot(&store);
        assert!(store.read_ai_consent_preferences(1000).is_err());
        assert!(store
            .save_ai_consent_preferences(&AiConsentPreferences::default(), 1000, &|| true)
            .is_err());
        assert_eq!(snapshot(&store), before, "changed {case}");
    }
}

#[test]
fn consent_ciphertext_cannot_be_reused_as_capture_preferences_or_in_another_profile() {
    let temp = tempfile::tempdir().unwrap();
    let mut a = crate::tests::open(&temp.path().join("a"), 1000);
    let (_, value) = choices();
    a.save_ai_consent_preferences(&value, 1000, &|| true)
        .unwrap();
    let sealed: Vec<u8> =
        a.db.query_row(
            "SELECT value FROM screen_ai_consent WHERE id=1",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let mut b = EvidenceStore::open(
        &temp.path().join("b"),
        ScopeId::from_profile("another").unwrap(),
        Zeroizing::new([7; 32]),
        Retention::default(),
        1000,
    )
    .unwrap();
    b.db.execute_batch(TABLE_SQL).unwrap();
    b.db.execute("INSERT INTO screen_ai_consent VALUES(1,?1,0)", [&sealed])
        .unwrap();
    assert!(b.read_ai_consent_preferences(1000).is_err());
    assert!(a
        .crypto
        .open(
            format!("preferences:{}", a.scope.path_component()).as_bytes(),
            &sealed
        )
        .is_err());
}

#[test]
fn a_cancelled_initial_save_adds_no_optional_schema() {
    let temp = tempfile::tempdir().unwrap();
    let mut store = crate::tests::open(&temp.path().join("store"), 1000);
    assert!(matches!(
        store.save_ai_consent_preferences(&AiConsentPreferences::default(), 1000, &|| false),
        Err(Error::Invalidated)
    ));
    assert!(!store.ai_consent_table_exists().unwrap());
}

#[test]
fn enabled_capture_preferences_never_initialize_or_change_separate_ai_grants() {
    let temp = tempfile::tempdir().unwrap();
    let mut store = crate::tests::open(&temp.path().join("store"), 1000);
    let capture = crate::CapturePreferences {
        enabled: true,
        replay_enabled: true,
        ocr_enabled: true,
        allowed_apps: BTreeSet::from(["owned.editor".into()]),
        ..Default::default()
    };
    store.save_preferences(&capture, 1000, &|| true).unwrap();
    assert_eq!(
        store.read_ai_consent_preferences(1000).unwrap(),
        AiConsentPreferences::default()
    );
    assert!(!store.ai_consent_table_exists().unwrap());
    let (_, consent) = choices();
    store
        .save_ai_consent_preferences(&consent, 1000, &|| true)
        .unwrap();
    assert_eq!(store.read_preferences(1000).unwrap(), capture);
}
