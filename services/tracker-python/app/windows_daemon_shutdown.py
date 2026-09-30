"""Cooperative Windows daemon stop, bound to one process and database.

Windows SIGTERM calls TerminateProcess, which bypasses Python finally/atexit
cleanup. A daemon-owned event lets the loop retire its URL worker and UIA host
before exiting. Legacy or unresponsive daemons still have a bounded, explicitly
diagnosed force fallback; that fallback does not prove provider cleanup.
"""
from __future__ import annotations

import ctypes
from ctypes import wintypes as W
import hashlib
import os
from pathlib import Path
import signal
import sys
import time
from typing import Callable, Literal


StopResult = Literal["exited", "cooperative", "forced"]
_COOPERATIVE_SECONDS = 2.0
_POLL_SECONDS = 0.05


def _canonical_path(path) -> str:
    return os.path.normcase(str(Path(path).expanduser().resolve()))


def _image_paths(executable: Path, source_runtime: bool) -> set[str]:
    paths = {_canonical_path(executable)}
    executable = executable.expanduser().resolve()
    if not source_runtime or executable.parent.name.casefold() != "scripts" or executable.name.casefold() not in {"python.exe", "pythonw.exe"}:
        return paths
    # Windows venv python.exe can remain as a launcher while its declared base
    # interpreter executes the identical source-daemon command. Admit only the
    # base named by this environment, never an arbitrary python basename.
    try:
        lines = (executable.parent.parent / "pyvenv.cfg").read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError):
        return paths
    homes = [line.partition("=")[2].strip() for line in lines
             if line.partition("=")[0].strip().casefold() == "home" and "=" in line]
    if len(homes) != 1 or not homes[0]:
        return paths
    home = Path(homes[0])
    if not home.is_absolute():
        return paths
    base = home / executable.name
    if base.is_file():
        paths.add(_canonical_path(base))
    return paths


def _event_name(db_path: Path, pid: int, creation_filetime: int) -> str:
    canonical_db = _canonical_path(db_path)
    digest = hashlib.sha256(canonical_db.encode("utf-8")).hexdigest()
    return f"Local\\DriftyTrackerStop-v1-{digest}-{pid}-{creation_filetime:x}"


class _NativeApi:
    def __init__(self) -> None:
        self.k = ctypes.WinDLL("kernel32", use_last_error=True)
        self.a = ctypes.WinDLL("advapi32", use_last_error=True)
        self.k.OpenProcess.argtypes = [W.DWORD, W.BOOL, W.DWORD]
        self.k.OpenProcess.restype = W.HANDLE
        self.k.GetCurrentProcess.restype = W.HANDLE
        self.k.GetProcessId.argtypes = [W.HANDLE]
        self.k.GetProcessId.restype = W.DWORD
        self.k.CloseHandle.argtypes = [W.HANDLE]
        self.k.CloseHandle.restype = W.BOOL
        self.k.WaitForSingleObject.argtypes = [W.HANDLE, W.DWORD]
        self.k.WaitForSingleObject.restype = W.DWORD
        self.k.GetProcessTimes.argtypes = [W.HANDLE] + [ctypes.POINTER(W.FILETIME)] * 4
        self.k.GetProcessTimes.restype = W.BOOL
        self.k.QueryFullProcessImageNameW.argtypes = [W.HANDLE, W.DWORD, W.LPWSTR, ctypes.POINTER(W.DWORD)]
        self.k.QueryFullProcessImageNameW.restype = W.BOOL
        self.k.ProcessIdToSessionId.argtypes = [W.DWORD, ctypes.POINTER(W.DWORD)]
        self.k.ProcessIdToSessionId.restype = W.BOOL
        self.k.CreateEventW.argtypes = [ctypes.c_void_p, W.BOOL, W.BOOL, W.LPCWSTR]
        self.k.CreateEventW.restype = W.HANDLE
        self.k.OpenEventW.argtypes = [W.DWORD, W.BOOL, W.LPCWSTR]
        self.k.OpenEventW.restype = W.HANDLE
        self.k.SetEvent.argtypes = [W.HANDLE]
        self.k.SetEvent.restype = W.BOOL
        self.k.TerminateProcess.argtypes = [W.HANDLE, W.UINT]
        self.k.TerminateProcess.restype = W.BOOL
        self.a.OpenProcessToken.argtypes = [W.HANDLE, W.DWORD, ctypes.POINTER(W.HANDLE)]
        self.a.OpenProcessToken.restype = W.BOOL
        self.a.GetTokenInformation.argtypes = [W.HANDLE, ctypes.c_int, ctypes.c_void_p, W.DWORD, ctypes.POINTER(W.DWORD)]
        self.a.GetTokenInformation.restype = W.BOOL
        self.a.GetLengthSid.argtypes = [ctypes.c_void_p]
        self.a.GetLengthSid.restype = W.DWORD

    def _error(self, operation: str) -> OSError:
        return ctypes.WinError(ctypes.get_last_error(), operation)

    def close(self, handle) -> None:
        if not self.k.CloseHandle(handle):
            raise self._error("Unable to close tracker shutdown handle.")

    def creation(self, handle) -> int:
        fields = [W.FILETIME() for _ in range(4)]
        if not self.k.GetProcessTimes(handle, *[ctypes.byref(f) for f in fields]):
            raise self._error("Unable to read tracker process creation.")
        return (fields[0].dwHighDateTime << 32) | fields[0].dwLowDateTime

    def _sid(self, handle) -> bytes:
        token = W.HANDLE()
        if not self.a.OpenProcessToken(handle, 8, ctypes.byref(token)):
            raise self._error("Unable to read tracker process owner.")
        try:
            size = W.DWORD()
            self.a.GetTokenInformation(token, 1, None, 0, ctypes.byref(size))
            if not size.value:
                raise self._error("Unable to size tracker process owner.")
            buffer = ctypes.create_string_buffer(size.value)
            if not self.a.GetTokenInformation(token, 1, buffer, size, ctypes.byref(size)):
                raise self._error("Unable to read tracker process owner.")
            sid = ctypes.c_void_p.from_buffer(buffer).value
            length = self.a.GetLengthSid(sid)
            if not length:
                raise self._error("Unable to read tracker owner SID.")
            return ctypes.string_at(sid, length)
        finally:
            self.close(token)

    def _session(self, handle) -> int:
        pid = self.k.GetProcessId(handle)
        session = W.DWORD()
        if not pid or not self.k.ProcessIdToSessionId(pid, ctypes.byref(session)):
            raise self._error("Unable to read tracker process session.")
        return session.value

    def validate_process(self, handle, executable: Path, source_runtime: bool = False) -> int:
        size = W.DWORD(32768)
        path = ctypes.create_unicode_buffer(size.value)
        if not self.k.QueryFullProcessImageNameW(handle, 0, path, ctypes.byref(size)):
            raise self._error("Unable to read tracker process executable.")
        if _canonical_path(path.value) not in _image_paths(executable, source_runtime):
            raise PermissionError("Tracker process executable changed; refusing to stop it.")
        current = self.k.GetCurrentProcess()
        if self._sid(handle) != self._sid(current) or self._session(handle) != self._session(current):
            raise PermissionError("Tracker process owner or session differs; refusing to stop it.")
        return self.creation(handle)

    def open_process(self, pid: int):
        # Keep this original process object through both the cooperative wait
        # and fallback. Never reopen a PID that could have been reused.
        handle = self.k.OpenProcess(0x1000 | 0x00100000 | 1, False, pid)
        if not handle and ctypes.get_last_error() != 87:
            raise self._error("Unable to open tracker process for verified stop.")
        return handle

    def wait(self, handle, seconds: float) -> bool:
        result = self.k.WaitForSingleObject(handle, max(0, int(seconds * 1000)))
        if result == 0:
            return True
        if result != 258:
            raise self._error("Unable to confirm tracker shutdown wait.")
        return False

    def create_event(self, name: str):
        ctypes.set_last_error(0)
        handle = self.k.CreateEventW(None, True, False, name)
        if not handle:
            raise self._error("Unable to create tracker shutdown event.")
        if ctypes.get_last_error() == 183:
            self.close(handle)
            raise FileExistsError("Tracker shutdown event already exists; refusing to adopt it.")
        return handle

    def open_event(self, name: str):
        handle = self.k.OpenEventW(2, False, name)
        if not handle and ctypes.get_last_error() != 2:
            raise self._error("Unable to open verified tracker shutdown event.")
        return handle

    def signal(self, handle) -> None:
        if not self.k.SetEvent(handle):
            raise self._error("Unable to request cooperative tracker shutdown.")

    def terminate(self, handle) -> None:
        if not self.k.TerminateProcess(handle, signal.SIGTERM) and not self.wait(handle, 0):
            raise self._error("Unable to force-stop verified tracker process.")


class WindowsDaemonStopEvent:
    def __init__(self, db_path: Path) -> None:
        self._api = _NativeApi()
        self._handle = None
        creation = self._api.creation(self._api.k.GetCurrentProcess())
        self._handle = self._api.create_event(_event_name(db_path, os.getpid(), creation))

    def requested(self) -> bool:
        return self._api.wait(self._handle, 0)

    def wait(self, seconds: float) -> bool:
        return self._api.wait(self._handle, max(0.0, seconds))

    def close(self) -> None:
        handle, self._handle = self._handle, None
        if handle is not None:
            self._api.close(handle)


def stop_windows_tracker_daemon(
    pid: int,
    db_path: Path,
    executable: Path,
    verify_ownership: Callable[[float], bool],
    timeout_seconds: float = 3.0,
    *,
    source_runtime: bool = False,
    deadline: float | None = None,
) -> StopResult:
    started = time.monotonic()
    own_deadline = started + max(0.0, timeout_seconds)
    deadline = own_deadline if deadline is None else min(deadline, own_deadline)
    cooperative_deadline = min(deadline, started + _COOPERATIVE_SECONDS)
    if started >= deadline:
        raise TimeoutError("Tracker daemon stop deadline expired before native binding.")
    api = _NativeApi()
    process = api.open_process(pid)
    if not process:
        return "exited"
    try:
        if api.wait(process, 0):
            return "exited"
        creation = api.validate_process(process, executable, source_runtime)
        if time.monotonic() >= deadline:
            raise TimeoutError("Tracker daemon stop deadline expired before ownership verification.")
        # This command/DB check is deliberately fresh and after native binding.
        # If the original exits during it, only its bound handle is ever used.
        verified = verify_ownership(deadline)
        if api.wait(process, 0):
            return "exited"
        if time.monotonic() >= deadline:
            raise TimeoutError("Tracker daemon stop deadline expired during ownership verification.")
        if not verified:
            raise PermissionError("Unable to verify tracker daemon database; refusing to stop it.")
        name = _event_name(db_path, pid, creation)
        reason = "shutdown event unavailable"
        while time.monotonic() < cooperative_deadline:
            event = api.open_event(name)
            if event:
                try:
                    if api.wait(process, 0):
                        return "exited"
                    if time.monotonic() >= deadline:
                        raise TimeoutError("Tracker daemon stop deadline expired before cooperative signal.")
                    api.signal(event)
                finally:
                    api.close(event)
                if api.wait(process, max(0.0, cooperative_deadline - time.monotonic())):
                    return "cooperative"
                reason = "cooperative shutdown timed out"
                break
            if api.wait(process, min(_POLL_SECONDS, max(0.0, cooperative_deadline - time.monotonic()))):
                return "exited"
        if api.wait(process, 0):
            return "exited"
        # A fallback remains conditional on the exact same fresh command/DB.
        # This recheck shares the original deadline; it never buys another wait.
        if time.monotonic() >= deadline:
            raise TimeoutError("Tracker daemon stop deadline expired before force fallback.")
        verified = verify_ownership(deadline)
        if api.wait(process, 0):
            return "exited"
        if time.monotonic() >= deadline:
            raise TimeoutError("Tracker daemon stop deadline expired before force fallback.")
        if not verified:
            raise PermissionError("Tracker daemon ownership changed before force fallback; refusing to stop it.")
        print(f"tracker Windows daemon force fallback: {reason}; provider cleanup is unconfirmed.", file=sys.stderr)
        api.terminate(process)
        if not api.wait(process, max(0.0, deadline - time.monotonic())):
            raise TimeoutError("Tracker daemon did not exit within the Windows stop deadline.")
        return "forced"
    finally:
        api.close(process)
