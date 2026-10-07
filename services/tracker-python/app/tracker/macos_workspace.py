from __future__ import annotations

import copy
import json
import os
import subprocess
import time
from collections.abc import Callable, Sequence
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Final, Literal

from app.permissions.accessibility import read_front_window_title
from app.tracker.browser_content import capture_browser_content
from app.tracker.browser_content_policy import policy_snapshot
from app.tracker.capture_contract import (  # re-exported: this module was the
    FrontmostCaptureSource,  # original home of the capture contract, and callers
    Snapshot,  # still import it from here.
    WindowTitleSource,
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
from app.tracker.chatgpt_session import apply_native_chatgpt_session_title
from app.tracker.macos_frontmost import (
    frontmost_via_lsappinfo,
    frontmost_via_system_events,
)
from app.tracker.macos_capture import (
    CAPTURE_TIMEOUT_SECONDS, IDENTITY_TIMEOUT_SECONDS,
    CommandScope, FrontmostApplication, context_worker, read_frontmost_application,
)
from app.tracker.macos_app_names import canonical_macos_app_name
from app.tracker.macos_system_activity import (
    OnScreenWindowRow,
    SystemTransientActivity,
    onscreen_window_rows,
    system_transient_activity_from_rows,
)
from app.tracker.youtube_video_recovery import YouTubeVideoIdMemory
from app.tracker.safari_url import refine_safari_url

# Recovers a video id for the occasional YouTube capture that lands mid SPA-navigation with
# the video title but a bare base URL (see youtube_video_recovery). Capture runs on a single
# thread, so a plain module-level instance is safe and cost-free.
_youtube_video_id_memory = YouTubeVideoIdMemory()

OSASCRIPT_TIMEOUT_SECONDS: Final = 3.0
# Bounds occasional native helper or automation stalls while keeping capture responsive.
COMMAND_TIMEOUT_SECONDS: Final = 5.0
FORCE_FRONTMOST_FALLBACK_CAPTURE_ENV: Final = "DRIFTY_FORCE_FRONTMOST_FALLBACK_CAPTURE"
FORCE_BROWSER_HISTORY_URL_FALLBACK_ENV: Final = "DRIFTY_FORCE_BROWSER_HISTORY_URL_FALLBACK"
_BROWSER_HISTORY_FALLBACK_STATUSES: Final = frozenset({"denied", "empty_result", "stale", "unavailable"})
_canonical_macos_app_name = canonical_macos_app_name


def _run_osascript(script: str) -> str:
    try:
        result = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
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
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as error:
        raise RuntimeError("command timed out") from error
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "command failed")
    return result.stdout.strip()


def _error_text(error: RuntimeError) -> str:
    return str(error).strip() or type(error).__name__


def _onscreen_window_rows(run_command=None) -> list[OnScreenWindowRow]:
    return onscreen_window_rows(run_command or _run_command)


def _system_transient_activity_from_rows(rows: Sequence[OnScreenWindowRow]) -> SystemTransientActivity | None:
    return system_transient_activity_from_rows(rows)


_browser_script = browser_script
_browser_automation_status_from_error = browser_automation_status_from_error
_is_supported_browser_app = is_supported_browser_app
_is_browser_history_supported_app = is_browser_history_supported_app
_youtube_ids = youtube_ids


def _browser_metadata(app_name: str | None, run_osascript=None) -> BrowserMetadata:
    return browser_metadata(app_name, run_osascript or _run_osascript)


def _browser_history_metadata(app_name: str | None, window_title: str | None, observed_at: str | None) -> BrowserMetadata:
    return browser_history_metadata(app_name, window_title, observed_at)


def _should_try_browser_history_url_fallback(app_name: str | None, browser: BrowserMetadata) -> bool:
    return (
        browser.site_url is None
        and browser.browser_automation_status in _BROWSER_HISTORY_FALLBACK_STATUSES
        and _is_browser_history_supported_app(app_name)
    )


def _frontmost_via_system_events(run_osascript=None) -> tuple[str | None, str | None, str | None, int | None]:
    return frontmost_via_system_events(run_osascript or _run_osascript)


def _frontmost_via_lsappinfo() -> tuple[str | None, str | None, str | None, int | None]:
    return frontmost_via_lsappinfo(_run_command)


def _frontmost_via_fallback_capture() -> tuple[str | None, str | None, str | None, str | None, int | None]:
    try:
        app_name, bundle_id, frontmost_fallback_error, pid = _frontmost_via_lsappinfo()
    except RuntimeError as fallback_error:
        return None, None, None, _error_text(fallback_error), None
    window_title = read_front_window_title() if app_name else None
    return app_name, bundle_id, window_title, frontmost_fallback_error, pid


def current_snapshot(include_system_transient: bool = True) -> Snapshot:
    observed_at = utc_now_iso()
    deadline = time.monotonic() + CAPTURE_TIMEOUT_SECONDS
    native = (None if os.environ.get(FORCE_FRONTMOST_FALLBACK_CAPTURE_ENV) == "1"
              else read_frontmost_application())
    if native is None:
        return _capture_snapshot(include_system_transient=include_system_transient, observed_at=observed_at)

    # Copy the small video-title memory: a timed-out job must not teach later
    # samples a URL or mutate any state used by the recording thread.
    video_memory = copy.deepcopy(_youtube_video_id_memory)
    command_scope = CommandScope(deadline)

    def capture(allowed: Callable[[], bool]) -> Snapshot | None:
        content_policy = policy_snapshot()
        snapshot = _capture_snapshot(
            include_system_transient=include_system_transient, observed_at=observed_at,
            native=native, capture_allowed=allowed, video_memory=video_memory, command_scope=command_scope,
        )
        if not allowed():
            return None
        final_app = read_frontmost_application(
            timeout=min(IDENTITY_TIMEOUT_SECONDS, deadline - time.monotonic()), run_command=command_scope.run,
        )
        if final_app != native or not allowed():
            return None
        if policy_snapshot() != content_policy:
            snapshot.browser_content_context = None
        return snapshot

    snapshot = context_worker.read(capture, deadline=deadline, cancel=command_scope.close)
    if snapshot is not None:
        _youtube_video_id_memory.observe(
            snapshot.window_title, snapshot.site_domain, snapshot.site_url,
            snapshot.youtube_video_id, learn=snapshot.capture_confidence >= 1.0,
        )
        return snapshot
    app_name = _canonical_macos_app_name(native.app_name, native.bundle_id) or native.app_name
    browser = _is_supported_browser_app(app_name)
    return Snapshot(
        observed_at=observed_at, app_name=app_name, bundle_id=native.bundle_id,
        window_title=None, source="nsworkspace", frontmost_capture_source="nsworkspace",
        browser_name=app_name if browser else None,
        browser_automation_status="unavailable" if browser else "not_applicable",
        browser_automation_error="Optional Mac context was unavailable for this sample." if browser else None,
    )


def _capture_snapshot(
    include_system_transient: bool = True, *, observed_at: str | None = None,
    native: FrontmostApplication | None = None,
    capture_allowed: Callable[[], bool] = lambda: True,
    video_memory: YouTubeVideoIdMemory | None = None,
    command_scope: CommandScope | None = None,
) -> Snapshot:
    observed_at = observed_at or utc_now_iso()

    def check_current() -> None:
        if not capture_allowed():
            raise RuntimeError("Optional Mac context sample expired.")

    def checked_osascript(script: str) -> str:
        check_current()
        if command_scope is not None:
            return command_scope.run(["osascript", "-e", script], timeout=OSASCRIPT_TIMEOUT_SECONDS)
        return _run_osascript(script)

    def checked_command(command: list[str], timeout: float = COMMAND_TIMEOUT_SECONDS, cancelled=None, reply=None) -> str:
        check_current()
        if command_scope is not None:
            if cancelled is None and reply is None:
                return command_scope.run(command, timeout=timeout)
            return command_scope.run(command, timeout=timeout, cancelled=cancelled, reply=reply)
        if cancelled is not None or reply is not None:
            scope = CommandScope(time.monotonic()+timeout)
            try:
                return scope.run(command, timeout=timeout, cancelled=cancelled, reply=reply)
            finally:
                scope.close()
        return _run_command(command, timeout=timeout)

    check_current()
    frontmost_capture_source: FrontmostCaptureSource = "system-events"
    frontmost_capture_error = None
    frontmost_fallback_error = None
    pid = None
    raw_window_title = None
    window_read_succeeded = False
    if native is not None:
        app_name, bundle_id, pid = native.app_name, native.bundle_id, native.pid
        frontmost_capture_source = "nsworkspace"
        window_title = None
        try:
            _, title_bundle, raw_window_title, title_pid = _frontmost_via_system_events(checked_osascript)
        except RuntimeError:
            # AX/Apple Events may fail while NSWorkspace identity stays valid.
            pass
        else:
            if title_pid != pid or title_bundle != bundle_id:
                raise RuntimeError("Foreground changed before optional context capture.")
            window_read_succeeded = True
            window_title = raw_window_title
    elif os.environ.get(FORCE_FRONTMOST_FALLBACK_CAPTURE_ENV) == "1":
        frontmost_capture_error = "System Events frontmost capture skipped by developer diagnostics."
        app_name, bundle_id, window_title, frontmost_fallback_error, pid = _frontmost_via_fallback_capture()
        frontmost_capture_source = "lsappinfo" if app_name else "unavailable"
    else:
        try:
            app_name, bundle_id, window_title, pid = _frontmost_via_system_events()
            if not _canonical_macos_app_name(app_name, bundle_id):
                # An empty successful AppleScript read is still a capture failure.
                # Try the same app-only fallback used for permission/automation errors.
                raise RuntimeError("System Events returned no frontmost app name.")
        except RuntimeError as error:
            frontmost_capture_error = _error_text(error)
            app_name, bundle_id, window_title, frontmost_fallback_error, pid = _frontmost_via_fallback_capture()
            frontmost_capture_source = "lsappinfo" if app_name else "unavailable"

    app_name = _canonical_macos_app_name(app_name, bundle_id)

    check_current()
    system_transient_activity = (
        _system_transient_activity_from_rows(_onscreen_window_rows(checked_command) if native else _onscreen_window_rows())
        if include_system_transient
        else None
    )

    if not app_name:
        if frontmost_capture_error is None:
            frontmost_capture_error = "System Events returned no frontmost app name."
        frontmost_capture_source = "unavailable"
        app_name = "Unavailable"
        pid = None

    # A frontmost app whose front window the accessibility tree will not expose
    # stays an app-only segment. The on-screen window list is a separate API,
    # but `kCGWindowName` is empty without Screen Recording, which Drifty
    # deliberately does not request (docs/permissions/macos.md). Measured on a
    # real desktop on 2026-09-19: 43 layer-0 rows, every application row
    # unnamed. Reading the list here only spent a helper process per title-less
    # capture and never produced a title, so the capture keeps the accessibility
    # result and records which mechanism produced it.
    window_title_source: WindowTitleSource | None = "system-events" if window_title else None

    check_current()
    window_title = apply_native_chatgpt_session_title(
        app_name,
        bundle_id,
        window_title,
        pid,
        checked_command if native else _run_command,
    )

    check_current()
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
        browser = _browser_metadata(app_name, checked_osascript) if native else _browser_metadata(app_name)
        browser = refine_safari_url(browser, bundle_id, pid, checked_command if native else _run_command)
        browser_history = None

    check_current()
    # Prefer the AX title captured in the same osascript pass as the tab read,
    # so window_title and site_* cannot describe two different moments.
    if browser.ax_window_title:
        window_title = browser.ax_window_title
        window_title_source = "browser-accessibility"
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

    check_current()
    youtube_video_id, site_url = (video_memory or _youtube_video_id_memory).observe(
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

    check_current()
    browser_content_context = None
    if native is not None and site_source == "applescript" and pid is not None:
        browser_content_context = capture_browser_content(
            pid=pid, bundle_id=bundle_id, page_url=browser.site_url, page_title=browser.site_title,
            observed_at=observed_at, timeout=min(0.65, max(0, command_scope.deadline-time.monotonic()-0.7)) if command_scope else 0.65,
            run_command=checked_command,
        )
        check_current()
    if native is not None and window_read_succeeded:
        # Revalidate the raw focused title, before native ChatGPT enrichment.
        # Browser AX metadata must agree with that same window as well. A
        # switch during optional reads returns only the original app identity.
        _, final_bundle, final_title, final_pid = _frontmost_via_system_events(checked_osascript)
        expected_title = browser.ax_window_title or raw_window_title
        if (final_pid != native.pid or final_bundle != native.bundle_id
                or final_title != raw_window_title or (browser.ax_window_title and final_title != expected_title)):
            raise RuntimeError("Foreground window changed during optional context capture.")
    check_current()
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
        window_title_source=window_title_source,
        adaptive_content_context=adaptive_content_context,
        browser_content_context=browser_content_context,
    )


def snapshot_to_json(snapshot: Snapshot) -> str:
    return json.dumps(asdict(snapshot))
