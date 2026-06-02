from __future__ import annotations

import json
import os
import platform
import signal
import subprocess
import sys
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from app.permissions.accessibility import has_accessibility_permission
from app.storage.db import TrackerDatabase


@dataclass
class FrontmostSnapshot:
    app_name: str
    window_title: str | None
    source: str = "nsworkspace"


class FrontmostMonitor:
    def read(self) -> FrontmostSnapshot:
        if platform.system() != "Darwin":
            return FrontmostSnapshot(app_name="Unsupported platform", window_title=None, source="manual")

        app_script = 'tell application "System Events" to get name of first application process whose frontmost is true'
        title_script = (
            'tell application "System Events" to tell (first application process whose frontmost is true) '
            'to get value of attribute "AXTitle" of front window'
        )
        app_name = self._run_script(app_script) or "Unknown app"
        window_title = self._run_script(title_script) if has_accessibility_permission() else None
        return FrontmostSnapshot(
            app_name=app_name,
            window_title=window_title,
            source="accessibility" if window_title else "nsworkspace",
        )

    @staticmethod
    def _run_script(script: str) -> str | None:
        result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True)
        if result.returncode != 0:
            return None
        output = result.stdout.strip()
        return output or None


class TrackerRuntime:
    def __init__(self, database: TrackerDatabase, monitor: FrontmostMonitor | None = None) -> None:
        self.database = database
        self.monitor = monitor or FrontmostMonitor()
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._last_snapshot: FrontmostSnapshot | None = None
        self._last_started_at: str | None = None
        self.pid_path = self.database.path.with_suffix(".pid")

    def get_timeline(self, day: str) -> list[dict[str, object]]:
        return self.database.fetch_timeline(day)

    def get_hourly_summary(self, day: str) -> list[dict[str, object]]:
        return self.database.fetch_hourly_summary(day)

    def get_raw_events(self, day: str, limit: int | None = 100) -> list[dict[str, object]]:
        return self.database.fetch_timeline(day, limit)

    def ensure_background_process(self, script_path: Path, db_path: Path) -> None:
        if self.is_running():
            return
        subprocess.Popen(
            [sys.executable, str(script_path), "--db", str(db_path), "--daemon"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
        )
        for _ in range(20):
            if self.is_running():
                return
            time.sleep(0.1)

    def run_forever(self) -> None:
        self.pid_path.write_text(str(os.getpid()))

        def _handle_signal(_signum, _frame) -> None:
            self._stop_event.set()

        signal.signal(signal.SIGTERM, _handle_signal)
        signal.signal(signal.SIGINT, _handle_signal)
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        while not self._stop_event.is_set():
            time.sleep(1)
        self._finalize_open_segment()
        self.pid_path.unlink(missing_ok=True)

    def stop_external_process(self) -> dict[str, object]:
        if self.pid_path.exists():
            try:
                pid = int(self.pid_path.read_text().strip())
                os.kill(pid, signal.SIGTERM)
            except (ProcessLookupError, ValueError):
                pass
            finally:
                self.pid_path.unlink(missing_ok=True)
        return self.build_external_status()

    def is_running(self) -> bool:
        if not self.pid_path.exists():
            return False
        try:
            pid = int(self.pid_path.read_text().strip())
            os.kill(pid, 0)
            return True
        except (OSError, ValueError):
            self.pid_path.unlink(missing_ok=True)
            return False

    def build_external_status(self) -> dict[str, object]:
        return {
            "isRunning": self.is_running(),
            "accessibilityGranted": has_accessibility_permission(),
            "lastEventAt": self.database.fetch_last_event_at(),
            "dbPath": str(self.database.path),
            "trackerMode": "tracking" if self.is_running() else "idle",
            "message": "Tracking desktop activity" if self.is_running() else "Tracker is idle",
        }

    def _loop(self) -> None:
        while not self._stop_event.is_set():
            snapshot = self.monitor.read()
            now = datetime.now(UTC).isoformat()
            if self._last_snapshot is None:
                self._last_snapshot = snapshot
                self._last_started_at = now
            elif self._snapshot_changed(snapshot, self._last_snapshot):
                self._write_segment(snapshot_end=now)
                self._last_snapshot = snapshot
                self._last_started_at = now
            time.sleep(2)

    @staticmethod
    def _snapshot_changed(current: FrontmostSnapshot, previous: FrontmostSnapshot) -> bool:
        return current.app_name != previous.app_name or current.window_title != previous.window_title

    def _finalize_open_segment(self) -> None:
        self._write_segment(snapshot_end=datetime.now(UTC).isoformat())
        self._last_snapshot = None
        self._last_started_at = None

    def _write_segment(self, snapshot_end: str) -> None:
        if not self._last_snapshot or not self._last_started_at:
            return
        started = datetime.fromisoformat(self._last_started_at)
        ended = datetime.fromisoformat(snapshot_end)
        duration = max(int((ended - started).total_seconds()), 1)
        self.database.insert_segment(
            {
                "id": str(uuid.uuid4()),
                "started_at": self._last_started_at,
                "ended_at": snapshot_end,
                "duration_seconds": duration,
                "app_name": self._last_snapshot.app_name,
                "bundle_id": None,
                "window_title": self._last_snapshot.window_title,
                "platform": "macos",
                "source": self._last_snapshot.source,
                "confidence": None,
                "raw_context_json": json.dumps({"windowTitle": self._last_snapshot.window_title}),
            }
        )
