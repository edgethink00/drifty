import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import MagicMock, patch

from app import main as tracker
from app.storage.db import TrackerDatabase
from tests.support_cleanup import temp_dir_closing_databases


@unittest.skipIf(sys.platform == "win32", "Mac onefile lifecycle uses POSIX process identities and file modes")
class FrozenDaemonLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.original_db = tracker.DB_PATH
        self.addCleanup(setattr, tracker, "DB_PATH", self.original_db)
        for name, value in (("platform", "darwin"), ("frozen", True),
                            ("executable", "/Applications/drifty.app/Contents/MacOS/drifty-tracker")):
            p = patch.object(sys, name, value, create=True)
            p.start()
            self.addCleanup(p.stop)

    def commands(self):
        return f"{sys.executable} daemon --db {tracker.DB_PATH}"

    def ready(self, pid=2002, parent=2001, token="b" * 32):
        database_stat = tracker.DB_PATH.stat() if tracker.DB_PATH.exists() else None
        return {"pid": pid, "birth": 222, "parentPid": parent, "parentBirth": 111,
                "fingerprint": "a" * 64, "startToken": token,
                "databasePath": str(tracker.DB_PATH.expanduser().resolve()),
                "databaseDevice": database_stat.st_dev if database_stat else 0,
                "databaseInode": database_stat.st_ino if database_stat else 0}

    def identity(self, pid):
        return {2001: (111, 50), 2002: (222, 2001), 3001: (333, 50),
                3002: (444, 3001)}[pid]

    def test_transient_frozen_mac_gets_independent_runtime_without_mutating_parent(self):
        inherited = {"_PYI_APPLICATION_HOME_DIR": "/tmp/_MEIshortlived",
                     "DRIFTY_TRACKER_APP_PID": "99", "PYINSTALLER_RESET_ENVIRONMENT": "0"}
        with patch.dict(os.environ, inherited, clear=True), patch.object(
            tracker, "_TRANSIENT_RUNTIME", True, create=True
        ):
            kwargs = tracker._detached_spawn_kwargs()
            self.assertEqual(kwargs.get("env", {}).get("PYINSTALLER_RESET_ENVIRONMENT"), "1")
            self.assertEqual(kwargs["env"]["DRIFTY_TRACKER_APP_PID"], "99")
            self.assertEqual(dict(os.environ), inherited)
            self.assertTrue(kwargs["start_new_session"])

    def test_long_lived_serve_keeps_existing_runtime_launch(self):
        with patch.object(tracker, "_TRANSIENT_RUNTIME", False, create=True):
            self.assertEqual(tracker._detached_spawn_kwargs(), {"start_new_session": True})

    def test_ready_worker_and_its_verified_supervisor_are_one_logical_generation(self):
        with temp_dir_closing_databases() as tmp:
            tracker.DB_PATH = Path(tmp) / "tracker.sqlite3"
            tracker.DB_PATH.touch()
            command = self.commands()
            db = MagicMock()
            db.get_meta.return_value = "a" * 64
            with patch.object(tracker, "_process_table", return_value={2001: command, 2002: command}), \
                    patch.object(tracker, "_process_command", return_value=command), \
                    patch.object(tracker, "_read_tracker_pid", return_value=2002), \
                    patch.object(tracker, "_read_tracker_ready", return_value=self.ready(), create=True), \
                    patch.object(tracker, "_macos_process_identity", side_effect=self.identity, create=True), \
                    patch.object(tracker, "_tracker_runtime_fingerprint", return_value="a" * 64), \
                    patch.object(tracker, "database", return_value=db), \
                    patch.object(tracker, "TrackerDatabase", return_value=db):
                tracker._write_pending_mac_start(2001, "a" * 64, "b" * 32)
                self.assertTrue(tracker.verify_current_runtime_running()["data"])
                with patch.object(tracker, "get_status", return_value={"ok": True, "data": {"running": True}}), \
                        patch.object(tracker, "_stop_tracker_daemons") as stop, \
                        patch.object(tracker.subprocess, "Popen") as spawn:
                    self.assertTrue(tracker.start_tracking()["ok"])
                stop.assert_not_called()
                spawn.assert_not_called()

    def test_unpacking_supervisor_with_stale_fingerprint_is_not_ready(self):
        with temp_dir_closing_databases() as tmp:
            tracker.DB_PATH = Path(tmp) / "tracker.sqlite3"
            db = MagicMock()
            db.get_meta.return_value = "a" * 64
            with patch.object(tracker, "_process_table", return_value={2001: self.commands()}), \
                    patch.object(tracker, "_process_command", return_value=self.commands()), \
                    patch.object(tracker, "_read_tracker_pid", return_value=None), \
                    patch.object(tracker, "_tracker_runtime_fingerprint", return_value="a" * 64), \
                    patch.object(tracker, "database", return_value=db):
                self.assertFalse(tracker.verify_current_runtime_running()["data"])

    def test_runtime_verification_never_initializes_or_maintains_database(self):
        with temp_dir_closing_databases() as tmp:
            tracker.DB_PATH = Path(tmp) / "tracker.sqlite3"
            db = TrackerDatabase(tracker.DB_PATH, perform_maintenance=False)
            db.set_meta(tracker.TRACKER_RUNTIME_FINGERPRINT_META_KEY, "a" * 64)
            db.close()
            real_database = TrackerDatabase

            def read_only_database(path, **kwargs):
                self.assertEqual(kwargs, {"read_only": True})
                return real_database(path, **kwargs)

            with patch.object(tracker, "_process_table", return_value={2002: self.commands()}), \
                    patch.object(tracker, "_process_command", return_value=self.commands()), \
                    patch.object(tracker, "_read_tracker_pid", return_value=2002), \
                    patch.object(tracker, "_read_tracker_ready", return_value=self.ready()), \
                    patch.object(tracker, "_macos_process_identity", side_effect=self.identity), \
                    patch.object(tracker, "_tracker_runtime_fingerprint", return_value="a" * 64), \
                    patch.object(tracker, "database", side_effect=AssertionError("writable initialization forbidden")), \
                    patch.object(tracker, "TrackerDatabase", side_effect=read_only_database) as factory:
                self.assertTrue(tracker.verify_current_runtime_running()["data"])
            factory.assert_called_once_with(tracker.DB_PATH, read_only=True)
            self.assertFalse((Path(tmp) / "database-backups").exists())

    def test_ready_publication_is_private_and_cleanup_preserves_other_generation(self):
        with temp_dir_closing_databases() as tmp:
            tracker.DB_PATH = Path(tmp) / "tracker.sqlite3"
            tracker.DB_PATH.touch()
            tracker._write_tracker_pid(2002)
            tracker.ready_path().write_text("stale")
            tracker.ready_path().chmod(0o644)
            with patch.object(tracker, "_macos_process_identity", side_effect=self.identity), \
                    patch.dict(os.environ, {tracker._START_TOKEN_ENV: "b" * 32}):
                tracker._publish_tracker_ready(2002, "a" * 64)
                self.assertEqual(tracker._ready_mac_worker(2002, start_token="b" * 32), self.ready())
                self.assertIsNone(tracker._ready_mac_worker(2002, start_token="c" * 32))
            self.assertEqual(tracker.ready_path().stat().st_mode & 0o777, 0o600)
            self.assertFalse(tracker._remove_pid_record_if_owned(3002))
            self.assertTrue(tracker.ready_path().exists())
            self.assertTrue(tracker._remove_pid_record_if_owned(2002))
            self.assertFalse(tracker.ready_path().exists())

    def test_ready_publication_requires_owned_pid_and_rejects_invalid_files(self):
        with temp_dir_closing_databases() as tmp:
            tracker.DB_PATH = Path(tmp) / "tracker.sqlite3"
            tracker._write_tracker_pid(3002)
            with patch.object(tracker, "_macos_process_identity", side_effect=self.identity):
                with self.assertRaisesRegex(RuntimeError, "no longer owns"):
                    tracker._publish_tracker_ready(2002, "a" * 64)
            for value in ("x" * 4097, "[]", "{", json.dumps({**self.ready(), "birth": True})):
                tracker.ready_path().write_text(value)
                self.assertIsNone(tracker._read_tracker_ready())

    def test_owner_exit_during_database_startup_skips_readiness_publication(self):
        with temp_dir_closing_databases() as tmp:
            tracker.DB_PATH = Path(tmp) / "tracker.sqlite3"
            db = TrackerDatabase(tracker.DB_PATH, perform_maintenance=False)
            owner = MagicMock()
            owner.is_alive.return_value = True

            def initialize():
                owner.is_alive.return_value = False
                return db

            with patch.object(tracker, "database", side_effect=initialize), \
                    patch.object(tracker, "_tracker_runtime_fingerprint", return_value="a" * 64), \
                    patch.object(tracker, "_publish_tracker_ready") as publish, \
                    patch.object(tracker, "DaemonMaintenance") as maintenance, \
                    patch.object(tracker, "_daemon_tick") as tick, \
                    patch.object(tracker, "_close_loaded_macos_capture") as close_capture, \
                    patch.object(tracker, "_close_loaded_windows_capture"):
                tracker._daemon_with_owner(owner)
            publish.assert_not_called()
            maintenance.assert_not_called()
            tick.assert_not_called()
            close_capture.assert_called_once()
            self.assertFalse(tracker.pid_path().exists())
            self.assertFalse(tracker.ready_path().exists())
            self.assertEqual(db.connect().execute("SELECT count(*) FROM activity_segments").fetchone()[0], 0)
            lock = tracker._acquire_tracker_daemon_lock()
            self.assertIsNotNone(lock)
            tracker._release_tracker_daemon_lock(lock)

    def test_readiness_identity_failure_is_cancelled_only_after_confirmed_owner_exit(self):
        for failed_read in ("worker", "supervisor"):
            for owner_state in ("exited", "alive", "standalone"):
                with self.subTest(failed_read=failed_read, owner_state=owner_state), temp_dir_closing_databases() as tmp:
                    tracker.DB_PATH = Path(tmp) / "tracker.sqlite3"
                    db = TrackerDatabase(tracker.DB_PATH, perform_maintenance=False)
                    owner = None if owner_state == "standalone" else MagicMock()
                    if owner is not None:
                        owner.is_alive.return_value = True
                    failure = RuntimeError("tracker owning app process identity is unavailable")

                    def identity(pid):
                        if failed_read == "supervisor" and pid == os.getpid():
                            return (222, 2001)
                        if owner_state == "exited":
                            owner.is_alive.return_value = False
                        raise failure

                    with patch.object(tracker, "database", return_value=db), \
                            patch.object(tracker, "_tracker_runtime_fingerprint", return_value="a" * 64), \
                            patch.object(tracker, "_macos_process_identity", side_effect=identity) as read_identity, \
                            patch.object(tracker, "DaemonMaintenance") as maintenance, \
                            patch.object(tracker, "_daemon_tick") as tick, \
                            patch.object(tracker, "_close_loaded_macos_capture") as close_capture, \
                            patch.object(tracker, "_close_loaded_windows_capture"):
                        if owner_state == "exited":
                            tracker._daemon_with_owner(owner)
                        else:
                            with self.assertRaises(RuntimeError) as raised:
                                tracker._daemon_with_owner(owner)
                            self.assertIs(raised.exception, failure)
                    self.assertEqual(read_identity.call_count, 1 if failed_read == "worker" else 2)
                    maintenance.assert_not_called()
                    tick.assert_not_called()
                    close_capture.assert_called_once()
                    self.assertFalse(tracker.pid_path().exists())
                    self.assertFalse(tracker.ready_path().exists())
                    self.assertEqual(db.connect().execute("SELECT count(*) FROM activity_segments").fetchone()[0], 0)

    def test_reused_parent_or_different_db_parent_cannot_collapse(self):
        with temp_dir_closing_databases() as tmp:
            tracker.DB_PATH = Path(tmp) / "tracker.sqlite3"
            with patch.object(tracker, "_read_tracker_pid", return_value=2002), \
                    patch.object(tracker, "_read_tracker_ready", return_value=self.ready()), \
                    patch.object(tracker, "_macos_process_identity", side_effect=self.identity):
                self.assertEqual(tracker._logical_tracker_daemon_pids({
                    2001: self.commands().replace(str(tracker.DB_PATH), str(Path(tmp) / "other.sqlite3")),
                    2002: self.commands(),
                }), [2002])
                with patch.object(tracker, "_macos_process_identity", side_effect=lambda pid: (999, 50) if pid == 2001 else self.identity(pid)):
                    self.assertIsNone(tracker._ready_mac_worker(2002))

    def test_pending_supervisor_is_unconfirmed_and_not_adopted(self):
        with temp_dir_closing_databases() as tmp:
            tracker.DB_PATH = Path(tmp) / "tracker.sqlite3"
            with patch.object(tracker, "_process_table", return_value={2001: self.commands()}):
                self.assertIsNone(tracker._observed_tracker_running())
                tracker._reconcile_pid_record([2001])
                self.assertIsNone(tracker._read_tracker_pid())

    def test_pending_start_is_private_and_live_launcher_is_never_ready(self):
        with temp_dir_closing_databases() as tmp:
            tracker.DB_PATH = Path(tmp) / "tracker.sqlite3"
            path = tracker.pending_path()
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("stale")
            path.chmod(0o644)
            processes = {2001: self.commands()}
            with patch.object(tracker, "_macos_process_identity", side_effect=self.identity), \
                    patch.object(tracker, "_process_table", return_value=processes), \
                    patch.object(tracker, "_process_command", side_effect=processes.get), \
                    patch.object(tracker, "_tracker_runtime_fingerprint", return_value="a" * 64):
                tracker._write_pending_mac_start(2001, "a" * 64, "b" * 32)
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)
                # A live, identity-checked launcher remains pending regardless
                # of record age; only its worker's handshake can make it ready.
                os.utime(path, (1, 1))
                self.assertTrue(tracker._pending_mac_start(processes, "a" * 64))
                self.assertIsNone(tracker._observed_tracker_running())
                tracker._reconcile_pid_record([2001])
                self.assertIsNone(tracker._read_tracker_pid())
                self.assertIsNone(tracker._ready_mac_worker(2001))
                self.assertFalse(tracker.ready_path().exists())

    def test_pending_start_rejects_stale_reused_or_different_runtime_launcher(self):
        with temp_dir_closing_databases() as tmp:
            tracker.DB_PATH = Path(tmp) / "tracker.sqlite3"
            command = self.commands()
            with patch.object(tracker, "_macos_process_identity", side_effect=self.identity):
                tracker._write_pending_mac_start(2001, "a" * 64, "b" * 32)
            cases = (
                ("exited launcher", {}, (111, 50), "a" * 64),
                ("reused launcher PID", {2001: command}, (999, 50), "a" * 64),
                ("different DB", {2001: command.replace(str(tracker.DB_PATH),
                    str(Path(tmp) / "other.sqlite3"))}, (111, 50), "a" * 64),
                ("different executable", {2001: command.replace(sys.executable,
                    "/Applications/drifty-old.app/Contents/MacOS/drifty-tracker")}, (111, 50), "a" * 64),
                ("different fingerprint", {2001: command}, (111, 50), "c" * 64),
                ("unavailable identity", {2001: command}, OSError("process exited"), "a" * 64),
            )
            for name, processes, identity, fingerprint in cases:
                with self.subTest(name=name), \
                        patch.object(tracker, "_macos_process_identity") as native_identity, \
                        patch.object(tracker, "_process_command", side_effect=processes.get), \
                        patch.object(tracker, "_tracker_runtime_fingerprint", return_value=fingerprint):
                    if isinstance(identity, Exception):
                        native_identity.side_effect = identity
                    else:
                        native_identity.return_value = identity
                    self.assertFalse(tracker._pending_mac_start(processes, fingerprint))

    def test_start_timeout_then_retry_does_not_stop_or_respawn_pending_pair(self):
        with temp_dir_closing_databases() as tmp:
            tracker.DB_PATH = Path(tmp) / "tracker.sqlite3"
            processes = {}

            def launch(*args, **kwargs):
                self.assertEqual(kwargs["env"][tracker._START_TOKEN_ENV], "b" * 32)
                processes.update({2001: self.commands(), 2002: self.commands()})
                # The worker has claimed its PID, but cold initialization has
                # not published a ready handshake before the first timeout.
                tracker._write_tracker_pid(2002)
                return MagicMock(pid=2001)

            with patch.object(tracker, "_process_table", side_effect=lambda: dict(processes)), \
                    patch.object(tracker, "_process_command", side_effect=processes.get), \
                    patch.object(tracker, "_macos_process_identity", side_effect=self.identity), \
                    patch.object(tracker, "_tracker_runtime_fingerprint", return_value="a" * 64), \
                    patch.object(tracker.secrets, "token_hex", return_value="b" * 32), \
                    patch.object(tracker.subprocess, "Popen", side_effect=launch) as spawn, \
                    patch.object(tracker, "_stop_tracker_daemons", return_value=[]) as stop, \
                    patch.object(tracker.time, "sleep"), \
                    patch.object(tracker.time, "monotonic", side_effect=[10, 12]), \
                    patch.object(tracker, "get_status", return_value={"ok": True, "data": {"running": True}}):
                first = tracker.start_tracking()
                self.assertFalse(first["ok"])
                self.assertIn("preparing", first["error"])
                spawn.assert_called_once()
                self.assertTrue(tracker.pending_path().exists())
                self.assertTrue(tracker._pending_mac_start(dict(processes), "a" * 64))
                stop.reset_mock()
                spawn.reset_mock()

                retry = tracker.start_tracking()
                self.assertFalse(retry["ok"])
                stop.assert_not_called()
                spawn.assert_not_called()
                self.assertEqual(tracker._read_tracker_pid(), 2002)
                self.assertTrue(tracker.pending_path().exists())
                self.assertFalse(tracker.ready_path().exists())

    def test_stop_cleans_pending_start_only_after_physical_pair_is_gone(self):
        for still_running in (True, False):
            with self.subTest(still_running=still_running), temp_dir_closing_databases() as tmp:
                tracker.DB_PATH = Path(tmp) / "tracker.sqlite3"
                pair = {2001: self.commands(), 2002: self.commands()}
                tracker._write_tracker_pid(2002)
                with patch.object(tracker, "_macos_process_identity", side_effect=self.identity):
                    tracker._write_pending_mac_start(2001, "a" * 64, "b" * 32)
                with patch.object(tracker, "_process_table", side_effect=[pair, pair if still_running else {}]), \
                        patch.object(tracker, "_stop_tracker_daemons", return_value=[]) as stop, \
                        patch.object(tracker, "get_status", return_value={"ok": True, "data": {"running": False}}), \
                        patch.object(tracker, "database", return_value=MagicMock()), \
                        patch.object(tracker, "reset_foreground_audio_diagnostics"):
                    result = tracker.stop_tracking()
                stop.assert_called_once_with([2001, 2002])
                self.assertEqual(result["ok"], not still_running)
                self.assertEqual(tracker.pending_path().exists(), still_running)

    def test_stop_uses_both_physical_processes_not_logical_worker_only(self):
        with temp_dir_closing_databases() as tmp:
            tracker.DB_PATH = Path(tmp) / "tracker.sqlite3"
            tracker._write_tracker_pid(2002)
            with patch.object(tracker, "_process_table", side_effect=[{2001: self.commands(), 2002: self.commands()}, {}]), \
                    patch.object(tracker, "_stop_tracker_daemons", return_value=[]) as stop, \
                    patch.object(tracker, "get_status", return_value={"ok": True, "data": {"running": False}}), \
                    patch.object(tracker, "reset_foreground_audio_diagnostics"):
                self.assertTrue(tracker.stop_tracking()["ok"])
                stop.assert_called_once_with([2001, 2002])

    def test_source_and_windows_never_request_frozen_runtime_reset(self):
        with patch.object(tracker, "_TRANSIENT_RUNTIME", True), patch.object(sys, "frozen", False):
            self.assertEqual(tracker._detached_spawn_kwargs(), {"start_new_session": True})
        with patch.object(sys, "platform", "win32"), patch.object(
            tracker.subprocess, "DETACHED_PROCESS", 8, create=True
        ), patch.object(tracker.subprocess, "CREATE_NEW_PROCESS_GROUP", 512, create=True):
            self.assertEqual(tracker._detached_spawn_kwargs(), {"creationflags": 520})

    def test_start_waits_for_its_worker_token_even_if_status_would_report_running(self):
        with temp_dir_closing_databases() as tmp:
            tracker.DB_PATH = Path(tmp) / "tracker.sqlite3"
            db = MagicMock()
            db.get_meta.return_value = "a" * 64

            def launch(*args, **kwargs):
                self.assertEqual(kwargs["env"][tracker._START_TOKEN_ENV], "b" * 32)
                tracker._write_tracker_pid(2002)
                return MagicMock(pid=2001)

            with patch.object(tracker, "_process_table", return_value={}), \
                    patch.object(tracker, "_process_command", return_value=self.commands()), \
                    patch.object(tracker.subprocess, "Popen", side_effect=launch), \
                    patch.object(tracker.secrets, "token_hex", return_value="b" * 32), \
                    patch.object(tracker, "_read_tracker_ready", side_effect=[self.ready(token="old"), self.ready(), self.ready()]), \
                    patch.object(tracker, "_macos_process_identity", side_effect=self.identity), \
                    patch.object(tracker, "_tracker_runtime_fingerprint", return_value="a" * 64), \
                    patch.object(tracker, "database", return_value=db), \
                    patch.object(tracker, "get_status", return_value={"ok": True, "data": {"running": True}}) as status, \
                    patch.object(tracker.time, "sleep") as sleep:
                self.assertTrue(tracker.start_tracking()["ok"])
                self.assertEqual(sleep.call_count, 2)
                status.assert_called_once_with()

    def test_start_timeout_never_returns_success_for_unpacking_supervisor(self):
        with temp_dir_closing_databases() as tmp:
            tracker.DB_PATH = Path(tmp) / "tracker.sqlite3"
            with patch.object(tracker, "_process_table", return_value={}), \
                    patch.object(tracker.subprocess, "Popen", return_value=MagicMock(pid=2001)), \
                    patch.object(tracker, "_macos_process_identity", side_effect=self.identity), \
                    patch.object(tracker, "_tracker_runtime_fingerprint", return_value="a" * 64), \
                    patch.object(tracker.time, "sleep"), \
                    patch.object(tracker.time, "monotonic", side_effect=[10, 12]), \
                    patch.object(tracker, "get_status", return_value={"ok": True, "data": {"running": True}}) as status:
                result = tracker.start_tracking()
                self.assertFalse(result["ok"])
                self.assertIsNone(result["data"])
                self.assertIn("preparing", result["error"])
                status.assert_not_called()

    def test_two_independent_generations_cannot_be_folded_into_one(self):
        with temp_dir_closing_databases() as tmp:
            tracker.DB_PATH = Path(tmp) / "tracker.sqlite3"
            command = self.commands()
            db = MagicMock()
            db.get_meta.return_value = "a" * 64
            with patch.object(tracker, "_process_table", return_value={pid: command for pid in [2001, 2002, 3001, 3002]}), \
                    patch.object(tracker, "_process_command", return_value=command), \
                    patch.object(tracker, "_read_tracker_pid", return_value=2002), \
                    patch.object(tracker, "_read_tracker_ready", return_value=self.ready(), create=True), \
                    patch.object(tracker, "_macos_process_identity", side_effect=self.identity, create=True), \
                    patch.object(tracker, "_tracker_runtime_fingerprint", return_value="a" * 64), \
                    patch.object(tracker, "database", return_value=db):
                self.assertFalse(tracker.verify_current_runtime_running()["data"])

    def test_reused_worker_pid_is_not_a_ready_generation(self):
        with temp_dir_closing_databases() as tmp:
            tracker.DB_PATH = Path(tmp) / "tracker.sqlite3"
            db = MagicMock()
            db.get_meta.return_value = "a" * 64
            with patch.object(tracker, "_process_table", return_value={2002: self.commands()}), \
                    patch.object(tracker, "_process_command", return_value=self.commands()), \
                    patch.object(tracker, "_read_tracker_pid", return_value=2002), \
                    patch.object(tracker, "_read_tracker_ready", return_value=self.ready(), create=True), \
                    patch.object(tracker, "_macos_process_identity", return_value=(999, 2001), create=True), \
                    patch.object(tracker, "_tracker_runtime_fingerprint", return_value="a" * 64), \
                    patch.object(tracker, "database", return_value=db):
                self.assertFalse(tracker.verify_current_runtime_running()["data"])


if __name__ == "__main__":
    unittest.main()
