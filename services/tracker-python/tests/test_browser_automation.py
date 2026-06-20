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
from app.tracker.macos_workspace import (
    BrowserMetadata,
    _browser_metadata,
    _browser_script,
    _run_osascript,
)


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

    def test_accessibility_address_bar_script_prioritizes_toolbar_and_stops_on_address_field(self) -> None:
        script = accessibility_address_bar_script("Google Chrome")

        self.assertIn("property toolbarMaxVisited : 120", script)
        self.assertIn("property foundAddress : false", script)
        self.assertIn("on scanToolbarFirst(theElement)", script)
        self.assertLess(
            script.index("my scanToolbarFirst(front window)"),
            script.index("my scanElement(front window)"),
        )
        self.assertIn("if foundAddress is true then return", script)
        self.assertIn("if foundAddress is true then exit repeat", script)

    def test_accessibility_address_bar_script_tries_known_chromium_path_before_recursive_scan(self) -> None:
        script = accessibility_address_bar_script("Google Chrome")

        self.assertIn("on scanKnownChromiumAddressBar(theWindow)", script)
        self.assertIn("set addressContainer to UI element 1 of theWindow", script)
        self.assertIn("set addressFieldGroup to UI element 4 of addressToolbar", script)
        self.assertIn("my considerAddressCandidate(UI element 2 of addressFieldGroup)", script)
        self.assertLess(
            script.index("my scanKnownChromiumAddressBar(front window)"),
            script.index("my scanToolbarFirst(front window)"),
        )

    def test_run_osascript_uses_timeout(self) -> None:
        with patch("app.tracker.macos_workspace.subprocess.run") as mock_run:
            mock_run.return_value.returncode = 0
            mock_run.return_value.stdout = "ok\n"
            mock_run.return_value.stderr = ""

            result = _run_osascript("return \"ok\"")

        self.assertEqual(result, "ok")
        self.assertEqual(mock_run.call_args.kwargs["timeout"], 3.0)

    def test_run_osascript_reports_timeout_as_runtime_error(self) -> None:
        with patch(
            "app.tracker.macos_workspace.subprocess.run",
            side_effect=subprocess.TimeoutExpired(cmd=["osascript"], timeout=3.0),
        ):
            with self.assertRaisesRegex(RuntimeError, "osascript timed out"):
                _run_osascript("delay 5")

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

    def test_browser_metadata_can_force_chromium_accessibility_address_bar(self) -> None:
        with patch.dict(os.environ, {"DRIFTY_FORCE_CHROMIUM_AX_CAPTURE": "1"}), patch(
            "app.tracker.macos_workspace._run_osascript",
            return_value="https://www.example.com/path?from=ax\nExample Page - Google Chrome",
        ) as mock_run:
            result = _browser_metadata("Google Chrome")

        self.assertEqual(result.site_domain, "example.com")
        self.assertEqual(result.site_url, "https://www.example.com/path?from=ax")
        self.assertEqual(result.match_state, "accessibility-address-bar")
        self.assertEqual(mock_run.call_count, 1)

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

    def test_browser_metadata_rechecks_address_bar_when_front_fallback_disagrees_with_ax_title(self) -> None:
        with patch(
            "app.tracker.macos_workspace._run_osascript",
            side_effect=[
                "\n".join(
                    [
                        "http://127.0.0.1:4173/?v=drifty",
                        "drifty — AI Time Tracker for Focus & Drift",
                        "front-fallback",
                        "Lecture - YouTube - Chrome - Alex",
                    ]
                ),
                "youtube.com/watch?v=lecture\nLecture - YouTube - Chrome - Alex",
            ],
        ) as mock_run:
            result = _browser_metadata("Google Chrome")

        self.assertEqual(result.site_domain, "youtube.com")
        self.assertEqual(result.site_url, "https://youtube.com/watch?v=lecture")
        self.assertEqual(result.youtube_video_id, "lecture")
        self.assertEqual(result.match_state, "accessibility-address-bar-schemaless")
        self.assertEqual(result.browser_automation_status, "granted")
        self.assertEqual(mock_run.call_count, 2)

    def test_browser_metadata_rechecks_address_bar_when_front_fallback_has_no_ax_title(self) -> None:
        with patch(
            "app.tracker.macos_workspace._run_osascript",
            side_effect=[
                "\n".join(
                    [
                        "http://127.0.0.1:4173/?v=drifty",
                        "drifty — AI Time Tracker for Focus & Drift",
                        "front-fallback",
                    ]
                ),
                "youtube.com/watch?v=lecture\nLecture - YouTube - Chrome - Alex",
            ],
        ) as mock_run:
            result = _browser_metadata("Google Chrome")

        self.assertEqual(result.site_domain, "youtube.com")
        self.assertEqual(result.site_url, "https://youtube.com/watch?v=lecture")
        self.assertEqual(result.match_state, "accessibility-address-bar-schemaless")
        self.assertEqual(result.browser_automation_status, "granted")
        self.assertEqual(mock_run.call_count, 2)

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
