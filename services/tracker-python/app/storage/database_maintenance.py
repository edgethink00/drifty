from __future__ import annotations

import os
import shutil
import sqlite3
import stat
import uuid
from collections.abc import Callable, Iterator
from contextlib import closing, contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from app.fs_safety import ensure_directory
from app.platform_locks import lock_exclusive, unlock


DEFAULT_BACKUP_INTERVAL_SECONDS = 24 * 60 * 60
DEFAULT_BACKUP_RETENTION = 3
BACKUP_DIRECTORY_NAME = "database-backups"
QUARANTINE_DIRECTORY_NAME = "database-quarantine"
_QUARANTINE_ONLY_RECORD_PREFIX = "quarantine-only:"
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


@dataclass(frozen=True)
class _PendingDatabaseRecovery:
    quarantined_path: Path
    requires_backup: bool


def database_backup_dir(db_path: Path) -> Path:
    return db_path.parent / BACKUP_DIRECTORY_NAME


def database_quarantine_dir(db_path: Path) -> Path:
    return db_path.parent / QUARANTINE_DIRECTORY_NAME


def _maintenance_lock_path(db_path: Path) -> Path:
    return db_path.parent / f".{db_path.name}.maintenance.lock"


def _recovery_pending_path(db_path: Path) -> Path:
    return db_path.parent / f".{db_path.name}.recovery-pending"


def _pending_recovery(db_path: Path) -> _PendingDatabaseRecovery | None:
    pending_path = _recovery_pending_path(db_path)
    try:
        name = pending_path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return None
    # Legacy basename-only records require a backup. Quarantine-only records
    # must finish moving every source file before a fresh database can open.
    requires_backup = not name.startswith(_QUARANTINE_ONLY_RECORD_PREFIX)
    if not requires_backup:
        name = name[len(_QUARANTINE_ONLY_RECORD_PREFIX):]
    # The record contains only a generated basename, never an arbitrary path.
    if (
        Path(name).name != name
        or "/" in name
        or "\\" in name
        or not name.startswith(f"{db_path.stem}-corrupt-")
        or not name.endswith(db_path.suffix)
    ):
        raise sqlite3.DatabaseError("invalid pending database recovery record")
    return _PendingDatabaseRecovery(
        quarantined_path=database_quarantine_dir(db_path) / name,
        requires_backup=requires_backup,
    )


def _record_pending_recovery(
    db_path: Path, quarantined_db: Path, *, requires_backup: bool
) -> None:
    pending_path = _recovery_pending_path(db_path)
    temp_path = pending_path.with_name(f"{pending_path.name}.{uuid.uuid4().hex}.tmp")
    try:
        with temp_path.open("w", encoding="utf-8") as record:
            prefix = "" if requires_backup else _QUARANTINE_ONLY_RECORD_PREFIX
            record.write(f"{prefix}{quarantined_db.name}")
            record.flush()
            os.fsync(record.fileno())
        os.replace(temp_path, pending_path)
    finally:
        temp_path.unlink(missing_ok=True)


@contextmanager
def _maintenance_lock(db_path: Path):
    ensure_directory(db_path.parent)
    with _maintenance_lock_path(db_path).open("a+") as lock_file:
        lock_exclusive(lock_file)
        try:
            yield
        finally:
            unlock(lock_file)


@contextmanager
def database_initialization_guard(db_path: Path) -> Iterator[None]:
    """Keep writable initialization from bypassing an interrupted recovery."""

    with _maintenance_lock(db_path):
        if _recovery_pending_path(db_path).exists():
            raise sqlite3.DatabaseError(
                "database recovery is pending; retry startup maintenance"
            )
        yield


def _is_confirmed_corruption_error(error: sqlite3.DatabaseError) -> bool:
    message = str(error).strip().lower()
    return any(marker in message for marker in _CORRUPTION_ERROR_MARKERS)


def _is_regular_file(path: Path) -> bool:
    # Path.is_file() can hide access/I/O errors on newer Python versions.
    try:
        return stat.S_ISREG(path.stat().st_mode)
    except FileNotFoundError:
        return False


def quick_check_database(path: Path, *, immutable: bool = False) -> bool:
    """Return whether SQLite confirms that ``path`` is internally consistent.

    Lock, permission, and I/O failures are deliberately re-raised. Only a
    positive quick_check finding or an explicit SQLite corruption error should
    ever lead the caller to quarantine a user's source-of-truth database.
    """

    if not _is_regular_file(path):
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


def _recovery_files(directory: Path, pattern: str) -> list[Path]:
    # glob() may silently yield nothing when a directory cannot be read.
    # Recovery and permanent deletion must distinguish that from no copies.
    try:
        entries = list(directory.iterdir())
    except FileNotFoundError:
        return []
    return [
        path for path in entries
        if path.match(pattern) and _is_regular_file(path)
    ]


def _backup_candidates(db_path: Path) -> list[Path]:
    return sorted(
        _recovery_files(database_backup_dir(db_path), _backup_pattern(db_path)),
        key=lambda path: (_backup_created_at(db_path, path), path.name),
        reverse=True,
    )


def _quarantine_candidates(db_path: Path) -> list[Path]:
    return sorted(
        _recovery_files(
            database_quarantine_dir(db_path),
            f"{db_path.stem}-corrupt-*{db_path.suffix}*",
        )
    )


@contextmanager
def permanent_deletion_guard(
    db_path: Path,
    source: sqlite3.Connection,
    *,
    on_backup_error: Callable[[OSError | sqlite3.DatabaseError], None] | None = None,
    refresh_backup: bool = True,
) -> Iterator[Callable[[], None]]:
    """Serialize a permanent delete and replace older recovery copies.

    The caller invokes the yielded function immediately before mutating the
    live database, while its SQLite transaction is still able to roll back.
    Holding the maintenance lock until that transaction commits prevents a
    concurrent backup from capturing the rows being permanently deleted. Once
    the caller's transaction exits, a verified snapshot of the post-transaction
    database replaces the invalidated copies before the lock is released. A
    batched caller may defer that last step, but must create one forced backup
    after the batch finishes.
    """

    with _maintenance_lock(db_path):
        invalidated = False

        def invalidate_recovery_copies() -> None:
            nonlocal invalidated
            if invalidated:
                return
            for path in [*_backup_candidates(db_path), *_quarantine_candidates(db_path)]:
                path.unlink()
            _recovery_pending_path(db_path).unlink(missing_ok=True)
            invalidated = True

        try:
            yield invalidate_recovery_copies
        finally:
            if invalidated and refresh_backup:
                try:
                    _create_rotating_backup_locked(
                        source,
                        db_path,
                        now=datetime.now(timezone.utc),
                        interval_seconds=0,
                        retention=DEFAULT_BACKUP_RETENTION,
                    )
                except (OSError, sqlite3.DatabaseError) as error:
                    if on_backup_error is None:
                        raise
                    on_backup_error(error)


def _latest_valid_backup(db_path: Path, *, skip_unreadable: bool = False) -> Path | None:
    for candidate in _backup_candidates(db_path):
        try:
            if quick_check_database(candidate, immutable=True):
                return candidate
        except (OSError, sqlite3.DatabaseError):
            # Only confirmed corruption permits trying an older recovery copy.
            # A healthy live DB may still create a new periodic backup.
            if not skip_unreadable:
                raise
    return None


def _quarantine_database_files(db_path: Path, quarantined_db: Path) -> None:
    quarantined_db.parent.mkdir(parents=True, exist_ok=True)
    if db_path.exists():
        os.replace(db_path, quarantined_db)
    # A previous process may have moved the source, then failed on a sidecar.
    # Finish these moves before a restored database can open at the live path.
    for suffix in ("-wal", "-shm"):
        source = Path(f"{db_path}{suffix}")
        if source.exists():
            os.replace(source, Path(f"{quarantined_db}{suffix}"))


def _restore_backup(backup_path: Path, db_path: Path) -> None:
    temp_path = db_path.with_name(f".{db_path.name}.restore-{uuid.uuid4().hex}.tmp")
    try:
        shutil.copy2(backup_path, temp_path)
        if not quick_check_database(temp_path, immutable=True):
            raise sqlite3.DatabaseError("restored database backup failed quick_check")
        # This is a closed backup copy, not a live WAL database. Publish it
        # without WAL mode so older SQLite can read it even if startup stops
        # before _init_db creates its live WAL/SHM files.
        with closing(sqlite3.connect(temp_path)) as restored:
            restored.execute("PRAGMA journal_mode = DELETE")
        os.replace(temp_path, db_path)
    finally:
        temp_path.unlink(missing_ok=True)


def prepare_database(db_path: Path, *, now: datetime | None = None) -> DatabasePreparationResult:
    """Recover confirmed corruption, including an interrupted earlier restore."""

    resolved_now = now or datetime.now(timezone.utc)
    with _maintenance_lock(db_path):
        pending_recovery = _pending_recovery(db_path)
        pending_quarantine = (
            pending_recovery.quarantined_path if pending_recovery is not None else None
        )
        source_exists = db_path.exists()
        if not source_exists and pending_quarantine is None:
            return DatabasePreparationResult(existed=False)
        if source_exists and quick_check_database(db_path):
            # The atomic restore may have completed before record cleanup failed.
            # Keep the healthy live database, including any subsequent writes.
            if pending_quarantine is not None:
                _recovery_pending_path(db_path).unlink()
            return DatabasePreparationResult(existed=True)

        backup_path = _latest_valid_backup(db_path)
        if (
            pending_recovery is not None
            and pending_recovery.requires_backup
            and backup_path is None
        ):
            raise sqlite3.DatabaseError("pending database recovery has no valid backup")
        if source_exists:
            quarantined_path = database_quarantine_dir(db_path) / (
                f"{db_path.stem}-corrupt-{_timestamp_slug(resolved_now)}{db_path.suffix}"
            )
            # Persist intent even without a backup: an interrupted sidecar
            # move must not leave old WAL/SHM beside a newly initialized database.
            _record_pending_recovery(
                db_path, quarantined_path, requires_backup=backup_path is not None
            )
        else:
            quarantined_path = pending_quarantine
        _quarantine_database_files(db_path, quarantined_path)
        if backup_path is not None:
            _restore_backup(backup_path, db_path)
        _recovery_pending_path(db_path).unlink(missing_ok=True)
        return DatabasePreparationResult(
            existed=True,
            quarantined_path=quarantined_path if quarantined_path.is_file() else None,
            restored_backup_path=backup_path,
        )


def _backup_is_due(db_path: Path, now: datetime, interval_seconds: int) -> bool:
    latest = _latest_valid_backup(db_path, skip_unreadable=True)
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
        return _create_rotating_backup_locked(
            source,
            db_path,
            now=resolved_now,
            interval_seconds=interval_seconds,
            retention=retention,
        )


def _create_rotating_backup_locked(
    source: sqlite3.Connection,
    db_path: Path,
    *,
    now: datetime,
    interval_seconds: int,
    retention: int,
) -> Path | None:
    if not _backup_is_due(db_path, now, interval_seconds):
        return None
    backup_dir = database_backup_dir(db_path)
    backup_dir.mkdir(parents=True, exist_ok=True)
    final_path = _backup_path(db_path, now)
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
