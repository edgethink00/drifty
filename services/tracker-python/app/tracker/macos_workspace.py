from __future__ import annotations

import json
import subprocess
from urllib.parse import parse_qs, urlparse
from dataclasses import dataclass, asdict
from datetime import datetime, timezone

from app.permissions.accessibility import read_front_window_title


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class Snapshot:
    observed_at: str
    app_name: str
    bundle_id: str | None
    window_title: str | None
    source: str
    browser_name: str | None = None
    site_domain: str | None = None
    site_title: str | None = None
    site_url: str | None = None
    youtube_video_id: str | None = None
    youtube_playlist_id: str | None = None
    youtube_is_shorts: bool | None = None
    site_source: str | None = None
    capture_confidence: float = 1.0


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


def _run_osascript(script: str) -> str:
    result = subprocess.run(
        ["osascript", "-e", script],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "osascript failed")
    return result.stdout.strip()


def _run_command(command: list[str]) -> str:
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "command failed")
    return result.stdout.strip()


def _optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    if not cleaned or cleaned == "missing value":
        return None
    return cleaned


def _frontmost_via_system_events() -> tuple[str | None, str | None, str | None]:
    result = _run_osascript(
        '''
        tell application "System Events"
          set frontApp to first application process whose frontmost is true
          set appName to name of frontApp
          set bundleId to bundle identifier of frontApp
          if bundleId is missing value then set bundleId to ""
          set windowTitle to ""
          tell frontApp
            if exists front window then
              set windowTitle to name of front window
            end if
          end tell
          return appName & linefeed & bundleId & linefeed & windowTitle
        end tell
        '''
    )
    parts = result.splitlines()
    app_name = _optional_text(parts[0] if len(parts) > 0 else None)
    bundle_id = _optional_text(parts[1] if len(parts) > 1 else None)
    window_title = _optional_text(parts[2] if len(parts) > 2 else None)
    return app_name, bundle_id, window_title


def _frontmost_via_lsappinfo() -> tuple[str | None, str | None]:
    front = _run_command(["lsappinfo", "front"])
    if "NULL" in front:
        return None, None

    asn = front.strip().strip("[]").strip()
    info = _run_command(["lsappinfo", "info", asn])

    app_name = None
    bundle_id = None
    for line in info.splitlines():
        line = line.strip()
        if line.startswith('"name"='):
            app_name = line.split("=", 1)[1].strip().strip('"')
        if line.startswith('"bundleID"='):
            bundle_id = line.split("=", 1)[1].strip().strip('"')

    return app_name, bundle_id


def _normalize_domain(url: str | None) -> str | None:
    if not url:
        return None
    try:
        parsed = urlparse(url)
        domain = parsed.hostname or ""
        return domain.removeprefix("www.") or None
    except Exception:
        return None


def _browser_script(app_name: str) -> str | None:
    # The AX front-window title is read in the same osascript pass as the tab
    # query, then used to pick the window the user is actually looking at:
    # Chrome's AppleScript "front window" can lag the real z-order when several
    # windows (e.g. multiple profiles, fullscreen Spaces) are open.
    if app_name == "Safari":
        return _tab_matching_script(
            app_name="Safari",
            exists_check="exists front document",
            tab_title="name of current tab of w",
            tab_url="URL of current tab of w",
            fallback_url="URL of front document",
            fallback_title="name of front document",
        )

    if app_name in {"Google Chrome", "Microsoft Edge", "Arc", "Brave Browser", "Chromium"}:
        return _tab_matching_script(
            app_name=app_name,
            exists_check="exists front window",
            tab_title="title of active tab of w",
            tab_url="URL of active tab of w",
            fallback_url="URL of active tab of front window",
            fallback_title="title of active tab of front window",
        )

    if app_name == "Firefox":
        return """
        tell application "System Events"
          if not (exists process "Firefox") then return ""
          tell process "Firefox"
            if not (exists front window) then return ""
            set currentUrl to value of text field 1 of toolbar 1 of front window
            set currentTitle to value of attribute "AXTitle" of front window
            return currentUrl & linefeed & currentTitle & linefeed & "focused" & linefeed & currentTitle
          end tell
        end tell
        """

    return None


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
          if not ({exists_check}) then return ""
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


def _youtube_ids(url: str | None) -> tuple[str | None, str | None, bool | None]:
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


def _browser_metadata(app_name: str | None) -> BrowserMetadata:
    if not app_name:
        return BrowserMetadata()

    script = _browser_script(app_name)
    if not script:
        return BrowserMetadata()

    try:
        result = _run_osascript(script)
    except Exception:
        return BrowserMetadata(browser_name=app_name)

    if not result:
        return BrowserMetadata(browser_name=app_name)

    if result.strip() == "STALE":
        return BrowserMetadata(browser_name=app_name, match_state="stale")

    parts = result.splitlines()
    url = parts[0].strip() if parts else None
    title = parts[1].strip() if len(parts) > 1 else None
    match_state = parts[2].strip() if len(parts) > 2 else None
    ax_window_title = parts[3].strip() if len(parts) > 3 else None
    video_id, playlist_id, is_shorts = _youtube_ids(url)
    return BrowserMetadata(
        browser_name=app_name,
        site_domain=_normalize_domain(url),
        site_title=title or None,
        site_url=url or None,
        youtube_video_id=video_id,
        youtube_playlist_id=playlist_id,
        youtube_is_shorts=is_shorts,
        ax_window_title=ax_window_title or None,
        match_state=match_state or None,
    )


def current_snapshot() -> Snapshot:
    try:
        app_name, bundle_id, window_title = _frontmost_via_system_events()
    except Exception:
        app_name, bundle_id = _frontmost_via_lsappinfo()
        window_title = read_front_window_title() if app_name else None

    if not app_name:
        app_name = "Unavailable"

    browser = _browser_metadata(app_name)

    # Prefer the AX title captured in the same osascript pass as the tab read,
    # so window_title and site_* cannot describe two different moments.
    if browser.ax_window_title:
        window_title = browser.ax_window_title

    site_source = None
    capture_confidence = 1.0
    if browser.site_domain:
        if browser.match_state == "front-fallback":
            # No window's active tab matched the focused window's title, so the
            # tab data may belong to a window other than the one on screen.
            site_source = "applescript-front-window"
            capture_confidence = 0.5 if browser.ax_window_title else 0.8
        else:
            site_source = "applescript"

    return Snapshot(
        observed_at=utc_now_iso(),
        app_name=app_name,
        bundle_id=bundle_id,
        window_title=window_title,
        source="accessibility" if window_title else "nsworkspace",
        browser_name=browser.browser_name,
        site_domain=browser.site_domain,
        site_title=browser.site_title,
        site_url=browser.site_url,
        youtube_video_id=browser.youtube_video_id,
        youtube_playlist_id=browser.youtube_playlist_id,
        youtube_is_shorts=browser.youtube_is_shorts,
        site_source=site_source,
        capture_confidence=capture_confidence,
    )


def snapshot_to_json(snapshot: Snapshot) -> str:
    return json.dumps(asdict(snapshot))
