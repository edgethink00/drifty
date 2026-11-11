"""Clock corrections through the production tick with independent SQLite oracles."""
from __future__ import annotations

import json
import random
import sqlite3
import sys
import unittest
from contextlib import ExitStack, closing, contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app import main
from app.storage import db as storage_db
from app.storage.database_maintenance import database_backup_dir
from app.storage.db import TrackerDatabase
from app.tracker.capture_contract import Snapshot
from app.tracker.capture_timeline import CaptureTimeline, CaptureTiming, CaptureTrim


class CaptureClockTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = TemporaryDirectory()
        self.path = Path(self.temp.name) / "owned-clock.sqlite3"
        self.db = TrackerDatabase(self.path)
        self.anchor = datetime(2026, 10, 1, 9, tzinfo=timezone.utc)
        self.elapsed = 0.0
        self.idle = 0.0
        self.wall = self.anchor
        self.tick = 100.0
        self.mac_clock_offset = None
        self.power = True
        self.audio = False
        self.context = "Owned context"
        self.fail_snapshot = False
        self.snapshot_delay = 0
        self.last = None
        owner = self

        class ControlledDatetime(datetime):
            @classmethod
            def now(cls, tz=None):
                return owner.wall if tz is not None else owner.wall.replace(tzinfo=None)

        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.addCleanup(self.db.close)
        self.stack.enter_context(patch.object(main, "datetime", ControlledDatetime))
        self.stack.enter_context(patch.object(main.time, "monotonic", side_effect=lambda: self.tick))
        self.stack.enter_context(patch.object(main, "_mac_capture_continuity_tick", side_effect=lambda:
            None if self.mac_clock_offset is None else self.tick + self.mac_clock_offset))
        self.stack.enter_context(patch.object(main, "seconds_since_last_input", side_effect=lambda: self.idle))
        self.stack.enter_context(patch.object(main, "current_power_state", side_effect=lambda:
            SimpleNamespace(observed_at=self.wall, should_capture=self.power, reason="owned_fixture")))
        self.stack.enter_context(patch.object(main, "current_snapshot", side_effect=self.snapshot))
        self.stack.enter_context(patch.object(main, "current_foreground_audio_sample", side_effect=lambda:
            SimpleNamespace(available=True, active=self.audio, reason="owned_fixture")))
        for name in ("_apply_developer_diagnostics_env",
                     "backfill_browser_history_context"):
            self.stack.enter_context(patch.object(main, name))

    def tearDown(self) -> None:
        self.stack.close()
        self.db.close()
        self.temp.cleanup()

    def snapshot(self, **kwargs) -> Snapshot:
        if self.fail_snapshot:
            raise RuntimeError("owned foreground failure")
        self.tick += self.snapshot_delay
        return Snapshot(observed_at=self.wall.isoformat(), app_name="Owned timing app",
                        bundle_id="owned.timing.app", window_title=self.context, source="owned-fixture")

    def capture(self, elapsed, *, idle=None, correction=0):
        self.elapsed = elapsed
        self.tick = 100.0 + elapsed
        self.wall = self.anchor + timedelta(seconds=elapsed + correction)
        self.idle = max(0, elapsed - 60) if idle is None else idle
        self.last = main._daemon_tick(self.db, self.last)
        return self.last

    def rows(self):
        with closing(sqlite3.connect(self.path)) as conn:
            conn.row_factory = sqlite3.Row
            self.assertEqual(conn.execute("PRAGMA quick_check").fetchone()[0], "ok")
            return [dict(row) for row in conn.execute("SELECT * FROM activity_segments ORDER BY id")]

    def deleted_uids(self):
        with closing(sqlite3.connect(self.path)) as conn:
            return {uid for (text,) in conn.execute("SELECT segment_uids_json FROM sync_deletions")
                    for uid in json.loads(text)}

    def active_prefix(self):
        for elapsed in range(0, 61, 5):
            self.capture(elapsed, idle=0)
        return self.rows()[0]["segment_uid"]

    @contextmanager
    def owned_database(self):
        with TemporaryDirectory() as tmp:
            prior_db, prior_path, prior_last = self.db, self.path, self.last
            self.path = Path(tmp) / "matrix.sqlite3"
            self.db = TrackerDatabase(self.path)
            self.last = None
            try:
                yield
            finally:
                self.db.close()
                self.db, self.path, self.last = prior_db, prior_path, prior_last

    def assert_supported_prefix(self, uid, seconds=60):
        rows = self.rows()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["segment_uid"], uid)
        self.assertEqual(rows[0]["duration_seconds"], seconds)
        self.assertEqual(rows[0]["ended_at"], (self.anchor + timedelta(seconds=seconds)).isoformat())
        self.assertNotIn(uid, self.deleted_uids())
        self.assertIsNone(self.last)
        self.assertEqual(self.db.get_meta("tracker_mode"), "idle")

    def test_idle_stop_uses_pre_correction_input_anchor(self):
        for correction in (0, -5, -60, -180, -300, 300):
            with self.subTest(correction=correction), self.owned_database():
                uid = self.active_prefix()
                for elapsed in range(65, 236, 5):
                    self.capture(elapsed)
                self.capture(240, correction=correction)
                self.assert_supported_prefix(uid)
                # Repeated idle ticks cannot trim the supported prefix again.
                self.capture(245, correction=correction - 300)
                self.assert_supported_prefix(uid)

    def test_correction_during_idle_removes_every_unsupported_row(self):
        for correction in (0, -5, -30, -60, -300, 30, 300):
            with self.subTest(correction=correction), self.owned_database():
                uid = self.active_prefix()
                for elapsed in range(65, 236, 5):
                    self.capture(elapsed, correction=correction)
                before = self.rows()
                unsupported = {row["segment_uid"] for row in before if row["segment_uid"] != uid}
                self.capture(240, correction=correction)
                self.assert_supported_prefix(uid)
                self.assertEqual(self.deleted_uids(), unsupported)

    def test_context_changes_without_input_do_not_leave_provisional_rows(self):
        uid = self.active_prefix()
        for elapsed in range(65, 236, 5):
            self.context = "Owned idle context " + str(elapsed // 30)
            self.capture(elapsed)
        unsupported = {row["segment_uid"] for row in self.rows() if row["segment_uid"] != uid}
        self.assertGreater(len(unsupported), 1)
        self.capture(240)
        self.assert_supported_prefix(uid)
        self.assertEqual(self.deleted_uids(), unsupported)

    def test_repeated_clock_and_context_changes_preserve_the_known_input_prefix(self):
        for seed in range(16):
            with self.subTest(seed=seed), self.owned_database():
                uid = self.active_prefix()
                rng = random.Random(seed)
                correction = 0
                for elapsed in range(65, 236, 5):
                    correction += rng.choice((-300, -60, -5, 0, 5, 60, 300))
                    self.context = "Owned random context " + str(rng.randrange(4))
                    self.capture(elapsed, correction=correction)
                unsupported = {row["segment_uid"] for row in self.rows() if row["segment_uid"] != uid}
                self.capture(240, correction=correction + rng.choice((-300, 300)))
                self.assert_supported_prefix(uid)
                self.assertEqual(self.deleted_uids(), unsupported)

    def test_input_between_samples_uses_elapsed_time_on_the_old_anchor(self):
        uid = self.active_prefix()
        for elapsed in range(65, 242, 5):
            self.capture(elapsed, idle=elapsed - 62, correction=-300)
        self.capture(242, idle=180, correction=-300)
        self.assert_supported_prefix(uid, 62)

    def test_slow_foreground_read_does_not_move_the_input_boundary(self):
        self.snapshot_delay = 2
        uid = self.active_prefix()
        for elapsed in range(65, 236, 5):
            self.capture(elapsed, correction=-300)
        self.capture(240, correction=-300)
        self.assert_supported_prefix(uid)

    def test_normal_fractional_sampling_rounds_the_trimmed_span_once(self):
        self.capture(0, idle=0)
        self.capture(7.4, idle=0)
        self.capture(14.8, idle=0)
        uid = self.rows()[0]["segment_uid"]
        for elapsed in range(20, 190, 5):
            self.capture(elapsed, idle=elapsed - 14.8)
        self.capture(194.8, idle=180)
        row = self.rows()[0]
        self.assertEqual(row["segment_uid"], uid)
        self.assertEqual(row["duration_seconds"], 15)
        self.assertEqual(row["ended_at"], (self.anchor + timedelta(seconds=14.8)).isoformat())

    def test_long_fractional_capture_still_trims_to_the_last_real_input(self):
        for i in range(301):
            self.capture(i * (16 / 3), idle=0)
        for elapsed in range(1605, 1780, 5):
            self.capture(elapsed, idle=elapsed - 1600)
        self.capture(1780, idle=180)
        row = self.rows()[0]
        self.assertEqual(row["duration_seconds"], 1600)
        self.assertEqual(row["ended_at"], (self.anchor + timedelta(seconds=1600)).isoformat())

    def test_fractional_credit_does_not_cross_a_power_suppressed_capture(self):
        self.capture(0, idle=0)
        self.capture(5.4, idle=0)
        original = self.rows()[0]
        self.power = False
        self.assertIsNone(self.capture(10.8, idle=0))
        self.power = True
        self.capture(100, idle=0)
        self.capture(105.4, idle=0)
        rows = self.rows()
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0], original)
        self.assertEqual(rows[1]["started_at"], (self.anchor + timedelta(seconds=100)).isoformat())
        self.assertEqual(sum(row["duration_seconds"] for row in rows), 20)

    def test_mac_stalled_sampler_never_credits_the_missing_interval(self):
        self.mac_clock_offset = 0
        self.capture(0, idle=0)
        original = self.rows()[0]
        self.capture(20, idle=0)
        self.capture(25, idle=0)
        rows = self.rows()
        self.assertEqual([row["duration_seconds"] for row in rows], [5, 10])
        self.assertEqual(rows[0], original)
        self.assertEqual(rows[1]["started_at"], (self.anchor + timedelta(seconds=20)).isoformat())

    def test_mac_sleep_clock_detects_a_gap_when_awake_clock_does_not(self):
        self.mac_clock_offset = 0
        self.capture(0, idle=0)
        original = self.rows()[0]
        # Only five seconds on the awake clock, but twenty seconds elapsed
        # including the time asleep. No suppressed-power tick was sampled.
        self.mac_clock_offset = 15
        self.capture(5, idle=0, correction=15)
        rows = self.rows()
        self.assertEqual([row["duration_seconds"] for row in rows], [5, 5])
        self.assertEqual(rows[0], original)
        self.assertEqual(rows[1]["started_at"], (self.anchor + timedelta(seconds=20)).isoformat())

    def test_fractional_credit_does_not_cross_an_idle_stop(self):
        self.capture(0, idle=0)
        self.capture(5.4, idle=0)
        self.assertIsNone(self.capture(185.4, idle=180))
        self.context = "Owned resumed context"
        self.capture(200, idle=0)
        self.capture(205.4, idle=0)
        rows = self.rows()
        self.assertEqual(rows[-1]["duration_seconds"], 10)

    def test_daemon_start_resets_the_cached_database_generation(self):
        self.active_prefix()
        old_timeline = self.db.capture_timeline
        self.assertTrue(old_timeline.points)
        with patch.object(main, "_acquire_tracker_daemon_lock", return_value=object()), patch.object(
            main, "_release_tracker_daemon_lock"
        ), patch.object(main, "_write_tracker_pid"), patch.object(
            main, "_remove_pid_record_if_owned"
        ), patch.object(main, "database", return_value=self.db), patch.object(
            main, "_maybe_create_periodic_backup", return_value=0
        ), patch.object(main, "_maybe_ingest_dev_signals", return_value=0), patch.object(
            main, "_close_loaded_windows_capture"
        ), patch.object(main.sys, "platform", "darwin"), patch.object(
            main, "_daemon_tick", side_effect=KeyboardInterrupt
        ):
            with self.assertRaises(KeyboardInterrupt):
                main._daemon_with_owner(None)
        self.assertIsNot(self.db.capture_timeline, old_timeline)
        self.assertEqual(self.db.capture_timeline.points, [])
        self.assertEqual(self.db.capture_timeline.floors, {})

    def test_initially_idle_row_is_legitimately_deleted_with_recovery_invalidation(self):
        for elapsed in range(0, 160, 5):
            self.capture(elapsed, idle=elapsed + 20)
        uid = self.rows()[0]["segment_uid"]
        old_backup = self.db.create_periodic_backup()
        self.assertTrue(old_backup.exists())
        self.capture(160, idle=180, correction=-300)
        self.assertEqual(self.rows(), [])
        self.assertEqual(self.deleted_uids(), {uid})
        self.assertFalse(old_backup.exists())
        for backup in database_backup_dir(self.path).glob("*.sqlite3"):
            with closing(sqlite3.connect(backup)) as conn:
                self.assertEqual(conn.execute("SELECT count(*) FROM activity_segments").fetchone()[0], 0)

    def test_restart_keeps_the_previous_generation_floor(self):
        self.active_prefix()
        before = self.rows()[0]
        self.db.close()
        self.db = TrackerDatabase(self.path)
        self.last = None
        self.assertEqual(self.db.capture_timeline.points, [])
        # Input predates the new generation, which may coalesce into old data.
        for elapsed in range(65, 221, 5):
            self.capture(elapsed, idle=elapsed - 40)
        self.assertEqual(self.rows()[0]["segment_uid"], before["segment_uid"])
        self.assertEqual(self.rows()[0]["duration_seconds"], before["duration_seconds"])
        self.assertEqual(self.rows()[0]["ended_at"], before["ended_at"])
        self.assertEqual(self.deleted_uids(), set())

    def test_restart_does_not_extend_a_previous_segment_across_an_unobserved_gap(self):
        uid = self.active_prefix()
        original = self.rows()[0]
        self.db.close()
        self.db = TrackerDatabase(self.path)
        self.last = None

        # The same foreground app returns before the ordinary 180-second
        # interactive merge window, but there was no running tracker.
        self.capture(95, idle=0)
        self.capture(100, idle=0)

        rows = self.rows()
        self.assertEqual(len(rows), 2)
        original_after, resumed = rows
        self.assertEqual(original_after, original)
        self.assertNotEqual(resumed["segment_uid"], uid)
        self.assertEqual(resumed["started_at"], (self.anchor + timedelta(seconds=95)).isoformat())
        self.assertEqual(resumed["ended_at"], (self.anchor + timedelta(seconds=100)).isoformat())
        self.assertEqual(resumed["duration_seconds"], 10)

    def test_idle_after_restart_does_not_rejoin_the_old_segment_on_new_input(self):
        for elapsed in range(0, 61, 5):
            self.capture(elapsed, idle=elapsed)
        original = self.rows()[0]
        self.db.close()
        self.db = TrackerDatabase(self.path)
        self.last = None

        # A fresh daemon can briefly record provisional samples even when the
        # last OS input predates its launch. Idle trims those samples, not the
        # previous generation's committed row.
        for elapsed in range(95, 181, 5):
            self.capture(elapsed, idle=elapsed)
        self.assertIsNone(self.last)
        self.assertEqual(self.rows(), [original])
        self.capture(185, idle=0)

        rows = self.rows()
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0], original)
        self.assertEqual(rows[1]["started_at"], (self.anchor + timedelta(seconds=185)).isoformat())
        self.assertEqual(rows[1]["duration_seconds"], 5)

    def test_foreground_failure_gap_keeps_the_input_anchor(self):
        uid = self.active_prefix()
        self.fail_snapshot = True
        with self.assertRaises(RuntimeError):
            self.capture(65, correction=-300)
        self.last = None  # daemon's existing exception handler
        self.fail_snapshot = False
        for elapsed in range(70, 236, 5):
            self.capture(elapsed, correction=-300)
        self.capture(240, correction=-300)
        self.assert_supported_prefix(uid)

    def test_input_after_failed_capture_does_not_credit_the_unobserved_gap(self):
        uid = self.active_prefix()
        self.fail_snapshot = True
        with self.assertRaises(RuntimeError):
            self.capture(65)
        self.last = None  # daemon's failed-tick reset
        self.fail_snapshot = False
        self.capture(100, idle=0)
        # 65 sampled seconds before failure + one fresh 5s sample. The
        # first default sample predates started_at and is removed by trim.
        self.assertEqual(self.rows()[0]["duration_seconds"], 70)
        for elapsed in range(105, 280, 5):
            self.capture(elapsed, idle=elapsed - 100)
        self.capture(280, idle=180)
        row = self.rows()[0]
        self.assertEqual(row["segment_uid"], uid)
        self.assertEqual(row["duration_seconds"], 65)
        self.assertEqual(row["ended_at"], (self.anchor + timedelta(seconds=100)).isoformat())
        self.assertEqual(self.deleted_uids(), set())

    def test_input_inside_failed_capture_gap_credits_only_the_fresh_sample_interval(self):
        for input_at, seconds, end_at in ((62, 60, 60), (98, 63, 98)):
            with self.subTest(input_at=input_at), self.owned_database():
                uid = self.active_prefix()
                self.fail_snapshot = True
                with self.assertRaises(RuntimeError):
                    self.capture(65, idle=3)
                self.last = None
                self.fail_snapshot = False
                for elapsed in range(100, input_at + 180, 5):
                    self.capture(elapsed, idle=elapsed - input_at)
                self.capture(input_at + 180, idle=180)
                row = self.rows()[0]
                self.assertEqual(row["segment_uid"], uid)
                # Input at 62 is wholly unobserved. Input at 98 supports 3s
                # inside the resumed capture's fresh [95, 100] sample.
                self.assertEqual(row["duration_seconds"], seconds)
                self.assertEqual(row["ended_at"], (self.anchor + timedelta(seconds=end_at)).isoformat())
                self.assertEqual(self.deleted_uids(), set())

    def test_new_input_after_correction_and_clock_catchup_remains_supported(self):
        self.active_prefix()
        for elapsed in range(65, 96, 5):
            self.capture(elapsed, correction=-300)
        for elapsed in range(100, 121, 5):
            self.capture(elapsed, idle=0, correction=-300)
        supported_uids = {row["segment_uid"] for row in self.rows()}
        # Clock catches up during the next idle window, without further input.
        for elapsed in range(125, 300, 5):
            self.capture(elapsed, idle=elapsed - 120, correction=0)
        self.capture(300, idle=180)
        rows = self.rows()
        self.assertEqual({row["segment_uid"] for row in rows}, supported_uids)
        self.assertEqual(sum(row["duration_seconds"] for row in rows), 120)
        self.assertEqual(rows[-1]["ended_at"], (self.anchor + timedelta(seconds=-180)).isoformat())
        self.assertTrue(supported_uids.isdisjoint(self.deleted_uids()))

    def test_passive_audio_preserves_supported_time_across_correction(self):
        self.active_prefix()
        for elapsed in range(65, 236, 5):
            self.capture(elapsed, correction=-300)
        self.audio = True
        self.capture(240, correction=-300)
        self.assertEqual(self.rows()[-1]["engagement_evidence"], "foreground-audio")
        before = self.rows()
        self.audio = False
        self.capture(260, correction=-300)
        self.assertEqual(self.rows(), before)
        self.assertEqual(self.deleted_uids(), set())
        self.assertEqual(self.db.get_meta("tracker_mode"), "idle")

    def test_power_suppression_preserves_completed_samples_across_correction(self):
        self.active_prefix()
        before = self.rows()
        self.power = False  # reachable Darwin power boundary; injected elsewhere
        self.capture(61, idle=1, correction=-300)
        self.assertEqual(self.rows(), before)
        self.assertEqual(self.deleted_uids(), set())
        self.assertEqual(self.db.get_meta("tracker_mode"), "suppressed")
        self.power = True
        self.capture(70, idle=0, correction=-300)
        self.assertEqual(sum(row["duration_seconds"] for row in self.rows()), 70)

    def test_resume_without_input_trims_provisional_time_from_before_suppression(self):
        uid = self.active_prefix()
        for elapsed in range(65, 236, 5):
            self.capture(elapsed)
        self.power = False
        self.capture(236, correction=-300)
        self.assertEqual(sum(row["duration_seconds"] for row in self.rows()), 240)
        self.power = True
        self.capture(240, correction=-300)
        self.assert_supported_prefix(uid)

    def test_input_age_advancing_across_sleep_cannot_move_known_input_backward(self):
        uid = self.active_prefix()
        for elapsed in range(65, 236, 5):
            self.capture(elapsed)
        # Model an OS idle clock including sleep while the elapsed clock did
        # not. This is a clock-domain control, not an actual machine sleep.
        self.capture(240, idle=1980, correction=-300)
        self.assert_supported_prefix(uid)

    def test_imported_and_remote_rows_are_never_capture_or_trim_targets(self):
        uid = self.active_prefix()
        with self.db.connect() as conn:
            for segment_uid, source, device in (("owned-import", "browser-history-import", None),
                                                ("owned-remote", "owned-fixture", "owned-device")):
                conn.execute("""INSERT INTO activity_segments
                    (segment_uid, started_at, ended_at, duration_seconds, app_name,
                     platform, source, origin_device_id) VALUES (?, ?, ?, 999, 'Owned unrelated', ?, ?, ?)""",
                    (segment_uid, self.anchor.isoformat(), (self.anchor + timedelta(days=1)).isoformat(),
                     self.rows()[0]["platform"], source, device))
        unrelated_before = [row for row in self.rows() if row["segment_uid"] != uid]
        for elapsed in range(65, 241, 5):
            self.capture(elapsed, correction=-300)
        rows = self.rows()
        self.assertEqual([row for row in rows if row["segment_uid"] in ("owned-import", "owned-remote")],
                         unrelated_before)
        active = next(row for row in rows if row["segment_uid"] == uid)
        self.assertEqual(active["duration_seconds"], 60)
        self.assertEqual(len(rows), 3)

    def test_trim_does_not_overwrite_or_delete_a_changed_or_reused_row(self):
        self.active_prefix()
        expected = CaptureTiming.from_row(self.rows()[0])
        with self.db.connect() as conn:
            conn.execute("UPDATE activity_segments SET duration_seconds = 999 WHERE id = ?",
                         (expected.segment_id,))
        self.db.trim_captured_segments([CaptureTrim(expected, None), CaptureTrim(expected, expected)])
        self.assertEqual(self.rows()[0]["duration_seconds"], 999)
        with self.db.connect() as conn:
            conn.execute("UPDATE activity_segments SET duration_seconds = ?, segment_uid = 'owned-reused' WHERE id = ?",
                         (expected.duration_seconds, expected.segment_id))
        self.db.trim_captured_segments([CaptureTrim(expected, None)])
        self.assertEqual(self.rows()[0]["segment_uid"], "owned-reused")
        self.assertEqual(self.deleted_uids(), set())

    def test_conditional_delete_holds_write_lock_from_validation_through_delete(self):
        self.capture(0, idle=20)
        expected = CaptureTiming.from_row(self.rows()[0])
        original_guard = storage_db.permanent_deletion_guard
        writer_was_blocked = []

        @contextmanager
        def competing_writer_at_invalidation(*args, **kwargs):
            with original_guard(*args, **kwargs) as invalidate:
                def attempt_write():
                    with closing(sqlite3.connect(self.path, timeout=0)) as writer:
                        try:
                            writer.execute("UPDATE activity_segments SET duration_seconds = 999 WHERE id = ?",
                                           (expected.segment_id,))
                            writer.commit()
                        except sqlite3.OperationalError as exc:
                            self.assertIn("locked", str(exc))
                            writer_was_blocked.append(True)
                        else:
                            writer_was_blocked.append(False)
                    invalidate()
                yield attempt_write

        with patch.object(storage_db, "permanent_deletion_guard", competing_writer_at_invalidation):
            self.db.trim_captured_segments([CaptureTrim(expected, None)])
        self.assertEqual(writer_was_blocked, [True])
        self.assertEqual(self.rows(), [])
        self.assertEqual(self.deleted_uids(), {expected.segment_uid})

    def test_capture_holds_write_lock_while_reading_and_updating_its_before_state(self):
        uid = self.active_prefix()
        original_merge_gap = TrackerDatabase._within_merge_gap
        writer_was_blocked = []

        def competing_writer_before_update(*args):
            with closing(sqlite3.connect(self.path, timeout=0)) as writer:
                try:
                    writer.execute("UPDATE activity_segments SET duration_seconds = 999 WHERE segment_uid = ?",
                                   (uid,))
                    writer.commit()
                except sqlite3.OperationalError as exc:
                    self.assertIn("locked", str(exc))
                    writer_was_blocked.append(True)
                else:
                    writer_was_blocked.append(False)
            return original_merge_gap(*args)

        with patch.object(TrackerDatabase, "_within_merge_gap", side_effect=competing_writer_before_update):
            self.capture(65, idle=0)
        self.assertEqual(writer_was_blocked, [True])
        self.assertEqual(self.rows()[0]["duration_seconds"], 70)
        self.assertEqual(self.rows()[0]["segment_uid"], uid)

    def test_external_timing_change_before_next_capture_becomes_a_preserved_floor(self):
        self.active_prefix()
        with self.db.connect() as conn:
            conn.execute("UPDATE activity_segments SET duration_seconds = 999")
        external = self.rows()[0]
        for elapsed in range(65, 241, 5):
            self.capture(elapsed)
        after = self.rows()[0]
        self.assertEqual(after["duration_seconds"], external["duration_seconds"])
        self.assertEqual(after["ended_at"], external["ended_at"])
        self.assertEqual(after["segment_uid"], external["segment_uid"])
        self.assertEqual(self.deleted_uids(), set())

    def test_failed_recovery_invalidation_keeps_rows_and_retries_without_losing_activity(self):
        uid = self.active_prefix()
        for elapsed in range(65, 236, 5):
            self.capture(elapsed, correction=-300)
        unsupported = {row["segment_uid"] for row in self.rows() if row["segment_uid"] != uid}
        original_guard = storage_db.permanent_deletion_guard

        @contextmanager
        def failed_invalidation(*args, **kwargs):
            with original_guard(*args, **kwargs):
                def fail():
                    raise PermissionError("owned recovery invalidation failure")
                yield fail

        with patch.object(storage_db, "permanent_deletion_guard", failed_invalidation):
            with self.assertRaises(PermissionError):
                self.capture(240, correction=-300)
        self.assertEqual({row["segment_uid"] for row in self.rows()}, unsupported | {uid})
        self.assertEqual(self.deleted_uids(), set())
        self.assertTrue(self.db.capture_timeline.pending_input_trims)
        self.capture(245, correction=-300)
        self.assert_supported_prefix(uid)
        self.assertEqual(self.deleted_uids(), unsupported)

    @contextmanager
    def failed_cleanup(self, count):
        original_guard = storage_db.permanent_deletion_guard
        failures = []

        @contextmanager
        def fail_guard(*args, **kwargs):
            with original_guard(*args, **kwargs) as invalidate:
                def attempt():
                    if len(failures) < count:
                        failures.append(self.elapsed)
                        raise PermissionError("owned pending cleanup failure")
                    invalidate()
                yield attempt

        with patch.object(storage_db, "permanent_deletion_guard", fail_guard), patch.object(
            main, "capture_tracker_exception"
        ):
            yield failures

    def test_failed_stop_retries_after_input_or_passive_activity_resumes(self):
        for kind in ("input", "passive"):
            for count in (1, 3):
                with self.subTest(kind=kind, count=count), self.owned_database():
                    self.audio = False
                    uid = self.active_prefix()
                    for elapsed in range(65, 236, 5):
                        self.capture(elapsed, correction=-300)
                    with self.failed_cleanup(count) as failures:
                        for elapsed in range(240, 240 + count * 5, 5):
                            with self.assertRaises(PermissionError):
                                self.capture(elapsed, correction=-300)
                            self.last = None
                        resume = 240 + count * 5
                        self.audio = kind == "passive"
                        for elapsed in range(resume, resume + 16, 5):
                            self.capture(elapsed, idle=0 if kind == "input" else elapsed - 60,
                                         correction=-300)
                        self.assertEqual(len(failures), count)
                    passive_rows = [row for row in self.rows()
                                    if row["engagement_evidence"] == "foreground-audio"]
                    self.audio = False
                    if kind == "input":
                        last_input = resume + 15
                        for elapsed in range(last_input + 5, last_input + 181, 5):
                            self.capture(elapsed, idle=elapsed - last_input, correction=-300)
                        expected = 75
                    else:
                        self.capture(resume + 35, correction=-300)
                        expected = 80
                    after = self.rows()
                    self.assertEqual(sum(row["duration_seconds"] for row in after), expected)
                    original = next(row for row in after if row["segment_uid"] == uid)
                    self.assertEqual(original["duration_seconds"], 60)
                    self.assertEqual(original["ended_at"], (self.anchor + timedelta(seconds=60)).isoformat())
                    self.assertTrue(all(row in after for row in passive_rows))
                    self.assertNotIn(uid, self.deleted_uids())

    def test_new_supported_captures_continue_while_cleanup_still_fails(self):
        for kind in ("input", "passive"):
            with self.subTest(kind=kind), self.owned_database():
                self.audio = False
                uid = self.active_prefix()
                for elapsed in range(65, 236, 5):
                    self.capture(elapsed, correction=-300)
                with self.failed_cleanup(3) as failures:
                    with self.assertRaises(PermissionError):
                        self.capture(240, correction=-300)
                    self.last = None
                    self.audio = kind == "passive"
                    for elapsed in range(245, 261, 5):
                        self.assertIsNotNone(self.capture(
                            elapsed, idle=0 if kind == "input" else elapsed - 60, correction=-300
                        ))
                    self.assertEqual(failures, [240, 245, 250])
                    # Repeated cleanup errors isolate the old queued row,
                    # while the new supported context still coalesces normally.
                    self.assertEqual(len(self.rows()), 2)
                passive_rows = [row for row in self.rows()
                                if row["engagement_evidence"] == "foreground-audio"]
                self.audio = False
                if kind == "input":
                    for elapsed in range(265, 441, 5):
                        self.capture(elapsed, idle=elapsed - 260, correction=-300)
                    expected = 75
                else:
                    self.capture(280, correction=-300)
                    expected = 80
                after = self.rows()
                self.assertEqual(sum(row["duration_seconds"] for row in after), expected)
                self.assertTrue(all(row in after for row in passive_rows))
                self.assertEqual(next(row for row in after if row["segment_uid"] == uid)["duration_seconds"], 60)
                self.assertNotIn(uid, self.deleted_uids())

    def test_delayed_cleanup_preserves_intervening_timing_uid_and_protected_origins(self):
        for change in ("timing", "uid", "import", "remote"):
            with self.subTest(change=change), self.owned_database():
                self.audio = False
                uid = self.active_prefix()
                for elapsed in range(65, 236, 5):
                    self.capture(elapsed, correction=-300)
                with self.failed_cleanup(1):
                    with self.assertRaises(PermissionError):
                        self.capture(240, correction=-300)
                    self.last = None
                    queued_row = self.rows()[-1]
                    with self.db.connect() as conn:
                        if change == "timing":
                            conn.execute("UPDATE activity_segments SET duration_seconds = 999 WHERE id = ?",
                                         (queued_row["id"],))
                        elif change == "uid":
                            conn.execute("UPDATE activity_segments SET segment_uid = 'owned-replacement' WHERE id = ?",
                                         (queued_row["id"],))
                        elif change == "import":
                            conn.execute("UPDATE activity_segments SET source = ? WHERE id = ?",
                                         (storage_db.BROWSER_HISTORY_IMPORT_SOURCE, queued_row["id"]))
                        else:
                            conn.execute("UPDATE activity_segments SET origin_device_id = 'owned-remote' WHERE id = ?",
                                         (queued_row["id"],))
                    protected = self.rows()[-1]
                    self.capture(245, correction=-300)
                self.assertEqual(next(row for row in self.rows() if row["id"] == protected["id"]), protected)
                self.assertNotIn(protected["segment_uid"], self.deleted_uids())
                self.assertNotIn(uid, self.deleted_uids())

    def test_zero_and_negative_merge_gaps_choose_capture_order(self):
        self.active_prefix()
        first_uid = self.rows()[0]["segment_uid"]
        self.capture(65, idle=0, correction=-300)
        second_uid = self.rows()[-1]["segment_uid"]
        self.assertNotEqual(first_uid, second_uid)
        self.capture(70, idle=0, correction=-305)  # equal timestamp is permitted
        self.capture(75, idle=0, correction=-300)
        rows = self.rows()
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["duration_seconds"], 65)
        self.assertEqual(rows[-1]["duration_seconds"], 15)
        self.assertEqual(rows[-1]["segment_uid"], second_uid)

    def test_long_interactive_run_keeps_the_in_memory_window_bounded(self):
        for elapsed in range(0, 2000, 5):
            self.capture(elapsed, idle=0)
        self.assertLessEqual(len(self.db.capture_timeline.points), 2)
        self.assertEqual(len(self.db.capture_timeline.floors), 1)


if __name__ == "__main__":
    unittest.main()
