from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.storage.db import TrackerDatabase


class ActivityTimelineCardStorageTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "tracker.sqlite3"
        self.db = TrackerDatabase(self.path, perform_maintenance=False)
        self.addCleanup(self.db.close)
        for minute in range(4):
            self.db.insert_segment({
                "started_at": f"2026-10-14T01:{minute * 10:02d}:00Z",
                "ended_at": f"2026-10-14T01:{minute * 10 + 9:02d}:00Z",
                "duration_seconds": 540,
                "app_name": "Code",
                "window_title": f"checkout-{minute}.ts",
            })
        self.ids = sorted((row["id"] for row in self.db.fetch_timeline("2026-10-14")), key=int)

    def window(self, key: str = "2026-10-14:w:a", ids: list[str] | None = None, language: str = "en", cards=None, **extra) -> dict:
        ids = self.ids if ids is None else ids
        return {
            "windowKey": key,
            "language": language,
            "logicalDay": "2026-10-14",
            "startedAt": "2026-10-14T01:00:00Z",
            "endedAt": "2026-10-14T01:39:00Z",
            "segmentIds": ids,
            "promptVersion": "activity-timeline-card-v1",
            "model": "m",
            "provider": "openai",
            "cards": [
                {"startedAt": "2026-10-14T01:00:00Z", "endedAt": "2026-10-14T01:19:00Z", "segmentIds": ids[:2],
                 "status": "ready", "variant": "strict", "title": "Checkout retry handler", "description": "Read the handler."},
                {"startedAt": "2026-10-14T01:20:00Z", "endedAt": "2026-10-14T01:39:00Z", "segmentIds": ids[2:],
                 "status": "limited", "variant": "partial", "title": "Retry tests", "description": ""},
            ] if cards is None else cards,
            **extra,
        }

    def windows(self, start: str = "2026-10-14T00:00:00Z") -> list[dict]:
        return self.db.get_activity_timeline_cards(start, "2026-10-15T00:00:00Z")

    def test_round_trips_a_window_with_its_cards_and_their_records(self) -> None:
        self.assertEqual(self.db.save_activity_timeline_window(self.window()), {"saved": 1, "replaced": 0, "cards": 2})
        [window] = self.windows()
        self.assertEqual((window["windowKey"], window["language"], window["promptVersion"]), ("2026-10-14:w:a", "en", "activity-timeline-card-v1"))
        self.assertEqual([(card["position"], card["title"], card["variant"]) for card in window["cards"]],
                         [(0, "Checkout retry handler", "strict"), (1, "Retry tests", "partial")])
        self.assertEqual(window["cards"][0]["segmentIds"], self.ids[:2])
        self.assertEqual(self.windows("2026-10-14T02:00:00Z"), [])

    def test_a_window_without_cards_is_kept_so_it_is_not_asked_again(self) -> None:
        self.assertEqual(self.db.save_activity_timeline_window(self.window(cards=[]))["saved"], 1)
        [window] = self.windows()
        self.assertEqual(window["cards"], [])

    def test_languages_are_kept_apart(self) -> None:
        self.db.save_activity_timeline_window(self.window(language="en"))
        self.db.save_activity_timeline_window(self.window(language="ko"))
        self.assertEqual(sorted(window["language"] for window in self.windows()), ["en", "ko"])

    def test_a_newer_window_replaces_the_ones_it_overlaps_in_its_language(self) -> None:
        self.db.save_activity_timeline_window(self.window(key="2026-10-14:w:a"))
        self.db.save_activity_timeline_window(self.window(key="2026-10-14:w:a", language="ko"))
        result = self.db.save_activity_timeline_window(self.window(key="2026-10-14:w:b", ids=self.ids[1:], cards=[]))
        self.assertEqual(result["replaced"], 1)
        self.assertEqual(sorted((window["windowKey"], window["language"]) for window in self.windows()),
                         [("2026-10-14:w:a", "ko"), ("2026-10-14:w:b", "en")])

    def test_deleting_any_record_removes_the_whole_window(self) -> None:
        self.db.save_activity_timeline_window(self.window())
        # The record belongs to the second card only; the first card goes too.
        self.db.delete_activity_segments([self.ids[3]])
        self.assertEqual(self.windows(), [])

    def test_late_answer_for_a_deleted_record_is_not_stored(self) -> None:
        self.db.delete_activity_segments([self.ids[0]])
        self.assertEqual(self.db.save_activity_timeline_window(self.window())["saved"], 0)
        self.assertEqual(self.windows(), [])

    def test_deleting_ai_results_removes_windows_and_activity_deletion_does_too(self) -> None:
        self.db.save_activity_timeline_window(self.window())
        self.db.delete_history_range("2026-10-14", "2026-10-14", {"aiClassifications": True}, record_tombstone=False)
        self.assertEqual(self.windows(), [])
        self.db.save_activity_timeline_window(self.window())
        self.db.delete_history_range("2026-10-14", "2026-10-14", {"activity": True}, record_tombstone=False)
        self.assertEqual(self.windows(), [])

    def test_schema_is_idempotent_across_reopen(self) -> None:
        self.db.save_activity_timeline_window(self.window())
        self.db.close()
        reopened = TrackerDatabase(self.path, perform_maintenance=False)
        self.addCleanup(reopened.close)
        self.assertEqual(len(reopened.get_activity_timeline_cards()), 1)

    def test_skips_malformed_windows_and_drops_malformed_cards(self) -> None:
        bad = [
            self.window(windowKey=""),
            self.window(language=""),
            self.window(logicalDay="yesterday"),
            self.window(endedAt="2026-10-14T00:00:00Z"),
            self.window(promptVersion=""),
            self.window(segmentIds=["not-a-number"]),
            self.window(cards="not a list"),
            "not a dict",
        ]
        for item in bad:
            self.assertEqual(self.db.save_activity_timeline_window(item)["saved"], 0)
        good, *_ = self.window()["cards"]
        cards = [
            good,
            {**good, "title": ""},
            {**good, "status": "abstain"},
            {**good, "variant": "other"},
            {**good, "endedAt": "2026-10-14T00:00:00Z"},
            # Records outside the window are not linked; a card left with none is dropped.
            {**good, "segmentIds": ["999999"]},
        ]
        self.assertEqual(self.db.save_activity_timeline_window(self.window(cards=cards))["cards"], 1)


if __name__ == "__main__":
    unittest.main()
