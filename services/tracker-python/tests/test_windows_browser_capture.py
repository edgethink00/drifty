from __future__ import annotations

import sys
import threading
import time
import types
import unittest
from unittest.mock import patch

from app.tracker import windows_browser_capture
from app.tracker.windows_browser_capture import _UrlWorker
from app.tracker.windows_browser_uia import WindowsBrowserCluesResult, WindowsBrowserUiaResult


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

    def test_page_clues_share_the_single_flight_and_keep_failures_fixed(self) -> None:
        started = threading.Event()
        release = self.release()

        def read(_hwnd, _app):
            started.set()
            self.assertTrue(release.wait(timeout=3.0))
            return WindowsBrowserUiaResult("https://example.test/a", None)

        worker = self.worker(read)
        worker.read(101, "Google Chrome", timeout_seconds=0.05)
        self.assertTrue(started.wait(timeout=1.0))
        jobs: list[int] = []
        busy = worker.read_clues(101, "Google Chrome", 0.5, lambda: jobs.append(1))
        self.assertIn("busy", busy.error or "")
        self.assertEqual(jobs, [])
        release.set()
        self.wait_idle(worker)
        done = worker.read_clues(
            101, "Google Chrome", 0.5,
            lambda: WindowsBrowserCluesResult(url="https://example.test/a", title="A", clues={"headings": ["H"]}),
        )
        self.assertEqual(done.clues, {"headings": ["H"]})

        def leak():
            raise RuntimeError("provider text https://example.test/private")

        failed = worker.read_clues(101, "Google Chrome", 0.5, leak)
        self.assertEqual(failed.error, "Windows page clue provider failed.")

    def test_clue_budget_leaves_pipe_transit_and_caps_the_reader(self) -> None:
        calls: list[tuple[int, str | None, int]] = []

        def reader(hwnd, app, reader_ms):
            calls.append((hwnd, app, reader_ms))
            return WindowsBrowserCluesResult(error="sensitive")

        with (
            patch.object(windows_browser_capture.sys, "platform", "win32"),
            patch.object(windows_browser_capture, "_worker", self.worker(lambda *_: None)),
        ):
            windows_browser_capture.read_browser_clues_with_budget(101, "Microsoft Edge", 1.4, reader=reader)
            windows_browser_capture.read_browser_clues_with_budget(101, "Microsoft Edge", 0.4, reader=reader)
            short = windows_browser_capture.read_browser_clues_with_budget(101, "Microsoft Edge", 0.15, reader=reader)
            other = windows_browser_capture.read_browser_clues_with_budget(101, "Tor Browser", 1.0, reader=reader)
        self.assertEqual(calls, [(101, "Microsoft Edge", 570), (101, "Microsoft Edge", 320)])
        self.assertIn("no remaining", short.error or "")
        self.assertIsNotNone(other.error)

    def test_public_description_uses_its_own_worker_and_never_raises(self) -> None:
        calls: list[tuple[str, float]] = []

        def reader(url, seconds):
            calls.append((url, seconds))
            if "fail" in url:
                raise OSError("resolver text https://example.test/private")
            return "Author description"

        description_worker = self.worker(lambda *_: None)
        with (
            patch.object(windows_browser_capture.sys, "platform", "win32"),
            patch.object(windows_browser_capture, "_description_worker", description_worker),
        ):
            found = windows_browser_capture.read_public_description_with_budget("https://example.test/a", 1.2, reader=reader)
            failed = windows_browser_capture.read_public_description_with_budget("https://example.test/fail", 0.3, reader=reader)
            short = windows_browser_capture.read_public_description_with_budget("https://example.test/a", 0.05, reader=reader)
        with patch.object(windows_browser_capture.sys, "platform", "darwin"):
            other = windows_browser_capture.read_public_description_with_budget("https://example.test/a", 1.0, reader=reader)
        self.assertEqual(found, "Author description")
        self.assertIsNone(failed)
        self.assertIsNone(short)
        self.assertIsNone(other)
        self.assertEqual([url for url, _ in calls], ["https://example.test/a", "https://example.test/fail"])
        self.assertAlmostEqual(calls[0][1], 0.60)
        self.assertAlmostEqual(calls[1][1], 0.28)
        # The UIA worker is never used for the network lookup.
        self.assertIsNot(description_worker, windows_browser_capture._worker)

    def test_public_description_tls_adds_bundled_roots_and_reuses_one_context(self) -> None:
        class FakeContext:
            def __init__(self) -> None:
                self.bundles: list[str] = []

            def load_verify_locations(self, cafile=None) -> None:
                self.bundles.append(cafile)

        clock = [100.0]
        with (
            patch.object(windows_browser_capture.ssl, "create_default_context", FakeContext),
            patch.object(windows_browser_capture, "_description_tls", None),
            patch.dict(sys.modules, {"certifi": types.SimpleNamespace(where=lambda: "C:/bundle/cacert.pem")}),
        ):
            first = windows_browser_capture._description_tls_context(lambda: clock[0])
            clock[0] += 3599
            reused = windows_browser_capture._description_tls_context(lambda: clock[0])
            clock[0] += 2
            rebuilt = windows_browser_capture._description_tls_context(lambda: clock[0])
            with patch("app.tracker.browser_public_description.fetch_description") as fetch:
                fetch.return_value = "Author description"
                found = windows_browser_capture._fetch_description("https://example.test/a", 0.6)
        self.assertIs(first, reused)
        self.assertIsNot(first, rebuilt)
        self.assertEqual(first.bundles, ["C:/bundle/cacert.pem"])
        self.assertEqual(found, "Author description")
        (url, seconds), kwargs = fetch.call_args
        self.assertEqual(url, "https://example.test/a")
        self.assertLessEqual(seconds, 0.6)
        self.assertIsInstance(kwargs["context"], FakeContext)

    def test_public_description_tls_falls_back_to_the_windows_store(self) -> None:
        class FakeContext:
            def load_verify_locations(self, cafile=None) -> None:
                raise AssertionError("no bundle to load")

        with (
            patch.object(windows_browser_capture.ssl, "create_default_context", FakeContext),
            patch.object(windows_browser_capture, "_description_tls", None),
            patch.dict(sys.modules, {"certifi": None}),
        ):
            context = windows_browser_capture._description_tls_context()
        self.assertIsInstance(context, FakeContext)


if __name__ == "__main__":
    unittest.main()
