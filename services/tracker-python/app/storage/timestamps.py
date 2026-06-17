from __future__ import annotations

from datetime import datetime
from typing import Final


UTC_Z_SUFFIX: Final = "Z"
UTC_OFFSET_SUFFIX: Final = "+00:00"


def parse_iso_datetime(value: str) -> datetime:
    return datetime.fromisoformat(_normalize_utc_z_suffix(value))


def _normalize_utc_z_suffix(value: str) -> str:
    if value.endswith(UTC_Z_SUFFIX):
        return f"{value[:-len(UTC_Z_SUFFIX)]}{UTC_OFFSET_SUFFIX}"
    return value
