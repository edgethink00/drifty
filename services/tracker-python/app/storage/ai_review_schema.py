from __future__ import annotations

import sqlite3

_REVIEW_TABLE = """
CREATE TABLE {name} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    segment_id INTEGER NOT NULL REFERENCES activity_segments(id) ON DELETE CASCADE,
    pass_id INTEGER NOT NULL REFERENCES project_pass_runs(id),
    prev_category TEXT, prev_productivity TEXT, prev_source TEXT,
    new_category TEXT, new_productivity TEXT, confidence REAL,
    reason TEXT, created_at TEXT NOT NULL, reverted_at TEXT,
    prev_classification_json TEXT, applied_classification_json TEXT
)
"""
_REVIEW_COLUMNS = (
    "id", "segment_id", "pass_id", "prev_category", "prev_productivity", "prev_source",
    "new_category", "new_productivity", "confidence", "reason", "created_at", "reverted_at",
    "prev_classification_json", "applied_classification_json",
)
_SNAPSHOT_COLUMNS = ("prev_classification_json", "applied_classification_json")
_REVIEW_INDEX = """CREATE INDEX IF NOT EXISTS idx_ai_review_events_segment
                   ON ai_review_events(segment_id, created_at DESC)"""


def ensure_ai_review_schema(conn: sqlite3.Connection) -> None:
    """Tie review details to their activity while retaining independent pass runs."""
    existing = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='ai_review_events'"
    ).fetchone()
    if existing is None:
        conn.execute(_REVIEW_TABLE.format(name="ai_review_events"))
        conn.execute(_REVIEW_INDEX)
        return

    existing_columns = {
        row[1] for row in conn.execute("PRAGMA table_info(ai_review_events)").fetchall()
    }
    foreign_keys = conn.execute("PRAGMA foreign_key_list(ai_review_events)").fetchall()
    has_segment_cascade = any(
        row[2] == "activity_segments" and row[3] == "segment_id"
        and row[4] == "id" and row[6] == "CASCADE"
        for row in foreign_keys
    )
    missing_snapshot_columns = [
        column for column in _SNAPSHOT_COLUMNS if column not in existing_columns
    ]
    if has_segment_cascade and not missing_snapshot_columns:
        conn.execute(_REVIEW_INDEX)
        return

    # DDL and any row copying share a savepoint, including when initialization
    # already owns a transaction. A failed upgrade must leave the old table.
    conn.execute("SAVEPOINT ai_review_cascade")
    try:
        if has_segment_cascade:
            for column in missing_snapshot_columns:
                conn.execute(f"ALTER TABLE ai_review_events ADD COLUMN {column} TEXT")
        else:
            conn.execute(_REVIEW_TABLE.format(name="ai_review_events_cascade"))
            sequence = conn.execute(
                "SELECT seq FROM sqlite_sequence WHERE name='ai_review_events'"
            ).fetchone()
            columns = ", ".join(_REVIEW_COLUMNS)
            values = ", ".join(
                "e." + column if column in existing_columns else "NULL"
                for column in _REVIEW_COLUMNS
            )
            conn.execute(f"""
                INSERT INTO ai_review_events_cascade ({columns})
                SELECT {values} FROM ai_review_events e
                JOIN activity_segments s ON s.id = e.segment_id
                JOIN project_pass_runs p ON p.id = e.pass_id
            """)
            conn.execute("DROP TABLE ai_review_events")
            conn.execute("ALTER TABLE ai_review_events_cascade RENAME TO ai_review_events")
            if sequence is not None:
                # Removed orphans may carry the highest id. Do not reuse historical
                # review ids after rebuilding an AUTOINCREMENT table.
                cursor = conn.execute(
                    "UPDATE sqlite_sequence SET seq=MAX(seq, ?) WHERE name='ai_review_events'",
                    (sequence[0],),
                )
                if cursor.rowcount == 0:
                    conn.execute(
                        "INSERT INTO sqlite_sequence(name,seq) VALUES ('ai_review_events',?)",
                        (sequence[0],),
                    )
        conn.execute(_REVIEW_INDEX)
        conn.execute("RELEASE SAVEPOINT ai_review_cascade")
    except BaseException:
        if conn.in_transaction:
            conn.execute("ROLLBACK TO SAVEPOINT ai_review_cascade")
            conn.execute("RELEASE SAVEPOINT ai_review_cascade")
        raise
