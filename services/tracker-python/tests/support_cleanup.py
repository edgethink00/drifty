"""Shared teardown helpers for tests that build databases in temp directories.

``TrackerDatabase`` holds one long-lived SQLite connection per instance, so a
test that drops the reference without closing it leaves the file open. On
macOS that is invisible: the unlink succeeds while the handle is open. Windows
refuses to delete an in-use file, so the same test fails in
``TemporaryDirectory.cleanup`` with WinError 32 rather than in the assertion
it was written for.

Rather than mask the difference, tests close what they opened. That is the
behavior the shipped daemon already follows, and it makes the temp directory
cleanup honest on both platforms.
"""

from __future__ import annotations

import gc
from contextlib import contextmanager
from tempfile import TemporaryDirectory


def close_tracker_databases() -> None:
    """Close every live ``TrackerDatabase`` connection.

    Tests construct databases in helpers and local variables as well as on
    ``self``, so a name-based teardown would miss some. Sweeping the object
    graph closes them all without each test having to track its instances.
    """
    from app.storage.db import TrackerDatabase

    for candidate in gc.get_objects():
        if isinstance(candidate, TrackerDatabase):
            try:
                candidate.close()
            except Exception:  # noqa: BLE001 - teardown must not mask failures
                pass


def cleanup_temp_dir(tempdir) -> None:
    """Close open databases, then remove ``tempdir``."""
    close_tracker_databases()
    gc.collect()
    tempdir.cleanup()


@contextmanager
def temp_dir_closing_databases():
    """``TemporaryDirectory`` that closes tracker databases before removal.

    Drop-in replacement for ``with TemporaryDirectory() as tempdir`` in tests
    that open a database inside the block.
    """
    tempdir = TemporaryDirectory()
    try:
        yield tempdir.name
    finally:
        cleanup_temp_dir(tempdir)
