from __future__ import annotations

import threading
import time
import unittest
from unittest.mock import patch

from app.tracker import windows_browser_capture
from app.tracker.windows_browser_capture import _UrlWorker
from app.tracker.windows_browser_uia import WindowsBrowserUiaResult


class WindowsBrowserCaptureTests(unittest.TestCase):
    def setUp(self) -> None:
        self.workers: list[_UrlWorker] = []
        self.releases: list[threading.Event] = []

    def tearDown(self) -> None:
        for release in self.releases:
            release.set()
        for worker in self.workers:
            worker.close()
            if worker._thread is not None:
                worker._thread.join(timeout=1.0)
                self.assertFalse(worker._thread.is_alive())

    def worker(self, reader) -> _UrlWorker:
        worker = _UrlWorker(reader)
        self.workers.append(worker)
        return worker

    def release(self) -> threading.Event:
        release = threading.Event()
        self.releases.append(release)
        return release

    def wait_idle(self, worker: _UrlWorker) -> None:
        with worker._condition:
            self.assertTrue(worker._condition.wait_for(lambda: worker._active is None, timeout=1.0))

    def test_fast_reads_are_fresh_requests_for_the_requested_window(self) -> None:
        requests: list[tuple[int, str | None, int]] = []

        def read(hwnd, app):
            requests.append((hwnd, app, threading.get_ident()))
            return WindowsBrowserUiaResult(f"https://example.test/{hwnd}/{len(requests)}", None)

        worker = self.worker(read)
        first = worker.read(101, "Opera")
        second = worker.read(202, "Opera")
        third = worker.read(202, "Opera")
        self.assertEqual(first.url, "https://example.test/101/1")
        self.assertEqual(second.url, "https://example.test/202/2")
        self.assertEqual(third.url, "https://example.test/202/3")
        self.assertEqual([row[:2] for row in requests], [(101, "Opera"), (202, "Opera"), (202, "Opera")])
        self.assertEqual(len({row[2] for row in requests}), 1)

    def test_slow_provider_does_not_block_the_sample_or_spawn_busy_workers(self) -> None:
        started = threading.Event()
        release = self.release()
        requests = []

        def read(hwnd, app):
            requests.append((hwnd, app, threading.get_ident()))
            started.set()
            self.assertTrue(release.wait(timeout=3.0))
            return WindowsBrowserUiaResult("https://example.test/late", None)

        worker = self.worker(read)
        began = time.monotonic()
        first = worker.read(101, "Opera")
        elapsed = time.monotonic() - began
        self.assertTrue(started.is_set())
        self.assertIsNone(first.url)
        self.assertIn("time budget", first.error or "")
        self.assertGreaterEqual(elapsed, 0.20)
        self.assertLess(elapsed, 0.75)
        thread = worker._thread
        began = time.monotonic()
        for hwnd in range(202, 302):
            busy = worker.read(hwnd, "Opera")
            self.assertIsNone(busy.url)
            self.assertIn("busy", busy.error or "")
        self.assertLess(time.monotonic() - began, 0.20)
        self.assertEqual(len(requests), 1)
        self.assertIs(worker._thread, thread)
        self.assertEqual(sum(item is thread for item in threading.enumerate()), 1)
        release.set()
        self.wait_idle(worker)

    def test_late_generation_is_discarded_even_when_the_window_stays_the_same(self) -> None:
        release = self.release()
        requests = []

        def read(hwnd, app):
            requests.append((hwnd, app))
            if len(requests) == 1:
                self.assertTrue(release.wait(timeout=3.0))
                return WindowsBrowserUiaResult("https://example.test/old-same-title-tab", None)
            return WindowsBrowserUiaResult("https://example.test/fresh-same-title-tab", None)

        worker = self.worker(read)
        expired = worker.read(101, "Opera", timeout_seconds=0.05)
        release.set()
        self.wait_idle(worker)
        fresh = worker.read(101, "Opera")
        self.assertIsNone(expired.url)
        self.assertEqual(fresh.url, "https://example.test/fresh-same-title-tab")
        self.assertEqual(requests, [(101, "Opera"), (101, "Opera")])
        self.assertEqual(worker._generation, 2)

    def test_failure_is_a_fixed_local_diagnostic_and_the_same_worker_recovers(self) -> None:
        attempts = []

        def read(_hwnd, _app):
            attempts.append(threading.get_ident())
            if len(attempts) == 1:
                raise RuntimeError("private provider text https://example.test/private")
            return WindowsBrowserUiaResult("https://example.test/recovered", None)

        worker = self.worker(read)
        failed = worker.read(101, "Firefox")
        recovered = worker.read(101, "Firefox")
        self.assertIsNone(failed.url)
        self.assertEqual(failed.error, "Windows URL provider failed.")
        self.assertEqual(recovered.url, "https://example.test/recovered")
        self.assertEqual(len(set(attempts)), 1)

    def test_close_wakes_a_waiting_sample_and_never_accepts_its_late_result(self) -> None:
        started = threading.Event()
        release = self.release()
        results = []
        calls = []

        def read(hwnd, app):
            calls.append((hwnd, app))
            started.set()
            self.assertTrue(release.wait(timeout=3.0))
            return WindowsBrowserUiaResult("https://example.test/late-after-stop", None)

        worker = self.worker(read)
        caller = threading.Thread(target=lambda: results.append(worker.read(101, "Opera", timeout_seconds=2.0)))
        caller.start()
        self.assertTrue(started.wait(timeout=1.0))
        began = time.monotonic()
        worker.close()
        caller.join(timeout=0.5)
        self.assertFalse(caller.is_alive())
        self.assertLess(time.monotonic() - began, 0.5)
        self.assertIsNone(results[0].url)
        self.assertIsNone(worker.read(202, "Opera").url)
        release.set()
        self.wait_idle(worker)
        self.assertEqual(calls, [(101, "Opera")])

    def test_unmeasured_browser_and_non_windows_do_not_start_a_worker(self) -> None:
        with patch.object(windows_browser_capture, "_worker") as worker:
            with patch.object(windows_browser_capture.sys, "platform", "win32"):
                self.assertIsNone(windows_browser_capture.read_browser_url_with_budget(101, "Tor Browser").url)
            with patch.object(windows_browser_capture.sys, "platform", "darwin"):
                self.assertIsNone(windows_browser_capture.read_browser_url_with_budget(101, "Opera").url)
        worker.read.assert_not_called()


if __name__ == "__main__":
    unittest.main()
