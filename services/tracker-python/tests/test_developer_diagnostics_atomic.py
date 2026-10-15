import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.storage.db import TrackerDatabase
from app.tracker import browser_content_policy as policy
from app.tracker.adaptive_context import developer_diagnostics as diagnostics


class DeveloperDiagnosticsAtomicTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.db = TrackerDatabase(Path(self.temp.name) / "tracker.sqlite3", perform_maintenance=False)
        self.addCleanup(self.db.close)
        previous = policy._settings_path
        self.addCleanup(lambda: policy.configure_settings(previous))
        env = patch.dict(os.environ)
        env.start()
        self.addCleanup(env.stop)

    def environment(self):
        return {key: os.environ.get(key) for key in (
            diagnostics.BROWSER_CONTENT_ENABLED_ENV,
            diagnostics.FORCE_CHROMIUM_AX_CAPTURE_ENV,
            diagnostics.FORCE_FRONTMOST_FALLBACK_CAPTURE_ENV,
            diagnostics.FORCE_BROWSER_HISTORY_URL_FALLBACK_ENV,
            diagnostics.ENABLE_ADAPTIVE_CONTEXT_CAPTURE_ENV,
            diagnostics.ADAPTIVE_CONTEXT_SOURCE_FAMILIES_ENV,
        )}

    def test_database_failure_preserves_all_settings_generation_and_environment(self):
        for enabled in (False, True):
            for blocked_key in (
                diagnostics.FORCE_CHROMIUM_AX_CAPTURE_META_KEY,
                diagnostics.ENHANCED_CONTEXT_SOURCE_FAMILIES_META_KEY,
            ):
                with self.subTest(enabled=enabled, blocked_key=blocked_key):
                    diagnostics.save_developer_diagnostics(self.db, {"browserContentContextEnabled": enabled})
                    conn = self.db.connect()
                    before = dict(conn.execute("SELECT key, value FROM tracker_meta"))
                    before_env = self.environment()
                    with conn:
                        conn.execute(
                            "CREATE TRIGGER reject_diagnostic_write BEFORE INSERT ON tracker_meta "
                            f"WHEN NEW.key = '{blocked_key}' BEGIN "
                            "SELECT RAISE(ABORT, 'synthetic diagnostic write failure'); END"
                        )
                    try:
                        with self.assertRaisesRegex(sqlite3.IntegrityError, "synthetic diagnostic write failure"):
                            diagnostics.save_developer_diagnostics(self.db, {
                                "browserContentContextEnabled": not enabled,
                                "forceChromiumAxCapture": True,
                                "forceFrontmostFallbackCapture": True,
                                "forceBrowserHistoryUrlFallback": True,
                                "enhancedContextEnabled": True,
                                "enhancedContextCaptureLocal": True,
                            })
                        self.assertEqual(before, dict(conn.execute("SELECT key, value FROM tracker_meta")))
                        self.assertEqual(before_env, self.environment())
                        self.assertFalse(conn.in_transaction)
                        self.assertEqual(conn.execute("PRAGMA quick_check").fetchone()[0], "ok")
                    finally:
                        with conn:
                            conn.execute("DROP TRIGGER reject_diagnostic_write")

    def test_success_commits_settings_and_applies_the_process_environment(self):
        diagnostics.save_developer_diagnostics(self.db, {"browserContentContextEnabled": False})
        revision = self.db.get_meta(policy.REVISION_KEY)
        payload = {
            "browserContentContextEnabled": True,
            "forceChromiumAxCapture": True,
            "forceFrontmostFallbackCapture": True,
            "forceBrowserHistoryUrlFallback": True,
            "enhancedContextEnabled": True,
            "enhancedContextCaptureLocal": True,
        }
        response = diagnostics.save_developer_diagnostics(self.db, payload)
        for key in payload:
            if key != "browserContentContextEnabled":
                self.assertTrue(response[key])
        self.assertEqual(self.db.get_meta(policy.ENABLED_KEY), "true")
        self.assertNotEqual(self.db.get_meta(policy.REVISION_KEY), revision)
        for key in (
            diagnostics.BROWSER_CONTENT_ENABLED_ENV,
            diagnostics.FORCE_CHROMIUM_AX_CAPTURE_ENV,
            diagnostics.FORCE_FRONTMOST_FALLBACK_CAPTURE_ENV,
            diagnostics.FORCE_BROWSER_HISTORY_URL_FALLBACK_ENV,
            diagnostics.ENABLE_ADAPTIVE_CONTEXT_CAPTURE_ENV,
        ):
            self.assertEqual(os.environ[key], "1")
        self.assertIsNotNone(policy.policy_snapshot())
        self.assertFalse(self.db.connect().in_transaction)

    def test_diagnostic_only_change_preserves_the_content_generation(self):
        diagnostics.save_developer_diagnostics(self.db, {"browserContentContextEnabled": True})
        revision = self.db.get_meta(policy.REVISION_KEY)
        diagnostics.save_developer_diagnostics(self.db, {
            "browserContentContextEnabled": True,
            "forceChromiumAxCapture": True,
        })
        self.assertEqual(self.db.get_meta(policy.REVISION_KEY), revision)
        self.assertEqual(self.db.get_meta(diagnostics.FORCE_CHROMIUM_AX_CAPTURE_META_KEY), "true")
        self.assertEqual(os.environ[diagnostics.FORCE_CHROMIUM_AX_CAPTURE_ENV], "1")


if __name__ == "__main__":
    unittest.main()
