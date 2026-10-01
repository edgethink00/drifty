import hashlib
import json
import os
import sqlite3
import subprocess
import sys
import threading
import time
import unittest
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import MagicMock, call, patch

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app import main as tracker_main
from app import windows_process_liveness
from app.storage import db as tracker_storage
from app.storage.db import TrackerDatabase
from app.storage.live_tail import fetch_live_tail
from app.tracker import browser_history, windows_workspace
from app.tracker.adaptive_context import developer_diagnostics
from app.tracker.macos_workspace import Snapshot
from app.tracker.macos_audio_activity import ForegroundAudioSample
from app.tracker.power_state import PowerStateSample
from app.tracker.windows_workspace import build_snapshot as build_windows_snapshot
from app.tracker.windows_browser_uia import WindowsBrowserUiaResult
from app.tracker.windows_browser_capture import _UrlWorker
from tests.support_cleanup import temp_dir_closing_databases


class TrackerMainTests(unittest.TestCase):
    def test_windows_status_without_pid_refuses_unreadable_process_table(self) -> None:
        db = MagicMock()
        db.get_meta.return_value = None
        with patch.object(tracker_main.sys, "platform", "win32"), patch.object(
            tracker_main, "database", return_value=db
        ), patch.object(tracker_main, "_read_tracker_pid", return_value=None), patch.object(
            tracker_main, "_process_table", return_value=None
        ) as inspect, patch.object(tracker_main, "accessibility_granted", return_value=True):
            status = tracker_main._dispatch({"command": "get_status", "payload": {}})
            self.assertFalse(status["ok"])
            self.assertIsNone(status["data"])
            self.assertIn("Unable to inspect", status["error"])
            inspect.assert_called_once_with()
            # Other boolean callers retain their existing unknown fallback.
            self.assertIs(tracker_main.is_running(), False)

    def test_windows_status_without_pid_accepts_a_readable_empty_process_table(self) -> None:
        db = MagicMock()
        db.get_meta.return_value = None
        with patch.object(tracker_main.sys, "platform", "win32"), patch.object(
            tracker_main, "database", return_value=db
        ), patch.object(tracker_main, "_read_tracker_pid", return_value=None), patch.object(
            tracker_main, "_process_table", return_value={}
        ), patch.object(tracker_main, "accessibility_granted", return_value=True):
            status = tracker_main.get_status()
        self.assertTrue(status["ok"])
        self.assertIs(status["data"]["running"], False)
        self.assertEqual(status["data"]["trackerMode"], "idle")

    def test_windows_status_keeps_a_live_pid_running_when_ownership_is_unknown(self) -> None:
        db = MagicMock()
        db.get_meta.return_value = None
        with patch.object(tracker_main.sys, "platform", "win32"), patch.object(
            tracker_main, "database", return_value=db
        ), patch.object(tracker_main, "_read_tracker_pid", return_value=501), patch.object(
            tracker_main, "_process_exists", return_value=True
        ), patch.object(tracker_main, "_process_command", return_value=None), patch.object(
            tracker_main, "_process_table", return_value=None
        ) as inspect, patch.object(tracker_main, "accessibility_granted", return_value=True):
            status = tracker_main.get_status()
        self.assertTrue(status["ok"])
        self.assertIs(status["data"]["running"], True)
        inspect.assert_not_called()

    def test_macos_status_retains_its_unreadable_table_fallback(self) -> None:
        db = MagicMock()
        db.get_meta.return_value = None
        with patch.object(tracker_main.sys, "platform", "darwin"), patch.object(
            tracker_main, "database", return_value=db
        ), patch.object(tracker_main, "_read_tracker_pid", return_value=None), patch.object(
            tracker_main, "_process_table", return_value=None
        ), patch.object(tracker_main, "accessibility_granted", return_value=True):
            status = tracker_main.get_status()
        self.assertTrue(status["ok"])
        self.assertIs(status["data"]["running"], False)
        self.assertEqual(status["data"]["trackerMode"], "idle")

    def test_windows_status_expired_budget_does_not_query_or_confirm_stopped(self) -> None:
        from app import windows_process_table as process_table

        db = MagicMock()
        db.get_meta.return_value = None
        process_table.invalidate_process_table_cache()
        try:
            with patch.object(tracker_main.sys, "platform", "win32"), patch.object(
                tracker_main.time, "monotonic", return_value=100.0
            ), patch.object(tracker_main, "database", return_value=db), patch.object(
                tracker_main, "_read_tracker_pid", return_value=None
            ), patch.object(tracker_main, "accessibility_granted", return_value=True), patch.object(
                process_table.subprocess, "run"
            ) as query:
                status = tracker_main.get_status(process_deadline=100.0)
            self.assertFalse(status["ok"])
            self.assertIsNone(status["data"])
            query.assert_not_called()
        finally:
            process_table.invalidate_process_table_cache()

    def test_windows_start_preserves_a_status_error_for_an_existing_daemon(self) -> None:
        db = MagicMock()
        db.get_meta.return_value = None
        command = f'"{sys.executable}" "{tracker_main._current_script_path()}" daemon --db "{tracker_main.DB_PATH}"'
        with patch.object(tracker_main.sys, "platform", "win32"), patch.object(
            tracker_main, "database", return_value=db
        ), patch.object(tracker_main, "_read_tracker_pid", return_value=None), patch.object(
            tracker_main, "_process_table", side_effect=[{501: command}, None]
        ), patch.object(tracker_main, "_reconcile_pid_record"), patch.object(
            tracker_main, "_running_daemon_matches_current_runtime", return_value=True
        ), patch.object(tracker_main, "accessibility_granted", return_value=True), patch.object(
            tracker_main.subprocess, "Popen"
        ) as spawn:
            status = tracker_main._start_tracking_locked()
        self.assertFalse(status["ok"])
        self.assertIsNone(status["data"])
        self.assertIn("Unable to inspect", status["error"])
        spawn.assert_not_called()

    def test_windows_start_poll_preserves_a_status_error(self) -> None:
        db = MagicMock()
        db.get_meta.return_value = None
        with patch.object(tracker_main.sys, "platform", "win32"), patch.object(
            tracker_main, "database", return_value=db
        ), patch.object(tracker_main, "_read_tracker_pid", return_value=None), patch.object(
            tracker_main, "_process_table", side_effect=[{}, {}, None]
        ), patch.object(tracker_main, "_reconcile_pid_record"), patch.object(
            tracker_main, "_invalidate_process_table"
        ), patch.object(tracker_main, "accessibility_granted", return_value=True), patch.object(
            tracker_main.subprocess, "Popen"
        ) as spawn, patch.object(tracker_main.time, "sleep"), patch.object(
            tracker_main, "TRACKER_START_TIMEOUT_SECONDS", 0.0
        ), patch.object(tracker_main, "_detached_spawn_kwargs", return_value={}
        ):
            status = tracker_main._start_tracking_locked()
        self.assertFalse(status["ok"])
        self.assertIsNone(status["data"])
        self.assertIn("Unable to inspect", status["error"])
        spawn.assert_called_once()

    def test_windows_stop_and_follow_up_status_do_not_confirm_an_unreadable_table(self) -> None:
        db = MagicMock()
        db.get_meta.return_value = None
        with patch.object(tracker_main.sys, "platform", "win32"), patch.object(
            tracker_main, "database", return_value=db
        ), patch.object(tracker_main, "_read_tracker_pid", return_value=None), patch.object(
            tracker_main, "_process_table", side_effect=[{}, {}, None, None]
        ), patch.object(tracker_main, "_reconcile_pid_record"), patch.object(
            tracker_main, "_invalidate_process_table"
        ), patch.object(tracker_main, "accessibility_granted", return_value=True):
            stopped = tracker_main._stop_tracking_locked()
            follow_up = tracker_main._dispatch({"command": "get_status", "payload": {}})
        for status in (stopped, follow_up):
            self.assertFalse(status["ok"])
            self.assertIsNone(status["data"])
            self.assertIn("Unable to inspect", status["error"])
        db.set_meta.assert_not_called()

    def test_status_skips_only_explicit_mac_native_permission_probe(self) -> None:
        for platform_name, payload, should_probe in (
            ("darwin", {}, True),
            ("darwin", {"skipAccessibilityProbe": True}, False),
            ("darwin", {"skipAccessibilityProbe": "true"}, True),
            ("win32", {"skipAccessibilityProbe": True}, True),
        ):
            with self.subTest(platform=platform_name, payload=payload):
                with patch.object(tracker_main, "database"), patch.object(
                    tracker_main, "is_running", return_value=False
                ), patch.object(tracker_main, "_read_tracker_pid", return_value=None), patch.object(
                    tracker_main, "_process_table", return_value={}
                ), patch.object(tracker_main.sys, "platform", platform_name), patch.object(
                    tracker_main, "accessibility_granted", return_value=True
                ) as probe:
                    result = tracker_main.COMMANDS["get_status"](payload)
                self.assertTrue(result["ok"])
                self.assertEqual(result["data"]["accessibilityGranted"], should_probe)
                self.assertEqual(probe.call_count, int(should_probe))

    def test_windows_stop_uses_cooperative_shutdown_instead_of_sigterm(self) -> None:
        command = f'"{sys.executable}" "{tracker_main._current_script_path()}" daemon --db "{tracker_main.DB_PATH}"'
        windows_stop = MagicMock(return_value="cooperative")
        with patch.object(tracker_main.sys, "platform", "win32"), patch.object(
            tracker_main, "_process_exists", return_value=True
        ), patch.object(tracker_main, "_process_command", return_value=command), patch.object(
            tracker_main, "_wait_for_process_exit", return_value=True
        ), patch.object(tracker_main, "_remove_pid_record_if_owned") as remove_pid, patch(
            "app.main.os.kill"
        ) as kill, patch.dict(sys.modules, {
            "app.windows_daemon_shutdown": SimpleNamespace(stop_windows_tracker_daemon=windows_stop)
        }):
            ownership = tracker_main._stop_verified_tracker_daemon(501)

        self.assertEqual(ownership, "tracker")
        kill.assert_not_called()
        windows_stop.assert_called_once()
        self.assertEqual(windows_stop.call_args.args[:2], (501, tracker_main.DB_PATH))
        remove_pid.assert_called_once_with(501)

    def test_windows_stop_fresh_database_recheck_refuses_changed_command(self) -> None:
        owned = f'"{sys.executable}" "{tracker_main._current_script_path()}" daemon --db "{tracker_main.DB_PATH}"'
        other = f'"{sys.executable}" "{tracker_main._current_script_path()}" daemon --db "{tracker_main.DB_PATH}.other"'
        def stop(pid, db, executable, verify, timeout, **kwargs):
            self.assertFalse(verify())
            raise PermissionError("changed database")
        windows_stop = MagicMock(side_effect=stop)
        with patch.object(tracker_main.sys, "platform", "win32"), patch.object(
            tracker_main, "_process_exists", return_value=True
        ), patch.object(tracker_main, "_process_command", side_effect=[owned, owned, other]), patch.object(
            tracker_main, "_invalidate_process_table"
        ) as invalidate, patch.object(tracker_main, "_remove_pid_record_if_owned") as remove_pid, patch(
            "app.main.os.kill"
        ) as kill, patch.dict(sys.modules, {
            "app.windows_daemon_shutdown": SimpleNamespace(stop_windows_tracker_daemon=windows_stop)
        }):
            with self.assertRaises(PermissionError):
                tracker_main._stop_verified_tracker_daemon(501)
        invalidate.assert_called_once(); kill.assert_not_called(); remove_pid.assert_not_called()

    def test_windows_stop_failure_preserves_pid_and_returns_observed_running_status(self) -> None:
        with TemporaryDirectory() as tmp, patch.object(tracker_main, "DB_PATH", Path(tmp) / "owned.sqlite3"):
            tracker_main._write_tracker_pid(501)
            command = f'"{sys.executable}" "{tracker_main._current_script_path()}" daemon --db "{tracker_main.DB_PATH}"'
            windows_stop = MagicMock(side_effect=TimeoutError("verified daemon did not exit"))
            with patch.object(tracker_main.sys, "platform", "win32"), patch.object(
                tracker_main, "_process_table", return_value={501: command}
            ), patch.object(tracker_main, "_process_command", return_value=command), patch.object(
                tracker_main, "_process_exists", return_value=True
            ), patch.object(tracker_main, "get_status", return_value={"data": {"running": True}}), patch(
                "app.main.os.kill"
            ) as kill, patch.dict(sys.modules, {
                "app.windows_daemon_shutdown": SimpleNamespace(stop_windows_tracker_daemon=windows_stop)
            }):
                result = tracker_main.stop_tracking()
            self.assertFalse(result["ok"])
            self.assertTrue(result["data"]["running"])
            self.assertIn("did not exit", result["error"])
            self.assertEqual(tracker_main._read_tracker_pid(), 501)
            kill.assert_not_called()

    def test_windows_stop_refreshes_cached_source_command_and_confirms_cooperative_exit(self) -> None:
        from app import windows_process_table as process_table

        with TemporaryDirectory() as tmp, patch.object(tracker_main, "DB_PATH", Path(tmp) / "owned.sqlite3"):
            tracker_main.state_dir().mkdir(parents=True)
            tracker_main._write_tracker_pid(501)
            command = f'"{sys.executable}" "{tracker_main._current_script_path()}" daemon --db "{tracker_main.DB_PATH}"'
            stopped = False
            queried_states = []

            def query(*args, **kwargs):
                queried_states.append(stopped)
                rows = [] if stopped else [{"ProcessId": 501, "CommandLine": command}]
                return subprocess.CompletedProcess(args[0], 0, stdout=json.dumps(rows), stderr="")

            def cooperative_stop(pid, db_path, executable, verify, timeout, **kwargs):
                nonlocal stopped
                queries_before_recheck = len(queried_states)
                self.assertTrue(verify())
                self.assertGreater(len(queried_states), queries_before_recheck)
                stopped = True
                return "cooperative"

            windows_stop = MagicMock(side_effect=cooperative_stop)
            with patch.object(tracker_main.sys, "platform", "win32"), patch.object(
                process_table, "_cached_table", {501: command}
            ), patch.object(process_table, "_cached_at", 10.0), patch.object(
                process_table.time, "monotonic", return_value=10.0
            ), patch.object(process_table.subprocess, "run", side_effect=query), patch.object(
                tracker_main, "_process_exists", return_value=True
            ), patch.object(tracker_main, "database", return_value=MagicMock()), patch.object(
                tracker_main, "get_status", return_value={"data": {"running": False}}
            ), patch("app.main.os.kill") as kill, patch.dict(sys.modules, {
                "app.windows_daemon_shutdown": SimpleNamespace(stop_windows_tracker_daemon=windows_stop)
            }):
                result = tracker_main.stop_tracking()

            self.assertTrue(result["ok"], result)
            windows_stop.assert_called_once()
            self.assertEqual(windows_stop.call_args.args[:3],
                             (501, tracker_main.DB_PATH, Path(sys.executable).expanduser().resolve()))
            self.assertEqual(windows_stop.call_args.kwargs, {"source_runtime": True, "deadline": 19.0})
            self.assertTrue(queried_states[-1], "stop confirmation must query after cooperative exit")
            self.assertFalse(tracker_main.pid_path().exists())
            kill.assert_not_called()

    def test_windows_stop_initial_query_and_failure_status_share_one_wall_budget(self) -> None:
        from app import windows_process_table as process_table

        run = subprocess.run

        def slow_query(*args, **kwargs):
            return run([sys.executable, "-c", "import time; time.sleep(2); print('[]')"], **kwargs)

        db = MagicMock()
        db.get_meta.return_value = None
        process_table.invalidate_process_table_cache()
        try:
            with TemporaryDirectory() as tmp, patch.object(
                tracker_main, "DB_PATH", Path(tmp) / "owned.sqlite3"
            ):
                tracker_main._write_tracker_pid(501)
                with patch.object(tracker_main.sys, "platform", "win32"), patch.object(
                    tracker_main, "TRACKER_EXIT_TIMEOUT_SECONDS", 0.2
                ), patch.object(tracker_main, "database", return_value=db), patch.object(
                    tracker_main, "accessibility_granted", return_value=True
                ), patch.object(tracker_main, "_process_exists", return_value=True), patch.object(
                    tracker_main, "_stop_verified_tracker_daemon"
                ) as stop, patch.object(process_table.subprocess, "run", side_effect=slow_query) as query:
                    started = time.monotonic()
                    result = tracker_main.stop_tracking()
                    elapsed = time.monotonic() - started

                self.assertGreaterEqual(elapsed, 0.15)
                self.assertLess(elapsed, 1.25)
                self.assertFalse(result["ok"])
                self.assertIn("Unable to inspect", result["error"])
                self.assertTrue(result["data"]["running"])
                self.assertEqual(tracker_main._read_tracker_pid(), 501)
                query.assert_called_once()  # No fresh 20s status query after expiry.
                stop.assert_not_called()
        finally:
            process_table.invalidate_process_table_cache()

    def test_windows_stop_expired_unknown_snapshot_without_pid_is_not_confirmed(self) -> None:
        from app import windows_process_table as process_table

        now = 0.0

        def late_query(*args, **kwargs):
            nonlocal now
            now = tracker_main.TRACKER_EXIT_TIMEOUT_SECONDS
            return MagicMock(returncode=0, stdout="[]")

        db = MagicMock()
        db.get_meta.return_value = None
        process_table.invalidate_process_table_cache()
        try:
            with TemporaryDirectory() as tmp, patch.object(
                tracker_main, "DB_PATH", Path(tmp) / "owned.sqlite3"
            ), patch.object(tracker_main.sys, "platform", "win32"), patch.object(
                tracker_main.time, "monotonic", side_effect=lambda: now
            ), patch.object(tracker_main, "database", return_value=db), patch.object(
                tracker_main, "accessibility_granted", return_value=True
            ), patch.object(tracker_main, "_read_tracker_pid", return_value=None), patch.object(
                tracker_main, "_stop_verified_tracker_daemon"
            ) as stop, patch.object(process_table.subprocess, "run", side_effect=late_query) as query:
                result = tracker_main.stop_tracking()

            self.assertFalse(result["ok"])
            self.assertIn("Unable to inspect", result["error"])
            self.assertIsNone(result["data"])
            self.assertIsNone(process_table._cached_table)
            query.assert_called_once()
            stop.assert_not_called()
        finally:
            process_table.invalidate_process_table_cache()

    def test_windows_stop_confirmation_and_status_share_one_wall_budget(self) -> None:
        from app import windows_process_table as process_table

        run = subprocess.run
        calls = 0

        def query(*args, **kwargs):
            nonlocal calls
            calls += 1
            if calls == 1:
                return subprocess.CompletedProcess(args[0], 0, stdout="[]")
            return run([sys.executable, "-c", "import time; time.sleep(2); print('[]')"], **kwargs)

        db = MagicMock()
        db.get_meta.return_value = None
        process_table.invalidate_process_table_cache()
        try:
            with patch.object(tracker_main.sys, "platform", "win32"), patch.object(
                tracker_main, "TRACKER_EXIT_TIMEOUT_SECONDS", 0.2
            ), patch.object(tracker_main, "database", return_value=db), patch.object(
                tracker_main, "accessibility_granted", return_value=True
            ), patch.object(tracker_main, "_read_tracker_pid", return_value=None), patch.object(
                tracker_main, "_reconcile_pid_record"
            ), patch.object(process_table.subprocess, "run", side_effect=query) as cim:
                started = time.monotonic()
                result = tracker_main.stop_tracking()
                elapsed = time.monotonic() - started
            self.assertGreaterEqual(elapsed, 0.15)
            self.assertLess(elapsed, 1.25)
            self.assertFalse(result["ok"])
            self.assertIn("Unable to confirm", result["error"])
            self.assertEqual(cim.call_count, 2)  # No third status CIM after expiry.
        finally:
            process_table.invalidate_process_table_cache()

    def _stop_simulated_windows_legacy_daemons(self, count: int):
        from app import windows_daemon_shutdown as shutdown
        from app import windows_process_table as process_table

        # Exercise public Stop, real command parsing/cache and the native Stop
        # algorithm. Only CIM transport, native handles and the clock are fake.
        now = 100.0
        active = set(range(501, 501 + count))
        handles = {pid: object() for pid in active}
        owners = {handle: pid for pid, handle in handles.items()}
        bound_at = []
        forced = []
        closed = []
        queries = []
        process_deadlines = []
        read_process_table = tracker_main._process_table

        def inspect_process_table(**kwargs):
            process_deadlines.append(kwargs.get("deadline"))
            return read_process_table(**kwargs)

        def open_process(pid):
            bound_at.append((pid, now))
            return handles[pid] if pid in active else None

        def wait(handle, seconds):
            nonlocal now
            self.assertIn(handle, owners)
            if owners[handle] not in active:
                return True
            now += seconds
            return False

        def terminate(handle):
            self.assertIn(handle, owners)
            forced.append(owners[handle])
            active.remove(owners[handle])

        api = SimpleNamespace(
            open_process=open_process,
            validate_process=lambda handle, executable, source: 1000 + owners[handle],
            wait=wait,
            open_event=lambda name: None,  # A legacy daemon has no Stop event.
            terminate=terminate,
            close=closed.append,
        )
        process_table.invalidate_process_table_cache()
        try:
            with TemporaryDirectory() as tmp, patch.object(
                tracker_main, "DB_PATH", Path(tmp) / "owned.sqlite3"
            ):
                command = f'"{sys.executable}" "{tracker_main._current_script_path()}" daemon --db "{tracker_main.DB_PATH}"'
                foreign = command.replace(str(tracker_main.DB_PATH), str(tracker_main.DB_PATH) + ".other")

                def query(*args, **kwargs):
                    nonlocal now
                    queries.append((now, kwargs["timeout"]))
                    if kwargs["timeout"] <= 0.25:
                        now += kwargs["timeout"]
                        raise subprocess.TimeoutExpired(args[0], kwargs["timeout"])
                    now += 0.25
                    rows = [{"ProcessId": pid, "CommandLine": command} for pid in active]
                    # Unrelated namespaces cannot buy a larger Stop budget.
                    rows.extend({"ProcessId": pid, "CommandLine": foreign} for pid in range(900, 920))
                    return subprocess.CompletedProcess(args[0], 0, stdout=json.dumps(rows))

                db = MagicMock()
                db.get_meta.return_value = None
                with patch.object(tracker_main.sys, "platform", "win32"), patch.object(
                    tracker_main.time, "monotonic", side_effect=lambda: now
                ), patch.object(process_table.subprocess, "run", side_effect=query), patch.object(
                    tracker_main, "_process_exists", side_effect=lambda pid: pid in active
                ), patch.object(shutdown, "_NativeApi", return_value=api), patch.object(
                    tracker_main, "database", return_value=db
                ), patch.object(tracker_main, "_process_table", side_effect=inspect_process_table), patch.object(
                    tracker_main, "accessibility_granted", return_value=True
                ), patch(
                    "app.main.os.kill"
                ) as kill, patch.object(shutdown.sys, "stderr", MagicMock()):
                    result = tracker_main.stop_tracking()
                kill.assert_not_called()
                self.assertEqual(len(closed), len(bound_at))
                return result, now - 100.0, active, forced, bound_at, queries, process_deadlines[-1]
        finally:
            process_table.invalidate_process_table_cache()

    def test_windows_stop_preserves_each_legacy_daemons_cooperative_wait(self) -> None:
        result, elapsed, active, forced, bound_at, queries, status = self._stop_simulated_windows_legacy_daemons(4)
        self.assertTrue(result["ok"], result)
        self.assertFalse(active)
        self.assertEqual(forced, [501, 502, 503, 504])
        self.assertEqual(len(bound_at), 4)
        self.assertGreater(elapsed, 8.0)  # Four full 2s windows on the fake clock.
        self.assertLessEqual(elapsed, 18.0)
        self.assertTrue(all(timeout <= 118.0 - started for started, timeout in queries))
        self.assertLessEqual(status, 118.0)
        self.assertLessEqual(status - (100.0 + elapsed), 3.0)

    def test_windows_stop_many_legacy_daemons_share_a_fixed_operation_cap(self) -> None:
        result, elapsed, active, forced, bound_at, queries, status = self._stop_simulated_windows_legacy_daemons(12)
        self.assertFalse(result["ok"])
        self.assertIsNone(result["data"])
        self.assertIn("deadline", result["error"])
        self.assertTrue(active)
        self.assertGreater(len(forced), 1)
        self.assertLess(len(forced), 12)
        self.assertAlmostEqual(elapsed, 24.0)
        self.assertTrue(all(started < 124.0 for _, started in bound_at))
        self.assertTrue(all(started < 124.0 and timeout <= 124.0 - started for started, timeout in queries))
        self.assertEqual(status, 124.0)

    def test_windows_stop_prebinding_queries_keep_the_overall_budget(self) -> None:
        now = 100.0
        command = f'"{sys.executable}" "{tracker_main._current_script_path()}" daemon --db "{tracker_main.DB_PATH}"'
        deadlines = []

        def inspect(pid, *, deadline):
            nonlocal now
            deadlines.append(deadline)
            if len(deadlines) == 1:
                now += 3.1  # Still inside overall, before native Stop starts.
            return command

        windows_stop = MagicMock(return_value="cooperative")
        with patch.object(tracker_main.sys, "platform", "win32"), patch.object(
            tracker_main.time, "monotonic", side_effect=lambda: now
        ), patch.object(tracker_main, "_process_exists", return_value=True), patch.object(
            tracker_main, "_process_command", side_effect=inspect
        ), patch.object(tracker_main, "_remove_pid_record_if_owned"), patch.dict(sys.modules, {
            "app.windows_daemon_shutdown": SimpleNamespace(stop_windows_tracker_daemon=windows_stop)
        }):
            self.assertEqual(tracker_main._stop_verified_tracker_daemon(501, deadline=118.0), "tracker")
        self.assertEqual(deadlines, [118.0, 118.0])
        self.assertEqual(windows_stop.call_args.args[4], 3.0)
        self.assertEqual(windows_stop.call_args.kwargs["deadline"], 118.0)

    def test_public_cli_dispatch_does_not_match_internal_argument_values(self) -> None:
        self.assertFalse(
            tracker_main._is_public_cli_invocation(
                ["--db", "status", "--request-json", '{"command":"get_status"}']
            )
        )

    def test_public_cli_dispatch_accepts_commands_overrides_and_unknown_commands(self) -> None:
        self.assertTrue(
            tracker_main._is_public_cli_invocation(
                ["--db", "/tmp/status", "summary", "--day", "2026-08-05"]
            )
        )
        self.assertTrue(tracker_main._is_public_cli_invocation(["unknown-command"]))
        self.assertFalse(tracker_main._is_public_cli_invocation(["serve", "--db", "/tmp/status"]))

    def test_public_cli_dispatch_preserves_legacy_modes_after_global_options(self) -> None:
        self.assertFalse(tracker_main._is_public_cli_invocation(["--db", "/tmp/db", "daemon"]))
        self.assertFalse(tracker_main._is_public_cli_invocation(["--db=/tmp/db", "serve"]))
        self.assertFalse(
            tracker_main._is_public_cli_invocation(
                ["--smoke-id", "drifty-sentry-smoke-abcdef", tracker_main.SENTRY_SMOKE_MODE]
            )
        )
        self.assertTrue(
            tracker_main._is_public_cli_invocation(
                ["--db", "/tmp/db", "summary", "--day", "2026-08-05"]
            )
        )

    def test_sentry_smoke_test_requires_initialized_sdk(self) -> None:
        result = tracker_main.sentry_smoke_test("drifty-sentry-smoke-abcdef", False)

        self.assertFalse(result["ok"])
        self.assertFalse(result["data"]["captureRequested"])
        self.assertFalse(result["data"]["deliveryConfirmed"])

    def test_sentry_smoke_test_rejects_unsafe_identifier(self) -> None:
        with patch.object(tracker_main, "capture_tracker_exception") as capture:
            result = tracker_main.sentry_smoke_test("person@example.com", True)

        self.assertFalse(result["ok"])
        self.assertIsNone(result["data"]["smokeId"])
        capture.assert_not_called()

    def test_sentry_smoke_test_requests_capture_without_claiming_delivery(self) -> None:
        with patch.object(tracker_main, "capture_tracker_exception", return_value=True) as capture:
            result = tracker_main.sentry_smoke_test("drifty-sentry-smoke-abcdef", True)

        self.assertTrue(result["ok"])
        self.assertTrue(result["data"]["captureRequested"])
        self.assertFalse(result["data"]["deliveryConfirmed"])
        error = capture.call_args.args[0]
        context = capture.call_args.args[1]
        self.assertEqual(str(error), "drifty-sentry-smoke-abcdef")
        self.assertEqual(context, {"phase": "sentry-smoke-test", "smokeId": "drifty-sentry-smoke-abcdef"})

    def test_sentry_smoke_test_generates_safe_identifier(self) -> None:
        with patch.object(tracker_main.secrets, "token_hex", return_value="0123456789abcdef"), patch.object(
            tracker_main, "capture_tracker_exception", return_value=True
        ):
            result = tracker_main.sentry_smoke_test(None, True)

        self.assertEqual(result["data"]["smokeId"], "drifty-sentry-smoke-0123456789abcdef")

    def test_sentry_sdk_check_is_a_legacy_mode(self) -> None:
        self.assertFalse(
            tracker_main._is_public_cli_invocation(["--db", "/tmp/db", tracker_main.SENTRY_SDK_CHECK_MODE])
        )

    def test_sentry_sdk_check_initializes_through_the_tracker_path_with_a_discard_dsn(self) -> None:
        fake_consts = MagicMock(VERSION="9.9.9")
        seen_dsn = []

        def fake_init(mode: str) -> bool:
            seen_dsn.append((mode, os.environ.get("DRIFTY_TRACKER_SENTRY_DSN")))
            return True

        with patch.dict(sys.modules, {"sentry_sdk": MagicMock(), "sentry_sdk.consts": fake_consts}), patch.dict(
            os.environ, {"DRIFTY_TRACKER_SENTRY_DSN": "https://real@example.invalid/1"}
        ), patch.object(tracker_main, "silence_urllib3_libressl_warning") as silence, patch.object(
            tracker_main, "init_tracker_sentry", side_effect=fake_init
        ):
            result = tracker_main.sentry_sdk_check()

        self.assertEqual(result, {"ok": True, "data": {"sentrySdkVersion": "9.9.9", "initialized": True}, "error": None})
        self.assertEqual(seen_dsn, [(tracker_main.SENTRY_SDK_CHECK_MODE, tracker_main.SENTRY_SDK_CHECK_DSN)])
        silence.assert_called_once_with()

    def test_sentry_sdk_check_fails_when_the_sdk_cannot_initialize(self) -> None:
        with patch.dict(sys.modules, {"sentry_sdk": MagicMock(), "sentry_sdk.consts": MagicMock(VERSION="9.9.9")}), patch.dict(
            os.environ, {}
        ), patch.object(tracker_main, "init_tracker_sentry", return_value=False):
            result = tracker_main.sentry_sdk_check()

        self.assertFalse(result["ok"])
        self.assertEqual(result["data"], {"sentrySdkVersion": "9.9.9", "initialized": False})
        self.assertIn("could not initialize", result["error"])

    def test_sentry_sdk_check_fails_when_the_sdk_is_missing(self) -> None:
        with patch.dict(sys.modules, {"sentry_sdk": None}):
            result = tracker_main.sentry_sdk_check()

        self.assertFalse(result["ok"])
        self.assertIsNone(result["data"]["sentrySdkVersion"])
        self.assertFalse(result["data"]["initialized"])
        self.assertIn("Sentry SDK is not bundled", result["error"])

    def test_sentry_sdk_check_mode_returns_before_the_real_sentry_init(self) -> None:
        with patch.object(sys, "argv", ["drifty-tracker", "--db", "/tmp/unused.sqlite3", "sentry-sdk-check"]), patch.object(
            tracker_main, "init_tracker_sentry"
        ) as init, patch.object(
            tracker_main, "sentry_sdk_check", return_value={"ok": False, "data": None, "error": "x"}
        ), patch("builtins.print"):
            with self.assertRaises(SystemExit) as exit_info:
                tracker_main.main()

        self.assertEqual(exit_info.exception.code, 1)
        init.assert_not_called()

    def test_one_shot_requests_defer_the_sentry_import(self) -> None:
        with patch.object(sys, "argv", ["drifty-tracker", "--db", "/tmp/unused.sqlite3", "--request-json", "{}"]), patch.object(
            tracker_main, "init_tracker_sentry", return_value=True
        ) as init, patch.object(tracker_main, "handle_request") as handle:
            tracker_main.main()

        init.assert_called_once_with("request", defer_sdk_import=True)
        handle.assert_called_once_with("{}")

    def test_long_lived_modes_initialize_sentry_eagerly(self) -> None:
        with patch.object(sys, "argv", ["drifty-tracker", "--db", "/tmp/unused.sqlite3", "serve"]), patch.object(
            tracker_main, "init_tracker_sentry", return_value=True
        ) as init, patch.object(tracker_main, "serve") as serve:
            tracker_main.main()

        init.assert_called_once_with("serve", defer_sdk_import=False)
        serve.assert_called_once_with()

    def test_day_bounds_supports_day_payload(self) -> None:
        start, end = tracker_main.day_bounds({"day": "2026-04-06"})
        self.assertEqual(start, "2026-04-06T00:00:00")
        self.assertEqual(end, "2026-04-06T23:59:59")

    def test_day_bounds_supports_start_end_payload(self) -> None:
        start, end = tracker_main.day_bounds({"start": "2026-04-01T00:00:00", "end": "2026-04-07T23:59:59"})
        self.assertEqual(start, "2026-04-01T00:00:00")
        self.assertEqual(end, "2026-04-07T23:59:59")

    def test_database_reuses_instance_for_same_db_path(self) -> None:
        with temp_dir_closing_databases() as tmp:
            with patch.object(tracker_main, "DB_PATH", Path(tmp) / "tracker.sqlite3"):
                first = tracker_main.database()
                second = tracker_main.database()

        self.assertIs(first, second)

    def test_database_rebuilds_instance_when_db_path_changes(self) -> None:
        with temp_dir_closing_databases() as tmp:
            with patch.object(tracker_main, "DB_PATH", Path(tmp) / "first.sqlite3"):
                first = tracker_main.database()
            with patch.object(tracker_main, "DB_PATH", Path(tmp) / "second.sqlite3"):
                second = tracker_main.database()

        self.assertIsNot(first, second)
        self.assertEqual(first.db_path.name, "first.sqlite3")
        self.assertEqual(second.db_path.name, "second.sqlite3")

    def test_start_tracking_forwards_db_path_to_daemon(self) -> None:
        with temp_dir_closing_databases() as tmp:
            tracker_main.DB_PATH = Path(tmp) / "tracker.sqlite3"
            with patch.object(tracker_main, "_process_table", side_effect=[{}, {}]), patch.object(
                tracker_main, "get_status", return_value={"data": {"running": False}}
            ), patch("app.main.time.sleep"), patch("app.main.subprocess.Popen") as popen:
                tracker_main.start_tracking()
                args = popen.call_args.args[0]
                self.assertIn("--db", args)
                self.assertIn(str(tracker_main.DB_PATH), args)

    def test_start_tracking_builds_source_daemon_command(self) -> None:
        with temp_dir_closing_databases() as tmp:
            tracker_main.DB_PATH = Path(tmp) / "tracker.sqlite3"

            with patch.object(sys, "executable", "/usr/bin/python3"), patch.object(
                sys, "frozen", False, create=True
            ), patch.object(tracker_main, "_process_table", side_effect=[{}, {}]), patch.object(
                tracker_main, "get_status", return_value={"data": {"running": True}}
            ), patch("app.main.time.sleep"), patch("app.main.subprocess.Popen") as popen:
                tracker_main.start_tracking()

        self.assertEqual(
            popen.call_args.args[0],
            [
                "/usr/bin/python3",
                tracker_main._current_script_path(),
                "daemon",
                "--db",
                str(tracker_main.DB_PATH),
            ],
        )

    def test_start_tracking_builds_frozen_daemon_command(self) -> None:
        with temp_dir_closing_databases() as tmp:
            tracker_main.DB_PATH = Path(tmp) / "tracker.sqlite3"

            with patch.object(sys, "executable", "/Applications/Drifty.app/Contents/MacOS/drifty-tracker"), patch.object(
                sys, "frozen", True, create=True
            ), patch.object(tracker_main, "_process_table", side_effect=[{}, {}]), patch.object(
                tracker_main, "get_status", return_value={"data": {"running": True}}
            ), patch("app.main.time.sleep"), patch("app.main.subprocess.Popen") as popen:
                tracker_main.start_tracking()

        self.assertEqual(
            popen.call_args.args[0],
            [
                "/Applications/Drifty.app/Contents/MacOS/drifty-tracker",
                "daemon",
                "--db",
                str(tracker_main.DB_PATH),
            ],
        )

    def test_start_tracking_reports_failure_when_daemon_does_not_start(self) -> None:
        with temp_dir_closing_databases() as tmp:
            tracker_main.DB_PATH = Path(tmp) / "tracker.sqlite3"
            with patch.object(tracker_main, "_process_table", side_effect=[{}, {}]), patch.object(
                tracker_main, "get_status", return_value={"data": {"running": False}}
            ), patch.object(
                tracker_main, "TRACKER_START_TIMEOUT_SECONDS", 0
            ), patch("app.main.time.sleep"), patch("app.main.subprocess.Popen"):
                result = tracker_main.start_tracking()

        self.assertFalse(result["ok"])
        self.assertIs(result["data"]["running"], False)
        self.assertIn("did not start", result["error"])

    def test_tracker_process_ownership_is_unknown_when_ps_fails(self) -> None:
        with patch("app.main.subprocess.run", side_effect=OSError("ps failed")):
            ownership = tracker_main._tracker_process_ownership(12345)

        self.assertEqual(ownership, "unknown")

    def test_tracker_process_ownership_is_unknown_when_ps_returns_empty_output(self) -> None:
        ps_result = MagicMock(returncode=0, stdout=" \n")
        with patch("app.main.subprocess.run", return_value=ps_result):
            ownership = tracker_main._tracker_process_ownership(12345)

        self.assertEqual(ownership, "unknown")

    def test_tracker_process_ownership_preserves_unquoted_database_paths_with_spaces(self) -> None:
        with temp_dir_closing_databases() as tmp:
            db_path = Path(tmp) / "Application Support" / "tracker.sqlite3"
            command = f"{sys.executable} {tracker_main._current_script_path()} daemon --db {db_path}"
            with patch.object(tracker_main, "DB_PATH", db_path), patch.object(
                tracker_main, "_process_command", return_value=command
            ):
                ownership = tracker_main._tracker_process_ownership(12345)

        self.assertEqual(ownership, "tracker")

    def test_cross_runtime_frozen_sidecars_are_recognized_only_for_exact_daemon_db(self) -> None:
        with TemporaryDirectory() as tmp, patch.object(tracker_main, "DB_PATH", Path(tmp) / "tracker.sqlite3"):
            current = f"/Applications/Drifty.app/Contents/MacOS/drifty-tracker daemon --db {tracker_main.DB_PATH}"
            updater = (
                f"/Applications/Drifty.app/Contents/Resources/_up_/drifty-tracker "
                f"daemon --db {tracker_main.DB_PATH}"
            )
            serve = f"/Applications/Drifty.app/Contents/MacOS/drifty-tracker serve --db {tracker_main.DB_PATH}"
            other_db = f"/Applications/Drifty.app/Contents/MacOS/drifty-tracker daemon --db {Path(tmp) / 'other.sqlite3'}"

            matches = tracker_main._matching_tracker_daemon_pids(
                {101: current, 102: updater, 103: serve, 104: other_db, 105: "/usr/bin/sleep 60"}
            )

        self.assertEqual(matches, [101, 102])

    def test_tracker_executable_name_covers_windows_and_macos_packaged_names(self) -> None:
        recognized = [
            "drifty-tracker",
            "drifty-tracker.exe",
            "drifty-tracker-aarch64-apple-darwin",
            "drifty-tracker-x86_64-apple-darwin",
            "drifty-tracker-x86_64-pc-windows-msvc.exe",
            "drifty-tracker-aarch64-pc-windows-msvc.exe",
        ]
        rejected = [
            "drifty-tracker.exe.bak",
            "drifty-trackerx",
            "my-drifty-tracker",
            "drifty-tracker.exe.exe",
        ]
        for name in recognized:
            with self.subTest(name=name):
                self.assertIsNotNone(tracker_main._TRACKER_EXECUTABLE_NAME.fullmatch(name))
        for name in rejected:
            with self.subTest(name=name):
                self.assertIsNone(tracker_main._TRACKER_EXECUTABLE_NAME.fullmatch(name))

    def test_windows_frozen_daemon_command_is_recognized(self) -> None:
        if sys.platform != "win32":
            self.skipTest("Windows path semantics")
        with TemporaryDirectory() as tmp, patch.object(tracker_main, "DB_PATH", Path(tmp) / "tracker.sqlite3"):
            onedir = f"C:\\Users\\alex\\drifty\\drifty-tracker.exe daemon --db {tracker_main.DB_PATH}"
            triple = (
                "C:\\Users\\alex\\drifty\\drifty-tracker-x86_64-pc-windows-msvc.exe "
                f"daemon --db {tracker_main.DB_PATH}"
            )
            matches = tracker_main._matching_tracker_daemon_pids({101: onedir, 102: triple})

        self.assertEqual(matches, [101, 102])

    def test_pid_record_removal_does_not_delete_new_daemon_ownership(self) -> None:
        with TemporaryDirectory() as tmp, patch.object(tracker_main, "DB_PATH", Path(tmp) / "tracker.sqlite3"):
            tracker_main.state_dir().mkdir(parents=True)
            tracker_main.pid_path().write_text("202")

            removed = tracker_main._remove_pid_record_if_owned(101)

            self.assertFalse(removed)
            self.assertEqual(tracker_main.pid_path().read_text(), "202")
            self.assertTrue(tracker_main._remove_pid_record_if_owned(202))
            self.assertFalse(tracker_main.pid_path().exists())

    def test_daemon_lock_allows_only_one_owner_per_tracker_state_directory(self) -> None:
        with TemporaryDirectory() as tmp, patch.object(tracker_main, "DB_PATH", Path(tmp) / "tracker.sqlite3"):
            with tracker_main.tracker_daemon_lock() as first_owner:
                with tracker_main.tracker_daemon_lock() as second_owner:
                    self.assertTrue(first_owner)
                    self.assertFalse(second_owner)

    def test_duplicate_daemon_exits_before_overwriting_pid_record(self) -> None:
        with TemporaryDirectory() as tmp, patch.object(tracker_main, "DB_PATH", Path(tmp) / "tracker.sqlite3"):
            with tracker_main.tracker_daemon_lock() as first_owner, patch.object(
                tracker_main, "database"
            ) as open_database:
                self.assertTrue(first_owner)
                tracker_main.daemon()

            open_database.assert_not_called()
            self.assertFalse(tracker_main.pid_path().exists())

    def test_start_tracking_cleans_unrelated_pid_without_signaling(self) -> None:
        with TemporaryDirectory() as tmp, patch.object(tracker_main, "DB_PATH", Path(tmp) / "tracker.sqlite3"):
            tracker_main.state_dir().mkdir(parents=True)
            pid_file = tracker_main.pid_path()
            pid_file.write_text("12345")

            with patch.object(
                tracker_main, "_process_table", side_effect=[{12345: "/usr/bin/sleep 60"}, {}]
            ), patch("app.main.os.kill") as kill, patch.object(tracker_main, "_process_exists", return_value=True), patch("app.main.time.sleep"), patch(
                "app.main.subprocess.Popen"
            ) as popen, patch.object(
                tracker_main, "get_status", return_value={"data": {"running": True}}
            ):
                result = tracker_main.start_tracking()

            self.assertTrue(result["ok"])
            kill.assert_not_called()
            self.assertFalse(pid_file.exists())
            popen.assert_called_once()

    def test_stop_tracking_preserves_pid_when_process_inspection_fails(self) -> None:
        with TemporaryDirectory() as tmp, patch.object(tracker_main, "DB_PATH", Path(tmp) / "tracker.sqlite3"):
            tracker_main.state_dir().mkdir(parents=True)
            pid_file = tracker_main.pid_path()
            pid_file.write_text("12345")

            with patch.object(tracker_main, "_process_table", return_value=None), patch(
                "app.main.os.kill"
            ) as kill, patch.object(tracker_main, "_process_exists", return_value=True), patch.object(tracker_main, "get_status", return_value={"data": {"running": False}}):
                result = tracker_main.stop_tracking()

            self.assertFalse(result["ok"])
            self.assertIn("Unable to inspect", result["error"])
            kill.assert_not_called()
            self.assertTrue(pid_file.exists())

    def test_start_tracking_preserves_pid_when_process_inspection_fails(self) -> None:
        with TemporaryDirectory() as tmp, patch.object(tracker_main, "DB_PATH", Path(tmp) / "tracker.sqlite3"):
            tracker_main.state_dir().mkdir(parents=True)
            pid_file = tracker_main.pid_path()
            pid_file.write_text("12345")

            with patch.object(tracker_main, "_process_table", return_value=None), patch.object(
                tracker_main, "get_status", return_value={"data": {"running": True}}
            ), patch("app.main.subprocess.Popen") as popen, patch("app.main.os.kill") as kill, patch.object(tracker_main, "_process_exists", return_value=True):
                result = tracker_main.start_tracking()

            self.assertFalse(result["ok"])
            self.assertIn("refusing to start a second daemon", result["error"])
            self.assertTrue(pid_file.exists())
            popen.assert_not_called()
            kill.assert_not_called()

    def test_stop_tracking_does_not_signal_tracker_for_another_database(self) -> None:
        with temp_dir_closing_databases() as tmp, patch.object(tracker_main, "DB_PATH", Path(tmp) / "tracker.sqlite3"):
            tracker_main.state_dir().mkdir(parents=True)
            pid_file = tracker_main.pid_path()
            pid_file.write_text("12345")
            other_db = Path(tmp) / "other.sqlite3"
            command = f"{sys.executable} {tracker_main._current_script_path()} daemon --db {other_db}"

            with patch.object(tracker_main, "_process_table", side_effect=[{12345: command}, {}]), patch(
                "app.main.os.kill"
            ) as kill, patch.object(tracker_main, "_process_exists", return_value=True), patch.object(
                tracker_main, "get_status", return_value={"data": {"running": False}}
            ):
                result = tracker_main.stop_tracking()

            self.assertTrue(result["ok"])
            kill.assert_not_called()
            self.assertFalse(pid_file.exists())

    @patch("app.main.sys.platform", "darwin")
    def test_stop_tracking_signals_verified_tracker_daemon(self) -> None:
        with temp_dir_closing_databases() as tmp, patch.object(tracker_main, "DB_PATH", Path(tmp) / "tracker.sqlite3"):
            tracker_main.state_dir().mkdir(parents=True)
            pid_file = tracker_main.pid_path()
            pid_file.write_text("12345")
            command = f"{sys.executable} {tracker_main._current_script_path()} daemon --db {tracker_main.DB_PATH}"

            with patch.object(tracker_main, "_process_table", side_effect=[{12345: command}, {}]), patch.object(
                tracker_main, "_process_command", return_value=command
            ), patch.object(tracker_main, "_wait_for_process_exit", return_value=True), patch(
                "app.main.os.kill"
            ) as kill, patch.object(tracker_main, "_process_exists", return_value=True), patch.object(tracker_main, "get_status", return_value={"data": {"running": False}}):
                result = tracker_main.stop_tracking()

            self.assertTrue(result["ok"])
            # os.kill(pid, 0) is the POSIX liveness probe and is not used on
            # Windows, so only the termination signal is asserted here.
            self.assertIn(call(12345, tracker_main.signal.SIGTERM), kill.call_args_list)
            self.assertFalse(pid_file.exists())

    @patch("app.main.sys.platform", "darwin")
    def test_stop_tracking_refreshes_a_process_table_cached_before_daemon_start(self) -> None:
        with temp_dir_closing_databases() as tmp, patch.object(tracker_main, "DB_PATH", Path(tmp) / "tracker.sqlite3"):
            tracker_main.state_dir().mkdir(parents=True)
            pid_file = tracker_main.pid_path()
            pid_file.write_text("12345")
            command = f"{sys.executable} {tracker_main._current_script_path()} daemon --db {tracker_main.DB_PATH}"
            # Start has just returned running from the pid/liveness probe, but
            # CIM still holds the empty pre-spawn process table for 0.75s.
            cached_table: dict[int, str] = {}
            fresh_tables = iter([{12345: command}, {}])

            def invalidate_cache() -> None:
                nonlocal cached_table
                cached_table = next(fresh_tables)

            with patch.object(tracker_main, "_process_table", side_effect=lambda: cached_table), patch.object(
                tracker_main, "_invalidate_process_table", side_effect=invalidate_cache
            ) as invalidate, patch.object(
                tracker_main, "_process_command", return_value=command
            ), patch.object(tracker_main, "_process_exists", return_value=True), patch.object(
                tracker_main, "_wait_for_process_exit", return_value=True
            ), patch("app.main.os.kill") as kill, patch.object(
                tracker_main, "get_status", return_value={"data": {"running": False}}
            ):
                result = tracker_main.stop_tracking()

            self.assertTrue(result["ok"])
            self.assertEqual(invalidate.call_count, 2)
            kill.assert_called_once_with(12345, tracker_main.signal.SIGTERM)
            self.assertFalse(pid_file.exists())

    def test_stop_tracking_clears_active_passive_diagnostics_after_confirmed_exit(self) -> None:
        with temp_dir_closing_databases() as tmp:
            db_path = Path(tmp) / "tracker.sqlite3"
            db = TrackerDatabase(db_path)
            db.set_meta(tracker_main.PASSIVE_AUDIO_LAST_SUPPORTED_AT_META_KEY, "2026-04-06T09:05:00+00:00")
            db.set_meta("foreground_audio_detection_available", "true")
            db.set_meta("foreground_audio_active", "true")
            db.set_meta("foreground_audio_reason", "active_output_owned_by_frontmost")
            db.set_meta("passive_lease_remaining_seconds", "1200")

            with patch.object(tracker_main, "DB_PATH", db_path), patch.object(
                tracker_main, "database", return_value=db
            ), patch.object(
                tracker_main, "_process_table", side_effect=[{}, {}]
            ), patch.object(
                tracker_main, "get_status", return_value={"data": {"running": False}}
            ):
                result = tracker_main.stop_tracking()

            self.assertTrue(result["ok"])
            self.assertEqual(db.get_meta(tracker_main.PASSIVE_AUDIO_LAST_SUPPORTED_AT_META_KEY), "")
            self.assertEqual(db.get_meta("foreground_audio_detection_available"), "false")
            self.assertEqual(db.get_meta("foreground_audio_active"), "false")
            self.assertEqual(db.get_meta("foreground_audio_reason"), "tracking_stopped")
            self.assertEqual(db.get_meta("passive_lease_remaining_seconds"), "")

    @patch("app.main.sys.platform", "darwin")
    def test_stop_tracking_finds_live_same_db_daemon_without_pid_record(self) -> None:
        with temp_dir_closing_databases() as tmp, patch.object(tracker_main, "DB_PATH", Path(tmp) / "tracker.sqlite3"):
            command = f"{sys.executable} {tracker_main._current_script_path()} daemon --db {tracker_main.DB_PATH}"
            with patch.object(tracker_main, "_process_table", side_effect=[{301: command}, {}]), patch.object(
                tracker_main, "_process_command", return_value=command
            ), patch.object(tracker_main, "_wait_for_process_exit", return_value=True), patch(
                "app.main.os.kill"
            ) as kill, patch.object(tracker_main, "_process_exists", return_value=True), patch.object(tracker_main, "get_status", return_value={"data": {"running": False}}):
                result = tracker_main.stop_tracking()

            self.assertTrue(result["ok"])
            # os.kill(pid, 0) is the POSIX liveness probe and is not used
            # on Windows, so only the termination signal is asserted.
            self.assertIn(call(301, tracker_main.signal.SIGTERM), kill.call_args_list)

    @patch("app.main.sys.platform", "darwin")
    def test_stop_tracking_stops_every_duplicate_same_db_daemon(self) -> None:
        with temp_dir_closing_databases() as tmp, patch.object(tracker_main, "DB_PATH", Path(tmp) / "tracker.sqlite3"):
            first = f"/Applications/Drifty.app/Contents/MacOS/drifty-tracker daemon --db {tracker_main.DB_PATH}"
            second = f"/tmp/old/Drifty.app/Contents/MacOS/drifty-tracker daemon --db {tracker_main.DB_PATH}"
            commands = {401: first, 402: second}
            with patch.object(tracker_main, "_process_table", side_effect=[commands, {}]), patch.object(
                tracker_main, "_process_command", side_effect=lambda pid: commands[pid]
            ), patch.object(tracker_main, "_wait_for_process_exit", return_value=True), patch(
                "app.main.os.kill"
            ) as kill, patch.object(tracker_main, "_process_exists", return_value=True), patch.object(tracker_main, "get_status", return_value={"data": {"running": False}}):
                result = tracker_main.stop_tracking()

            self.assertTrue(result["ok"])
            # os.kill(pid, 0) is the POSIX liveness probe and is not used on
            # Windows; every duplicate must still be signalled, in order.
            self.assertEqual(
                [c for c in kill.call_args_list if c.args[1] == tracker_main.signal.SIGTERM],
                [
                    call(401, tracker_main.signal.SIGTERM),
                    call(402, tracker_main.signal.SIGTERM),
                ],
            )

    @patch("app.main.sys.platform", "darwin")
    def test_stop_tracking_reports_failure_when_daemon_does_not_exit(self) -> None:
        with TemporaryDirectory() as tmp, patch.object(tracker_main, "DB_PATH", Path(tmp) / "tracker.sqlite3"):
            tracker_main.state_dir().mkdir(parents=True)
            tracker_main.pid_path().write_text("501")
            command = f"{sys.executable} {tracker_main._current_script_path()} daemon --db {tracker_main.DB_PATH}"
            with patch.object(tracker_main, "_process_table", return_value={501: command}), patch.object(
                tracker_main, "_process_command", return_value=command
            ), patch.object(tracker_main, "_wait_for_process_exit", return_value=False), patch(
                "app.main.os.kill"
            ) as kill, patch.object(tracker_main, "_process_exists", return_value=True), patch.object(tracker_main, "get_status", return_value={"data": {"running": True}}):
                result = tracker_main.stop_tracking()

            self.assertFalse(result["ok"])
            self.assertIn("did not exit after SIGTERM", result["error"])
            self.assertTrue(tracker_main.pid_path().exists())
            # os.kill(pid, 0) is the POSIX liveness probe and is not used
            # on Windows, so only the termination signal is asserted.
            self.assertIn(call(501, tracker_main.signal.SIGTERM), kill.call_args_list)

    @patch("app.main.sys.platform", "darwin")
    def test_stop_verified_daemon_accepts_kill_race_only_after_confirmed_exit(self) -> None:
        with TemporaryDirectory() as tmp, patch.object(tracker_main, "DB_PATH", Path(tmp) / "tracker.sqlite3"):
            tracker_main.state_dir().mkdir(parents=True)
            tracker_main.pid_path().write_text("501")
            command = f"{sys.executable} {tracker_main._current_script_path()} daemon --db {tracker_main.DB_PATH}"
            with patch.object(tracker_main, "_process_exists", side_effect=[True, False]), patch.object(
                tracker_main, "_process_command", return_value=command
            ), patch("app.main.os.kill", side_effect=PermissionError("process exited during kill")):
                ownership = tracker_main._stop_verified_tracker_daemon(501)

            self.assertEqual(ownership, "tracker")
            self.assertFalse(tracker_main.pid_path().exists())

    @patch("app.main.sys.platform", "darwin")
    def test_stop_verified_daemon_preserves_live_process_permission_failure(self) -> None:
        with TemporaryDirectory() as tmp, patch.object(tracker_main, "DB_PATH", Path(tmp) / "tracker.sqlite3"):
            tracker_main.state_dir().mkdir(parents=True)
            tracker_main.pid_path().write_text("501")
            command = f"{sys.executable} {tracker_main._current_script_path()} daemon --db {tracker_main.DB_PATH}"
            with patch.object(tracker_main, "_process_exists", side_effect=[True, True]), patch.object(
                tracker_main, "_process_command", return_value=command
            ), patch("app.main.os.kill", side_effect=PermissionError("access denied")):
                with self.assertRaises(PermissionError):
                    tracker_main._stop_verified_tracker_daemon(501)

            self.assertTrue(tracker_main.pid_path().exists())

    def test_stop_tracking_reaps_actual_duplicate_temp_daemons_without_pid_record(self) -> None:
        processes: list[subprocess.Popen] = []
        with temp_dir_closing_databases() as tmp:
            root = Path(tmp)
            db_path = root / "tracker.sqlite3"
            for runtime_name in ("runtime-a", "runtime-b"):
                script = root / runtime_name / "services" / "tracker-python" / "app" / "main.py"
                script.parent.mkdir(parents=True)
                script.write_text("import time\nwhile True:\n    time.sleep(60)\n")
                processes.append(
                    subprocess.Popen(
                        [sys.executable, str(script), "daemon", "--db", str(db_path)],
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                    )
                )

            try:
                deadline = time.monotonic() + 3
                discovered: list[int] = []
                with patch.object(tracker_main, "DB_PATH", db_path):
                    while time.monotonic() < deadline:
                        process_table = tracker_main._process_table()
                        if process_table is not None:
                            discovered = tracker_main._matching_tracker_daemon_pids(process_table)
                        if {process.pid for process in processes}.issubset(discovered):
                            break
                        time.sleep(0.02)

                    spawned_pids = {process.pid for process in processes}
                    # A Windows venv executable can remain as a launcher while
                    # the base interpreter runs the same command line. CIM then
                    # reports two matching PIDs for one Popen handle. The
                    # lifecycle contract is that every daemon we spawned is
                    # discovered and every same-DB runtime is reaped, not that
                    # one command line always maps to exactly one process.
                    self.assertTrue(spawned_pids.issubset(discovered))
                    self.assertFalse(tracker_main.pid_path().exists())
                    with patch.object(tracker_main, "get_status", return_value={"data": {"running": False}}):
                        result = tracker_main.stop_tracking()

                    self.assertTrue(result["ok"], result)
                    self.assertFalse(tracker_main.pid_path().exists())
                    remaining_table = tracker_main._process_table()
                    self.assertIsNotNone(remaining_table)
                    self.assertEqual(tracker_main._matching_tracker_daemon_pids(remaining_table or {}), [])
            finally:
                for process in processes:
                    if process.poll() is None:
                        process.terminate()
                        process.wait(timeout=3)

    def test_start_tracking_cleans_missing_pid_record_without_signaling(self) -> None:
        with TemporaryDirectory() as tmp, patch.object(tracker_main, "DB_PATH", Path(tmp) / "tracker.sqlite3"):
            tracker_main.state_dir().mkdir(parents=True)
            pid_file = tracker_main.pid_path()
            pid_file.write_text("12345")

            with patch.object(tracker_main, "_process_table", side_effect=[{}, {}]), patch(
                "app.main.os.kill"
            ) as kill, patch.object(tracker_main, "_process_exists", return_value=True), patch("app.main.time.sleep"), patch("app.main.subprocess.Popen") as popen, patch.object(
                tracker_main, "get_status", return_value={"data": {"running": True}}
            ):
                result = tracker_main.start_tracking()

            self.assertTrue(result["ok"])
            kill.assert_not_called()
            self.assertFalse(pid_file.exists())
            popen.assert_called_once()

    @patch("app.main.sys.platform", "darwin")
    def test_start_tracking_replaces_source_daemon_when_current_runtime_is_frozen(self) -> None:
        with temp_dir_closing_databases() as tmp:
            tracker_main.DB_PATH = Path(tmp) / "tracker.sqlite3"
            tracker_main.state_dir().mkdir(parents=True)
            tracker_main.pid_path().write_text("12345")
            source_command = f"/usr/bin/python3 {tracker_main._current_script_path()} daemon --db {tracker_main.DB_PATH}"

            with patch.object(sys, "frozen", True, create=True), patch.object(
                sys, "executable", "/Applications/Drifty.app/Contents/MacOS/drifty-tracker"
            ), patch.object(tracker_main, "_process_table", side_effect=[{12345: source_command}, {}]), patch.object(
                tracker_main, "_process_command", return_value=source_command
            ), patch.object(tracker_main, "_wait_for_process_exit", return_value=True), patch(
                "app.main.os.kill"
            ) as kill, patch.object(tracker_main, "_process_exists", return_value=True), patch("app.main.time.sleep"), patch(
                "app.main.subprocess.Popen"
            ) as popen, patch.object(
                tracker_main, "get_status", return_value={"data": {"running": True}}
            ):
                tracker_main.start_tracking()

        # os.kill(pid, 0) is the POSIX liveness probe and is not used
        # on Windows, so only the termination signal is asserted.
        self.assertIn(call(12345, tracker_main.signal.SIGTERM), kill.call_args_list)
        self.assertEqual(
            popen.call_args.args[0],
            [
                "/Applications/Drifty.app/Contents/MacOS/drifty-tracker",
                "daemon",
                "--db",
                str(tracker_main.DB_PATH),
            ],
        )

    @patch("app.main.sys.platform", "darwin")
    def test_start_tracking_replaces_cross_runtime_daemon_without_pid_record(self) -> None:
        with temp_dir_closing_databases() as tmp:
            tracker_main.DB_PATH = Path(tmp) / "tracker.sqlite3"
            old_command = f"/tmp/old/Drifty.app/Contents/MacOS/drifty-tracker daemon --db {tracker_main.DB_PATH}"

            with patch.object(sys, "frozen", True, create=True), patch.object(
                sys, "executable", "/Applications/Drifty.app/Contents/MacOS/drifty-tracker"
            ), patch.object(tracker_main, "_process_table", side_effect=[{22345: old_command}, {}]), patch.object(
                tracker_main, "_process_command", return_value=old_command
            ), patch.object(tracker_main, "_wait_for_process_exit", return_value=True), patch(
                "app.main.os.kill"
            ) as kill, patch.object(tracker_main, "_process_exists", return_value=True), patch("app.main.time.sleep"), patch("app.main.subprocess.Popen") as popen, patch.object(
                tracker_main, "get_status", return_value={"data": {"running": True}}
            ):
                result = tracker_main.start_tracking()

            self.assertTrue(result["ok"])
            # os.kill(pid, 0) is the POSIX liveness probe and is not used
            # on Windows, so only the termination signal is asserted.
            self.assertIn(call(22345, tracker_main.signal.SIGTERM), kill.call_args_list)
            popen.assert_called_once()

    def test_start_tracking_recognizes_current_frozen_sidecar_daemon(self) -> None:
        with temp_dir_closing_databases() as tmp:
            tracker_main.DB_PATH = Path(tmp) / "tracker.sqlite3"
            tracker_main.state_dir().mkdir(parents=True)
            tracker_main.pid_path().write_text("12345")
            mock_db = MagicMock()
            mock_db.get_meta.return_value = "same-runtime"
            sidecar_command = f"/Applications/Drifty.app/Contents/MacOS/drifty-tracker daemon --db {tracker_main.DB_PATH}"

            with patch.object(sys, "frozen", True, create=True), patch.object(
                sys, "executable", "/Applications/Drifty.app/Contents/MacOS/drifty-tracker"
            ), patch.object(tracker_main, "_process_table", return_value={12345: sidecar_command}), patch.object(
                tracker_main, "_process_command", return_value=sidecar_command
            ), patch.object(tracker_main, "database", return_value=mock_db), patch.object(
                tracker_main, "_tracker_runtime_fingerprint", return_value="same-runtime"
            ), patch("app.main.os.kill") as kill, patch.object(tracker_main, "_process_exists", return_value=True), patch("app.main.subprocess.Popen") as popen, patch.object(
                tracker_main, "get_status", return_value={"data": {"running": True}}
            ):
                result = tracker_main.start_tracking()

        self.assertTrue(result["ok"])
        mock_db.get_meta.assert_called_once_with(tracker_main.TRACKER_RUNTIME_FINGERPRINT_META_KEY)
        kill.assert_not_called()
        popen.assert_not_called()

    @patch("app.main.sys.platform", "darwin")
    def test_start_tracking_replaces_stale_packaged_daemon(self) -> None:
        with temp_dir_closing_databases() as tmp:
            tracker_main.DB_PATH = Path(tmp) / "tracker.sqlite3"
            state_dir = tracker_main.state_dir()
            state_dir.mkdir(parents=True)
            tracker_main.pid_path().write_text("12345")
            stale_command = f"/Applications/Drifty.app/Contents/Resources/_up_/services/tracker-python/app/main.py daemon --db {tracker_main.DB_PATH}"
            with patch.object(tracker_main, "_process_table", side_effect=[{12345: stale_command}, {}]), patch.object(
                tracker_main, "_process_command", return_value=stale_command
            ), patch.object(tracker_main, "_wait_for_process_exit", return_value=True), patch(
                "app.main.os.kill"
            ) as kill, patch.object(tracker_main, "_process_exists", return_value=True), patch("app.main.time.sleep"), patch(
                "app.main.subprocess.Popen"
            ) as popen, patch.object(tracker_main, "get_status", return_value={"data": {"running": True}}):
                tracker_main.start_tracking()

        # os.kill(pid, 0) is the POSIX liveness probe and is not used
        # on Windows, so only the termination signal is asserted.
        self.assertIn(call(12345, tracker_main.signal.SIGTERM), kill.call_args_list)
        popen.assert_called_once()

    @patch("app.main.sys.platform", "darwin")
    def test_start_tracking_replaces_same_path_daemon_when_runtime_fingerprint_differs(self) -> None:
        with temp_dir_closing_databases() as tmp:
            tracker_main.DB_PATH = Path(tmp) / "tracker.sqlite3"
            tracker_main.state_dir().mkdir(parents=True)
            tracker_main.pid_path().write_text("12345")
            mock_db = MagicMock()
            mock_db.get_meta.return_value = "old-runtime"
            current_command = f"{sys.executable} {tracker_main._current_script_path()} daemon --db {tracker_main.DB_PATH}"

            with patch.object(tracker_main, "_process_table", side_effect=[{12345: current_command}, {}]), patch.object(
                tracker_main, "_process_command", return_value=current_command
            ), patch.object(
                tracker_main, "database", return_value=mock_db
            ), patch.object(
                tracker_main, "_tracker_runtime_fingerprint", return_value="new-runtime"
            ), patch.object(tracker_main, "_wait_for_process_exit", return_value=True), patch(
                "app.main.os.kill"
            ) as kill, patch.object(tracker_main, "_process_exists", return_value=True), patch("app.main.time.sleep"), patch(
                "app.main.subprocess.Popen"
            ) as popen, patch.object(tracker_main, "get_status", return_value={"data": {"running": True}}):
                tracker_main.start_tracking()

        mock_db.get_meta.assert_called_once_with(tracker_main.TRACKER_RUNTIME_FINGERPRINT_META_KEY)
        # os.kill(pid, 0) is the POSIX liveness probe and is not used
        # on Windows, so only the termination signal is asserted.
        self.assertIn(call(12345, tracker_main.signal.SIGTERM), kill.call_args_list)
        popen.assert_called_once()

    def test_start_recovery_rejects_a_same_path_daemon_from_an_old_runtime(self) -> None:
        with temp_dir_closing_databases() as tmp:
            tracker_main.DB_PATH = Path(tmp) / "tracker.sqlite3"
            command = f"{sys.executable} {tracker_main._current_script_path()} daemon --db {tracker_main.DB_PATH}"
            mock_db = MagicMock()
            with patch.object(tracker_main, "_process_table", return_value={12345: command}), patch.object(
                tracker_main, "_process_command", return_value=command
            ), patch.object(tracker_main, "database", return_value=mock_db), patch.object(
                tracker_main, "_tracker_runtime_fingerprint", return_value="new-runtime"
            ):
                mock_db.get_meta.return_value = "old-runtime"
                self.assertFalse(tracker_main.verify_current_runtime_running()["data"])
                mock_db.get_meta.return_value = "new-runtime"
                self.assertTrue(tracker_main.verify_current_runtime_running()["data"])

                with patch.object(tracker_main, "_process_table", return_value={12345: command, 12346: command}):
                    self.assertFalse(tracker_main.verify_current_runtime_running()["data"])

    def test_start_recovery_requires_a_live_daemon_for_the_current_database(self) -> None:
        with temp_dir_closing_databases() as tmp:
            tracker_main.DB_PATH = Path(tmp) / "tracker.sqlite3"
            other_db = Path(tmp) / "other.sqlite3"
            current_command = f"{sys.executable} {tracker_main._current_script_path()} daemon --db {tracker_main.DB_PATH}"
            other_db_command = f"{sys.executable} {tracker_main._current_script_path()} daemon --db {other_db}"
            old_script = Path(tmp) / "old" / "services" / "tracker-python" / "app" / "main.py"
            old_script_command = f"{sys.executable} {old_script} daemon --db {tracker_main.DB_PATH}"
            mock_db = MagicMock()
            mock_db.get_meta.return_value = "current-runtime"

            for processes in (None, {}, {12345: other_db_command}, {12345: old_script_command}):
                with self.subTest(processes=processes), patch.object(
                    tracker_main, "_process_table", return_value=processes
                ), patch.object(tracker_main, "_process_command", side_effect=lambda pid: processes[pid] if processes else None), patch.object(
                    tracker_main, "database", return_value=mock_db
                ), patch.object(tracker_main, "_tracker_runtime_fingerprint", return_value="current-runtime"):
                    self.assertFalse(tracker_main.verify_current_runtime_running()["data"])

            with patch.object(tracker_main, "_process_table", return_value={12345: current_command}), patch.object(
                tracker_main, "_process_command", return_value=current_command
            ), patch.object(tracker_main, "database", return_value=mock_db), patch.object(
                tracker_main, "_tracker_runtime_fingerprint", return_value="current-runtime"
            ):
                self.assertTrue(tracker_main.verify_current_runtime_running()["data"])

    def test_start_tracking_keeps_same_path_daemon_when_runtime_fingerprint_matches(self) -> None:
        with temp_dir_closing_databases() as tmp:
            tracker_main.DB_PATH = Path(tmp) / "tracker.sqlite3"
            tracker_main.state_dir().mkdir(parents=True)
            tracker_main.pid_path().write_text("12345")
            mock_db = MagicMock()
            mock_db.get_meta.return_value = "same-runtime"
            current_command = f"{sys.executable} {tracker_main._current_script_path()} daemon --db {tracker_main.DB_PATH}"

            with patch.object(tracker_main, "_process_table", return_value={12345: current_command}), patch.object(
                tracker_main, "_process_command", return_value=current_command
            ), patch.object(tracker_main, "database", return_value=mock_db), patch.object(
                tracker_main, "_tracker_runtime_fingerprint", return_value="same-runtime"
            ), patch("app.main.os.kill") as kill, patch.object(tracker_main, "_process_exists", return_value=True), patch("app.main.subprocess.Popen") as popen, patch.object(
                tracker_main, "get_status", return_value={"data": {"running": True}}
            ):
                result = tracker_main.start_tracking()

        self.assertTrue(result["ok"])
        mock_db.get_meta.assert_called_once_with(tracker_main.TRACKER_RUNTIME_FINGERPRINT_META_KEY)
        kill.assert_not_called()
        popen.assert_not_called()

    def test_frozen_runtime_fingerprint_changes_with_executable_bytes(self) -> None:
        with temp_dir_closing_databases() as tmp:
            executable = Path(tmp) / "drifty-tracker"
            executable.write_bytes(b"sidecar-v1")

            with patch.object(sys, "frozen", True, create=True), patch.object(sys, "executable", str(executable)):
                first = tracker_main._tracker_runtime_fingerprint()
                expected = hashlib.sha256(
                    b"frozen\0" + str(executable).encode("utf-8") + b"\0" + b"sidecar-v1"
                ).hexdigest()
                executable.write_bytes(b"sidecar-v2")
                second = tracker_main._tracker_runtime_fingerprint()

        self.assertEqual(first, expected)
        self.assertNotEqual(first, second)

    def test_frozen_runtime_fingerprint_uses_stat_fallback_when_executable_read_fails(self) -> None:
        with temp_dir_closing_databases() as tmp:
            executable = Path(tmp) / "drifty-tracker"
            executable.write_bytes(b"sidecar")

            with patch.object(sys, "frozen", True, create=True), patch.object(
                sys, "executable", str(executable)
            ), patch("pathlib.Path.read_bytes", side_effect=OSError("denied")):
                fingerprint = tracker_main._tracker_runtime_fingerprint()
                executable_stat = executable.stat()
                expected = hashlib.sha256(
                    b"frozen\0"
                    + str(executable).encode("utf-8")
                    + b"\0"
                    + b"read-error:OSError\0"
                    + f"{executable_stat.st_size}:{executable_stat.st_mtime_ns}".encode("utf-8")
                ).hexdigest()

        self.assertEqual(fingerprint, expected)

    def test_source_runtime_fingerprint_hashes_python_sources(self) -> None:
        with temp_dir_closing_databases() as tmp:
            app_dir = Path(tmp)
            source_file = app_dir / "main.py"
            nested_source = app_dir / "tracker" / "monitor.py"
            ignored_source = app_dir / "__pycache__" / "main.py"
            nested_source.parent.mkdir()
            ignored_source.parent.mkdir()
            source_file.write_bytes(b"print('main')\n")
            nested_source.write_bytes(b"print('monitor')\n")
            ignored_source.write_bytes(b"print('ignored')\n")
            non_python = app_dir / "README.md"
            non_python.write_text("ignored")

            expected_digest = hashlib.sha256()
            expected_digest.update(b"source\0")
            for path in [source_file, nested_source]:
                expected_digest.update(str(path.relative_to(app_dir)).encode("utf-8"))
                expected_digest.update(b"\0")
                expected_digest.update(path.read_bytes())
                expected_digest.update(b"\0")

            with patch.object(sys, "frozen", False, create=True), patch.object(tracker_main, "APP_DIR", app_dir):
                first = tracker_main._tracker_runtime_fingerprint()
                ignored_source.write_bytes(b"ignored change")
                second = tracker_main._tracker_runtime_fingerprint()
                nested_source.write_bytes(b"print('changed')\n")
                third = tracker_main._tracker_runtime_fingerprint()

        self.assertEqual(first, expected_digest.hexdigest())
        self.assertEqual(first, second)
        self.assertNotEqual(first, third)

    def test_get_current_snapshot_returns_camel_case_payload_without_recording(self) -> None:
        snapshot = Snapshot(
            observed_at="2026-04-06T09:00:00+00:00",
            app_name="cmux",
            bundle_id="dev.cmux",
            window_title="workspace",
            source="accessibility",
            browser_automation_status="not_applicable",
            browser_history_status="no_readable_database",
            browser_history_reason="missing_database",
            browser_history_database_found=False,
            browser_history_profile_count=0,
            browser_history_candidate_count=0,
            browser_history_error_count=0,
        )

        with patch.object(tracker_main, "current_snapshot", return_value=snapshot):
            result = tracker_main.get_current_snapshot()

        self.assertTrue(result["ok"])
        self.assertEqual(result["data"]["observedAt"], snapshot.observed_at)
        self.assertEqual(result["data"]["appName"], "cmux")
        self.assertEqual(result["data"]["bundleId"], "dev.cmux")
        self.assertEqual(result["data"]["browserAutomationStatus"], "not_applicable")
        self.assertIsNone(result["data"]["browserAutomationError"])
        self.assertEqual(result["data"]["browserHistoryStatus"], "no_readable_database")
        self.assertEqual(result["data"]["browserHistoryReason"], "missing_database")
        self.assertFalse(result["data"]["browserHistoryDatabaseFound"])
        self.assertEqual(result["data"]["browserHistoryProfileCount"], 0)
        self.assertEqual(result["data"]["browserHistoryCandidateCount"], 0)
        self.assertEqual(result["data"]["browserHistoryErrorCount"], 0)

    def test_get_current_snapshot_treats_failed_windows_capture_as_a_gap(self) -> None:
        failed = build_windows_snapshot(None, None, "2026-04-06T09:00:00+00:00")
        with temp_dir_closing_databases() as tmp:
            db_path = Path(tmp) / "tracker.sqlite3"
            with patch.object(tracker_main, "DB_PATH", db_path), patch.object(
                tracker_main, "current_snapshot", return_value=failed
            ):
                result = tracker_main.get_current_snapshot()

            self.assertTrue(result["ok"])
            self.assertIsNone(result["data"])
            self.assertFalse(db_path.exists())

    def test_get_current_snapshot_preserves_macos_failed_capture_response(self) -> None:
        captured = Snapshot(
            observed_at="2026-04-06T09:00:00+00:00",
            app_name="Unavailable",
            bundle_id=None,
            window_title=None,
            source="nsworkspace",
            frontmost_capture_source="unavailable",
        )
        with temp_dir_closing_databases() as tmp:
            with patch.object(tracker_main, "DB_PATH", Path(tmp) / "tracker.sqlite3"), patch.object(
                tracker_main, "current_snapshot", return_value=captured
            ):
                result = tracker_main.get_current_snapshot()

        self.assertEqual(result["data"]["appName"], "Unavailable")
        self.assertEqual(result["data"]["source"], "nsworkspace")

    def test_get_current_snapshot_keeps_a_real_unavailable_named_app(self) -> None:
        for capture_source in (None, "win32-foreground"):
            with self.subTest(capture_source=capture_source):
                captured = Snapshot(
                    observed_at="2026-04-06T09:00:00+00:00",
                    app_name="Unavailable",
                    bundle_id=None,
                    window_title=None,
                    source="win32-foreground-untitled",
                    frontmost_capture_source=capture_source,
                )
                with temp_dir_closing_databases() as tmp:
                    with patch.object(tracker_main, "DB_PATH", Path(tmp) / "tracker.sqlite3"), patch.object(
                        tracker_main, "current_snapshot", return_value=captured
                    ):
                        result = tracker_main.get_current_snapshot()

                self.assertEqual(result["data"]["appName"], "Unavailable")
                self.assertEqual(result["data"]["frontmostCaptureSource"], capture_source)

    def test_get_current_snapshot_does_not_initialize_missing_database(self) -> None:
        snapshot = Snapshot(
            observed_at="2026-04-06T09:00:00+00:00",
            app_name="cmux",
            bundle_id="dev.cmux",
            window_title="workspace",
            source="accessibility",
            browser_automation_status="not_applicable",
        )

        with temp_dir_closing_databases() as tmp:
            db_path = Path(tmp) / "tracker.sqlite3"
            with patch.object(tracker_main, "DB_PATH", db_path), patch.object(
                tracker_main, "current_snapshot", return_value=snapshot
            ), patch.dict(tracker_main.os.environ, {}, clear=True):
                result = tracker_main.get_current_snapshot()

                self.assertTrue(result["ok"])
                self.assertFalse(db_path.exists())
                self.assertEqual(tracker_main.os.environ[tracker_main.FORCE_CHROMIUM_AX_CAPTURE_ENV], "0")
                self.assertEqual(tracker_main.os.environ[tracker_main.FORCE_FRONTMOST_FALLBACK_CAPTURE_ENV], "0")
                self.assertEqual(tracker_main.os.environ[tracker_main.FORCE_BROWSER_HISTORY_URL_FALLBACK_ENV], "0")

    def test_get_timeline_uses_day_filter(self) -> None:
        mock_db = MagicMock()
        mock_db.fetch_timeline.return_value = []
        with patch.object(tracker_main, "database", return_value=mock_db):
            tracker_main.get_timeline({"day": "2026-04-06"})
        mock_db.fetch_timeline.assert_called_once_with("2026-04-06")

    def test_get_timeline_uses_range_filter(self) -> None:
        mock_db = MagicMock()
        mock_db.timeline.return_value = []
        with patch.object(tracker_main, "database", return_value=mock_db):
            tracker_main.get_timeline({"start": "2026-04-01T00:00:00", "end": "2026-04-07T23:59:59"})
        mock_db.timeline.assert_called_once_with("2026-04-01T00:00:00", "2026-04-07T23:59:59")

    def test_get_timeline_page_forwards_range_cursor_and_limit(self) -> None:
        mock_db = MagicMock()
        mock_db.timeline_page.return_value = {
            "items": [{"id": "42"}],
            "hasMore": True,
            "nextCursor": {
                "beforeEndedAt": "2026-04-06T09:05:00+00:00",
                "beforeSegmentId": "42",
            },
        }

        with patch.object(tracker_main, "database", return_value=mock_db):
            result = tracker_main.get_timeline_page({
                "start": "2026-04-01T00:00:00",
                "end": "2026-04-07T23:59:59",
                "beforeEndedAt": "2026-04-06T09:05:00+00:00",
                "beforeSegmentId": "42",
                "limit": 200,
            })

        self.assertTrue(result["ok"])
        self.assertEqual(result["data"]["items"], [{"id": "42"}])
        mock_db.timeline_page.assert_called_once_with(
            start="2026-04-01T00:00:00",
            end="2026-04-07T23:59:59",
            before_ended_at="2026-04-06T09:05:00+00:00",
            before_segment_id="42",
            limit=200,
        )

    def test_search_timeline_forwards_query_range_cursor_and_limit(self) -> None:
        mock_db = MagicMock()
        mock_db.search_timeline_page.return_value = {
            "items": [{"id": "42"}],
            "hasMore": True,
            "nextCursor": {
                "beforeEndedAt": "2026-04-06T09:05:00+00:00",
                "beforeSegmentId": "42",
            },
        }

        with patch.object(tracker_main, "database", return_value=mock_db):
            result = tracker_main.search_timeline({
                "query": "arc project",
                "start": "2026-04-01T00:00:00",
                "end": "2026-04-07T23:59:59",
                "beforeEndedAt": "2026-04-06T09:05:00+00:00",
                "beforeSegmentId": "42",
                "limit": 200,
            })

        self.assertTrue(result["ok"])
        self.assertEqual(result["data"]["items"], [{"id": "42"}])
        mock_db.search_timeline_page.assert_called_once_with(
            query="arc project",
            start="2026-04-01T00:00:00",
            end="2026-04-07T23:59:59",
            before_ended_at="2026-04-06T09:05:00+00:00",
            before_segment_id="42",
            limit=200,
        )

    def test_search_timeline_rejects_non_dict_selector(self) -> None:
        mock_db = MagicMock()

        with patch.object(tracker_main, "database", return_value=mock_db):
            result = tracker_main.search_timeline("not a payload")

        self.assertFalse(result["ok"])
        self.assertIsNone(result["data"])
        mock_db.search_timeline_page.assert_not_called()

    def test_timeline_page_accepts_day_selector(self) -> None:
        mock_db = MagicMock()
        mock_db.timeline_page.return_value = {"items": [], "hasMore": False, "nextCursor": None}

        with patch.object(tracker_main, "database", return_value=mock_db):
            result = tracker_main.get_timeline_page({"day": "2026-04-06"})

        self.assertTrue(result["ok"])
        mock_db.timeline_page.assert_called_once_with(
            start="2026-04-06T00:00:00",
            end="2026-04-06T23:59:59",
            before_ended_at=None,
            before_segment_id=None,
            limit=None,
        )

    def test_search_timeline_accepts_day_selector(self) -> None:
        mock_db = MagicMock()
        mock_db.search_timeline_page.return_value = {"items": [], "hasMore": False, "nextCursor": None}

        with patch.object(tracker_main, "database", return_value=mock_db):
            result = tracker_main.search_timeline({"query": "arc project", "day": "2026-04-06"})

        self.assertTrue(result["ok"])
        mock_db.search_timeline_page.assert_called_once_with(
            query="arc project",
            start="2026-04-06T00:00:00",
            end="2026-04-06T23:59:59",
            before_ended_at=None,
            before_segment_id=None,
            limit=None,
        )

    def test_timeline_page_rejects_empty_partial_and_mixed_selectors(self) -> None:
        for payload in (
            {},
            {"start": "2026-04-01T00:00:00"},
            {"end": "2026-04-07T23:59:59"},
            {
                "day": "2026-04-06",
                "start": "2026-04-01T00:00:00",
                "end": "2026-04-07T23:59:59",
            },
        ):
            with self.subTest(payload=payload):
                mock_db = MagicMock()
                with patch.object(tracker_main, "database", return_value=mock_db):
                    result = tracker_main.get_timeline_page(payload)

                self.assertFalse(result["ok"])
                self.assertIsNone(result["data"])
                mock_db.timeline_page.assert_not_called()

    def test_get_unclassified_segments_omitting_segment_ids_preserves_existing_behavior(self) -> None:
        mock_db = MagicMock()
        segments = [{"id": "segment-1"}, {"id": "segment-2"}]
        mock_db.fetch_unclassified_segments.return_value = segments

        with patch.object(tracker_main, "database", return_value=mock_db):
            result = tracker_main.get_unclassified_segments({})

        self.assertTrue(result["ok"])
        self.assertEqual(result["data"], segments)
        mock_db.fetch_unclassified_segments.assert_called_once_with(None, None, 50, None)

    def test_get_unclassified_segments_filters_to_requested_segment_ids(self) -> None:
        mock_db = MagicMock()
        mock_db.fetch_unclassified_segments.return_value = [{"id": "segment-2"}]

        with patch.object(tracker_main, "database", return_value=mock_db):
            result = tracker_main.get_unclassified_segments({
                "limit": 20,
                "segmentIds": ["segment-2", "unknown-segment"],
            })

        self.assertTrue(result["ok"])
        self.assertEqual(result["data"], [{"id": "segment-2"}])
        mock_db.fetch_unclassified_segments.assert_called_once_with(
            None,
            None,
            20,
            {"segment-2", "unknown-segment"},
        )

    def test_get_unclassified_segments_returns_no_segments_for_empty_segment_ids(self) -> None:
        mock_db = MagicMock()

        with patch.object(tracker_main, "database", return_value=mock_db):
            result = tracker_main.get_unclassified_segments({"segmentIds": []})

        self.assertTrue(result["ok"])
        self.assertEqual(result["data"], [])
        mock_db.fetch_unclassified_segments.assert_not_called()

    def test_get_unclassified_segments_rejects_invalid_segment_ids(self) -> None:
        for payload in (
            {"segmentIds": "segment-1"},
            {"segmentIds": ["segment-1", 2]},
        ):
            with self.subTest(payload=payload):
                mock_db = MagicMock()
                with patch.object(tracker_main, "database", return_value=mock_db):
                    result = tracker_main.get_unclassified_segments(payload)

                self.assertFalse(result["ok"])
                self.assertIsNone(result["data"])
                mock_db.fetch_unclassified_segments.assert_not_called()

    def test_get_dashboard_week_timeline_uses_compact_range_filter(self) -> None:
        mock_db = MagicMock()
        mock_db.dashboard_week_timeline.return_value = []
        mock_db.timeline.side_effect = AssertionError("dashboard week should use compact timeline")

        with patch.object(tracker_main, "database", return_value=mock_db):
            result = tracker_main.get_dashboard_week_timeline({
                "start": "2026-04-01T00:00:00",
                "end": "2026-04-07T23:59:59",
            })

        self.assertTrue(result["ok"])
        mock_db.dashboard_week_timeline.assert_called_once_with("2026-04-01T00:00:00", "2026-04-07T23:59:59")
        mock_db.timeline.assert_not_called()

    def test_get_project_trend_timeline_uses_slim_query(self) -> None:
        mock_db = MagicMock()
        mock_db.project_trend_timeline.return_value = []
        mock_db.timeline.side_effect = AssertionError("project trend should use the slim timeline")

        with patch.object(tracker_main, "database", return_value=mock_db):
            result = tracker_main.get_project_trend_timeline({
                "start": "2026-04-01T00:00:00",
                "end": "2026-04-07T23:59:59",
            })

        self.assertTrue(result["ok"])
        mock_db.project_trend_timeline.assert_called_once_with("2026-04-01T00:00:00", "2026-04-07T23:59:59")
        mock_db.timeline.assert_not_called()

    def test_get_live_tail_reads_database_tail_without_snapshot_capture(self) -> None:
        mock_db = MagicMock()
        mock_db.get_meta.side_effect = lambda key, default=None: {
            "tracker_mode": "tracking",
            "last_event_at": "2026-04-06T09:10:00+00:00",
        }.get(key, default)

        with patch.object(tracker_main, "database", return_value=mock_db), patch.object(
            tracker_main, "fetch_live_tail", return_value=[{"id": "42"}]
        ) as fetch, patch.object(tracker_main, "is_running", return_value=True), patch.object(
            tracker_main, "current_snapshot"
        ) as snapshot:
            result = tracker_main.get_live_tail({
                "start": "2026-04-06T00:00:00",
                "end": "2026-04-06T23:59:59",
                "afterSegmentId": "42",
                "afterEndedAt": "2026-04-06T09:05:00+00:00",
                "limit": 8,
            })

        self.assertTrue(result["ok"])
        self.assertTrue(result["data"]["running"])
        self.assertEqual(result["data"]["trackerMode"], "tracking")
        self.assertEqual(result["data"]["lastEventAt"], "2026-04-06T09:10:00+00:00")
        self.assertEqual(result["data"]["segments"], [{"id": "42"}])
        fetch.assert_called_once_with(
            mock_db,
            "2026-04-06T00:00:00",
            "2026-04-06T23:59:59",
            "42",
            "2026-04-06T09:05:00+00:00",
            8,
        )
        snapshot.assert_not_called()

    def test_fetch_live_tail_returns_updated_cursor_segment(self) -> None:
        with temp_dir_closing_databases() as tmp:
            db = TrackerDatabase(Path(tmp) / "tracker.sqlite3")
            with db.connect() as conn:
                conn.execute(
                    """
                    INSERT INTO activity_segments(
                      started_at, ended_at, duration_seconds, app_name, platform, source
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    ("2026-04-06T09:00:00+00:00", "2026-04-06T09:05:00+00:00", 300, "Mail", "macos", "accessibility"),
                )
                conn.execute(
                    """
                    INSERT INTO activity_segments(
                      started_at, ended_at, duration_seconds, app_name, platform, source
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    ("2026-04-06T09:05:00+00:00", "2026-04-06T09:10:00+00:00", 300, "Drifty", "macos", "accessibility"),
                )

            rows = fetch_live_tail(
                db,
                "2026-04-06T00:00:00+00:00",
                "2026-04-06T23:59:59+00:00",
                "2",
                "2026-04-06T09:09:00+00:00",
                8,
            )

        self.assertEqual([row["id"] for row in rows], ["2"])
        self.assertEqual(rows[0]["appName"], "Drifty")

    def test_get_top_sites_uses_range_aggregate(self) -> None:
        mock_db = MagicMock()
        mock_db.top_sites.return_value = []
        mock_db.timeline.side_effect = AssertionError("range top sites should aggregate in SQL")

        with patch.object(tracker_main, "database", return_value=mock_db):
            result = tracker_main.get_top_sites({
                "start": "2026-04-01T00:00:00",
                "end": "2026-04-07T23:59:59",
                "limit": 8,
            })

        self.assertTrue(result["ok"])
        mock_db.top_sites.assert_called_once_with("2026-04-01T00:00:00", "2026-04-07T23:59:59", 8)
        mock_db.timeline.assert_not_called()

    def test_get_reusable_ai_classifications_returns_json_serializable_mapping(self) -> None:
        mock_db = MagicMock()
        mock_db.get_reusable_ai_classifications.return_value = {
            "fp-one": {
                "segmentId": "1",
                "inputFingerprint": "fp-one",
                "category": "workspace",
                "productivity": "focus",
                "source": "llm",
                "confidence": 0.9,
                "reason": "Prior result",
                "aiResult": True,
                "stale": False,
            }
        }

        with patch.object(tracker_main, "database", return_value=mock_db):
            result = tracker_main.get_reusable_ai_classifications({"inputFingerprints": ["fp-one", 3, "fp-two"]})

        self.assertTrue(result["ok"])
        self.assertEqual(result["data"]["fp-one"]["segmentId"], "1")
        mock_db.get_reusable_ai_classifications.assert_called_once_with(["fp-one", "fp-two"])

    def test_save_classifications_command_reports_late_automatic_write_as_not_saved(self) -> None:
        with temp_dir_closing_databases() as tmp:
            db = TrackerDatabase(Path(tmp) / "tracker.sqlite3")
            db.record_snapshot(
                Snapshot(
                    observed_at="2026-04-06T09:00:00+00:00",
                    app_name="QA Activity",
                    bundle_id="so.drifty.qa",
                    window_title="Manual classification race",
                    source="accessibility",
                ),
                5,
            )
            segment_id = db.fetch_timeline("2026-04-06")[0]["id"]

            with patch.object(tracker_main, "database", return_value=db):
                manual_result = tracker_main.save_classifications({
                    "classifications": [{
                        "segmentId": segment_id,
                        "category": "learning",
                        "productivity": "focus",
                        "source": "manual",
                        "confidence": 1,
                    }]
                })
                late_result = tracker_main.save_classifications({
                    "classifications": [{
                        "segmentId": segment_id,
                        "category": "utility",
                        "productivity": "drift",
                        "source": "llm",
                        "confidence": 0.9,
                        "aiResult": True,
                    }]
                })

            self.assertEqual(manual_result["data"]["saved"], 1)
            self.assertEqual(late_result["data"]["saved"], 0)
            classification = db.fetch_timeline("2026-04-06")[0]["classification"]
            self.assertEqual(classification["category"], "learning")
            self.assertEqual(classification["productivity"], "focus")
            self.assertEqual(classification["source"], "manual")

    def test_classification_rule_handlers_forward_to_database(self) -> None:
        mock_db = MagicMock()
        mock_db.get_classification_rules.return_value = []
        mock_db.save_classification_rule.return_value = {"id": "rule-1"}
        mock_db.delete_classification_rule.return_value = 1
        mock_db.search_classification_rule_candidates.return_value = [{"id": "app:Linear"}]
        mock_db.apply_classification_rules.return_value = {"matchedCount": 1, "appliedCount": 1, "skippedCount": 0}

        with patch.object(tracker_main, "database", return_value=mock_db):
            rules = tracker_main.get_classification_rules({})
            saved = tracker_main.save_classification_rule({"input": {"targetKind": "app", "targetValue": "Linear"}})
            deleted = tracker_main.delete_classification_rule({"id": "rule-1"})
            candidates = tracker_main.search_classification_rule_candidates({"query": "lin", "targetKind": "app"})
            applied = tracker_main.apply_classification_rules({"start": "2026-04-06T00:00:00", "end": "2026-04-07T00:00:00"})

        self.assertTrue(rules["ok"])
        self.assertEqual(saved["data"]["id"], "rule-1")
        self.assertEqual(deleted["data"]["deleted"], 1)
        self.assertEqual(candidates["data"][0]["id"], "app:Linear")
        self.assertEqual(applied["data"]["appliedCount"], 1)
        mock_db.save_classification_rule.assert_called_once_with({"targetKind": "app", "targetValue": "Linear"})
        mock_db.delete_classification_rule.assert_called_once_with("rule-1")
        mock_db.search_classification_rule_candidates.assert_called_once_with("lin", target_kind="app")
        mock_db.apply_classification_rules.assert_called_once_with("2026-04-06T00:00:00", "2026-04-07T00:00:00")

    def test_set_developer_diagnostics_persists_frontmost_fallback_capture_flag(self) -> None:
        mock_db = MagicMock()

        with patch.object(tracker_main, "database", return_value=mock_db), patch.object(
            developer_diagnostics, "apply_developer_diagnostics_env"
        ) as apply_env:
            result = tracker_main.set_developer_diagnostics({
                "forceChromiumAxCapture": True,
                "forceFrontmostFallbackCapture": True,
                "forceBrowserHistoryUrlFallback": True,
                "enhancedContextEnabled": True,
                "enhancedContextCaptureLocal": False,
                "enhancedContextSourceFamilies": ["document_knowledge", "calendar_meeting"],
            })

        self.assertTrue(result["ok"])
        self.assertEqual(
            result["data"],
            {
                "forceChromiumAxCapture": True,
                "forceFrontmostFallbackCapture": True,
                "forceBrowserHistoryUrlFallback": True,
                "enhancedContextEnabled": True,
                "enhancedContextCaptureLocal": False,
                "enhancedContextSourceFamilies": ["document_knowledge", "calendar_meeting"],
            },
        )
        mock_db.set_meta.assert_any_call(tracker_main.FORCE_CHROMIUM_AX_CAPTURE_META_KEY, "true")
        mock_db.set_meta.assert_any_call(tracker_main.FORCE_FRONTMOST_FALLBACK_CAPTURE_META_KEY, "true")
        mock_db.set_meta.assert_any_call(tracker_main.FORCE_BROWSER_HISTORY_URL_FALLBACK_META_KEY, "true")
        mock_db.set_meta.assert_any_call(tracker_main.ENHANCED_CONTEXT_ENABLED_META_KEY, "true")
        mock_db.set_meta.assert_any_call(tracker_main.ENHANCED_CONTEXT_CAPTURE_LOCAL_META_KEY, "false")
        mock_db.set_meta.assert_any_call(
            tracker_main.ENHANCED_CONTEXT_SOURCE_FAMILIES_META_KEY,
            "document_knowledge,calendar_meeting",
        )
        apply_env.assert_called_once_with(mock_db)

    def test_apply_developer_diagnostics_env_sets_frontmost_fallback_capture_env(self) -> None:
        mock_db = MagicMock()
        mock_db.get_meta.side_effect = lambda key, default=None: {
            tracker_main.FORCE_CHROMIUM_AX_CAPTURE_META_KEY: "false",
            tracker_main.FORCE_FRONTMOST_FALLBACK_CAPTURE_META_KEY: "true",
            tracker_main.FORCE_BROWSER_HISTORY_URL_FALLBACK_META_KEY: "true",
        }.get(key, default)

        with patch.dict(tracker_main.os.environ, {}, clear=True):
            tracker_main._apply_developer_diagnostics_env(mock_db)

            self.assertEqual(tracker_main.os.environ[tracker_main.FORCE_CHROMIUM_AX_CAPTURE_ENV], "0")
            self.assertEqual(tracker_main.os.environ[tracker_main.FORCE_FRONTMOST_FALLBACK_CAPTURE_ENV], "1")
            self.assertEqual(tracker_main.os.environ[tracker_main.FORCE_BROWSER_HISTORY_URL_FALLBACK_ENV], "1")
            self.assertEqual(tracker_main.os.environ[tracker_main.ENABLE_ADAPTIVE_CONTEXT_CAPTURE_ENV], "0")
            self.assertEqual(tracker_main.os.environ[tracker_main.ADAPTIVE_CONTEXT_SOURCE_FAMILIES_ENV], "")

    def test_apply_developer_diagnostics_env_sets_enhanced_context_capture_env(self) -> None:
        mock_db = MagicMock()
        mock_db.get_meta.side_effect = lambda key, default=None: {
            tracker_main.ENHANCED_CONTEXT_ENABLED_META_KEY: "true",
            tracker_main.ENHANCED_CONTEXT_CAPTURE_LOCAL_META_KEY: "true",
            tracker_main.ENHANCED_CONTEXT_SOURCE_FAMILIES_META_KEY: "document_knowledge,unknown,calendar_meeting",
        }.get(key, default)

        with patch.dict(tracker_main.os.environ, {}, clear=True):
            tracker_main._apply_developer_diagnostics_env(mock_db)

            self.assertEqual(tracker_main.os.environ[tracker_main.ENABLE_ADAPTIVE_CONTEXT_CAPTURE_ENV], "1")
            self.assertEqual(
                tracker_main.os.environ[tracker_main.ADAPTIVE_CONTEXT_SOURCE_FAMILIES_ENV],
                "document_knowledge,calendar_meeting",
            )

    def test_delete_activity_segments_forwards_string_ids_to_database(self) -> None:
        mock_db = MagicMock()
        mock_db.delete_activity_segments.return_value = 2

        with patch.object(tracker_main, "database", return_value=mock_db):
            result = tracker_main.delete_activity_segments({"ids": ["1", 2, "3", None]})

        self.assertTrue(result["ok"])
        self.assertEqual(result["data"]["deleted"], 2)
        mock_db.delete_activity_segments.assert_called_once_with(["1", "3"])

    def test_delete_history_range_forwards_payload_to_database(self) -> None:
        mock_db = MagicMock()
        mock_db.delete_history_range.return_value = {
            "activitySegments": 3,
            "classifications": 2,
            "youtubeMetadata": 1,
            "dryRun": True,
        }

        with patch.object(tracker_main, "database", return_value=mock_db):
            result = tracker_main.delete_history_range(
                {
                    "start": "2026-04-01",
                    "end": "2026-04-06",
                    "scopes": {"activity": True, "aiClassifications": False, "youtubeMetadata": True},
                    "dryRun": True,
                }
            )

        self.assertTrue(result["ok"])
        self.assertEqual(
            result["data"],
            {"activitySegments": 3, "classifications": 2, "youtubeMetadata": 1, "dryRun": True},
        )
        mock_db.delete_history_range.assert_called_once_with(
            start="2026-04-01",
            end="2026-04-06",
            scopes={"activity": True, "aiClassifications": False, "youtubeMetadata": True},
            dry_run=True,
        )

    def test_delete_history_range_defaults_to_all_time_real_delete(self) -> None:
        mock_db = MagicMock()
        mock_db.delete_history_range.return_value = {
            "activitySegments": 0,
            "classifications": 0,
            "youtubeMetadata": 0,
            "dryRun": False,
        }

        with patch.object(tracker_main, "database", return_value=mock_db):
            result = tracker_main.delete_history_range(
                {"scopes": {"activity": True, "aiClassifications": True, "youtubeMetadata": True}}
            )

        self.assertTrue(result["ok"])
        mock_db.delete_history_range.assert_called_once_with(
            start=None,
            end=None,
            scopes={"activity": True, "aiClassifications": True, "youtubeMetadata": True},
            dry_run=False,
        )

    def test_delete_history_range_requires_scopes_object(self) -> None:
        mock_db = MagicMock()

        with patch.object(tracker_main, "database", return_value=mock_db):
            result = tracker_main.delete_history_range({"start": "2026-04-01"})

        self.assertFalse(result["ok"])
        mock_db.delete_history_range.assert_not_called()

    def test_handle_power_state_sample_trims_and_skips_when_suppressed(self) -> None:
        mock_db = MagicMock()
        observed_at = datetime(2026, 4, 6, 9, 5, tzinfo=timezone.utc)
        power_state = PowerStateSample(
            observed_at=observed_at,
            should_capture=False,
            reason="non_user_visible_wake_type:darkwake",
        )

        should_skip = tracker_main.handle_power_state_sample(mock_db, power_state)

        self.assertTrue(should_skip)
        mock_db.trim_latest_segment.assert_called_once_with(observed_at.isoformat())
        mock_db.set_meta.assert_any_call(tracker_main.PASSIVE_AUDIO_LAST_SUPPORTED_AT_META_KEY, "")
        mock_db.set_meta.assert_any_call("foreground_audio_detection_available", "false")
        mock_db.set_meta.assert_any_call("foreground_audio_active", "false")
        mock_db.set_meta.assert_any_call("foreground_audio_reason", "power_suppressed")
        mock_db.set_meta.assert_any_call("passive_lease_remaining_seconds", "")
        mock_db.set_meta.assert_any_call("tracker_mode", "suppressed")
        mock_db.set_meta.assert_any_call("capture_suppressed_reason", "non_user_visible_wake_type:darkwake")
        mock_db.set_meta.assert_any_call("last_capture_suppressed_at", observed_at.isoformat())

    def test_handle_power_state_sample_keeps_tracking_when_capture_allowed(self) -> None:
        mock_db = MagicMock()
        power_state = PowerStateSample(
            observed_at=datetime(2026, 4, 6, 9, 5, tzinfo=timezone.utc),
            should_capture=True,
            reason="active_power_state",
        )

        should_skip = tracker_main.handle_power_state_sample(mock_db, power_state)

        self.assertFalse(should_skip)
        mock_db.trim_latest_segment.assert_not_called()
        mock_db.set_meta.assert_not_called()

    def test_sample_seconds_since_previous_uses_default_for_first_capture(self) -> None:
        self.assertEqual(tracker_main.sample_seconds_since_previous(None, 12.0, default_seconds=5), 5)

    def test_sample_seconds_since_previous_accounts_for_delayed_loop(self) -> None:
        self.assertEqual(tracker_main.sample_seconds_since_previous(10.0, 17.4, default_seconds=5), 7)

    def test_sample_seconds_since_previous_keeps_minimum_interval(self) -> None:
        self.assertEqual(tracker_main.sample_seconds_since_previous(10.0, 12.0, default_seconds=5), 5)

    def test_audio_grace_is_bounded_and_rejects_future_or_invalid_timestamps(self) -> None:
        now = datetime(2026, 4, 6, 9, 5, tzinfo=timezone.utc)
        offset_timestamp = (now - timedelta(seconds=10)).astimezone(
            timezone(timedelta(hours=9))
        ).isoformat()

        self.assertTrue(tracker_main.audio_grace_is_active((now - timedelta(seconds=15)).isoformat(), now))
        self.assertTrue(tracker_main.audio_grace_is_active(offset_timestamp, now))
        self.assertFalse(tracker_main.audio_grace_is_active((now - timedelta(seconds=15.001)).isoformat(), now))
        self.assertFalse(tracker_main.audio_grace_is_active((now + timedelta(seconds=1)).isoformat(), now))
        self.assertFalse(tracker_main.audio_grace_is_active("2026-04-06T09:04:50", now))
        self.assertFalse(tracker_main.audio_grace_is_active("invalid", now))

    def test_engagement_decision_uses_foreground_audio_inside_lease(self) -> None:
        mock_db = MagicMock()
        mock_db.latest_local_engagement_evidence.return_value = None
        sample = ForegroundAudioSample(True, True, "active_output_owned_by_frontmost")
        now = datetime(2026, 4, 6, 9, 5, tzinfo=timezone.utc)

        with patch.object(tracker_main, "current_foreground_audio_sample", return_value=sample):
            decision = tracker_main.engagement_decision_for_tick(mock_db, 300, now=now)

        self.assertEqual(decision.kind, "capture_passive")
        mock_db.set_meta.assert_any_call("passive_lease_remaining_seconds", "1500")
        mock_db.set_meta.assert_any_call("foreground_audio_active", "true")
        mock_db.set_meta.assert_any_call(
            tracker_main.PASSIVE_AUDIO_LAST_SUPPORTED_AT_META_KEY,
            now.isoformat(),
        )

    def test_engagement_decision_does_not_probe_during_interactive_input_window(self) -> None:
        mock_db = MagicMock()

        with patch.object(tracker_main, "current_foreground_audio_sample") as audio_probe:
            decision = tracker_main.engagement_decision_for_tick(mock_db, 179.999)

        self.assertEqual(decision.kind, "capture_interactive")
        audio_probe.assert_not_called()
        mock_db.latest_local_engagement_evidence.assert_not_called()
        mock_db.set_meta.assert_any_call("idle_detection_available", "true")
        mock_db.set_meta.assert_any_call("idle_seconds", "179.999")
        mock_db.set_meta.assert_any_call(tracker_main.PASSIVE_AUDIO_LAST_SUPPORTED_AT_META_KEY, "")
        mock_db.set_meta.assert_any_call("foreground_audio_reason", "interactive_input")
        mock_db.set_meta.assert_any_call("passive_lease_remaining_seconds", "")

    def test_engagement_decision_preserves_capture_when_idle_detection_is_unavailable(self) -> None:
        mock_db = MagicMock()

        with patch.object(tracker_main, "current_foreground_audio_sample") as audio_probe:
            decision = tracker_main.engagement_decision_for_tick(mock_db, None)

        self.assertEqual(decision.kind, "capture_interactive")
        audio_probe.assert_not_called()
        mock_db.latest_local_engagement_evidence.assert_not_called()
        mock_db.set_meta.assert_any_call("idle_detection_available", "false")
        mock_db.set_meta.assert_any_call(tracker_main.PASSIVE_AUDIO_LAST_SUPPORTED_AT_META_KEY, "")
        mock_db.set_meta.assert_any_call("foreground_audio_reason", "idle_detection_unavailable")
        mock_db.set_meta.assert_any_call("passive_lease_remaining_seconds", "")

    def test_engagement_decision_contains_unexpected_audio_probe_failure(self) -> None:
        mock_db = MagicMock()
        mock_db.latest_local_engagement_evidence.return_value = None
        mock_db.get_meta.return_value = None

        with patch.object(
            tracker_main,
            "current_foreground_audio_sample",
            side_effect=ImportError("missing packaged module"),
        ):
            decision = tracker_main.engagement_decision_for_tick(mock_db, 300)

        self.assertEqual(decision.kind, "stop_and_trim_to_input")
        mock_db.set_meta.assert_any_call("foreground_audio_detection_available", "false")
        mock_db.set_meta.assert_any_call("foreground_audio_active", "false")
        mock_db.set_meta.assert_any_call("foreground_audio_reason", "probe_failed")

    def test_unexpected_audio_probe_failure_does_not_use_dropout_grace(self) -> None:
        mock_db = MagicMock()
        mock_db.latest_local_engagement_evidence.return_value = "foreground-audio"
        now = datetime(2026, 4, 6, 9, 5, tzinfo=timezone.utc)
        mock_db.get_meta.return_value = (now - timedelta(seconds=5)).isoformat()

        with patch.object(
            tracker_main,
            "current_foreground_audio_sample",
            side_effect=RuntimeError("unexpected HAL failure"),
        ):
            decision = tracker_main.engagement_decision_for_tick(mock_db, 300, now=now)

        self.assertEqual(decision.kind, "stop_and_keep_recorded")
        mock_db.get_meta.assert_not_called()

    def test_engagement_decision_limits_audio_dropout_grace_to_fifteen_seconds(self) -> None:
        mock_db = MagicMock()
        mock_db.latest_local_engagement_evidence.return_value = "foreground-audio"
        now = datetime(2026, 4, 6, 9, 5, tzinfo=timezone.utc)
        mock_db.get_meta.return_value = (now - timedelta(seconds=15)).isoformat()
        sample = ForegroundAudioSample(True, False, "no_active_output")

        with patch.object(tracker_main, "current_foreground_audio_sample", return_value=sample):
            within_grace = tracker_main.engagement_decision_for_tick(mock_db, 300, now=now)
            after_grace = tracker_main.engagement_decision_for_tick(
                mock_db,
                300,
                now=now + timedelta(milliseconds=1),
            )

        self.assertEqual(within_grace.kind, "capture_passive")
        self.assertEqual(after_grace.kind, "stop_and_keep_recorded")

    def test_engagement_decision_refuses_audio_grace_without_recorded_passive_time(self) -> None:
        mock_db = MagicMock()
        mock_db.latest_local_engagement_evidence.return_value = None
        now = datetime(2026, 4, 6, 9, 5, tzinfo=timezone.utc)
        mock_db.get_meta.return_value = (now - timedelta(seconds=5)).isoformat()
        sample = ForegroundAudioSample(True, False, "no_active_output")

        with patch.object(tracker_main, "current_foreground_audio_sample", return_value=sample):
            decision = tracker_main.engagement_decision_for_tick(mock_db, 300, now=now)

        self.assertEqual(decision.kind, "stop_and_trim_to_input")

    def test_engagement_decision_refuses_grace_when_output_belongs_to_another_app(self) -> None:
        mock_db = MagicMock()
        mock_db.latest_local_engagement_evidence.return_value = "foreground-audio"
        now = datetime(2026, 4, 6, 9, 5, tzinfo=timezone.utc)
        mock_db.get_meta.return_value = (now - timedelta(seconds=5)).isoformat()
        sample = ForegroundAudioSample(True, False, "active_output_not_owned_by_frontmost")

        with patch.object(tracker_main, "current_foreground_audio_sample", return_value=sample):
            decision = tracker_main.engagement_decision_for_tick(mock_db, 300, now=now)

        self.assertEqual(decision.kind, "stop_and_keep_recorded")
        mock_db.get_meta.assert_not_called()

    def test_power_suppression_prevents_grace_from_reopening_capture(self) -> None:
        now = datetime(2026, 4, 6, 9, 5, tzinfo=timezone.utc)
        with temp_dir_closing_databases() as tmp:
            db = TrackerDatabase(Path(tmp) / "tracker.sqlite3")
            db.record_snapshot(
                Snapshot(
                    observed_at=(now - timedelta(seconds=10)).isoformat(),
                    app_name="Audio Review",
                    bundle_id="com.example.audio-review",
                    window_title="Review",
                    source="accessibility",
                    engagement_evidence="foreground-audio",
                ),
                5,
            )
            db.set_meta(
                tracker_main.PASSIVE_AUDIO_LAST_SUPPORTED_AT_META_KEY,
                (now - timedelta(seconds=5)).isoformat(),
            )
            tracker_main.handle_power_state_sample(
                db,
                PowerStateSample(
                    observed_at=now - timedelta(seconds=4),
                    should_capture=False,
                    reason="clamshell_sleep_state",
                ),
            )
            sample = ForegroundAudioSample(True, False, "no_active_output")

            with patch.object(tracker_main, "current_foreground_audio_sample", return_value=sample):
                decision = tracker_main.engagement_decision_for_tick(db, 300, now=now)

            self.assertEqual(decision.kind, "stop_and_keep_recorded")
            self.assertEqual(db.get_meta(tracker_main.PASSIVE_AUDIO_LAST_SUPPORTED_AT_META_KEY), "")

    def test_engagement_decision_does_not_probe_or_extend_expired_lease(self) -> None:
        mock_db = MagicMock()
        mock_db.latest_local_engagement_evidence.return_value = "foreground-audio"

        with patch.object(tracker_main, "current_foreground_audio_sample") as audio_probe:
            decision = tracker_main.engagement_decision_for_tick(mock_db, 1800)

        self.assertEqual(decision.kind, "stop_and_keep_recorded")
        audio_probe.assert_not_called()
        mock_db.set_meta.assert_any_call("passive_lease_remaining_seconds", "0")

    def test_engagement_decision_rounds_remaining_lease_up_while_capture_is_valid(self) -> None:
        mock_db = MagicMock()
        mock_db.latest_local_engagement_evidence.return_value = None
        sample = ForegroundAudioSample(True, True, "active_output_owned_by_frontmost")

        with patch.object(tracker_main, "current_foreground_audio_sample", return_value=sample):
            decision = tracker_main.engagement_decision_for_tick(mock_db, 1799.5)

        self.assertEqual(decision.kind, "capture_passive")
        mock_db.set_meta.assert_any_call("passive_lease_remaining_seconds", "1")

    def test_apply_engagement_stop_preserves_supported_time_but_trims_unsupported_idle(self) -> None:
        now = datetime(2026, 4, 6, 9, 5, tzinfo=timezone.utc)
        keep_db = MagicMock()
        trim_db = MagicMock()

        tracker_main.apply_engagement_stop(
            keep_db,
            tracker_main.EngagementDecision("stop_and_keep_recorded"),
            300,
            now=now,
        )
        tracker_main.apply_engagement_stop(
            trim_db,
            tracker_main.EngagementDecision("stop_and_trim_to_input"),
            300,
            now=now,
        )

        keep_db.trim_latest_segment.assert_not_called()
        trim_db.trim_latest_segment.assert_called_once_with((now - timedelta(seconds=300)).isoformat())
        keep_db.set_meta.assert_any_call(tracker_main.PASSIVE_AUDIO_LAST_SUPPORTED_AT_META_KEY, "")
        keep_db.set_meta.assert_any_call("foreground_audio_detection_available", "false")
        keep_db.set_meta.assert_any_call("foreground_audio_active", "false")
        keep_db.set_meta.assert_any_call("foreground_audio_reason", "engagement_stopped")
        keep_db.set_meta.assert_any_call("passive_lease_remaining_seconds", "")
        keep_db.set_meta.assert_any_call("tracker_mode", "idle")
        trim_db.set_meta.assert_any_call(tracker_main.PASSIVE_AUDIO_LAST_SUPPORTED_AT_META_KEY, "")
        trim_db.set_meta.assert_any_call("foreground_audio_detection_available", "false")
        trim_db.set_meta.assert_any_call("foreground_audio_active", "false")
        trim_db.set_meta.assert_any_call("foreground_audio_reason", "engagement_stopped")
        trim_db.set_meta.assert_any_call("passive_lease_remaining_seconds", "")
        trim_db.set_meta.assert_any_call("tracker_mode", "idle")

    @patch("app.main.sys.platform", "darwin")
    def test_daemon_skips_idle_and_snapshot_when_power_state_suppressed(self) -> None:
        with temp_dir_closing_databases() as tmp:
            tracker_main.DB_PATH = Path(tmp) / "tracker.sqlite3"
            mock_db = MagicMock()
            power_state = PowerStateSample(
                observed_at=datetime(2026, 4, 6, 9, 5, tzinfo=timezone.utc),
                should_capture=False,
                reason="non_user_visible_wake_type:darkwake",
            )
            with patch.object(tracker_main, "database", return_value=mock_db), patch.object(
                tracker_main, "current_power_state", return_value=power_state
            ), patch.object(tracker_main, "seconds_since_last_input") as idle, patch.object(
                tracker_main, "current_snapshot"
            ) as snapshot, patch.object(
                tracker_main, "current_foreground_audio_sample"
            ) as audio_probe, patch.object(
                tracker_main.time, "sleep", side_effect=KeyboardInterrupt
            ):
                with self.assertRaises(KeyboardInterrupt):
                    tracker_main.daemon()

        idle.assert_not_called()
        snapshot.assert_not_called()
        audio_probe.assert_not_called()
        mock_db.trim_latest_segment.assert_called_once_with(power_state.observed_at.isoformat())
        mock_db.set_meta.assert_any_call(tracker_main.PASSIVE_AUDIO_LAST_SUPPORTED_AT_META_KEY, "")
        mock_db.set_meta.assert_any_call("tracker_mode", "suppressed")

    @patch("app.main.sys.platform", "darwin")
    def test_daemon_resumes_with_default_sample_after_power_suppression(self) -> None:
        with temp_dir_closing_databases() as tmp:
            tracker_main.DB_PATH = Path(tmp) / "tracker.sqlite3"
            mock_db = MagicMock()
            suppressed = PowerStateSample(
                observed_at=datetime(2026, 4, 6, 9, 5, tzinfo=timezone.utc),
                should_capture=False,
                reason="clamshell_sleep_state",
            )
            active = PowerStateSample(
                observed_at=datetime(2026, 4, 6, 9, 6, tzinfo=timezone.utc),
                should_capture=True,
                reason="active_power_state",
            )
            snapshot = Snapshot(
                observed_at="2026-04-06T09:06:00+00:00",
                app_name="cmux",
                bundle_id="dev.cmux",
                window_title="workspace",
                source="accessibility",
            )
            with patch.object(tracker_main, "database", return_value=mock_db), patch.object(
                tracker_main, "current_power_state", side_effect=[suppressed, active]
            ), patch.object(tracker_main, "seconds_since_last_input", return_value=0.0), patch.object(
                tracker_main, "_apply_developer_diagnostics_env"
            ), patch.object(
                tracker_main, "current_snapshot", return_value=snapshot
            ), patch.object(
                tracker_main.time, "monotonic", return_value=190.0
            ), patch.object(
                tracker_main, "enqueue_youtube_metadata_fetch"
            ), patch.object(
                tracker_main, "backfill_browser_history_context"
            ), patch.object(
                tracker_main.time, "sleep", side_effect=[None, KeyboardInterrupt]
            ):
                with self.assertRaises(KeyboardInterrupt):
                    tracker_main.daemon()

        mock_db.record_snapshot.assert_called_once()
        self.assertEqual(mock_db.record_snapshot.call_args.args[1], tracker_main.SAMPLE_SECONDS)
        mock_db.set_meta.assert_any_call("tracker_mode", "suppressed")
        mock_db.set_meta.assert_any_call("tracker_mode", "tracking")

    def test_daemon_stops_sampling_when_owning_app_exits(self) -> None:
        for platform in ("darwin", "win32"):
            with self.subTest(platform=platform):
                owner = MagicMock()
                owner.is_alive.return_value = True
                owner.wait_until_exit.return_value = True
                owner_context = MagicMock()
                owner_context.__enter__.return_value = owner
                stop_event = MagicMock()
                stop_event.requested.return_value = False
                stop_event.wait.return_value = True
                create_stop_event = MagicMock(return_value=stop_event)
                lock_file = MagicMock()
                with patch.object(tracker_main.sys, "platform", platform), patch.dict(sys.modules, {
                    "app.windows_daemon_shutdown": SimpleNamespace(WindowsDaemonStopEvent=create_stop_event)
                }), patch.object(
                    windows_process_liveness, "tracker_app_owner", return_value=owner_context, create=True
                ), patch.object(tracker_main, "_acquire_tracker_daemon_lock", return_value=lock_file), patch.object(
                    tracker_main, "_release_tracker_daemon_lock"
                ) as release_lock, patch.object(tracker_main, "_write_tracker_pid"), patch.object(
                    tracker_main, "_remove_pid_record_if_owned"
                ) as remove_pid, patch.object(tracker_main, "database", return_value=MagicMock()), patch.object(
                    tracker_main, "_maybe_create_periodic_backup", return_value=0.0
                ), patch.object(tracker_main, "_maybe_ingest_dev_signals", return_value=0.0), patch.object(
                    tracker_main, "_daemon_tick", return_value=1.0
                ) as tick, patch.object(tracker_main, "_close_loaded_windows_capture") as close_capture, patch.object(
                    tracker_main.time, "sleep", side_effect=[None, KeyboardInterrupt]
                ):
                    try:
                        tracker_main.daemon()
                    except KeyboardInterrupt:
                        # Bound the old unowned loop so the regression fails by count,
                        # rather than leaving a real sampling process behind.
                        pass

                tick.assert_called_once()
                if platform == "win32":
                    create_stop_event.assert_called_once_with(tracker_main.DB_PATH)
                    stop_event.wait.assert_called_once_with(tracker_main.SAMPLE_SECONDS, owner=owner)
                    stop_event.close.assert_called_once()
                    owner.wait_until_exit.assert_not_called()
                else:
                    create_stop_event.assert_not_called()
                    owner.wait_until_exit.assert_called_once_with(tracker_main.SAMPLE_SECONDS)
                close_capture.assert_called_once()
                remove_pid.assert_called_once_with(os.getpid())
                release_lock.assert_called_once_with(lock_file)
                owner_context.__exit__.assert_called_once()

    def test_daemon_does_not_start_after_owning_app_has_already_exited(self) -> None:
        owner = MagicMock()
        owner.is_alive.return_value = False
        owner_context = MagicMock()
        owner_context.__enter__.return_value = owner
        with patch.object(
            windows_process_liveness, "tracker_app_owner", return_value=owner_context, create=True
        ), patch.object(tracker_main, "_acquire_tracker_daemon_lock") as acquire_lock, patch.object(
            tracker_main, "_release_tracker_daemon_lock"
        ), patch.object(tracker_main, "_remove_pid_record_if_owned"), patch.object(
            tracker_main, "_write_tracker_pid"
        ) as write_pid, patch.object(tracker_main, "database", return_value=MagicMock()) as open_db, patch.object(
            tracker_main, "_maybe_create_periodic_backup", return_value=0.0
        ), patch.object(tracker_main, "_maybe_ingest_dev_signals", return_value=0.0), patch.object(
            tracker_main, "_daemon_tick"
        ) as tick, patch.object(tracker_main.time, "sleep", side_effect=KeyboardInterrupt):
            try:
                tracker_main.daemon()
            except KeyboardInterrupt:
                pass

        acquire_lock.assert_not_called()
        write_pid.assert_not_called()
        open_db.assert_not_called()
        tick.assert_not_called()
        owner_context.__exit__.assert_called_once()

    def test_daemon_releases_lock_if_owner_exits_during_lock_acquisition(self) -> None:
        owner = MagicMock()
        owner.is_alive.side_effect = [True, False]
        owner_context = MagicMock()
        owner_context.__enter__.return_value = owner
        lock_file = MagicMock()
        with patch.object(
            windows_process_liveness, "tracker_app_owner", return_value=owner_context
        ), patch.object(tracker_main, "_acquire_tracker_daemon_lock", return_value=lock_file), patch.object(
            tracker_main, "_release_tracker_daemon_lock"
        ) as release_lock, patch.object(tracker_main, "database") as open_db:
            tracker_main.daemon()

        release_lock.assert_called_once_with(lock_file)
        open_db.assert_not_called()

    @patch("app.main.sys.platform", "darwin")
    def test_daemon_records_runtime_fingerprint_on_start(self) -> None:
        with temp_dir_closing_databases() as tmp:
            tracker_main.DB_PATH = Path(tmp) / "tracker.sqlite3"
            mock_db = MagicMock()
            power_state = PowerStateSample(
                observed_at=datetime(2026, 4, 6, 9, 5, tzinfo=timezone.utc),
                should_capture=False,
                reason="non_user_visible_wake_type:darkwake",
            )
            with patch.object(tracker_main, "database", return_value=mock_db), patch.object(
                tracker_main, "_tracker_runtime_fingerprint", return_value="runtime-fp"
            ), patch.object(tracker_main, "current_power_state", return_value=power_state), patch.object(
                tracker_main.time, "sleep", side_effect=KeyboardInterrupt
            ):
                with self.assertRaises(KeyboardInterrupt):
                    tracker_main.daemon()

        mock_db.set_meta.assert_any_call(tracker_main.TRACKER_RUNTIME_FINGERPRINT_META_KEY, "runtime-fp")
        mock_db.set_meta.assert_any_call("foreground_audio_detection_available", "false")
        mock_db.set_meta.assert_any_call("foreground_audio_active", "false")
        mock_db.set_meta.assert_any_call("foreground_audio_reason", "daemon_started")
        mock_db.set_meta.assert_any_call("passive_lease_remaining_seconds", "")

    @patch("app.main.sys.platform", "darwin")
    def test_daemon_checks_for_a_due_backup_while_it_remains_running(self) -> None:
        with temp_dir_closing_databases() as tmp:
            tracker_main.DB_PATH = Path(tmp) / "tracker.sqlite3"
            mock_db = MagicMock()
            power_state = PowerStateSample(
                observed_at=datetime(2026, 4, 6, 9, 5, tzinfo=timezone.utc),
                should_capture=False,
                reason="non_user_visible_wake_type:darkwake",
            )
            with patch.object(tracker_main, "database", return_value=mock_db), patch.object(
                tracker_main, "current_power_state", return_value=power_state
            ), patch.object(
                tracker_main.time,
                "time",
                side_effect=[0.0, float(tracker_main.DATABASE_BACKUP_CHECK_SECONDS)],
            ), patch.object(
                tracker_main, "ingest_dev_agent_sessions"
            ), patch.object(
                tracker_main.time, "sleep", side_effect=KeyboardInterrupt
            ):
                with self.assertRaises(KeyboardInterrupt):
                    tracker_main.daemon()

        mock_db.create_periodic_backup.assert_called_once_with()

    @patch("app.main.sys.platform", "darwin")
    def test_daemon_ingests_dev_signals_when_the_window_is_due(self) -> None:
        """Agent turns stay current without opening the Your Agents tab."""
        with temp_dir_closing_databases() as tmp:
            tracker_main.DB_PATH = Path(tmp) / "tracker.sqlite3"
            mock_db = MagicMock()
            power_state = PowerStateSample(
                observed_at=datetime(2026, 4, 6, 9, 5, tzinfo=timezone.utc),
                should_capture=False,
                reason="non_user_visible_wake_type:darkwake",
            )
            with patch.object(tracker_main, "database", return_value=mock_db), patch.object(
                tracker_main, "current_power_state", return_value=power_state
            ), patch.object(
                tracker_main.time,
                "time",
                side_effect=[0.0, float(tracker_main.DEV_SIGNALS_INGEST_INTERVAL_SECONDS)],
            ), patch.object(
                tracker_main, "ingest_dev_agent_sessions"
            ) as ingest_sessions, patch.object(
                tracker_main.time, "sleep", side_effect=KeyboardInterrupt
            ):
                with self.assertRaises(KeyboardInterrupt):
                    tracker_main.daemon()

        ingest_sessions.assert_called_once_with(
            mock_db,
            backfill_days=tracker_main.DEV_SIGNALS_BACKFILL_DAYS,
            max_files=tracker_main.DEV_SIGNALS_DAEMON_MAX_FILES,
        )

    @patch("app.main.sys.platform", "darwin")
    def test_unexpected_periodic_backup_error_does_not_skip_sampling(self) -> None:
        with temp_dir_closing_databases() as tmp:
            tracker_main.DB_PATH = Path(tmp) / "tracker.sqlite3"
            mock_db = MagicMock()
            mock_db.create_periodic_backup.side_effect = RuntimeError("backup bug")
            power_state = PowerStateSample(
                observed_at=datetime(2026, 4, 6, 9, 5, tzinfo=timezone.utc),
                should_capture=False,
                reason="non_user_visible_wake_type:darkwake",
            )
            with patch.object(tracker_main, "database", return_value=mock_db), patch.object(
                tracker_main, "current_power_state", return_value=power_state
            ) as current_power_state, patch.object(
                tracker_main.time,
                "time",
                side_effect=[0.0, float(tracker_main.DATABASE_BACKUP_CHECK_SECONDS)],
            ), patch.object(
                tracker_main, "capture_tracker_exception"
            ) as capture_exception, patch.object(
                tracker_main.sys, "stderr", MagicMock()
            ), patch.object(
                tracker_main, "ingest_dev_agent_sessions"
            ), patch.object(
                tracker_main.time, "sleep", side_effect=KeyboardInterrupt
            ):
                with self.assertRaises(KeyboardInterrupt):
                    tracker_main.daemon()

        current_power_state.assert_called_once_with()
        capture_exception.assert_called_once()
        self.assertEqual(
            capture_exception.call_args.args[1],
            {"phase": "database_periodic_backup"},
        )

    def test_periodic_backup_check_handles_interval_and_clock_correction(self) -> None:
        mock_db = MagicMock()
        interval = float(tracker_main.DATABASE_BACKUP_CHECK_SECONDS)

        self.assertEqual(
            tracker_main._maybe_create_periodic_backup(
                mock_db, 100.0, now_wall_seconds=100.0 + interval - 1
            ),
            100.0,
        )
        mock_db.create_periodic_backup.assert_not_called()

        self.assertEqual(
            tracker_main._maybe_create_periodic_backup(
                mock_db, 100.0, now_wall_seconds=100.0 + interval
            ),
            100.0 + interval,
        )
        mock_db.create_periodic_backup.assert_called_once_with()

        self.assertEqual(
            tracker_main._maybe_create_periodic_backup(
                mock_db, 100.0 + interval, now_wall_seconds=50.0
            ),
            50.0,
        )
        mock_db.create_periodic_backup.assert_called_once_with()

    def test_daemon_tick_leaves_gap_when_foreground_identity_is_unavailable(self) -> None:
        mock_db = MagicMock()
        power_state = PowerStateSample(
            observed_at=datetime(2026, 4, 6, 9, 0, tzinfo=timezone.utc),
            should_capture=True,
            reason="ok",
        )
        snapshot = Snapshot(
            observed_at="2026-04-06T09:00:00+00:00",
            app_name="Unavailable",
            bundle_id=None,
            window_title=None,
            source="unknown",
            frontmost_capture_source="unavailable",
        )
        with patch.object(tracker_main, "current_power_state", return_value=power_state), patch.object(
            tracker_main, "seconds_since_last_input", return_value=0.0
        ), patch.object(tracker_main, "_apply_developer_diagnostics_env"), patch.object(
            tracker_main, "current_snapshot", return_value=snapshot
        ), patch.object(tracker_main, "enqueue_youtube_metadata_fetch") as metadata_fetch, patch.object(
            tracker_main, "backfill_browser_history_context"
        ) as history_backfill:
            next_tick = tracker_main._daemon_tick(mock_db, 37.0)

        self.assertIsNone(next_tick)
        mock_db.record_snapshot.assert_not_called()
        metadata_fetch.assert_not_called()
        history_backfill.assert_not_called()
        self.assertNotIn(call("last_event_at", snapshot.observed_at), mock_db.set_meta.call_args_list)

    def test_daemon_tick_bounds_windows_sampling_gaps_in_stored_activity(self) -> None:
        cases = (
            ("win32", 7.4, 7, 1),
            ("win32", 10.0, 10, 1),
            ("win32", 10.1, 5, 2),
            ("win32", 13.0, 5, 2),
            ("win32", 1800.0, 5, 2),
            ("darwin", 1800.0, 1800, 2),
        )
        for platform, elapsed, credited_seconds, row_count in cases:
            with self.subTest(platform=platform, elapsed=elapsed):
                self._assert_stored_sampling_interval(
                    platform, elapsed, credited_seconds, row_count, passive=False
                )

    def test_daemon_tick_does_not_bridge_passive_audio_across_windows_sampling_gap(self) -> None:
        self._assert_stored_sampling_interval("win32", 13.0, 5, 2, passive=True)

    def _assert_stored_sampling_interval(
        self, platform: str, elapsed: float, credited_seconds: int, row_count: int, *, passive: bool
    ) -> None:
        started = datetime(2026, 4, 6, 9, 0, tzinfo=timezone.utc)
        snapshots = [
            Snapshot(
                observed_at=(started + timedelta(seconds=offset)).isoformat(),
                app_name="Synthetic timing app",
                bundle_id="synthetic.timing.app",
                window_title="Owned fixture",
                source="unknown",
                frontmost_capture_source="win32-foreground",
            )
            for offset in (0.0, elapsed)
        ]
        with temp_dir_closing_databases() as tmp:
            database = TrackerDatabase(Path(tmp) / "tracker.sqlite3", perform_maintenance=False)
            with patch.object(tracker_main.sys, "platform", platform), patch.object(
                tracker_main, "current_power_state",
                return_value=PowerStateSample(started, True, "owned fixture"),
            ), patch.object(tracker_main, "seconds_since_last_input", return_value=0.0), patch.object(
                tracker_main, "engagement_decision_for_tick",
                return_value=SimpleNamespace(should_capture=True, is_passive=passive),
            ), patch.object(tracker_main, "_apply_developer_diagnostics_env"), patch.object(
                tracker_main, "current_snapshot", side_effect=snapshots,
            ), patch.object(tracker_main.time, "monotonic", side_effect=(100.0, 100.0 + elapsed)), patch.object(
                tracker_main, "enqueue_youtube_metadata_fetch",
            ), patch.object(tracker_main, "backfill_browser_history_context"), patch.object(
                tracker_main, "SAMPLE_SECONDS", 5,
            ):
                previous_tick = tracker_main._daemon_tick(database, None)
                self.assertEqual(tracker_main._daemon_tick(database, previous_tick), 100.0 + elapsed)
            rows = database.connect().execute(
                "SELECT started_at, ended_at, duration_seconds, engagement_evidence "
                "FROM activity_segments ORDER BY id"
            ).fetchall()
            self.assertEqual(len(rows), row_count)
            self.assertEqual(sum(row["duration_seconds"] for row in rows), 5 + credited_seconds)
            if row_count == 2:
                self.assertEqual(rows[0]["ended_at"], snapshots[0].observed_at)
                self.assertEqual(rows[1]["started_at"], snapshots[1].observed_at)
                self.assertEqual(rows[1]["duration_seconds"], credited_seconds)
            expected_evidence = "foreground-audio" if passive else None
            self.assertTrue(all(row["engagement_evidence"] == expected_evidence for row in rows))

    def test_daemon_tick_records_a_verified_app_named_unavailable(self) -> None:
        mock_db = MagicMock()
        power_state = PowerStateSample(
            observed_at=datetime(2026, 4, 6, 9, 0, tzinfo=timezone.utc),
            should_capture=True,
            reason="ok",
        )
        snapshot = Snapshot(
            observed_at="2026-04-06T09:00:00+00:00",
            app_name="Unavailable",
            bundle_id=None,
            window_title=None,
            source="win32-foreground-untitled",
            frontmost_capture_source="win32-foreground",
        )
        with patch.object(tracker_main, "current_power_state", return_value=power_state), patch.object(
            tracker_main, "seconds_since_last_input", return_value=0.0
        ), patch.object(tracker_main, "_apply_developer_diagnostics_env"), patch.object(
            tracker_main, "current_snapshot", return_value=snapshot
        ), patch.object(tracker_main, "enqueue_youtube_metadata_fetch"), patch.object(
            tracker_main, "backfill_browser_history_context"
        ):
            self.assertIsNotNone(tracker_main._daemon_tick(mock_db, None))

        mock_db.record_snapshot.assert_called_once()
        self.assertIs(mock_db.record_snapshot.call_args.args[0], snapshot)

    def test_windows_foreground_race_is_not_saved_to_timeline(self) -> None:
        with temp_dir_closing_databases() as tmp:
            tracker_main.DB_PATH = Path(tmp) / "tracker.sqlite3"
            db = TrackerDatabase(tracker_main.DB_PATH)
            failed = build_windows_snapshot(
                None,
                None,
                observed_at="2026-04-06T09:00:00+00:00",
                capture_error="Foreground window changed during browser capture (title).",
            )
            recovered = Snapshot(
                observed_at="2026-04-06T09:00:05+00:00",
                app_name="Firefox",
                bundle_id="c:\\apps\\firefox.exe",
                window_title="Browser",
                source="win32-foreground",
                frontmost_capture_source="win32-foreground",
            )
            power_state = PowerStateSample(
                observed_at=datetime(2026, 4, 6, 9, 0, tzinfo=timezone.utc),
                should_capture=True,
                reason="ok",
            )
            with patch.object(tracker_main, "current_power_state", return_value=power_state), patch.object(
                tracker_main, "seconds_since_last_input", return_value=0.0
            ), patch.object(tracker_main, "_apply_developer_diagnostics_env"), patch.object(
                tracker_main, "current_snapshot", side_effect=[failed, recovered]
            ), patch.object(tracker_main, "enqueue_youtube_metadata_fetch"), patch.object(
                tracker_main, "backfill_browser_history_context"
            ):
                self.assertIsNone(tracker_main._daemon_tick(db, None))
                self.assertEqual(db.fetch_timeline("2026-04-06"), [])
                self.assertIsNotNone(tracker_main._daemon_tick(db, None))

            timeline = db.fetch_timeline("2026-04-06")
            self.assertEqual(len(timeline), 1)
            self.assertEqual(timeline[0]["appName"], "Firefox")

    def test_slow_windows_url_records_app_time_and_never_enriches_prior_intervals(self) -> None:
        release = threading.Event()
        requests = []

        def read_url(hwnd, app):
            requests.append((hwnd, app))
            if len(requests) == 1:
                self.assertTrue(release.wait(timeout=3.0))
                return WindowsBrowserUiaResult("https://example.test/late-old-page", None)
            return WindowsBrowserUiaResult("https://example.test/fresh-page", None)

        worker = _UrlWorker(read_url)
        try:
            with temp_dir_closing_databases() as tmp:
                path = Path(tmp) / "tracker.sqlite3"
                db = TrackerDatabase(path)
                captured_at = datetime(2026, 4, 6, 9, 0, tzinfo=timezone.utc)
                window = windows_workspace.ForegroundWindow(hwnd=101, pid=202, title="Same title - Opera")
                identity = windows_workspace.ProcessIdentity(r"C:\Browser\opera.exe", "Opera", None)
                observations = [(captured_at + timedelta(seconds=5 * index)).isoformat() for index in range(3)]
                with (
                    patch.object(tracker_main, "DB_PATH", path),
                    patch.object(tracker_storage, "CAPTURE_PLATFORM", "windows"),
                    patch.object(tracker_main, "current_power_state", return_value=PowerStateSample(
                        observed_at=captured_at, should_capture=True, reason="fixture-active",
                    )),
                    patch.object(tracker_main, "seconds_since_last_input", return_value=0.0),
                    patch.object(tracker_main, "current_snapshot", side_effect=lambda **_: windows_workspace.current_snapshot()),
                    patch.object(windows_workspace, "is_windows", return_value=True),
                    patch.object(windows_workspace, "process_session_id", return_value=1),
                    patch.object(windows_workspace, "read_foreground_window", return_value=window),
                    patch.object(windows_workspace, "resolve_identity", return_value=(identity, None)),
                    patch.object(windows_workspace, "utc_now_iso", side_effect=observations),
                    patch.object(windows_workspace, "read_browser_url_with_budget", side_effect=worker.read),
                ):
                    began = time.monotonic()
                    tick = tracker_main._daemon_tick(db, None)
                    self.assertIsNotNone(tick)
                    self.assertLess(time.monotonic() - began, 0.75)
                    with db.connect() as conn:
                        app_only = dict(conn.execute("SELECT * FROM activity_segments").fetchone())
                    self.assertEqual(app_only["app_name"], "Opera")
                    self.assertEqual(app_only["duration_seconds"], tracker_main.SAMPLE_SECONDS)
                    self.assertIsNone(app_only["site_url"])
                    raw = json.loads(app_only["raw_context_json"])
                    self.assertIn("time budget", raw["browser_automation_error"])

                    # The same HWND/title while its first request is still in
                    # flight records more app time, without queuing another URL.
                    tick = tracker_main._daemon_tick(db, tick)
                    self.assertIsNotNone(tick)
                    self.assertEqual(requests, [(101, "Opera")])
                    with db.connect() as conn:
                        before_release = dict(conn.execute("SELECT * FROM activity_segments").fetchone())
                    self.assertEqual(before_release["duration_seconds"], tracker_main.SAMPLE_SECONDS * 2)
                    self.assertIsNone(before_release["site_url"])

                    release.set()
                    with worker._condition:
                        self.assertTrue(worker._condition.wait_for(lambda: worker._active is None, timeout=1.0))
                    with db.connect() as conn:
                        after_release = dict(conn.execute("SELECT * FROM activity_segments").fetchone())
                    self.assertEqual(after_release, before_release)
                    self.assertIsNotNone(tracker_main._daemon_tick(db, tick))

                with db.connect() as conn:
                    rows = [dict(row) for row in conn.execute("SELECT * FROM activity_segments ORDER BY id")]
                self.assertEqual(len(rows), 2)
                self.assertEqual(rows[0], before_release)
                self.assertEqual(rows[1]["site_url"], "https://example.test/fresh-page")
                self.assertEqual(rows[1]["site_source"], "windows-uia-document")
                self.assertEqual(rows[1]["duration_seconds"], tracker_main.SAMPLE_SECONDS)
                self.assertEqual(rows[1]["started_at"], observations[2])
                self.assertEqual(requests, [(101, "Opera"), (101, "Opera")])
        finally:
            release.set()
            worker.close()
            if worker._thread is not None:
                worker._thread.join(timeout=1.0)
                self.assertFalse(worker._thread.is_alive())

    @patch("app.main.sys.platform", "darwin")
    def test_daemon_survives_tick_exception_and_keeps_sampling(self) -> None:
        with temp_dir_closing_databases() as tmp:
            tracker_main.DB_PATH = Path(tmp) / "tracker.sqlite3"
            mock_db = MagicMock()
            snapshot = Snapshot(
                observed_at="2026-04-06T09:00:05+00:00",
                app_name="cmux",
                bundle_id="dev.cmux",
                window_title="workspace",
                source="accessibility",
            )
            power_state = PowerStateSample(
                observed_at=datetime(2026, 4, 6, 9, 0, tzinfo=timezone.utc),
                should_capture=True,
                reason="ok",
            )
            with patch.object(tracker_main, "database", return_value=mock_db), patch.object(
                tracker_main, "current_power_state", return_value=power_state
            ), patch.object(tracker_main, "seconds_since_last_input", return_value=0.0), patch.object(
                tracker_main, "_apply_developer_diagnostics_env"
            ), patch.object(
                tracker_main,
                "current_snapshot",
                side_effect=[RuntimeError("apple event failed"), snapshot],
            ), patch.object(
                tracker_main, "enqueue_youtube_metadata_fetch"
            ), patch.object(
                tracker_main, "backfill_browser_history_context"
            ), patch.object(
                tracker_main.sys, "stderr", MagicMock()
            ), patch.object(
                tracker_main.time, "sleep", side_effect=[None, KeyboardInterrupt]
            ):
                with self.assertRaises(KeyboardInterrupt):
                    tracker_main.daemon()

        # The first tick raised, the daemon kept looping, and the second tick recorded.
        mock_db.record_snapshot.assert_called_once()
        self.assertIs(mock_db.record_snapshot.call_args.args[0], snapshot)
        mock_db.set_meta.assert_any_call("tracker_mode", "tracking")

    @patch("app.main.sys.platform", "darwin")
    def test_daemon_resets_capture_tick_after_failed_tick(self) -> None:
        with temp_dir_closing_databases() as tmp:
            tracker_main.DB_PATH = Path(tmp) / "tracker.sqlite3"
            mock_db = MagicMock()
            snapshot = Snapshot(
                observed_at="2026-04-06T09:00:05+00:00",
                app_name="cmux",
                bundle_id="dev.cmux",
                window_title="workspace",
                source="accessibility",
            )
            power_state = PowerStateSample(
                observed_at=datetime(2026, 4, 6, 9, 0, tzinfo=timezone.utc),
                should_capture=True,
                reason="ok",
            )
            with patch.object(tracker_main, "database", return_value=mock_db), patch.object(
                tracker_main, "current_power_state", return_value=power_state
            ), patch.object(tracker_main, "seconds_since_last_input", return_value=0.0), patch.object(
                tracker_main, "_apply_developer_diagnostics_env"
            ), patch.object(
                tracker_main,
                "current_snapshot",
                side_effect=[snapshot, RuntimeError("database is locked"), snapshot],
            ), patch.object(
                tracker_main.time, "monotonic", side_effect=[100.0, 190.0]
            ), patch.object(
                tracker_main, "enqueue_youtube_metadata_fetch"
            ), patch.object(
                tracker_main, "backfill_browser_history_context"
            ), patch.object(
                tracker_main.sys, "stderr", MagicMock()
            ), patch.object(
                tracker_main.time, "sleep", side_effect=[None, None, KeyboardInterrupt]
            ):
                with self.assertRaises(KeyboardInterrupt):
                    tracker_main.daemon()

        # A failed tick is a capture gap: the capture after the failure must use
        # the default sample length instead of the 90s elapsed since the last
        # successful capture.
        self.assertEqual(mock_db.record_snapshot.call_count, 2)
        self.assertEqual(
            mock_db.record_snapshot.call_args_list[1].args[1],
            tracker_main.SAMPLE_SECONDS,
        )

    def test_daemon_tick_skips_capture_after_owner_exit(self) -> None:
        mock_db = MagicMock()
        with patch.object(tracker_main, "current_power_state") as power, patch.object(
            tracker_main, "current_snapshot"
        ) as snapshot:
            self.assertIsNone(tracker_main._daemon_tick(mock_db, 42.0, capture_allowed=lambda: False))
        power.assert_not_called()
        snapshot.assert_not_called()
        mock_db.record_snapshot.assert_not_called()
        mock_db.set_meta.assert_not_called()

    def test_daemon_tick_discards_snapshot_if_owner_exits_during_foreground_read(self) -> None:
        mock_db = MagicMock()
        capture_allowed = MagicMock(side_effect=[True, True, False])
        with patch.object(tracker_main, "handle_power_state_sample", return_value=False), patch.object(
            tracker_main, "current_power_state"
        ), patch.object(tracker_main, "seconds_since_last_input", return_value=0.0), patch.object(
            tracker_main, "engagement_decision_for_tick", return_value=MagicMock(should_capture=True)
        ), patch.object(tracker_main, "_apply_developer_diagnostics_env"), patch.object(
            tracker_main, "current_snapshot"
        ) as snapshot, patch.object(tracker_main, "backfill_browser_history_context") as backfill:
            self.assertIsNone(tracker_main._daemon_tick(mock_db, 42.0, capture_allowed=capture_allowed))
        snapshot.assert_called_once_with(include_system_transient=False)
        mock_db.record_snapshot.assert_not_called()
        mock_db.set_meta.assert_not_called()
        backfill.assert_not_called()

    def test_daemon_tick_records_snapshot_and_returns_capture_tick(self) -> None:
        mock_db = MagicMock()
        snapshot = Snapshot(
            observed_at="2026-04-06T09:00:05+00:00",
            app_name="cmux",
            bundle_id="dev.cmux",
            window_title="workspace",
            source="accessibility",
        )
        power_state = PowerStateSample(
            observed_at=datetime(2026, 4, 6, 9, 0, tzinfo=timezone.utc),
            should_capture=True,
            reason="ok",
        )
        with patch.object(tracker_main, "current_power_state", return_value=power_state), patch.object(
            tracker_main, "seconds_since_last_input", return_value=0.0
        ), patch.object(tracker_main, "_apply_developer_diagnostics_env"), patch.object(
            tracker_main, "current_snapshot", return_value=snapshot
        ), patch.object(
            tracker_main.time, "monotonic", return_value=42.0
        ), patch.object(
            tracker_main, "enqueue_youtube_metadata_fetch"
        ), patch.object(
            tracker_main, "backfill_browser_history_context"
        ):
            next_tick = tracker_main._daemon_tick(mock_db, None)

        self.assertEqual(next_tick, 42.0)
        mock_db.record_snapshot.assert_called_once()
        mock_db.set_meta.assert_any_call("last_event_at", snapshot.observed_at)

    def test_daemon_tick_records_supported_passive_segment_with_bounded_merge_gap(self) -> None:
        mock_db = MagicMock()
        mock_db.latest_local_engagement_evidence.return_value = None
        snapshot = Snapshot(
            observed_at="2026-04-06T09:05:00+00:00",
            app_name="Google Chrome",
            bundle_id="com.google.Chrome",
            window_title="Audio review",
            source="accessibility",
        )
        power_state = PowerStateSample(
            observed_at=datetime(2026, 4, 6, 9, 5, tzinfo=timezone.utc),
            should_capture=True,
            reason="ok",
        )
        audio_sample = ForegroundAudioSample(True, True, "active_output_owned_by_frontmost")
        with patch.object(tracker_main, "current_power_state", return_value=power_state), patch.object(
            tracker_main, "seconds_since_last_input", return_value=300.0
        ), patch.object(
            tracker_main, "current_foreground_audio_sample", return_value=audio_sample
        ), patch.object(
            tracker_main, "_apply_developer_diagnostics_env"
        ), patch.object(
            tracker_main, "current_snapshot", return_value=snapshot
        ), patch.object(
            tracker_main.time, "monotonic", return_value=42.0
        ), patch.object(
            tracker_main, "enqueue_youtube_metadata_fetch"
        ), patch.object(
            tracker_main, "backfill_browser_history_context"
        ):
            next_tick = tracker_main._daemon_tick(mock_db, 37.0)

        self.assertEqual(next_tick, 42.0)
        self.assertEqual(snapshot.engagement_evidence, "foreground-audio")
        mock_db.record_snapshot.assert_called_once_with(
            snapshot,
            tracker_main.SAMPLE_SECONDS,
            max_merge_gap_seconds=tracker_main.PASSIVE_AUDIO_GAP_GRACE_SECONDS,
        )
        # The existing sub-three-minute idle grace remains interactive. The
        # passive evidence begins at this observed sample and is never applied
        # retroactively to an interval where the audio probe did not run.
        mock_db.trim_latest_segment.assert_not_called()
        mock_db.set_meta.assert_any_call("tracker_mode", "tracking")

    def test_daemon_tick_does_not_bridge_passive_capture_after_a_gap(self) -> None:
        mock_db = MagicMock()
        mock_db.latest_local_engagement_evidence.return_value = "foreground-audio"
        snapshot = Snapshot(
            observed_at="2026-04-06T09:05:30+00:00",
            app_name="Google Chrome",
            bundle_id="com.google.Chrome",
            window_title="Audio review",
            source="accessibility",
        )
        power_state = PowerStateSample(
            observed_at=datetime(2026, 4, 6, 9, 5, 30, tzinfo=timezone.utc),
            should_capture=True,
            reason="ok",
        )
        audio_sample = ForegroundAudioSample(True, True, "active_output_owned_by_frontmost")
        with patch.object(tracker_main, "current_power_state", return_value=power_state), patch.object(
            tracker_main, "seconds_since_last_input", return_value=330.0
        ), patch.object(
            tracker_main, "current_foreground_audio_sample", return_value=audio_sample
        ), patch.object(tracker_main, "_apply_developer_diagnostics_env"), patch.object(
            tracker_main, "current_snapshot", return_value=snapshot
        ), patch.object(tracker_main.time, "monotonic", return_value=50.0), patch.object(
            tracker_main, "enqueue_youtube_metadata_fetch"
        ), patch.object(tracker_main, "backfill_browser_history_context"):
            tracker_main._daemon_tick(mock_db, None)

        mock_db.record_snapshot.assert_called_once_with(
            snapshot,
            tracker_main.SAMPLE_SECONDS,
            max_merge_gap_seconds=0,
        )

    def test_enqueue_youtube_metadata_fetch_skips_cached_video(self) -> None:
        with temp_dir_closing_databases() as tmp:
            db_path = Path(tmp) / "tracker.sqlite3"
            mock_db = MagicMock()
            mock_db.youtube_metadata_should_fetch.return_value = False
            with patch.object(tracker_main, "TrackerDatabase") as constructor, patch(
                "app.main.threading.Thread"
            ) as thread:
                mock_db.db_path = db_path
                tracker_main.enqueue_youtube_metadata_fetch(
                    mock_db,
                    "abc123",
                    "https://www.youtube.com/watch?v=abc123",
                )

        constructor.assert_not_called()
        thread.assert_not_called()

    def test_enqueue_youtube_metadata_fetch_starts_background_worker(self) -> None:
        with temp_dir_closing_databases() as tmp:
            db_path = Path(tmp) / "tracker.sqlite3"
            mock_db = MagicMock()
            mock_db.youtube_metadata_should_fetch.return_value = True
            with patch.object(tracker_main, "TrackerDatabase") as constructor, patch(
                "app.main.threading.Thread"
            ) as thread:
                mock_db.db_path = db_path
                tracker_main.enqueue_youtube_metadata_fetch(
                    mock_db,
                    "abc123",
                    "https://www.youtube.com/watch?v=abc123",
                )

        constructor.assert_not_called()
        thread.assert_called_once_with(
            target=tracker_main._fetch_youtube_metadata_background,
            args=(db_path, "abc123", "https://www.youtube.com/watch?v=abc123"),
            daemon=True,
        )
        thread.return_value.start.assert_called_once()
        tracker_main._YOUTUBE_METADATA_IN_FLIGHT.discard("abc123")

    def test_youtube_worker_owns_and_closes_connection_after_fetch_failure(self) -> None:
        db_path = Path("/tmp/metadata-worker-test.sqlite3")
        worker_db = MagicMock()
        worker_db.youtube_metadata_should_fetch.return_value = True
        tracker_main._YOUTUBE_METADATA_IN_FLIGHT.add("worker-video")
        with patch.object(tracker_main, "TrackerDatabase", return_value=worker_db) as constructor, patch.object(
            tracker_main, "fetch_youtube_metadata", side_effect=OSError("network unavailable")
        ):
            tracker_main._fetch_youtube_metadata_background(
                db_path, "worker-video", "https://www.youtube.com/watch?v=worker-video"
            )
        constructor.assert_called_once_with(db_path, perform_maintenance=False)
        worker_db.save_youtube_metadata_failure.assert_called_once_with("worker-video")
        worker_db.close.assert_called_once()
        self.assertNotIn("worker-video", tracker_main._YOUTUBE_METADATA_IN_FLIGHT)

    def test_youtube_worker_start_failure_does_not_block_tracking_or_retry(self) -> None:
        db = MagicMock()
        db.db_path = Path("/tmp/metadata-start-test.sqlite3")
        db.youtube_metadata_should_fetch.return_value = True
        video_id = "start-failure-video"
        tracker_main._YOUTUBE_METADATA_IN_FLIGHT.discard(video_id)
        try:
            with patch("app.main.threading.Thread") as thread:
                thread.return_value.start.side_effect = [RuntimeError("can't start new thread"), None]
                tracker_main.enqueue_youtube_metadata_fetch(db, video_id, "https://www.youtube.com/watch?v=" + video_id)
                self.assertNotIn(video_id, tracker_main._YOUTUBE_METADATA_IN_FLIGHT)
                tracker_main.enqueue_youtube_metadata_fetch(db, video_id, "https://www.youtube.com/watch?v=" + video_id)
                self.assertEqual(thread.return_value.start.call_count, 2)
                self.assertIn(video_id, tracker_main._YOUTUBE_METADATA_IN_FLIGHT)
        finally:
            tracker_main._YOUTUBE_METADATA_IN_FLIGHT.discard(video_id)

    def test_youtube_worker_close_failure_still_clears_inflight(self) -> None:
        worker_db = MagicMock()
        worker_db.youtube_metadata_should_fetch.return_value = False
        worker_db.close.side_effect = RuntimeError("close failed")
        video_id = "close-failure-video"
        tracker_main._YOUTUBE_METADATA_IN_FLIGHT.add(video_id)
        with patch.object(tracker_main, "TrackerDatabase", return_value=worker_db):
            with self.assertRaisesRegex(RuntimeError, "close failed"):
                tracker_main._fetch_youtube_metadata_background(
                    Path("/tmp/metadata-close-test.sqlite3"), video_id, "https://www.youtube.com/watch?v=" + video_id,
                )
        self.assertNotIn(video_id, tracker_main._YOUTUBE_METADATA_IN_FLIGHT)

    def test_youtube_worker_writes_real_sqlite_on_its_own_thread(self) -> None:
        from app.tracker.youtube_metadata import YouTubeVideoMetadata

        threads = []
        real_thread = tracker_main.threading.Thread
        def capture_thread(**kwargs):
            thread = real_thread(**kwargs)
            threads.append(thread)
            return thread

        video_id = "separate-connection-video"
        with temp_dir_closing_databases() as tmp:
            db = TrackerDatabase(Path(tmp) / "tracker.sqlite3")
            try:
                with patch("app.main.threading.Thread", side_effect=capture_thread), patch.object(
                    tracker_main, "fetch_youtube_metadata",
                    return_value=YouTubeVideoMetadata(video_id=video_id, title="Synthetic QA title"),
                ):
                    tracker_main.enqueue_youtube_metadata_fetch(db, video_id, "https://www.youtube.com/watch?v=" + video_id)
                    self.assertEqual(len(threads), 1)
                    threads[0].join(timeout=5)
                    self.assertFalse(threads[0].is_alive())
                with db.connect() as conn:
                    row = conn.execute("SELECT title, status FROM youtube_video_metadata WHERE video_id = ?", (video_id,)).fetchone()
                self.assertEqual((row["title"], row["status"]), ("Synthetic QA title", "ok"))
                self.assertNotIn(video_id, tracker_main._YOUTUBE_METADATA_IN_FLIGHT)
            finally:
                for thread in threads:
                    thread.join(timeout=5)
                db.close()

    def test_serve_processes_requests_echoes_id_and_survives_errors(self) -> None:
        import io
        import json

        requests = "\n".join(
            [
                json.dumps({"id": 1, "command": "ping", "payload": {"value": 7}}),
                "",  # blank line should be skipped, not break the loop
                json.dumps({"id": 2, "command": "does_not_exist", "payload": {}}),
                json.dumps({"command": "ping", "payload": {}}),  # no id -> no id echoed
            ]
        )
        stub_commands = {"ping": lambda payload: tracker_main.response(True, payload)}
        out = io.StringIO()
        with patch.object(tracker_main, "COMMANDS", stub_commands), patch.object(
            tracker_main.sys, "stdin", io.StringIO(requests)
        ), patch.object(tracker_main.sys, "stdout", out):
            tracker_main.serve()

        lines = [line for line in out.getvalue().splitlines() if line]
        self.assertEqual(len(lines), 3)

        first = json.loads(lines[0])
        self.assertTrue(first["ok"])
        self.assertEqual(first["data"], {"value": 7})
        self.assertEqual(first["id"], 1)

        # An unknown command returns an error envelope but does NOT kill the loop.
        second = json.loads(lines[1])
        self.assertFalse(second["ok"])
        self.assertEqual(second["id"], 2)
        self.assertIsNotNone(second["error"])

        # A request without an id gets no id field echoed back.
        third = json.loads(lines[2])
        self.assertTrue(third["ok"])
        self.assertNotIn("id", third)

    def test_serve_reads_utf8_requests_when_the_platform_code_page_is_not_utf8(self) -> None:
        import io
        import json

        payload = {"name": "카카오톡", "reason": "회의록 정리 — 업무"}
        request = json.dumps({"id": 1, "command": "echo", "payload": payload}, ensure_ascii=False)
        # Windows opens a piped stdin with the ANSI code page: cp949 on Korean Windows.
        stdin = io.TextIOWrapper(io.BytesIO(f"{request}\n".encode("utf-8")), encoding="cp949")
        stub_commands = {"echo": lambda received: tracker_main.response(True, received)}
        out = io.StringIO()
        with patch.object(tracker_main, "COMMANDS", stub_commands), patch.object(
            tracker_main.sys, "stdin", stdin
        ), patch.object(tracker_main.sys, "stdout", out):
            tracker_main.serve()

        envelope = json.loads(out.getvalue())
        self.assertTrue(envelope["ok"])
        self.assertEqual(envelope["data"], payload)

    def test_serve_survives_a_malformed_byte_in_the_request_stream(self) -> None:
        import io
        import json

        valid = json.dumps({"id": 2, "command": "echo", "payload": {"name": "카카오톡"}}, ensure_ascii=False)
        stream = b'{"id": 1, "command": "echo", "payload": {"name": "\xff"}}\n' + f"{valid}\n".encode("utf-8")
        stdin = io.TextIOWrapper(io.BytesIO(stream), encoding="cp949")
        stub_commands = {"echo": lambda received: tracker_main.response(True, received)}
        out = io.StringIO()
        with patch.object(tracker_main, "COMMANDS", stub_commands), patch.object(
            tracker_main.sys, "stdin", stdin
        ), patch.object(tracker_main.sys, "stdout", out):
            tracker_main.serve()

        envelopes = [json.loads(line) for line in out.getvalue().splitlines() if line]
        self.assertEqual([envelope["id"] for envelope in envelopes], [1, 2])
        self.assertEqual(envelopes[1]["data"], {"name": "카카오톡"})


class BrowserHistoryBackfillUpgradeTests(unittest.TestCase):
    """Exercise persisted captures through normal reopen and a real daemon tick."""

    captured_at = datetime(2026, 4, 6, 9, 0, tzinfo=timezone.utc)
    window_title = "Upgrade boundary documentation - Google Chrome"
    history_url = "https://docs.example.test/upgrade-boundary"

    def _add_history_visit(self, root: Path, title: str, url: str, observed_at: datetime) -> None:
        history = root / "Default" / "History"
        history.parent.mkdir(parents=True, exist_ok=True)
        visited_at = int((observed_at.timestamp() + 11_644_473_600) * 1_000_000)
        with closing(sqlite3.connect(history)) as conn:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS urls(id INTEGER PRIMARY KEY, url TEXT, title TEXT, last_visit_time INTEGER)"
            )
            conn.execute("CREATE TABLE IF NOT EXISTS visits(id INTEGER PRIMARY KEY, url INTEGER, visit_time INTEGER)")
            cursor = conn.execute(
                "INSERT INTO urls(url, title, last_visit_time) VALUES (?, ?, ?)",
                (url, title, visited_at),
            )
            conn.execute("INSERT INTO visits(url, visit_time) VALUES (?, ?)", (cursor.lastrowid, visited_at))
            conn.commit()

    def _windows_browser_snapshot(self, observed_at: datetime) -> Snapshot:
        return build_windows_snapshot(
            windows_workspace.ForegroundWindow(hwnd=101, pid=202, title=self.window_title),
            windows_workspace.ProcessIdentity(
                exe_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe",
                exe_name="Google Chrome",
                aumid=None,
            ),
            observed_at=observed_at.isoformat(),
        )

    def _record_legacy_history_miss(self, db: TrackerDatabase, snapshot: Snapshot, platform: str) -> int:
        # These persisted fields and record_snapshot are unchanged from the
        # pre-guard writer. Resolve an actual readable History title miss;
        # an empty History would instead produce no_readable_database.
        metadata = browser_history.browser_history_metadata(
            snapshot.app_name, snapshot.window_title, snapshot.observed_at
        )
        self.assertEqual(metadata.browser_history_status, "no_match")
        self.assertTrue(metadata.browser_history_database_found)
        self.assertIsNone(metadata.site_url)
        snapshot.browser_name = snapshot.app_name
        snapshot.browser_automation_status = "unavailable"
        snapshot.browser_automation_error = "Fixture foreground Document read failed."
        for field in (
            "browser_history_status", "browser_history_reason", "browser_history_database_found",
            "browser_history_profile_count", "browser_history_candidate_count", "browser_history_error_count",
        ):
            setattr(snapshot, field, getattr(metadata, field))
        with patch.object(tracker_storage, "CAPTURE_PLATFORM", platform):
            db.record_snapshot(snapshot, 5, max_merge_gap_seconds=0)
        with db.connect() as conn:
            row = conn.execute("SELECT * FROM activity_segments ORDER BY id DESC LIMIT 1").fetchone()
        self.assertEqual(row["platform"], platform)
        self.assertIsNone(row["site_url"])
        self.assertEqual(json.loads(row["raw_context_json"])["browser_history_status"], "no_match")
        return int(row["id"])

    def _reopen_and_tick(self, db: TrackerDatabase, observed_at: datetime) -> TrackerDatabase:
        path = db.db_path
        db.close()
        resumed = TrackerDatabase(path)
        self.assertTrue(resumed.maintenance_result.existed)
        self.assertIsNone(resumed.maintenance_error)
        self.assertIsNone(resumed.maintenance_result.quarantined_path)
        self.assertIsNone(resumed.maintenance_result.restored_backup_path)
        snapshot = build_windows_snapshot(
            windows_workspace.ForegroundWindow(hwnd=303, pid=404, title="Fixture editor document"),
            windows_workspace.ProcessIdentity(exe_path=r"C:\Windows\System32\notepad.exe", exe_name="Notepad", aumid=None),
            observed_at=observed_at.isoformat(),
        )
        # Only platform inputs are supplied. DB preparation/writing, the daemon
        # backfill call, title matching and History SQLite reads remain real.
        with patch.object(tracker_main, "DB_PATH", path), patch.object(
            tracker_storage, "CAPTURE_PLATFORM", "windows"
        ), patch.object(
            tracker_main, "current_power_state",
            return_value=PowerStateSample(observed_at=observed_at, should_capture=True, reason="fixture-active"),
        ), patch.object(tracker_main, "seconds_since_last_input", return_value=0.0), patch.object(
            tracker_main, "current_snapshot", return_value=snapshot
        ):
            self.assertIsNotNone(tracker_main._daemon_tick(resumed, None))
        self.assertEqual(resumed.get_meta("last_event_at"), observed_at.isoformat())
        with resumed.connect() as conn:
            latest = conn.execute("SELECT * FROM activity_segments ORDER BY id DESC LIMIT 1").fetchone()
        self.assertEqual(latest["app_name"], snapshot.app_name)
        return resumed

    def _assert_app_only(self, db: TrackerDatabase, segment_id: int) -> None:
        with db.connect() as conn:
            row = conn.execute("SELECT * FROM activity_segments WHERE id = ?", (segment_id,)).fetchone()
        self.assertEqual(row["app_name"], "Google Chrome")
        self.assertEqual(row["duration_seconds"], 5)
        for field in ("site_domain", "site_title", "site_url", "site_source", "youtube_video_id"):
            self.assertIsNone(row[field], field)
        self.assertNotIn("browser_history_backfilled", json.loads(row["raw_context_json"]))

    def test_legacy_windows_history_miss_stays_app_only_after_reopen_and_tick(self) -> None:
        with temp_dir_closing_databases() as tmp:
            root = Path(tmp)
            self._add_history_visit(root / "chrome", "Unrelated readable page", "https://other.example.test/", self.captured_at)
            with patch.object(browser_history, "_BROWSER_ROOTS", {"Google Chrome": root / "chrome"}):
                db = TrackerDatabase(root / "tracker.sqlite3")
                segment_id = self._record_legacy_history_miss(db, self._windows_browser_snapshot(self.captured_at), "windows")
                self._add_history_visit(root / "chrome", "Upgrade boundary documentation", self.history_url, self.captured_at)
                resumed = self._reopen_and_tick(db, self.captured_at + timedelta(seconds=30))
                self._assert_app_only(resumed, segment_id)

    def test_known_windows_capture_source_refuses_history_with_a_mac_platform_label(self) -> None:
        with temp_dir_closing_databases() as tmp:
            root = Path(tmp)
            self._add_history_visit(root / "chrome", "Unrelated readable page", "https://other.example.test/", self.captured_at)
            with patch.object(browser_history, "_BROWSER_ROOTS", {"Google Chrome": root / "chrome"}):
                db = TrackerDatabase(root / "tracker.sqlite3")
                segment_id = self._record_legacy_history_miss(db, self._windows_browser_snapshot(self.captured_at), "macos")
                self._add_history_visit(root / "chrome", "Upgrade boundary documentation", self.history_url, self.captured_at)
                resumed = self._reopen_and_tick(db, self.captured_at + timedelta(seconds=30))
                self._assert_app_only(resumed, segment_id)

    def test_new_windows_failed_live_capture_stays_app_only_after_reopen_and_tick(self) -> None:
        with temp_dir_closing_databases() as tmp:
            root = Path(tmp)
            self._add_history_visit(root / "chrome", "Upgrade boundary documentation", self.history_url, self.captured_at)
            with patch.object(browser_history, "_BROWSER_ROOTS", {"Google Chrome": root / "chrome"}):
                db = TrackerDatabase(root / "tracker.sqlite3")
                snapshot = windows_workspace.enrich_browser_snapshot(
                    self._windows_browser_snapshot(self.captured_at), 101,
                    live_reader=lambda hwnd, app: WindowsBrowserUiaResult(url=None, error="Fixture Document read failed."),
                    bridge_reader=lambda app, live_url: None,
                )
                self.assertIsNone(snapshot.browser_history_status)
                with patch.object(tracker_storage, "CAPTURE_PLATFORM", "windows"):
                    db.record_snapshot(snapshot, 5)
                with db.connect() as conn:
                    segment_id = int(conn.execute("SELECT id FROM activity_segments").fetchone()["id"])
                resumed = self._reopen_and_tick(db, self.captured_at + timedelta(seconds=30))
                self._assert_app_only(resumed, segment_id)

    def test_mac_history_miss_fills_after_reopen_and_tick(self) -> None:
        with temp_dir_closing_databases() as tmp:
            root = Path(tmp)
            self._add_history_visit(root / "chrome", "Unrelated readable page", "https://other.example.test/", self.captured_at)
            with patch.object(browser_history, "_BROWSER_ROOTS", {"Google Chrome": root / "chrome"}):
                db = TrackerDatabase(root / "tracker.sqlite3")
                snapshot = Snapshot(
                    observed_at=self.captured_at.isoformat(), app_name="Google Chrome", bundle_id="com.google.Chrome",
                    window_title=self.window_title, source="accessibility", frontmost_capture_source="system-events",
                )
                segment_id = self._record_legacy_history_miss(db, snapshot, "macos")
                self._add_history_visit(root / "chrome", "Upgrade boundary documentation", self.history_url, self.captured_at)
                resumed = self._reopen_and_tick(db, self.captured_at + timedelta(seconds=30))
                with resumed.connect() as conn:
                    row = conn.execute("SELECT * FROM activity_segments WHERE id = ?", (segment_id,)).fetchone()
                self.assertEqual(row["site_url"], self.history_url)
                self.assertEqual(row["site_source"], "browser-history-title")
                self.assertTrue(json.loads(row["raw_context_json"])["browser_history_backfilled"])

    def test_recent_windows_rows_do_not_crowd_mac_history_backfill_out_of_scan(self) -> None:
        with temp_dir_closing_databases() as tmp:
            root = Path(tmp)
            self._add_history_visit(root / "chrome", "Unrelated readable page", "https://other.example.test/", self.captured_at)
            with patch.object(browser_history, "_BROWSER_ROOTS", {"Google Chrome": root / "chrome"}):
                db = TrackerDatabase(root / "tracker.sqlite3")
                mac_snapshot = Snapshot(
                    observed_at=self.captured_at.isoformat(), app_name="Google Chrome", bundle_id="com.google.Chrome",
                    window_title=self.window_title, source="accessibility", frontmost_capture_source="system-events",
                )
                mac_id = self._record_legacy_history_miss(db, mac_snapshot, "macos")
                windows_ids = [
                    self._record_legacy_history_miss(
                        db, self._windows_browser_snapshot(self.captured_at + timedelta(seconds=index)), "windows"
                    )
                    for index in range(1, 102)
                ]
                self._add_history_visit(root / "chrome", "Upgrade boundary documentation", self.history_url, self.captured_at)
                resumed = self._reopen_and_tick(db, self.captured_at + timedelta(seconds=120))
                with resumed.connect() as conn:
                    mac = conn.execute("SELECT * FROM activity_segments WHERE id = ?", (mac_id,)).fetchone()
                self.assertEqual(mac["site_url"], self.history_url)
                for segment_id in windows_ids:
                    self._assert_app_only(resumed, segment_id)


if __name__ == "__main__":
    unittest.main()
