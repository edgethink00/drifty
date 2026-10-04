import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.tracker.macos_workspace import BrowserMetadata, current_snapshot


_MACOS_ONLY = unittest.skipUnless(sys.platform == "darwin", "macOS foreground capture stack")


@_MACOS_ONLY
class MacosSnapshotBrowserSourceTests(unittest.TestCase):
    def test_safari_native_scheme_keeps_capture_confidence_and_source(self) -> None:
        metadata = BrowserMetadata(
            browser_name="Safari", site_domain="example.test",
            site_url="https://example.test/path", ax_window_title="Example",
            match_state="accessibility-address-bar-schemaless", browser_automation_status="granted",
        )
        with patch("app.tracker.macos_workspace._frontmost_via_system_events", return_value=(
            "Safari", "com.apple.Safari", "Example", 42,
        )), patch("app.tracker.macos_workspace._browser_metadata", return_value=metadata), patch(
            "app.tracker.chatgpt_session.packaged_helper_candidates", return_value=(Path(__file__),),
        ), patch("app.tracker.macos_workspace._run_command", return_value=json.dumps({
            "schemaVersion": 1, "pid": 42, "bundleId": "com.apple.Safari",
            "windowTitle": "Example", "url": "http://example.test/path",
        })):
            snapshot = current_snapshot(include_system_transient=False)
        self.assertEqual(snapshot.site_url, "http://example.test/path")
        self.assertEqual(snapshot.capture_confidence, 0.6)
        self.assertEqual(snapshot.site_source, "accessibility-address-bar")
        self.assertEqual(snapshot.window_title, "Example")

    def test_current_snapshot_marks_accessibility_address_bar_source(self) -> None:
        metadata = BrowserMetadata(
            browser_name="Google Chrome",
            site_domain="example.com",
            site_url="https://example.com/docs",
            ax_window_title="Example Docs - Google Chrome",
            match_state="accessibility-address-bar",
            browser_automation_status="granted",
        )
        with patch("app.tracker.macos_workspace._run_osascript") as mock_run, patch(
            "app.tracker.macos_workspace._browser_metadata",
            return_value=metadata,
        ):
            mock_run.return_value = "Google Chrome\ncom.google.Chrome\nExample Docs - Google Chrome"

            snapshot = current_snapshot()

        self.assertEqual(snapshot.site_source, "accessibility-address-bar")
        self.assertEqual(snapshot.capture_confidence, 0.8)
        self.assertEqual(snapshot.site_url, "https://example.com/docs")
        self.assertEqual(snapshot.browser_automation_status, "granted")

    def test_current_snapshot_lowers_confidence_for_schemaless_accessibility_address(self) -> None:
        metadata = BrowserMetadata(
            browser_name="Google Chrome",
            site_domain="example.com",
            site_url="https://example.com/docs",
            ax_window_title="Example Docs - Google Chrome",
            match_state="accessibility-address-bar-schemaless",
            browser_automation_status="granted",
        )
        with patch("app.tracker.macos_workspace._run_osascript") as mock_run, patch(
            "app.tracker.macos_workspace._browser_metadata",
            return_value=metadata,
        ):
            mock_run.return_value = "Google Chrome\ncom.google.Chrome\nExample Docs - Google Chrome"

            snapshot = current_snapshot()

        self.assertEqual(snapshot.site_source, "accessibility-address-bar")
        self.assertEqual(snapshot.capture_confidence, 0.6)


if __name__ == "__main__":
    unittest.main()
