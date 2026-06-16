use super::matching::{matching_handlers, TargetMatchValues};

pub(super) fn tab_close_script(
    browser_name: &str,
    site_url: &str,
    site_domain: Option<&str>,
) -> String {
    let process_name = super::matching::applescript_string_literal(browser_name);
    let target = TargetMatchValues::new(site_url, site_domain);
    let site_url = target.site_url;
    let site_domain = target.site_domain;
    let handlers = matching_handlers();
    format!(
        r##"tell application "System Events"
  set targetUrl to "{site_url}"
  set targetDomain to "{site_domain}"
  if not (exists process "{process_name}") then return "not_found"
end tell
tell application "{process_name}" to activate
delay 0.1
tell application "System Events"
  tell process "{process_name}"
    if frontmost is false then return "not_found"
    if not (exists front window) then return "not_found"
    set currentUrl to ""
    keystroke "l" using command down
    delay 0.4
    try
      set focusedElement to value of attribute "AXFocusedUIElement"
      set currentUrl to value of attribute "AXValue" of focusedElement as text
    end try
    key code 53
    if my tabMatchesTarget(currentUrl, targetUrl, targetDomain) then
      delay 0.05
      keystroke "w" using command down
      return "closed_browser_tab"
    end if
  end tell
end tell
return "not_found"

{handlers}"##
    )
}
