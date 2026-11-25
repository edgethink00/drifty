"""Native-only, read-only activity references for local screen evidence.

The caller must supply this app's trusted tracker DB path and an identity hint
from its verified native capture, never from a WebView/provider. Digests prove
equality, not capture permission or account ownership. Those gates stay native.
No sampling, flush, schema change, raw title response, or telemetry occurs here.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import sqlite3
import stat
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterator, Sequence

from app.capture_platform import CAPTURE_PLATFORM
from app.storage.timestamps import parse_iso_datetime
from app.storage.screen_activity_fence import FenceState, _objects, read_state

_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)
_MAX_UNIX_MS = 253402300799999
_MAX_BIND_AGE_MS = 10_000
_MAX_CANDIDATES = 64
_MAX_RECORD_IDS = 64
_QUERY_BUDGET_SECONDS = 0.05
_TITLE_DOMAIN = b"drifty-window-title-v1\0"
_SITE_DOMAIN = b"drifty-site-v1\0"
_PRIVATE_WINDOW_POLICY_KEY = "capture_policy_private_windows"
_DIGEST = re.compile(r"[0-9a-f]{64}\Z")
_ID = re.compile(r"[1-9][0-9]{0,18}\Z")
_SOURCES = {"macos": frozenset({"accessibility"}),
            "windows": frozenset({"win32-foreground"})}
_COLUMNS = """id, segment_uid, started_at, ended_at, platform, source,
    bundle_id, window_title, origin_device_id, exclusion_source,
    engagement_evidence, confidence, site_domain, site_source"""
# Safari reports no private mode to scripting. Its address-bar read takes the
# focused window's title and address in one accessibility pass and records
# 0.8 only while the field is not being edited and the toolbar shows a
# tab-group control, which private windows never have in any UI language; so
# such a row vouches like a scripted tab. Other browsers' address-bar reads
# can miss a private window's mode, and lower confidences mean a guessed
# window, an incomplete address or a window that may be private.
_ADDRESS_BAR_VOUCHED_BUNDLES = frozenset({"com.apple.Safari", "com.apple.SafariTechnologyPreview"})


def _vouched(row: sqlite3.Row) -> bool:
    confidence = row["confidence"]
    return confidence == 1.0 or (confidence == 0.8
                                 and row["site_source"] == "accessibility-address-bar"
                                 and row["bundle_id"] in _ADDRESS_BAR_VOUCHED_BUNDLES)


@dataclass(frozen=True)
class CapturedWindowHint:
    app_key: str
    title_digest: str
    observed_at_ms: int


@dataclass(frozen=True)
class LocalActivityRecord:
    record_id: str
    segment_uid: str
    identity_digest: str
    started_at_ms: int
    ended_at_ms: int
    revoked_ranges: tuple[tuple[int, int], ...] = ()
    proof_version: int = 0
    # Digest of the row's site, only when private windows are known to leave
    # no row (tracker policy "skip"). Native memory uses it to admit a
    # browser capture before pixels; the domain itself never crosses IPC.
    site_digest: str | None = None

    def contains(self, observed_at_ms: int) -> bool:
        return (type(observed_at_ms) is int
                and self.started_at_ms <= observed_at_ms < self.ended_at_ms
                and not any(start <= observed_at_ms < end for start, end in self.revoked_ranges))


def _bounded_string(value: object, limit: int) -> bool:
    if not isinstance(value, str) or len(value) > limit or not value.strip():
        return False
    try:
        return (len(value.encode("utf-8")) <= limit
                and not any(ord(c) < 32 or ord(c) == 127 for c in value))
    except UnicodeError:
        return False


def window_title_digest(value: object) -> str | None:
    # Hash exactly the stored title. Never fold case, infer a filename, strip
    # a branded suffix, or collapse distinct Unicode/title values into one.
    if not _bounded_string(value, 2048):
        return None
    return hashlib.sha256(_TITLE_DOMAIN + value.encode("utf-8")).hexdigest()


def site_digest(value: object) -> str | None:
    if not _bounded_string(value, 253) or not value.isascii():
        return None
    return hashlib.sha256(_SITE_DOMAIN + value.strip().lower().encode("ascii")).hexdigest()


def _private_windows_skipped(conn: sqlite3.Connection) -> bool:
    # The tracker stores no private flag on a row. Only the skip policy makes
    # "a matching row exists" imply "this was not a private window".
    row = conn.execute("SELECT value FROM tracker_meta WHERE key=?", (_PRIVATE_WINDOW_POLICY_KEY,)).fetchone()
    return row is None or row[0] in (None, "skip")


def _timestamp(value: object) -> datetime | None:
    if not isinstance(value, str) or len(value) > 64:
        return None
    try:
        parsed = parse_iso_datetime(value)
        # Current local snapshots carry an offset. An unknown legacy clock
        # remains readable by ordinary tracking but cannot grant a screen link.
        if parsed.tzinfo is None:
            return None
        return parsed.astimezone(timezone.utc)
    except (ValueError, OverflowError):
        return None


def _ceil_millis(value: datetime) -> int:
    delta = value - _EPOCH
    micros = (delta.days * 86400 + delta.seconds) * 1_000_000 + delta.microseconds
    # Integer lattice equivalent to start <= millisecond observation < end;
    # do not truncate a submillisecond start into an earlier supported point.
    return -(-micros // 1000)


def _record_id(value: object) -> bool:
    return (isinstance(value, str) and _ID.fullmatch(value) is not None
            and int(value) <= 9223372036854775807)


def _record(row: sqlite3.Row, fence: FenceState | None = None,
            sites: bool = False, *, replay: bool = False) -> LocalActivityRecord | None:
    if (row["platform"] != CAPTURE_PLATFORM
            or row["source"] not in (_SOURCES.get(CAPTURE_PLATFORM, frozenset()) | (frozenset({"nsworkspace", "lsappinfo"}) if replay and CAPTURE_PLATFORM == "macos" else frozenset()))
            or row["origin_device_id"] is not None
            or row["exclusion_source"] is not None
            or row["engagement_evidence"] is not None
            or (not replay and not _vouched(row))
            or (replay and (not isinstance(row["confidence"], (int, float))
                            or not math.isfinite(row["confidence"])
                            or not 0 <= row["confidence"] <= 1))
            or not _bounded_string(row["bundle_id"], 2048)):
        return None
    record_id = str(row["id"])
    uid = row["segment_uid"]
    if not _record_id(record_id) or not isinstance(uid, str) or len(uid) != 36:
        return None
    try:
        parsed_uid = uuid.UUID(uid)
        if str(parsed_uid) != uid or parsed_uid.int == 0:
            return None
    except ValueError:
        return None
    title_digest = (hashlib.sha256(json.dumps([row["window_title"], row["source"], row["confidence"]], ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
                    if replay else window_title_digest(row["window_title"]))
    start, end = _timestamp(row["started_at"]), _timestamp(row["ended_at"])
    if title_digest is None or start is None or end is None or end <= start:
        return None
    start_ms, end_ms = _ceil_millis(start), _ceil_millis(end)
    if start_ms < 0 or end_ms > _MAX_UNIX_MS or end_ms <= start_ms:
        return None
    identity_fields = ["tracker-replay-record-v1" if replay else "tracker-local-record-v1", record_id, uid,
                       row["platform"], row["source"], row["bundle_id"], title_digest]
    if fence is not None:
        identity_fields.extend(["point-fence-v1", fence.epoch])
    identity = json.dumps(identity_fields,
                          ensure_ascii=False, separators=(",", ":"))
    return LocalActivityRecord(record_id, uid, hashlib.sha256(identity.encode()).hexdigest(),
                               start_ms, end_ms, () if fence is None else fence.ranges.get(uid, ()),
                               0 if fence is None else 1,
                               site_digest(row["site_domain"]) if sites else None)


def _current_fence(conn: sqlite3.Connection, rows: Sequence[sqlite3.Row], required: bool) -> FenceState | None:
    if not required and not _objects(conn):
        return None  # Legacy direct reference tests/tools grant no native IPC authority.
    uids = tuple(dict.fromkeys(row["segment_uid"] for row in rows
                              if isinstance(row["segment_uid"], str)))
    return read_state(conn, uids)


@contextmanager
def _read_connection(path: Path) -> Iterator[tuple[sqlite3.Connection, float]]:
    # Do not initialize a tracker or its schema merely to resolve a link.
    if not path.is_absolute():
        raise ValueError("screen_activity_unavailable")
    metadata = path.lstat()
    if (not stat.S_ISREG(metadata.st_mode) or path.is_symlink()
            or getattr(metadata, "st_file_attributes", 0) & 0x400):
        raise ValueError("screen_activity_unavailable")
    deadline = time.monotonic() + _QUERY_BUDGET_SECONDS
    # https://docs.python.org/3/library/sqlite3.html#how-to-work-with-sqlite-uris
    conn = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=0.05)
    try:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA query_only=ON")
        conn.execute("PRAGMA busy_timeout=50")
        conn.set_progress_handler(lambda: int(time.monotonic() >= deadline), 1000)
        conn.create_function("screen_title_digest", 1, window_title_digest, deterministic=True)
        conn.execute("BEGIN")  # Activity rows, epoch and revocations share one read snapshot.
        yield conn, deadline
    finally:
        conn.close()


def resolve_capture_record(
    path: Path, hint: CapturedWindowHint, *, now_ms: int | None = None, require_fence: bool = False,
) -> LocalActivityRecord | None:
    """Return one complete, local identity/range match, otherwise no link.

    This is intentionally not a title/time search API. A fixed native caller
    supplies a capture-verified app and exact title digest. A still-uncovered
    point can be retried after normal tracking extends the row; never flush it
    or invent elapsed time to obtain a match. Ambiguity and incomplete scans
    cannot select a first/best row.
    """
    current = time.time_ns() // 1_000_000 if now_ms is None else now_ms
    if (not isinstance(hint, CapturedWindowHint)
            or not _bounded_string(hint.app_key, 2048)
            or not isinstance(hint.title_digest, str)
            or _DIGEST.fullmatch(hint.title_digest) is None
            or type(hint.observed_at_ms) is not int or type(current) is not int
            or not 0 <= hint.observed_at_ms <= current <= _MAX_UNIX_MS
            or current - hint.observed_at_ms > _MAX_BIND_AGE_MS):
        return None
    observed = _EPOCH + timedelta(milliseconds=hint.observed_at_ms)
    iso = observed.isoformat()
    try:
        with _read_connection(path) as (conn, deadline):
            if time.monotonic() >= deadline:
                return None
            # SQLite datetime() has second precision without subsec. Use it
            # only as an indexed, conservative candidate filter, then check
            # the exact stored offsets/fractions on the integer-ms lattice.
            # https://www.sqlite.org/lang_datefunc.html
            rows = conn.execute(f"""SELECT {_COLUMNS} FROM activity_segments
                WHERE origin_device_id IS NULL AND platform=? AND bundle_id=?
                  AND datetime(started_at)<=datetime(?)
                  AND datetime(ended_at)>=datetime(?)
                  AND CASE WHEN length(window_title)<=2048
                           THEN screen_title_digest(window_title) END=?
                LIMIT ?""", (CAPTURE_PLATFORM, hint.app_key, iso, iso,
                              hint.title_digest, _MAX_CANDIDATES + 1)).fetchall()
            if len(rows) > _MAX_CANDIDATES or time.monotonic() >= deadline:
                return None
            fence = _current_fence(conn, rows, require_fence)
            sites = _private_windows_skipped(conn)
            matches = [ref for row in rows if (ref := _record(row, fence, sites)) is not None
                       and ref.contains(hint.observed_at_ms)]
            return matches[0] if len(matches) == 1 and time.monotonic() < deadline else None
    except (OSError, sqlite3.Error, UnicodeError, ValueError, OverflowError):
        # Optional screen linkage must not echo a title/path/SQL error or send
        # raw request locals through the tracker's generic exception reporter.
        return None


def read_local_record_refs(path: Path, record_ids: Sequence[str], *, require_fence: bool = False,
                           authoritative: bool = False, replay: bool = False) -> tuple[LocalActivityRecord, ...]:
    """Re-resolve current IDs for native guarded reads; no raw content returned.

    A caller must compare UID, identity digest AND current point containment to
    its stored binding. A reused SQLite integer alone never revives a binding.
    Native account/exclusion/deletion/expiry checks are still required afterward.
    Authoritative reads distinguish unavailable storage from confirmed missing
    rows: memory reconciliation must never treat a timeout as deletion.
    """
    if (not isinstance(record_ids, (list, tuple)) or not record_ids
            or len(record_ids) > _MAX_RECORD_IDS
            or any(not _record_id(value) for value in record_ids)
            or len(set(record_ids)) != len(record_ids)):
        return ()
    try:
        with _read_connection(path) as (conn, deadline):
            if time.monotonic() >= deadline:
                raise ValueError("screen_activity_unavailable")
            placeholders = ",".join("?" for _ in record_ids)
            rows = conn.execute(f"SELECT {_COLUMNS} FROM activity_segments WHERE id IN ({placeholders})",
                                tuple(int(value) for value in record_ids)).fetchall()
            if time.monotonic() >= deadline:
                raise ValueError("screen_activity_unavailable")
            fence = _current_fence(conn, rows, require_fence)
            refs = {ref.record_id: ref for row in rows if (ref := _record(row, fence, replay=replay)) is not None}
            if time.monotonic() >= deadline:
                raise ValueError("screen_activity_unavailable")
            return tuple(refs[value] for value in record_ids if value in refs)
    except (OSError, sqlite3.Error, UnicodeError, ValueError, OverflowError):
        if authoritative:
            raise ValueError("screen_activity_unavailable") from None
        return ()
