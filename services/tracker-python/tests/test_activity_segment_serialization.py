import json
import subprocess
import sys
import unittest
from datetime import datetime
from pathlib import Path
from tempfile import TemporaryDirectory

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.storage.db import TrackerDatabase


class ActivitySegmentSerializationTests(unittest.TestCase):
    def test_serializer_imports_with_system_python(self) -> None:
        system_python = Path("/usr/bin/python3")
        if not system_python.exists():
            self.skipTest("/usr/bin/python3 is not available on this platform")

        script = (
            "import sys;"
            f"sys.path.insert(0, {str(SERVICE_ROOT)!r});"
            "import app.storage.activity_segment_serialization"
        )
        result = subprocess.run(
            [str(system_python), "-c", script],
            capture_output=True,
            text=True,
            check=False,
        )

        self.assertEqual(result.returncode, 0, result.stderr)

    def test_fetch_timeline_includes_browser_automation_diagnostics(self) -> None:
        started_at = "2026-06-13T00:00:00+00:00"
        with TemporaryDirectory() as tempdir:
            database = TrackerDatabase(Path(tempdir) / "tracker.sqlite3")
            database.insert_segment(
                {
                    "started_at": started_at,
                    "ended_at": "2026-06-13T00:05:00+00:00",
                    "duration_seconds": 300,
                    "app_name": "Google Chrome",
                    "bundle_id": "com.google.Chrome",
                    "window_title": "Chrome",
                    "browser_name": "Google Chrome",
                    "site_source": None,
                    "platform": "macos",
                    "source": "accessibility",
                    "confidence": 1.0,
                    "raw_context_json": json.dumps(
                        {
                            "browser_automation_status": "empty_result",
                            "browser_automation_error": "Google Chrome returned an empty browser automation result.",
                        }
                    ),
                }
            )

            local_day = datetime.fromisoformat(started_at).astimezone().date().isoformat()
            segment = database.fetch_timeline(local_day)[0]

        self.assertEqual(segment["browserAutomationStatus"], "empty_result")
        self.assertEqual(segment["browserAutomationError"], "Google Chrome returned an empty browser automation result.")


if __name__ == "__main__":
    unittest.main()
