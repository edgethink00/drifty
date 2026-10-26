// The candidate ships only on macOS; Windows keeps the existing Python helper.
#![cfg(target_os = "macos")]
use std::{path::Path, process::Command};

fn compare(script: &str) {
    let python = std::env::var_os("DRIFTY_TEST_PYTHON").unwrap_or_else(|| "python3".into());
    let result = Command::new(python)
        .arg("-I")
        .arg(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("tests")
                .join(script),
        )
        .arg(env!("CARGO_BIN_EXE_drifty-screen-activity"))
        .output()
        .expect("Python oracle must be available for the macOS helper contract");
    assert!(
        result.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&result.stdout),
        String::from_utf8_lossy(&result.stderr)
    );
}
#[test]
fn reader_matches_existing_python_wire_and_preserves_database() {
    compare("compare_reader.py");
}
#[test]
fn preparer_matches_existing_python_states_and_schema() {
    compare("compare_prepare.py");
}
