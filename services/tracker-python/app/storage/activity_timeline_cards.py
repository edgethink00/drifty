"""Local timeline cards: AI descriptions of finished activity windows.

A window is one stretch of activity (a session split at 20-minute breaks, at
most three hours), described once per language. Its cards say what the
stretch was about over ranges of its records, and each card keeps its
details: the activities the model tallied before naming it, each with the
records it covers. All are stored locally only, never synced or shared, with
links to the records they came from:

* deleting any record of a window removes the window and its cards, so the
  window is described again from the records that remain;
* a newer window in the same language replaces the windows it overlaps.

User choices for blocks (hide a name) stay in activity_block_labels.
"""

from __future__ import annotations

import json
import re
import sqlite3
from datetime import datetime, timezone
from typing import Any, Callable, Optional

ACTIVITY_TIMELINE_CARD_SCHEMA = """
CREATE TABLE IF NOT EXISTS activity_timeline_windows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  window_key TEXT NOT NULL,
  language TEXT NOT NULL,
  logical_day TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  model TEXT,
  provider TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(window_key, language)
);

CREATE INDEX IF NOT EXISTS idx_activity_timeline_windows_range
ON activity_timeline_windows(started_at, ended_at);

CREATE TABLE IF NOT EXISTS activity_timeline_window_segments (
  window_id INTEGER NOT NULL REFERENCES activity_timeline_windows(id) ON DELETE CASCADE,
  segment_id INTEGER NOT NULL REFERENCES activity_segments(id) ON DELETE CASCADE,
  PRIMARY KEY (window_id, segment_id)
);

CREATE INDEX IF NOT EXISTS idx_activity_timeline_window_segments_segment
ON activity_timeline_window_segments(segment_id);

CREATE TABLE IF NOT EXISTS activity_timeline_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  window_id INTEGER NOT NULL REFERENCES activity_timeline_windows(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ready', 'limited')),
  variant TEXT NOT NULL CHECK (variant IN ('strict', 'partial', 'apps')),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '[]',
  UNIQUE(window_id, position)
);

CREATE TABLE IF NOT EXISTS activity_timeline_card_segments (
  card_id INTEGER NOT NULL REFERENCES activity_timeline_cards(id) ON DELETE CASCADE,
  segment_id INTEGER NOT NULL REFERENCES activity_segments(id) ON DELETE CASCADE,
  PRIMARY KEY (card_id, segment_id)
);

-- Card text may quote a deleted record's title: drop its whole window first.
CREATE TRIGGER IF NOT EXISTS trg_activity_timeline_windows_segment_delete
BEFORE DELETE ON activity_segments
BEGIN
  DELETE FROM activity_timeline_windows
  WHERE id IN (SELECT window_id FROM activity_timeline_window_segments WHERE segment_id = OLD.id);
END;
"""

CARD_STATUSES = {"ready", "limited"}
CARD_VARIANTS = {"strict", "partial", "apps"}
MAX_KEY_LENGTH = 160
MAX_TITLE_LENGTH = 80
MAX_DESCRIPTION_LENGTH = 240
MAX_META_LENGTH = 120
MAX_CARDS_PER_WINDOW = 64
MAX_DETAILS_PER_CARD = 12
MAX_DETAIL_LENGTH = 80
MAX_SEGMENTS_PER_WINDOW = 2000
SEGMENT_QUERY_BATCH = 400
_DAY_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def ensure_activity_timeline_card_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(ACTIVITY_TIMELINE_CARD_SCHEMA)
    columns = {row[1] for row in conn.execute("PRAGMA table_info(activity_timeline_cards)")}
    if "details" not in columns:
        # Cards stored before details were kept read back with none.
        conn.execute("ALTER TABLE activity_timeline_cards ADD COLUMN details TEXT NOT NULL DEFAULT '[]'")


def _text(value: Any, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    return " ".join(value.split())[:limit]


def _optional_text(value: Any, limit: int = MAX_META_LENGTH) -> Optional[str]:
    return _text(value, limit) or None


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
    for item in value[:MAX_SEGMENTS_PER_WINDOW]:
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


def _details(value: Any, card_ids: set[int]) -> list[dict[str, Any]]:
    """Each detail names an activity, the card's records it covers and whether
    the card's title names it; others are dropped."""
    if not isinstance(value, list):
        return []
    details = []
    for item in value[:MAX_DETAILS_PER_CARD]:
        if not isinstance(item, dict):
            continue
        activity = _text(item.get("activity"), MAX_DETAIL_LENGTH)
        segment_ids = [segment_id for segment_id in _segment_ids(item.get("segmentIds")) if segment_id in card_ids]
        if activity and segment_ids:
            details.append({
                "activity": activity,
                "segmentIds": [str(segment_id) for segment_id in segment_ids],
                "named": item.get("named") is True,
            })
    return details


def _read_details(value: Any) -> list[dict[str, Any]]:
    try:
        parsed = json.loads(value or "[]")
    except (TypeError, ValueError):
        return []
    if not isinstance(parsed, list):
        return []
    return [
        {"activity": item["activity"], "segmentIds": item["segmentIds"], "named": item.get("named") is True}
        for item in parsed
        if isinstance(item, dict) and isinstance(item.get("activity"), str) and isinstance(item.get("segmentIds"), list)
    ]


def _card_fields(item: Any, window_ids: set[int], parse: Callable[[str], datetime]) -> Optional[dict[str, Any]]:
    if not isinstance(item, dict):
        return None
    started_at = _iso(item.get("startedAt"), parse)
    ended_at = _iso(item.get("endedAt"), parse)
    status = item.get("status")
    variant = item.get("variant")
    title = _text(item.get("title"), MAX_TITLE_LENGTH)
    segment_ids = [segment_id for segment_id in _segment_ids(item.get("segmentIds")) if segment_id in window_ids]
    if not started_at or not ended_at or ended_at <= started_at or not title or not segment_ids:
        return None
    if status not in CARD_STATUSES or variant not in CARD_VARIANTS:
        return None
    return {
        "started_at": started_at,
        "ended_at": ended_at,
        "status": status,
        "variant": variant,
        "title": title,
        "description": _text(item.get("description"), MAX_DESCRIPTION_LENGTH),
        "segment_ids": segment_ids,
        "details": _details(item.get("details"), set(segment_ids)),
    }


def save_window(conn: sqlite3.Connection, item: Any, parse: Callable[[str], datetime]) -> dict[str, int]:
    """Store one described window with its cards; a window with no cards is
    still stored so the same stretch is not asked about again."""
    skipped = {"saved": 0, "replaced": 0, "cards": 0}
    if not isinstance(item, dict):
        return skipped
    window_key = _text(item.get("windowKey"), MAX_KEY_LENGTH)
    language = _text(item.get("language"), 8)
    logical_day = _text(item.get("logicalDay"), 10)
    started_at = _iso(item.get("startedAt"), parse)
    ended_at = _iso(item.get("endedAt"), parse)
    prompt_version = _text(item.get("promptVersion"), 64)
    segment_ids = _segment_ids(item.get("segmentIds"))
    if not window_key or not language or not _DAY_PATTERN.match(logical_day) or not prompt_version or not segment_ids:
        return skipped
    if not started_at or not ended_at or ended_at <= started_at:
        return skipped
    raw_cards = item.get("cards")
    if not isinstance(raw_cards, list):
        return skipped
    window_ids = set(segment_ids)
    cards = [card for card in (_card_fields(raw, window_ids, parse) for raw in raw_cards[:MAX_CARDS_PER_WINDOW]) if card]
    if not conn.in_transaction:
        conn.execute("BEGIN IMMEDIATE")
    if _existing_segment_ids(conn, segment_ids) != window_ids:
        # A record was deleted while the window was being described.
        return skipped
    replaced = conn.execute(
        """
        DELETE FROM activity_timeline_windows
        WHERE language = ?
          AND (window_key = ? OR (datetime(started_at) < datetime(?) AND datetime(ended_at) > datetime(?)))
        """,
        (language, window_key, ended_at, started_at),
    ).rowcount
    timestamp = datetime.now(timezone.utc).isoformat()
    cursor = conn.execute(
        """
        INSERT INTO activity_timeline_windows (
          window_key, language, logical_day, started_at, ended_at, prompt_version, model, provider, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            window_key, language, logical_day, started_at, ended_at, prompt_version,
            _optional_text(item.get("model")), _optional_text(item.get("provider"), 32), timestamp,
        ),
    )
    window_id = int(cursor.lastrowid)
    conn.executemany(
        "INSERT INTO activity_timeline_window_segments(window_id, segment_id) VALUES (?, ?)",
        [(window_id, segment_id) for segment_id in segment_ids],
    )
    for position, card in enumerate(cards):
        card_cursor = conn.execute(
            """
            INSERT INTO activity_timeline_cards (
              window_id, position, started_at, ended_at, status, variant, title, description, details
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                window_id, position, card["started_at"], card["ended_at"], card["status"], card["variant"],
                card["title"], card["description"], json.dumps(card["details"], ensure_ascii=False),
            ),
        )
        card_id = int(card_cursor.lastrowid)
        conn.executemany(
            "INSERT INTO activity_timeline_card_segments(card_id, segment_id) VALUES (?, ?)",
            [(card_id, segment_id) for segment_id in card["segment_ids"]],
        )
    return {"saved": 1, "replaced": max(0, replaced), "cards": len(cards)}


def get_windows(conn: sqlite3.Connection, start: Optional[str], end: Optional[str]) -> list[dict[str, Any]]:
    clauses = []
    params: list[Any] = []
    if start:
        clauses.append("datetime(w.ended_at) > datetime(?)")
        params.append(start)
    if end:
        clauses.append("datetime(w.started_at) < datetime(?)")
        params.append(end)
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    windows = conn.execute(
        f"SELECT w.* FROM activity_timeline_windows w {where} ORDER BY w.started_at ASC, w.id ASC",
        params,
    ).fetchall()
    if not windows:
        return []
    by_id: dict[int, dict[str, Any]] = {}
    for row in windows:
        by_id[int(row["id"])] = {
            "windowKey": row["window_key"],
            "language": row["language"],
            "logicalDay": row["logical_day"],
            "startedAt": row["started_at"],
            "endedAt": row["ended_at"],
            "promptVersion": row["prompt_version"],
            "model": row["model"],
            "provider": row["provider"],
            "createdAt": row["created_at"],
            "cards": [],
        }
    ids = list(by_id)
    for offset in range(0, len(ids), SEGMENT_QUERY_BATCH):
        batch = ids[offset:offset + SEGMENT_QUERY_BATCH]
        placeholders = ",".join("?" for _ in batch)
        rows = conn.execute(
            f"""
            SELECT c.*, GROUP_CONCAT(s.segment_id) AS segment_ids
            FROM activity_timeline_cards c
            LEFT JOIN activity_timeline_card_segments s ON s.card_id = c.id
            WHERE c.window_id IN ({placeholders})
            GROUP BY c.id
            ORDER BY c.window_id ASC, c.position ASC
            """,
            tuple(batch),
        ).fetchall()
        for row in rows:
            segment_ids = sorted((value for value in (row["segment_ids"] or "").split(",") if value), key=int)
            by_id[int(row["window_id"])]["cards"].append({
                "position": int(row["position"]),
                "startedAt": row["started_at"],
                "endedAt": row["ended_at"],
                "status": row["status"],
                "variant": row["variant"],
                "title": row["title"],
                "description": row["description"],
                "segmentIds": segment_ids,
                "details": _read_details(row["details"]),
            })
    return list(by_id.values())


def delete_windows_for_segments(conn: sqlite3.Connection, segment_subquery: Optional[str], params: tuple[Any, ...]) -> None:
    """Part of deleting AI results: remove the windows (and cards) of the selected records."""
    if segment_subquery is None:
        conn.execute("DELETE FROM activity_timeline_windows")
        return
    conn.execute(
        "DELETE FROM activity_timeline_windows WHERE id IN ("
        f"SELECT window_id FROM activity_timeline_window_segments WHERE segment_id IN ({segment_subquery}))",
        params,
    )
