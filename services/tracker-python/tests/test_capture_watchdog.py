from __future__ import annotations

import json
from contextlib import closing
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

from app.capture_watchdog import CaptureWatchdog, TIMEOUT_SECONDS, POLL_SECONDS


class CaptureWatchdogTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.db = Path(self.tmp.name) / 'tracker.sqlite3'
        (self.db.parent / '.state').mkdir()
        self.now = 0
        self.wall = 10000
        self.exits = []
        self.allowed = True
        self.watchdog = self.make()

    def make(self):
        return CaptureWatchdog(self.db, lambda: self.allowed, clock=lambda: self.now,
                               wall_clock=lambda: self.wall, retire=lambda: self.exits.append(75))

    def advance(self, seconds):
        for _ in range(seconds // POLL_SECONDS):
            self.now += POLL_SECONDS
            self.watchdog.check()

    def test_only_snapshot_phase_may_retire_and_budget_survives_new_process(self):
        self.advance(600)  # DB locks, idle, policy suppression and maintenance are unarmed.
        self.assertEqual(self.exits, [])
        for i in range(5):
            self.watchdog = self.make()
            with self.watchdog.snapshot():
                self.advance(TIMEOUT_SECONDS - POLL_SECONDS)
                self.assertEqual(len(self.exits), min(i, 3))
                self.advance(POLL_SECONDS)
        self.assertEqual(self.exits, [75] * 3)
        value = json.loads(self.watchdog.path.read_text())
        self.assertEqual(value['attempts'], [10000] * 3)
        if os.name != 'nt':
            self.assertEqual(self.watchdog.path.stat().st_mode & 0o777, 0o600)

    def test_finished_snapshot_exception_and_cancellation_disarm(self):
        with self.assertRaises(RuntimeError), self.watchdog.snapshot():
            self.advance(5)
            raise RuntimeError('capture failure')
        self.advance(150)
        with self.watchdog.snapshot():
            self.allowed = False
            self.advance(150)
        self.assertEqual(self.exits, [])
        self.assertFalse(self.watchdog.path.exists())

    def test_suspend_or_clock_discontinuity_requires_a_fresh_full_window(self):
        with self.watchdog.snapshot():
            self.advance(115)
            self.now += 3600
            self.watchdog.check()
            self.advance(115)
            self.assertEqual(self.exits, [])
            self.advance(5)
        self.assertEqual(self.exits, [75])

    def test_unwritable_budget_and_corrupt_or_future_budget_fail_closed(self):
        for raw in ['{', '{"version":1,"attempts":[10001]}',
                    '{"version":2,"attempts":[]}', '{"version":1,"attempts":[true]}',
                    ' ' * 1025]:
            self.watchdog.path.write_text(raw)
            with self.watchdog.snapshot():
                self.advance(125)
        self.watchdog.path.unlink()
        with patch('app.capture_watchdog.os.replace', side_effect=OSError('disk full')):
            with self.watchdog.snapshot():
                self.advance(125)
        self.assertEqual(self.exits, [])
        self.assertEqual(list(self.watchdog.path.parent.glob('.capture-recovery-*')), [])

    def test_budget_cooldown_preserves_retries_but_running_does_not_reset_budget(self):
        self.watchdog.path.write_text(json.dumps({'version': 1, 'attempts': [10000] * 3}))
        with self.watchdog.snapshot():
            self.advance(125)
            self.wall += 3600
            self.advance(5)
        self.assertEqual(self.exits, [75])
        self.assertEqual(json.loads(self.watchdog.path.read_text())['attempts'], [13600])

    def test_phase_lock_prevents_capture_thread_entering_storage_during_exit(self):
        retiring, release, finished = threading.Event(), threading.Event(), threading.Event()
        self.watchdog.retire = lambda: (retiring.set(), release.wait(2))
        self.watchdog.started_at = 0
        self.now = 120
        self.watchdog.last_poll = 115
        worker = threading.Thread(target=self.watchdog.check)
        worker.start()
        self.assertTrue(retiring.wait(2))
        def end_snapshot():
            with self.watchdog.lock:
                self.watchdog.started_at = None
            finished.set()
        capture = threading.Thread(target=end_snapshot)
        capture.start()
        self.assertFalse(finished.wait(.05))
        release.set()
        worker.join(2)
        capture.join(2)
        self.assertTrue(finished.is_set())

    def test_real_self_exit_preserves_database_rows_and_allows_new_writes(self):
        connection = sqlite3.connect(self.db)
        connection.execute('CREATE TABLE original(id TEXT PRIMARY KEY, value TEXT)')
        connection.execute("INSERT INTO original VALUES ('old', 'preserve')")
        connection.commit()
        connection.close()
        # Separate interpreter executes the actual exit primitive; the process
        # cannot continue to the simulated write after snapshot retirement.
        code = '''
import sqlite3,sys
from pathlib import Path
from app.capture_watchdog import CaptureWatchdog
p=Path(sys.argv[1]); now=[0]
# Model an in-flight background maintenance transaction at process exit.
connection=sqlite3.connect(p)
connection.execute('BEGIN IMMEDIATE')
connection.execute("UPDATE original SET value='uncommitted' WHERE id='old'")
w=CaptureWatchdog(p,lambda: True,clock=lambda:now[0])
with w.snapshot():
 for i in range(24):
  now[0]+=5; w.check()
sqlite3.connect(p).execute("DELETE FROM original")
'''
        env = dict(os.environ, PYTHONPATH=str(Path(__file__).resolve().parents[1]))
        result = subprocess.run([sys.executable, '-c', code, str(self.db)], env=env, timeout=10)
        self.assertEqual(result.returncode, 75)
        with closing(sqlite3.connect(self.db)) as connection, connection:
            self.assertEqual(connection.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
            self.assertEqual(connection.execute('SELECT * FROM original').fetchall(), [('old', 'preserve')])
            connection.execute("INSERT INTO original VALUES ('new', 'resumed')")

    def test_thread_creation_failure_is_optional_and_late_cancellation_denies_exit(self):
        with patch('app.capture_watchdog.threading.Thread.start', side_effect=RuntimeError('thread unavailable')):
            self.assertIsNone(self.watchdog.start())
        self.watchdog.allowed = lambda: self.allowed
        original_claim = self.watchdog._claim_attempt
        def claim_then_cancel():
            result = original_claim()
            self.allowed = False
            return result
        with patch.object(self.watchdog, '_claim_attempt', side_effect=claim_then_cancel):
            with self.watchdog.snapshot():
                self.advance(120)
        self.assertEqual(self.exits, [])

    def test_thread_shutdown_is_interruptible(self):
        self.watchdog.start()
        self.watchdog.close()
        self.assertFalse(self.watchdog.thread.is_alive())
