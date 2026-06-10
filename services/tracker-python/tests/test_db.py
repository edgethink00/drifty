import os
import sys
import time
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

    def test_timeline_range_filters_treat_naive_bounds_as_local_time(self) -> None:
        previous_tz = os.environ.get("TZ")
        os.environ["TZ"] = "Asia/Seoul"
        time.tzset()
        try:
            self.database.insert_segment(
                {
                    "started_at": "2026-06-10T00:41:46+00:00",
                    "ended_at": "2026-06-10T00:55:00+00:00",
                    "duration_seconds": 795,
                    "app_name": "Calendar",
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
                    "started_at": "2026-06-10T19:30:00+00:00",
                    "ended_at": "2026-06-10T19:45:00+00:00",
                    "duration_seconds": 900,
                    "app_name": "Slack",
                    "bundle_id": None,
                    "window_title": None,
                    "platform": "macos",
                    "source": "nsworkspace",
                    "confidence": None,
                    "raw_context_json": "{}",
                }
            )

            rows = self.database.timeline(start="2026-06-10T04:00:00", end="2026-06-11T03:59:59")
        finally:
            if previous_tz is None:
                os.environ.pop("TZ", None)
            else:
                os.environ["TZ"] = previous_tz
            time.tzset()

        self.assertEqual([row["app_name"] for row in rows], ["Calendar"])
        self.assertEqual(rows[0]["started_at"], "2026-06-10T00:41:46+00:00")

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

        self.assertEqual(deleted, 0)
        self.assertEqual(self.database.classification_metrics()["aiClassifiedSegments"], 1)
        self.assertEqual(sum(1 for item in refreshed if item.get("classification")), 2)
        self.assertEqual(refreshed[1]["classification"]["source"], "rule")

    def test_classification_rule_crud_normalizes_site_target(self) -> None:
        rule = self.database.save_classification_rule(
            {
                "targetKind": "site",
                "targetValue": "https://www.Example.com/docs",
                "category": "learning",
                "productivity": "focus",
                "confidence": 0.8,
            }
        )

        rules = self.database.get_classification_rules()
        deleted = self.database.delete_classification_rule(rule["id"])

        self.assertEqual(rule["targetValue"], "example.com")
        self.assertEqual(rules[0]["targetKind"], "site")
        self.assertEqual(rules[0]["category"], "learning")
        self.assertEqual(deleted, 1)
        self.assertEqual(self.database.get_classification_rules(), [])

    def test_search_classification_rule_candidates_returns_sites_and_apps(self) -> None:
        self.database.insert_segment(
            {
                "started_at": "2026-04-06T09:00:00+00:00",
                "ended_at": "2026-04-06T09:03:20+00:00",
                "duration_seconds": 200,
                "app_name": "Safari",
                "bundle_id": "com.apple.Safari",
                "site_domain": "docs.example.com",
                "site_title": "Example Docs",
            }
        )
        self.database.insert_segment(
            {
                "started_at": "2026-04-06T09:10:00+00:00",
                "ended_at": "2026-04-06T09:15:00+00:00",
                "duration_seconds": 300,
                "app_name": "Safari",
                "bundle_id": "com.apple.Safari",
                "site_domain": "docs.example.com",
                "site_title": "Example Docs",
            }
        )
        self.database.insert_segment(
            {
                "started_at": "2026-04-06T10:00:00+00:00",
                "ended_at": "2026-04-06T10:10:00+00:00",
                "duration_seconds": 600,
                "app_name": "Safari Technology Preview",
                "bundle_id": "com.apple.SafariTechnologyPreview",
                "site_domain": "blog.example.com",
                "site_title": "Example Blog",
            }
        )

        site_candidates = self.database.search_classification_rule_candidates("example")
        app_candidates = self.database.search_classification_rule_candidates("safari")

        self.assertEqual(site_candidates[0]["targetValue"], "blog.example.com")
        self.assertEqual(site_candidates[0]["targetKind"], "site")
        self.assertEqual(site_candidates[0]["segmentCount"], 1)
        self.assertEqual(site_candidates[0]["totalSeconds"], 600)
        self.assertEqual(site_candidates[1]["targetValue"], "docs.example.com")
        self.assertEqual(site_candidates[1]["segmentCount"], 2)
        self.assertEqual(site_candidates[1]["totalSeconds"], 500)

        self.assertEqual(app_candidates[0]["bundleId"], "com.apple.SafariTechnologyPreview")
        self.assertEqual(app_candidates[0]["totalSeconds"], 600)
        self.assertEqual(app_candidates[1]["bundleId"], "com.apple.Safari")
        self.assertEqual(app_candidates[1]["totalSeconds"], 500)

    def test_apply_classification_rules_matches_site_subdomains_and_app_names(self) -> None:
        self.database.insert_segment(
            {
                "started_at": "2026-04-06T09:00:00+00:00",
                "ended_at": "2026-04-06T09:05:00+00:00",
                "duration_seconds": 300,
                "app_name": "Safari",
                "bundle_id": "com.apple.Safari",
                "site_domain": "docs.example.com",
            }
        )
        self.database.insert_segment(
            {
                "started_at": "2026-04-06T10:00:00+00:00",
                "ended_at": "2026-04-06T10:05:00+00:00",
                "duration_seconds": 300,
                "app_name": "Linear",
                "bundle_id": None,
            }
        )
        site_rule = self.database.save_classification_rule(
            {
                "targetKind": "site",
                "targetValue": "example.com",
                "category": "learning",
                "productivity": "focus",
            }
        )
        self.database.save_classification_rule(
            {
                "targetKind": "app",
                "targetValue": "Linear",
                "category": "workspace",
                "productivity": "focus",
            }
        )

        result = self.database.apply_classification_rules()
        events = self.database.fetch_timeline("2026-04-06")

        self.assertEqual(result["matchedCount"], 2)
        self.assertEqual(result["appliedCount"], 2)
        self.assertEqual(events[0]["classification"]["source"], "rule")
        self.assertEqual(events[0]["classification"]["category"], "learning")
        self.assertEqual(events[0]["classification"]["classificationRuleId"], site_rule["id"])
        self.assertEqual(events[1]["classification"]["category"], "workspace")

    def test_delete_classification_rule_removes_materialized_rule_classifications(self) -> None:
        self.database.insert_segment(
            {
                "started_at": "2026-04-06T09:00:00+00:00",
                "ended_at": "2026-04-06T09:05:00+00:00",
                "duration_seconds": 300,
                "app_name": "Linear",
            }
        )
        rule = self.database.save_classification_rule(
            {
                "targetKind": "app",
                "targetValue": "Linear",
                "category": "workspace",
                "productivity": "focus",
            }
        )
        self.database.apply_classification_rules()
        self.assertEqual(self.database.fetch_timeline("2026-04-06")[0]["classification"]["classificationRuleId"], rule["id"])

        deleted = self.database.delete_classification_rule(rule["id"])
        refreshed = self.database.fetch_timeline("2026-04-06")

        self.assertEqual(deleted, 1)
        self.assertNotIn("classification", refreshed[0])

    def test_disabling_classification_rule_removes_materialized_rule_classifications(self) -> None:
        self.database.insert_segment(
            {
                "started_at": "2026-04-06T09:00:00+00:00",
                "ended_at": "2026-04-06T09:05:00+00:00",
                "duration_seconds": 300,
                "app_name": "Safari",
                "bundle_id": "com.apple.Safari",
                "site_domain": "docs.example.com",
            }
        )
        rule = self.database.save_classification_rule(
            {
                "targetKind": "site",
                "targetValue": "example.com",
                "category": "learning",
                "productivity": "focus",
            }
        )
        self.database.apply_classification_rules()
        self.assertEqual(self.database.fetch_timeline("2026-04-06")[0]["classification"]["classificationRuleId"], rule["id"])

        disabled = self.database.save_classification_rule(
            {
                "targetKind": "site",
                "targetValue": "example.com",
                "category": "learning",
                "productivity": "focus",
                "enabled": False,
            }
        )
        refreshed = self.database.fetch_timeline("2026-04-06")

        self.assertFalse(disabled["enabled"])
        self.assertEqual(disabled["id"], rule["id"])
        self.assertNotIn("classification", refreshed[0])

    def test_save_classifications_clears_rule_id_for_non_rule_rows(self) -> None:
        self.database.insert_segment(
            {
                "started_at": "2026-04-06T09:00:00+00:00",
                "ended_at": "2026-04-06T09:05:00+00:00",
                "duration_seconds": 300,
                "app_name": "Linear",
            }
        )
        rule = self.database.save_classification_rule(
            {
                "targetKind": "app",
                "targetValue": "Linear",
                "category": "workspace",
                "productivity": "focus",
            }
        )
        self.database.apply_classification_rules()
        segment = self.database.fetch_timeline("2026-04-06")[0]
        self.assertEqual(segment["classification"]["classificationRuleId"], rule["id"])

        self.database.save_classifications(
            [
                {
                    "segmentId": segment["id"],
                    "category": "communication",
                    "productivity": "neutral",
                    "source": "manual",
                    "confidence": 0.7,
                    "inputFingerprint": "manual-fp",
                }
            ]
        )

        updated = self.database.fetch_timeline("2026-04-06")[0]
        self.assertEqual(updated["classification"]["source"], "manual")
        self.assertIsNone(updated["classification"]["classificationRuleId"])

    def test_reusable_ai_classification_lookup_returns_exact_fingerprint_hit(self) -> None:
        segment_id = self._insert_classified_segment(
            "2026-04-06T09:00:00+00:00",
            "fp-reusable",
            category="learning",
            productivity="focus",
            reason="Prior AI result",
        )

        reusable = self.database.get_reusable_ai_classifications(["fp-reusable", "fp-missing"])

        self.assertEqual(set(reusable.keys()), {"fp-reusable"})
        self.assertEqual(reusable["fp-reusable"]["segmentId"], str(segment_id))
        self.assertEqual(reusable["fp-reusable"]["inputFingerprint"], "fp-reusable")
        self.assertEqual(reusable["fp-reusable"]["category"], "learning")
        self.assertEqual(reusable["fp-reusable"]["productivity"], "focus")
        self.assertEqual(reusable["fp-reusable"]["source"], "llm")
        self.assertTrue(reusable["fp-reusable"]["aiResult"])
        self.assertFalse(reusable["fp-reusable"]["stale"])

    def test_reusable_ai_classification_lookup_ignores_non_ai_results(self) -> None:
        self._insert_classified_segment(
            "2026-04-06T09:00:00+00:00",
            "fp-rule",
            source="rule",
            ai_result=False,
        )

        reusable = self.database.get_reusable_ai_classifications(["fp-rule"])

        self.assertEqual(reusable, {})

    def test_reusable_ai_classification_lookup_ignores_stale_results(self) -> None:
        self._insert_classified_segment(
            "2026-04-06T09:00:00+00:00",
            "fp-stale",
            stale=True,
        )

        reusable = self.database.get_reusable_ai_classifications(["fp-stale"])

        self.assertEqual(reusable, {})

    def test_reusable_ai_classification_lookup_returns_empty_for_miss(self) -> None:
        reusable = self.database.get_reusable_ai_classifications(["fp-unknown"])

        self.assertEqual(reusable, {})

    def test_reusable_ai_classification_lookup_uses_newest_classified_at_then_segment_id(self) -> None:
        self._insert_classified_segment(
            "2026-04-06T09:00:00+00:00",
            "fp-duplicate",
            category="workspace",
            classified_at="2026-04-06T10:00:00+00:00",
        )
        newest_segment_id = self._insert_classified_segment(
            "2026-04-06T10:00:00+00:00",
            "fp-duplicate",
            category="learning",
            classified_at="2026-04-06T11:00:00+00:00",
        )
        self._insert_classified_segment(
            "2026-04-06T11:00:00+00:00",
            "fp-tie",
            category="workspace",
            classified_at="2026-04-06T12:00:00+00:00",
        )
        tie_winner_id = self._insert_classified_segment(
            "2026-04-06T12:00:00+00:00",
            "fp-tie",
            category="utility",
            classified_at="2026-04-06T12:00:00+00:00",
        )

        reusable = self.database.get_reusable_ai_classifications(["fp-duplicate", "fp-tie"])

        self.assertEqual(reusable["fp-duplicate"]["segmentId"], str(newest_segment_id))
        self.assertEqual(reusable["fp-duplicate"]["category"], "learning")
        self.assertEqual(reusable["fp-tie"]["segmentId"], str(tie_winner_id))
        self.assertEqual(reusable["fp-tie"]["category"], "utility")

    def _insert_classified_segment(
        self,
        started_at: str,
        input_fingerprint: str,
        *,
        category: str = "workspace",
        productivity: str = "focus",
        source: str = "llm",
        confidence: float = 0.9,
        reason: str = "Prior result",
        model: str = "gemini-3.1-flash-lite",
        prompt_version: str = "v1",
        taxonomy_version: str = "v1",
        classified_at: str = "2026-04-06T09:30:00+00:00",
        ai_result: bool = True,
        stale: bool = False,
    ) -> int:
        self.database.insert_segment(
            {
                "started_at": started_at,
                "ended_at": started_at,
                "duration_seconds": 300,
                "app_name": "MysteryApp",
            }
        )
        segment_id = int(self.database.fetch_timeline(started_at[:10])[-1]["id"])
        self.database.save_classifications([
            {
                "segmentId": segment_id,
                "category": category,
                "productivity": productivity,
                "source": source,
                "confidence": confidence,
                "reason": reason,
                "model": model,
                "promptVersion": prompt_version,
                "taxonomyVersion": taxonomy_version,
                "inputFingerprint": input_fingerprint,
                "aiResult": ai_result,
                "stale": stale,
                "classifiedAt": classified_at,
            }
        ])
        return segment_id



if __name__ == "__main__":
    unittest.main()
