"""Account-scoped receive barriers; never part of the sync push outbox."""
from __future__ import annotations

import json
import sqlite3
from typing import Any


def ensure_received_deletion_schema(conn: sqlite3.Connection) -> None:
    # Old applied_sync_deletions rows contain only an id and must remain intact.
    # A subsequent tombstone replay supplies their missing target without
    # repeating a range deletion over freshly captured local history.
    conn.execute("""
        CREATE TABLE IF NOT EXISTS received_sync_deletions (
          account_id TEXT NOT NULL,
          deletion_uid TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('range', 'uids')),
          range_start TEXT,
          range_end TEXT,
          segment_uids_json TEXT,
          PRIMARY KEY (account_id, deletion_uid)
        )
    """)


def sync_account_scope(conn: sqlite3.Connection) -> str:
    row = conn.execute("SELECT value FROM tracker_meta WHERE key = 'sync_account_id'").fetchone()
    return row[0] if row and row[0] else ""


class SyncDeletionBarrier:
    def __init__(self, conn: sqlite3.Connection, segments: list[dict[str, Any]]):
        candidates = {item.get("segmentUid") for item in segments}
        account = sync_account_scope(conn)
        rows = conn.execute("""
            SELECT kind, range_start, range_end, segment_uids_json
            FROM received_sync_deletions WHERE account_id = ?
            UNION ALL
            SELECT kind, range_start, coalesce(range_end, created_at) AS range_end, segment_uids_json
            FROM sync_deletions WHERE account_id = ?
        """, (account, account))
        self.uids: set[str] = set()
        self.ranges: list[tuple[str | None, str | None]] = []
        for row in rows:
            if row["kind"] == "uids":
                self.uids.update(uid for uid in json.loads(row["segment_uids_json"] or "[]")
                                 if uid in candidates)
            else:
                self.ranges.append((row["range_start"], row["range_end"]))

    def blocks(self, conn: sqlite3.Connection, item: dict[str, Any]) -> bool:
        if item["segmentUid"] in self.uids:
            return True
        # Keep the existing history-deletion overlap semantics, including its
        # exact lower edge and SQLite upper-edge normalization. Do not invent
        # a second parser that disagrees on offsets or trimmed fractions.
        return any(conn.execute("""
            SELECT (? IS NULL OR (datetime(?) >= datetime(?) AND history_ends_after(?, ?)))
               AND (? IS NULL OR datetime(?) <= datetime(?))
        """, (start, item.get("endedAt"), start, item.get("endedAt"), start,
              end, item.get("startedAt"), end)).fetchone()[0]
                   for start, end in self.ranges)
