"""Pause as the tracker sees it.

The app saves the person's pause next to the tracker database before it asks
the tracker to stop. Capture reads that file itself, so nothing is saved after
a pause even when the stop signal arrives late or fails, and the app can show
the pause at once instead of an error while it retries the stop.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

PAUSE_FILE_NAME = "tracking-pause.json"
LOG_FILE_NAME = "tracking-pause.log"
LOG_MAX_BYTES = 256 * 1024
_PAUSE_FILE_MAX_BYTES = 4096


def pause_file_path(db_path: Path) -> Path:
    return Path(db_path).expanduser().parent / PAUSE_FILE_NAME


def pause_requested(db_path: Path) -> bool:
    """True while a pause is saved. The app treats an unreadable pause as a
    pause until the person resumes, so capture does too."""
    try:
        os.stat(pause_file_path(db_path))
    except (FileNotFoundError, NotADirectoryError):
        return False
    except OSError:
        return True
    return True


def unix_seconds_cutoff(value: Any) -> datetime | None:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        return None
    try:
        return datetime.fromtimestamp(value, timezone.utc)
    except (OverflowError, OSError, ValueError):
        return None


def paused_at(db_path: Path) -> datetime | None:
    """When the saved pause began, or None when it cannot be read."""
    try:
        with open(pause_file_path(db_path), "rb") as pause_file:
            raw = pause_file.read(_PAUSE_FILE_MAX_BYTES + 1)
    except OSError:
        return None
    if len(raw) > _PAUSE_FILE_MAX_BYTES:
        return None
    try:
        data = json.loads(raw)
    except ValueError:
        return None
    if not isinstance(data, dict):
        return None
    return unix_seconds_cutoff(data.get("pausedAtUnixSeconds"))


def record(db_path: Path, event: str, **fields: Any) -> None:
    """Append one line to the local pause log. Never raises.

    The log keeps outcomes and counts only, never activity, so a pause that
    misbehaves can be explained later without guessing.
    """
    try:
        log_path = Path(db_path).expanduser().parent / LOG_FILE_NAME
        try:
            if log_path.stat().st_size > LOG_MAX_BYTES:
                os.replace(log_path, log_path.with_name(LOG_FILE_NAME + ".1"))
        except FileNotFoundError:
            pass
        stamp = datetime.now(timezone.utc).isoformat(timespec="milliseconds")
        details = " ".join(f"{key}={_log_value(value)}" for key, value in fields.items())
        line = f"{stamp} tracker {event}{' ' + details if details else ''}\n"
        with open(log_path, "a", encoding="utf-8") as log_file:
            log_file.write(line)
    except Exception:  # noqa: BLE001 - diagnostics must never affect capture or stop
        pass


def _log_value(value: Any) -> str:
    text = str(value).replace("\n", " ").replace("\r", " ")
    return text[:200]
