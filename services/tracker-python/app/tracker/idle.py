from __future__ import annotations

import ctypes
import math
import sys
from collections.abc import Callable

IdleReader = Callable[[], float]

_HID_SYSTEM_STATE = 1
_ANY_INPUT_EVENT_TYPE = 0xFFFFFFFF
_reader: IdleReader | None = None
_reader_initialized = False


def seconds_since_last_input() -> float | None:
    reader = _idle_reader()
    if reader is None:
        return None

    try:
        value = float(reader())
    except Exception:
        return None

    if not math.isfinite(value) or value < 0:
        return None
    return value


def _idle_reader() -> IdleReader | None:
    global _reader, _reader_initialized
    if _reader_initialized:
        return _reader

    _reader = _make_quartz_reader() or _make_ctypes_reader()
    _reader_initialized = True
    return _reader


def _make_quartz_reader() -> IdleReader | None:
    try:
        from Quartz.CoreGraphics import (  # type: ignore[import-not-found]
            CGEventSourceSecondsSinceLastEventType,
            kCGAnyInputEventType,
            kCGEventSourceStateHIDSystemState,
        )
    except Exception:
        return None

    def read() -> float:
        return CGEventSourceSecondsSinceLastEventType(
            kCGEventSourceStateHIDSystemState,
            kCGAnyInputEventType,
        )

    return read


def _make_ctypes_reader() -> IdleReader | None:
    if sys.platform != "darwin":
        return None

    try:
        core_graphics = ctypes.CDLL("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics")
        function = core_graphics.CGEventSourceSecondsSinceLastEventType
    except Exception:
        return None

    function.argtypes = [ctypes.c_int, ctypes.c_uint32]
    function.restype = ctypes.c_double

    def read() -> float:
        return function(_HID_SYSTEM_STATE, _ANY_INPUT_EVENT_TYPE)

    return read
