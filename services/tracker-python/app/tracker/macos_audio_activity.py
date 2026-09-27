from __future__ import annotations

import ctypes
import re
import subprocess
import sys
import threading
import time
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from typing import Final, Literal


CommandRunner = Callable[[list[str]], str]
AudioProbeReason = Literal[
    "active_output_owned_by_frontmost",
    "coreaudio_unavailable",
    "frontmost_process_unavailable",
    "process_ownership_unavailable",
    "no_active_output",
    "active_output_not_owned_by_frontmost",
]

CORE_AUDIO_FRAMEWORK: Final = "/System/Library/Frameworks/CoreAudio.framework/CoreAudio"
COMMAND_TIMEOUT_SECONDS: Final = 2.0
CORE_AUDIO_PROBE_TIMEOUT_SECONDS: Final = 1.0
FOREGROUND_AUDIO_SAMPLE_TIMEOUT_SECONDS: Final = 4.0
LSAPPINFO_PATH: Final = "/usr/bin/lsappinfo"
PS_PATH: Final = "/bin/ps"
_AUDIO_OBJECT_SYSTEM_OBJECT: Final = 1
_AUDIO_OBJECT_PROPERTY_ELEMENT_MAIN: Final = 0
_CORE_AUDIO_PROBE_LOCK = threading.Lock()


def _fourcc(value: str) -> int:
    if len(value) != 4:
        raise ValueError("CoreAudio property selectors must contain four characters")
    return int.from_bytes(value.encode("ascii"), byteorder="big")


_AUDIO_OBJECT_PROPERTY_SCOPE_GLOBAL: Final = _fourcc("glob")
_AUDIO_HARDWARE_PROPERTY_PROCESS_OBJECT_LIST: Final = _fourcc("prs#")
_AUDIO_PROCESS_PROPERTY_PID: Final = _fourcc("ppid")
_AUDIO_PROCESS_PROPERTY_IS_RUNNING_OUTPUT: Final = _fourcc("piro")


class _AudioObjectPropertyAddress(ctypes.Structure):
    _fields_ = [
        ("selector", ctypes.c_uint32),
        ("scope", ctypes.c_uint32),
        ("element", ctypes.c_uint32),
    ]


@dataclass(frozen=True)
class FrontmostProcess:
    pid: int
    bundle_id: str | None
    bundle_path: str | None
    coalition_pids: frozenset[int] = frozenset()


@dataclass(frozen=True)
class ProcessRow:
    pid: int
    parent_pid: int
    command: str


@dataclass(frozen=True)
class ForegroundAudioSample:
    available: bool
    active: bool
    reason: AudioProbeReason


class CoreAudioProcessReader:
    """Read process-level output state without opening or capturing audio streams."""

    def __init__(self, library: object) -> None:
        self._get_data_size = getattr(library, "AudioObjectGetPropertyDataSize")
        self._get_data = getattr(library, "AudioObjectGetPropertyData")
        self._get_data_size.argtypes = [
            ctypes.c_uint32,
            ctypes.POINTER(_AudioObjectPropertyAddress),
            ctypes.c_uint32,
            ctypes.c_void_p,
            ctypes.POINTER(ctypes.c_uint32),
        ]
        self._get_data_size.restype = ctypes.c_int32
        self._get_data.argtypes = [
            ctypes.c_uint32,
            ctypes.POINTER(_AudioObjectPropertyAddress),
            ctypes.c_uint32,
            ctypes.c_void_p,
            ctypes.POINTER(ctypes.c_uint32),
            ctypes.c_void_p,
        ]
        self._get_data.restype = ctypes.c_int32

    def running_output_process_ids(self) -> frozenset[int]:
        process_ids = self._process_object_ids()
        running: set[int] = set()
        for object_id in process_ids:
            is_running = self._read_uint32(object_id, _AUDIO_PROCESS_PROPERTY_IS_RUNNING_OUTPUT)
            if is_running != 1:
                continue
            pid = self._read_int32(object_id, _AUDIO_PROCESS_PROPERTY_PID)
            if pid is not None and pid > 0:
                running.add(pid)
        return frozenset(running)

    def _process_object_ids(self) -> tuple[int, ...]:
        address = _property_address(_AUDIO_HARDWARE_PROPERTY_PROCESS_OBJECT_LIST)
        data_size = ctypes.c_uint32(0)
        status = self._get_data_size(
            _AUDIO_OBJECT_SYSTEM_OBJECT,
            ctypes.byref(address),
            0,
            None,
            ctypes.byref(data_size),
        )
        if status != 0:
            raise OSError(status, "CoreAudio process list is unavailable")
        if data_size.value == 0:
            return ()

        item_size = ctypes.sizeof(ctypes.c_uint32)
        count = data_size.value // item_size
        if count <= 0 or data_size.value % item_size != 0:
            raise RuntimeError("CoreAudio returned an invalid process list size")
        values = (ctypes.c_uint32 * count)()
        status = self._get_data(
            _AUDIO_OBJECT_SYSTEM_OBJECT,
            ctypes.byref(address),
            0,
            None,
            ctypes.byref(data_size),
            values,
        )
        if status != 0:
            raise OSError(status, "Unable to read the CoreAudio process list")
        return tuple(int(value) for value in values)

    def _read_uint32(self, object_id: int, selector: int) -> int | None:
        value = ctypes.c_uint32(0)
        return self._read_scalar(object_id, selector, value)

    def _read_int32(self, object_id: int, selector: int) -> int | None:
        value = ctypes.c_int32(0)
        return self._read_scalar(object_id, selector, value)

    def _read_scalar(
        self,
        object_id: int,
        selector: int,
        value: ctypes.c_uint32 | ctypes.c_int32,
    ) -> int | None:
        address = _property_address(selector)
        data_size = ctypes.c_uint32(ctypes.sizeof(value))
        status = self._get_data(
            object_id,
            ctypes.byref(address),
            0,
            None,
            ctypes.byref(data_size),
            ctypes.byref(value),
        )
        if status != 0 or data_size.value != ctypes.sizeof(value):
            return None
        return int(value.value)


def _property_address(selector: int) -> _AudioObjectPropertyAddress:
    return _AudioObjectPropertyAddress(
        selector=selector,
        scope=_AUDIO_OBJECT_PROPERTY_SCOPE_GLOBAL,
        element=_AUDIO_OBJECT_PROPERTY_ELEMENT_MAIN,
    )


def _run_command(
    command: list[str],
    *,
    timeout_seconds: float = COMMAND_TIMEOUT_SECONDS,
) -> str:
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
            timeout=timeout_seconds,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise RuntimeError(type(error).__name__) from error
    if result.returncode != 0:
        raise RuntimeError(f"command exited with status {result.returncode}")
    return result.stdout.strip()


def _command_runner_with_deadline(
    run_command: CommandRunner,
    deadline: float,
) -> CommandRunner:
    """Share one wall-clock budget across every helper command in a sample."""

    def run(command: list[str]) -> str:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise RuntimeError("foreground audio command budget exhausted")
        if run_command is _run_command:
            output = _run_command(
                command,
                timeout_seconds=min(COMMAND_TIMEOUT_SECONDS, remaining),
            )
        else:
            # Injected runners are used by deterministic tests. They cannot be
            # interrupted generically, but results that arrive after the shared
            # deadline still fail closed.
            output = run_command(command)
        if time.monotonic() > deadline:
            raise RuntimeError("foreground audio command budget exhausted")
        return output

    return run


def current_frontmost_process(run_command: CommandRunner = _run_command) -> FrontmostProcess | None:
    used_filtered_info = False
    try:
        front = run_command([LSAPPINFO_PATH, "front"])
        if "NULL" in front:
            return None
        asn = front.strip().strip("[]").strip()
        try:
            info = run_command(
                [
                    LSAPPINFO_PATH,
                    "info",
                    asn,
                    "pid",
                    "bundleid",
                    "bundlepath",
                    "coalitionPIDs",
                ]
            )
            used_filtered_info = True
        except RuntimeError:
            # Keep direct-PID and ancestry attribution working on a macOS build
            # whose lsappinfo does not support filtered info keys.
            info = run_command([LSAPPINFO_PATH, "info", asn])
    except RuntimeError:
        return None

    pid_match = re.search(r'(?m)^\s*"?pid"?\s*=\s*(\d+)\b', info)
    if pid_match is None and used_filtered_info:
        try:
            info = run_command([LSAPPINFO_PATH, "info", asn])
        except RuntimeError:
            return None
        pid_match = re.search(r'(?m)^\s*"?pid"?\s*=\s*(\d+)\b', info)
    if not pid_match:
        return None
    bundle_id = _lsappinfo_value(info, "CFBundleIdentifier") or _lsappinfo_value(
        info, "bundleID"
    )
    bundle_path = _lsappinfo_value(info, "LSBundlePath") or _lsappinfo_value(
        info, "bundle path"
    )
    return FrontmostProcess(
        pid=int(pid_match.group(1)),
        bundle_id=bundle_id,
        bundle_path=bundle_path,
        coalition_pids=_lsappinfo_coalition_pids(info),
    )


def process_rows(run_command: CommandRunner = _run_command) -> tuple[ProcessRow, ...] | None:
    try:
        output = run_command([PS_PATH, "-axo", "pid=,ppid=,command="])
    except RuntimeError:
        return None
    rows: list[ProcessRow] = []
    for line in output.splitlines():
        parts = line.strip().split(maxsplit=2)
        if len(parts) < 3:
            continue
        try:
            pid = int(parts[0])
            parent_pid = int(parts[1])
        except ValueError:
            continue
        rows.append(ProcessRow(pid=pid, parent_pid=parent_pid, command=parts[2]))
    return tuple(rows)


def process_is_owned_by_frontmost(
    candidate_pid: int,
    frontmost: FrontmostProcess,
    rows: Iterable[ProcessRow],
) -> bool:
    if candidate_pid == frontmost.pid or candidate_pid in frontmost.coalition_pids:
        return True

    rows_by_pid = {row.pid: row for row in rows}
    visited: set[int] = set()
    cursor = candidate_pid
    while cursor > 1 and cursor not in visited:
        visited.add(cursor)
        row = rows_by_pid.get(cursor)
        if row is None:
            break
        if row.parent_pid == frontmost.pid:
            return True
        cursor = row.parent_pid

    # Safari may launch WebContent/XPC audio clients under launchd rather than
    # under the visible Safari process. Restrict the path fallback to Safari so
    # two independent Chrome profiles sharing one app bundle cannot claim each
    # other's output.
    if frontmost.bundle_id != "com.apple.Safari" or not frontmost.bundle_path:
        return False
    row = rows_by_pid.get(candidate_pid)
    bundle_prefix = f"{frontmost.bundle_path.rstrip('/')}/Contents/"
    return bool(row and row.command.startswith(bundle_prefix))


def foreground_audio_sample(
    *,
    run_command: CommandRunner = _run_command,
    reader_factory: Callable[[], CoreAudioProcessReader | None] | None = None,
    audio_probe_timeout_seconds: float = CORE_AUDIO_PROBE_TIMEOUT_SECONDS,
    sample_timeout_seconds: float = FOREGROUND_AUDIO_SAMPLE_TIMEOUT_SECONDS,
) -> ForegroundAudioSample:
    if sys.platform != "darwin":
        return ForegroundAudioSample(False, False, "coreaudio_unavailable")
    if sample_timeout_seconds <= 0:
        return ForegroundAudioSample(False, False, "coreaudio_unavailable")
    deadline = time.monotonic() + sample_timeout_seconds
    bounded_run_command = _command_runner_with_deadline(run_command, deadline)
    frontmost = current_frontmost_process(bounded_run_command)
    if frontmost is None:
        return ForegroundAudioSample(False, False, "frontmost_process_unavailable")

    factory = reader_factory or _core_audio_reader
    try:
        reader = factory()
        if reader is None:
            return ForegroundAudioSample(False, False, "coreaudio_unavailable")
        output_pids = _running_output_process_ids_with_timeout(
            reader,
            timeout_seconds=min(
                audio_probe_timeout_seconds,
                max(0.0, deadline - time.monotonic()),
            ),
        )
    except (AttributeError, OSError, RuntimeError, TypeError, ValueError):
        return ForegroundAudioSample(False, False, "coreaudio_unavailable")

    if not output_pids:
        return ForegroundAudioSample(True, False, "no_active_output")
    if frontmost.pid in output_pids:
        return ForegroundAudioSample(True, True, "active_output_owned_by_frontmost")
    if output_pids.intersection(frontmost.coalition_pids):
        return ForegroundAudioSample(True, True, "active_output_owned_by_frontmost")
    rows = process_rows(bounded_run_command)
    if rows is None:
        return ForegroundAudioSample(False, False, "process_ownership_unavailable")
    for pid in output_pids:
        if process_is_owned_by_frontmost(pid, frontmost, rows):
            return ForegroundAudioSample(True, True, "active_output_owned_by_frontmost")
    return ForegroundAudioSample(True, False, "active_output_not_owned_by_frontmost")


def _running_output_process_ids_with_timeout(
    reader: CoreAudioProcessReader,
    *,
    timeout_seconds: float,
) -> frozenset[int]:
    """Bound HAL reads while allowing at most one stuck probe per daemon.

    ctypes calls cannot be interrupted safely in-process. A daemon worker lets
    the capture loop fail closed on deadline; the non-blocking lock prevents a
    wedged CoreAudio call from accumulating another worker every sample tick.
    The lock is released if the system call eventually returns.
    """

    if timeout_seconds <= 0:
        raise ValueError("CoreAudio probe timeout must be positive")
    probe_lock = _CORE_AUDIO_PROBE_LOCK
    if not probe_lock.acquire(blocking=False):
        raise TimeoutError("A previous CoreAudio probe is still running")

    completed = threading.Event()
    result: list[frozenset[int]] = []
    errors: list[Exception] = []

    def read_output_processes() -> None:
        try:
            result.append(reader.running_output_process_ids())
        except Exception as error:
            errors.append(error)
        finally:
            probe_lock.release()
            completed.set()

    worker = threading.Thread(
        target=read_output_processes,
        name="drifty-coreaudio-probe",
        daemon=True,
    )
    try:
        worker.start()
    except Exception:
        probe_lock.release()
        raise
    if not completed.wait(timeout_seconds):
        raise TimeoutError("CoreAudio output-state probe timed out")
    if errors:
        raise errors[0]
    if not result:
        raise RuntimeError("CoreAudio probe completed without a result")
    return result[0]


def _core_audio_reader() -> CoreAudioProcessReader | None:
    if sys.platform != "darwin":
        return None
    try:
        library = ctypes.CDLL(CORE_AUDIO_FRAMEWORK)
        return CoreAudioProcessReader(library)
    except (AttributeError, OSError):
        return None


def _lsappinfo_value(info: str, key: str) -> str | None:
    match = re.search(rf'(?m)^\s*"?{re.escape(key)}"?="([^"]*)"\s*$', info)
    if match is None:
        return None
    cleaned = match.group(1).strip()
    return cleaned or None


def _lsappinfo_coalition_pids(info: str) -> frozenset[int]:
    keyed_match = re.search(
        r'(?m)^\s*"?LSApplicationCoalitionPIDsKey"?=\(\s*([^)]*)\)',
        info,
    )
    if keyed_match is not None:
        return frozenset(int(value) for value in re.findall(r"\d+", keyed_match.group(1)))

    summary_match = re.search(r"(?m)^\s*coalition:\s*\d+\s*\{([^}]*)\}", info)
    if summary_match is None:
        return frozenset()
    return frozenset(int(value) for value in re.findall(r"\d+", summary_match.group(1)))
