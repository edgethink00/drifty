"""Real WAL contention and upgrade coverage for cold tracker connections."""
from __future__ import annotations

import json
import sqlite3
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from app import main as tracker_main
from app.storage.db import TrackerDatabase


class DatabaseInitializationTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = Path(directory.name) / "tracker.sqlite3"
        self.db = TrackerDatabase(self.path)
        self.addCleanup(self.db.close)
        self.db.insert_segment({
            "started_at": "2026-10-23T09:00:00+00:00",
            "ended_at": "2026-10-23T09:01:00+00:00",
            "duration_seconds": 60,
            "app_name": "Synthetic editor",
        })
        # Existing installations have already completed this one-time repair.
        # It remains a real write when needed, independent of schema setup.
        self.db.replay_trimmed_fraction_range_deletions()

    def test_cold_read_commands_work_while_another_connection_holds_writer_lock(self) -> None:
        writer = self.db.connect()
        schema_version = writer.execute("PRAGMA schema_version").fetchone()[0]
        writer.execute("BEGIN IMMEDIATE")
        writer.execute("INSERT INTO tracker_meta VALUES ('uncommitted', 'writer')")
        try:
            for handler in (tracker_main.get_timeline, tracker_main.get_compact_timeline, tracker_main.get_classification_metrics):
                with self.subTest(command=handler.__name__), patch.object(
                    tracker_main, "DB_PATH", self.path
                ), patch.object(tracker_main, "_DATABASE_CACHE", None):
                    try:
                        payload = ({"start": "2026-10-23T00:00:00", "end": "2026-10-23T23:59:59"}
                                   if handler is tracker_main.get_compact_timeline else {"day": "2026-10-23"})
                        result = json.loads(tracker_main._encode_response(handler(payload)))
                        self.assertTrue(result["ok"])
                        if handler is tracker_main.get_timeline:
                            self.assertEqual([row["appName"] for row in result["data"]], ["Synthetic editor"])
                        elif handler is tracker_main.get_compact_timeline:
                            self.assertEqual([row["appName"] for row in result["data"]["items"]], ["Synthetic editor"])
                        else:
                            self.assertEqual(result["data"]["totalSegments"], 1)
                        opened = tracker_main.database()
                        self.assertEqual(opened.connect().total_changes, 0)
                        self.assertIsNone(opened.maintenance_error)
                        self.assertIsNone(opened.get_meta("uncommitted"))
                        self.assertEqual(opened.connect().execute("PRAGMA schema_version").fetchone()[0], schema_version)
                        # The normal cache remains writable after the concurrent
                        # transaction ends; do not substitute a read-only cache.
                        writer.rollback()
                        opened.set_meta("after_writer", "saved")
                        self.assertEqual(self.db.get_meta("after_writer"), "saved")
                        writer.execute("BEGIN IMMEDIATE")
                        writer.execute("INSERT INTO tracker_meta VALUES ('uncommitted', 'writer')")
                    finally:
                        if tracker_main._DATABASE_CACHE is not None:
                            tracker_main._DATABASE_CACHE.close()
        finally:
            writer.rollback()

    def test_pending_data_repairs_still_run_and_preserve_other_values(self) -> None:
        with self.db.connect() as conn:
            conn.execute("UPDATE excluded_apps SET updated_at = NULL")
            conn.execute("INSERT INTO classification_rules "
                         "(id, target_kind, target_value, normalized_target_value, match_scope, "
                         "detail_kind, normalized_detail_value, category, productivity, created_at, updated_at) "
                         "VALUES ('legacy', 'app', 'Editor', 'editor', '', 'obsolete', 'obsolete', "
                         "'Coding', 'productive', 'created', 'updated')")
            conn.execute("UPDATE sync_counter SET seq = 99 WHERE id = 1")
            expected_exclusions = conn.execute("SELECT COUNT(*) FROM excluded_apps").fetchone()[0]
        reopened = TrackerDatabase(self.path)
        self.addCleanup(reopened.close)
        conn = reopened.connect()
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM excluded_apps").fetchone()[0], expected_exclusions)
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM excluded_apps WHERE updated_at IS NULL").fetchone()[0], 0)
        self.assertEqual(tuple(conn.execute("SELECT match_scope, detail_kind, normalized_detail_value, category "
                                            "FROM classification_rules WHERE id = 'legacy'").fetchone()),
                         ("surface", "", "", "Coding"))
        self.assertEqual(conn.execute("SELECT seq FROM sync_counter WHERE id = 1").fetchone()[0], 99)
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM activity_segments").fetchone()[0], 1)
        self.assertEqual(conn.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_old_trigger_is_replaced_and_missing_trigger_is_recreated(self) -> None:
        names = [f"trg_activity_classifications_sync_origin_{op}" for op in ("insert", "update", "delete")]
        conn = self.db.connect()
        expected = {name: conn.execute("SELECT sql FROM sqlite_master WHERE name = ?", (name,)).fetchone()[0]
                    for name in names}
        with conn:
            for name in names:
                conn.execute(f"DROP TRIGGER {name}")
            conn.execute(f"CREATE TRIGGER {names[0]} AFTER INSERT ON activity_classifications BEGIN SELECT 1; END")
        reopened = TrackerDatabase(self.path)
        self.addCleanup(reopened.close)
        for name in names:
            self.assertEqual(reopened.connect().execute("SELECT sql FROM sqlite_master WHERE name = ?", (name,)).fetchone()[0],
                             expected[name])
        # Upgrading the definitions must preserve the local-choice behavior.
        segment_id = conn.execute("SELECT id FROM activity_segments").fetchone()[0]
        reopened.save_classifications([{
            "segmentId": segment_id, "category": "Coding", "productivity": "productive",
            "source": "manual", "confidence": 1.0, "inputFingerprint": "synthetic",
        }])
        self.assertEqual(conn.execute("SELECT provenance FROM sync_classification_provenance WHERE segment_id = ?",
                                      (segment_id,)).fetchone()[0], "local-protected")

    def test_failed_trigger_replacement_keeps_the_previous_definition(self) -> None:
        conn = self.db.connect()
        name = "trg_activity_classifications_sync_origin_insert"
        old_sql = conn.execute("SELECT sql FROM sqlite_master WHERE name = ?", (name,)).fetchone()[0]
        with self.assertRaises(sqlite3.OperationalError):
            TrackerDatabase._ensure_current_trigger(conn, name, "CREATE TRIGGER invalid syntax")
        self.assertEqual(conn.execute("SELECT sql FROM sqlite_master WHERE name = ?", (name,)).fetchone()[0], old_sql)
        self.assertFalse(conn.in_transaction)

    def test_actual_upgrade_still_requires_writer_lock_and_retries_after_release(self) -> None:
        name = "trg_activity_classifications_sync_origin_delete"
        writer = self.db.connect()
        writer.execute(f"DROP TRIGGER {name}")

        class ShortTimeoutDatabase(TrackerDatabase):
            def connect(self):
                conn = super().connect()
                conn.execute("PRAGMA busy_timeout=25")
                return conn

        writer.execute("BEGIN IMMEDIATE")
        try:
            with self.assertRaisesRegex(sqlite3.OperationalError, "database is locked"):
                ShortTimeoutDatabase(self.path)
            self.assertIsNone(writer.execute("SELECT 1 FROM sqlite_master WHERE name = ?", (name,)).fetchone())
        finally:
            writer.rollback()
        reopened = TrackerDatabase(self.path)
        self.addCleanup(reopened.close)
        self.assertIsNotNone(reopened.connect().execute("SELECT 1 FROM sqlite_master WHERE name = ?", (name,)).fetchone())
        self.assertEqual(reopened.connect().execute("SELECT COUNT(*) FROM activity_segments").fetchone()[0], 1)


if __name__ == "__main__":
    unittest.main()
