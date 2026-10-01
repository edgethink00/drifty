import ctypes
import os
import subprocess
import sys
from tempfile import TemporaryDirectory
import threading
import time
import unittest
from pathlib import Path
from ctypes import wintypes
from unittest.mock import MagicMock, patch

from app import windows_process_liveness as liveness
from app.windows_daemon_shutdown import WindowsDaemonStopEvent


class WindowsTrackerOwnerTests(unittest.TestCase):
    def kernel32(self, creation_time=0x123456789ABCDEF0):
        kernel32 = MagicMock()
        kernel32.OpenProcess.return_value = 123
        kernel32.WaitForSingleObject.return_value = liveness._WAIT_TIMEOUT

        def process_times(handle, created, exited, kernel, user):
            value = ctypes.cast(created, ctypes.POINTER(wintypes.FILETIME)).contents
            value.dwLowDateTime = creation_time & 0xFFFFFFFF
            value.dwHighDateTime = creation_time >> 32
            return True

        kernel32.GetProcessTimes.side_effect = process_times
        return kernel32

    def test_retained_owner_handle_detects_exit_without_reopening_pid(self):
        kernel32 = self.kernel32()
        kernel32.WaitForSingleObject.side_effect = [258, 0, 0]
        with patch.object(liveness.ctypes, "WinDLL", return_value=kernel32, create=True):
            owner = liveness._open_windows_process_owner(42, 0x123456789ABCDEF0)
            self.assertTrue(owner.is_alive())
            self.assertTrue(owner.wait_until_exit(5))
            self.assertFalse(owner.is_alive())
            owner.close()
            owner.close()

        kernel32.OpenProcess.assert_called_once_with(0x101000, False, 42)
        self.assertEqual(kernel32.WaitForSingleObject.call_args_list[1].args, (123, 5000))
        kernel32.CloseHandle.assert_called_once_with(123)
        self.assertFalse(owner.is_alive())

    def test_reused_pid_is_rejected_and_handle_closed(self):
        kernel32 = self.kernel32(creation_time=77)
        with patch.object(liveness.ctypes, "WinDLL", return_value=kernel32, create=True):
            with self.assertRaisesRegex(RuntimeError, "identity changed"):
                liveness._open_windows_process_owner(42, 76)
        kernel32.CloseHandle.assert_called_once_with(123)
        kernel32.WaitForSingleObject.assert_not_called()

    def test_missing_or_inaccessible_owner_fails_closed(self):
        kernel32 = self.kernel32()
        kernel32.OpenProcess.return_value = None
        with patch.object(liveness.ctypes, "WinDLL", return_value=kernel32, create=True):
            with self.assertRaisesRegex(RuntimeError, "process is unavailable"):
                liveness._open_windows_process_owner(42, 77)
        kernel32.GetProcessTimes.assert_not_called()
        kernel32.CloseHandle.assert_not_called()

    def test_unreadable_creation_time_fails_closed_and_closes_handle(self):
        kernel32 = self.kernel32()
        kernel32.GetProcessTimes.side_effect = None
        kernel32.GetProcessTimes.return_value = False
        with patch.object(liveness.ctypes, "WinDLL", return_value=kernel32, create=True):
            with self.assertRaisesRegex(RuntimeError, "identity is unavailable"):
                liveness._open_windows_process_owner(42, 77)
        kernel32.CloseHandle.assert_called_once_with(123)

    def test_failed_or_unexpected_wait_disables_capture(self):
        for wait_result in (0xFFFFFFFF, 128, 1):
            with self.subTest(wait_result=wait_result):
                kernel32 = self.kernel32()
                kernel32.WaitForSingleObject.return_value = wait_result
                owner = liveness.WindowsProcessOwner(kernel32, 123)
                self.assertFalse(owner.is_alive())
                owner.close()

    def test_combined_wait_uses_both_retained_handles_without_polling_or_reopening(self):
        kernel32 = self.kernel32()
        kernel32.WaitForMultipleObjects.side_effect = [258, 0, 1]
        with patch.object(liveness.ctypes, "WinDLL", return_value=kernel32, create=True):
            owner = liveness._open_windows_process_owner(42, 0x123456789ABCDEF0)
            self.assertFalse(owner.wait_until_exit_or_stop(5, 456))
            self.assertTrue(owner.wait_until_exit_or_stop(5, 456))
            self.assertTrue(owner.wait_until_exit_or_stop(5, 456))
            owner.close()

        kernel32.OpenProcess.assert_called_once_with(0x101000, False, 42)
        kernel32.WaitForSingleObject.assert_not_called()
        self.assertEqual(kernel32.WaitForMultipleObjects.call_count, 3)
        for call in kernel32.WaitForMultipleObjects.call_args_list:
            count, handles, wait_all, milliseconds = call.args
            self.assertEqual((count, list(handles), wait_all, milliseconds), (2, [123, 456], False, 5000))
        kernel32.CloseHandle.assert_called_once_with(123)

    def test_combined_wait_failure_or_closed_owner_disables_capture(self):
        kernel32 = self.kernel32()
        owner = liveness.WindowsProcessOwner(kernel32, 123)
        for result in (0xFFFFFFFF, 128, 2):
            with self.subTest(result=result):
                kernel32.WaitForMultipleObjects.return_value = result
                self.assertTrue(owner.wait_until_exit_or_stop(5, 456))
        owner.close()
        kernel32.WaitForMultipleObjects.reset_mock()
        self.assertTrue(owner.wait_until_exit_or_stop(5, 456))
        kernel32.WaitForMultipleObjects.assert_not_called()

    def test_unowned_standalone_windows_daemon_retains_existing_lifetime(self):
        with patch.object(liveness.sys, "platform", "win32"), patch.dict(os.environ, {}, clear=True), patch.object(
            liveness, "_open_windows_process_owner"
        ) as open_owner:
            with liveness.tracker_app_owner() as owner:
                self.assertIsNone(owner)
        open_owner.assert_not_called()

    def test_non_windows_daemon_does_not_load_windows_apis(self):
        with patch.object(liveness.sys, "platform", "darwin"), patch.dict(
            os.environ, {liveness.TRACKER_APP_PID_ENV: "42"}, clear=True
        ), patch.object(liveness, "_open_windows_process_owner") as open_owner:
            with liveness.tracker_app_owner() as owner:
                self.assertIsNone(owner)
        open_owner.assert_not_called()

    def test_partial_invalid_or_out_of_range_owner_identity_fails_closed(self):
        for pid, creation in (("42", None), (None, "77"), ("", "77"), ("-1", "77"),
                              ("0", "77"), ("42", "0"), ("abc", "77"),
                              (str(2**32), "77"), ("42", str(2**64))):
            env = {}
            if pid is not None:
                env[liveness.TRACKER_APP_PID_ENV] = pid
            if creation is not None:
                env[liveness.TRACKER_APP_CREATION_TIME_ENV] = creation
            with self.subTest(pid=pid, creation=creation), patch.object(
                liveness.sys, "platform", "win32"
            ), patch.dict(os.environ, env, clear=True), patch.object(
                liveness, "_open_windows_process_owner"
            ) as open_owner:
                with self.assertRaisesRegex(RuntimeError, "identity is invalid"):
                    with liveness.tracker_app_owner():
                        self.fail("invalid identity was admitted")
                open_owner.assert_not_called()

    def test_owned_context_closes_handle_even_on_daemon_failure(self):
        owner = MagicMock()
        with patch.object(liveness.sys, "platform", "win32"), patch.dict(
            os.environ,
            {liveness.TRACKER_APP_PID_ENV: "42", liveness.TRACKER_APP_CREATION_TIME_ENV: "77"},
            clear=True,
        ), patch.object(liveness, "_open_windows_process_owner", return_value=owner) as open_owner:
            with self.assertRaisesRegex(RuntimeError, "tick failed"):
                with liveness.tracker_app_owner() as actual_owner:
                    self.assertIs(actual_owner, owner)
                    raise RuntimeError("tick failed")
        open_owner.assert_called_once_with(42, 77)
        owner.close.assert_called_once_with()

    @unittest.skipUnless(sys.platform == "win32", "requires real Windows process handles")
    def test_real_owner_exit_with_code_259_signals_retained_handle(self):
        # This process belongs only to the test. A process handle must signal
        # exit even when GetExitCodeProcess would report ambiguous STILL_ACTIVE.
        child = subprocess.Popen([sys._base_executable, "-c", "import sys,time;time.sleep(30);sys.exit(259)"])
        owner = None
        try:
            kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
            kernel32.GetProcessTimes.argtypes = (wintypes.HANDLE,) + (ctypes.POINTER(wintypes.FILETIME),) * 4
            kernel32.GetProcessTimes.restype = wintypes.BOOL
            created, exited, kernel, user = (wintypes.FILETIME() for _ in range(4))
            self.assertTrue(kernel32.GetProcessTimes(
                int(child._handle), ctypes.byref(created), ctypes.byref(exited),
                ctypes.byref(kernel), ctypes.byref(user),
            ))
            creation_time = (created.dwHighDateTime << 32) | created.dwLowDateTime
            owner = liveness._open_windows_process_owner(child.pid, creation_time)
            self.assertTrue(owner.is_alive())
            # Terminate this disposable child with 259, without a 30s test wait.
            kernel32.TerminateProcess.argtypes = (wintypes.HANDLE, wintypes.UINT)
            kernel32.TerminateProcess.restype = wintypes.BOOL
            self.assertTrue(kernel32.TerminateProcess(int(child._handle), 259))
            self.assertTrue(owner.wait_until_exit(3))
            self.assertFalse(owner.is_alive())
            self.assertEqual(child.wait(timeout=3), 259)
        finally:
            if owner is not None:
                owner.close()
            if child.poll() is None:
                child.kill()
            child.wait(timeout=3)

    @unittest.skipUnless(sys.platform == "win32", "requires real Windows process and event handles")
    def test_real_combined_wait_wakes_for_stop_or_owner_exit_before_next_sample(self):
        for cancellation in ("stop", "owner"):
            with self.subTest(cancellation=cancellation), TemporaryDirectory() as tmp:
                child = subprocess.Popen([sys._base_executable, "-c", "import time;time.sleep(30)"])
                owner = event = timer = None
                try:
                    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
                    kernel32.GetProcessTimes.argtypes = (wintypes.HANDLE,) + (ctypes.POINTER(wintypes.FILETIME),) * 4
                    kernel32.GetProcessTimes.restype = wintypes.BOOL
                    created, exited, kernel, user = (wintypes.FILETIME() for _ in range(4))
                    self.assertTrue(kernel32.GetProcessTimes(
                        int(child._handle), ctypes.byref(created), ctypes.byref(exited),
                        ctypes.byref(kernel), ctypes.byref(user),
                    ))
                    creation_time = (created.dwHighDateTime << 32) | created.dwLowDateTime
                    owner = liveness._open_windows_process_owner(child.pid, creation_time)
                    event = WindowsDaemonStopEvent(Path(tmp) / "owned.sqlite3")
                    callback = (lambda: event._api.signal(event._handle)) if cancellation == "stop" else child.terminate
                    timer = threading.Timer(.05, callback)
                    timer.start()
                    started = time.monotonic()
                    self.assertTrue(event.wait(5, owner=owner))
                    self.assertLess(time.monotonic() - started, 2)
                    if cancellation == "stop":
                        self.assertTrue(event.requested())
                        self.assertTrue(owner.is_alive())
                        self.assertIsNone(child.poll())
                    else:
                        self.assertFalse(event.requested())
                        self.assertFalse(owner.is_alive())
                        child.wait(timeout=1)
                finally:
                    if timer is not None:
                        timer.join(timeout=1)
                    if event is not None:
                        event.close()
                    if owner is not None:
                        owner.close()
                    if child.poll() is None:
                        child.terminate()
                    child.wait(timeout=3)


    def test_original_owner_or_stop_event_wakes_without_reopening_or_closing_handles(self):
        kernel32 = self.kernel32()
        kernel32.WaitForMultipleObjects.side_effect = [258, 0, 1, 0xFFFFFFFF]
        owner = liveness.WindowsProcessOwner(kernel32, 123)
        self.assertEqual(
            [owner.wait_until_exit_or_stop(5, 456) for _ in range(4)],
            [False, True, True, True],
        )
        for invocation in kernel32.WaitForMultipleObjects.call_args_list:
            count, handles, wait_all, timeout_ms = invocation.args
            self.assertEqual(count, 2)
            self.assertEqual(list(handles), [123, 456])
            self.assertFalse(wait_all)
            self.assertEqual(timeout_ms, 5000)
        kernel32.OpenProcess.assert_not_called()
        kernel32.CloseHandle.assert_not_called()
        owner.close()
        kernel32.CloseHandle.assert_called_once_with(123)


    def test_missing_owner_or_stop_handle_fails_closed_without_native_wait(self):
        kernel32 = self.kernel32()
        owner = liveness.WindowsProcessOwner(kernel32, 123)
        self.assertTrue(owner.wait_until_exit_or_stop(5, None))
        owner.close()
        self.assertTrue(owner.wait_until_exit_or_stop(5, 456))
        kernel32.WaitForMultipleObjects.assert_not_called()


    @unittest.skipUnless(sys.platform == "win32", "requires native Windows process/event handles")
    def test_real_stop_event_wakes_while_original_owner_is_still_alive(self):
        from app import windows_daemon_shutdown as shutdown
        api = shutdown._NativeApi()
        owner = liveness._open_windows_process_owner(
            os.getpid(), api.creation(api.k.GetCurrentProcess())
        )
        event = api.create_event(None)
        try:
            self.assertTrue(owner.is_alive())
            self.assertFalse(owner.wait_until_exit_or_stop(0, event))
            self.assertTrue(api.k.SetEvent(event))
            self.assertTrue(owner.wait_until_exit_or_stop(5, event))
            self.assertTrue(owner.is_alive())
        finally:
            api.close(event)
            owner.close()



if __name__ == "__main__":
    unittest.main()
