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
from app.tracker.macos_workspace import Snapshot


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

    def test_fetch_timeline_includes_frontmost_capture_diagnostics(self) -> None:
        started_at = "2026-06-13T00:00:00+00:00"
        with TemporaryDirectory() as tempdir:
            database = TrackerDatabase(Path(tempdir) / "tracker.sqlite3")
            database.insert_segment(
                {
                    "started_at": started_at,
                    "ended_at": "2026-06-13T00:05:00+00:00",
                    "duration_seconds": 300,
                    "app_name": "Unavailable",
                    "bundle_id": None,
                    "window_title": None,
                    "platform": "macos",
                    "source": "nsworkspace",
                    "confidence": 1.0,
                    "raw_context_json": json.dumps(
                        {
                            "frontmost_capture_source": "unavailable",
                            "frontmost_capture_error": "osascript timed out",
                            "frontmost_fallback_error": "lsappinfo info returned no parseable app name.",
                        }
                    ),
                }
            )

            local_day = datetime.fromisoformat(started_at).astimezone().date().isoformat()
            segment = database.fetch_timeline(local_day)[0]

        self.assertEqual(segment["frontmostCaptureSource"], "unavailable")
        self.assertEqual(segment["frontmostCaptureError"], "osascript timed out")
        self.assertEqual(segment["frontmostFallbackError"], "lsappinfo info returned no parseable app name.")

    def test_record_snapshot_persists_frontmost_capture_diagnostics(self) -> None:
        started_at = "2026-06-13T00:00:00+00:00"
        with TemporaryDirectory() as tempdir:
            database = TrackerDatabase(Path(tempdir) / "tracker.sqlite3")
            database.record_snapshot(
                Snapshot(
                    observed_at=started_at,
                    app_name="Google Chrome",
                    bundle_id="com.google.Chrome",
                    window_title=None,
                    source="nsworkspace",
                    browser_name="Google Chrome",
                    browser_automation_status="unavailable",
                    browser_automation_error="Google Chrome automation denied",
                    frontmost_capture_source="lsappinfo",
                    frontmost_capture_error="System Events denied",
                    frontmost_fallback_error=None,
                ),
                sample_seconds=5,
            )

            local_day = datetime.fromisoformat(started_at).astimezone().date().isoformat()
            segment = database.fetch_timeline(local_day)[0]

        self.assertEqual(segment["appName"], "Google Chrome")
        self.assertEqual(segment["bundleId"], "com.google.Chrome")
        self.assertEqual(segment["frontmostCaptureSource"], "lsappinfo")
        self.assertEqual(segment["frontmostCaptureError"], "System Events denied")
        self.assertIsNone(segment["frontmostFallbackError"])
        self.assertEqual(segment["browserAutomationStatus"], "unavailable")
        self.assertEqual(segment["browserAutomationError"], "Google Chrome automation denied")

    def test_fetch_timeline_hides_uncertain_front_fallback_site_context(self) -> None:
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
                    "window_title": "Lecture - YouTube - Chrome - Alex",
                    "site_domain": "127.0.0.1",
                    "site_title": "drifty — AI Time Tracker for Focus & Drift",
                    "site_url": "http://127.0.0.1:4173/?v=drifty",
                    "browser_name": "Google Chrome",
                    "site_source": "applescript-front-window",
                    "platform": "macos",
                    "source": "accessibility",
                    "confidence": 0.5,
                }
            )

            local_day = datetime.fromisoformat(started_at).astimezone().date().isoformat()
            segment = database.fetch_timeline(local_day)[0]

        self.assertIsNone(segment["siteDomain"])
        self.assertIsNone(segment["siteTitle"])
        self.assertIsNone(segment["siteUrl"])
        self.assertEqual(segment["windowTitle"], "Lecture - YouTube - Chrome - Alex")

    def test_fetch_timeline_hides_front_fallback_site_context_without_window_title(self) -> None:
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
                    "window_title": None,
                    "site_domain": "127.0.0.1",
                    "site_title": "drifty — AI Time Tracker for Focus & Drift",
                    "site_url": "http://127.0.0.1:4173/?v=drifty",
                    "browser_name": "Google Chrome",
                    "site_source": "applescript-front-window",
                    "platform": "macos",
                    "source": "nsworkspace",
                    "confidence": 0.8,
                }
            )

            local_day = datetime.fromisoformat(started_at).astimezone().date().isoformat()
            segment = database.fetch_timeline(local_day)[0]

        self.assertIsNone(segment["siteDomain"])
        self.assertIsNone(segment["siteTitle"])
        self.assertIsNone(segment["siteUrl"])


if __name__ == "__main__":
    unittest.main()
