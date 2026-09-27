use super::*;
use serde_json::json;

const DRIFTY_UUID: &str = "4c4c44e2-5555-3144-a1b2-000000000001";
const APPKIT_UUID: &str = "4c4c44e2-5555-3144-a1b2-000000000002";
const DRIFTY_BASE: u64 = 0x1_0000_0000;
const APPKIT_BASE: u64 = 0x1_9000_0000;

fn report_text(header: Value, body: Value) -> String {
    format!("{header}\n{body}")
}

fn drifty_header(incident: &str) -> Value {
    json!({
        "bug_type": "309",
        "app_name": "drifty",
        "app_version": "1.11.21",
        "bundleID": "so.drifty.mac",
        "incident_id": incident,
        "os_version": "macOS 26.6 (25G72)",
    })
}

fn used_images() -> Value {
    json!([
        {
            "source": "P", "arch": "arm64", "base": DRIFTY_BASE, "size": 0x0200_0000u64,
            "uuid": DRIFTY_UUID, "name": "drifty",
            "path": "/Users/jane/Applications/drifty.app/Contents/MacOS/drifty"
        },
        {
            "source": "P", "arch": "arm64e", "base": APPKIT_BASE, "size": 0x0100_0000u64,
            "uuid": APPKIT_UUID, "name": "AppKit",
            "path": "/System/Library/Frameworks/AppKit.framework/Versions/C/AppKit"
        },
        {
            "source": "A", "base": 0, "size": 0, "name": "unreferenced.dylib"
        }
    ])
}

fn uncaught_exception_body() -> Value {
    json!({
        "procName": "drifty",
        "procPath": "/Users/jane/Applications/drifty.app/Contents/MacOS/drifty",
        "exception": { "type": "EXC_CRASH", "signal": "SIGABRT" },
        "termination": { "indicator": "Abort trap: 6" },
        "asi": {
            "CoreFoundation": [
                "*** Terminating app due to uncaught exception 'NSInternalInconsistencyException', reason: 'bad frame in /Users/jane/Library/x'"
            ]
        },
        "faultingThread": 0,
        "lastExceptionBacktrace": [
            { "imageIndex": 1, "imageOffset": 0x40, "symbol": "-[NSWindow setFrame:display:]", "symbolLocation": 8 },
            { "imageIndex": 0, "imageOffset": 0x1234, "symbol": "drifty_lib::commands::pet_panel::show" }
        ],
        "threads": [
            { "triggered": true, "frames": [ { "imageIndex": 1, "imageOffset": 0x10 } ] }
        ],
        "usedImages": used_images(),
    })
}

#[test]
fn uncaught_appkit_exception_reports_its_reason_and_throw_site() {
    let report = parse_crash_report(&report_text(
        drifty_header("incident-1"),
        uncaught_exception_body(),
    ))
    .expect("a Drifty crash report");

    assert_eq!(report.incident_id, "incident-1");
    assert_eq!(report.app_version.as_deref(), Some("1.11.21"));
    assert_eq!(report.exception_type, "EXC_CRASH (SIGABRT)");
    assert_eq!(
        report.exception_value.as_deref(),
        Some("*** Terminating app due to uncaught exception 'NSInternalInconsistencyException', reason: 'bad frame in /Users/[user]/Library/x'")
    );
    assert!(report.from_exception_backtrace);

    // Caller first: the Drifty call site, then the AppKit frame that threw.
    let functions: Vec<_> = report
        .frames
        .iter()
        .map(|frame| frame.function.as_deref())
        .collect();
    assert_eq!(
        functions,
        [
            Some("drifty_lib::commands::pet_panel::show"),
            Some("-[NSWindow setFrame:display:]")
        ]
    );
    let caller = &report.frames[0];
    assert_eq!(caller.instruction_addr, Some(Addr(DRIFTY_BASE + 0x1234)));
    assert_eq!(caller.package.as_deref(), Some("drifty"));
    assert_eq!(caller.in_app, Some(true));
    let thrower = &report.frames[1];
    assert_eq!(thrower.in_app, Some(false));
    assert_eq!(thrower.symbol_addr, Some(Addr(APPKIT_BASE + 0x40 - 8)));

    // Only images a frame points into, named without their paths.
    let names: Vec<_> = report
        .images
        .iter()
        .map(|image| match image {
            DebugImage::Symbolic(image) => image.name.as_str(),
            _ => panic!("expected symbolic images"),
        })
        .collect();
    assert_eq!(names, ["drifty", "AppKit"]);
}

#[test]
fn abort_without_an_exception_uses_the_crashed_thread_and_termination() {
    let body = json!({
        "procName": "drifty",
        "exception": { "type": "EXC_BAD_ACCESS", "signal": "SIGSEGV", "subtype": "KERN_INVALID_ADDRESS at 0x0000000000000010" },
        "termination": { "indicator": "Segmentation fault: 11" },
        "faultingThread": 1,
        "threads": [
            { "frames": [ { "imageIndex": 1, "imageOffset": 0x99 } ] },
            { "frames": [
                { "imageIndex": 0, "imageOffset": 0x20, "symbol": "inner" },
                { "imageIndex": 0, "imageOffset": 0x10, "symbol": "outer" }
            ] }
        ],
        "usedImages": used_images(),
    });

    let report = parse_crash_report(&report_text(drifty_header("incident-2"), body)).unwrap();

    assert_eq!(report.exception_type, "EXC_BAD_ACCESS (SIGSEGV)");
    assert_eq!(
        report.exception_value.as_deref(),
        Some("KERN_INVALID_ADDRESS at 0x0000000000000010\nSegmentation fault: 11")
    );
    assert!(!report.from_exception_backtrace);
    let functions: Vec<_> = report
        .frames
        .iter()
        .map(|frame| frame.function.as_deref())
        .collect();
    assert_eq!(functions, [Some("outer"), Some("inner")]);
}

#[test]
fn other_processes_and_non_crash_reports_are_ignored() {
    let body = uncaught_exception_body();
    let mut other_app = drifty_header("incident-3");
    other_app["bundleID"] = json!("com.example.other");
    assert!(parse_crash_report(&report_text(other_app, body.clone())).is_none());

    let mut hang = drifty_header("incident-4");
    hang["bug_type"] = json!("288");
    assert!(parse_crash_report(&report_text(hang, body.clone())).is_none());

    assert!(parse_crash_report("not a report").is_none());
}

#[test]
fn crash_event_is_fatal_unhandled_and_carries_no_process_path() {
    let report = parse_crash_report(&report_text(
        drifty_header("incident-5"),
        uncaught_exception_body(),
    ))
    .unwrap();
    let event = crash_event(&report, SystemTime::UNIX_EPOCH);

    assert_eq!(event.level, Level::Fatal);
    assert_eq!(
        event.release.as_deref(),
        Some(release_for_app_version(Some("1.11.21")).as_str())
    );
    let exception = &event.exception.values[0];
    assert_eq!(exception.mechanism.as_ref().unwrap().handled, Some(false));
    assert_eq!(
        event.tags.get("crash.incident").map(String::as_str),
        Some("incident-5")
    );
    match event.contexts.get("os") {
        Some(Context::Os(os)) => {
            assert_eq!(os.version.as_deref(), Some("26.6"));
            assert_eq!(os.build.as_deref(), Some("25G72"));
        }
        other => panic!("expected an os context, got {other:?}"),
    }
    let serialized = serde_json::to_string(&event).unwrap();
    assert!(!serialized.contains("/Users/jane"), "{serialized}");
}

#[test]
fn earlier_versions_get_their_own_release_and_the_running_version_joins_its_build() {
    assert_eq!(release_for_app_version(Some("0.0.1")), "drifty-mac@0.0.1");
    assert_eq!(
        release_for_app_version(Some(env!("CARGO_PKG_VERSION"))),
        release_for_app_version(None)
    );
}

#[test]
fn each_crash_is_forwarded_once_across_launches() {
    let reports = tempfile::tempdir().unwrap();
    let state = tempfile::tempdir().unwrap();
    let state_path = state.path().join(STATE_FILE_NAME);
    std::fs::write(
        reports.path().join("drifty-2026-09-27-120000.ips"),
        report_text(drifty_header("incident-a"), uncaught_exception_body()),
    )
    .unwrap();
    std::fs::write(
        reports.path().join("drifty-2026-09-27-130000.ips"),
        report_text(drifty_header("incident-b"), uncaught_exception_body()),
    )
    .unwrap();
    let mut foreign = drifty_header("incident-c");
    foreign["bundleID"] = json!("com.example.other");
    std::fs::write(
        reports.path().join("drifty-helper-2026-09-27.ips"),
        report_text(foreign, uncaught_exception_body()),
    )
    .unwrap();
    std::fs::write(reports.path().join("drifty-notes.txt"), "ignored").unwrap();
    let dirs = vec![reports.path().to_path_buf(), reports.path().join("missing")];

    let mut sent = Vec::new();
    let forwarded = forward_new_reports(&dirs, &state_path, SystemTime::now(), |event| {
        sent.push(event.tags.get("crash.incident").cloned().unwrap());
    });
    sent.sort();
    assert_eq!(forwarded, 2);
    assert_eq!(sent, ["incident-a", "incident-b"]);

    let again = forward_new_reports(&dirs, &state_path, SystemTime::now(), |_| {
        panic!("an already forwarded crash must not be sent again")
    });
    assert_eq!(again, 0);
}

#[test]
fn reports_older_than_the_window_are_left_alone() {
    let reports = tempfile::tempdir().unwrap();
    let state = tempfile::tempdir().unwrap();
    std::fs::write(
        reports.path().join("drifty-old.ips"),
        report_text(drifty_header("incident-old"), uncaught_exception_body()),
    )
    .unwrap();
    let later = SystemTime::now() + MAX_REPORT_AGE + Duration::from_secs(60);

    let forwarded = forward_new_reports(
        &[reports.path().to_path_buf()],
        &state.path().join(STATE_FILE_NAME),
        later,
        |_| panic!("stale crash must not be sent"),
    );
    assert_eq!(forwarded, 0);
}
