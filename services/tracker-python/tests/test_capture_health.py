from __future__ import annotations

import json
import os
from pathlib import Path
import sqlite3
import sys
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.capture_health import CaptureHealthPublisher, public_health
from app import main
import test_capture_clock as clock


class CaptureHealthTests(unittest.TestCase):
    def setUp(self):
        self.fixture = clock.CaptureClockTests()
        self.fixture.setUp()
        self.path = self.fixture.path
        state = self.path.parent / ".state"
        state.mkdir(exist_ok=True)
        (state / "tracker.pid").write_text(str(os.getpid()))
        self.health = CaptureHealthPublisher(self.path)
        self.fixture.db.capture_health = self.health

    def tearDown(self):
        self.fixture.tearDown()

    def sample(self, elapsed, **kwargs):
        self.health.begin_tick()
        try:
            self.fixture.capture(elapsed, **kwargs)
        except Exception as error:
            self.health.failed(error)
            self.fixture.last = None
        self.health.publish()

    def receipt(self):
        return json.loads(self.health.path.read_text())

    def test_watchdog_arms_only_around_os_snapshot_not_storage_or_idle(self):
        from app.capture_watchdog import CaptureWatchdog
        watchdog = CaptureWatchdog(self.path, lambda: True)
        self.fixture.db.capture_watchdog = watchdog
        original_snapshot = self.fixture.snapshot
        original_record = self.fixture.db.record_snapshot
        def snapshot(**kwargs):
            self.assertIsNotNone(watchdog.started_at)
            return original_snapshot(**kwargs)
        def record(*args, **kwargs):
            self.assertIsNone(watchdog.started_at)
            return original_record(*args, **kwargs)
        with patch.object(main, "current_snapshot", side_effect=snapshot), patch.object(
                self.fixture.db, "record_snapshot", side_effect=record):
            self.sample(0, idle=0)
            self.sample(5, idle=1000)
        self.assertIsNone(watchdog.started_at)
        self.assertFalse(watchdog.path.exists())

    def test_reports_commits_not_pid_or_successful_reads_and_recovers(self):
        self.sample(0, idle=0)
        self.assertEqual(self.receipt()["commits"], 1)
        original = self.fixture.rows()
        for message, reason in (("database or disk is full", "storageFull"),
                                ("database is locked", "storageBusy"), ("disk I/O error", "storageIo")):
            with self.subTest(reason=reason), patch.object(self.fixture.db, "record_snapshot", side_effect=sqlite3.OperationalError(message)):
                self.sample(5, idle=0)
                self.assertEqual(public_health(self.path, True), {"captureHealth": "failed", "captureFailureReason": reason})
                self.assertEqual(self.receipt()["commits"], 1)
                self.assertEqual(self.fixture.rows(), original)
        self.sample(10, idle=0)
        self.assertEqual(self.receipt()["commits"], 2)
        self.assertEqual(public_health(self.path, True)["captureHealth"], "recording")

    def test_post_commit_metadata_failure_does_not_erase_success_receipt(self):
        with patch.object(main, "backfill_browser_history_context", side_effect=RuntimeError("owned enrichment failure")):
            self.sample(0, idle=0)
        self.assertEqual(self.receipt()["commits"], 1)
        self.assertEqual(len(self.fixture.rows()), 1)
        self.assertEqual(public_health(self.path, True)["captureHealth"], "recording")

    def test_real_sqlite_full_rolls_back_capture_and_recovers_without_deleting_history(self):
        self.sample(0, idle=0)
        original = self.fixture.rows()
        conn = self.fixture.db.connect()
        pages = conn.execute("PRAGMA page_count").fetchone()[0]
        previous_limit = conn.execute("PRAGMA max_page_count").fetchone()[0]
        conn.execute(f"PRAGMA max_page_count={pages}")
        self.fixture.context = "owned large snapshot " * 50000
        self.sample(5, idle=0)
        self.assertEqual(public_health(self.path, True), {"captureHealth": "failed", "captureFailureReason": "storageFull"})
        self.assertEqual(self.receipt()["commits"], 1)
        self.assertEqual(self.fixture.rows(), original)
        conn.execute(f"PRAGMA max_page_count={previous_limit}")
        self.fixture.context = "owned resumed capture"
        self.sample(10, idle=0)
        self.assertEqual(self.receipt()["commits"], 2)
        self.assertEqual(self.fixture.rows()[0], original[0])
        self.assertEqual(public_health(self.path, True)["captureHealth"], "recording")

    def test_real_sqlite_writer_lock_preserves_records_and_receipt_reports_failure(self):
        self.sample(0, idle=0)
        original = self.fixture.rows()
        self.fixture.db.connect().execute("PRAGMA busy_timeout=1")
        other = sqlite3.connect(self.path)
        try:
            other.execute("BEGIN IMMEDIATE")
            self.sample(5, idle=0)
            self.assertEqual(public_health(self.path, True)["captureFailureReason"], "storageBusy")
            self.assertEqual(self.receipt()["commits"], 1)
            self.assertEqual(self.fixture.rows(), original)
        finally:
            other.rollback()
            other.close()
        self.sample(10, idle=0)
        self.assertEqual(self.receipt()["commits"], 2)
        self.assertEqual(public_health(self.path, True)["captureHealth"], "recording")

    def test_restarted_pending_cleanup_preserves_new_capture_and_reports_its_commit(self):
        original = self.fixture.queue_failed_idle_cleanup()
        self.fixture.reopen_capture()
        self.health = CaptureHealthPublisher(self.path)
        self.fixture.db.capture_health = self.health
        with self.fixture.failed_cleanup(1):
            self.sample(165, idle=0)
        self.assertEqual(public_health(self.path, True)["captureHealth"], "recording")
        self.assertEqual(self.receipt()["commits"], 1)
        self.assertEqual(self.fixture.rows()[0], original)
        resumed = self.fixture.rows()[1]
        self.sample(170, idle=0)
        self.assertEqual(self.receipt()["commits"], 2)
        self.assertEqual(len(self.fixture.rows()), 1)
        self.assertEqual(self.fixture.rows()[0]["segment_uid"], resumed["segment_uid"])
        self.assertEqual(self.fixture.deleted_uids(), {original["segment_uid"]})

    def test_metadata_failure_before_capture_does_not_claim_a_commit(self):
        with patch.object(self.fixture.db, "set_meta", side_effect=sqlite3.OperationalError("database or disk is full")):
            self.sample(0, idle=0)
        self.assertEqual(self.receipt()["commits"], 0)
        self.assertEqual(self.fixture.rows(), [])
        self.assertEqual(public_health(self.path, True)["captureHealth"], "failed")

    def test_idle_power_and_policy_suppression_are_successful_non_capture_outcomes(self):
        self.sample(0, idle=200)
        self.assertEqual(public_health(self.path, True)["captureHealth"], "idle")
        self.fixture.power = False
        self.sample(5, idle=0)
        self.assertEqual(public_health(self.path, True)["captureHealth"], "suppressed")
        self.fixture.power = True
        with patch.object(main, "capture_decision", return_value="skip"):
            self.sample(10, idle=0)
        self.assertEqual(public_health(self.path, True)["captureHealth"], "suppressed")
        self.assertEqual(self.receipt()["commits"], 0)

    def test_telemetry_write_failure_cannot_lose_activity_or_refresh_old_evidence(self):
        self.sample(0, idle=0)
        original = self.health.path.read_text()
        with patch("app.capture_health.os.replace", side_effect=OSError("owned full volume")):
            self.sample(5, idle=0)
        self.assertEqual(len(self.fixture.rows()), 1)
        self.assertEqual(self.fixture.rows()[0]["duration_seconds"], 10)
        self.assertEqual(self.health.path.read_text(), original)
        self.assertEqual(list(self.health.path.parent.glob(".capture-health-*")), [])
        with patch("app.capture_health.time.time", return_value=self.receipt()["updatedAt"] + 91):
            self.assertEqual(public_health(self.path, True)["captureHealth"], "unknown")

    def test_stale_wrong_pid_invalid_and_future_receipts_are_unknown(self):
        self.sample(0, idle=0)
        original = self.receipt()
        for changes in ({"pid": os.getpid()+1}, {"version": 2}, {"state": "secret"},
                        {"updatedAt": 0}, {"updatedAt": float("nan")}, {"updatedAt": 1e20}):
            with self.subTest(changes=changes):
                self.health.path.write_text(json.dumps({**original, **changes}))
                self.assertEqual(public_health(self.path, True)["captureHealth"], "unknown")
        self.assertEqual(public_health(self.path, False), {})
        self.health.path.unlink()
        self.assertEqual(public_health(self.path, True)["captureHealth"], "unknown")

    def test_receipt_contains_only_fixed_state_counters_and_timestamps(self):
        self.fixture.context = "PRIVATE DOCUMENT TITLE"
        self.sample(0, idle=0)
        self.assertNotIn("PRIVATE", self.health.path.read_text())
        self.assertEqual(set(self.receipt()), {"version", "pid", "runId", "sequence", "commits", "lastCommitAt", "state", "reason", "updatedAt"})
        if sys.platform != "win32":
            self.assertEqual(self.health.path.stat().st_mode & 0o777, 0o600)

    def test_real_daemon_loop_publishes_failed_tick_and_successful_recovery(self):
        fixture = self.fixture
        original_tick = main._daemon_tick
        calls = []
        def tick(db, previous, **kwargs):
            calls.append(len(calls))
            if len(calls) == 1:
                raise sqlite3.OperationalError("database is locked")
            return original_tick(db, previous, **kwargs)
        observations = []
        def wait(_seconds):
            observations.append(public_health(self.path, True))
            if len(observations) == 2:
                raise KeyboardInterrupt
        stop_event = MagicMock()
        stop_event.requested.return_value = False
        stop_event.wait.side_effect = wait
        with patch.object(main, "DB_PATH", self.path), patch.object(main, "database", return_value=fixture.db), \
             patch.object(main, "_acquire_tracker_daemon_lock", return_value=object()), \
             patch.object(main, "_release_tracker_daemon_lock"), patch.object(main, "_write_tracker_pid"), \
             patch.object(main, "_remove_pid_record_if_owned"), patch.object(main, "_frozen_macos", return_value=False), \
             patch.object(main, "_maybe_create_periodic_backup", return_value=0), \
             patch.object(main, "_maybe_ingest_dev_signals", return_value=0), \
             patch.object(main, "_daemon_tick", side_effect=tick), \
             patch("app.windows_daemon_shutdown.WindowsDaemonStopEvent", return_value=stop_event), \
             patch.object(main.time, "sleep", side_effect=wait), patch.object(main, "capture_tracker_exception"):
            with self.assertRaises(KeyboardInterrupt):
                main._daemon_with_owner(None)
        self.assertEqual([o["captureHealth"] for o in observations], ["failed", "recording"])
        self.assertEqual(self.receipt()["commits"], 1)


if __name__ == "__main__":
    unittest.main()
