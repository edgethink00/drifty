from __future__ import annotations

import io
import json
import os
import sqlite3
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from app.storage.db import TrackerDatabase
from app.storage.screen_activity_fence import _objects, read_state
from app.storage.screen_activity_prepare import HEADER, Preparation, main, prepare_existing, runtime_fingerprint

ROOT = Path(__file__).resolve().parents[1]


class ScreenActivityPrepareTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'tracker.sqlite3'
        self.db = TrackerDatabase(self.path, perform_maintenance=False)
        self.addCleanup(self.db.close)

    def test_first_preparation_requires_matching_producer_and_reuses_valid_epoch_without_restart(self):
        before = self.path.read_bytes()
        self.assertEqual(prepare_existing(self.path, 'a'*64), Preparation.WRITER_NOT_READY)
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(_objects(self.db.connect()), {})
        self.db.set_meta('tracker_runtime_fingerprint', 'b'*64)
        self.assertEqual(prepare_existing(self.path, 'a'*64), Preparation.WRITER_NOT_READY)
        self.assertEqual(_objects(self.db.connect()), {})
        self.db.set_meta('tracker_runtime_fingerprint', 'a'*64)
        self.assertEqual(prepare_existing(self.path, 'a'*64), Preparation.READY)
        epoch = read_state(self.db.connect(), ()).epoch
        # A paused/upgraded producer does not require DDL or a daemon start to
        # inspect an existing valid fence. Capture activation is separate.
        self.assertEqual(prepare_existing(self.path, 'b'*64), Preparation.READY)
        self.assertEqual(read_state(self.db.connect(), ()).epoch, epoch)

    def test_busy_writer_does_not_install_schema_or_block_existing_readiness(self):
        self.db.set_meta('tracker_runtime_fingerprint', 'a'*64)
        with self.db.connect() as writer:
            writer.execute('BEGIN IMMEDIATE')
            self.assertEqual(prepare_existing(self.path, 'a'*64), Preparation.UNAVAILABLE)
        self.assertEqual(_objects(self.db.connect()), {})
        self.assertEqual(prepare_existing(self.path, 'a'*64), Preparation.READY)
        with self.db.connect() as writer:
            writer.execute('BEGIN IMMEDIATE')
            self.assertEqual(prepare_existing(self.path, 'a'*64), Preparation.READY)

    def test_missing_foreign_corrupt_or_relative_paths_do_not_create_or_repair_data(self):
        missing = self.path.parent/'missing.sqlite3'
        self.assertEqual(prepare_existing(missing, 'a'*64), Preparation.MISSING)
        self.assertFalse(missing.exists())
        self.assertEqual(prepare_existing(Path('relative.sqlite3'), 'a'*64), Preparation.UNAVAILABLE)
        foreign = self.path.parent/'foreign.sqlite3'
        conn = sqlite3.connect(foreign)
        try:
            with conn:
                conn.execute('CREATE TABLE protected(value TEXT)')
        finally:
            conn.close()
        before = foreign.read_bytes()
        self.assertEqual(prepare_existing(foreign, 'a'*64), Preparation.UNAVAILABLE)
        self.assertEqual(foreign.read_bytes(), before)
        corrupt = self.path.parent/'corrupt.sqlite3'
        corrupt.write_bytes(b'owned corrupt test fixture')
        self.assertEqual(prepare_existing(corrupt, 'a'*64), Preparation.UNAVAILABLE)
        self.assertEqual(corrupt.read_bytes(), b'owned corrupt test fixture')

    def test_future_schema_and_bad_fingerprint_are_preserved_without_ddl(self):
        with self.db.connect() as conn:
            conn.execute('CREATE TABLE screen_context_activity_future(value TEXT)')
            conn.execute("INSERT INTO screen_context_activity_future VALUES('protected')")
        before = self.path.read_bytes()
        self.assertEqual(prepare_existing(self.path, 'a'*64), Preparation.UNAVAILABLE)
        self.assertEqual(self.path.read_bytes(), before)
        for value in ('A'*64, 'a'*63, 'a'*65, 'secret fp', None):
            self.assertEqual(prepare_existing(self.path, value), Preparation.UNAVAILABLE)
        self.assertEqual(self.path.read_bytes(), before)

    def test_file_links_are_refused(self):
        link = self.path.parent/'linked.sqlite3'
        try:
            link.symlink_to(self.path)
        except (OSError, NotImplementedError):
            self.skipTest('symbolic links unavailable in this test role')
        self.assertEqual(prepare_existing(link, 'a'*64), Preparation.UNAVAILABLE)

    def test_source_and_frozen_fingerprints_match_the_existing_tracker_contract(self):
        from app import main as tracker
        app = self.path.parent/'source-app'
        app.mkdir()
        (app/'z.py').write_text('z=1\n')
        (app/'a.py').write_text('a=1\n')
        (app/'__pycache__').mkdir()
        (app/'__pycache__/ignored.py').write_text('ignored=1\n')
        with patch.object(tracker, 'APP_DIR', app), patch.object(tracker, '_current_runtime_mode', return_value='source'):
            self.assertEqual(runtime_fingerprint(app, Path(sys.executable), False), tracker._tracker_runtime_fingerprint())
        executable = self.path.parent/'owned-executable'
        executable.write_bytes(b'owned frozen runtime fixture')
        with patch.object(tracker, '_current_runtime_mode', return_value='frozen'), patch.object(sys, 'executable', str(executable)):
            self.assertEqual(runtime_fingerprint(app, executable, True), tracker._tracker_runtime_fingerprint())

    def test_private_output_is_fixed_and_closed_or_partial_pipes_do_not_echo(self):
        written = bytearray()
        def partial_write(fd, data):
            self.assertEqual(fd, 1)
            part = data[:2]
            written.extend(part)
            return len(part)
        with patch('app.storage.screen_activity_prepare.runtime_fingerprint', return_value='a'*64), patch('os.write', side_effect=partial_write):
            self.assertEqual(main(['--db', str(self.path.parent/'missing')]), 0)
        self.assertEqual(written, HEADER+bytes([Preparation.MISSING]))
        with patch('app.storage.screen_activity_prepare.runtime_fingerprint', side_effect=OSError('private runtime path')), patch('os.write', side_effect=BrokenPipeError('private pipe')):
            self.assertEqual(main(['--db', str(self.path)]), 2)
        with patch('os.write') as output:
            self.assertEqual(main(['--db', str(self.path), '--unexpected']), 2)
            output.assert_not_called()

    def test_actual_early_entry_emits_only_fixed_result_before_heavy_imports(self):
        missing = self.path.parent/'actual-entry-missing.sqlite3'
        code = f'''import builtins,runpy,sys
original=builtins.__import__
def checked(name,*args,**kwargs):
 if name.startswith(('app.storage.db','app.telemetry','app.tracker.macos_workspace','app.tracker.windows_workspace','sentry_sdk')):
  raise RuntimeError('heavy import reached')
 return original(name,*args,**kwargs)
builtins.__import__=checked
sys.argv=[{str(ROOT/'app/main.py')!r},'screen-context-activity-prepare-v1','--db',{str(missing)!r}]
runpy.run_path(sys.argv[0],run_name='__main__')
'''
        result = subprocess.run([sys.executable, '-I', '-c', code], capture_output=True, timeout=5)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, HEADER+bytes([Preparation.MISSING]))
        self.assertEqual(result.stderr, b'')
        self.assertFalse(missing.exists())

    def test_dedicated_helper_uses_the_selected_producer_without_starting_tracking(self):
        producer = self.path.parent/'selected-tracker'
        producer.write_bytes(b'owned selected producer bytes')
        self.db.set_meta('tracker_runtime_fingerprint', runtime_fingerprint(ROOT/'app', producer, True))
        entry = ROOT/'app/screen_activity_main.py'
        command = [sys.executable, '-I', str(entry), 'screen-context-activity-prepare-v1',
                   '--db', str(self.path), '--producer-runtime', str(producer)]
        result = subprocess.run(command, capture_output=True, timeout=5)
        self.assertEqual((result.returncode, result.stdout, result.stderr), (0, HEADER+b'\0', b''))
        self.assertEqual(len(_objects(self.db.connect())), 4)
        self.assertEqual(self.db.connect().execute('SELECT COUNT(*) FROM activity_segments').fetchone()[0], 0)
        for bad in ('relative-producer', str(self.path.parent/'missing-producer')):
            result = subprocess.run(command[:-1]+[bad], capture_output=True, timeout=5)
            self.assertEqual((result.returncode, result.stdout, result.stderr),
                             (0, HEADER+bytes([Preparation.UNAVAILABLE]), b''))
        for arguments in ([], ['serve'], command[4:-2]):
            result = subprocess.run([sys.executable, '-I', str(entry), *arguments], capture_output=True, timeout=5)
            self.assertEqual((result.returncode, result.stdout, result.stderr), (2, b'', b''))


if __name__ == '__main__':
    unittest.main()
