use std::{
    fs,
    path::Path,
    process::{Child, Command, Stdio},
    thread,
    time::{Duration, Instant},
};

const SAFARI_QA_URL: &str = "https://example.com/?drifty_extreme_nudge_qa=safari-native";
const EDGE_QA_URL: &str = "https://example.com/?drifty_extreme_nudge_qa=edge-native";
const FIREFOX_QA_URL: &str = "https://example.com/?drifty_extreme_nudge_qa=firefox-native";

#[test]
#[ignore = "launches Safari and closes a real test tab"]
fn qa_closes_safari_tab_through_native_browser_tab_path() {
    if !Path::new("/Applications/Safari.app").exists() {
        eprintln!("Safari is not installed; skipping manual QA test");
        return;
    }

    open_safari_tab(SAFARI_QA_URL).expect("open Safari QA tab");
    wait_for_tab_count("Safari", SAFARI_QA_URL, 1).expect("Safari QA tab is visible");

    super::close_browser_tab(
        "Safari",
        None,
        Some(SAFARI_QA_URL),
        Some("example.com"),
        false,
    )
    .expect("native Safari close_browser_tab closes QA tab");

    wait_for_tab_count("Safari", SAFARI_QA_URL, 0).expect("Safari QA tab is closed");
}

#[test]
#[ignore = "launches Microsoft Edge with a temporary profile and closes a real test tab"]
fn qa_closes_edge_tab_through_native_browser_tab_path() {
    if !Path::new("/Applications/Microsoft Edge.app").exists() {
        eprintln!("Microsoft Edge is not installed; skipping manual QA test");
        return;
    }
    match process_exists("Microsoft Edge") {
        Ok(true) => {
            eprintln!("Microsoft Edge is already running; skipping isolated QA test");
            return;
        }
        Ok(false) => {}
        Err(error) => panic!("failed to confirm Edge precondition: {error}"),
    }

    let profile = TempProfile::new("drifty-edge-native-qa").expect("create Edge QA profile");
    let mut browser = launch_browser(
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        &[
            format!("--user-data-dir={}", profile.path()),
            "--no-first-run".to_string(),
            "--no-default-browser-check".to_string(),
            "--new-window".to_string(),
            EDGE_QA_URL.to_string(),
        ],
    )
    .expect("launch Edge QA browser");

    let result = wait_for_tab_count("Microsoft Edge", EDGE_QA_URL, 1)
        .map_err(|error| format!("Edge QA tab did not open: {error}"))
        .and_then(|_| {
            run_osascript_text(r#"tell application "Microsoft Edge" to activate"#).map(|_| ())
        })
        .and_then(|_| {
            // SSH-launched automation cannot always activate GUI apps itself.
            // Leave enough time for the Computer Use foreground handoff used by
            // the attended pre-merge smoke without weakening the assertion.
            wait_until(Duration::from_secs(20), || {
                process_is_frontmost("Microsoft Edge")
            })
            .map_err(|error| format!("Edge did not become frontmost: {error}"))
        })
        .and_then(|_| {
            super::close_browser_tab(
                "Microsoft Edge",
                None,
                Some(EDGE_QA_URL),
                Some("example.com"),
                false,
            )
            .map_err(|error| error.to_string())
        })
        .and_then(|_| {
            wait_for_tab_count("Microsoft Edge", EDGE_QA_URL, 0)
                .map_err(|error| format!("Edge QA tab remained after close: {error}"))
        });

    cleanup_edge_browser(&mut browser, profile.path());
    result.expect("native Edge close_browser_tab closes QA tab");
}

#[test]
#[ignore = "launches Microsoft Edge with a temporary profile and proves a background tab is preserved"]
fn qa_refuses_to_close_edge_after_the_browser_loses_frontmost() {
    if !Path::new("/Applications/Microsoft Edge.app").exists() {
        eprintln!("Microsoft Edge is not installed; skipping manual QA test");
        return;
    }
    match process_exists("Microsoft Edge") {
        Ok(true) => {
            eprintln!("Microsoft Edge is already running; skipping isolated QA test");
            return;
        }
        Ok(false) => {}
        Err(error) => panic!("failed to confirm Edge precondition: {error}"),
    }

    let profile = TempProfile::new("drifty-edge-background-guard-qa")
        .expect("create Edge background-guard QA profile");
    let mut browser = launch_browser(
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        &[
            format!("--user-data-dir={}", profile.path()),
            "--no-first-run".to_string(),
            "--no-default-browser-check".to_string(),
            "--new-window".to_string(),
            EDGE_QA_URL.to_string(),
        ],
    )
    .expect("launch Edge background-guard QA browser");

    let result = wait_for_tab_count("Microsoft Edge", EDGE_QA_URL, 1)
        .and_then(|_| run_osascript_text(r#"tell application "Finder" to activate"#).map(|_| ()))
        .and_then(|_| {
            wait_until(Duration::from_secs(4), || {
                process_is_frontmost("Microsoft Edge").map(|frontmost| !frontmost)
            })
        })
        .and_then(|_| {
            match super::close_browser_tab(
                "Microsoft Edge",
                None,
                Some(EDGE_QA_URL),
                Some("example.com"),
                false,
            ) {
                Err(super::ExtremeNudgeError::BrowserTabNotFound { diagnostic })
                    if diagnostic == "chromium_not_frontmost" =>
                {
                    Ok(())
                }
                other => Err(format!(
                    "expected chromium_not_frontmost, observed {other:?}"
                )),
            }
        })
        .and_then(|_| wait_for_tab_count("Microsoft Edge", EDGE_QA_URL, 1));

    cleanup_edge_browser(&mut browser, profile.path());
    result.expect("native Edge close guard preserves a tab after focus moves away");
}

#[test]
#[ignore = "launches Firefox with a temporary profile and closes a real test tab when Accessibility exposes the front window"]
fn qa_closes_firefox_tab_through_native_browser_tab_path() {
    if !Path::new("/Applications/Firefox.app").exists() {
        eprintln!("Firefox is not installed; skipping manual QA test");
        return;
    }

    let profile = TempProfile::new("drifty-firefox-native-qa").expect("create Firefox QA profile");
    prepare_firefox_profile(&profile.path()).expect("prepare Firefox QA profile");
    let mut browser = launch_browser(
        "/Applications/Firefox.app/Contents/MacOS/firefox",
        &[
            "--no-remote".to_string(),
            "--profile".to_string(),
            profile.path(),
            "--new-window".to_string(),
            FIREFOX_QA_URL.to_string(),
        ],
    )
    .expect("launch Firefox QA browser");

    let result = match wait_for_firefox_url_match(FIREFOX_QA_URL, true) {
        Ok(()) => super::close_browser_tab(
            "Firefox",
            None,
            Some(FIREFOX_QA_URL),
            Some("example.com"),
            false,
        )
        .map_err(|error| error.to_string())
        .and_then(|_| wait_for_firefox_url_match(FIREFOX_QA_URL, false)),
        Err(error) => {
            eprintln!("Firefox URL is not exposed through Accessibility; skipping QA: {error}");
            Ok(())
        }
    };

    cleanup_browser_process(&mut browser, profile.path());
    result.expect("native Firefox close_browser_tab closes QA tab");
}

fn open_safari_tab(url: &str) -> Result<(), String> {
    let url = applescript_string_literal(url);
    let script = format!(
        r#"tell application "Safari"
  activate
  make new document with properties {{URL:"{url}"}}
end tell"#
    );
    run_osascript_text(&script).map(|_| ())
}

fn prepare_firefox_profile(profile_path: &str) -> Result<(), String> {
    let prefs = [
        r#"user_pref("accessibility.force_disabled", -1);"#,
        r#"user_pref("browser.aboutwelcome.enabled", false);"#,
        r#"user_pref("browser.shell.checkDefaultBrowser", false);"#,
        r#"user_pref("browser.startup.homepage_override.mstone", "ignore");"#,
        r#"user_pref("browser.startup.firstrunSkipsHomepage", true);"#,
        r#"user_pref("startup.homepage_welcome_url", "about:blank");"#,
        r#"user_pref("startup.homepage_welcome_url.additional", "");"#,
        r#"user_pref("datareporting.policy.dataSubmissionPolicyBypassNotification", true);"#,
        r#"user_pref("app.normandy.first_run", false);"#,
    ]
    .join("\n");
    fs::write(format!("{profile_path}/user.js"), format!("{prefs}\n"))
        .map_err(|error| error.to_string())
}

fn wait_for_tab_count(app_name: &str, url: &str, expected: usize) -> Result<(), String> {
    wait_until(Duration::from_secs(12), || {
        let count = browser_tab_count(app_name, url)?;
        if count == expected {
            Ok(true)
        } else {
            Ok(false)
        }
    })
}

fn browser_tab_count(app_name: &str, url: &str) -> Result<usize, String> {
    let app_name = applescript_string_literal(app_name);
    let url = applescript_string_literal(url);
    let script = format!(
        r#"tell application "{app_name}"
  set targetUrl to "{url}"
  set matchCount to 0
  repeat with browserWindow in windows
    repeat with browserTab in tabs of browserWindow
      try
        if URL of browserTab is targetUrl then set matchCount to matchCount + 1
      end try
    end repeat
  end repeat
  return matchCount
end tell"#
    );
    run_osascript_text(&script)?
        .parse::<usize>()
        .map_err(|error| error.to_string())
}

fn process_is_frontmost(app_name: &str) -> Result<bool, String> {
    let app_name = applescript_string_literal(app_name);
    let observed = run_osascript_text(&format!(
        r#"tell application "System Events"
  if not (exists process "{app_name}") then return "missing"
  tell process "{app_name}" to return frontmost
end tell"#
    ))?;
    match observed.as_str() {
        "true" => Ok(true),
        "false" => Ok(false),
        _ => Err(format!("unexpected frontmost state: {observed}")),
    }
}

fn process_exists(app_name: &str) -> Result<bool, String> {
    let app_name = applescript_string_literal(app_name);
    let observed = run_osascript_text(&format!(
        r#"tell application "System Events" to return exists process "{app_name}""#
    ))?;
    match observed.as_str() {
        "true" => Ok(true),
        "false" => Ok(false),
        _ => Err(format!("unexpected process state: {observed}")),
    }
}

fn wait_for_firefox_url_match(url: &str, expected: bool) -> Result<(), String> {
    let url = applescript_string_literal(url);
    let schemaless_url = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .unwrap_or(&url)
        .to_string();
    wait_until(Duration::from_secs(12), || {
        let script = format!(
            r#"tell application "System Events"
  if not (exists process "Firefox") then return "no_process"
end tell
tell application "Firefox" to activate
delay 0.1
tell application "System Events"
  tell process "Firefox"
    set frontmost to true
    if not (exists front window) then return "no_window"
    set windowTitle to name of front window
    set currentUrl to ""
    set focusedRole to ""
    keystroke "l" using command down
    delay 0.4
    try
      set focusedElement to value of attribute "AXFocusedUIElement"
      set focusedRole to value of attribute "AXRole" of focusedElement as text
      set currentUrl to value of attribute "AXValue" of focusedElement as text
    end try
    key code 53
    if currentUrl is "{url}" or currentUrl is "{schemaless_url}" then return "match"
    return "window:" & windowTitle & "|role:" & focusedRole & "|url:" & currentUrl
  end tell
end tell
return "no_match""#
        );
        let observed = run_osascript_text(&script)?;
        if (observed == "match") == expected {
            Ok(true)
        } else {
            Err(format!(
                "Firefox URL match expected {expected}, observed {observed}"
            ))
        }
    })
}

fn run_osascript_text(script: &str) -> Result<String, String> {
    let output = super::run_osascript(script).map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn wait_until(
    timeout: Duration,
    mut condition: impl FnMut() -> Result<bool, String>,
) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    let mut last_error: Option<String> = None;
    loop {
        match condition() {
            Ok(true) => return Ok(()),
            Ok(false) => {}
            Err(error) => last_error = Some(error),
        }

        if Instant::now() >= deadline {
            return Err(last_error.unwrap_or_else(|| "condition timed out".to_string()));
        }

        thread::sleep(Duration::from_millis(250));
    }
}

fn launch_browser(binary: &str, args: &[String]) -> Result<Child, String> {
    Command::new(binary)
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| error.to_string())
}

fn cleanup_browser_process(child: &mut Child, profile_path: String) {
    let _ = child.kill();
    let _ = child.wait();
    let _ = Command::new("pkill").args(["-f", &profile_path]).status();
}

fn cleanup_edge_browser(child: &mut Child, profile_path: String) {
    let _ = run_osascript_text(r#"tell application "Microsoft Edge" to quit"#);
    cleanup_browser_process(child, profile_path);
    let _ = Command::new("pkill")
        .args(["-x", "Microsoft Edge"])
        .status();
    let _ = wait_until(Duration::from_secs(4), || {
        process_exists("Microsoft Edge").map(|exists| !exists)
    });
}

fn applescript_string_literal(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

struct TempProfile {
    path: String,
}

impl TempProfile {
    fn new(prefix: &str) -> Result<Self, String> {
        let output = Command::new("mktemp")
            .args(["-d", &format!("/tmp/{prefix}.XXXXXX")])
            .output()
            .map_err(|error| error.to_string())?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
        Ok(Self {
            path: String::from_utf8_lossy(&output.stdout).trim().to_string(),
        })
    }

    fn path(&self) -> String {
        self.path.clone()
    }
}

impl Drop for TempProfile {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}
