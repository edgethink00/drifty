"""Windows foreground-activity capture (Phase 1 spike).

Design doc: ``docs/plans/2026-08-17-windows-port-phase1-design.md``.

Capture layers:

1. ``GetForegroundWindow`` -> HWND, title, owning PID (pure ctypes, no
   third-party dependencies, mirroring the stdlib-only sidecar rule).
2. Process identity via ``QueryFullProcessImageNameW``.
3. UWP hosts (``ApplicationFrameHost.exe``): resolve the hosted app by walking
   child windows for a different-PID ``Windows.UI.Core.CoreWindow``, then read
   that process's AUMID via ``GetApplicationUserModelId``. The host executable
   must never become the recorded identity; unresolved hosts are marked
   explicitly (gate W1-G2).
4. Session honesty: a capture from a non-interactive session (session 0 /
   no desktop) reports ``frontmost_capture_source="unavailable"`` with a typed
   error instead of fabricating a snapshot (gate W1-G6).

Identity model under test (§4.2): ``bundle_id`` carries the AUMID for packaged
apps and the lowercased executable path otherwise, so downstream identity keys
(`app_identity_key`) stay unique without schema changes.

Allowlisted browser URLs are read from the focused window's top-level Document
ValuePattern through a resident UI Automation host. A fresh extension bridge
is considered only when it matches the same foreground Document. Windows
does not infer a foreground URL from a separate browser-history profile.

With the Content context setting on, bounded visible page clues are read from
that same just-validated Document and bound to this window's raw title.
"""

from __future__ import annotations

import ctypes
import os
import sys
import time
from dataclasses import dataclass
from typing import Callable

from app.tracker.browser_automation import BrowserMetadata, normalize_domain, youtube_ids
from app.tracker.browser_content import content_excluded_url, normalize_context
from app.tracker.browser_description import MAX_DESCRIPTION_UTF16, clip_description
from app.tracker.browser_content_policy import policy_snapshot
from app.text_safety import replace_lone_surrogates
from app.tracker.capture_contract import Snapshot, utc_now_iso
from app.tracker.adaptive_context import AdaptiveContextCaptureInput, adaptive_content_context_for_capture
from app.tracker.windows_app_names import exe_display_name, is_windows_browser_app
from app.tracker.windows_browser_uia import WindowsBrowserCluesResult, WindowsBrowserUiaResult
from app.tracker.windows_browser_capture import (
    _URL_SAMPLE_BUDGET_SECONDS,
    read_browser_clues_with_budget,
    read_browser_url_with_budget,
    read_public_description_with_budget,
)
from app.tracker.windows_browser_bridge import read_browser_bridge_metadata


_APPLICATION_FRAME_HOST = "applicationframehost.exe"
_APPLICATION_FRAME_WINDOW_CLASS = "ApplicationFrameWindow"
_CORE_WINDOW_CLASS = "Windows.UI.Core.CoreWindow"
_TITLE_MAX = 512
_AUMID_MAX = 1024
_PATH_MAX = 32767

_PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
_APPMODEL_ERROR_NO_APPLICATION = 15703
_LIVE_UIA_CONFIDENCE = 0.8
# The Windows port's steady-state capture budget is 1.5s. A longer retry
# could credit the first window's elapsed tracking interval to a new app.
_FOREGROUND_RETRY_BUDGET_SECONDS = 1.5
# Leave room for the final HWND/PID/title check inside the same whole-capture
# budget. Identity capture itself still has the original 1.5s acceptance gate.
_FOREGROUND_CHECK_RESERVE_SECONDS = 0.05
# Edge labels its private windows in the window title. Chrome, Brave and
# Opera do not; the UIA host refuses their clues by the parenthesized mode
# label on the browser root view (any measured UI language) or the profile
# button's name.
_EDGE_PRIVATE_TITLE_LABEL = "[InPrivate]"
# Leave time after the optional description lookup for the caller's checks.
_DESCRIPTION_RESERVE_SECONDS = 0.03
_CLUE_BUDGET_UTF16 = 240


def _utf16_length(value: str) -> int:
    return len(value.encode("utf-16-le")) // 2


@dataclass(frozen=True)
class ForegroundWindow:
    hwnd: int
    title: str | None
    pid: int


@dataclass(frozen=True)
class ProcessIdentity:
    exe_path: str | None
    exe_name: str | None
    aumid: str | None


def _user32() -> ctypes.WinDLL:  # pragma: no cover - trivial accessor
    return ctypes.windll.user32


def _kernel32() -> ctypes.WinDLL:  # pragma: no cover - trivial accessor
    return ctypes.windll.kernel32


def is_windows() -> bool:
    return sys.platform == "win32"


def process_session_id(pid: int | None = None) -> int | None:
    """Session id of ``pid`` (default: this process). ``None`` when unknown."""
    if not is_windows():  # pragma: no cover - exercised on Windows only
        return None
    kernel32 = _kernel32()
    if pid is None:
        pid = kernel32.GetCurrentProcessId()
    session = ctypes.c_ulong()
    if not kernel32.ProcessIdToSessionId(ctypes.c_ulong(pid), ctypes.byref(session)):
        return None
    return session.value


def read_foreground_window() -> ForegroundWindow | None:  # pragma: no cover - Win32 boundary
    user32 = _user32()
    hwnd = user32.GetForegroundWindow()
    if not hwnd:
        return None
    buffer = ctypes.create_unicode_buffer(_TITLE_MAX)
    length = user32.GetWindowTextW(hwnd, buffer, _TITLE_MAX)
    title = buffer.value if length > 0 else None
    pid = ctypes.c_ulong()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    if pid.value == 0:
        return None
    return ForegroundWindow(hwnd=int(hwnd), title=title, pid=pid.value)


def read_process_exe_path(pid: int) -> str | None:  # pragma: no cover - Win32 boundary
    kernel32 = _kernel32()
    handle = kernel32.OpenProcess(_PROCESS_QUERY_LIMITED_INFORMATION, False, ctypes.c_ulong(pid))
    if not handle:
        return None
    try:
        size = ctypes.c_ulong(_PATH_MAX)
        buffer = ctypes.create_unicode_buffer(_PATH_MAX)
        if kernel32.QueryFullProcessImageNameW(handle, 0, buffer, ctypes.byref(size)):
            return buffer.value or None
        return None
    finally:
        kernel32.CloseHandle(handle)


def read_process_aumid(pid: int) -> str | None:  # pragma: no cover - Win32 boundary
    """AUMID for a packaged (UWP/MSIX) process; ``None`` for classic Win32."""
    kernel32 = _kernel32()
    handle = kernel32.OpenProcess(_PROCESS_QUERY_LIMITED_INFORMATION, False, ctypes.c_ulong(pid))
    if not handle:
        return None
    try:
        length = ctypes.c_uint32(_AUMID_MAX)
        buffer = ctypes.create_unicode_buffer(_AUMID_MAX)
        result = kernel32.GetApplicationUserModelId(handle, ctypes.byref(length), buffer)
        if result == 0:
            return buffer.value or None
        if result == _APPMODEL_ERROR_NO_APPLICATION:
            return None
        return None
    finally:
        kernel32.CloseHandle(handle)


def _window_class_name(user32: ctypes.WinDLL, hwnd: int) -> str:  # pragma: no cover
    buffer = ctypes.create_unicode_buffer(256)
    user32.GetClassNameW(hwnd, buffer, 256)
    return buffer.value


def resolve_uwp_hosted_pid(frame_hwnd: int, host_pid: int) -> int | None:  # pragma: no cover
    """PID of the app hosted inside an ApplicationFrameHost frame window.

    The hosted app parents a ``Windows.UI.Core.CoreWindow`` under the frame
    window, owned by a different process than the host.
    """
    user32 = _user32()
    found: list[int] = []

    callback_type = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)

    def on_child(child_hwnd: ctypes.c_void_p, _lparam: ctypes.c_void_p) -> bool:
        child = int(ctypes.cast(child_hwnd, ctypes.c_void_p).value or 0)
        if not child:
            return True
        if _window_class_name(user32, child) != _CORE_WINDOW_CLASS:
            return True
        child_pid = ctypes.c_ulong()
        user32.GetWindowThreadProcessId(child, ctypes.byref(child_pid))
        if child_pid.value and child_pid.value != host_pid:
            found.append(child_pid.value)
            return False
        return True

    user32.EnumChildWindows(frame_hwnd, callback_type(on_child), None)
    return found[0] if found else None


def identity_key_for(exe_path: str | None, aumid: str | None) -> str | None:
    """Stable identity carried in the Snapshot ``bundle_id`` field (§4.2)."""
    if aumid:
        return aumid
    if exe_path:
        return exe_path.lower()
    return None


def aumid_display_name(aumid: str) -> str | None:
    """Best-effort readable name from an AUMID (``PackageFamily!AppId``)."""
    package_family, _, app_id = aumid.partition("!")
    package_name = package_family.split("_", 1)[0]
    label = package_name.rsplit(".", 1)[-1] if package_name else None
    if label and label.lower() not in {"app", app_id.lower()}:
        return label
    return app_id or label or None


def build_snapshot(
    window: ForegroundWindow | None,
    identity: ProcessIdentity | None,
    observed_at: str | None = None,
    capture_error: str | None = None,
) -> Snapshot:
    """Assemble the shared Snapshot shape from Windows capture results.

    Pure function so unit tests cover the mapping rules on any platform.
    """
    observed = observed_at or utc_now_iso()
    # A window title (or even an executable basename) cannot identify the
    # owning app when both stable process identifiers are unreadable. Treat it
    # as a failed capture so callers do not show it as live foreground work.
    if (
        window is None
        or identity is None
        or identity_key_for(identity.exe_path, identity.aumid) is None
    ):
        return Snapshot(
            observed_at=observed,
            app_name="Unavailable",
            bundle_id=None,
            window_title=None,
            source="unknown",
            frontmost_capture_source="unavailable",
            frontmost_capture_error=capture_error or (
                "Foreground process identity unavailable."
                if window is not None else "No foreground window available."
            ),
        )

    app_name = None
    if identity.aumid:
        app_name = aumid_display_name(identity.aumid)
    if not app_name:
        app_name = exe_display_name(identity.exe_path) or identity.exe_name
    if not app_name:
        app_name = "Unavailable"

    # GetWindowTextW truncates at _TITLE_MAX UTF-16 units and can split an emoji.
    window_title = replace_lone_surrogates(window.title or "").strip() or None
    return Snapshot(
        observed_at=observed,
        app_name=app_name,
        bundle_id=identity_key_for(identity.exe_path, identity.aumid),
        window_title=window_title,
        source="win32-foreground" if window_title else "win32-foreground-untitled",
        capture_confidence=1.0,
        # Name the mechanism that actually produced this read. Reporting a
        # macOS value here made Windows captures indistinguishable from
        # AppleScript reads in diagnostics, which is the kind of quiet
        # falsehood that survives into support tickets.
        frontmost_capture_source=(
            "uwp-frame-host" if identity.aumid else "win32-foreground"
        ),
        frontmost_capture_error=capture_error,
    )


def _browser_metadata_from_live_uia(
    app_name: str,
    result: WindowsBrowserUiaResult,
) -> BrowserMetadata:
    if not result.url:
        return BrowserMetadata(
            browser_name=app_name,
            browser_automation_status="unavailable",
            browser_automation_error=result.error or "Windows UIA Document URL unavailable.",
        )
    video_id, playlist_id, is_shorts = youtube_ids(result.url)
    return BrowserMetadata(
        browser_name=app_name,
        site_domain=normalize_domain(result.url),
        site_url=result.url,
        youtube_video_id=video_id,
        youtube_playlist_id=playlist_id,
        youtube_is_shorts=is_shorts,
        match_state="windows-uia-document",
        browser_automation_status="granted",
    )


def enrich_browser_snapshot(
    snapshot: Snapshot,
    hwnd: int,
    live_reader: Callable[[int, str | None], WindowsBrowserUiaResult] | None = None,
    bridge_reader: Callable[[str, str | None], BrowserMetadata | None] = read_browser_bridge_metadata,
    *,
    url_timeout_seconds: float = _URL_SAMPLE_BUDGET_SECONDS,
) -> Snapshot:
    """Use a bridge URL only when it matches this foreground window's Document."""
    # Every named Windows browser gets browser_name even when its UIA URL is
    # unavailable, so an automatic close refuses its tab instead of treating
    # the whole browser as an app.
    if not is_windows_browser_app(snapshot.app_name):
        return snapshot

    # Explicit provider injections keep their two-argument contract. Production
    # reads additionally obey the foreground observation's remaining budget.
    live_result = (
        live_reader(hwnd, snapshot.app_name) if live_reader is not None else
        read_browser_url_with_budget(hwnd, snapshot.app_name, timeout_seconds=url_timeout_seconds)
    )
    # A private window is known from the URL reader's own private signal
    # (Firefox family, Vivaldi, Whale) or Edge's "[InPrivate]" title label.
    # Chrome, Brave and Opera expose neither here and are recorded as normal.
    if live_result.privacy_state == "private" or (
        snapshot.window_title and _EDGE_PRIVATE_TITLE_LABEL in snapshot.window_title
    ):
        snapshot.private_window = True
    live = _browser_metadata_from_live_uia(snapshot.app_name, live_result)
    # Opera's measured Document provides its own HWND-local URL. The v1
    # Chromium bridge has no Opera product/HWND binding, so even a same-URL
    # message cannot add trustworthy information about this Opera window.
    bridge = None if snapshot.app_name == "Opera" else bridge_reader(snapshot.app_name, live_result.url)
    # Keep this guard at the caller as well: injected readers and future bridge
    # versions must not bypass the exact HWND-local foreground proof.
    if bridge is not None and bridge.site_url != live_result.url:
        bridge = None
    # A v1 bridge message has no HWND, PID, or product identity. Even after its
    # URL matches this window, another tab at the same URL could supply a
    # different title or other dynamic page data. Derive all page fields from
    # the HWND-local Document; the bridge is only an exact-URL corroboration.
    # Even a normal browser can have multiple pages with the same title. A
    # recent normal-history entry is not proof of this foreground HWND's page,
    # and a failed UIA read cannot reliably distinguish private windows. Keep
    # browser app time and the diagnostic without guessing a site.

    snapshot.browser_name = snapshot.app_name
    snapshot.site_domain = live.site_domain
    snapshot.site_title = live.site_title
    snapshot.site_url = live.site_url
    snapshot.youtube_video_id = live.youtube_video_id
    snapshot.youtube_playlist_id = live.youtube_playlist_id
    snapshot.youtube_is_shorts = live.youtube_is_shorts
    snapshot.site_source = "windows-uia-document" if live.site_url else None
    # An exact URL match is not proof that the v1 bridge sender is this HWND.
    # Its source, confidence, and diagnostics must not replace the live read.
    if live.site_url:
        snapshot.capture_confidence = _LIVE_UIA_CONFIDENCE
    snapshot.browser_automation_status = live.browser_automation_status
    snapshot.browser_automation_error = live.browser_automation_error
    return snapshot


def capture_windows_browser_content(
    snapshot: Snapshot,
    hwnd: int,
    *,
    timeout_seconds: float,
    clue_reader: Callable[[int, str | None, float], WindowsBrowserCluesResult] | None = None,
    describer: Callable[[str, float], str | None] | None = None,
) -> dict[str, object] | None:
    """Bounded visible page clues for this foreground window, or None.

    Only a Document URL read from this exact HWND qualifies; the host inspects
    that same Document once. The clues are bound to the raw window title,
    which must begin with the Document's own name, and are discarded when the
    Content context setting changes during the read. Unavailable optional
    context never affects tracking.

    As on macOS, admitted clues on an HTTPS page may also carry one anonymous
    public description (D) that shares the headings' 240-character budget.
    """
    window_title = snapshot.window_title
    if (os.environ.get("DRIFTY_BROWSER_CONTENT_CONTEXT") != "1" or timeout_seconds <= 0
            or snapshot.site_source != "windows-uia-document" or not snapshot.site_url
            or not window_title or _EDGE_PRIVATE_TITLE_LABEL in window_title
            or content_excluded_url(snapshot.site_url)):
        return None
    policy = policy_snapshot()
    if policy is None:
        return None
    started = time.monotonic()
    result = (
        clue_reader(hwnd, snapshot.app_name, timeout_seconds) if clue_reader is not None
        else read_browser_clues_with_budget(hwnd, snapshot.app_name, timeout_seconds)
    )
    if (result.error or not result.clues or result.url != snapshot.site_url or not result.title
            or not (window_title == result.title or window_title.startswith(result.title + " "))):
        return None
    clues = dict(result.clues)
    description_cap = min(MAX_DESCRIPTION_UTF16,
                          _CLUE_BUDGET_UTF16 - sum(_utf16_length(h) for h in clues.get("headings", [])))
    remaining = timeout_seconds - (time.monotonic() - started) - _DESCRIPTION_RESERVE_SECONDS
    if description_cap > 0 and snapshot.site_url.startswith("https://"):
        text = (describer(snapshot.site_url, remaining) if describer is not None
                else read_public_description_with_budget(snapshot.site_url, remaining))
        description = clip_description(text, description_cap) if isinstance(text, str) else ""
        if description:
            clues["description"] = description
    if policy_snapshot() != policy:
        return None
    return normalize_context({
        "version": 1, "collectedAt": snapshot.observed_at, "pageUrl": snapshot.site_url,
        "pageTitle": window_title, **clues,
    })


def resolve_identity(
    window: ForegroundWindow,
    read_exe_path: Callable[[int], str | None] | None = None,
    read_aumid: Callable[[int], str | None] | None = None,
    resolve_hosted_pid: Callable[[int, int], int | None] | None = None,
    read_window_class: Callable[[int], str] | None = None,
) -> tuple[ProcessIdentity, str | None]:
    """Resolve process identity, unwrapping UWP frame hosts.

    Returns the identity plus an optional diagnostic when a UWP host could not
    be unwrapped (gate W1-G2 requires the host never to pose as the app).
    """
    exe_reader = read_exe_path or read_process_exe_path
    aumid_reader = read_aumid or read_process_aumid
    hosted_resolver = resolve_hosted_pid or resolve_uwp_hosted_pid
    class_reader = read_window_class or (lambda hwnd: _window_class_name(_user32(), hwnd))

    exe_path = exe_reader(window.pid)
    exe_name = exe_display_name(exe_path)
    diagnostic = None

    is_frame_host = bool(exe_path) and exe_path.replace("\\", "/").rsplit("/", 1)[-1].lower() == _APPLICATION_FRAME_HOST
    # The host executable itself can be temporarily unreadable even though
    # its foreground frame and the packaged child process remain accessible.
    # A class name alone is not an app identity: accept this fallback only
    # after the child supplies a packaged AUMID, never as the frame host.
    unreadable_frame_host = (
        exe_path is None and class_reader(window.hwnd) == _APPLICATION_FRAME_WINDOW_CLASS
    )
    if is_frame_host or unreadable_frame_host:
        hosted_pid = hosted_resolver(window.hwnd, window.pid)
        if hosted_pid:
            hosted_exe = exe_reader(hosted_pid)
            hosted_aumid = aumid_reader(hosted_pid)
            if hosted_aumid or (is_frame_host and hosted_exe):
                return (
                    ProcessIdentity(
                        exe_path=hosted_exe,
                        exe_name=exe_display_name(hosted_exe),
                        aumid=hosted_aumid,
                    ),
                    None,
                )
        # W1-G2: never report the frame host as the app identity.
        return (
            ProcessIdentity(exe_path=None, exe_name="unresolved-uwp", aumid=None),
            "ApplicationFrameHost child window did not resolve to a hosted app.",
        )

    aumid = aumid_reader(window.pid)
    return ProcessIdentity(exe_path=exe_path, exe_name=exe_name, aumid=aumid), diagnostic


def _foreground_change_kind(previous: ForegroundWindow, current: ForegroundWindow | None) -> str:
    """Describe a capture race without recording window titles or process IDs."""
    if current is None:
        return "missing"
    if current.hwnd != previous.hwnd:
        return "handle"
    if current.pid != previous.pid:
        return "process"
    if current.title != previous.title:
        return "title"
    return "unknown"


def current_snapshot() -> Snapshot:  # pragma: no cover - composed Win32 boundary
    observed = utc_now_iso()
    if not is_windows():
        return build_snapshot(None, None, observed, "windows_workspace requires Windows.")

    session = process_session_id()
    if session in (None, 0):
        return build_snapshot(
            None,
            None,
            observed,
            "Capture refused: Windows session is unknown or has no interactive desktop.",
        )

    # A tab switch or a new foreground window can race either process identity
    # or the slower browser URL read. Re-sample the *new* foreground once;
    # never reuse the first attempt's identity, title, or URL for that window.
    # URL reads have their own short, single-flight deadline. A late URL becomes
    # app-only context without stalling this observation; the remaining whole
    # capture budget still refuses slow identity capture or a delayed retry.
    capture_started = time.monotonic()
    for attempt in range(2):
        if attempt:
            if time.monotonic() - capture_started > _FOREGROUND_RETRY_BUDGET_SECONDS:
                return failed
            observed = utc_now_iso()
        window = read_foreground_window()
        if window is None:
            failed = build_snapshot(None, None, observed, "GetForegroundWindow returned no window.")
        else:
            identity, diagnostic = resolve_identity(window)
            identity_window = read_foreground_window()
            if identity_window != window:
                failed = build_snapshot(
                    None, None, observed,
                    f"Foreground window changed during identity capture ({_foreground_change_kind(window, identity_window)}).",
                )
            else:
                snapshot = build_snapshot(window, identity, observed, diagnostic)
                if snapshot.frontmost_capture_source == "unavailable":
                    failed = snapshot
                else:
                    remaining = _FOREGROUND_RETRY_BUDGET_SECONDS - (time.monotonic() - capture_started)
                    if remaining < 0:
                        return build_snapshot(None, None, observed, "Foreground capture exceeded time budget.")
                    enriched = enrich_browser_snapshot(
                        snapshot, window.hwnd,
                        url_timeout_seconds=min(
                            _URL_SAMPLE_BUDGET_SECONDS,
                            max(0.0, remaining - _FOREGROUND_CHECK_RESERVE_SECONDS),
                        ),
                    )
                    # Optional page clues use only what is left of this capture's
                    # budget; the final foreground check below still covers them.
                    if os.environ.get("DRIFTY_BROWSER_CONTENT_CONTEXT") == "1" and enriched.site_url:
                        enriched.browser_content_context = capture_windows_browser_content(
                            enriched, window.hwnd,
                            timeout_seconds=(
                                _FOREGROUND_RETRY_BUDGET_SECONDS - (time.monotonic() - capture_started)
                                - _FOREGROUND_CHECK_RESERVE_SECONDS
                            ),
                        )
                    # URL/bridge reads may outlive the observation.
                    # Discard the whole candidate if its context changed.
                    enriched_window = read_foreground_window()
                    if enriched_window == window:
                        # Even a stable HWND/title cannot prove that its tab or
                        # content stayed put during a slow first UIA read. Do
                        # not credit that entire interval to a late result.
                        if time.monotonic() - capture_started > _FOREGROUND_RETRY_BUDGET_SECONDS:
                            return build_snapshot(
                                None, None, observed,
                                "Foreground capture exceeded time budget.",
                            )
                        # Derive bounded metadata only after the final HWND/PID/title
                        # freshness check. No body/UIA text or extra browser read.
                        enriched.adaptive_content_context = adaptive_content_context_for_capture(
                            AdaptiveContextCaptureInput(
                                observed_at=enriched.observed_at,
                                app_name=enriched.app_name,
                                bundle_id=enriched.bundle_id,
                                window_title=enriched.window_title,
                                browser_name=enriched.browser_name,
                                site_domain=enriched.site_domain,
                                site_title=enriched.site_title,
                                site_url=enriched.site_url,
                                allow_local_file_read=False,
                            )
                        )
                        return enriched
                    failed = build_snapshot(
                        None, None, observed,
                        f"Foreground window changed during browser capture ({_foreground_change_kind(window, enriched_window)}).",
                    )
        if attempt:
            return failed
    raise AssertionError("Foreground capture retry exhausted")
