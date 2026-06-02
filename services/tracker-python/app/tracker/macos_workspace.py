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
    if app_name == "Safari":
        return """
        tell application "Safari"
          if not (exists front document) then return ""
          set currentUrl to URL of front document
          set currentTitle to name of front document
          return currentUrl & linefeed & currentTitle
        end tell
        """

    if app_name in {"Google Chrome", "Microsoft Edge", "Arc", "Brave Browser", "Chromium"}:
        return f'''
        tell application "{app_name}"
          if not (exists front window) then return ""
          set activeTab to active tab of front window
          set currentUrl to URL of activeTab
          set currentTitle to title of activeTab
          return currentUrl & linefeed & currentTitle
        end tell
        '''

    if app_name == "Firefox":
        return """
        tell application "System Events"
          if not (exists process "Firefox") then return ""
          tell process "Firefox"
            if not (exists front window) then return ""
            set currentUrl to value of text field 1 of toolbar 1 of front window
            set currentTitle to value of attribute "AXTitle" of front window
            return currentUrl & linefeed & currentTitle
          end tell
        end tell
        """

    return None


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


def _browser_metadata(app_name: str | None) -> tuple[str | None, str | None, str | None, str | None, str | None, str | None, bool | None]:
    if not app_name:
        return None, None, None, None, None, None, None

    script = _browser_script(app_name)
    if not script:
        return None, None, None, None, None, None, None

    try:
        result = _run_osascript(script)
    except Exception:
        return app_name, None, None, None, None, None, None

    if not result:
        return app_name, None, None, None, None, None, None

    parts = result.splitlines()
    url = parts[0].strip() if parts else None
    title = parts[1].strip() if len(parts) > 1 else None
    video_id, playlist_id, is_shorts = _youtube_ids(url)
    return app_name, _normalize_domain(url), title or None, url or None, video_id, playlist_id, is_shorts


def current_snapshot() -> Snapshot:
    try:
        app_name, bundle_id, window_title = _frontmost_via_system_events()
    except Exception:
        app_name, bundle_id = _frontmost_via_lsappinfo()
        window_title = read_front_window_title() if app_name else None

    if not app_name:
        app_name = "Unavailable"

    browser_name, site_domain, site_title, site_url, youtube_video_id, youtube_playlist_id, youtube_is_shorts = _browser_metadata(app_name)

    return Snapshot(
        observed_at=utc_now_iso(),
        app_name=app_name,
        bundle_id=bundle_id,
        window_title=window_title,
        source="accessibility" if window_title else "nsworkspace",
        browser_name=browser_name,
        site_domain=site_domain,
        site_title=site_title,
        site_url=site_url,
        youtube_video_id=youtube_video_id,
        youtube_playlist_id=youtube_playlist_id,
        youtube_is_shorts=youtube_is_shorts,
        site_source="applescript" if site_domain else None,
    )


def snapshot_to_json(snapshot: Snapshot) -> str:
    return json.dumps(asdict(snapshot))
