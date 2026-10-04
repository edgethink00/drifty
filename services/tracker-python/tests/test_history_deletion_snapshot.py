from __future__ import annotations

from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from app.storage.database_maintenance import create_rotating_backup, database_backup_dir
from app.storage.db import TrackerDatabase
from app.tracker.capture_contract import Snapshot
from app.tracker.youtube_metadata import YouTubeVideoMetadata


class HistoryDeletionSnapshotTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "tracker.sqlite3"
        self.deleter = TrackerDatabase(self.path, perform_maintenance=False)
        self.writer = TrackerDatabase(self.path, perform_maintenance=False)
        self.addCleanup(self.deleter.close)
        self.addCleanup(self.writer.close)

    def capture(self, observed_at: str, *, video_id: str | None = None) -> None:
        self.writer.record_snapshot(Snapshot(
            observed_at=observed_at, app_name="Synthetic QA", bundle_id="qa.snapshot",
            window_title="Synthetic", source="qa", youtube_video_id=video_id,
        ), 5)

    def backup(self) -> Path:
        backup = create_rotating_backup(self.writer.connect(), self.path, interval_seconds=0)
        self.assertIsNotNone(backup)
        return backup

    def interleave_before_write(self, mutation) -> list[Exception]:
        errors: list[Exception] = []
        executed: list[str] = []

        def trace(statement: str) -> None:
            if not statement.strip().upper().startswith("BEGIN") or executed:
                return
            executed.append(statement)
            try:
                mutation()
            except Exception as error:
                # sqlite3 suppresses exceptions from trace callbacks.
                errors.append(error)

        self.deleter.connect().set_trace_callback(trace)
        self.addCleanup(self.deleter.connect().set_trace_callback, None)
        self.addCleanup(lambda: self.assertEqual(len(executed), 1))
        return errors

    def rows(self, query: str) -> list[tuple]:
        with closing(sqlite3.connect(self.path)) as connection:
            return connection.execute(query).fetchall()

    def assert_refreshed_backup(self, old: Path, query: str, expected: list[tuple]) -> None:
        self.assertFalse(old.exists())
        backups = list(database_backup_dir(self.path).glob("tracker-*.sqlite3"))
        self.assertEqual(len(backups), 1)
        with closing(sqlite3.connect(backups[0])) as connection:
            self.assertEqual(connection.execute(query).fetchall(), expected)

    def test_capture_extension_is_counted_deleted_and_tombstoned_together(self) -> None:
        self.capture("2026-10-04T10:00:00+00:00")
        old = self.backup()
        errors = self.interleave_before_write(
            lambda: self.capture("2026-10-04T10:00:05+00:00"))
        from app import main

        with patch("app.main.database", return_value=self.deleter):
            response = main._dispatch({"command": "delete_history_range", "payload": {
                "start": "2026-10-04T10:00:02+00:00", "end": "2026-10-04T10:01:00+00:00",
                "scopes": {"activity": True},
            }})
        self.assertTrue(response["ok"])
        result = response["data"]
        self.assertEqual(errors, [])
        self.assertEqual(self.rows("SELECT id FROM activity_segments"), [])
        self.assertEqual(result["activitySegments"], 1)
        self.assertEqual(self.rows("SELECT range_start, range_end FROM sync_deletions"),
                         [("2026-10-04T10:00:02+00:00", "2026-10-04T10:01:00+00:00")])
        self.assert_refreshed_backup(old, "SELECT id FROM activity_segments", [])

    def test_concurrent_ai_save_is_counted_and_recovery_copy_is_replaced(self) -> None:
        self.capture("2026-10-04T10:00:05+00:00")
        old = self.backup()
        errors = self.interleave_before_write(lambda: self.writer.save_classifications([{
            "segmentId": "1", "category": "learning", "productivity": "focus",
            "source": "llm", "aiResult": True,
        }]))
        result = self.deleter.delete_history_range(
            "2026-10-04T10:00:00+00:00", "2026-10-04T10:01:00+00:00",
            {"aiClassifications": True})
        self.assertEqual(errors, [])
        self.assertEqual(self.rows("SELECT segment_id FROM activity_classifications"), [])
        self.assertEqual(result["classifications"], 1)
        self.assertEqual(self.rows("SELECT COUNT(*) FROM activity_segments"), [(1,)])
        self.assertEqual(self.rows("SELECT COUNT(*) FROM sync_deletions"), [(0,)])
        self.assert_refreshed_backup(old, "SELECT segment_id FROM activity_classifications", [])

    def test_concurrent_metadata_save_is_counted_and_recovery_copy_is_replaced(self) -> None:
        self.capture("2026-10-04T10:00:05+00:00", video_id="synthetic-video")
        old = self.backup()
        errors = self.interleave_before_write(lambda: self.writer.save_youtube_metadata(
            YouTubeVideoMetadata(video_id="synthetic-video")))
        result = self.deleter.delete_history_range(
            "2026-10-04T10:00:00+00:00", "2026-10-04T10:01:00+00:00",
            {"youtubeMetadata": True})
        self.assertEqual(errors, [])
        self.assertEqual(self.rows("SELECT video_id FROM youtube_video_metadata"), [])
        self.assertEqual(result["youtubeMetadata"], 1)
        self.assertEqual(self.rows("SELECT COUNT(*) FROM activity_segments"), [(1,)])
        self.assert_refreshed_backup(old, "SELECT video_id FROM youtube_video_metadata", [])

    def test_dry_run_remains_read_only_and_keeps_backup(self) -> None:
        self.capture("2026-10-04T10:00:05+00:00")
        old = self.backup()
        statements: list[str] = []
        self.deleter.connect().set_trace_callback(statements.append)
        self.addCleanup(self.deleter.connect().set_trace_callback, None)
        result = self.deleter.delete_history_range(scopes={"activity": True}, dry_run=True)
        self.assertEqual(result["activitySegments"], 1)
        self.assertEqual(self.rows("SELECT COUNT(*) FROM activity_segments"), [(1,)])
        self.assertEqual(self.rows("SELECT COUNT(*) FROM sync_deletions"), [(0,)])
        self.assertTrue(old.exists())
        self.assertFalse(any(s.strip().upper().startswith("BEGIN") for s in statements))

    def test_busy_writer_fails_before_deleting_and_can_retry(self) -> None:
        self.capture("2026-10-04T10:00:05+00:00")
        old = self.backup()
        self.writer.connect().execute("BEGIN IMMEDIATE")
        self.deleter.connect().execute("PRAGMA busy_timeout = 25")
        try:
            with self.assertRaises(sqlite3.OperationalError):
                self.deleter.delete_history_range(scopes={"activity": True})
            self.assertEqual(self.rows("SELECT COUNT(*) FROM activity_segments"), [(1,)])
            self.assertEqual(self.rows("SELECT COUNT(*) FROM sync_deletions"), [(0,)])
            self.assertTrue(old.exists())
            self.assertFalse(self.deleter.connect().in_transaction)
        finally:
            self.writer.connect().rollback()
        result = self.deleter.delete_history_range(scopes={"activity": True})
        self.assertEqual(result["activitySegments"], 1)
        self.assertEqual(self.rows("SELECT COUNT(*) FROM activity_segments"), [(0,)])


if __name__ == "__main__":
    unittest.main()
