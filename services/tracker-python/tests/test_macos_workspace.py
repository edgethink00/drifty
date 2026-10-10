import os
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app import main as tracker_main
from app.storage.db import TrackerDatabase
from app.tracker.power_state import PowerStateSample
from app.tracker.macos_workspace import (
    BrowserMetadata,
    Snapshot,
    _browser_metadata,
    _browser_script,
    _browser_automation_status_from_error,
    _canonical_macos_app_name,
    _frontmost_via_lsappinfo,
    _run_command,
    _youtube_ids,
    current_snapshot,
)


_MACOS_ONLY = unittest.skipUnless(sys.platform == "darwin", "macOS foreground capture stack")


@_MACOS_ONLY
class MacosWorkspaceTests(unittest.TestCase):
    def test_canonicalizes_firefox_developer_edition_from_bundle_id(self) -> None:
        self.assertEqual(
            _canonical_macos_app_name("firefox", "org.mozilla.firefoxdeveloperedition"),
            "Firefox Developer Edition",
        )
        self.assertEqual(_canonical_macos_app_name("Safari", "com.apple.Safari"), "Safari")

    def test_canonicalizes_release_firefox_from_its_lowercase_process_name(self) -> None:
        # System Events reports the executable name; the browser registry,
        # page capture, and the tab-close path all key on "Firefox".
        self.assertEqual(_canonical_macos_app_name("firefox", "org.mozilla.firefox"), "Firefox")
        self.assertEqual(_canonical_macos_app_name("Firefox", "org.mozilla.firefox"), "Firefox")

    def test_canonicalizes_zen_and_floorp_from_their_lowercase_process_names(self) -> None:
        # Zen 1.22.3b and Floorp 12.18.1 report "zen" and "floorp" through
        # System Events, the same shape as release Firefox.
        self.assertEqual(_canonical_macos_app_name("zen", "app.zen-browser.zen"), "Zen")
        self.assertEqual(_canonical_macos_app_name("floorp", "app.floorp.Floorp"), "Floorp")
        # Without the bundle identity nothing is renamed.
        self.assertEqual(_canonical_macos_app_name("zen", None), "zen")

    def test_current_snapshot_captures_firefox_family_pages_under_the_canonical_name(self) -> None:
        for process_name, bundle_id, app_name in (
            ("firefox", "org.mozilla.firefox", "Firefox"),
            ("zen", "app.zen-browser.zen", "Zen"),
            ("floorp", "app.floorp.Floorp", "Floorp"),
        ):
            with patch('app.tracker.macos_workspace._run_osascript') as mock_run, \
                 patch('app.tracker.macos_workspace._onscreen_window_rows', return_value=[]), \
                 patch('app.tracker.macos_workspace._browser_metadata', return_value=BrowserMetadata()) as mock_browser_metadata:
                mock_run.return_value = f'{process_name}\n{bundle_id}\nShorts'

                snapshot = current_snapshot(include_system_transient=False)

            self.assertEqual(snapshot.app_name, app_name)
            mock_browser_metadata.assert_called_once_with(app_name)

    def test_browser_script_matrix(self) -> None:
        safari_script = _browser_script("Safari")
        self.assertIsNotNone(safari_script)
        self.assertIn('tell application "Safari"', safari_script)
        self.assertIn('name of current tab of w', safari_script)
        self.assertIn('URL of front document', safari_script)
        self.assertIn('name of front document', safari_script)
        self.assertIn('"STALE"', safari_script)

        for app_name in [
            "Google Chrome",
            "Arc",
            "Aside",
            "Brave Browser",
            "Chromium",
            "Microsoft Edge",
            "Opera",
            "Vivaldi",
            "Whale",
        ]:
            with self.subTest(app_name=app_name):
                script = _browser_script(app_name)
                self.assertIsNotNone(script)
                self.assertIn(f'tell application "{app_name}"', script)
                self.assertIn('title of active tab of w', script)
                self.assertIn('count of windows', script)
                self.assertIn('URL of active tab of window 1', script)
                self.assertIn('"STALE"', script)

        firefox_script = _browser_script("Firefox")
        self.assertIsNotNone(firefox_script)
        self.assertIn('tell application "System Events"', firefox_script)
        self.assertIn('process "Firefox"', firefox_script)
        self.assertIn('text field 1 of toolbar 1 of front window', firefox_script)
        self.assertNotIn('clipboard', firefox_script.lower())
        self.assertNotIn('keystroke', firefox_script.lower())

        self.assertIsNone(_browser_script("Preview"))

    def test_browser_scripts_read_ax_title_in_same_pass(self) -> None:
        for app_name in [
            "Safari",
            "Google Chrome",
            "Arc",
            "Aside",
            "Brave Browser",
            "Chromium",
            "Microsoft Edge",
            "Opera",
            "Vivaldi",
            "Whale",
        ]:
            with self.subTest(app_name=app_name):
                script = _browser_script(app_name)
                self.assertIn('first application process whose frontmost is true', script)
                self.assertIn('axTitle starts with tabTitle', script)
                self.assertIn('"front-fallback"', script)
                self.assertIn('"matched"', script)

    def test_browser_metadata_matrix_for_supported_browsers(self) -> None:
        cases = [
            "Safari",
            "Google Chrome",
            "Arc",
            "Aside",
            "Brave Browser",
            "Chromium",
            "Microsoft Edge",
            "Firefox",
            "Firefox Developer Edition",
            "Floorp",
            "Opera",
            "Vivaldi",
            "Whale",
            "Zen",
        ]
        url = 'https://www.example.com/path?ref=tracker'
        title = 'Example Title'
        ax_title = 'Example Title - Google Chrome - Profile'

        for app_name in cases:
            with self.subTest(app_name=app_name):
                with patch(
                    'app.tracker.macos_workspace._run_osascript',
                    return_value=f'{url}\n{title}\nmatched\n{ax_title}',
                ) as mock_run:
                    result = _browser_metadata(app_name)

                if app_name in {'Safari', 'Firefox', 'Firefox Developer Edition', 'Floorp', 'Zen'}:
                    expected = BrowserMetadata(
                        browser_name=app_name,
                        site_domain='example.com',
                        site_url=url,
                        ax_window_title=title,
                        match_state='accessibility-address-bar',
                        browser_automation_status='granted',
                    )
                else:
                    expected = BrowserMetadata(
                        browser_name=app_name,
                        site_domain='example.com',
                        site_title=title,
                        site_url=url,
                        ax_window_title=ax_title,
                        match_state='matched',
                        browser_automation_status='granted',
                    )
                self.assertEqual(result, expected)
                mock_run.assert_called_once()

    def test_browser_metadata_parses_legacy_two_line_output(self) -> None:
        with patch('app.tracker.macos_workspace._run_osascript', return_value='https://www.example.com/path\nExample'):
            result = _browser_metadata('Google Chrome')

        self.assertEqual(
            result,
            BrowserMetadata(
                browser_name='Google Chrome',
                site_domain='example.com',
                site_title='Example',
                site_url='https://www.example.com/path',
                browser_automation_status='granted',
            ),
        )

    def test_browser_metadata_returns_none_title_for_single_line_output(self) -> None:
        with patch('app.tracker.macos_workspace._run_osascript', return_value='https://www.example.com/path'):
            result = _browser_metadata('Google Chrome')

        self.assertEqual(
            result,
            BrowserMetadata(
                browser_name='Google Chrome',
                site_domain='example.com',
                site_url='https://www.example.com/path',
                browser_automation_status='granted',
            ),
        )

    def test_safari_ax_capture_marks_empty_address_result_unavailable(self) -> None:
        with patch('app.tracker.macos_workspace._run_osascript', return_value='') as mock_run:
            result = _browser_metadata('Safari')

        self.assertEqual(
            result,
            BrowserMetadata(
                browser_name='Safari',
                browser_automation_status='unavailable',
                browser_automation_error='Safari accessibility address bar fallback returned an empty result.',
            ),
        )
        self.assertTrue(any('tell application "Safari"' in call.args[0] for call in mock_run.call_args_list))

    def test_browser_metadata_marks_stale_when_frontmost_app_changed(self) -> None:
        with patch('app.tracker.macos_workspace._run_osascript', return_value='STALE') as mock_run:
            result = _browser_metadata('Google Chrome')

        self.assertEqual(result, BrowserMetadata(browser_name='Google Chrome', match_state='stale', browser_automation_status='stale'))
        self.assertIsNone(result.site_domain)
        mock_run.assert_called_once()

    def test_browser_metadata_skips_unsupported_apps_without_running_osascript(self) -> None:
        with patch('app.tracker.macos_workspace._run_osascript') as mock_run:
            result = _browser_metadata('Preview')

        self.assertEqual(result, BrowserMetadata())
        mock_run.assert_not_called()

    def test_browser_metadata_returns_empty_metadata_for_supported_browser_exception(self) -> None:
        with patch('app.tracker.macos_workspace._run_osascript', side_effect=RuntimeError('osascript failed')) as mock_run:
            result = _browser_metadata('Firefox')

        self.assertEqual(
            result,
            BrowserMetadata(
                browser_name='Firefox',
                browser_automation_status='unavailable',
                browser_automation_error='osascript failed',
            ),
        )
        mock_run.assert_called_once()

    def test_browser_metadata_marks_automation_denied_without_site_context(self) -> None:
        with patch(
            'app.tracker.macos_workspace._run_osascript',
            side_effect=RuntimeError('Not authorized to send Apple events to Google Chrome.'),
        ):
            result = _browser_metadata('Google Chrome')

        self.assertEqual(result.browser_name, 'Google Chrome')
        self.assertEqual(result.browser_automation_status, 'denied')
        self.assertEqual(result.browser_automation_error, 'Not authorized to send Apple events to Google Chrome.')
        self.assertIsNone(result.site_domain)

    def test_browser_automation_status_from_error_detects_tcc_denial(self) -> None:
        self.assertEqual(_browser_automation_status_from_error('Not authorized to send Apple events.'), 'denied')
        self.assertEqual(_browser_automation_status_from_error('execution error: Not permitted. (-1743)'), 'denied')
        self.assertEqual(
            _browser_automation_status_from_error(
                'osascript 보조 액세스가 허용되지 않습니다. (-25211)'
            ),
            'denied',
        )
        self.assertEqual(_browser_automation_status_from_error('Google Chrome got an error.'), 'unavailable')

    def test_forced_chromium_ax_capture_marks_localized_assistive_access_denial(self) -> None:
        with patch.dict(os.environ, {"DRIFTY_FORCE_CHROMIUM_AX_CAPTURE": "1"}), patch(
            'app.tracker.macos_workspace._run_osascript',
            side_effect=RuntimeError('osascript 보조 액세스가 허용되지 않습니다. (-25211)'),
        ):
            result = _browser_metadata('Aside')

        self.assertEqual(result.browser_name, 'Aside')
        self.assertEqual(result.browser_automation_status, 'denied')
        self.assertIn('-25211', result.browser_automation_error or '')
        self.assertIsNone(result.site_url)

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

    def test_run_command_raises_runtime_error_on_timeout(self) -> None:
        with self.assertRaises(RuntimeError) as caught:
            _run_command(['/bin/sleep', '5'], timeout=0.1)

        self.assertEqual(str(caught.exception), 'command timed out')

    def test_frontmost_lsappinfo_parses_real_quoted_header_name(self) -> None:
        info = '"Google Chrome" ASN:0x0-0x1c01c: (in front)\n    bundleID="com.google.Chrome"\n'
        with patch('app.tracker.macos_workspace._run_command', side_effect=['ASN:0x0-0x1c01c:', info]):
            app_name, bundle_id, fallback_error, _pid = _frontmost_via_lsappinfo()

        self.assertEqual(app_name, 'Google Chrome')
        self.assertEqual(bundle_id, 'com.google.Chrome')
        self.assertIsNone(fallback_error)

    def test_frontmost_lsappinfo_still_parses_name_field(self) -> None:
        info = '"name"="Notes"\n"bundleID"="com.apple.Notes"\n'
        with patch('app.tracker.macos_workspace._run_command', side_effect=['ASN:0x0-0x2345:', info]):
            app_name, bundle_id, fallback_error, _pid = _frontmost_via_lsappinfo()

        self.assertEqual(app_name, 'Notes')
        self.assertEqual(bundle_id, 'com.apple.Notes')
        self.assertIsNone(fallback_error)

    def test_frontmost_lsappinfo_keeps_error_when_name_is_missing(self) -> None:
        info = 'bundleID="com.google.Chrome"\n'
        with patch('app.tracker.macos_workspace._run_command', side_effect=['ASN:0x0-0x1c01c:', info]):
            app_name, bundle_id, fallback_error, _pid = _frontmost_via_lsappinfo()

        self.assertIsNone(app_name)
        self.assertEqual(bundle_id, 'com.google.Chrome')
        self.assertEqual(fallback_error, 'lsappinfo info returned no parseable app name.')

    def test_current_snapshot_preserves_app_tracking_without_window_title(self) -> None:
        with patch('app.tracker.macos_workspace._run_osascript') as mock_run, \
             patch('app.tracker.macos_workspace._onscreen_window_rows', return_value=[]), \
             patch('app.tracker.macos_workspace.read_front_window_title', return_value=None), \
             patch('app.tracker.macos_workspace._browser_metadata', return_value=BrowserMetadata()) as mock_browser_metadata:
            mock_run.return_value = 'Notes\ncom.apple.Notes'

            snapshot = current_snapshot()

        self.assertEqual(snapshot.app_name, 'Notes')
        self.assertEqual(snapshot.bundle_id, 'com.apple.Notes')
        self.assertIsNone(snapshot.window_title)
        self.assertEqual(snapshot.source, 'nsworkspace')
        self.assertEqual(snapshot.capture_confidence, 1.0)
        self.assertEqual(snapshot.browser_automation_status, 'not_applicable')
        self.assertIsNone(snapshot.system_transient_activity)
        mock_browser_metadata.assert_called_once_with('Notes')

    def test_current_snapshot_leaves_an_unreadable_window_as_an_app_only_segment(self) -> None:
        # The on-screen window list cannot stand in for the accessibility tree:
        # kCGWindowName needs Screen Recording, which Drifty does not request,
        # so every application row arrives unnamed on a real desktop. Reading
        # it here only cost a helper process per title-less capture.
        rows = [
            {"owner_name": "Dock", "layer": 20, "name": "Dock"},
            {"owner_name": "Google Chrome", "layer": 0, "name": None},
        ]
        with patch('app.tracker.macos_workspace._run_osascript') as mock_run, \
             patch('app.tracker.macos_workspace._onscreen_window_rows', return_value=rows) as mock_rows, \
             patch('app.tracker.macos_workspace._browser_metadata', return_value=BrowserMetadata(
                 browser_name="Google Chrome",
                 browser_automation_status="unavailable",
                 browser_automation_error="Google Chrome accessibility address bar fallback found no front window.",
             )):
            mock_run.return_value = 'Google Chrome\ncom.google.Chrome'

            snapshot = current_snapshot(include_system_transient=False)

        self.assertIsNone(snapshot.window_title)
        self.assertIsNone(snapshot.window_title_source)
        self.assertEqual(snapshot.source, "nsworkspace")
        # A capture without a window title must not spend a window-list read.
        mock_rows.assert_not_called()
    def test_current_snapshot_keeps_the_system_events_window_title_source(self) -> None:
        with patch('app.tracker.macos_workspace._run_osascript') as mock_run, \
             patch('app.tracker.macos_workspace._onscreen_window_rows', return_value=[]) as mock_rows, \
             patch('app.tracker.macos_workspace._browser_metadata', return_value=BrowserMetadata()):
            mock_run.return_value = 'Notes\ncom.apple.Notes\nMeeting notes'

            snapshot = current_snapshot(include_system_transient=False)

        self.assertEqual(snapshot.window_title, "Meeting notes")
        self.assertEqual(snapshot.window_title_source, "system-events")
        # A readable title must not cost an extra window-list read.
        mock_rows.assert_not_called()

    def test_current_snapshot_reports_the_browser_accessibility_title_source(self) -> None:
        with patch('app.tracker.macos_workspace._run_osascript') as mock_run, \
             patch('app.tracker.macos_workspace._onscreen_window_rows', return_value=[]), \
             patch('app.tracker.macos_workspace._browser_metadata', return_value=BrowserMetadata(
                 browser_name="Google Chrome",
                 ax_window_title="Same-pass title",
                 site_domain="drifty.so",
                 site_url="https://drifty.so/",
                 match_state="accessibility-address-bar",
             )):
            mock_run.return_value = 'Google Chrome\ncom.google.Chrome'

            snapshot = current_snapshot(include_system_transient=False)

        self.assertEqual(snapshot.window_title, "Same-pass title")
        self.assertEqual(snapshot.window_title_source, "browser-accessibility")

    def test_current_snapshot_marks_mission_control_from_dock_cgwindow_rows(self) -> None:
        mission_control_rows = [
            {"owner_name": "Dock", "layer": 20, "name": "Dock"},
            {"owner_name": "Dock", "layer": 18, "name": ""},
            {"owner_name": "Dock", "layer": 17, "name": "appicon"},
        ]
        with patch('app.tracker.macos_workspace._run_osascript') as mock_run, \
             patch('app.tracker.macos_workspace._onscreen_window_rows', return_value=mission_control_rows), \
             patch('app.tracker.macos_workspace._browser_metadata', return_value=BrowserMetadata()) as mock_browser_metadata:
            mock_run.return_value = 'Google Chrome\ncom.google.Chrome\nActive tab'

            snapshot = current_snapshot()

        self.assertEqual(snapshot.app_name, 'Google Chrome')
        self.assertEqual(snapshot.bundle_id, 'com.google.Chrome')
        self.assertEqual(snapshot.window_title, 'Active tab')
        self.assertEqual(snapshot.system_transient_activity, 'mission_control')
        mock_browser_metadata.assert_called_once_with('Google Chrome')

    def test_current_snapshot_marks_app_switcher_from_dock_cgwindow_rows(self) -> None:
        app_switcher_rows = [
            {"owner_name": "Dock", "layer": 20, "name": ""},
        ]
        with patch('app.tracker.macos_workspace._run_osascript') as mock_run, \
             patch('app.tracker.macos_workspace._onscreen_window_rows', return_value=app_switcher_rows), \
             patch('app.tracker.macos_workspace._browser_metadata', return_value=BrowserMetadata()) as mock_browser_metadata:
            mock_run.return_value = 'Google Chrome\ncom.google.Chrome\nActive tab'

            snapshot = current_snapshot()

        self.assertEqual(snapshot.app_name, 'Google Chrome')
        self.assertEqual(snapshot.bundle_id, 'com.google.Chrome')
        self.assertEqual(snapshot.window_title, 'Active tab')
        self.assertEqual(snapshot.system_transient_activity, 'app_switcher')
        mock_browser_metadata.assert_called_once_with('Google Chrome')

    def test_current_snapshot_ignores_app_switcher_when_window_names_are_unreadable(self) -> None:
        # Without Screen Recording permission every kCGWindowName arrives as
        # None. A permanently visible Dock also lives on layer 20, so treating
        # the missing name as "empty" reported app_switcher forever and
        # suppressed every drift alarm.
        unreadable_dock_rows = [
            {"owner_name": "Dock", "layer": 20, "name": None},
            {"owner_name": "Google Chrome", "layer": 0, "name": None},
        ]
        with patch('app.tracker.macos_workspace._run_osascript') as mock_run, \
             patch('app.tracker.macos_workspace._onscreen_window_rows', return_value=unreadable_dock_rows), \
             patch('app.tracker.macos_workspace._browser_metadata', return_value=BrowserMetadata()):
            mock_run.return_value = 'Google Chrome\ncom.google.Chrome\nActive tab'

            snapshot = current_snapshot()

        self.assertIsNone(snapshot.system_transient_activity)

    def test_current_snapshot_still_detects_app_switcher_when_names_are_readable(self) -> None:
        # A readable name elsewhere proves the empty Dock overlay name is real
        # evidence rather than a permission artifact.
        readable_rows = [
            {"owner_name": "Dock", "layer": 20, "name": ""},
            {"owner_name": "Google Chrome", "layer": 0, "name": "Active tab"},
        ]
        with patch('app.tracker.macos_workspace._run_osascript') as mock_run, \
             patch('app.tracker.macos_workspace._onscreen_window_rows', return_value=readable_rows), \
             patch('app.tracker.macos_workspace._browser_metadata', return_value=BrowserMetadata()):
            mock_run.return_value = 'Google Chrome\ncom.google.Chrome\nActive tab'

            snapshot = current_snapshot()

        self.assertEqual(snapshot.system_transient_activity, 'app_switcher')

    def test_current_snapshot_keeps_mission_control_without_readable_names(self) -> None:
        # Mission Control keys off layer 18 alone, so it must stay detectable
        # even when names are unreadable.
        mission_control_rows = [
            {"owner_name": "Dock", "layer": 18, "name": None},
        ]
        with patch('app.tracker.macos_workspace._run_osascript') as mock_run, \
             patch('app.tracker.macos_workspace._onscreen_window_rows', return_value=mission_control_rows), \
             patch('app.tracker.macos_workspace._browser_metadata', return_value=BrowserMetadata()):
            mock_run.return_value = 'Google Chrome\ncom.google.Chrome\nActive tab'

            snapshot = current_snapshot()

        self.assertEqual(snapshot.system_transient_activity, 'mission_control')

    def test_get_current_snapshot_returns_system_transient_activity(self) -> None:
        snapshot = Snapshot(
            observed_at='2026-06-14T10:00:00+00:00',
            app_name='Google Chrome',
            bundle_id='com.google.Chrome',
            window_title='Active tab',
            source='accessibility',
            system_transient_activity='app_switcher',
            browser_automation_status='not_applicable',
        )

        with patch.object(tracker_main, 'current_snapshot', return_value=snapshot):
            result = tracker_main.get_current_snapshot()

        self.assertTrue(result['ok'])
        self.assertEqual(result['data']['systemTransientActivity'], 'app_switcher')

    def test_current_snapshot_uses_atomic_window_title_when_available(self) -> None:
        with patch('app.tracker.macos_workspace._run_osascript') as mock_run, \
             patch('app.tracker.macos_workspace.read_front_window_title') as mock_window_title, \
             patch('app.tracker.macos_workspace._browser_metadata', return_value=BrowserMetadata()) as mock_browser_metadata:
            mock_run.return_value = 'Claude\ncom.anthropic.claude\nClaude Chat'

            snapshot = current_snapshot()

        self.assertEqual(snapshot.app_name, 'Claude')
        self.assertEqual(snapshot.bundle_id, 'com.anthropic.claude')
        self.assertEqual(snapshot.window_title, 'Claude Chat')
        self.assertEqual(snapshot.source, 'accessibility')
        mock_window_title.assert_not_called()
        mock_browser_metadata.assert_called_once_with('Claude')

    def test_current_snapshot_replaces_generic_native_chatgpt_title_with_session_header(self) -> None:
        helper = chr(10).join(['ok=1', 'project=drifty_mac', 'thread=앱 버튼 UI 일관성 진단', ''])
        with patch('app.tracker.macos_workspace._run_osascript') as mock_run, \
             patch('app.tracker.macos_workspace._run_command', return_value=helper) as mock_command, \
             patch('app.tracker.macos_workspace._browser_metadata', return_value=BrowserMetadata()):
            mock_run.return_value = chr(10).join(['ChatGPT', 'com.openai.codex', 'ChatGPT', '97939'])
            snapshot = current_snapshot(include_system_transient=False)

        self.assertEqual(snapshot.app_name, 'ChatGPT')
        self.assertEqual(snapshot.bundle_id, 'com.openai.codex')
        self.assertEqual(snapshot.window_title, '앱 버튼 UI 일관성 진단 - drifty_mac')
        mock_command.assert_called()

    def test_current_snapshot_uses_same_frontmost_process_for_app_and_window_title(self) -> None:
        with patch('app.tracker.macos_workspace._run_osascript') as mock_run, \
             patch('app.tracker.macos_workspace.read_front_window_title', return_value='Virev AI - Google Chrome') as mock_window_title, \
             patch('app.tracker.macos_workspace._browser_metadata', return_value=BrowserMetadata()) as mock_browser_metadata:
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
             patch('app.tracker.macos_workspace._frontmost_via_lsappinfo', return_value=('Notes', 'com.apple.Notes', None, None)) as mock_lsappinfo, \
             patch('app.tracker.macos_workspace.read_front_window_title', return_value=None), \
             patch('app.tracker.macos_workspace._browser_metadata', return_value=BrowserMetadata()):
            snapshot = current_snapshot()

        self.assertEqual(snapshot.app_name, 'Notes')
        self.assertEqual(snapshot.bundle_id, 'com.apple.Notes')
        self.assertIsNone(snapshot.window_title)
        self.assertEqual(snapshot.source, 'nsworkspace')
        self.assertEqual(snapshot.frontmost_capture_source, 'lsappinfo')
        self.assertEqual(snapshot.frontmost_capture_error, 'System Events lookup failed')
        self.assertIsNone(snapshot.frontmost_fallback_error)
        mock_run.assert_called_once()
        mock_lsappinfo.assert_called_once()

    def test_current_snapshot_falls_back_when_system_events_returns_no_app(self) -> None:
        for result in ('', 'missing value\n\n\n', '\n\n\n'):
            with self.subTest(result=result), \
                 patch('app.tracker.macos_workspace._run_osascript', return_value=result), \
                 patch('app.tracker.macos_workspace._frontmost_via_lsappinfo', return_value=('Notes', 'com.apple.Notes', None, None)) as fallback, \
                 patch('app.tracker.macos_workspace.read_front_window_title', return_value=None), \
                 patch('app.tracker.macos_workspace._browser_metadata', return_value=BrowserMetadata()):
                snapshot = current_snapshot(include_system_transient=False)

                self.assertEqual(snapshot.app_name, 'Notes')
                self.assertEqual(snapshot.bundle_id, 'com.apple.Notes')
                self.assertEqual(snapshot.frontmost_capture_source, 'lsappinfo')
                self.assertEqual(snapshot.frontmost_capture_error, 'System Events returned no frontmost app name.')
                self.assertIsNone(snapshot.frontmost_fallback_error)
                self.assertIsNone(snapshot.window_title)
                fallback.assert_called_once()

    def test_current_snapshot_keeps_a_gap_when_empty_primary_and_fallback_both_fail(self) -> None:
        with patch('app.tracker.macos_workspace._run_osascript', return_value=''), \
             patch('app.tracker.macos_workspace._frontmost_via_lsappinfo', return_value=(None, None, 'lsappinfo front returned NULL.', None)) as fallback, \
             patch('app.tracker.macos_workspace.read_front_window_title') as title, \
             patch('app.tracker.macos_workspace._browser_metadata', return_value=BrowserMetadata()):
            snapshot = current_snapshot(include_system_transient=False)

        self.assertEqual(snapshot.app_name, 'Unavailable')
        self.assertEqual(snapshot.frontmost_capture_source, 'unavailable')
        self.assertEqual(snapshot.frontmost_capture_error, 'System Events returned no frontmost app name.')
        self.assertEqual(snapshot.frontmost_fallback_error, 'lsappinfo front returned NULL.')
        fallback.assert_called_once()
        title.assert_not_called()

    def test_current_snapshot_does_not_replace_a_valid_primary_with_fallback(self) -> None:
        with patch('app.tracker.macos_workspace._run_osascript', return_value='Notes\ncom.apple.Notes\n\n123'), \
             patch('app.tracker.macos_workspace._frontmost_via_lsappinfo') as fallback, \
             patch('app.tracker.macos_workspace._browser_metadata', return_value=BrowserMetadata()):
            snapshot = current_snapshot(include_system_transient=False)

        self.assertEqual(snapshot.app_name, 'Notes')
        self.assertEqual(snapshot.frontmost_capture_source, 'system-events')
        self.assertIsNone(snapshot.frontmost_capture_error)
        fallback.assert_not_called()

    def test_daemon_records_app_time_after_an_empty_primary_read(self) -> None:
        with TemporaryDirectory() as tmp:
            db = TrackerDatabase(Path(tmp) / 'tracker.sqlite3', perform_maintenance=False)
            self.addCleanup(db.close)
            power = PowerStateSample(
                observed_at=datetime.now(timezone.utc), should_capture=True, reason='ok',
            )
            with patch('app.tracker.macos_workspace._run_osascript', return_value=''), \
                 patch('app.tracker.macos_workspace._frontmost_via_lsappinfo', return_value=('Notes', 'com.apple.Notes', None, None)), \
                 patch('app.tracker.macos_workspace.read_front_window_title', return_value=None), \
                 patch('app.tracker.macos_workspace._browser_metadata', return_value=BrowserMetadata()), \
                 patch.object(tracker_main, 'current_power_state', return_value=power), \
                 patch.object(tracker_main, 'seconds_since_last_input', return_value=0.0), \
                 patch.object(tracker_main, '_apply_developer_diagnostics_env'), \
                 patch.object(tracker_main, 'enqueue_youtube_metadata_fetch'), \
                 patch.object(tracker_main, 'backfill_browser_history_context'):
                self.assertIsNotNone(tracker_main._daemon_tick(db, None))

            row = db.connect().execute(
                'SELECT app_name, duration_seconds FROM activity_segments',
            ).fetchone()
            self.assertIsNotNone(row)
            self.assertEqual(row['app_name'], 'Notes')
            self.assertEqual(row['duration_seconds'], tracker_main.SAMPLE_SECONDS)
            db.close()

    def test_current_snapshot_recovers_app_name_from_real_lsappinfo_shape(self) -> None:
        info = '"Google Chrome" ASN:0x0-0x1c01c: (in front)\n    bundleID="com.google.Chrome"\n'
        with patch('app.tracker.macos_workspace._run_osascript', side_effect=RuntimeError('System Events denied')) as mock_run, \
             patch('app.tracker.macos_workspace._run_command', side_effect=['ASN:0x0-0x1c01c:', info, '[]']), \
             patch('app.tracker.macos_workspace.read_front_window_title', return_value=None), \
             patch('app.tracker.macos_workspace._browser_metadata', return_value=BrowserMetadata()) as mock_browser_metadata:
            snapshot = current_snapshot(include_system_transient=False)

        self.assertEqual(snapshot.app_name, 'Google Chrome')
        self.assertEqual(snapshot.bundle_id, 'com.google.Chrome')
        self.assertEqual(snapshot.frontmost_capture_source, 'lsappinfo')
        self.assertEqual(snapshot.frontmost_capture_error, 'System Events denied')
        self.assertIsNone(snapshot.frontmost_fallback_error)
        self.assertIsNone(snapshot.window_title)
        self.assertIsNone(snapshot.window_title_source)
        mock_run.assert_called_once()
        mock_browser_metadata.assert_called_once_with('Google Chrome')

    def test_current_snapshot_can_force_frontmost_lsappinfo_fallback_for_developer_diagnostics(self) -> None:
        info = '"Google Chrome" ASN:0x0-0x1c01c: (in front)\n    bundleID="com.google.Chrome"\n'
        with patch.dict(os.environ, {'DRIFTY_FORCE_FRONTMOST_FALLBACK_CAPTURE': '1'}), \
             patch('app.tracker.macos_workspace._run_osascript') as mock_run, \
             patch('app.tracker.macos_workspace._run_command', side_effect=['ASN:0x0-0x1c01c:', info]), \
             patch('app.tracker.macos_workspace.read_front_window_title', return_value='Chrome window'), \
             patch('app.tracker.macos_workspace._browser_metadata', return_value=BrowserMetadata()) as mock_browser_metadata:
            snapshot = current_snapshot(include_system_transient=False)

        self.assertEqual(snapshot.app_name, 'Google Chrome')
        self.assertEqual(snapshot.bundle_id, 'com.google.Chrome')
        self.assertEqual(snapshot.window_title, 'Chrome window')
        self.assertEqual(snapshot.frontmost_capture_source, 'lsappinfo')
        self.assertEqual(snapshot.frontmost_capture_error, 'System Events frontmost capture skipped by developer diagnostics.')
        self.assertIsNone(snapshot.frontmost_fallback_error)
        mock_run.assert_not_called()
        mock_browser_metadata.assert_called_once_with('Google Chrome')

    def test_current_snapshot_can_force_browser_history_url_fallback_for_developer_diagnostics(self) -> None:
        metadata = BrowserMetadata(
            browser_name='Google Chrome',
            site_domain='youtube.com',
            site_title='Lecture - YouTube',
            site_url='https://www.youtube.com/watch?v=lecture',
            youtube_video_id='lecture',
            match_state='browser-history-title',
            browser_automation_status='granted',
            browser_history_status='matched',
            browser_history_reason='matched',
            browser_history_database_found=True,
            browser_history_profile_count=1,
            browser_history_candidate_count=1,
            browser_history_error_count=0,
        )
        with patch.dict(os.environ, {'DRIFTY_FORCE_BROWSER_HISTORY_URL_FALLBACK': '1'}), \
             patch('app.tracker.macos_workspace._run_osascript') as mock_run, \
             patch('app.tracker.macos_workspace._browser_metadata') as mock_browser_metadata, \
             patch('app.tracker.macos_workspace._browser_history_metadata', return_value=metadata) as mock_history_metadata:
            mock_run.return_value = 'Google Chrome\ncom.google.Chrome\nLecture - YouTube - Google Chrome'

            snapshot = current_snapshot(include_system_transient=False)

        self.assertEqual(snapshot.site_url, 'https://www.youtube.com/watch?v=lecture')
        self.assertEqual(snapshot.site_source, 'browser-history-title')
        self.assertEqual(snapshot.capture_confidence, 0.45)
        self.assertEqual(snapshot.youtube_video_id, 'lecture')
        self.assertEqual(snapshot.browser_history_status, 'matched')
        self.assertEqual(snapshot.browser_history_reason, 'matched')
        self.assertTrue(snapshot.browser_history_database_found)
        self.assertEqual(snapshot.browser_history_profile_count, 1)
        self.assertEqual(snapshot.browser_history_candidate_count, 1)
        self.assertEqual(snapshot.browser_history_error_count, 0)
        mock_browser_metadata.assert_not_called()
        mock_history_metadata.assert_called_once_with('Google Chrome', 'Lecture - YouTube - Google Chrome', snapshot.observed_at)

    def test_current_snapshot_forced_browser_history_unsupported_browser_keeps_no_site_data(self) -> None:
        with patch.dict(os.environ, {'DRIFTY_FORCE_BROWSER_HISTORY_URL_FALLBACK': '1'}), \
             patch('app.tracker.macos_workspace._run_osascript') as mock_run, \
             patch('app.tracker.macos_workspace._browser_metadata') as mock_browser_metadata, \
             patch('app.tracker.macos_workspace._browser_history_metadata') as mock_history_metadata:
            mock_run.return_value = 'Safari\ncom.apple.Safari\nDocs - Safari'

            snapshot = current_snapshot(include_system_transient=False)

        self.assertIsNone(snapshot.site_url)
        self.assertIsNone(snapshot.site_source)
        self.assertEqual(snapshot.browser_automation_status, 'unavailable')
        self.assertEqual(snapshot.browser_automation_error, 'Browser history URL fallback is not supported for Safari.')
        self.assertEqual(snapshot.browser_history_status, 'unsupported')
        self.assertEqual(snapshot.browser_history_reason, 'unsupported_browser')
        self.assertIsNone(snapshot.browser_history_database_found)
        mock_browser_metadata.assert_not_called()
        mock_history_metadata.assert_not_called()

    def test_current_snapshot_uses_browser_history_after_browser_automation_fails(self) -> None:
        automation_metadata = BrowserMetadata(
            browser_name='Google Chrome',
            browser_automation_status='denied',
            browser_automation_error='Not authorized to send Apple events to Google Chrome.',
        )
        history_metadata = BrowserMetadata(
            browser_name='Google Chrome',
            site_domain='docs.example.test',
            site_title='Fallback plan',
            site_url='https://docs.example.test/fallback',
            match_state='browser-history-title',
            browser_automation_status='granted',
            browser_history_status='matched',
            browser_history_reason='matched',
            browser_history_database_found=True,
            browser_history_profile_count=1,
            browser_history_candidate_count=4,
            browser_history_error_count=0,
        )
        with patch.dict(os.environ, {'DRIFTY_FORCE_BROWSER_HISTORY_URL_FALLBACK': '0'}), \
             patch('app.tracker.macos_workspace._run_osascript') as mock_run, \
             patch('app.tracker.macos_workspace._browser_metadata', return_value=automation_metadata) as mock_browser_metadata, \
             patch('app.tracker.macos_workspace._browser_history_metadata', return_value=history_metadata) as mock_history_metadata:
            mock_run.return_value = 'Google Chrome\ncom.google.Chrome\nFallback plan - Google Chrome'

            snapshot = current_snapshot(include_system_transient=False)

        self.assertEqual(snapshot.site_url, 'https://docs.example.test/fallback')
        self.assertEqual(snapshot.site_source, 'browser-history-title')
        self.assertEqual(snapshot.capture_confidence, 0.45)
        self.assertEqual(snapshot.browser_automation_status, 'granted')
        self.assertEqual(snapshot.browser_history_status, 'matched')
        self.assertEqual(snapshot.browser_history_candidate_count, 4)
        mock_browser_metadata.assert_called_once_with('Google Chrome')
        mock_history_metadata.assert_called_once_with('Google Chrome', 'Fallback plan - Google Chrome', snapshot.observed_at)

    def test_current_snapshot_still_records_chrome_when_its_profile_folder_is_protected(self) -> None:
        # DRIFTY-MAC-NATIVE-4G (1.11.23): Apple Events to Chrome were denied, so
        # capture fell back to history, and listing Chrome's profile folder raised
        # PermissionError out of the whole sample.
        automation_metadata = BrowserMetadata(
            browser_name='Google Chrome',
            browser_automation_status='denied',
            browser_automation_error='Not authorized to send Apple events to Google Chrome.',
        )
        with TemporaryDirectory() as profile_root, \
             patch.dict(os.environ, {'DRIFTY_FORCE_BROWSER_HISTORY_URL_FALLBACK': '0'}), \
             patch.dict('app.tracker.browser_history._BROWSER_ROOTS', {'Google Chrome': Path(profile_root)}), \
             patch('app.tracker.macos_workspace._run_osascript') as mock_run, \
             patch('app.tracker.macos_workspace._browser_metadata', return_value=automation_metadata), \
             patch('app.tracker.browser_history.Path.iterdir', side_effect=PermissionError(1, 'Operation not permitted')):
            mock_run.return_value = 'Google Chrome\ncom.google.Chrome\nFallback plan - Google Chrome'

            snapshot = current_snapshot(include_system_transient=False)

        self.assertEqual(snapshot.app_name, 'Google Chrome')
        self.assertEqual(snapshot.bundle_id, 'com.google.Chrome')
        self.assertIsNone(snapshot.site_url)
        self.assertEqual(snapshot.browser_history_reason, 'unreadable_profile_root')

    def test_current_snapshot_keeps_direct_browser_url_without_history_lookup(self) -> None:
        metadata = BrowserMetadata(
            browser_name='Google Chrome',
            site_domain='example.com',
            site_title='Example',
            site_url='https://example.com/',
            match_state='matched',
            browser_automation_status='granted',
        )
        with patch('app.tracker.macos_workspace._run_osascript') as mock_run, \
             patch('app.tracker.macos_workspace._browser_metadata', return_value=metadata), \
             patch('app.tracker.macos_workspace._browser_history_metadata') as mock_history_metadata:
            mock_run.return_value = 'Google Chrome\ncom.google.Chrome\nExample - Google Chrome'

            snapshot = current_snapshot(include_system_transient=False)

        self.assertEqual(snapshot.site_url, 'https://example.com/')
        self.assertEqual(snapshot.site_source, 'applescript')
        self.assertIsNone(snapshot.browser_history_status)
        mock_history_metadata.assert_not_called()

    def test_current_snapshot_preserves_automation_error_when_history_has_no_match(self) -> None:
        automation_metadata = BrowserMetadata(
            browser_name='Google Chrome',
            browser_automation_status='unavailable',
            browser_automation_error='Google Chrome returned an empty browser automation result.',
        )
        history_metadata = BrowserMetadata(
            browser_name='Google Chrome',
            browser_automation_status='unavailable',
            browser_automation_error='Google Chrome browser history fallback found no unique browser history title match: no_match.',
            browser_history_status='no_match',
            browser_history_reason='no_match',
            browser_history_database_found=True,
            browser_history_profile_count=1,
            browser_history_candidate_count=3,
            browser_history_error_count=0,
        )
        with patch('app.tracker.macos_workspace._run_osascript') as mock_run, \
             patch('app.tracker.macos_workspace._browser_metadata', return_value=automation_metadata), \
             patch('app.tracker.macos_workspace._browser_history_metadata', return_value=history_metadata) as mock_history_metadata:
            mock_run.return_value = 'Google Chrome\ncom.google.Chrome\nMissing page - Google Chrome'

            snapshot = current_snapshot(include_system_transient=False)

        self.assertIsNone(snapshot.site_url)
        self.assertIsNone(snapshot.site_source)
        self.assertEqual(snapshot.browser_automation_status, 'unavailable')
        self.assertEqual(snapshot.browser_automation_error, 'Google Chrome returned an empty browser automation result.')
        self.assertEqual(snapshot.browser_history_status, 'no_match')
        self.assertEqual(snapshot.browser_history_reason, 'no_match')
        self.assertTrue(snapshot.browser_history_database_found)
        self.assertEqual(snapshot.browser_history_candidate_count, 3)
        mock_history_metadata.assert_called_once_with('Google Chrome', 'Missing page - Google Chrome', snapshot.observed_at)

    def test_current_snapshot_records_frontmost_diagnostics_when_all_app_capture_fails(self) -> None:
        with patch('app.tracker.macos_workspace._run_osascript', side_effect=RuntimeError('osascript timed out')), \
             patch(
                 'app.tracker.macos_workspace._frontmost_via_lsappinfo',
                 return_value=(None, None, 'lsappinfo info returned no parseable app name.', None),
             ), \
             patch('app.tracker.macos_workspace.read_front_window_title') as mock_window_title, \
             patch('app.tracker.macos_workspace._browser_metadata', return_value=BrowserMetadata()):
            snapshot = current_snapshot()

        self.assertEqual(snapshot.app_name, 'Unavailable')
        self.assertIsNone(snapshot.bundle_id)
        self.assertIsNone(snapshot.window_title)
        self.assertEqual(snapshot.source, 'nsworkspace')
        self.assertEqual(snapshot.frontmost_capture_source, 'unavailable')
        self.assertEqual(snapshot.frontmost_capture_error, 'osascript timed out')
        self.assertEqual(snapshot.frontmost_fallback_error, 'lsappinfo info returned no parseable app name.')
        mock_window_title.assert_not_called()

    def test_current_snapshot_prefers_ax_title_from_browser_pass(self) -> None:
        metadata = BrowserMetadata(
            browser_name='Google Chrome',
            site_domain='youtube.com',
            site_title='Video - YouTube',
            site_url='https://www.youtube.com/watch?v=abc123',
            youtube_video_id='abc123',
            ax_window_title='Video - YouTube - 오디오 재생 - Chrome - Alex',
            match_state='matched',
            browser_automation_status='granted',
        )
        with patch('app.tracker.macos_workspace._run_osascript') as mock_run, \
             patch('app.tracker.macos_workspace._browser_metadata', return_value=metadata):
            mock_run.return_value = 'Google Chrome\ncom.google.Chrome\nStale earlier title'

            snapshot = current_snapshot()

        self.assertEqual(snapshot.window_title, 'Video - YouTube - 오디오 재생 - Chrome - Alex')
        self.assertEqual(snapshot.site_domain, 'youtube.com')
        self.assertEqual(snapshot.site_source, 'applescript')
        self.assertEqual(snapshot.capture_confidence, 1.0)
        self.assertEqual(snapshot.browser_automation_status, 'granted')
        self.assertEqual(snapshot.source, 'accessibility')

    def test_current_snapshot_lowers_confidence_on_front_fallback_with_ax_title(self) -> None:
        metadata = BrowserMetadata(
            browser_name='Google Chrome',
            site_domain='newtab',
            site_title='새 탭',
            site_url='chrome://newtab/',
            ax_window_title='Video - YouTube - Chrome - Alex',
            match_state='front-fallback',
            browser_automation_status='granted',
        )
        with patch('app.tracker.macos_workspace._run_osascript') as mock_run, \
             patch('app.tracker.macos_workspace._browser_metadata', return_value=metadata):
            mock_run.return_value = 'Google Chrome\ncom.google.Chrome\nVideo - YouTube - Chrome - Alex'

            snapshot = current_snapshot()

        self.assertEqual(snapshot.site_source, 'applescript-front-window')
        self.assertEqual(snapshot.capture_confidence, 0.5)

    def test_current_snapshot_front_fallback_without_ax_title_keeps_moderate_confidence(self) -> None:
        metadata = BrowserMetadata(
            browser_name='Google Chrome',
            site_domain='example.com',
            site_title='Example',
            site_url='https://example.com/',
            ax_window_title=None,
            match_state='front-fallback',
            browser_automation_status='granted',
        )
        with patch('app.tracker.macos_workspace._run_osascript') as mock_run, \
             patch('app.tracker.macos_workspace._browser_metadata', return_value=metadata):
            mock_run.return_value = 'Google Chrome\ncom.google.Chrome'

            snapshot = current_snapshot()

        self.assertEqual(snapshot.site_source, 'applescript-front-window')
        self.assertEqual(snapshot.capture_confidence, 0.8)
        self.assertIsNone(snapshot.window_title)

    def test_current_snapshot_records_no_site_data_for_stale_browser_read(self) -> None:
        metadata = BrowserMetadata(browser_name='Google Chrome', match_state='stale', browser_automation_status='stale')
        with patch('app.tracker.macos_workspace._run_osascript') as mock_run, \
             patch('app.tracker.macos_workspace._browser_metadata', return_value=metadata):
            mock_run.return_value = 'Google Chrome\ncom.google.Chrome\nSome window'

            snapshot = current_snapshot()

        self.assertIsNone(snapshot.site_domain)
        self.assertIsNone(snapshot.site_source)
        self.assertEqual(snapshot.capture_confidence, 1.0)


if __name__ == '__main__':
    unittest.main()
