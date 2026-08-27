#![cfg(target_os = "macos")]

use std::{
    env,
    path::Path,
    process::Command,
    thread,
    time::{Duration, Instant},
};

use objc2::rc::autoreleasepool;
use objc2_app_kit::NSRunningApplication;
use objc2_foundation::NSString;

const BACKGROUND_QA_ENV: &str = "DRIFTY_NATIVE_QA_BACKGROUND_APP";
const CALCULATOR_PATH: &str = "/System/Applications/Calculator.app";
const CALCULATOR_BUNDLE_ID: &str = "com.apple.calculator";

#[test]
#[ignore = "launches and closes a hidden Calculator after an explicit local QA opt-in"]
fn qa_terminates_a_real_app_and_observes_its_exit() {
    assert_eq!(
        env::var(BACKGROUND_QA_ENV).as_deref(),
        Ok("1"),
        "refusing to close a real app without explicit background-app QA opt-in"
    );
    assert!(
        Path::new(CALCULATOR_PATH).exists(),
        "Calculator is unavailable in this macOS image"
    );
    assert_eq!(
        running_application_count(CALCULATOR_BUNDLE_ID),
        0,
        "refusing to reuse or close a pre-existing Calculator instance"
    );

    let _guard = RunningAppGuard::new(CALCULATOR_BUNDLE_ID);
    let status = Command::new("/usr/bin/open")
        .args(["-g", "-j", "-n", CALCULATOR_PATH])
        .status()
        .expect("launch Calculator in the background");
    assert!(status.success(), "open returned {status}");
    assert!(
        wait_until(Duration::from_secs(8), || {
            running_application_count(CALCULATOR_BUNDLE_ID) == 1
        }),
        "Calculator did not register with NSRunningApplication"
    );

    let termination_started = Instant::now();
    let termination_result = super::terminate_app_by_bundle_id(CALCULATOR_BUNDLE_ID);
    eprintln!(
        "native termination returned {:?} after {:?}; running={}",
        termination_result,
        termination_started.elapsed(),
        running_application_count(CALCULATOR_BUNDLE_ID)
    );
    if termination_result.is_err() {
        for observation in 1..=12 {
            thread::sleep(Duration::from_millis(250));
            eprintln!(
                "post-failure observation {observation}: running={}",
                running_application_count(CALCULATOR_BUNDLE_ID)
            );
        }
    }
    termination_result.expect("native app termination observes Calculator exit");

    assert!(
        wait_until(Duration::from_secs(3), || {
            running_application_count(CALCULATOR_BUNDLE_ID) == 0
        }),
        "Calculator remained registered after termination succeeded"
    );
}

struct RunningAppGuard {
    bundle_id: &'static str,
}

impl RunningAppGuard {
    fn new(bundle_id: &'static str) -> Self {
        Self { bundle_id }
    }
}

impl Drop for RunningAppGuard {
    fn drop(&mut self) {
        force_terminate_running_applications(self.bundle_id);
        let _ = wait_until(Duration::from_secs(2), || {
            running_application_count(self.bundle_id) == 0
        });
    }
}

fn running_application_count(bundle_id: &str) -> usize {
    autoreleasepool(|_| {
        let bundle_identifier = NSString::from_str(bundle_id);
        NSRunningApplication::runningApplicationsWithBundleIdentifier(&bundle_identifier).count()
    })
}

fn force_terminate_running_applications(bundle_id: &str) {
    autoreleasepool(|_| {
        let bundle_identifier = NSString::from_str(bundle_id);
        let applications =
            NSRunningApplication::runningApplicationsWithBundleIdentifier(&bundle_identifier);
        for index in 0..applications.count() {
            applications.objectAtIndex(index).forceTerminate();
        }
    });
}

fn wait_until(timeout: Duration, condition: impl Fn() -> bool) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if condition() {
            return true;
        }
        thread::sleep(Duration::from_millis(25));
    }
    condition()
}
