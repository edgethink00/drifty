"""Safari refinement through the real worker and owned-command lifetime.

Only foreground/browser OS observations and the native executable are fixtures.
The sample worker, deadline, subprocess cancellation and Safari validation run
unchanged; these tests do not claim native Accessibility coverage.
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from app.tracker import macos_workspace as workspace
from app.tracker.browser_automation import BrowserMetadata
from app.tracker.macos_capture import CommandScope, ContextWorker, FrontmostApplication


@unittest.skipIf(sys.platform == "win32", "Mac helper fixture uses a POSIX executable")
class SafariWorkerIntegrationTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.helper = self.root / "helper"
        self.helper.write_text(
            f"#!{sys.executable}\n"
            "import json, pathlib, sys, time\n"
            "root = pathlib.Path(__file__).parent\n"
            "data = json.loads((root / 'data.json').read_text())\n"
            "mode = sys.argv[1]\n"
            "if mode == '--safari-url': time.sleep(data['delay'])\n"
            "print(json.dumps(data['identity' if mode == '--frontmost-app' else 'safari']))\n",
        )
        self.helper.chmod(0o755)
        self.identity = {
            "version": 1, "app_name": "Safari", "bundle_id": "com.apple.Safari", "pid": 42,
        }
        self.payload = {
            "schemaVersion": 1, "pid": 42, "bundleId": "com.apple.Safari",
            "windowTitle": "HTTP fixture", "url": "http://example.test:8080/path?q=A#anchor",
        }
        self.configure_helper()
        # macOS can inspect a newly written executable on its first launch.
        # Validate the synthetic Python helper before measuring capture's real
        # deadlines; fixture admission is not native Accessibility coverage.
        ready = subprocess.run([str(self.helper), "--frontmost-app"],
                               capture_output=True, text=True, check=True, timeout=3)
        self.assertEqual(json.loads(ready.stdout), self.identity)
        self.worker = ContextWorker()
        self.children = []
        self.scopes = []
        self.addCleanup(self.close_worker)
        self.mock("context_worker", new=self.worker)
        self.mock("_onscreen_window_rows", return_value=[])
        self.mock("apply_native_chatgpt_session_title", side_effect=lambda app, bundle, title, pid, runner: title)
        self.mock("adaptive_content_context_for_capture", return_value=None)
        self.front = ("Safari", "com.apple.Safari", "HTTP fixture", 42)
        self.title = self.mock("_frontmost_via_system_events", return_value=self.front)
        self.browser = self.mock("_browser_metadata", return_value=BrowserMetadata(
            browser_name="Safari", site_domain="example.test", site_title="HTTP fixture",
            site_url="https://example.test:8080/path?q=A#anchor", ax_window_title="HTTP fixture",
            match_state="accessibility-address-bar-schemaless", browser_automation_status="granted",
        ))
        for module in ("macos_capture", "safari_url"):
            self.start_patch(patch(f"app.tracker.{module}.packaged_helper_path", return_value=self.helper))
        self.start_patch(patch("app.tracker.safari_url.sys.platform", "darwin"))
        self.start_patch(patch.dict("os.environ", {
            workspace.FORCE_FRONTMOST_FALLBACK_CAPTURE_ENV: "0",
            workspace.FORCE_BROWSER_HISTORY_URL_FALLBACK_ENV: "0",
        }))
        scopes = self.scopes

        class ObservedScope(CommandScope):
            def __init__(self, deadline):
                super().__init__(deadline)
                self.calls = []
                scopes.append(self)

            def run(self, command, *, timeout):
                self.calls.append((command, threading.current_thread().name, time.monotonic()))
                return super().run(command, timeout=timeout)

        self.mock("CommandScope", new=ObservedScope)
        real_popen = subprocess.Popen

        def spawn(*args, **kwargs):
            child = real_popen(*args, **kwargs)
            self.children.append(child)
            return child

        self.start_patch(patch("app.tracker.macos_capture.subprocess.Popen", side_effect=spawn))

    def start_patch(self, patcher):
        value = patcher.start()
        self.addCleanup(patcher.stop)
        return value

    def mock(self, name, **kwargs):
        return self.start_patch(patch.object(workspace, name, **kwargs))

    def configure_helper(self, delay=0):
        (self.root / "data.json").write_text(json.dumps({
            "identity": self.identity, "safari": self.payload, "delay": delay,
        }))

    def wait_idle(self):
        with self.worker._condition:
            self.assertTrue(self.worker._condition.wait_for(lambda: self.worker._active is None, timeout=2))

    def close_worker(self):
        self.worker.close()
        if self.worker._thread is not None:
            self.worker._thread.join(2)
        for child in self.children:
            if child.poll() is None:
                child.kill()
                child.wait()

    def test_native_worker_preserves_http_path_query_fragment_and_confidence(self):
        result = workspace.current_snapshot(False)
        self.assertEqual(result.site_url, self.payload["url"])
        self.assertEqual(result.frontmost_capture_source, "nsworkspace")
        self.assertEqual(result.site_source, "accessibility-address-bar")
        self.assertEqual(result.capture_confidence, 0.6)
        self.assertEqual(result.window_title, "HTTP fixture")
        self.assertEqual(len(self.scopes), 1)
        calls = self.scopes[0].calls
        self.assertEqual([call[0][1:] for call in calls], [["--safari-url", "42"], ["--frontmost-app"]])
        self.assertTrue(all(call[1] == "Drifty-Mac-Context" for call in calls))
        self.assertTrue(all(child.poll() is not None for child in self.children))

    def test_legacy_capture_also_preserves_safari_correction(self):
        with patch.object(workspace, "read_frontmost_application", return_value=None):
            result = workspace.current_snapshot(False)
        self.assertEqual(result.site_url, self.payload["url"])
        self.assertEqual(result.frontmost_capture_source, "system-events")
        self.assertEqual(result.capture_confidence, 0.6)
        self.assertEqual(self.scopes, [])

    def test_mismatched_native_tab_cannot_correct_another_tabs_url(self):
        for changed in ({"windowTitle": "Other tab"}, {"pid": 43},
                        {"url": "http://example.test:8080/path?q=B#anchor"}):
            with self.subTest(changed=changed):
                original = dict(self.payload)
                self.payload.update(changed)
                self.configure_helper()
                result = workspace.current_snapshot(False)
                self.assertEqual(result.site_url, self.browser.return_value.site_url)
                self.assertEqual(result.capture_confidence, 0.6)
                self.payload = original

    def test_window_switch_after_refinement_discards_all_optional_context(self):
        self.title.side_effect = [self.front, ("Safari", "com.apple.Safari", "Other tab", 42)]
        result = workspace.current_snapshot(False)
        self.assertEqual(result.app_name, "Safari")
        self.assertEqual(result.frontmost_capture_source, "nsworkspace")
        self.assertIsNone(result.window_title)
        self.assertIsNone(result.site_url)
        self.assertEqual(self.scopes[0].calls[0][0][1], "--safari-url")

    def test_safari_helper_shares_remaining_budget_and_is_reaped_on_expiry(self):
        metadata = self.browser.return_value

        def delayed_browser(*_):
            time.sleep(2.6)
            return metadata

        self.browser.side_effect = delayed_browser
        self.configure_helper(delay=60)
        started = time.monotonic()
        result = workspace.current_snapshot(False)
        self.assertLess(time.monotonic() - started, workspace.CAPTURE_TIMEOUT_SECONDS + 0.35)
        self.assertEqual(result.app_name, "Safari")
        self.assertIsNone(result.site_url)
        self.wait_idle()
        calls = self.scopes[0].calls
        self.assertEqual([call[0][1:] for call in calls], [["--safari-url", "42"]])
        self.assertLess(calls[0][2], self.scopes[0].deadline)
        self.assertTrue(all(child.poll() is not None for child in self.children))
        self.assertFalse(self.scopes[0]._children)
        # Expired HTTP context cannot be reused after the worker becomes free.
        self.configure_helper()
        self.browser.side_effect = None
        self.assertEqual(workspace.current_snapshot(False).site_url, self.payload["url"])

    def test_expired_browser_read_cannot_start_safari_helper(self):
        entered, release = threading.Event(), threading.Event()
        metadata = self.browser.return_value

        def delayed_browser(*_):
            entered.set()
            release.wait(2)
            return metadata

        self.browser.side_effect = delayed_browser
        # This case starts after app identity has been acquired. A slow Python
        # fixture startup must not send it through the separate legacy path.
        native = FrontmostApplication("Safari", "com.apple.Safari", 42)
        try:
            with patch.object(workspace, "read_frontmost_application", return_value=native) as identity, \
                 patch.object(workspace, "CAPTURE_TIMEOUT_SECONDS", 0.5):
                result = workspace.current_snapshot(False)
                identity.assert_called_once_with()
            self.assertTrue(entered.is_set())
            self.assertEqual(result.frontmost_capture_source, "nsworkspace")
            self.assertIsNone(result.site_url)
        finally:
            release.set()
        self.wait_idle()
        self.assertEqual(len(self.scopes), 1)
        self.assertEqual(self.scopes[0].calls, [])
        self.assertEqual(self.children, [])


if __name__ == "__main__":
    unittest.main()
