import json
import sqlite3
import subprocess
import sys
import unittest
from contextlib import closing
from datetime import datetime
from pathlib import Path
from tempfile import TemporaryDirectory

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.storage.db import TrackerDatabase, fetch_row_dicts
from app.tracker.macos_workspace import Snapshot
from tests.support_cleanup import temp_dir_closing_databases


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
        with temp_dir_closing_databases() as tempdir:
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

    def test_full_and_compact_timeline_include_passive_engagement_evidence(self) -> None:
        started_at = "2026-06-13T00:00:00+00:00"
        with temp_dir_closing_databases() as tempdir:
            database = TrackerDatabase(Path(tempdir) / "tracker.sqlite3")
            database.insert_segment(
                {
                    "started_at": started_at,
                    "ended_at": "2026-06-13T00:05:00+00:00",
                    "duration_seconds": 300,
                    "app_name": "Google Chrome",
                    "bundle_id": "com.google.Chrome",
                    "window_title": "Audio review",
                    "platform": "macos",
                    "source": "accessibility",
                    "confidence": 1.0,
                    "engagement_evidence": "foreground-audio",
                    "raw_context_json": json.dumps({"engagement_evidence": "foreground-audio"}),
                }
            )

            local_day = datetime.fromisoformat(started_at).astimezone().date().isoformat()
            full = database.fetch_timeline(local_day)[0]
            compact = database.dashboard_week_timeline(
                "2026-06-12T00:00:00+00:00",
                "2026-06-14T00:00:00+00:00",
            )[0]

        self.assertEqual(full["engagementEvidence"], "foreground-audio")
        self.assertEqual(compact["engagementEvidence"], "foreground-audio")

    def test_segments_recorded_under_an_executable_name_show_the_canonical_app(self) -> None:
        # Before the tracker canonicalized Firefox-family names, System Events
        # recorded them as "firefox", "zen", and "floorp". Those rows must share
        # one app row with segments recorded afterwards.
        rows = [
            ("firefox", "org.mozilla.firefox", "Firefox"),
            ("zen", "app.zen-browser.zen", "Zen"),
            ("floorp", "app.floorp.Floorp", "Floorp"),
            ("Firefox", "org.mozilla.firefox", "Firefox"),
            ("firefox", None, "firefox"),
            ("Google Chrome", "com.google.Chrome", "Google Chrome"),
        ]
        with temp_dir_closing_databases() as tempdir:
            database = TrackerDatabase(Path(tempdir) / "tracker.sqlite3")
            for index, (app_name, bundle_id, _) in enumerate(rows):
                database.insert_segment(
                    {
                        "started_at": f"2026-06-13T00:{index:02d}:00+00:00",
                        "ended_at": f"2026-06-13T00:{index:02d}:30+00:00",
                        "duration_seconds": 30,
                        "app_name": app_name,
                        "bundle_id": bundle_id,
                        "platform": "macos",
                        "source": "accessibility",
                        "confidence": 1.0,
                    }
                )

            local_day = datetime.fromisoformat("2026-06-13T00:00:00+00:00").astimezone().date().isoformat()
            full = database.fetch_timeline(local_day)
            compact = database.dashboard_week_timeline(
                "2026-06-12T00:00:00+00:00",
                "2026-06-14T00:00:00+00:00",
            )
            trend = database.project_trend_timeline(
                "2026-06-12T00:00:00+00:00",
                "2026-06-14T00:00:00+00:00",
            )
            with database.connect() as connection:
                stored = sorted(row[0] for row in connection.execute("SELECT app_name FROM activity_segments"))

        expected = sorted(display for _, _, display in rows)
        for serialized in (full, compact, trend):
            self.assertEqual(sorted(item["appName"] for item in serialized), expected)
        # Stored history keeps what was captured.
        self.assertEqual(stored, sorted(app_name for app_name, _, _ in rows))

    def test_windows_segments_recorded_under_an_executable_name_show_the_browser(self) -> None:
        # Windows capture named unknown executables after their stem, so Zen
        # and Floorp were stored as "zen" and "floorp". Rows are matched on the
        # stored executable path, and any other stored name is left alone.
        rows = [
            ("zen", r"c:\program files\zen browser\zen.exe", "Zen"),
            ("floorp", r"c:\program files\ablaze floorp\floorp.exe", "Floorp"),
            ("Zen", r"c:\program files\zen browser\zen.exe", "Zen"),
            ("Firefox", r"c:\users\qa\desktop\tor browser\browser\firefox.exe", "Tor Browser"),
            ("Firefox", r"c:\program files\mozilla firefox\firefox.exe", "Firefox"),
            ("notepad", r"c:\windows\system32\notepad.exe", "notepad"),
            ("Renamed App", r"c:\program files\zen browser\zen.exe", "Renamed App"),
            ("zen", "Some.Package_abc!App", "zen"),
        ]
        with temp_dir_closing_databases() as tempdir:
            database = TrackerDatabase(Path(tempdir) / "tracker.sqlite3")
            for index, (app_name, bundle_id, _) in enumerate(rows):
                database.insert_segment(
                    {
                        "started_at": f"2026-06-13T00:{index:02d}:00+00:00",
                        "ended_at": f"2026-06-13T00:{index:02d}:30+00:00",
                        "duration_seconds": 30,
                        "app_name": app_name,
                        "bundle_id": bundle_id,
                        "platform": "windows",
                        "source": "win32-foreground",
                        "confidence": 1.0,
                    }
                )
            local_day = datetime.fromisoformat("2026-06-13T00:00:00+00:00").astimezone().date().isoformat()
            full = database.fetch_timeline(local_day)

        self.assertEqual(sorted(item["appName"] for item in full), sorted(display for _, _, display in rows))

    def test_raw_context_cannot_claim_passive_engagement_evidence(self) -> None:
        started_at = "2026-06-13T00:00:00+00:00"
        with temp_dir_closing_databases() as tempdir:
            database = TrackerDatabase(Path(tempdir) / "tracker.sqlite3")
            database.insert_segment(
                {
                    "started_at": started_at,
                    "ended_at": "2026-06-13T00:05:00+00:00",
                    "duration_seconds": 300,
                    "app_name": "Untrusted Context",
                    "platform": "macos",
                    "source": "accessibility",
                    "raw_context_json": json.dumps({"engagement_evidence": "foreground-audio"}),
                }
            )

            local_day = datetime.fromisoformat(started_at).astimezone().date().isoformat()
            segment = database.fetch_timeline(local_day)[0]

        self.assertNotIn("engagementEvidence", segment)

    def test_fetch_timeline_includes_browser_history_diagnostics(self) -> None:
        started_at = "2026-06-13T00:00:00+00:00"
        with temp_dir_closing_databases() as tempdir:
            database = TrackerDatabase(Path(tempdir) / "tracker.sqlite3")
            database.insert_segment(
                {
                    "started_at": started_at,
                    "ended_at": "2026-06-13T00:05:00+00:00",
                    "duration_seconds": 300,
                    "app_name": "Google Chrome",
                    "browser_name": "Google Chrome",
                    "site_source": "browser-history-title",
                    "platform": "macos",
                    "source": "accessibility",
                    "confidence": 0.45,
                    "raw_context_json": json.dumps(
                        {
                            "browser_history_status": "matched",
                            "browser_history_reason": "matched",
                            "browser_history_database_found": True,
                            "browser_history_profile_count": 1,
                            "browser_history_candidate_count": 7,
                            "browser_history_error_count": 0,
                        }
                    ),
                }
            )

            local_day = datetime.fromisoformat(started_at).astimezone().date().isoformat()
            segment = database.fetch_timeline(local_day)[0]

        self.assertEqual(segment["browserHistoryStatus"], "matched")
        self.assertEqual(segment["browserHistoryReason"], "matched")
        self.assertTrue(segment["browserHistoryDatabaseFound"])
        self.assertEqual(segment["browserHistoryProfileCount"], 1)
        self.assertEqual(segment["browserHistoryCandidateCount"], 7)
        self.assertEqual(segment["browserHistoryErrorCount"], 0)

    def test_fetch_timeline_includes_frontmost_capture_diagnostics(self) -> None:
        started_at = "2026-06-13T00:00:00+00:00"
        with temp_dir_closing_databases() as tempdir:
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
        with temp_dir_closing_databases() as tempdir:
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
        with temp_dir_closing_databases() as tempdir:
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
        with temp_dir_closing_databases() as tempdir:
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

class FetchRowDictsTests(unittest.TestCase):
    def test_matches_sqlite_row_dicts_and_leaves_the_connection_row_factory_alone(self) -> None:
        with temp_dir_closing_databases() as tempdir:
            database = TrackerDatabase(Path(tempdir) / "tracker.sqlite3")
            for index in range(3):
                database.insert_segment(
                    {
                        "started_at": f"2026-06-13T00:{index:02d}:00+00:00",
                        "ended_at": f"2026-06-13T00:{index:02d}:30+00:00",
                        "duration_seconds": 30,
                        "app_name": "Code",
                        "bundle_id": None if index == 1 else "com.example.code",
                        "platform": "macos",
                        "source": "accessibility",
                        "confidence": 1.0,
                    }
                )
            query = """
                SELECT activity_segments.*, activity_classifications.category AS classification_category
                FROM activity_segments
                LEFT JOIN activity_classifications ON activity_classifications.segment_id = activity_segments.id
                WHERE activity_segments.duration_seconds >= ?
                ORDER BY activity_segments.started_at ASC
            """
            with database.connect() as connection:
                expected = [dict(row) for row in connection.execute(query, (30,)).fetchall()]
                actual = fetch_row_dicts(connection, query, (30,))
                self.assertIsInstance(connection.execute("SELECT 1 AS one").fetchone(), sqlite3.Row)

        self.assertEqual(len(actual), 3)
        self.assertEqual(actual, expected)
        self.assertEqual([list(row) for row in actual], [list(row) for row in expected])

    def test_keeps_the_first_value_of_a_repeated_column_name_like_sqlite_row(self) -> None:
        with closing(sqlite3.connect(":memory:")) as connection:
            connection.row_factory = sqlite3.Row
            query = "SELECT 1 AS a, 2 AS b, 3 AS a"
            expected = [dict(row) for row in connection.execute(query).fetchall()]
            actual = fetch_row_dicts(connection, query, ())

        self.assertEqual(expected, [{"a": 1, "b": 2}])
        self.assertEqual(actual, expected)



if __name__ == "__main__":
    unittest.main()
