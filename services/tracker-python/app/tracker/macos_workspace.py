from __future__ import annotations

import json
import subprocess
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Final, Literal, TypedDict

from app.permissions.accessibility import read_front_window_title
from app.tracker.browser_automation import (
    BrowserAutomationStatus,
    BrowserMetadata,
    browser_automation_status_from_error,
    browser_metadata,
    browser_script,
    is_supported_browser_app,
    youtube_ids,
)

SystemTransientActivity = Literal["mission_control", "app_switcher"]


class OnScreenWindowRow(TypedDict):
    owner_name: str | None
    layer: int | None
    name: str | None


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
    browser_automation_status: BrowserAutomationStatus | None = None
    browser_automation_error: str | None = None
    system_transient_activity: SystemTransientActivity | None = None


_CG_WINDOW_ROWS_SCRIPT: Final[str] = "\n".join(
    (
        "import Foundation",
        "import CoreGraphics",
        "let rawRows = (CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]]) ?? []",
        "let rows = rawRows.map { row -> [String: Any] in",
        "    [",
        '        "owner_name": row[kCGWindowOwnerName as String] as? String ?? NSNull(),',
        '        "layer": row[kCGWindowLayer as String] as? Int ?? NSNull(),',
        '        "name": row[kCGWindowName as String] as? String ?? NSNull(),',
        "    ]",
        "}",
        "let data = try JSONSerialization.data(withJSONObject: rows)",
        "print(String(data: data, encoding: .utf8) ?? \"[]\")",
    )
)


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


def _json_text(value: object) -> str | None:
    return value if isinstance(value, str) else None


def _json_int(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _onscreen_window_rows() -> list[OnScreenWindowRow]:
    try:
        raw_rows = json.loads(_run_command(["/usr/bin/swift", "-e", _CG_WINDOW_ROWS_SCRIPT]))
    except (RuntimeError, json.JSONDecodeError):
        return []

    if not isinstance(raw_rows, list):
        return []

    rows: list[OnScreenWindowRow] = []
    for raw_row in raw_rows:
        if not isinstance(raw_row, dict):
            continue
        rows.append(
            {
                "owner_name": _json_text(raw_row.get("owner_name")),
                "layer": _json_int(raw_row.get("layer")),
                "name": _json_text(raw_row.get("name")),
            }
        )
    return rows


def _row_name(row: OnScreenWindowRow) -> str:
    return (row["name"] or "").strip()


def _is_dock_window(row: OnScreenWindowRow) -> bool:
    return row["owner_name"] == "Dock"


def _is_mission_control_marker(row: OnScreenWindowRow) -> bool:
    return _is_dock_window(row) and (
        row["layer"] == 18 or (row["layer"] == 17 and _row_name(row) == "appicon")
    )


def _is_app_switcher_marker(row: OnScreenWindowRow) -> bool:
    return _is_dock_window(row) and row["layer"] == 20 and _row_name(row) == ""


def _system_transient_activity_from_rows(rows: Sequence[OnScreenWindowRow]) -> SystemTransientActivity | None:
    if any(_is_mission_control_marker(row) for row in rows):
        return "mission_control"
    if any(_is_app_switcher_marker(row) for row in rows):
        return "app_switcher"
    return None


def _system_transient_activity() -> SystemTransientActivity | None:
    return _system_transient_activity_from_rows(_onscreen_window_rows())


_browser_script = browser_script
_browser_automation_status_from_error = browser_automation_status_from_error
_is_supported_browser_app = is_supported_browser_app
_youtube_ids = youtube_ids


def _browser_metadata(app_name: str | None) -> BrowserMetadata:
    return browser_metadata(app_name, _run_osascript)


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


def current_snapshot(include_system_transient: bool = True) -> Snapshot:
    try:
        app_name, bundle_id, window_title = _frontmost_via_system_events()
    except Exception:
        app_name, bundle_id = _frontmost_via_lsappinfo()
        window_title = read_front_window_title() if app_name else None

    system_transient_activity = _system_transient_activity() if include_system_transient else None

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

    browser_automation_status = browser.browser_automation_status
    if browser_automation_status is None and not _is_supported_browser_app(app_name):
        browser_automation_status = "not_applicable"

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
        browser_automation_status=browser_automation_status,
        browser_automation_error=browser.browser_automation_error,
        system_transient_activity=system_transient_activity,
    )


def snapshot_to_json(snapshot: Snapshot) -> str:
    return json.dumps(asdict(snapshot))
