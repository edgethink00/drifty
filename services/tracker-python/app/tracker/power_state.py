from __future__ import annotations

import ctypes
import platform
import subprocess
from dataclasses import dataclass, field
from datetime import datetime, timezone
from functools import lru_cache


@dataclass(frozen=True)
class PowerStateSample:
    observed_at: datetime
    should_capture: bool
    reason: str
    metadata: dict[str, str] = field(default_factory=dict)


NON_USER_VISIBLE_WAKE_TYPES = {
    "dark",
    "darkwake",
    "maintenance",
    "maintenancewake",
    "sleepservice",
    "sleepservicewake",
}


# Copy one root-domain snapshot per sample; never cache the power values.
_POWER_KEYS = (
    "Wake Type", "WakeType", "IOPMRootDomainWakeType",
    "IOPMUserIsActive", "AppleClamshellState", "AppleClamshellCausesSleep",
)
_CF_UTF8 = 0x08000100


class _IOKitPowerReader:
    def __init__(self) -> None:
        self.io = ctypes.CDLL("/System/Library/Frameworks/IOKit.framework/IOKit")
        self.cf = ctypes.CDLL("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation")
        signatures = (
            (self.io, "IOServiceNameMatching", [ctypes.c_char_p], ctypes.c_void_p),
            (self.io, "IOServiceGetMatchingService", [ctypes.c_uint32, ctypes.c_void_p], ctypes.c_uint32),
            (self.io, "IORegistryEntryCreateCFProperties", [
                ctypes.c_uint32, ctypes.POINTER(ctypes.c_void_p), ctypes.c_void_p, ctypes.c_uint32,
            ], ctypes.c_int32),
            (self.io, "IOObjectRelease", [ctypes.c_uint32], ctypes.c_int32),
            (self.cf, "CFRelease", [ctypes.c_void_p], None),
            (self.cf, "CFStringCreateWithCString", [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_uint32], ctypes.c_void_p),
            (self.cf, "CFDictionaryGetValue", [ctypes.c_void_p, ctypes.c_void_p], ctypes.c_void_p),
            (self.cf, "CFGetTypeID", [ctypes.c_void_p], ctypes.c_ulong),
            (self.cf, "CFBooleanGetTypeID", [], ctypes.c_ulong),
            (self.cf, "CFBooleanGetValue", [ctypes.c_void_p], ctypes.c_ubyte),
            (self.cf, "CFStringGetTypeID", [], ctypes.c_ulong),
            (self.cf, "CFStringGetLength", [ctypes.c_void_p], ctypes.c_long),
            (self.cf, "CFStringGetMaximumSizeForEncoding", [ctypes.c_long, ctypes.c_uint32], ctypes.c_long),
            (self.cf, "CFStringGetCString", [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_long, ctypes.c_uint32], ctypes.c_ubyte),
        )
        for library, name, args, result in signatures:
            function = getattr(library, name)
            function.argtypes = args
            function.restype = result

    def read(self) -> dict[str, str] | None:
        matching = self.io.IOServiceNameMatching(b"IOPMrootDomain")
        if not matching:
            return None
        # GetMatchingService consumes the matching dictionary even on failure.
        entry = self.io.IOServiceGetMatchingService(0, matching)
        if not entry:
            return None
        properties = ctypes.c_void_p()
        try:
            if self.io.IORegistryEntryCreateCFProperties(entry, ctypes.byref(properties), None, 0) != 0:
                return None
            if not properties.value:
                return None
            values: dict[str, str] = {}
            for name in _POWER_KEYS:
                key = self.cf.CFStringCreateWithCString(None, name.encode("utf-8"), _CF_UTF8)
                if not key:
                    return None
                try:
                    value = self.cf.CFDictionaryGetValue(properties, key)
                    if not value:
                        continue
                    kind = self.cf.CFGetTypeID(value)
                    if kind == self.cf.CFBooleanGetTypeID():
                        values[name] = "Yes" if self.cf.CFBooleanGetValue(value) else "No"
                    elif kind == self.cf.CFStringGetTypeID():
                        length = self.cf.CFStringGetMaximumSizeForEncoding(self.cf.CFStringGetLength(value), _CF_UTF8)
                        if length < 0:
                            return None
                        buffer = ctypes.create_string_buffer(length + 1)
                        if not self.cf.CFStringGetCString(value, buffer, len(buffer), _CF_UTF8):
                            return None
                        values[name] = buffer.value.decode("utf-8")
                    else:
                        # An unexpected representation must use the legacy probe.
                        return None
                finally:
                    self.cf.CFRelease(key)
            return values or None
        finally:
            if properties.value:
                self.cf.CFRelease(properties)
            self.io.IOObjectRelease(entry)


@lru_cache(maxsize=1)
def _native_power_reader() -> _IOKitPowerReader:
    return _IOKitPowerReader()


def _read_native_power_state() -> dict[str, str] | None:
    try:
        return _native_power_reader().read()
    except (OSError, AttributeError, ValueError):
        return None


def current_power_state() -> PowerStateSample:
    observed_at = datetime.now(timezone.utc)
    if platform.system() != "Darwin":
        return PowerStateSample(
            observed_at=observed_at,
            should_capture=True,
            reason="non_darwin_power_state_unavailable",
        )

    metadata = _read_native_power_state()
    if metadata is not None:
        return evaluate_power_state(metadata, observed_at=observed_at)

    try:
        result = subprocess.run(
            ["ioreg", "-r", "-n", "IOPMrootDomain", "-d", "1"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=2,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return PowerStateSample(
            observed_at=observed_at,
            should_capture=True,
            reason="power_state_probe_failed",
            metadata={"error": type(exc).__name__},
        )

    if result.returncode != 0:
        return PowerStateSample(
            observed_at=observed_at,
            should_capture=True,
            reason="power_state_probe_unavailable",
            metadata={"returncode": str(result.returncode)},
        )

    return evaluate_ioreg_power_state(result.stdout, observed_at=observed_at)


def evaluate_ioreg_power_state(output: str, observed_at: datetime | None = None) -> PowerStateSample:
    return evaluate_power_state(parse_ioreg_root_domain(output), observed_at=observed_at)


def evaluate_power_state(metadata: dict[str, str], observed_at: datetime | None = None) -> PowerStateSample:
    sample_time = observed_at or datetime.now(timezone.utc)
    if not metadata:
        return PowerStateSample(
            observed_at=sample_time,
            should_capture=True,
            reason="power_state_unknown",
        )

    wake_type = _normalized(
        metadata.get("Wake Type")
        or metadata.get("WakeType")
        or metadata.get("IOPMRootDomainWakeType")
    )
    if wake_type in NON_USER_VISIBLE_WAKE_TYPES:
        return PowerStateSample(
            observed_at=sample_time,
            should_capture=False,
            reason=f"non_user_visible_wake_type:{wake_type}",
            metadata=metadata,
        )

    # A visible user session can remain active with the lid closed in external-display mode.
    user_is_active = _normalized(metadata.get("IOPMUserIsActive")) == "yes"
    if user_is_active:
        return PowerStateSample(
            observed_at=sample_time,
            should_capture=True,
            reason="active_power_state",
            metadata=metadata,
        )

    clamshell_closed = _normalized(metadata.get("AppleClamshellState")) == "yes"
    clamshell_causes_sleep = _normalized(metadata.get("AppleClamshellCausesSleep")) == "yes"
    if clamshell_closed and clamshell_causes_sleep:
        return PowerStateSample(
            observed_at=sample_time,
            should_capture=False,
            reason="clamshell_sleep_state",
            metadata=metadata,
        )

    return PowerStateSample(
        observed_at=sample_time,
        should_capture=True,
        reason="active_power_state",
        metadata=metadata,
    )


def parse_ioreg_root_domain(output: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in output.splitlines():
        line = raw_line.strip()
        quote_index = line.find('"')
        if quote_index == -1:
            continue
        line = line[quote_index:]
        if not line.startswith('"') or '" =' not in line:
            continue
        key, raw_value = line.split("=", 1)
        values[key.strip().strip('"')] = raw_value.strip().strip('"')
    return values


def _normalized(value: str | None) -> str:
    return "" if value is None else value.replace(" ", "").lower()
