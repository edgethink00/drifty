import os
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.tracker.accessibility_address_bar import accessibility_address_bar_script
from app.tracker.macos_workspace import BrowserMetadata, _browser_metadata, _browser_script


class BrowserAutomationDiagnosticsTests(unittest.TestCase):
    def test_accessibility_address_bar_imports_with_system_python(self) -> None:
        env = {**os.environ, "PYTHONPATH": str(SERVICE_ROOT)}

        result = subprocess.run(
            ["/usr/bin/python3", "-c", "import app.tracker.accessibility_address_bar"],
            capture_output=True,
            env=env,
            text=True,
            check=False,
        )

        self.assertEqual(result.returncode, 0, result.stderr)

    def test_accessibility_address_bar_script_uses_bounded_ui_element_scan(self) -> None:
        script = accessibility_address_bar_script("Google Chrome")

        self.assertIn("UI elements of theElement", script)
        self.assertIn('roleText is "AXWebArea"', script)
        self.assertIn("property maxVisited : 500", script)
        self.assertIn("property bestPriority : -1", script)
        self.assertNotIn("entire contents", script)

    def test_browser_script_marks_missing_scriptable_window(self) -> None:
        script = _browser_script("Google Chrome")

        self.assertIsNotNone(script)
        self.assertIn('"NO_SCRIPTABLE_WINDOW"', script)

    def test_browser_script_supports_chrome_canary(self) -> None:
        script = _browser_script("Google Chrome Canary")

        self.assertIsNotNone(script)
        self.assertIn('tell application "Google Chrome Canary"', script)

    def test_browser_metadata_marks_missing_scriptable_window_unavailable(self) -> None:
        with patch(
            "app.tracker.macos_workspace._run_osascript",
            side_effect=["NO_SCRIPTABLE_WINDOW", "AX_NO_ADDRESS_FIELD"],
        ) as mock_run:
            result = _browser_metadata("Google Chrome")

        self.assertEqual(
            result,
            BrowserMetadata(
                browser_name="Google Chrome",
                browser_automation_status="unavailable",
                browser_automation_error="Google Chrome accessibility address bar fallback found no readable address field.",
            ),
        )
        self.assertIsNone(result.site_url)
        self.assertEqual(mock_run.call_count, 2)

    def test_browser_metadata_uses_accessibility_address_bar_when_scriptable_window_missing(self) -> None:
        with patch(
            "app.tracker.macos_workspace._run_osascript",
            side_effect=[
                "NO_SCRIPTABLE_WINDOW",
                "https://www.example.com/path?from=ax\nExample Page - Google Chrome",
            ],
        ):
            result = _browser_metadata("Google Chrome")

        self.assertEqual(
            result,
            BrowserMetadata(
                browser_name="Google Chrome",
                site_domain="example.com",
                site_url="https://www.example.com/path?from=ax",
                ax_window_title="Example Page - Google Chrome",
                match_state="accessibility-address-bar",
                browser_automation_status="granted",
            ),
        )

    def test_browser_metadata_normalizes_schemaless_accessibility_address(self) -> None:
        with patch(
            "app.tracker.macos_workspace._run_osascript",
            side_effect=[
                RuntimeError("Google Chrome got an error: active tab unavailable."),
                "example.com/docs\nExample Docs - Google Chrome",
            ],
        ):
            result = _browser_metadata("Google Chrome")

        self.assertEqual(result.site_domain, "example.com")
        self.assertEqual(result.site_url, "https://example.com/docs")
        self.assertEqual(result.match_state, "accessibility-address-bar-schemaless")
        self.assertEqual(result.browser_automation_status, "granted")

    def test_browser_metadata_ignores_invalid_accessibility_address_value(self) -> None:
        with patch(
            "app.tracker.macos_workspace._run_osascript",
            side_effect=[
                "NO_SCRIPTABLE_WINDOW",
                "Search Google or type a URL\nNew Tab - Google Chrome",
            ],
        ):
            result = _browser_metadata("Google Chrome")

        self.assertEqual(
            result,
            BrowserMetadata(
                browser_name="Google Chrome",
                browser_automation_status="unavailable",
                browser_automation_error="Google Chrome accessibility address bar fallback returned a non-URL value.",
            ),
        )


if __name__ == "__main__":
    unittest.main()
