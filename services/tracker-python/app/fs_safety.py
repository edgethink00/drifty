"""Filesystem helpers that tolerate Windows' delayed deletes.

Windows keeps a deleted file or directory in a "delete pending" state while
another process still holds a handle to it: an antivirus scan of a file the
tracker just wrote, the search indexer, or an installer replacing the app. In
that window `CreateDirectory` reports "already exists" while the path cannot be
opened, and removing a directory whose files are still pending reports "The
directory is not empty". Both states clear on their own within moments, so the
tracker should wait briefly instead of failing a command or a capture tick.
"""

from __future__ import annotations

import os
import shutil
import tempfile
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path

# About 1.5 s in total: long enough for a scan or an installer step to release
# the path, short enough that a genuinely broken data directory still fails fast.
_DIRECTORY_RETRY_DELAYS_SECONDS = (0.05, 0.1, 0.2, 0.4, 0.8)
_CLEANUP_RETRY_DELAYS_SECONDS = (0.05, 0.2)


class DataDirectoryUnavailableError(OSError):
    """The tracker's data directory exists in a state that cannot be used."""


def ensure_directory(path: Path, *, sleep: Callable[[float], None] = time.sleep) -> None:
    """Create `path` (and parents) or confirm it is already a directory.

    Retries briefly when the path exists but cannot be used as a directory yet,
    then raises `DataDirectoryUnavailableError` naming what was found there so
    a report distinguishes a stray file from an unreadable directory.
    """
    last_error: OSError | None = None
    for delay in (*_DIRECTORY_RETRY_DELAYS_SECONDS, None):
        try:
            path.mkdir(parents=True, exist_ok=True)
            return
        except (FileExistsError, PermissionError) as error:
            last_error = error
        if path.is_dir():
            return
        if delay is None:
            break
        sleep(delay)
    raise DataDirectoryUnavailableError(
        f"Tracker data directory is not usable ({_describe_path(path)}): {last_error}"
    ) from last_error


def _describe_path(path: Path) -> str:
    try:
        metadata = os.lstat(path)
    except FileNotFoundError:
        return "missing"
    except OSError as error:
        return f"unreadable, {type(error).__name__} {getattr(error, 'winerror', None) or error.errno}"
    if path.is_symlink():
        return "a link whose target is unavailable"
    if os.path.isfile(path):
        return "a file"
    return f"not a directory (mode {oct(metadata.st_mode)})"


@contextmanager
def scratch_directory(prefix: str = "drifty-") -> Iterator[Path]:
    """Temporary directory whose cleanup never fails the caller.

    `tempfile.TemporaryDirectory` raises from its cleanup when Windows still
    holds a copied file, which aborted a whole capture tick after the browser
    history had already been read. `ignore_cleanup_errors` needs Python 3.10,
    and packaged Mac builds can run on 3.9, so cleanup is handled here.
    """
    path = Path(tempfile.mkdtemp(prefix=prefix))
    try:
        yield path
    finally:
        remove_tree_quietly(path)


def remove_tree_quietly(path: Path, *, sleep: Callable[[float], None] = time.sleep) -> bool:
    """Remove `path`, retrying briefly; return False if anything was left behind."""
    for delay in (*_CLEANUP_RETRY_DELAYS_SECONDS, None):
        try:
            shutil.rmtree(path)
            return True
        except FileNotFoundError:
            return True
        except OSError:
            if delay is None:
                break
            sleep(delay)
    # Leave what the OS will not release yet; it is inside the temp directory,
    # which the OS and later runs clean up.
    shutil.rmtree(path, ignore_errors=True)
    return not path.exists()
