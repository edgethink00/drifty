"""Keep slow Windows URL enrichment out of foreground app sampling.

There is one worker and one in-flight request per tracker process, without a
queue or a URL cache. Cold UIA may finish warming after a sample's deadline;
that result is discarded and a later sample must read its own live Document.
The worker never receives or mutates the caller's Snapshot.

Optional page-clue reads share that worker, so a clue read and a URL read never
overlap in the UIA host.

The anonymous public description (D) lookup uses its own single-flight worker:
it waits on the network, never on the UIA host, and a blocked resolver must not
delay the next URL read.
"""

from __future__ import annotations

import atexit
import ssl
import sys
import threading
import time
from dataclasses import dataclass, field
from typing import Callable

from app.tracker.windows_browser_uia import (
    WindowsBrowserCluesResult,
    WindowsBrowserUiaResult,
    _close_host,
    is_live_uia_browser,
    read_live_browser_clues,
    read_live_browser_url,
)


# Warm measured reads fit in this allowance. A cold provider keeps warming in
# the single worker, while this sample retains only verified app context.
_URL_SAMPLE_BUDGET_SECONDS = 0.25
# Page clues use at most the macOS helper's 620ms reader deadline, and leave
# time for the host reply to cross the pipe before this sample's deadline.
_CLUES_SAMPLE_BUDGET_SECONDS = 0.65
_CLUES_TRANSIT_SECONDS = 0.08
_CLUES_MIN_READER_MS = 100
_CLUES_MAX_READER_MS = 620
# The macOS reader's own deadline; shorter remaining time is used as is.
_DESCRIPTION_MAX_SECONDS = 0.62
_DESCRIPTION_MIN_SECONDS = 0.06
# Windows installs most third-party roots only when its own verifier first needs
# one, and Chrome and Firefox verify with their own root lists, so Python can
# miss the root of a valid public site (17 of 398 study sites on a 34-root
# guest). The sidecar already bundles certifi (sentry_sdk's transport imports
# it), so the lookup also trusts those Mozilla roots. Loading the bundle costs
# about 0.2s of CPU, so the single description worker reuses one context and
# rebuilds it hourly to pick up roots Windows adds later.
_DESCRIPTION_TLS_REFRESH_SECONDS = 3600.0
_description_tls: tuple[float, ssl.SSLContext] | None = None


@dataclass
class _UrlRequest:
    generation: int
    hwnd: int
    app_name: str | None
    deadline: float
    job: Callable[[], object] | None = None
    failure: Callable[[str], object] = lambda message: WindowsBrowserUiaResult(None, message)
    label: str = "Windows URL"
    completed: threading.Event = field(default_factory=threading.Event)
    expired: bool = False
    result: object | None = None


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
        return self._submit(hwnd, app_name, timeout_seconds, None,
                            lambda message: WindowsBrowserUiaResult(None, message), "Windows URL")

    def read_clues(
        self,
        hwnd: int,
        app_name: str | None,
        timeout_seconds: float,
        job: Callable[[], WindowsBrowserCluesResult],
    ) -> WindowsBrowserCluesResult:
        return self._submit(hwnd, app_name, timeout_seconds, job,
                            lambda message: WindowsBrowserCluesResult(error=message), "Windows page clue")

    def _submit(self, hwnd, app_name, timeout_seconds, job, failure, label):
        deadline = time.monotonic() + max(0.0, timeout_seconds)
        with self._condition:
            if self._closed:
                return failure(f"{label} capture is stopped.")
            if self._active is not None:
                return failure(f"{label} capture is still busy with a previous read.")
            self._generation += 1
            request = _UrlRequest(self._generation, hwnd, app_name, deadline, job, failure, label)
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
                    return failure(f"{label} worker could not start.")
            self._condition.notify()

        request.completed.wait(max(0.0, deadline - time.monotonic()))
        with self._condition:
            # Accept only this caller's still-current, timely result. Neither
            # the worker nor the next caller can revive an expired generation.
            result = request.result
            request.result = None
            request.expired = True
            if self._closed:
                return failure(f"{label} capture is stopped.")
            if result is not None and time.monotonic() <= deadline:
                return result
            return failure(f"{label} capture exceeded this sample's time budget.")

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
                result = request.job() if request.job is not None else self._reader(request.hwnd, request.app_name)
            except Exception:
                # Provider exception text could contain page data. This stays
                # a fixed local diagnostic, without exception telemetry.
                result = request.failure(f"{request.label} provider failed.")
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
_description_worker = _UrlWorker()
atexit.register(_description_worker.close)


def close_browser_capture() -> None:
    """Retire the active sample before stopping its separately owned UIA host.

    Daemon cooperative stop calls this explicitly; the existing atexit hooks
    repeat the same idempotent cleanup when the interpreter returns normally.
    """
    _worker.close()
    _description_worker.close()
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


def read_browser_clues_with_budget(
    hwnd: int,
    app_name: str | None,
    timeout_seconds: float,
    *,
    reader: Callable[[int, str | None, int], WindowsBrowserCluesResult] = read_live_browser_clues,
) -> WindowsBrowserCluesResult:
    """Read page clues within this sample's remaining time, never past it."""
    if sys.platform != "win32" or not is_live_uia_browser(app_name):
        return WindowsBrowserCluesResult(error="Windows UIA is not applicable.")
    allowance = min(_CLUES_SAMPLE_BUDGET_SECONDS, timeout_seconds)
    reader_ms = min(_CLUES_MAX_READER_MS, int((allowance - _CLUES_TRANSIT_SECONDS) * 1000))
    if reader_ms < _CLUES_MIN_READER_MS:
        return WindowsBrowserCluesResult(error="Windows page clues have no remaining sample time budget.")
    return _worker.read_clues(hwnd, app_name, allowance, lambda: reader(hwnd, app_name, reader_ms))


def _description_tls_context(now: Callable[[], float] = time.monotonic) -> ssl.SSLContext:
    """Windows system roots plus the bundled certifi roots, reused by the description worker."""
    global _description_tls
    current = now()
    cached = _description_tls
    if cached is not None and current - cached[0] < _DESCRIPTION_TLS_REFRESH_SECONDS:
        return cached[1]
    context = ssl.create_default_context()
    try:
        import certifi

        context.load_verify_locations(cafile=certifi.where())
    except (ImportError, OSError, ssl.SSLError):
        pass  # The Windows store alone still validates most public sites.
    _description_tls = (current, context)
    return context


def _fetch_description(url: str, seconds: float) -> str | None:
    from app.tracker.browser_public_description import fetch_description

    started = time.monotonic()
    context = _description_tls_context()
    return fetch_description(url, seconds - (time.monotonic() - started), context=context)


def read_public_description_with_budget(
    url: str,
    timeout_seconds: float,
    *,
    reader: Callable[[str, float], str | None] = _fetch_description,
) -> str | None:
    """One anonymous public description lookup within this sample's remaining time.

    Uses the same bounded reader as macOS (no cookies, login, cache or proxy),
    in-process on a dedicated worker. A late or failed lookup yields None.
    """
    if sys.platform != "win32" or not timeout_seconds or timeout_seconds < _DESCRIPTION_MIN_SECONDS:
        return None
    allowance = min(_DESCRIPTION_MAX_SECONDS, timeout_seconds)
    result = _description_worker._submit(
        0, None, allowance, lambda: reader(url, max(0.01, allowance - 0.02)),
        lambda _message: None, "Windows page description",
    )
    return result if isinstance(result, str) and result else None
