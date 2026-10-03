from __future__ import annotations

from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sqlite3
import tempfile
import unittest

from app.storage.db import TrackerDatabase
from app.tracker.capture_contract import Snapshot
from app.tracker.youtube_metadata import YouTubeVideoMetadata


class HistoryDeletionBoundaryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.db = TrackerDatabase(Path(self.temp.name) / "tracker.sqlite3", perform_maintenance=False)
        self.addCleanup(self.temp.cleanup)
        self.addCleanup(self.db.close)
        self.start = datetime(2026, 10, 3, tzinfo=timezone.utc).replace(microsecond=123456)

    def raw(self, query: str) -> list[tuple]:
        with closing(sqlite3.connect(self.db.db_path)) as conn:
            return conn.execute(query).fetchall()

    def insert(self, end: datetime, name: str, *, related: bool = False) -> int:
        self.db.record_snapshot(Snapshot(
            observed_at=end.isoformat(), app_name=name, bundle_id="qa." + name,
            window_title="Synthetic boundary QA", source="qa",
            youtube_video_id=name if related else None,
        ), 5)
        segment_id = self.raw("SELECT MAX(id) FROM activity_segments")[0][0]
        if related:
            self.assertEqual(self.db.save_classifications([
                {"segmentId": str(segment_id), "category": "learning",
                 "productivity": "focus", "source": "llm", "aiResult": True}
            ]), 1)
            self.db.save_youtube_metadata(YouTubeVideoMetadata(video_id=name))
            result = self.db.save_project_window_assignments([{
                "windowId": name, "windowStartedAt": (end - timedelta(seconds=5)).isoformat(),
                "windowEndedAt": end.isoformat(), "durationSeconds": 5,
                "segmentOverlaps": [{"segmentId": str(segment_id), "durationSeconds": 5}],
            }])
            self.assertEqual(result["saved"], 1)
        return segment_id

    def delete(self, scopes: dict, *, dry_run: bool = False) -> dict:
        return self.db.delete_history_range(
            self.start.isoformat(), (self.start + timedelta(days=1)).isoformat(),
            scopes, dry_run=dry_run, record_tombstone=False)

    def test_microsecond_overlap_and_timezone_equivalence(self) -> None:
        for fractional in (0, 123456):
            for offset_hours in (0, 9):
                for relative_us in (-1000000, -1, 0, 1, 500000, 1000000):
                    with self.subTest(fractional=fractional, offset=offset_hours, delta=relative_us):
                        self.db.delete_history_range(scopes={"activity": True}, record_tombstone=False)
                        self.start = self.start.replace(microsecond=fractional)
                        ending = self.start + timedelta(microseconds=relative_us)
                        self.insert(ending.astimezone(timezone(timedelta(hours=offset_hours))), "Case")
                        expected = int(relative_us > 0)
                        dry = self.delete({"activity": True}, dry_run=True)
                        self.assertEqual(self.raw("SELECT COUNT(*) FROM activity_segments"), [(1,)])
                        real = self.delete({"activity": True})
                        self.assertEqual((dry["activitySegments"], real["activitySegments"]), (expected, expected))
                        self.assertEqual(self.raw("SELECT COUNT(*) FROM activity_segments"), [(1 - expected,)])

    def test_activity_and_related_rows_share_the_exact_lower_boundary(self) -> None:
        keep = self.insert(self.start, "Keep", related=True)
        self.insert(self.start + timedelta(microseconds=1), "Remove", related=True)
        dry = self.delete({"activity": True, "youtubeMetadata": True}, dry_run=True)
        self.assertEqual(dry, {"activitySegments": 1, "classifications": 1,
                              "youtubeMetadata": 1, "dryRun": True})
        self.assertEqual(self.raw("SELECT COUNT(*) FROM project_window_assignments"), [(2,)])
        self.assertEqual(self.delete({"activity": True, "youtubeMetadata": True}), {**dry, "dryRun": False})
        self.assertEqual(self.raw("SELECT id FROM activity_segments"), [(keep,)])
        self.assertEqual(self.raw("SELECT segment_id FROM activity_classifications"), [(keep,)])
        self.assertEqual(self.raw("SELECT video_id FROM youtube_video_metadata"), [("Keep",)])
        self.assertEqual(self.raw("SELECT window_id FROM project_window_assignments"), [("Keep",)])

    def test_ai_only_scope_keeps_touching_classification_and_all_activity(self) -> None:
        keep = self.insert(self.start, "Keep", related=True)
        self.insert(self.start + timedelta(microseconds=1), "Remove", related=True)
        result = self.delete({"aiClassifications": True})
        self.assertEqual(result, {"activitySegments": 0, "classifications": 1,
                                  "youtubeMetadata": 0, "dryRun": False})
        self.assertEqual(self.raw("SELECT segment_id FROM activity_classifications"), [(keep,)])
        self.assertEqual(self.raw("SELECT COUNT(*) FROM activity_segments"), [(2,)])
        self.assertEqual(self.raw("SELECT COUNT(*) FROM project_window_assignments"), [(2,)])
        self.assertEqual(self.raw("SELECT COUNT(*) FROM youtube_video_metadata"), [(2,)])

    def test_youtube_only_scope_keeps_touching_metadata_and_all_activity(self) -> None:
        self.insert(self.start, "Keep", related=True)
        self.insert(self.start + timedelta(microseconds=1), "Remove", related=True)
        result = self.delete({"youtubeMetadata": True})
        self.assertEqual(result, {"activitySegments": 0, "classifications": 0,
                                  "youtubeMetadata": 1, "dryRun": False})
        self.assertEqual(self.raw("SELECT video_id FROM youtube_video_metadata"), [("Keep",)])
        self.assertEqual(self.raw("SELECT COUNT(*) FROM activity_segments"), [(2,)])
        self.assertEqual(self.raw("SELECT COUNT(*) FROM activity_classifications"), [(2,)])

    def test_date_only_start_preserves_previous_day_ending_at_midnight(self) -> None:
        local_start = self.start.astimezone().replace(hour=0, minute=0, second=0, microsecond=0)
        keep = self.insert(local_start, "PreviousDay")
        self.insert(local_start + timedelta(microseconds=1), "ChosenDay")
        result = self.db.delete_history_range(
            local_start.date().isoformat(), local_start.date().isoformat(),
            {"activity": True}, record_tombstone=False)
        self.assertEqual(result["activitySegments"], 1)
        self.assertEqual(self.raw("SELECT id FROM activity_segments"), [(keep,)])

    def test_legacy_naive_utc_storage_and_z_suffix_keep_the_same_instant(self) -> None:
        keep = self.insert(self.start, "Naive")
        remove = self.insert(self.start + timedelta(microseconds=1), "Zulu")
        with self.db.connect() as conn:
            conn.execute("UPDATE activity_segments SET ended_at=? WHERE id=?",
                         (self.start.replace(tzinfo=None).isoformat(), keep))
            conn.execute("UPDATE activity_segments SET ended_at=? WHERE id=?",
                         ((self.start + timedelta(microseconds=1)).isoformat().replace("+00:00", "Z"), remove))
        self.assertEqual(self.delete({"activity": True})["activitySegments"], 1)
        self.assertEqual(self.raw("SELECT id FROM activity_segments"), [(keep,)])

    def test_range_tombstone_replay_preserves_the_same_boundary(self) -> None:
        keep = self.insert(self.start, "Keep")
        self.insert(self.start + timedelta(microseconds=1), "Remove")
        result = self.db.apply_synced_deletions([{
            "deletionUid": "qa.boundary", "kind": "range",
            "rangeStart": self.start.astimezone(timezone(timedelta(hours=9))).isoformat(),
            "rangeEnd": (self.start + timedelta(days=1)).isoformat(),
        }])
        self.assertEqual(result, {"applied": 1, "skipped": 0})
        self.assertEqual(self.raw("SELECT id FROM activity_segments"), [(keep,)])

    def test_invalid_bound_fails_before_deletion_and_malformed_row_stays_excluded(self) -> None:
        keep = self.insert(self.start, "InvalidStored")
        with self.db.connect() as conn:
            conn.execute("UPDATE activity_segments SET ended_at='invalid' WHERE id=?", (keep,))
        with self.assertRaises(ValueError):
            self.db.delete_history_range("invalid", scopes={"activity": True}, record_tombstone=False)
        self.assertEqual(self.delete({"activity": True})["activitySegments"], 0)
        self.assertEqual(self.raw("SELECT id FROM activity_segments"), [(keep,)])


if __name__ == "__main__":
    unittest.main()
