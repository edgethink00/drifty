use super::*;
use sentry::protocol::debugid::{CodeId, DebugId};
use std::str::FromStr;

const INSTALL_DIR: &str = r"C:\Users\jane\AppData\Local\drifty";
const REPORT_ID: &str = "0f3c2a51-7d1e-4b0e-9c4d-2a6b8e1f0c77";
// 2026-10-12T01:00:00Z as a FILETIME.
const EVENT_UNIX_SECONDS: u64 = 1_791_766_800;

fn filetime_ticks(unix_seconds: u64) -> u64 {
    (unix_seconds + FILETIME_UNIX_OFFSET_SECONDS) * 10_000_000
}

/// A Report.wer shaped like the ones Windows 11 writes: UTF-16LE with a BOM,
/// localized signature names, and the private fields that must never leave.
fn report(event_type: &str, app: &str, signatures: &[&str], app_dir: &str, id: &str) -> Vec<u8> {
    let names = [
        "응용 프로그램 이름",
        "응용 프로그램 버전",
        "응용 프로그램 타임스탬프",
        "오류 모듈 이름",
        "오류 모듈 버전",
        "오류 모듈 타임스탬프",
        "예외 코드",
        "예외 오프셋",
        "추가 정보",
    ];
    let mut lines = vec![
        "Version=1".to_string(),
        format!("EventType={event_type}"),
        format!("EventTime={}", filetime_ticks(EVENT_UNIX_SECONDS)),
        "ReportType=2".to_string(),
        format!("ReportIdentifier={id}"),
        format!("Sig[0].Name={}", names[0]),
        format!("Sig[0].Value={app}"),
    ];
    for (index, value) in signatures.iter().enumerate() {
        lines.push(format!(
            "Sig[{}].Name={}",
            index + 1,
            names[(index + 1).min(names.len() - 1)]
        ));
        lines.push(format!("Sig[{}].Value={value}", index + 1));
    }
    lines.extend([
        "DynamicSig[1].Name=OS 버전".to_string(),
        "DynamicSig[1].Value=10.0.26200.2.0.0.768.101".to_string(),
        "DynamicSig[2].Name=로캘 ID".to_string(),
        "DynamicSig[2].Value=1042".to_string(),
        format!(r"LoadedModule[0]={app_dir}\{app}"),
        r"LoadedModule[1]=C:\Users\jane\Documents\private-plugin.dll".to_string(),
        "OsInfo[0].Key=hostname".to_string(),
        "OsInfo[0].Value=JANES-LAPTOP".to_string(),
        "ConsentKey=APPCRASH".to_string(),
        format!("AppName={app}"),
        format!(r"AppPath={app_dir}\{app}"),
    ]);
    let text = lines.join("\r\n");
    let mut bytes = vec![0xFF, 0xFE];
    for unit in text.encode_utf16() {
        bytes.extend_from_slice(&unit.to_le_bytes());
    }
    bytes
}

fn fail_fast_report(app_dir: &str, id: &str) -> Vec<u8> {
    report(
        "BEX64",
        "drifty.exe",
        &[
            "1.12.2.0",
            "6ac7f9ac",
            "ucrtbase.dll",
            "10.0.26100.9444",
            "2bbefd73",
            "00000000000a527e",
            "c0000409",
            "0000000000000007",
        ],
        app_dir,
        id,
    )
}

fn heap_corruption_report() -> Vec<u8> {
    report(
        "APPCRASH",
        "drifty.exe",
        &[
            "1.12.2.0",
            "6ac7f9ac",
            "StackHash_ab9d",
            "10.0.26100.9444",
            "6bdf03ca",
            "c0000374",
            "PCH_E0_FROM_ntdll+0x0000000000161914",
        ],
        INSTALL_DIR,
        REPORT_ID,
    )
}

fn loaded_image(path: &str, code_id: &str, base: u64) -> DebugImage {
    DebugImage::Symbolic(SymbolicDebugImage {
        name: path.to_string(),
        arch: None,
        image_addr: Addr(base),
        image_size: 0x0080_0000,
        image_vmaddr: Addr(0),
        id: DebugId::from_str("3249d99d-0c40-4931-8610-f4e4fb0b6936-1").unwrap(),
        code_id: Some(CodeId::new(code_id.to_string())),
        debug_file: Some(r"C:\Users\builder\src\target\release\drifty.pdb".to_string()),
    })
}

#[test]
fn fail_fast_reports_read_the_offset_before_the_code() {
    let crash = parse_report_wer(&fail_fast_report(INSTALL_DIR, REPORT_ID)).unwrap();
    assert_eq!(crash.event_type, "BEX64");
    assert_eq!(crash.process, "drifty.exe");
    assert_eq!(crash.app_version.as_deref(), Some("1.12.2.0"));
    assert_eq!(crash.fault_module.as_deref(), Some("ucrtbase.dll"));
    assert_eq!(crash.exception_code, Some(0xC000_0409));
    assert_eq!(crash.exception_offset.as_deref(), Some("00000000000a527e"));
    assert_eq!(crash.os_version.as_deref(), Some("10.0.26200"));
    assert_eq!(
        crash.event_time,
        Some(UNIX_EPOCH + Duration::from_secs(EVENT_UNIX_SECONDS))
    );
    assert_eq!(
        crash.process_dir.as_deref(),
        Some(r"c:\users\jane\appdata\local\drifty")
    );
}

#[test]
fn crash_reports_read_the_code_before_a_pass_through_offset() {
    let crash = parse_report_wer(&heap_corruption_report()).unwrap();
    assert_eq!(crash.event_type, "APPCRASH");
    assert_eq!(crash.exception_code, Some(0xC000_0374));
    assert_eq!(
        crash.exception_offset.as_deref(),
        Some("PCH_E0_FROM_ntdll+0x0000000000161914")
    );

    let event = wer_crash_event(&crash, &[], SystemTime::now());
    let exception = &event.exception.values[0];
    assert_eq!(exception.ty, "STATUS_HEAP_CORRUPTION");
    assert_eq!(
        exception.value.as_deref(),
        Some("drifty.exe 1.12.2.0 stopped with 0xc0000374 in StackHash_ab9d 10.0.26100.9444 at PCH_E0_FROM_ntdll+0x0000000000161914")
    );
    // Without a recorded module timestamp for ntdll there is no address to trust.
    assert!(exception.stacktrace.is_none());
}

#[test]
fn other_applications_hangs_and_unidentified_reports_are_ignored() {
    let chrome = report(
        "APPCRASH",
        "chrome.exe",
        &["1.0.0.0"],
        INSTALL_DIR,
        REPORT_ID,
    );
    assert!(parse_report_wer(&chrome).is_none());
    let hang = report(
        "AppHangB1",
        "drifty.exe",
        &["1.12.2.0"],
        INSTALL_DIR,
        REPORT_ID,
    );
    assert!(parse_report_wer(&hang).is_none());
    let unidentified = report(
        "APPCRASH",
        "drifty.exe",
        &["1.12.2.0"],
        INSTALL_DIR,
        "not-a-report-id",
    );
    assert!(parse_report_wer(&unidentified).is_none());
    assert!(parse_report_wer(b"not a report").is_none());
}

#[test]
fn every_drifty_executable_is_recognized() {
    for process in ["drifty-tracker.exe", "DRIFTY-BROWSER-HOST.EXE"] {
        let bytes = report(
            "APPCRASH",
            process,
            &[
                "0.0.0.0",
                "6ac7f9ac",
                "python312.dll",
                "3.12.10150.1013",
                "67f3a0b1",
                "c0000005",
                "000000000001a2b3",
            ],
            INSTALL_DIR,
            REPORT_ID,
        );
        let crash = parse_report_wer(&bytes).unwrap();
        assert_eq!(crash.process, process.to_ascii_lowercase());
        assert_eq!(crash.exception_code, Some(0xC000_0005));
        // An executable without a version resource joins the running build
        // instead of inventing a drifty-mac@0.0.0 release.
        let event = wer_crash_event(&crash, &[], SystemTime::now());
        assert_eq!(
            event.release.as_deref(),
            Some(release_for_app_version(None).as_str())
        );
    }
}

#[test]
fn event_is_fatal_unhandled_and_carries_no_path_module_list_or_os_inventory() {
    let crash = parse_report_wer(&fail_fast_report(INSTALL_DIR, REPORT_ID)).unwrap();
    let event = wer_crash_event(&crash, &[], SystemTime::now());
    assert_eq!(event.level, Level::Fatal);
    assert_eq!(event.release.as_deref(), Some("drifty-mac@1.12.2"));
    assert_eq!(
        event.timestamp,
        UNIX_EPOCH + Duration::from_secs(EVENT_UNIX_SECONDS)
    );
    let exception = &event.exception.values[0];
    assert_eq!(exception.ty, "STATUS_STACK_BUFFER_OVERRUN");
    let mechanism = exception.mechanism.as_ref().unwrap();
    assert_eq!(mechanism.ty, "windows_error_report");
    assert_eq!(mechanism.handled, Some(false));
    assert_eq!(
        event.tags.get("crash.source").map(String::as_str),
        Some("windows-error-report")
    );
    assert_eq!(
        event.tags.get("crash.incident").map(String::as_str),
        Some(REPORT_ID)
    );
    assert_eq!(
        event.tags.get("crash.exception_code").map(String::as_str),
        Some("0xc0000409")
    );
    assert_eq!(
        event.tags.get("crash.module").map(String::as_str),
        Some("ucrtbase.dll")
    );
    assert!(event.debug_meta.images.is_empty());

    let serialized = serde_json::to_string(&event).unwrap().to_ascii_lowercase();
    for private in [
        "jane",
        "users",
        "private-plugin",
        "janes-laptop",
        "1042",
        "appdata",
    ] {
        assert!(
            !serialized.contains(private),
            "event leaked {private}: {serialized}"
        );
    }
}

#[test]
fn a_module_identical_to_one_in_this_process_gets_a_symbolicated_frame() {
    let crash = parse_report_wer(&report(
        "APPCRASH",
        "drifty.exe",
        &[
            "1.12.2.0",
            "6ac7f9ac",
            "drifty.exe",
            "1.12.2.0",
            "6ac7f9ac",
            "c0000005",
            "0000000000001234",
        ],
        INSTALL_DIR,
        REPORT_ID,
    ))
    .unwrap();
    let base = 0x7FF6_1000_0000;
    let images = [
        loaded_image(
            r"C:\Windows\System32\ntdll.dll",
            "a1b2c3d4200000",
            0x7FFE_0000_0000,
        ),
        loaded_image(
            r"C:\Users\jane\AppData\Local\drifty\drifty.exe",
            "6AC7F9AC2c6000",
            base,
        ),
    ];
    let event = wer_crash_event(&crash, &images, SystemTime::now());
    let frames = &event.exception.values[0]
        .stacktrace
        .as_ref()
        .unwrap()
        .frames;
    assert_eq!(frames.len(), 1);
    assert_eq!(frames[0].instruction_addr, Some(Addr(base + 0x1234)));
    assert_eq!(frames[0].package.as_deref(), Some("drifty.exe"));
    let [DebugImage::Symbolic(image)] = event.debug_meta.images.as_slice() else {
        panic!("expected exactly the matched image");
    };
    assert_eq!(image.name, "drifty.exe");
    assert_eq!(image.debug_file.as_deref(), Some("drifty.pdb"));
    assert_eq!(image.image_addr, Addr(base));

    // An updated binary carries another PE timestamp; its addresses would lie.
    let updated = [loaded_image(
        r"C:\Users\jane\AppData\Local\drifty\drifty.exe",
        "6bd000002c6000",
        base,
    )];
    let event = wer_crash_event(&crash, &updated, SystemTime::now());
    assert!(event.exception.values[0].stacktrace.is_none());
    assert!(event.debug_meta.images.is_empty());
}

fn write_report(root: &Path, folder: &str, bytes: &[u8]) -> PathBuf {
    let dir = root.join(folder);
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join(REPORT_FILE_NAME);
    std::fs::write(&path, bytes).unwrap();
    path
}

#[test]
fn only_this_installs_crashes_are_forwarded_once_across_launches() {
    let archive = tempfile::tempdir().unwrap();
    let queue = tempfile::tempdir().unwrap();
    let state = tempfile::tempdir().unwrap();
    let state_path = state.path().join(STATE_FILE_NAME);
    let first = "11111111-2222-4333-8444-555555555555";
    let second = "66666666-7777-4888-9999-aaaaaaaaaaaa";
    write_report(
        archive.path(),
        "AppCrash_drifty.exe_d19a0e58_cab_1",
        &fail_fast_report(INSTALL_DIR, first),
    );
    write_report(
        queue.path(),
        "BEX64_drifty.exe_65ea597a_cab_2",
        &fail_fast_report(&INSTALL_DIR.to_ascii_uppercase(), second),
    );
    write_report(
        archive.path(),
        "BEX64_drifty.exe_4eb44325_cab_3",
        &fail_fast_report(
            r"C:\Users\jane\qa\drifty-candidate",
            "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
        ),
    );
    write_report(
        archive.path(),
        "AppCrash_chrome.exe_1234_cab_4",
        &report("APPCRASH", "chrome.exe", &["1.0"], INSTALL_DIR, REPORT_ID),
    );
    let dirs = vec![
        archive.path().to_path_buf(),
        queue.path().to_path_buf(),
        archive.path().join("missing"),
    ];
    let install_dir = PathBuf::from(format!(r"\\?\{INSTALL_DIR}\"));

    let mut sent = Vec::new();
    let forwarded = forward_new_reports(
        &dirs,
        &install_dir,
        &[],
        &state_path,
        SystemTime::now(),
        |event| {
            sent.push(event.tags.get("crash.incident").cloned().unwrap());
        },
    );
    sent.sort();
    assert_eq!(forwarded, 2);
    assert_eq!(sent, [first, second]);

    let again = forward_new_reports(
        &dirs,
        &install_dir,
        &[],
        &state_path,
        SystemTime::now(),
        |_| panic!("an already forwarded crash must not be sent again"),
    );
    assert_eq!(again, 0);
}

#[test]
fn reports_older_than_the_window_are_left_alone() {
    let archive = tempfile::tempdir().unwrap();
    let state = tempfile::tempdir().unwrap();
    write_report(
        archive.path(),
        "BEX64_drifty.exe_old",
        &fail_fast_report(INSTALL_DIR, REPORT_ID),
    );
    let later = SystemTime::now() + MAX_REPORT_AGE + Duration::from_secs(60);

    let forwarded = forward_new_reports(
        &[archive.path().to_path_buf()],
        Path::new(INSTALL_DIR),
        &[],
        &state.path().join(STATE_FILE_NAME),
        later,
        |_| panic!("stale crash must not be sent"),
    );
    assert_eq!(forwarded, 0);
}

#[test]
fn the_onedir_tracker_below_the_app_counts_as_this_install() {
    // tauri.windows.conf.json installs the tracker as drifty-tracker\ below the
    // install directory; the app and browser host sit in the directory itself.
    let archive = tempfile::tempdir().unwrap();
    let state = tempfile::tempdir().unwrap();
    let tracker = "12121212-3434-4565-8787-909090909090";
    let host = "abababab-cdcd-4efe-8a0a-1b1b1b1b1b1b";
    let signatures = [
        "0.0.0.0",
        "6ac7f9ac",
        "python312.dll",
        "3.12.10150.1013",
        "67f3a0b1",
        "c0000005",
        "000000000001a2b3",
    ];
    let crash = |process: &str, app_dir: &str, id: &str| {
        report("APPCRASH", process, &signatures, app_dir, id)
    };
    let tracker_dir = format!(r"{INSTALL_DIR}\drifty-tracker");
    write_report(
        archive.path(),
        "AppCrash_drifty-tracker._1",
        &crash("drifty-tracker.exe", &tracker_dir, tracker),
    );
    write_report(
        archive.path(),
        "AppCrash_drifty-browser-_2",
        &crash("drifty-browser-host.exe", INSTALL_DIR, host),
    );
    // Another install's tracker, and a tracker beside the app, where this
    // install never places one.
    write_report(
        archive.path(),
        "AppCrash_drifty-tracker._3",
        &crash(
            "drifty-tracker.exe",
            r"C:\Users\jane\qa\drifty-candidate\drifty-tracker",
            "c1c1c1c1-d2d2-4e3e-8f4f-a5a5a5a5a5a5",
        ),
    );
    write_report(
        archive.path(),
        "AppCrash_drifty-tracker._4",
        &crash(
            "drifty-tracker.exe",
            INSTALL_DIR,
            "e6e6e6e6-f7f7-4a8a-9b9b-c0c0c0c0c0c0",
        ),
    );

    let mut sent = Vec::new();
    let forwarded = forward_new_reports(
        &[archive.path().to_path_buf()],
        Path::new(INSTALL_DIR),
        &[],
        &state.path().join(STATE_FILE_NAME),
        SystemTime::now(),
        |event| {
            sent.push(event.tags.get("crash.incident").cloned().unwrap());
        },
    );
    sent.sort();
    assert_eq!(forwarded, 2);
    assert_eq!(sent, [tracker, host]);
}
