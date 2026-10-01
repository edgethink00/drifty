from __future__ import annotations

import sys
import unittest
from contextlib import ExitStack
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app import main as tracker_main
from app.storage.db import TrackerDatabase
from app.storage.live_tail import fetch_live_tail
from app.tracker.macos_workspace import Snapshot


class TrackerClockRollbackTests(unittest.TestCase):
    def _snapshot(self, observed_at: str) -> Snapshot:
        return Snapshot(
            observed_at=observed_at,
            app_name="Owned clock test",
            bundle_id="owned.clock.test",
            window_title="Owned context",
            source="qa",
        )

    def test_backward_capture_preserves_committed_segment(self) -> None:
        for gap in (None, 0, 180):
            for observed_at in (
                "2026-10-01T08:59:55+00:00",
                "2026-10-01T08:59:59.999999+00:00",
            ):
                with self.subTest(gap=gap, observed_at=observed_at), TemporaryDirectory() as tempdir:
                    db = TrackerDatabase(Path(tempdir) / "owned.sqlite3")
                    try:
                        first = self._snapshot("2026-10-01T09:00:00+00:00")
                        db.record_snapshot(first, 5, max_merge_gap_seconds=gap)
                        before = dict(db.connect().execute("SELECT * FROM activity_segments").fetchone())
                        db.record_snapshot(replace(first, observed_at=observed_at), 5, max_merge_gap_seconds=gap)
                        rows = [dict(row) for row in db.connect().execute("SELECT * FROM activity_segments ORDER BY id")]

                        self.assertEqual(len(rows), 2)
                        self.assertEqual(rows[0], before)
                        self.assertEqual(rows[1]["started_at"], observed_at)
                        self.assertEqual(rows[1]["ended_at"], observed_at)
                        self.assertEqual(rows[1]["duration_seconds"], 5)
                        self.assertEqual(sum(row["duration_seconds"] for row in rows), 10)
                    finally:
                        db.close()

    def test_backward_history_enrichment_does_not_rewrite_committed_segment(self) -> None:
        with TemporaryDirectory() as tempdir:
            db = TrackerDatabase(Path(tempdir) / "owned.sqlite3")
            try:
                first = self._snapshot("2026-10-01T09:00:00+00:00")
                db.record_snapshot(first, 5, max_merge_gap_seconds=180)
                before = dict(db.connect().execute("SELECT * FROM activity_segments").fetchone())
                db.record_snapshot(
                    replace(
                        first,
                        observed_at="2026-10-01T08:59:55+00:00",
                        browser_name="Owned browser",
                        site_domain="owned.example",
                        site_title="Owned page",
                        site_url="https://owned.example/page",
                        site_source="browser-history-title",
                    ),
                    5,
                    max_merge_gap_seconds=180,
                )
                rows = [dict(row) for row in db.connect().execute("SELECT * FROM activity_segments ORDER BY id")]

                self.assertEqual(len(rows), 2)
                self.assertEqual(rows[0], before)
                self.assertEqual(rows[1]["site_domain"], "owned.example")
                self.assertEqual(rows[1]["duration_seconds"], 5)
            finally:
                db.close()

    def test_equal_and_forward_capture_keep_existing_merge_policy(self) -> None:
        cases = (
            (0, "2026-10-01T09:00:00+00:00", 1),
            (0, "2026-10-01T09:00:01+00:00", 2),
            (180, "2026-10-01T09:03:00+00:00", 1),
            (180, "2026-10-01T09:03:01+00:00", 2),
            (None, "2026-10-01T10:00:00+00:00", 1),
            (180, "2026-10-01T18:00:00+09:00", 1),
        )
        for gap, observed_at, expected_rows in cases:
            with self.subTest(gap=gap, observed_at=observed_at), TemporaryDirectory() as tempdir:
                db = TrackerDatabase(Path(tempdir) / "owned.sqlite3")
                try:
                    first = self._snapshot("2026-10-01T09:00:00+00:00")
                    db.record_snapshot(first, 5, max_merge_gap_seconds=gap)
                    db.record_snapshot(replace(first, observed_at=observed_at), 5, max_merge_gap_seconds=gap)
                    rows = [dict(row) for row in db.connect().execute("SELECT * FROM activity_segments ORDER BY id")]

                    self.assertEqual(len(rows), expected_rows)
                    self.assertEqual(sum(row["duration_seconds"] for row in rows), 10)
                finally:
                    db.close()

    def test_idle_after_clock_rollback_discards_only_the_unconfirmed_capture(self) -> None:
        # These are elapsed/input observations; wall time changes during idle.
        for rollback in (0, 30, 60, 300):
            with self.subTest(rollback=rollback), TemporaryDirectory() as tempdir:
                db = TrackerDatabase(Path(tempdir) / "owned.sqlite3")
                try:
                    anchor = datetime(2026, 10, 2, 9, tzinfo=timezone.utc)
                    wall = [anchor]
                    idle = [0.0]
                    monotonic = [100.0]

                    class Clock(datetime):
                        @classmethod
                        def now(cls, tz=None):
                            return wall[0]

                    with ExitStack() as patches:
                        patches.enter_context(patch.object(tracker_main, "datetime", Clock))
                        patches.enter_context(patch.object(tracker_main.time, "monotonic", side_effect=lambda: monotonic[0]))
                        patches.enter_context(patch.object(tracker_main, "seconds_since_last_input", side_effect=lambda: idle[0]))
                        patches.enter_context(patch.object(tracker_main, "current_power_state", return_value=SimpleNamespace(should_capture=True)))
                        patches.enter_context(patch.object(tracker_main, "current_snapshot", side_effect=lambda **kwargs: self._snapshot(wall[0].isoformat())))
                        patches.enter_context(patch.object(tracker_main, "current_foreground_audio_sample", return_value=SimpleNamespace(available=False, active=False, reason="owned-no-audio")))
                        for name in ("enqueue_youtube_metadata_fetch", "backfill_browser_history_context", "_apply_developer_diagnostics_env"):
                            patches.enter_context(patch.object(tracker_main, name))
                        last_tick = None
                        for elapsed in range(0, 236, 5):
                            wall[0] = anchor + timedelta(seconds=elapsed - (rollback if elapsed >= 65 else 0))
                            monotonic[0] = 100 + elapsed
                            idle[0] = max(0, elapsed - 60)
                            last_tick = tracker_main._daemon_tick(db, last_tick)
                            if elapsed == 60:
                                committed = dict(db.connect().execute("SELECT * FROM activity_segments").fetchone())

                        wall[0] = anchor + timedelta(seconds=240 - rollback)
                        monotonic[0] = 100 + 240
                        idle[0] = 180
                        self.assertIsNone(tracker_main._daemon_tick(db, last_tick))
                        rows = [dict(row) for row in db.connect().execute("SELECT * FROM activity_segments ORDER BY id")]
                        self.assertEqual(db.get_meta("tracker_mode"), "idle")
                        self.assertEqual(len(rows), 1)
                        # The generation-local input boundary also excludes the
                        # initial default sample before started_at (#1578), as
                        # the ordinary no-correction trim does. Keep the actual
                        # observed 60s and the identity of the supported row.
                        self.assertEqual(rows[0]["segment_uid"], committed["segment_uid"])
                        self.assertEqual(rows[0]["started_at"], committed["started_at"])
                        self.assertEqual(rows[0]["ended_at"], (anchor + timedelta(seconds=60)).isoformat())
                        self.assertEqual(rows[0]["duration_seconds"], 60)
                finally:
                    db.close()

    def test_capture_order_survives_reopen_and_keeps_chronological_reads(self) -> None:
        with TemporaryDirectory() as tempdir:
            path = Path(tempdir) / "owned.sqlite3"
            db = TrackerDatabase(path)
            try:
                first = self._snapshot("2026-10-02T09:00:00+00:00")
                db.record_snapshot(first, 5, max_merge_gap_seconds=180)
                original = dict(db.connect().execute("SELECT * FROM activity_segments").fetchone())
                rolled_back = replace(first, observed_at="2026-10-02T08:55:00+00:00")
                db.record_snapshot(rolled_back, 5, max_merge_gap_seconds=180)
                db.close()
                db = TrackerDatabase(path)
                db.record_snapshot(replace(rolled_back, observed_at="2026-10-02T08:55:05+00:00"), 5, max_merge_gap_seconds=180)
                rows = [dict(row) for row in db.connect().execute("SELECT * FROM activity_segments ORDER BY id")]
                self.assertEqual(len(rows), 2)
                self.assertEqual(rows[0], original)
                self.assertEqual(rows[1]["duration_seconds"], 10)
                # Public chronological readers/cursors keep their wall-time contract.
                self.assertEqual(db.fetch_last_event_at(), first.observed_at)
                tail = fetch_live_tail(db, None, None, str(original["id"]), first.observed_at)
                self.assertEqual(len(tail), 1)
                self.assertEqual(tail[0]["id"], str(rows[1]["id"]))
                self.assertEqual(tail[0]["durationSeconds"], 10)
                # Continue at five-second intervals through wall-clock catch-up.
                for seconds in range(10, 306, 5):
                    observed_at = (datetime.fromisoformat(rolled_back.observed_at) + timedelta(seconds=seconds)).isoformat()
                    db.record_snapshot(replace(rolled_back, observed_at=observed_at), 5, max_merge_gap_seconds=180)
                rows = [dict(row) for row in db.connect().execute("SELECT * FROM activity_segments ORDER BY id")]
                self.assertEqual(len(rows), 2)
                self.assertEqual(rows[0], original)
                self.assertEqual(rows[1]["duration_seconds"], 310)
            finally:
                db.close()

    def test_latest_capture_evidence_and_trim_ignore_later_imported_and_remote_rows(self) -> None:
        with TemporaryDirectory() as tempdir:
            db = TrackerDatabase(Path(tempdir) / "owned.sqlite3")
            try:
                first = self._snapshot("2026-10-02T09:00:00+00:00")
                db.record_snapshot(first, 5)
                original = dict(db.connect().execute("SELECT * FROM activity_segments").fetchone())
                passive = replace(first, observed_at="2026-10-02T08:55:00+00:00", engagement_evidence="foreground-audio")
                db.record_snapshot(passive, 5)
                for source, end in (("browser-history-import", "2026-10-02T09:05:00+00:00"), ("owned-remote", "2026-10-02T09:10:00+00:00")):
                    db.insert_segment({"started_at": end, "ended_at": end, "duration_seconds": 5, "app_name": "Owned protected row", "source": source})
                db.connect().execute("UPDATE activity_segments SET origin_device_id = 'owned-remote-device' WHERE source = 'owned-remote'")
                protected = [dict(row) for row in db.connect().execute("SELECT * FROM activity_segments WHERE source IN ('browser-history-import', 'owned-remote') ORDER BY id")]
                self.assertEqual(db.latest_local_engagement_evidence(), "foreground-audio")
                db.record_snapshot(replace(passive, observed_at="2026-10-02T08:55:05+00:00"), 5)
                db.trim_latest_segment("2026-10-02T08:54:59+00:00")
                self.assertEqual(db.latest_local_engagement_evidence(), None)
                rows = [dict(row) for row in db.connect().execute("SELECT * FROM activity_segments ORDER BY id")]
                self.assertEqual(rows[0], original)
                self.assertEqual(rows[1:], protected)
            finally:
                db.close()

    def test_sync_outbox_holds_the_active_capture_after_clock_rollback(self) -> None:
        with TemporaryDirectory() as tempdir:
            db = TrackerDatabase(Path(tempdir) / "owned.sqlite3")
            try:
                first = self._snapshot("2026-10-02T09:00:00+00:00")
                db.record_snapshot(first, 5)
                db.record_snapshot(replace(first, observed_at="2026-10-02T08:55:00+00:00"), 5)
                rows = db.connect().execute("SELECT segment_uid, sync_seq FROM activity_segments ORDER BY id").fetchall()

                class Clock(datetime):
                    @classmethod
                    def now(cls, tz=None):
                        return datetime(2026, 10, 2, 8, 55, 1, tzinfo=timezone.utc)

                with patch("app.storage.db.datetime", Clock):
                    outbox = db.get_sync_outbox(0)
                self.assertEqual([item["segmentUid"] for item in outbox["items"]], [rows[0]["segment_uid"]])
                self.assertLess(outbox["batchMaxSeq"], rows[1]["sync_seq"])
            finally:
                db.close()


if __name__ == "__main__":
    unittest.main()
