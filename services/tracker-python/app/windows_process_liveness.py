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
from ctypes import wintypes
from typing import Final

__all__ = ["windows_process_is_alive"]

_PROCESS_QUERY_LIMITED_INFORMATION: Final = 0x1000
_STILL_ACTIVE: Final = 259
_ERROR_INVALID_PARAMETER: Final = 87
_ERROR_ACCESS_DENIED: Final = 5


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

