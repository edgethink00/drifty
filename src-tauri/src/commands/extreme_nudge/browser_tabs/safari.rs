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
        r##"set targetUrl to "{site_url}"
set targetDomain to "{site_domain}"
tell application "System Events"
  if not (exists process "{browser_name}") then return "not_found:safari_not_running"
  tell process "{browser_name}"
    if frontmost is false then return "not_found:safari_not_frontmost"
  end tell
end tell
tell application "{browser_name}"
  if not (exists front window) then return "not_found:safari_no_front_window"
  try
    set currentUrl to URL of current tab of front window
    if my tabMatchesTarget(currentUrl, targetUrl, targetDomain) then
      close current tab of front window
      return "closed_browser_tab:safari_front_tab"
    end if
  end try
  return "not_found:safari_target_mismatch"
end tell

{handlers}"##
    )
}
