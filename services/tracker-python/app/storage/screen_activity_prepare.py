"""Native opt-in preparation; separate from the always read-only reader.

This entry never initializes a tracker, daemon, account, telemetry or OS
capture. Native code supplies its existing absolute DB path. Fingerprints
check producer compatibility, not account/capture authority.
"""
from __future__ import annotations

import hashlib
import os
import re
import sqlite3
import stat
import sys
import time
from enum import IntEnum
from pathlib import Path

from app.storage.screen_activity_fence import _objects, prepare, read_state

HEADER = b"SBP1"


class Preparation(IntEnum):
    READY = 0
    WRITER_NOT_READY = 1
    MISSING = 2
    UNAVAILABLE = 3


def runtime_fingerprint(app_dir: Path, executable: Path, frozen: bool) -> str:
    # Same bytes/order as main._tracker_runtime_fingerprint. Unlike ordinary
    # tracking, an optional preparation never substitutes an error/stat digest
    # when it cannot read its own runtime.
    digest = hashlib.sha256()
    if frozen:
        digest.update(b"frozen\0")
        digest.update(str(executable).encode("utf-8"))
        digest.update(b"\0")
        with executable.open("rb") as source:
            while block := source.read(128 * 1024):
                digest.update(block)
    else:
        digest.update(b"source\0")
        for source in sorted(p for p in app_dir.rglob("*.py") if "__pycache__" not in p.parts):
            digest.update(str(source.relative_to(app_dir)).encode("utf-8"))
            digest.update(b"\0")
            digest.update(source.read_bytes())
            digest.update(b"\0")
    return digest.hexdigest()


def prepare_existing(path: Path, fingerprint: str) -> Preparation:
    if (not path.is_absolute() or not isinstance(fingerprint, str)
            or re.fullmatch(r"[0-9a-f]{64}", fingerprint) is None):
        return Preparation.UNAVAILABLE
    try:
        metadata = path.lstat()
        if (not stat.S_ISREG(metadata.st_mode) or path.is_symlink()
                or getattr(metadata, "st_file_attributes", 0) & 0x400):
            return Preparation.UNAVAILABLE
        deadline = time.monotonic() + .2
        connection = sqlite3.connect(path.as_uri() + "?mode=rw", uri=True, timeout=.05)
        try:
            connection.execute("PRAGMA busy_timeout=50")
            connection.set_progress_handler(lambda: int(time.monotonic() >= deadline), 1000)
            # Reusing an already valid fence performs no DDL, restarts no
            # tracker and remains possible while tracking is paused. Native
            # capture activation separately verifies its current producer.
            connection.execute("BEGIN")
            if _objects(connection):
                read_state(connection, ())
                connection.rollback()
                return Preparation.READY
            connection.rollback()
            connection.execute("BEGIN IMMEDIATE")
            # Another preparer may have won before our write reservation.
            if _objects(connection):
                read_state(connection, ())
                connection.rollback()
                return Preparation.READY
            producer = connection.execute(
                "SELECT value FROM tracker_meta WHERE key='tracker_runtime_fingerprint'").fetchone()
            if producer is None or producer[0] != fingerprint:
                connection.rollback()
                return Preparation.WRITER_NOT_READY
            prepare(connection)
            if time.monotonic() >= deadline:
                connection.rollback()
                return Preparation.UNAVAILABLE
            connection.commit()
            return Preparation.READY
        finally:
            connection.close()
    except FileNotFoundError:
        return Preparation.MISSING
    except (OSError, sqlite3.Error, ValueError, UnicodeError):
        return Preparation.UNAVAILABLE


def main(arguments: list[str], *, producer_runtime: Path | None = None) -> int:
    if len(arguments) != 2 or arguments[0] != "--db":
        return 2
    try:
        if producer_runtime is not None:
            metadata = producer_runtime.lstat()
            if (not producer_runtime.is_absolute() or not stat.S_ISREG(metadata.st_mode)
                    or producer_runtime.is_symlink()
                    or getattr(metadata, "st_file_attributes", 0) & 0x400):
                raise ValueError("producer_runtime")
        fingerprint = runtime_fingerprint(
            Path(__file__).resolve().parents[1], producer_runtime or Path(sys.executable),
            producer_runtime is not None or bool(getattr(sys, "frozen", False)))
        state = prepare_existing(Path(arguments[1]), fingerprint)
    except (OSError, ValueError, UnicodeError):
        state = Preparation.UNAVAILABLE
    try:
        # Fixed five-byte result only: no paths, IDs, fingerprint, SQL error or
        # generic exception reporter, including on a failed/closed pipe.
        data = HEADER + bytes([state])
        while data:
            used = os.write(1, data)
            if used <= 0:
                return 2
            data = data[used:]
        return 0
    except OSError:
        return 2
