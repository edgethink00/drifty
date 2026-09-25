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

Allowlisted Chromium browser URLs are read from the focused window's top-level
Document ValuePattern through a resident UI Automation host. An exact extension
bridge takes precedence; verified browser history is a separately labeled,
conservative fallback, including for Firefox without bridge context.
"""

from __future__ import annotations

import ctypes
import ntpath
import os
import sys
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Callable

from app.tracker.browser_automation import BrowserMetadata, normalize_domain, youtube_ids
from app.tracker.browser_history import browser_history_metadata, is_browser_history_supported_app
from app.tracker.capture_contract import Snapshot, utc_now_iso
from app.tracker.windows_app_names import exe_display_name, is_windows_browser_app
from app.tracker.windows_browser_uia import WindowsBrowserUiaResult, read_live_browser_url
from app.tracker.windows_browser_bridge import read_browser_bridge_metadata


_APPLICATION_FRAME_HOST = "applicationframehost.exe"
_CORE_WINDOW_CLASS = "Windows.UI.Core.CoreWindow"
_TITLE_MAX = 512
_AUMID_MAX = 1024
_PATH_MAX = 32767

_PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
_APPMODEL_ERROR_NO_APPLICATION = 15703
_LIVE_UIA_CONFIDENCE = 0.8
_HISTORY_FALLBACK_CONFIDENCE = 0.45

_VERIFIED_HISTORY_BROWSER_PATHS: dict[str, tuple[tuple[str, str], ...]] = {
    "Google Chrome": (
        ("PROGRAMFILES", r"Google\Chrome\Application\chrome.exe"),
        ("PROGRAMFILES(X86)", r"Google\Chrome\Application\chrome.exe"),
        ("LOCALAPPDATA", r"Google\Chrome\Application\chrome.exe"),
    ),
    "Google Chrome Beta": (
        ("PROGRAMFILES", r"Google\Chrome Beta\Application\chrome.exe"),
        ("PROGRAMFILES(X86)", r"Google\Chrome Beta\Application\chrome.exe"),
        ("LOCALAPPDATA", r"Google\Chrome Beta\Application\chrome.exe"),
    ),
    "Google Chrome Dev": (
        ("PROGRAMFILES", r"Google\Chrome Dev\Application\chrome.exe"),
        ("PROGRAMFILES(X86)", r"Google\Chrome Dev\Application\chrome.exe"),
        ("LOCALAPPDATA", r"Google\Chrome Dev\Application\chrome.exe"),
    ),
    "Google Chrome Canary": (
        ("LOCALAPPDATA", r"Google\Chrome SxS\Application\chrome.exe"),
    ),
    "Microsoft Edge": (
        ("PROGRAMFILES", r"Microsoft\Edge\Application\msedge.exe"),
        ("PROGRAMFILES(X86)", r"Microsoft\Edge\Application\msedge.exe"),
        ("LOCALAPPDATA", r"Microsoft\Edge\Application\msedge.exe"),
    ),
    "Brave Browser": (
        ("PROGRAMFILES", r"BraveSoftware\Brave-Browser\Application\brave.exe"),
        ("PROGRAMFILES(X86)", r"BraveSoftware\Brave-Browser\Application\brave.exe"),
        ("LOCALAPPDATA", r"BraveSoftware\Brave-Browser\Application\brave.exe"),
    ),
    "Firefox": (
        ("PROGRAMFILES", r"Mozilla Firefox\firefox.exe"),
        ("PROGRAMFILES(X86)", r"Mozilla Firefox\firefox.exe"),
        ("LOCALAPPDATA", r"Mozilla Firefox\firefox.exe"),
    ),
}


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


def is_verified_browser_history_identity(
    app_name: str,
    bundle_id: str | None,
    environment: Mapping[str, str] | None = None,
) -> bool:
    """Allow cross-process history reads only for a known browser install.

    Live UIA remains HWND-local and works for portable browsers. History is a
    separate process/profile boundary, so a basename such as ``chrome.exe`` is
    not sufficient proof that the foreground executable owns Chrome's profile.
    """
    if not bundle_id or not ntpath.isabs(bundle_id):
        return False
    relative_paths = _VERIFIED_HISTORY_BROWSER_PATHS.get(app_name)
    if not relative_paths:
        return False
    values = os.environ if environment is None else environment
    actual = ntpath.normcase(ntpath.normpath(bundle_id))
    for root_name, relative_path in relative_paths:
        root = values.get(root_name)
        if not root:
            continue
        expected = ntpath.normcase(ntpath.normpath(ntpath.join(root, relative_path)))
        if actual == expected:
            return True
    return False


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
    if window is None or identity is None:
        return Snapshot(
            observed_at=observed,
            app_name="Unavailable",
            bundle_id=None,
            window_title=None,
            source="unknown",
            frontmost_capture_source="unavailable",
            frontmost_capture_error=capture_error or "No foreground window available.",
        )

    app_name = None
    if identity.aumid:
        app_name = aumid_display_name(identity.aumid)
    if not app_name:
        app_name = exe_display_name(identity.exe_path) or identity.exe_name
    if not app_name:
        app_name = "Unavailable"

    window_title = (window.title or "").strip() or None
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
    live_reader: Callable[[int, str | None], WindowsBrowserUiaResult] = read_live_browser_url,
    history_reader: Callable[[str | None, str | None, str | None], BrowserMetadata] = browser_history_metadata,
    history_identity_checker: Callable[[str, str | None], bool] = is_verified_browser_history_identity,
    bridge_reader: Callable[[str], BrowserMetadata | None] = read_browser_bridge_metadata,
) -> Snapshot:
    """Attach exact bridge context, then UIA, then conservative history."""
    # A browser without a history root is still a browser: it gets
    # browser_name, so an automatic close refuses its tab instead of treating
    # the whole browser as an app. Its live and history readers stay off.
    if not (is_browser_history_supported_app(snapshot.app_name) or is_windows_browser_app(snapshot.app_name)):
        return snapshot

    bridge = bridge_reader(snapshot.app_name)
    live = BrowserMetadata(browser_name=snapshot.app_name)
    history = None
    metadata = bridge or live
    if bridge is None:
        live = _browser_metadata_from_live_uia(snapshot.app_name, live_reader(hwnd, snapshot.app_name))
        metadata = live
    if bridge is None and not live.site_url and history_identity_checker(snapshot.app_name, snapshot.bundle_id):
        history = history_reader(snapshot.app_name, snapshot.window_title, snapshot.observed_at)
        if history.site_url:
            metadata = history

    snapshot.browser_name = snapshot.app_name
    snapshot.site_domain = metadata.site_domain
    snapshot.site_title = metadata.site_title
    snapshot.site_url = metadata.site_url
    snapshot.youtube_video_id = metadata.youtube_video_id
    snapshot.youtube_playlist_id = metadata.youtube_playlist_id
    snapshot.youtube_is_shorts = metadata.youtube_is_shorts
    snapshot.site_source = (
        "browser-extension"
        if bridge is not None
        else "windows-uia-document"
        if live.site_url
        else "browser-history-title"
        if metadata.site_url
        else None
    )
    if bridge is not None:
        snapshot.capture_confidence = 1.0
    elif live.site_url:
        snapshot.capture_confidence = _LIVE_UIA_CONFIDENCE
    elif metadata.site_url:
        snapshot.capture_confidence = _HISTORY_FALLBACK_CONFIDENCE
    diagnostic_metadata = bridge if bridge is not None else live
    snapshot.browser_automation_status = diagnostic_metadata.browser_automation_status
    snapshot.browser_automation_error = diagnostic_metadata.browser_automation_error
    if history is not None:
        snapshot.browser_history_status = history.browser_history_status
        snapshot.browser_history_reason = history.browser_history_reason
        snapshot.browser_history_database_found = history.browser_history_database_found
        snapshot.browser_history_profile_count = history.browser_history_profile_count
        snapshot.browser_history_candidate_count = history.browser_history_candidate_count
        snapshot.browser_history_error_count = history.browser_history_error_count
    return snapshot


def resolve_identity(
    window: ForegroundWindow,
    read_exe_path: Callable[[int], str | None] | None = None,
    read_aumid: Callable[[int], str | None] | None = None,
    resolve_hosted_pid: Callable[[int, int], int | None] | None = None,
) -> tuple[ProcessIdentity, str | None]:
    """Resolve process identity, unwrapping UWP frame hosts.

    Returns the identity plus an optional diagnostic when a UWP host could not
    be unwrapped (gate W1-G2 requires the host never to pose as the app).
    """
    exe_reader = read_exe_path or read_process_exe_path
    aumid_reader = read_aumid or read_process_aumid
    hosted_resolver = resolve_hosted_pid or resolve_uwp_hosted_pid

    exe_path = exe_reader(window.pid)
    exe_name = exe_display_name(exe_path)
    diagnostic = None

    is_frame_host = bool(exe_path) and exe_path.replace("\\", "/").rsplit("/", 1)[-1].lower() == _APPLICATION_FRAME_HOST
    if is_frame_host:
        hosted_pid = hosted_resolver(window.hwnd, window.pid)
        if hosted_pid:
            hosted_exe = exe_reader(hosted_pid)
            hosted_aumid = aumid_reader(hosted_pid)
            if hosted_exe or hosted_aumid:
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

    window = read_foreground_window()
    if window is None:
        return build_snapshot(None, None, observed, "GetForegroundWindow returned no window.")

    identity, diagnostic = resolve_identity(window)
    if read_foreground_window() != window:
        return build_snapshot(
            None, None, observed, "Foreground window changed during identity capture."
        )
    snapshot = build_snapshot(window, identity, observed, diagnostic)
    enriched = enrich_browser_snapshot(snapshot, window.hwnd)
    # URL/bridge/history reads may outlive the original foreground observation.
    # Never combine an earlier title/process with later browser metadata. This
    # detects observed changes; it does not make UIA or tab navigation atomic.
    if read_foreground_window() != window:
        return build_snapshot(
            None, None, observed, "Foreground window changed during browser capture."
        )
    return enriched
