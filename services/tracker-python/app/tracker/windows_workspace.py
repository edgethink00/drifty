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

Browser URL capture is deliberately absent here: it is workstream W2 (UIA /
history fallback) and lands behind the same ``Snapshot`` fields later.
"""

from __future__ import annotations

import ctypes
import sys
from dataclasses import dataclass
from typing import Callable

from app.tracker.capture_contract import Snapshot, utc_now_iso


_APPLICATION_FRAME_HOST = "applicationframehost.exe"
_CORE_WINDOW_CLASS = "Windows.UI.Core.CoreWindow"
_TITLE_MAX = 512
_AUMID_MAX = 1024
_PATH_MAX = 32767

_PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
_APPMODEL_ERROR_NO_APPLICATION = 15703


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


def exe_display_name(exe_path: str | None) -> str | None:
    if not exe_path:
        return None
    name = exe_path.replace("\\", "/").rsplit("/", 1)[-1]
    if name.lower().endswith(".exe"):
        name = name[: -len(".exe")]
    return name or None


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
    if session == 0:
        return build_snapshot(
            None,
            None,
            observed,
            "Capture refused: session 0 has no interactive desktop.",
        )

    window = read_foreground_window()
    if window is None:
        return build_snapshot(None, None, observed, "GetForegroundWindow returned no window.")

    identity, diagnostic = resolve_identity(window)
    return build_snapshot(window, identity, observed, diagnostic)
