import json
import sys
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import Mock

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.tracker.browser_automation import BrowserMetadata
from app.tracker.zen_url import HELPER_TIMEOUT_SECONDS, refine_zen_url


class ZenUrlTests(unittest.TestCase):
    def setUp(self):
        # Zen 1.23 shows only the host while its sidebar address field is idle.
        self.browser = BrowserMetadata(
            browser_name="Zen", site_domain="youtube.com", site_url="https://youtube.com",
            ax_window_title="Lecture - YouTube", match_state="accessibility-address-bar-schemaless",
            browser_automation_status="granted",
        )
        self.payload = {
            "schemaVersion": 1, "pid": 42, "bundleId": "app.zen-browser.zen",
            "windowTitle": "Lecture - YouTube", "url": "https://www.youtube.com/watch?v=abc123&list=PL1",
        }
        self.helper = Path("/packaged/chatgpt-session-ax")

    def refine(self, runner, browser=None, bundle="app.zen-browser.zen", pid=42):
        return refine_zen_url(browser or self.browser, bundle, pid, runner, helper_path=self.helper)

    def test_restores_the_selected_page_url_and_its_video_identity(self):
        runner = Mock(return_value=json.dumps(self.payload))
        refined = self.refine(runner)
        self.assertEqual(refined.site_url, self.payload["url"])
        self.assertEqual((refined.youtube_video_id, refined.youtube_playlist_id), ("abc123", "PL1"))
        self.assertEqual((refined.match_state, refined.ax_window_title), (self.browser.match_state, self.browser.ax_window_title))
        runner.assert_called_once_with([str(self.helper), "--gecko-url", "42"], timeout=HELPER_TIMEOUT_SECONDS)

    def test_a_full_address_other_browsers_and_incomplete_captures_skip_the_helper(self):
        for updates, bundle, pid in (
            ({"site_url": "https://youtube.com/watch?v=abc123"}, "app.zen-browser.zen", 42),
            ({"browser_name": "Firefox"}, "org.mozilla.firefox", 42),
            ({}, "org.mozilla.firefox", 42), ({}, None, 42), ({}, "app.zen-browser.zen", None),
            ({}, "app.zen-browser.zen", True), ({}, "app.zen-browser.zen", 0),
            ({"match_state": "browser-history-title"}, "app.zen-browser.zen", 42),
            ({"site_url": None}, "app.zen-browser.zen", 42), ({"ax_window_title": None}, "app.zen-browser.zen", 42),
        ):
            with self.subTest(updates=updates, bundle=bundle, pid=pid):
                browser = replace(self.browser, **updates)
                runner = Mock()
                self.assertIs(self.refine(runner, browser, bundle, pid), browser)
                runner.assert_not_called()

    def test_rejects_another_host_window_or_malformed_helper_output(self):
        for updates in (
            {"schemaVersion": 2}, {"pid": 43}, {"bundleId": "org.mozilla.firefox"}, {"windowTitle": "Other tab"},
            {"url": "https://evil.example/watch?v=abc123"}, {"url": "file:///youtube.com/watch"}, {"url": None},
        ):
            with self.subTest(updates=updates):
                runner = Mock(return_value=json.dumps(dict(self.payload, **updates)))
                self.assertIs(self.refine(runner), self.browser)
        for response in ("null", "[]", "", "true"):
            with self.subTest(response=response):
                self.assertIs(self.refine(Mock(return_value=response)), self.browser)
        for error in (OSError("missing"), RuntimeError("command timed out")):
            with self.subTest(error=error):
                self.assertIs(self.refine(Mock(side_effect=error)), self.browser)


if __name__ == "__main__":
    unittest.main()
