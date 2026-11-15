"""Small local capture receipt independent of SQLite writes. Never stores activity."""
from __future__ import annotations

import json
import math
import os
import sqlite3
import tempfile
import time
import uuid
from pathlib import Path

STATES = {"starting", "recording", "idle", "suppressed", "gap", "failed"}
REASONS = {"storageFull", "storageBusy", "storageIo", "capture"}
MAX_AGE_SECONDS = 90


def health_path(database: Path) -> Path:
    return database.parent / ".state" / "tracker.capture-health.json"


def failure_reason(error: Exception) -> str:
    if isinstance(error, sqlite3.Error):
        code = getattr(error, "sqlite_errorcode", 0) & 0xFF
        message = str(error).lower()
        if code == 13 or message == "database or disk is full":
            return "storageFull"
        if code in (5, 6) or "database is locked" in message or "database table is locked" in message:
            return "storageBusy"
        return "storageIo"
    return "capture"


class CaptureHealthPublisher:
    def __init__(self, database: Path):
        self.path = health_path(database)
        self.run_id = str(uuid.uuid4())
        self.sequence = 0
        self.commits = 0
        self.last_commit_at = None
        self.state = "starting"
        self.reason = None
        self.committed_this_tick = False

    def begin_tick(self) -> None:
        self.committed_this_tick = False
        self.state = "starting"
        self.reason = None

    def recorded(self, observed_at: str) -> None:
        # Called only after record_snapshot's transaction has committed, before
        # optional enrichment/status writes that can fail independently.
        self.commits += 1
        self.last_commit_at = observed_at
        self.committed_this_tick = True
        self.state = "recording"
        self.reason = None
        self.publish()

    def outcome(self, state: str) -> None:
        if state not in STATES:
            raise ValueError("unsupported capture outcome")
        self.state = state
        self.reason = None

    def failed(self, error: Exception) -> None:
        if not self.committed_this_tick:
            self.state = "failed"
            self.reason = failure_reason(error)
        # A post-commit enrichment failure does not undo that successful capture.

    def publish(self) -> None:
        self.sequence += 1
        value = {"version": 1, "pid": os.getpid(), "runId": self.run_id,
                 "sequence": self.sequence, "commits": self.commits,
                 "lastCommitAt": self.last_commit_at, "state": self.state,
                 "reason": self.reason, "updatedAt": time.time()}
        temporary = None
        try:
            # The daemon PID publisher already owns/creates .state. Never
            # create a missing database directory to report health.
            with tempfile.NamedTemporaryFile(mode="w", dir=self.path.parent,
                                             prefix=".capture-health-", delete=False) as stream:
                temporary = Path(stream.name)
                json.dump(value, stream, separators=(",", ":"))
            os.replace(temporary, self.path)
        except OSError:
            # A full/unwritable volume can prevent the receipt too. Consumers
            # expire the old receipt; telemetry must never suppress capture.
            pass
        finally:
            if temporary is not None:
                try:
                    temporary.unlink(missing_ok=True)
                except OSError:
                    pass


def public_health(database: Path, running: bool) -> dict:
    if not running:
        return {}
    path = health_path(database)
    try:
        with path.open("rb") as stream:
            raw = stream.read(4097)
        if len(raw) > 4096:
            raise ValueError("oversized receipt")
        value = json.loads(raw)
        pid = int((path.parent / "tracker.pid").read_text())
        age = time.time() - float(value["updatedAt"])
        if (value["version"] != 1 or value["pid"] != pid or pid <= 0
                or value["state"] not in STATES or not math.isfinite(age)
                or not 0 <= age < MAX_AGE_SECONDS):
            raise ValueError("unverified receipt")
        return {"captureHealth": value["state"],
                "captureFailureReason": value.get("reason") if value.get("reason") in REASONS else None}
    except (OSError, ValueError, TypeError, KeyError):
        return {"captureHealth": "unknown", "captureFailureReason": None}
