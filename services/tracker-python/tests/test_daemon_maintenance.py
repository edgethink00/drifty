"""Real SQLite/locking probes for optional work off the sampling thread."""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import threading
import textwrap
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import daemon_maintenance as maintenance
from app.storage.db import TrackerDatabase
from app.storage.database_maintenance import quick_check_database
from app.tracker.capture_contract import Snapshot
from app.tracker.dev_signals import ingest
from app.tracker.dev_signals.adapters import ProviderAdapter
from app.tracker.dev_signals.agent_sessions import parse_codex_session


class DaemonMaintenanceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.db = TrackerDatabase(self.root / 'tracker.sqlite3', perform_maintenance=False)
        self.worker = maintenance.DaemonMaintenance(self.db.db_path, backfill_days=30, max_files=40)

    def tearDown(self):
        self.worker.close()
        if self.worker._thread is not None:
            self.worker._thread.join(5)
            self.assertFalse(self.worker._thread.is_alive())
        self.db.close()
        self.temp.cleanup()

    def write_log(self, seconds=60):
        start = datetime.now(timezone.utc) - timedelta(minutes=5)
        path = self.root / 'synthetic.jsonl'
        records = [
            {'type': 'event_msg', 'timestamp': start.isoformat(), 'payload': {'type': 'task_started', 'turn_id': 'one'}},
            {'type': 'event_msg', 'timestamp': (start+timedelta(seconds=seconds)).isoformat(), 'payload': {'type': 'task_complete', 'turn_id': 'one'}},
        ]
        path.write_text('\n'.join(json.dumps(record) for record in records), encoding='utf-8')
        return path

    def provider(self, parser=parse_codex_session):
        return ProviderAdapter('codex', lambda: [self.root], parser, replace_sessions=True)

    def capture(self):
        self.db.record_snapshot(Snapshot(datetime.now(timezone.utc).isoformat(), 'Editor',
                                        'fixture.editor', 'Synthetic', 'test'), 5)

    def test_slow_parser_does_not_block_capture_and_manual_import_defers(self):
        self.write_log()
        entered, release, done = threading.Event(), threading.Event(), threading.Event()
        thread_ids = []
        def parse(path):
            entered.set()
            if not release.wait(5):
                raise AssertionError('parser was not released')
            return parse_codex_session(path)
        original = maintenance.ingest_agent_sessions
        def run(db, **kwargs):
            thread_ids.append(threading.get_ident())
            self.assertIsNot(db, self.db)
            try:
                return original(db, **kwargs)
            finally:
                done.set()
        with patch.object(ingest, 'PROVIDERS', (self.provider(parse),)), patch.object(maintenance, 'ingest_agent_sessions', side_effect=run):
            self.worker.request_agent_ingest()
            try:
                self.assertTrue(entered.wait(5))
                self.capture()
                self.assertEqual(self.db.connect().execute('SELECT count(*) FROM activity_segments').fetchone()[0], 1)
                self.assertEqual(ingest.ingest_agent_sessions(self.db), (0, 0, 0))
            finally:
                release.set()
            self.assertTrue(done.wait(5))
        self.assertNotEqual(thread_ids, [threading.get_ident()])
        self.assertEqual(self.db.connect().execute('SELECT active_seconds FROM agent_session_events').fetchone()[0], 60)

    def test_close_during_parse_preserves_rows_and_checkpoint_then_retries(self):
        self.write_log()
        provider = self.provider()
        with patch.object(ingest, 'PROVIDERS', (provider,)):
            ingest.ingest_agent_sessions(self.db)
        before = self.db.connect().execute('SELECT active_seconds FROM agent_session_events').fetchone()[0]
        checkpoint = ingest._read_session_watermark(self.db, 'codex')
        self.write_log(seconds=120)
        entered, release = threading.Event(), threading.Event()
        def parse(path):
            turns = parse_codex_session(path)
            entered.set()
            if not release.wait(5):
                raise AssertionError('parser was not released')
            return turns
        with patch.object(ingest, 'PROVIDERS', (self.provider(parse),)):
            self.worker.request_agent_ingest()
            try:
                self.assertTrue(entered.wait(5))
                start = time.monotonic()
                self.worker.close()
                self.assertLess(time.monotonic()-start, 1)
                self.worker.request_backup()  # closed workers cannot accept more work
            finally:
                release.set()
            self.worker._thread.join(5)
        self.assertEqual(self.db.connect().execute('SELECT active_seconds FROM agent_session_events').fetchone()[0], before)
        self.assertEqual(ingest._read_session_watermark(self.db, 'codex'), checkpoint)
        self.assertFalse((self.root/'database-backups').exists())
        with patch.object(ingest, 'PROVIDERS', (provider,)):
            ingest.ingest_agent_sessions(self.db)
        self.assertEqual(self.db.connect().execute('SELECT active_seconds FROM agent_session_events').fetchone()[0], 120)

    def test_requests_coalesce_and_worker_recovers_after_failure(self):
        entered, release, reported, second = [threading.Event() for _ in range(4)]
        calls = []
        def run(db, **kwargs):
            calls.append(threading.get_ident())
            if len(calls) == 1:
                entered.set()
                if not release.wait(5):
                    raise AssertionError('pass was not released')
                raise RuntimeError('synthetic parser failure')
            second.set()
        with patch.object(maintenance, 'ingest_agent_sessions', side_effect=run), patch.object(
            maintenance, 'capture_tracker_exception', side_effect=lambda *args: reported.set()
        ), patch.object(maintenance, 'traceback'), patch.object(maintenance, 'print', create=True):
            self.worker.request_agent_ingest()
            try:
                self.assertTrue(entered.wait(5))
                for _ in range(50):
                    self.worker.request_agent_ingest()
            finally:
                release.set()
            self.assertTrue(second.wait(5))
            self.worker.close()
        self.assertTrue(reported.is_set())
        self.assertEqual(len(calls), 2)
        self.assertEqual(len(set(calls)), 1)

    def test_backup_uses_own_connection_and_creates_verified_snapshot(self):
        self.capture()
        finished = threading.Event()
        backup = TrackerDatabase.create_periodic_backup
        paths = []
        def observed(db):
            self.assertIsNot(db, self.db)
            try:
                paths.append(backup(db))
            finally:
                finished.set()
        with patch.object(TrackerDatabase, 'create_periodic_backup', observed):
            self.worker.request_backup()
            self.assertTrue(finished.wait(5))
            self.worker.close()
        self.assertEqual(len(paths), 1)
        self.assertTrue(quick_check_database(paths[0], immutable=True))

    def test_real_maintenance_lock_does_not_block_capture_or_close(self):
        ready = threading.Event()
        with patch.object(maintenance, 'ingest_agent_sessions', side_effect=lambda *args, **kw: ready.set()):
            self.worker.request_agent_ingest()
            self.assertTrue(ready.wait(5))
        # Warm the worker's separate DB before contending its periodic backup.
        source_root = Path(__file__).resolve().parents[1]
        code = ('import sys;from pathlib import Path;sys.path.insert(0,sys.argv[1]);'
                'from app.storage.database_maintenance import _maintenance_lock\n'
                'with _maintenance_lock(Path(sys.argv[2])):\n'
                ' print("locked",flush=True)\n sys.stdin.readline()\n')
        child = subprocess.Popen([sys.executable, '-c', code, str(source_root), str(self.db.db_path)],
                                 stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        entered = threading.Event()
        backup = TrackerDatabase.create_periodic_backup
        def blocked(db):
            entered.set()
            return backup(db)
        try:
            self.assertEqual(child.stdout.readline().strip(), 'locked')
            with patch.object(TrackerDatabase, 'create_periodic_backup', blocked):
                self.worker.request_backup()
                self.assertTrue(entered.wait(5))
                self.capture()
                start = time.monotonic()
                self.worker.close()
                self.assertLess(time.monotonic()-start, 1)
                self.assertTrue(self.worker._thread.is_alive())
                self.assertEqual(self.db.connect().execute('SELECT count(*) FROM activity_segments').fetchone()[0], 1)
                child.communicate('\n', timeout=5)
                self.worker._thread.join(5)
        finally:
            if child.poll() is None:
                child.kill()
            child.communicate(timeout=5)

    def test_process_exits_with_blocked_maintenance_thread(self):
        # Process shutdown, including Windows, must not wait for an uninterruptible
        # parser. There is no detached maintenance subprocess to orphan.
        code = textwrap.dedent('''
            import sys,time,threading
            from pathlib import Path
            from unittest.mock import patch
            sys.path.insert(0,sys.argv[1])
            from app import main,daemon_maintenance
            main.DB_PATH=Path(sys.argv[2])
            stop=threading.Event()
            def blocked(*args,**kwargs):
                threading.Timer(0.05,stop.set).start()
                print('parser-entered',flush=True)
                time.sleep(60)
            class Owner:
                def is_alive(self):return not stop.is_set()
                def wait_until_exit(self,seconds):return stop.wait(seconds)
                def wait_until_exit_or_stop(self,seconds,handle):return stop.wait(seconds)
            with patch.object(main,'DEV_SIGNALS_INGEST_INTERVAL_SECONDS',0), patch.object(
                daemon_maintenance,'ingest_agent_sessions',side_effect=blocked
            ), patch.object(main,'_daemon_tick',return_value=1):
                main._daemon_with_owner(Owner())
            print('daemon-returned',flush=True)
        ''')
        result = subprocess.run([sys.executable, '-c', code, str(Path(__file__).resolve().parents[1]),
                                 str(self.root/'child.sqlite3')], capture_output=True, text=True, timeout=8)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.splitlines(), ['parser-entered', 'daemon-returned'])


if __name__ == '__main__':
    unittest.main()
