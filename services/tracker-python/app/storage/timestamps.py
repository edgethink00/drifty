from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Final


UTC_Z_SUFFIX: Final = "Z"
UTC_OFFSET_SUFFIX: Final = "+00:00"
# Python before 3.11 accepts only 3- or 6-digit fractional seconds in
# fromisoformat(). PostgreSQL (and so synced rows) trims trailing zeros, which
# yields values such as "...:36.65494+00:00" that the packaged macOS tracker
# would otherwise reject while reading its own timeline.
# Do not pad a partial match before an invalid suffix: newer fromisoformat
# versions can accept trailing junk after an exactly six-digit fraction.
_FRACTIONAL_SECONDS: Final = re.compile(r"(?<=[T ]\d{2}:\d{2}:\d{2})\.(\d+)(?=[+-]|$)")


def parse_iso_datetime(value: str) -> datetime:
    return datetime.fromisoformat(_normalize_fractional_seconds(_normalize_utc_z_suffix(value)))


def _normalize_utc_z_suffix(value: str) -> str:
    if value.endswith(UTC_Z_SUFFIX):
        return f"{value[:-len(UTC_Z_SUFFIX)]}{UTC_OFFSET_SUFFIX}"
    return value


def _normalize_fractional_seconds(value: str) -> str:
    return _FRACTIONAL_SECONDS.sub(lambda match: "." + match.group(1)[:6].ljust(6, "0"), value, count=1)


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
