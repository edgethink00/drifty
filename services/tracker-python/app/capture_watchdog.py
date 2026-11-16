"""Bounded self-retirement for a blocked OS snapshot, never for storage work.

The native owner recovers only after process identity inspection confirms exit.
This watchdog never signals another PID and never reads or changes activity rows.
"""
from __future__ import annotations

import json
import math
import os
import threading
import time
from contextlib import contextmanager
from pathlib import Path

TIMEOUT_SECONDS = 120
POLL_SECONDS = 5
MAX_POLL_GAP_SECONDS = 20
WINDOW_SECONDS = 3600
MAX_RETIREMENTS = 3


class CaptureWatchdog:
    def __init__(self, database: Path, allowed, *, clock=time.monotonic,
                 wall_clock=time.time, retire=None):
        self.path = database.parent / ".state" / "tracker.capture-recovery.json"
        self.allowed = allowed
        self.clock = clock
        self.wall_clock = wall_clock
        self.retire = retire if retire is not None else lambda: os._exit(75)
        self.lock = threading.Lock()
        self.stop_event = threading.Event()
        self.started_at = None
        self.last_poll = clock()
        self.thread = None

    def start(self):
        self.thread = threading.Thread(target=self._run, name="capture-watchdog", daemon=True)
        try:
            self.thread.start()
        except (OSError, RuntimeError):
            self.thread = None
            return None
        return self

    @contextmanager
    def snapshot(self):
        with self.lock:
            self.started_at = self.clock()
        try:
            yield
        finally:
            with self.lock:
                self.started_at = None

    def _claim_attempt(self):
        # The sole daemon lock serializes writers. An unreadable or malformed
        # budget fails closed; restarting cannot fix a full/unwritable volume.
        try:
            now = self.wall_clock()
            if not math.isfinite(now) or now < 0:
                return False
            if self.path.exists():
                with self.path.open("rb") as stream:
                    raw = stream.read(1025)
                if len(raw) > 1024:
                    return False
                value = json.loads(raw)
                attempts = value["attempts"]
                if value["version"] != 1 or not isinstance(attempts, list):
                    return False
                if len(attempts) > MAX_RETIREMENTS or any(
                    type(t) not in (int, float) or not 0 <= t <= now for t in attempts
                ):
                    return False
                attempts = [t for t in attempts if now - t < WINDOW_SECONDS]
            else:
                attempts = []
            if len(attempts) >= MAX_RETIREMENTS:
                return False
            # Atomic receipt helper uses an owner-only temporary file. Unlike
            # telemetry, this write must succeed before retirement is allowed.
            import tempfile
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(mode="w", dir=self.path.parent,
                                                 prefix=".capture-recovery-", delete=False) as stream:
                    temporary = Path(stream.name)
                    json.dump({"version": 1, "attempts": attempts + [now]}, stream)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(temporary, self.path)
            finally:
                if temporary is not None:
                    temporary.unlink(missing_ok=True)
            return True
        except (OSError, ValueError, TypeError, KeyError):
            return False

    def check(self):
        with self.lock:
            now = self.clock()
            gap = now - self.last_poll
            self.last_poll = now
            if self.started_at is None:
                return False
            # Sleep or a suspended/starved process is not a blocked API. Start
            # a fresh observation window after any discontinuity.
            if gap < 0 or gap > MAX_POLL_GAP_SECONDS:
                self.started_at = now
                return False
            if now - self.started_at < TIMEOUT_SECONDS or not self.allowed():
                return False
            if not self._claim_attempt() or not self.allowed():
                return False
            # Hold the phase lock through self-exit. The sampling thread cannot
            # leave snapshot() and enter a DB transaction between check/exit.
            self.started_at = None
            self.retire()
            return True

    def _run(self):
        while not self.stop_event.wait(POLL_SECONDS):
            self.check()

    def close(self):
        self.stop_event.set()
        if self.thread is not None:
            self.thread.join(timeout=POLL_SECONDS)
