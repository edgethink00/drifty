use super::matching::{matching_handlers, TargetMatchValues};

pub(super) fn tab_close_script(
    browser_name: &str,
    site_url: &str,
    site_domain: Option<&str>,
) -> String {
    let browser_name = super::matching::applescript_string_literal(browser_name);
    let target = TargetMatchValues::new(site_url, site_domain);
    let site_url = target.site_url;
    let site_domain = target.site_domain;
    let handlers = matching_handlers();
    format!(
        r##"tell application "{browser_name}"
  if not (exists front window) then return "not_found"
  set targetUrl to "{site_url}"
  set targetDomain to "{site_domain}"
  try
    set currentUrl to URL of current tab of front window
    if my tabMatchesTarget(currentUrl, targetUrl, targetDomain) then
      close current tab of front window
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

{handlers}"##
    )
}
