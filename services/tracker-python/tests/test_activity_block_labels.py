from __future__ import annotations

import sqlite3
import tempfile
import unittest
from pathlib import Path

from app.storage.activity_block_labels import ActivityBlockLabelError
from app.storage.db import TrackerDatabase


class ActivityBlockLabelStorageTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "tracker.sqlite3"
        self.db = TrackerDatabase(self.path, perform_maintenance=False)
        self.addCleanup(self.db.close)
        for minute in range(3):
            self.db.insert_segment({
                "started_at": f"2026-10-14T01:{minute * 10:02d}:00Z",
                "ended_at": f"2026-10-14T01:{minute * 10 + 9:02d}:00Z",
                "duration_seconds": 540,
                "app_name": "Code",
                "window_title": f"checkout-{minute}.ts",
            })
        self.ids = sorted((row["id"] for row in self.db.fetch_timeline("2026-10-14")), key=int)

    def block(self, key: str = "2026-10-14:block", ids: list[str] | None = None, **extra) -> dict:
        return {
            "blockKey": key,
            "logicalDay": "2026-10-14",
            "blockStartedAt": "2026-10-14T01:00:00Z",
            "blockEndedAt": "2026-10-14T01:30:00Z",
            "segmentIds": self.ids if ids is None else ids,
            **extra,
        }

    def labels(self) -> list[dict]:
        return self.db.get_activity_block_labels("2026-10-14T00:00:00Z", "2026-10-15T00:00:00Z")

    def test_empty_user_title_hides_the_block_label(self) -> None:
        saved = self.db.save_activity_block_user_label(self.block(title="  ", description="ignored"))
        self.assertEqual((saved["status"], saved["title"], saved["description"]), ("hidden", "", ""))
        [label] = self.labels()
        self.assertEqual((label["source"], label["segmentIds"]), ("user", self.ids))
        self.assertEqual(self.db.get_activity_block_labels("2026-10-14T02:00:00Z", "2026-10-15T00:00:00Z"), [])

    def test_user_label_follows_remaining_records_and_goes_with_the_last(self) -> None:
        self.db.save_activity_block_user_label(self.block(title="Client A checkout", description="Invoice notes"))
        self.db.delete_activity_segments([self.ids[0]])
        [user] = self.labels()
        self.assertEqual(user["segmentIds"], self.ids[1:])
        self.db.delete_activity_segments(self.ids[1:])
        self.assertEqual(self.labels(), [])

    def test_editing_a_carried_label_replaces_the_previous_grouping(self) -> None:
        self.db.save_activity_block_user_label(self.block(key="2026-10-14:old", title="Old name"))
        self.db.save_activity_block_user_label(self.block(key="2026-10-14:new", ids=self.ids[:2], title="New name"),
                                               previous_block_key="2026-10-14:old")
        self.assertEqual([(label["blockKey"], label["title"]) for label in self.labels()], [("2026-10-14:new", "New name")])

    def test_reset_removes_the_user_label(self) -> None:
        self.db.save_activity_block_user_label(self.block(title="Mine"))
        self.assertEqual(self.db.delete_activity_block_user_label("2026-10-14:block"), {"deleted": 1})
        self.assertEqual(self.labels(), [])

    def test_user_label_requires_existing_records(self) -> None:
        with self.assertRaises(ActivityBlockLabelError):
            self.db.save_activity_block_user_label(self.block(ids=["999999"], title="Ghost"))
        self.assertEqual(self.labels(), [])

    def test_deleting_ai_results_keeps_user_labels_and_activity_deletion_removes_them(self) -> None:
        self.db.save_activity_block_user_label(self.block(title=""))
        self.db.delete_history_range("2026-10-14", "2026-10-14", {"aiClassifications": True}, record_tombstone=False)
        self.assertEqual([label["status"] for label in self.labels()], ["hidden"])
        self.db.delete_history_range("2026-10-14", "2026-10-14", {"activity": True}, record_tombstone=False)
        self.assertEqual(self.labels(), [])

    def test_ai_rows_from_unreleased_builds_are_removed_on_open(self) -> None:
        self.db.save_activity_block_user_label(self.block(title=""))
        self.db.close()
        conn = sqlite3.connect(self.path)
        conn.execute(
            "INSERT INTO activity_block_labels (block_key, source, logical_day, block_started_at, block_ended_at,"
            " status, title, created_at, updated_at) VALUES ('2026-10-14:w:old:c1', 'ai', '2026-10-14',"
            " '2026-10-14T01:00:00+00:00', '2026-10-14T01:30:00+00:00', 'ready', 'Old card', 'x', 'x')"
        )
        conn.commit()
        conn.close()
        reopened = TrackerDatabase(self.path, perform_maintenance=False)
        self.addCleanup(reopened.close)
        self.assertEqual([label["source"] for label in reopened.get_activity_block_labels()], ["user"])


if __name__ == "__main__":
    unittest.main()
