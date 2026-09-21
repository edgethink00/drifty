use std::path::Path;

use super::super::ExtremeNudgeError;

pub(super) fn is_supported_browser(browser_name: &str) -> bool {
    browser_process_name(browser_name).is_some()
}

pub(super) fn close_browser_tab(
    browser_name: &str,
    browser_identity: Option<&str>,
    site_url: Option<&str>,
    site_domain: Option<&str>,
) -> Result<String, ExtremeNudgeError> {
    let process_name = browser_process_name(browser_name).ok_or_else(|| {
        ExtremeNudgeError::BrowserTabNotFound {
            diagnostic: "windows_uia_unsupported_browser".to_string(),
        }
    })?;
    let browser_identity =
        normalized_browser_identity(browser_identity, browser_name, process_name)?;
    super::super::super::windows_browser_uia::close_foreground_tab(
        process_name,
        &browser_identity,
        site_url.unwrap_or(""),
        site_domain.unwrap_or(""),
    )
    .map_err(|diagnostic| ExtremeNudgeError::BrowserTabNotFound { diagnostic })
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
    // signing trust decision. The direct UIA operation later revalidates that
    // the exact foreground process still owns this complete captured path.
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
}
