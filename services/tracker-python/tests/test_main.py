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

    def test_start_tracking_replaces_stale_packaged_daemon(self) -> None:
        with TemporaryDirectory() as tmp:
            tracker_main.DB_PATH = Path(tmp) / "tracker.sqlite3"
            state_dir = tracker_main.state_dir()
            state_dir.mkdir(parents=True)
            tracker_main.pid_path().write_text("12345")
            stale_command = "/Applications/dtime.app/Contents/Resources/_up_/services/tracker-python/app/main.py daemon"
            with patch.object(tracker_main, "is_running", return_value=True), patch.object(
                tracker_main, "_process_command", return_value=stale_command
            ), patch("app.main.os.kill") as kill, patch("app.main.time.sleep"), patch(
                "app.main.subprocess.Popen"
            ) as popen, patch.object(tracker_main, "get_status", return_value={"data": {"running": True}}):
                tracker_main.start_tracking()

        kill.assert_called_once_with(12345, tracker_main.signal.SIGTERM)
        popen.assert_called_once()

    def test_get_current_snapshot_returns_camel_case_payload_without_recording(self) -> None:
        snapshot = Snapshot(
            observed_at="2026-04-06T09:00:00+00:00",
            app_name="cmux",
            bundle_id="dev.cmux",
            window_title="workspace",
            source="accessibility",
        )

        with patch.object(tracker_main, "current_snapshot", return_value=snapshot):
            result = tracker_main.get_current_snapshot()

        self.assertTrue(result["ok"])
        self.assertEqual(result["data"]["observedAt"], snapshot.observed_at)
        self.assertEqual(result["data"]["appName"], "cmux")
        self.assertEqual(result["data"]["bundleId"], "dev.cmux")

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
            candidates = tracker_main.search_classification_rule_candidates({"query": "lin"})
            applied = tracker_main.apply_classification_rules({"start": "2026-04-06T00:00:00", "end": "2026-04-07T00:00:00"})

        self.assertTrue(rules["ok"])
        self.assertEqual(saved["data"]["id"], "rule-1")
        self.assertEqual(deleted["data"]["deleted"], 1)
        self.assertEqual(candidates["data"][0]["id"], "app:Linear")
        self.assertEqual(applied["data"]["appliedCount"], 1)
        mock_db.save_classification_rule.assert_called_once_with({"targetKind": "app", "targetValue": "Linear"})
        mock_db.delete_classification_rule.assert_called_once_with("rule-1")
        mock_db.search_classification_rule_candidates.assert_called_once_with("lin")
        mock_db.apply_classification_rules.assert_called_once_with("2026-04-06T00:00:00", "2026-04-07T00:00:00")

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


if __name__ == "__main__":
    unittest.main()
