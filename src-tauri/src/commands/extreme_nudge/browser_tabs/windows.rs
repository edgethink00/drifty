use std::{
    env,
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

use serde::Deserialize;

use super::super::ExtremeNudgeError;

const WINDOWS_TAB_CLOSE_SCRIPT: &str = include_str!("windows_tab_close.ps1");
const SCRIPT_TIMEOUT: Duration = Duration::from_secs(20);
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const MAX_OUTPUT_BYTES: usize = 64 * 1024;

struct TemporaryPowerShellScript {
    path: PathBuf,
}

impl TemporaryPowerShellScript {
    fn create() -> Result<Self, std::io::Error> {
        let path = env::temp_dir().join(format!(
            "drifty-tab-close-{}-{}.ps1",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)?;
        if let Err(error) = file
            .write_all(WINDOWS_TAB_CLOSE_SCRIPT.as_bytes())
            .and_then(|_| file.sync_all())
        {
            drop(file);
            let _ = fs::remove_file(&path);
            return Err(error);
        }
        Ok(Self { path })
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TemporaryPowerShellScript {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WindowsTabCloseResult {
    closed: bool,
    diagnostic: Option<String>,
    error: Option<String>,
}

pub(super) fn is_supported_browser(browser_name: &str) -> bool {
    browser_process_name(browser_name).is_some()
}

pub(super) fn close_browser_tab(
    browser_name: &str,
    browser_identity: Option<&str>,
    site_url: Option<&str>,
    site_domain: Option<&str>,
) -> Result<String, ExtremeNudgeError> {
    use std::os::windows::process::CommandExt;

    let process_name = browser_process_name(browser_name).ok_or_else(|| {
        ExtremeNudgeError::BrowserTabNotFound {
            diagnostic: "windows_uia_unsupported_browser".to_string(),
        }
    })?;
    let browser_identity =
        normalized_browser_identity(browser_identity, browser_name, process_name)?;
    let powershell = trusted_powershell_path()
        .map_err(|diagnostic| ExtremeNudgeError::BrowserTabNotFound { diagnostic })?;
    let script =
        TemporaryPowerShellScript::create().map_err(|_| ExtremeNudgeError::BrowserTabNotFound {
            diagnostic: "windows_uia_script_create_failed".to_string(),
        })?;
    let mut command = Command::new(powershell);
    command
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
        ])
        .arg(script.path())
        .env("DRIFTY_NUDGE_BROWSER_PROCESS", process_name)
        .env("DRIFTY_NUDGE_BROWSER_IDENTITY", &browser_identity)
        .env("DRIFTY_NUDGE_SITE_URL", site_url.unwrap_or(""))
        .env("DRIFTY_NUDGE_SITE_DOMAIN", site_domain.unwrap_or(""))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(CREATE_NO_WINDOW);
    let mut child = command
        .spawn()
        .map_err(|_| ExtremeNudgeError::BrowserTabNotFound {
            diagnostic: "windows_uia_spawn_failed".to_string(),
        })?;
    let deadline = Instant::now() + SCRIPT_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(50)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(ExtremeNudgeError::BrowserTabNotFound {
                    diagnostic: "windows_uia_timeout".to_string(),
                });
            }
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(ExtremeNudgeError::BrowserTabNotFound {
                    diagnostic: "windows_uia_wait_failed".to_string(),
                });
            }
        }
    }

    let mut stdout = Vec::new();
    if let Some(pipe) = child.stdout.take() {
        let _ = pipe.take(MAX_OUTPUT_BYTES as u64).read_to_end(&mut stdout);
    }
    let parsed = serde_json::from_slice::<WindowsTabCloseResult>(&stdout).map_err(|_| {
        ExtremeNudgeError::BrowserTabNotFound {
            diagnostic: "windows_uia_invalid_response".to_string(),
        }
    })?;
    if parsed.closed {
        return Ok(parsed
            .diagnostic
            .unwrap_or_else(|| "windows_uia_closed_tab".to_string()));
    }
    Err(ExtremeNudgeError::BrowserTabNotFound {
        diagnostic: failure_diagnostic(parsed),
    })
}

fn failure_diagnostic(result: WindowsTabCloseResult) -> String {
    // The caller handles `closed` before entering this failure-only path.
    result
        .diagnostic
        .filter(|value| !value.trim().is_empty())
        .or(result.error)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "windows_uia_target_not_found".to_string())
}

fn trusted_powershell_path() -> Result<PathBuf, String> {
    let system_root = env::var_os("SystemRoot")
        .ok_or_else(|| "windows_uia_system_root_unavailable".to_string())?;
    let root = PathBuf::from(system_root);
    if !root.is_absolute() {
        return Err("windows_uia_system_root_not_absolute".to_string());
    }
    let candidate = root
        .join("System32")
        .join("WindowsPowerShell")
        .join("v1.0")
        .join("powershell.exe");
    if !candidate.is_file() {
        return Err("windows_uia_trusted_powershell_unavailable".to_string());
    }
    Ok(candidate)
}

fn browser_process_name(browser_name: &str) -> Option<&'static str> {
    match browser_name.trim() {
        "Google Chrome" | "Google Chrome Beta" | "Google Chrome Dev" | "Google Chrome Canary" => {
            Some("chrome")
        }
        "Microsoft Edge" => Some("msedge"),
        "Brave Browser" => Some("brave"),
        _ => None,
    }
}

fn normalized_browser_identity(
    browser_identity: Option<&str>,
    browser_name: &str,
    process_name: &str,
) -> Result<String, ExtremeNudgeError> {
    let identity = browser_identity
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or(ExtremeNudgeError::MissingBrowserIdentity)?;
    let path = Path::new(identity);
    let expected_file_name = format!("{process_name}.exe");
    let matches_process = path
        .file_name()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case(&expected_file_name));
    let normalized = identity.replace('/', "\\").to_ascii_lowercase();
    // The path suffix separates product/channel identities; it is not a code-
    // signing trust decision. The PowerShell operation later revalidates that
    // the exact running process still owns this complete captured path.
    let browser_identity_matches = match browser_name.trim() {
        "Google Chrome Beta" => normalized.ends_with(r"\google\chrome beta\application\chrome.exe"),
        "Google Chrome Dev" => normalized.ends_with(r"\google\chrome dev\application\chrome.exe"),
        "Google Chrome Canary" => {
            normalized.ends_with(r"\google\chrome sxs\application\chrome.exe")
        }
        "Google Chrome" => ![
            r"\google\chrome beta\application\chrome.exe",
            r"\google\chrome dev\application\chrome.exe",
            r"\google\chrome sxs\application\chrome.exe",
        ]
        .iter()
        .any(|suffix| normalized.ends_with(suffix)),
        "Brave Browser" => {
            normalized.ends_with(r"\bravesoftware\brave-browser\application\brave.exe")
        }
        _ => true,
    };
    if !path.is_absolute() || !matches_process || !browser_identity_matches {
        return Err(ExtremeNudgeError::BrowserTabNotFound {
            diagnostic: "windows_uia_invalid_browser_identity".to_string(),
        });
    }
    Ok(identity.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn browser_process_mapping_is_explicit() {
        assert_eq!(browser_process_name("Google Chrome"), Some("chrome"));
        assert_eq!(browser_process_name("Google Chrome Beta"), Some("chrome"));
        assert_eq!(browser_process_name("Google Chrome Dev"), Some("chrome"));
        assert_eq!(browser_process_name("Google Chrome Canary"), Some("chrome"));
        assert_eq!(browser_process_name("Microsoft Edge"), Some("msedge"));
        assert_eq!(browser_process_name("Brave Browser"), Some("brave"));
        assert_eq!(browser_process_name("Firefox"), None);
    }

    #[test]
    fn browser_identity_requires_the_exact_absolute_executable_kind() {
        assert_eq!(
            normalized_browser_identity(
                Some(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
                "Google Chrome",
                "chrome"
            )
            .expect("Chrome identity"),
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        );
        assert!(normalized_browser_identity(
            Some(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
            "Google Chrome Beta",
            "chrome"
        )
        .is_err());
        assert!(normalized_browser_identity(
            Some(r"C:\Program Files\Google\Chrome Beta\Application\chrome.exe"),
            "Google Chrome",
            "chrome"
        )
        .is_err());
        assert!(normalized_browser_identity(
            Some(r"C:\Program Files\Google\Chrome Beta\Application\chrome.exe"),
            "Google Chrome Beta",
            "chrome"
        )
        .is_ok());
        assert!(normalized_browser_identity(
            Some(r"C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe"),
            "Brave Browser",
            "brave"
        )
        .is_ok());
        assert!(
            normalized_browser_identity(Some(r"C:\Temp\brave.exe"), "Brave Browser", "brave")
                .is_err()
        );
        assert!(normalized_browser_identity(
            Some(r"C:\Temp\msedge.exe"),
            "Google Chrome",
            "chrome"
        )
        .is_err());
        assert!(
            normalized_browser_identity(Some("chrome.exe"), "Google Chrome", "chrome").is_err()
        );
        assert!(matches!(
            normalized_browser_identity(None, "Google Chrome", "chrome"),
            Err(ExtremeNudgeError::MissingBrowserIdentity),
        ));
    }

    #[test]
    fn embedded_script_requires_unique_target_before_invoke() {
        assert!(WINDOWS_TAB_CLOSE_SCRIPT.contains("$candidates.Count -ne 1"));
        assert!(WINDOWS_TAB_CLOSE_SCRIPT.contains("DRIFTY_NUDGE_BROWSER_IDENTITY"));
        assert!(WINDOWS_TAB_CLOSE_SCRIPT.contains("MainModule.FileName"));
        assert!(WINDOWS_TAB_CLOSE_SCRIPT.contains("ownerStartTicks"));
        assert!(WINDOWS_TAB_CLOSE_SCRIPT.contains("Test-CandidateIdentity $candidate"));
        assert!(WINDOWS_TAB_CLOSE_SCRIPT.contains("SelectionItemPattern"));
        assert!(WINDOWS_TAB_CLOSE_SCRIPT.contains("InvokePattern"));
        assert!(WINDOWS_TAB_CLOSE_SCRIPT.contains("ambiguous target"));
        assert!(WINDOWS_TAB_CLOSE_SCRIPT.contains("NativeWindowHandle"));
        assert!(WINDOWS_TAB_CLOSE_SCRIPT.contains("$tab.Current.IsOffscreen"));
        assert!(WINDOWS_TAB_CLOSE_SCRIPT.contains("$scanAttempt -lt 2"));
        assert!(WINDOWS_TAB_CLOSE_SCRIPT.contains("ControlType]::ToolBar"));
        assert!(WINDOWS_TAB_CLOSE_SCRIPT.contains("ControlType]::Document"));
        assert!(WINDOWS_TAB_CLOSE_SCRIPT.contains("$windowRect.Height * 0.25"));
        assert!(WINDOWS_TAB_CLOSE_SCRIPT.contains("Is-BrowserToolbarEdit $edit $window"));
        assert!(WINDOWS_TAB_CLOSE_SCRIPT.contains("windows_uia_no_verified_close"));
        assert!(WINDOWS_TAB_CLOSE_SCRIPT.contains("Remember-OriginalSelection $window $tabs"));
        assert!(
            WINDOWS_TAB_CLOSE_SCRIPT.contains("Remember-ReplacementSelection $candidate.window")
        );
        assert!(WINDOWS_TAB_CLOSE_SCRIPT.contains("function Restore-OriginalSelections"));
        assert!(WINDOWS_TAB_CLOSE_SCRIPT.contains("$replacementSelections.ContainsKey($windowKey)"));
        assert!(WINDOWS_TAB_CLOSE_SCRIPT.contains("GetForegroundWindow"));
        assert!(WINDOWS_TAB_CLOSE_SCRIPT.contains("GetWindowThreadProcessId"));
        assert!(WINDOWS_TAB_CLOSE_SCRIPT.contains("$restoreKeys += $foregroundWindowKey"));
        assert!(WINDOWS_TAB_CLOSE_SCRIPT.contains("SetForegroundWindow"));
        assert!(WINDOWS_TAB_CLOSE_SCRIPT.contains("BringWindowToTop"));
        assert!(WINDOWS_TAB_CLOSE_SCRIPT.contains("$auto::FocusedElement"));
        assert!(WINDOWS_TAB_CLOSE_SCRIPT.contains("$originalFocusedElement.SetFocus()"));
        assert!(WINDOWS_TAB_CLOSE_SCRIPT.contains("$auto::FromHandle"));
        assert!(!WINDOWS_TAB_CLOSE_SCRIPT.contains("AttachThreadInput"));
        assert!(!WINDOWS_TAB_CLOSE_SCRIPT.contains("ShowWindow"));
        assert!(WINDOWS_TAB_CLOSE_SCRIPT.contains("focus_restore_failed"));
        assert!(WINDOWS_TAB_CLOSE_SCRIPT.contains("$originalSelectionKeys[$windowKey]"));
        assert!(WINDOWS_TAB_CLOSE_SCRIPT.contains("$attemptedCloseTabKey = $candidate.key"));
        assert!(WINDOWS_TAB_CLOSE_SCRIPT.contains("$attemptedCloseVerified = $true"));
        assert!(WINDOWS_TAB_CLOSE_SCRIPT.contains("$preferReplacement"));
        assert!(WINDOWS_TAB_CLOSE_SCRIPT.contains("@('chrome', 'msedge', 'brave')"));
        assert!(WINDOWS_TAB_CLOSE_SCRIPT.contains("$tab.Current.ClassName -ne 'BraveTab'"));
        assert!(
            WINDOWS_TAB_CLOSE_SCRIPT.contains("$parent.Current.ClassName -eq 'BraveTabContainer'")
        );
        assert!(WINDOWS_TAB_CLOSE_SCRIPT.contains("function Fail"));
        assert!(WINDOWS_TAB_CLOSE_SCRIPT.contains("Restore-OriginalSelections"));
        assert!(!WINDOWS_TAB_CLOSE_SCRIPT.contains("$pid ="));
        assert!(WINDOWS_TAB_CLOSE_SCRIPT.len() > 12 * 1024);
    }

    #[test]
    fn stable_failure_diagnostic_takes_precedence_over_detail() {
        let parsed: WindowsTabCloseResult = serde_json::from_str(
            r#"{"closed":false,"diagnostic":"windows_uia_ambiguous_or_missing_target","error":"ambiguous target: exact=0, domain=0"}"#,
        )
        .expect("deserialize tab-close failure");
        assert_eq!(
            failure_diagnostic(parsed),
            "windows_uia_ambiguous_or_missing_target"
        );
        assert_eq!(
            failure_diagnostic(WindowsTabCloseResult {
                closed: false,
                diagnostic: None,
                error: Some("legacy detail".to_string()),
            }),
            "legacy detail"
        );
        assert_eq!(
            failure_diagnostic(WindowsTabCloseResult {
                closed: false,
                diagnostic: Some("  ".to_string()),
                error: Some("legacy detail".to_string()),
            }),
            "legacy detail"
        );
        assert_eq!(
            failure_diagnostic(WindowsTabCloseResult {
                closed: false,
                diagnostic: None,
                error: None,
            }),
            "windows_uia_target_not_found"
        );
    }

    #[test]
    fn temporary_script_contains_the_embedded_source_and_is_deleted_on_drop() {
        let path;
        {
            let script = TemporaryPowerShellScript::create().expect("create temporary script");
            path = script.path().to_path_buf();
            assert_eq!(
                fs::read_to_string(&path).expect("read temporary script"),
                WINDOWS_TAB_CLOSE_SCRIPT
            );
        }
        assert!(!path.exists());
    }

    #[test]
    fn powershell_path_is_absolute_and_system_owned() {
        let path = trusted_powershell_path().expect("trusted PowerShell path");
        assert!(path.is_absolute());
        assert!(path.ends_with(r"System32\WindowsPowerShell\v1.0\powershell.exe"));
    }
}
