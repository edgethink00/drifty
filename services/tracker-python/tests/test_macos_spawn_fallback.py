import errno
import subprocess
import unittest
from unittest.mock import patch

from app.tracker import macos_workspace as workspace
from app.tracker.browser_automation import BrowserMetadata


class MacosSpawnFallbackTests(unittest.TestCase):
    def test_osascript_spawn_failure_uses_app_fallback(self):
        with patch.object(workspace, 'read_frontmost_application', return_value=None), \
             patch.object(workspace.subprocess, 'run', side_effect=BlockingIOError(errno.EAGAIN, 'resource busy')) as run, \
             patch.object(workspace, '_frontmost_via_lsappinfo', return_value=('Notes', 'com.apple.Notes', None, 123)) as fallback, \
             patch.object(workspace, 'read_front_window_title', return_value=None), \
             patch.object(workspace, '_browser_metadata', return_value=BrowserMetadata()):
            snapshot = workspace.current_snapshot(include_system_transient=False)
            run.side_effect = None
            run.return_value = subprocess.CompletedProcess('synthetic', 0, 'Finder\ncom.apple.finder\n\n456', '')
            recovered = workspace.current_snapshot(include_system_transient=False)

        self.assertEqual(snapshot.app_name, 'Notes')
        self.assertEqual(snapshot.bundle_id, 'com.apple.Notes')
        self.assertEqual(snapshot.frontmost_capture_source, 'lsappinfo')
        self.assertIn('osascript could not start', snapshot.frontmost_capture_error)
        fallback.assert_called_once()
        self.assertEqual(recovered.app_name, 'Finder')
        self.assertEqual(recovered.frontmost_capture_source, 'system-events')
        self.assertIsNone(recovered.frontmost_capture_error)

    def test_both_spawn_paths_unavailable_return_diagnostic_snapshot(self):
        with patch.object(workspace, 'read_frontmost_application', return_value=None), \
             patch.object(workspace.subprocess, 'run', side_effect=BlockingIOError(errno.EAGAIN, 'resource busy')):
            snapshot = workspace.current_snapshot(include_system_transient=False)

        self.assertEqual(snapshot.app_name, 'Unavailable')
        self.assertEqual(snapshot.frontmost_capture_source, 'unavailable')
        self.assertIn('osascript could not start', snapshot.frontmost_capture_error)
        self.assertIn('capture command could not start', snapshot.frontmost_fallback_error)

    def test_spawn_errors_preserve_cause_without_exporting_command_arguments(self):
        for runner, argument in ((workspace._run_osascript, 'private synthetic script'),
                                 (workspace._run_command, ['missing-helper', 'private synthetic argument'])):
            with self.subTest(runner=runner.__name__):
                error = FileNotFoundError(errno.ENOENT, 'private synthetic command')
                with patch.object(workspace.subprocess, 'run', side_effect=error):
                    with self.assertRaises(RuntimeError) as raised:
                        runner(argument)
                self.assertIs(raised.exception.__cause__, error)
                self.assertIn(str(errno.ENOENT), str(raised.exception))
                self.assertNotIn('private synthetic', str(raised.exception))

    def test_process_control_exceptions_are_not_converted(self):
        with patch.object(workspace.subprocess, 'run', side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                workspace._run_osascript('synthetic')


if __name__ == '__main__':
    unittest.main()
