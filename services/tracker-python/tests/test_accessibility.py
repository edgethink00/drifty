import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.permissions.accessibility import accessibility_granted


class AccessibilityPermissionTests(unittest.TestCase):
    def test_accessibility_granted_when_front_window_title_returns_non_empty_title(self) -> None:
        completed = subprocess.CompletedProcess(
            args=["osascript"],
            returncode=0,
            stdout="Project Plan\n",
            stderr="",
        )

        with patch("app.permissions.accessibility.subprocess.run", return_value=completed) as mock_run:
            self.assertTrue(accessibility_granted())
        script = mock_run.call_args.args[0][2]
        self.assertIn("front window", script)
        self.assertIn("name of front window", script)

    def test_accessibility_denied_when_front_window_title_probe_fails(self) -> None:
        completed = subprocess.CompletedProcess(
            args=["osascript"],
            returncode=1,
            stdout="",
            stderr="Not authorized to send Apple events to System Events.",
        )

        with patch("app.permissions.accessibility.subprocess.run", return_value=completed):
            self.assertFalse(accessibility_granted())

    def test_accessibility_denied_when_front_window_title_is_empty(self) -> None:
        completed = subprocess.CompletedProcess(
            args=["osascript"],
            returncode=0,
            stdout="\n",
            stderr="",
        )

        with patch("app.permissions.accessibility.subprocess.run", return_value=completed):
            self.assertFalse(accessibility_granted())


if __name__ == "__main__":
    unittest.main()
