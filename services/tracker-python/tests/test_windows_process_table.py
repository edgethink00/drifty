"""Tests for the Windows process-table backend and the platform lock shim.

Both modules replace a Unix primitive the tracker depends on for correctness,
not convenience: the process table decides whether a second daemon may start,
and the locks serialize PID-record edits. The cases below pin the properties
that make those decisions safe, especially the difference between "no daemons
are running" and "the process list could not be read".
"""

from __future__ import annotations

import subprocess
import sys
import time
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app import platform_locks  # noqa: E402
from app import windows_process_table as wpt  # noqa: E402


def _completed(stdout: str, returncode: int = 0) -> subprocess.CompletedProcess:
    return subprocess.CompletedProcess(args=[], returncode=returncode, stdout=stdout, stderr="")


class WindowsProcessTableTests(unittest.TestCase):
    def setUp(self) -> None:
        # The module caches its snapshot, so each case starts from a cold one.
        wpt.invalidate_process_table_cache()

    tearDown = setUp

    def test_parses_pid_and_command_line_pairs(self) -> None:
        payload = (
            '[{"ProcessId":1234,"CommandLine":"python.exe main.py daemon --db C:\\\\db.sqlite3"},'
            '{"ProcessId":22,"CommandLine":"explorer.exe"}]'
        )
        with patch.object(wpt.subprocess, "run", return_value=_completed(payload)):
            table = wpt.windows_process_table()
        self.assertEqual(table[22], "explorer.exe")
        self.assertIn("--db", table[1234])

    def test_single_process_object_is_accepted(self) -> None:
        # ConvertTo-Json emits an object, not a list, for a one-row result.
        payload = '{"ProcessId":7,"CommandLine":"solo.exe"}'
        with patch.object(wpt.subprocess, "run", return_value=_completed(payload)):
            self.assertEqual(wpt.windows_process_table(), {7: "solo.exe"})

    def test_null_command_lines_are_dropped(self) -> None:
        # System processes report a null command line and are never daemons.
        payload = '[{"ProcessId":4,"CommandLine":null},{"ProcessId":9,"CommandLine":"  "}]'
        with patch.object(wpt.subprocess, "run", return_value=_completed(payload)):
            self.assertEqual(wpt.windows_process_table(), {})

    def test_unreadable_snapshot_reports_none_not_empty(self) -> None:
        """The distinction that prevents a duplicate daemon.

        An empty table means "nothing is running" and lets the caller start a
        daemon. A failed query must never be reported that way.
        """
        for outcome in (
            _completed("", returncode=1),
            _completed(""),
            _completed("not json at all"),
        ):
            with patch.object(wpt.subprocess, "run", return_value=outcome):
                self.assertIsNone(wpt.windows_process_table())

    def test_query_failure_reports_none(self) -> None:
        with patch.object(wpt.subprocess, "run", side_effect=OSError("powershell missing")):
            self.assertIsNone(wpt.windows_process_table())

    def test_timeout_reports_none(self) -> None:
        with patch.object(
            wpt.subprocess, "run", side_effect=subprocess.TimeoutExpired(cmd="powershell", timeout=20)
        ):
            self.assertIsNone(wpt.windows_process_table())

    def test_generic_query_keeps_twenty_second_timeout(self) -> None:
        with patch.object(wpt.subprocess, "run", return_value=_completed("[]")) as run:
            self.assertEqual(wpt.windows_process_table(), {})
        self.assertEqual(run.call_args.kwargs["timeout"], 20)

    def test_stop_deadline_bounds_a_real_slow_query(self) -> None:
        run = subprocess.run

        def slow_query(*args, **kwargs):
            return run([sys.executable, "-c", "import time; time.sleep(2); print('[]')"], **kwargs)

        started = time.monotonic()
        with patch.object(wpt.subprocess, "run", side_effect=slow_query) as query:
            self.assertIsNone(wpt.windows_process_table(deadline=started + 0.2))
        elapsed = time.monotonic() - started
        self.assertGreaterEqual(elapsed, 0.15)
        self.assertLess(elapsed, 1.25, "query must not spend the generic 20s allowance")
        query.assert_called_once()
        self.assertIsNone(wpt._cached_table)

    def test_expired_stop_budget_refuses_even_a_cached_snapshot(self) -> None:
        with patch.object(wpt, "_cached_table", {501: "owned command"}), patch.object(
            wpt, "_cached_at", 10.0
        ), patch.object(wpt.time, "monotonic", return_value=10.0), patch.object(
            wpt.subprocess, "run"
        ) as run:
            self.assertIsNone(wpt.windows_process_command(501, deadline=10.0))
        run.assert_not_called()

    def test_process_command_returns_none_for_unknown_pid(self) -> None:
        payload = '[{"ProcessId":10,"CommandLine":"a.exe"}]'
        with patch.object(wpt.subprocess, "run", return_value=_completed(payload)):
            self.assertEqual(wpt.windows_process_command(10), "a.exe")
            self.assertIsNone(wpt.windows_process_command(11))

    def test_process_command_propagates_unreadable_snapshot(self) -> None:
        with patch.object(wpt.subprocess, "run", return_value=_completed("", returncode=1)):
            self.assertIsNone(wpt.windows_process_command(10))


class ProcessTableCacheTests(unittest.TestCase):
    """The cache exists for latency but must not change what callers observe."""

    def setUp(self) -> None:
        wpt.invalidate_process_table_cache()

    tearDown = setUp

    def test_repeated_reads_share_one_snapshot(self) -> None:
        payload = '[{"ProcessId":1,"CommandLine":"a.exe"}]'
        with patch.object(wpt.subprocess, "run", return_value=_completed(payload)) as run:
            wpt.windows_process_table()
            wpt.windows_process_table()
            wpt.windows_process_command(1)
        self.assertEqual(run.call_count, 1)

    def test_invalidation_forces_a_fresh_query(self) -> None:
        """A caller that just changed process state must be able to re-observe."""
        payload = '[{"ProcessId":1,"CommandLine":"a.exe"}]'
        with patch.object(wpt.subprocess, "run", return_value=_completed(payload)) as run:
            wpt.windows_process_table()
            wpt.invalidate_process_table_cache()
            wpt.windows_process_table()
        self.assertEqual(run.call_count, 2)

    def test_failures_are_not_cached(self) -> None:
        """Caching an unreadable snapshot would extend a transient failure."""
        with patch.object(wpt.subprocess, "run", return_value=_completed("", returncode=1)):
            self.assertIsNone(wpt.windows_process_table())
        payload = '[{"ProcessId":2,"CommandLine":"b.exe"}]'
        with patch.object(wpt.subprocess, "run", return_value=_completed(payload)):
            self.assertEqual(wpt.windows_process_table(), {2: "b.exe"})

    def test_callers_cannot_mutate_the_cached_snapshot(self) -> None:
        payload = '[{"ProcessId":1,"CommandLine":"a.exe"}]'
        with patch.object(wpt.subprocess, "run", return_value=_completed(payload)):
            first = wpt.windows_process_table()
            first[999] = "injected.exe"
            self.assertNotIn(999, wpt.windows_process_table())


class PlatformLockTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = TemporaryDirectory()
        self.path = Path(self.tempdir.name) / "test.lock"

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    def test_exclusive_lock_round_trip(self) -> None:
        with self.path.open("a+") as handle:
            platform_locks.lock_exclusive(handle)
            platform_locks.unlock(handle)

    def test_nonblocking_lock_reports_acquisition(self) -> None:
        with self.path.open("a+") as handle:
            self.assertTrue(platform_locks.lock_exclusive_nonblocking(handle))
            platform_locks.unlock(handle)

    def test_context_manager_releases_on_exception(self) -> None:
        with self.path.open("a+") as handle:
            with self.assertRaises(RuntimeError):
                with platform_locks.exclusive_lock(handle):
                    raise RuntimeError("boom")
            # Releasing must have happened, so the lock is takeable again.
            self.assertTrue(platform_locks.lock_exclusive_nonblocking(handle))
            platform_locks.unlock(handle)

    def test_unlock_is_safe_when_not_held(self) -> None:
        """Teardown paths unlock defensively; a double unlock must not raise."""
        with self.path.open("a+") as handle:
            platform_locks.lock_exclusive(handle)
            platform_locks.unlock(handle)
            platform_locks.unlock(handle)


if __name__ == "__main__":
    unittest.main()
