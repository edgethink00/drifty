"""Cross-platform advisory file locking for tracker lifecycle and maintenance.

The tracker serializes four things with file locks: daemon ownership, PID
record edits, lifecycle start/stop, and database maintenance. All four use the
same three operations, so this module exposes exactly those three and nothing
more.

Platform mapping:

* Unix uses ``fcntl.flock``, unchanged from the original implementation.
* Windows uses ``msvcrt.locking``, which is the stdlib byte-range lock. Two
  differences matter and are handled here rather than at each call site:

  1. ``msvcrt.locking`` locks a byte range from the current file position, not
     the whole file, so every operation seeks to 0 and locks one byte. Peers
     only need a shared rendezvous byte, never file contents, so a one-byte
     range is a complete lock for this purpose.
  2. ``LK_LOCK`` retries for ~10 seconds and then raises rather than blocking
     forever, so the blocking helper loops until it wins.

Both backends are advisory and process-scoped: a lock is released when the
holder unlocks or its handle closes, including on abrupt termination.
"""

from __future__ import annotations

import sys
import time
from contextlib import contextmanager
from typing import IO

__all__ = ["lock_exclusive", "lock_exclusive_nonblocking", "unlock", "exclusive_lock"]

_WINDOWS = sys.platform == "win32"

if _WINDOWS:
    import msvcrt
else:
    import fcntl

# One byte is enough: peers rendezvous on the lock, never on file contents.
_LOCK_BYTES = 1
# msvcrt.LK_LOCK gives up after roughly ten seconds; the blocking helper keeps
# retrying so callers get flock-style "wait until acquired" semantics.
_WINDOWS_RETRY_SECONDS = 0.05


def _seek_to_lock_region(handle: IO) -> None:
    handle.seek(0)


def lock_exclusive(handle: IO) -> None:
    """Take an exclusive lock, waiting as long as necessary."""
    if not _WINDOWS:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        return
    while True:
        _seek_to_lock_region(handle)
        try:
            msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, _LOCK_BYTES)
            return
        except OSError:
            time.sleep(_WINDOWS_RETRY_SECONDS)


def lock_exclusive_nonblocking(handle: IO) -> bool:
    """Try to take an exclusive lock; return whether it was acquired.

    Callers treat a refusal as "another process already owns this role", so a
    contended lock must report cleanly instead of raising.
    """
    if not _WINDOWS:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return False
        return True
    _seek_to_lock_region(handle)
    try:
        msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, _LOCK_BYTES)
    except OSError:
        return False
    return True


def unlock(handle: IO) -> None:
    """Release a lock held on ``handle``.

    Release runs in ``finally`` blocks, so a failure here must not mask the
    original error. Windows raises if the range is not locked, which happens
    when a caller unlocks twice during unwinding.
    """
    if not _WINDOWS:
        fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        return
    _seek_to_lock_region(handle)
    try:
        msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, _LOCK_BYTES)
    except OSError:
        pass


@contextmanager
def exclusive_lock(handle: IO):
    """Hold an exclusive lock on ``handle`` for the duration of the block."""
    lock_exclusive(handle)
    try:
        yield handle
    finally:
        unlock(handle)

