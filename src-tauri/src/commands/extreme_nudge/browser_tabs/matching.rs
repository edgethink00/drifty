pub(super) struct TargetMatchValues {
    pub(super) site_url: String,
    pub(super) site_domain: String,
}

impl TargetMatchValues {
    pub(super) fn new(site_url: &str, site_domain: Option<&str>) -> Self {
        let normalized_domain = normalized_site_domain(site_domain);
        Self {
            site_url: applescript_string_literal(site_url),
            site_domain: applescript_string_literal(normalized_domain.as_deref().unwrap_or("")),
        }
    }
}

pub(in crate::commands::extreme_nudge) fn normalized_site_domain(
    value: Option<&str>,
) -> Option<String> {
    let trimmed = value?.trim().trim_end_matches('.');
    if trimmed.is_empty() {
        return None;
    }

    let lowercase = trimmed.to_ascii_lowercase();
    let without_www = lowercase.strip_prefix("www.").unwrap_or(&lowercase);
    Some(without_www.to_string())
}

pub(in crate::commands::extreme_nudge) fn site_domain_from_url(site_url: &str) -> Option<String> {
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

pub(super) fn applescript_string_literal(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

pub(super) fn matching_handlers() -> &'static str {
    r##"on tabMatchesTarget(currentUrl, targetUrl, targetDomain)
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
    set afterScheme to currentUrl
    if (count of schemeParts) is greater than or equal to 2 then
      set afterScheme to item 2 of schemeParts
    end if
    if afterScheme is not "" then
      set AppleScript's text item delimiters to "/"
      set hostPort to item 1 of text items of afterScheme
      set AppleScript's text item delimiters to "?"
      set hostPort to item 1 of text items of hostPort
      set AppleScript's text item delimiters to "#"
      set hostPort to item 1 of text items of hostPort
      set AppleScript's text item delimiters to ":"
      set hostName to item 1 of text items of hostPort
      ignoring case
        if hostName starts with "www." then set hostName to text 5 thru -1 of hostName
      end ignoring
      set normalizedHost to hostName
    end if
  end try
  set AppleScript's text item delimiters to savedTextItemDelimiters
  return normalizedHost
end normalizedUrlHost"##
}
