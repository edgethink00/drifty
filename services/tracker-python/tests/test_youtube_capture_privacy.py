"""Local capture must not schedule the legacy YouTube watch-page lookup."""
import io
import os
import sys
import threading
import unittest
import urllib.request
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app import main
from app.storage import db as tracker_storage
from app.storage.db import TrackerDatabase
from app.tracker import browser_history
from app.tracker.browser_automation import BrowserMetadata
from app.tracker.macos_workspace import Snapshot
from app.tracker.power_state import PowerStateSample
from app.tracker.youtube_metadata import YouTubeVideoMetadata
from tests.support_cleanup import temp_dir_closing_databases


@contextmanager
def watch_outbound_requests():
    threads = []
    real_thread = threading.Thread

    def start_thread(**kwargs):
        thread = real_thread(**kwargs)
        threads.append(thread)
        return thread

    with patch("threading.Thread", side_effect=start_thread), patch.object(
        urllib.request, "urlopen", side_effect=lambda *args, **kwargs: io.BytesIO(b"{}")
    ) as transport:
        try:
            yield transport, threads
        finally:
            for thread in threads:
                thread.join(5)
                if thread.is_alive():
                    raise AssertionError("Synthetic metadata worker did not finish")


class YouTubeCapturePrivacyTests(unittest.TestCase):
    def test_new_video_capture_stays_local_on_both_platforms(self):
        for platform in ("darwin", "win32"):
            for content_setting in (None, "0", "1"):
                with self.subTest(platform=platform, content_setting=content_setting):
                    self.check_sampling(platform, content_setting)

    def test_existing_cached_metadata_survives_new_local_capture(self):
        for platform in ("darwin", "win32"):
            with self.subTest(platform=platform):
                self.check_sampling(platform, "0", cached=True)

    def check_sampling(self, platform, content_setting, cached=False):
        with temp_dir_closing_databases() as tmp:
            db = TrackerDatabase(Path(tmp) / "tracker.sqlite3", perform_maintenance=False)
            if cached:
                db.save_youtube_metadata(YouTubeVideoMetadata(
                    video_id="fixture1234", title="Cached lecture", category="Education",
                    channel_name="Synthetic channel", description="Preserved cached description",
                ))
            snapshots = [Snapshot(
                observed_at=f"2026-10-04T10:00:{second:02d}+00:00",
                app_name="Synthetic Browser", bundle_id="fixture.browser",
                window_title="Local lecture title", source="accessibility",
                site_title="Local lecture title", site_domain="youtube.com",
                site_url="https://www.youtube.com/watch?v=fixture1234", youtube_video_id="fixture1234",
            ) for second in (0, 5)]
            capture_platform = "macos" if platform == "darwin" else "windows"
            with patch.dict(os.environ, {}, clear=False), patch.object(main.sys, "platform", platform), patch.object(
                tracker_storage, "CAPTURE_PLATFORM", capture_platform
            ):
                if content_setting is None:
                    os.environ.pop("DRIFTY_BROWSER_CONTENT_CONTEXT", None)
                else:
                    os.environ["DRIFTY_BROWSER_CONTENT_CONTEXT"] = content_setting
                with watch_outbound_requests() as (transport, threads), patch.object(
                    main, "current_power_state", return_value=PowerStateSample(
                        datetime(2026, 10, 4, tzinfo=timezone.utc), True, "synthetic"
                    )
                ), patch.object(main, "seconds_since_last_input", return_value=0.0), patch.object(
                    main, "_apply_developer_diagnostics_env"
                ), patch.object(main, "current_snapshot", side_effect=snapshots), patch.object(
                    main, "backfill_browser_history_context"
                ):
                    previous = None
                    for _ in snapshots:
                        previous = main._daemon_tick(db, previous)
            transport.assert_not_called()
            self.assertEqual(threads, [])
            rows = db.fetch_timeline("2026-10-04")
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["durationSeconds"], 10)
            self.assertEqual(rows[0]["platform"], capture_platform)
            self.assertEqual(rows[0]["siteTitle"], "Local lecture title")
            self.assertEqual(rows[0]["youtubeVideoId"], "fixture1234")
            if cached:
                self.assertEqual(rows[0]["youtubeTitle"], "Cached lecture")
                self.assertEqual(rows[0]["youtubeCategory"], "Education")
                self.assertEqual(rows[0]["youtubeChannelName"], "Synthetic channel")
                self.assertEqual(rows[0]["youtubeDescription"], "Preserved cached description")
            else:
                self.assertIsNone(rows[0]["youtubeCategory"])
                self.assertEqual(db.connect().execute("SELECT COUNT(*) FROM youtube_video_metadata").fetchone()[0], 0)

    def test_history_backfill_keeps_local_identity_without_network(self):
        for platform in ("darwin", "win32"):
            # Only saved Mac rows are eligible for History backfill, even when
            # the database is subsequently opened on Windows.
            with self.subTest(platform=platform), temp_dir_closing_databases() as tmp, patch.object(
                tracker_storage, "CAPTURE_PLATFORM", "macos"
            ):
                db = TrackerDatabase(Path(tmp) / "tracker.sqlite3", perform_maintenance=False)
                db.record_snapshot(Snapshot(
                    observed_at="2026-04-06T09:00:00+00:00", app_name="Google Chrome",
                    bundle_id="com.google.Chrome", window_title="Lecture - YouTube - Google Chrome",
                    source="accessibility", browser_name="Google Chrome", browser_automation_status="unavailable",
                    browser_history_status="no_match", browser_history_reason="outside_time_window",
                    browser_history_database_found=True,
                ), 5)
                resolved = BrowserMetadata(
                    browser_name="Google Chrome", site_domain="youtube.com", site_title="Lecture - YouTube",
                    site_url="https://www.youtube.com/watch?v=fixture1234", youtube_video_id="fixture1234",
                    match_state="browser-history-title", browser_history_status="matched",
                    browser_history_reason="matched", browser_history_database_found=True,
                )
                with watch_outbound_requests() as (transport, threads), patch.object(
                    main.sys, "platform", platform
                ), patch.object(browser_history, "browser_history_metadata", return_value=resolved) as resolver:
                    main.backfill_browser_history_context(db, "2026-04-06T09:00:30+00:00")
                resolver.assert_called_once()
                transport.assert_not_called()
                self.assertEqual(threads, [])
                row = db.fetch_timeline("2026-04-06")[0]
                self.assertEqual(row["siteUrl"], resolved.site_url)
                self.assertEqual(row["siteTitle"], resolved.site_title)
                self.assertEqual(row["youtubeVideoId"], "fixture1234")
                self.assertEqual(row["siteSource"], "browser-history-title")


if __name__ == "__main__":
    unittest.main()
