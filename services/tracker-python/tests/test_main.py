import hashlib
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import MagicMock, patch

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app import main as tracker_main
from app.storage.db import TrackerDatabase
from app.storage.live_tail import fetch_live_tail
from app.tracker.adaptive_context import developer_diagnostics
from app.tracker.macos_workspace import Snapshot
from app.tracker.power_state import PowerStateSample


class TrackerMainTests(unittest.TestCase):
    def test_day_bounds_supports_day_payload(self) -> None:
        start, end = tracker_main.day_bounds({"day": "2026-04-06"})
        self.assertEqual(start, "2026-04-06T00:00:00")
        self.assertEqual(end, "2026-04-06T23:59:59")

    def test_day_bounds_supports_start_end_payload(self) -> None:
        start, end = tracker_main.day_bounds({"start": "2026-04-01T00:00:00", "end": "2026-04-07T23:59:59"})
        self.assertEqual(start, "2026-04-01T00:00:00")
        self.assertEqual(end, "2026-04-07T23:59:59")

    def test_start_tracking_forwards_db_path_to_daemon(self) -> None:
        with TemporaryDirectory() as tmp:
            tracker_main.DB_PATH = Path(tmp) / "tracker.sqlite3"
            with patch.object(tracker_main, "is_running", return_value=False), patch.object(
                tracker_main, "get_status", return_value={"data": {"running": False}}
            ), patch("app.main.time.sleep"), patch("app.main.subprocess.Popen") as popen:
                tracker_main.start_tracking()
                args = popen.call_args.args[0]
                self.assertIn("--db", args)
                self.assertIn(str(tracker_main.DB_PATH), args)

    def test_start_tracking_builds_source_daemon_command(self) -> None:
        with TemporaryDirectory() as tmp:
            tracker_main.DB_PATH = Path(tmp) / "tracker.sqlite3"

            with patch.object(sys, "executable", "/usr/bin/python3"), patch.object(
                sys, "frozen", False, create=True
            ), patch.object(tracker_main, "is_running", return_value=False), patch.object(
                tracker_main, "get_status", return_value={"data": {"running": True}}
            ), patch("app.main.time.sleep"), patch("app.main.subprocess.Popen") as popen:
                tracker_main.start_tracking()

        self.assertEqual(
            popen.call_args.args[0],
            [
                "/usr/bin/python3",
                tracker_main._current_script_path(),
                "daemon",
                "--db",
                str(tracker_main.DB_PATH),
            ],
        )

    def test_start_tracking_builds_frozen_daemon_command(self) -> None:
        with TemporaryDirectory() as tmp:
            tracker_main.DB_PATH = Path(tmp) / "tracker.sqlite3"

            with patch.object(sys, "executable", "/Applications/Drifty.app/Contents/MacOS/drifty-tracker"), patch.object(
                sys, "frozen", True, create=True
            ), patch.object(tracker_main, "is_running", return_value=False), patch.object(
                tracker_main, "get_status", return_value={"data": {"running": True}}
            ), patch("app.main.time.sleep"), patch("app.main.subprocess.Popen") as popen:
                tracker_main.start_tracking()

        self.assertEqual(
            popen.call_args.args[0],
            [
                "/Applications/Drifty.app/Contents/MacOS/drifty-tracker",
                "daemon",
                "--db",
                str(tracker_main.DB_PATH),
            ],
        )

    def test_start_tracking_reports_failure_when_daemon_does_not_start(self) -> None:
        with TemporaryDirectory() as tmp:
            tracker_main.DB_PATH = Path(tmp) / "tracker.sqlite3"
            with patch.object(tracker_main, "is_running", return_value=False), patch.object(
                tracker_main, "get_status", return_value={"data": {"running": False}}
            ), patch("app.main.time.sleep"), patch("app.main.subprocess.Popen"):
                result = tracker_main.start_tracking()

        self.assertFalse(result["ok"])
        self.assertIs(result["data"]["running"], False)
        self.assertIn("did not start", result["error"])

    def test_start_tracking_replaces_source_daemon_when_current_runtime_is_frozen(self) -> None:
        with TemporaryDirectory() as tmp:
            tracker_main.DB_PATH = Path(tmp) / "tracker.sqlite3"
            tracker_main.state_dir().mkdir(parents=True)
            tracker_main.pid_path().write_text("12345")
            source_command = f"/usr/bin/python3 {tracker_main._current_script_path()} daemon --db {tracker_main.DB_PATH}"

            with patch.object(sys, "frozen", True, create=True), patch.object(
                sys, "executable", "/Applications/Drifty.app/Contents/MacOS/drifty-tracker"
            ), patch.object(tracker_main, "is_running", return_value=True), patch.object(
                tracker_main, "_process_command", return_value=source_command
            ), patch("app.main.os.kill") as kill, patch("app.main.time.sleep"), patch(
                "app.main.subprocess.Popen"
            ) as popen, patch.object(
                tracker_main, "get_status", return_value={"data": {"running": True}}
            ):
                tracker_main.start_tracking()

        kill.assert_called_once_with(12345, tracker_main.signal.SIGTERM)
        self.assertEqual(
            popen.call_args.args[0],
            [
                "/Applications/Drifty.app/Contents/MacOS/drifty-tracker",
                "daemon",
                "--db",
                str(tracker_main.DB_PATH),
            ],
        )

    def test_start_tracking_recognizes_current_frozen_sidecar_daemon(self) -> None:
        with TemporaryDirectory() as tmp:
            tracker_main.DB_PATH = Path(tmp) / "tracker.sqlite3"
            tracker_main.state_dir().mkdir(parents=True)
            tracker_main.pid_path().write_text("12345")
            mock_db = MagicMock()
            mock_db.get_meta.return_value = "same-runtime"
            sidecar_command = f"/Applications/Drifty.app/Contents/MacOS/drifty-tracker daemon --db {tracker_main.DB_PATH}"

            with patch.object(sys, "frozen", True, create=True), patch.object(
                sys, "executable", "/Applications/Drifty.app/Contents/MacOS/drifty-tracker"
            ), patch.object(tracker_main, "is_running", return_value=True), patch.object(
                tracker_main, "_process_command", return_value=sidecar_command
            ), patch.object(tracker_main, "database", return_value=mock_db), patch.object(
                tracker_main, "_tracker_runtime_fingerprint", return_value="same-runtime"
            ), patch("app.main.os.kill") as kill, patch("app.main.subprocess.Popen") as popen, patch.object(
                tracker_main, "get_status", return_value={"data": {"running": True}}
            ):
                result = tracker_main.start_tracking()

        self.assertTrue(result["ok"])
        mock_db.get_meta.assert_called_once_with(tracker_main.TRACKER_RUNTIME_FINGERPRINT_META_KEY)
        kill.assert_not_called()
        popen.assert_not_called()

    def test_start_tracking_replaces_stale_packaged_daemon(self) -> None:
        with TemporaryDirectory() as tmp:
            tracker_main.DB_PATH = Path(tmp) / "tracker.sqlite3"
            state_dir = tracker_main.state_dir()
            state_dir.mkdir(parents=True)
            tracker_main.pid_path().write_text("12345")
            stale_command = "/Applications/Drifty.app/Contents/Resources/_up_/services/tracker-python/app/main.py daemon"
            with patch.object(tracker_main, "is_running", return_value=True), patch.object(
                tracker_main, "_process_command", return_value=stale_command
            ), patch("app.main.os.kill") as kill, patch("app.main.time.sleep"), patch(
                "app.main.subprocess.Popen"
            ) as popen, patch.object(tracker_main, "get_status", return_value={"data": {"running": True}}):
                tracker_main.start_tracking()

        kill.assert_called_once_with(12345, tracker_main.signal.SIGTERM)
        popen.assert_called_once()

    def test_start_tracking_replaces_same_path_daemon_when_runtime_fingerprint_differs(self) -> None:
        with TemporaryDirectory() as tmp:
            tracker_main.DB_PATH = Path(tmp) / "tracker.sqlite3"
            tracker_main.state_dir().mkdir(parents=True)
            tracker_main.pid_path().write_text("12345")
            mock_db = MagicMock()
            mock_db.get_meta.return_value = "old-runtime"
            current_command = f"{sys.executable} {tracker_main._current_script_path()} daemon --db {tracker_main.DB_PATH}"

            with patch.object(tracker_main, "is_running", return_value=True), patch.object(
                tracker_main, "_process_command", return_value=current_command
            ), patch.object(tracker_main, "database", return_value=mock_db), patch.object(
                tracker_main, "_tracker_runtime_fingerprint", return_value="new-runtime"
            ), patch("app.main.os.kill") as kill, patch("app.main.time.sleep"), patch(
                "app.main.subprocess.Popen"
            ) as popen, patch.object(tracker_main, "get_status", return_value={"data": {"running": True}}):
                tracker_main.start_tracking()

        mock_db.get_meta.assert_called_once_with(tracker_main.TRACKER_RUNTIME_FINGERPRINT_META_KEY)
        kill.assert_called_once_with(12345, tracker_main.signal.SIGTERM)
        popen.assert_called_once()

    def test_start_tracking_keeps_same_path_daemon_when_runtime_fingerprint_matches(self) -> None:
        with TemporaryDirectory() as tmp:
            tracker_main.DB_PATH = Path(tmp) / "tracker.sqlite3"
            tracker_main.state_dir().mkdir(parents=True)
            tracker_main.pid_path().write_text("12345")
            mock_db = MagicMock()
            mock_db.get_meta.return_value = "same-runtime"
            current_command = f"{sys.executable} {tracker_main._current_script_path()} daemon --db {tracker_main.DB_PATH}"

            with patch.object(tracker_main, "is_running", return_value=True), patch.object(
                tracker_main, "_process_command", return_value=current_command
            ), patch.object(tracker_main, "database", return_value=mock_db), patch.object(
                tracker_main, "_tracker_runtime_fingerprint", return_value="same-runtime"
            ), patch("app.main.os.kill") as kill, patch("app.main.subprocess.Popen") as popen, patch.object(
                tracker_main, "get_status", return_value={"data": {"running": True}}
            ):
                result = tracker_main.start_tracking()

        self.assertTrue(result["ok"])
        mock_db.get_meta.assert_called_once_with(tracker_main.TRACKER_RUNTIME_FINGERPRINT_META_KEY)
        kill.assert_not_called()
        popen.assert_not_called()

    def test_frozen_runtime_fingerprint_changes_with_executable_bytes(self) -> None:
        with TemporaryDirectory() as tmp:
            executable = Path(tmp) / "drifty-tracker"
            executable.write_bytes(b"sidecar-v1")

            with patch.object(sys, "frozen", True, create=True), patch.object(sys, "executable", str(executable)):
                first = tracker_main._tracker_runtime_fingerprint()
                expected = hashlib.sha256(
                    b"frozen\0" + str(executable).encode("utf-8") + b"\0" + b"sidecar-v1"
                ).hexdigest()
                executable.write_bytes(b"sidecar-v2")
                second = tracker_main._tracker_runtime_fingerprint()

        self.assertEqual(first, expected)
        self.assertNotEqual(first, second)

    def test_frozen_runtime_fingerprint_uses_stat_fallback_when_executable_read_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            executable = Path(tmp) / "drifty-tracker"
            executable.write_bytes(b"sidecar")

            with patch.object(sys, "frozen", True, create=True), patch.object(
                sys, "executable", str(executable)
            ), patch("pathlib.Path.read_bytes", side_effect=OSError("denied")):
                fingerprint = tracker_main._tracker_runtime_fingerprint()
                executable_stat = executable.stat()
                expected = hashlib.sha256(
                    b"frozen\0"
                    + str(executable).encode("utf-8")
                    + b"\0"
                    + b"read-error:OSError\0"
                    + f"{executable_stat.st_size}:{executable_stat.st_mtime_ns}".encode("utf-8")
                ).hexdigest()

        self.assertEqual(fingerprint, expected)

    def test_source_runtime_fingerprint_hashes_python_sources(self) -> None:
        with TemporaryDirectory() as tmp:
            app_dir = Path(tmp)
            source_file = app_dir / "main.py"
            nested_source = app_dir / "tracker" / "monitor.py"
            ignored_source = app_dir / "__pycache__" / "main.py"
            nested_source.parent.mkdir()
            ignored_source.parent.mkdir()
            source_file.write_bytes(b"print('main')\n")
            nested_source.write_bytes(b"print('monitor')\n")
            ignored_source.write_bytes(b"print('ignored')\n")
            non_python = app_dir / "README.md"
            non_python.write_text("ignored")

            expected_digest = hashlib.sha256()
            expected_digest.update(b"source\0")
            for path in [source_file, nested_source]:
                expected_digest.update(str(path.relative_to(app_dir)).encode("utf-8"))
                expected_digest.update(b"\0")
                expected_digest.update(path.read_bytes())
                expected_digest.update(b"\0")

            with patch.object(sys, "frozen", False, create=True), patch.object(tracker_main, "APP_DIR", app_dir):
                first = tracker_main._tracker_runtime_fingerprint()
                ignored_source.write_bytes(b"ignored change")
                second = tracker_main._tracker_runtime_fingerprint()
                nested_source.write_bytes(b"print('changed')\n")
                third = tracker_main._tracker_runtime_fingerprint()

        self.assertEqual(first, expected_digest.hexdigest())
        self.assertEqual(first, second)
        self.assertNotEqual(first, third)

    def test_get_current_snapshot_returns_camel_case_payload_without_recording(self) -> None:
        snapshot = Snapshot(
            observed_at="2026-04-06T09:00:00+00:00",
            app_name="cmux",
            bundle_id="dev.cmux",
            window_title="workspace",
            source="accessibility",
            browser_automation_status="not_applicable",
            browser_history_status="no_readable_database",
            browser_history_reason="missing_database",
            browser_history_database_found=False,
            browser_history_profile_count=0,
            browser_history_candidate_count=0,
            browser_history_error_count=0,
        )

        with patch.object(tracker_main, "current_snapshot", return_value=snapshot):
            result = tracker_main.get_current_snapshot()

        self.assertTrue(result["ok"])
        self.assertEqual(result["data"]["observedAt"], snapshot.observed_at)
        self.assertEqual(result["data"]["appName"], "cmux")
        self.assertEqual(result["data"]["bundleId"], "dev.cmux")
        self.assertEqual(result["data"]["browserAutomationStatus"], "not_applicable")
        self.assertIsNone(result["data"]["browserAutomationError"])
        self.assertEqual(result["data"]["browserHistoryStatus"], "no_readable_database")
        self.assertEqual(result["data"]["browserHistoryReason"], "missing_database")
        self.assertFalse(result["data"]["browserHistoryDatabaseFound"])
        self.assertEqual(result["data"]["browserHistoryProfileCount"], 0)
        self.assertEqual(result["data"]["browserHistoryCandidateCount"], 0)
        self.assertEqual(result["data"]["browserHistoryErrorCount"], 0)

    def test_get_current_snapshot_does_not_initialize_missing_database(self) -> None:
        snapshot = Snapshot(
            observed_at="2026-04-06T09:00:00+00:00",
            app_name="cmux",
            bundle_id="dev.cmux",
            window_title="workspace",
            source="accessibility",
            browser_automation_status="not_applicable",
        )

        with TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "tracker.sqlite3"
            with patch.object(tracker_main, "DB_PATH", db_path), patch.object(
                tracker_main, "current_snapshot", return_value=snapshot
            ), patch.dict(tracker_main.os.environ, {}, clear=True):
                result = tracker_main.get_current_snapshot()

                self.assertTrue(result["ok"])
                self.assertFalse(db_path.exists())
                self.assertEqual(tracker_main.os.environ[tracker_main.FORCE_CHROMIUM_AX_CAPTURE_ENV], "0")
                self.assertEqual(tracker_main.os.environ[tracker_main.FORCE_FRONTMOST_FALLBACK_CAPTURE_ENV], "0")
                self.assertEqual(tracker_main.os.environ[tracker_main.FORCE_BROWSER_HISTORY_URL_FALLBACK_ENV], "0")

    def test_get_timeline_uses_day_filter(self) -> None:
        mock_db = MagicMock()
        mock_db.fetch_timeline.return_value = []
        with patch.object(tracker_main, "database", return_value=mock_db):
            tracker_main.get_timeline({"day": "2026-04-06"})
        mock_db.fetch_timeline.assert_called_once_with("2026-04-06")

    def test_get_timeline_uses_range_filter(self) -> None:
        mock_db = MagicMock()
        mock_db.timeline.return_value = []
        with patch.object(tracker_main, "database", return_value=mock_db):
            tracker_main.get_timeline({"start": "2026-04-01T00:00:00", "end": "2026-04-07T23:59:59"})
        mock_db.timeline.assert_called_once_with("2026-04-01T00:00:00", "2026-04-07T23:59:59")

    def test_get_timeline_page_forwards_range_cursor_and_limit(self) -> None:
        mock_db = MagicMock()
        mock_db.timeline_page.return_value = {
            "items": [{"id": "42"}],
            "hasMore": True,
            "nextCursor": {
                "beforeEndedAt": "2026-04-06T09:05:00+00:00",
                "beforeSegmentId": "42",
            },
        }

        with patch.object(tracker_main, "database", return_value=mock_db):
            result = tracker_main.get_timeline_page({
                "start": "2026-04-01T00:00:00",
                "end": "2026-04-07T23:59:59",
                "beforeEndedAt": "2026-04-06T09:05:00+00:00",
                "beforeSegmentId": "42",
                "limit": 200,
            })

        self.assertTrue(result["ok"])
        self.assertEqual(result["data"]["items"], [{"id": "42"}])
        mock_db.timeline_page.assert_called_once_with(
            start="2026-04-01T00:00:00",
            end="2026-04-07T23:59:59",
            before_ended_at="2026-04-06T09:05:00+00:00",
            before_segment_id="42",
            limit=200,
        )

    def test_search_timeline_forwards_query_range_cursor_and_limit(self) -> None:
        mock_db = MagicMock()
        mock_db.search_timeline_page.return_value = {
            "items": [{"id": "42"}],
            "hasMore": True,
            "nextCursor": {
                "beforeEndedAt": "2026-04-06T09:05:00+00:00",
                "beforeSegmentId": "42",
            },
        }

        with patch.object(tracker_main, "database", return_value=mock_db):
            result = tracker_main.search_timeline({
                "query": "arc project",
                "start": "2026-04-01T00:00:00",
                "end": "2026-04-07T23:59:59",
                "beforeEndedAt": "2026-04-06T09:05:00+00:00",
                "beforeSegmentId": "42",
                "limit": 200,
            })

        self.assertTrue(result["ok"])
        self.assertEqual(result["data"]["items"], [{"id": "42"}])
        mock_db.search_timeline_page.assert_called_once_with(
            query="arc project",
            start="2026-04-01T00:00:00",
            end="2026-04-07T23:59:59",
            before_ended_at="2026-04-06T09:05:00+00:00",
            before_segment_id="42",
            limit=200,
        )

    def test_search_timeline_non_dict_payload_uses_blank_query(self) -> None:
        mock_db = MagicMock()
        mock_db.search_timeline_page.return_value = {"items": [], "hasMore": False, "nextCursor": None}

        with patch.object(tracker_main, "database", return_value=mock_db):
            result = tracker_main.search_timeline("not a payload")

        self.assertTrue(result["ok"])
        self.assertEqual(result["data"], {"items": [], "hasMore": False, "nextCursor": None})
        mock_db.search_timeline_page.assert_called_once_with(
            query="",
            start=None,
            end=None,
            before_ended_at=None,
            before_segment_id=None,
            limit=None,
        )

    def test_get_dashboard_week_timeline_uses_compact_range_filter(self) -> None:
        mock_db = MagicMock()
        mock_db.dashboard_week_timeline.return_value = []
        mock_db.timeline.side_effect = AssertionError("dashboard week should use compact timeline")

        with patch.object(tracker_main, "database", return_value=mock_db):
            result = tracker_main.get_dashboard_week_timeline({
                "start": "2026-04-01T00:00:00",
                "end": "2026-04-07T23:59:59",
            })

        self.assertTrue(result["ok"])
        mock_db.dashboard_week_timeline.assert_called_once_with("2026-04-01T00:00:00", "2026-04-07T23:59:59")
        mock_db.timeline.assert_not_called()

    def test_get_live_tail_reads_database_tail_without_snapshot_capture(self) -> None:
        mock_db = MagicMock()
        mock_db.get_meta.side_effect = lambda key, default=None: {
            "tracker_mode": "tracking",
            "last_event_at": "2026-04-06T09:10:00+00:00",
        }.get(key, default)

        with patch.object(tracker_main, "database", return_value=mock_db), patch.object(
            tracker_main, "fetch_live_tail", return_value=[{"id": "42"}]
        ) as fetch, patch.object(tracker_main, "is_running", return_value=True), patch.object(
            tracker_main, "current_snapshot"
        ) as snapshot:
            result = tracker_main.get_live_tail({
                "start": "2026-04-06T00:00:00",
                "end": "2026-04-06T23:59:59",
                "afterSegmentId": "42",
                "afterEndedAt": "2026-04-06T09:05:00+00:00",
                "limit": 8,
            })

        self.assertTrue(result["ok"])
        self.assertTrue(result["data"]["running"])
        self.assertEqual(result["data"]["trackerMode"], "tracking")
        self.assertEqual(result["data"]["lastEventAt"], "2026-04-06T09:10:00+00:00")
        self.assertEqual(result["data"]["segments"], [{"id": "42"}])
        fetch.assert_called_once_with(
            mock_db,
            "2026-04-06T00:00:00",
            "2026-04-06T23:59:59",
            "42",
            "2026-04-06T09:05:00+00:00",
            8,
        )
        snapshot.assert_not_called()

    def test_fetch_live_tail_returns_updated_cursor_segment(self) -> None:
        with TemporaryDirectory() as tmp:
            db = TrackerDatabase(Path(tmp) / "tracker.sqlite3")
            with db.connect() as conn:
                conn.execute(
                    """
                    INSERT INTO activity_segments(
                      started_at, ended_at, duration_seconds, app_name, platform, source
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    ("2026-04-06T09:00:00+00:00", "2026-04-06T09:05:00+00:00", 300, "Mail", "macos", "accessibility"),
                )
                conn.execute(
                    """
                    INSERT INTO activity_segments(
                      started_at, ended_at, duration_seconds, app_name, platform, source
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    ("2026-04-06T09:05:00+00:00", "2026-04-06T09:10:00+00:00", 300, "Drifty", "macos", "accessibility"),
                )

            rows = fetch_live_tail(
                db,
                "2026-04-06T00:00:00+00:00",
                "2026-04-06T23:59:59+00:00",
                "2",
                "2026-04-06T09:09:00+00:00",
                8,
            )

        self.assertEqual([row["id"] for row in rows], ["2"])
        self.assertEqual(rows[0]["appName"], "Drifty")

    def test_get_top_sites_uses_range_aggregate(self) -> None:
        mock_db = MagicMock()
        mock_db.top_sites.return_value = []
        mock_db.timeline.side_effect = AssertionError("range top sites should aggregate in SQL")

        with patch.object(tracker_main, "database", return_value=mock_db):
            result = tracker_main.get_top_sites({
                "start": "2026-04-01T00:00:00",
                "end": "2026-04-07T23:59:59",
                "limit": 8,
            })

        self.assertTrue(result["ok"])
        mock_db.top_sites.assert_called_once_with("2026-04-01T00:00:00", "2026-04-07T23:59:59", 8)
        mock_db.timeline.assert_not_called()

    def test_get_reusable_ai_classifications_returns_json_serializable_mapping(self) -> None:
        mock_db = MagicMock()
        mock_db.get_reusable_ai_classifications.return_value = {
            "fp-one": {
                "segmentId": "1",
                "inputFingerprint": "fp-one",
                "category": "workspace",
                "productivity": "focus",
                "source": "llm",
                "confidence": 0.9,
                "reason": "Prior result",
                "aiResult": True,
                "stale": False,
            }
        }

        with patch.object(tracker_main, "database", return_value=mock_db):
            result = tracker_main.get_reusable_ai_classifications({"inputFingerprints": ["fp-one", 3, "fp-two"]})

        self.assertTrue(result["ok"])
        self.assertEqual(result["data"]["fp-one"]["segmentId"], "1")
        mock_db.get_reusable_ai_classifications.assert_called_once_with(["fp-one", "fp-two"])

    def test_classification_rule_handlers_forward_to_database(self) -> None:
        mock_db = MagicMock()
        mock_db.get_classification_rules.return_value = []
        mock_db.save_classification_rule.return_value = {"id": "rule-1"}
        mock_db.delete_classification_rule.return_value = 1
        mock_db.search_classification_rule_candidates.return_value = [{"id": "app:Linear"}]
        mock_db.apply_classification_rules.return_value = {"matchedCount": 1, "appliedCount": 1, "skippedCount": 0}

        with patch.object(tracker_main, "database", return_value=mock_db):
            rules = tracker_main.get_classification_rules({})
            saved = tracker_main.save_classification_rule({"input": {"targetKind": "app", "targetValue": "Linear"}})
            deleted = tracker_main.delete_classification_rule({"id": "rule-1"})
            candidates = tracker_main.search_classification_rule_candidates({"query": "lin", "targetKind": "app"})
            applied = tracker_main.apply_classification_rules({"start": "2026-04-06T00:00:00", "end": "2026-04-07T00:00:00"})

        self.assertTrue(rules["ok"])
        self.assertEqual(saved["data"]["id"], "rule-1")
        self.assertEqual(deleted["data"]["deleted"], 1)
        self.assertEqual(candidates["data"][0]["id"], "app:Linear")
        self.assertEqual(applied["data"]["appliedCount"], 1)
        mock_db.save_classification_rule.assert_called_once_with({"targetKind": "app", "targetValue": "Linear"})
        mock_db.delete_classification_rule.assert_called_once_with("rule-1")
        mock_db.search_classification_rule_candidates.assert_called_once_with("lin", target_kind="app")
        mock_db.apply_classification_rules.assert_called_once_with("2026-04-06T00:00:00", "2026-04-07T00:00:00")

    def test_set_developer_diagnostics_persists_frontmost_fallback_capture_flag(self) -> None:
        mock_db = MagicMock()

        with patch.object(tracker_main, "database", return_value=mock_db), patch.object(
            developer_diagnostics, "apply_developer_diagnostics_env"
        ) as apply_env:
            result = tracker_main.set_developer_diagnostics({
                "forceChromiumAxCapture": True,
                "forceFrontmostFallbackCapture": True,
                "forceBrowserHistoryUrlFallback": True,
                "enhancedContextEnabled": True,
                "enhancedContextCaptureLocal": False,
                "enhancedContextSourceFamilies": ["document_knowledge", "calendar_meeting"],
            })

        self.assertTrue(result["ok"])
        self.assertEqual(
            result["data"],
            {
                "forceChromiumAxCapture": True,
                "forceFrontmostFallbackCapture": True,
                "forceBrowserHistoryUrlFallback": True,
                "enhancedContextEnabled": True,
                "enhancedContextCaptureLocal": False,
                "enhancedContextSourceFamilies": ["document_knowledge", "calendar_meeting"],
            },
        )
        mock_db.set_meta.assert_any_call(tracker_main.FORCE_CHROMIUM_AX_CAPTURE_META_KEY, "true")
        mock_db.set_meta.assert_any_call(tracker_main.FORCE_FRONTMOST_FALLBACK_CAPTURE_META_KEY, "true")
        mock_db.set_meta.assert_any_call(tracker_main.FORCE_BROWSER_HISTORY_URL_FALLBACK_META_KEY, "true")
        mock_db.set_meta.assert_any_call(tracker_main.ENHANCED_CONTEXT_ENABLED_META_KEY, "true")
        mock_db.set_meta.assert_any_call(tracker_main.ENHANCED_CONTEXT_CAPTURE_LOCAL_META_KEY, "false")
        mock_db.set_meta.assert_any_call(
            tracker_main.ENHANCED_CONTEXT_SOURCE_FAMILIES_META_KEY,
            "document_knowledge,calendar_meeting",
        )
        apply_env.assert_called_once_with(mock_db)

    def test_apply_developer_diagnostics_env_sets_frontmost_fallback_capture_env(self) -> None:
        mock_db = MagicMock()
        mock_db.get_meta.side_effect = lambda key, default=None: {
            tracker_main.FORCE_CHROMIUM_AX_CAPTURE_META_KEY: "false",
            tracker_main.FORCE_FRONTMOST_FALLBACK_CAPTURE_META_KEY: "true",
            tracker_main.FORCE_BROWSER_HISTORY_URL_FALLBACK_META_KEY: "true",
        }.get(key, default)

        with patch.dict(tracker_main.os.environ, {}, clear=True):
            tracker_main._apply_developer_diagnostics_env(mock_db)

            self.assertEqual(tracker_main.os.environ[tracker_main.FORCE_CHROMIUM_AX_CAPTURE_ENV], "0")
            self.assertEqual(tracker_main.os.environ[tracker_main.FORCE_FRONTMOST_FALLBACK_CAPTURE_ENV], "1")
            self.assertEqual(tracker_main.os.environ[tracker_main.FORCE_BROWSER_HISTORY_URL_FALLBACK_ENV], "1")
            self.assertEqual(tracker_main.os.environ[tracker_main.ENABLE_ADAPTIVE_CONTEXT_CAPTURE_ENV], "0")
            self.assertEqual(tracker_main.os.environ[tracker_main.ADAPTIVE_CONTEXT_SOURCE_FAMILIES_ENV], "")

    def test_apply_developer_diagnostics_env_sets_enhanced_context_capture_env(self) -> None:
        mock_db = MagicMock()
        mock_db.get_meta.side_effect = lambda key, default=None: {
            tracker_main.ENHANCED_CONTEXT_ENABLED_META_KEY: "true",
            tracker_main.ENHANCED_CONTEXT_CAPTURE_LOCAL_META_KEY: "true",
            tracker_main.ENHANCED_CONTEXT_SOURCE_FAMILIES_META_KEY: "document_knowledge,unknown,calendar_meeting",
        }.get(key, default)

        with patch.dict(tracker_main.os.environ, {}, clear=True):
            tracker_main._apply_developer_diagnostics_env(mock_db)

            self.assertEqual(tracker_main.os.environ[tracker_main.ENABLE_ADAPTIVE_CONTEXT_CAPTURE_ENV], "1")
            self.assertEqual(
                tracker_main.os.environ[tracker_main.ADAPTIVE_CONTEXT_SOURCE_FAMILIES_ENV],
                "document_knowledge,calendar_meeting",
            )

    def test_delete_activity_segments_forwards_string_ids_to_database(self) -> None:
        mock_db = MagicMock()
        mock_db.delete_activity_segments.return_value = 2

        with patch.object(tracker_main, "database", return_value=mock_db):
            result = tracker_main.delete_activity_segments({"ids": ["1", 2, "3", None]})

        self.assertTrue(result["ok"])
        self.assertEqual(result["data"]["deleted"], 2)
        mock_db.delete_activity_segments.assert_called_once_with(["1", "3"])

    def test_delete_history_range_forwards_payload_to_database(self) -> None:
        mock_db = MagicMock()
        mock_db.delete_history_range.return_value = {
            "activitySegments": 3,
            "classifications": 2,
            "youtubeMetadata": 1,
            "dryRun": True,
        }

        with patch.object(tracker_main, "database", return_value=mock_db):
            result = tracker_main.delete_history_range(
                {
                    "start": "2026-04-01",
                    "end": "2026-04-06",
                    "scopes": {"activity": True, "aiClassifications": False, "youtubeMetadata": True},
                    "dryRun": True,
                }
            )

        self.assertTrue(result["ok"])
        self.assertEqual(
            result["data"],
            {"activitySegments": 3, "classifications": 2, "youtubeMetadata": 1, "dryRun": True},
        )
        mock_db.delete_history_range.assert_called_once_with(
            start="2026-04-01",
            end="2026-04-06",
            scopes={"activity": True, "aiClassifications": False, "youtubeMetadata": True},
            dry_run=True,
        )

    def test_delete_history_range_defaults_to_all_time_real_delete(self) -> None:
        mock_db = MagicMock()
        mock_db.delete_history_range.return_value = {
            "activitySegments": 0,
            "classifications": 0,
            "youtubeMetadata": 0,
            "dryRun": False,
        }

        with patch.object(tracker_main, "database", return_value=mock_db):
            result = tracker_main.delete_history_range(
                {"scopes": {"activity": True, "aiClassifications": True, "youtubeMetadata": True}}
            )

        self.assertTrue(result["ok"])
        mock_db.delete_history_range.assert_called_once_with(
            start=None,
            end=None,
            scopes={"activity": True, "aiClassifications": True, "youtubeMetadata": True},
            dry_run=False,
        )

    def test_delete_history_range_requires_scopes_object(self) -> None:
        mock_db = MagicMock()

        with patch.object(tracker_main, "database", return_value=mock_db):
            result = tracker_main.delete_history_range({"start": "2026-04-01"})

        self.assertFalse(result["ok"])
        mock_db.delete_history_range.assert_not_called()

    def test_handle_idle_sample_trims_and_skips_when_threshold_reached(self) -> None:
        mock_db = MagicMock()
        now = datetime(2026, 4, 6, 9, 5, tzinfo=timezone.utc)

        should_skip = tracker_main.handle_idle_sample(mock_db, 181.25, now=now, threshold_seconds=180)

        self.assertTrue(should_skip)
        mock_db.trim_latest_segment.assert_called_once_with((now - timedelta(seconds=181.25)).isoformat())
        mock_db.set_meta.assert_any_call("idle_detection_available", "true")
        mock_db.set_meta.assert_any_call("idle_seconds", "181.250")
        mock_db.set_meta.assert_any_call("tracker_mode", "idle")

    def test_handle_idle_sample_keeps_tracking_when_idle_unavailable(self) -> None:
        mock_db = MagicMock()

        should_skip = tracker_main.handle_idle_sample(mock_db, None, threshold_seconds=180)

        self.assertFalse(should_skip)
        mock_db.set_meta.assert_called_once_with("idle_detection_available", "false")
        mock_db.trim_latest_segment.assert_not_called()

    def test_handle_idle_sample_keeps_tracking_below_threshold(self) -> None:
        mock_db = MagicMock()

        should_skip = tracker_main.handle_idle_sample(mock_db, 42.0, threshold_seconds=180)

        self.assertFalse(should_skip)
        mock_db.set_meta.assert_any_call("idle_detection_available", "true")
        mock_db.set_meta.assert_any_call("idle_seconds", "42.000")
        mock_db.trim_latest_segment.assert_not_called()

    def test_handle_power_state_sample_trims_and_skips_when_suppressed(self) -> None:
        mock_db = MagicMock()
        observed_at = datetime(2026, 4, 6, 9, 5, tzinfo=timezone.utc)
        power_state = PowerStateSample(
            observed_at=observed_at,
            should_capture=False,
            reason="non_user_visible_wake_type:darkwake",
        )

        should_skip = tracker_main.handle_power_state_sample(mock_db, power_state)

        self.assertTrue(should_skip)
        mock_db.trim_latest_segment.assert_called_once_with(observed_at.isoformat())
        mock_db.set_meta.assert_any_call("tracker_mode", "suppressed")
        mock_db.set_meta.assert_any_call("capture_suppressed_reason", "non_user_visible_wake_type:darkwake")
        mock_db.set_meta.assert_any_call("last_capture_suppressed_at", observed_at.isoformat())

    def test_handle_power_state_sample_keeps_tracking_when_capture_allowed(self) -> None:
        mock_db = MagicMock()
        power_state = PowerStateSample(
            observed_at=datetime(2026, 4, 6, 9, 5, tzinfo=timezone.utc),
            should_capture=True,
            reason="active_power_state",
        )

        should_skip = tracker_main.handle_power_state_sample(mock_db, power_state)

        self.assertFalse(should_skip)
        mock_db.trim_latest_segment.assert_not_called()
        mock_db.set_meta.assert_not_called()

    def test_sample_seconds_since_previous_uses_default_for_first_capture(self) -> None:
        self.assertEqual(tracker_main.sample_seconds_since_previous(None, 12.0, default_seconds=5), 5)

    def test_sample_seconds_since_previous_accounts_for_delayed_loop(self) -> None:
        self.assertEqual(tracker_main.sample_seconds_since_previous(10.0, 17.4, default_seconds=5), 7)

    def test_sample_seconds_since_previous_keeps_minimum_interval(self) -> None:
        self.assertEqual(tracker_main.sample_seconds_since_previous(10.0, 12.0, default_seconds=5), 5)

    def test_daemon_skips_idle_and_snapshot_when_power_state_suppressed(self) -> None:
        with TemporaryDirectory() as tmp:
            tracker_main.DB_PATH = Path(tmp) / "tracker.sqlite3"
            mock_db = MagicMock()
            power_state = PowerStateSample(
                observed_at=datetime(2026, 4, 6, 9, 5, tzinfo=timezone.utc),
                should_capture=False,
                reason="non_user_visible_wake_type:darkwake",
            )
            with patch.object(tracker_main, "database", return_value=mock_db), patch.object(
                tracker_main, "current_power_state", return_value=power_state
            ), patch.object(tracker_main, "seconds_since_last_input") as idle, patch.object(
                tracker_main, "current_snapshot"
            ) as snapshot, patch.object(
                tracker_main.time, "sleep", side_effect=KeyboardInterrupt
            ):
                with self.assertRaises(KeyboardInterrupt):
                    tracker_main.daemon()

        idle.assert_not_called()
        snapshot.assert_not_called()
        mock_db.trim_latest_segment.assert_called_once_with(power_state.observed_at.isoformat())
        mock_db.set_meta.assert_any_call("tracker_mode", "suppressed")

    def test_daemon_records_runtime_fingerprint_on_start(self) -> None:
        with TemporaryDirectory() as tmp:
            tracker_main.DB_PATH = Path(tmp) / "tracker.sqlite3"
            mock_db = MagicMock()
            power_state = PowerStateSample(
                observed_at=datetime(2026, 4, 6, 9, 5, tzinfo=timezone.utc),
                should_capture=False,
                reason="non_user_visible_wake_type:darkwake",
            )
            with patch.object(tracker_main, "database", return_value=mock_db), patch.object(
                tracker_main, "_tracker_runtime_fingerprint", return_value="runtime-fp"
            ), patch.object(tracker_main, "current_power_state", return_value=power_state), patch.object(
                tracker_main.time, "sleep", side_effect=KeyboardInterrupt
            ):
                with self.assertRaises(KeyboardInterrupt):
                    tracker_main.daemon()

        mock_db.set_meta.assert_any_call(tracker_main.TRACKER_RUNTIME_FINGERPRINT_META_KEY, "runtime-fp")

    def test_enqueue_youtube_metadata_fetch_skips_cached_video(self) -> None:
        with TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "tracker.sqlite3"
            mock_db = MagicMock()
            mock_db.youtube_metadata_should_fetch.return_value = False
            with patch.object(tracker_main, "TrackerDatabase", return_value=mock_db), patch(
                "app.main.threading.Thread"
            ) as thread:
                tracker_main.enqueue_youtube_metadata_fetch(
                    db_path,
                    "abc123",
                    "https://www.youtube.com/watch?v=abc123",
                )

        thread.assert_not_called()

    def test_enqueue_youtube_metadata_fetch_starts_background_worker(self) -> None:
        with TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "tracker.sqlite3"
            mock_db = MagicMock()
            mock_db.youtube_metadata_should_fetch.return_value = True
            with patch.object(tracker_main, "TrackerDatabase", return_value=mock_db), patch(
                "app.main.threading.Thread"
            ) as thread:
                tracker_main.enqueue_youtube_metadata_fetch(
                    db_path,
                    "abc123",
                    "https://www.youtube.com/watch?v=abc123",
                )

        thread.return_value.start.assert_called_once()
        tracker_main._YOUTUBE_METADATA_IN_FLIGHT.discard("abc123")

    def test_serve_processes_requests_echoes_id_and_survives_errors(self) -> None:
        import io
        import json

        requests = "\n".join(
            [
                json.dumps({"id": 1, "command": "ping", "payload": {"value": 7}}),
                "",  # blank line should be skipped, not break the loop
                json.dumps({"id": 2, "command": "does_not_exist", "payload": {}}),
                json.dumps({"command": "ping", "payload": {}}),  # no id -> no id echoed
            ]
        )
        stub_commands = {"ping": lambda payload: tracker_main.response(True, payload)}
        out = io.StringIO()
        with patch.object(tracker_main, "COMMANDS", stub_commands), patch.object(
            tracker_main.sys, "stdin", io.StringIO(requests)
        ), patch.object(tracker_main.sys, "stdout", out):
            tracker_main.serve()

        lines = [line for line in out.getvalue().splitlines() if line]
        self.assertEqual(len(lines), 3)

        first = json.loads(lines[0])
        self.assertTrue(first["ok"])
        self.assertEqual(first["data"], {"value": 7})
        self.assertEqual(first["id"], 1)

        # An unknown command returns an error envelope but does NOT kill the loop.
        second = json.loads(lines[1])
        self.assertFalse(second["ok"])
        self.assertEqual(second["id"], 2)
        self.assertIsNotNone(second["error"])

        # A request without an id gets no id field echoed back.
        third = json.loads(lines[2])
        self.assertTrue(third["ok"])
        self.assertNotIn("id", third)


if __name__ == "__main__":
    unittest.main()
