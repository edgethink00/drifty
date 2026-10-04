import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.tracker.macos_frontmost import (
    frontmost_via_lsappinfo,
    frontmost_via_system_events,
    normalize_lsappinfo_asn,
)


_MACOS_ONLY = unittest.skipUnless(sys.platform == "darwin", "macOS foreground capture stack")
_OBSERVED_FRONT_ASN = "ASN:0x0-c00c:"
_CANONICAL_FRONT_ASN = "ASN:0x0-0xc00c:"
_OBSERVED_INFO = '"drifty" ASN:0x0-c00c: (in front)\n    bundleID="so.drifty.mac"\n'


@_MACOS_ONLY
class MacosFrontmostScriptTests(unittest.TestCase):
    @staticmethod
    def _run_with_os_reads_stubbed(script: str, window_read: str, *, fail_identity: bool = False) -> str:
        # Execute the production error boundary in Apple's interpreter, with
        # only the OS reads replaced. This never touches the user's windows or
        # requires Accessibility/Automation permission on a CI host.
        script = script.replace('tell application "System Events"', 'tell me')
        script = script.replace('set frontApp to first application process whose frontmost is true', 'set frontApp to me')
        script = script.replace(
            'set appName to name of frontApp',
            'error "identity unavailable" number -600' if fail_identity else 'set appName to "Notes"',
        )
        script = script.replace('set bundleId to bundle identifier of frontApp', 'set bundleId to "com.apple.Notes"')
        script = script.replace('set unixId to unix id of frontApp', 'set unixId to 4242')
        script, count = re.subn(r'tell frontApp\b.*?end tell', lambda _: window_read, script, count=1, flags=re.DOTALL)
        if count != 1:
            raise AssertionError("The foreground window read was not replaced")
        result = subprocess.run(['osascript', '-e', script], capture_output=True, text=True, timeout=5)
        if result.returncode:
            raise RuntimeError(result.stderr.strip())
        return result.stdout.strip()

    def test_window_read_errors_preserve_the_captured_app_and_pid(self) -> None:
        # A disappearing window, a nonresponsive AX target, and denied AX
        # access must not invalidate the app identity already read successfully.
        for code in (-1728, -25204, -25211):
            with self.subTest(code=code):
                result = frontmost_via_system_events(
                    lambda script: self._run_with_os_reads_stubbed(
                        script, f'set windowTitle to "partial title"\nerror "window unavailable" number {code}'
                    )
                )
                self.assertEqual(result, ("Notes", "com.apple.Notes", None, 4242))

    def test_successful_window_read_keeps_the_title(self) -> None:
        result = frontmost_via_system_events(
            lambda script: self._run_with_os_reads_stubbed(script, 'set windowTitle to "Meeting notes"')
        )
        self.assertEqual(result, ("Notes", "com.apple.Notes", "Meeting notes", 4242))

    def test_identity_failure_still_reaches_the_existing_fallback(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "identity unavailable"):
            frontmost_via_system_events(
                lambda script: self._run_with_os_reads_stubbed(
                    script, 'set windowTitle to "Meeting notes"', fail_identity=True
                )
            )

    def test_daemon_records_app_time_after_window_error_without_retrying_capture(self) -> None:
        from datetime import datetime, timezone
        from app import main as tracker_main
        from app.storage.db import TrackerDatabase
        from app.tracker.macos_workspace import BrowserMetadata
        from app.tracker.power_state import PowerStateSample

        with tempfile.TemporaryDirectory() as directory:
            db = TrackerDatabase(Path(directory) / 'tracker.sqlite3', perform_maintenance=False)
            self.addCleanup(db.close)
            power = PowerStateSample(observed_at=datetime.now(timezone.utc), should_capture=True, reason='ok')
            with patch(
                'app.tracker.macos_workspace._run_osascript',
                side_effect=lambda script: self._run_with_os_reads_stubbed(
                    script, 'error "window disappeared" number -1728'
                ),
            ), patch(
                'app.tracker.macos_workspace._frontmost_via_fallback_capture',
                return_value=(None, None, None, 'fallback unavailable', None),
            ) as fallback, patch(
                'app.tracker.macos_workspace._browser_metadata', return_value=BrowserMetadata(),
            ), patch.object(tracker_main, 'current_power_state', return_value=power), \
                 patch.object(tracker_main, 'seconds_since_last_input', return_value=0.0), \
                 patch.object(tracker_main, '_apply_developer_diagnostics_env'), \
                 patch.object(tracker_main, 'enqueue_youtube_metadata_fetch'), \
                 patch.object(tracker_main, 'backfill_browser_history_context'):
                self.assertIsNotNone(tracker_main._daemon_tick(db, None))

            fallback.assert_not_called()
            row = db.connect().execute('SELECT app_name, duration_seconds FROM activity_segments').fetchone()
            self.assertEqual(row['app_name'], 'Notes')
            self.assertEqual(row['duration_seconds'], tracker_main.SAMPLE_SECONDS)
            db.close()

    def test_unmodified_script_compiles_with_system_events_dictionary(self) -> None:
        runner = Mock(return_value="Notes\ncom.apple.Notes\nTitle\n4242")
        frontmost_via_system_events(runner)
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run(
                ['osacompile', '-o', str(Path(directory) / 'foreground.scpt'), '-e', runner.call_args.args[0]],
                capture_output=True, text=True, timeout=10,
            )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_frontmost_script_recovers_aside_main_title_from_exact_synthetic_window_shape(self) -> None:
        run_osascript = Mock(return_value="Aside\ncom.example.aside\nRecovered title")

        result = frontmost_via_system_events(run_osascript)

        self.assertEqual(result[:3], ("Aside", "com.example.aside", "Recovered title"))
        script = run_osascript.call_args.args[0]
        self.assertIn('if appName is "Aside" and windowTitle is ""', script)
        self.assertIn('frontSubrole is "AXUnknown" and frontChildCount is 0', script)
        self.assertIn('first window whose value of attribute "AXMain" is true', script)
        self.assertIn('first window whose subrole is "AXStandardWindow"', script)
        self.assertLess(
            script.index('first window whose value of attribute "AXMain" is true'),
            script.index('first window whose subrole is "AXStandardWindow"'),
        )

    def test_multiline_window_title_cannot_replace_the_process_id(self) -> None:
        result = frontmost_via_system_events(Mock(return_value="Notes\ncom.apple.Notes\nFirst line\n123\nLast line\n4242"))
        self.assertEqual(result, ("Notes", "com.apple.Notes", "First line\n123\nLast line", 4242))

    def test_frontmost_parser_still_preserves_empty_window_titles(self) -> None:
        run_osascript = Mock(return_value="Google Chrome\ncom.google.Chrome\n")

        result = frontmost_via_system_events(run_osascript)

        self.assertEqual(result[:3], ("Google Chrome", "com.google.Chrome", None))


class MacosFrontmostLsappinfoTests(unittest.TestCase):
    def test_normalize_lsappinfo_asn_rewrites_observed_missing_second_0x(self) -> None:
        self.assertEqual(normalize_lsappinfo_asn(_OBSERVED_FRONT_ASN), _CANONICAL_FRONT_ASN)

    def test_normalize_lsappinfo_asn_rewrites_digit_only_low_word(self) -> None:
        self.assertEqual(normalize_lsappinfo_asn("ASN:0x0-123:"), "ASN:0x0-0x123:")

    def test_normalize_lsappinfo_asn_preserves_canonical_and_bracketed_forms(self) -> None:
        self.assertEqual(normalize_lsappinfo_asn("ASN:0x0-0x1c01c:"), "ASN:0x0-0x1c01c:")
        self.assertEqual(normalize_lsappinfo_asn("[ ASN:0x0-0x1c01c: ]"), "ASN:0x0-0x1c01c:")

    def test_normalize_lsappinfo_asn_does_not_invent_tokens_for_malformed_input(self) -> None:
        self.assertEqual(normalize_lsappinfo_asn("not-an-asn"), "not-an-asn")
        self.assertEqual(normalize_lsappinfo_asn("ASN:front:"), "ASN:front:")

    def test_frontmost_lsappinfo_uses_normalized_asn_for_observed_macos_14_front_token(self) -> None:
        commands: list[list[str]] = []

        def run_command(command: list[str]) -> str:
            commands.append(command)
            if command == ["lsappinfo", "front"]:
                return _OBSERVED_FRONT_ASN
            if command == ["lsappinfo", "info", _OBSERVED_FRONT_ASN]:
                return ""
            if command == ["lsappinfo", "info", _CANONICAL_FRONT_ASN]:
                return _OBSERVED_INFO
            raise AssertionError(command)

        app_name, bundle_id, fallback_error, pid = frontmost_via_lsappinfo(run_command)

        self.assertEqual(app_name, "drifty")
        self.assertEqual(bundle_id, "so.drifty.mac")
        self.assertIsNone(fallback_error)
        self.assertIsNone(pid)
        self.assertEqual(
            commands,
            [
                ["lsappinfo", "front"],
                ["lsappinfo", "info", _CANONICAL_FRONT_ASN],
            ],
        )

    def test_frontmost_lsappinfo_normalizes_digit_only_low_word_before_info(self) -> None:
        commands: list[list[str]] = []

        def run_command(command: list[str]) -> str:
            commands.append(command)
            if command == ["lsappinfo", "front"]:
                return "ASN:0x0-123:"
            if command == ["lsappinfo", "info", "ASN:0x0-0x123:"]:
                return '"Notes" ASN:0x0-0x123: (in front)\n    bundleID="com.apple.Notes"\n'
            raise AssertionError(command)

        app_name, bundle_id, fallback_error, _pid = frontmost_via_lsappinfo(run_command)

        self.assertEqual(app_name, "Notes")
        self.assertEqual(bundle_id, "com.apple.Notes")
        self.assertIsNone(fallback_error)
        self.assertEqual(commands[1], ["lsappinfo", "info", "ASN:0x0-0x123:"])

    def test_frontmost_lsappinfo_still_parses_canonical_asn_and_name_field(self) -> None:
        def run_command(command: list[str]) -> str:
            if command == ["lsappinfo", "front"]:
                return "ASN:0x0-0x1c01c:"
            if command == ["lsappinfo", "info", "ASN:0x0-0x1c01c:"]:
                return '"name"="Google Chrome"\n"bundleID"="com.google.Chrome"\n'
            raise AssertionError(command)

        app_name, bundle_id, fallback_error, _pid = frontmost_via_lsappinfo(run_command)

        self.assertEqual(app_name, "Google Chrome")
        self.assertEqual(bundle_id, "com.google.Chrome")
        self.assertIsNone(fallback_error)

    def test_frontmost_lsappinfo_keeps_null_front_error(self) -> None:
        run_command = Mock(return_value="NULL")

        app_name, bundle_id, fallback_error, pid = frontmost_via_lsappinfo(run_command)

        self.assertIsNone(app_name)
        self.assertIsNone(bundle_id)
        self.assertEqual(fallback_error, "lsappinfo front returned NULL.")
        self.assertIsNone(pid)
        run_command.assert_called_once_with(["lsappinfo", "front"])

    def test_frontmost_lsappinfo_passes_malformed_front_token_through_without_substitution(self) -> None:
        def run_command(command: list[str]) -> str:
            if command == ["lsappinfo", "front"]:
                return "ASN:front:"
            if command == ["lsappinfo", "info", "ASN:front:"]:
                return ""
            raise AssertionError(command)

        app_name, bundle_id, fallback_error, _pid = frontmost_via_lsappinfo(run_command)

        self.assertIsNone(app_name)
        self.assertIsNone(bundle_id)
        self.assertEqual(fallback_error, "lsappinfo info returned no parseable app name.")


if __name__ == "__main__":
    unittest.main()
