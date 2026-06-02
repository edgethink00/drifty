import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.tracker.power_state import current_power_state, evaluate_ioreg_power_state, parse_ioreg_root_domain


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

    def test_current_power_state_captures_on_non_darwin(self) -> None:
        with patch("app.tracker.power_state.platform.system", return_value="Linux"):
            sample = current_power_state()

        self.assertTrue(sample.should_capture)
        self.assertEqual(sample.reason, "non_darwin_power_state_unavailable")

    def test_current_power_state_captures_when_probe_fails(self) -> None:
        completed = MagicMock(returncode=1, stdout="")
        with patch("app.tracker.power_state.platform.system", return_value="Darwin"), patch(
            "app.tracker.power_state.subprocess.run", return_value=completed
        ):
            sample = current_power_state()

        self.assertTrue(sample.should_capture)
        self.assertEqual(sample.reason, "power_state_probe_unavailable")


if __name__ == "__main__":
    unittest.main()
