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
        r##"property bestValue : ""
property bestLength : -1
property bestPriority : -1
property readableCount : 0
property visitedCount : 0
property maxVisited : 500
property toolbarVisitedCount : 0
property toolbarMaxVisited : 120
property foundAddress : false
set targetUrl to "{site_url}"
set targetDomain to "{site_domain}"

tell application "{browser_name}"
  try
    if exists front window then
      set currentUrl to URL of active tab of front window
      if my tabMatchesTarget(currentUrl, targetUrl, targetDomain) then
        close active tab of front window
        return "closed_browser_tab:chromium_active_tab"
      end if
    end if
  end try
  repeat with browserWindow in windows
    repeat with browserTab in tabs of browserWindow
      try
        set currentUrl to URL of browserTab
        if my tabMatchesTarget(currentUrl, targetUrl, targetDomain) then
          close browserTab
          return "closed_browser_tab:chromium_scanned_tab"
        end if
      end try
    end repeat
  end repeat
end tell
try
  tell application "System Events"
    tell process "{browser_name}"
      if frontmost is false then return "not_found:chromium_ax_not_frontmost"
      if not (exists front window) then return "not_found:chromium_ax_no_front_window"
      set bestValue to ""
      set bestLength to -1
      set bestPriority to -1
      set readableCount to 0
      set visitedCount to 0
      set toolbarVisitedCount to 0
      set foundAddress to false
      my scanToolbarFirst(front window)
      if foundAddress is false then my scanElement(front window)
      set currentUrl to bestValue
      if currentUrl is "" then return "not_found:chromium_ax_no_address_candidate"
      if my tabMatchesTarget(currentUrl, targetUrl, targetDomain) then
        try
          tell application "{browser_name}" to close active tab of front window
        on error
          return "not_found:chromium_ax_close_failed"
        end try
        delay 0.2
        set bestValue to ""
        set bestLength to -1
        set bestPriority to -1
        set readableCount to 0
        set visitedCount to 0
        set toolbarVisitedCount to 0
        set foundAddress to false
        if exists front window then
          my scanToolbarFirst(front window)
          if foundAddress is false then my scanElement(front window)
          if my tabMatchesTarget(bestValue, targetUrl, targetDomain) then return "not_found:chromium_ax_post_close_target_still_frontmost"
        end if
        return "closed_browser_tab:chromium_ax_front_tab"
      end if
    end tell
  end tell
end try
return "not_found:chromium_ax_target_mismatch"

on considerAddressCandidate(addressField)
  tell application "System Events"
    try
      set descriptionText to ""
      try
        set descriptionText to description of addressField
      end try
      set candidatePriority to 0
      if descriptionText contains "주소" or descriptionText contains "Address" or descriptionText contains "address" or descriptionText contains "URL" or descriptionText contains "url" then
        set candidatePriority to 1
      end if
      set candidate to value of addressField as text
      if candidate is not "" and candidate is not "missing value" then
        set readableCount to readableCount + 1
        if candidatePriority > bestPriority or (candidatePriority is bestPriority and (length of candidate) > bestLength) then
          set bestValue to candidate
          set bestLength to length of candidate
          set bestPriority to candidatePriority
        end if
        if candidatePriority is 1 then set foundAddress to true
      end if
    end try
  end tell
end considerAddressCandidate

on scanElement(theElement)
  if foundAddress is true then return
  if visitedCount is greater than maxVisited then return
  set visitedCount to visitedCount + 1
  tell application "System Events"
    set roleText to ""
    try
      set roleText to role of theElement
    end try
    if roleText is "AXWebArea" then return
    if roleText is "AXTextField" or roleText is "AXComboBox" then
      my considerAddressCandidate(theElement)
      if foundAddress is true then return
    end if
    try
      repeat with childElement in UI elements of theElement
        my scanElement(childElement)
        if foundAddress is true then exit repeat
        if visitedCount is greater than maxVisited then exit repeat
      end repeat
    end try
  end tell
end scanElement

on scanToolbarFirst(theElement)
  if foundAddress is true then return
  if toolbarVisitedCount is greater than toolbarMaxVisited then return
  set toolbarVisitedCount to toolbarVisitedCount + 1
  tell application "System Events"
    set roleText to ""
    try
      set roleText to role of theElement
    end try
    if roleText is "AXWebArea" then return
    if roleText is "AXToolbar" then
      my scanElement(theElement)
      return
    end if
    try
      repeat with childElement in UI elements of theElement
        my scanToolbarFirst(childElement)
        if foundAddress is true then exit repeat
        if toolbarVisitedCount is greater than toolbarMaxVisited then exit repeat
      end repeat
    end try
  end tell
end scanToolbarFirst

{handlers}"##
    )
}
