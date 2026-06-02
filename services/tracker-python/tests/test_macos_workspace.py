import sys
import unittest
from pathlib import Path
from unittest.mock import patch

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.tracker.macos_workspace import _browser_metadata, _browser_script, _youtube_ids, current_snapshot


class MacosWorkspaceTests(unittest.TestCase):
    def test_browser_script_matrix(self) -> None:
        safari_script = _browser_script("Safari")
        self.assertIsNotNone(safari_script)
        self.assertIn('tell application "Safari"', safari_script)
        self.assertIn('front document', safari_script)
        self.assertIn('URL of front document', safari_script)
        self.assertIn('name of front document', safari_script)

        for app_name in ["Google Chrome", "Arc", "Brave Browser", "Chromium", "Microsoft Edge"]:
            with self.subTest(app_name=app_name):
                script = _browser_script(app_name)
                self.assertIsNotNone(script)
                self.assertIn(f'tell application "{app_name}"', script)
                self.assertIn('active tab of front window', script)

        firefox_script = _browser_script("Firefox")
        self.assertIsNotNone(firefox_script)
        self.assertIn('tell application "System Events"', firefox_script)
        self.assertIn('process "Firefox"', firefox_script)
        self.assertIn('text field 1 of toolbar 1 of front window', firefox_script)
        self.assertNotIn('clipboard', firefox_script.lower())
        self.assertNotIn('keystroke', firefox_script.lower())

        self.assertIsNone(_browser_script("Preview"))

    def test_browser_metadata_matrix_for_supported_browsers(self) -> None:
        cases = [
            "Safari",
            "Google Chrome",
            "Arc",
            "Brave Browser",
            "Chromium",
            "Microsoft Edge",
            "Firefox",
        ]
        url = 'https://www.example.com/path?ref=tracker'
        title = 'Example Title'

        for app_name in cases:
            with self.subTest(app_name=app_name):
                with patch('app.tracker.macos_workspace._run_osascript', return_value=f'{url}\n{title}') as mock_run:
                    result = _browser_metadata(app_name)

                self.assertEqual(
                    result,
                    (
                        app_name,
                        'example.com',
                        title,
                        url,
                        None,
                        None,
                        None,
                    ),
                )
                mock_run.assert_called_once()

    def test_browser_metadata_returns_none_title_for_single_line_output(self) -> None:
        with patch('app.tracker.macos_workspace._run_osascript', return_value='https://www.example.com/path'):
            result = _browser_metadata('Safari')

        self.assertEqual(
            result,
            (
                'Safari',
                'example.com',
                None,
                'https://www.example.com/path',
                None,
                None,
                None,
            ),
        )

    def test_browser_metadata_returns_empty_metadata_for_empty_output(self) -> None:
        with patch('app.tracker.macos_workspace._run_osascript', return_value='') as mock_run:
            result = _browser_metadata('Microsoft Edge')

        self.assertEqual(result, ('Microsoft Edge', None, None, None, None, None, None))
        mock_run.assert_called_once()

    def test_browser_metadata_skips_unsupported_apps_without_running_osascript(self) -> None:
        with patch('app.tracker.macos_workspace._run_osascript') as mock_run:
            result = _browser_metadata('Preview')

        self.assertEqual(result, (None, None, None, None, None, None, None))
        mock_run.assert_not_called()

    def test_browser_metadata_returns_empty_metadata_for_supported_browser_exception(self) -> None:
        with patch('app.tracker.macos_workspace._run_osascript', side_effect=RuntimeError('osascript failed')) as mock_run:
            result = _browser_metadata('Firefox')

        self.assertEqual(result, ('Firefox', None, None, None, None, None, None))
        mock_run.assert_called_once()

    def test_youtube_ids_cover_supported_url_shapes(self) -> None:
        cases = [
            ('https://www.youtube.com/watch?v=abc123&list=PL123', ('abc123', 'PL123', False)),
            ('https://youtu.be/short123', ('short123', None, False)),
            ('https://www.youtube.com/shorts/short456?list=PL456', ('short456', 'PL456', True)),
            ('https://www.youtube.com/embed/embed789?list=PL789', ('embed789', 'PL789', False)),
            ('https://www.youtube.com/live/live999?list=PL999', ('live999', 'PL999', False)),
            ('https://music.youtube.com/watch?v=music321&list=PL321', ('music321', 'PL321', False)),
            ('https://example.com/watch?v=abc123', (None, None, None)),
        ]

        for url, expected in cases:
            with self.subTest(url=url):
                self.assertEqual(_youtube_ids(url), expected)

    def test_current_snapshot_preserves_app_tracking_without_window_title(self) -> None:
        with patch('app.tracker.macos_workspace._run_osascript') as mock_run, \
             patch('app.tracker.macos_workspace.read_front_window_title', return_value=None), \
             patch('app.tracker.macos_workspace._browser_metadata', return_value=(None, None, None, None, None, None, None)) as mock_browser_metadata:
            mock_run.return_value = 'Notes\ncom.apple.Notes'

            snapshot = current_snapshot()

        self.assertEqual(snapshot.app_name, 'Notes')
        self.assertEqual(snapshot.bundle_id, 'com.apple.Notes')
        self.assertIsNone(snapshot.window_title)
        self.assertEqual(snapshot.source, 'nsworkspace')
        mock_browser_metadata.assert_called_once_with('Notes')

    def test_current_snapshot_uses_atomic_window_title_when_available(self) -> None:
        with patch('app.tracker.macos_workspace._run_osascript') as mock_run, \
             patch('app.tracker.macos_workspace.read_front_window_title') as mock_window_title, \
             patch('app.tracker.macos_workspace._browser_metadata', return_value=(None, None, None, None, None, None, None)) as mock_browser_metadata:
            mock_run.return_value = 'Claude\ncom.anthropic.claude\nClaude Chat'

            snapshot = current_snapshot()

        self.assertEqual(snapshot.app_name, 'Claude')
        self.assertEqual(snapshot.bundle_id, 'com.anthropic.claude')
        self.assertEqual(snapshot.window_title, 'Claude Chat')
        self.assertEqual(snapshot.source, 'accessibility')
        mock_window_title.assert_not_called()
        mock_browser_metadata.assert_called_once_with('Claude')

    def test_current_snapshot_uses_same_frontmost_process_for_app_and_window_title(self) -> None:
        with patch('app.tracker.macos_workspace._run_osascript') as mock_run, \
             patch('app.tracker.macos_workspace.read_front_window_title', return_value='Virev AI - Google Chrome') as mock_window_title, \
             patch('app.tracker.macos_workspace._browser_metadata', return_value=(None, None, None, None, None, None, None)) as mock_browser_metadata:
            mock_run.return_value = 'Claude\ncom.anthropic.claude'

            snapshot = current_snapshot()

        self.assertEqual(snapshot.app_name, 'Claude')
        self.assertEqual(snapshot.bundle_id, 'com.anthropic.claude')
        self.assertIsNone(snapshot.window_title)
        self.assertEqual(snapshot.source, 'nsworkspace')
        mock_window_title.assert_not_called()
        mock_browser_metadata.assert_called_once_with('Claude')

    def test_current_snapshot_falls_back_to_lsappinfo_when_system_events_lookup_fails(self) -> None:
        with patch('app.tracker.macos_workspace._run_osascript', side_effect=RuntimeError('System Events lookup failed')) as mock_run, \
             patch('app.tracker.macos_workspace._frontmost_via_lsappinfo', return_value=('Notes', 'com.apple.Notes')) as mock_lsappinfo, \
             patch('app.tracker.macos_workspace.read_front_window_title', return_value=None), \
             patch('app.tracker.macos_workspace._browser_metadata', return_value=(None, None, None, None, None, None, None)):
            snapshot = current_snapshot()

        self.assertEqual(snapshot.app_name, 'Notes')
        self.assertEqual(snapshot.bundle_id, 'com.apple.Notes')
        self.assertIsNone(snapshot.window_title)
        self.assertEqual(snapshot.source, 'nsworkspace')
        mock_run.assert_called_once()
        mock_lsappinfo.assert_called_once()


if __name__ == '__main__':
    unittest.main()
