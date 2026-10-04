import json
import sys
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import Mock, patch

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.tracker.browser_automation import BrowserMetadata
from app.tracker.safari_url import HELPER_TIMEOUT_SECONDS, refine_safari_url


class SafariUrlTests(unittest.TestCase):
    def setUp(self):
        self.browser = BrowserMetadata(
            browser_name="Safari", site_domain="example.test",
            site_url="https://example.test:8080/path?tab=A#anchor",
            site_title="Example", ax_window_title="Example",
            match_state="accessibility-address-bar-schemaless",
            browser_automation_status="granted",
        )
        self.payload = {
            "schemaVersion": 1, "pid": 42, "bundleId": "com.apple.Safari",
            "windowTitle": "Example", "url": "http://example.test:8080/path?tab=A#anchor",
        }
        self.helper = Path("/packaged/chatgpt-session-ax")

    def refine(self, runner, browser=None, bundle="com.apple.Safari", pid=42):
        return refine_safari_url(
            browser or self.browser, bundle, pid, runner, helper_path=self.helper,
        )

    def test_corrects_only_omitted_scheme_and_bounds_helper(self):
        runner = Mock(return_value=json.dumps(self.payload))
        self.assertEqual(self.refine(runner), replace(self.browser, site_url=self.payload["url"]))
        runner.assert_called_once_with([str(self.helper), "--safari-url", "42"], timeout=HELPER_TIMEOUT_SECONDS)

    def test_https_and_technology_preview(self):
        for browser, bundle in ((self.browser, "com.apple.Safari"), (
            replace(self.browser, browser_name="Safari Technology Preview"), "com.apple.SafariTechnologyPreview",
        )):
            with self.subTest(bundle=bundle):
                payload = dict(self.payload, bundleId=bundle, url=browser.site_url)
                self.assertEqual(self.refine(Mock(return_value=json.dumps(payload)), browser, bundle), browser)

    def test_root_slash_omitted_by_safari_still_corrects_scheme(self):
        browser = replace(self.browser, site_url="https://example.test:8080")
        payload = dict(self.payload, url="http://example.test:8080/")
        self.assertEqual(self.refine(Mock(return_value=json.dumps(payload)), browser).site_url,
                         "http://example.test:8080")

    def test_skips_non_safari_explicit_scheme_and_incomplete_capture(self):
        for updates, bundle, pid in (
            ({"browser_name": "Google Chrome"}, "com.google.Chrome", 42),
            ({}, "other.bundle", 42), ({}, None, 42), ({}, "com.apple.Safari", None),
            ({}, "com.apple.Safari", True), ({}, "com.apple.Safari", 0),
            ({"match_state": "accessibility-address-bar"}, "com.apple.Safari", 42),
            ({"match_state": "browser-history-title"}, "com.apple.Safari", 42),
            ({"site_url": None}, "com.apple.Safari", 42),
            ({"ax_window_title": None}, "com.apple.Safari", 42),
        ):
            with self.subTest(updates=updates, bundle=bundle, pid=pid):
                browser = replace(self.browser, **updates)
                runner = Mock()
                self.assertIs(self.refine(runner, browser, bundle, pid), browser)
                runner.assert_not_called()

    def test_rejects_foreign_or_inconsistent_native_capture(self):
        for updates in (
            {"schemaVersion": 2}, {"schemaVersion": True}, {"pid": 43}, {"pid": "42"},
            {"bundleId": "com.apple.SafariTechnologyPreview"}, {"windowTitle": "Other tab"},
            {"url": "http://other.test:8080/path?tab=A#anchor"},
            {"url": "http://example.test:8080/path?tab=B#anchor"},
            {"url": "http://example.test:8080/path?tab=A#other"},
            {"url": "http://example.test:8080/other?tab=A#anchor"},
            {"url": "http://example.test:8080/%70ath?tab=A#anchor"},
            {"url": "file:///example.test:8080/path?tab=A#anchor"}, {"url": None},
        ):
            with self.subTest(updates=updates):
                runner = Mock(return_value=json.dumps(dict(self.payload, **updates)))
                self.assertIs(self.refine(runner), self.browser)

    def test_unavailable_old_or_malformed_helper_preserves_fallback(self):
        for response in ("null", "[]", "{}", "ok=0", "", "true"):
            with self.subTest(response=response):
                self.assertIs(self.refine(Mock(return_value=response)), self.browser)
        for error in (OSError("missing"), RuntimeError("command timed out")):
            with self.subTest(error=error):
                self.assertIs(self.refine(Mock(side_effect=error)), self.browser)
        with patch("app.tracker.safari_url.packaged_helper_path", return_value=None), patch(
            "app.tracker.safari_url.sys.platform", "darwin",
        ):
            runner = Mock()
            self.assertIs(refine_safari_url(self.browser, "com.apple.Safari", 42, runner), self.browser)
            runner.assert_not_called()


if __name__ == "__main__":
    unittest.main()
