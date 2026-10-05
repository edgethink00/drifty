import ctypes
import errno
import json
import os
from pathlib import Path
import select
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

from app import macos_process_liveness as liveness


class MacTrackerOwnerTests(unittest.TestCase):
    def native_select(self):
        queue = MagicMock()
        queue.control.return_value = []
        api = SimpleNamespace(
            kqueue=MagicMock(return_value=queue), kevent=MagicMock(),
            KQ_FILTER_PROC=-5, KQ_EV_ADD=1, KQ_EV_ENABLE=4,
            KQ_EV_ONESHOT=16, KQ_NOTE_EXIT=0x80000000,
        )
        return api, queue

    def test_retained_subscription_never_reopens_a_reused_pid_and_exit_is_sticky(self):
        api, queue = self.native_select()
        with patch.object(liveness, "select", api), patch.object(
            liveness, "macos_process_creation_time", side_effect=[77, 77]
        ) as identity:
            owner = liveness._open_macos_process_owner(42, 77)
            queue.control.side_effect = [[], [object()]]
            self.assertTrue(owner.is_alive())
            self.assertTrue(owner.wait_until_exit(5))
            # If PID 42 is now a different live process, an empty event queue
            # or fresh PID lookup must not revive this original owner.
            self.assertFalse(owner.is_alive())
            self.assertTrue(owner.wait_until_exit(5))
            self.assertEqual(identity.call_count, 2)
            owner.close()
            owner.close()
        queue.close.assert_called_once_with()
        api.kevent.assert_called_once_with(42, filter=-5, flags=21, fflags=0x80000000)

    def test_wrong_initial_birth_is_rejected_before_allocating_queue(self):
        api, _ = self.native_select()
        with patch.object(liveness, "select", api), patch.object(
            liveness, "macos_process_creation_time", return_value=78
        ), self.assertRaisesRegex(RuntimeError, "identity changed"):
            liveness._open_macos_process_owner(42, 77)
        api.kqueue.assert_not_called()

    def test_pid_replacement_during_registration_fails_closed_and_releases_queue(self):
        api, queue = self.native_select()
        with patch.object(liveness, "select", api), patch.object(
            liveness, "macos_process_creation_time", side_effect=[77, 78]
        ), self.assertRaisesRegex(RuntimeError, "identity changed"):
            liveness._open_macos_process_owner(42, 77)
        queue.close.assert_called_once_with()

    def test_exit_or_error_during_registration_is_not_discarded(self):
        for result in ([object()], OSError(errno.ESRCH, "owner exited")):
            api, queue = self.native_select()
            queue.control.side_effect = [result]
            with self.subTest(result=result), patch.object(liveness, "select", api), patch.object(
                liveness, "macos_process_creation_time", return_value=77
            ), self.assertRaises((RuntimeError, OSError)):
                liveness._open_macos_process_owner(42, 77)
            queue.close.assert_called_once_with()
            self.assertEqual(queue.control.call_args.args[1:], (1, 0))

    def test_identity_inspection_failure_before_or_after_registration_fails_closed(self):
        for sequence, expected_closes in (([RuntimeError("unavailable")], 0),
                                          ([77, RuntimeError("unavailable")], 1)):
            api, queue = self.native_select()
            with self.subTest(sequence=sequence), patch.object(liveness, "select", api), patch.object(
                liveness, "macos_process_creation_time", side_effect=sequence
            ), self.assertRaisesRegex(RuntimeError, "unavailable"):
                liveness._open_macos_process_owner(42, 77)
            self.assertEqual(queue.close.call_count, expected_closes)

    def test_queue_creation_failure_does_not_admit_an_owner(self):
        api, _ = self.native_select()
        api.kqueue.side_effect = OSError(errno.EMFILE, "too many files")
        with patch.object(liveness, "select", api), patch.object(
            liveness, "macos_process_creation_time", return_value=77
        ), self.assertRaisesRegex(RuntimeError, "monitor is unavailable"):
            liveness._open_macos_process_owner(42, 77)

    def test_failed_wait_and_invalid_timeout_latch_capture_off(self):
        for error in (OSError(errno.EBADF, "closed"), InterruptedError(), ValueError(), OverflowError()):
            queue = MagicMock()
            queue.control.side_effect = error
            owner = liveness.MacOSProcessOwner(queue)
            with self.subTest(error=error):
                self.assertTrue(owner.wait_until_exit(1))
                self.assertFalse(owner.is_alive())
                queue.control.assert_called_once_with([], 1, 1.0)
                owner.close()
        for timeout in (float("nan"), float("inf"), None):
            queue = MagicMock()
            owner = liveness.MacOSProcessOwner(queue)
            self.assertTrue(owner.wait_until_exit(timeout))
            queue.control.assert_not_called()
            owner.close()

    def test_partial_invalid_or_out_of_range_env_never_opens_owner(self):
        for pid, creation in (("42", None), (None, "77"), ("", "77"), ("-1", "77"),
                              ("0", "77"), ("42", "0"), ("abc", "77"), ("４２", "77"),
                              (" 42", "77"), (str(2**31), "77"), ("42", str(2**64)),
                              ("42", "1" * 5000)):
            env = {key: value for key, value in (
                (liveness.TRACKER_APP_PID_ENV, pid), (liveness.TRACKER_APP_CREATION_TIME_ENV, creation)
            ) if value is not None}
            with self.subTest(pid=pid, creation=str(creation)[:30]), patch.object(
                liveness.sys, "platform", "darwin"
            ), patch.dict(os.environ, env, clear=True), patch.object(
                liveness, "_open_macos_process_owner"
            ) as open_owner, self.assertRaisesRegex(RuntimeError, "identity is invalid"):
                with liveness.tracker_app_owner():
                    self.fail("invalid owner admitted")
            open_owner.assert_not_called()

    def test_standalone_or_other_platform_does_not_load_native_apis(self):
        for platform, env in (("darwin", {}), ("win32", {liveness.TRACKER_APP_PID_ENV: "42"})):
            with self.subTest(platform=platform), patch.object(liveness.sys, "platform", platform), patch.dict(
                os.environ, env, clear=True
            ), patch.object(liveness, "_open_macos_process_owner") as open_owner:
                with liveness.tracker_app_owner() as owner:
                    self.assertIsNone(owner)
                open_owner.assert_not_called()

    def test_context_closes_original_queue_after_capture_failure(self):
        owner = MagicMock()
        with patch.object(liveness.sys, "platform", "darwin"), patch.dict(os.environ, {
            liveness.TRACKER_APP_PID_ENV: "42", liveness.TRACKER_APP_CREATION_TIME_ENV: "77",
        }, clear=True), patch.object(liveness, "_open_macos_process_owner", return_value=owner), \
                self.assertRaisesRegex(RuntimeError, "capture failed"):
            with liveness.tracker_app_owner() as actual:
                self.assertIs(actual, owner)
                raise RuntimeError("capture failed")
        owner.close.assert_called_once_with()

    def test_libproc_short_wrong_pid_exiting_or_invalid_timestamp_fails_closed(self):
        for returned, pid, flags, seconds, micros in (
            (0, 42, 0, 100, 1), (8, 42, 0, 100, 1),
            (136, 43, 0, 100, 1), (136, 42, 4, 100, 1),
            (136, 42, 0, 0, 0), (136, 42, 0, 100, 1_000_000),
            (136, 42, 0, 2**64 - 1, 0),
        ):
            api = MagicMock()

            def fill(request_pid, flavor, arg, buffer, size):
                info = ctypes.cast(buffer, ctypes.POINTER(liveness._ProcBsdInfo)).contents
                info.pbi_pid, info.pbi_flags = pid, flags
                info.pbi_start_tvsec, info.pbi_start_tvusec = seconds, micros
                return returned

            api.proc_pidinfo.side_effect = fill
            with self.subTest(returned=returned, pid=pid, flags=flags, micros=micros), patch.object(
                liveness.sys, "platform", "darwin"
            ), patch.object(liveness.ctypes, "CDLL", return_value=api), \
                    self.assertRaisesRegex(RuntimeError, "identity is unavailable"):
                liveness.macos_process_creation_time(42)


@unittest.skipUnless(sys.platform == "darwin", "requires native macOS libproc and kqueue")
class NativeMacTrackerOwnerTests(unittest.TestCase):
    def child(self):
        child = subprocess.Popen(
            [sys.executable, "-c", "import sys; sys.stdin.buffer.read(1)"],
            stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )

        def cleanup():
            if child.poll() is None:
                child.kill()
            child.wait(timeout=3)
            child.stdin.close()

        self.addCleanup(cleanup)
        return child

    def exit_child(self, child):
        child.stdin.write(b"x")
        child.stdin.flush()
        child.wait(timeout=3)

    def test_current_process_identity_env_context_and_close_release_native_fd(self):
        created = liveness.macos_process_creation_time(os.getpid())
        self.assertGreater(created, 0)
        self.assertEqual(created, liveness.macos_process_creation_time(os.getpid()))
        with patch.dict(os.environ, {
            liveness.TRACKER_APP_PID_ENV: str(os.getpid()),
            liveness.TRACKER_APP_CREATION_TIME_ENV: str(created),
        }):
            with liveness.tracker_app_owner() as owner:
                fd = owner._queue.fileno()
                self.assertFalse(os.get_inheritable(fd))
                self.assertTrue(owner.is_alive())
                self.assertFalse(owner.wait_until_exit(0.01))
            self.assertFalse(owner.is_alive())
            owner.close()
            with self.assertRaises(OSError) as error:
                os.fstat(fd)
            self.assertEqual(error.exception.errno, errno.EBADF)

    def test_wrong_native_birth_is_rejected(self):
        created = liveness.macos_process_creation_time(os.getpid())
        with self.assertRaisesRegex(RuntimeError, "identity changed"):
            liveness._open_macos_process_owner(os.getpid(), created + 1)

    def test_exit_wakes_wait_and_consumed_event_cannot_revive_owner(self):
        child = self.child()
        owner = liveness._open_macos_process_owner(child.pid, liveness.macos_process_creation_time(child.pid))
        self.addCleanup(owner.close)
        self.assertTrue(owner.is_alive())
        timer = threading.Timer(0.05, lambda: self.exit_child(child))
        timer.start()
        self.addCleanup(lambda: timer.join(timeout=3))
        started = time.monotonic()
        self.assertTrue(owner.wait_until_exit(5))
        self.assertLess(time.monotonic() - started, 2)
        self.assertFalse(owner.is_alive())
        self.assertTrue(owner.wait_until_exit(0))

    def test_already_exited_owner_cannot_be_bound(self):
        child = self.child()
        created = liveness.macos_process_creation_time(child.pid)
        self.exit_child(child)
        with self.assertRaises(RuntimeError):
            liveness._open_macos_process_owner(child.pid, created)

    def test_native_exit_in_each_registration_window_fails_closed_without_fd_leak(self):
        original_identity = liveness.macos_process_creation_time
        original_kqueue = select.kqueue
        for exit_after_read in (1, 2):
            child = self.child()
            created = original_identity(child.pid)
            queues = []
            calls = 0

            def identity(pid):
                nonlocal calls
                value = original_identity(pid)
                calls += 1
                if calls == exit_after_read:
                    self.exit_child(child)
                return value

            def queue():
                actual = original_kqueue()
                queues.append(actual)
                return actual

            with self.subTest(exit_after_read=exit_after_read), patch.object(
                liveness, "macos_process_creation_time", side_effect=identity
            ), patch.object(liveness.select, "kqueue", side_effect=queue), \
                    self.assertRaises((RuntimeError, OSError)):
                liveness._open_macos_process_owner(child.pid, created)
            self.assertEqual(len(queues), 1)
            self.assertTrue(queues[0].closed)

    def test_independent_sibling_monitor_stops_when_exact_owner_exits(self):
        child = self.child()
        env = dict(os.environ)
        env[liveness.TRACKER_APP_PID_ENV] = str(child.pid)
        env[liveness.TRACKER_APP_CREATION_TIME_ENV] = str(liveness.macos_process_creation_time(child.pid))
        env["PYTHONPATH"] = str(Path(__file__).resolve().parents[1])
        observer = subprocess.Popen([sys.executable, "-c", """
from app.macos_process_liveness import tracker_app_owner
with tracker_app_owner() as owner:
    assert owner.is_alive()
    print('bound', flush=True)
    assert owner.wait_until_exit(5)
    assert not owner.is_alive()
print('exited', flush=True)
"""], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            self.assertTrue(select.select([observer.stdout], [], [], 3)[0], "observer did not bind")
            self.assertEqual(observer.stdout.readline().strip(), "bound")
            self.exit_child(child)
            stdout, stderr = observer.communicate(timeout=3)
            self.assertEqual(observer.returncode, 0, stderr)
            self.assertEqual(stdout.strip(), "exited")
        finally:
            if observer.poll() is None:
                observer.kill()
            observer.communicate(timeout=3)

    def test_repeated_native_binding_and_context_failure_release_each_descriptor(self):
        created = liveness.macos_process_creation_time(os.getpid())
        for _ in range(20):
            with patch.dict(os.environ, {
                liveness.TRACKER_APP_PID_ENV: str(os.getpid()),
                liveness.TRACKER_APP_CREATION_TIME_ENV: str(created),
            }), self.assertRaisesRegex(RuntimeError, "synthetic capture failure"):
                with liveness.tracker_app_owner() as owner:
                    queue = owner._queue
                    raise RuntimeError("synthetic capture failure")
            self.assertTrue(queue.closed)

    @unittest.skipUnless(shutil.which("xcrun"), "requires installed macOS SDK for ABI comparison")
    def test_ctypes_layout_and_birth_value_match_compiled_sdk(self):
        source = r'''
#include <libproc.h>
#include <sys/proc_info.h>
#include <sys/param.h>
#include <sys/event.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
int main(int argc, char **argv) {
    struct proc_bsdinfo p = {0};
    int n = proc_pidinfo(atoi(argv[1]), PROC_PIDTBSDINFO, 0, &p, sizeof(p));
    if (n != sizeof(p)) return 2;
    printf("{\"size\":%zu,\"sec_offset\":%zu,\"usec_offset\":%zu,"
           "\"maxcomlen\":%d,\"flavor\":%d,\"creation\":%llu,"
           "\"pid_size\":%zu,\"uid_size\":%zu,\"gid_size\":%zu,"
           "\"proc_filter\":%d,\"note_exit\":%u}\n",
        sizeof(p), offsetof(struct proc_bsdinfo, pbi_start_tvsec),
        offsetof(struct proc_bsdinfo, pbi_start_tvusec), MAXCOMLEN, PROC_PIDTBSDINFO,
        (unsigned long long)(p.pbi_start_tvsec * 1000000 + p.pbi_start_tvusec),
        sizeof(pid_t), sizeof(uid_t), sizeof(gid_t), EVFILT_PROC, NOTE_EXIT);
    return 0;
}
'''
        with TemporaryDirectory(prefix="drifty-owner-abi-") as directory:
            c = Path(directory) / "check.c"
            exe = Path(directory) / "check"
            c.write_text(source)
            subprocess.run(["xcrun", "clang", "-Wall", "-Werror", str(c), "-lproc", "-o", str(exe)],
                           check=True, capture_output=True, timeout=30)
            result = subprocess.run([str(exe), str(os.getpid())], check=True,
                                    capture_output=True, text=True, timeout=3)
        abi = json.loads(result.stdout)
        self.assertEqual(abi["size"], ctypes.sizeof(liveness._ProcBsdInfo))
        self.assertEqual(abi["sec_offset"], liveness._ProcBsdInfo.pbi_start_tvsec.offset)
        self.assertEqual(abi["usec_offset"], liveness._ProcBsdInfo.pbi_start_tvusec.offset)
        self.assertEqual(abi["maxcomlen"], 16)
        self.assertEqual(abi["flavor"], liveness._PROC_PIDTBSDINFO)
        self.assertEqual(abi["creation"], liveness.macos_process_creation_time(os.getpid()))
        self.assertEqual((abi["pid_size"], abi["uid_size"], abi["gid_size"]), (4, 4, 4))
        self.assertEqual(abi["proc_filter"], select.KQ_FILTER_PROC)
        self.assertEqual(abi["note_exit"], select.KQ_NOTE_EXIT)


if __name__ == "__main__":
    unittest.main()
