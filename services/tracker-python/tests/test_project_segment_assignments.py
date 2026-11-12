import tempfile
import unittest
from pathlib import Path

from app.storage.db import TrackerDatabase


class ProjectSegmentAssignmentTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "tracker.sqlite3"
        self.db = TrackerDatabase(self.path)
        self.addCleanup(lambda: self.db.close())
        for app in ["Code", "Chrome"]:
            self.db.insert_segment({"started_at": "2026-04-06T09:00:00Z", "ended_at": "2026-04-06T09:03:00Z",
                                    "duration_seconds": 180, "app_name": app})
        self.ids = [row["id"] for row in self.db.fetch_timeline("2026-04-06")]
        self.project = self.db.save_project({"name": "Lab", "description": ""})["id"]
        with self.db.connect() as conn:
            conn.execute("INSERT INTO team_projects(id, organization_id, name, description, color, created_at, updated_at) VALUES ('team', 'org', 'Team', '', '#000', '2026-04-06', '2026-04-06')")

    def decision(self, sid, **fields):
        return {"decisionUnit": "segment", "windowId": "w" + sid,
                "windowStartedAt": "2026-04-06T09:00:00Z", "windowEndedAt": "2026-04-06T09:03:00Z",
                "durationSeconds": 180, "segmentOverlaps": [{"segmentId": sid, "durationSeconds": 180}],
                "projectId": self.project, "teamProjectId": None, "confidence": 0.9, "source": "ai", **fields}

    def test_same_start_records_do_not_collide_with_each_other_or_legacy_windows(self):
        legacy = self.decision(self.ids[0])
        legacy.pop("decisionUnit")
        self.db.save_project_window_assignments([legacy])
        self.assertEqual(self.db.save_project_window_assignments([self.decision(sid) for sid in self.ids])["saved"], 2)
        rows = self.db.get_project_window_assignments()
        self.assertEqual(len(rows), 3)
        self.assertEqual(sum(row.get("decisionUnit") == "segment" for row in rows), 2)

    def test_team_personal_and_null_replace_one_atomic_source_decision(self):
        for project, team in [(None, "team"), (self.project, None), (None, None)]:
            self.assertEqual(self.db.save_project_window_assignments([
                self.decision(self.ids[0], projectId=project, teamProjectId=team)])["saved"], 1)
            rows = self.db.get_project_window_assignments()
            self.assertEqual(len(rows), 1)
            self.assertEqual((rows[0]["projectId"], rows[0]["teamProjectId"]), (project, team))
        invalid = self.decision(self.ids[0], teamProjectId="team")
        self.assertEqual(self.db.save_project_window_assignments([invalid])["saved"], 0)

    def test_ai_decision_does_not_overwrite_user_assignment(self):
        self.db.save_project_assignments([{"segmentId": self.ids[0], "projectId": None, "source": "manual"}])
        self.db.save_project_window_assignments([self.decision(self.ids[0])])
        manual = self.db.get_project_assignments()[0]
        self.assertEqual((manual["source"], manual["projectId"]), ("manual", None))

    def test_delete_cascades_and_late_response_cannot_restore_the_record(self):
        value = self.decision(self.ids[0])
        self.db.save_project_window_assignments([value])
        self.db.delete_activity_segments([self.ids[0]])
        self.assertEqual(self.db.get_project_window_assignments(), [])
        self.assertEqual(self.db.save_project_window_assignments([value])["saved"], 0)

    def test_pass_counts_only_decisions_that_storage_accepted(self):
        record = self.db.record_project_pass({"rangeStart": "2026-04-06T00:00:00Z", "rangeEnd": "2026-04-07T00:00:00Z",
                                              "trigger": "manual", "assignmentsCount": 0, "promptVersion": "pp-v6-segment"})
        result = self.db.save_project_window_assignments([
            self.decision(self.ids[0], passId=record["id"]), self.decision("999999", passId=record["id"])])
        self.assertEqual(result["saved"], 1)
        self.assertEqual(self.db.get_project_pass_runs()[0]["assignmentsCount"], 1)

    def test_exclusion_added_during_inference_rejects_the_late_decision(self):
        code = next(row["id"] for row in self.db.fetch_timeline("2026-04-06") if row["appName"] == "Code")
        self.db.save_excluded_app("qa-code", "Code")
        self.assertEqual(self.db.save_project_window_assignments([self.decision(code)])["saved"], 0)
        self.assertEqual(self.db.get_project_window_assignments(), [])

    def test_segment_contract_rejects_mixed_sources_and_unknown_grains(self):
        mixed = self.decision(self.ids[0])
        mixed["segmentOverlaps"].append({"segmentId": self.ids[1], "durationSeconds": 1})
        self.assertEqual(self.db.save_project_window_assignments([mixed])["saved"], 0)
        self.assertEqual(self.db.save_project_window_assignments([self.decision(self.ids[0], decisionUnit="future")])["saved"], 0)

    def test_range_reads_retain_fractional_seconds_at_the_boundary(self):
        self.db.insert_segment({"started_at": "2026-04-06T09:02:59.500Z", "ended_at": "2026-04-06T09:02:59.500Z",
                                "duration_seconds": 1, "app_name": "Point"})
        sid = next(row["id"] for row in self.db.fetch_timeline("2026-04-06") if row["appName"] == "Point")
        value = self.decision(sid, windowStartedAt="2026-04-06T09:02:59.500Z", windowEndedAt="2026-04-06T09:03:00.500Z",
                              durationSeconds=1, segmentOverlaps=[{"segmentId": sid, "durationSeconds": 1}])
        self.db.save_project_window_assignments([value])
        self.assertEqual(len(self.db.get_project_window_assignments("2026-04-06T09:03:00Z", "2026-04-06T09:03:01Z")), 1)
        self.assertEqual(self.db.get_project_window_assignments(None, "2026-04-06T09:02:59.500Z"), [])

    def test_opening_an_old_database_preserves_legacy_decisions(self):
        legacy = self.decision(self.ids[0])
        legacy.pop("decisionUnit")
        self.db.save_project_window_assignments([legacy])
        with self.db.connect() as conn:
            conn.execute("DROP TABLE project_segment_assignments")
        self.db.close()
        self.db = TrackerDatabase(self.path)
        self.assertEqual(len(self.db.get_project_window_assignments()), 1)
        self.assertNotIn("decisionUnit", self.db.get_project_window_assignments()[0])
        self.assertEqual(self.db.save_project_window_assignments([self.decision(self.ids[1])])["saved"], 1)


if __name__ == "__main__":
    unittest.main()
