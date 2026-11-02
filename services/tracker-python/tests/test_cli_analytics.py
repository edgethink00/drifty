from __future__ import annotations

import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.cli.mcp import call_tool
from app.storage.db import TrackerDatabase
import tests.test_cli as cli_fixture


class ChatRecordAnalyticsTests(unittest.TestCase):
    setUp = cli_fixture.DriftyCliTests.setUp
    tearDown = cli_fixture.DriftyCliTests.tearDown

    def call(self, **arguments):
        with patch.dict(os.environ, {"TZ": "Asia/Seoul"}):
            return call_tool(self.db_path, "summary", arguments, "safe")

    def add(self, database, start, end, seconds, app="Editor", productivity="focus"):
        database.insert_segment({"started_at": start, "ended_at": end, "duration_seconds": seconds,
                                 "app_name": app, "platform": "macos", "source": "test"})
        row = next(row for row in database.timeline() if row["started_at"] == start and row["app_name"] == app)
        database.save_classifications([{"segmentId": str(row["id"]), "category": "Software Development",
                                        "productivity": productivity, "source": "manual", "confidence": 1}])
        return str(row["id"])

    def test_day_and_explicit_cutoff_clip_records_without_changing_the_database(self):
        database = TrackerDatabase(self.db_path, perform_maintenance=False)
        self.add(database, "2026-07-28T23:30:00+09:00", "2026-07-29T00:30:00+09:00", 3600)
        self.add(database, "2026-07-29T23:30:00+09:00", "2026-07-30T00:30:00+09:00", 3600)
        database.close()
        before = self.db_path.read_bytes()
        result = self.call(day="2026-07-29")["structuredContent"]["data"]
        self.assertEqual(result["recordedSeconds"], 9300 + 3600)
        self.assertEqual(result["firstRecordedAt"], "2026-07-29T00:00:00+09:00")
        self.assertEqual(result["lastRecordedAt"], "2026-07-30T00:00:00+09:00")
        partial = self.call(**{"from": "2026-07-29T00:00:00+09:00", "to": "2026-07-29T09:30:00+09:00"})["structuredContent"]["data"]
        self.assertEqual(partial["recordedSeconds"], 3600)
        self.assertEqual(self.db_path.read_bytes(), before)

    def test_overlapping_devices_share_elapsed_time_before_project_and_label_filters(self):
        database = TrackerDatabase(self.db_path, perform_maintenance=False)
        local = self.add(database, "2026-07-28T10:00:00+09:00", "2026-07-28T11:00:00+09:00", 3600, "Mac editor")
        remote = self.add(database, "2026-07-28T10:00:00+09:00", "2026-07-28T11:00:00+09:00", 3600, "Windows editor", "drift")
        with database.connect() as connection:
            connection.execute("UPDATE activity_segments SET origin_device_id = 'qa-pc' WHERE id = ?", (remote,))
        database.save_project_assignments([{"segmentId": local, "projectId": "project-polaris", "source": "manual", "confidence": 1}])
        database.close()
        result = self.call(day="2026-07-28")["structuredContent"]["data"]
        self.assertEqual(result["recordedSeconds"], 3600)
        self.assertEqual(result["focusSeconds"], 1800)
        self.assertEqual(result["driftSeconds"], 1800)
        self.assertEqual(result["projects"], [{"id": "project-polaris", "name": "Polaris", "seconds": 1800}])
        selected = self.call(day="2026-07-28", projectId="project-polaris")["structuredContent"]["data"]
        self.assertEqual(selected["recordedSeconds"], 1800)

    def test_project_assignment_does_not_include_a_title_match(self):
        database = TrackerDatabase(self.db_path, perform_maintenance=False)
        extra = self.add(database, "2026-07-29T17:00:00+09:00", "2026-07-29T17:10:00+09:00", 600)
        with database.connect() as connection:
            connection.execute("UPDATE activity_segments SET window_title = 'Polaris newsletter' WHERE id = ?", (extra,))
        database.close()
        result = self.call(day="2026-07-29", projectId="project-polaris")
        data = result["structuredContent"]["data"]
        self.assertEqual(data["recordedSeconds"], 8100)
        self.assertNotIn("newsletter", json.dumps(result))
        overview = self.call(day="2026-07-29")["structuredContent"]["data"]
        self.assertEqual(overview["unassignedSeconds"], 1800)
        self.assertTrue(self.call(day="2026-07-29", projectId="does-not-exist")["isError"])

    def test_forward_point_sample_keeps_its_project_across_midnight(self):
        database = TrackerDatabase(self.db_path, perform_maintenance=False)
        segment = self.add(database, "2026-07-27T23:59:59+09:00", "2026-07-27T23:59:59+09:00", 4)
        database.save_project_assignments([{"segmentId": segment, "projectId": "project-polaris", "source": "manual", "confidence": 1}])
        database.close()
        data = self.call(day="2026-07-28", projectId="project-polaris")["structuredContent"]["data"]
        self.assertEqual(data["recordedSeconds"], 3)
        self.assertEqual(data["projects"][0]["seconds"], 3)

    def test_window_assignments_use_sampled_time_and_manual_choices_win(self):
        database = TrackerDatabase(self.db_path, perform_maintenance=False)
        segment = self.add(database, "2026-07-28T09:00:00+09:00", "2026-07-28T10:00:00+09:00", 1800)
        database.save_project_window_assignments([{
            "windowId": "partial", "windowStartedAt": "2026-07-28T09:15:00+09:00",
            "windowEndedAt": "2026-07-28T09:45:00+09:00", "durationSeconds": 1800,
            "segmentOverlaps": [{"segmentId": segment, "durationSeconds": 1800}],
            "projectId": "project-polaris", "source": "ai", "confidence": 1,
        }])
        database.close()
        result = self.call(day="2026-07-28")["structuredContent"]["data"]
        self.assertEqual(result["recordedSeconds"], 1800)
        self.assertEqual(result["projects"][0]["seconds"], 900)
        self.assertEqual(result["unassignedSeconds"], 900)
        database = TrackerDatabase(self.db_path, perform_maintenance=False)
        database.save_project_assignments([{"segmentId": segment, "projectId": "project-polaris", "source": "manual", "confidence": 1}])
        database.close()
        result = self.call(day="2026-07-28", projectId="project-polaris")["structuredContent"]["data"]
        self.assertEqual(result["recordedSeconds"], 1800)

    def test_longest_focus_joins_short_gaps_excludes_gap_seconds_and_breaks_at_midnight(self):
        database = TrackerDatabase(self.db_path, perform_maintenance=False)
        for start, end, seconds in [
            ("09:00:00", "09:30:00", 1800), ("09:34:00", "10:04:00", 1800),
            ("14:00:00", "15:00:00", 3600),
        ]:
            self.add(database, "2026-07-28T" + start + "+09:00", "2026-07-28T" + end + "+09:00", seconds)
        database.close()
        data = self.call(day="2026-07-28")["structuredContent"]["data"]
        self.assertEqual(data["longestFocus"], {"startedAt": "2026-07-28T09:00:00+09:00", "endedAt": "2026-07-28T10:04:00+09:00", "seconds": 3600})
        self.assertEqual(data["focusRunMaxGapSeconds"], 300)

    def test_complete_week_summary_reports_coverage_and_drift_specific_rankings(self):
        result = self.call(**{"from": "2026-07-27T00:00:00+09:00", "to": "2026-08-03T00:00:00+09:00"})
        data = result["structuredContent"]["data"]
        self.assertEqual(len(data["days"]), 7)
        self.assertEqual(data["recordedDays"], 1)
        self.assertIsNone(data["days"][0]["focusShare"])
        self.assertEqual(data["topApps"][0]["name"], "Visual Studio Code")
        self.assertEqual(data["topDriftApps"], [{"name": "Safari", "seconds": 1200}])
        self.assertEqual(data["topDriftSiteDomains"], [{"name": "youtube.com", "seconds": 1200}])
        self.assertTrue(data["totalsComplete"])
        self.assertNotIn("SENTINEL", json.dumps(result))

    def test_invalid_ranges_are_errors_and_pagination_never_claims_a_complete_total(self):
        for arguments in ({}, {"day": "2026-07-29", "from": "a", "to": "b"},
                          {"from": "2026-07-29T00:00:00+09:00"},
                          {"from": "2026-07-01T00:00:00+09:00", "to": "2026-08-03T00:00:00+09:00"}):
            with self.subTest(arguments=arguments):
                self.assertTrue(self.call(**arguments)["isError"])
        with patch.dict(os.environ, {"TZ": "Asia/Seoul"}):
            first = call_tool(self.db_path, "search", {"query": "Safari", "day": "2026-07-29", "limit": 1}, "safe")["structuredContent"]["data"]
            last = call_tool(self.db_path, "search", {"query": "Safari", "day": "2026-07-29", "limit": 1, "cursor": first["nextCursor"]}, "safe")["structuredContent"]["data"]
        self.assertEqual(first["matchedSecondsScope"], "page")
        self.assertFalse(first["totalsComplete"])
        self.assertFalse(last["totalsComplete"])

    def test_explicit_range_and_day_coverage_keep_a_dst_fall_back_hour(self):
        try:
            from zoneinfo import ZoneInfo
            ZoneInfo("America/New_York")
        except Exception:
            self.skipTest("IANA timezone data is unavailable")
        database = TrackerDatabase(self.db_path, perform_maintenance=False)
        self.add(database, "2026-11-01T00:30:00-04:00", "2026-11-01T02:30:00-05:00", 10800)
        database.close()
        with patch.dict(os.environ, {"TZ": "America/New_York"}):
            result = call_tool(self.db_path, "summary", {"from": "2026-11-01T00:00:00-04:00", "to": "2026-11-02T00:00:00-05:00"}, "safe")["structuredContent"]["data"]
        self.assertEqual(result["recordedSeconds"], 10800)
        self.assertEqual(len(result["days"]), 1)
        self.assertEqual(result["longestFocus"]["seconds"], 10800)


if __name__ == "__main__":
    unittest.main()
