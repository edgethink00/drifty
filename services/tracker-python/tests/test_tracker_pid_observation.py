import errno
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from app import main as tracker
from app.storage.db import TrackerDatabase


class TrackerPidObservationTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.path = Path(temp.name) / "tracker.sqlite3"
        patcher = patch.object(tracker, "DB_PATH", self.path)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_denied_pid_record_uses_exact_database_process_discovery(self):
        owned = f'"{tracker.sys.executable}" "{tracker._current_script_path()}" daemon --db "{self.path}"'
        unrelated = f'"{tracker.sys.executable}" "{tracker._current_script_path()}" daemon --db "{self.path}.other"'
        for processes, expected in (({501: owned}, True), ({501: unrelated}, False), ({}, False)):
            with self.subTest(processes=processes), patch.object(
                tracker, "_read_tracker_pid", side_effect=PermissionError(errno.EACCES, "denied state")
            ), patch.object(tracker, "_process_table", return_value=processes) as inspect:
                self.assertIs(tracker._observed_tracker_running(), expected)
                inspect.assert_called_once_with()

    def test_denied_pid_record_preserves_unknown_discovery_and_deadline(self):
        with patch.object(tracker, "_read_tracker_pid", side_effect=PermissionError(errno.EACCES, "denied state")), patch.object(
            tracker, "_process_table", return_value=None
        ) as inspect:
            self.assertIsNone(tracker._observed_tracker_running(deadline=123.0))
            inspect.assert_called_once_with(deadline=123.0)

    def test_windows_status_keeps_unreadable_discovery_unconfirmed(self):
        with patch.object(tracker.sys, "platform", "win32"), patch.object(
            tracker, "_read_tracker_pid", side_effect=PermissionError(errno.EACCES, "denied state")
        ), patch.object(tracker, "_process_table", return_value=None):
            result = tracker._status_from_database(MagicMock())
            self.assertFalse(result["ok"])
            self.assertIsNone(result["data"])
            self.assertIn("running state is unconfirmed", result["error"])

    def test_live_tail_remains_readable_when_only_pid_state_is_denied(self):
        db = TrackerDatabase(self.path, perform_maintenance=False)
        self.addCleanup(db.close)
        db.set_meta("tracker_mode", "suppressed")
        db.set_meta("last_event_at", "2026-10-16T00:00:00+00:00")
        owned = f'"{tracker.sys.executable}" "{tracker._current_script_path()}" daemon --db "{self.path}"'
        with patch.object(tracker, "database", return_value=db), patch.object(
            tracker, "_read_tracker_pid", side_effect=PermissionError(errno.EACCES, "denied state")
        ), patch.object(tracker, "_process_table", return_value={501: owned}):
            result = tracker.get_live_tail({"day": "2026-10-16"})
        self.assertTrue(result["ok"])
        self.assertTrue(result["data"]["running"])
        self.assertEqual(result["data"]["trackerMode"], "suppressed")
        self.assertEqual(result["data"]["lastEventAt"], "2026-10-16T00:00:00+00:00")
        self.assertEqual(result["data"]["segments"], [])

    def test_pid_read_write_and_remove_still_propagate_permission_denial(self):
        tracker.state_dir().mkdir()
        tracker.pid_path().write_text("501", encoding="utf-8")
        with patch.object(tracker, "ensure_state_dir", side_effect=PermissionError(errno.EACCES, "denied state")):
            for action in (tracker._read_tracker_pid, lambda: tracker._write_tracker_pid(502), lambda: tracker._remove_pid_record_if_owned(501)):
                with self.subTest(action=action), self.assertRaises(PermissionError):
                    action()
        self.assertEqual(tracker.pid_path().read_text(encoding="utf-8"), "501")

    def test_unexpected_pid_errors_still_propagate(self):
        for error in (OSError(errno.EIO, "disk I/O error"), TypeError("invalid PID reader")):
            with self.subTest(error=error), patch.object(tracker, "_read_tracker_pid", side_effect=error), patch.object(
                tracker, "_process_table"
            ) as inspect:
                with self.assertRaises(type(error)):
                    tracker._observed_tracker_running()
                inspect.assert_not_called()


if __name__ == "__main__":
    unittest.main()
