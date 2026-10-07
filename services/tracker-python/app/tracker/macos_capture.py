"""Native app identity and one bounded, disposable result per Mac sample.

Optional context never owns the caller's Snapshot or database. There is no
queue or result cache: an expired result cannot be reused by a later sample.
"""
from __future__ import annotations

import atexit
import json
import os
import signal
import selectors
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
        self._termination_lock = threading.Lock()
        self._terminated: set[subprocess.Popen] = set()

    def _kill(self, child) -> None:
        # macOS can return EPERM for a second SIGKILL while the first is being
        # delivered. Serialize cancellation/timeout/exit cleanup for this owner.
        with self._termination_lock:
            if child in self._terminated:
                return
            try:
                if os.name == "posix":
                    os.killpg(child.pid, signal.SIGKILL)
                else:
                    child.kill()
            except ProcessLookupError:
                pass
            self._terminated.add(child)

    def run(self, command: list[str], *, timeout: float, cancelled=None, reply=None) -> str:
        with self._lock:
            if self._closed or time.monotonic() >= self.deadline:
                raise RuntimeError('Optional Mac context sample expired.')
        # Process creation itself cannot be interrupted by a Python timeout.
        # Register immediately afterwards and kill if cancellation raced spawn.
        with subprocess.Popen(command, stdin=subprocess.PIPE if reply else subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              text=reply is None, encoding='utf-8' if reply is None else None,
                              errors='replace' if reply is None else None, start_new_session=os.name == "posix") as child:
            with self._lock:
                self._children.add(child)
                if self._closed:
                    self._kill(child)
            try:
                until = min(time.monotonic()+timeout, self.deadline)
                if reply is not None:
                    return self._exchange(child, until, cancelled, reply)
                while True:
                    if cancelled is not None and cancelled():
                        raise RuntimeError('Optional Mac context setting changed.')
                    remaining = until-time.monotonic()
                    if remaining <= 0:
                        raise subprocess.TimeoutExpired(command, timeout)
                    try:
                        stdout, stderr = child.communicate(timeout=min(remaining, 0.02) if cancelled is not None else remaining)
                        break
                    except subprocess.TimeoutExpired:
                        if time.monotonic() >= until:
                            raise
                if child.returncode != 0:
                    raise RuntimeError(stderr.strip() or 'Optional Mac context helper failed.')
                return stdout.strip()
            except subprocess.TimeoutExpired as error:
                self._kill(child)
                child.wait()
                raise RuntimeError('Optional Mac context helper timed out.') from error
            except BaseException:
                self._kill(child)
                child.wait()
                raise
            finally:
                self._kill(child)  # Reap descendants even when the native root exited normally.
                with self._lock:
                    self._children.discard(child)
                    with self._termination_lock:
                        self._terminated.discard(child)

    def _exchange(self, child, until, cancelled, reply):
        """One native preface/reply, then the ordinary final observation.

        The callback executes in the frozen tracker, so its reader is spawned by
        that same executable. Both commands remain registered in this scope.
        """
        chunks = {child.stdout: bytearray(), child.stderr: bytearray()}
        answered = False
        with selectors.DefaultSelector() as selector:
            for stream in chunks:
                os.set_blocking(stream.fileno(), False)
                selector.register(stream, selectors.EVENT_READ)
            while selector.get_map():
                if cancelled is not None and cancelled():
                    raise RuntimeError('Optional Mac context setting changed.')
                remaining = until-time.monotonic()
                if remaining <= 0:
                    raise subprocess.TimeoutExpired(child.args, 0)
                for key, _ in selector.select(min(remaining, .02)):
                    part = os.read(key.fileobj.fileno(), 4096)
                    if not part:
                        selector.unregister(key.fileobj)
                        continue
                    chunks[key.fileobj].extend(part)
                    if len(chunks[key.fileobj]) > 16384:
                        raise RuntimeError('Optional Mac context reply exceeded its bound.')
                    if key.fileobj is child.stdout and not answered and b'\n' in chunks[child.stdout]:
                        line, _, rest = chunks[child.stdout].partition(b'\n')
                        chunks[child.stdout] = bytearray(rest)
                        response = reply(line.decode('utf-8', errors='strict'))
                        answered = True
                        if response is None:
                            # A final observation (no lookup) is also the first line.
                            chunks[child.stdout] = bytearray(line+b'\n'+rest)
                        else:
                            child.stdin.write((response+'\n').encode('utf-8'))
                            child.stdin.flush()
                        child.stdin.close()
            child.wait(timeout=max(.001, until-time.monotonic()))
        if child.returncode != 0:
            raise RuntimeError('Optional Mac context helper failed.')
        return chunks[child.stdout].decode('utf-8', errors='strict').strip()

    def close(self) -> None:
        with self._lock:
            self._closed = True
            for child in self._children:
                try:
                    self._kill(child)
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
