"""Real SQLite two-connection races at the manual-assignment read/write boundary."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.storage.db import TrackerDatabase


class AfterReadConnection:
    def __init__(self, connection, table, after_read):
        self.connection = connection
        self.table = table
        self.after_read = after_read
        self.intercepted = False

    def execute(self, sql, *args):
        cursor = self.connection.execute(sql, *args)
        if not self.intercepted and "SELECT source FROM " + self.table in sql:
            self.intercepted = True
            self.after_read()
        return cursor

    def __enter__(self):
        self.connection.__enter__()
        return self

    def __exit__(self, *args):
        return self.connection.__exit__(*args)


class ProjectManualRaceTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        path = Path(self.directory.name) / "tracker.sqlite3"
        self.ai = TrackerDatabase(path)
        self.user = TrackerDatabase(path, perform_maintenance=False)
        self.addCleanup(self.ai.close)
        self.addCleanup(self.user.close)
        self.ai.insert_segment({"started_at": "2026-04-06T09:00:00Z", "ended_at": "2026-04-06T09:03:00Z", "duration_seconds": 180, "app_name": "Code"})
        self.sid = self.ai.fetch_timeline("2026-04-06")[0]["id"]
        self.project = self.ai.save_project({"name": "Manual"})["id"]
        self.other = self.ai.save_project({"name": "AI"})["id"]
        with self.ai.connect() as conn:
            for name in ["manual-team", "ai-team"]:
                conn.execute("INSERT INTO team_projects(id, organization_id, name, description, color, created_at, updated_at) VALUES (?, 'org', ?, '', '#000', '2026-04-06', '2026-04-06')", (name, name))

    def lane(self, team):
        if team:
            return ("team_project_assignments", self.ai.save_team_project_assignments, self.user.save_team_project_assignments, self.user.get_team_project_assignments, "teamProjectId", "manual-team", "ai-team")
        return ("activity_project_assignments", self.ai.save_project_assignments, self.user.save_project_assignments, self.user.get_project_assignments, "projectId", self.project, self.other)

    def race(self, team):
        table, save_ai, save_user, read, key, manual_project, ai_project = self.lane(team)
        for existing in [False, True]:
            with self.subTest(existing_ai=existing):
                with self.ai.connect() as conn:
                    conn.execute("DELETE FROM " + table)
                if existing:
                    save_ai([{"segmentId": self.sid, key: ai_project, "source": "ai"}])
                committed = []
                def commit_manual():
                    committed.append(save_user([{"segmentId": self.sid, key: manual_project, "source": "manual"}]))
                    self.assertEqual(read()[0][key], manual_project)
                connection = AfterReadConnection(self.ai.connect(), table, commit_manual)
                with patch.object(self.ai, "connect", return_value=connection):
                    result = save_ai([{"segmentId": self.sid, key: ai_project, "source": "ai"}])
                self.assertEqual(committed, [{"saved": 1, "skippedManual": 0}])
                self.assertEqual(read()[0]["source"], "manual")
                self.assertEqual(read()[0][key], manual_project)
                self.assertEqual(result, {"saved": 0, "skippedManual": 1})

    def test_personal_manual_commit_between_ai_read_and_write(self):
        self.race(False)

    def test_team_manual_commit_between_ai_read_and_write(self):
        self.race(True)

    def test_sequential_manual_guard_and_explicit_manual_override(self):
        for team in [False, True]:
            with self.subTest(team=team):
                _, save_ai, save_user, read, key, manual_project, ai_project = self.lane(team)
                self.assertEqual(save_user([{"segmentId": self.sid, key: manual_project, "source": "manual"}])["saved"], 1)
                self.assertEqual(save_ai([{"segmentId": self.sid, key: ai_project, "source": "ai"}]), {"saved": 0, "skippedManual": 1})
                self.assertEqual(save_user([{"segmentId": self.sid, key: None, "source": "manual"}])["saved"], 1)
                self.assertIsNone(read()[0][key])

    def test_ai_updates_ai_and_missing_references_are_not_manual_skips(self):
        for team in [False, True]:
            with self.subTest(team=team):
                _, save_ai, _, read, key, _, ai_project = self.lane(team)
                self.assertEqual(save_ai([{"segmentId": self.sid, key: None, "source": "ai"}])["saved"], 1)
                self.assertEqual(save_ai([{"segmentId": self.sid, key: ai_project, "source": "ai"}])["saved"], 1)
                self.assertEqual(read()[0][key], ai_project)
                self.assertEqual(save_ai([{"segmentId": 999999, key: ai_project}, {"segmentId": self.sid, key: "deleted-project"}]), {"saved": 0, "skippedManual": 0})


if __name__ == "__main__":
    unittest.main()
