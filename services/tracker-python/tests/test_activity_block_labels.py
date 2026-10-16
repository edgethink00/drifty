from __future__ import annotations

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

    def ai(self, **extra) -> dict:
        return {
            **self.block(),
            "status": "ready",
            "title": "Checkout error review",
            "description": "Read the retry handler.",
            "evidenceFingerprint": "fp-1",
            "language": "en",
            "provider": "openai",
            "model": "m",
            "promptVersion": "activity-block-label-v1",
            **extra,
        }

    def labels(self) -> list[dict]:
        return self.db.get_activity_block_labels("2026-10-14T00:00:00Z", "2026-10-15T00:00:00Z")

    def test_round_trips_ai_label_with_its_source_records(self) -> None:
        self.assertEqual(self.db.save_activity_block_labels([self.ai()]), {"saved": 1, "skipped": 0})
        [label] = self.labels()
        self.assertEqual(label["source"], "ai")
        self.assertEqual(label["title"], "Checkout error review")
        self.assertEqual(label["segmentIds"], self.ids)
        self.assertEqual(label["evidenceFingerprint"], "fp-1")
        self.assertEqual(self.db.get_activity_block_labels("2026-10-14T02:00:00Z", "2026-10-15T00:00:00Z"), [])

    def test_regeneration_replaces_text_and_links_without_dropping_the_row(self) -> None:
        self.db.save_activity_block_labels([self.ai()])
        self.db.save_activity_block_labels([self.ai(title="Retry handler review", evidenceFingerprint="fp-2") | {"segmentIds": self.ids[:2]}])
        [label] = self.labels()
        self.assertEqual((label["title"], label["evidenceFingerprint"], label["segmentIds"]), ("Retry handler review", "fp-2", self.ids[:2]))

    def test_abstention_is_cached_without_text(self) -> None:
        self.db.save_activity_block_labels([self.ai(status="abstain")])
        [label] = self.labels()
        self.assertEqual((label["status"], label["title"], label["description"]), ("abstain", "", ""))

    def test_late_answer_for_deleted_record_is_not_stored(self) -> None:
        self.db.delete_activity_segments([self.ids[0]])
        self.assertEqual(self.db.save_activity_block_labels([self.ai()]), {"saved": 0, "skipped": 1})
        self.assertEqual(self.labels(), [])

    def test_deleting_a_record_removes_ai_text_but_user_label_follows_remaining_records(self) -> None:
        self.db.save_activity_block_labels([self.ai()])
        self.db.save_activity_block_user_label(self.block(title="Client A checkout", description="Invoice notes"))
        self.db.delete_activity_segments([self.ids[0]])
        [user] = self.labels()
        self.assertEqual(user["source"], "user")
        self.assertEqual(user["segmentIds"], self.ids[1:])
        self.db.delete_activity_segments(self.ids[1:])
        self.assertEqual(self.labels(), [])

    def test_regeneration_never_overwrites_user_label(self) -> None:
        self.db.save_activity_block_user_label(self.block(title="Client A checkout"))
        self.db.save_activity_block_labels([self.ai(title="Something else")])
        by_source = {label["source"]: label for label in self.labels()}
        self.assertEqual(by_source["user"]["title"], "Client A checkout")
        self.assertEqual(by_source["ai"]["title"], "Something else")

    def test_empty_user_title_hides_the_block_label(self) -> None:
        saved = self.db.save_activity_block_user_label(self.block(title="  ", description="ignored"))
        self.assertEqual((saved["status"], saved["title"], saved["description"]), ("hidden", "", ""))

    def test_editing_a_carried_label_replaces_the_previous_grouping(self) -> None:
        self.db.save_activity_block_user_label(self.block(key="2026-10-14:old", title="Old name"))
        self.db.save_activity_block_user_label(self.block(key="2026-10-14:new", ids=self.ids[:2], title="New name"),
                                               previous_block_key="2026-10-14:old")
        self.assertEqual([(label["blockKey"], label["title"]) for label in self.labels()], [("2026-10-14:new", "New name")])

    def test_reset_removes_only_the_user_label(self) -> None:
        self.db.save_activity_block_labels([self.ai()])
        self.db.save_activity_block_user_label(self.block(title="Mine"))
        self.assertEqual(self.db.delete_activity_block_user_label("2026-10-14:block"), {"deleted": 1})
        self.assertEqual([label["source"] for label in self.labels()], ["ai"])

    def test_user_label_requires_existing_records(self) -> None:
        with self.assertRaises(ActivityBlockLabelError):
            self.db.save_activity_block_user_label(self.block(ids=["999999"], title="Ghost"))
        self.assertEqual(self.labels(), [])

    def test_deleting_ai_results_keeps_user_labels_and_activity_deletion_removes_both(self) -> None:
        self.db.save_activity_block_labels([self.ai()])
        self.db.save_activity_block_user_label(self.block(title="Mine"))
        self.db.delete_history_range("2026-10-14", "2026-10-14", {"aiClassifications": True}, record_tombstone=False)
        self.assertEqual([label["source"] for label in self.labels()], ["user"])
        self.db.delete_history_range("2026-10-14", "2026-10-14", {"activity": True}, record_tombstone=False)
        self.assertEqual(self.labels(), [])

    def test_schema_is_idempotent_across_reopen(self) -> None:
        self.db.save_activity_block_labels([self.ai()])
        self.db.close()
        reopened = TrackerDatabase(self.path, perform_maintenance=False)
        self.addCleanup(reopened.close)
        self.assertEqual(len(reopened.get_activity_block_labels()), 1)

    def test_rejects_malformed_rows(self) -> None:
        bad = [
            self.ai(blockKey=""),
            self.ai(logicalDay="yesterday"),
            self.ai(blockEndedAt="2026-10-14T00:00:00Z"),
            self.ai(status="maybe"),
            self.ai(title=""),
            self.ai(segmentIds=["not-a-number"]),
            "not a dict",
        ]
        self.assertEqual(self.db.save_activity_block_labels(bad), {"saved": 0, "skipped": len(bad)})


if __name__ == "__main__":
    unittest.main()

