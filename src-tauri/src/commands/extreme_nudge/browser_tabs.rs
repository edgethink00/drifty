use std::process::Command;

use super::ExtremeNudgeError;

pub(super) fn normalized_site_domain(value: Option<&str>) -> Option<String> {
    let trimmed = value?.trim().trim_end_matches('.');
    if trimmed.is_empty() {
        return None;
    }

    let lowercase = trimmed.to_ascii_lowercase();
    let without_www = lowercase.strip_prefix("www.").unwrap_or(&lowercase);
    Some(without_www.to_string())
}

pub(super) fn site_domain_from_url(site_url: &str) -> Option<String> {
    let trimmed = site_url.trim();
    if trimmed.is_empty() {
        return None;
    }

    let after_scheme = trimmed
        .split_once("://")
        .map_or(trimmed, |(_, remainder)| remainder);
    let authority = after_scheme
        .split(['/', '?', '#'])
        .next()
        .unwrap_or_default();
    let host_with_port = authority.rsplit('@').next().unwrap_or(authority);
    let host = host_with_port.split(':').next().unwrap_or_default();
    normalized_site_domain(Some(host))
}

pub(super) fn close_chrome_like_browser_tab(
    browser_name: &str,
    site_url: Option<&str>,
    site_domain: Option<&str>,
) -> Result<(), ExtremeNudgeError> {
    let target_label = site_url.or(site_domain).unwrap_or("unknown target");
    let script = chrome_like_tab_close_script(browser_name, site_url.unwrap_or(""), site_domain);
    let output = Command::new("osascript")
        .args(["-e", &script])
        .output()
        .map_err(|error| ExtremeNudgeError::AppleScriptFailed(error.to_string()))?;

    if !output.status.success() {
        return Err(ExtremeNudgeError::AppleScriptFailed(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    if stdout.trim() == "closed_browser_tab" {
        return Ok(());
    }

    Err(ExtremeNudgeError::BrowserTabNotFound(
        target_label.to_string(),
    ))
}

fn chrome_like_tab_close_script(
    browser_name: &str,
    site_url: &str,
    site_domain: Option<&str>,
) -> String {
    let browser_name = applescript_string_literal(browser_name);
    let site_url = applescript_string_literal(site_url);
    let normalized_domain = normalized_site_domain(site_domain);
    let site_domain = applescript_string_literal(normalized_domain.as_deref().unwrap_or(""));
    format!(
        r##"tell application "{browser_name}"
  if not (exists front window) then return "not_found"
  set targetUrl to "{site_url}"
  set targetDomain to "{site_domain}"
  try
    set currentUrl to URL of active tab of front window
    if my tabMatchesTarget(currentUrl, targetUrl, targetDomain) then
      close active tab of front window
      return "closed_browser_tab"
    end if
  end try
  repeat with browserWindow in windows
    repeat with browserTab in tabs of browserWindow
      try
        set currentUrl to URL of browserTab
        if my tabMatchesTarget(currentUrl, targetUrl, targetDomain) then
          close browserTab
          return "closed_browser_tab"
        end if
      end try
    end repeat
  end repeat
  return "not_found"
end tell

on tabMatchesTarget(currentUrl, targetUrl, targetDomain)
  if targetUrl is not "" and currentUrl is targetUrl then return true
  if targetDomain is "" then return false
  ignoring case
    if normalizedUrlHost(currentUrl) is targetDomain then return true
  end ignoring
  return false
end tabMatchesTarget

on normalizedUrlHost(currentUrl)
  if currentUrl is "" then return ""
  set savedTextItemDelimiters to AppleScript's text item delimiters
  set normalizedHost to ""
  try
    set AppleScript's text item delimiters to "://"
    set schemeParts to text items of currentUrl
    if (count of schemeParts) is greater than or equal to 2 then
      set afterScheme to item 2 of schemeParts
      set AppleScript's text item delimiters to "/"
      set hostPort to item 1 of text items of afterScheme
      set AppleScript's text item delimiters to "?"
      set hostPort to item 1 of text items of hostPort
      set AppleScript's text item delimiters to "#"
      set hostPort to item 1 of text items of hostPort
      set AppleScript's text item delimiters to ":"
      set hostName to item 1 of text items of hostPort
      if hostName starts with "www." then set hostName to text 5 thru -1 of hostName
      set normalizedHost to hostName
    end if
  end try
  set AppleScript's text item delimiters to savedTextItemDelimiters
  return normalizedHost
end normalizedUrlHost"##
    )
}

fn applescript_string_literal(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

#[cfg(test)]
mod tests {
    use super::super::ExtremeNudgeTarget;
    use super::*;

    #[test]
    fn tab_close_script_matches_active_tab_before_scanning_windows() {
        let script = chrome_like_tab_close_script(
            "Google Chrome",
            "https://youtube.com/watch?v=abc",
            Some("youtube.com"),
        );

        assert!(script.contains("URL of active tab of front window"));
        assert!(script.contains("close active tab of front window"));
        assert!(script.contains("repeat with browserWindow in windows"));
        assert!(script.contains("repeat with browserTab in tabs of browserWindow"));
    }

    #[test]
    fn chrome_like_tab_close_script_matches_same_domain_when_exact_url_differs() {
        let target: ExtremeNudgeTarget = serde_json::from_value(serde_json::json!({
            "appName": "Google Chrome",
            "bundleId": "com.google.Chrome",
            "browserName": "Google Chrome",
            "siteDomain": "chess.com",
            "siteUrl": "https://www.chess.com/play/online"
        }))
        .unwrap();

        assert_eq!(target.site_domain.as_deref(), Some("chess.com"));

        let script = chrome_like_tab_close_script(
            "Google Chrome",
            target.site_url.as_deref().unwrap(),
            target.site_domain.as_deref(),
        );

        assert!(script.contains("normalizedUrlHost(currentUrl) is targetDomain"));
    }

    #[test]
    fn applescript_string_literal_escapes_quotes_and_backslashes() {
        assert_eq!(
            applescript_string_literal(r#"https://example.test/watch?q="a\b""#),
            r#"https://example.test/watch?q=\"a\\b\""#
        );
    }

    #[test]
    fn site_domain_from_url_strips_www_and_path() {
        assert_eq!(
            site_domain_from_url("https://www.chess.com/play/online?ref=home").as_deref(),
            Some("chess.com"),
        );
    }
}
