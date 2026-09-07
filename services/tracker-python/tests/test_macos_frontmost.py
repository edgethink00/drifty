import sys
import unittest
from pathlib import Path
from unittest.mock import Mock

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
