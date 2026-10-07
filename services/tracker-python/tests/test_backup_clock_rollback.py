from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
import unittest
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.storage import database_maintenance as maintenance
from app.storage.database_maintenance import create_rotating_backup, database_backup_dir, prepare_database
from app.storage.db import TrackerDatabase
from tests.support_cleanup import cleanup_temp_dir


class BackupClockRollbackTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = TemporaryDirectory()
        self.path = Path(self.temp.name) / "tracker.sqlite3"
        self.clock = datetime(2026, 10, 6, tzinfo=timezone.utc)
        self.db = TrackerDatabase(self.path, perform_maintenance=False)
        self.write("before")

    def tearDown(self) -> None:
        self.db.close()
        cleanup_temp_dir(self.temp)

    def write(self, value: str) -> None:
        self.db.set_meta("clock-test", value)

    def backup(self, offset_days: int, *, force: bool = False, retention: int = 3) -> Path | None:
        return create_rotating_backup(
            self.db.connect(), self.path,
            now=self.clock + timedelta(days=offset_days),
            interval_seconds=0 if force else 86400,
            retention=retention,
        )

    def recover_value(self) -> str:
        self.db.close()
        self.path.write_bytes(b"confirmed synthetic SQLite corruption")
        result = prepare_database(self.path, now=self.clock + timedelta(days=2))
        self.assertIsNotNone(result.restored_backup_path)
        with sqlite3.connect(self.path) as connection:
            return connection.execute("SELECT value FROM tracker_meta WHERE key = 'clock-test'").fetchone()[0]

    def test_corrected_clock_creates_and_recovers_newest_successful_snapshot(self) -> None:
        self.assertIsNotNone(self.backup(365))
        self.write("after")
        new = self.backup(2)
        self.assertIsNotNone(new, "clock correction suppressed the daily backup")
        self.assertEqual(self.recover_value(), "after", "recovery selected the old future-dated snapshot")

    def test_clock_correction_resets_daily_interval_without_repeated_backups(self) -> None:
        self.backup(365)
        self.write("after")
        self.backup(2)
        self.assertIsNone(self.backup(2), "future-dated copy forced every maintenance poll to back up")
        self.assertIsNotNone(self.backup(3), "normal daily cadence did not resume")

    def test_retention_one_keeps_verified_new_snapshot_after_clock_correction(self) -> None:
        old = self.backup(365, retention=1)
        self.write("after")
        new = self.backup(2, retention=1)
        self.assertTrue(new.is_file())
        self.assertFalse(old.exists())
        self.assertEqual(self.recover_value(), "after")

    def test_multiple_future_dated_copies_cannot_displace_new_snapshot(self) -> None:
        for day in (365, 366, 367):
            self.backup(day)
        self.write("after")
        new = self.backup(2)
        self.assertTrue(new.is_file())
        self.assertEqual(len(list(database_backup_dir(self.path).glob("*.sqlite3"))), 3)
        self.assertEqual(self.recover_value(), "after")

    def test_rotation_preserves_recent_snapshots_after_multiple_clock_changes(self) -> None:
        for day in (365, 366, 367):
            self.backup(day)
        self.write("after-rollback-first")
        first_corrected = self.backup(2)
        self.write("after-rollback-second")
        latest = self.backup(3)
        self.assertTrue(first_corrected.is_file(), "future filenames displaced a more recent verified backup")
        latest.write_bytes(b"synthetic corrupt newest copy")
        self.assertEqual(self.recover_value(), "after-rollback-first")

    def test_normal_clock_keeps_existing_daily_cadence(self) -> None:
        self.backup(0)
        self.write("after")
        self.assertIsNone(self.backup(0))
        self.assertIsNotNone(self.backup(1))
        self.assertEqual(self.recover_value(), "after")

    def test_legacy_copies_without_order_record_still_recover(self) -> None:
        self.backup(0)
        record = self.path.parent / f".{self.path.name}.backup-order"
        record.unlink()
        self.write("after")
        self.backup(1)
        record.unlink()
        self.assertEqual(self.recover_value(), "after")

    def test_corrupt_recorded_snapshot_falls_back_to_valid_older_copy(self) -> None:
        self.backup(0)
        self.write("after")
        latest = self.backup(1)
        latest.write_bytes(b"synthetic corrupt backup")
        self.assertEqual(self.recover_value(), "before")

    def test_missing_recorded_snapshot_falls_back_to_valid_older_copy(self) -> None:
        self.backup(0)
        self.write("after")
        self.backup(1).unlink()
        self.assertEqual(self.recover_value(), "before")

    def test_order_record_publish_error_keeps_prior_copy_and_reports_failure(self) -> None:
        self.backup(365)
        self.write("after")
        original = os.replace
        record = self.path.parent / f".{self.path.name}.backup-order"
        def fail_record(source, destination):
            if destination == record:
                raise OSError("synthetic record publication failure")
            return original(source, destination)
        with patch("app.storage.database_maintenance.os.replace", side_effect=fail_record):
            with self.assertRaisesRegex(OSError, "record publication failure"):
                self.backup(2, retention=1)
        self.assertEqual(len(list(database_backup_dir(self.path).glob("*.sqlite3"))), 1)
        self.assertEqual(self.db.get_meta("clock-test"), "after")
        self.assertEqual(self.recover_value(), "before")

    def test_failed_snapshot_publication_preserves_previous_order_at_retention_one(self) -> None:
        self.backup(365)
        self.write("after-first-correction")
        self.backup(2)
        self.write("not-backed-up")
        original = os.replace
        def fail_snapshot(source, destination):
            if destination.parent == database_backup_dir(self.path) and destination.suffix == ".sqlite3":
                raise OSError("synthetic snapshot publication failure")
            return original(source, destination)
        with patch("app.storage.database_maintenance.os.replace", side_effect=fail_snapshot):
            with self.assertRaisesRegex(OSError, "snapshot publication failure"):
                self.backup(3, retention=1)
        self.assertEqual(self.recover_value(), "after-first-correction")

    def test_reused_clock_timestamp_cannot_promote_old_copy_after_failed_publication(self) -> None:
        self.backup(365)
        self.write("after-first-correction")
        self.backup(2)
        self.write("not-backed-up")
        original = os.replace
        def fail_snapshot(source, destination):
            if destination.parent == database_backup_dir(self.path) and destination.suffix == ".sqlite3":
                raise OSError("synthetic snapshot publication failure")
            return original(source, destination)
        with patch("app.storage.database_maintenance.os.replace", side_effect=fail_snapshot):
            with self.assertRaisesRegex(OSError, "snapshot publication failure"):
                self.backup(365, force=True)
        self.assertEqual(self.recover_value(), "after-first-correction")

    def test_reused_clock_timestamp_keeps_distinct_recovery_copies(self) -> None:
        self.backup(365)
        self.write("after-first-correction")
        first = self.backup(2)
        self.write("latest")
        self.backup(365)
        self.write("last")
        latest = self.backup(2)
        self.assertNotEqual(latest, first)
        self.assertTrue(first.is_file())
        self.assertIsNone(self.backup(2), "collision suffix broke the daily interval")
        latest.write_bytes(b"synthetic corrupt newest copy")
        self.assertEqual(self.recover_value(), "latest")

    def test_process_exit_after_snapshot_publication_recovers_completed_copy(self) -> None:
        self.backup(365)
        self.write("after")
        self.db.close()
        child_code = """
import os
import sqlite3
import sys
from datetime import datetime
from pathlib import Path
from app.storage import database_maintenance as maintenance

path = Path(sys.argv[1])
original = os.replace
def exit_after_snapshot(source, destination):
    original(source, destination)
    if destination.parent == maintenance.database_backup_dir(path) and destination.suffix == ".sqlite3":
        os._exit(77)
maintenance.os.replace = exit_after_snapshot
with sqlite3.connect(path) as connection:
    maintenance.create_rotating_backup(connection, path, now=datetime.fromisoformat(sys.argv[2]))
"""
        child = subprocess.run(
            [sys.executable, "-c", child_code, str(self.path),
             (self.clock + timedelta(days=2)).isoformat()],
            cwd=SERVICE_ROOT, capture_output=True, text=True, timeout=15,
        )
        self.assertEqual(child.returncode, 77, child.stderr)
        self.assertEqual(self.recover_value(), "after")

    def test_legacy_non_timestamped_copy_does_not_invalidate_new_order_record(self) -> None:
        old = self.backup(0)
        old.rename(old.with_name("tracker-legacy.sqlite3"))
        (self.path.parent / f".{self.path.name}.backup-order").unlink()
        self.write("after")
        self.assertIsNotNone(self.backup(1, force=True))
        self.assertEqual(self.recover_value(), "after")

    def test_invalid_utf8_record_does_not_block_a_healthy_database_backup(self) -> None:
        self.backup(0)
        record = self.path.parent / f".{self.path.name}.backup-order"
        record.write_bytes(b"\xff\xfe")
        self.write("after")
        self.assertIsNotNone(self.backup(1, force=True))
        self.assertEqual(self.recover_value(), "after")

    def test_same_stem_other_database_backups_cannot_displace_our_recovery_copy(self) -> None:
        ours = self.backup(365)
        other_path = self.path.with_suffix(".db")
        other = TrackerDatabase(other_path, perform_maintenance=False)
        try:
            other.set_meta("clock-test", "another-database")
            for day in (2, 3, 4, 5):
                create_rotating_backup(other.connect(), other_path, now=self.clock + timedelta(days=day))
        finally:
            other.close()
        self.assertTrue(ours.is_file(), "another database rotated away our snapshot")
        self.assertEqual(self.recover_value(), "before")

    def test_new_record_does_not_claim_a_legacy_backup_of_another_database(self) -> None:
        legacy = self.backup(0)
        (self.path.parent / f".{self.path.name}.backup-order").unlink()
        other_path = self.path.with_suffix(".db")
        other = TrackerDatabase(other_path, perform_maintenance=False)
        try:
            other.set_meta("clock-test", "another-database")
            create_rotating_backup(other.connect(), other_path, now=self.clock + timedelta(days=1), interval_seconds=0)
        finally:
            other.close()
        self.assertTrue(legacy.is_file())
        self.db.close()
        original = b"confirmed synthetic SQLite corruption"
        self.path.write_bytes(original)
        with self.assertRaisesRegex(sqlite3.DatabaseError, "ambiguous.*backup"):
            prepare_database(self.path, now=self.clock)
        self.assertEqual(self.path.read_bytes(), original)
        self.assertTrue(legacy.is_file())

    def test_unreadable_foreign_order_record_preserves_source_and_backups(self) -> None:
        ours = self.backup(0)
        foreign = self.path.parent / ".tracker.db.backup-order"
        foreign.write_text("../another.sqlite3", encoding="utf-8")
        self.write("after")
        with self.assertRaisesRegex(sqlite3.DatabaseError, "invalid database backup order record"):
            self.backup(1)
        self.assertTrue(ours.is_file())
        self.assertEqual(self.db.get_meta("clock-test"), "after")
        self.db.close()
        self.path.write_bytes(b"confirmed synthetic SQLite corruption")
        with self.assertRaisesRegex(sqlite3.DatabaseError, "invalid database backup order record"):
            prepare_database(self.path)
        self.assertEqual(self.path.read_bytes(), b"confirmed synthetic SQLite corruption")
        self.assertTrue(ours.is_file())

    def test_foreign_snapshot_published_during_rotation_is_preserved(self) -> None:
        for day in (365, 366, 367):
            self.backup(day)
        other = TrackerDatabase(self.path.with_suffix(".db"), perform_maintenance=False)
        other.set_meta("clock-test", "another-database")
        original_files = maintenance._recovery_files
        original_rotate = maintenance._rotate_backups
        state = {"rotating": False, "other_snapshot": None}
        def rotate(db_path, retention):
            state["rotating"] = True
            try:
                return original_rotate(db_path, retention)
            finally:
                state["rotating"] = False
        def files(directory, pattern):
            if state["rotating"] and directory == database_backup_dir(self.path) and state["other_snapshot"] is None:
                state["rotating"] = False
                state["other_snapshot"] = False  # prevent reentering the injection
                state["other_snapshot"] = create_rotating_backup(other.connect(), other.db_path, now=self.clock)
                state["rotating"] = True
            return original_files(directory, pattern)
        try:
            with patch.object(maintenance, "_rotate_backups", side_effect=rotate), patch.object(maintenance, "_recovery_files", side_effect=files):
                self.backup(2)
            self.assertIsNotNone(state["other_snapshot"])
            self.assertTrue(state["other_snapshot"].is_file(), "rotation erased a newly published foreign copy")
        finally:
            other.close()

    def test_other_database_cannot_rotate_away_an_ambiguous_legacy_copy(self) -> None:
        old = self.backup(365)
        legacy = old.with_name("tracker-20271006T000000000000Z.sqlite3")
        old.rename(legacy)
        (self.path.parent / f".{self.path.name}.backup-order").unlink()
        other = TrackerDatabase(self.path.with_suffix(".db"), perform_maintenance=False)
        try:
            other.set_meta("clock-test", "another-database")
            for day in (2, 3, 4):
                create_rotating_backup(other.connect(), other.db_path, now=self.clock + timedelta(days=day))
        finally:
            other.close()
        self.assertTrue(legacy.is_file(), "clock correction removed an unowned legacy backup")
        self.db.close()
        original = b"confirmed synthetic SQLite corruption"
        self.path.write_bytes(original)
        with self.assertRaisesRegex(sqlite3.DatabaseError, "ambiguous.*backup"):
            prepare_database(self.path, now=self.clock)
        self.assertEqual(self.path.read_bytes(), original)
        self.assertTrue(legacy.is_file())

    def test_single_database_legacy_rotation_is_not_disabled_by_pid_file(self) -> None:
        for day in (0, 1, 2):
            self.backup(day)
            (self.path.parent / f".{self.path.name}.backup-order").unlink()
        (self.path.parent / "tracker.pid").write_text("12345", encoding="utf-8")
        self.write("after")
        self.backup(3)
        self.assertEqual(len(list(database_backup_dir(self.path).glob("*.sqlite3"))), 3)
        self.assertEqual(self.recover_value(), "after")

    def test_queued_default_clock_sample_cannot_create_duplicate_backup(self) -> None:
        state = {"now": self.clock, "injected": False}
        original_lock = maintenance._maintenance_lock
        class ControlledClock(datetime):
            @classmethod
            def now(cls, tz=None):
                return state["now"]
        @contextmanager
        def lock(db_path):
            if not state["injected"]:
                state["injected"] = True
                state["now"] += timedelta(seconds=1)
                create_rotating_backup(self.db.connect(), db_path, now=state["now"])
            with original_lock(db_path):
                yield
        with patch.object(maintenance, "datetime", ControlledClock), patch.object(maintenance, "_maintenance_lock", lock):
            queued = create_rotating_backup(self.db.connect(), self.path)
        self.assertIsNone(queued, "a queued old clock sample was mistaken for a clock correction")
        self.assertEqual(len(list(database_backup_dir(self.path).glob("*.sqlite3"))), 1)

    def test_invalid_record_cannot_redirect_recovery_or_move_source(self) -> None:
        self.backup(0)
        record = self.path.parent / f".{self.path.name}.backup-order"
        record.write_text("../another.sqlite3", encoding="utf-8")
        self.db.close()
        self.path.write_bytes(b"confirmed synthetic SQLite corruption")
        with self.assertRaisesRegex(sqlite3.DatabaseError, "invalid database backup order record"):
            prepare_database(self.path)
        self.assertEqual(self.path.read_bytes(), b"confirmed synthetic SQLite corruption")


if __name__ == "__main__":
    unittest.main()
