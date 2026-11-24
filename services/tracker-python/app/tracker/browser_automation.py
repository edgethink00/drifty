from __future__ import annotations

import os
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal
from urllib.parse import parse_qs, urlparse

from app.tracker.accessibility_address_bar import (
    accessibility_address_bar_script,
    is_accessibility_address_bar_browser_app,
    is_chromium_browser_app,
    metadata_from_accessibility_address_bar_result,
)

BrowserAutomationStatus = Literal["granted", "denied", "unavailable", "stale", "empty_result", "not_applicable"]
BrowserHistoryStatus = Literal["unsupported", "no_profile_root", "no_readable_database", "no_match", "matched"]

_NO_SCRIPTABLE_WINDOW = "NO_SCRIPTABLE_WINDOW"
_FORCE_CHROMIUM_AX_CAPTURE_ENV = "DRIFTY_FORCE_CHROMIUM_AX_CAPTURE"


@dataclass
class BrowserMetadata:
    browser_name: str | None = None
    site_domain: str | None = None
    site_title: str | None = None
    site_url: str | None = None
    youtube_video_id: str | None = None
    youtube_playlist_id: str | None = None
    youtube_is_shorts: bool | None = None
    ax_window_title: str | None = None
    match_state: str | None = None
    browser_automation_status: BrowserAutomationStatus | None = None
    browser_automation_error: str | None = None
    browser_history_status: BrowserHistoryStatus | None = None
    browser_history_reason: str | None = None
    browser_history_database_found: bool | None = None
    browser_history_profile_count: int | None = None
    browser_history_candidate_count: int | None = None
    browser_history_error_count: int | None = None
    # True when the browser reports this window as private (a scripting window
    # mode or the Dia identifier), False when it reports a normal window.
    private_window: bool | None = None
    # Safari's address-bar read: True while the address field has keyboard
    # focus (it then shows what is typed, not the page). None when unreported.
    address_field_editing: bool | None = None


# Safari and the Firefox family expose no scripting window mode; they add a
# localized label to a private window's title only. These are the labels
# measured on real windows (docs/research/2026-10-07-browser-coverage-native-
# follow-up.md V20, V24, V36). Other UI languages are recorded as normal
# windows, the same rule the page clues follow (owner decision 2026-10-13).
# Safari joins the label with a comma ("Page, Private Browsing"); Firefox with
# an em dash, sometimes after its own name ("Page — Mozilla Firefox Private
# Browsing"). Only these exact joins count, so a page that merely mentions
# private browsing in its own title is still recorded.
_SAFARI_PRIVATE_TITLE_LABELS: tuple[str, ...] = ("Private Browsing", "개인정보 보호 브라우징")
_SAFARI_TITLE_SEPARATORS: tuple[str, ...] = (", ", " — ")
_FIREFOX_PRIVATE_TITLE_LABELS: tuple[str, ...] = ("Private Browsing", "Mozilla Firefox Private Browsing")
_FIREFOX_TITLE_SEPARATORS: tuple[str, ...] = (" — ",)
_SAFARI_APPS = frozenset({"Safari", "Safari Technology Preview"})
_FIREFOX_FAMILY_APPS = frozenset({"Firefox", "Firefox Developer Edition", "Floorp", "LibreWolf", "Waterfox", "Zen"})


def private_window_from_mode(mode: str | None) -> bool | None:
    """A scripting window mode: any reported mode other than normal is private."""
    value = (mode or "").strip().lower()
    if not value or value == "missing value":
        return None
    return value != "normal"


def private_window_from_title(app_name: str | None, window_title: str | None) -> bool | None:
    """True only when a Safari or Firefox-family title carries its private label."""
    title = (window_title or "").strip()
    if not title or not app_name:
        return None
    if app_name in _SAFARI_APPS:
        labels, separators = _SAFARI_PRIVATE_TITLE_LABELS, _SAFARI_TITLE_SEPARATORS
    elif app_name in _FIREFOX_FAMILY_APPS:
        labels, separators = _FIREFOX_PRIVATE_TITLE_LABELS, _FIREFOX_TITLE_SEPARATORS
    else:
        return None
    for label in labels:
        if title == label or any(title.endswith(separator + label) for separator in separators):
            return True
    return None


def normalize_domain(url: str | None) -> str | None:
    if not url:
        return None
    try:
        parsed = urlparse(url)
        domain = parsed.hostname or ""
        return domain.removeprefix("www.") or None
    except Exception:
        return None


def browser_script(app_name: str) -> str | None:
    if app_name == "Safari":
        return _tab_matching_script(
            app_name="Safari",
            exists_check="exists front document",
            tab_title="name of current tab of w",
            tab_url="URL of current tab of w",
            fallback_url="URL of front document",
            fallback_title="name of front document",
        )

    if app_name in {
        "Google Chrome",
        "Google Chrome Canary",
        "Microsoft Edge",
        "Arc",
        "Aside",
        "Brave Browser",
        "Chromium",
        "Comet",
        "Opera",
        "Vivaldi",
        "Whale",
    }:
        return _tab_matching_script(
            app_name=app_name,
            exists_check="(count of windows) > 0",
            tab_title="title of active tab of w",
            tab_url="URL of active tab of w",
            fallback_url="URL of active tab of window 1",
            fallback_title="title of active tab of window 1",
        )

    if app_name == "Dia":
        return _dia_window_script()

    if app_name == "Firefox":
        return f"""
        tell application "System Events"
          if not (exists process "Firefox") then return ""
          tell process "Firefox"
            if not (exists front window) then return "{_NO_SCRIPTABLE_WINDOW}"
            set currentUrl to value of text field 1 of toolbar 1 of front window
            set currentTitle to value of attribute "AXTitle" of front window
            return currentUrl & linefeed & currentTitle & linefeed & "focused" & linefeed & currentTitle
          end tell
        end tell
        """

    return None


def is_supported_browser_app(app_name: str | None) -> bool:
    return bool(
        app_name
        and (
            browser_script(app_name)
            or is_accessibility_address_bar_browser_app(app_name)
        )
    )


def browser_automation_status_from_error(message: str) -> BrowserAutomationStatus:
    normalized = message.lower()
    if (
        "not authorized" in normalized
        or "not permitted" in normalized
        or "not allowed assistive access" in normalized
        or "-1743" in normalized
        or "-25211" in normalized
    ):
        return "denied"
    return "unavailable"


def safe_browser_automation_error(error: RuntimeError) -> str:
    return " ".join(str(error).split())[:240]


def _accessibility_address_bar_metadata(
    app_name: str, run_osascript: Callable[[str], str]
) -> BrowserMetadata | None:
    if not is_accessibility_address_bar_browser_app(app_name):
        return None

    try:
        result = run_osascript(accessibility_address_bar_script(app_name))
    except RuntimeError as error:
        error_message = safe_browser_automation_error(error)
        return BrowserMetadata(
            browser_name=app_name,
            browser_automation_status=browser_automation_status_from_error(error_message),
            browser_automation_error=error_message,
        )

    metadata = metadata_from_accessibility_address_bar_result(app_name, result)
    if not metadata.site_url:
        return BrowserMetadata(
            browser_name=app_name,
            browser_automation_status="unavailable",
            browser_automation_error=metadata.error,
        )

    video_id, playlist_id, is_shorts = youtube_ids(metadata.site_url)
    return BrowserMetadata(
        browser_name=app_name,
        site_domain=normalize_domain(metadata.site_url),
        site_url=metadata.site_url,
        youtube_video_id=video_id,
        youtube_playlist_id=playlist_id,
        youtube_is_shorts=is_shorts,
        ax_window_title=metadata.ax_window_title,
        match_state=metadata.match_state,
        address_field_editing=metadata.address_field_editing,
        browser_automation_status="granted",
    )


def _force_chromium_ax_capture_enabled() -> bool:
    return os.environ.get(_FORCE_CHROMIUM_AX_CAPTURE_ENV) == "1"


def _tab_matching_script(
    app_name: str,
    exists_check: str,
    tab_title: str,
    tab_url: str,
    fallback_url: str,
    fallback_title: str,
) -> str:
    aside_synthetic_window_recovery = ""
    focused_title = "if exists front window then set axTitle to name of front window"
    if app_name == "Comet":
        # Comet lists the translation bubble as its front AXUnknown window.
        # The focused standard window still points to the actual tab, and is
        # the same window the native content helper validates before/after.
        focused_title = '''
              set focusedWindow to value of attribute "AXFocusedWindow"
              if subrole of focusedWindow is "AXStandardWindow" then set axTitle to name of focusedWindow
        '''
    if app_name == "Aside":
        aside_synthetic_window_recovery = '''
              -- Aside keeps an empty AXUnknown shadow window ahead of its real
              -- browser window. Only bypass that exact synthetic shape; normal
              -- Chromium front-window selection remains unchanged.
              if axTitle is "" then
                set frontSubrole to ""
                set frontChildCount to -1
                try
                  set frontSubrole to subrole of front window as text
                end try
                try
                  set frontChildCount to count of UI elements of front window
                end try
                if frontSubrole is "AXUnknown" and frontChildCount is 0 then
                  try
                    set targetWindow to first window whose value of attribute "AXMain" is true
                    set axTitle to name of targetWindow as text
                  on error
                    try
                      set targetWindow to first window whose subrole is "AXStandardWindow"
                      set axTitle to name of targetWindow as text
                    end try
                  end try
                end if
              end if
        '''
    # Chromium browsers report a window mode ("normal", "incognito"); reading
    # it from the window whose tab matched the focused title costs one
    # property in the same pass. A front-window fallback may describe another
    # window, so it reports no mode. Safari has no such property.
    matched_mode = ""
    if is_chromium_browser_app(app_name):
        matched_mode = "try\n                      set matchedMode to (mode of w) as text\n                    end try"
    return f'''
        set axTitle to ""
        tell application "System Events"
          try
            set frontProc to first application process whose frontmost is true
            if name of frontProc is not equal to "{app_name}" then return "STALE"
            tell frontProc
              {focused_title}
{aside_synthetic_window_recovery}
            end tell
          end try
        end tell
        tell application "{app_name}"
          if not ({exists_check}) then return "{_NO_SCRIPTABLE_WINDOW}"
          set matchedUrl to ""
          set matchedTitle to ""
          set matchedMode to ""
          set bestLength to -1
          if axTitle is not "" then
            repeat with w in windows
              try
                set tabTitle to {tab_title}
                if tabTitle is not "" and axTitle starts with tabTitle then
                  if (length of tabTitle) > bestLength then
                    set matchedUrl to {tab_url}
                    set matchedTitle to tabTitle
                    set bestLength to length of tabTitle
                    {matched_mode}
                  end if
                end if
              end try
            end repeat
          end if
          set matchState to "matched"
          if bestLength < 0 then
            set matchState to "front-fallback"
            set matchedUrl to {fallback_url}
            set matchedTitle to {fallback_title}
            set matchedMode to ""
          end if
          return matchedUrl & linefeed & matchedTitle & linefeed & matchState & linefeed & axTitle & linefeed & matchedMode
        end tell
    '''


def _dia_window_script() -> str:
    # Dia 1.52 shortens its accessibility window title ("asyncio - Asynch...")
    # and exposes no window mode or bounds, so the shared title match cannot
    # bind a tab. The focused window's accessibility identifier carries the
    # scripting window id instead: bigBrowserWindow_<id> for a normal window,
    # bigIncognitoBrowserWindow_<id> for incognito. URL and title are read
    # from exactly that window in either mode, like every other browser.
    return f'''
        set axTitle to ""
        set axIdentifier to ""
        tell application "System Events"
          try
            set frontProc to first application process whose frontmost is true
            if name of frontProc is not equal to "Dia" then return "STALE"
            tell frontProc
              if not (exists front window) then return "{_NO_SCRIPTABLE_WINDOW}"
              set axTitle to name of front window
              set axIdentifier to value of attribute "AXIdentifier" of front window
            end tell
          end try
        end tell
        set windowId to ""
        if axIdentifier starts with "bigBrowserWindow_" then set windowId to text 18 thru -1 of axIdentifier
        if axIdentifier starts with "bigIncognitoBrowserWindow_" then set windowId to text 27 thru -1 of axIdentifier
        set windowMode to ""
        if axIdentifier starts with "bigBrowserWindow_" then set windowMode to "normal"
        if axIdentifier starts with "bigIncognitoBrowserWindow_" then set windowMode to "incognito"
        if windowId is "" then return "{_NO_SCRIPTABLE_WINDOW}"
        tell application "Dia"
          set w to window id windowId
          return (URL of active tab of w) & linefeed & (title of active tab of w) & linefeed & "matched" & linefeed & axTitle & linefeed & windowMode
        end tell
    '''


def youtube_ids(url: str | None) -> tuple[str | None, str | None, bool | None]:
    if not url:
        return None, None, None

    try:
        parsed = urlparse(url)
    except Exception:
        return None, None, None

    hostname = (parsed.hostname or "").removeprefix("www.").lower()
    if hostname not in {"youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"}:
        return None, None, None

    query = parse_qs(parsed.query)
    video_id = (query.get("v") or [None])[0]
    playlist_id = (query.get("list") or [None])[0]

    path_parts = [part for part in parsed.path.split("/") if part]
    is_shorts = len(path_parts) >= 2 and path_parts[0] == "shorts"
    if not video_id and hostname == "youtu.be" and path_parts:
        video_id = path_parts[0]
    if not video_id and len(path_parts) >= 2 and path_parts[0] in {"shorts", "embed", "live"}:
        video_id = path_parts[1]

    return video_id, playlist_id, is_shorts


def browser_metadata(app_name: str | None, run_osascript: Callable[[str], str]) -> BrowserMetadata:
    if not app_name:
        return BrowserMetadata()

    if app_name in {
        "Floorp",
        "Firefox",
        "Firefox Developer Edition",
        "LibreWolf",
        "Google Chrome Canary",
        "Safari",
        "Safari Technology Preview",
        "Waterfox",
        "Zen",
    }:
        fallback = _accessibility_address_bar_metadata(app_name, run_osascript)
        # Safari removes its toolbar from AX in full screen. A failed AX
        # probe must not suppress the existing focused-tab automation path.
        if fallback and (fallback.site_url or app_name != "Safari"):
            return fallback

    script = browser_script(app_name)
    if not script:
        return BrowserMetadata()

    if _force_chromium_ax_capture_enabled() and is_chromium_browser_app(app_name):
        fallback = _accessibility_address_bar_metadata(app_name, run_osascript)
        if fallback:
            return fallback

    try:
        result = run_osascript(script)
    except RuntimeError as error:
        error_message = safe_browser_automation_error(error)
        fallback = _accessibility_address_bar_metadata(app_name, run_osascript)
        if fallback and fallback.site_url:
            return fallback
        if fallback and browser_automation_status_from_error(error_message) != "denied":
            return fallback
        return BrowserMetadata(
            browser_name=app_name,
            browser_automation_status=browser_automation_status_from_error(error_message),
            browser_automation_error=error_message,
        )

    normalized_result = result.strip()
    if not normalized_result:
        fallback = _accessibility_address_bar_metadata(app_name, run_osascript)
        if fallback:
            return fallback
        return BrowserMetadata(
            browser_name=app_name,
            browser_automation_status="empty_result",
            browser_automation_error=f"{app_name} returned an empty browser automation result.",
        )

    if normalized_result == "STALE":
        return BrowserMetadata(browser_name=app_name, match_state="stale", browser_automation_status="stale")

    if normalized_result == _NO_SCRIPTABLE_WINDOW:
        fallback = _accessibility_address_bar_metadata(app_name, run_osascript)
        if fallback:
            return fallback
        return BrowserMetadata(
            browser_name=app_name,
            browser_automation_status="unavailable",
            browser_automation_error=f"{app_name} reported no scriptable browser window.",
        )

    parts = result.splitlines()
    url = parts[0].strip() if parts else None
    title = parts[1].strip() if len(parts) > 1 else None
    match_state = parts[2].strip() if len(parts) > 2 else None
    ax_window_title = parts[3].strip() if len(parts) > 3 else None
    private_window = private_window_from_mode(parts[4]) if len(parts) > 4 else None
    if match_state == "front-fallback" and is_chromium_browser_app(app_name):
        fallback = _accessibility_address_bar_metadata(app_name, run_osascript)
        if fallback and fallback.site_url:
            return fallback
        return BrowserMetadata(
            browser_name=app_name,
            ax_window_title=ax_window_title,
            match_state=match_state,
            browser_automation_status=fallback.browser_automation_status if fallback else "unavailable",
            browser_automation_error=fallback.browser_automation_error
            if fallback
            else f"{app_name} front fallback did not match the focused window.",
        )
    video_id, playlist_id, is_shorts = youtube_ids(url)
    return BrowserMetadata(
        browser_name=app_name,
        site_domain=normalize_domain(url),
        site_title=title or None,
        site_url=url or None,
        youtube_video_id=video_id,
        youtube_playlist_id=playlist_id,
        youtube_is_shorts=is_shorts,
        ax_window_title=ax_window_title or None,
        match_state=match_state or None,
        browser_automation_status="granted",
        private_window=private_window,
    )
