from __future__ import annotations

import io
import json
import os
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app import main as tracker_main
from app import tracking_pause_gate
from app.storage.db import TrackerDatabase
from app.tracker.macos_workspace import Snapshot
from app.tracker.power_state import PowerStateSample
from tests.support_cleanup import temp_dir_closing_databases

STARTED = datetime(2026, 11, 6, 9, tzinfo=timezone.utc)


def at(seconds: float) -> str:
    return (STARTED + timedelta(seconds=seconds)).isoformat()


def save_pause(db_path: Path, paused_at_seconds: int) -> None:
    pause = {"version": 1, "kind": "indefinite", "pausedAtUnixSeconds": paused_at_seconds}
    tracking_pause_gate.pause_file_path(db_path).write_text(json.dumps(pause))


def insert_segment(db: TrackerDatabase, started: float, ended: float, duration: int, *,
                   app_name: str = "Synthetic Editor", source: str = "nsworkspace",
                   origin_device_id: str | None = None) -> int:
    with db.connect() as conn:
        cursor = conn.execute(
            """
            INSERT INTO activity_segments (
                started_at, ended_at, duration_seconds, app_name, platform, source, origin_device_id
            ) VALUES (?, ?, ?, ?, 'macos', ?, ?)
            """,
            (at(started), at(ended), duration, app_name, source, origin_device_id),
        )
        return int(cursor.lastrowid)


def segment_rows(db: TrackerDatabase) -> list[tuple]:
    rows = db.connect().execute(
        "SELECT app_name, started_at, ended_at, duration_seconds FROM activity_segments ORDER BY id"
    ).fetchall()
    return [tuple(row) for row in rows]


class PauseFileTests(unittest.TestCase):
    def test_reads_a_saved_pause_and_its_start(self) -> None:
        with TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "tracker.sqlite3"
            self.assertFalse(tracking_pause_gate.pause_requested(db_path))
            self.assertIsNone(tracking_pause_gate.paused_at(db_path))
            started = int(STARTED.timestamp())
            save_pause(db_path, started)
            self.assertTrue(tracking_pause_gate.pause_requested(db_path))
            self.assertEqual(tracking_pause_gate.paused_at(db_path), STARTED)
            timed = {"version": 1, "pausedAtUnixSeconds": started, "resumesAtUnixSeconds": started + 900}
            tracking_pause_gate.pause_file_path(db_path).write_text(json.dumps(timed))
            self.assertEqual(tracking_pause_gate.paused_at(db_path), STARTED)

    def test_an_unreadable_pause_still_pauses_capture_without_a_cutoff(self) -> None:
        with TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "tracker.sqlite3"
            tracking_pause_gate.pause_file_path(db_path).write_text("{not json")
            self.assertTrue(tracking_pause_gate.pause_requested(db_path))
            self.assertIsNone(tracking_pause_gate.paused_at(db_path))
            with patch.object(tracking_pause_gate.os, "stat", side_effect=PermissionError("denied")):
                self.assertTrue(tracking_pause_gate.pause_requested(db_path))

    def test_accepts_only_positive_whole_seconds_as_a_cutoff(self) -> None:
        for value in (True, 0, -5, 1.5, "1700000000", None):
            with self.subTest(value=value):
                self.assertIsNone(tracking_pause_gate.unix_seconds_cutoff(value))
        self.assertEqual(tracking_pause_gate.unix_seconds_cutoff(int(STARTED.timestamp())), STARTED)

    def test_log_appends_outcomes_and_rolls_over_when_large(self) -> None:
        with TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "tracker.sqlite3"
            with patch.object(tracking_pause_gate, "LOG_MAX_BYTES", 80):
                tracking_pause_gate.record(db_path, "capture_discarded", trimmed=1, deleted=2)
                tracking_pause_gate.record(db_path, "capture_stopped_for_pause", cutoff="read")
                tracking_pause_gate.record(db_path, "capture_stopped_for_pause", cutoff="read")
            log_path = Path(tmp) / tracking_pause_gate.LOG_FILE_NAME
            rolled = Path(tmp) / (tracking_pause_gate.LOG_FILE_NAME + ".1")
            self.assertIn("tracker capture_discarded trimmed=1 deleted=2", rolled.read_text())
            self.assertIn("tracker capture_stopped_for_pause cutoff=read", log_path.read_text())

    def test_log_never_raises(self) -> None:
        tracking_pause_gate.record(Path("/nonexistent-dir/for/drifty/tracker.sqlite3"), "capture_discarded")


class DiscardAfterPauseTests(unittest.TestCase):
    def test_keeps_activity_before_the_pause_and_removes_only_local_capture_after_it(self) -> None:
        with temp_dir_closing_databases() as tmp:
            db = TrackerDatabase(Path(tmp) / "tracker.sqlite3", perform_maintenance=False)
            insert_segment(db, 0, 20, 20, app_name="Before")
            insert_segment(db, 25, 40, 20, app_name="Across")
            insert_segment(db, 48, 48, 5, app_name="Last sample")
            after = insert_segment(db, 52, 70, 18, app_name="After")
            insert_segment(db, 55, 60, 5, app_name="Other device", origin_device_id="device-b")
            insert_segment(db, 55, 60, 5, app_name="Imported", source="browser-history-import")
            after_uid = db.connect().execute(
                "SELECT segment_uid FROM activity_segments WHERE id = ?", (after,)
            ).fetchone()[0]

            result = db.discard_live_capture_after(at(50))

            # "Across" runs to 45s (25s + 20s credit), before the pause at 50s.
            self.assertEqual(result, {"trimmed": 1, "deleted": 1})
            self.assertEqual(segment_rows(db), [
                ("Before", at(0), at(20), 20),
                ("Across", at(25), at(40), 20),
                ("Last sample", at(48), at(48), 2),
                ("Other device", at(55), at(60), 5),
                ("Imported", at(55), at(60), 5),
            ])
            tombstones = db.connect().execute("SELECT kind, segment_uids_json FROM sync_deletions").fetchall()
            self.assertEqual([(row[0], json.loads(row[1])) for row in tombstones], [("uids", [after_uid])])
            # Repeating the cleanup is harmless: the daemon and Stop both run it.
            self.assertEqual(db.discard_live_capture_after(at(50)), {"trimmed": 0, "deleted": 0})

    def test_ends_a_segment_running_across_the_pause_at_the_pause(self) -> None:
        with temp_dir_closing_databases() as tmp:
            db = TrackerDatabase(Path(tmp) / "tracker.sqlite3", perform_maintenance=False)
            insert_segment(db, 30, 90, 60, app_name="Across")
            insert_segment(db, 50, 50, 5, app_name="At the pause")
            self.assertEqual(db.discard_live_capture_after(at(50)), {"trimmed": 1, "deleted": 1})
            self.assertEqual(segment_rows(db), [("Across", at(30), at(50), 20)])


class DaemonPauseGateTests(unittest.TestCase):
    def test_daemon_stops_saving_and_exits_once_a_pause_is_saved(self) -> None:
        sample_seconds = tracker_main.SAMPLE_SECONDS
        elapsed = 0
        snapshots = []

        def snapshot(**_kwargs):
            snapshots.append(elapsed)
            return Snapshot(
                observed_at=at(elapsed),
                app_name="Synthetic Editor",
                bundle_id="test.synthetic.editor",
                window_title="Same document",
                source="accessibility",
            )

        with temp_dir_closing_databases() as tmp:
            path = Path(tmp) / "tracker.sqlite3"
            db = TrackerDatabase(path, perform_maintenance=False)

            def wait(_seconds):
                nonlocal elapsed
                elapsed += sample_seconds
                if elapsed == 2 * sample_seconds:
                    # The app saves the pause between samples; its Stop has not arrived.
                    save_pause(path, int(STARTED.timestamp()) + 7)
                if elapsed > 4 * sample_seconds:
                    raise AssertionError("the daemon kept running after the pause was saved")

            with patch.object(tracker_main.sys, "platform", "darwin"), patch.object(
                tracker_main, "_frozen_macos", return_value=False
            ), patch.object(tracker_main, "DB_PATH", path), patch.object(
                tracker_main, "_DATABASE_CACHE", db
            ), patch.object(
                tracker_main, "current_power_state", return_value=PowerStateSample(STARTED, True, "ok")
            ), patch.object(tracker_main, "seconds_since_last_input", return_value=0.0), patch.object(
                tracker_main, "current_snapshot", side_effect=snapshot
            ), patch.object(tracker_main, "backfill_browser_history_context"), patch.object(
                tracker_main, "capture_tracker_exception"
            ), patch.object(
                tracker_main.sys, "stderr", new=io.StringIO()
            ), patch.object(tracker_main.time, "monotonic", side_effect=lambda: 100.0 + elapsed), patch.object(
                tracker_main.time, "sleep", side_effect=wait
            ):
                tracker_main._daemon_with_owner(None)
                self.assertFalse(tracker_main.pid_path().exists())
                with tracker_main.tracker_daemon_lock() as acquired:
                    self.assertTrue(acquired)

            self.assertEqual(snapshots, [0, sample_seconds])
            # Two samples were credited until 10s; the pause began at 7s.
            self.assertEqual(segment_rows(db), [("Synthetic Editor", at(0), at(sample_seconds), 7)])
            log = (path.parent / tracking_pause_gate.LOG_FILE_NAME).read_text()
            self.assertIn("tracker capture_stopped_for_pause cutoff=read", log)
            self.assertIn("tracker capture_discarded origin=daemon trimmed=1 deleted=0", log)

    def test_a_tick_saves_nothing_when_the_pause_lands_during_the_snapshot(self) -> None:
        with temp_dir_closing_databases() as tmp:
            path = Path(tmp) / "tracker.sqlite3"
            db = TrackerDatabase(path, perform_maintenance=False)

            def snapshot(**_kwargs):
                save_pause(path, int(STARTED.timestamp()))
                return Snapshot(
                    observed_at=at(0), app_name="Synthetic Editor", bundle_id="test.synthetic.editor",
                    window_title="Same document", source="accessibility",
                )

            with patch.object(tracker_main, "DB_PATH", path), patch.object(
                tracker_main, "current_power_state", return_value=PowerStateSample(STARTED, True, "ok")
            ), patch.object(tracker_main, "seconds_since_last_input", return_value=0.0), patch.object(
                tracker_main, "current_snapshot", side_effect=snapshot
            ), patch.object(tracker_main, "_apply_developer_diagnostics_env"):
                allowed = lambda: not tracking_pause_gate.pause_requested(path)  # noqa: E731
                self.assertIsNone(tracker_main._daemon_tick(db, None, capture_allowed=allowed))
            self.assertEqual(segment_rows(db), [])


class StopDiscardTests(unittest.TestCase):
    def stop(self, db: TrackerDatabase, payload):
        with patch.object(tracker_main, "DB_PATH", db.db_path), patch.object(
            tracker_main, "database", return_value=db
        ), patch.object(
            tracker_main, "_process_table", side_effect=[{}, {}]
        ), patch.object(
            tracker_main, "get_status", return_value={"data": {"running": False}}
        ):
            return tracker_main.stop_tracking(payload)

    def test_confirmed_stop_removes_capture_saved_after_the_pause_began(self) -> None:
        with temp_dir_closing_databases() as tmp:
            db = TrackerDatabase(Path(tmp) / "tracker.sqlite3", perform_maintenance=False)
            insert_segment(db, 0, 40, 40, app_name="Across")
            insert_segment(db, 45, 60, 15, app_name="After")
            result = self.stop(db, {"discardCaptureAfter": int(STARTED.timestamp()) + 30})
            self.assertTrue(result["ok"])
            self.assertEqual(segment_rows(db), [("Across", at(0), at(30), 30)])

    def test_stop_without_a_valid_cutoff_keeps_activity(self) -> None:
        for payload in ({}, None, {"discardCaptureAfter": True}, {"discardCaptureAfter": "30"}):
            with self.subTest(payload=payload), temp_dir_closing_databases() as tmp:
                db = TrackerDatabase(Path(tmp) / "tracker.sqlite3", perform_maintenance=False)
                insert_segment(db, 0, 40, 40, app_name="Across")
                self.assertTrue(self.stop(db, payload)["ok"])
                self.assertEqual(segment_rows(db), [("Across", at(0), at(40), 40)])

    def test_a_failed_stop_keeps_activity_for_the_next_attempt(self) -> None:
        with temp_dir_closing_databases() as tmp:
            db = TrackerDatabase(Path(tmp) / "tracker.sqlite3", perform_maintenance=False)
            insert_segment(db, 0, 40, 40, app_name="Across")
            with patch.object(tracker_main, "DB_PATH", db.db_path), patch.object(
                tracker_main, "database", return_value=db
            ), patch.object(tracker_main, "_process_table", return_value=None), patch.object(
                tracker_main, "get_status", return_value={"data": {"running": True}}
            ):
                result = tracker_main.stop_tracking({"discardCaptureAfter": int(STARTED.timestamp()) + 30})
            self.assertFalse(result["ok"])
            self.assertEqual(segment_rows(db), [("Across", at(0), at(40), 40)])


if __name__ == "__main__":
    unittest.main()
