
from __future__ import annotations

import sqlite3
import sys
import threading
import unittest
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app import main as tracker_main
from app.storage.db import TrackerDatabase
from app.tracker.macos_workspace import Snapshot
from app.tracker.youtube_metadata import YouTubeVideoMetadata


class YouTubeMetadataDeletionTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = TemporaryDirectory()
        self.path = Path(self.tempdir.name) / "tracker.sqlite3"
        self.db = TrackerDatabase(self.path)

    def tearDown(self):
        self.db.close()
        self.tempdir.cleanup()

    def add_activity(self, video_id, minute=0):
        self.db.record_snapshot(Snapshot(
            observed_at=datetime(2026, 10, 3, 9, minute, tzinfo=timezone.utc).isoformat(),
            app_name="Synthetic Browser", bundle_id="fixture.browser",
            window_title="Synthetic video", source="accessibility",
            site_domain="youtube.com",
            site_url="https://www.youtube.com/watch?v=" + video_id,
            youtube_video_id=video_id,
        ), 5, max_merge_gap_seconds=0)
        with self.db.connect() as conn:
            return str(conn.execute("SELECT MAX(id) FROM activity_segments").fetchone()[0])

    def metadata_ids(self):
        with closing(sqlite3.connect(self.path)) as conn:
            return {row[0] for row in conn.execute("SELECT video_id FROM youtube_video_metadata")}

    def test_selected_deletion_removes_metadata_of_last_reference(self):
        segment_id = self.add_activity("deleted-video")
        self.db.save_youtube_metadata(YouTubeVideoMetadata(video_id="deleted-video", title="Synthetic private title"))
        self.assertEqual(self.db.delete_activity_segments([segment_id]), 1)
        self.assertEqual(self.metadata_ids(), set())

    def test_shared_reference_keeps_metadata_until_last_segment_is_deleted(self):
        first = self.add_activity("shared-video")
        second = self.add_activity("shared-video", minute=2)
        self.assertNotEqual(first, second)
        self.db.save_youtube_metadata(YouTubeVideoMetadata(video_id="shared-video"))
        self.assertEqual(self.db.delete_activity_segments([first]), 1)
        self.assertEqual(self.metadata_ids(), {"shared-video"})
        self.assertEqual(self.db.delete_activity_segments([second]), 1)
        self.assertEqual(self.metadata_ids(), set())

    def test_unrelated_retained_orphan_is_not_swept(self):
        segment_id = self.add_activity("deleted-video")
        self.db.save_youtube_metadata(YouTubeVideoMetadata(video_id="deleted-video"))
        self.db.save_youtube_metadata(YouTubeVideoMetadata(video_id="retained-cache"))
        self.db.delete_activity_segments([segment_id])
        self.assertEqual(self.metadata_ids(), {"retained-cache"})

    def test_failed_metadata_record_is_removed_with_last_reference(self):
        segment_id = self.add_activity("failed-video")
        self.db.save_youtube_metadata_failure("failed-video")
        self.db.delete_activity_segments([segment_id])
        self.assertEqual(self.metadata_ids(), set())

    def run_late_worker(self, fails=False, retain_reference=False):
        video_id = "late-video"
        segment_id = self.add_activity(video_id)
        if retain_reference:
            self.add_activity(video_id, minute=2)
        entered = threading.Event()
        release = threading.Event()
        worker_errors = []

        def fetch(*args, **kwargs):
            entered.set()
            if not release.wait(5):
                raise RuntimeError("QA worker release timeout")
            if fails:
                raise OSError("Synthetic network error")
            return YouTubeVideoMetadata(video_id=video_id, title="Synthetic late title")

        def run():
            try:
                tracker_main._fetch_youtube_metadata_background(self.path, video_id, "https://www.youtube.com/watch?v=" + video_id)
            except BaseException as error:
                worker_errors.append(error)

        tracker_main._YOUTUBE_METADATA_IN_FLIGHT.add(video_id)
        with patch.object(tracker_main, "fetch_youtube_metadata", side_effect=fetch):
            thread = threading.Thread(target=run)
            thread.start()
            try:
                self.assertTrue(entered.wait(5))
                self.db.delete_activity_segments([segment_id])
            finally:
                release.set()
                thread.join(5)
            self.assertFalse(thread.is_alive())
        self.assertEqual(worker_errors, [])
        self.assertNotIn(video_id, tracker_main._YOUTUBE_METADATA_IN_FLIGHT)

    def test_late_success_does_not_recreate_deleted_metadata(self):
        self.run_late_worker()
        self.assertEqual(self.metadata_ids(), set())

    def test_late_failure_does_not_recreate_deleted_metadata(self):
        self.run_late_worker(fails=True)
        self.assertEqual(self.metadata_ids(), set())

    def test_late_success_with_remaining_reference_is_saved(self):
        self.run_late_worker(retain_reference=True)
        self.assertEqual(self.metadata_ids(), {"late-video"})

    def test_late_failure_with_remaining_reference_is_saved(self):
        self.run_late_worker(fails=True, retain_reference=True)
        self.assertEqual(self.metadata_ids(), {"late-video"})
        with self.db.connect() as conn:
            self.assertEqual(conn.execute("SELECT status FROM youtube_video_metadata").fetchone()[0], "failed")

    def test_metadata_cleanup_failure_rolls_back_activity_deletion(self):
        segment_id = self.add_activity("rollback-video")
        self.db.save_youtube_metadata(YouTubeVideoMetadata(video_id="rollback-video"))
        with self.db.connect() as conn:
            conn.execute("CREATE TRIGGER reject_qa_metadata_delete BEFORE DELETE ON youtube_video_metadata "
                         "BEGIN SELECT RAISE(ABORT, 'synthetic metadata cleanup failure'); END")
        with self.assertRaisesRegex(sqlite3.IntegrityError, "synthetic metadata cleanup failure"):
            self.db.delete_activity_segments([segment_id], refresh_recovery_backup=False)
        with self.db.connect() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM activity_segments").fetchone()[0], 1)
        self.assertEqual(self.metadata_ids(), {"rollback-video"})

    def test_large_deletion_batches_prune_only_candidate_metadata(self):
        ids = []
        for i in range(905):
            self.db.record_snapshot(Snapshot(
                observed_at="2026-10-03T09:00:00+00:00",
                app_name="Synthetic Browser", bundle_id="fixture.browser",
                window_title="Synthetic " + str(i), source="accessibility",
                youtube_video_id="batch-video-" + str(i),
            ), 5)
            with self.db.connect() as conn:
                ids.append(str(conn.execute("SELECT MAX(id) FROM activity_segments").fetchone()[0]))
            self.db.save_youtube_metadata(YouTubeVideoMetadata(video_id="batch-video-" + str(i)))
        self.db.save_youtube_metadata(YouTubeVideoMetadata(video_id="retained-cache"))
        self.assertEqual(self.db.delete_activity_segments(ids + ["invalid", ids[0]]), 905)
        self.assertEqual(self.metadata_ids(), {"retained-cache"})


if __name__ == "__main__":
    unittest.main()
