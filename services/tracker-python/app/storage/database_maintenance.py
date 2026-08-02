from __future__ import annotations

import fcntl
import os
import shutil
import sqlite3
import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


DEFAULT_BACKUP_INTERVAL_SECONDS = 24 * 60 * 60
DEFAULT_BACKUP_RETENTION = 3
BACKUP_DIRECTORY_NAME = "database-backups"
QUARANTINE_DIRECTORY_NAME = "database-quarantine"
_CORRUPTION_ERROR_MARKERS = (
    "database disk image is malformed",
    "database corrupt",
    "database corruption",
    "file is not a database",
    "malformed database schema",
)


@dataclass(frozen=True)
class DatabasePreparationResult:
    existed: bool
    quarantined_path: Path | None = None
    restored_backup_path: Path | None = None


def database_backup_dir(db_path: Path) -> Path:
    return db_path.parent / BACKUP_DIRECTORY_NAME


def database_quarantine_dir(db_path: Path) -> Path:
    return db_path.parent / QUARANTINE_DIRECTORY_NAME


def _maintenance_lock_path(db_path: Path) -> Path:
    return db_path.parent / f".{db_path.name}.maintenance.lock"


@contextmanager
def _maintenance_lock(db_path: Path):
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with _maintenance_lock_path(db_path).open("a+") as lock_file:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)


def _is_confirmed_corruption_error(error: sqlite3.DatabaseError) -> bool:
    message = str(error).strip().lower()
    return any(marker in message for marker in _CORRUPTION_ERROR_MARKERS)


def quick_check_database(path: Path, *, immutable: bool = False) -> bool:
    """Return whether SQLite confirms that ``path`` is internally consistent.

    Lock, permission, and I/O failures are deliberately re-raised. Only a
    positive quick_check finding or an explicit SQLite corruption error should
    ever lead the caller to quarantine a user's source-of-truth database.
    """

    if not path.is_file():
        return False
    uri = f"{path.resolve().as_uri()}?mode=ro"
    if immutable:
        # SQLite backup snapshots are closed, self-contained files. A snapshot
        # can retain WAL journal mode in its header while having no WAL/SHM
        # sidecars; immutable mode lets older system SQLite builds validate
        # that file without trying to create a new SHM file. Never use this for
        # the live source database because immutable readers ignore active WAL.
        uri = f"{uri}&immutable=1"
    connection: sqlite3.Connection | None = None
    try:
        connection = sqlite3.connect(uri, uri=True, timeout=5)
        connection.execute("PRAGMA busy_timeout = 5000")
        rows = connection.execute("PRAGMA quick_check").fetchall()
    except sqlite3.DatabaseError as error:
        if _is_confirmed_corruption_error(error):
            return False
        raise
    finally:
        if connection is not None:
            connection.close()
    return bool(rows) and all(str(row[0]).strip().lower() == "ok" for row in rows)


def _timestamp_slug(now: datetime) -> str:
    return now.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")


def _backup_pattern(db_path: Path) -> str:
    return f"{db_path.stem}-*.sqlite3"


def _backup_path(db_path: Path, now: datetime) -> Path:
    return database_backup_dir(db_path) / f"{db_path.stem}-{_timestamp_slug(now)}.sqlite3"


def _backup_created_at(db_path: Path, backup_path: Path) -> datetime:
    prefix = f"{db_path.stem}-"
    suffix = ".sqlite3"
    if backup_path.name.startswith(prefix) and backup_path.name.endswith(suffix):
        timestamp = backup_path.name[len(prefix) : -len(suffix)]
        try:
            return datetime.strptime(timestamp, "%Y%m%dT%H%M%S%fZ").replace(
                tzinfo=timezone.utc
            )
        except ValueError:
            pass
    return datetime.fromtimestamp(backup_path.stat().st_mtime, tz=timezone.utc)


def _backup_candidates(db_path: Path) -> list[Path]:
    backup_dir = database_backup_dir(db_path)
    if not backup_dir.is_dir():
        return []
    return sorted(
        (path for path in backup_dir.glob(_backup_pattern(db_path)) if path.is_file()),
        key=lambda path: (_backup_created_at(db_path, path), path.name),
        reverse=True,
    )


def _quarantine_candidates(db_path: Path) -> list[Path]:
    quarantine_dir = database_quarantine_dir(db_path)
    if not quarantine_dir.is_dir():
        return []
    return sorted(
        path
        for path in quarantine_dir.glob(
            f"{db_path.stem}-corrupt-*{db_path.suffix}*"
        )
        if path.is_file()
    )


@contextmanager
def permanent_deletion_guard(
    db_path: Path,
) -> Iterator[Callable[[], None]]:
    """Serialize a permanent delete and invalidate older recovery copies.

    The caller invokes the yielded function immediately before mutating the
    live database, while its SQLite transaction is still able to roll back.
    Holding the maintenance lock until that transaction commits prevents a
    concurrent backup from capturing the rows being permanently deleted.
    """

    with _maintenance_lock(db_path):
        invalidated = False

        def invalidate_recovery_copies() -> None:
            nonlocal invalidated
            if invalidated:
                return
            for path in [*_backup_candidates(db_path), *_quarantine_candidates(db_path)]:
                path.unlink()
            invalidated = True

        yield invalidate_recovery_copies


def _latest_valid_backup(db_path: Path) -> Path | None:
    for candidate in _backup_candidates(db_path):
        try:
            if quick_check_database(candidate, immutable=True):
                return candidate
        except (OSError, sqlite3.DatabaseError):
            continue
    return None


def _quarantine_database_files(db_path: Path, now: datetime) -> Path:
    quarantine_dir = database_quarantine_dir(db_path)
    quarantine_dir.mkdir(parents=True, exist_ok=True)
    quarantined_db = quarantine_dir / f"{db_path.stem}-corrupt-{_timestamp_slug(now)}{db_path.suffix}"
    os.replace(db_path, quarantined_db)
    for suffix in ("-wal", "-shm"):
        source = Path(f"{db_path}{suffix}")
        if source.exists():
            os.replace(source, Path(f"{quarantined_db}{suffix}"))
    return quarantined_db


def _restore_backup(backup_path: Path, db_path: Path) -> None:
    temp_path = db_path.with_name(f".{db_path.name}.restore-{uuid.uuid4().hex}.tmp")
    try:
        shutil.copy2(backup_path, temp_path)
        if not quick_check_database(temp_path, immutable=True):
            raise sqlite3.DatabaseError("restored database backup failed quick_check")
        os.replace(temp_path, db_path)
    finally:
        temp_path.unlink(missing_ok=True)


def prepare_database(db_path: Path, *, now: datetime | None = None) -> DatabasePreparationResult:
    """Check an existing database and recover only from confirmed corruption."""

    if not db_path.exists():
        return DatabasePreparationResult(existed=False)
    resolved_now = now or datetime.now(timezone.utc)
    with _maintenance_lock(db_path):
        if not db_path.exists():
            return DatabasePreparationResult(existed=False)
        if quick_check_database(db_path):
            return DatabasePreparationResult(existed=True)

        backup_path = _latest_valid_backup(db_path)
        quarantined_path = _quarantine_database_files(db_path, resolved_now)
        if backup_path is not None:
            _restore_backup(backup_path, db_path)
        return DatabasePreparationResult(
            existed=True,
            quarantined_path=quarantined_path,
            restored_backup_path=backup_path,
        )


def _backup_is_due(db_path: Path, now: datetime, interval_seconds: int) -> bool:
    latest = _latest_valid_backup(db_path)
    if latest is None:
        return True
    elapsed_seconds = (
        now.astimezone(timezone.utc) - _backup_created_at(db_path, latest)
    ).total_seconds()
    return elapsed_seconds >= max(0, interval_seconds)


def _rotate_backups(db_path: Path, retention: int) -> None:
    keep = max(1, retention)
    for stale_path in _backup_candidates(db_path)[keep:]:
        stale_path.unlink(missing_ok=True)


def create_rotating_backup(
    source: sqlite3.Connection,
    db_path: Path,
    *,
    now: datetime | None = None,
    interval_seconds: int = DEFAULT_BACKUP_INTERVAL_SECONDS,
    retention: int = DEFAULT_BACKUP_RETENTION,
) -> Path | None:
    """Create a verified SQLite snapshot and retain only the newest copies."""

    resolved_now = now or datetime.now(timezone.utc)
    with _maintenance_lock(db_path):
        if not _backup_is_due(db_path, resolved_now, interval_seconds):
            return None
        backup_dir = database_backup_dir(db_path)
        backup_dir.mkdir(parents=True, exist_ok=True)
        final_path = _backup_path(db_path, resolved_now)
        temp_path = backup_dir / f".{final_path.name}.{uuid.uuid4().hex}.tmp"
        destination: sqlite3.Connection | None = None
        try:
            destination = sqlite3.connect(temp_path)
            source.backup(destination, pages=256, sleep=0.01)
            destination.close()
            destination = None
            if not quick_check_database(temp_path, immutable=True):
                raise sqlite3.DatabaseError("database backup failed quick_check")
            os.replace(temp_path, final_path)
            _rotate_backups(db_path, retention)
            return final_path
        finally:
            if destination is not None:
                destination.close()
            temp_path.unlink(missing_ok=True)
