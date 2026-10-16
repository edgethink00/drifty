"""What device sync of projects and app & site rules reads from and writes to the tracker."""
import tempfile
import unittest
from pathlib import Path

from app.storage.db import TrackerDatabase


class DefinitionSyncStorageTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.db = TrackerDatabase(Path(directory.name) / "tracker.sqlite3")
        self.addCleanup(self.db.close)

    def rule(self, **overrides):
        return {"targetKind": "site", "targetValue": "www.Example.com", "category": "learning", "productivity": "focus", **overrides}

    def test_one_rule_has_one_sync_key_however_its_target_was_spelled(self):
        self.db.save_classification_rule(self.rule())
        first = self.db.get_classification_rules()
        self.db.save_classification_rule(self.rule(targetValue="https://example.com/path", productivity="neutral"))
        second = self.db.get_classification_rules()

        self.assertEqual(len(second), 1)
        self.assertRegex(first[0]["syncKey"], r"^[0-9a-f]{64}$")
        self.assertEqual(first[0]["syncKey"], second[0]["syncKey"])
        self.assertEqual(second[0]["productivity"], "neutral")

    def test_a_narrower_rule_has_its_own_sync_key(self):
        self.db.save_classification_rule(self.rule())
        self.db.save_classification_rule(self.rule(matchScope="detail", detailKind="siteTitle", detailValue="Docs"))
        self.db.save_classification_rule(self.rule(targetKind="app", targetValue="Example"))

        keys = {rule["syncKey"] for rule in self.db.get_classification_rules()}
        self.assertEqual(len(keys), 3)

    def test_a_project_from_another_device_keeps_its_creation_time(self):
        synced = self.db.save_project({"id": "p-synced", "name": "Synced", "createdAt": "2026-01-02T03:04:05Z"})
        renamed = self.db.save_project({"id": "p-synced", "name": "Renamed", "createdAt": "2026-09-09T00:00:00Z"})
        unreadable = self.db.save_project({"id": "p-local", "name": "Local", "createdAt": "yesterday"})

        self.assertEqual(synced["createdAt"], "2026-01-02T03:04:05+00:00")
        self.assertEqual(renamed["createdAt"], synced["createdAt"])
        self.assertNotEqual(unreadable["createdAt"], "yesterday")
        self.assertEqual([project["id"] for project in self.db.get_projects()], ["p-synced", "p-local"])


if __name__ == "__main__":
    unittest.main()
