"""Optional periodic work owned by one tracker daemon, off its capture loop."""
from __future__ import annotations

import sys
import threading
import traceback
from pathlib import Path

from app.sentry_setup import capture_tracker_exception
from app.storage.db import TrackerDatabase
from app.tracker.dev_signals.ingest import IngestCancelled, ingest_agent_sessions


class DaemonMaintenance:
    def __init__(self, db_path: Path, *, backfill_days: int, max_files: int):
        self._db_path = db_path
        self._backfill_days = backfill_days
        self._max_files = max_files
        self._condition = threading.Condition()
        self._stop = threading.Event()
        self._pending: set[str] = set()
        self._thread: threading.Thread | None = None

    def request_backup(self) -> None:
        self._request("backup")

    def request_agent_ingest(self) -> None:
        self._request("agents")

    def _request(self, task: str) -> None:
        with self._condition:
            if self._stop.is_set():
                return
            # At most one pending request per task, even if a slow pass spans
            # several windows. No executor queue or additional worker can grow.
            self._pending.add(task)
            if self._thread is None:
                thread = threading.Thread(target=self._run, name="tracker-maintenance", daemon=True)
                thread.start()
                self._thread = thread
            self._condition.notify()

    def close(self) -> None:
        with self._condition:
            self._stop.set()
            self._pending.clear()
            self._condition.notify()
        if self._thread is not None:
            # File/SQLite calls may be blocked in the OS. This daemon thread
            # cannot outlive the tracker process, and must not hold up Stop or
            # owner-exit cleanup. A completed DB transaction stays committed;
            # process exit rolls back an unfinished transaction normally.
            self._thread.join(timeout=0.2)

    def _run(self) -> None:
        db = None
        try:
            while not self._stop.is_set():
                with self._condition:
                    self._condition.wait_for(lambda: self._stop.is_set() or self._pending)
                    if self._stop.is_set():
                        return
                    pending, self._pending = self._pending, set()
                for task in ("backup", "agents"):
                    if task not in pending or self._stop.is_set():
                        continue
                    try:
                        if db is None:
                            # Never share the sampling connection across threads.
                            # Recovery/startup maintenance already ran in daemon.
                            db = TrackerDatabase(self._db_path, perform_maintenance=False)
                            db.connect().set_progress_handler(lambda: int(self._stop.is_set()), 1000)
                        if self._stop.is_set():
                            return
                        if task == "backup":
                            db.create_periodic_backup()
                        else:
                            ingest_agent_sessions(db, backfill_days=self._backfill_days,
                                                  max_files=self._max_files,
                                                  cancelled=self._stop.is_set)
                    except IngestCancelled:
                        return
                    except Exception as exc:
                        if not self._stop.is_set():
                            phase = "database_periodic_backup" if task == "backup" else "dev_signals_periodic_ingest"
                            capture_tracker_exception(exc, {"phase": phase})
                            print(f"tracker {phase} failed:", file=sys.stderr)
                            traceback.print_exc(file=sys.stderr)
        finally:
            if db is not None:
                db.connect().set_progress_handler(None, 0)
                db.close()
