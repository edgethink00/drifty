from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal
from urllib.parse import parse_qs, urlparse

from app.tracker.accessibility_address_bar import (
    accessibility_address_bar_script,
    is_chromium_browser_app,
    metadata_from_accessibility_address_bar_result,
)

BrowserAutomationStatus = Literal["granted", "denied", "unavailable", "stale", "empty_result", "not_applicable"]

_NO_SCRIPTABLE_WINDOW = "NO_SCRIPTABLE_WINDOW"


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

    if app_name in {"Google Chrome", "Google Chrome Canary", "Microsoft Edge", "Arc", "Brave Browser", "Chromium"}:
        return _tab_matching_script(
            app_name=app_name,
            exists_check="(count of windows) > 0",
            tab_title="title of active tab of w",
            tab_url="URL of active tab of w",
            fallback_url="URL of active tab of window 1",
            fallback_title="title of active tab of window 1",
        )

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
    return bool(app_name and browser_script(app_name))


def browser_automation_status_from_error(message: str) -> BrowserAutomationStatus:
    normalized = message.lower()
    if "not authorized" in normalized or "not permitted" in normalized or "-1743" in normalized:
        return "denied"
    return "unavailable"


def safe_browser_automation_error(error: RuntimeError) -> str:
    return " ".join(str(error).split())[:240]


def _chromium_accessibility_metadata(app_name: str, run_osascript: Callable[[str], str]) -> BrowserMetadata | None:
    if not is_chromium_browser_app(app_name):
        return None

    try:
        result = run_osascript(accessibility_address_bar_script(app_name))
    except RuntimeError as error:
        return BrowserMetadata(
            browser_name=app_name,
            browser_automation_status="unavailable",
            browser_automation_error=safe_browser_automation_error(error),
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
        browser_automation_status="granted",
    )


def _tab_matching_script(
    app_name: str,
    exists_check: str,
    tab_title: str,
    tab_url: str,
    fallback_url: str,
    fallback_title: str,
) -> str:
    return f'''
        set axTitle to ""
        tell application "System Events"
          try
            set frontProc to first application process whose frontmost is true
            if name of frontProc is not equal to "{app_name}" then return "STALE"
            tell frontProc
              if exists front window then set axTitle to name of front window
            end tell
          end try
        end tell
        tell application "{app_name}"
          if not ({exists_check}) then return "{_NO_SCRIPTABLE_WINDOW}"
          set matchedUrl to ""
          set matchedTitle to ""
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
          end if
          return matchedUrl & linefeed & matchedTitle & linefeed & matchState & linefeed & axTitle
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

    script = browser_script(app_name)
    if not script:
        return BrowserMetadata()

    try:
        result = run_osascript(script)
    except RuntimeError as error:
        error_message = safe_browser_automation_error(error)
        fallback = _chromium_accessibility_metadata(app_name, run_osascript)
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
        fallback = _chromium_accessibility_metadata(app_name, run_osascript)
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
        fallback = _chromium_accessibility_metadata(app_name, run_osascript)
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
    if match_state == "front-fallback" and is_chromium_browser_app(app_name):
        fallback = _chromium_accessibility_metadata(app_name, run_osascript)
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
    )
