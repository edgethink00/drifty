import ctypes
import io
import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import textwrap
import time
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

from app import main as tracker_main
from app import windows_daemon_shutdown as shutdown


class _FakeNative:
    def __init__(self, *, event=True, cooperative=True, force_exits=True):
        self.now = 0.0
        self.original = object()
        self.event = object() if event else None
        self.cooperative = cooperative
        self.force_exits = force_exits
        self.exited = False
        self.signaled = False
        self.forced = []
        self.closed = []
        self.opened_names = []
        self.creation_filetime = 123456789

    def open_process(self, pid):
        return self.original

    def validate_process(self, handle, executable, source_runtime=False):
        assert handle is self.original
        return self.creation_filetime

    def wait(self, handle, seconds):
        assert handle is self.original
        if self.exited:
            return True
        if seconds > 0:
            self.now += seconds
            if (self.signaled and self.cooperative) or (self.forced and self.force_exits):
                self.exited = True
        return self.exited

    def open_event(self, name):
        self.opened_names.append(name)
        return self.event

    def signal(self, event):
        assert event is self.event
        self.signaled = True

    def terminate(self, handle):
        assert handle is self.original
        self.forced.append(handle)

    def close(self, handle):
        self.closed.append(handle)


class WindowsDaemonShutdownTests(unittest.TestCase):
    def stop(self, api, verify=lambda: True, timeout=3.0):
        with patch.object(shutdown, "_NativeApi", return_value=api), patch.object(
            shutdown.time, "monotonic", side_effect=lambda: api.now
        ):
            return shutdown.stop_windows_tracker_daemon(501, Path("owned.sqlite3"), Path(sys.executable), verify, timeout)

    def test_cooperative_stop_signals_exact_db_and_process_generation_without_force(self):
        api = _FakeNative()
        self.assertEqual(self.stop(api), "cooperative")
        self.assertEqual(api.opened_names, [shutdown._event_name(Path("owned.sqlite3"), 501, api.creation_filetime)])
        self.assertTrue(api.signaled)
        self.assertFalse(api.forced)
        self.assertEqual(api.closed, [api.event, api.original])

    def test_database_and_creation_are_distinct_event_owners(self):
        name = shutdown._event_name(Path("owned.sqlite3"), 501, 100)
        self.assertTrue(name.startswith("Local\\DriftyTrackerStop-v1-"))
        self.assertNotEqual(name, shutdown._event_name(Path("another.sqlite3"), 501, 100))
        self.assertNotEqual(name, shutdown._event_name(Path("owned.sqlite3"), 501, 101))
        self.assertNotEqual(name, shutdown._event_name(Path("owned.sqlite3"), 502, 100))
        self.assertNotIn("owned.sqlite3", name)

    def test_original_exit_during_command_recheck_never_signals_a_reused_pid(self):
        api = _FakeNative()
        def verify():
            api.exited = True  # the numeric PID may now name another process
            return True
        self.assertEqual(self.stop(api, verify), "exited")
        self.assertFalse(api.opened_names)
        self.assertFalse(api.signaled)
        self.assertFalse(api.forced)
        self.assertEqual(api.closed, [api.original])

    def test_changed_database_or_unknown_command_fails_closed(self):
        api = _FakeNative()
        with self.assertRaisesRegex(PermissionError, "database"):
            self.stop(api, lambda: False)
        self.assertFalse(api.signaled)
        self.assertFalse(api.forced)
        self.assertEqual(api.closed, [api.original])

    def test_unverified_native_identity_never_opens_event_or_forces(self):
        api = _FakeNative()
        api.validate_process = MagicMock(side_effect=PermissionError("owner/session/path mismatch"))
        with self.assertRaises(PermissionError):
            self.stop(api)
        self.assertFalse(api.opened_names)
        self.assertFalse(api.forced)
        self.assertEqual(api.closed, [api.original])

    def test_legacy_missing_event_retries_then_uses_only_the_original_handle(self):
        api = _FakeNative(event=False)
        stderr = io.StringIO()
        with patch.object(shutdown.sys, "stderr", stderr):
            self.assertEqual(self.stop(api), "forced")
        self.assertGreater(len(api.opened_names), 1)
        self.assertEqual(api.forced, [api.original])
        self.assertLessEqual(api.now, 3.0)
        self.assertIn("shutdown event unavailable; provider cleanup is unconfirmed", stderr.getvalue())
        self.assertEqual(api.closed, [api.original])

    def test_event_published_during_startup_is_used_before_fallback(self):
        api = _FakeNative(event=False)
        event = object()
        def open_event(name):
            api.opened_names.append(name)
            if api.now >= 0.1:
                api.event = event
                return event
            return None
        api.open_event = open_event
        self.assertEqual(self.stop(api), "cooperative")
        self.assertFalse(api.forced)
        self.assertEqual(api.closed, [event, api.original])

    def test_busy_daemon_force_wait_uses_remaining_single_deadline(self):
        api = _FakeNative(cooperative=False, force_exits=False)
        with patch.object(shutdown.sys, "stderr", io.StringIO()), self.assertRaisesRegex(TimeoutError, "deadline"):
            self.stop(api)
        self.assertEqual(api.forced, [api.original])
        self.assertEqual(api.now, 3.0)
        self.assertEqual(api.closed, [api.event, api.original])

    def test_slow_ownership_recheck_does_not_reset_stop_budget(self):
        api = _FakeNative()
        def verify():
            api.now = 4.0
            return True
        with self.assertRaisesRegex(TimeoutError, "before force"):
            self.stop(api, verify)
        self.assertFalse(api.signaled)
        self.assertFalse(api.forced)
        self.assertEqual(api.closed, [api.original])

    def test_changed_ownership_before_fallback_never_forces(self):
        api = _FakeNative(event=False)
        verify = MagicMock(side_effect=[True, False])
        with self.assertRaisesRegex(PermissionError, "before force"):
            self.stop(api, verify)
        self.assertEqual(verify.call_count, 2)
        self.assertFalse(api.forced)
        self.assertEqual(api.closed, [api.original])

    def test_original_exit_during_fallback_recheck_accepts_confirmed_exit_not_reused_pid(self):
        api = _FakeNative(event=False)
        calls = []
        def verify():
            calls.append(True)
            if len(calls) == 2:
                api.exited = True
                return False  # the PID disappeared or was reused in the query
            return True
        self.assertEqual(self.stop(api, verify), "exited")
        self.assertFalse(api.forced)
        self.assertEqual(api.closed, [api.original])

    def test_event_access_or_type_error_is_not_treated_as_legacy(self):
        api = _FakeNative()
        api.open_event = MagicMock(side_effect=PermissionError("unreadable event"))
        with self.assertRaises(PermissionError):
            self.stop(api)
        self.assertFalse(api.forced)
        self.assertEqual(api.closed, [api.original])

    def test_set_event_failure_closes_both_handles_without_force(self):
        api = _FakeNative()
        api.signal = MagicMock(side_effect=OSError("SetEvent failed"))
        with self.assertRaises(OSError):
            self.stop(api)
        self.assertFalse(api.forced)
        self.assertEqual(api.closed, [api.event, api.original])

    def test_existing_event_is_closed_and_rejected_instead_of_adopted(self):
        api = object.__new__(shutdown._NativeApi)
        api.k = SimpleNamespace(CreateEventW=MagicMock(return_value=55))
        api.close = MagicMock()
        with patch.object(ctypes, "set_last_error", create=True), patch.object(
            ctypes, "get_last_error", return_value=183, create=True
        ), self.assertRaises(FileExistsError):
            api.create_event("owned-name")
        api.close.assert_called_once_with(55)

    def test_native_validation_checks_executable_owner_and_session(self):
        for mismatch in ("path", "owner", "session"):
            with self.subTest(mismatch=mismatch):
                api = object.__new__(shutdown._NativeApi)
                def query(handle, flags, buffer, size):
                    buffer.value = str(Path(sys.executable if mismatch != "path" else "other.exe").resolve())
                    return True
                api.k = SimpleNamespace(QueryFullProcessImageNameW=query, GetCurrentProcess=lambda: "self")
                api._sid = lambda handle: b"other" if mismatch == "owner" and handle != "self" else b"owner"
                api._session = lambda handle: 2 if mismatch == "session" and handle != "self" else 1
                api.creation = MagicMock(return_value=100)
                with self.assertRaises(PermissionError):
                    api.validate_process("target", Path(sys.executable))
                api.creation.assert_not_called()

    def test_event_close_is_idempotent(self):
        api = MagicMock()
        api.creation.return_value = 100
        api.create_event.return_value = 55
        with patch.object(shutdown, "_NativeApi", return_value=api):
            event = shutdown.WindowsDaemonStopEvent(Path("owned.sqlite3"))
        event.close(); event.close()
        api.close.assert_called_once_with(55)

    def test_source_venv_admits_only_its_declared_base_interpreter(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            launcher = root / "venv/Scripts/python.exe"
            base = root / "base/python.exe"
            foreign = root / "foreign/python.exe"
            for path in (launcher, base, foreign):
                path.parent.mkdir(parents=True, exist_ok=True); path.touch()
            config = launcher.parent.parent / "pyvenv.cfg"
            config.write_text(f"home = {base.parent}\n")
            paths = shutdown._image_paths(launcher, True)
            self.assertEqual(paths, {shutdown._canonical_path(launcher), shutdown._canonical_path(base)})
            self.assertNotIn(shutdown._canonical_path(foreign), paths)
            self.assertEqual(shutdown._image_paths(launcher, False), {shutdown._canonical_path(launcher)})
            api = object.__new__(shutdown._NativeApi)
            def query(handle, flags, buffer, size):
                buffer.value = str(base)
                return True
            api.k = SimpleNamespace(QueryFullProcessImageNameW=query, GetCurrentProcess=lambda: "self")
            api._sid = lambda handle: b"owner"
            api._session = lambda handle: 1
            api.creation = MagicMock(return_value=100)
            self.assertEqual(api.validate_process("base-child", launcher, True), 100)
            with self.assertRaises(PermissionError):
                api.validate_process("frozen-config-spoof", launcher, False)
            base.unlink()
            with self.assertRaises(PermissionError):
                api.validate_process("missing-declared-base", launcher, True)
            base.touch()
            for text in ("", "home = relative\n", f"home = {base.parent}\nhome = {foreign.parent}\n"):
                config.write_text(text)
                self.assertEqual(shutdown._image_paths(launcher, True), {shutdown._canonical_path(launcher)})
            config.unlink()
            self.assertEqual(shutdown._image_paths(launcher, True), {shutdown._canonical_path(launcher)})

    def test_source_launcher_fallback_then_base_child_event_keep_distinct_process_generations(self):
        launcher = _FakeNative(event=False)
        base = _FakeNative()
        base.creation_filetime += 1
        with patch.object(shutdown.sys, "stderr", io.StringIO()) as stderr:
            self.assertEqual(self.stop(launcher), "forced")
            self.assertEqual(self.stop(base), "cooperative")
        self.assertNotEqual(launcher.opened_names[0], base.opened_names[0])
        self.assertTrue(launcher.forced); self.assertFalse(base.forced)
        self.assertIn("provider cleanup is unconfirmed", stderr.getvalue())

    def test_native_terminate_permission_error_is_only_accepted_after_exit(self):
        api = object.__new__(shutdown._NativeApi)
        api.k = SimpleNamespace(TerminateProcess=MagicMock(return_value=False))
        api.wait = MagicMock(return_value=False)
        api._error = lambda label: PermissionError(label)
        with self.assertRaises(PermissionError):
            api.terminate("bound-original")
        api.wait.return_value = True
        api.terminate("bound-original")


class DaemonCooperativeLifecycleTests(unittest.TestCase):
    def run_daemon(self, event, *, db_error=None, capture_error=None):
        order = []
        db = MagicMock()
        if db_error:
            db.set_meta.side_effect = db_error
        event.close.side_effect = lambda: order.append("event-close")
        def create(db_path):
            order.append("event-create")
            return event
        def close_capture():
            order.append("capture-close")
            if capture_error:
                raise capture_error
        with patch.object(tracker_main.sys, "platform", "win32"), patch.object(
            tracker_main, "_acquire_tracker_daemon_lock", return_value="owned-lock"
        ), patch.object(shutdown, "WindowsDaemonStopEvent", side_effect=create), patch.object(
            tracker_main, "_write_tracker_pid", side_effect=lambda pid: order.append("pid-publish")
        ), patch.object(tracker_main, "database", return_value=db), patch.object(
            tracker_main, "_tracker_runtime_fingerprint", return_value="fixture"
        ), patch.object(tracker_main, "reset_foreground_audio_diagnostics"), patch.object(
            tracker_main, "_daemon_tick", return_value=1.0
        ) as tick, patch.object(tracker_main, "_close_loaded_windows_capture", side_effect=close_capture), patch.object(
            tracker_main, "_remove_pid_record_if_owned", side_effect=lambda pid: order.append("pid-remove")
        ), patch.object(tracker_main, "_release_tracker_daemon_lock", side_effect=lambda lock: order.append("lock-release")), patch.object(
            tracker_main.time, "sleep"
        ) as sleep:
            if db_error or capture_error:
                with self.assertRaises(type(db_error or capture_error)):
                    tracker_main.daemon()
            else:
                tracker_main.daemon()
        return order, tick, sleep

    def test_stop_during_initialization_exits_without_new_tick_and_closes_before_pid(self):
        event = MagicMock()
        event.requested.return_value = True
        order, tick, sleep = self.run_daemon(event)
        self.assertEqual(order, ["event-create", "pid-publish", "capture-close", "pid-remove", "event-close", "lock-release"])
        tick.assert_not_called(); sleep.assert_not_called()

    def test_stop_interrupts_sample_wait_and_retires_capture_before_releasing_ownership(self):
        event = MagicMock()
        event.requested.return_value = False
        event.wait.return_value = True
        order, tick, sleep = self.run_daemon(event)
        tick.assert_called_once(); sleep.assert_not_called()
        event.wait.assert_called_once_with(tracker_main.SAMPLE_SECONDS)
        self.assertLess(order.index("capture-close"), order.index("pid-remove"))
        self.assertLess(order.index("pid-remove"), order.index("lock-release"))

    def test_stop_received_during_maintenance_does_not_begin_a_new_capture(self):
        for requests in ([False, True], [False, False, True]):
            with self.subTest(requests=requests):
                event = MagicMock()
                event.requested.side_effect = requests
                order, tick, sleep = self.run_daemon(event)
                tick.assert_not_called(); sleep.assert_not_called(); event.wait.assert_not_called()
                self.assertLess(order.index("capture-close"), order.index("lock-release"))

    def test_initialization_error_closes_event_pid_and_daemon_lock(self):
        event = MagicMock()
        order, tick, sleep = self.run_daemon(event, db_error=RuntimeError("initialization failed"))
        self.assertEqual(order, ["event-create", "pid-publish", "capture-close", "pid-remove", "event-close", "lock-release"])
        tick.assert_not_called(); sleep.assert_not_called()

    def test_capture_close_failure_still_releases_pid_event_and_daemon_lock(self):
        event = MagicMock()
        event.requested.return_value = True
        order, tick, sleep = self.run_daemon(event, capture_error=OSError("cleanup failed"))
        self.assertEqual(order, ["event-create", "pid-publish", "capture-close", "pid-remove", "event-close", "lock-release"])
        tick.assert_not_called(); sleep.assert_not_called()

    def test_event_creation_failure_never_publishes_pid_and_releases_daemon_lock(self):
        with patch.object(tracker_main.sys, "platform", "win32"), patch.object(
            tracker_main, "_acquire_tracker_daemon_lock", return_value="owned-lock"
        ), patch.object(shutdown, "WindowsDaemonStopEvent", side_effect=FileExistsError("collision")), patch.object(
            tracker_main, "_write_tracker_pid"
        ) as publish, patch.object(tracker_main, "_remove_pid_record_if_owned"), patch.object(
            tracker_main, "_close_loaded_windows_capture"
        ), patch.object(tracker_main, "_release_tracker_daemon_lock") as release:
            with self.assertRaises(FileExistsError):
                tracker_main.daemon()
        publish.assert_not_called(); release.assert_called_once_with("owned-lock")

    def test_shutdown_does_not_import_unloaded_windows_capture_modules(self):
        with patch.object(tracker_main.sys, "platform", "win32"), patch.dict(sys.modules, {
            "app.tracker.windows_browser_capture": None, "app.tracker.windows_browser_uia": None,
        }), patch("builtins.__import__", side_effect=AssertionError("shutdown must not import")):
            tracker_main._close_loaded_windows_capture()

    def test_real_daemon_return_retires_unpublished_uia_child_and_temp_before_atexit(self):
        # Only the native event transport and PowerShell OS launch are portable
        # fixtures. The real daemon loop, URL worker, owned constructor, explicit
        # cleanup, and subsequent interpreter exit run in an actual subprocess.
        code = textwrap.dedent('''
            import atexit,json,subprocess,sys,tempfile,time
            from pathlib import Path
            from types import SimpleNamespace
            from unittest.mock import MagicMock
            root = Path(sys.argv[1])
            from app import main,windows_daemon_shutdown as shutdown
            child = None
            def observe_exit():
                state = {"childStopped": child is not None and child.poll() is not None,
                         "tempScripts": len(list(root.glob("drifty-uia-*.ps1")))}
                print(json.dumps({"afterAtexit": state}), flush=True)
                if child is not None and child.poll() is None:
                    child.kill(); child.wait(timeout=1)
            atexit.register(observe_exit)
            from app.tracker import windows_browser_capture as capture,windows_browser_uia as uia
            real_init = subprocess.Popen.__init__
            def launch(process, command, **kwargs):
                global child
                child_code = "import time; time.sleep(60)"
                real_init(process, [sys.executable, "-u", "-c", child_code], stdin=subprocess.PIPE,
                          stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, encoding="utf-8",
                          creationflags=kwargs.get("creationflags", 0))
                child = process
                (root / "child-pid").write_text(str(process.pid))
            subprocess.Popen.__init__ = launch
            uia._powershell_executable = lambda: sys.executable
            tempfile.tempdir = str(root)
            class ChildEventApi:
                k = SimpleNamespace(GetCurrentProcess=lambda: "self")
                def creation(self, handle): return 100
                def create_event(self, name):
                    (root / "event-name").write_text(name)
                    return name
                def wait(self, handle, seconds):
                    deadline = time.monotonic() + seconds
                    while True:
                        if (root / "stop-event").exists():
                            return (root / "stop-event").read_text() == handle
                        if time.monotonic() >= deadline: return False
                        time.sleep(.005)
                def close(self, handle): pass
            shutdown._NativeApi = ChildEventApi
            sys.platform = "win32"
            main.DB_PATH = root / "owned.sqlite3"
            main.SAMPLE_SECONDS = 60
            main.database = MagicMock(return_value=MagicMock())
            main._tracker_runtime_fingerprint = lambda: "unit-fixture"
            def tick(db, previous):
                result = capture.read_browser_url_with_budget(101, "Microsoft Edge")
                (root / "ready").write_text(json.dumps({
                    "tempScripts": len(list(root.glob("drifty-uia-*.ps1"))),
                    "constructorUnpublished": uia._host is None, "childCreated": child is not None,
                    "appOnly": result.url is None,
                }))
                return time.monotonic()
            main._daemon_tick = tick
            main.daemon()
            print(json.dumps({"beforeAtexit": {
                "childStopped": child is not None and child.poll() is not None,
                "tempScripts": len(list(root.glob("drifty-uia-*.ps1"))),
                "workerRetired": capture._worker._closed,
                "pidRemoved": not main.pid_path().exists(),
            }}), flush=True)
        ''')
        service_root = Path(__file__).resolve().parents[1]
        environment = {**os.environ, "PYTHONPATH": str(service_root)}
        for key in ("VITE_SENTRY_DSN", "DRIFTY_NATIVE_SENTRY_DSN", "DRIFTY_TRACKER_SENTRY_DSN", "SENTRY_DSN"):
            environment[key] = ""
        # A Windows venv Popen PID can belong to its launcher while os.getpid()
        # names the base-interpreter child that owns the daemon's stop event.
        # Launch the base image directly so this portable transport binds both
        # sides to the same actual process and generation.
        interpreter = sys._base_executable if sys.platform == "win32" else sys.executable
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            process = subprocess.Popen([interpreter, "-c", code, str(root)], stdout=subprocess.PIPE,
                                       stderr=subprocess.PIPE, text=True, env=environment)
            try:
                deadline = time.monotonic() + 5
                while not (root / "ready").exists() and process.poll() is None and time.monotonic() < deadline:
                    time.sleep(.01)
                self.assertTrue((root / "ready").exists(), "real daemon did not reach the cold UIA fixture")
                self.assertEqual(json.loads((root / "ready").read_text()), {
                    "tempScripts": 1, "constructorUnpublished": True, "childCreated": True, "appOnly": True,
                })
                self.assertEqual((root / "event-name").read_text(),
                                 shutdown._event_name(root / "owned.sqlite3", process.pid, 100))
                api = MagicMock()
                api.open_process.return_value = process
                api.validate_process.return_value = 100
                def wait(handle, seconds):
                    try: handle.wait(timeout=seconds)
                    except subprocess.TimeoutExpired: return False
                    return True
                api.wait.side_effect = wait
                api.open_event.side_effect = lambda name: name if (root / "event-name").read_text() == name else None
                api.signal.side_effect = lambda name: (root / "stop-event").write_text(name)
                api.terminate.side_effect = AssertionError("natural cooperative stop must not force")
                command = f'"{interpreter}" "{tracker_main._current_script_path()}" daemon --db "{root / "owned.sqlite3"}"'
                with patch.object(tracker_main.sys, "platform", "win32"), patch.object(
                    tracker_main, "DB_PATH", root / "owned.sqlite3"
                ), patch.object(tracker_main, "_process_exists", side_effect=lambda pid: process.poll() is None), patch.object(
                    tracker_main, "_process_command", return_value=command
                ), patch.object(shutdown, "_NativeApi", return_value=api), patch("app.main.os.kill") as kill:
                    self.assertEqual(tracker_main._stop_verified_tracker_daemon(process.pid), "tracker")
                kill.assert_not_called(); api.terminate.assert_not_called()
                out, err = process.communicate(timeout=2)
                self.assertEqual(process.returncode, 0, err)
                before, after = [json.loads(line) for line in out.splitlines()]
                self.assertEqual(before["beforeAtexit"], {"childStopped": True, "tempScripts": 0,
                    "workerRetired": True, "pidRemoved": True})
                self.assertEqual(after["afterAtexit"], {"childStopped": True, "tempScripts": 0})
            finally:
                # Retain a failing cleanup observation before any fixture rescue.
                event_file = root / "event-name"
                if process.poll() is None and event_file.exists():
                    (root / "stop-event").write_text(event_file.read_text())
                    try: process.wait(timeout=3)
                    except subprocess.TimeoutExpired: process.kill(); process.wait(timeout=1)
                if process.poll() is None:
                    process.kill(); process.wait(timeout=1)
                if process.stdout: process.stdout.close()
                if process.stderr: process.stderr.close()


if __name__ == "__main__":
    unittest.main()
