//! Opt-in native QA for Windows automatic close. A runner in the interactive
//! desktop session opens a real browser on uniquely marked loopback pages,
//! makes the target tab foreground, and runs this test. It locates the close
//! control the way Pet Mode does, then applies the product's automatic close,
//! and records both outcomes. The runner judges them against its own
//! scenario and an outside connection oracle; this test asserts nothing about
//! success so refusal scenarios use the same entry point.

use std::{env, fs};

const ENV_OPT_IN: &str = "DRIFTY_NATIVE_QA_WINDOWS_TAB_CLOSE";
const ENV_BROWSER: &str = "DRIFTY_NATIVE_QA_BROWSER";
const ENV_BROWSER_IDENTITY: &str = "DRIFTY_NATIVE_QA_BROWSER_IDENTITY";
const ENV_URL: &str = "DRIFTY_NATIVE_QA_URL";
const ENV_OPERATION: &str = "DRIFTY_NATIVE_QA_OPERATION";
const ENV_RESULT_PATH: &str = "DRIFTY_NATIVE_QA_RESULT_PATH";

#[test]
#[ignore = "locates and closes the foreground tab of a real browser opened by the Windows QA runner"]
fn qa_windows_locates_then_applies_automatic_close() {
    assert_eq!(
        env::var(ENV_OPT_IN).as_deref(),
        Ok("1"),
        "set {ENV_OPT_IN}=1 to confirm this native UI action"
    );
    let browser_name = env::var(ENV_BROWSER).expect("set DRIFTY_NATIVE_QA_BROWSER");
    let browser_identity =
        env::var(ENV_BROWSER_IDENTITY).expect("set DRIFTY_NATIVE_QA_BROWSER_IDENTITY");
    let url = env::var(ENV_URL).expect("set DRIFTY_NATIVE_QA_URL");
    assert!(
        url.starts_with("http://127.0.0.1:") && url.contains("drifty_browser_qa="),
        "QA may only target a marked loopback page: {url}"
    );
    let operation = env::var(ENV_OPERATION).unwrap_or_else(|_| "locate-close".to_string());
    let result_path = env::var(ENV_RESULT_PATH).expect("set DRIFTY_NATIVE_QA_RESULT_PATH");

    let mut result = serde_json::Map::new();
    if operation.contains("locate") {
        let located = super::windows::browser_process_name(&browser_name)
            .ok_or_else(|| "windows_uia_unsupported_browser".to_string())
            .and_then(|process_name| {
                crate::commands::windows_browser_uia::locate_foreground_tab_close(
                    process_name,
                    &browser_identity,
                    &url,
                    "",
                )
            });
        result.insert(
            "locate".to_string(),
            match located {
                Ok(point) => serde_json::json!({
                    "ok": true, "x": point.x, "y": point.y, "diagnostic": point.diagnostic
                }),
                Err(diagnostic) => serde_json::json!({ "ok": false, "diagnostic": diagnostic }),
            },
        );
    }
    if operation.contains("close") {
        let target: super::super::ExtremeNudgeTarget = serde_json::from_value(serde_json::json!({
            "appName": browser_name,
            "bundleId": browser_identity,
            "browserName": browser_name,
            "siteUrl": url,
        }))
        .expect("QA target");
        result.insert(
            "close".to_string(),
            match super::super::apply_extreme_nudge(&target) {
                Ok(outcome) => serde_json::json!({
                    "ok": true,
                    "outcome": serde_json::to_value(&outcome).expect("serialize outcome"),
                }),
                Err(error) => serde_json::json!({
                    "ok": false,
                    "failure": serde_json::to_value(super::super::ExtremeNudgeFailure::from(error))
                        .expect("serialize failure"),
                }),
            },
        );
    }
    fs::write(
        &result_path,
        serde_json::to_vec_pretty(&serde_json::Value::Object(result)).expect("serialize result"),
    )
    .expect("write QA result");
}
