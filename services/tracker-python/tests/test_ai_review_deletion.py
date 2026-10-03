from __future__ import annotations

from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile
import unittest

from app.storage.db import TrackerDatabase
from app.tracker.capture_contract import Snapshot

LEGACY_REVIEW_SCHEMA = """
CREATE TABLE ai_review_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    segment_id INTEGER NOT NULL,
    pass_id INTEGER NOT NULL REFERENCES project_pass_runs(id),
    prev_category TEXT, prev_productivity TEXT, prev_source TEXT,
    new_category TEXT, new_productivity TEXT, confidence REAL,
    reason TEXT, created_at TEXT NOT NULL, reverted_at TEXT
)
"""


class AiReviewDeletionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "tracker.sqlite3"
        self.db = TrackerDatabase(self.path, perform_maintenance=False)
        self.addCleanup(self.temp.cleanup)
        self.addCleanup(lambda: self.db.close())
        for name, at in [("Remove", "2026-10-03T12:00:00+00:00"),
                         ("Keep", "2026-10-02T12:00:00+00:00")]:
            self.db.record_snapshot(Snapshot(
                observed_at=at, app_name=name, bundle_id="qa." + name,
                window_title="Synthetic QA", source="qa",
            ), 5)
        self.pass_id = self.db.record_project_pass({
            "rangeStart": "2026-10-01T00:00:00+00:00",
            "rangeEnd": "2026-10-04T00:00:00+00:00",
            "trigger": "qa", "promptVersion": "synthetic",
        })["id"]
        self.db.save_ai_review_events([
            {"segmentId": str(i), "passId": self.pass_id,
             "prevCategory": "previous", "newCategory": "updated",
             "prevProductivity": "drift", "newProductivity": "focus",
             "prevSource": "heuristic", "confidence": 0.75,
             "createdAt": "2026-10-03T12:00:00.123456+00:00",
             "reason": "Synthetic reason " + str(i)}
            for i in (1, 2)
        ])

        with self.db.connect() as conn:
            conn.execute("UPDATE ai_review_events SET reverted_at='2026-10-03T12:30:00.654321+00:00' WHERE id=2")

    def raw(self, query: str, params: tuple = ()) -> list[tuple]:
        with closing(sqlite3.connect(self.path)) as conn:
            return conn.execute(query, params).fetchall()

    def review_rows(self) -> list[tuple]:
        return self.raw("SELECT * FROM ai_review_events ORDER BY id")

    def assert_retained_data(self) -> None:
        self.assertEqual(self.raw("SELECT id FROM activity_segments ORDER BY id"), [(2,)])
        self.assertEqual(self.raw("SELECT segment_id, reason FROM ai_review_events ORDER BY id"),
                         [(2, "Synthetic reason 2")])
        self.assertEqual(self.raw("SELECT id FROM project_pass_runs"), [(self.pass_id,)])

    def make_legacy(self, *, only_orphans: bool = False) -> list[tuple]:
        expected = self.review_rows()
        self.db.close()
        with closing(sqlite3.connect(self.path)) as conn:
            conn.execute("DROP TABLE ai_review_events")
            conn.execute(LEGACY_REVIEW_SCHEMA)
            if not only_orphans:
                conn.executemany("INSERT INTO ai_review_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", expected)
            conn.execute("""INSERT INTO ai_review_events(id,segment_id,pass_id,reason,created_at)
                            VALUES (50,999,?,'Orphan segment','2026-10-03T12:00:00Z')""", (self.pass_id,))
            conn.execute("""INSERT INTO ai_review_events(id,segment_id,pass_id,reason,created_at)
                            VALUES (51,1,999,'Orphan pass','2026-10-03T12:00:00Z')""")
            conn.execute("CREATE INDEX idx_ai_review_events_segment ON ai_review_events(segment_id, created_at DESC)")
            conn.commit()
        return [] if only_orphans else expected

    def reopen(self) -> None:
        self.db.close()
        self.db = TrackerDatabase(self.path, perform_maintenance=False)

    def test_selected_deletion_removes_linked_reviews_and_preserves_other_data(self) -> None:
        self.assertEqual(self.db.delete_activity_segments(["1"], record_tombstone=False), 1)
        self.assert_retained_data()

    def test_range_deletion_and_dry_run_use_the_same_cascade_boundary(self) -> None:
        before = self.review_rows()
        result = self.db.delete_history_range(
            "2026-10-03T00:00:00+00:00", "2026-10-04T00:00:00+00:00",
            {"activity": True}, dry_run=True, record_tombstone=False)
        self.assertEqual(result["activitySegments"], 1)
        self.assertEqual(self.review_rows(), before)
        self.db.delete_history_range(
            "2026-10-03T00:00:00+00:00", "2026-10-04T00:00:00+00:00",
            {"activity": True}, record_tombstone=False)
        self.assert_retained_data()

    def test_direct_parent_deletion_also_cascades(self) -> None:
        with self.db.connect() as conn:
            self.assertEqual(conn.execute("PRAGMA foreign_keys").fetchone()[0], 1)
            conn.execute("DELETE FROM activity_segments WHERE id=1")
        self.assert_retained_data()

    def test_classification_only_deletion_preserves_reviews(self) -> None:
        before = self.review_rows()
        self.assertEqual(self.db.save_classifications([
            {"segmentId": str(i), "category": "learning", "productivity": "focus",
             "source": "llm", "aiResult": True}
            for i in (1, 2)
        ]), 2)
        result = self.db.delete_history_range(
            "2026-10-03T00:00:00+00:00", "2026-10-04T00:00:00+00:00",
            {"aiClassifications": True}, record_tombstone=False)
        self.assertEqual(result, {"activitySegments": 0, "classifications": 1,
                                  "youtubeMetadata": 0, "dryRun": False})
        self.assertEqual(self.raw("SELECT segment_id FROM activity_classifications ORDER BY segment_id"), [(2,)])
        self.assertEqual(self.review_rows(), before)
        self.assertEqual(self.raw("SELECT id FROM activity_segments ORDER BY id"), [(1,), (2,)])

    def test_legacy_migration_preserves_complete_rows_and_drops_only_orphans(self) -> None:
        expected = self.make_legacy()
        self.reopen()
        self.assertEqual(self.review_rows(), expected)
        self.assertEqual(self.raw("PRAGMA foreign_key_check(ai_review_events)"), [])
        self.assertEqual(self.raw("SELECT seq FROM sqlite_sequence WHERE name='ai_review_events'"), [(51,)])
        self.assertEqual(self.raw("SELECT id FROM project_pass_runs"), [(self.pass_id,)])
        self.db.delete_activity_segments(["1"], record_tombstone=False)
        self.assert_retained_data()

    def test_legacy_sequence_is_preserved_when_all_reviews_were_orphans(self) -> None:
        self.make_legacy(only_orphans=True)
        self.reopen()
        self.assertEqual(self.review_rows(), [])
        self.db.save_ai_review_events([{"segmentId": "1", "passId": self.pass_id, "reason": "New synthetic review"}])
        self.assertEqual(self.raw("SELECT id, reason FROM ai_review_events"), [(52, "New synthetic review")])

    def test_migration_is_idempotent(self) -> None:
        self.make_legacy()
        self.reopen()
        first = self.review_rows()
        schema = self.raw("SELECT name,sql FROM sqlite_master WHERE tbl_name='ai_review_events' ORDER BY name")
        self.reopen()
        self.assertEqual(self.review_rows(), first)
        self.assertEqual(self.raw("SELECT name,sql FROM sqlite_master WHERE tbl_name='ai_review_events' ORDER BY name"), schema)

    def test_failed_schema_rebuild_rolls_back_ddl_rows_and_sequence(self) -> None:
        from app.storage.ai_review_schema import ensure_ai_review_schema

        self.make_legacy()
        before = self.review_rows()
        before_schema = self.raw("SELECT name,sql FROM sqlite_master WHERE tbl_name='ai_review_events' ORDER BY name")
        sequence = self.raw("SELECT seq FROM sqlite_sequence WHERE name='ai_review_events'")
        with self.db.connect() as conn:
            conn.execute("INSERT INTO tracker_meta(key,value) VALUES ('qa.outer','retained')")

            denied = []

            def deny_rename(action: int, first: str, second: str, *_unused) -> int:
                if action == sqlite3.SQLITE_ALTER_TABLE and second == "ai_review_events_cascade":
                    denied.append((first, second))
                    return sqlite3.SQLITE_DENY
                return sqlite3.SQLITE_OK

            conn.set_authorizer(deny_rename)
            try:
                with self.assertRaises(sqlite3.DatabaseError):
                    ensure_ai_review_schema(conn)
            finally:
                # Python 3.9 does not disable authorizers with None.
                conn.set_authorizer(lambda *_args: sqlite3.SQLITE_OK)
            self.assertEqual(denied, [("main", "ai_review_events_cascade")])
            self.assertTrue(conn.in_transaction)
            self.assertEqual(conn.execute("SELECT value FROM tracker_meta WHERE key='qa.outer'").fetchone()[0], "retained")
        self.assertEqual(self.review_rows(), before)
        self.assertEqual(self.raw("SELECT name,sql FROM sqlite_master WHERE tbl_name='ai_review_events' ORDER BY name"), before_schema)
        self.assertEqual(self.raw("SELECT seq FROM sqlite_sequence WHERE name='ai_review_events'"), sequence)
        self.assertEqual(self.raw("SELECT name FROM sqlite_master WHERE name='ai_review_events_cascade'"), [])

    def test_fresh_schema_rejects_orphan_review_writes(self) -> None:
        with self.db.connect() as conn:
            with self.assertRaises(sqlite3.IntegrityError):
                conn.execute("INSERT INTO ai_review_events(segment_id,pass_id,created_at) VALUES (999,?,'2026-10-03')",
                             (self.pass_id,))
        self.assertEqual(len(self.review_rows()), 2)

    def test_late_results_still_skip_missing_parents_without_losing_valid_events(self) -> None:
        self.db.delete_activity_segments(["1"], record_tombstone=False)
        self.assertEqual(self.db.save_ai_review_events([
            {"segmentId": "1", "passId": self.pass_id},
            {"segmentId": "2", "passId": 999},
            {"segmentId": "2", "passId": self.pass_id, "reason": "Valid late review"},
        ]), 1)
        self.assertEqual(self.raw("SELECT segment_id,reason FROM ai_review_events ORDER BY id"),
                         [(2, "Synthetic reason 2"), (2, "Valid late review")])


if __name__ == "__main__":
    unittest.main()
