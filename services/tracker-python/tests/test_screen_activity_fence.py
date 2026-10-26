from __future__ import annotations

import sqlite3
import unittest
import uuid
from unittest.mock import patch
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory

from app.storage import screen_activity_fence as fence
from app.storage.db import TrackerDatabase
from app.storage.screen_activity_binding import read_local_record_refs
from app.tracker.capture_contract import Snapshot


class ScreenActivityFenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'tracker.sqlite3'
        for target in ('app.storage.db.CAPTURE_PLATFORM', 'app.storage.screen_activity_binding.CAPTURE_PLATFORM'):
            platform = patch(target, 'macos')
            platform.start()
            self.addCleanup(platform.stop)
        self.db = TrackerDatabase(self.path, perform_maintenance=False)
        self.addCleanup(self.db.close)
        self.conn = self.db.connect()
        self.base = datetime(2026, 10, 20, tzinfo=timezone.utc)
        self.row(0)
        self.row(10)
        self.uid = self.conn.execute('SELECT segment_uid FROM activity_segments').fetchone()[0]

    def iso(self, seconds):
        return (self.base + timedelta(seconds=seconds)).isoformat()

    def row(self, seconds):
        return self.db.record_snapshot(Snapshot(self.iso(seconds), 'Owned app', 'owned.app',
                                                'Owned private title', 'accessibility'), 5)

    def prepare(self):
        with self.conn:
            self.conn.execute('BEGIN IMMEDIATE')
            return fence.prepare(self.conn)

    def state(self):
        return fence.read_state(self.conn, (self.uid,))

    def references(self):
        # These assertions cover point/restore semantics, not cold filesystem
        # latency. A legitimate50ms optional refusal must not become an
        # IndexError in this test. Restore I/O keeps its actual clock outside
        # this context. Separate deadline tests and real source/frozen Rust
        # interop retain the unchanged50/200ms production budgets.
        with patch('app.storage.screen_activity_binding.time.monotonic', return_value=1000.0):
            return read_local_record_refs(self.path, ['1'], require_fence=True)

    def test_schema_is_only_installed_by_explicit_write_locked_preparation(self):
        before = self.path.read_bytes()
        with self.assertRaisesRegex(ValueError, 'unavailable'):
            self.state()
        self.assertEqual(self.path.read_bytes(), before)
        with self.assertRaisesRegex(ValueError, 'write transaction'):
            fence.prepare(self.conn)
        epoch = self.prepare()
        self.assertEqual(epoch, self.prepare())
        self.assertEqual(self.state().ranges, {})
        self.assertNotIn('Owned', str(self.state()))

    def test_real_trim_records_only_removed_points_and_regrowth_does_not_erase_them(self):
        epoch = self.prepare()
        self.db.trim_latest_segment(self.iso(5))
        expected = ((fence._ceil_ms(self.iso(5)), fence._ceil_ms(self.iso(10))),)
        self.assertEqual(self.state().ranges[self.uid], expected)
        self.row(15)
        self.assertEqual(self.state().epoch, epoch)
        self.assertEqual(self.state().ranges[self.uid], expected)
        self.assertEqual(self.conn.execute('SELECT COUNT(*) FROM activity_segments').fetchone()[0], 1)

    def test_real_internal_collapse_and_same_uid_restore_cannot_remove_the_revocation(self):
        self.prepare()
        before = dict(self.conn.execute('SELECT * FROM activity_segments').fetchone())
        self.db.trim_latest_segment(self.iso(0))
        self.assertEqual(self.conn.execute('SELECT COUNT(*) FROM activity_segments').fetchone()[0], 0)
        with self.conn:
            columns = ','.join(before)
            placeholders = ','.join('?' for _ in before)
            self.conn.execute(f'INSERT INTO activity_segments ({columns}) VALUES ({placeholders})', tuple(before.values()))
        self.assertEqual(self.state().ranges[self.uid], ((0, fence.MAX_UNIX_MS),))

    def test_rollback_keeps_activity_and_revocations_in_one_transaction(self):
        self.prepare()
        with self.assertRaisesRegex(RuntimeError, 'rollback'):
            with self.conn:
                self.conn.execute('DELETE FROM activity_segments')
                self.assertEqual(self.state().ranges[self.uid], ((0, fence.MAX_UNIX_MS),))
                raise RuntimeError('rollback')
        self.assertEqual(self.state().ranges, {})
        self.assertEqual(self.conn.execute('SELECT COUNT(*) FROM activity_segments').fetchone()[0], 1)

    def test_submillisecond_trim_and_forward_start_keep_exact_half_open_lattice(self):
        self.prepare()
        with self.conn:
            self.conn.execute('UPDATE activity_segments SET started_at=?,ended_at=?',
                              (self.iso(0.0005), self.iso(5.0005)))
        self.assertEqual(self.state().ranges[self.uid], (
            (fence._ceil_ms(self.iso(0)), fence._ceil_ms(self.iso(0.0005))),
            (fence._ceil_ms(self.iso(5.0005)), fence._ceil_ms(self.iso(10))),
        ))

    def test_other_identity_and_remote_rows_do_not_grant_reused_evidence(self):
        self.prepare()
        with self.conn:
            self.conn.execute("UPDATE activity_segments SET window_title='changed'")
            self.conn.execute("UPDATE activity_segments SET window_title='Owned private title'")
        self.assertEqual(self.state().ranges[self.uid], ((0, fence.MAX_UNIX_MS),))
        with self.conn:
            self.conn.execute('DELETE FROM activity_segments')
            self.conn.execute('DELETE FROM screen_context_activity_revocations')
        self.row(20)
        with self.conn:
            self.conn.execute("UPDATE activity_segments SET origin_device_id='other'")
            self.conn.execute('DELETE FROM screen_context_activity_revocations')
            self.conn.execute('DELETE FROM activity_segments')
        self.assertEqual(self.state().ranges, {})

    def test_range_bound_compacts_one_uid_and_supported_recovery_changes_epoch(self):
        epoch = self.prepare()
        with self.conn:
            for n in range(65):
                self.conn.execute('UPDATE activity_segments SET ended_at=?', (self.iso(9 - n / 1000),))
        self.assertEqual(self.state().ranges[self.uid], ((0, fence.MAX_UNIX_MS),))
        self.assertEqual(self.state().epoch, epoch)
        # A supported restore explicitly rotates the epoch in the same write
        # transaction before any new optional link can be granted.
        with self.conn:
            self.conn.execute('BEGIN IMMEDIATE')
            fence.invalidate_recovered(self.conn)
        self.assertNotEqual(self.state().epoch, epoch)
        self.assertEqual(self.state().ranges, {})

    def test_global_bound_rotates_epoch_before_discarding_the_old_revocations(self):
        epoch = self.prepare()
        with self.conn:
            self.conn.executemany('INSERT INTO screen_context_activity_revocations VALUES(?,?,?)',
                                  ((str(uuid.UUID(int=n+1)), 0, 1)
                                   for n in range(fence.MAX_REVOKED_POINTS)))
            self.conn.execute('UPDATE activity_segments SET ended_at=?', (self.iso(5),))
        self.assertNotEqual(self.state().epoch, epoch)
        self.assertEqual(self.conn.execute('SELECT COUNT(*) FROM screen_context_activity_revocations').fetchone()[0], 0)

    def test_unknown_schema_and_partial_state_are_preserved_and_refused(self):
        with self.conn:
            self.conn.execute('CREATE TABLE screen_context_activity_future(value TEXT)')
            self.conn.execute("INSERT INTO screen_context_activity_future VALUES('protected')")
        with self.assertRaisesRegex(ValueError, 'unavailable'):
            self.prepare()
        self.assertEqual(self.conn.execute('SELECT value FROM screen_context_activity_future').fetchone()[0], 'protected')

    def test_strict_read_refuses_unprepared_db_and_survives_trim_regrow_without_reviving_point(self):
        self.assertEqual(self.references(), ())
        epoch = self.prepare()
        before = self.references()[0]
        self.assertEqual(before.proof_version, 1)
        self.assertTrue(before.contains(fence._ceil_ms(self.iso(8))))
        self.db.trim_latest_segment(self.iso(5))
        self.row(15)
        after = self.references()[0]
        self.assertEqual(before.identity_digest, after.identity_digest)
        self.assertEqual(self.state().epoch, epoch)
        self.assertTrue(after.contains(fence._ceil_ms(self.iso(2))))
        self.assertFalse(after.contains(fence._ceil_ms(self.iso(8))))
        self.assertTrue(after.contains(fence._ceil_ms(self.iso(12))))

    def test_actual_backup_restore_rotates_before_publish_and_preserves_backup_bytes(self):
        epoch = self.prepare()
        before = self.references()[0]
        backup = self.db.create_periodic_backup()
        saved_backup = backup.read_bytes()
        self.db.trim_latest_segment(self.iso(5))
        self.db.close()
        self.path.write_bytes(b'owned synthetic corrupt database')
        recovered = TrackerDatabase(self.path)
        try:
            self.assertIsNotNone(recovered.maintenance_result.restored_backup_path)
            fresh = self.references()[0]
            self.assertNotEqual(before.identity_digest, fresh.identity_digest)
            self.assertNotEqual(fence.read_state(recovered.connect(), (self.uid,)).epoch, epoch)
            self.assertEqual(backup.read_bytes(), saved_backup)
        finally:
            recovered.close()


if __name__ == '__main__':
    unittest.main()
