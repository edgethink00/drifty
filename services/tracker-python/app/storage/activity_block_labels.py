"""Local user choices for timeline blocks.

A user label records what the user decided for one Day/Week block: today only
"hide the task name" (an empty title). It is stored locally only, next to the
activity it describes, and is never part of device sync or any shared surface.
It keeps links to its records, follows the remaining ones when some are
deleted, and disappears with the last.

AI descriptions live in their own tables (activity_timeline_cards.py). Rows
with source 'ai' were written only by unreleased builds and are removed when
the schema is opened.
"""

from __future__ import annotations

import re
import sqlite3
from datetime import datetime, timezone
from typing import Any, Callable, Optional

ACTIVITY_BLOCK_LABEL_SCHEMA = """
CREATE TABLE IF NOT EXISTS activity_block_labels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  block_key TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('ai', 'user')),
  logical_day TEXT NOT NULL,
  block_started_at TEXT NOT NULL,
  block_ended_at TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  evidence_fingerprint TEXT,
  reason TEXT,
  language TEXT,
  model TEXT,
  provider TEXT,
  prompt_version TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(block_key, source)
);

CREATE INDEX IF NOT EXISTS idx_activity_block_labels_range
ON activity_block_labels(block_started_at, block_ended_at);

CREATE TABLE IF NOT EXISTS activity_block_label_segments (
  label_id INTEGER NOT NULL REFERENCES activity_block_labels(id) ON DELETE CASCADE,
  segment_id INTEGER NOT NULL REFERENCES activity_segments(id) ON DELETE CASCADE,
  PRIMARY KEY (label_id, segment_id)
);

CREATE INDEX IF NOT EXISTS idx_activity_block_label_segments_segment
ON activity_block_label_segments(segment_id);

-- AI text may quote the deleted record's title: drop the whole label first.
CREATE TRIGGER IF NOT EXISTS trg_activity_block_labels_ai_segment_delete
BEFORE DELETE ON activity_segments
BEGIN
  DELETE FROM activity_block_labels
  WHERE source = 'ai'
    AND id IN (SELECT label_id FROM activity_block_label_segments WHERE segment_id = OLD.id);
END;

-- A user label outlives partial deletion but not the last record it describes.
CREATE TRIGGER IF NOT EXISTS trg_activity_block_labels_orphan
AFTER DELETE ON activity_block_label_segments
WHEN NOT EXISTS (SELECT 1 FROM activity_block_label_segments WHERE label_id = OLD.label_id)
BEGIN
  DELETE FROM activity_block_labels WHERE id = OLD.label_id;
END;
"""

MAX_KEY_LENGTH = 160
MAX_USER_TITLE_LENGTH = 80
MAX_USER_DESCRIPTION_LENGTH = 300
MAX_META_LENGTH = 120
MAX_SEGMENTS_PER_LABEL = 2000
SEGMENT_QUERY_BATCH = 400
_DAY_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class ActivityBlockLabelError(ValueError):
    pass


def ensure_activity_block_label_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(ACTIVITY_BLOCK_LABEL_SCHEMA)
    # Timeline cards moved to activity_timeline_* tables before any release.
    conn.execute("DELETE FROM activity_block_labels WHERE source = 'ai'")


def _text(value: Any, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    collapsed = " ".join(value.split())
    return collapsed[:limit]


def _optional_text(value: Any, limit: int = MAX_META_LENGTH) -> Optional[str]:
    text = _text(value, limit)
    return text or None


def _iso(value: Any, parse: Callable[[str], datetime]) -> Optional[str]:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = parse(value.strip())
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.astimezone()
    return parsed.astimezone(timezone.utc).isoformat()


def _segment_ids(value: Any) -> list[int]:
    if not isinstance(value, list):
        return []
    ids = []
    for item in value[:MAX_SEGMENTS_PER_LABEL]:
        text = str(item).strip()
        if text.isdecimal():
            ids.append(int(text))
    return sorted(set(ids))


def _existing_segment_ids(conn: sqlite3.Connection, ids: list[int]) -> set[int]:
    found: set[int] = set()
    for start in range(0, len(ids), SEGMENT_QUERY_BATCH):
        batch = ids[start:start + SEGMENT_QUERY_BATCH]
        placeholders = ",".join("?" for _ in batch)
        for row in conn.execute(f"SELECT id FROM activity_segments WHERE id IN ({placeholders})", tuple(batch)):
            found.add(int(row[0]))
    return found


def _block_fields(item: dict[str, Any], parse: Callable[[str], datetime]) -> Optional[dict[str, Any]]:
    block_key = _text(item.get("blockKey"), MAX_KEY_LENGTH)
    logical_day = _text(item.get("logicalDay"), 10)
    started_at = _iso(item.get("blockStartedAt"), parse)
    ended_at = _iso(item.get("blockEndedAt"), parse)
    segment_ids = _segment_ids(item.get("segmentIds"))
    if not block_key or not _DAY_PATTERN.match(logical_day) or not started_at or not ended_at or not segment_ids:
        return None
    if ended_at <= started_at:
        return None
    return {
        "block_key": block_key,
        "logical_day": logical_day,
        "block_started_at": started_at,
        "block_ended_at": ended_at,
        "segment_ids": segment_ids,
    }


def _replace_links(conn: sqlite3.Connection, label_id: int, segment_ids: list[int]) -> None:
    # Insert before removing so the label never passes through zero links,
    # which the orphan trigger would treat as deletion of its last record.
    conn.executemany(
        "INSERT OR IGNORE INTO activity_block_label_segments(label_id, segment_id) VALUES (?, ?)",
        [(label_id, segment_id) for segment_id in segment_ids],
    )
    keep = set(segment_ids)
    stale = [
        int(row[0])
        for row in conn.execute(
            "SELECT segment_id FROM activity_block_label_segments WHERE label_id = ?", (label_id,)
        )
        if int(row[0]) not in keep
    ]
    conn.executemany(
        "DELETE FROM activity_block_label_segments WHERE label_id = ? AND segment_id = ?",
        [(label_id, segment_id) for segment_id in stale],
    )


def _upsert_label(conn: sqlite3.Connection, source: str, block: dict[str, Any], values: dict[str, Any], timestamp: str) -> int:
    conn.execute(
        """
        INSERT INTO activity_block_labels (
          block_key, source, logical_day, block_started_at, block_ended_at, status, title, description,
          evidence_fingerprint, reason, language, model, provider, prompt_version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(block_key, source) DO UPDATE SET
          logical_day = excluded.logical_day,
          block_started_at = excluded.block_started_at,
          block_ended_at = excluded.block_ended_at,
          status = excluded.status,
          title = excluded.title,
          description = excluded.description,
          evidence_fingerprint = excluded.evidence_fingerprint,
          reason = excluded.reason,
          language = excluded.language,
          model = excluded.model,
          provider = excluded.provider,
          prompt_version = excluded.prompt_version,
          updated_at = excluded.updated_at
        """,
        (
            block["block_key"], source, block["logical_day"], block["block_started_at"], block["block_ended_at"],
            values["status"], values["title"], values["description"], values.get("evidence_fingerprint"),
            values.get("reason"), values.get("language"), values.get("model"), values.get("provider"),
            values.get("prompt_version"), timestamp, timestamp,
        ),
    )
    row = conn.execute(
        "SELECT id FROM activity_block_labels WHERE block_key = ? AND source = ?", (block["block_key"], source)
    ).fetchone()
    return int(row[0])


def save_user_label(
    conn: sqlite3.Connection,
    item: Any,
    previous_block_key: Any,
    parse: Callable[[str], datetime],
) -> dict[str, Any]:
    """Store the user's own name for a block. An empty title hides the label."""
    if not isinstance(item, dict):
        raise ActivityBlockLabelError("label must be an object")
    block = _block_fields(item, parse)
    if block is None:
        raise ActivityBlockLabelError("label needs a block key, logical day, bounds and records")
    title = _text(item.get("title"), MAX_USER_TITLE_LENGTH)
    description = _text(item.get("description"), MAX_USER_DESCRIPTION_LENGTH) if title else ""
    if not conn.in_transaction:
        conn.execute("BEGIN IMMEDIATE")
    existing = sorted(_existing_segment_ids(conn, block["segment_ids"]))
    if not existing:
        raise ActivityBlockLabelError("the records for this block no longer exist")
    block = {**block, "segment_ids": existing}
    previous = _text(previous_block_key, MAX_KEY_LENGTH)
    if previous and previous != block["block_key"]:
        # The edit replaces a label carried over from an earlier grouping.
        conn.execute("DELETE FROM activity_block_labels WHERE block_key = ? AND source = 'user'", (previous,))
    timestamp = datetime.now(timezone.utc).isoformat()
    label_id = _upsert_label(conn, "user", block, {
        "status": "user" if title else "hidden",
        "title": title,
        "description": description,
    }, timestamp)
    _replace_links(conn, label_id, existing)
    rows = _select_labels(conn, "WHERE l.id = ?", [label_id])
    return rows[0]


def delete_user_label(conn: sqlite3.Connection, block_key: Any) -> dict[str, int]:
    key = _text(block_key, MAX_KEY_LENGTH)
    if not key:
        raise ActivityBlockLabelError("blockKey is required")
    cursor = conn.execute("DELETE FROM activity_block_labels WHERE block_key = ? AND source = 'user'", (key,))
    return {"deleted": cursor.rowcount}


def _select_labels(conn: sqlite3.Connection, where: str, params: list[Any]) -> list[dict[str, Any]]:
    rows = conn.execute(
        f"""
        SELECT l.*, GROUP_CONCAT(s.segment_id) AS segment_ids
        FROM activity_block_labels l
        LEFT JOIN activity_block_label_segments s ON s.label_id = l.id
        {where}
        GROUP BY l.id
        ORDER BY l.block_started_at ASC, l.source ASC
        """,
        params,
    ).fetchall()
    result = []
    for row in rows:
        segment_ids = sorted((str(value) for value in (row["segment_ids"] or "").split(",") if value), key=int)
        result.append({
            "blockKey": row["block_key"],
            "source": row["source"],
            "logicalDay": row["logical_day"],
            "blockStartedAt": row["block_started_at"],
            "blockEndedAt": row["block_ended_at"],
            "segmentIds": segment_ids,
            "status": row["status"],
            "title": row["title"],
            "description": row["description"],
            "evidenceFingerprint": row["evidence_fingerprint"],
            "reason": row["reason"],
            "language": row["language"],
            "model": row["model"],
            "provider": row["provider"],
            "promptVersion": row["prompt_version"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        })
    return result


def get_labels(conn: sqlite3.Connection, start: Optional[str], end: Optional[str]) -> list[dict[str, Any]]:
    clauses = ["l.source = 'user'"]
    params: list[Any] = []
    if start:
        clauses.append("datetime(l.block_ended_at) > datetime(?)")
        params.append(start)
    if end:
        clauses.append("datetime(l.block_started_at) < datetime(?)")
        params.append(end)
    return _select_labels(conn, "WHERE " + " AND ".join(clauses), params)


