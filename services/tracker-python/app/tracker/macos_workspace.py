from __future__ import annotations

import json
import os
import subprocess
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Final, Literal

from app.permissions.accessibility import read_front_window_title
from app.tracker.capture_contract import (  # re-exported: this module was the
    FrontmostCaptureSource,  # original home of the capture contract, and callers
    Snapshot,  # still import it from here.
    utc_now_iso,
)
from app.tracker.adaptive_context import (
    AdaptiveContentContextPayload,
    AdaptiveContextCaptureInput,
    adaptive_content_context_for_capture,
)
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
from app.tracker.macos_frontmost import (
    frontmost_via_lsappinfo,
    frontmost_via_system_events,
)
from app.tracker.macos_system_activity import (
    OnScreenWindowRow,
    SystemTransientActivity,
    onscreen_window_rows,
    system_transient_activity_from_rows,
)
from app.tracker.youtube_video_recovery import YouTubeVideoIdMemory

# Recovers a video id for the occasional YouTube capture that lands mid SPA-navigation with
# the video title but a bare base URL (see youtube_video_recovery). Capture runs on a single
# thread, so a plain module-level instance is safe and cost-free.
_youtube_video_id_memory = YouTubeVideoIdMemory()

OSASCRIPT_TIMEOUT_SECONDS: Final = 3.0
# Generous enough for the first `swift -e` invocation, which pays JIT warmup cost.
COMMAND_TIMEOUT_SECONDS: Final = 5.0
FORCE_FRONTMOST_FALLBACK_CAPTURE_ENV: Final = "DRIFTY_FORCE_FRONTMOST_FALLBACK_CAPTURE"
FORCE_BROWSER_HISTORY_URL_FALLBACK_ENV: Final = "DRIFTY_FORCE_BROWSER_HISTORY_URL_FALLBACK"
_BROWSER_HISTORY_FALLBACK_STATUSES: Final = frozenset({"denied", "empty_result", "stale", "unavailable"})


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


def _error_text(error: RuntimeError) -> str:
    return str(error).strip() or type(error).__name__


def _onscreen_window_rows() -> list[OnScreenWindowRow]:
    return onscreen_window_rows(_run_command)


def _system_transient_activity_from_rows(rows: Sequence[OnScreenWindowRow]) -> SystemTransientActivity | None:
    return system_transient_activity_from_rows(rows)


_browser_script = browser_script
_browser_automation_status_from_error = browser_automation_status_from_error
_is_supported_browser_app = is_supported_browser_app
_is_browser_history_supported_app = is_browser_history_supported_app
_youtube_ids = youtube_ids


def _browser_metadata(app_name: str | None) -> BrowserMetadata:
    return browser_metadata(app_name, _run_osascript)


def _browser_history_metadata(app_name: str | None, window_title: str | None, observed_at: str | None) -> BrowserMetadata:
    return browser_history_metadata(app_name, window_title, observed_at)


def _should_try_browser_history_url_fallback(app_name: str | None, browser: BrowserMetadata) -> bool:
    return (
        browser.site_url is None
        and browser.browser_automation_status in _BROWSER_HISTORY_FALLBACK_STATUSES
        and _is_browser_history_supported_app(app_name)
    )


def _frontmost_via_system_events() -> tuple[str | None, str | None, str | None]:
    return frontmost_via_system_events(_run_osascript)


def _frontmost_via_lsappinfo() -> tuple[str | None, str | None, str | None]:
    return frontmost_via_lsappinfo(_run_command)


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
    if os.environ.get(FORCE_FRONTMOST_FALLBACK_CAPTURE_ENV) == "1":
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

    system_transient_activity = (
        _system_transient_activity_from_rows(_onscreen_window_rows()) if include_system_transient else None
    )

    if not app_name:
        if frontmost_capture_error is None:
            frontmost_capture_error = "System Events returned no frontmost app name."
        frontmost_capture_source = "unavailable"
        app_name = "Unavailable"

    force_browser_history_url_fallback = os.environ.get(FORCE_BROWSER_HISTORY_URL_FALLBACK_ENV) == "1"
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
    adaptive_content_context = adaptive_content_context_for_capture(
        AdaptiveContextCaptureInput(
            observed_at=observed_at,
            app_name=app_name,
            bundle_id=bundle_id,
            window_title=window_title,
            browser_name=browser.browser_name,
            site_domain=browser.site_domain,
            site_title=browser.site_title,
            site_url=site_url,
        )
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
        adaptive_content_context=adaptive_content_context,
    )


def snapshot_to_json(snapshot: Snapshot) -> str:
    return json.dumps(asdict(snapshot))
