"""Experimental local point revocations, atomically stored with tracker writes.

Only a trusted native preparation step may install this schema. Ordinary DB
initialization does not create it. It contains opaque segment UIDs, integer
point bounds and a random epoch, never titles, images or application metadata.
The read-only screen reader must require this schema before granting a link.
"""
from __future__ import annotations

import re
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone

from app.storage.timestamps import parse_iso_datetime

MAX_UNIX_MS = 253402300799999
MAX_REVOKED_POINTS = 65536
MAX_UID_RANGES = 64
_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)
_HEX = re.compile(r"[0-9a-f]{32}\Z")
_META = "screen_context_activity_meta"
_POINTS = "screen_context_activity_revocations"
_IDENTITY_CHANGED = " OR ".join(f"OLD.{key} IS NOT NEW.{key}" for key in (
    "segment_uid", "platform", "source", "bundle_id", "window_title",
    "origin_device_id", "exclusion_source", "engagement_evidence", "confidence",
))
_OLD_START = "screen_ceil_ms(OLD.started_at)"
_NEW_START = "screen_ceil_ms(NEW.started_at)"
_OLD_END = "screen_ceil_ms(OLD.ended_at)"
_NEW_END = "screen_ceil_ms(NEW.ended_at)"
_UNKNOWN_CLOCK = " OR ".join(f"{value} IS NULL" for value in (
    _OLD_START, _NEW_START, _OLD_END, _NEW_END,
))
_CHECK = f"""SELECT CASE WHEN (SELECT COUNT(*) FROM {_META}
    WHERE id=1 AND version=1 AND length(epoch)=32) != 1
    THEN RAISE(ABORT, 'screen activity fence unavailable') END;"""
_BOUND = f"""
    INSERT OR IGNORE INTO {_POINTS}
      SELECT OLD.segment_uid, 0, {MAX_UNIX_MS} WHERE
      (SELECT COUNT(*) FROM {_POINTS} WHERE segment_uid=OLD.segment_uid) > {MAX_UID_RANGES};
    DELETE FROM {_POINTS} WHERE segment_uid=OLD.segment_uid
      AND NOT (from_ms=0 AND to_ms={MAX_UNIX_MS})
      AND EXISTS (SELECT 1 FROM {_POINTS} WHERE segment_uid=OLD.segment_uid
                  AND from_ms=0 AND to_ms={MAX_UNIX_MS});
    UPDATE {_META} SET epoch=lower(hex(randomblob(16)))
      WHERE (SELECT COUNT(*) FROM {_POINTS}) > {MAX_REVOKED_POINTS};
    DELETE FROM {_POINTS} WHERE (SELECT COUNT(*) FROM {_POINTS}) > {MAX_REVOKED_POINTS};
"""
SCHEMA = {
    _META: f"""CREATE TABLE {_META} (
      id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL CHECK(version=1),
      epoch TEXT NOT NULL CHECK(length(epoch)=32))""",
    _POINTS: f"""CREATE TABLE {_POINTS} (
      segment_uid TEXT NOT NULL, from_ms INTEGER NOT NULL, to_ms INTEGER NOT NULL,
      PRIMARY KEY(segment_uid, from_ms, to_ms),
      CHECK(typeof(from_ms)='integer' AND typeof(to_ms)='integer'
            AND from_ms>=0 AND to_ms<= {MAX_UNIX_MS} AND from_ms<to_ms))""",
    "screen_context_activity_delete": f"""CREATE TRIGGER screen_context_activity_delete
      AFTER DELETE ON activity_segments WHEN OLD.origin_device_id IS NULL
      AND length(OLD.segment_uid)=36 BEGIN
      {_CHECK}
      INSERT OR IGNORE INTO {_POINTS} VALUES(OLD.segment_uid, 0, {MAX_UNIX_MS});
      {_BOUND} END""",
    "screen_context_activity_update": f"""CREATE TRIGGER screen_context_activity_update
      AFTER UPDATE ON activity_segments WHEN OLD.origin_device_id IS NULL
      AND length(OLD.segment_uid)=36 AND (
        {_IDENTITY_CHANGED} OR OLD.started_at IS NOT NEW.started_at
        OR screen_end_shrunk(OLD.ended_at, NEW.ended_at)) BEGIN
      {_CHECK}
      INSERT OR IGNORE INTO {_POINTS}
        SELECT OLD.segment_uid, 0, {MAX_UNIX_MS}
        WHERE {_IDENTITY_CHANGED} OR {_UNKNOWN_CLOCK};
      INSERT OR IGNORE INTO {_POINTS}
        SELECT OLD.segment_uid, {_OLD_START}, {_NEW_START}
        WHERE {_NEW_START}>{_OLD_START};
      INSERT OR IGNORE INTO {_POINTS}
        SELECT OLD.segment_uid, {_NEW_END}, {_OLD_END}
        WHERE {_NEW_END}<{_OLD_END};
      {_BOUND} END""",
}


def _ceil_ms(value: object) -> int | None:
    if not isinstance(value, str) or len(value) > 64:
        return None
    try:
        stamp = parse_iso_datetime(value)
        if stamp.tzinfo is None:
            return None
        delta = stamp.astimezone(timezone.utc) - _EPOCH
        micros = (delta.days * 86400 + delta.seconds) * 1_000_000 + delta.microseconds
        result = -(-micros // 1000)
        return result if 0 <= result <= MAX_UNIX_MS else None
    except (ValueError, OverflowError):
        return None


def register_clock(connection: sqlite3.Connection) -> None:
    connection.create_function("screen_ceil_ms", 1, _ceil_ms, deterministic=True)
    connection.create_function("screen_end_shrunk", 2, _end_shrunk, deterministic=True)


def _end_shrunk(previous: object, current: object) -> bool:
    if previous == current:
        return False
    before, after = _ceil_ms(previous), _ceil_ms(current)
    return before is None or after is None or after < before


def _objects(connection: sqlite3.Connection) -> dict[str, str]:
    return dict(connection.execute(
        "SELECT name,sql FROM sqlite_master WHERE name LIKE 'screen_context_activity_%'"))


def _known_schema(objects: dict[str, str]) -> bool:
    return (set(objects) == set(SCHEMA)
            and all(isinstance(objects[key], str) and objects[key].strip() == value.strip()
                    for key, value in SCHEMA.items()))


def prepare(connection: sqlite3.Connection) -> str:
    """Native-only, already write-locked initialization; never commit for caller."""
    if not connection.in_transaction:
        raise ValueError("screen activity fence requires write transaction")
    objects = _objects(connection)
    if objects and not _known_schema(objects):
        raise ValueError("screen activity fence unavailable")
    register_clock(connection)
    if not objects:
        for sql in SCHEMA.values():
            connection.execute(sql)
        connection.execute(f"INSERT INTO {_META} VALUES(1,1,lower(hex(randomblob(16))))")
    return read_state(connection, ()).epoch


@dataclass(frozen=True)
class FenceState:
    epoch: str
    ranges: dict[str, tuple[tuple[int, int], ...]]


def read_state(connection: sqlite3.Connection, uids: tuple[str, ...]) -> FenceState:
    """Read in the caller's same snapshot as activity rows; no DDL or repair."""
    if not _known_schema(_objects(connection)) or len(uids) > 64:
        raise ValueError("screen activity fence unavailable")
    rows = connection.execute(f"SELECT id,version,epoch FROM {_META}").fetchall()
    if (len(rows) != 1 or rows[0][0] != 1 or rows[0][1] != 1
            or not isinstance(rows[0][2], str) or not _HEX.fullmatch(rows[0][2])):
        raise ValueError("screen activity fence unavailable")
    ranges: dict[str, list[tuple[int, int]]] = {}
    if uids:
        placeholders = ','.join('?' for _ in uids)
        points = connection.execute(
            f"SELECT segment_uid,from_ms,to_ms FROM {_POINTS} WHERE segment_uid IN ({placeholders}) "
            "ORDER BY segment_uid,from_ms,to_ms LIMIT 4097", uids).fetchall()
        if len(points) > 4096:
            raise ValueError("screen activity fence unavailable")
        for uid, start, end in points:
            if type(start) is not int or type(end) is not int or not 0 <= start < end <= MAX_UNIX_MS:
                raise ValueError("screen activity fence unavailable")
            values = ranges.setdefault(uid, [])
            if values and start <= values[-1][1]:
                values[-1] = (values[-1][0], max(end, values[-1][1]))
            else:
                values.append((start, end))
            if len(values) > MAX_UID_RANGES:
                raise ValueError("screen activity fence unavailable")
    return FenceState(rows[0][2], {uid: tuple(values) for uid, values in ranges.items()})


def invalidate_recovered(connection: sqlite3.Connection) -> None:
    """A supported backup restore cannot revive an older fence epoch."""
    objects = _objects(connection)
    if not objects:
        return
    if not _known_schema(objects):
        return  # A strict optional reader already refuses unknown/partial schema.
    if not connection.in_transaction:
        raise ValueError("screen activity fence unavailable")
    connection.execute(f"UPDATE {_META} SET epoch=lower(hex(randomblob(16)))")
    connection.execute(f"DELETE FROM {_POINTS}")
