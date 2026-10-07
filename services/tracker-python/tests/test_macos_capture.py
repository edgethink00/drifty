from __future__ import annotations

import json
import subprocess
import sys
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from app.tracker.capture_contract import Snapshot
from app.tracker.macos_capture import CommandScope, ContextWorker, FrontmostApplication, read_frontmost_application
from app.tracker import macos_workspace as workspace
from app.tracker.browser_automation import BrowserMetadata
from app.tracker.youtube_video_recovery import YouTubeVideoIdMemory


def snapshot(name='Notes'):
    return Snapshot('2026-10-04T00:00:00+00:00', name, 'com.apple.Notes', None, 'nsworkspace')


class NativeIdentityTests(unittest.TestCase):
    def test_reads_versioned_json_without_applescript_or_runtime_compilation(self):
        helper = Path('/test/chatgpt-session-ax')
        result = subprocess.CompletedProcess([], 0, json.dumps({
            'version': 1, 'app_name': 'Notes\nQA', 'bundle_id': 'com.apple.Notes', 'pid': 42,
        }), '')
        with patch('app.tracker.macos_capture.subprocess.run', return_value=result) as run:
            identity = read_frontmost_application(helper_path=helper, timeout=0.2)
        self.assertEqual(identity, FrontmostApplication('Notes\nQA', 'com.apple.Notes', 42))
        self.assertEqual(run.call_args.args[0], [str(helper), '--frontmost-app'])
        self.assertEqual(run.call_args.kwargs['timeout'], 0.2)

    def test_absent_helper_and_expired_budget_do_not_spawn(self):
        with patch('app.tracker.macos_capture.packaged_helper_path', return_value=None), \
             patch('app.tracker.macos_capture.subprocess.run') as run:
            self.assertIsNone(read_frontmost_application())
            self.assertIsNone(read_frontmost_application(helper_path=Path('/helper'), timeout=0))
        run.assert_not_called()

    def test_bad_and_unavailable_identity_fall_back(self):
        for data in ([], {}, {'version': 2}, {'version': 1, 'app_name': None},
                     {'version': 1, 'app_name': 'Notes', 'pid': True},
                     {'version': 1, 'app_name': 'Notes', 'pid': 0},
                     {'version': 1, 'app_name': 'Notes', 'pid': 42, 'bundle_id': []}):
            with self.subTest(data=data), patch('app.tracker.macos_capture.subprocess.run',
                return_value=subprocess.CompletedProcess([], 0, json.dumps(data), '')):
                self.assertIsNone(read_frontmost_application(helper_path=Path('/helper')))
        for error in (FileNotFoundError(), subprocess.TimeoutExpired('helper', 0.5)):
            with patch('app.tracker.macos_capture.subprocess.run', side_effect=error):
                self.assertIsNone(read_frontmost_application(helper_path=Path('/helper')))


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.worker = ContextWorker()
        self.addCleanup(self.worker.close)

    def wait_idle(self):
        with self.worker._condition:
            self.assertTrue(self.worker._condition.wait_for(lambda: self.worker._active is None, timeout=1))

    def test_expired_result_is_not_reused_and_does_not_accumulate_jobs(self):
        entered, release, allowed_after = threading.Event(), threading.Event(), []
        self.addCleanup(release.set)
        def slow(allowed):
            entered.set()
            release.wait(1)
            allowed_after.append(allowed())
            return snapshot('Old app')
        start = time.monotonic()
        self.assertIsNone(self.worker.read(slow, deadline=start + 0.05))
        self.assertLess(time.monotonic() - start, 0.5)
        self.assertTrue(entered.is_set())
        later = Mock(return_value=snapshot('New app'))
        for _ in range(20):
            self.assertIsNone(self.worker.read(later, deadline=time.monotonic() + 1))
        later.assert_not_called()
        release.set()
        self.wait_idle()
        self.assertEqual(allowed_after, [False])
        self.assertEqual(self.worker.read(later, deadline=time.monotonic() + 1).app_name, 'New app')
        later.assert_called_once()

    def test_exception_and_expired_deadline_do_not_poison_later_samples(self):
        capture = Mock(side_effect=RuntimeError('private title'))
        self.assertIsNone(self.worker.read(capture, deadline=time.monotonic() - 1))
        capture.assert_not_called()
        self.assertIsNone(self.worker.read(capture, deadline=time.monotonic() + 1))
        self.assertEqual(self.worker.read(lambda _: snapshot(), deadline=time.monotonic() + 1).app_name, 'Notes')

    def test_close_wakes_a_waiting_caller_without_waiting_for_provider(self):
        entered, release = threading.Event(), threading.Event()
        self.addCleanup(release.set)
        results = []
        def slow(_):
            entered.set()
            release.wait(2)
            return snapshot()
        thread = threading.Thread(target=lambda: results.append(self.worker.read(slow, deadline=time.monotonic() + 10)))
        thread.start()
        self.assertTrue(entered.wait(1))
        self.worker.close()
        thread.join(1)
        self.assertFalse(thread.is_alive())
        self.assertEqual(results, [None])
        release.set()
        self.worker._thread.join(1)
        self.assertFalse(self.worker._thread.is_alive())
        self.assertIsNone(self.worker.read(lambda _: snapshot(), deadline=time.monotonic() + 1))


class OwnedHelperTests(unittest.TestCase):
    def test_deadline_kills_and_reaps_the_owned_child(self):
        scope = CommandScope(time.monotonic() + 0.1)
        children = []
        real_popen = subprocess.Popen
        def spawn(*args, **kwargs):
            child = real_popen(*args, **kwargs)
            children.append(child)
            return child
        with patch('app.tracker.macos_capture.subprocess.Popen', side_effect=spawn):
            with self.assertRaisesRegex(RuntimeError, 'timed out'):
                scope.run([sys.executable, '-c', 'import time; time.sleep(60)'], timeout=60)
        self.assertEqual(len(children), 1)
        self.assertIsNotNone(children[0].poll())
        self.assertFalse(scope._children)

    def test_worker_shutdown_cancels_its_helper_and_reaps_it(self):
        worker = ContextWorker()
        scope = CommandScope(time.monotonic() + 60)
        entered = threading.Event()
        children = []
        real_popen = subprocess.Popen
        def spawn(*args, **kwargs):
            child = real_popen(*args, **kwargs)
            children.append(child)
            entered.set()
            return child
        results = []
        self.addCleanup(worker.close)
        self.addCleanup(scope.close)
        with patch('app.tracker.macos_capture.subprocess.Popen', side_effect=spawn):
            caller = threading.Thread(target=lambda: results.append(worker.read(
                lambda _: scope.run([sys.executable, '-c', 'import time; time.sleep(60)'], timeout=60),
                deadline=time.monotonic() + 60, cancel=scope.close,
            )))
            caller.start()
            self.assertTrue(entered.wait(1))
            worker.close()
            caller.join(1)
            worker._thread.join(1)
        self.assertFalse(caller.is_alive())
        self.assertFalse(worker._thread.is_alive())
        self.assertEqual(results, [None])
        self.assertIsNotNone(children[0].poll())


class NativeSnapshotTests(unittest.TestCase):
    def setUp(self):
        self.worker = ContextWorker()
        self.addCleanup(self.worker.close)
        self.patches = []
        self.native = FrontmostApplication('Google Chrome', 'com.google.Chrome', 42)
        self.front = ('Google Chrome', 'com.google.Chrome', 'QA - YouTube', 42)
        self.identity = self.mock('read_frontmost_application', return_value=self.native)
        self.title = self.mock('_frontmost_via_system_events', return_value=self.front)
        self.fallback = self.mock('_frontmost_via_fallback_capture')
        self.browser = self.mock('_browser_metadata', return_value=BrowserMetadata(
            browser_name='Google Chrome', site_domain='youtube.com', site_title='QA',
            site_url='https://www.youtube.com/watch?v=qa', youtube_video_id='qa',
            ax_window_title='QA - YouTube', match_state='matched', browser_automation_status='granted',
        ))
        self.mock('_onscreen_window_rows', return_value=[])
        self.mock('apply_native_chatgpt_session_title', side_effect=lambda app, bundle, title, pid, runner: title)
        self.adaptive = self.mock('adaptive_content_context_for_capture', return_value=None)
        self.memory = YouTubeVideoIdMemory()
        self.mock('_youtube_video_id_memory', new=self.memory)
        self.mock('context_worker', new=self.worker)

    def mock(self, name, **kwargs):
        p = patch.object(workspace, name, **kwargs)
        value = p.start()
        self.addCleanup(p.stop)
        return value

    def test_fast_capture_preserves_metadata_and_honest_source(self):
        result = workspace.current_snapshot(False)
        self.assertEqual(result.app_name, 'Google Chrome')
        self.assertEqual(result.site_url, 'https://www.youtube.com/watch?v=qa')
        self.assertEqual(result.frontmost_capture_source, 'nsworkspace')
        self.assertEqual(result.window_title_source, 'browser-accessibility')
        self.assertEqual(self.identity.call_count, 2)
        self.assertEqual(self.title.call_count, 2)
        self.fallback.assert_not_called()
        self.assertIn('QA', self.memory._entries)

    def test_browser_content_uses_the_sample_command_scope_and_preserves_baseline_on_failure(self):
        capture = self.mock('capture_browser_content', return_value=None)
        result = workspace.current_snapshot(False)
        self.assertEqual(result.site_url, 'https://www.youtube.com/watch?v=qa')
        self.assertIsNone(result.browser_content_context)
        self.assertTrue(callable(capture.call_args.kwargs['run_command']))
        self.assertGreater(capture.call_args.kwargs['timeout'], 0)
        self.assertLessEqual(capture.call_args.kwargs['timeout'], 0.65)
        self.assertEqual(capture.call_args.kwargs['pid'], self.native.pid)

    def test_unmatched_or_history_browser_metadata_cannot_start_body_capture(self):
        capture = self.mock('capture_browser_content', return_value=None)
        for state in ('front-fallback', 'browser-history-title', 'accessibility-address-bar'):
            with self.subTest(state=state):
                self.browser.return_value.match_state = state
                workspace.current_snapshot(False)
        capture.assert_not_called()

    def test_switched_process_or_window_cannot_attach_metadata(self):
        for changed in [('Notes', 'com.apple.Notes', 'New title', 99),
                        ('Google Chrome', 'com.google.Chrome', 'Other window', 42)]:
            with self.subTest(changed=changed):
                self.title.side_effect = [self.front, changed]
                result = workspace.current_snapshot(False)
                self.assertEqual(result.app_name, 'Google Chrome')
                self.assertIsNone(result.site_url)
                self.assertIsNone(result.window_title)
                self.assertEqual(dict(self.memory._entries), {})

    def test_foreground_change_after_metadata_invalidates_result(self):
        self.identity.side_effect = [self.native, FrontmostApplication('Notes', 'com.apple.Notes', 99)]
        result = workspace.current_snapshot(False)
        self.assertIsNone(result.site_url)
        self.assertEqual(dict(self.memory._entries), {})

    def test_identity_stays_available_when_accessibility_fails(self):
        self.title.side_effect = RuntimeError('AX unavailable')
        self.browser.return_value = BrowserMetadata(browser_name='Google Chrome', browser_automation_status='denied')
        result = workspace.current_snapshot(False)
        self.assertEqual(result.app_name, 'Google Chrome')
        self.assertIsNone(result.window_title)
        self.assertEqual(result.browser_automation_status, 'denied')
        self.fallback.assert_not_called()

    def test_late_enrichment_cannot_teach_video_memory_and_next_sample_stays_fresh(self):
        entered, release = threading.Event(), threading.Event()
        self.addCleanup(release.set)
        def slow(_):
            entered.set()
            release.wait(1)
            return None
        self.adaptive.side_effect = slow
        with patch.object(workspace, 'CAPTURE_TIMEOUT_SECONDS', 0.05):
            result = workspace.current_snapshot(False)
        self.assertTrue(entered.is_set())
        self.assertIsNone(result.site_url)
        self.assertEqual(dict(self.memory._entries), {})
        release.set()
        with self.worker._condition:
            self.assertTrue(self.worker._condition.wait_for(lambda: self.worker._active is None, timeout=1))
        self.assertEqual(dict(self.memory._entries), {})
        self.adaptive.side_effect = None
        self.assertEqual(workspace.current_snapshot(False).site_url, 'https://www.youtube.com/watch?v=qa')

    def test_missing_native_helper_keeps_legacy_capture(self):
        self.identity.return_value = None
        result = workspace.current_snapshot(False)
        self.assertEqual(result.frontmost_capture_source, 'system-events')
        self.assertEqual(result.site_url, 'https://www.youtube.com/watch?v=qa')

    def test_developer_forced_fallback_keeps_its_existing_path(self):
        with patch.dict('os.environ', {workspace.FORCE_FRONTMOST_FALLBACK_CAPTURE_ENV: '1'}):
            self.fallback.return_value = ('Notes', 'com.apple.Notes', None, None, None)
            self.browser.return_value = BrowserMetadata()
            result = workspace.current_snapshot(False)
        self.identity.assert_not_called()
        self.assertEqual(result.frontmost_capture_source, 'lsappinfo')


if __name__ == '__main__':
    unittest.main()
