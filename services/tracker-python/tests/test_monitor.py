import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.storage.db import TrackerDatabase
from app.tracker.monitor import FrontmostSnapshot, TrackerRuntime


class FakeMonitor:
    def __init__(self) -> None:
        self.snapshots = [
            FrontmostSnapshot(app_name="Code", window_title="a.ts"),
            FrontmostSnapshot(app_name="Safari", window_title="OpenAI"),
        ]
        self.index = 0

    def read(self) -> FrontmostSnapshot:
        snapshot = self.snapshots[min(self.index, len(self.snapshots) - 1)]
        self.index += 1
        return snapshot


class TrackerRuntimeTests(unittest.TestCase):
    def test_external_status_shape(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            runtime = TrackerRuntime(TrackerDatabase(Path(tmp) / "tracker.sqlite3"), monitor=FakeMonitor())
            status = runtime.build_external_status()
            self.assertIn("dbPath", status)
            self.assertEqual(status["trackerMode"], "idle")

    def test_stale_pid_is_cleaned_up(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            runtime = TrackerRuntime(TrackerDatabase(Path(tmp) / "tracker.sqlite3"), monitor=FakeMonitor())
            runtime.pid_path.write_text("999999")
            with patch("os.kill", side_effect=ProcessLookupError):
                self.assertFalse(runtime.is_running())
            self.assertFalse(runtime.pid_path.exists())

    def test_ensure_background_process_returns_when_running(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            runtime = TrackerRuntime(TrackerDatabase(Path(tmp) / "tracker.sqlite3"), monitor=FakeMonitor())
            with patch.object(runtime, "is_running", side_effect=[False, True]):
                with patch("subprocess.Popen") as popen:
                    runtime.ensure_background_process(Path("main.py"), Path(tmp) / "tracker.sqlite3")
                    popen.assert_called_once()


if __name__ == "__main__":
    unittest.main()
