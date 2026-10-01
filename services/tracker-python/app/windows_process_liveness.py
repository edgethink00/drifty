"""Windows process liveness.

``os.kill(pid, 0)`` is the POSIX liveness idiom and it does not port. Measured
on Windows 11: for a process that has already exited it still returns success
while any handle to it remains open, so a caller sees a dead daemon as alive,
waits out its timeout and reports a failed stop for work that already
succeeded.

``OpenProcess`` with ``PROCESS_QUERY_LIMITED_INFORMATION`` plus
``GetExitCodeProcess`` answers the question directly: a live process reports
``STILL_ACTIVE``, an exited one reports its real exit code even while handles
remain.

One caveat is deliberate rather than incidental. A process that genuinely exits
with code 259 is indistinguishable from a running one through this API. That
is accepted here because the alternative — treating an ambiguous answer as
"exited" — would let the tracker start a second daemon alongside a live one,
and duplicate daemons writing one database is worse than a stop that waits out
its timeout and reports honestly.
"""

from __future__ import annotations

import ctypes
import os
import sys
from contextlib import contextmanager
from ctypes import wintypes
from typing import Final, Iterator

__all__ = ["windows_process_is_alive", "tracker_app_owner"]

_PROCESS_QUERY_LIMITED_INFORMATION: Final = 0x1000
_SYNCHRONIZE: Final = 0x100000
_WAIT_TIMEOUT: Final = 258
_STILL_ACTIVE: Final = 259
_ERROR_INVALID_PARAMETER: Final = 87
_ERROR_ACCESS_DENIED: Final = 5
TRACKER_APP_PID_ENV: Final = "DRIFTY_TRACKER_APP_PID"
TRACKER_APP_CREATION_TIME_ENV: Final = "DRIFTY_TRACKER_APP_CREATION_TIME"


def windows_process_is_alive(pid: int) -> bool:
    """Whether ``pid`` names a process that has not exited."""
    if pid <= 0:
        return False

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.GetExitCodeProcess.argtypes = (wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD))
    kernel32.GetExitCodeProcess.restype = wintypes.BOOL
    kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
    kernel32.CloseHandle.restype = wintypes.BOOL

    handle = kernel32.OpenProcess(_PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not handle:
        error = ctypes.get_last_error()
        # Access denied means the process exists but belongs to someone else;
        # an invalid parameter means no such pid.
        return error == _ERROR_ACCESS_DENIED

    try:
        exit_code = wintypes.DWORD()
        if not kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code)):
            # The handle opened, so the pid is real; an unreadable exit code is
            # treated as still running for the reason given in the module docs.
            return True
        return exit_code.value == _STILL_ACTIVE
    finally:
        kernel32.CloseHandle(handle)


class WindowsProcessOwner:
    """Keep the original owner's process object, even after its PID is reused.

    Waiting on a process handle detects exit without the exit-code-259
    ambiguity of the general daemon liveness probe above. Any failed wait
    disables capture; owner inspection must never extend an app's lifetime.
    """

    def __init__(self, kernel32, handle) -> None:
        self._kernel32 = kernel32
        self._handle = handle

    def is_alive(self) -> bool:
        return not self.wait_until_exit(0)

    def wait_until_exit(self, seconds: float) -> bool:
        if self._handle is None:
            return True
        milliseconds = min(max(int(seconds * 1000), 0), 0xFFFFFFFE)
        return self._kernel32.WaitForSingleObject(self._handle, milliseconds) != _WAIT_TIMEOUT

    def wait_until_exit_or_stop(self, seconds: float, stop_event_handle) -> bool:
        """Wake for app exit or the daemon's cooperative Stop without polling.

        The daemon owns both retained handles throughout this wait. Failed or
        unexpected native results stop capture just like an owner-only wait.
        """
        if self._handle is None or stop_event_handle is None:
            return True
        handles = (wintypes.HANDLE * 2)(self._handle, stop_event_handle)
        milliseconds = min(max(int(seconds * 1000), 0), 0xFFFFFFFE)
        return self._kernel32.WaitForMultipleObjects(2, handles, False, milliseconds) != _WAIT_TIMEOUT

    def close(self) -> None:
        if self._handle is not None:
            self._kernel32.CloseHandle(self._handle)
            self._handle = None


def _open_windows_process_owner(pid: int, creation_time: int) -> WindowsProcessOwner:
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.GetProcessTimes.argtypes = (wintypes.HANDLE,) + (ctypes.POINTER(wintypes.FILETIME),) * 4
    kernel32.GetProcessTimes.restype = wintypes.BOOL
    kernel32.WaitForSingleObject.argtypes = (wintypes.HANDLE, wintypes.DWORD)
    kernel32.WaitForSingleObject.restype = wintypes.DWORD
    kernel32.WaitForMultipleObjects.argtypes = (
        wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE), wintypes.BOOL, wintypes.DWORD
    )
    kernel32.WaitForMultipleObjects.restype = wintypes.DWORD
    kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
    kernel32.CloseHandle.restype = wintypes.BOOL

    handle = kernel32.OpenProcess(_PROCESS_QUERY_LIMITED_INFORMATION | _SYNCHRONIZE, False, pid)
    if not handle:
        raise RuntimeError("tracker owning app process is unavailable")
    try:
        created, exited, kernel, user = (wintypes.FILETIME() for _ in range(4))
        if not kernel32.GetProcessTimes(
            handle, ctypes.byref(created), ctypes.byref(exited), ctypes.byref(kernel), ctypes.byref(user)
        ):
            raise RuntimeError("tracker owning app process identity is unavailable")
        observed_creation_time = (created.dwHighDateTime << 32) | created.dwLowDateTime
        if observed_creation_time != creation_time:
            raise RuntimeError("tracker owning app process identity changed")
        return WindowsProcessOwner(kernel32, handle)
    except BaseException:
        kernel32.CloseHandle(handle)
        raise


@contextmanager
def tracker_app_owner() -> Iterator[WindowsProcessOwner | None]:
    """App-launched Windows daemons stop with that exact app process.

    The Rust launcher supplies both fields for serve and one-shot commands;
    their detached daemon inherits them. An unowned standalone CLI daemon
    retains its existing lifetime. Partial or invalid ownership fails closed.
    """
    if sys.platform != "win32":
        yield None
        return
    raw_pid = os.environ.get(TRACKER_APP_PID_ENV)
    raw_creation = os.environ.get(TRACKER_APP_CREATION_TIME_ENV)
    if raw_pid is None and raw_creation is None:
        yield None
        return
    if not all(value and value.isascii() and value.isdecimal() for value in (raw_pid, raw_creation)):
        raise RuntimeError("tracker owning app process identity is invalid")
    pid, creation_time = int(raw_pid), int(raw_creation)
    if not 0 < pid <= 0xFFFFFFFF or not 0 < creation_time <= 0xFFFFFFFFFFFFFFFF:
        raise RuntimeError("tracker owning app process identity is invalid")
    owner = _open_windows_process_owner(pid, creation_time)
    try:
        yield owner
    finally:
        owner.close()
