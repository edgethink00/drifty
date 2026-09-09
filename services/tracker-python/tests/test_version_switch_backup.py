import sqlite3
from contextlib import closing
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from app.storage.db import TrackerDatabase
from app.storage.database_maintenance import create_rotating_backup, permanent_deletion_guard


class VersionSwitchBackupTests(unittest.TestCase):
    def test_snapshot_includes_committed_wal_and_is_invalidated_by_deletion(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'tracker.sqlite3'
            db = TrackerDatabase(path, perform_maintenance=False)
            source = db.connect()
            source.execute('CREATE TABLE version_test (value TEXT)')
            source.execute("INSERT INTO version_test VALUES ('synthetic')")
            source.commit()
            backup = create_rotating_backup(source, path, interval_seconds=0)
            self.assertIsNotNone(backup)
            with closing(sqlite3.connect(backup)) as copy:
                self.assertEqual(copy.execute('PRAGMA quick_check').fetchone()[0], 'ok')
                self.assertEqual(copy.execute('SELECT value FROM version_test').fetchone()[0], 'synthetic')
            with permanent_deletion_guard(path, source, refresh_backup=False) as invalidate:
                with source:
                    invalidate()
                    source.execute('DELETE FROM version_test')
            self.assertFalse(backup.exists())
            source.close()

    def test_command_propagates_backup_failure(self):
        from app import main
        with patch.object(main, 'database') as database, patch('app.storage.database_maintenance.create_rotating_backup', side_effect=sqlite3.OperationalError('disk full')):
            with self.assertRaises(sqlite3.OperationalError):
                main.backup_for_version_switch({})

    def test_forced_backups_are_fresh_and_retained(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'tracker.sqlite3'
            source = sqlite3.connect(path)
            source.execute('CREATE TABLE version_test (value TEXT)')
            copies = [create_rotating_backup(source, path, interval_seconds=0) for _ in range(4)]
            self.assertEqual(len(set(copies)), 4)
            self.assertFalse(copies[0].exists())
            self.assertTrue(all(p.exists() for p in copies[1:]))
            source.close()
