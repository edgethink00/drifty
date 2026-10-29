import tempfile
import unittest
from pathlib import Path

from app.storage.db import TrackerDatabase


class ProjectWindowSampledTimeTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.db = TrackerDatabase(Path(self.directory.name) / "tracker.sqlite3")
        self.addCleanup(self.db.close)
        for second in ["59.500", "58.000"]:
            self.db.insert_segment({"started_at": "2026-04-06T09:02:" + second + "Z", "ended_at": "2026-04-06T09:02:" + second + "Z", "duration_seconds": 1, "app_name": "Code"})
        self.ids = sorted((row["id"] for row in self.db.fetch_timeline("2026-04-06")), key=int)

    def window(self, overlaps, duration, minute=0):
        return {"windowId": "w" + str(minute), "windowStartedAt": "2026-04-06T09:0" + str(minute) + ":00Z",
                "windowEndedAt": "2026-04-06T09:0" + str(minute + 3) + ":00Z",
                "durationSeconds": duration, "segmentOverlaps": overlaps, "projectId": None, "teamProjectId": None, "source": "ai"}

    def overlap(self, sid, seconds):
        return {"segmentId": sid, "durationSeconds": seconds}

    def test_retains_both_half_second_windows_of_a_boundary_point_sample(self):
        windows = [self.window([self.overlap(self.ids[0], 0.5)], 0.5, minute) for minute in [0, 3]]
        self.assertEqual(self.db.save_project_window_assignments(windows)["saved"], 2)
        rows = self.db.get_project_window_assignments()
        self.assertEqual([row["durationSeconds"] for row in rows], [0.5, 0.5])
        self.assertEqual([row["segmentOverlaps"] for row in rows], [[self.overlap(self.ids[0], 0.5)]] * 2)

    def test_retains_fractional_contributors_and_noninteger_window_total(self):
        overlaps = [self.overlap(self.ids[0], 0.5), self.overlap(self.ids[1], 1)]
        self.assertEqual(self.db.save_project_window_assignments([self.window(overlaps, 1.5)])["saved"], 1)
        row = self.db.get_project_window_assignments()[0]
        self.assertEqual(row["durationSeconds"], 1.5)
        self.assertEqual(row["segmentOverlaps"], overlaps)

    def test_a_deleted_fractional_contributor_still_invalidates_the_entire_window(self):
        deleted, kept = self.ids
        self.db.delete_activity_segments([deleted])
        window = self.window([self.overlap(deleted, 0.5), self.overlap(kept, 1)], 1.5)
        self.assertEqual(self.db.save_project_window_assignments([window])["saved"], 0)
        self.assertEqual(self.db.get_project_window_assignments(), [])

    def test_integer_windows_remain_compatible(self):
        window = self.window([self.overlap(self.ids[0], 1)], 1)
        self.assertEqual(self.db.save_project_window_assignments([window])["saved"], 1)
        self.assertEqual(self.db.get_project_window_assignments()[0]["durationSeconds"], 1)

    def test_rejects_nonfinite_or_nonpositive_durations(self):
        for value in [float("nan"), float("inf"), -1, 0]:
            with self.subTest(value=value):
                self.assertEqual(self.db.save_project_window_assignments([self.window([self.overlap(self.ids[0], value)], value)])["saved"], 0)
                self.assertEqual(self.db.save_project_window_assignments([self.window([self.overlap(self.ids[0], 1)], value)])["saved"], 0)
        self.assertEqual(self.db.get_project_window_assignments(), [])

    def test_slim_trend_retains_synced_device_identity_without_extra_context(self):
        start, end = "2026-04-06T09:10:00Z", "2026-04-06T09:16:00Z"
        self.db.insert_segment({"started_at": start, "ended_at": end, "duration_seconds": 60,
                                "app_name": "Code", "platform": "macos"})
        result = self.db.apply_synced_segments([{
            "segmentUid": "qa-project-remote", "originDeviceId": "qa-pc",
            "startedAt": start, "endedAt": end, "durationSeconds": 60,
            "appName": "Editor", "platform": "windows", "source": "uia",
            "windowTitle": "Private context", "siteUrl": "https://example.com/private",
        }])
        self.assertEqual(result["inserted"], 1)
        full = [row for row in self.db.fetch_timeline("2026-04-06") if row["startedAt"] == start]
        slim = self.db.project_trend_timeline(start, end)
        self.assertEqual({row["id"]: row.get("deviceId") for row in slim},
                         {row["id"]: row.get("deviceId") for row in full})
        self.assertEqual(sorted(row["durationSeconds"] for row in slim), [60, 60])
        remote = next(row for row in slim if row["platform"] == "windows")
        self.assertEqual(remote.get("deviceId"), "qa-pc")
        # Titles read as on the full timeline; the URL stays out of the slim view.
        self.assertEqual(remote.get("windowTitle"), next(row for row in full if row.get("deviceId") == "qa-pc").get("windowTitle"))
        self.assertNotIn("siteUrl", remote)
