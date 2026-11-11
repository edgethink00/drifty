import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from app.storage.db import TrackerDatabase
from app.tracker import browser_content_policy as policy
from app.tracker.browser_content import capture_browser_content
from app.tracker.adaptive_context.developer_diagnostics import apply_developer_diagnostics_env
from app.tracker.capture_contract import Snapshot
from app.tracker.windows_workspace import capture_windows_browser_content


class ContentPolicyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        profile = root / "profile"
        profile.mkdir()
        self.desktop_permit = root / ".so.drifty.qa.browser-content-permit.v1"
        self.db = TrackerDatabase(profile / "tracker.sqlite3", perform_maintenance=False)
        self.addCleanup(self.db.close)
        previous = policy._settings_path
        self.addCleanup(setattr, policy, "_settings_path", previous)
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

    def test_desktop_off_revokes_while_sqlite_still_has_on(self):
        path = self.desktop_permit
        old_session = "a" * 32
        current_session = "b" * 32
        first_generation = "c" * 32
        second_generation = "d" * 32
        with patch.dict(os.environ, {
            "DRIFTY_BROWSER_CONTENT_SESSION": current_session,
            policy._PERMIT_PATH_ENV: str(path),
        }):
            policy.configure_settings(None)
            self.assertIsNone(policy.policy_snapshot())
            policy.configure_settings(self.db.path)
            self.assertIsNone(policy.policy_snapshot())
            path.write_bytes(f"v1:{old_session}:{first_generation}\n".encode("ascii"))
            self.assertIsNone(policy.policy_snapshot())
            path.write_bytes(f"v1:{current_session}:{first_generation}\n".encode("ascii"))
            before = policy.policy_snapshot()
            self.assertEqual(before[2], first_generation.encode("ascii"))
            blocker = sqlite3.connect(self.db.path)
            try:
                blocker.execute("BEGIN IMMEDIATE")
                path.unlink()
                self.assertIsNone(policy.policy_snapshot())
                self.assertEqual(self.db.get_meta(policy.ENABLED_KEY), "true")
                # The SQLite setting and its revision did not change.
                path.write_bytes(f"v1:{current_session}:{second_generation}\n".encode("ascii"))
                after = policy.policy_snapshot()
                self.assertEqual(before[:2], after[:2])
                self.assertNotEqual(before, after)
                path.write_bytes(b"broken")
                self.assertIsNone(policy.policy_snapshot())
            finally:
                blocker.close()

    def test_desktop_does_not_trust_a_permit_next_to_the_database(self):
        session = "a" * 32
        generation = "b" * 32
        legacy = self.db.path.with_name("browser-content-permit.v1")
        legacy.write_bytes(f"v1:{session}:{generation}\n".encode("ascii"))
        with patch.dict(os.environ, {"DRIFTY_BROWSER_CONTENT_SESSION": session}):
            os.environ.pop(policy._PERMIT_PATH_ENV, None)
            self.assertIsNone(policy.policy_snapshot())
            os.environ[policy._PERMIT_PATH_ENV] = legacy.name
            self.assertIsNone(policy.policy_snapshot())
            os.environ[policy._PERMIT_PATH_ENV] = str(self.desktop_permit)
            self.assertIsNone(policy.policy_snapshot())

    @unittest.skipUnless(os.name == "nt", "Windows file sharing behavior")
    def test_desktop_can_revoke_while_the_windows_policy_reader_holds_the_file(self):
        permit = self.desktop_permit
        session = "a" * 32
        generation = "b" * 32
        permit.write_bytes(f"v1:{session}:{generation}\n".encode("ascii"))
        with patch.dict(os.environ, {
            "DRIFTY_BROWSER_CONTENT_SESSION": session,
            policy._PERMIT_PATH_ENV: str(permit),
        }):
            self.assertIsNotNone(policy.policy_snapshot())
            with policy._open_permit(permit) as opened:
                self.assertEqual(opened.read(3), b"v1:")
                permit.unlink()
                self.assertIsNone(policy.policy_snapshot())
            self.assertFalse(permit.exists())

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

    def test_resolution_failure_never_uses_standalone_or_previous_database(self):
        for previous_path in (None, self.db.path):
            with self.subTest(previous_path=previous_path):
                policy.configure_settings(previous_path)
                self.assertIsNotNone(policy.policy_snapshot())
                with patch.object(Path, "resolve", side_effect=OSError("unavailable path")):
                    policy.configure_settings(self.db.path)
                self.assertIsNone(policy.policy_snapshot())

    def test_resolution_failure_blocks_native_and_public_description_reads(self):
        snapshot = Snapshot(
            observed_at="2026-10-19T09:00:00+00:00", app_name="Google Chrome",
            bundle_id="com.google.Chrome", window_title="Course - Chrome", source="windows-uia",
            site_url="https://example.org/course", site_source="windows-uia-document",
        )
        helper = Path(self.temp.name) / "synthetic-helper"
        for enabled in (False, True):
            with self.subTest(enabled=enabled):
                policy.save_content_setting(self.db, enabled)
                with patch.object(Path, "resolve", side_effect=OSError("unavailable path")):
                    apply_developer_diagnostics_env(self.db)
                reader, describer, run = Mock(), Mock(), Mock()
                self.assertIsNone(capture_windows_browser_content(
                    snapshot, 42, timeout_seconds=0.6, clue_reader=reader, describer=describer,
                ))
                with patch("sys.platform", "darwin"):
                    self.assertIsNone(capture_browser_content(
                        pid=42, bundle_id="com.google.Chrome", page_url=snapshot.site_url,
                        page_title="Course", observed_at=snapshot.observed_at,
                        helper_path=helper, run_command=run,
                    ))
                reader.assert_not_called()
                describer.assert_not_called()
                run.assert_not_called()

    def test_resolution_recovery_uses_requested_database_and_preserves_generation(self):
        first = policy.policy_snapshot()
        other = TrackerDatabase(Path(self.temp.name) / "other.sqlite3", perform_maintenance=False)
        self.addCleanup(other.close)
        policy.save_content_setting(other, False)
        with patch.object(Path, "resolve", side_effect=OSError("unavailable path")):
            policy.configure_settings(other.path)
        self.assertIsNone(policy.policy_snapshot())
        policy.configure_settings(other.path)
        self.assertIsNone(policy.policy_snapshot(), "The previous ON database must not be reused")
        policy.save_content_setting(other, True)
        self.assertEqual(policy.policy_snapshot()[0], other.path.resolve())
        policy.configure_settings(self.db.path)
        self.assertEqual(policy.policy_snapshot(), first)
        policy.configure_settings(None)
        self.assertEqual(policy.policy_snapshot(), (None, "standalone"))

    def test_resolution_failure_during_native_read_discards_the_inflight_clue(self):
        arguments = dict(pid=42, bundle_id="com.google.Chrome", page_url="https://example.org/course",
                         page_title="Course", observed_at="2026-10-19T09:00:00Z",
                         helper_path=Path(self.temp.name) / "synthetic-helper")
        frame = dict(version=1, pid=42, bundleId=arguments["bundle_id"],
                     pageUrl=arguments["page_url"], pageTitle="Course", clues={"headings": ["Week 2"]})

        def run(command, *, cancelled, timeout, reply):
            self.assertFalse(cancelled())
            with patch.object(Path, "resolve", side_effect=OSError("unavailable path")):
                policy.configure_settings(self.db.path)
            self.assertTrue(cancelled())
            return json.dumps(frame)

        with patch("sys.platform", "darwin"):
            self.assertIsNone(capture_browser_content(**arguments, run_command=run))
        policy.configure_settings(self.db.path)
        with patch("sys.platform", "darwin"):
            self.assertIsNotNone(capture_browser_content(
                **arguments, run_command=lambda *a, **k: json.dumps(frame),
            ))


if __name__ == "__main__":
    unittest.main()
