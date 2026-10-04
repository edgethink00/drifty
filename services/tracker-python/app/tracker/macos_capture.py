"""Native app identity and one bounded, disposable result per Mac sample.

Optional context never owns the caller's Snapshot or database. There is no
queue or result cache: an expired result cannot be reused by a later sample.
"""
from __future__ import annotations

import atexit
import json
import subprocess
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from app.tracker.capture_contract import Snapshot
from app.tracker.chatgpt_session import packaged_helper_path

# Keep the existing AppleScript allowance for the complete optional sample,
# instead of granting that allowance again to every fallback read.
CAPTURE_TIMEOUT_SECONDS = 3.0
IDENTITY_TIMEOUT_SECONDS = 0.5


@dataclass(frozen=True)
class FrontmostApplication:
    app_name: str
    bundle_id: str | None
    pid: int


def read_frontmost_application(*, timeout: float = IDENTITY_TIMEOUT_SECONDS,
                               helper_path: Path | None = None,
                               run_command: Callable[..., str] | None = None) -> FrontmostApplication | None:
    # Never compile at capture time. Source-only runs and damaged/old packages
    # retain the existing provider when this packaged capability is absent.
    helper = helper_path or packaged_helper_path()
    if helper is None or timeout <= 0:
        return None
    try:
        command = [str(helper), '--frontmost-app']
        if run_command is not None:
            output = run_command(command, timeout=min(timeout, IDENTITY_TIMEOUT_SECONDS))
        else:
            result = subprocess.run(
                command, capture_output=True, text=True,
                encoding='utf-8', errors='replace', check=False,
                timeout=min(timeout, IDENTITY_TIMEOUT_SECONDS),
            )
            if result.returncode != 0:
                return None
            output = result.stdout
        data = json.loads(output)
    except (OSError, RuntimeError, subprocess.TimeoutExpired, ValueError):
        return None
    if not isinstance(data, dict) or data.get('version') != 1:
        return None
    name, bundle, pid = data.get('app_name'), data.get('bundle_id'), data.get('pid')
    if not isinstance(name, str) or not name.strip():
        return None
    if not isinstance(pid, int) or isinstance(pid, bool) or pid <= 0:
        return None
    if bundle is not None and not isinstance(bundle, str):
        return None
    return FrontmostApplication(name.strip(), bundle.strip() or None if bundle else None, pid)


class CommandScope:
    """Cancel only this sample's owned helpers, including on one-shot exit."""
    def __init__(self, deadline: float) -> None:
        self.deadline = deadline
        self._lock = threading.Lock()
        self._closed = False
        self._children: set[subprocess.Popen] = set()

    def run(self, command: list[str], *, timeout: float) -> str:
        with self._lock:
            if self._closed or time.monotonic() >= self.deadline:
                raise RuntimeError('Optional Mac context sample expired.')
        # Process creation itself cannot be interrupted by a Python timeout.
        # Register immediately afterwards and kill if cancellation raced spawn.
        with subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              text=True, encoding='utf-8', errors='replace') as child:
            with self._lock:
                self._children.add(child)
                if self._closed:
                    child.kill()
            try:
                stdout, stderr = child.communicate(timeout=max(0.0, min(timeout, self.deadline - time.monotonic())))
                if child.returncode != 0:
                    raise RuntimeError(stderr.strip() or 'Optional Mac context helper failed.')
                return stdout.strip()
            except subprocess.TimeoutExpired as error:
                child.kill()
                child.wait()
                raise RuntimeError('Optional Mac context helper timed out.') from error
            except BaseException:
                child.kill()
                child.wait()
                raise
            finally:
                with self._lock:
                    self._children.discard(child)

    def close(self) -> None:
        with self._lock:
            self._closed = True
            for child in self._children:
                try:
                    child.kill()
                except ProcessLookupError:
                    pass


@dataclass
class _Request:
    capture: Callable[[Callable[[], bool]], Snapshot | None]
    deadline: float
    cancel: Callable[[], None]
    completed: threading.Event = field(default_factory=threading.Event)
    expired: bool = False
    result: Snapshot | None = None


class ContextWorker:
    def __init__(self) -> None:
        self._condition = threading.Condition()
        self._active: _Request | None = None
        self._thread: threading.Thread | None = None
        self._closed = False

    def read(self, capture: Callable[[Callable[[], bool]], Snapshot | None], *, deadline: float,
             cancel: Callable[[], None] = lambda: None) -> Snapshot | None:
        with self._condition:
            if self._closed or self._active is not None or time.monotonic() >= deadline:
                return None
            request = _Request(capture, deadline, cancel)
            self._active = request
            if self._thread is None:
                self._thread = threading.Thread(target=self._run, name='Drifty-Mac-Context', daemon=True)
                try:
                    self._thread.start()
                except RuntimeError:
                    self._active = None
                    self._thread = None
                    return None
            self._condition.notify()
        request.completed.wait(max(0.0, deadline - time.monotonic()))
        with self._condition:
            result = request.result
            request.result = None
            request.expired = True
            request.cancel()
            return result if not self._closed and time.monotonic() <= deadline else None

    def _allowed(self, request: _Request) -> bool:
        with self._condition:
            return not self._closed and not request.expired and time.monotonic() < request.deadline

    def _run(self) -> None:
        while True:
            with self._condition:
                while self._active is None and not self._closed:
                    self._condition.wait()
                if self._closed:
                    return
                request = self._active
            result = None
            if self._allowed(request):
                try:
                    result = request.capture(lambda: self._allowed(request))
                except Exception:
                    # Optional provider failures do not invalidate app identity.
                    # Never log exception text that could contain window data.
                    pass
            with self._condition:
                if self._active is request:
                    self._active = None
                    if self._allowed(request):
                        request.result = result
                    request.completed.set()
                    self._condition.notify_all()

    def close(self) -> None:
        with self._condition:
            self._closed = True
            if self._active is not None:
                self._active.expired = True
                self._active.result = None
                self._active.cancel()
                self._active.completed.set()
            self._condition.notify_all()


context_worker = ContextWorker()
atexit.register(context_worker.close)
