import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app import main as tracker_main
from app.storage.db import TrackerDatabase
from app.tracker.macos_workspace import Snapshot
from app.tracker.power_state import PowerStateSample
from app.tracker.youtube_metadata import YouTubeVideoMetadata
from tests.support_cleanup import temp_dir_closing_databases


class CaptureEnrichmentTests(unittest.TestCase):
    def test_metadata_fetch_uses_recorded_capture_after_app_exclusion(self):
        # Exercise the real capture transaction and worker, substituting only
        # OS observations and the external network call with synthetic data.
        for excluded, prior_reference in ((True, False), (True, True), (False, False)):
            with self.subTest(excluded=excluded, prior_reference=prior_reference):
                self._check_capture(excluded, prior_reference)

    def _check_capture(self, excluded, prior_reference):
        video_id = "fixture1234"
        threads = []
        real_thread = tracker_main.threading.Thread

        def capture_thread(**kwargs):
            thread = real_thread(**kwargs)
            threads.append(thread)
            return thread

        def snapshot(second):
            return Snapshot(
                observed_at=f"2026-10-04T10:00:{second:02d}+00:00",
                app_name="Synthetic Browser", bundle_id="fixture.browser",
                window_title="Synthetic video", source="accessibility",
                site_url=f"https://www.youtube.com/watch?v={video_id}",
                youtube_video_id=video_id,
            )

        with temp_dir_closing_databases() as tmp:
            db = TrackerDatabase(Path(tmp) / "tracker.sqlite3")
            try:
                if prior_reference:
                    earlier = snapshot(0)
                    earlier.observed_at = "2026-10-03T10:00:00+00:00"
                    db.record_snapshot(earlier, 5)
                if excluded:
                    db.save_excluded_app("fixture-rule", "Synthetic Browser", "fixture.browser")
                power = PowerStateSample(datetime(2026, 10, 4, tzinfo=timezone.utc), True, "ok")
                with patch.object(tracker_main, "current_power_state", return_value=power), patch.object(
                    tracker_main, "seconds_since_last_input", return_value=0.0
                ), patch.object(tracker_main, "_apply_developer_diagnostics_env"), patch.object(
                    tracker_main, "current_snapshot", side_effect=[snapshot(0), snapshot(5)]
                ), patch.object(tracker_main, "backfill_browser_history_context"), patch.object(
                    tracker_main.threading, "Thread", side_effect=capture_thread
                ), patch.object(
                    tracker_main, "fetch_youtube_metadata",
                    return_value=YouTubeVideoMetadata(video_id=video_id, title="Synthetic title"),
                ) as fetch:
                    previous_tick = None
                    for _ in range(2):
                        previous_tick = tracker_main._daemon_tick(db, previous_tick)
                        for thread in threads:
                            thread.join(timeout=5)
                            self.assertFalse(thread.is_alive())
                    rows = db.fetch_timeline("2026-10-04")
                    self.assertEqual(len(rows), 1)
                    self.assertEqual(rows[0]["durationSeconds"], 10)
                    if excluded:
                        self.assertEqual(rows[0]["appName"], "[Redacted]")
                        self.assertIsNone(rows[0]["siteUrl"])
                        fetch.assert_not_called()
                        self.assertEqual(threads, [])
                    else:
                        self.assertEqual(rows[0]["appName"], "Synthetic Browser")
                        fetch.assert_called_once()
                    self.assertNotIn(video_id, tracker_main._YOUTUBE_METADATA_IN_FLIGHT)
            finally:
                for thread in threads:
                    thread.join(timeout=5)
                db.close()


if __name__ == "__main__":
    unittest.main()
