import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.storage.db import TrackerDatabase
from app.tracker import browser_content_policy as policy
from app.tracker.browser_content import capture_browser_content
from app.tracker.adaptive_context.developer_diagnostics import apply_developer_diagnostics_env


class ContentPolicyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.db = TrackerDatabase(Path(self.temp.name)/"tracker.sqlite3", perform_maintenance=False)
        self.addCleanup(self.db.close)
        previous = policy._settings_path
        self.addCleanup(lambda: policy.configure_settings(previous))
        self.env = patch.dict(os.environ, {"DRIFTY_BROWSER_CONTENT_CONTEXT": "1"})
        self.env.start(); self.addCleanup(self.env.stop)
        policy.configure_settings(self.db.path)
        policy.save_content_setting(self.db, True)

    def test_committed_setting_is_seen_without_stale_process_environment(self):
        self.assertIsNotNone(policy.policy_snapshot())
        policy.save_content_setting(self.db, False)
        self.assertEqual(os.environ["DRIFTY_BROWSER_CONTENT_CONTEXT"], "1")
        self.assertIsNone(policy.policy_snapshot())

    def test_off_on_changes_generation_but_repeated_on_preserves_it(self):
        first = policy.policy_snapshot()
        policy.save_content_setting(self.db, True)
        self.assertEqual(policy.policy_snapshot(), first)
        policy.save_content_setting(self.db, False)
        policy.save_content_setting(self.db, True)
        self.assertNotEqual(policy.policy_snapshot(), first)

    def test_generation_change_during_native_read_discards_entire_clue(self):
        arguments = dict(pid=42, bundle_id="com.google.Chrome", page_url="https://example.org/course",
                         page_title="Course", observed_at="2026-10-07T00:00:00Z", helper_path=Path("/qa/helper"))
        frame = dict(version=1, pid=42, bundleId="com.google.Chrome", pageUrl=arguments["page_url"],
                     pageTitle="Course", clues={"description": "Public course summary", "headings": ["Week 2"]})
        calls = []
        def run(command, *, cancelled, timeout, reply):
            calls.append(command)
            self.assertTrue(callable(reply))
            self.assertFalse(cancelled())
            policy.save_content_setting(self.db, False)
            policy.save_content_setting(self.db, True)
            self.assertTrue(cancelled())
            return json.dumps(frame)
        with patch("sys.platform", "darwin"):
            self.assertIsNone(capture_browser_content(**arguments, run_command=run))
            self.assertEqual(len(calls), 1, "The transport must execute the OFF/ON transition")
            self.assertIsNotNone(capture_browser_content(**arguments, run_command=lambda *a, **k: json.dumps(frame)))

    def test_settings_application_configures_actual_db_path(self):
        policy.configure_settings(None)
        apply_developer_diagnostics_env(self.db)
        self.assertEqual(policy.policy_snapshot()[0], self.db.path.resolve())

    def test_unreadable_or_missing_settings_fail_closed_without_creating_db(self):
        path = Path(self.temp.name)/"missing.sqlite3"
        policy.configure_settings(path)
        self.assertIsNone(policy.policy_snapshot())
        self.assertFalse(path.exists())


if __name__ == "__main__":
    unittest.main()
