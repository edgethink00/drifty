from __future__ import annotations

from datetime import datetime, timezone
from typing import Final


UTC_Z_SUFFIX: Final = "Z"
UTC_OFFSET_SUFFIX: Final = "+00:00"


def parse_iso_datetime(value: str) -> datetime:
    return datetime.fromisoformat(_normalize_utc_z_suffix(value))


def _normalize_utc_z_suffix(value: str) -> str:
    if value.endswith(UTC_Z_SUFFIX):
        return f"{value[:-len(UTC_Z_SUFFIX)]}{UTC_OFFSET_SUFFIX}"
    return value


def history_ends_after(value: str, bound: str) -> bool:
    """Compare a deletion's lower edge without SQLite's second truncation.

    Legacy offset-free stored timestamps follow SQLite's UTC interpretation;
    requested bounds have already been normalized to an explicit UTC offset.
    """
    try:
        ended = parse_iso_datetime(value)
        start = parse_iso_datetime(bound)
    except (AttributeError, TypeError, ValueError):
        return False
    if ended.tzinfo is None:
        ended = ended.replace(tzinfo=timezone.utc)
    return ended > start
