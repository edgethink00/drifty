"""Windows idle detection (design doc §4.4).

``GetLastInputInfo`` reports the tick of the last input as a 32-bit value while
``GetTickCount64`` is 64-bit, so the subtraction must be done in 32-bit space to
survive the ~49.7-day wraparound. ``GetTickCount64`` also keeps counting across
standby, so a wake inflates idle; callers get an explicit sleep-gap signal
instead of a stretched idle number (Drifty never synthesizes activity across a
gap).
"""

from __future__ import annotations

import ctypes
import sys
from dataclasses import dataclass

_UINT32_MODULO = 1 << 32


class _LastInputInfo(ctypes.Structure):
    _fields_ = [("cbSize", ctypes.c_uint), ("dwTime", ctypes.c_uint)]


@dataclass(frozen=True)
class IdleSample:
    idle_seconds: float | None
    available: bool
    reason: str | None = None


def idle_seconds_from_ticks(last_input_tick: int, current_tick: int) -> float:
    """Idle seconds from raw ticks, correct across 32-bit wraparound.

    ``current_tick`` may be the 64-bit tick count; only its low 32 bits are
    comparable with ``last_input_tick``.
    """
    low_current = current_tick % _UINT32_MODULO
    delta = (low_current - (last_input_tick % _UINT32_MODULO)) % _UINT32_MODULO
    return delta / 1000.0


def is_sleep_gap(elapsed_wall_seconds: float, expected_interval_seconds: float) -> bool:
    """True when wall-clock advanced far past the sampling interval.

    A standby/hibernate window shows up as a large wall-clock jump between two
    ticks; the caller records an honest gap rather than trusting idle math.
    """
    if expected_interval_seconds <= 0:
        return False
    return elapsed_wall_seconds > (expected_interval_seconds * 2)


def read_idle_sample() -> IdleSample:  # pragma: no cover - Win32 boundary
    if sys.platform != "win32":
        return IdleSample(None, False, "windows_idle requires Windows")
    info = _LastInputInfo()
    info.cbSize = ctypes.sizeof(_LastInputInfo)
    if not ctypes.windll.user32.GetLastInputInfo(ctypes.byref(info)):
        return IdleSample(None, False, "GetLastInputInfo failed")
    current = ctypes.windll.kernel32.GetTickCount64()
    return IdleSample(idle_seconds_from_ticks(info.dwTime, current), True, None)
