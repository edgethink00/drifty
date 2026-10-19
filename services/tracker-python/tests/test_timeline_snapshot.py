from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from app.storage.db import TrackerDatabase, fetch_row_dicts
from tests.support_cleanup import cleanup_temp_dir


class TimelineSnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(cleanup_temp_dir, self.temp)
        self.path = Path(self.temp.name) / "tracker.sqlite3"
        self.db = TrackerDatabase(self.path, perform_maintenance=False)
        self.addCleanup(self.db.close)

    def seed(self, count=605):
        base = datetime(2026, 10, 19, tzinfo=timezone.utc)
        with self.db.connect() as conn:
            conn.execute(
                "INSERT INTO youtube_video_metadata(video_id,title,description,status) VALUES(?,?,?,?)",
                ("synthetic", "Video title", "Long description " * 1000, "ready"),
            )
            for i in range(count):
                # Insertion order differs from timestamp order, including ties.
                start = base + timedelta(seconds=((i * 17) % count) // 2)
                conn.execute("""INSERT INTO activity_segments
                    (started_at,ended_at,duration_seconds,app_name,segment_uid,
                     window_title,youtube_video_id,platform,source)
                    VALUES(?,?,?,?,?,?,?,?,?)""",
                    (start.isoformat(), (start + timedelta(seconds=1)).isoformat(),
                     1, "Synthetic", f"synthetic-{i}", f"Window {i}",
                     "synthetic" if i % 2 else None, "windows", "synthetic"))

    def test_order_limits_and_enrichment_across_multiple_batches(self):
        self.seed()
        self.db.save_classifications([
            {"segmentId": 1, "category": "workspace", "productivity": "focus", "source": "manual"},
            {"segmentId": 605, "category": "learning", "productivity": "focus", "source": "manual"},
        ])
        rows = self.db.timeline()
        self.assertEqual(len(rows), 605)
        self.assertEqual(len({row["id"] for row in rows}), 605)
        self.assertEqual([row["started_at"] for row in rows], sorted(row["started_at"] for row in rows))
        for row in rows:
            self.assertEqual(row["window_title"], f"Window {row['id'] - 1}")
            self.assertEqual(row["youtube_description"], "Long description " * 1000 if row["id"] % 2 == 0 else None)
            if row["id"] in (1, 605):
                self.assertEqual(row["classification_source"], "manual")
                self.assertEqual(row["classification_category"], "workspace" if row["id"] == 1 else "learning")
        for limit in (1, 199, 200, 201, 600, 999, 0, -1, None):
            with self.subTest(limit=limit):
                self.assertEqual(self.db.timeline(limit=limit), rows[:limit] if limit and limit > 0 else rows)
        self.assertFalse(self.db.connect().in_transaction)

    def test_all_batches_observe_one_snapshot_while_another_writer_finishes(self):
        self.seed()
        expected = self.db.timeline()
        other = TrackerDatabase(self.path, perform_maintenance=False)
        self.addCleanup(other.close)
        other.connect().execute("PRAGMA busy_timeout=50")
        calls = []

        def read(conn, query, params):
            calls.append(True)
            if len(calls) == 2:
                with other.connect() as writer:
                    writer.execute("DELETE FROM activity_segments WHERE id=605")
                    writer.execute("UPDATE activity_segments SET window_title='Changed' WHERE id=604")
                    writer.execute("UPDATE youtube_video_metadata SET description='Changed'")
                other.save_classifications([
                    {"segmentId": 603, "category": "entertainment", "productivity": "drift", "source": "manual"},
                ])
            return fetch_row_dicts(conn, query, params)

        with patch("app.storage.db.fetch_row_dicts", side_effect=read):
            self.assertEqual(self.db.timeline(), expected)
        self.assertGreater(len(calls), 2)
        updated = self.db.timeline()
        self.assertEqual(len(updated), 604)
        by_id = {row["id"]: row for row in updated}
        self.assertEqual(by_id[604]["window_title"], "Changed")
        self.assertEqual(by_id[604]["youtube_description"], "Changed")
        self.assertEqual(by_id[603]["classification_source"], "manual")
        self.assertFalse(self.db.connect().in_transaction)

    def test_detail_failure_ends_snapshot_and_connection_recovers(self):
        self.seed()
        expected = self.db.timeline()
        reads = []

        def read(conn, query, params):
            reads.append(True)
            if len(reads) == 2:
                raise sqlite3.OperationalError("synthetic detail read failure")
            return fetch_row_dicts(conn, query, params)

        with patch("app.storage.db.fetch_row_dicts", side_effect=read):
            with self.assertRaisesRegex(sqlite3.OperationalError, "synthetic detail"):
                self.db.timeline()
        self.assertFalse(self.db.connect().in_transaction)
        self.assertEqual(self.db.timeline(), expected)
        self.assertEqual(self.db.connect().execute("PRAGMA quick_check").fetchone()[0], "ok")

    def test_read_only_connection_keeps_results_and_persistent_state(self):
        self.seed()
        expected = self.db.timeline()
        self.db.close()
        reader = TrackerDatabase(self.path, read_only=True, perform_maintenance=False)
        self.addCleanup(reader.close)
        before = self.path.read_bytes()
        changes = reader.connect().total_changes
        self.assertEqual(reader.timeline(), expected)
        self.assertEqual(reader.connect().total_changes, changes)
        self.assertFalse(reader.connect().in_transaction)
        reader.close()
        self.assertEqual(self.path.read_bytes(), before)

    def test_existing_transaction_keeps_its_uncommitted_view(self):
        self.seed(3)
        conn = self.db.connect()
        conn.execute("UPDATE activity_segments SET window_title='Pending' WHERE id=1")
        self.assertTrue(conn.in_transaction)
        by_id = {row["id"]: row for row in self.db.timeline()}
        self.assertEqual(by_id[1]["window_title"], "Pending")
        # Existing connection context behavior commits successful work.
        self.assertFalse(conn.in_transaction)
        with sqlite3.connect(self.path) as other:
            self.assertEqual(other.execute("SELECT window_title FROM activity_segments WHERE id=1").fetchone()[0], "Pending")

    def test_empty_range_releases_snapshot_without_writes(self):
        self.seed(3)
        conn = self.db.connect()
        changes = conn.total_changes
        self.assertEqual(self.db.timeline(start="2026-10-20T00:00:00Z"), [])
        self.assertEqual(conn.total_changes, changes)
        self.assertFalse(conn.in_transaction)
