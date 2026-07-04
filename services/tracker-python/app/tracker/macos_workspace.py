from __future__ import annotations

import json
import os
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
from app.tracker.browser_history import (
    browser_history_metadata,
    is_browser_history_supported_app,
)
from app.tracker.youtube_video_recovery import YouTubeVideoIdMemory

# Recovers a video id for the occasional YouTube capture that lands mid SPA-navigation with
# the video title but a bare base URL (see youtube_video_recovery). Capture runs on a single
# thread, so a plain module-level instance is safe and cost-free.
_youtube_video_id_memory = YouTubeVideoIdMemory()

SystemTransientActivity = Literal["mission_control", "app_switcher"]
FrontmostCaptureSource = Literal["system-events", "lsappinfo", "unavailable"]
OSASCRIPT_TIMEOUT_SECONDS: Final = 3.0
# Generous enough for the first `swift -e` invocation, which pays JIT warmup cost.
COMMAND_TIMEOUT_SECONDS: Final = 5.0
FORCE_FRONTMOST_FALLBACK_CAPTURE_ENV: Final = "DRIFTY_FORCE_FRONTMOST_FALLBACK_CAPTURE"
FORCE_BROWSER_HISTORY_URL_FALLBACK_ENV: Final = "DRIFTY_FORCE_BROWSER_HISTORY_URL_FALLBACK"
_BROWSER_HISTORY_FALLBACK_STATUSES: Final = frozenset({"denied", "empty_result", "stale", "unavailable"})


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
    browser_history_status: str | None = None
    browser_history_reason: str | None = None
    browser_history_database_found: bool | None = None
    browser_history_profile_count: int | None = None
    browser_history_candidate_count: int | None = None
    browser_history_error_count: int | None = None
    system_transient_activity: SystemTransientActivity | None = None
    frontmost_capture_source: FrontmostCaptureSource | None = None
    frontmost_capture_error: str | None = None
    frontmost_fallback_error: str | None = None


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
    try:
        result = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True,
            text=True,
            check=False,
            timeout=OSASCRIPT_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired as error:
        raise RuntimeError("osascript timed out") from error
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "osascript failed")
    return result.stdout.strip()


def _run_command(command: list[str], timeout: float = COMMAND_TIMEOUT_SECONDS) -> str:
    try:
        result = subprocess.run(command, capture_output=True, text=True, check=False, timeout=timeout)
    except subprocess.TimeoutExpired as error:
        raise RuntimeError("command timed out") from error
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


def _lsappinfo_text(value: str) -> str | None:
    cleaned = value.strip()
    if not cleaned:
        return None
    if not cleaned.startswith('"'):
        return _optional_text(cleaned)

    chars: list[str] = []
    escaped = False
    for char in cleaned[1:]:
        if escaped:
            chars.append(char)
            escaped = False
            continue
        if char == "\\":
            escaped = True
            continue
        if char == '"':
            return _optional_text("".join(chars))
        chars.append(char)
    return None


def _lsappinfo_assignment(line: str, key: str) -> str | None:
    for prefix in (f'"{key}"=', f"{key}="):
        if line.startswith(prefix):
            return _lsappinfo_text(line.split("=", 1)[1])
    return None


def _lsappinfo_header_app_name(line: str) -> str | None:
    if not line.startswith('"') or line.startswith('"name"=') or line.startswith('"bundleID"='):
        return None
    return _lsappinfo_text(line)


def _error_text(error: RuntimeError) -> str:
    return str(error).strip() or type(error).__name__


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
_is_browser_history_supported_app = is_browser_history_supported_app
_youtube_ids = youtube_ids


def _browser_metadata(app_name: str | None) -> BrowserMetadata:
    return browser_metadata(app_name, _run_osascript)


def _browser_history_metadata(app_name: str | None, window_title: str | None, observed_at: str | None) -> BrowserMetadata:
    return browser_history_metadata(app_name, window_title, observed_at)


def _force_browser_history_url_fallback() -> bool:
    return os.environ.get(FORCE_BROWSER_HISTORY_URL_FALLBACK_ENV) == "1"


def _should_try_browser_history_url_fallback(app_name: str | None, browser: BrowserMetadata) -> bool:
    return (
        browser.site_url is None
        and browser.browser_automation_status in _BROWSER_HISTORY_FALLBACK_STATUSES
        and _is_browser_history_supported_app(app_name)
    )


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


def _frontmost_via_lsappinfo() -> tuple[str | None, str | None, str | None]:
    front = _run_command(["lsappinfo", "front"])
    if "NULL" in front:
        return None, None, "lsappinfo front returned NULL."

    asn = front.strip().strip("[]").strip()
    info = _run_command(["lsappinfo", "info", asn])

    app_name = None
    bundle_id = None
    for line in info.splitlines():
        line = line.strip()
        if app_name is None:
            app_name = _lsappinfo_header_app_name(line)
        parsed_name = _lsappinfo_assignment(line, "name")
        if parsed_name is not None:
            app_name = parsed_name
        parsed_bundle_id = _lsappinfo_assignment(line, "bundleID")
        if parsed_bundle_id is not None:
            bundle_id = parsed_bundle_id

    fallback_error = None
    if app_name is None:
        fallback_error = "lsappinfo info returned no parseable app name."

    return app_name, bundle_id, fallback_error


def _force_frontmost_fallback_capture() -> bool:
    return os.environ.get(FORCE_FRONTMOST_FALLBACK_CAPTURE_ENV) == "1"


def _frontmost_via_fallback_capture() -> tuple[str | None, str | None, str | None, str | None]:
    try:
        app_name, bundle_id, frontmost_fallback_error = _frontmost_via_lsappinfo()
    except RuntimeError as fallback_error:
        return None, None, None, _error_text(fallback_error)
    window_title = read_front_window_title() if app_name else None
    return app_name, bundle_id, window_title, frontmost_fallback_error


def current_snapshot(include_system_transient: bool = True) -> Snapshot:
    observed_at = utc_now_iso()
    frontmost_capture_source: FrontmostCaptureSource = "system-events"
    frontmost_capture_error = None
    frontmost_fallback_error = None
    if _force_frontmost_fallback_capture():
        frontmost_capture_error = "System Events frontmost capture skipped by developer diagnostics."
        app_name, bundle_id, window_title, frontmost_fallback_error = _frontmost_via_fallback_capture()
        frontmost_capture_source = "lsappinfo" if app_name else "unavailable"
    else:
        try:
            app_name, bundle_id, window_title = _frontmost_via_system_events()
        except RuntimeError as error:
            frontmost_capture_error = _error_text(error)
            app_name, bundle_id, window_title, frontmost_fallback_error = _frontmost_via_fallback_capture()
            frontmost_capture_source = "lsappinfo" if app_name else "unavailable"

    system_transient_activity = _system_transient_activity() if include_system_transient else None

    if not app_name:
        if frontmost_capture_error is None:
            frontmost_capture_error = "System Events returned no frontmost app name."
        frontmost_capture_source = "unavailable"
        app_name = "Unavailable"

    force_browser_history_url_fallback = _force_browser_history_url_fallback()
    if force_browser_history_url_fallback:
        if _is_browser_history_supported_app(app_name):
            browser = _browser_history_metadata(app_name, window_title, observed_at)
        elif _browser_script(app_name):
            browser = BrowserMetadata(
                browser_name=app_name,
                browser_automation_status="unavailable",
                browser_automation_error=f"Browser history URL fallback is not supported for {app_name}.",
                browser_history_status="unsupported",
                browser_history_reason="unsupported_browser",
            )
        else:
            browser = BrowserMetadata()
        browser_history = browser
    else:
        browser = _browser_metadata(app_name)
        browser_history = None

    # Prefer the AX title captured in the same osascript pass as the tab read,
    # so window_title and site_* cannot describe two different moments.
    if browser.ax_window_title:
        window_title = browser.ax_window_title
    if not force_browser_history_url_fallback and _should_try_browser_history_url_fallback(app_name, browser):
        history_browser = _browser_history_metadata(app_name, window_title, observed_at)
        browser_history = history_browser
        if history_browser.site_url:
            browser = history_browser

    site_source = None
    capture_confidence = 1.0
    if browser.site_domain:
        if browser.match_state == "browser-history-title":
            site_source = "browser-history-title"
            capture_confidence = 0.45
        elif browser.match_state == "front-fallback":
            # No window's active tab matched the focused window's title, so the
            # tab data may belong to a window other than the one on screen.
            site_source = "applescript-front-window"
            capture_confidence = 0.5 if browser.ax_window_title else 0.8
        elif browser.match_state == "accessibility-address-bar":
            site_source = "accessibility-address-bar"
            capture_confidence = 0.8
        elif browser.match_state == "accessibility-address-bar-schemaless":
            site_source = "accessibility-address-bar"
            capture_confidence = 0.6
        else:
            site_source = "applescript"

    browser_automation_status = browser.browser_automation_status
    if browser_automation_status is None and not _is_supported_browser_app(app_name):
        browser_automation_status = "not_applicable"

    youtube_video_id, site_url = _youtube_video_id_memory.observe(
        window_title,
        browser.site_domain,
        browser.site_url,
        browser.youtube_video_id,
        # Only exact-match captures (confidence 1.0 above) may teach the title -> id memory;
        # e.g. a "front-fallback" tab read can describe a different window, and learning a
        # wrong pair would replay it later at full confidence.
        learn=capture_confidence >= 1.0,
    )

    return Snapshot(
        observed_at=observed_at,
        app_name=app_name,
        bundle_id=bundle_id,
        window_title=window_title,
        source="accessibility" if window_title else "nsworkspace",
        browser_name=browser.browser_name,
        site_domain=browser.site_domain,
        site_title=browser.site_title,
        site_url=site_url,
        youtube_video_id=youtube_video_id,
        youtube_playlist_id=browser.youtube_playlist_id,
        youtube_is_shorts=browser.youtube_is_shorts,
        site_source=site_source,
        capture_confidence=capture_confidence,
        browser_automation_status=browser_automation_status,
        browser_automation_error=browser.browser_automation_error,
        browser_history_status=browser_history.browser_history_status if browser_history else None,
        browser_history_reason=browser_history.browser_history_reason if browser_history else None,
        browser_history_database_found=browser_history.browser_history_database_found if browser_history else None,
        browser_history_profile_count=browser_history.browser_history_profile_count if browser_history else None,
        browser_history_candidate_count=browser_history.browser_history_candidate_count if browser_history else None,
        browser_history_error_count=browser_history.browser_history_error_count if browser_history else None,
        system_transient_activity=system_transient_activity,
        frontmost_capture_source=frontmost_capture_source,
        frontmost_capture_error=frontmost_capture_error,
        frontmost_fallback_error=frontmost_fallback_error,
    )


def snapshot_to_json(snapshot: Snapshot) -> str:
    return json.dumps(asdict(snapshot))
