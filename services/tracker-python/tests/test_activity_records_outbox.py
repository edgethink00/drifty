from __future__ import annotations

import json
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.storage.db import TrackerDatabase
from tests.support_cleanup import cleanup_temp_dir


def _iso(moment: datetime) -> str:
    return moment.isoformat(timespec="seconds")


class ActivityRecordsOutboxTests(unittest.TestCase):
    """Activity records (product decision 2026-10-26) read the device-sync
    change feed with YouTube context and keep their own deletion flag."""

    def setUp(self) -> None:
        self.tempdir = TemporaryDirectory()
        self.database = TrackerDatabase(Path(self.tempdir.name) / "tracker.sqlite3")

    def tearDown(self) -> None:
        cleanup_temp_dir(self.tempdir)

    def _insert_segment(self, index: int, **overrides) -> None:
        started = datetime(2026, 10, 20, 9, 0, 0, tzinfo=timezone.utc) + timedelta(minutes=index)
        segment = {
            "started_at": _iso(started),
            "ended_at": _iso(started + timedelta(seconds=30)),
            "duration_seconds": 30,
            "app_name": "Safari",
            "bundle_id": "com.apple.Safari",
            "window_title": f"Window {index}",
            "platform": "macos",
            "source": "accessibility",
            "confidence": None,
            "raw_context_json": "{}",
        }
        segment.update(overrides)
        self.database.insert_segment(segment)

    def test_context_adds_youtube_metadata_only_when_asked(self) -> None:
        self._insert_segment(0, site_domain="youtube.com", youtube_video_id="video-1")
        with self.database.connect() as conn:
            conn.execute(
                "INSERT INTO youtube_video_metadata (video_id, title, channel_name, category, status) "
                "VALUES ('video-1', 'Rust ownership', 'Teacher', 'Education', 'ready')"
            )

        with_context = self.database.get_sync_outbox(0, limit=10, hot_grace_seconds=0, include_context=True)
        plain = self.database.get_sync_outbox(0, limit=10, hot_grace_seconds=0)

        item = with_context["items"][0]
        self.assertEqual(item["youtubeTitle"], "Rust ownership")
        self.assertEqual(item["youtubeChannelName"], "Teacher")
        self.assertEqual(item["youtubeCategory"], "Education")
        # Device sync keeps its payload shape.
        self.assertNotIn("Teacher", json.dumps(plain["items"]))
        self.assertNotIn("youtubeChannelName", plain["items"][0])
        self.assertEqual(with_context["batchMaxSeq"], plain["batchMaxSeq"])

    def test_record_deletions_are_independent_of_device_sync(self) -> None:
        self._insert_segment(0)
        self._insert_segment(1)
        with self.database.connect() as conn:
            ids = [str(row["id"]) for row in conn.execute("SELECT id FROM activity_segments ORDER BY id")]
            conn.execute(
                "INSERT INTO sync_deletions (deletion_uid, account_id, kind, range_start, range_end, created_at) "
                "VALUES ('old-tombstone', NULL, 'range', '2026-01-01T00:00:00+00:00', '2026-01-02T00:00:00+00:00', "
                "'2026-01-02T00:00:00+00:00')"
            )
        enrolled_at = "2026-10-01T00:00:00.000Z"

        # No device-sync account: sync sees nothing, records see the new deletion.
        self.database.delete_activity_segments([ids[0]])
        self.assertEqual(self.database.get_pending_sync_deletions(), [])
        pending = self.database.get_pending_sync_deletions(scope="records", created_after=enrolled_at)
        self.assertEqual([item["kind"] for item in pending], ["uids"])
        self.assertEqual(len(pending[0]["segmentUids"]), 1)

        self.assertEqual(self.database.mark_sync_deletions_pushed([pending[0]["deletionUid"]], "records"), 1)
        self.assertEqual(self.database.get_pending_sync_deletions(scope="records", created_after=enrolled_at), [])

        # With device sync on, each consumer marks only its own flag.
        self.database.set_sync_state({"sync_account_id": "account-a"})
        self.database.delete_activity_segments([ids[1]])
        sync_pending = self.database.get_pending_sync_deletions()
        self.assertEqual(len(sync_pending), 1)
        self.database.mark_sync_deletions_pushed([sync_pending[0]["deletionUid"]])
        records_pending = self.database.get_pending_sync_deletions(scope="records", created_after=enrolled_at)
        self.assertEqual([item["deletionUid"] for item in records_pending], [sync_pending[0]["deletionUid"]])

    def test_record_deletions_need_an_enrollment_time(self) -> None:
        self._insert_segment(0)
        with self.database.connect() as conn:
            segment_id = str(conn.execute("SELECT id FROM activity_segments").fetchone()["id"])
        self.database.delete_activity_segments([segment_id])

        self.assertEqual(self.database.get_pending_sync_deletions(scope="records"), [])
        later = (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat().replace("+00:00", "Z")
        self.assertEqual(self.database.get_pending_sync_deletions(scope="records", created_after=later), [])


if __name__ == "__main__":
    unittest.main()
