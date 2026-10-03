from __future__ import annotations

from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile
import unittest

from app.storage.db import BROWSER_HISTORY_IMPORT_SOURCE, TrackerDatabase
from app.storage.live_tail import fetch_live_tail
from app.tracker.capture_contract import Snapshot


class LiveTailTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.db = TrackerDatabase(Path(self.temp.name) / "tracker.sqlite3", perform_maintenance=False)
        self.addCleanup(self.temp.cleanup)
        self.addCleanup(self.db.close)

    def capture(self, name: str, at: str) -> None:
        self.db.record_snapshot(
            Snapshot(observed_at=at, app_name=name, bundle_id="qa." + name,
                     window_title="Synthetic " + name, source="qa"),
            sample_seconds=5,
        )

    def raw_rows(self) -> list[tuple]:
        with closing(sqlite3.connect(self.db.db_path)) as conn:
            return conn.execute("SELECT id, ended_at, duration_seconds FROM activity_segments ORDER BY id").fetchall()

    def tail(self, after_id: str | None, after_end: str | None, limit: int = 8,
             start: str | None = None, end: str | None = None) -> list[dict]:
        return fetch_live_tail(self.db, start, end, after_id, after_end, limit)

    def test_backdated_new_rows_page_in_insertion_order_without_skipping_ids(self) -> None:
        self.capture("Before", "2026-10-03T12:00:00+00:00")
        self.capture("First", "2026-10-03T11:40:00+00:00")
        self.capture("Second", "2026-10-03T11:10:00+00:00")
        self.capture("Third", "2026-10-03T11:30:00+00:00")
        cursor = "1"
        observed = []
        for _ in range(3):
            page = self.tail(cursor, "2026-10-03T12:00:00+00:00", 1)
            self.assertEqual(len(page), 1)
            observed.append(page[0]["id"])
            cursor = page[0]["id"]
        self.assertEqual(observed, [str(row[0]) for row in self.raw_rows()][1:])

    def test_latest_capture_extension_is_visible_below_the_wall_time_cursor(self) -> None:
        self.capture("Before", "2026-10-03T12:00:00+00:00")
        self.capture("After", "2026-10-03T11:30:00+00:00")
        self.capture("After", "2026-10-03T11:30:05+00:00")
        raw = self.raw_rows()
        self.assertEqual(len(raw), 2)
        page = self.tail("2", "2026-10-03T12:00:00+00:00")
        self.assertEqual([row["id"] for row in page], ["2"])
        self.assertEqual(page[0]["endedAt"], raw[1][1])
        self.assertEqual(page[0]["durationSeconds"], raw[1][2])

    def test_bounded_backlog_does_not_starve_behind_an_old_future_interval(self) -> None:
        self.capture("Before", "2026-10-03T12:00:00+00:00")
        for i in range(1, 13):
            self.capture("After" + str(i), "2026-10-03T11:30:" + str(i).zfill(2) + "+00:00")
        cursor = "1"
        seen = {"1"}
        for _ in range(2):
            page = self.tail(cursor, "2026-10-03T12:00:00+00:00", 8)
            self.assertLessEqual(len(page), 8)
            seen.update(row["id"] for row in page)
            cursor = str(max(int(row_id) for row_id in seen))
        self.assertEqual(seen, {str(row[0]) for row in self.raw_rows()})
        self.capture("After12", "2026-10-03T11:31:00+00:00")
        page = self.tail(cursor, "2026-10-03T12:00:00+00:00")
        self.assertEqual([row["id"] for row in page], ["13"])
        self.assertEqual(page[0]["durationSeconds"], 10)

    def test_live_capture_replay_ignores_later_import_and_foreign_device_rows(self) -> None:
        self.capture("Before", "2026-10-03T12:00:00+00:00")
        self.capture("After", "2026-10-03T11:30:00+00:00")
        with self.db.connect() as conn:
            conn.execute("""INSERT INTO activity_segments(started_at, ended_at, duration_seconds,
                app_name, platform, source) VALUES (?, ?, 5, 'Imported', 'macos', ?)""",
                ("2026-10-03T08:00:00+00:00", "2026-10-03T08:00:05+00:00", BROWSER_HISTORY_IMPORT_SOURCE))
            conn.execute("""INSERT INTO activity_segments(started_at, ended_at, duration_seconds,
                app_name, platform, source, origin_device_id) VALUES (?, ?, 5, 'Other device', 'macos', 'qa', 'synthetic-peer')""",
                ("2026-10-03T08:10:00+00:00", "2026-10-03T08:10:05+00:00"))
        self.capture("After", "2026-10-03T11:30:05+00:00")
        page = self.tail("4", "2026-10-03T12:00:00+00:00")
        self.assertEqual([row["id"] for row in page], ["2"])
        self.assertEqual(page[0]["durationSeconds"], 10)

    def test_capture_replay_respects_the_selected_range(self) -> None:
        self.capture("Current", "2026-10-03T11:30:00+00:00")
        self.assertEqual(self.tail("1", "2026-10-03T12:00:00+00:00",
                                  start="2026-10-02T00:00:00+00:00", end="2026-10-03T00:00:00+00:00"), [])

    def test_unchanged_normal_capture_is_not_replayed(self) -> None:
        self.capture("Current", "2026-10-03T12:00:00+00:00")
        self.assertEqual(self.tail("1", "2026-10-03T12:00:00+00:00"), [])

    def test_normal_capture_extension_and_time_only_cursor_still_work(self) -> None:
        self.capture("Current", "2026-10-03T12:00:00+00:00")
        self.capture("Current", "2026-10-03T12:00:05+00:00")
        for cursor in ("1", None):
            page = self.tail(cursor, "2026-10-03T12:00:00+00:00")
            self.assertEqual([row["id"] for row in page], ["1"])
            self.assertEqual(page[0]["durationSeconds"], 10)

    def test_initial_tail_keeps_chronological_order_and_the_limit(self) -> None:
        self.capture("Latest", "2026-10-03T12:00:00+00:00")
        self.capture("Earliest", "2026-10-03T10:00:00+00:00")
        self.capture("Middle", "2026-10-03T11:00:00+00:00")
        page = self.tail(None, None, 2)
        self.assertEqual([row["id"] for row in page], ["3", "1"])


if __name__ == "__main__":
    unittest.main()
