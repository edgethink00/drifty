"""Bind a Mac app-owned tracker to one process lifetime, not a reusable PID.

The launcher supplies PID plus Unix birth time in integer microseconds. These
are macOS values, not Windows FILETIME. libproc identity checks bracket the
EVFILT_PROC/NOTE_EXIT registration; after admission we only wait on that
retained kernel subscription. No process lookup can reattach it to a reused PID.

ABI source: macOS SDK libproc.h (proc_pidinfo), sys/proc_info.h
(PROC_PIDTBSDINFO and proc_bsdinfo), sys/param.h (MAXCOMLEN), sys/_types.h
(uid_t/gid_t/pid_t). The native test compares this layout against compiled SDK
headers. Python's select module owns the kevent ABI.
"""

from __future__ import annotations

import ctypes
import math
import os
import select
import sys
from contextlib import contextmanager
from typing import Iterator

__all__ = ["MacOSProcessOwner", "macos_process_creation_time", "tracker_app_owner"]

TRACKER_APP_PID_ENV = "DRIFTY_TRACKER_APP_PID"
TRACKER_APP_CREATION_TIME_ENV = "DRIFTY_TRACKER_APP_CREATION_TIME"
_PROC_PIDTBSDINFO = 3
_PROC_FLAG_INEXIT = 4
_MAX_PID = 0x7FFFFFFF  # Darwin pid_t is signed int32_t.
_MAX_CREATION_TIME = 0xFFFFFFFFFFFFFFFF


class _ProcBsdInfo(ctypes.Structure):
    _fields_ = [
        ("pbi_flags", ctypes.c_uint32),
        ("pbi_status", ctypes.c_uint32),
        ("pbi_xstatus", ctypes.c_uint32),
        ("pbi_pid", ctypes.c_uint32),
        ("pbi_ppid", ctypes.c_uint32),
        ("pbi_uid", ctypes.c_uint32),
        ("pbi_gid", ctypes.c_uint32),
        ("pbi_ruid", ctypes.c_uint32),
        ("pbi_rgid", ctypes.c_uint32),
        ("pbi_svuid", ctypes.c_uint32),
        ("pbi_svgid", ctypes.c_uint32),
        ("rfu_1", ctypes.c_uint32),
        ("pbi_comm", ctypes.c_char * 16),
        ("pbi_name", ctypes.c_char * 32),
        ("pbi_nfiles", ctypes.c_uint32),
        ("pbi_pgid", ctypes.c_uint32),
        ("pbi_pjobc", ctypes.c_uint32),
        ("e_tdev", ctypes.c_uint32),
        ("e_tpgid", ctypes.c_uint32),
        ("pbi_nice", ctypes.c_int32),
        ("pbi_start_tvsec", ctypes.c_uint64),
        ("pbi_start_tvusec", ctypes.c_uint64),
    ]


def macos_process_creation_time(pid: int) -> int:
    """Read the native Unix birth timestamp, in integer microseconds.

    A missing, exiting, inaccessible, or partially read process is not a valid
    owner. This helper does not shell out, request TCC, or inspect app contents.
    """
    if sys.platform != "darwin" or not 0 < pid <= _MAX_PID:
        raise RuntimeError("tracker owning app process identity is unavailable")
    try:
        libproc = ctypes.CDLL("/usr/lib/libproc.dylib", use_errno=True)
        libproc.proc_pidinfo.argtypes = (
            ctypes.c_int, ctypes.c_int, ctypes.c_uint64, ctypes.c_void_p, ctypes.c_int
        )
        libproc.proc_pidinfo.restype = ctypes.c_int
        info = _ProcBsdInfo()
        size = ctypes.sizeof(info)
        returned = libproc.proc_pidinfo(pid, _PROC_PIDTBSDINFO, 0, ctypes.byref(info), size)
    except (OSError, AttributeError) as error:
        raise RuntimeError("tracker owning app process identity is unavailable") from error
    if (returned != size or info.pbi_pid != pid or info.pbi_flags & _PROC_FLAG_INEXIT
            or info.pbi_start_tvusec >= 1_000_000):
        raise RuntimeError("tracker owning app process identity is unavailable")
    creation_time = info.pbi_start_tvsec * 1_000_000 + info.pbi_start_tvusec
    if not 0 < creation_time <= _MAX_CREATION_TIME:
        raise RuntimeError("tracker owning app process identity is unavailable")
    return creation_time


class MacOSProcessOwner:
    """One retained exit subscription, used and closed by the daemon thread.

    Exit and failed waits latch permanently. Consuming the one-shot event must
    not make the next is_alive call mistake an empty queue for a live owner.
    """

    def __init__(self, queue) -> None:
        self._queue = queue
        self._exited = False

    def is_alive(self) -> bool:
        return not self.wait_until_exit(0)

    def wait_until_exit(self, seconds: float) -> bool:
        if self._queue is None or self._exited:
            return True
        try:
            timeout = float(seconds)
            if not math.isfinite(timeout):
                raise ValueError("invalid owner wait timeout")
            events = self._queue.control([], 1, max(timeout, 0.0))
        except (OSError, ValueError, OverflowError, TypeError):
            self._exited = True
            return True
        # Only NOTE_EXIT is subscribed. EV_ERROR or any unexpected event also
        # disables capture; none is authority to extend the app's lifetime.
        if events:
            self._exited = True
        return self._exited

    def close(self) -> None:
        queue, self._queue = self._queue, None
        self._exited = True
        if queue is not None:
            queue.close()


def _open_macos_process_owner(pid: int, creation_time: int) -> MacOSProcessOwner:
    if not 0 < pid <= _MAX_PID or not 0 < creation_time <= _MAX_CREATION_TIME:
        raise RuntimeError("tracker owning app process identity is invalid")
    if macos_process_creation_time(pid) != creation_time:
        raise RuntimeError("tracker owning app process identity changed")
    try:
        queue = select.kqueue()
    except (OSError, AttributeError) as error:
        raise RuntimeError("tracker owning app process monitor is unavailable") from error
    owner = MacOSProcessOwner(queue)
    try:
        event = select.kevent(
            pid, filter=select.KQ_FILTER_PROC,
            flags=select.KQ_EV_ADD | select.KQ_EV_ENABLE | select.KQ_EV_ONESHOT,
            fflags=select.KQ_NOTE_EXIT,
        )
        # Collect an exit/error that races registration, instead of discarding
        # it with max_events=0. A post-registration identity read catches a PID
        # replacement between the first read and attaching the kernel knote.
        if queue.control([event], 1, 0):
            raise RuntimeError("tracker owning app process is unavailable")
        if macos_process_creation_time(pid) != creation_time:
            raise RuntimeError("tracker owning app process identity changed")
        if not owner.is_alive():
            raise RuntimeError("tracker owning app process is unavailable")
        return owner
    except BaseException:
        owner.close()
        raise


@contextmanager
def tracker_app_owner() -> Iterator[MacOSProcessOwner | None]:
    """Yield no owner only for a standalone CLI or a non-Mac platform.

    A partial/invalid identity or failed native binding raises before capture.
    The calling daemon checks is_alive before/after capture and uses
    wait_until_exit between samples, as it already does for Windows owners.
    """
    if sys.platform != "darwin":
        yield None
        return
    raw_pid = os.environ.get(TRACKER_APP_PID_ENV)
    raw_creation = os.environ.get(TRACKER_APP_CREATION_TIME_ENV)
    if raw_pid is None and raw_creation is None:
        yield None
        return
    if not all(value and len(value) <= 20 and value.isascii() and value.isdecimal()
               for value in (raw_pid, raw_creation)):
        raise RuntimeError("tracker owning app process identity is invalid")
    pid, creation_time = int(raw_pid), int(raw_creation)
    if not 0 < pid <= _MAX_PID or not 0 < creation_time <= _MAX_CREATION_TIME:
        raise RuntimeError("tracker owning app process identity is invalid")
    owner = _open_macos_process_owner(pid, creation_time)
    try:
        yield owner
    finally:
        owner.close()
