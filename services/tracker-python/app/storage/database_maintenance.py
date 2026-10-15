from __future__ import annotations

import os
import re
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
    """Return whether ``path`` contains an internally consistent SQLite database.

    Lock, permission, and I/O failures are deliberately re-raised. Only a
    positive quick_check finding or an explicit SQLite corruption error should
    ever lead the caller to quarantine a user's source-of-truth database.
    """

    try:
        return _quick_check_database(path, immutable=immutable, mode="ro")
    except sqlite3.OperationalError as error:
        if (
            not immutable
            and str(error) == "unable to open database file"
            and _wal_sidecars_can_be_initialized(path)
        ):
            # Some system SQLite builds need writable startup to recreate a
            # closed WAL's disposable files. Never use immutable on a live DB:
            # it would ignore committed WAL pages. `rw` cannot create a DB.
            return _quick_check_database(path, immutable=False, mode="rw")
        raise


def _wal_sidecars_can_be_initialized(path: Path) -> bool:
    # Preserve existing WAL/SHM bytes, including corrupt recovery evidence.
    # Access/I/O errors must propagate instead of looking like missing files.
    for suffix in ("-wal", "-shm"):
        try:
            Path(f"{path}{suffix}").stat()
        except FileNotFoundError:
            continue
        return False
    try:
        with path.open("rb") as source:
            header = source.read(20)
    except FileNotFoundError:
        return False
    return header[:16] == b"SQLite format 3\x00" and header[18:20] == b"\x02\x02"


def _quick_check_database(path: Path, *, immutable: bool, mode: str) -> bool:
    if not _is_regular_file(path):
        return False
    uri = f"{path.resolve().as_uri()}?mode={mode}"
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
        # SQLite calls a zero-page file "ok" because it can initialize it as a
        # new database. It is not a usable tracker recovery copy. Ask SQLite
        # rather than checking file size so committed live WAL pages count.
        page_count = connection.execute("PRAGMA page_count").fetchone()[0]
    except sqlite3.DatabaseError as error:
        if _is_confirmed_corruption_error(error):
            return False
        raise
    finally:
        if connection is not None:
            connection.close()
    return page_count > 0 and bool(rows) and all(str(row[0]).strip().lower() == "ok" for row in rows)


def _timestamp_slug(now: datetime) -> str:
    return now.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")


def _backup_path(db_path: Path, now: datetime) -> Path:
    # A publication record must refer to one unique snapshot. Never reuse a
    # basename after rotation, including across same-stem custom databases.
    name = f"{db_path.stem}-{_timestamp_slug(now)}-{uuid.uuid4().hex}.sqlite3"
    return database_backup_dir(db_path) / name


def _backup_order_record_path(db_path: Path) -> Path:
    return db_path.parent / f".{db_path.name}.backup-order"


def _is_backup_record_name(db_path: Path, name: str) -> bool:
    pattern = rf"{re.escape(db_path.stem)}-\d{{8}}T\d{{12}}Z(?:-[0-9a-f]{{32}})?\.sqlite3"
    return re.fullmatch(pattern, name) is not None


def _recorded_backup_order(db_path: Path) -> list[Path]:
    try:
        names = _backup_order_record_path(db_path).read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        return []
    except UnicodeError as error:
        raise sqlite3.DatabaseError("invalid database backup order record") from error
    # Only generated basenames are valid; recovery metadata cannot choose an
    # arbitrary file outside this database's existing backup family.
    if not names or len(names) != len(set(names)) or any(
        not _is_backup_record_name(db_path, name) for name in names
    ):
        raise sqlite3.DatabaseError("invalid database backup order record")
    return [database_backup_dir(db_path) / name for name in names]


def _record_backup_order(db_path: Path, candidates: list[Path]) -> None:
    record_path = _backup_order_record_path(db_path)
    temp_path = record_path.with_name(f"{record_path.name}.{uuid.uuid4().hex}.tmp")
    try:
        with temp_path.open("w", encoding="utf-8") as record:
            # Non-generated legacy names remain fallbacks; do not introduce
            # an invalid or path-bearing name into the validated order record.
            record.write("\n".join(
                path.name for path in candidates if _is_backup_record_name(db_path, path.name)
            ))
            record.flush()
            os.fsync(record.fileno())
        os.replace(temp_path, record_path)
    finally:
        temp_path.unlink(missing_ok=True)


def _backup_created_at(db_path: Path, backup_path: Path) -> datetime:
    prefix = f"{db_path.stem}-"
    suffix = ".sqlite3"
    if backup_path.name.startswith(prefix) and backup_path.name.endswith(suffix):
        timestamp = backup_path.name[len(prefix) : -len(suffix)]
        timestamp = re.sub(r"-[0-9a-f]{32}$", "", timestamp)
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


def _backup_families_overlap(first_stem: str, second_stem: str) -> bool:
    # Legacy discovery used a stem prefix, so a longer, hyphenated stem can
    # also own a file in that family. Treat that provenance as ambiguous.
    return (
        first_stem == second_stem
        or first_stem.startswith(f"{second_stem}-")
        or second_stem.startswith(f"{first_stem}-")
    )


def _other_database_paths(db_path: Path, record_suffix: str) -> list[Path]:
    owners: list[Path] = []
    for record in _recovery_files(db_path.parent, f".*{record_suffix}"):
        owner_name = record.name[1:-len(record_suffix)]
        if owner_name != db_path.name and _backup_families_overlap(Path(owner_name).stem, db_path.stem):
            owners.append(db_path.with_name(owner_name))
    return owners


def _foreign_recorded_backups(db_path: Path) -> set[Path]:
    claimed: set[Path] = set()
    for owner in _other_database_paths(db_path, ".backup-order"):
        # A filename-scoped record claims only that publisher's snapshots.
        # Unreadable claims fail before deletion or corruption recovery.
        claimed.update(_recorded_backup_order(owner))
    return claimed


def _has_other_backup_family_database(db_path: Path) -> bool:
    if _other_database_paths(db_path, ".maintenance.lock") or _other_database_paths(db_path, ".backup-order"):
        return True
    # Legacy/custom databases may have no suffix or any suffix, and a corrupt
    # sibling need not have a readable SQLite header. A related filename makes
    # stem-only provenance ambiguous. Exclude our own live SQLite sidecars.
    own_files = {db_path.name, *(f"{db_path.name}{suffix}" for suffix in ("-wal", "-shm", "-journal"))}
    for path in _recovery_files(db_path.parent, "*"):
        if path.name in own_files or not _backup_families_overlap(path.stem, db_path.stem):
            continue
        if path.name == "tracker.pid":
            # Legacy process metadata contains a positive ASCII PID. A custom
            # or corrupt database using that name is not proven PID metadata.
            with path.open("rb") as sibling:
                metadata = sibling.read(32)
            pid = metadata.strip()
            if len(metadata) < 32 and pid.isdigit() and int(pid) > 0:
                continue
        return True
    return False


def _backup_candidates(db_path: Path) -> list[Path]:
    # List files before reading ownership records: a concurrent publisher
    # records its unique basename before making that file visible.
    candidates = [
        path for path in _recovery_files(database_backup_dir(db_path), "*")
        if path.name.startswith(f"{db_path.stem}-") and path.name.endswith(".sqlite3")
    ]
    foreign = _foreign_recorded_backups(db_path)
    return sorted(
        (path for path in candidates if path not in foreign and _is_regular_file(path)),
        key=lambda path: (_backup_created_at(db_path, path), path.name),
        reverse=True,
    )


def _quarantine_body_pattern(db_path: Path) -> str:
    # Preserve old names while recognizing new collision-resistant copies.
    return rf"{re.escape(db_path.stem)}-corrupt-\d{{8}}T\d{{12}}Z(?:-[0-9a-f]{{32}})?{re.escape(db_path.suffix)}"


def _quarantine_candidates(db_path: Path) -> list[Path]:
    # Match generated basenames literally, with only SQLite's known sidecars.
    # A suffix prefix (.sqlite vs .sqlite3), glob character, or missing suffix
    # must never broaden permanent deletion to another database's originals.
    pattern = re.compile(_quarantine_body_pattern(db_path) + r"(?:-(?:wal|shm|journal))?")
    candidates = sorted(
        path for path in _recovery_files(database_quarantine_dir(db_path), "*")
        if pattern.fullmatch(path.name)
    )
    # A custom DB ending in -wal/-shm/-journal can have the same quarantine
    # basename as our sidecar. Its persistent filename-scoped records prove
    # this is not safe to unlink, in either direction, even after quarantine.
    owners = {
        *_other_database_paths(db_path, ".maintenance.lock"),
        *_other_database_paths(db_path, ".backup-order"),
    }
    if any(
        re.fullmatch(_quarantine_body_pattern(owner) + r"(?:-(?:wal|shm|journal))?", candidate.name)
        for owner in owners for candidate in candidates
    ):
        raise sqlite3.DatabaseError(
            "ambiguous database quarantine ownership; resolve before permanent deletion"
        )
    return candidates


def _has_ambiguous_legacy_backups(db_path: Path) -> bool:
    candidates = _backup_candidates(db_path)
    recorded = set(_recorded_backup_order(db_path))
    return any(path not in recorded for path in candidates) and _has_other_backup_family_database(db_path)


def _interrupted_backup_candidates(db_path: Path) -> list[Path]:
    # Only names this module generates, including possible SQLite sidecars.
    # Match the full DB filename, just like its maintenance lock. Different
    # DBs may share a stem in one directory. Preserve ambiguous legacy names.
    # Under that lock a matching file cannot belong to a live backup; abrupt
    # process exit may have bypassed the creator's finally.
    pattern = re.compile(
        rf"\.{re.escape(db_path.name)}-\d{{8}}T\d{{12}}Z\.[0-9a-f]{{32}}\.tmp"
        r"(?:-(?:journal|wal|shm))?"
    )
    try:
        entries = list(database_backup_dir(db_path).iterdir())
    except FileNotFoundError:
        return []
    return [path for path in entries if pattern.fullmatch(path.name) and _is_regular_file(path)]


def _interrupted_restore_candidates(db_path: Path) -> list[Path]:
    # Restore works beside the live DB, unlike backup staging. An abrupt exit
    # can leave this closed copy holding rows a later permanent delete removes.
    # The filename-scoped maintenance lock excludes an active restore here.
    pattern = re.compile(
        rf"(\.{re.escape(db_path.name)}\.restore-[0-9a-f]{{32}}\.tmp)"
        r"(?:-(?:journal|wal|shm))?"
    )
    candidates: list[Path] = []
    for path in db_path.parent.iterdir():
        match = pattern.fullmatch(path.name)
        if match is None or not _is_regular_file(path):
            continue
        # A custom database can use a generated-looking basename. Its own
        # durable records prove that deleting this file or its sidecars is unsafe.
        owners = {path, path.with_name(match.group(1))}
        if any(
            _is_regular_file(_maintenance_lock_path(owner))
            or _is_regular_file(_backup_order_record_path(owner))
            for owner in owners
        ):
            raise sqlite3.DatabaseError(
                "ambiguous database restore ownership; resolve before permanent deletion"
            )
        candidates.append(path)
    return candidates


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
            # Preserve both the live rows and every recovery copy when an old
            # stem-only snapshot might belong to either database. Ignoring it
            # would allow deleted rows to reappear; unlinking it could destroy
            # the other database's only recovery copy.
            if _has_ambiguous_legacy_backups(db_path):
                raise sqlite3.DatabaseError(
                    "ambiguous legacy database backups; resolve ownership before permanent deletion"
                )
            for path in [*_interrupted_restore_candidates(db_path),
                         *_interrupted_backup_candidates(db_path),
                         *_backup_candidates(db_path), *_quarantine_candidates(db_path)]:
                path.unlink()
            _recovery_pending_path(db_path).unlink(missing_ok=True)
            _backup_order_record_path(db_path).unlink(missing_ok=True)
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


def _ordered_backup_candidates(db_path: Path, *, skip_unreadable: bool = False) -> list[Path]:
    candidates = _backup_candidates(db_path)
    try:
        recorded = _recorded_backup_order(db_path)
    except (OSError, sqlite3.DatabaseError):
        if not skip_unreadable:
            raise
        recorded = []
    # Missing publication targets and already-rotated copies are ignored.
    # Only a single unambiguous database may use stem-only legacy fallbacks.
    ordered = [path for path in recorded if path in candidates]
    if _has_other_backup_family_database(db_path):
        return ordered
    return [*ordered, *(path for path in candidates if path not in ordered)]


def _latest_valid_backup(db_path: Path, *, skip_unreadable: bool = False) -> Path | None:
    candidates = _ordered_backup_candidates(db_path, skip_unreadable=skip_unreadable)
    for candidate in candidates:
        try:
            if quick_check_database(candidate, immutable=True):
                return candidate
        except (OSError, sqlite3.DatabaseError):
            # Only confirmed corruption permits trying an older recovery copy.
            # A healthy live DB may still create a new periodic backup.
            if not skip_unreadable:
                raise
    if not skip_unreadable and _has_ambiguous_legacy_backups(db_path):
        # No proven usable copy exists. Stop before moving the corrupt source
        # or publishing a fresh empty database over this unresolved recovery.
        raise sqlite3.DatabaseError(
            "ambiguous legacy database backups; resolve ownership before recovery"
        )
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
        if source_exists and not _is_regular_file(db_path):
            # A directory/device is a path error, not confirmed DB corruption.
            # Keep it in place instead of quarantining it and creating a DB.
            raise sqlite3.OperationalError("database path is not a regular file")
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
                f"{db_path.stem}-corrupt-{_timestamp_slug(resolved_now)}-{uuid.uuid4().hex}{db_path.suffix}"
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
    # A corrected clock must not postpone backups until a future filename
    # catches up. The next verified snapshot resets the interval baseline.
    return elapsed_seconds < 0 or elapsed_seconds >= max(0, interval_seconds)


def _rotate_backups(db_path: Path, retention: int) -> None:
    # Successful publication order survives clock changes for every retained
    # copy, including the fallback when the newest snapshot becomes corrupt.
    candidates = _ordered_backup_candidates(db_path)
    ambiguous_legacy = _has_other_backup_family_database(db_path)
    recorded = set(_recorded_backup_order(db_path))
    for stale_path in candidates[max(1, retention):]:
        # Correcting one DB's clock must not remove another DB's unrecorded
        # legacy copy. Preserve uncertain provenance until explicitly resolved.
        if ambiguous_legacy and stale_path not in recorded:
            continue
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

    with _maintenance_lock(db_path):
        # Sample the real clock after admission; an older queued sample must
        # not look like a backward clock correction after another backup wins.
        resolved_now = now or datetime.now(timezone.utc)
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
    for interrupted in _interrupted_backup_candidates(db_path):
        interrupted.unlink()
    if not _backup_is_due(db_path, now, interval_seconds):
        return None
    backup_dir = database_backup_dir(db_path)
    backup_dir.mkdir(parents=True, exist_ok=True)
    final_path = _backup_path(db_path, now)
    temp_path = backup_dir / f".{db_path.name}-{_timestamp_slug(now)}.{uuid.uuid4().hex}.tmp"
    destination: sqlite3.Connection | None = None
    try:
        destination = sqlite3.connect(temp_path)
        source.backup(destination, pages=256, sleep=0.01)
        destination.close()
        destination = None
        if not quick_check_database(temp_path, immutable=True):
            raise sqlite3.DatabaseError("database backup failed quick_check")
        previous = _ordered_backup_candidates(db_path, skip_unreadable=True)
        try:
            recorded = set(_recorded_backup_order(db_path))
        except (OSError, sqlite3.DatabaseError):
            recorded = set()
        # Do not claim unrecorded legacy copies whose provenance is unknown.
        previous = [path for path in previous if path in recorded]
        # Publish intent before the snapshot: a process exit after its rename
        # must not leave a complete newer copy behind an older recovery record.
        # Keep all prior entries until rotation; a failed rename has a missing
        # target and must preserve the previous recovery order even at retention 1.
        _record_backup_order(db_path, [final_path, *(
            path for path in previous if path != final_path
        )])
        os.replace(temp_path, final_path)
        _rotate_backups(db_path, retention)
        return final_path
    finally:
        if destination is not None:
            destination.close()
        temp_path.unlink(missing_ok=True)
