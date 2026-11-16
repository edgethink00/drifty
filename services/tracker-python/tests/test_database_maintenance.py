from __future__ import annotations

import errno
import os
import sqlite3
import subprocess
import sys
import threading
import textwrap
import unittest
from contextlib import closing, contextmanager
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
from app.tracker.capture_contract import Snapshot
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

    def test_zero_page_database_is_not_a_valid_recovery_copy(self) -> None:
        self.db_path.write_bytes(b"")
        for immutable in (False, True):
            with self.subTest(immutable=immutable):
                self.assertFalse(quick_check_database(self.db_path, immutable=immutable))
        self.assertEqual(self.db_path.read_bytes(), b"")

    def test_directory_at_database_path_is_preserved_without_bootstrapping(self) -> None:
        self.db_path.mkdir()
        marker = self.db_path / "preserved.txt"
        marker.write_bytes(b"synthetic directory contents")

        with self.assertRaisesRegex(sqlite3.OperationalError, "not a regular file"):
            TrackerDatabase(self.db_path)

        self.assertTrue(self.db_path.is_dir())
        self.assertEqual(marker.read_bytes(), b"synthetic directory contents")
        self.assertFalse(database_quarantine_dir(self.db_path).exists())

    def _seed_corrupt_database_with_rollback_journal(self) -> bytes:
        with closing(sqlite3.connect(self.db_path)) as connection:
            connection.execute("CREATE TABLE preserved (value TEXT)")
            connection.execute("INSERT INTO preserved VALUES ('rollback-original')")
            connection.commit()
            self.assertIsNotNone(create_rotating_backup(connection, self.db_path, interval_seconds=0))
        # An interrupted, uncommitted transaction leaves real rollback pages.
        # The source is then independently corrupted; recovery must preserve
        # the journal together with that source before opening its replacement.
        script = textwrap.dedent("""
            import os, sqlite3, sys
            connection = sqlite3.connect(sys.argv[1])
            connection.execute('BEGIN IMMEDIATE')
            connection.execute("UPDATE preserved SET value = 'uncommitted'")
            os._exit(0)
        """)
        child = subprocess.run(
            [sys.executable, "-c", script, str(self.db_path)],
            capture_output=True, text=True, timeout=15,
        )
        self.assertEqual(child.returncode, 0, child.stderr)
        original = Path(f"{self.db_path}-journal").read_bytes()
        self.assertIn(b"rollback-original", original)
        self.db_path.write_bytes(b"synthetic confirmed corruption")
        return original

    def _assert_rollback_journal_recovery(self, original: bytes) -> None:
        recovered = TrackerDatabase(self.db_path)
        self.addCleanup(recovered.close)
        quarantine = recovered.maintenance_result.quarantined_path
        self.assertIsNotNone(quarantine)
        self.assertEqual(quarantine.read_bytes(), b"synthetic confirmed corruption")
        quarantined_journal = Path(f"{quarantine}-journal")
        self.assertTrue(quarantined_journal.is_file())
        self.assertEqual(quarantined_journal.read_bytes(), original)
        self.assertIsNotNone(recovered.maintenance_result.restored_backup_path)
        with recovered.connect() as connection:
            self.assertEqual(connection.execute("SELECT value FROM preserved").fetchone()[0], "rollback-original")

    def test_recovery_preserves_real_rollback_journal_before_replacement_opens(self) -> None:
        original = self._seed_corrupt_database_with_rollback_journal()
        self._assert_rollback_journal_recovery(original)

    def test_interrupted_rollback_journal_move_blocks_replacement_until_retry(self) -> None:
        original = self._seed_corrupt_database_with_rollback_journal()
        journal = Path(f"{self.db_path}-journal")
        replace = os.replace

        def fail_journal_move(source, destination):
            if Path(source) == journal:
                raise PermissionError("journal sharing denial")
            return replace(source, destination)

        with patch(
            "app.storage.database_maintenance.os.replace", side_effect=fail_journal_move
        ), self.assertRaisesRegex(PermissionError, "journal sharing denial"):
            unexpected = TrackerDatabase(self.db_path)
            unexpected.close()

        self.assertFalse(self.db_path.exists())
        self.assertEqual(journal.read_bytes(), original)
        with self.assertRaisesRegex(sqlite3.DatabaseError, "recovery is pending"):
            TrackerDatabase(self.db_path, perform_maintenance=False)
        self.assertFalse(self.db_path.exists())
        self._assert_rollback_journal_recovery(original)

    def test_startup_preserves_a_checkpointed_wal_database_without_sidecars(self) -> None:
        with closing(sqlite3.connect(self.db_path)) as connection:
            connection.execute("PRAGMA journal_mode=WAL").fetchall()
            connection.execute("CREATE TABLE preserved (value TEXT)")
            connection.execute("INSERT INTO preserved VALUES ('keep-me')")
            connection.commit()
            self.assertEqual(connection.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone(), (0, 0, 0))
        # Apple's SQLite can leave an empty WAL/index after closing. Model a
        # closed, fully checkpointed source whose disposable sidecars are gone.
        wal = Path(f"{self.db_path}-wal")
        if wal.exists():
            self.assertEqual(wal.stat().st_size, 0)
        wal.unlink(missing_ok=True)
        Path(f"{self.db_path}-shm").unlink(missing_ok=True)
        original = self.db_path.read_bytes()

        result = prepare_database(self.db_path)

        self.assertTrue(result.existed)
        self.assertIsNone(result.quarantined_path)
        self.assertIsNone(result.restored_backup_path)
        self.assertEqual(self.db_path.read_bytes(), original)
        with closing(sqlite3.connect(self.db_path)) as connection:
            self.assertEqual(connection.execute("SELECT value FROM preserved").fetchall(), [("keep-me",)])
        self.assertFalse(database_quarantine_dir(self.db_path).exists())

    def test_startup_checks_include_committed_pages_still_in_live_wal(self) -> None:
        with closing(sqlite3.connect(self.db_path)) as writer:
            writer.execute("PRAGMA journal_mode=WAL").fetchall()
            writer.execute("PRAGMA wal_autocheckpoint=0")
            writer.execute("CREATE TABLE preserved (value TEXT)")
            writer.execute("INSERT INTO preserved VALUES ('in-the-wal')")
            writer.commit()
            self.assertGreater(Path(f"{self.db_path}-wal").stat().st_size, 0)
            result = prepare_database(self.db_path)
            self.assertTrue(result.existed)
            self.assertIsNone(result.quarantined_path)
            with closing(sqlite3.connect(self.db_path)) as reader:
                self.assertEqual(reader.execute("SELECT value FROM preserved").fetchall(), [("in-the-wal",)])

    def test_check_does_not_recreate_a_source_removed_after_file_inspection(self) -> None:
        self.db_path.write_bytes(b"fixture checked before replacement")
        connect = sqlite3.connect

        def remove_before_open(*args, **kwargs):
            self.db_path.unlink()
            return connect(*args, **kwargs)

        with patch("app.storage.database_maintenance.sqlite3.connect", side_effect=remove_before_open):
            with self.assertRaises(sqlite3.OperationalError):
                quick_check_database(self.db_path)
        self.assertFalse(self.db_path.exists())

    def test_permanent_delete_removes_backup_interrupted_by_worker_shutdown(self) -> None:
        database = TrackerDatabase(self.db_path, perform_maintenance=False)
        self.addCleanup(database.close)
        database.record_snapshot(Snapshot(datetime.now(timezone.utc).isoformat(), 'Editor',
                                          'fixture.editor', 'Delete me', 'test'), 5)
        segment_id = str(database.connect().execute('SELECT id FROM activity_segments').fetchone()[0])
        script = textwrap.dedent('''
            import sys,threading
            from pathlib import Path
            from unittest.mock import patch
            from app.daemon_maintenance import DaemonMaintenance
            from app.storage import database_maintenance as storage
            ready=threading.Event()
            original=storage.quick_check_database
            def slow_verify(path, **kwargs):
                valid=original(path, **kwargs)
                if path.name.endswith('.tmp'):
                    ready.set()
                    threading.Event().wait(60)
                return valid
            with patch.object(storage,'quick_check_database',side_effect=slow_verify):
                worker=DaemonMaintenance(Path(sys.argv[1]),backfill_days=30,max_files=40)
                worker.request_backup()
                if not ready.wait(5):raise RuntimeError('backup never reached verification')
                worker.close()
        ''')
        result = subprocess.run([sys.executable, '-c', script, str(self.db_path)],
                                cwd=SERVICE_ROOT, capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        interrupted = list(database_backup_dir(self.db_path).glob('.*.tmp'))
        self.assertEqual(len(interrupted), 1)
        with closing(sqlite3.connect(f'{interrupted[0].as_uri()}?mode=ro&immutable=1', uri=True)) as copy:
            self.assertEqual(copy.execute('SELECT count(*) FROM activity_segments').fetchone()[0], 1)
        self.assertEqual(database.delete_activity_segments([segment_id]), 1)
        self.assertFalse(interrupted[0].exists(), 'permanent deletion left an interrupted copy containing deleted activity')
        for backup in database_backup_dir(self.db_path).glob('*.sqlite3'):
            with closing(sqlite3.connect(f'{backup.as_uri()}?mode=ro&immutable=1', uri=True)) as copy:
                self.assertEqual(copy.execute('SELECT count(*) FROM activity_segments').fetchone()[0], 0)

    def test_permanent_delete_removes_restore_interrupted_by_process_exit(self) -> None:
        database = TrackerDatabase(self.db_path, perform_maintenance=False)
        database.record_snapshot(
            Snapshot(datetime.now(timezone.utc).isoformat(), 'Editor',
                     'fixture.editor', 'Delete me', 'test'), 5
        )
        segment_id = str(database.connect().execute(
            'SELECT id FROM activity_segments'
        ).fetchone()[0])
        create_rotating_backup(database.connect(), self.db_path, interval_seconds=0)
        database.close()
        self.db_path.write_bytes(b'corrupt source requiring restore')
        script = textwrap.dedent('''
            import os,sys
            from pathlib import Path
            from unittest.mock import patch
            from app.storage import database_maintenance as storage
            from app.storage.db import TrackerDatabase
            copy=storage.shutil.copy2
            def exit_after_copy(source,destination):
                result=copy(source,destination)
                if '.restore-' in Path(destination).name:
                    os._exit(73)
                return result
            with patch.object(storage.shutil,'copy2',side_effect=exit_after_copy):
                TrackerDatabase(Path(sys.argv[1]))
        ''')
        result = subprocess.run(
            [sys.executable, '-c', script, str(self.db_path)],
            cwd=SERVICE_ROOT, capture_output=True, text=True, timeout=10
        )
        self.assertEqual(result.returncode, 73, result.stderr)
        interrupted = list(self.db_path.parent.glob('.tracker.sqlite3.restore-*.tmp'))
        self.assertEqual(len(interrupted), 1)
        with closing(sqlite3.connect(
            interrupted[0].as_uri() + '?mode=ro&immutable=1', uri=True
        )) as copy:
            self.assertEqual(copy.execute('SELECT count(*) FROM activity_segments').fetchone()[0], 1)
        reopened = TrackerDatabase(self.db_path)
        self.addCleanup(reopened.close)
        self.assertEqual(reopened.delete_activity_segments([segment_id]), 1)
        self.assertEqual(reopened.connect().execute('SELECT count(*) FROM activity_segments').fetchone()[0], 0)
        self.assertFalse(interrupted[0].exists(), 'permanent deletion left the interrupted restore containing deleted activity')

    def test_history_range_delete_removes_interrupted_restore_copy(self) -> None:
        database = TrackerDatabase(self.db_path, perform_maintenance=False)
        self.addCleanup(database.close)
        database.insert_segment({
            'started_at': '2026-10-07T09:00:00+00:00',
            'ended_at': '2026-10-07T09:01:00+00:00',
            'duration_seconds': 60, 'app_name': 'Delete me',
        })
        backup = create_rotating_backup(database.connect(), self.db_path, interval_seconds=0)
        interrupted = self.db_path.with_name(f'.{self.db_path.name}.restore-{"a"*32}.tmp')
        interrupted.write_bytes(backup.read_bytes())
        result = database.delete_history_range(
            start='2026-10-07', end='2026-10-07', scopes={'activity': True}
        )
        self.assertEqual(result['activitySegments'], 1)
        self.assertFalse(interrupted.exists())
        for recovery in database_backup_dir(self.db_path).glob('*.sqlite3'):
            with closing(sqlite3.connect(
                recovery.as_uri() + '?mode=ro&immutable=1', uri=True
            )) as copy:
                self.assertEqual(copy.execute('SELECT count(*) FROM activity_segments').fetchone()[0], 0)

    def test_restore_cleanup_keeps_foreign_and_unrecognized_files(self) -> None:
        self.db_path = self.db_path.with_name('tracker[qa].sqlite3')
        database = TrackerDatabase(self.db_path, perform_maintenance=False)
        self.addCleanup(database.close)
        database.record_snapshot(
            Snapshot(datetime.now(timezone.utc).isoformat(), 'Editor',
                     'fixture.editor', 'Delete me', 'test'), 5
        )
        segment_id = str(database.connect().execute('SELECT id FROM activity_segments').fetchone()[0])
        backup = create_rotating_backup(database.connect(), self.db_path, interval_seconds=0)
        interrupted = self.db_path.with_name(f'.{self.db_path.name}.restore-{"b"*32}.tmp')
        interrupted.write_bytes(backup.read_bytes())
        sidecars = [Path(str(interrupted) + suffix) for suffix in ('-wal', '-shm', '-journal')]
        for sidecar in sidecars:
            sidecar.write_bytes(b'owned closed restore sidecar')
        foreign = [
            self.db_path.with_name(f'.tracker[qa].db.restore-{"b"*32}.tmp'),
            self.db_path.with_name(f'.trackerq.sqlite3.restore-{"b"*32}.tmp'),
            self.db_path.with_name(f'.tracker[qa].sqlite3.restore-{"b"*31}.tmp'),
            self.db_path.with_name(f'.tracker[qa].sqlite3.restore-{"z"*32}.tmp'),
            Path(str(interrupted) + '-custom'),
        ]
        for path in foreign:
            path.write_bytes(backup.read_bytes())
        expected = {path: path.read_bytes() for path in foreign}
        self.assertEqual(database.delete_activity_segments([segment_id]), 1)
        self.assertFalse(any(path.exists() for path in [interrupted, *sidecars]))
        self.assertEqual({path: path.read_bytes() for path in foreign}, expected)

    def test_unremovable_restore_copy_prevents_permanent_delete(self) -> None:
        database = TrackerDatabase(self.db_path, perform_maintenance=False)
        self.addCleanup(database.close)
        database.record_snapshot(
            Snapshot(datetime.now(timezone.utc).isoformat(), 'Editor',
                     'fixture.editor', 'Keep until deletion can complete', 'test'), 5
        )
        segment_id = str(database.connect().execute('SELECT id FROM activity_segments').fetchone()[0])
        backup = create_rotating_backup(database.connect(), self.db_path, interval_seconds=0)
        interrupted = self.db_path.with_name(f'.{self.db_path.name}.restore-{"c"*32}.tmp')
        interrupted.write_bytes(backup.read_bytes())
        expected_backup = backup.read_bytes()
        unlink = Path.unlink
        def deny_restore_unlink(path, *args, **kwargs):
            if path == interrupted:
                raise PermissionError('restore copy sharing denial')
            return unlink(path, *args, **kwargs)
        with patch.object(Path, 'unlink', deny_restore_unlink):
            with self.assertRaisesRegex(PermissionError, 'restore copy sharing denial'):
                database.delete_activity_segments([segment_id])
        self.assertEqual(database.connect().execute('SELECT count(*) FROM activity_segments').fetchone()[0], 1)
        self.assertEqual(interrupted.read_bytes(), expected_backup)
        self.assertEqual(backup.read_bytes(), expected_backup)

    def test_restore_named_database_ownership_blocks_cleanup(self) -> None:
        database = TrackerDatabase(self.db_path, perform_maintenance=False)
        self.addCleanup(database.close)
        database.record_snapshot(
            Snapshot(datetime.now(timezone.utc).isoformat(), 'Editor',
                     'fixture.editor', 'Keep until ownership is resolved', 'test'), 5
        )
        segment_id = str(database.connect().execute('SELECT id FROM activity_segments').fetchone()[0])
        foreign_path = self.db_path.with_name(f'.{self.db_path.name}.restore-{"d"*32}.tmp')
        foreign = TrackerDatabase(foreign_path, perform_maintenance=False)
        self._insert_marker(foreign, 'foreign database')
        foreign.close()
        expected = foreign_path.read_bytes()
        with self.assertRaisesRegex(sqlite3.DatabaseError, 'ambiguous.*restore'):
            database.delete_activity_segments([segment_id])
        self.assertEqual(database.connect().execute('SELECT count(*) FROM activity_segments').fetchone()[0], 1)
        self.assertEqual(foreign_path.read_bytes(), expected)

    def test_backup_reuse_cleans_only_owned_interrupted_files(self) -> None:
        database = TrackerDatabase(self.db_path)
        self.addCleanup(database.close)
        backup = create_rotating_backup(database.connect(), self.db_path, interval_seconds=0)
        temp = backup.with_name(f'.{self.db_path.name}-20261005T010000000000Z.{"a"*32}.tmp')
        temp.write_bytes(backup.read_bytes())
        sidecars = [Path(str(temp)+suffix) for suffix in ('-wal','-shm','-journal')]
        for path in sidecars:
            path.write_bytes(b'interrupted')
        unrelated = [backup.with_name('.tracker-not-generated.sqlite3.unknown.tmp'),
                     backup.with_name(f'.other.sqlite3-20261005T010000000000Z.{"a"*32}.tmp'),
                     backup.with_name(f'.{backup.name}.{"a"*32}.tmp')]
        for path in unrelated:
            path.write_bytes(b'preserve')
        self.assertIsNone(create_rotating_backup(database.connect(), self.db_path))
        self.assertTrue(backup.exists())
        self.assertTrue(all(path.exists() for path in unrelated))
        self.assertFalse(any(path.exists() for path in [temp,*sidecars]))

    def test_cleanup_preserves_active_backup_for_same_stem_other_database(self) -> None:
        first = TrackerDatabase(self.db_path, perform_maintenance=False)
        self.addCleanup(first.close)
        other_path = self.db_path.with_suffix('.db')
        other = TrackerDatabase(other_path, perform_maintenance=False)
        other.close()
        from app.storage import database_maintenance as storage
        original = storage.quick_check_database
        entered, release = threading.Event(), threading.Event()
        errors, backups = [], []
        def verify(path, **kwargs):
            if path.name.endswith('.tmp') and threading.current_thread() is thread:
                entered.set()
                if not release.wait(5):
                    raise AssertionError('backup verification was not released')
            return original(path, **kwargs)
        def run():
            db = TrackerDatabase(other_path, perform_maintenance=False)
            try:
                backups.append(create_rotating_backup(db.connect(), other_path, interval_seconds=0))
            except Exception as error:
                errors.append(error)
            finally:
                db.close()
        thread = threading.Thread(target=run)
        with patch.object(storage, 'quick_check_database', side_effect=verify):
            thread.start()
            try:
                self.assertTrue(entered.wait(5))
                create_rotating_backup(first.connect(), self.db_path, interval_seconds=0)
            finally:
                release.set()
                thread.join(5)
        self.assertFalse(thread.is_alive())
        self.assertEqual(errors, [])
        self.assertTrue(backups[0].exists())

    def test_unremovable_interrupted_backup_prevents_permanent_delete(self) -> None:
        database = TrackerDatabase(self.db_path)
        self.addCleanup(database.close)
        database.record_snapshot(Snapshot(datetime.now(timezone.utc).isoformat(), 'Editor',
                                          'fixture.editor', 'Keep on failure', 'test'), 5)
        segment_id = str(database.connect().execute('SELECT id FROM activity_segments').fetchone()[0])
        backup = create_rotating_backup(database.connect(), self.db_path, interval_seconds=0)
        temp = backup.with_name(f'.{self.db_path.name}-20261005T010000000000Z.{"b"*32}.tmp')
        temp.write_bytes(backup.read_bytes())
        unlink = Path.unlink
        def refuse(path, *args, **kwargs):
            if path == temp:
                raise PermissionError('synthetic locked backup')
            return unlink(path, *args, **kwargs)
        with patch.object(Path, 'unlink', refuse), self.assertRaises(PermissionError):
            database.delete_activity_segments([segment_id])
        self.assertEqual(database.connect().execute('SELECT count(*) FROM activity_segments').fetchone()[0], 1)
        self.assertTrue(temp.exists())

    def test_truncated_empty_source_recovers_the_existing_backup(self) -> None:
        database = TrackerDatabase(self.db_path)
        self._insert_marker(database, "recover-empty-source")
        backup = create_rotating_backup(database.connect(), self.db_path, interval_seconds=0)
        database.close()
        self.db_path.write_bytes(b"")
        recovered = TrackerDatabase(self.db_path)
        try:
            self.assertEqual(recovered.get_meta("maintenance-test"), "recover-empty-source")
            self.assertEqual(recovered.maintenance_result.restored_backup_path, backup)
            self.assertEqual(recovered.maintenance_result.quarantined_path.read_bytes(), b"")
        finally:
            recovered.close()

    def test_newer_empty_backup_does_not_hide_the_valid_older_snapshot(self) -> None:
        database = TrackerDatabase(self.db_path)
        self._insert_marker(database, "valid-older")
        backup = create_rotating_backup(database.connect(), self.db_path, interval_seconds=0)
        database.close()
        empty = backup.parent / "tracker-20990101T000000000000Z.sqlite3"
        empty.write_bytes(b"")
        self.db_path.write_bytes(b"confirmed corrupt source")
        recovered = TrackerDatabase(self.db_path)
        try:
            self.assertEqual(recovered.get_meta("maintenance-test"), "valid-older")
            self.assertEqual(recovered.maintenance_result.restored_backup_path, backup)
            self.assertEqual(empty.read_bytes(), b"")
        finally:
            recovered.close()

    def test_initialized_empty_sqlite_database_remains_valid(self) -> None:
        with closing(sqlite3.connect(self.db_path)) as connection:
            connection.execute("PRAGMA user_version = 1")
        self.assertTrue(quick_check_database(self.db_path))
        self.assertTrue(quick_check_database(self.db_path, immutable=True))

    def test_fresh_zero_page_source_without_backup_can_still_initialize(self) -> None:
        self.db_path.write_bytes(b"")
        database = TrackerDatabase(self.db_path)
        try:
            self._insert_marker(database, "new-database")
            self.assertEqual(database.get_meta("maintenance-test"), "new-database")
            self.assertTrue(quick_check_database(self.db_path))
        finally:
            database.close()

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

    @contextmanager
    def _deny_sqlite_pragma_authorization(self, path: Path):
        # Keep the real SQLite engine: its authorizer produces SQLITE_AUTH,
        # rather than injecting a preconstructed exception into quick_check.
        connect = sqlite3.connect
        denied = []

        def open_with_authorizer(database, *args, **kwargs):
            connection = connect(database, *args, **kwargs)
            if str(database).startswith(path.resolve().as_uri() + "?"):
                def authorize(action, *_arguments):
                    if action == sqlite3.SQLITE_PRAGMA:
                        denied.append(action)
                        return sqlite3.SQLITE_DENY
                    return sqlite3.SQLITE_OK

                connection.set_authorizer(authorize)
            return connection

        with patch("app.storage.database_maintenance.sqlite3.connect", open_with_authorizer):
            yield denied

    def test_sqlite_authorization_denial_preserves_newer_live_wal_over_backup(self) -> None:
        with closing(TrackerDatabase(self.db_path)) as database:
            self._insert_marker(database, "older-backup")
            backup = create_rotating_backup(database.connect(), self.db_path, interval_seconds=0)
            self.assertIsNotNone(backup)
            self._insert_marker(database, "newer-live-record")
            wal = Path(f"{self.db_path}-wal")
            self.assertGreater(wal.stat().st_size, 0)
            protected = [self.db_path, wal, backup, self.db_path.parent / ".tracker.sqlite3.backup-order"]
            original = {path: path.read_bytes() for path in protected}
            identity = (self.db_path.stat().st_dev, self.db_path.stat().st_ino)

            with self._deny_sqlite_pragma_authorization(self.db_path) as denied:
                with self.assertRaises(sqlite3.DatabaseError) as failure:
                    TrackerDatabase(self.db_path)
            self.assertTrue(denied, "the real SQLite authorizer must reject a request")
            # Python 3.9 does not expose sqlite_errorcode or SQLITE_AUTH.
            if hasattr(failure.exception, "sqlite_errorcode"):
                self.assertEqual(failure.exception.sqlite_errorcode & 0xFF, 23)
            self.assertEqual({path: path.read_bytes() for path in protected}, original)
            self.assertEqual((self.db_path.stat().st_dev, self.db_path.stat().st_ino), identity)
            self.assertFalse(database_quarantine_dir(self.db_path).exists())
            self.assertFalse((self.db_path.parent / ".tracker.sqlite3.recovery-pending").exists())

        with closing(TrackerDatabase(self.db_path)) as reopened:
            value = reopened.connect().execute(
                "SELECT value FROM tracker_meta WHERE key='maintenance-test'"
            ).fetchone()[0]
            self.assertEqual(value, "newer-live-record")
            self.assertEqual(reopened.connect().execute("PRAGMA integrity_check").fetchone()[0], "ok")

    def test_authorization_denied_backup_does_not_restore_an_older_copy(self) -> None:
        with closing(TrackerDatabase(self.db_path)) as database:
            self._insert_marker(database, "old-backup")
            older = create_rotating_backup(database.connect(), self.db_path, interval_seconds=0)
            self._insert_marker(database, "newest-backup")
            newest = create_rotating_backup(database.connect(), self.db_path, interval_seconds=0)
        self.assertIsNotNone(older)
        self.assertIsNotNone(newest)
        self.db_path.write_bytes(b"synthetic confirmed corruption; preserve as evidence")
        protected = [self.db_path, older, newest, self.db_path.parent / ".tracker.sqlite3.backup-order"]
        original = {path: path.read_bytes() for path in protected}

        with self._deny_sqlite_pragma_authorization(newest) as denied:
            with self.assertRaises(sqlite3.DatabaseError):
                TrackerDatabase(self.db_path)
        self.assertTrue(denied, "the newest backup must reach the real SQLite authorization check")
        self.assertEqual({path: path.read_bytes() for path in protected}, original)
        self.assertFalse(database_quarantine_dir(self.db_path).exists())
        self.assertFalse((self.db_path.parent / ".tracker.sqlite3.recovery-pending").exists())

        with closing(TrackerDatabase(self.db_path)) as recovered:
            value = recovered.connect().execute(
                "SELECT value FROM tracker_meta WHERE key='maintenance-test'"
            ).fetchone()[0]
            self.assertEqual(value, "newest-backup")

    @unittest.skipIf(os.name == "nt" or getattr(os, "geteuid", lambda: 0)() == 0,
                     "requires POSIX file permissions and an unprivileged process")
    def test_maintenance_lock_access_denial_preserves_records_and_backups(self) -> None:
        with closing(TrackerDatabase(self.db_path)) as database:
            self._insert_marker(database, "preserved-after-access-denial")
            backup = create_rotating_backup(database.connect(), self.db_path, interval_seconds=0)
        self.assertIsNotNone(backup)
        protected = [self.db_path, backup, self.db_path.parent / ".tracker.sqlite3.backup-order"]
        original = {path: path.read_bytes() for path in protected}
        lock = self.db_path.parent / ".tracker.sqlite3.maintenance.lock"
        lock.touch(exist_ok=True)
        mode = lock.stat().st_mode & 0o777
        try:
            # Only this disposable fixture's lock changes. Do not elevate or
            # retry the denied operation through another account or mechanism.
            lock.chmod(0)
            with self.assertRaises(PermissionError) as failure:
                TrackerDatabase(self.db_path)
            self.assertIn(failure.exception.errno, (errno.EACCES, errno.EPERM))
            self.assertEqual({path: path.read_bytes() for path in protected}, original)
            self.assertFalse(database_quarantine_dir(self.db_path).exists())
            self.assertFalse((self.db_path.parent / ".tracker.sqlite3.recovery-pending").exists())
        finally:
            lock.chmod(mode)

        with closing(TrackerDatabase(self.db_path)) as reopened:
            value = reopened.connect().execute(
                "SELECT value FROM tracker_meta WHERE key='maintenance-test'"
            ).fetchone()[0]
            self.assertEqual(value, "preserved-after-access-denial")

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

    def test_locked_backup_times_out_without_replacing_recovery_or_holding_maintenance_lock(self) -> None:
        # Connection busy_timeout does not bound sqlite3.Connection.backup's
        # own retry loop. Keep the writer in this process so a stuck child can
        # be killed without leaking a lock or hanging the test suite.
        script = textwrap.dedent("""
            import sqlite3, sys
            from pathlib import Path
            from unittest.mock import patch
            sys.path.insert(0, sys.argv[1])
            from app.storage.database_maintenance import create_rotating_backup, database_initialization_guard
            path = Path(sys.argv[2])
            source = sqlite3.connect(path, timeout=0.02)
            try:
                with patch('app.storage.database_maintenance.BACKUP_COPY_TIMEOUT_SECONDS', 0.1):
                    try:
                        create_rotating_backup(source, path, interval_seconds=0)
                    except sqlite3.OperationalError as error:
                        assert 'backup copy timed out' in str(error), error
                    else:
                        raise AssertionError('locked backup unexpectedly completed')
                # This opens a new file-lock handle: the failed copy must
                # release the maintenance lock before another operation starts.
                with database_initialization_guard(path):
                    print('timeout and lock released', flush=True)
            finally:
                source.close()
        """)
        for journal in ("delete", "wal"):
            with self.subTest(journal=journal):
                path = Path(self.tempdir.name) / f"busy-{journal}.sqlite3"
                with closing(sqlite3.connect(path)) as writer:
                    writer.execute(f"PRAGMA journal_mode={journal}")
                    writer.execute("CREATE TABLE fixture (value TEXT)")
                    writer.execute("INSERT INTO fixture VALUES ('original')")
                    writer.commit()
                    previous = create_rotating_backup(writer, path, interval_seconds=0)
                    previous_bytes = previous.read_bytes()
                    order = path.parent / f".{path.name}.backup-order"
                    order_bytes = order.read_bytes()
                    writer.execute("PRAGMA locking_mode=EXCLUSIVE")
                    writer.execute("BEGIN EXCLUSIVE")
                    writer.execute("UPDATE fixture SET value='uncommitted'")
                    try:
                        result = subprocess.run(
                            [sys.executable, "-c", script, str(SERVICE_ROOT), str(path)],
                            capture_output=True, text=True, timeout=5,
                        )
                        self.assertEqual(result.returncode, 0, result.stderr)
                        self.assertIn("timeout and lock released", result.stdout)
                        self.assertEqual(previous.read_bytes(), previous_bytes)
                        self.assertEqual(order.read_bytes(), order_bytes)
                        self.assertEqual(list(database_backup_dir(path).glob(f".{path.name}-*.tmp*")), [])
                    finally:
                        writer.rollback()
                    self.assertEqual(writer.execute("SELECT value FROM fixture").fetchone()[0], "original")
                    # Releasing contention lets the very next attempt succeed.
                    writer.execute("UPDATE fixture SET value='later committed'")
                    writer.commit()
                    retry = create_rotating_backup(writer, path, interval_seconds=0)
                    self.assertTrue(quick_check_database(retry, immutable=True))
                    with closing(sqlite3.connect(retry)) as snapshot:
                        self.assertEqual(snapshot.execute("SELECT value FROM fixture").fetchone()[0], "later committed")

    def test_backup_copy_deadline_also_bounds_progress_and_preserves_the_previous_snapshot(self) -> None:
        with closing(sqlite3.connect(self.db_path)) as source:
            source.execute("CREATE TABLE fixture (value BLOB)")
            source.execute("INSERT INTO fixture VALUES (zeroblob(4 * 1024 * 1024))")
            source.commit()
            previous = create_rotating_backup(source, self.db_path, interval_seconds=0)
            previous_bytes = previous.read_bytes()
            order = self.db_path.parent / f".{self.db_path.name}.backup-order"
            order_bytes = order.read_bytes()
            # Real incremental SQLite copy, with only elapsed time controlled.
            # Busy-only bounds miss repeated restarts during concurrent writes.
            with patch("app.storage.database_maintenance.monotonic", side_effect=[0.0, 31.0]):
                with self.assertRaisesRegex(sqlite3.OperationalError, "backup copy timed out"):
                    create_rotating_backup(source, self.db_path, interval_seconds=0)
            self.assertEqual(previous.read_bytes(), previous_bytes)
            self.assertEqual(order.read_bytes(), order_bytes)
            self.assertEqual(list(database_backup_dir(self.db_path).glob(".*.tmp*")), [])
            retry = create_rotating_backup(source, self.db_path, interval_seconds=0)
            self.assertTrue(quick_check_database(retry, immutable=True))
            with closing(sqlite3.connect(retry)) as snapshot:
                self.assertEqual(snapshot.execute("SELECT length(value) FROM fixture").fetchone()[0], 4 * 1024 * 1024)

    def test_backup_recovers_from_transient_contention_before_the_copy_deadline(self) -> None:
        with closing(sqlite3.connect(self.db_path)) as writer:
            writer.execute("CREATE TABLE fixture (value TEXT)")
            writer.execute("INSERT INTO fixture VALUES ('committed')")
            writer.commit()
            writer.execute("BEGIN EXCLUSIVE")
            writer.execute("UPDATE fixture SET value='must roll back'")
            busy_steps = []

            class UnlockingSource(sqlite3.Connection):
                def backup(self, target, **kwargs):
                    deadline_check = kwargs.pop("progress", None)

                    def progress(status, remaining, total):
                        # Python 3.9 exposes backup status codes but does not
                        # export names for every SQLite result constant.
                        if status in (5, 6):  # SQLITE_BUSY, SQLITE_LOCKED
                            busy_steps.append(status)
                            writer.rollback()
                        if deadline_check is not None:
                            deadline_check(status, remaining, total)

                    return super().backup(target, progress=progress, **kwargs)

            with closing(sqlite3.connect(self.db_path, timeout=0.02, factory=UnlockingSource)) as source:
                backup = create_rotating_backup(source, self.db_path, interval_seconds=0)
            self.assertTrue(busy_steps, "The fixture must encounter a real SQLite lock")
            self.assertTrue(quick_check_database(backup, immutable=True))
            with closing(sqlite3.connect(backup)) as snapshot:
                self.assertEqual(snapshot.execute("SELECT value FROM fixture").fetchone()[0], "committed")

    def test_periodic_backup_timeout_preserves_the_callers_uncommitted_transaction(self) -> None:
        # A backup from its own write transaction also retries indefinitely
        # without the guard; keep a future regression inside a bounded child.
        script = textwrap.dedent("""
            import sqlite3, sys
            from contextlib import closing
            from datetime import datetime, timedelta, timezone
            from pathlib import Path
            from unittest.mock import patch
            sys.path.insert(0, sys.argv[1])
            from app.storage.db import TrackerDatabase
            from app.storage.database_maintenance import create_rotating_backup
            database = TrackerDatabase(Path(sys.argv[2]))
            source = database.connect()
            try:
                with source:
                    source.execute("INSERT INTO tracker_meta(key,value) VALUES ('maintenance-test','committed')")
                previous = create_rotating_backup(source, database.db_path,
                    now=datetime.now(timezone.utc) - timedelta(days=2), interval_seconds=0)
                previous_bytes = previous.read_bytes()
                source.execute("UPDATE tracker_meta SET value='pending' WHERE key='maintenance-test'")
                with patch('app.storage.database_maintenance.BACKUP_COPY_TIMEOUT_SECONDS', 0.05):
                    assert database.create_periodic_backup() is None
                assert 'backup copy timed out' in database.maintenance_error
                assert source.in_transaction
                assert source.execute("SELECT value FROM tracker_meta WHERE key='maintenance-test'").fetchone()[0] == 'pending'
                with closing(sqlite3.connect(database.db_path)) as observer:
                    assert observer.execute("SELECT value FROM tracker_meta WHERE key='maintenance-test'").fetchone()[0] == 'committed'
                assert previous.read_bytes() == previous_bytes
                print('caller transaction preserved')
            finally:
                source.rollback()
                database.close()
        """)
        result = subprocess.run(
            [sys.executable, "-c", script, str(SERVICE_ROOT), str(self.db_path)],
            capture_output=True, text=True, timeout=5,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("caller transaction preserved", result.stdout)

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
                    quarantine = database_quarantine_dir(db_path) / "tracker-corrupt-20261006T000000000000Z.sqlite3"
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
