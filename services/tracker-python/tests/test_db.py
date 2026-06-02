import sys
import unittest
from datetime import datetime
from pathlib import Path
from tempfile import TemporaryDirectory

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.storage.db import TrackerDatabase
from app.tracker.macos_workspace import Snapshot
from app.tracker.youtube_metadata import YouTubeVideoMetadata


class TrackerDatabaseTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = TemporaryDirectory()
        self.db_path = Path(self.tempdir.name) / "tracker.sqlite3"
        self.database = TrackerDatabase(self.db_path)

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    def test_record_snapshot_does_not_merge_same_activity_after_long_gap(self) -> None:
        self.database.record_snapshot(
            Snapshot(
                observed_at="2026-04-06T09:00:00+00:00",
                app_name="Code",
                bundle_id="com.microsoft.VSCode",
                window_title="main.py",
                source="accessibility",
            ),
            5,
            max_merge_gap_seconds=180,
        )
        self.database.record_snapshot(
            Snapshot(
                observed_at="2026-04-06T09:10:00+00:00",
                app_name="Code",
                bundle_id="com.microsoft.VSCode",
                window_title="main.py",
                source="accessibility",
            ),
            5,
            max_merge_gap_seconds=180,
        )

        events = self.database.fetch_timeline("2026-04-06")
        self.assertEqual(len(events), 2)

    def test_record_snapshot_still_merges_same_activity_within_gap(self) -> None:
        self.database.record_snapshot(
            Snapshot(
                observed_at="2026-04-06T09:00:00+00:00",
                app_name="Code",
                bundle_id="com.microsoft.VSCode",
                window_title="main.py",
                source="accessibility",
            ),
            5,
            max_merge_gap_seconds=180,
        )
        self.database.record_snapshot(
            Snapshot(
                observed_at="2026-04-06T09:00:05+00:00",
                app_name="Code",
                bundle_id="com.microsoft.VSCode",
                window_title="main.py",
                source="accessibility",
            ),
            5,
            max_merge_gap_seconds=180,
        )

        events = self.database.fetch_timeline("2026-04-06")
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["durationSeconds"], 10)

    def test_trim_latest_segment_shortens_duration(self) -> None:
        self.database.insert_segment(
            {
                "started_at": "2026-04-06T09:00:00+00:00",
                "ended_at": "2026-04-06T09:10:00+00:00",
                "duration_seconds": 600,
                "app_name": "Code",
                "bundle_id": None,
                "window_title": "main.py",
                "platform": "macos",
                "source": "accessibility",
                "confidence": None,
                "raw_context_json": "{}",
            }
        )

        self.database.trim_latest_segment("2026-04-06T09:03:00+00:00")

        events = self.database.fetch_timeline("2026-04-06")
        self.assertEqual(events[0]["endedAt"], "2026-04-06T09:03:00+00:00")
        self.assertEqual(events[0]["durationSeconds"], 180)

    def test_trim_latest_segment_deletes_empty_result(self) -> None:
        self.database.insert_segment(
            {
                "started_at": "2026-04-06T09:00:00+00:00",
                "ended_at": "2026-04-06T09:10:00+00:00",
                "duration_seconds": 600,
                "app_name": "Code",
                "bundle_id": None,
                "window_title": "main.py",
                "platform": "macos",
                "source": "accessibility",
                "confidence": None,
                "raw_context_json": "{}",
            }
        )

        self.database.trim_latest_segment("2026-04-06T09:00:00+00:00")

        self.assertEqual(self.database.fetch_timeline("2026-04-06"), [])

    def test_insert_and_fetch_timeline(self) -> None:
        started_at = "2026-04-06T09:00:00+00:00"
        self.database.insert_segment(
            {
                "started_at": started_at,
                "ended_at": "2026-04-06T09:05:00+00:00",
                "duration_seconds": 300,
                "app_name": "Finder",
                "bundle_id": "com.apple.finder",
                "window_title": None,
                "platform": "macos",
                "source": "nsworkspace",
                "confidence": None,
                "raw_context_json": "{}",
            }
        )
        local_day = datetime.fromisoformat(started_at).astimezone().date().isoformat()
        events = self.database.fetch_timeline(local_day)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["appName"], "Finder")

    def test_hourly_summary_groups_by_hour(self) -> None:
        started_at = "2026-04-06T09:00:00+00:00"
        self.database.insert_segment(
            {
                "started_at": started_at,
                "ended_at": "2026-04-06T09:30:00+00:00",
                "duration_seconds": 1800,
                "app_name": "Code",
                "bundle_id": None,
                "window_title": "main.tsx",
                "platform": "macos",
                "source": "nsworkspace",
                "confidence": None,
                "raw_context_json": "{}",
            }
        )
        local_day = datetime.fromisoformat(started_at).astimezone().date().isoformat()
        local_hour = datetime.fromisoformat(started_at).astimezone().strftime("%H:00")
        summary = self.database.fetch_hourly_summary(local_day)
        self.assertEqual(summary[0]["hourLabel"], local_hour)
        self.assertEqual(summary[0]["durationSeconds"], 1800)

    def test_last_event_at_reads_latest_end(self) -> None:
        self.database.insert_segment(
            {
                "started_at": "2026-04-06T09:00:00+00:00",
                "ended_at": "2026-04-06T09:05:00+00:00",
                "duration_seconds": 300,
                "app_name": "Finder",
                "bundle_id": None,
                "window_title": None,
                "platform": "macos",
                "source": "nsworkspace",
                "confidence": None,
                "raw_context_json": "{}",
            }
        )
        self.assertEqual(self.database.fetch_last_event_at(), "2026-04-06T09:05:00+00:00")

    def test_fetch_top_sites_aggregates_browser_rows(self) -> None:
        started_at = "2026-04-06T09:00:00+00:00"
        self.database.insert_segment(
            {
                "started_at": started_at,
                "ended_at": "2026-04-06T09:05:00+00:00",
                "duration_seconds": 300,
                "app_name": "Safari",
                "bundle_id": "com.apple.Safari",
                "window_title": "Tauri docs",
                "site_domain": "tauri.app",
                "site_title": "Tauri docs",
                "browser_name": "Safari",
                "site_source": "applescript",
                "platform": "macos",
                "source": "accessibility",
                "confidence": 1.0,
                "raw_context_json": "{}",
            }
        )
        local_day = datetime.fromisoformat(started_at).astimezone().date().isoformat()
        sites = self.database.fetch_top_sites(local_day)
        self.assertEqual(sites[0]["siteDomain"], "tauri.app")
        self.assertEqual(sites[0]["totalSeconds"], 300)

    def test_browser_url_and_youtube_ids_are_persisted(self) -> None:
        self.database.record_snapshot(
            Snapshot(
                observed_at="2026-04-06T09:00:00+00:00",
                app_name="Safari",
                bundle_id="com.apple.Safari",
                window_title="Tiny Desk Concert",
                source="accessibility",
                browser_name="Safari",
                site_domain="youtube.com",
                site_title="Tiny Desk Concert",
                site_url="https://www.youtube.com/watch?v=abc123&list=RDabc123",
                youtube_video_id="abc123",
                youtube_playlist_id="RDabc123",
                youtube_is_shorts=False,
                site_source="applescript",
            ),
            5,
        )

        events = self.database.fetch_timeline("2026-04-06")

        self.assertEqual(events[0]["siteUrl"], "https://www.youtube.com/watch?v=abc123&list=RDabc123")
        self.assertEqual(events[0]["youtubeVideoId"], "abc123")
        self.assertEqual(events[0]["youtubePlaylistId"], "RDabc123")
        self.assertFalse(events[0]["youtubeIsShorts"])

    def test_youtube_metadata_is_joined_into_timeline(self) -> None:
        self.database.record_snapshot(
            Snapshot(
                observed_at="2026-04-06T09:00:00+00:00",
                app_name="Safari",
                bundle_id="com.apple.Safari",
                window_title="MIT Lecture",
                source="accessibility",
                browser_name="Safari",
                site_domain="youtube.com",
                site_title="MIT Lecture",
                site_url="https://www.youtube.com/watch?v=lecture123",
                youtube_video_id="lecture123",
                youtube_is_shorts=False,
                site_source="applescript",
            ),
            5,
        )
        self.database.save_youtube_metadata(
            YouTubeVideoMetadata(
                video_id="lecture123",
                category="Education",
                channel_id="channel-1",
                channel_name="MIT OpenCourseWare",
                title="MIT Lecture",
                description="Lecture description",
                keywords=["lecture", "cs"],
                duration_seconds=1200,
                view_count=12345,
                is_live=False,
                is_unlisted=True,
                publish_date="2026-04-06",
                upload_date="2026-04-05",
            )
        )

        events = self.database.fetch_timeline("2026-04-06")

        self.assertEqual(events[0]["youtubeCategory"], "Education")
        self.assertEqual(events[0]["youtubeChannelId"], "channel-1")
        self.assertEqual(events[0]["youtubeChannelName"], "MIT OpenCourseWare")
        self.assertEqual(events[0]["youtubeTitle"], "MIT Lecture")
        self.assertEqual(events[0]["youtubeDescription"], "Lecture description")
        self.assertEqual(events[0]["youtubeKeywords"], ["lecture", "cs"])
        self.assertEqual(events[0]["youtubeDurationSeconds"], 1200)
        self.assertEqual(events[0]["youtubeViewCount"], 12345)
        self.assertFalse(events[0]["youtubeIsLive"])
        self.assertTrue(events[0]["youtubeIsUnlisted"])
        self.assertEqual(events[0]["youtubePublishDate"], "2026-04-06")
        self.assertEqual(events[0]["youtubeUploadDate"], "2026-04-05")

    def test_timeline_supports_range_filters(self) -> None:
        self.database.insert_segment(
            {
                "started_at": "2026-04-06T09:00:00+00:00",
                "ended_at": "2026-04-06T09:10:00+00:00",
                "duration_seconds": 600,
                "app_name": "Finder",
                "bundle_id": None,
                "window_title": None,
                "platform": "macos",
                "source": "nsworkspace",
                "confidence": None,
                "raw_context_json": "{}",
            }
        )
        self.database.insert_segment(
            {
                "started_at": "2026-04-08T09:00:00+00:00",
                "ended_at": "2026-04-08T09:10:00+00:00",
                "duration_seconds": 600,
                "app_name": "Code",
                "bundle_id": None,
                "window_title": None,
                "platform": "macos",
                "source": "nsworkspace",
                "confidence": None,
                "raw_context_json": "{}",
            }
        )

        rows = self.database.timeline(start="2026-04-07T00:00:00+00:00", end="2026-04-09T00:00:00+00:00")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["app_name"], "Code")

    def test_saved_classification_is_serialized_with_timeline(self) -> None:
        self.database.record_snapshot(
            Snapshot(
                observed_at="2026-04-06T09:00:00+00:00",
                app_name="Arc",
                bundle_id="company.thebrowser.Browser",
                window_title="Project plan",
                source="accessibility",
                browser_name="Arc",
                site_domain="example.com",
                site_title="Project plan",
            ),
            5,
        )
        segment = self.database.fetch_timeline("2026-04-06")[0]

        saved = self.database.save_classifications([
            {
                "segmentId": segment["id"],
                "category": "workspace",
                "productivity": "focus",
                "source": "llm",
                "confidence": 0.91,
                "reason": "Classified from activity context",
                "model": "gemini-3.1-flash-lite",
                "promptVersion": "v1",
                "taxonomyVersion": "v1",
                "inputFingerprint": "fp-example",
                "aiResult": True,
            }
        ])

        self.assertEqual(saved, 1)
        classified = self.database.fetch_timeline("2026-04-06")[0]
        self.assertEqual(classified["classification"]["category"], "workspace")
        self.assertEqual(classified["classification"]["productivity"], "focus")
        self.assertEqual(classified["classification"]["source"], "llm")
        self.assertTrue(classified["classification"]["aiResult"])

    def test_refresh_non_ai_classifications_preserves_ai_results(self) -> None:
        self.database.insert_segment(
            {
                "started_at": "2026-04-06T09:00:00+00:00",
                "ended_at": "2026-04-06T09:05:00+00:00",
                "duration_seconds": 300,
                "app_name": "Code",
            }
        )
        self.database.insert_segment(
            {
                "started_at": "2026-04-06T10:00:00+00:00",
                "ended_at": "2026-04-06T10:05:00+00:00",
                "duration_seconds": 300,
                "app_name": "Mail",
            }
        )
        segments = self.database.fetch_timeline("2026-04-06")

        self.database.save_classifications([
            {
                "segmentId": segments[0]["id"],
                "category": "workspace",
                "productivity": "focus",
                "source": "llm",
                "confidence": 0.9,
                "inputFingerprint": "fp-ai",
                "aiResult": True,
            },
            {
                "segmentId": segments[1]["id"],
                "category": "communication",
                "productivity": "neutral",
                "source": "rule",
                "confidence": 0.7,
                "inputFingerprint": "fp-rule",
                "aiResult": False,
            },
        ])

        deleted = self.database.refresh_non_ai_classifications()
        refreshed = self.database.fetch_timeline("2026-04-06")

        self.assertEqual(deleted, 1)
        self.assertEqual(self.database.classification_metrics()["aiClassifiedSegments"], 1)
        self.assertEqual(sum(1 for item in refreshed if item.get("classification")), 1)



if __name__ == "__main__":
    unittest.main()
