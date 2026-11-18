#!/usr/bin/env python3
"""Observe the legacy backup ownership guard without opening any database."""
from __future__ import annotations

import sys

# Imports must not leave caches beside an installed support checkout.
sys.dont_write_bytecode = True

import argparse
import json
import os
from pathlib import Path
import stat

SERVICE = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(SERVICE))
from app.storage import database_maintenance as maintenance

MAX_ENTRIES = 4096
MAX_RECORD_BYTES = 64 * 1024
MAX_METADATA_BYTES = 1024 * 1024


class UnknownObservation(Exception):
    pass


def signature(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_size, info.st_mtime_ns)


def inventory(directory):
    try:
        info = directory.lstat()
    except FileNotFoundError:
        return None
    if not stat.S_ISDIR(info.st_mode):
        raise UnknownObservation("unsupported_directory")
    entries = {}
    with os.scandir(directory) as scan:
        for entry in scan:
            if len(entries) == MAX_ENTRIES:
                raise UnknownObservation("entry_limit")
            # Windows DirEntry.stat may omit the file ID that lstat/fstat
            # expose. Compare the same metadata API across inventory/reads.
            entries[entry.name] = signature(Path(entry.path).lstat())
    return entries


def entry_name(entries, name):
    if name in (entries or {}):
        return name
    # Windows metadata opens use the filesystem's case-insensitive lookup.
    normalized = os.path.normcase(name)
    return next((item for item in (entries or {}) if os.path.normcase(item) == normalized), None)


def regular(entries, name):
    info = (entries or {}).get(entry_name(entries, name))
    if info is None:
        return False
    if stat.S_ISLNK(info[2]):
        raise UnknownObservation("symbolic_link")
    return stat.S_ISREG(info[2])


def read_metadata(path, expected, limit, *, prefix=False):
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    fd = os.open(path, flags)
    with os.fdopen(fd, "rb") as source:
        if signature(os.fstat(source.fileno())) != expected:
            raise UnknownObservation("concurrent_change")
        if not prefix and expected[3] > limit:
            raise UnknownObservation("record_limit")
        value = source.read(limit if prefix else limit + 1)
        if not prefix and len(value) > limit:
            raise UnknownObservation("record_limit")
        if signature(os.fstat(source.fileno())) != expected:
            raise UnknownObservation("concurrent_change")
    if signature(path.lstat()) != expected:
        raise UnknownObservation("concurrent_change")
    return value


def observe(db_path):
    # Never return paths, names, exception text, activity or owner identifiers.
    result = {
        "schemaVersion": 1,
        "scope": "legacy_backup_ownership",
        "state": "unknown",
        "reason": "inspection_failed",
        "deletionAuthorized": False,
    }
    try:
        parent = inventory(db_path.parent)
        if not regular(parent, db_path.name):
            raise UnknownObservation("database_missing_or_not_regular")
        backup_dir = maintenance.database_backup_dir(db_path)
        backups = inventory(backup_dir)
        target = parent[entry_name(parent, db_path.name)]
        protected_ids = {(target[0], target[1])}
        protected_ids.update(
            (info[0], info[1]) for name, info in (backups or {}).items()
            if name.startswith(db_path.stem + "-") and name.endswith(".sqlite3")
        )
        remaining_metadata = MAX_METADATA_BYTES

        def metadata(path, expected, limit, *, prefix=False):
            nonlocal remaining_metadata
            if (expected[0], expected[1]) in protected_ids:
                raise UnknownObservation("metadata_aliases_database")
            if not prefix and expected[3] > limit:
                raise UnknownObservation("record_limit")
            planned = min(expected[3], limit) if prefix else expected[3]
            if planned > remaining_metadata:
                raise UnknownObservation("metadata_budget")
            value = read_metadata(path, expected, limit, prefix=prefix)
            remaining_metadata -= len(value)
            return value

        def record(owner):
            name = "." + owner.name + ".backup-order"
            if not regular(parent, name):
                if entry_name(parent, name) is not None:
                    raise UnknownObservation("unsupported_metadata")
                try:
                    (db_path.parent / name).lstat()
                except FileNotFoundError:
                    return set()
                # A case-insensitive volume may resolve a different spelling
                # even on POSIX. Do not mistake that record for an absent one.
                raise UnknownObservation("noncanonical_metadata_name")
            name = entry_name(parent, name)
            raw = metadata(db_path.parent / name, parent[name], MAX_RECORD_BYTES)
            try:
                names = raw.decode("utf-8").splitlines()
            except UnicodeError:
                raise UnknownObservation("invalid_order_record") from None
            if not names or len(names) != len(set(names)) or any(
                not maintenance._is_backup_record_name(owner, item) for item in names
            ):
                raise UnknownObservation("invalid_order_record")
            return set(names)

        own = record(db_path)
        foreign = set()
        related_records = False
        for name in parent:
            for suffix in (".backup-order", ".maintenance.lock"):
                if not Path(name).match(".*" + suffix):
                    continue
                owner_name = name[1:-len(suffix)]
                owner = db_path.with_name(owner_name) if owner_name else None
                if owner is None or owner.name == db_path.name or not maintenance._backup_families_overlap(
                    owner.stem, db_path.stem
                ):
                    continue
                if regular(parent, name):
                    related_records = True
                    if suffix == ".backup-order":
                        foreign.update(record(owner))

        candidates = {
            name for name in (backups or {})
            if name.startswith(db_path.stem + "-") and name.endswith(".sqlite3")
            and regular(backups, name)
        }
        unrecorded = candidates - foreign - own
        other_family = related_records
        own_files = {db_path.name, *(db_path.name + suffix for suffix in ("-wal", "-shm", "-journal"))}
        for name in parent:
            if name in own_files or not maintenance._backup_families_overlap(Path(name).stem, db_path.stem):
                continue
            if not regular(parent, name):
                continue
            if name == "tracker.pid":
                raw = metadata(db_path.parent / name, parent[name], 32, prefix=True)
                pid = raw.strip()
                if len(raw) < 32 and pid.isdigit() and int(pid) > 0:
                    continue
            other_family = True

        # This is a bounded, unlocked observation, never a deletion prerequisite.
        if inventory(db_path.parent) != parent or inventory(backup_dir) != backups:
            raise UnknownObservation("concurrent_change")
        ambiguous = bool(unrecorded) and other_family
        result.update(
            state="ambiguous" if ambiguous else "not_observed",
            reason="unattributed_copy_and_overlapping_family" if ambiguous else "guard_not_observed",
            matchingCopies=len(candidates),
            unattributedCopies=len(unrecorded),
            overlappingFamilyObserved=other_family,
        )
    except UnknownObservation as error:
        result["reason"] = error.args[0]
    except PermissionError:
        result["reason"] = "permission_denied"
    except (OSError, ValueError):
        # Missing/raced files, invalid metadata and OS errors never become clear.
        result["reason"] = "inspection_failed"
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database", type=Path, help="explicit local tracker DB path; never opened")
    args = parser.parse_args()
    result = observe(args.database.absolute())
    print(json.dumps(result, sort_keys=True))
    return {"not_observed": 0, "ambiguous": 1, "unknown": 2}[result["state"]]


if __name__ == "__main__":
    raise SystemExit(main())
