"""Durable, already-decided idle trims. No activity or cross-process clocks."""
from __future__ import annotations

import json
from dataclasses import asdict

from app.storage.timestamps import parse_iso_datetime
from app.tracker.capture_timeline import CaptureTiming, CaptureTrim


def ensure_schema(conn) -> None:
    conn.execute("""CREATE TABLE IF NOT EXISTS pending_capture_cleanup (
        segment_uid TEXT PRIMARY KEY NOT NULL,
        plan_json TEXT NOT NULL
    )""")
    # Deleting/replacing a row revokes its old plan, even if an importer later
    # reuses the same UID and timestamps. Timing/origin changes revoke it too.
    conn.execute("""CREATE TRIGGER IF NOT EXISTS capture_cleanup_deleted
        AFTER DELETE ON activity_segments BEGIN
        DELETE FROM pending_capture_cleanup WHERE segment_uid=OLD.segment_uid;
        END""")
    # SQLite REPLACE can skip DELETE triggers when recursive_triggers is off.
    # Every inserted generation revokes an older plan for the same UID too.
    conn.execute("""CREATE TRIGGER IF NOT EXISTS capture_cleanup_inserted
        AFTER INSERT ON activity_segments BEGIN
        DELETE FROM pending_capture_cleanup WHERE segment_uid=NEW.segment_uid;
        END""")
    conn.execute("""CREATE TRIGGER IF NOT EXISTS capture_cleanup_changed
        AFTER UPDATE OF segment_uid, started_at, ended_at, duration_seconds,
                        origin_device_id, source, engagement_evidence ON activity_segments BEGIN
        DELETE FROM pending_capture_cleanup WHERE segment_uid=OLD.segment_uid;
        END""")


def _timing(value) -> CaptureTiming:
    if not isinstance(value, dict) or set(value) != set(CaptureTiming.__dataclass_fields__):
        raise ValueError("invalid cleanup timing")
    result = CaptureTiming(**value)
    if (type(result.segment_id) is not int or result.segment_id <= 0
            or type(result.duration_seconds) is not int or result.duration_seconds < 0
            or not isinstance(result.segment_uid, str) or not result.segment_uid
            or len(result.segment_uid) > 128):
        raise ValueError("invalid cleanup identity")
    for stamp in (result.started_at, result.ended_at):
        if not isinstance(stamp, str) or parse_iso_datetime(stamp).tzinfo is None:
            raise ValueError("invalid cleanup timestamp")
    return result


def decode(encoded: str) -> CaptureTrim:
    if len(encoded) > 4096:
        raise ValueError("oversized cleanup plan")
    value = json.loads(encoded)
    if not isinstance(value, dict) or set(value) != {"version", "expected", "target"} or value["version"] != 1:
        raise ValueError("unsupported cleanup plan")
    expected = _timing(value["expected"])
    target = _timing(value["target"]) if value["target"] is not None else None
    if target is not None and (
        (target.segment_id, target.segment_uid, target.started_at)
        != (expected.segment_id, expected.segment_uid, expected.started_at)
        or target.duration_seconds > expected.duration_seconds
        or parse_iso_datetime(target.ended_at) < parse_iso_datetime(target.started_at)
    ):
        raise ValueError("cleanup cannot expand or replace a record")
    return CaptureTrim(expected, target)


def encode(trim: CaptureTrim) -> str:
    result = json.dumps({"version": 1, **asdict(trim)}, sort_keys=True, separators=(",", ":"))
    decode(result)
    return result


def save(conn, trims: list[CaptureTrim]) -> None:
    for trim in trims:
        conn.execute("INSERT INTO pending_capture_cleanup VALUES (?, ?) "
                     "ON CONFLICT(segment_uid) DO UPDATE SET plan_json=excluded.plan_json",
                     (trim.expected.segment_uid, encode(trim)))


def load(conn) -> list[CaptureTrim]:
    plans = []
    for row in conn.execute("SELECT segment_uid, plan_json FROM pending_capture_cleanup"):
        try:
            trim = decode(row["plan_json"])
            if trim.expected.segment_uid == row["segment_uid"]:
                plans.append(trim)
        except (ValueError, TypeError, OverflowError):
            # Malformed/unknown plans never grant deletion authority. Leave
            # them for diagnosis, without blocking unrelated supported capture.
            continue
    return plans


def acknowledge(conn, trims: list[CaptureTrim]) -> None:
    for trim in trims:
        conn.execute("DELETE FROM pending_capture_cleanup WHERE segment_uid=? AND plan_json=?",
                     (trim.expected.segment_uid, encode(trim)))


def active(conn, trims: list[CaptureTrim]) -> list[CaptureTrim]:
    return [trim for trim in trims if conn.execute(
        "SELECT 1 FROM pending_capture_cleanup WHERE segment_uid=? AND plan_json=?",
        (trim.expected.segment_uid, encode(trim))).fetchone() is not None]
