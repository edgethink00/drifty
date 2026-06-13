import sys
import unittest
from pathlib import Path
from unittest.mock import patch

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.tracker.macos_workspace import BrowserMetadata, _browser_metadata, _browser_script


class BrowserAutomationDiagnosticsTests(unittest.TestCase):
    def test_browser_script_marks_missing_scriptable_window(self) -> None:
        script = _browser_script("Google Chrome")

        self.assertIsNotNone(script)
        self.assertIn('"NO_SCRIPTABLE_WINDOW"', script)

    def test_browser_metadata_marks_missing_scriptable_window_unavailable(self) -> None:
        with patch(
            "app.tracker.macos_workspace._run_osascript",
            return_value="NO_SCRIPTABLE_WINDOW",
        ) as mock_run:
            result = _browser_metadata("Google Chrome")

        self.assertEqual(
            result,
            BrowserMetadata(
                browser_name="Google Chrome",
                browser_automation_status="unavailable",
                browser_automation_error="Google Chrome reported no scriptable browser window.",
            ),
        )
        self.assertIsNone(result.site_url)
        mock_run.assert_called_once()


if __name__ == "__main__":
    unittest.main()
