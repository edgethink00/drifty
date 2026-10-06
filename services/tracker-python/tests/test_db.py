from __future__ import annotations

import gc
import os
import sqlite3
import sys
import time
import unittest
import warnings
from contextlib import closing
from dataclasses import replace
from datetime import datetime, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import MagicMock, patch

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.storage.classification_rule_url import canonicalize_classification_rule_site_url
from app.storage.db import BrowserHistoryBackfillConfig, TrackerDatabase
from app.tracker.browser_automation import BrowserMetadata
from app.tracker.macos_workspace import Snapshot
from app.tracker.youtube_metadata import YouTubeVideoMetadata
from tests.support_cleanup import cleanup_temp_dir


class ClassificationRuleUrlTests(unittest.TestCase):
    def test_canonicalizes_bare_hosts_with_ports_like_the_desktop_helper(self) -> None:
        self.assertEqual(
            canonicalize_classification_rule_site_url("example.com:8443/work/plan?token=secret&view=compact#section"),
            "https://example.com:8443/work/plan?view=compact",
        )


class TrackerDatabaseTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = TemporaryDirectory()
        self.db_path = Path(self.tempdir.name) / "tracker.sqlite3"
        self.database = TrackerDatabase(self.db_path)

    def tearDown(self) -> None:
        cleanup_temp_dir(self.tempdir)

    def test_database_context_does_not_leak_connections_or_resource_warnings(self) -> None:
        with warnings.catch_warnings(record=True) as captured:
            warnings.simplefilter("always", ResourceWarning)
            with self.database.connect() as conn:
                conn.execute("SELECT 1").fetchone()

            del conn
            gc.collect()

        resource_warnings = [str(warning.message) for warning in captured if warning.category is ResourceWarning]
        self.assertEqual([], resource_warnings)

    def test_connect_reuses_one_connection_and_commits_without_closing(self) -> None:
        first = self.database.connect()
        second = self.database.connect()
        self.assertIs(first, second)

        with self.database.connect() as conn:
            conn.execute("INSERT INTO tracker_meta (key, value) VALUES ('commit-key', 'commit-value')")

        # The with-block committed (visible to a separate connection) and the
        # shared connection stays open and usable afterwards.
        other = TrackerDatabase(self.db_path)
        self.assertEqual(other.get_meta("commit-key"), "commit-value")
        self.assertEqual(self.database.connect().execute("SELECT 1").fetchone()[0], 1)

    def test_connection_context_rolls_back_on_exception(self) -> None:
        with self.assertRaises(RuntimeError):
            with self.database.connect() as conn:
                conn.execute("INSERT INTO tracker_meta (key, value) VALUES ('rollback-key', 'rollback-value')")
                raise RuntimeError("boom")

        self.assertIsNone(self.database.get_meta("rollback-key"))

    def test_existing_database_adds_engagement_evidence_column_without_losing_activity(self) -> None:
        self.database.close()
        self.db_path.unlink()
        with sqlite3.connect(self.db_path) as connection:
            connection.executescript(
                """
                CREATE TABLE activity_segments (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  started_at TEXT NOT NULL,
                  ended_at TEXT NOT NULL,
                  duration_seconds INTEGER NOT NULL,
                  app_name TEXT NOT NULL,
                  bundle_id TEXT,
                  window_title TEXT,
                  platform TEXT NOT NULL,
                  source TEXT NOT NULL,
                  confidence REAL,
                  raw_context_json TEXT
                );
                INSERT INTO activity_segments (
                  started_at, ended_at, duration_seconds, app_name, platform, source
                ) VALUES (
                  '2026-04-06T09:00:00+00:00',
                  '2026-04-06T09:05:00+00:00',
                  300,
                  'Legacy App',
                  'macos',
                  'nsworkspace'
                );
                """
            )

        self.database = TrackerDatabase(self.db_path)

        with self.database.connect() as connection:
            columns = {
                row["name"]
                for row in connection.execute("PRAGMA table_info(activity_segments)")
            }
        timeline = self.database.fetch_timeline("2026-04-06")
        self.assertIn("engagement_evidence", columns)
        self.assertEqual(len(timeline), 1)
        self.assertEqual(timeline[0]["appName"], "Legacy App")
        self.assertEqual(timeline[0]["durationSeconds"], 300)
        self.assertNotIn("engagementEvidence", timeline[0])

    def _insert_activity_segment(
        self,
        index: int,
        *,
        started_at: str | None = None,
        ended_at: str | None = None,
        **overrides,
    ) -> None:
        default_started_at = datetime(2026, 4, 6, 9, 0, 0) + timedelta(minutes=index)
        default_ended_at = default_started_at + timedelta(seconds=30)
        segment = {
            "started_at": started_at or f"{default_started_at.isoformat(timespec='seconds')}+00:00",
            "ended_at": ended_at or f"{default_ended_at.isoformat(timespec='seconds')}+00:00",
            "duration_seconds": 30,
            "app_name": "Code",
            "bundle_id": "com.microsoft.VSCode",
            "window_title": f"Window {index}",
            "platform": "macos",
            "source": "accessibility",
            "confidence": None,
            "raw_context_json": "{}",
        }
        segment.update(overrides)
        self.database.insert_segment(segment)

    def test_timeline_page_defaults_to_200_rows_and_returns_cursor(self) -> None:
        for index in range(205):
            self._insert_activity_segment(index)

        page = self.database.timeline_page(
            start="2026-04-06T00:00:00+00:00",
            end="2026-04-06T23:59:59+00:00",
        )

        self.assertEqual(len(page["items"]), 200)
        self.assertTrue(page["hasMore"])
        self.assertEqual(page["items"][0]["windowTitle"], "Window 5")
        self.assertEqual(page["items"][-1]["windowTitle"], "Window 204")
        self.assertEqual(
            page["nextCursor"],
            {
                "beforeEndedAt": page["items"][0]["endedAt"],
                "beforeSegmentId": page["items"][0]["id"],
            },
        )

    def test_timeline_page_clamps_limit_between_1_and_500(self) -> None:
        for index in range(505):
            self._insert_activity_segment(index)

        tiny_page = self.database.timeline_page(
            start="2026-04-06T00:00:00+00:00",
            end="2026-04-06T23:59:59+00:00",
            limit=0,
        )
        large_page = self.database.timeline_page(
            start="2026-04-06T00:00:00+00:00",
            end="2026-04-06T23:59:59+00:00",
            limit=999,
        )

        self.assertEqual(len(tiny_page["items"]), 1)
        self.assertTrue(tiny_page["hasMore"])
        self.assertEqual(len(large_page["items"]), 500)
        self.assertTrue(large_page["hasMore"])

    def test_timeline_page_cursor_handles_duplicate_ended_at_without_gaps(self) -> None:
        duplicate_ended_at = "2026-04-06T10:00:00+00:00"
        for index in range(4):
            self._insert_activity_segment(
                index,
                started_at=f"2026-04-06T09:{index:02d}:00+00:00",
                ended_at=duplicate_ended_at,
            )

        first_page = self.database.timeline_page(
            start="2026-04-06T00:00:00+00:00",
            end="2026-04-06T23:59:59+00:00",
            limit=2,
        )
        second_page = self.database.timeline_page(
            start="2026-04-06T00:00:00+00:00",
            end="2026-04-06T23:59:59+00:00",
            before_ended_at=first_page["nextCursor"]["beforeEndedAt"],
            before_segment_id=first_page["nextCursor"]["beforeSegmentId"],
            limit=2,
        )

        observed_ids = [item["id"] for item in second_page["items"]] + [item["id"] for item in first_page["items"]]
        full_timeline_ids = [item["id"] for item in self.database.fetch_timeline("2026-04-06")]
        self.assertEqual(observed_ids, full_timeline_ids)
        self.assertFalse(second_page["hasMore"])
        self.assertIsNone(second_page["nextCursor"])

    def test_search_timeline_page_returns_old_match_when_no_range_is_passed(self) -> None:
        self._insert_activity_segment(
            0,
            started_at="2026-01-01T09:00:00+00:00",
            ended_at="2026-01-01T09:05:00+00:00",
            app_name="Arc",
            window_title="Archive planning",
            site_domain="old.example",
        )
        self._insert_activity_segment(
            1,
            started_at="2026-04-06T09:00:00+00:00",
            ended_at="2026-04-06T09:05:00+00:00",
            app_name="Code",
            window_title="Current work",
        )

        page = self.database.search_timeline_page("archive")

        self.assertEqual([item["windowTitle"] for item in page["items"]], ["Archive planning"])
        self.assertFalse(page["hasMore"])
        self.assertIsNone(page["nextCursor"])

    def test_search_timeline_page_excludes_nonmatching_rows_and_uses_all_tokens(self) -> None:
        self._insert_activity_segment(0, app_name="Arc", window_title="Project board", site_domain="example.com")
        self._insert_activity_segment(1, app_name="Arc", window_title="Personal board", site_domain="example.com")
        self._insert_activity_segment(2, app_name="Code", window_title="Project editor", site_domain="internal.test")

        page = self.database.search_timeline_page("arc project")

        self.assertEqual([item["windowTitle"] for item in page["items"]], ["Project board"])

    def test_search_timeline_page_treats_like_wildcards_as_literals(self) -> None:
        self._insert_activity_segment(0, window_title="Budget 100%_done")
        self._insert_activity_segment(1, window_title="Budget 100xxdone")

        page = self.database.search_timeline_page("100%_done")

        self.assertEqual([item["windowTitle"] for item in page["items"]], ["Budget 100%_done"])

    def test_search_timeline_page_cursor_handles_duplicate_ended_at_without_gaps(self) -> None:
        duplicate_ended_at = "2026-04-06T10:00:00+00:00"
        for index in range(4):
            self._insert_activity_segment(
                index,
                started_at=f"2026-04-06T09:{index:02d}:00+00:00",
                ended_at=duplicate_ended_at,
                window_title=f"Search result {index}",
            )

        first_page = self.database.search_timeline_page("search", limit=2)
        second_page = self.database.search_timeline_page(
            "search",
            before_ended_at=first_page["nextCursor"]["beforeEndedAt"],
            before_segment_id=first_page["nextCursor"]["beforeSegmentId"],
            limit=2,
        )

        observed_ids = [item["id"] for item in second_page["items"]] + [item["id"] for item in first_page["items"]]
        full_search_ids = [item["id"] for item in self.database.search_timeline_page("search", limit=10)["items"]]
        self.assertEqual(observed_ids, full_search_ids)
        self.assertFalse(second_page["hasMore"])
        self.assertIsNone(second_page["nextCursor"])

    def test_search_timeline_page_blank_query_returns_empty_page_without_scanning(self) -> None:
        with patch.object(self.database, "connect", side_effect=AssertionError("blank search should not scan")):
            page = self.database.search_timeline_page(" \t\n ")

        self.assertEqual(page, {"items": [], "hasMore": False, "nextCursor": None})

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

    @patch("app.storage.db.CAPTURE_PLATFORM", "macos")
    def test_record_snapshot_splits_changed_app_identity_including_history_enrichment(self) -> None:
        identities = (
            ("com.google.Chrome", "com.other.Chrome"),
            (None, "com.google.Chrome"),
            ("com.google.Chrome", None),
        )
        for identity_index, (prior_identity, next_identity) in enumerate(identities):
            for enrich in (False, True):
                with self.subTest(prior=prior_identity, next=next_identity, history=enrich):
                    with closing(TrackerDatabase(Path(self.tempdir.name) / f"identity-{identity_index}-{enrich}.sqlite3")) as database:
                        prior = Snapshot(
                            observed_at="2026-04-06T09:00:00+00:00",
                            app_name="Google Chrome",
                            bundle_id=prior_identity,
                            window_title="Document - Google Chrome",
                            source="accessibility",
                            browser_name="Google Chrome",
                        )
                        history = {
                            "site_domain": "example.com",
                            "site_title": "Document",
                            "site_url": "https://example.com/document",
                            "site_source": "browser-history-title",
                        } if enrich else {}
                        database.record_snapshot(prior, 5, max_merge_gap_seconds=180)
                        with database.connect() as conn:
                            before = dict(conn.execute("SELECT * FROM activity_segments").fetchone())
                        database.record_snapshot(replace(
                            prior,
                            observed_at="2026-04-06T09:00:05+00:00",
                            bundle_id=next_identity,
                            **history,
                        ), 5, max_merge_gap_seconds=180)
                        with database.connect() as conn:
                            rows = [dict(row) for row in conn.execute("SELECT * FROM activity_segments ORDER BY id")]
                        self.assertEqual(len(rows), 2)
                        self.assertEqual(rows[0], before)
                        self.assertEqual(rows[1]["bundle_id"], next_identity)
                        self.assertEqual(sum(row["duration_seconds"] for row in rows), 10)

    def test_record_snapshot_preserves_windows_row_when_mac_context_matches_or_enriches(self) -> None:
        for enrich in (False, True):
            with self.subTest(history=enrich):
                with closing(TrackerDatabase(Path(self.tempdir.name) / f"platform-{enrich}.sqlite3")) as database:
                    prior = Snapshot(
                        observed_at="2026-04-06T09:00:00+00:00",
                        app_name="Google Chrome",
                        # Pin both IDs to the same value so platform isolation
                        # cannot accidentally rely only on differing app IDs.
                        bundle_id="com.google.Chrome",
                        window_title="Document - Google Chrome",
                        source="win32-foreground",
                        browser_name="Google Chrome",
                    )
                    history = {
                        "site_domain": "example.com",
                        "site_title": "Document",
                        "site_url": "https://example.com/document",
                        "site_source": "browser-history-title",
                    } if enrich else {}
                    with patch("app.storage.db.CAPTURE_PLATFORM", "windows"):
                        database.record_snapshot(prior, 5, max_merge_gap_seconds=180)
                    with database.connect() as conn:
                        before = dict(conn.execute("SELECT * FROM activity_segments").fetchone())
                    with patch("app.storage.db.CAPTURE_PLATFORM", "macos"):
                        database.record_snapshot(replace(
                            prior,
                            observed_at="2026-04-06T09:00:05+00:00",
                            source="accessibility",
                            **history,
                        ), 5, max_merge_gap_seconds=180)
                    with database.connect() as conn:
                        rows = [dict(row) for row in conn.execute("SELECT * FROM activity_segments ORDER BY id")]
                    self.assertEqual(len(rows), 2)
                    self.assertEqual(rows[0], before)
                    self.assertEqual(rows[1]["platform"], "macos")
                    self.assertEqual(rows[1]["site_url"], history.get("site_url"))
                    self.assertEqual(sum(row["duration_seconds"] for row in rows), 10)

    @patch("app.storage.db.CAPTURE_PLATFORM", "windows")
    def test_record_snapshot_coalesces_same_windows_app_identity_without_a_url(self) -> None:
        snapshot = Snapshot(
            observed_at="2026-04-06T09:00:00+00:00",
            app_name="Google Chrome",
            bundle_id=r"C:\Apps\Chrome\chrome.exe",
            window_title="Document - Google Chrome",
            source="win32-foreground",
            browser_name="Google Chrome",
            browser_automation_status="unavailable",
        )
        self.database.record_snapshot(snapshot, 5, max_merge_gap_seconds=180)
        self.database.record_snapshot(replace(
            snapshot,
            observed_at="2026-04-06T09:00:05+00:00",
            browser_automation_error="The live URL read is still unavailable.",
        ), 5, max_merge_gap_seconds=180)

        events = self.database.fetch_timeline("2026-04-06")
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["durationSeconds"], 10)
        self.assertEqual(events[0]["bundleId"], snapshot.bundle_id)
        self.assertEqual(events[0]["platform"], "windows")
        self.assertIsNone(events[0]["siteUrl"])
        self.assertEqual(events[0]["browserAutomationError"], "The live URL read is still unavailable.")

    @patch("app.storage.db.CAPTURE_PLATFORM", "macos")
    def test_record_snapshot_never_extends_matching_imported_history(self) -> None:
        self._insert_activity_segment(
            0,
            started_at="2026-04-06T08:59:55+00:00",
            ended_at="2026-04-06T09:00:00+00:00",
            duration_seconds=5,
            app_name="Google Chrome",
            bundle_id="com.google.Chrome",
            window_title="Document - Google Chrome",
            browser_name="Google Chrome",
            site_domain="example.com",
            site_title="Document",
            site_url="https://example.com/document",
            site_source="browser-history-import",
            source="browser-history-import",
        )
        with self.database.connect() as conn:
            before = dict(conn.execute("SELECT * FROM activity_segments").fetchone())

        self.database.record_snapshot(Snapshot(
            observed_at="2026-04-06T09:00:05+00:00",
            app_name="Google Chrome",
            bundle_id="com.google.Chrome",
            window_title="Document - Google Chrome",
            source="accessibility",
            browser_name="Google Chrome",
            site_domain="example.com",
            site_title="Document",
            site_url="https://example.com/document",
            site_source="applescript",
        ), 5, max_merge_gap_seconds=180)

        with self.database.connect() as conn:
            rows = [dict(row) for row in conn.execute("SELECT * FROM activity_segments ORDER BY id")]
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0], before)
        self.assertEqual(rows[1]["source"], "accessibility")
        self.assertEqual(rows[1]["duration_seconds"], 5)
        self.assertEqual(rows[1]["site_url"], "https://example.com/document")

    def test_record_snapshot_splits_interactive_and_passive_evidence(self) -> None:
        self.database.record_snapshot(
            Snapshot(
                observed_at="2026-04-06T09:00:00+00:00",
                app_name="Google Chrome",
                bundle_id="com.google.Chrome",
                window_title="Audio review",
                source="accessibility",
            ),
            5,
            max_merge_gap_seconds=180,
        )
        self.database.record_snapshot(
            Snapshot(
                observed_at="2026-04-06T09:00:05+00:00",
                app_name="Google Chrome",
                bundle_id="com.google.Chrome",
                window_title="Audio review",
                source="accessibility",
                engagement_evidence="foreground-audio",
            ),
            5,
            max_merge_gap_seconds=15,
        )
        self.database.record_snapshot(
            Snapshot(
                observed_at="2026-04-06T09:00:10+00:00",
                app_name="Google Chrome",
                bundle_id="com.google.Chrome",
                window_title="Audio review",
                source="accessibility",
            ),
            5,
            max_merge_gap_seconds=180,
        )

        events = self.database.fetch_timeline("2026-04-06")
        self.assertEqual(len(events), 3)
        self.assertIsNone(events[0].get("engagementEvidence"))
        self.assertEqual(events[1]["engagementEvidence"], "foreground-audio")
        self.assertIsNone(events[2].get("engagementEvidence"))
        self.assertIsNone(self.database.latest_local_engagement_evidence())

    def test_latest_local_engagement_evidence_reads_passive_segment(self) -> None:
        self.database.record_snapshot(
            Snapshot(
                observed_at="2026-04-06T09:00:00+00:00",
                app_name="Google Chrome",
                bundle_id="com.google.Chrome",
                window_title="Audio review",
                source="accessibility",
                engagement_evidence="foreground-audio",
            ),
            5,
        )

        self.assertEqual(self.database.latest_local_engagement_evidence(), "foreground-audio")

    def test_latest_local_engagement_evidence_does_not_scan_newer_excluded_rows(self) -> None:
        self.database.record_snapshot(
            Snapshot(observed_at="2026-04-06T09:00:00+00:00", app_name="Owned live app",
                     bundle_id="owned.live", window_title="Owned", source="qa",
                     engagement_evidence="foreground-audio"), 5,
        )
        with self.database.connect() as connection:
            connection.executemany(
                """INSERT INTO activity_segments
                   (started_at,ended_at,duration_seconds,app_name,platform,source,origin_device_id)
                   VALUES ('2030-01-01T09:00:00+00:00','2030-01-01T09:00:00+00:00',5,'Owned excluded','macos',?,?)""",
                [("browser-history-import", None), ("qa", "owned-remote")] * 500,
            )
        progress_calls = []
        connection = self.database.connect()
        connection.set_progress_handler(lambda: progress_calls.append(True) or 0, 100)
        try:
            evidence = self.database.latest_local_engagement_evidence()
        finally:
            connection.set_progress_handler(None, 0)
        self.assertEqual(evidence, "foreground-audio")
        self.assertLess(len(progress_calls), 5)

    def test_record_snapshot_refreshes_browser_diagnostics_when_merging(self) -> None:
        self.database.record_snapshot(
            Snapshot(
                observed_at="2026-04-06T09:00:00+00:00",
                app_name="Google Chrome",
                bundle_id="com.google.Chrome",
                window_title=None,
                source="nsworkspace",
                browser_name="Google Chrome",
                browser_automation_status="granted",
            ),
            5,
            max_merge_gap_seconds=180,
        )
        self.database.record_snapshot(
            Snapshot(
                observed_at="2026-04-06T09:00:05+00:00",
                app_name="Google Chrome",
                bundle_id="com.google.Chrome",
                window_title=None,
                source="nsworkspace",
                browser_name="Google Chrome",
                browser_automation_status="empty_result",
                browser_automation_error="Google Chrome returned an empty browser automation result.",
            ),
            5,
            max_merge_gap_seconds=180,
        )

        events = self.database.fetch_timeline("2026-04-06")
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["browserAutomationStatus"], "empty_result")
        self.assertEqual(
            events[0]["browserAutomationError"],
            "Google Chrome returned an empty browser automation result.",
        )

    @patch("app.storage.db.CAPTURE_PLATFORM", "macos")
    def test_record_snapshot_enriches_empty_site_segment_from_browser_history_without_splitting(self) -> None:
        self.database.record_snapshot(
            Snapshot(
                observed_at="2026-04-06T09:00:00+00:00",
                app_name="Google Chrome",
                bundle_id="com.google.Chrome",
                window_title="Lecture - YouTube - Google Chrome",
                source="accessibility",
                browser_name="Google Chrome",
                browser_automation_status="unavailable",
            ),
            5,
            max_merge_gap_seconds=180,
        )
        self.database.record_snapshot(
            Snapshot(
                observed_at="2026-04-06T09:00:05+00:00",
                app_name="Google Chrome",
                bundle_id="com.google.Chrome",
                window_title="Lecture - YouTube - Google Chrome",
                source="accessibility",
                browser_name="Google Chrome",
                site_domain="youtube.com",
                site_title="Lecture - YouTube",
                site_url="https://www.youtube.com/watch?v=lecture",
                youtube_video_id="lecture",
                site_source="browser-history-title",
                capture_confidence=0.45,
                browser_automation_status="granted",
            ),
            5,
            max_merge_gap_seconds=180,
        )

        events = self.database.fetch_timeline("2026-04-06")
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["durationSeconds"], 10)
        self.assertEqual(events[0]["siteDomain"], "youtube.com")
        self.assertEqual(events[0]["siteTitle"], "Lecture - YouTube")
        self.assertEqual(events[0]["siteUrl"], "https://www.youtube.com/watch?v=lecture")
        self.assertEqual(events[0]["youtubeVideoId"], "lecture")
        self.assertEqual(events[0]["siteSource"], "browser-history-title")
        self.assertEqual(events[0]["confidence"], 0.45)

    @patch("app.storage.db.CAPTURE_PLATFORM", "macos")
    def test_backfill_recent_browser_history_context_updates_retryable_no_match_segment(self) -> None:
        self.database.record_snapshot(
            Snapshot(
                observed_at="2026-04-06T09:00:00+00:00",
                app_name="Google Chrome",
                bundle_id="com.google.Chrome",
                window_title="Lecture - YouTube - Google Chrome",
                source="accessibility",
                browser_name="Google Chrome",
                browser_automation_status="unavailable",
                browser_history_status="no_match",
                browser_history_reason="outside_time_window",
                browser_history_database_found=True,
                browser_history_profile_count=1,
                browser_history_candidate_count=0,
                browser_history_error_count=0,
            ),
            5,
            max_merge_gap_seconds=180,
        )
        segment_id = self.database.fetch_timeline("2026-04-06")[0]["id"]
        with self.database.connect() as conn:
            conn.execute(
                """
                INSERT INTO activity_classifications(
                    segment_id,
                    input_fingerprint,
                    category,
                    productivity,
                    source,
                    confidence,
                    classified_at
                ) VALUES (?, 'fp', 'entertainment', 'drift', 'youtube', 0.7, '2026-04-06T09:00:01+00:00')
                """,
                (segment_id,),
            )

        resolver_calls: list[tuple[str | None, str | None, str | None]] = []

        def resolve_browser_history(app_name: str | None, window_title: str | None, observed_at: str | None) -> BrowserMetadata:
            resolver_calls.append((app_name, window_title, observed_at))
            return BrowserMetadata(
                browser_name="Google Chrome",
                site_domain="youtube.com",
                site_title="Lecture - YouTube",
                site_url="https://www.youtube.com/watch?v=lecture",
                youtube_video_id="lecture",
                match_state="browser-history-title",
                browser_automation_status="granted",
                browser_history_status="matched",
                browser_history_reason="matched",
                browser_history_database_found=True,
                browser_history_profile_count=1,
                browser_history_candidate_count=1,
                browser_history_error_count=0,
            )

        results = self.database.backfill_recent_browser_history_context(
            resolve_browser_history,
            lambda title: True,
            BrowserHistoryBackfillConfig(
                observed_at="2026-04-06T09:00:30+00:00",
                max_age_seconds=180,
            ),
        )

        events = self.database.fetch_timeline("2026-04-06")
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].segment_id, int(segment_id))
        self.assertEqual(results[0].youtube_video_id, "lecture")
        self.assertEqual(events[0]["siteDomain"], "youtube.com")
        self.assertEqual(events[0]["siteTitle"], "Lecture - YouTube")
        self.assertEqual(events[0]["siteUrl"], "https://www.youtube.com/watch?v=lecture")
        self.assertEqual(events[0]["youtubeVideoId"], "lecture")
        self.assertEqual(events[0]["siteSource"], "browser-history-title")
        self.assertEqual(events[0]["confidence"], 0.45)
        self.assertTrue(events[0]["classification"]["stale"])
        self.assertEqual(
            resolver_calls,
            [("Google Chrome", "Lecture - YouTube - Google Chrome", "2026-04-06T09:00:00+00:00")],
        )

    @patch("app.storage.db.CAPTURE_PLATFORM", "macos")
    def test_backfill_recent_browser_history_context_skips_segments_older_than_max_age(self) -> None:
        for observed_at in ("2026-04-06T08:00:00+00:00", "2026-04-06T09:00:00+00:00"):
            self.database.record_snapshot(
                Snapshot(
                    observed_at=observed_at,
                    app_name="Google Chrome",
                    bundle_id="com.google.Chrome",
                    window_title="Lecture - YouTube - Google Chrome",
                    source="accessibility",
                    browser_name="Google Chrome",
                    browser_automation_status="unavailable",
                    browser_history_status="no_match",
                    browser_history_reason="outside_time_window",
                    browser_history_database_found=True,
                    browser_history_profile_count=1,
                    browser_history_candidate_count=0,
                    browser_history_error_count=0,
                ),
                5,
                max_merge_gap_seconds=180,
            )

        resolver_calls: list[tuple[str | None, str | None, str | None]] = []

        def resolve_browser_history(app_name: str | None, window_title: str | None, observed_at: str | None) -> BrowserMetadata:
            resolver_calls.append((app_name, window_title, observed_at))
            return BrowserMetadata(
                browser_name="Google Chrome",
                site_domain="youtube.com",
                site_title="Lecture - YouTube",
                site_url="https://www.youtube.com/watch?v=lecture",
                youtube_video_id="lecture",
                match_state="browser-history-title",
                browser_automation_status="granted",
                browser_history_status="matched",
                browser_history_reason="matched",
                browser_history_database_found=True,
                browser_history_profile_count=1,
                browser_history_candidate_count=1,
                browser_history_error_count=0,
            )

        results = self.database.backfill_recent_browser_history_context(
            resolve_browser_history,
            lambda title: True,
            BrowserHistoryBackfillConfig(
                observed_at="2026-04-06T09:00:30+00:00",
                max_age_seconds=180,
            ),
        )

        # Only the 09:00 segment falls inside the 180s window; the 08:00
        # segment is excluded by the SQL cutoff and never reaches the resolver.
        self.assertEqual(len(results), 1)
        self.assertEqual(len(resolver_calls), 1)
        self.assertEqual(resolver_calls[0][2], "2026-04-06T09:00:00+00:00")
        events = self.database.fetch_timeline("2026-04-06")
        old_event = next(event for event in events if event["startedAt"] == "2026-04-06T08:00:00+00:00")
        self.assertIsNone(old_event["siteDomain"])

    def test_record_snapshot_does_not_overwrite_existing_site_context_with_browser_history(self) -> None:
        self.database.record_snapshot(
            Snapshot(
                observed_at="2026-04-06T09:00:00+00:00",
                app_name="Google Chrome",
                bundle_id="com.google.Chrome",
                window_title="Lecture - YouTube - Google Chrome",
                source="accessibility",
                browser_name="Google Chrome",
                site_domain="example.com",
                site_title="Existing",
                site_url="https://example.com/",
                site_source="applescript",
            ),
            5,
            max_merge_gap_seconds=180,
        )
        self.database.record_snapshot(
            Snapshot(
                observed_at="2026-04-06T09:00:05+00:00",
                app_name="Google Chrome",
                bundle_id="com.google.Chrome",
                window_title="Lecture - YouTube - Google Chrome",
                source="accessibility",
                browser_name="Google Chrome",
                site_domain="youtube.com",
                site_title="Lecture - YouTube",
                site_url="https://www.youtube.com/watch?v=lecture",
                youtube_video_id="lecture",
                site_source="browser-history-title",
            ),
            5,
            max_merge_gap_seconds=180,
        )

        events = self.database.fetch_timeline("2026-04-06")
        self.assertEqual(len(events), 2)
        self.assertEqual(events[0]["siteUrl"], "https://example.com/")
        self.assertEqual(events[1]["siteUrl"], "https://www.youtube.com/watch?v=lecture")

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

    def test_fetch_timeline_day_uses_bounded_range_query(self) -> None:
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

        with patch.object(self.database, "timeline", wraps=self.database.timeline) as timeline_spy:
            events = self.database.fetch_timeline(local_day)

        self.assertEqual(len(events), 1)
        timeline_spy.assert_called_once_with(
            start=f"{local_day}T00:00:00",
            end=f"{local_day}T23:59:59",
            limit=None,
        )

    def test_activity_segments_has_range_query_indexes(self) -> None:
        with self.database.connect() as conn:
            indexes = {row["name"] for row in conn.execute("PRAGMA index_list(activity_segments)")}

        self.assertIn("idx_activity_segments_started_at", indexes)
        self.assertIn("idx_activity_segments_ended_at", indexes)

    def test_existing_import_keys_gain_segment_lookup_without_changing_rows(self) -> None:
        segment_id = self._insert_segment_returning_id("2026-04-06T09:00:00+00:00")
        with self.database.connect() as conn:
            conn.execute("DROP INDEX IF EXISTS idx_browser_history_import_keys_segment_id")
            conn.executemany(
                "INSERT INTO browser_history_import_keys(import_key, segment_id, imported_at) VALUES (?, ?, ?)",
                [("linked", segment_id, "2026-04-06"), ("deleted", None, "2026-04-05")],
            )
            before = [tuple(row) for row in conn.execute(
                "SELECT * FROM browser_history_import_keys ORDER BY import_key"
            )]
        self.database.close()

        # Upgrade a populated database, then reopen it again to verify idempotence.
        for _ in range(2):
            with closing(TrackerDatabase(self.db_path, perform_maintenance=False)) as upgraded:
                conn = upgraded.connect()
                after = [tuple(row) for row in conn.execute(
                    "SELECT * FROM browser_history_import_keys ORDER BY import_key"
                )]
                self.assertEqual(after, before)
                plan = [row["detail"] for row in conn.execute(
                    "EXPLAIN QUERY PLAN SELECT rowid FROM browser_history_import_keys WHERE segment_id = ?",
                    (segment_id,),
                )]
                self.assertTrue(any("SEARCH" in step and "USING" in step for step in plan), plan)
                self.assertFalse(any("SCAN browser_history_import_keys" in step for step in plan), plan)
                self.assertEqual(conn.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_segment_deletion_does_not_scan_every_import_key_for_each_segment(self) -> None:
        with self.database.connect() as conn:
            conn.executemany(
                "INSERT INTO activity_segments(id, started_at, ended_at, duration_seconds, app_name, platform, source)"
                " VALUES (?, '2026-04-06T09:00:00+00:00', '2026-04-06T09:00:05+00:00', 5, 'QA', 'macos', 'qa')",
                [(i,) for i in range(1, 302)],
            )
            conn.executemany(
                "INSERT INTO browser_history_import_keys(import_key, segment_id, imported_at) VALUES (?, ?, '2026-04-06')",
                [(f"deleted-{i}", i) for i in range(1, 301)]
                + [(f"kept-{i}", 301) for i in range(1000)],
            )

        # Bound SQLite work rather than wall-clock speed. Without the child-key
        # index, each parent deletion scans all 1,300 keys and exceeds this budget.
        progress_calls = 0

        def bound_sqlite_work() -> int:
            nonlocal progress_calls
            progress_calls += 1
            return int(progress_calls >= 300)

        conn.set_progress_handler(bound_sqlite_work, 1000)
        try:
            self.assertEqual(self.database.delete_activity_segments([str(i) for i in range(1, 301)]), 300)
        finally:
            conn.set_progress_handler(None, 0)

        # Preserve import deduplication keys even when their segment is deleted.
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM browser_history_import_keys").fetchone()[0], 1300)
        self.assertEqual(conn.execute(
            "SELECT COUNT(*) FROM browser_history_import_keys WHERE segment_id IS NULL"
        ).fetchone()[0], 300)
        self.assertEqual(conn.execute(
            "SELECT COUNT(*) FROM browser_history_import_keys WHERE segment_id = 301"
        ).fetchone()[0], 1000)
        self.assertEqual(conn.execute("PRAGMA foreign_key_check").fetchall(), [])

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

    def test_hourly_summary_range_aggregates_without_loading_timeline(self) -> None:
        self.database.insert_segment(
            {
                "started_at": "2026-04-06T09:00:00+00:00",
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
        self.database.insert_segment(
            {
                "started_at": "2026-04-06T09:30:00+00:00",
                "ended_at": "2026-04-06T09:45:00+00:00",
                "duration_seconds": 900,
                "app_name": "Safari",
                "bundle_id": None,
                "window_title": "Docs",
                "platform": "macos",
                "source": "nsworkspace",
                "confidence": None,
                "raw_context_json": "{}",
            }
        )
        self.database.timeline = MagicMock(side_effect=AssertionError("range summary should aggregate in SQL"))

        summary = self.database.hourly_summary("2026-04-06T00:00:00", "2026-04-06T23:59:59")

        local_hour = datetime.fromisoformat("2026-04-06T09:00:00+00:00").astimezone().strftime("%H:00")
        self.assertEqual(summary, [
            {
                "hour": f"localT{local_hour}",
                "totalSeconds": 2700,
                "appBreakdown": [
                    {"appName": "Code", "totalSeconds": 1800},
                    {"appName": "Safari", "totalSeconds": 900},
                ],
            }
        ])

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

    def test_last_event_at_orders_by_datetime_not_text(self) -> None:
        self._insert_activity_segment(0, started_at="2026-04-06T09:00:00+00:00", ended_at="2026-04-06T09:05:00+00:00")
        self._insert_activity_segment(1, started_at="2026-04-06T10:55:00+02:00", ended_at="2026-04-06T11:00:00+02:00")

        self.assertEqual(self.database.fetch_last_event_at(), "2026-04-06T09:05:00+00:00")

    def test_latest_segment_query_avoids_temp_btree_sort(self) -> None:
        with self.database.connect() as conn:
            plan = " ".join(
                row["detail"]
                for row in conn.execute(
                    "EXPLAIN QUERY PLAN "
                    "SELECT ended_at FROM activity_segments ORDER BY datetime(ended_at) DESC, id DESC LIMIT 1"
                )
            )

        self.assertNotIn("TEMP B-TREE", plan)

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

    def test_fetch_top_sites_uses_started_local_day(self) -> None:
        local_midnight = datetime.fromisoformat("2026-04-06T00:00:00").astimezone()
        self.database.insert_segment(
            {
                "started_at": (local_midnight - timedelta(minutes=5)).isoformat(),
                "ended_at": (local_midnight + timedelta(minutes=5)).isoformat(),
                "duration_seconds": 600,
                "app_name": "Safari",
                "bundle_id": "com.apple.Safari",
                "window_title": "Previous day bridge",
                "site_domain": "previous.example",
                "site_title": "Previous day bridge",
                "browser_name": "Safari",
                "site_source": "applescript",
                "platform": "macos",
                "source": "accessibility",
                "confidence": 1.0,
                "raw_context_json": "{}",
            }
        )
        self.database.insert_segment(
            {
                "started_at": (local_midnight + timedelta(hours=9)).isoformat(),
                "ended_at": (local_midnight + timedelta(hours=9, minutes=10)).isoformat(),
                "duration_seconds": 600,
                "app_name": "Safari",
                "bundle_id": "com.apple.Safari",
                "window_title": "Current day",
                "site_domain": "current.example",
                "site_title": "Current day",
                "browser_name": "Safari",
                "site_source": "applescript",
                "platform": "macos",
                "source": "accessibility",
                "confidence": 1.0,
                "raw_context_json": "{}",
            }
        )

        sites = self.database.fetch_top_sites("2026-04-06")

        self.assertEqual([site["siteDomain"] for site in sites], ["current.example"])

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

    def test_timeline_accepts_utc_z_range_bounds(self) -> None:
        self.database.insert_segment(
            {
                "started_at": "2026-06-16T19:09:00+00:00",
                "ended_at": "2026-06-16T19:20:00+00:00",
                "duration_seconds": 660,
                "app_name": "Google Chrome",
                "bundle_id": "com.google.Chrome",
                "window_title": None,
                "platform": "macos",
                "source": "nsworkspace",
                "confidence": None,
                "raw_context_json": "{}",
            }
        )

        rows = self.database.timeline(start="2026-06-16T19:08:56.900Z", end="2026-06-16T19:30:00.000Z")

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["app_name"], "Google Chrome")

    def test_timeline_range_filters_treat_naive_bounds_as_local_time(self) -> None:
        # TZ + tzset() is the Unix way to pin a process timezone; Windows has
        # no tzset and ignores TZ here. The behaviour under test (naive bounds
        # resolve against local time) is platform-neutral, but only this
        # mechanism for forcing a known zone is not, so the check runs where
        # the zone can actually be pinned.
        if not hasattr(time, "tzset"):
            self.skipTest("TZ/tzset zone pinning is unavailable on this platform")
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

    def test_unclassified_segment_allow_list_is_applied_before_limit(self) -> None:
        first_id = self._insert_history_segment(
            "2026-04-06T09:00:00+00:00",
            "2026-04-06T09:01:00+00:00",
        )
        requested_id = self._insert_history_segment(
            "2026-04-06T10:00:00+00:00",
            "2026-04-06T10:01:00+00:00",
        )

        unclassified = self.database.fetch_unclassified_segments(
            limit=1,
            segment_ids={str(requested_id)},
        )

        self.assertNotEqual(first_id, requested_id)
        self.assertEqual([segment["id"] for segment in unclassified], [str(requested_id)])

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
        # No request id or latency means the row was copied from the fingerprint cache.
        self.assertTrue(classified["classification"]["reusedAiResult"])

        self.database.save_classifications([
            {
                "segmentId": segment["id"],
                "category": "workspace",
                "productivity": "focus",
                "source": "llm",
                "confidence": 0.91,
                "inputFingerprint": "fp-example",
                "aiResult": True,
                "latencyMs": 420,
            }
        ])
        fresh = self.database.fetch_timeline("2026-04-06")[0]
        self.assertFalse(fresh["classification"]["reusedAiResult"])

    def test_late_non_manual_classifications_do_not_overwrite_manual_correction(self) -> None:
        non_manual_sources = (
            "llm",
            "fallback",
            "system",
            "unknown",
            "app-db",
            "domain-db",
            "youtube",
            "rule",
            "ai_review",
        )

        for index, source in enumerate(non_manual_sources):
            with self.subTest(source=source):
                segment_id = self._insert_segment_returning_id(
                    f"2026-04-06T10:{index:02d}:00+00:00"
                )
                selected_before_manual = self.database.fetch_unclassified_segments(
                    segment_ids={str(segment_id)}
                )
                self.assertEqual(
                    [segment["id"] for segment in selected_before_manual],
                    [str(segment_id)],
                )

                manual_saved = self.database.save_classifications([
                    {
                        "segmentId": segment_id,
                        "category": "learning",
                        "productivity": "focus",
                        "source": "manual",
                        "confidence": 1,
                        "inputFingerprint": f"manual:{segment_id}",
                    }
                ])
                late_saved = self.database.save_classifications([
                    {
                        "segmentId": segment_id,
                        "category": "utility",
                        "productivity": "drift",
                        "source": source,
                        "confidence": 0.9,
                        "inputFingerprint": f"late:{source}:{segment_id}",
                        "aiResult": source == "llm",
                    }
                ])

                self.assertEqual(manual_saved, 1)
                self.assertEqual(late_saved, 0)
                classification = next(
                    segment["classification"]
                    for segment in self.database.fetch_timeline("2026-04-06")
                    if segment["id"] == str(segment_id)
                )
                self.assertEqual(classification["category"], "learning")
                self.assertEqual(classification["productivity"], "focus")
                self.assertEqual(classification["source"], "manual")

    def test_manual_classification_can_replace_existing_automatic_and_manual_corrections(self) -> None:
        segment_id = self._insert_segment_returning_id("2026-04-06T11:00:00+00:00")
        first_saved = self.database.save_classifications([
            {
                "segmentId": segment_id,
                "category": "workspace",
                "productivity": "focus",
                "source": "llm",
                "confidence": 0.9,
            }
        ])
        second_saved = self.database.save_classifications([
            {
                "segmentId": segment_id,
                "category": "learning",
                "productivity": "neutral",
                "source": "manual",
                "confidence": 1,
            }
        ])
        third_saved = self.database.save_classifications([
            {
                "segmentId": segment_id,
                "category": "communication",
                "productivity": "drift",
                "source": "manual",
                "confidence": 1,
            }
        ])

        self.assertEqual(first_saved, 1)
        self.assertEqual(second_saved, 1)
        self.assertEqual(third_saved, 1)
        classification = next(
            segment["classification"]
            for segment in self.database.fetch_timeline("2026-04-06")
            if segment["id"] == str(segment_id)
        )
        self.assertEqual(classification["category"], "communication")
        self.assertEqual(classification["productivity"], "drift")
        self.assertEqual(classification["source"], "manual")

    def test_save_classifications_counts_only_rows_applied_in_a_mixed_batch(self) -> None:
        protected_segment_id = self._insert_segment_returning_id("2026-04-06T12:00:00+00:00")
        writable_segment_id = self._insert_segment_returning_id("2026-04-06T12:05:00+00:00")
        self.database.save_classifications([
            {
                "segmentId": protected_segment_id,
                "category": "learning",
                "productivity": "focus",
                "source": "manual",
                "confidence": 1,
            }
        ])

        saved = self.database.save_classifications([
            {
                "segmentId": protected_segment_id,
                "category": "utility",
                "productivity": "drift",
                "source": "llm",
                "confidence": 0.9,
            },
            {
                "segmentId": writable_segment_id,
                "category": "workspace",
                "productivity": "focus",
                "source": "llm",
                "confidence": 0.9,
            },
        ])

        classifications_by_id = {
            segment["id"]: segment["classification"]
            for segment in self.database.fetch_timeline("2026-04-06")
            if segment["id"] in {str(protected_segment_id), str(writable_segment_id)}
        }
        self.assertEqual(saved, 1)
        self.assertEqual(classifications_by_id[str(protected_segment_id)]["source"], "manual")
        self.assertEqual(classifications_by_id[str(writable_segment_id)]["source"], "llm")

    def test_save_classifications_skips_rows_whose_segment_or_rule_disappeared(self) -> None:
        live_segment_id = self._insert_segment_returning_id("2026-04-06T12:00:00+00:00")
        ruled_segment_id = self._insert_segment_returning_id("2026-04-06T12:05:00+00:00")
        trimmed_segment_id = self._insert_segment_returning_id("2026-04-06T12:10:00+00:00")
        rule = self.database.save_classification_rule(
            {
                "targetKind": "app",
                "targetValue": "Code",
                "category": "workspace",
                "productivity": "focus",
            }
        )
        # Both disappear from another path after a classifier selected them.
        self.database.delete_activity_segments([str(trimmed_segment_id)])
        self.database.delete_classification_rule(rule["id"])

        saved = self.database.save_classifications([
            {
                "segmentId": trimmed_segment_id,
                "category": "utility",
                "productivity": "drift",
                "source": "llm",
                "confidence": 0.9,
            },
            {
                "segmentId": ruled_segment_id,
                "category": "workspace",
                "productivity": "focus",
                "source": "rule",
                "confidence": 1,
                "classificationRuleId": rule["id"],
            },
            {
                "segmentId": live_segment_id,
                "category": "learning",
                "productivity": "focus",
                "source": "llm",
                "confidence": 0.9,
            },
        ])

        classifications_by_id = {
            segment["id"]: segment.get("classification")
            for segment in self.database.fetch_timeline("2026-04-06")
        }
        self.assertEqual(saved, 1)
        self.assertEqual(classifications_by_id[str(live_segment_id)]["category"], "learning")
        self.assertIsNone(classifications_by_id[str(ruled_segment_id)])
        self.assertNotIn(str(trimmed_segment_id), classifications_by_id)
        with self.database.connect() as conn:
            orphaned = conn.execute(
                "SELECT COUNT(*) AS count FROM activity_classifications WHERE segment_id IN (?, ?)",
                (trimmed_segment_id, ruled_segment_id),
            ).fetchone()["count"]
        self.assertEqual(orphaned, 0)

    def test_dashboard_week_timeline_omits_verbose_fields_without_full_timeline(self) -> None:
        self.database.record_snapshot(
            Snapshot(
                observed_at="2026-04-06T09:00:00+00:00",
                app_name="Safari",
                bundle_id="com.apple.Safari",
                window_title="Long private lecture title",
                source="accessibility",
                browser_name="Safari",
                site_domain="youtube.com",
                site_title="Lecture",
                site_url="https://www.youtube.com/watch?v=lecture123",
                youtube_video_id="lecture123",
                youtube_is_shorts=False,
                site_source="applescript",
                browser_automation_status="denied",
                browser_automation_error="browser automation diagnostic should not be in dashboard week payload",
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
                description="Large transcript-like description should stay out of dashboard week payload.",
                keywords=["lecture", "cs", "large-keywords"],
                duration_seconds=1200,
                view_count=12345,
                is_live=False,
                is_unlisted=True,
                publish_date="2026-04-06",
                upload_date="2026-04-05",
            )
        )
        segment = self.database.fetch_timeline("2026-04-06")[0]
        self.database.save_classifications([
            {
                "segmentId": segment["id"],
                "category": "learning",
                "productivity": "focus",
                "source": "llm",
                "confidence": 0.91,
                "reason": "Verbose classification reason should stay out of dashboard week payload",
                "model": "gemini-3.1-flash-lite",
                "promptVersion": "v1",
                "taxonomyVersion": "v1",
                "inputFingerprint": "fp-dashboard-week",
                "aiResult": True,
            }
        ])
        self.database.timeline = MagicMock(side_effect=AssertionError("dashboard week should use compact SQL"))

        rows = self.database.dashboard_week_timeline(
            "2026-04-06T00:00:00",
            "2026-04-06T23:59:59",
        )

        self.assertEqual(len(rows), 1)
        compact = rows[0]
        self.assertEqual(compact["appName"], "Safari")
        self.assertEqual(compact["siteDomain"], "youtube.com")
        self.assertEqual(compact["siteTitle"], "Lecture")
        self.assertEqual(compact["youtubeCategory"], "Education")
        self.assertEqual(compact["youtubeTitle"], "MIT Lecture")
        self.assertEqual(compact["classification"]["category"], "learning")
        self.assertEqual(compact["classification"]["productivity"], "focus")
        self.assertEqual(compact["classification"]["source"], "llm")
        self.assertNotIn("windowTitle", compact)
        self.assertNotIn("browserAutomationError", compact)
        self.assertNotIn("youtubeDescription", compact)
        self.assertNotIn("youtubeKeywords", compact)
        self.assertNotIn("model", compact["classification"])
        self.assertNotIn("reason", compact["classification"])

    def test_project_trend_timeline_returns_slim_rows(self) -> None:
        self.database.record_snapshot(
            Snapshot(
                observed_at="2026-04-06T09:00:00+00:00",
                app_name="Safari",
                bundle_id="com.apple.Safari",
                window_title="Lecture",
                source="accessibility",
                browser_name="Safari",
                site_domain="youtube.com",
                site_title="Lecture",
                site_url="https://www.youtube.com/watch?v=lecture123",
                youtube_video_id="lecture123",
                youtube_is_shorts=False,
                site_source="applescript",
                browser_automation_status="denied",
                browser_automation_error="diagnostic should not be in project trend payload",
            ),
            5,
        )

        rows = self.database.project_trend_timeline(
            "2026-04-06T00:00:00",
            "2026-04-06T23:59:59",
        )

        self.assertEqual(len(rows), 1)
        slim = rows[0]
        self.assertEqual(
            set(slim.keys()),
            {"id", "startedAt", "endedAt", "durationSeconds", "appName", "platform", "source", "bundleId", "siteDomain"},
        )
        self.assertEqual(slim["appName"], "Safari")
        self.assertEqual(slim["bundleId"], "com.apple.Safari")
        self.assertEqual(slim["siteDomain"], "youtube.com")
        self.assertEqual(slim["durationSeconds"], 5)

    def test_project_trend_timeline_hides_uncertain_site_context(self) -> None:
        self.database.record_snapshot(
            Snapshot(
                observed_at="2026-04-06T10:00:00+00:00",
                app_name="Safari",
                bundle_id="com.apple.Safari",
                window_title="Unrelated window title",
                source="accessibility",
                browser_name="Safari",
                site_domain="example.com",
                site_title="Completely different site",
                site_source="applescript-front-window",
            ),
            5,
        )

        rows = self.database.project_trend_timeline(
            "2026-04-06T00:00:00",
            "2026-04-06T23:59:59",
        )

        self.assertEqual(len(rows), 1)
        self.assertNotIn("siteDomain", rows[0])

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

    def test_refresh_non_ai_classifications_preserves_manual_and_ai_review_corrections(self) -> None:
        for hour, app_name in [(9, "Code"), (10, "Mail"), (11, "Design")]:
            self.database.insert_segment(
                {
                    "started_at": f"2026-04-06T{hour:02d}:00:00+00:00",
                    "ended_at": f"2026-04-06T{hour:02d}:05:00+00:00",
                    "duration_seconds": 300,
                    "app_name": app_name,
                }
            )
        segments = self.database.fetch_timeline("2026-04-06")
        self.database.save_classifications([
            {
                "segmentId": segments[0]["id"],
                "category": "workspace",
                "productivity": "focus",
                "source": "manual",
                "confidence": 1,
                "aiResult": False,
            },
            {
                "segmentId": segments[1]["id"],
                "category": "communication",
                "productivity": "neutral",
                "source": "system",
                "confidence": 0.7,
                "aiResult": False,
            },
            {
                "segmentId": segments[2]["id"],
                "category": "workspace",
                "productivity": "focus",
                "source": "ai_review",
                "confidence": 0.9,
            },
        ])

        deleted = self.database.refresh_non_ai_classifications(
            "2026-04-06T00:00:00+00:00", "2026-04-06T23:59:59+00:00"
        )
        refreshed = self.database.fetch_timeline("2026-04-06")

        self.assertEqual(deleted, 1)
        self.assertEqual(refreshed[0]["classification"]["source"], "manual")
        self.assertEqual(refreshed[0]["classification"]["category"], "workspace")
        self.assertIsNone(refreshed[1].get("classification"))
        self.assertEqual(refreshed[2]["classification"]["source"], "ai_review")

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
        app_only_candidates = self.database.search_classification_rule_candidates("", target_kind="app")

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
        self.assertEqual([candidate["targetKind"] for candidate in app_only_candidates], ["app", "app"])
        self.assertEqual(app_only_candidates[0]["bundleId"], "com.apple.SafariTechnologyPreview")
        self.assertEqual(app_only_candidates[1]["bundleId"], "com.apple.Safari")

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

    def test_apply_classification_rules_preserves_manual_classification(self) -> None:
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
        with self.database.connect() as conn:
            segment_id = conn.execute("SELECT id FROM activity_segments LIMIT 1").fetchone()["id"]
        # The user manually classifies the segment.
        self.database.save_classifications(
            [
                {"segmentId": segment_id, "category": "learning", "productivity": "neutral", "source": "manual", "confidence": 1.0}
            ]
        )
        # A later, broad rule matches the same segment.
        self.database.save_classification_rule(
            {
                "targetKind": "site",
                "targetValue": "example.com",
                "category": "workspace",
                "productivity": "focus",
            }
        )

        result = self.database.apply_classification_rules()
        events = self.database.fetch_timeline("2026-04-06")

        # The rule matches but must not overwrite the manual label.
        self.assertEqual(result["matchedCount"], 1)
        self.assertEqual(result["appliedCount"], 0)
        self.assertEqual(result["skippedCount"], 1)
        self.assertEqual(events[0]["classification"]["source"], "manual")
        self.assertEqual(events[0]["classification"]["category"], "learning")
        self.assertEqual(events[0]["classification"]["productivity"], "neutral")

    def test_detail_classification_rule_matches_only_exact_detail_on_same_site(self) -> None:
        self.database.insert_segment(
            {
                "started_at": "2026-04-06T09:00:00+00:00",
                "ended_at": "2026-04-06T09:05:00+00:00",
                "duration_seconds": 300,
                "app_name": "Safari",
                "bundle_id": "com.apple.Safari",
                "site_domain": "docs.example.com",
                "site_title": "Sprint plan",
            }
        )
        self.database.insert_segment(
            {
                "started_at": "2026-04-06T10:00:00+00:00",
                "ended_at": "2026-04-06T10:05:00+00:00",
                "duration_seconds": 300,
                "app_name": "Safari",
                "bundle_id": "com.apple.Safari",
                "site_domain": "docs.example.com",
                "site_title": "Roadmap",
            }
        )
        self.database.insert_segment(
            {
                "started_at": "2026-04-06T11:00:00+00:00",
                "ended_at": "2026-04-06T11:05:00+00:00",
                "duration_seconds": 300,
                "app_name": "Safari",
                "bundle_id": "com.apple.Safari",
                "site_domain": "calendar.example.com",
                "site_title": "Sprint plan",
            }
        )
        rule = self.database.save_classification_rule(
            {
                "targetKind": "site",
                "targetValue": "docs.example.com",
                "matchScope": "detail",
                "detailKind": "title",
                "detailValue": "Sprint plan",
                "category": "workspace",
                "productivity": "focus",
            }
        )

        result = self.database.apply_classification_rules()
        events = self.database.fetch_timeline("2026-04-06")

        self.assertEqual(rule["matchScope"], "detail")
        self.assertEqual(rule["detailKind"], "title")
        self.assertEqual(rule["detailValue"], "Sprint plan")
        self.assertEqual(result["matchedCount"], 1)
        self.assertEqual(events[0]["classification"]["classificationRuleId"], rule["id"])
        self.assertNotIn("classification", events[1])
        self.assertNotIn("classification", events[2])

    def test_detail_classification_rule_uses_exact_normalized_detail(self) -> None:
        self.database.insert_segment(
            {
                "started_at": "2026-04-06T09:00:00+00:00",
                "ended_at": "2026-04-06T09:05:00+00:00",
                "duration_seconds": 300,
                "app_name": "Safari",
                "bundle_id": "com.apple.Safari",
                "site_domain": "docs.example.com",
                "site_title": "Sprint plan",
            }
        )
        self.database.save_classification_rule(
            {
                "targetKind": "site",
                "targetValue": "docs.example.com",
                "matchScope": "detail",
                "detailKind": "title",
                "detailValue": "Sprint",
                "category": "workspace",
                "productivity": "focus",
            }
        )

        result = self.database.apply_classification_rules()
        events = self.database.fetch_timeline("2026-04-06")

        self.assertEqual(result["matchedCount"], 0)
        self.assertNotIn("classification", events[0])

    def test_app_detail_classification_rule_matches_only_detail_on_same_app(self) -> None:
        self.database.insert_segment(
            {
                "started_at": "2026-04-06T09:00:00+00:00",
                "ended_at": "2026-04-06T09:05:00+00:00",
                "duration_seconds": 300,
                "app_name": "Linear",
                "bundle_id": "com.linear",
                "window_title": "Sprint plan",
            }
        )
        self.database.insert_segment(
            {
                "started_at": "2026-04-06T10:00:00+00:00",
                "ended_at": "2026-04-06T10:05:00+00:00",
                "duration_seconds": 300,
                "app_name": "Notes",
                "bundle_id": "com.apple.Notes",
                "window_title": "Sprint plan",
            }
        )
        rule = self.database.save_classification_rule(
            {
                "targetKind": "app",
                "targetValue": "com.linear",
                "matchScope": "detail",
                "detailKind": "windowTitle",
                "detailValue": "Sprint plan",
                "category": "workspace",
                "productivity": "focus",
            }
        )

        result = self.database.apply_classification_rules()
        events = self.database.fetch_timeline("2026-04-06")

        self.assertEqual(result["matchedCount"], 1)
        self.assertEqual(events[0]["classification"]["classificationRuleId"], rule["id"])
        self.assertNotIn("classification", events[1])

    def test_site_url_detail_classification_rule_matches_only_same_canonical_url(self) -> None:
        self.database.insert_segment(
            {
                "started_at": "2026-04-06T09:00:00+00:00",
                "ended_at": "2026-04-06T09:05:00+00:00",
                "duration_seconds": 300,
                "app_name": "Safari",
                "bundle_id": "com.apple.Safari",
                "site_domain": "lichess.org",
                "site_url": "https://lichess.org/training/123",
            }
        )
        self.database.insert_segment(
            {
                "started_at": "2026-04-06T10:00:00+00:00",
                "ended_at": "2026-04-06T10:05:00+00:00",
                "duration_seconds": 300,
                "app_name": "Safari",
                "bundle_id": "com.apple.Safari",
                "site_domain": "lichess.org",
                "site_url": "https://lichess.org/training/456",
            }
        )
        self.database.insert_segment(
            {
                "started_at": "2026-04-06T11:00:00+00:00",
                "ended_at": "2026-04-06T11:05:00+00:00",
                "duration_seconds": 300,
                "app_name": "Safari",
                "bundle_id": "com.apple.Safari",
                "site_domain": "chess.com",
                "site_url": "https://lichess.org/training/123",
            }
        )
        rule = self.database.save_classification_rule(
            {
                "targetKind": "site",
                "targetValue": "https://www.lichess.org",
                "matchScope": "detail",
                "detailKind": "siteUrl",
                "detailValue": "https://user:pass@www.lichess.org/training/123?utm_source=x&token=secret#comments",
                "category": "learning",
                "productivity": "focus",
            }
        )

        result = self.database.apply_classification_rules()
        events = self.database.fetch_timeline("2026-04-06")

        self.assertEqual(rule["targetValue"], "lichess.org")
        self.assertEqual(rule["detailKind"], "siteUrl")
        self.assertEqual(rule["detailValue"], "https://lichess.org/training/123")
        self.assertEqual(result["matchedCount"], 1)
        self.assertEqual(events[0]["classification"]["classificationRuleId"], rule["id"])
        self.assertNotIn("classification", events[1])
        self.assertNotIn("classification", events[2])

    def test_site_url_detail_rule_beats_broad_rule_and_disabling_removes_only_its_rows(self) -> None:
        self.database.insert_segment(
            {
                "started_at": "2026-04-06T09:00:00+00:00",
                "ended_at": "2026-04-06T09:05:00+00:00",
                "duration_seconds": 300,
                "app_name": "Safari",
                "bundle_id": "com.apple.Safari",
                "site_domain": "youtube.com",
                "site_url": "https://youtu.be/ABC123?si=sharetoken",
            }
        )
        self.database.insert_segment(
            {
                "started_at": "2026-04-06T10:00:00+00:00",
                "ended_at": "2026-04-06T10:05:00+00:00",
                "duration_seconds": 300,
                "app_name": "Safari",
                "bundle_id": "com.apple.Safari",
                "site_domain": "youtube.com",
                "site_url": "https://youtube.com/watch?v=OTHER",
            }
        )
        broad_rule = self.database.save_classification_rule(
            {
                "targetKind": "site",
                "targetValue": "youtube.com",
                "category": "entertainment",
                "productivity": "drift",
            }
        )
        detail_rule = self.database.save_classification_rule(
            {
                "targetKind": "site",
                "targetValue": "youtube.com",
                "matchScope": "detail",
                "detailKind": "siteUrl",
                "detailValue": "https://www.youtube.com/watch?v=ABC123&t=90s&utm_source=share",
                "category": "learning",
                "productivity": "focus",
            }
        )
        self.database.apply_classification_rules()
        initial_events = self.database.fetch_timeline("2026-04-06")

        disabled = self.database.save_classification_rule(
            {
                "targetKind": "site",
                "targetValue": "youtube.com",
                "matchScope": "detail",
                "detailKind": "siteUrl",
                "detailValue": "https://youtube.com/watch?v=ABC123",
                "category": "learning",
                "productivity": "focus",
                "enabled": False,
            }
        )
        disabled_events = self.database.fetch_timeline("2026-04-06")

        self.assertEqual(detail_rule["detailValue"], "https://youtube.com/watch?v=ABC123")
        self.assertEqual(initial_events[0]["classification"]["classificationRuleId"], detail_rule["id"])
        self.assertEqual(initial_events[1]["classification"]["classificationRuleId"], broad_rule["id"])
        self.assertFalse(disabled["enabled"])
        self.assertEqual(disabled["id"], detail_rule["id"])
        self.assertNotIn("classification", disabled_events[0])
        self.assertEqual(disabled_events[1]["classification"]["classificationRuleId"], broad_rule["id"])

    def test_detail_classification_rule_beats_broad_rule_for_same_site(self) -> None:
        self.database.insert_segment(
            {
                "started_at": "2026-04-06T09:00:00+00:00",
                "ended_at": "2026-04-06T09:05:00+00:00",
                "duration_seconds": 300,
                "app_name": "Safari",
                "bundle_id": "com.apple.Safari",
                "site_domain": "docs.example.com",
                "site_title": "Sprint plan",
            }
        )
        broad_rule = self.database.save_classification_rule(
            {
                "targetKind": "site",
                "targetValue": "docs.example.com",
                "category": "entertainment",
                "productivity": "drift",
            }
        )
        detail_rule = self.database.save_classification_rule(
            {
                "targetKind": "site",
                "targetValue": "docs.example.com",
                "matchScope": "detail",
                "detailKind": "title",
                "detailValue": "Sprint plan",
                "category": "workspace",
                "productivity": "focus",
            }
        )

        result = self.database.apply_classification_rules()
        event = self.database.fetch_timeline("2026-04-06")[0]

        self.assertNotEqual(detail_rule["id"], broad_rule["id"])
        self.assertEqual(result["matchedCount"], 1)
        self.assertEqual(event["classification"]["category"], "workspace")
        self.assertEqual(event["classification"]["classificationRuleId"], detail_rule["id"])

    def test_disabling_detail_rule_removes_only_its_materialized_classifications(self) -> None:
        self.database.insert_segment(
            {
                "started_at": "2026-04-06T09:00:00+00:00",
                "ended_at": "2026-04-06T09:05:00+00:00",
                "duration_seconds": 300,
                "app_name": "Safari",
                "bundle_id": "com.apple.Safari",
                "site_domain": "docs.example.com",
                "site_title": "Sprint plan",
            }
        )
        self.database.insert_segment(
            {
                "started_at": "2026-04-06T10:00:00+00:00",
                "ended_at": "2026-04-06T10:05:00+00:00",
                "duration_seconds": 300,
                "app_name": "Safari",
                "bundle_id": "com.apple.Safari",
                "site_domain": "docs.example.com",
                "site_title": "Roadmap",
            }
        )
        detail_rule = self.database.save_classification_rule(
            {
                "targetKind": "site",
                "targetValue": "docs.example.com",
                "matchScope": "detail",
                "detailKind": "title",
                "detailValue": "Sprint plan",
                "category": "workspace",
                "productivity": "focus",
            }
        )
        broad_rule = self.database.save_classification_rule(
            {
                "targetKind": "site",
                "targetValue": "docs.example.com",
                "category": "learning",
                "productivity": "focus",
            }
        )
        self.database.apply_classification_rules()

        disabled = self.database.save_classification_rule(
            {
                "targetKind": "site",
                "targetValue": "docs.example.com",
                "matchScope": "detail",
                "detailKind": "title",
                "detailValue": "Sprint plan",
                "category": "workspace",
                "productivity": "focus",
                "enabled": False,
            }
        )
        events = self.database.fetch_timeline("2026-04-06")

        self.assertFalse(disabled["enabled"])
        self.assertEqual(disabled["id"], detail_rule["id"])
        self.assertNotIn("classification", events[0])
        self.assertEqual(events[1]["classification"]["classificationRuleId"], broad_rule["id"])

    def test_delete_detail_rule_removes_only_its_materialized_classifications(self) -> None:
        self.database.insert_segment(
            {
                "started_at": "2026-04-06T09:00:00+00:00",
                "ended_at": "2026-04-06T09:05:00+00:00",
                "duration_seconds": 300,
                "app_name": "Safari",
                "bundle_id": "com.apple.Safari",
                "site_domain": "docs.example.com",
                "site_title": "Sprint plan",
            }
        )
        self.database.insert_segment(
            {
                "started_at": "2026-04-06T10:00:00+00:00",
                "ended_at": "2026-04-06T10:05:00+00:00",
                "duration_seconds": 300,
                "app_name": "Safari",
                "bundle_id": "com.apple.Safari",
                "site_domain": "docs.example.com",
                "site_title": "Roadmap",
            }
        )
        detail_rule = self.database.save_classification_rule(
            {
                "targetKind": "site",
                "targetValue": "docs.example.com",
                "matchScope": "detail",
                "detailKind": "title",
                "detailValue": "Sprint plan",
                "category": "workspace",
                "productivity": "focus",
            }
        )
        broad_rule = self.database.save_classification_rule(
            {
                "targetKind": "site",
                "targetValue": "docs.example.com",
                "category": "learning",
                "productivity": "focus",
            }
        )
        self.database.apply_classification_rules()

        deleted = self.database.delete_classification_rule(detail_rule["id"])
        events = self.database.fetch_timeline("2026-04-06")

        self.assertEqual(deleted, 1)
        self.assertNotIn("classification", events[0])
        self.assertEqual(events[1]["classification"]["classificationRuleId"], broad_rule["id"])

    def test_surface_classification_rule_rows_serialize_with_surface_match_scope(self) -> None:
        legacy_path = Path(self.tempdir.name) / "legacy-rules.sqlite3"
        with closing(sqlite3.connect(legacy_path)) as conn:
            conn.execute(
                """
                CREATE TABLE classification_rules (
                  id TEXT PRIMARY KEY,
                  target_kind TEXT NOT NULL,
                  target_value TEXT NOT NULL,
                  normalized_target_value TEXT NOT NULL,
                  category TEXT NOT NULL,
                  productivity TEXT NOT NULL,
                  enabled INTEGER NOT NULL DEFAULT 1,
                  confidence REAL,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                INSERT INTO classification_rules (
                    id,
                    target_kind,
                    target_value,
                    normalized_target_value,
                    category,
                    productivity,
                    enabled,
                    confidence,
                    created_at,
                    updated_at
                ) VALUES (?, 'site', 'docs.example.com', 'docs.example.com', 'learning', 'focus', 1, NULL, ?, ?)
                """,
                ("legacy-rule", "2026-04-06T09:00:00+00:00", "2026-04-06T09:00:00+00:00"),
            )
            conn.commit()
        legacy_database = TrackerDatabase(legacy_path)
        serialized = legacy_database.get_classification_rules()[0]

        self.assertEqual(serialized["matchScope"], "surface")
        self.assertIsNone(serialized["detailKind"])
        self.assertIsNone(serialized["detailValue"])

    def test_detail_classification_rule_requires_detail_fields(self) -> None:
        with self.assertRaisesRegex(ValueError, "detailKind and detailValue are required"):
            self.database.save_classification_rule(
                {
                    "targetKind": "site",
                    "targetValue": "docs.example.com",
                    "matchScope": "detail",
                    "category": "workspace",
                    "productivity": "focus",
                }
            )
        with self.assertRaisesRegex(ValueError, "detailKind and detailValue are required"):
            self.database.save_classification_rule(
                {
                    "targetKind": "site",
                    "targetValue": "example.com",
                    "matchScope": "detail",
                    "detailKind": "siteUrl",
                    "detailValue": "https://example.com:bad/work?token=secret#fragment",
                    "category": "learning",
                    "productivity": "focus",
                }
            )

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

    def test_delete_activity_segments_removes_segments_and_classifications(self) -> None:
        segment_id = self._insert_classified_segment(
            "2026-04-06T09:00:00+00:00",
            "delete-me",
        )
        kept_segment_id = self._insert_classified_segment(
            "2026-04-06T10:00:00+00:00",
            "keep-me",
        )

        deleted = self.database.delete_activity_segments([str(segment_id)])

        self.assertEqual(deleted, 1)
        events = self.database.fetch_timeline("2026-04-06")
        self.assertEqual([event["id"] for event in events], [str(kept_segment_id)])
        with self.database.connect() as conn:
            classifications = conn.execute(
                "SELECT segment_id FROM activity_classifications ORDER BY segment_id"
            ).fetchall()
        self.assertEqual([row["segment_id"] for row in classifications], [kept_segment_id])

    @staticmethod
    def _local_history_iso(year: int, month: int, day: int, hour: int = 0, minute: int = 0, second: int = 0) -> str:
        return datetime(year, month, day, hour, minute, second).astimezone().isoformat()

    def _insert_history_segment(
        self,
        started_at: str,
        ended_at: str,
        *,
        app_name: str = "Code",
        youtube_video_id: str | None = None,
    ) -> int:
        self.database.insert_segment(
            {
                "started_at": started_at,
                "ended_at": ended_at,
                "duration_seconds": 60,
                "app_name": app_name,
                "youtube_video_id": youtube_video_id,
            }
        )
        with self.database.connect() as conn:
            return int(conn.execute("SELECT MAX(id) AS id FROM activity_segments").fetchone()["id"])

    def _count_rows(self, table: str) -> int:
        with self.database.connect() as conn:
            return int(conn.execute(f"SELECT COUNT(*) AS count FROM {table}").fetchone()["count"])

    def _save_history_classification(self, segment_id: int, *, source: str = "llm", ai_result: bool = True) -> None:
        self.database.save_classifications([
            {
                "segmentId": segment_id,
                "category": "workspace",
                "productivity": "focus",
                "source": source,
                "confidence": 0.9,
                "inputFingerprint": f"fp-{segment_id}",
                "aiResult": ai_result,
            }
        ])

    def test_delete_history_range_includes_segments_overlapping_day_bounds(self) -> None:
        kept_before = self._insert_history_segment(
            self._local_history_iso(2026, 4, 5, 22, 0, 0),
            self._local_history_iso(2026, 4, 5, 22, 1, 0),
        )
        start_edge = self._insert_history_segment(
            self._local_history_iso(2026, 4, 5, 23, 59, 30),
            self._local_history_iso(2026, 4, 6, 0, 0, 30),
        )
        middle = self._insert_history_segment(
            self._local_history_iso(2026, 4, 6, 12, 0, 0),
            self._local_history_iso(2026, 4, 6, 12, 1, 0),
        )
        end_edge = self._insert_history_segment(
            self._local_history_iso(2026, 4, 7, 23, 59, 50),
            self._local_history_iso(2026, 4, 8, 0, 10, 0),
        )
        kept_after = self._insert_history_segment(
            self._local_history_iso(2026, 4, 8, 0, 30, 0),
            self._local_history_iso(2026, 4, 8, 0, 31, 0),
        )

        result = self.database.delete_history_range(
            start="2026-04-06",
            end="2026-04-07",
            scopes={"activity": True, "aiClassifications": False, "youtubeMetadata": False},
        )

        self.assertEqual(
            result,
            {"activitySegments": 3, "classifications": 0, "youtubeMetadata": 0, "dryRun": False},
        )
        with self.database.connect() as conn:
            remaining = [row["id"] for row in conn.execute("SELECT id FROM activity_segments ORDER BY id")]
        self.assertEqual(remaining, [kept_before, kept_after])
        self.assertNotIn(start_edge, remaining)
        self.assertNotIn(middle, remaining)
        self.assertNotIn(end_edge, remaining)

    def test_delete_history_range_dry_run_counts_match_real_delete(self) -> None:
        ai_segment = self._insert_history_segment(
            self._local_history_iso(2026, 4, 6, 9, 0, 0),
            self._local_history_iso(2026, 4, 6, 9, 1, 0),
            youtube_video_id="vid-in-range",
        )
        rule_segment = self._insert_history_segment(
            self._local_history_iso(2026, 4, 6, 10, 0, 0),
            self._local_history_iso(2026, 4, 6, 10, 1, 0),
        )
        self._save_history_classification(ai_segment, source="llm", ai_result=True)
        self._save_history_classification(rule_segment, source="rule", ai_result=False)
        self.database.save_youtube_metadata(YouTubeVideoMetadata(video_id="vid-in-range"))

        scopes = {"activity": True, "aiClassifications": True, "youtubeMetadata": True}
        dry = self.database.delete_history_range(start="2026-04-06", end="2026-04-06", scopes=scopes, dry_run=True)

        self.assertEqual(
            dry,
            {"activitySegments": 2, "classifications": 2, "youtubeMetadata": 1, "dryRun": True},
        )
        self.assertEqual(self._count_rows("activity_segments"), 2)
        self.assertEqual(self._count_rows("activity_classifications"), 2)
        self.assertEqual(self._count_rows("youtube_video_metadata"), 1)

        real = self.database.delete_history_range(start="2026-04-06", end="2026-04-06", scopes=scopes)

        self.assertEqual(real, {**dry, "dryRun": False})
        self.assertEqual(self._count_rows("activity_segments"), 0)
        self.assertEqual(self._count_rows("activity_classifications"), 0)
        self.assertEqual(self._count_rows("youtube_video_metadata"), 0)

    def test_delete_history_range_activity_scope_cascades_classifications(self) -> None:
        in_range = self._insert_history_segment(
            self._local_history_iso(2026, 4, 6, 9, 0, 0),
            self._local_history_iso(2026, 4, 6, 9, 1, 0),
        )
        also_in_range = self._insert_history_segment(
            self._local_history_iso(2026, 4, 6, 10, 0, 0),
            self._local_history_iso(2026, 4, 6, 10, 1, 0),
        )
        out_of_range = self._insert_history_segment(
            self._local_history_iso(2026, 4, 8, 9, 0, 0),
            self._local_history_iso(2026, 4, 8, 9, 1, 0),
        )
        self._save_history_classification(in_range, source="llm", ai_result=True)
        self._save_history_classification(also_in_range, source="rule", ai_result=False)
        self._save_history_classification(out_of_range, source="llm", ai_result=True)

        result = self.database.delete_history_range(
            start="2026-04-06",
            end="2026-04-06",
            scopes={"activity": True, "aiClassifications": False, "youtubeMetadata": False},
        )

        self.assertEqual(
            result,
            {"activitySegments": 2, "classifications": 2, "youtubeMetadata": 0, "dryRun": False},
        )
        with self.database.connect() as conn:
            remaining_classifications = [
                row["segment_id"]
                for row in conn.execute("SELECT segment_id FROM activity_classifications ORDER BY segment_id")
            ]
        self.assertEqual(remaining_classifications, [out_of_range])

    def test_delete_history_range_ai_scope_keeps_segments_and_rule_classifications(self) -> None:
        ai_segment = self._insert_history_segment(
            self._local_history_iso(2026, 4, 6, 9, 0, 0),
            self._local_history_iso(2026, 4, 6, 9, 1, 0),
        )
        rule_segment = self._insert_history_segment(
            self._local_history_iso(2026, 4, 6, 10, 0, 0),
            self._local_history_iso(2026, 4, 6, 10, 1, 0),
        )
        self._save_history_classification(ai_segment, source="llm", ai_result=True)
        self._save_history_classification(rule_segment, source="rule", ai_result=False)

        result = self.database.delete_history_range(
            start="2026-04-06",
            end="2026-04-06",
            scopes={"activity": False, "aiClassifications": True, "youtubeMetadata": False},
        )

        self.assertEqual(
            result,
            {"activitySegments": 0, "classifications": 1, "youtubeMetadata": 0, "dryRun": False},
        )
        self.assertEqual(self._count_rows("activity_segments"), 2)
        with self.database.connect() as conn:
            remaining_classifications = [
                row["segment_id"]
                for row in conn.execute("SELECT segment_id FROM activity_classifications ORDER BY segment_id")
            ]
        self.assertEqual(remaining_classifications, [rule_segment])

    def test_delete_history_range_youtube_scope_removes_only_metadata_referenced_in_range(self) -> None:
        self._insert_history_segment(
            self._local_history_iso(2026, 4, 6, 9, 0, 0),
            self._local_history_iso(2026, 4, 6, 9, 1, 0),
            youtube_video_id="vid-in-range",
        )
        self._insert_history_segment(
            self._local_history_iso(2026, 4, 8, 9, 0, 0),
            self._local_history_iso(2026, 4, 8, 9, 1, 0),
            youtube_video_id="vid-out-of-range",
        )
        self.database.save_youtube_metadata(YouTubeVideoMetadata(video_id="vid-in-range"))
        self.database.save_youtube_metadata(YouTubeVideoMetadata(video_id="vid-out-of-range"))
        self.database.save_youtube_metadata(YouTubeVideoMetadata(video_id="vid-orphan"))

        result = self.database.delete_history_range(
            start="2026-04-06",
            end="2026-04-06",
            scopes={"activity": False, "aiClassifications": False, "youtubeMetadata": True},
        )

        self.assertEqual(
            result,
            {"activitySegments": 0, "classifications": 0, "youtubeMetadata": 1, "dryRun": False},
        )
        self.assertEqual(self._count_rows("activity_segments"), 2)
        with self.database.connect() as conn:
            remaining_videos = sorted(
                row["video_id"] for row in conn.execute("SELECT video_id FROM youtube_video_metadata")
            )
        self.assertEqual(remaining_videos, ["vid-orphan", "vid-out-of-range"])

    def test_delete_history_range_all_time_removes_everything_in_scope(self) -> None:
        first = self._insert_history_segment(
            self._local_history_iso(2026, 4, 6, 9, 0, 0),
            self._local_history_iso(2026, 4, 6, 9, 1, 0),
            youtube_video_id="vid-referenced",
        )
        self._insert_history_segment(
            self._local_history_iso(2026, 5, 1, 9, 0, 0),
            self._local_history_iso(2026, 5, 1, 9, 1, 0),
        )
        self._save_history_classification(first, source="llm", ai_result=True)
        self.database.save_youtube_metadata(YouTubeVideoMetadata(video_id="vid-referenced"))
        self.database.save_youtube_metadata(YouTubeVideoMetadata(video_id="vid-orphan"))

        result = self.database.delete_history_range(
            scopes={"activity": True, "aiClassifications": True, "youtubeMetadata": True},
        )

        self.assertEqual(
            result,
            {"activitySegments": 2, "classifications": 1, "youtubeMetadata": 2, "dryRun": False},
        )
        self.assertEqual(self._count_rows("activity_segments"), 0)
        self.assertEqual(self._count_rows("activity_classifications"), 0)
        self.assertEqual(self._count_rows("youtube_video_metadata"), 0)

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

    def test_project_assignment_batch_skips_rows_whose_segment_or_project_disappeared(self) -> None:
        project = self.database.save_project({"name": "Kept", "description": "d"})["id"]
        removed_project = self.database.save_project({"name": "Removed", "description": "d"})["id"]
        live = self._insert_segment_returning_id("2026-04-06T09:00:00+00:00")
        trimmed = self._insert_segment_returning_id("2026-04-06T09:10:00+00:00")
        orphaned = self._insert_segment_returning_id("2026-04-06T09:20:00+00:00")
        # Both vanish from another path after the project pass selected them (#1492).
        self.database.delete_activity_segments([str(trimmed)])
        self.database.delete_project(removed_project)

        result = self.database.save_project_assignments(
            [
                {"segmentId": trimmed, "projectId": project, "source": "ai"},
                {"segmentId": orphaned, "projectId": removed_project, "source": "ai"},
                {"segmentId": live, "projectId": project, "source": "ai"},
            ]
        )

        self.assertEqual(result, {"saved": 1, "skippedManual": 0})
        assignments = {a["segmentId"]: a["projectId"] for a in self.database.get_project_assignments("2026-04-06")}
        self.assertEqual(assignments, {str(live): project})

    def test_team_project_assignment_batch_skips_rows_whose_segment_or_team_project_disappeared(self) -> None:
        self.database.upsert_team_projects("org-1", [{"id": "tp-a", "name": "A", "description": "d"}])
        live = self._insert_segment_returning_id("2026-04-06T09:00:00+00:00")
        trimmed = self._insert_segment_returning_id("2026-04-06T09:10:00+00:00")
        unknown_project = self._insert_segment_returning_id("2026-04-06T09:20:00+00:00")
        self.database.delete_activity_segments([str(trimmed)])

        result = self.database.save_team_project_assignments(
            [
                {"segmentId": trimmed, "teamProjectId": "tp-a", "source": "ai"},
                {"segmentId": unknown_project, "teamProjectId": "tp-removed", "source": "ai"},
                {"segmentId": live, "teamProjectId": "tp-a", "source": "ai"},
            ]
        )

        self.assertEqual(result, {"saved": 1, "skippedManual": 0})
        assignments = {a["segmentId"]: a["teamProjectId"] for a in self.database.get_team_project_assignments("2026-04-06")}
        self.assertEqual(assignments, {str(live): "tp-a"})

    def test_ai_review_event_batch_skips_rows_whose_segment_or_pass_disappeared(self) -> None:
        live = self._insert_segment_returning_id("2026-04-06T09:00:00+00:00")
        trimmed = self._insert_segment_returning_id("2026-04-06T09:10:00+00:00")
        pass_id = self.database.record_project_pass(
            {"rangeStart": "2026-04-06T00:00:00+00:00", "rangeEnd": "2026-04-06T23:59:59+00:00", "trigger": "manual"}
        )["id"]
        self.database.delete_activity_segments([str(trimmed)])
        event = {"prevCategory": "workspace", "newCategory": "social_media", "confidence": 0.9}

        saved = self.database.save_ai_review_events(
            [
                {**event, "segmentId": trimmed, "passId": pass_id},
                {**event, "segmentId": live, "passId": pass_id + 1000},
                {**event, "segmentId": live, "passId": pass_id},
            ]
        )

        self.assertEqual(saved, 1)
        events = self.database.get_ai_review_events("2026-04-06")
        self.assertEqual([(e["segmentId"], e["passId"]) for e in events], [(str(live), pass_id)])

    def _insert_segment_returning_id(self, started_at: str, ended_at: str | None = None) -> int:
        self.database.insert_segment(
            {
                "started_at": started_at,
                "ended_at": ended_at or started_at,
                "duration_seconds": 300,
                "app_name": "Code",
            }
        )
        with self.database.connect() as conn:
            return int(conn.execute("SELECT MAX(id) AS id FROM activity_segments").fetchone()["id"])

    def test_project_crud_and_archived_status(self) -> None:
        created = self.database.save_project({"name": "Drifty", "description": "Mac app work", "color": "#111111"})
        project_id = created["id"]
        self.assertTrue(project_id)
        self.assertEqual(created["status"], "active")
        self.assertEqual(created["anchors"], [])

        updated = self.database.save_project(
            {"id": project_id, "name": "Drifty Mac", "description": "Renamed", "status": "archived"}
        )
        self.assertEqual(updated["name"], "Drifty Mac")
        self.assertEqual(updated["status"], "archived")
        self.assertEqual(updated["createdAt"], created["createdAt"])

        projects = self.database.get_projects()
        self.assertEqual(len(projects), 1)
        self.assertEqual(projects[0]["status"], "archived")

        with self.assertRaises(ValueError):
            self.database.save_project({"name": "Bad", "description": "x", "status": "nonsense"})
        with self.assertRaises(ValueError):
            self.database.save_project({"name": "", "description": "x"})

    def test_project_anchor_merge_and_delete(self) -> None:
        project_id = self.database.save_project({"name": "P", "description": "d"})["id"]
        self.database.save_project_anchors(
            project_id,
            [
                {"kind": "app", "value": "Code", "source": "harvested"},
                {"kind": "domain", "value": "github.com", "source": "manual"},
                {"kind": "bogus", "value": "x", "source": "manual"},
            ],
        )
        # Duplicate app/Code must not create a second row (INSERT OR IGNORE).
        anchors = self.database.save_project_anchors(
            project_id, [{"kind": "app", "value": "Code", "source": "harvested"}]
        )
        self.assertEqual(len(anchors), 2)
        kinds = {(a["kind"], a["value"]) for a in anchors}
        self.assertEqual(kinds, {("app", "Code"), ("domain", "github.com")})

        deleted = self.database.delete_project_anchor(project_id, "app", "Code")
        self.assertEqual(deleted, 1)
        self.assertEqual(len(self.database.get_projects()[0]["anchors"]), 1)

    def test_assignment_upsert_and_manual_guard(self) -> None:
        project_a = self.database.save_project({"name": "A", "description": "a"})["id"]
        project_b = self.database.save_project({"name": "B", "description": "b"})["id"]
        seg1 = self._insert_segment_returning_id("2026-04-06T09:00:00+00:00")
        seg2 = self._insert_segment_returning_id("2026-04-06T10:00:00+00:00")

        first = self.database.save_project_assignments(
            [{"segmentId": seg1, "projectId": project_a, "source": "ai", "confidence": 0.8}]
        )
        self.assertEqual(first, {"saved": 1, "skippedManual": 0})

        # Re-assign seg1 to another project (upsert, still one row).
        self.database.save_project_assignments(
            [{"segmentId": seg1, "projectId": project_b, "source": "ai", "confidence": 0.7}]
        )
        assignments = self.database.get_project_assignments("2026-04-06")
        seg1_rows = [a for a in assignments if a["segmentId"] == str(seg1)]
        self.assertEqual(len(seg1_rows), 1)
        self.assertEqual(seg1_rows[0]["projectId"], project_b)

        # Make seg2 a manual assignment, then AI must not overwrite it.
        self.database.save_project_assignments(
            [{"segmentId": seg2, "projectId": project_a, "source": "manual"}]
        )
        guarded = self.database.save_project_assignments(
            [{"segmentId": seg2, "projectId": project_b, "source": "ai", "confidence": 0.9}]
        )
        self.assertEqual(guarded, {"saved": 0, "skippedManual": 1})
        seg2_row = [a for a in self.database.get_project_assignments("2026-04-06") if a["segmentId"] == str(seg2)][0]
        self.assertEqual(seg2_row["projectId"], project_a)
        self.assertEqual(seg2_row["source"], "manual")

        # Manual is allowed to overwrite an AI assignment.
        promoted = self.database.save_project_assignments(
            [{"segmentId": seg1, "projectId": project_a, "source": "manual"}]
        )
        self.assertEqual(promoted, {"saved": 1, "skippedManual": 0})

    def test_get_project_assignments_range_filter(self) -> None:
        project_id = self.database.save_project({"name": "P", "description": "d"})["id"]
        seg_day1 = self._insert_segment_returning_id("2026-04-06T09:00:00+00:00")
        seg_day2 = self._insert_segment_returning_id("2026-04-07T09:00:00+00:00")
        self.database.save_project_assignments(
            [
                {"segmentId": seg_day1, "projectId": project_id, "source": "ai"},
                {"segmentId": seg_day2, "projectId": project_id, "source": "ai"},
            ]
        )
        day1 = self.database.get_project_assignments("2026-04-06T00:00:00+00:00", "2026-04-06T23:59:59+00:00")
        self.assertEqual([a["segmentId"] for a in day1], [str(seg_day1)])

    def test_delete_project_nulls_assignments(self) -> None:
        project_id = self.database.save_project({"name": "P", "description": "d"})["id"]
        seg = self._insert_segment_returning_id("2026-04-06T09:00:00+00:00")
        self.database.save_project_assignments([{"segmentId": seg, "projectId": project_id, "source": "ai"}])
        deleted = self.database.delete_project(project_id)
        self.assertEqual(deleted, 1)
        rows = self.database.get_project_assignments("2026-04-06")
        self.assertEqual(len(rows), 1)
        self.assertIsNone(rows[0]["projectId"])

    def _project_window_input(self, segment_ids: list[int], **fields: object) -> dict:
        return {
            "windowId": "w-qa",
            "windowStartedAt": "2026-04-06T09:00:00+00:00",
            "windowEndedAt": "2026-04-06T09:03:00+00:00",
            "durationSeconds": 180,
            "segmentOverlaps": [{"segmentId": str(sid), "durationSeconds": 180} for sid in segment_ids],
            **fields,
        }

    def test_history_range_deletion_removes_windows_outside_range_referencing_deleted_segments(self) -> None:
        removed = self._insert_history_segment("2026-04-06T09:00:00+00:00", "2026-04-06T10:00:00+00:00")
        kept = self._insert_history_segment("2026-04-06T08:00:00+00:00", "2026-04-06T08:03:00+00:00")
        windows = [
            self._project_window_input([removed], windowId="before"),
            self._project_window_input([removed], windowId="after",
                                       windowStartedAt="2026-04-06T09:57:00+00:00",
                                       windowEndedAt="2026-04-06T10:00:00+00:00"),
            self._project_window_input([kept], windowId="kept",
                                       windowStartedAt="2026-04-06T08:00:00+00:00",
                                       windowEndedAt="2026-04-06T08:03:00+00:00"),
        ]
        self.assertEqual(self.database.save_project_window_assignments(windows)["saved"], 3)
        preserved_window = self.database.get_project_window_assignments()[0]
        self.database.save_project_assignments([{"segmentId": kept, "projectId": None, "source": "manual"}])
        preserved_assignment = self.database.get_project_assignments()[0]
        self.assertEqual(preserved_assignment["source"], "manual")
        bounds = {"start": "2026-04-06T09:30:00+00:00", "end": "2026-04-06T09:33:00+00:00",
                  "scopes": {"activity": True}}
        dry = self.database.delete_history_range(**bounds, dry_run=True)
        self.assertEqual(dry["activitySegments"], 1)
        self.assertEqual(len(self.database.get_project_window_assignments()), 3)

        deleted = self.database.delete_history_range(**bounds)
        self.assertEqual(deleted["activitySegments"], 1)
        with closing(sqlite3.connect(self.db_path)) as conn:
            self.assertEqual(conn.execute("SELECT id FROM activity_segments").fetchall(), [(kept,)])
        remaining = self.database.get_project_window_assignments()
        self.assertEqual([window["windowId"] for window in remaining], ["kept"])
        self.assertEqual(remaining[0], preserved_window)
        self.assertEqual(self.database.get_project_assignments(), [preserved_assignment])
        # A late result may not recreate either invalidated window.
        self.assertEqual(self.database.save_project_window_assignments(windows[:2])["saved"], 0)

    def test_history_range_project_window_cleanup_rolls_back_with_activity_deletion(self) -> None:
        removed = self._insert_history_segment("2026-04-06T09:00:00+00:00", "2026-04-06T10:00:00+00:00")
        self.database.save_project_window_assignments([self._project_window_input([removed])])
        with self.database.connect() as conn:
            conn.execute("CREATE TRIGGER qa_abort_range_delete BEFORE DELETE ON activity_segments "
                         "BEGIN SELECT RAISE(ABORT, 'qa range failure'); END")
        with self.assertRaisesRegex(sqlite3.IntegrityError, "qa range failure"):
            self.database.delete_history_range(start="2026-04-06T09:30:00+00:00",
                                               end="2026-04-06T09:33:00+00:00", scopes={"activity": True})
        self.assertEqual(self._count_rows("activity_segments"), 1)
        self.assertEqual(len(self.database.get_project_window_assignments()), 1)

    def test_project_window_late_result_does_not_recreate_deleted_activity_references(self) -> None:
        deleted = self._insert_segment_returning_id("2026-04-06T09:00:00+00:00")
        kept = self._insert_segment_returning_id("2026-04-06T09:03:00+00:00")
        late = self._project_window_input([deleted])
        self.database.save_project_window_assignments([late])
        self.database.delete_activity_segments([str(deleted)])
        self.assertEqual(self.database.get_project_window_assignments(), [])

        result = self.database.save_project_window_assignments([
            late,
            self._project_window_input([kept], windowStartedAt="2026-04-06T09:03:00+00:00",
                                       windowEndedAt="2026-04-06T09:06:00+00:00"),
        ])

        self.assertEqual(result, {"saved": 1, "skippedManual": 0})
        with closing(sqlite3.connect(self.db_path)) as conn:
            self.assertEqual(conn.execute("SELECT id FROM activity_segments").fetchall(), [(kept,)])
        self.assertEqual(
            [row["segmentOverlaps"] for row in self.database.get_project_window_assignments()],
            [[{"segmentId": str(kept), "durationSeconds": 180}]],
        )

    def test_project_window_late_result_skips_entire_partially_deleted_window(self) -> None:
        kept = self._insert_segment_returning_id("2026-04-06T09:00:00+00:00")
        deleted = self._insert_segment_returning_id("2026-04-06T09:01:00+00:00")
        late = self._project_window_input([kept, deleted])
        self.database.save_project_window_assignments([late])
        self.database.delete_activity_segments([str(deleted)])

        self.assertEqual(self.database.save_project_window_assignments([late])["saved"], 0)
        self.assertEqual(self.database.get_project_window_assignments(), [])

    def test_project_window_batch_skips_deleted_personal_project_and_preserves_existing_result(self) -> None:
        sid = self._insert_segment_returning_id("2026-04-06T09:00:00+00:00")
        kept = self.database.save_project({"name": "Kept"})["id"]
        gone = self.database.save_project({"name": "Gone"})["id"]
        self.database.save_project_window_assignments([self._project_window_input([sid], projectId=kept)])
        self.database.delete_project(gone)

        result = self.database.save_project_window_assignments([
            self._project_window_input([sid], projectId=kept,
                                       windowStartedAt="2026-04-06T09:03:00+00:00",
                                       windowEndedAt="2026-04-06T09:06:00+00:00"),
            self._project_window_input([sid], projectId=gone),
        ])

        self.assertEqual(result, {"saved": 1, "skippedManual": 0})
        self.assertEqual([row["projectId"] for row in self.database.get_project_window_assignments()], [kept, kept])

    def test_project_window_batch_skips_deleted_team_project(self) -> None:
        sid = self._insert_segment_returning_id("2026-04-06T09:00:00+00:00")
        self.database.upsert_team_projects("org-qa", [{"id": "gone", "name": "Gone"}, {"id": "kept", "name": "Kept"}])
        late = self._project_window_input([sid], teamProjectId="gone")
        self.database.upsert_team_projects("org-qa", [{"id": "kept", "name": "Kept"}])

        result = self.database.save_project_window_assignments([
            late, self._project_window_input([sid], teamProjectId="kept"),
        ])

        self.assertEqual(result, {"saved": 1, "skippedManual": 0})
        self.assertEqual([row["teamProjectId"] for row in self.database.get_project_window_assignments()], ["kept"])

    def test_project_window_reference_check_handles_more_than_one_sqlite_variable_batch(self) -> None:
        with self.database.connect() as conn:
            conn.executemany(
                "INSERT INTO activity_segments (started_at, ended_at, duration_seconds, app_name, platform, source)"
                " VALUES ('2026-04-06T09:00:00+00:00', '2026-04-06T09:03:00+00:00', 1, 'QA', 'macos', 'qa')",
                [()] * 1001,
            )
            ids = [row["id"] for row in conn.execute("SELECT id FROM activity_segments")]
        late = self._project_window_input(ids)
        self.assertEqual(self.database.save_project_window_assignments([late])["saved"], 1)
        self.database.delete_activity_segments([str(ids[-1])])
        self.assertEqual(self.database.save_project_window_assignments([late])["saved"], 0)
        self.assertEqual(self.database.get_project_window_assignments(), [])

    def test_project_window_reference_check_serializes_concurrent_activity_deletion(self) -> None:
        sid = self._insert_segment_returning_id("2026-04-06T09:00:00+00:00")
        other = sqlite3.connect(self.db_path, timeout=0)
        attempted = []
        def delete_before_window_insert(statement: str) -> None:
            if "INSERT INTO project_window_assignments" not in statement:
                return
            try:
                other.execute("DELETE FROM activity_segments WHERE id = ?", (sid,))
                other.commit()
                attempted.append("deleted")
            except sqlite3.OperationalError as error:
                attempted.append(str(error))
                other.rollback()
        self.database.connect().set_trace_callback(delete_before_window_insert)
        try:
            self.assertEqual(self.database.save_project_window_assignments([self._project_window_input([sid])])["saved"], 1)
        finally:
            self.database.connect().set_trace_callback(None)
            other.close()

        self.assertEqual(attempted, ["database is locked"])
        self.database.delete_activity_segments([str(sid)])
        self.assertEqual(self.database.get_project_window_assignments(), [])

    def test_project_window_invalid_batches_remain_noops_during_writer_contention(self) -> None:
        sid = self._insert_segment_returning_id("2026-04-06T09:00:00+00:00")
        other = sqlite3.connect(self.db_path, timeout=0)
        other.execute("BEGIN IMMEDIATE")
        self.database.connect().execute("PRAGMA busy_timeout = 0")
        try:
            self.assertEqual(self.database.save_project_window_assignments([])["saved"], 0)
            result = self.database.save_project_window_assignments([
                {},
                self._project_window_input([sid], windowEndedAt="invalid"),
                self._project_window_input([sid], durationSeconds=0),
                self._project_window_input([sid], projectId="personal", teamProjectId="team"),
            ])
            self.assertEqual(result, {"saved": 0, "skippedManual": 0})
        finally:
            other.rollback()
            other.close()
        self.assertEqual(self.database.get_project_window_assignments(), [])

    def test_project_window_batch_still_rolls_back_unexpected_sqlite_errors(self) -> None:
        sid = self._insert_segment_returning_id("2026-04-06T09:00:00+00:00")
        with self.database.connect() as conn:
            conn.execute(
                "CREATE TRIGGER qa_abort_window BEFORE INSERT ON project_window_assignments"
                " WHEN NEW.window_id = 'abort' BEGIN SELECT RAISE(ABORT, 'qa window abort'); END"
            )
        with self.assertRaisesRegex(sqlite3.IntegrityError, "qa window abort"):
            self.database.save_project_window_assignments([
                self._project_window_input([sid]),
                self._project_window_input([sid], windowId="abort", windowStartedAt="2026-04-06T09:03:00+00:00",
                                           windowEndedAt="2026-04-06T09:06:00+00:00"),
            ])
        self.assertEqual(self.database.get_project_window_assignments(), [])

    def test_project_window_assignment_roundtrip_upsert_and_range(self) -> None:
        project_a = self.database.save_project({"name": "A", "description": "a"})["id"]
        project_b = self.database.save_project({"name": "B", "description": "b"})["id"]
        seg_day1 = self._insert_segment_returning_id(
            "2026-04-06T09:00:00+00:00", "2026-04-06T09:06:00+00:00"
        )
        seg_day2 = self._insert_segment_returning_id(
            "2026-04-07T09:00:00+00:00", "2026-04-07T09:03:00+00:00"
        )
        first = self.database.save_project_window_assignments(
            [
                {
                    "windowId": "w0",
                    "windowStartedAt": "2026-04-06T09:00:00+00:00",
                    "windowEndedAt": "2026-04-06T09:03:00+00:00",
                    "durationSeconds": 180,
                    "segmentOverlaps": [{"segmentId": seg_day1, "durationSeconds": 180}],
                    "projectId": project_a,
                    "teamProjectId": None,
                    "confidence": 0.91,
                    "chunkFingerprint": "pp-a",
                },
                {
                    "windowId": "w1",
                    "windowStartedAt": "2026-04-07T09:00:00+00:00",
                    "windowEndedAt": "2026-04-07T09:03:00+00:00",
                    "durationSeconds": 180,
                    "segmentOverlaps": [{"segmentId": seg_day2, "durationSeconds": 180}],
                    "projectId": project_a,
                    "teamProjectId": None,
                },
            ]
        )
        self.assertEqual(first, {"saved": 2, "skippedManual": 0})

        # The fixed window start is the stable local key, so rerunning that window
        # updates one row instead of accumulating competing decisions.
        self.database.save_project_window_assignments(
            [
                {
                    "windowId": "w99",
                    "windowStartedAt": "2026-04-06T09:00:00+00:00",
                    "windowEndedAt": "2026-04-06T09:03:00+00:00",
                    "durationSeconds": 180,
                    "segmentOverlaps": [{"segmentId": seg_day1, "durationSeconds": 180}],
                    "projectId": project_b,
                    "teamProjectId": None,
                    "confidence": 0.95,
                    "chunkFingerprint": "pp-b",
                }
            ]
        )
        day1 = self.database.get_project_window_assignments(
            "2026-04-06T00:00:00+00:00", "2026-04-07T00:00:00+00:00"
        )
        self.assertEqual(len(day1), 1)
        self.assertEqual(day1[0]["windowId"], "w99")
        self.assertEqual(day1[0]["projectId"], project_b)
        self.assertEqual(day1[0]["segmentOverlaps"], [{"segmentId": str(seg_day1), "durationSeconds": 180}])
        self.assertEqual(day1[0]["chunkFingerprint"], "pp-b")

        self.database.delete_project(project_b)
        self.assertIsNone(self.database.get_project_window_assignments("2026-04-06")[0]["projectId"])

    def test_project_window_assignment_routes_team_project_exclusively(self) -> None:
        self.database.upsert_team_projects(
            "org-1", [{"id": "tp-a", "name": "A", "description": "d"}]
        )
        seg = self._insert_segment_returning_id(
            "2026-04-06T09:00:00+00:00", "2026-04-06T09:03:00+00:00"
        )
        result = self.database.save_project_window_assignments(
            [
                {
                    "windowId": "w0",
                    "windowStartedAt": "2026-04-06T09:00:00+00:00",
                    "windowEndedAt": "2026-04-06T09:03:00+00:00",
                    "durationSeconds": 180,
                    "segmentOverlaps": [{"segmentId": seg, "durationSeconds": 180}],
                    "projectId": None,
                    "teamProjectId": "tp-a",
                }
            ]
        )
        self.assertEqual(result["saved"], 1)
        row = self.database.get_project_window_assignments("2026-04-06")[0]
        self.assertIsNone(row["projectId"])
        self.assertEqual(row["teamProjectId"], "tp-a")

    def test_team_project_upsert_and_get(self) -> None:
        result = self.database.upsert_team_projects(
            "org-1",
            [
                {
                    "id": "tp-a",
                    "name": "Team A",
                    "description": "shared work",
                    "color": "#222222",
                    "anchors": [
                        {"kind": "app", "value": "Code", "source": "harvested"},
                        {"kind": "bogus", "value": "x", "source": "manual"},
                    ],
                },
                {"id": "tp-b", "name": "Team B", "description": "other"},
            ],
        )
        self.assertEqual(len(result), 2)
        by_id = {p["id"]: p for p in result}
        self.assertEqual(by_id["tp-a"]["organizationId"], "org-1")
        self.assertEqual(by_id["tp-a"]["status"], "active")
        self.assertEqual([a["value"] for a in by_id["tp-a"]["anchors"]], ["Code"])
        self.assertEqual(by_id["tp-b"]["color"], "#6366f1")

        # id is required for team projects (cloud uuid).
        with self.assertRaises(ValueError):
            self.database.upsert_team_projects("org-1", [{"name": "x", "description": "d"}])
        with self.assertRaises(ValueError):
            self.database.upsert_team_projects("", [{"id": "tp-a", "name": "x", "description": "d"}])

    def test_team_project_upsert_removes_vanished_but_preserves_survivor_assignment(self) -> None:
        self.database.upsert_team_projects(
            "org-1",
            [
                {"id": "tp-keep", "name": "Keep", "description": "d"},
                {"id": "tp-drop", "name": "Drop", "description": "d"},
            ],
        )
        seg = self._insert_segment_returning_id("2026-04-06T09:00:00+00:00")
        self.database.save_team_project_assignments(
            [{"segmentId": seg, "teamProjectId": "tp-keep", "source": "ai"}]
        )

        # Resync with tp-drop gone. Non-destructive upsert must keep tp-keep and its assignment.
        remaining = self.database.upsert_team_projects(
            "org-1", [{"id": "tp-keep", "name": "Keep Renamed", "description": "d2"}]
        )
        self.assertEqual([p["id"] for p in remaining], ["tp-keep"])
        self.assertEqual(remaining[0]["name"], "Keep Renamed")
        rows = self.database.get_team_project_assignments("2026-04-06")
        keep_row = [a for a in rows if a["segmentId"] == str(seg)][0]
        self.assertEqual(keep_row["teamProjectId"], "tp-keep")

    def test_team_project_upsert_nulls_assignment_of_dropped_project(self) -> None:
        self.database.upsert_team_projects(
            "org-1",
            [
                {"id": "tp-keep", "name": "Keep", "description": "d"},
                {"id": "tp-drop", "name": "Drop", "description": "d"},
            ],
        )
        seg = self._insert_segment_returning_id("2026-04-06T09:00:00+00:00")
        self.database.save_team_project_assignments(
            [{"segmentId": seg, "teamProjectId": "tp-drop", "source": "ai"}]
        )
        # Resync drops tp-drop; ON DELETE SET NULL must null the assignment's project.
        self.database.upsert_team_projects(
            "org-1", [{"id": "tp-keep", "name": "Keep", "description": "d"}]
        )
        rows = self.database.get_team_project_assignments("2026-04-06")
        dropped_row = [a for a in rows if a["segmentId"] == str(seg)][0]
        self.assertIsNone(dropped_row["teamProjectId"])

    def test_team_project_upsert_empty_clears_org(self) -> None:
        self.database.upsert_team_projects(
            "org-1", [{"id": "tp-a", "name": "A", "description": "d"}]
        )
        self.assertEqual(len(self.database.get_team_projects()), 1)
        # An authoritative empty upsert intentionally clears the org's mirror. The app
        # layer guards against sending [] on a transient fetch, so this only fires when
        # the org truly has zero projects.
        remaining = self.database.upsert_team_projects("org-1", [])
        self.assertEqual(remaining, [])
        self.assertEqual(self.database.get_team_projects(), [])

    def test_team_project_assignment_manual_guard_and_range(self) -> None:
        self.database.upsert_team_projects(
            "org-1",
            [
                {"id": "tp-a", "name": "A", "description": "d"},
                {"id": "tp-b", "name": "B", "description": "d"},
            ],
        )
        seg_day1 = self._insert_segment_returning_id("2026-04-06T09:00:00+00:00")
        seg_day2 = self._insert_segment_returning_id("2026-04-07T09:00:00+00:00")

        self.database.save_team_project_assignments(
            [
                {"segmentId": seg_day1, "teamProjectId": "tp-a", "source": "manual"},
                {"segmentId": seg_day2, "teamProjectId": "tp-a", "source": "ai"},
            ]
        )
        guarded = self.database.save_team_project_assignments(
            [{"segmentId": seg_day1, "teamProjectId": "tp-b", "source": "ai", "confidence": 0.9}]
        )
        self.assertEqual(guarded, {"saved": 0, "skippedManual": 1})

        day1 = self.database.get_team_project_assignments(
            "2026-04-06T00:00:00+00:00", "2026-04-06T23:59:59+00:00"
        )
        self.assertEqual([a["segmentId"] for a in day1], [str(seg_day1)])
        self.assertEqual(day1[0]["teamProjectId"], "tp-a")
        self.assertEqual(day1[0]["source"], "manual")

    def test_record_project_pass(self) -> None:
        result = self.database.record_project_pass(
            {
                "rangeStart": "2026-04-06T00:00:00+00:00",
                "rangeEnd": "2026-04-06T23:59:59+00:00",
                "trigger": "manual",
                "model": "test-model",
                "tokensIn": 1000,
                "promptVersion": "pp-v1",
            }
        )
        self.assertIsInstance(result["id"], int)
        with self.database.connect() as conn:
            row = conn.execute("SELECT trigger, model, tokens_in FROM project_pass_runs WHERE id = ?", (result["id"],)).fetchone()
        self.assertEqual(row["trigger"], "manual")
        self.assertEqual(row["model"], "test-model")
        self.assertEqual(row["tokens_in"], 1000)

        runs = self.database.get_project_pass_runs()
        self.assertEqual(len(runs), 1)
        self.assertEqual(runs[0]["tokensIn"], 1000)
        self.assertEqual(runs[0]["trigger"], "manual")

    def test_ai_review_event_save_and_revert(self) -> None:
        seg = self._insert_classified_segment(
            "2026-04-06T09:00:00+00:00", "fp-review", category="workspace", productivity="focus", source="llm"
        )
        pass_id = self.database.record_project_pass(
            {"rangeStart": "2026-04-06T00:00:00+00:00", "rangeEnd": "2026-04-06T23:59:59+00:00", "trigger": "manual", "promptVersion": "pp-v1"}
        )["id"]
        self.database.save_ai_review_events(
            [
                {
                    "segmentId": seg,
                    "passId": pass_id,
                    "prevCategory": "workspace",
                    "prevProductivity": "focus",
                    "prevSource": "llm",
                    "newCategory": "social_media",
                    "newProductivity": "focus",
                    "confidence": 0.9,
                }
            ]
        )
        # Apply the correction the way the service would.
        self.database.save_classifications(
            [{"segmentId": seg, "category": "social_media", "productivity": "focus", "source": "ai_review", "confidence": 0.9, "inputFingerprint": "fp-review"}]
        )

        events = self.database.get_ai_review_events("2026-04-06")
        self.assertEqual(len(events), 1)
        event_id = events[0]["id"]

        result = self.database.revert_ai_review_event(event_id)
        self.assertEqual(result, {"reverted": True, "restored": True})

        with self.database.connect() as conn:
            row = conn.execute("SELECT category, productivity, source FROM activity_classifications WHERE segment_id = ?", (seg,)).fetchone()
        self.assertEqual((row["category"], row["productivity"], row["source"]), ("workspace", "focus", "llm"))

        reverted_events = self.database.get_ai_review_events("2026-04-06")
        self.assertIsNotNone(reverted_events[0]["revertedAt"])
        self.assertEqual(self.database.get_reverted_ai_review_segment_ids([str(seg)]), [str(seg)])

        # A second revert is a no-op.
        self.assertEqual(self.database.revert_ai_review_event(event_id), {"reverted": False, "restored": False})

    def test_revert_skips_restore_when_user_changed_classification(self) -> None:
        seg = self._insert_classified_segment(
            "2026-04-06T09:00:00+00:00", "fp-review2", category="workspace", productivity="focus", source="llm"
        )
        pass_id = self.database.record_project_pass(
            {"rangeStart": "2026-04-06T00:00:00+00:00", "rangeEnd": "2026-04-06T23:59:59+00:00", "trigger": "manual", "promptVersion": "pp-v1"}
        )["id"]
        self.database.save_ai_review_events(
            [{"segmentId": seg, "passId": pass_id, "prevCategory": "workspace", "prevProductivity": "focus", "prevSource": "llm", "newCategory": "social_media", "newProductivity": "focus", "confidence": 0.9}]
        )
        self.database.save_classifications(
            [{"segmentId": seg, "category": "social_media", "productivity": "focus", "source": "ai_review", "inputFingerprint": "fp-review2"}]
        )
        # User manually overrides after the AI review.
        self.database.save_classifications(
            [{"segmentId": seg, "category": "communication", "productivity": "neutral", "source": "manual", "inputFingerprint": "fp-review2"}]
        )
        event_id = self.database.get_ai_review_events("2026-04-06")[0]["id"]
        result = self.database.revert_ai_review_event(event_id)
        self.assertEqual(result, {"reverted": True, "restored": False})

        with self.database.connect() as conn:
            row = conn.execute("SELECT category, source FROM activity_classifications WHERE segment_id = ?", (seg,)).fetchone()
        self.assertEqual((row["category"], row["source"]), ("communication", "manual"))


if __name__ == "__main__":
    unittest.main()
