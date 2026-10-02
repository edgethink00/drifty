from __future__ import annotations

import errno
import os
import sqlite3
import subprocess
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
from tests.support_cleanup import cleanup_temp_dir


class DatabaseMaintenanceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = TemporaryDirectory()
        self.db_path = Path(self.tempdir.name) / "tracker.sqlite3"

    def tearDown(self) -> None:
        cleanup_temp_dir(self.tempdir)

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

    def test_long_running_database_can_create_a_due_backup_without_reopening(self) -> None:
        database = TrackerDatabase(self.db_path)
        self._insert_marker(database, "created-while-running")

        backup = database.create_periodic_backup()

        self.assertIsNotNone(backup)
        self.assertTrue(quick_check_database(backup, immutable=True))
        with closing(sqlite3.connect(backup)) as snapshot:
            self.assertEqual(
                snapshot.execute(
                    "SELECT value FROM tracker_meta WHERE key = 'maintenance-test'"
                ).fetchone()[0],
                "created-while-running",
            )
        database.close()

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

    def test_unreadable_backup_preserves_source_until_latest_copy_can_be_retried(self) -> None:
        for with_older in (False, True):
            for fault in (PermissionError("backup access denied"),
                          sqlite3.OperationalError("disk I/O error")):
                with self.subTest(older=with_older, fault=type(fault).__name__):
                    with TemporaryDirectory() as directory:
                        db_path = Path(directory) / "tracker.sqlite3"
                        database = TrackerDatabase(db_path)
                        base = datetime.now(timezone.utc) - timedelta(hours=2)
                        self._insert_marker(database, "older")
                        if with_older:
                            create_rotating_backup(database.connect(), db_path,
                                                   now=base, interval_seconds=0)
                        self._insert_marker(database, "latest")
                        latest = create_rotating_backup(
                            database.connect(), db_path,
                            now=base + timedelta(hours=1), interval_seconds=0,
                        )
                        database.close()
                        original_backup = latest.read_bytes()
                        original_source = b"confirmed corrupt source"
                        db_path.write_bytes(original_source)
                        check = quick_check_database
                        attempted = []

                        def fail_latest(path, **kwargs):
                            if path == latest:
                                attempted.append(path)
                                raise fault
                            return check(path, **kwargs)

                        with patch("app.storage.database_maintenance.quick_check_database",
                                   side_effect=fail_latest):
                            with self.assertRaises(type(fault)):
                                TrackerDatabase(db_path)

                        self.assertEqual(attempted, [latest])
                        self.assertEqual(db_path.read_bytes(), original_source)
                        self.assertEqual(latest.read_bytes(), original_backup)
                        self.assertFalse(database_quarantine_dir(db_path).exists())
                        self.assertFalse((db_path.parent / ".tracker.sqlite3.recovery-pending").exists())
                        recovered = TrackerDatabase(db_path)
                        try:
                            self.assertEqual(recovered.get_meta("maintenance-test"), "latest")
                            self.assertEqual(recovered.maintenance_result.restored_backup_path, latest)
                        finally:
                            recovered.close()

    def test_unreadable_backup_directory_does_not_publish_an_empty_replacement(self) -> None:
        database = TrackerDatabase(self.db_path)
        self._insert_marker(database, "retry-directory")
        backup = create_rotating_backup(database.connect(), self.db_path, interval_seconds=0)
        database.close()
        original_backup = backup.read_bytes()
        original_source = b"confirmed corrupt source"
        self.db_path.write_bytes(original_source)
        read_directory = Path.iterdir
        attempted = []

        def deny_directory(path):
            if path == backup.parent:
                attempted.append(path)
                raise PermissionError("backup directory access denied")
            return read_directory(path)

        with patch.object(Path, "iterdir", deny_directory):
            with self.assertRaisesRegex(PermissionError, "directory access denied"):
                TrackerDatabase(self.db_path)

        self.assertEqual(attempted, [backup.parent])
        self.assertEqual(self.db_path.read_bytes(), original_source)
        self.assertEqual(backup.read_bytes(), original_backup)
        self.assertFalse(database_quarantine_dir(self.db_path).exists())
        recovered = TrackerDatabase(self.db_path)
        try:
            self.assertEqual(recovered.get_meta("maintenance-test"), "retry-directory")
        finally:
            recovered.close()

    def test_unreadable_recovery_directory_prevents_delete_and_tombstone_commit(self) -> None:
        for folder_name in ("database-backups", "database-quarantine"):
            with self.subTest(directory=folder_name), TemporaryDirectory() as directory:
                db_path = Path(directory) / "tracker.sqlite3"
                database = TrackerDatabase(db_path)
                try:
                    database.insert_segment({
                        "segment_uid": "must-remain-until-copies-removed",
                        "started_at": "2026-08-02T09:00:00+00:00",
                        "ended_at": "2026-08-02T09:01:00+00:00",
                        "duration_seconds": 60,
                        "app_name": "Recovery directory guard",
                    })
                    connection = database.connect()
                    segment_id = str(connection.execute(
                        "SELECT id FROM activity_segments").fetchone()[0])
                    backup = create_rotating_backup(connection, db_path, interval_seconds=0)
                    quarantine = database_quarantine_dir(db_path) / "tracker-corrupt-owned.sqlite3"
                    quarantine.parent.mkdir()
                    quarantine.write_bytes(backup.read_bytes())
                    original_backup = backup.read_bytes()
                    original_quarantine = quarantine.read_bytes()
                    before_deletions = [tuple(row) for row in connection.execute(
                        "SELECT * FROM sync_deletions").fetchall()]
                    read_directory = Path.iterdir
                    attempted = []

                    def deny_directory(path):
                        if path == db_path.parent / folder_name:
                            attempted.append(path)
                            raise PermissionError("recovery directory access denied")
                        return read_directory(path)

                    with patch.object(Path, "iterdir", deny_directory):
                        with self.assertRaisesRegex(PermissionError, "directory access denied"):
                            database.delete_activity_segments([segment_id])

                    self.assertEqual(attempted, [db_path.parent / folder_name])
                    self.assertEqual(connection.execute(
                        "SELECT segment_uid FROM activity_segments").fetchone()[0],
                        "must-remain-until-copies-removed")
                    self.assertEqual([tuple(row) for row in connection.execute(
                        "SELECT * FROM sync_deletions").fetchall()], before_deletions)
                    # Enumeration must finish for both folders before any copy is removed.
                    self.assertEqual(backup.read_bytes(), original_backup)
                    self.assertEqual(quarantine.read_bytes(), original_quarantine)

                    self.assertEqual(database.delete_activity_segments([segment_id]), 1)
                    self.assertEqual(connection.execute(
                        "SELECT count(*) FROM activity_segments").fetchone()[0], 0)
                    self.assertFalse(quarantine.exists())
                    self.assertEqual(connection.execute(
                        "SELECT count(*) FROM sync_deletions").fetchone()[0],
                        len(before_deletions) + 1)
                    for snapshot in database_backup_dir(db_path).iterdir():
                        with closing(sqlite3.connect(snapshot)) as copy:
                            self.assertEqual(copy.execute(
                                "SELECT count(*) FROM activity_segments").fetchone()[0], 0)
                finally:
                    database.close()

    def test_backup_metadata_access_error_is_not_treated_as_a_missing_file(self) -> None:
        database = TrackerDatabase(self.db_path)
        self._insert_marker(database, "metadata-retry")
        backup = create_rotating_backup(database.connect(), self.db_path, interval_seconds=0)
        database.close()
        original_source = b"confirmed corrupt source"
        self.db_path.write_bytes(original_source)
        metadata = Path.stat

        def deny_metadata(path, *args, **kwargs):
            if path == backup:
                raise PermissionError("backup metadata access denied")
            return metadata(path, *args, **kwargs)

        with patch.object(Path, "stat", deny_metadata):
            with self.assertRaisesRegex(PermissionError, "metadata access denied"):
                prepare_database(self.db_path)
            with self.assertRaisesRegex(PermissionError, "metadata access denied"):
                quick_check_database(backup, immutable=True)

        self.assertEqual(self.db_path.read_bytes(), original_source)
        self.assertFalse(database_quarantine_dir(self.db_path).exists())
        recovered = TrackerDatabase(self.db_path)
        try:
            self.assertEqual(recovered.get_meta("maintenance-test"), "metadata-retry")
        finally:
            recovered.close()

    def test_periodic_backup_can_replace_an_unreadable_snapshot_from_healthy_live_data(self) -> None:
        database = TrackerDatabase(self.db_path)
        try:
            self._insert_marker(database, "old")
            previous = create_rotating_backup(
                database.connect(), self.db_path,
                now=datetime.now(timezone.utc) - timedelta(days=2), interval_seconds=0,
            )
            self._insert_marker(database, "healthy-current")
            check = quick_check_database
            attempted = []

            def deny_previous(path, **kwargs):
                if path == previous:
                    attempted.append(path)
                    raise sqlite3.OperationalError("unable to open database file")
                return check(path, **kwargs)

            with patch("app.storage.database_maintenance.quick_check_database",
                       side_effect=deny_previous):
                created = database.create_periodic_backup()

            self.assertEqual(attempted, [previous])
            self.assertIsNotNone(created)
            self.assertEqual(database.get_meta("maintenance-test"), "healthy-current")
            with closing(sqlite3.connect(created)) as snapshot:
                self.assertEqual(snapshot.execute(
                    "SELECT value FROM tracker_meta WHERE key = 'maintenance-test'"
                ).fetchone()[0], "healthy-current")
        finally:
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

    def _seed_windows_recovery(self) -> Path:
        database = TrackerDatabase(self.db_path)
        self._insert_marker(database, "recover-me")
        database.insert_segment(
            {
                "segment_uid": "recovery-windows-row",
                "started_at": "2026-08-02T09:00:00+00:00",
                "ended_at": "2026-08-02T09:01:00+00:00",
                "duration_seconds": 60,
                "app_name": "Synthetic Windows recovery",
                "platform": "windows",
                "source": "win32-foreground",
            }
        )
        backup = create_rotating_backup(
            database.connect(), self.db_path, interval_seconds=0
        )
        self.assertIsNotNone(backup)
        database.close()
        self.db_path.write_bytes(b"not a sqlite database")
        return backup

    def _assert_windows_recovery(self, database: TrackerDatabase) -> None:
        self.assertEqual(database.get_meta("maintenance-test"), "recover-me")
        rows = database.connect().execute(
            "SELECT segment_uid, platform FROM activity_segments"
        ).fetchall()
        self.assertEqual(
            [(row["segment_uid"], row["platform"]) for row in rows],
            [("recovery-windows-row", "windows")],
        )

    def test_failed_restore_retries_without_starting_an_empty_database(self) -> None:
        replace = os.replace

        def fail_restore_replace(source, destination):
            if ".restore-" in Path(source).name:
                raise PermissionError("destination sharing denial")
            return replace(source, destination)

        failures = (
            ("copy denied", "shutil.copy2", PermissionError("copy denied")),
            ("disk full", "shutil.copy2", OSError(errno.ENOSPC, "disk full")),
            ("replace denied", "os.replace", fail_restore_replace),
        )
        for name, target, failure in failures:
            with self.subTest(name=name), TemporaryDirectory() as directory:
                self.db_path = Path(directory) / "tracker.sqlite3"
                backup = self._seed_windows_recovery()
                backup_bytes = backup.read_bytes()
                for _attempt in range(2):
                    with patch(
                        f"app.storage.database_maintenance.{target}",
                        side_effect=failure,
                    ), self.assertRaises(OSError):
                        TrackerDatabase(self.db_path)
                    self.assertFalse(self.db_path.exists())
                    self.assertEqual(backup.read_bytes(), backup_bytes)
                    self.assertEqual(
                        len(list(database_quarantine_dir(self.db_path).glob("*.sqlite3"))),
                        1,
                    )

                recovered = TrackerDatabase(self.db_path)
                self.addCleanup(recovered.close)
                self._assert_windows_recovery(recovered)
                self.assertEqual(recovered.maintenance_result.restored_backup_path, backup)
                self.assertEqual(backup.read_bytes(), backup_bytes)
                self.assertEqual(list(self.db_path.parent.glob("*.tmp")), [])
                recovered.close()

    def test_restore_retries_after_an_abrupt_process_exit(self) -> None:
        backup = self._seed_windows_recovery()
        backup_bytes = backup.read_bytes()
        script = "\n".join(
            (
                "import os, sys",
                "from pathlib import Path",
                "from unittest.mock import patch",
                "from app.storage.db import TrackerDatabase",
                "with patch('app.storage.database_maintenance.shutil.copy2', "
                "side_effect=lambda *_args, **_kwargs: os._exit(73)):",
                "    TrackerDatabase(Path(sys.argv[1]))",
            )
        )
        failed = subprocess.run(
            [sys.executable, "-c", script, str(self.db_path)],
            cwd=SERVICE_ROOT,
            capture_output=True,
            text=True,
            timeout=10,
        )
        self.assertEqual(failed.returncode, 73, failed.stderr)
        self.assertFalse(self.db_path.exists())
        retry_script = "\n".join(
            (
                "import sys",
                "from pathlib import Path",
                "from app.storage.db import TrackerDatabase",
                "db = TrackerDatabase(Path(sys.argv[1]))",
                "assert db.get_meta('maintenance-test') == 'recover-me'",
                "assert db.connect().execute("
                "'SELECT COUNT(*) FROM activity_segments').fetchone()[0] == 1",
                "assert db.maintenance_result.restored_backup_path is not None",
                "db.close()",
            )
        )
        retry = subprocess.run(
            [sys.executable, "-c", retry_script, str(self.db_path)],
            cwd=SERVICE_ROOT,
            capture_output=True,
            text=True,
            timeout=10,
        )
        self.assertEqual(retry.returncode, 0, retry.stderr)
        self.assertEqual(backup.read_bytes(), backup_bytes)

    def test_interrupted_sidecar_quarantine_finishes_before_restore(self) -> None:
        self._seed_windows_recovery()
        wal_path = Path(f"{self.db_path}-wal")
        shm_path = Path(f"{self.db_path}-shm")
        wal_path.write_bytes(b"original wal sidecar")
        shm_path.write_bytes(b"original shm sidecar")
        replace = os.replace

        def fail_shm_move(source, destination):
            if Path(source) == shm_path:
                raise PermissionError("shm sharing denial")
            return replace(source, destination)

        with patch(
            "app.storage.database_maintenance.os.replace", side_effect=fail_shm_move
        ), self.assertRaisesRegex(PermissionError, "shm sharing denial"):
            TrackerDatabase(self.db_path)

        self.assertFalse(self.db_path.exists())
        self.assertTrue(shm_path.exists())
        # SQLite can initialize SHM even during the failed read-only check.
        # Preserve the file left by that first attempt through the retry.
        remaining_shm = shm_path.read_bytes()
        recovered = TrackerDatabase(self.db_path)
        self.addCleanup(recovered.close)
        self._assert_windows_recovery(recovered)
        quarantine = recovered.maintenance_result.quarantined_path
        self.assertIsNotNone(quarantine)
        self.assertEqual(Path(f"{quarantine}-wal").read_bytes(), b"original wal sidecar")
        self.assertEqual(Path(f"{quarantine}-shm").read_bytes(), remaining_shm)

    def test_interrupted_quarantine_without_backup_preserves_sidecars_on_retry(self) -> None:
        original = b"corrupt source with no verified backup"
        self.db_path.write_bytes(original)
        wal_path = Path(f"{self.db_path}-wal")
        shm_path = Path(f"{self.db_path}-shm")
        wal_path.write_bytes(b"uncheckpointed source wal")
        shm_path.write_bytes(b"source shm")
        replace = os.replace

        def fail_wal_move(source, destination):
            if Path(source) == wal_path:
                raise PermissionError("wal sharing denial")
            return replace(source, destination)

        with patch(
            "app.storage.database_maintenance.os.replace", side_effect=fail_wal_move
        ), self.assertRaisesRegex(PermissionError, "wal sharing denial"):
            TrackerDatabase(self.db_path)
        self.assertFalse(self.db_path.exists())
        remaining_shm = shm_path.read_bytes()
        with self.assertRaisesRegex(sqlite3.DatabaseError, "recovery is pending"):
            TrackerDatabase(self.db_path, perform_maintenance=False)

        recovered = TrackerDatabase(self.db_path)
        self.addCleanup(recovered.close)
        quarantine = recovered.maintenance_result.quarantined_path
        self.assertIsNotNone(quarantine)
        self.assertEqual(quarantine.read_bytes(), original)
        self.assertEqual(Path(f"{quarantine}-wal").read_bytes(), b"uncheckpointed source wal")
        self.assertEqual(Path(f"{quarantine}-shm").read_bytes(), remaining_shm)
        self.assertIsNone(recovered.maintenance_result.restored_backup_path)
        self.assertTrue(quick_check_database(self.db_path))
        self.assertFalse((self.db_path.parent / ".tracker.sqlite3.recovery-pending").exists())

    def test_no_backup_quarantine_resumes_after_process_exit_during_source_move(self) -> None:
        original = b"corrupt source requiring quarantine only"
        self.db_path.write_bytes(original)
        wal_path = Path(f"{self.db_path}-wal")
        wal_path.write_bytes(b"preserve wal across process exit")
        script = "\n".join((
            "import os, sys",
            "from pathlib import Path",
            "from unittest.mock import patch",
            "from app.storage.database_maintenance import prepare_database",
            "path = Path(sys.argv[1])",
            "replace = os.replace",
            "def exit_after_move(source, destination):",
            "    replace(source, destination)",
            "    if Path(source) == path: os._exit(73)",
            "with patch('app.storage.database_maintenance.os.replace', side_effect=exit_after_move):",
            "    prepare_database(path)",
        ))
        failed = subprocess.run(
            [sys.executable, "-c", script, str(self.db_path)],
            cwd=SERVICE_ROOT, capture_output=True, text=True, timeout=10,
        )
        self.assertEqual(failed.returncode, 73, failed.stderr)
        self.assertFalse(self.db_path.exists())
        recovered = TrackerDatabase(self.db_path)
        self.addCleanup(recovered.close)
        quarantine = recovered.maintenance_result.quarantined_path
        self.assertIsNotNone(quarantine)
        self.assertEqual(quarantine.read_bytes(), original)
        self.assertEqual(Path(f"{quarantine}-wal").read_bytes(), b"preserve wal across process exit")
        self.assertTrue(quick_check_database(self.db_path))
        self.assertIsNone(recovered.maintenance_result.restored_backup_path)

    def test_missing_database_with_old_recovery_copies_is_a_fresh_install(self) -> None:
        self._seed_windows_recovery()
        recovered = TrackerDatabase(self.db_path)
        self._assert_windows_recovery(recovered)
        recovered.close()
        self.db_path.unlink()
        self.assertTrue(database_backup_dir(self.db_path).is_dir())
        self.assertTrue(database_quarantine_dir(self.db_path).is_dir())

        fresh = TrackerDatabase(self.db_path)
        self.addCleanup(fresh.close)
        self.assertFalse(fresh.maintenance_result.existed)
        self.assertIsNone(fresh.maintenance_result.restored_backup_path)
        self.assertIsNone(fresh.get_meta("maintenance-test"))
        self.assertEqual(fresh.fetch_timeline("2026-08-02"), [])

    def test_pending_restore_with_no_valid_backup_does_not_start_fresh(self) -> None:
        backup = self._seed_windows_recovery()
        backup_bytes = backup.read_bytes()
        with patch(
            "app.storage.database_maintenance.shutil.copy2",
            side_effect=PermissionError("copy denied"),
        ), self.assertRaises(PermissionError):
            TrackerDatabase(self.db_path)
        backup.write_bytes(b"invalid backup")

        with self.assertRaises(sqlite3.DatabaseError):
            TrackerDatabase(self.db_path)
        self.assertFalse(self.db_path.exists())
        self.assertEqual(len(list(database_quarantine_dir(self.db_path).glob("*.sqlite3"))), 1)
        backup.write_bytes(backup_bytes)
        recovered = TrackerDatabase(self.db_path)
        self.addCleanup(recovered.close)
        self._assert_windows_recovery(recovered)

    def test_completed_restore_with_failed_record_cleanup_keeps_newer_writes(self) -> None:
        self._seed_windows_recovery()
        unlink = Path.unlink

        def fail_record_cleanup(path, *args, **kwargs):
            if path.name.endswith(".recovery-pending"):
                raise PermissionError("record cleanup denied")
            return unlink(path, *args, **kwargs)

        with patch.object(Path, "unlink", fail_record_cleanup), self.assertRaisesRegex(
            PermissionError, "record cleanup denied"
        ):
            TrackerDatabase(self.db_path)
        self.assertTrue(quick_check_database(self.db_path))
        with self.assertRaisesRegex(sqlite3.DatabaseError, "recovery.*pending"):
            TrackerDatabase(self.db_path, perform_maintenance=False)
        # A connection that was already open may have written after publication.
        # A successful retry must preserve that healthy database, not replay an
        # older backup merely because clearing the recovery record failed.
        with closing(sqlite3.connect(self.db_path)) as connection:
            with connection:
                connection.execute(
                    "UPDATE tracker_meta SET value = 'written-after-restore' "
                    "WHERE key = 'maintenance-test'"
                )

        with closing(TrackerDatabase(self.db_path)) as reopened:
            self.assertEqual(reopened.get_meta("maintenance-test"), "written-after-restore")
            self.assertIsNone(reopened.maintenance_result.restored_backup_path)
        self.assertEqual(list(self.db_path.parent.glob("*.recovery-pending")), [])

    def test_recovery_record_failure_leaves_the_original_in_place(self) -> None:
        self._seed_windows_recovery()
        original = self.db_path.read_bytes()
        replace = os.replace

        def fail_record_publish(source, destination):
            if Path(destination).name.endswith(".recovery-pending"):
                raise OSError(errno.ENOSPC, "record disk full")
            return replace(source, destination)

        with patch(
            "app.storage.database_maintenance.os.replace", side_effect=fail_record_publish
        ), self.assertRaisesRegex(OSError, "record disk full"):
            TrackerDatabase(self.db_path)
        self.assertEqual(self.db_path.read_bytes(), original)
        self.assertEqual(list(self.db_path.parent.glob("*.tmp")), [])
        with closing(TrackerDatabase(self.db_path)) as recovered:
            self._assert_windows_recovery(recovered)

    def test_malformed_recovery_record_never_uses_an_arbitrary_path(self) -> None:
        self._seed_windows_recovery()
        with patch(
            "app.storage.database_maintenance.shutil.copy2",
            side_effect=PermissionError("copy denied"),
        ), self.assertRaises(PermissionError):
            TrackerDatabase(self.db_path)
        record = next(self.db_path.parent.glob("*.recovery-pending"))
        valid_record = record.read_text()
        for invalid in ("../foreign.sqlite3", "quarantine-only:../foreign.sqlite3"):
            with self.subTest(record=invalid):
                record.write_text(invalid)
                with self.assertRaisesRegex(sqlite3.DatabaseError, "invalid pending"):
                    TrackerDatabase(self.db_path)
                self.assertFalse(self.db_path.exists())
        record.write_text(valid_record)
        with closing(TrackerDatabase(self.db_path)) as recovered:
            self._assert_windows_recovery(recovered)

    def test_permanent_delete_clears_a_leftover_recovery_record(self) -> None:
        self._seed_windows_recovery()
        with closing(TrackerDatabase(self.db_path)) as database:
            quarantine = database.maintenance_result.quarantined_path
            self.assertIsNotNone(quarantine)
            # Exercise deletion through an already initialized connection. New
            # workers must refuse to open while a recovery record is present.
            record = self.db_path.parent / f".{self.db_path.name}.recovery-pending"
            record.write_text(quarantine.name, encoding="utf-8")
            segment_id = str(database.connect().execute(
                "SELECT id FROM activity_segments"
            ).fetchone()["id"])
            self.assertEqual(database.delete_activity_segments([segment_id]), 1)
        self.assertFalse(record.exists())
        self.db_path.write_bytes(b"not a sqlite database")
        with closing(TrackerDatabase(self.db_path)) as recovered:
            self.assertEqual(recovered.fetch_timeline("2026-08-02"), [])

    def test_worker_cannot_create_a_fresh_database_during_pending_recovery(self) -> None:
        backup = self._seed_windows_recovery()
        with patch(
            "app.storage.database_maintenance.shutil.copy2",
            side_effect=PermissionError("copy denied"),
        ), self.assertRaises(PermissionError):
            TrackerDatabase(self.db_path)

        for _attempt in range(2):
            with self.assertRaisesRegex(sqlite3.DatabaseError, "recovery.*pending"):
                TrackerDatabase(self.db_path, perform_maintenance=False)
            self.assertFalse(self.db_path.exists())
        self.assertTrue(quick_check_database(backup, immutable=True))
        with closing(TrackerDatabase(self.db_path)) as recovered:
            self._assert_windows_recovery(recovered)

    def test_pending_restore_does_not_require_the_corrupt_quarantine_copy(self) -> None:
        self._seed_windows_recovery()
        with patch(
            "app.storage.database_maintenance.shutil.copy2",
            side_effect=PermissionError("copy denied"),
        ), self.assertRaises(PermissionError):
            TrackerDatabase(self.db_path)
        quarantined = next(database_quarantine_dir(self.db_path).glob("*.sqlite3"))
        quarantined.unlink()

        with closing(TrackerDatabase(self.db_path)) as recovered:
            self._assert_windows_recovery(recovered)
            self.assertIsNotNone(recovered.maintenance_result.restored_backup_path)
            self.assertIsNone(recovered.maintenance_result.quarantined_path)
        with closing(TrackerDatabase(self.db_path)) as reopened:
            self._assert_windows_recovery(reopened)

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
        refreshed_backups = list(
            database_backup_dir(self.db_path).glob("tracker-*.sqlite3")
        )
        self.assertEqual(len(refreshed_backups), 1)
        self.assertTrue(quick_check_database(refreshed_backups[0], immutable=True))
        database.close()

        self.db_path.write_bytes(b"not a sqlite database")
        recovered = TrackerDatabase(self.db_path)

        self.assertEqual(
            recovered.maintenance_result.restored_backup_path,
            refreshed_backups[0],
        )
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
        refreshed_backups = list(
            database_backup_dir(self.db_path).glob("tracker-*.sqlite3")
        )
        self.assertEqual(len(refreshed_backups), 1)
        with closing(sqlite3.connect(refreshed_backups[0])) as snapshot:
            self.assertEqual(
                snapshot.execute("SELECT COUNT(*) FROM activity_segments").fetchone()[0],
                0,
            )
        database.close()

    def test_post_delete_backup_failure_keeps_the_delete_and_records_diagnostics(self) -> None:
        database = TrackerDatabase(self.db_path)
        database.insert_segment(
            {
                "started_at": "2026-08-02T09:00:00+00:00",
                "ended_at": "2026-08-02T09:01:00+00:00",
                "duration_seconds": 60,
                "app_name": "Delete even if disk is full",
            }
        )
        with database.connect() as connection:
            segment_id = str(
                connection.execute("SELECT id FROM activity_segments").fetchone()["id"]
            )
        older_backup = create_rotating_backup(
            database.connect(), self.db_path, interval_seconds=0
        )
        self.assertIsNotNone(older_backup)

        with patch(
            "app.storage.database_maintenance._create_rotating_backup_locked",
            side_effect=OSError("disk full"),
        ):
            deleted = database.delete_activity_segments([segment_id])

        self.assertEqual(deleted, 1)
        self.assertEqual(database.fetch_timeline("2026-08-02"), [])
        self.assertFalse(older_backup.exists())
        self.assertEqual(
            list(database_backup_dir(self.db_path).glob("tracker-*.sqlite3")), []
        )
        self.assertEqual(database.maintenance_error, "disk full")
        database.close()

    def test_vacuum_failure_does_not_turn_a_committed_delete_into_failure(self) -> None:
        database = TrackerDatabase(self.db_path)
        with database.connect() as connection:
            connection.execute(
                """
                WITH RECURSIVE sequence(value) AS (
                    SELECT 1
                    UNION ALL
                    SELECT value + 1 FROM sequence WHERE value < 1000
                )
                INSERT INTO activity_segments (
                    started_at,
                    ended_at,
                    duration_seconds,
                    app_name,
                    platform,
                    source
                )
                SELECT
                    '2026-08-02T09:00:00+00:00',
                    '2026-08-02T09:00:01+00:00',
                    1,
                    'Bulk delete',
                    'macos',
                    'accessibility'
                FROM sequence
                """
            )

        class VacuumFailingConnection:
            def __init__(self, connection: sqlite3.Connection):
                self.connection = connection

            def __enter__(self):
                self.connection.__enter__()
                return self

            def __exit__(self, *args):
                return self.connection.__exit__(*args)

            def execute(self, sql: str, parameters=()):
                if sql == "VACUUM":
                    raise sqlite3.OperationalError("vacuum locked")
                return self.connection.execute(sql, parameters)

            def __getattr__(self, name: str):
                return getattr(self.connection, name)

        failing_connection = VacuumFailingConnection(database.connect())
        with patch.object(database, "connect", return_value=failing_connection):
            result = database.delete_history_range(
                scopes={"activity": True},
            )

        self.assertEqual(result["activitySegments"], 1000)
        self.assertEqual(database.fetch_timeline("2026-08-02"), [])
        self.assertEqual(database.maintenance_error, "vacuum locked")
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
