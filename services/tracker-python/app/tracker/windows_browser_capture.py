"""Keep slow Windows URL enrichment out of foreground app sampling.

There is one worker and one in-flight request per tracker process, without a
queue or a URL cache. Cold UIA may finish warming after a sample's deadline;
that result is discarded and a later sample must read its own live Document.
The worker never receives or mutates the caller's Snapshot.
"""

from __future__ import annotations

import atexit
import sys
import threading
import time
from dataclasses import dataclass, field
from typing import Callable

from app.tracker.windows_browser_uia import (
    WindowsBrowserUiaResult,
    _close_host,
    is_live_uia_browser,
    read_live_browser_url,
)


# Warm measured reads fit in this allowance. A cold provider keeps warming in
# the single worker, while this sample retains only verified app context.
_URL_SAMPLE_BUDGET_SECONDS = 0.25


@dataclass
class _UrlRequest:
    generation: int
    hwnd: int
    app_name: str | None
    deadline: float
    completed: threading.Event = field(default_factory=threading.Event)
    expired: bool = False
    result: WindowsBrowserUiaResult | None = None


class _UrlWorker:
    def __init__(
        self,
        reader: Callable[[int, str | None], WindowsBrowserUiaResult] = read_live_browser_url,
    ) -> None:
        self._reader = reader
        self._condition = threading.Condition()
        self._active: _UrlRequest | None = None
        self._generation = 0
        self._closed = False
        self._thread: threading.Thread | None = None

    def read(
        self,
        hwnd: int,
        app_name: str | None,
        timeout_seconds: float = _URL_SAMPLE_BUDGET_SECONDS,
    ) -> WindowsBrowserUiaResult:
        deadline = time.monotonic() + max(0.0, timeout_seconds)
        with self._condition:
            if self._closed:
                return WindowsBrowserUiaResult(None, "Windows URL capture is stopped.")
            if self._active is not None:
                return WindowsBrowserUiaResult(None, "Windows URL capture is still busy with a previous read.")
            self._generation += 1
            request = _UrlRequest(self._generation, hwnd, app_name, deadline)
            self._active = request
            if self._thread is None:
                self._thread = threading.Thread(
                    target=self._run, name="Drifty-Windows-URL", daemon=True,
                )
                try:
                    self._thread.start()
                except Exception:
                    self._thread = None
                    self._active = None
                    return WindowsBrowserUiaResult(None, "Windows URL worker could not start.")
            self._condition.notify()

        request.completed.wait(max(0.0, deadline - time.monotonic()))
        with self._condition:
            # Accept only this caller's still-current, timely result. Neither
            # the worker nor the next caller can revive an expired generation.
            result = request.result
            request.result = None
            request.expired = True
            if self._closed:
                return WindowsBrowserUiaResult(None, "Windows URL capture is stopped.")
            if result is not None and time.monotonic() <= deadline:
                return result
            return WindowsBrowserUiaResult(None, "Windows URL capture exceeded this sample's time budget.")

    def _run(self) -> None:
        while True:
            with self._condition:
                while self._active is None and not self._closed:
                    self._condition.wait()
                if self._closed:
                    return
                request = self._active
                if request.expired or time.monotonic() >= request.deadline:
                    self._active = None
                    request.completed.set()
                    self._condition.notify_all()
                    continue
            try:
                result = self._reader(request.hwnd, request.app_name)
            except Exception:
                # Provider exception text could contain page data. This stays
                # a fixed local diagnostic, without exception telemetry.
                result = WindowsBrowserUiaResult(None, "Windows URL provider failed.")
            with self._condition:
                if self._active is request:
                    self._active = None
                    if not self._closed and not request.expired and time.monotonic() <= request.deadline:
                        request.result = result
                    request.completed.set()
                    self._condition.notify_all()

    def close(self) -> None:
        # Do not join a provider call: the foreground caller and process exit
        # must stay bounded. The UIA module independently stops its owned host
        # at exit, including a child whose constructor is still awaiting ready.
        with self._condition:
            self._closed = True
            if self._active is not None:
                self._active.expired = True
                self._active.result = None
                self._active.completed.set()
            self._condition.notify_all()


_worker = _UrlWorker()
# Registered after importing UIA, so LIFO exit first invalidates the sample,
# then UIA terminates any still-running owned subprocess without its read lock.
atexit.register(_worker.close)


def close_browser_capture() -> None:
    """Retire the active sample before stopping its separately owned UIA host.

    Daemon cooperative stop calls this explicitly; the existing atexit hooks
    repeat the same idempotent cleanup when the interpreter returns normally.
    """
    _worker.close()
    _close_host()


def read_browser_url_with_budget(
    hwnd: int,
    app_name: str | None,
    timeout_seconds: float = _URL_SAMPLE_BUDGET_SECONDS,
) -> WindowsBrowserUiaResult:
    if sys.platform != "win32" or not is_live_uia_browser(app_name):
        return WindowsBrowserUiaResult(None, "Windows UIA is not applicable.")
    if timeout_seconds <= 0:
        return WindowsBrowserUiaResult(None, "Windows URL capture has no remaining sample time budget.")
    return _worker.read(hwnd, app_name, min(_URL_SAMPLE_BUDGET_SECONDS, timeout_seconds))
