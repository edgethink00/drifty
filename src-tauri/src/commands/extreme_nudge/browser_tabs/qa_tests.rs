use std::{
    fs,
    io::{Read, Write},
    net::TcpStream,
    path::Path,
    process::{Child, Command, Stdio},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const SAFARI_QA_URL: &str = "https://example.com/?drifty_extreme_nudge_qa=safari-native";
const EDGE_QA_URL: &str = "https://example.com/?drifty_extreme_nudge_qa=edge-native";
const FIREFOX_QA_URL: &str = "https://example.com/?drifty_extreme_nudge_qa=firefox-native";
const BROWSER_QA_ORACLE_HOST: &str = "127.0.0.1";
const BROWSER_QA_ORACLE_PORT: u16 = 18_777;
const ENV_BROWSER_QA_OPT_IN: &str = "DRIFTY_NATIVE_QA_BROWSER_TAB_CLOSE";
const ENV_BROWSER_QA_BROWSER: &str = "DRIFTY_NATIVE_QA_BROWSER";
const ENV_BROWSER_QA_URL: &str = "DRIFTY_NATIVE_QA_URL";
const ENV_BROWSER_QA_ACTIVE_URL: &str = "DRIFTY_NATIVE_QA_ACTIVE_URL";
const ENV_BROWSER_QA_FORCE_AX: &str = "DRIFTY_NATIVE_QA_FORCE_AX";
const ENV_BROWSER_QA_SKIP_FOCUS: &str = "DRIFTY_NATIVE_QA_SKIP_FOCUS";
const ENV_BROWSER_QA_SOAK_MARKER: &str = "DRIFTY_NATIVE_QA_SOAK_MARKER";
const ENV_BROWSER_QA_SOAK_ITERATIONS: &str = "DRIFTY_NATIVE_QA_SOAK_ITERATIONS";
const ENV_BROWSER_QA_WHALE_PROFILE: &str = "DRIFTY_NATIVE_QA_WHALE_PROFILE";
/// Makes the Firefox matrix target play quiet audio so its tab shows the audio
/// toggle beside the close button, the shape of a playing video tab.
const ENV_BROWSER_QA_TARGET_AUDIO: &str = "DRIFTY_NATIVE_QA_TARGET_AUDIO";

#[test]
#[ignore = "closes an explicitly selected loopback QA tab in an already running browser"]
fn qa_closes_environment_selected_loopback_tab_through_native_path() {
    assert_eq!(
        std::env::var(ENV_BROWSER_QA_OPT_IN).as_deref(),
        Ok("1"),
        "set {ENV_BROWSER_QA_OPT_IN}=1 to confirm this native UI action"
    );

    let browser_name = std::env::var(ENV_BROWSER_QA_BROWSER)
        .expect("set DRIFTY_NATIVE_QA_BROWSER to an installed supported browser");
    assert!(
        super::is_supported_browser_tab_target(&browser_name),
        "unsupported QA browser: {browser_name}"
    );

    let qa_url = std::env::var(ENV_BROWSER_QA_URL)
        .expect("set DRIFTY_NATIVE_QA_URL to a uniquely marked loopback URL");
    let (host, _) = validated_loopback_qa_url(&qa_url);

    let skip_focus = std::env::var(ENV_BROWSER_QA_SKIP_FOCUS).as_deref() == Ok("1");
    if !skip_focus
        && matches!(
            browser_name.as_str(),
            "Google Chrome"
                | "Google Chrome Canary"
                | "Microsoft Edge"
                | "Arc"
                | "Aside"
                | "Brave Browser"
                | "Chromium"
                | "Opera"
                | "Vivaldi"
                | "Whale"
        )
    {
        focus_chromium_qa_tab(&browser_name, &qa_url)
            .expect("focus the exact marked Chromium QA tab before closing it");
    } else if !skip_focus
        && matches!(
            browser_name.as_str(),
            "Safari" | "Safari Technology Preview"
        )
    {
        focus_safari_qa_tab(&browser_name, &qa_url)
            .expect("focus the exact marked Safari QA tab before closing it");
    }

    let force_ax = std::env::var(ENV_BROWSER_QA_FORCE_AX).as_deref() == Ok("1");
    let diagnostic =
        super::close_browser_tab(&browser_name, None, Some(&qa_url), Some(&host), force_ax)
            .expect("native close_browser_tab closes the selected QA tab");

    eprintln!("browser={browser_name} diagnostic={diagnostic}");
}

#[test]
#[ignore = "proves a marked background QA tab is not closed when another marked tab is active"]
fn qa_refuses_background_loopback_tab_when_frontmost_is_different() {
    assert_eq!(
        std::env::var(ENV_BROWSER_QA_OPT_IN).as_deref(),
        Ok("1"),
        "set {ENV_BROWSER_QA_OPT_IN}=1 to confirm this native UI action"
    );
    let browser_name = std::env::var(ENV_BROWSER_QA_BROWSER)
        .expect("set DRIFTY_NATIVE_QA_BROWSER to an installed supported browser");
    assert!(
        matches!(
            browser_name.as_str(),
            "Google Chrome"
                | "Google Chrome Canary"
                | "Microsoft Edge"
                | "Arc"
                | "Aside"
                | "Brave Browser"
                | "Chromium"
                | "Opera"
                | "Vivaldi"
                | "Safari"
                | "Safari Technology Preview"
                | "Firefox Developer Edition"
                | "Floorp"
                | "Zen"
                | "Whale"
        ),
        "background-tab refusal QA currently targets scriptable macOS browsers"
    );
    let target_url = std::env::var(ENV_BROWSER_QA_URL)
        .expect("set DRIFTY_NATIVE_QA_URL to the marked background target URL");
    let active_url = std::env::var(ENV_BROWSER_QA_ACTIVE_URL)
        .expect("set DRIFTY_NATIVE_QA_ACTIVE_URL to a different marked active URL");
    let (target_host, target_marker) = validated_loopback_qa_url(&target_url);
    let (active_host, active_marker) = validated_loopback_qa_url(&active_url);
    assert_eq!(
        target_marker, active_marker,
        "target and active QA URLs must belong to the same run"
    );
    assert_ne!(
        target_url, active_url,
        "the active QA URL must differ from the target"
    );
    assert_ne!(
        target_host, active_host,
        "the negative QA tab must be outside the retained exact-or-domain match policy"
    );

    let skip_focus = std::env::var(ENV_BROWSER_QA_SKIP_FOCUS).as_deref() == Ok("1");
    if skip_focus {
        eprintln!("browser={browser_name} focus=prearranged_by_external_oracle");
    } else if matches!(
        browser_name.as_str(),
        "Safari" | "Safari Technology Preview"
    ) {
        focus_safari_qa_tab(&browser_name, &active_url).expect(
            "focus the exact marked Safari sentinel before attempting the background target",
        );
    } else {
        focus_chromium_qa_tab(&browser_name, &active_url).expect(
            "focus the exact marked Chromium sentinel before attempting the background target",
        );
    }
    let force_ax = std::env::var(ENV_BROWSER_QA_FORCE_AX).as_deref() == Ok("1");
    let error = super::close_browser_tab(
        &browser_name,
        None,
        Some(&target_url),
        Some(&target_host),
        force_ax,
    )
    .expect_err("frontmost close must refuse a background target outside the accepted domain");

    match error {
        super::super::ExtremeNudgeError::BrowserTabNotFound { diagnostic } => {
            eprintln!("browser={browser_name} refusal={diagnostic}");
        }
        other => panic!("expected fail-closed target refusal, observed {other:?}"),
    }
}

#[test]
#[ignore = "opens and closes marked loopback targets repeatedly while a connection oracle proves both sentinels survive"]
fn qa_soaks_environment_selected_browser_tab_close() {
    assert_eq!(
        std::env::var(ENV_BROWSER_QA_OPT_IN).as_deref(),
        Ok("1"),
        "set {ENV_BROWSER_QA_OPT_IN}=1 to confirm this native UI action"
    );
    let browser_name = std::env::var(ENV_BROWSER_QA_BROWSER)
        .expect("set DRIFTY_NATIVE_QA_BROWSER to an installed supported browser");
    assert!(
        super::is_supported_browser_tab_target(&browser_name),
        "unsupported QA browser: {browser_name}"
    );
    let marker = std::env::var(ENV_BROWSER_QA_SOAK_MARKER)
        .expect("set DRIFTY_NATIVE_QA_SOAK_MARKER to a unique synthetic run marker");
    assert!(
        !marker.is_empty()
            && marker.len() <= 80
            && marker
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || ".-_".contains(character)),
        "invalid browser QA soak marker"
    );
    let iterations = std::env::var(ENV_BROWSER_QA_SOAK_ITERATIONS)
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(10);
    assert!(
        (1..=20).contains(&iterations),
        "browser QA soak iterations must be between 1 and 20"
    );

    let left_url = browser_qa_url(&marker, "sentinel-left");
    let right_url = browser_qa_url(&marker, "sentinel-right");
    open_browser_qa_tab(&browser_name, &left_url).expect("open left soak sentinel");
    wait_for_browser_qa_oracle_roles(&marker, &[("sentinel-left", 1)])
        .expect("left soak sentinel connects to the outside oracle");
    open_browser_qa_tab(&browser_name, &right_url).expect("open right soak sentinel");
    wait_for_browser_qa_oracle_roles(&marker, &[("sentinel-left", 1), ("sentinel-right", 1)])
        .expect("both soak sentinels connect to the outside oracle");

    let force_ax = std::env::var(ENV_BROWSER_QA_FORCE_AX).as_deref() == Ok("1");
    let mut diagnostics = Vec::new();
    for index in 1..=iterations {
        let role = format!("target-{index:02}");
        let target_url = browser_qa_url(&marker, &role);
        open_browser_qa_tab(&browser_name, &target_url).expect("open marked soak target");
        wait_for_browser_qa_oracle_roles(
            &marker,
            &[("sentinel-left", 1), ("sentinel-right", 1), (&role, 1)],
        )
        .expect("target and both sentinels are connected before close");

        let diagnostic = super::close_browser_tab(
            &browser_name,
            None,
            Some(&target_url),
            Some(BROWSER_QA_ORACLE_HOST),
            force_ax,
        )
        .expect("native close removes the marked frontmost soak target");
        diagnostics.push(diagnostic);
        wait_for_browser_qa_oracle_roles(
            &marker,
            &[("sentinel-left", 1), ("sentinel-right", 1), (&role, 0)],
        )
        .expect("only the target disconnects after the close");
    }

    eprintln!(
        "browser={browser_name} closes={iterations} false_closes=0 diagnostics={diagnostics:?}"
    );
}

fn open_browser_qa_tab(browser_name: &str, url: &str) -> Result<(), String> {
    match browser_name {
        "Firefox" => open_firefox_qa_tab(url),
        "Firefox Developer Edition" | "Floorp" | "Zen" => open_app_qa_tab(browser_name, url),
        "Whale" => open_whale_qa_tab(url),
        "Google Chrome Canary" => open_app_qa_tab(browser_name, url),
        "Safari" | "Safari Technology Preview" => open_app_qa_tab(browser_name, url),
        _ => open_chromium_qa_tab(browser_name, url),
    }
}

fn open_whale_qa_tab(url: &str) -> Result<(), String> {
    let profile = std::env::var(ENV_BROWSER_QA_WHALE_PROFILE)
        .map_err(|_| format!("set {ENV_BROWSER_QA_WHALE_PROFILE} to the isolated QA profile"))?;
    let status = Command::new("/Applications/Whale.app/Contents/MacOS/Whale")
        .args([
            format!("--user-data-dir={profile}"),
            "--new-tab".to_string(),
            url.to_string(),
        ])
        .status()
        .map_err(|error| error.to_string())?;
    if status.success() {
        run_osascript_text(r#"tell application "Whale" to activate"#)?;
        thread::sleep(Duration::from_millis(400));
        Ok(())
    } else {
        Err(format!("Whale --new-tab failed with {status}"))
    }
}

fn open_app_qa_tab(browser_name: &str, url: &str) -> Result<(), String> {
    let status = Command::new("open")
        .args(["-a", browser_name, url])
        .status()
        .map_err(|error| error.to_string())?;
    if status.success() {
        if matches!(browser_name, "Floorp" | "Whale" | "Zen") {
            let browser_name = applescript_string_literal(browser_name);
            run_osascript_text(&format!("tell application \"{browser_name}\" to activate"))?;
        }
        thread::sleep(Duration::from_millis(400));
        Ok(())
    } else {
        Err(format!("open -a {browser_name} failed with {status}"))
    }
}

fn open_chromium_qa_tab(browser_name: &str, url: &str) -> Result<(), String> {
    let browser_name = applescript_string_literal(browser_name);
    let url = applescript_string_literal(url);
    let script = format!(
        r#"tell application "{browser_name}"
  if not (exists front window) then make new window
  set qaTab to make new tab at end of tabs of front window with properties {{URL:"{url}"}}
  set active tab index of front window to count of tabs of front window
  activate
  return "opened"
end tell"#
    );
    let result = run_osascript_text(&script)?;
    if result == "opened" {
        Ok(())
    } else {
        Err(format!("could not open Chromium QA tab: {result}"))
    }
}

fn validated_loopback_qa_url(raw_url: &str) -> (String, String) {
    let parsed = url::Url::parse(raw_url).expect("browser QA URL must be valid");
    assert!(
        matches!(parsed.scheme(), "http" | "https"),
        "QA URL must use http or https"
    );
    let host = parsed.host_str().expect("QA URL must have a host");
    assert!(
        matches!(host, "localhost" | "127.0.0.1" | "::1") || host.ends_with(".localhost"),
        "QA URL must use a loopback-only host"
    );
    let marker = parsed
        .query_pairs()
        .find_map(|(key, value)| {
            (key == "drifty_browser_qa" && !value.trim().is_empty()).then(|| value.into_owned())
        })
        .expect("QA URL must carry a non-empty drifty_browser_qa marker");
    (host.to_string(), marker)
}

fn focus_chromium_qa_tab(browser_name: &str, url: &str) -> Result<(), String> {
    let browser_name = applescript_string_literal(browser_name);
    let url = applescript_string_literal(url);
    let script = format!(
        r#"set targetUrl to "{url}"
tell application "{browser_name}"
  set foundTarget to false
  repeat with browserWindow in windows
    set tabIndex to 0
    repeat with browserTab in tabs of browserWindow
      set tabIndex to tabIndex + 1
      try
        if URL of browserTab is targetUrl then
          set active tab index of browserWindow to tabIndex
          set index of browserWindow to 1
          set foundTarget to true
          exit repeat
        end if
      end try
    end repeat
    if foundTarget then exit repeat
  end repeat
  if foundTarget is false then return "not_found"
  activate
  return "focused"
end tell"#
    );

    let result = run_osascript_text(&script)?;
    if result == "focused" {
        Ok(())
    } else {
        Err(format!("expected focused, observed {result}"))
    }
}

fn focus_safari_qa_tab(browser_name: &str, url: &str) -> Result<(), String> {
    let browser_name = applescript_string_literal(browser_name);
    let url = applescript_string_literal(url);
    let script = format!(
        r#"set targetUrl to "{url}"
tell application "{browser_name}"
  set foundTarget to false
  repeat with browserWindow in windows
    repeat with browserTab in tabs of browserWindow
      try
        if URL of browserTab is targetUrl then
          set current tab of browserWindow to browserTab
          set index of browserWindow to 1
          set foundTarget to true
          exit repeat
        end if
      end try
    end repeat
    if foundTarget then exit repeat
  end repeat
  if foundTarget is false then return "not_found"
  activate
  return "focused"
end tell"#
    );

    let result = run_osascript_text(&script)?;
    if result == "focused" {
        Ok(())
    } else {
        Err(format!("expected focused, observed {result}"))
    }
}

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

#[cfg(target_os = "macos")]
#[test]
#[ignore = "launches an isolated Firefox profile and proves positive and negative close behavior with a loopback connection oracle"]
fn qa_exercises_firefox_loopback_tab_close_matrix() {
    assert_eq!(
        std::env::var(ENV_BROWSER_QA_OPT_IN).as_deref(),
        Ok("1"),
        "set {ENV_BROWSER_QA_OPT_IN}=1 to confirm this native UI action"
    );
    if !Path::new("/Applications/Firefox.app").exists() {
        eprintln!("Firefox is not installed; skipping manual QA test");
        return;
    }

    let run_id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock is after Unix epoch")
        .as_millis();
    let marker = format!("firefox-{run_id}");
    let left_url = browser_qa_url(&marker, "sentinel-left");
    let right_url = browser_qa_url_on_host(&marker, "sentinel-right", "negative.localhost");
    let target_audio = std::env::var(ENV_BROWSER_QA_TARGET_AUDIO).as_deref() == Ok("1");
    let target_url = if target_audio {
        format!("{}&audio=1", browser_qa_url(&marker, "target"))
    } else {
        browser_qa_url(&marker, "target")
    };
    browser_qa_oracle_roles(&marker)
        .expect("start scripts/qa/browser-ax-pages/server.mjs on 127.0.0.1:18777 first");

    let profile =
        TempProfile::new("drifty-firefox-matrix-qa").expect("create isolated Firefox QA profile");
    prepare_firefox_profile(&profile.path()).expect("prepare Firefox QA profile");
    let mut browser = launch_browser(
        "/Applications/Firefox.app/Contents/MacOS/firefox",
        &[
            "--no-remote".to_string(),
            "--profile".to_string(),
            profile.path(),
            "--new-window".to_string(),
            left_url.clone(),
        ],
    )
    .expect("launch isolated Firefox QA browser");

    let result = (|| -> Result<(), String> {
        wait_for_browser_qa_oracle_roles(&marker, &[("sentinel-left", 1)])?;
        dismiss_firefox_startup_overlay()?;
        open_firefox_qa_tab(&right_url)?;
        wait_for_browser_qa_oracle_roles(&marker, &[("sentinel-left", 1), ("sentinel-right", 1)])?;
        open_firefox_qa_tab(&target_url)?;
        wait_for_browser_qa_oracle_roles(
            &marker,
            &[("sentinel-left", 1), ("sentinel-right", 1), ("target", 1)],
        )?;

        focus_firefox_qa_tab(&target_url)?;
        focus_firefox_qa_tab(&right_url)?;
        // The preflight Pet Mode runs before the cat approaches must refuse
        // exactly what the close refuses.
        match super::preflight_native_ax_tab_close(
            "Firefox",
            Some(&target_url),
            Some(BROWSER_QA_ORACLE_HOST),
        ) {
            Err(diagnostic) if diagnostic == "firefox_native_ax_target_mismatch" => {
                eprintln!("browser=Firefox preflight_refusal={diagnostic}");
            }
            other => {
                return Err(format!(
                    "Firefox preflight did not refuse the negative tab: {other:?}"
                ));
            }
        }
        let refusal = match super::close_browser_tab(
            "Firefox",
            None,
            Some(&target_url),
            Some(BROWSER_QA_ORACLE_HOST),
            false,
        ) {
            Err(error) => error,
            Ok(diagnostic) => {
                return Err(format!(
                    "Firefox close unexpectedly accepted the negative tab: {diagnostic}"
                ));
            }
        };
        match refusal {
            super::super::ExtremeNudgeError::BrowserTabNotFound { diagnostic } => {
                eprintln!("browser=Firefox refusal={diagnostic}");
            }
            other => return Err(format!("unexpected Firefox refusal error: {other:?}")),
        }
        wait_for_browser_qa_oracle_roles(
            &marker,
            &[("sentinel-left", 1), ("sentinel-right", 1), ("target", 1)],
        )?;

        focus_firefox_qa_tab(&target_url)?;
        if target_audio {
            // Let the tab's audio toggle appear before geometry is read.
            thread::sleep(Duration::from_secs(2));
        }
        eprintln!(
            "browser=Firefox target_tab_buttons=\n{}",
            describe_firefox_qa_tab_buttons(&target_url)?
        );
        let hotspot = super::preflight_native_ax_tab_close(
            "Firefox",
            Some(&target_url),
            Some(BROWSER_QA_ORACLE_HOST),
        )
        .map_err(|diagnostic| format!("Firefox preflight refused the target: {diagnostic}"))?;
        eprintln!(
            "browser=Firefox preflight_hotspot=({:.1},{:.1}) exact={} diagnostic={}",
            hotspot.x, hotspot.y, hotspot.exact, hotspot.diagnostic
        );
        if !hotspot.exact {
            return Err(format!(
                "Firefox preflight did not locate the close control: {}",
                hotspot.diagnostic
            ));
        }
        let diagnostic = super::close_browser_tab(
            "Firefox",
            None,
            Some(&target_url),
            Some(BROWSER_QA_ORACLE_HOST),
            false,
        )
        .map_err(|error| error.to_string())?;
        eprintln!("browser=Firefox diagnostic={diagnostic}");
        wait_for_browser_qa_oracle_roles(
            &marker,
            &[("sentinel-left", 1), ("sentinel-right", 1), ("target", 0)],
        )
    })();

    cleanup_browser_process(&mut browser, profile.path());
    result.expect("Firefox loopback close matrix passes without an out-of-policy close");
}

fn dismiss_firefox_startup_overlay() -> Result<(), String> {
    run_osascript_text(
        r#"tell application "Firefox" to activate
delay 0.1
tell application "System Events"
  tell process "Firefox"
    set frontmost to true
    key code 53
  end tell
end tell"#,
    )
    .map(|_| ())
}

fn open_firefox_qa_tab(url: &str) -> Result<(), String> {
    // DOM ids first: Firefox's visible labels follow its UI language, and the
    // matrix must run on localized builds as well as English and Korean.
    let open_result = run_osascript_text(
        r#"tell application "Firefox" to activate
delay 0.1
tell application "System Events"
  tell process "Firefox"
    set frontmost to true
    set allElements to entire contents of front window
    repeat with currentElement in allElements
      try
        if role of currentElement is "AXButton" then
          set domId to value of attribute "AXDOMIdentifier" of currentElement as text
          if domId is "tabs-newtab-button" or domId is "new-tab-button" or domId is "vertical-tabs-newtab-button" then
            perform action "AXPress" of currentElement
            return "opened"
          end if
        end if
      end try
    end repeat
    repeat with currentElement in allElements
      try
        if role of currentElement is "AXButton" then
          set buttonDescription to description of currentElement as text
          if buttonDescription contains "새 탭" or buttonDescription contains "New Tab" or buttonDescription contains "new tab" then
            perform action "AXPress" of currentElement
            return "opened"
          end if
        end if
      end try
    end repeat
    return "no_new_tab_button"
  end tell
end tell"#,
    )?;
    if open_result != "opened" {
        return Err(format!(
            "could not press Firefox new-tab action: {open_result}"
        ));
    }

    let url = applescript_string_literal(url);
    let script = format!(
        r#"tell application "Firefox" to activate
delay 0.2
tell application "System Events"
  tell process "Firefox"
    set frontmost to true
    set allElements to entire contents of front window
    repeat with currentElement in allElements
      try
        if role of currentElement is "AXComboBox" then
          set descriptionText to description of currentElement as text
          set domId to ""
          try
            set domId to value of attribute "AXDOMIdentifier" of currentElement as text
          end try
          if domId is "urlbar-input" or descriptionText contains "주소" or descriptionText contains "Address" or descriptionText contains "address" or descriptionText contains "URL" or descriptionText contains "url" then
            set value of currentElement to "{url}"
            set value of attribute "AXFocused" of currentElement to true
            key code 36
            return "opened"
          end if
        end if
      end try
    end repeat
    return "no_address"
  end tell
end tell"#
    );
    let result = run_osascript_text(&script)?;
    if result == "opened" {
        Ok(())
    } else {
        Err(format!("could not open Firefox QA tab: {result}"))
    }
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
        r#"user_pref("browser.ctrlTab.sortByRecentlyUsed", false);"#,
        // Lets the audio QA target play without a click, so its tab shows the
        // audio toggle.
        r#"user_pref("media.autoplay.default", 0);"#,
        r#"user_pref("media.autoplay.blocking_policy", 0);"#,
        r#"user_pref("browser.shell.checkDefaultBrowser", false);"#,
        r#"user_pref("browser.startup.homepage_override.mstone", "ignore");"#,
        r#"user_pref("browser.startup.firstrunSkipsHomepage", true);"#,
        r#"user_pref("browser.translations.automaticallyPopup", false);"#,
        r#"user_pref("startup.homepage_welcome_url", "about:blank");"#,
        r#"user_pref("startup.homepage_welcome_url.additional", "");"#,
        r#"user_pref("datareporting.policy.dataSubmissionPolicyBypassNotification", true);"#,
        r#"user_pref("datareporting.policy.firstRunURL", "");"#,
        r#"user_pref("termsofuse.bypassNotification", true);"#,
        r#"user_pref("app.normandy.first_run", false);"#,
    ]
    .join("\n");
    fs::write(format!("{profile_path}/user.js"), format!("{prefs}\n"))
        .map_err(|error| error.to_string())
}

fn browser_qa_url(marker: &str, role: &str) -> String {
    browser_qa_url_on_host(marker, role, BROWSER_QA_ORACLE_HOST)
}

fn browser_qa_url_on_host(marker: &str, role: &str, host: &str) -> String {
    format!("http://{host}:{BROWSER_QA_ORACLE_PORT}/?drifty_browser_qa={marker}&role={role}")
}

fn wait_for_browser_qa_oracle_roles(
    marker: &str,
    expected: &[(&str, usize)],
) -> Result<(), String> {
    wait_until(Duration::from_secs(15), || {
        let roles = browser_qa_oracle_roles(marker)?;
        let matches = expected.iter().all(|(role, expected_count)| {
            roles
                .get(*role)
                .and_then(serde_json::Value::as_u64)
                .unwrap_or(0)
                == *expected_count as u64
        });
        if matches {
            Ok(true)
        } else {
            Err(format!(
                "browser QA oracle roles mismatch: expected={expected:?} observed={roles:?}"
            ))
        }
    })
}

fn browser_qa_oracle_roles(
    marker: &str,
) -> Result<serde_json::Map<String, serde_json::Value>, String> {
    let mut stream = TcpStream::connect((BROWSER_QA_ORACLE_HOST, BROWSER_QA_ORACLE_PORT))
        .map_err(|error| format!("connect browser QA oracle: {error}"))?;
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .map_err(|error| error.to_string())?;
    let request = format!(
        "GET /status?drifty_browser_qa={marker} HTTP/1.1\r\nHost: {BROWSER_QA_ORACLE_HOST}:{BROWSER_QA_ORACLE_PORT}\r\nConnection: close\r\n\r\n"
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|error| error.to_string())?;
    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .map_err(|error| error.to_string())?;
    let (_, body) = response
        .split_once("\r\n\r\n")
        .ok_or_else(|| "browser QA oracle returned an invalid HTTP response".to_string())?;
    let payload: serde_json::Value =
        serde_json::from_str(body.trim()).map_err(|error| error.to_string())?;
    payload
        .get("roles")
        .and_then(serde_json::Value::as_object)
        .cloned()
        .ok_or_else(|| "browser QA oracle response omitted roles".to_string())
}

fn focus_firefox_qa_tab(url: &str) -> Result<(), String> {
    let expected_title = applescript_string_literal(&firefox_qa_tab_title(url)?);
    let script = format!(
        r#"tell application "Firefox" to activate
delay 0.1
tell application "System Events"
  tell process "Firefox"
    set frontmost to true
    set allElements to entire contents of front window
    repeat with currentElement in allElements
      try
        if role of currentElement is "AXRadioButton" and title of currentElement is "{expected_title}" then
          perform action "AXPress" of currentElement
          return "focused"
        end if
      end try
    end repeat
    return "not_found"
  end tell
end tell"#
    );
    let result = run_osascript_text(&script)?;
    if result != "focused" {
        return Err(format!("could not focus exact Firefox QA tab: {result}"));
    }
    wait_for_firefox_url_match(url, true)
}

fn firefox_qa_tab_title(url: &str) -> Result<String, String> {
    let parsed = url::Url::parse(url).map_err(|error| error.to_string())?;
    let marker = parsed
        .query_pairs()
        .find_map(|(key, value)| (key == "drifty_browser_qa").then(|| value.into_owned()))
        .ok_or_else(|| "Firefox QA URL omitted the run marker".to_string())?;
    let role = parsed
        .query_pairs()
        .find_map(|(key, value)| (key == "role").then(|| value.into_owned()))
        .ok_or_else(|| "Firefox QA URL omitted the role".to_string())?;
    Ok(format!("Drifty QA {role} {marker}"))
}

/// Records the QA tab's frame and every button inside it, so the structural
/// close rule's geometry can be checked against the real browser.
fn describe_firefox_qa_tab_buttons(url: &str) -> Result<String, String> {
    let expected_title = applescript_string_literal(&firefox_qa_tab_title(url)?);
    let script = format!(
        r#"on frameText(theElement)
  tell application "System Events"
    set elementPosition to position of theElement
    set elementSize to size of theElement
    return ((item 1 of elementPosition) as text) & "," & ((item 2 of elementPosition) as text) & " " & ((item 1 of elementSize) as text) & "x" & ((item 2 of elementSize) as text)
  end tell
end frameText

tell application "System Events"
  tell process "Firefox"
    set report to "not_found"
    set allElements to entire contents of front window
    repeat with currentElement in allElements
      try
        if role of currentElement is "AXRadioButton" and title of currentElement is "{expected_title}" then
          set report to "tab " & my frameText(currentElement)
          set descendants to {{}}
          repeat with childElement in (UI elements of currentElement)
            set end of descendants to contents of childElement
            try
              repeat with grandchildElement in (UI elements of childElement)
                set end of descendants to contents of grandchildElement
              end repeat
            end try
          end repeat
          repeat with childElement in descendants
            try
              set childRole to role of childElement
              set domId to ""
              try
                set domId to value of attribute "AXDOMIdentifier" of childElement as text
              end try
              set report to report & linefeed & childRole & " " & my frameText(childElement) & " description=" & (description of childElement as text) & " domId=" & domId
            end try
          end repeat
          return report
        end if
      end try
    end repeat
    return report
  end tell
end tell"#
    );
    run_osascript_text(&script)
}

fn firefox_front_url() -> Result<String, String> {
    run_osascript_text(
        r#"tell application "Firefox" to activate
delay 0.1
tell application "System Events"
  tell process "Firefox"
    set frontmost to true
    if not (exists front window) then return ""
    set allElements to entire contents of front window
    repeat with currentElement in allElements
      try
        if role of currentElement is "AXComboBox" then
          set descriptionText to description of currentElement as text
          set domId to ""
          try
            set domId to value of attribute "AXDOMIdentifier" of currentElement as text
          end try
          if domId is "urlbar-input" or descriptionText contains "주소" or descriptionText contains "Address" or descriptionText contains "address" or descriptionText contains "URL" or descriptionText contains "url" then
            return value of currentElement as text
          end if
        end if
      end try
    end repeat
    return ""
  end tell
end tell"#,
    )
}

fn urls_match_exactly_with_optional_scheme(observed: &str, expected: &str) -> bool {
    if observed == expected {
        return true;
    }
    let observed_without_scheme = observed
        .strip_prefix("https://")
        .or_else(|| observed.strip_prefix("http://"));
    let expected_without_scheme = expected
        .strip_prefix("https://")
        .or_else(|| expected.strip_prefix("http://"));
    observed_without_scheme.is_some() && observed_without_scheme == expected_without_scheme
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
    wait_until(Duration::from_secs(12), || {
        let observed = firefox_front_url()?;
        if urls_match_exactly_with_optional_scheme(&observed, url) == expected {
            Ok(true)
        } else {
            Err(format!(
                "Firefox URL match expected {expected}, observed {observed:?}"
            ))
        }
    })
}

fn run_osascript_text(script: &str) -> Result<String, String> {
    let output = super::run_osascript(script).map_err(|error| match error {
        super::super::ExtremeNudgeError::AppleScriptFailed(message) => message,
        other => other.to_string(),
    })?;
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
