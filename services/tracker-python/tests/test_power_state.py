import ctypes
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.tracker.power_state import _IOKitPowerReader, _read_native_power_state, current_power_state, evaluate_ioreg_power_state, parse_ioreg_root_domain


class PowerStateTests(unittest.TestCase):
    def test_parse_ioreg_root_domain_extracts_key_values(self) -> None:
        values = parse_ioreg_root_domain(
            '    | |   "WakeType" = "MaintenanceWake"\n'
            '    | |   "IOPMUserTriggeredFullWake" = No\n'
        )

        self.assertEqual(values["WakeType"], "MaintenanceWake")
        self.assertEqual(values["IOPMUserTriggeredFullWake"], "No")

    def test_evaluate_suppresses_darkwake(self) -> None:
        observed_at = datetime(2026, 4, 6, 9, 0, tzinfo=timezone.utc)

        sample = evaluate_ioreg_power_state('"WakeType" = "DarkWake"', observed_at=observed_at)

        self.assertFalse(sample.should_capture)
        self.assertEqual(sample.observed_at, observed_at)
        self.assertEqual(sample.reason, "non_user_visible_wake_type:darkwake")

    def test_evaluate_suppresses_ioreg_wake_type_key(self) -> None:
        sample = evaluate_ioreg_power_state('"Wake Type" = "MaintenanceWake"')

        self.assertFalse(sample.should_capture)
        self.assertEqual(sample.reason, "non_user_visible_wake_type:maintenancewake")

    def test_evaluate_suppresses_maintenance_wake(self) -> None:
        sample = evaluate_ioreg_power_state('"WakeType" = "Maintenance Wake"')

        self.assertFalse(sample.should_capture)
        self.assertEqual(sample.reason, "non_user_visible_wake_type:maintenancewake")

    def test_evaluate_suppresses_sleepservice(self) -> None:
        sample = evaluate_ioreg_power_state('"WakeType" = "SleepService"')

        self.assertFalse(sample.should_capture)
        self.assertEqual(sample.reason, "non_user_visible_wake_type:sleepservice")

    def test_evaluate_captures_non_user_triggered_full_wake(self) -> None:
        sample = evaluate_ioreg_power_state('"IOPMUserTriggeredFullWake" = No')

        self.assertTrue(sample.should_capture)
        self.assertEqual(sample.reason, "active_power_state")

    def test_evaluate_captures_user_activity_assertion_even_when_full_wake_is_not_user_triggered(self) -> None:
        sample = evaluate_ioreg_power_state(
            '"Wake Type" = "UserActivity Assertion"\n'
            '"IOPMUserTriggeredFullWake" = No\n'
            '"IOPMUserIsActive" = Yes\n'
            '"AppleClamshellState" = No\n'
            '"AppleClamshellCausesSleep" = Yes\n'
        )

        self.assertTrue(sample.should_capture)
        self.assertEqual(sample.reason, "active_power_state")

    def test_evaluate_captures_user_active_closed_clamshell(self) -> None:
        sample = evaluate_ioreg_power_state(
            '"Wake Type" = "UserActivity Assertion"\n'
            '"IOPMUserIsActive" = Yes\n'
            '"AppleClamshellState" = Yes\n'
            '"AppleClamshellCausesSleep" = Yes\n'
        )

        self.assertTrue(sample.should_capture)
        self.assertEqual(sample.reason, "active_power_state")

    def test_evaluate_suppresses_darkwake_even_when_closed_clamshell_reports_user_active(self) -> None:
        sample = evaluate_ioreg_power_state(
            '"Wake Type" = "DarkWake"\n'
            '"IOPMUserIsActive" = Yes\n'
            '"AppleClamshellState" = Yes\n'
            '"AppleClamshellCausesSleep" = Yes\n'
        )

        self.assertFalse(sample.should_capture)
        self.assertEqual(sample.reason, "non_user_visible_wake_type:darkwake")

    def test_evaluate_suppresses_closed_clamshell_sleep_state(self) -> None:
        sample = evaluate_ioreg_power_state(
            '"AppleClamshellState" = Yes\n'
            '"AppleClamshellCausesSleep" = Yes\n'
        )

        self.assertFalse(sample.should_capture)
        self.assertEqual(sample.reason, "clamshell_sleep_state")

    def test_evaluate_captures_active_and_unknown_power_state(self) -> None:
        active = evaluate_ioreg_power_state('"IOPMUserTriggeredFullWake" = Yes')
        unknown = evaluate_ioreg_power_state("")

        self.assertTrue(active.should_capture)
        self.assertEqual(active.reason, "active_power_state")
        self.assertTrue(unknown.should_capture)
        self.assertEqual(unknown.reason, "power_state_unknown")

    def test_native_library_failure_uses_legacy_probe(self) -> None:
        with patch("app.tracker.power_state._native_power_reader", side_effect=OSError("unavailable")):
            self.assertIsNone(_read_native_power_state())

    def test_native_reader_releases_snapshot_and_service_when_string_conversion_fails(self) -> None:
        reader = _IOKitPowerReader.__new__(_IOKitPowerReader)
        reader.io = MagicMock()
        reader.cf = MagicMock()
        reader.io.IOServiceNameMatching.return_value = 10
        reader.io.IOServiceGetMatchingService.return_value = 11
        def copy_properties(entry, output, allocator, options):
            ctypes.cast(output, ctypes.POINTER(ctypes.c_void_p))[0] = 55
            return 0
        reader.io.IORegistryEntryCreateCFProperties.side_effect = copy_properties
        reader.cf.CFStringCreateWithCString.return_value = 7
        reader.cf.CFDictionaryGetValue.return_value = 8
        reader.cf.CFGetTypeID.return_value = 2
        reader.cf.CFBooleanGetTypeID.return_value = 1
        reader.cf.CFStringGetTypeID.return_value = 2
        reader.cf.CFStringGetLength.return_value = 5
        reader.cf.CFStringGetMaximumSizeForEncoding.return_value = 20
        reader.cf.CFStringGetCString.return_value = 0
        self.assertIsNone(reader.read())
        released = [getattr(call.args[0], "value", call.args[0]) for call in reader.cf.CFRelease.call_args_list]
        self.assertEqual(released, [7, 55])
        reader.io.IOObjectRelease.assert_called_once_with(11)

    def test_native_power_state_uses_same_darkwake_precedence_without_subprocess(self) -> None:
        with patch("app.tracker.power_state.platform.system", return_value="Darwin"), patch(
            "app.tracker.power_state._read_native_power_state",
            return_value={"Wake Type": "DarkWake", "IOPMUserIsActive": "Yes"},
        ), patch("app.tracker.power_state.subprocess.run") as run:
            sample = current_power_state()
        self.assertFalse(sample.should_capture)
        self.assertEqual(sample.reason, "non_user_visible_wake_type:darkwake")
        run.assert_not_called()

    def test_current_power_state_captures_on_non_darwin(self) -> None:
        with patch("app.tracker.power_state.platform.system", return_value="Linux"):
            sample = current_power_state()

        self.assertTrue(sample.should_capture)
        self.assertEqual(sample.reason, "non_darwin_power_state_unavailable")

    def test_current_power_state_captures_user_active_closed_clamshell_from_ioreg(self) -> None:
        completed = MagicMock(
            returncode=0,
            stdout=(
                '    | |   "Wake Type" = "UserActivity Assertion"\n'
                '    | |   "IOPMUserIsActive" = Yes\n'
                '    | |   "AppleClamshellState" = Yes\n'
                '    | |   "AppleClamshellCausesSleep" = Yes\n'
            ),
        )
        with patch("app.tracker.power_state._read_native_power_state", return_value=None), patch("app.tracker.power_state.platform.system", return_value="Darwin"), patch(
            "app.tracker.power_state.subprocess.run", return_value=completed
        ) as run:
            sample = current_power_state()

        self.assertTrue(sample.should_capture)
        self.assertEqual(sample.reason, "active_power_state")
        run.assert_called_once_with(
            ["ioreg", "-r", "-n", "IOPMrootDomain", "-d", "1"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=2,
            check=False,
        )

    def test_current_power_state_captures_when_probe_fails(self) -> None:
        completed = MagicMock(returncode=1, stdout="")
        with patch("app.tracker.power_state._read_native_power_state", return_value=None), patch("app.tracker.power_state.platform.system", return_value="Darwin"), patch(
            "app.tracker.power_state.subprocess.run", return_value=completed
        ):
            sample = current_power_state()

        self.assertTrue(sample.should_capture)
        self.assertEqual(sample.reason, "power_state_probe_unavailable")


if __name__ == "__main__":
    unittest.main()
