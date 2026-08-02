from __future__ import annotations

import sqlite3
import sys
import threading
import unittest
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.storage.database_maintenance import (
    create_rotating_backup,
    database_backup_dir,
    database_quarantine_dir,
    prepare_database,
    quick_check_database,
)
from app.storage.db import TrackerDatabase


class DatabaseMaintenanceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = TemporaryDirectory()
        self.db_path = Path(self.tempdir.name) / "tracker.sqlite3"

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    @staticmethod
    def _insert_marker(database: TrackerDatabase, value: str) -> None:
        with database.connect() as connection:
            connection.execute(
                "INSERT OR REPLACE INTO tracker_meta (key, value) VALUES ('maintenance-test', ?)",
                (value,),
            )

    def test_existing_database_creates_a_verified_backup_on_reopen(self) -> None:
        database = TrackerDatabase(self.db_path)
        self._insert_marker(database, "preserved")
        database.close()

        reopened = TrackerDatabase(self.db_path)
        backups = list(database_backup_dir(self.db_path).glob("tracker-*.sqlite3"))
        self.assertEqual(len(backups), 1)
        self.assertTrue(quick_check_database(backups[0], immutable=True))
        with closing(sqlite3.connect(backups[0])) as backup:
            value = backup.execute(
                "SELECT value FROM tracker_meta WHERE key = 'maintenance-test'"
            ).fetchone()[0]
        self.assertEqual(value, "preserved")
        reopened.close()

    def test_wal_mode_backup_is_self_contained_and_system_read_only_compatible(self) -> None:
        database = TrackerDatabase(self.db_path)
        with database.connect() as connection:
            connection.execute("PRAGMA wal_autocheckpoint = 0")
            connection.execute(
                "INSERT OR REPLACE INTO tracker_meta (key, value) VALUES ('wal-row', 'included')"
            )
        self.assertTrue(Path(f"{self.db_path}-wal").exists())

        backup = create_rotating_backup(
            database.connect(), self.db_path, interval_seconds=0
        )

        self.assertIsNotNone(backup)
        self.assertTrue(quick_check_database(backup, immutable=True))
        self.assertFalse(Path(f"{backup}-wal").exists())
        self.assertFalse(Path(f"{backup}-shm").exists())
        with closing(sqlite3.connect(backup)) as snapshot:
            self.assertEqual(
                snapshot.execute(
                    "SELECT value FROM tracker_meta WHERE key = 'wal-row'"
                ).fetchone()[0],
                "included",
            )
        database.close()

    def test_backup_failure_does_not_make_a_healthy_database_unavailable(self) -> None:
        database = TrackerDatabase(self.db_path)
        self._insert_marker(database, "still-available")
        database.close()

        with patch("app.storage.db.create_rotating_backup", side_effect=OSError("disk full")):
            reopened = TrackerDatabase(self.db_path)

        self.assertEqual(reopened.get_meta("maintenance-test"), "still-available")
        self.assertEqual(reopened.maintenance_error, "disk full")
        reopened.close()

    def test_short_lived_connection_can_skip_repeating_startup_maintenance(self) -> None:
        database = TrackerDatabase(self.db_path)
        self._insert_marker(database, "worker")
        database.close()

        with patch("app.storage.db.prepare_database") as prepare, patch(
            "app.storage.db.create_rotating_backup"
        ) as backup:
            worker = TrackerDatabase(self.db_path, perform_maintenance=False)

        prepare.assert_not_called()
        backup.assert_not_called()
        self.assertEqual(worker.get_meta("maintenance-test"), "worker")
        worker.close()

    def test_rotation_keeps_only_the_three_newest_verified_backups(self) -> None:
        database = TrackerDatabase(self.db_path)
        base = datetime(2026, 8, 2, tzinfo=timezone.utc)
        created = []
        for index in range(4):
            self._insert_marker(database, str(index))
            created.append(
                create_rotating_backup(
                    database.connect(),
                    self.db_path,
                    now=base + timedelta(minutes=index),
                    interval_seconds=0,
                    retention=3,
                )
            )

        backups = sorted(database_backup_dir(self.db_path).glob("tracker-*.sqlite3"))
        self.assertEqual(len(backups), 3)
        self.assertFalse(created[0].exists())
        self.assertTrue(all(path.exists() for path in created[1:]))
        database.close()

    def test_daily_interval_skips_duplicate_backup_until_twenty_four_hours_pass(self) -> None:
        database = TrackerDatabase(self.db_path)
        self._insert_marker(database, "daily")
        base = datetime.now(timezone.utc)

        first = create_rotating_backup(database.connect(), self.db_path, now=base)
        within_interval = create_rotating_backup(
            database.connect(), self.db_path, now=base + timedelta(hours=23)
        )
        after_interval = create_rotating_backup(
            database.connect(), self.db_path, now=base + timedelta(hours=25)
        )

        self.assertIsNotNone(first)
        self.assertIsNone(within_interval)
        self.assertIsNotNone(after_interval)
        self.assertEqual(len(list(database_backup_dir(self.db_path).glob("tracker-*.sqlite3"))), 2)
        database.close()

    def test_concurrent_backup_attempts_are_serialized_to_one_snapshot(self) -> None:
        database = TrackerDatabase(self.db_path)
        self._insert_marker(database, "concurrent")
        database.close()
        barrier = threading.Barrier(2)
        results: list[Path | None] = []
        errors: list[BaseException] = []

        def worker() -> None:
            try:
                with closing(sqlite3.connect(self.db_path)) as connection:
                    barrier.wait(timeout=5)
                    results.append(create_rotating_backup(connection, self.db_path))
            except BaseException as error:
                errors.append(error)

        threads = [threading.Thread(target=worker) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10)

        self.assertFalse(any(thread.is_alive() for thread in threads))
        self.assertEqual(errors, [])
        self.assertEqual(sum(result is not None for result in results), 1)
        self.assertEqual(len(list(database_backup_dir(self.db_path).glob("tracker-*.sqlite3"))), 1)

    def test_non_corruption_sqlite_error_preserves_the_original_database(self) -> None:
        database = TrackerDatabase(self.db_path)
        self._insert_marker(database, "preserve-on-lock")
        database.close()
        original = self.db_path.read_bytes()

        with patch(
            "app.storage.database_maintenance.quick_check_database",
            side_effect=sqlite3.OperationalError("database is locked"),
        ):
            with self.assertRaisesRegex(sqlite3.OperationalError, "locked"):
                prepare_database(self.db_path)

        self.assertEqual(self.db_path.read_bytes(), original)
        self.assertFalse(database_quarantine_dir(self.db_path).exists())

    def test_failed_backup_removes_partial_snapshot(self) -> None:
        database = TrackerDatabase(self.db_path)

        class FailingSource:
            @staticmethod
            def backup(*_args, **_kwargs) -> None:
                raise sqlite3.OperationalError("simulated backup failure")

        with self.assertRaisesRegex(sqlite3.OperationalError, "simulated"):
            create_rotating_backup(FailingSource(), self.db_path)

        backup_dir = database_backup_dir(self.db_path)
        self.assertEqual(list(backup_dir.glob("*")), [])
        database.close()

    def test_confirmed_corruption_is_quarantined_and_restored_from_latest_valid_backup(self) -> None:
        database = TrackerDatabase(self.db_path)
        self._insert_marker(database, "recover-me")
        backup = create_rotating_backup(
            database.connect(),
            self.db_path,
            now=datetime(2026, 8, 2, tzinfo=timezone.utc),
            interval_seconds=0,
        )
        self.assertIsNotNone(backup)
        database.close()
        self.db_path.write_bytes(b"not a sqlite database")

        recovered = TrackerDatabase(self.db_path)

        self.assertEqual(recovered.maintenance_result.restored_backup_path, backup)
        quarantined = recovered.maintenance_result.quarantined_path
        self.assertIsNotNone(quarantined)
        self.assertTrue(quarantined.exists())
        self.assertEqual(quarantined.read_bytes(), b"not a sqlite database")
        self.assertTrue(quick_check_database(self.db_path))
        self.assertEqual(recovered.get_meta("maintenance-test"), "recover-me")
        recovered.close()

    def test_permanent_activity_delete_cannot_be_undone_by_backup_recovery(self) -> None:
        database = TrackerDatabase(self.db_path)
        database.insert_segment(
            {
                "started_at": "2026-08-02T09:00:00+00:00",
                "ended_at": "2026-08-02T09:01:00+00:00",
                "duration_seconds": 60,
                "app_name": "Private activity",
            }
        )
        with database.connect() as connection:
            segment_id = str(
                connection.execute("SELECT id FROM activity_segments").fetchone()["id"]
            )
        backup = create_rotating_backup(
            database.connect(),
            self.db_path,
            now=datetime(2026, 8, 2, tzinfo=timezone.utc),
            interval_seconds=0,
        )
        self.assertIsNotNone(backup)
        quarantine_dir = database_quarantine_dir(self.db_path)
        quarantine_dir.mkdir(parents=True)
        quarantined_copy = quarantine_dir / "tracker-corrupt-20260801T000000000000Z.sqlite3"
        quarantined_copy.write_bytes(self.db_path.read_bytes())

        self.assertEqual(database.delete_activity_segments([segment_id]), 1)
        self.assertFalse(backup.exists())
        self.assertFalse(quarantined_copy.exists())
        database.close()

        self.db_path.write_bytes(b"not a sqlite database")
        recovered = TrackerDatabase(self.db_path)

        self.assertIsNone(recovered.maintenance_result.restored_backup_path)
        self.assertEqual(recovered.fetch_timeline("2026-08-02"), [])
        recovered.close()

    def test_permanent_history_range_delete_invalidates_older_backups(self) -> None:
        database = TrackerDatabase(self.db_path)
        database.insert_segment(
            {
                "started_at": "2026-08-02T09:00:00+00:00",
                "ended_at": "2026-08-02T09:01:00+00:00",
                "duration_seconds": 60,
                "app_name": "Private activity",
            }
        )
        backup = create_rotating_backup(
            database.connect(), self.db_path, interval_seconds=0
        )
        self.assertIsNotNone(backup)

        result = database.delete_history_range(
            start="2026-08-02",
            end="2026-08-02",
            scopes={"activity": True},
        )

        self.assertEqual(result["activitySegments"], 1)
        self.assertFalse(backup.exists())
        database.close()

    def test_recovery_copy_cleanup_failure_prevents_permanent_delete(self) -> None:
        database = TrackerDatabase(self.db_path)
        database.insert_segment(
            {
                "started_at": "2026-08-02T09:00:00+00:00",
                "ended_at": "2026-08-02T09:01:00+00:00",
                "duration_seconds": 60,
                "app_name": "Keep when cleanup fails",
            }
        )
        with database.connect() as connection:
            segment_id = str(
                connection.execute("SELECT id FROM activity_segments").fetchone()["id"]
            )
        backup = create_rotating_backup(
            database.connect(), self.db_path, interval_seconds=0
        )
        self.assertIsNotNone(backup)

        with patch.object(Path, "unlink", side_effect=PermissionError("read only")):
            with self.assertRaisesRegex(PermissionError, "read only"):
                database.delete_activity_segments([segment_id])

        self.assertTrue(backup.exists())
        self.assertEqual(len(database.fetch_timeline("2026-08-02")), 1)
        database.close()

    def test_restore_skips_a_newer_corrupt_backup_and_uses_the_latest_valid_copy(self) -> None:
        database = TrackerDatabase(self.db_path)
        self._insert_marker(database, "older-valid")
        older = create_rotating_backup(
            database.connect(),
            self.db_path,
            now=datetime(2026, 8, 2, tzinfo=timezone.utc),
            interval_seconds=0,
        )
        self._insert_marker(database, "newer-corrupt")
        newer = create_rotating_backup(
            database.connect(),
            self.db_path,
            now=datetime(2026, 8, 2, 0, 1, tzinfo=timezone.utc),
            interval_seconds=0,
        )
        database.close()
        self.assertIsNotNone(older)
        self.assertIsNotNone(newer)
        older.touch()
        newer.touch()
        newer.write_bytes(b"corrupt backup")
        self.db_path.write_bytes(b"corrupt source")

        recovered = TrackerDatabase(self.db_path)

        self.assertEqual(recovered.maintenance_result.restored_backup_path, older)
        self.assertEqual(recovered.get_meta("maintenance-test"), "older-valid")
        recovered.close()

    def test_confirmed_corruption_without_backup_starts_fresh_but_preserves_original(self) -> None:
        self.db_path.write_bytes(b"not a sqlite database")

        recovered = TrackerDatabase(self.db_path)

        self.assertIsNone(recovered.maintenance_result.restored_backup_path)
        quarantined = recovered.maintenance_result.quarantined_path
        self.assertIsNotNone(quarantined)
        self.assertTrue(quarantined.exists())
        self.assertTrue(quick_check_database(self.db_path))
        self.assertEqual(len(list(database_quarantine_dir(self.db_path).glob("tracker-corrupt-*.sqlite3"))), 1)
        recovered.close()

    def test_quarantine_moves_wal_and_shm_sidecars_with_the_corrupt_database(self) -> None:
        self.db_path.write_bytes(b"not a sqlite database")
        Path(f"{self.db_path}-wal").write_bytes(b"wal-sidecar")
        Path(f"{self.db_path}-shm").write_bytes(b"shm-sidecar")

        with patch(
            "app.storage.database_maintenance.quick_check_database", return_value=False
        ), patch("app.storage.db.create_rotating_backup"):
            recovered = TrackerDatabase(self.db_path)

        quarantined = recovered.maintenance_result.quarantined_path
        self.assertIsNotNone(quarantined)
        self.assertEqual(Path(f"{quarantined}-wal").read_bytes(), b"wal-sidecar")
        self.assertEqual(Path(f"{quarantined}-shm").read_bytes(), b"shm-sidecar")
        # The fresh replacement database may immediately create new WAL/SHM
        # files at the original path; the quarantined copies above must retain
        # the corrupt database's original sidecars.
        recovered.close()


if __name__ == "__main__":
    unittest.main()
