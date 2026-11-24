use super::*;
use crate::{activity_reader::{ActivityResolver, CapturedActivityHint}, native::WindowTitleDigest, LocalActivityRecordRef};
use std::sync::Mutex as StdMutex;

/// Answers resolve requests from a fixed table keyed by how far back the point is.
struct Rows {
    calls: StdMutex<Vec<i64>>,
    answer: Box<dyn Fn(i64) -> Result<Option<LocalActivityRecordRef>, Error> + Send + Sync>,
}
impl ActivityResolver for Rows {
    fn resolve_capture(&self, hint: &CapturedActivityHint, _: &dyn Fn() -> bool)
        -> Result<Option<LocalActivityRecordRef>, Error> {
        let back = unix_millis().unwrap() - hint.observed_at_ms;
        self.calls.lock().unwrap().push(back);
        (self.answer)(back)
    }
    fn read_current(&self, _: &[String], _: &dyn Fn() -> bool) -> Result<Vec<LocalActivityRecordRef>, Error> {
        Ok(Vec::new())
    }
    fn reset(&self) {}
}
fn record(site: Option<&str>) -> LocalActivityRecordRef {
    let mut value = serde_json::json!({"recordId":"7","segmentUid":"f26d8c10-cb09-4c98-a3e3-3744216aab1e",
        "identityDigest":"a".repeat(64),"startedAtMs":1,"endedAtMs":253_402_300_799_999_i64});
    if let Some(site) = site { value["siteDigest"] = serde_json::json!(site); }
    serde_json::from_value(value).unwrap()
}
fn gate(answer: impl Fn(i64) -> Result<Option<LocalActivityRecordRef>, Error> + Send + Sync + 'static)
    -> (SiteGate, Arc<Rows>) {
    let rows = Arc::new(Rows { calls: StdMutex::new(Vec::new()), answer: Box::new(answer) });
    (SiteGate { sites: BTreeSet::from(["b".repeat(64)]), any_site: false, resolver: rows.clone() }, rows)
}
fn title() -> WindowTitleDigest {
    WindowTitleDigest::parse("c".repeat(64)).unwrap()
}

#[test]
fn only_a_vouched_chosen_site_admits_a_browser_window() {
    let (allowed, _) = gate(|_| Ok(Some(record(Some(&"b".repeat(64))))));
    assert!(allowed.admits("com.google.Chrome", &title(), &|| true));
    let (other, _) = gate(|_| Ok(Some(record(Some(&"d".repeat(64))))));
    assert!(!other.admits("com.google.Chrome", &title(), &|| true));
    // No digest means the tracker could not vouch it is not a private window.
    let (unvouched, _) = gate(|_| Ok(Some(record(None))));
    assert!(!unvouched.admits("com.google.Chrome", &title(), &|| true));
}

#[test]
fn the_look_back_is_bounded_to_one_sample_and_fails_closed() {
    let (late, rows) = gate(|back| Ok((back >= 4_000).then(|| record(Some(&"b".repeat(64))))));
    assert!(late.admits("com.google.Chrome", &title(), &|| true));
    assert_eq!(rows.calls.lock().unwrap().len(), 3);
    let (missing, rows) = gate(|_| Ok(None));
    assert!(!missing.admits("com.google.Chrome", &title(), &|| true));
    assert!(rows.calls.lock().unwrap().iter().all(|back| *back <= 6_000));
    let (broken, rows) = gate(|_| Err(Error::WorkerUnavailable));
    assert!(!broken.admits("com.google.Chrome", &title(), &|| true));
    assert_eq!(rows.calls.lock().unwrap().len(), 1);
    let (cancelled, rows) = gate(|_| Ok(Some(record(Some(&"b".repeat(64))))));
    assert!(!cancelled.admits("com.google.Chrome", &title(), &|| false));
    assert!(rows.calls.lock().unwrap().is_empty());
}

#[test]
fn ordinary_admission_never_accepts_a_browser_surface() {
    let facts: SurfaceFacts = serde_json::from_value(serde_json::json!({
        "identity": {"pid": 9, "processBirth": 1, "windowId": 3, "appId": "com.google.Chrome",
            "documentId": "doc", "documentGeneration": 1},
        "permission": true, "foreground": true, "interactive": true, "protected": false,
        "visibility": "visible", "privacy": "browser"})).unwrap();
    let (site, _) = gate(|_| Ok(Some(record(Some(&"b".repeat(64))))));
    let mut policy = CapturePolicy { enabled: true, ocr_enabled: true,
        allowed_apps: BTreeSet::from(["com.google.Chrome".into()]), ..CapturePolicy::default() };
    assert!(!policy.admits(&facts));
    assert!(!policy.admits_browser(&facts, Some(&title()), &|| true));
    policy.site_gate = Some(site);
    assert!(!policy.admits(&facts));
    assert!(policy.admits_browser(&facts, Some(&title()), &|| true));
    assert!(!policy.admits_browser(&facts, None, &|| true));
    policy.allowed_apps.clear();
    assert!(!policy.admits_browser(&facts, Some(&title()), &|| true));
}


#[test]
fn post_capture_admission_needs_the_gate_and_the_backend_flag() {
    let facts: SurfaceFacts = serde_json::from_value(serde_json::json!({
        "identity": {"pid": 9, "processBirth": 1, "windowId": 3, "appId": "com.google.Chrome",
            "documentId": "doc", "documentGeneration": 1},
        "permission": true, "foreground": true, "interactive": true, "protected": false,
        "visibility": "visible", "privacy": "browser"})).unwrap();
    let (site, _) = gate(|_| Ok(Some(record(Some(&"b".repeat(64))))));
    let mut policy = CapturePolicy { enabled: true, ocr_enabled: true,
        allowed_apps: BTreeSet::from(["com.google.Chrome".into()]), ..CapturePolicy::default() };
    assert!(!policy.admits_capture(&facts, true));
    policy.site_gate = Some(site);
    assert!(!policy.admits_capture(&facts, false));
    assert!(policy.admits_capture(&facts, true));
    let mut private = facts.clone();
    private.privacy = crate::Privacy::Private;
    assert!(!policy.admits_capture(&private, true));
    policy.excluded_apps.insert("com.google.Chrome".into());
    assert!(!policy.admits_capture(&facts, true));
}

fn window(app: &str, name: Option<&str>, privacy: &str) -> SurfaceFacts {
    let mut value = serde_json::json!({
        "identity": {"pid": 9, "processBirth": 1, "windowId": 3, "appId": app,
            "documentId": "doc", "documentGeneration": 1},
        "permission": true, "foreground": true, "interactive": true, "protected": false,
        "visibility": "visible", "privacy": privacy});
    if let Some(name) = name { value["appName"] = serde_json::json!(name); }
    serde_json::from_value(value).unwrap()
}

#[test]
fn every_app_memory_admits_any_app_but_the_excluded_by_bundle_or_name() {
    let mut policy = CapturePolicy { enabled: true, ocr_enabled: true, all_apps: true, ..CapturePolicy::default() };
    assert!(policy.validate().is_ok());
    assert!(policy.admits(&window("notion.id", Some("Notion"), "not_browser")));
    // Bundle rules compare without case; name rules match the shown name.
    policy.excluded_apps = BTreeSet::from(["com.1password.1password".into(), "name:kakaotalk".into()]);
    assert!(!policy.admits(&window("com.1Password.1password", Some("1Password"), "not_browser")));
    assert!(!policy.admits(&window("com.kakao.KakaoTalkMac", Some(" KakaoTalk "), "not_browser")));
    assert!(policy.admits(&window("notion.id", Some("Notion"), "not_browser")));
    // Without a name, any name rule refuses the window rather than guessing.
    assert!(!policy.admits(&window("notion.id", None, "not_browser")));
    policy.excluded_apps = BTreeSet::from(["com.1password.1password".into(), "site:example.com".into()]);
    assert!(policy.admits(&window("notion.id", None, "not_browser")));
    // Private, unknown and browser windows never pass ordinary admission.
    for privacy in ["private", "unknown", "browser"] {
        assert!(!policy.admits(&window("notion.id", Some("Notion"), privacy)));
    }
    let bad = window("notion.id", Some("No\ntion"), "not_browser");
    assert!(!policy.admits(&bad));
    // Every-app reading is a selected-apps choice; a general scene cannot carry it.
    policy.scope = CaptureScope::ActiveDisplayScene;
    assert!(policy.validate().is_err());
}

#[test]
fn every_app_memory_admits_a_browser_page_on_any_vouched_site() {
    let rows = |site: Option<String>| -> Arc<Rows> {
        Arc::new(Rows { calls: StdMutex::new(Vec::new()),
            answer: Box::new(move |_| Ok(Some(record(site.as_deref())))) })
    };
    let any = |resolver: Arc<Rows>| SiteGate { sites: BTreeSet::new(), any_site: true, resolver };
    let safari = window("com.apple.Safari", Some("Safari"), "browser");
    let mut policy = CapturePolicy { enabled: true, ocr_enabled: true, all_apps: true, ..CapturePolicy::default() };
    policy.site_gate = Some(any(rows(Some("d".repeat(64)))));
    assert!(policy.admits_browser(&safari, Some(&title()), &|| true));
    // No vouched site (a private window, or one the tracker could not read) refuses.
    policy.site_gate = Some(any(rows(None)));
    assert!(!policy.admits_browser(&safari, Some(&title()), &|| true));
    // An excluded browser app refuses before any site is asked.
    policy.site_gate = Some(any(rows(Some("d".repeat(64)))));
    policy.excluded_apps.insert("com.apple.safari".into());
    assert!(!policy.admits_browser(&safari, Some(&title()), &|| true));
}

