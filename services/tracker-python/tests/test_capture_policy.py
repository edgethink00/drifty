"""Confirmed private windows and recording hours, through the production tick."""
from __future__ import annotations

import json
import sqlite3
import sys
import unittest
from contextlib import ExitStack, closing
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app import main
from app.storage.db import ImportedActivitySegment, TrackerDatabase
from app.tracker.browser_automation import (
    browser_metadata,
    private_window_from_mode,
    private_window_from_title,
)
from app.tracker.capture_contract import Snapshot
from app.tracker.capture_policy import (
    CapturePolicy,
    RecordingSchedule,
    capture_decision,
    load_capture_policy,
    save_capture_policy,
    schedule_from_payload,
)
from app.tracker.windows_browser_uia import WindowsBrowserUiaResult
from app.tracker.windows_app_names import WINDOWS_BROWSER_APP_NAMES
from app.tracker.windows_workspace import (
    ForegroundWindow,
    ProcessIdentity,
    build_snapshot,
    enrich_browser_snapshot,
)

# 2026-10-23 is a Friday.
FRIDAY = datetime(2026, 10, 23)


def local(day: datetime, hour: int, minute: int = 0) -> datetime:
    return day.replace(hour=hour, minute=minute)


class RecordingScheduleTests(unittest.TestCase):
    def test_pause_window_crossing_midnight_covers_both_evenings_and_mornings(self) -> None:
        quiet = schedule_from_payload({"enabled": True, "mode": "pause-within", "startMinute": 22 * 60, "endMinute": 8 * 60})
        assert quiet is not None
        self.assertFalse(quiet.allows_recording(local(FRIDAY, 23, 30)))
        self.assertFalse(quiet.allows_recording(local(FRIDAY, 7, 59)))
        self.assertTrue(quiet.allows_recording(local(FRIDAY, 8, 0)))
        self.assertTrue(quiet.allows_recording(local(FRIDAY, 21, 59)))

    def test_work_hours_record_only_on_chosen_days(self) -> None:
        work = schedule_from_payload({"enabled": True, "mode": "record-within", "days": [1, 2, 3, 4, 5],
                                      "startMinute": 9 * 60, "endMinute": 18 * 60})
        assert work is not None
        self.assertTrue(work.allows_recording(local(FRIDAY, 9, 0)))
        self.assertFalse(work.allows_recording(local(FRIDAY, 18, 0)))
        self.assertFalse(work.allows_recording(local(FRIDAY, 8, 59)))
        saturday = FRIDAY + timedelta(days=1)
        self.assertFalse(work.allows_recording(local(saturday, 10, 0)))

    def test_a_night_shift_belongs_to_the_day_it_starts(self) -> None:
        night = RecordingSchedule(mode="record-within", days=frozenset({5}), start_minute=22 * 60, end_minute=2 * 60)
        saturday = FRIDAY + timedelta(days=1)
        self.assertTrue(night.allows_recording(local(FRIDAY, 23, 0)))
        self.assertTrue(night.allows_recording(local(saturday, 1, 30)))
        self.assertFalse(night.allows_recording(local(saturday, 23, 0)))
        self.assertFalse(night.allows_recording(local(FRIDAY, 1, 30)))

    def test_unusable_schedules_record_at_every_hour(self) -> None:
        for payload in (
            None,
            {"enabled": False, "mode": "record-within", "startMinute": 540, "endMinute": 1080},
            {"enabled": True, "mode": "record-within", "startMinute": 540, "endMinute": 540},
            {"enabled": True, "mode": "record-within", "days": [], "startMinute": 540, "endMinute": 1080},
            {"enabled": True, "mode": "sometimes", "startMinute": 540, "endMinute": 1080},
            {"enabled": True, "mode": "record-within", "startMinute": 2000, "endMinute": 1080},
        ):
            self.assertIsNone(schedule_from_payload(payload), payload)


class CaptureDecisionTests(unittest.TestCase):
    def snapshot(self, private_window: bool | None) -> Snapshot:
        return Snapshot(observed_at="2026-10-23T01:00:00+00:00", app_name="Google Chrome", bundle_id="com.google.Chrome",
                        window_title="Secret page", source="accessibility", browser_name="Google Chrome",
                        site_domain="example.com", site_title="Secret page", site_url="https://example.com/secret",
                        site_source="applescript", browser_content_context={"version": 1}, private_window=private_window)

    def test_only_a_confirmed_private_window_is_left_out(self) -> None:
        now = local(FRIDAY, 12)
        self.assertEqual(capture_decision(self.snapshot(True), CapturePolicy(), now), "skip")
        self.assertEqual(capture_decision(self.snapshot(None), CapturePolicy(), now), "record")
        self.assertEqual(capture_decision(self.snapshot(False), CapturePolicy(), now), "record")
        self.assertEqual(capture_decision(self.snapshot(True), CapturePolicy(private_windows="record"), now), "record")

    def test_off_hours_skip_every_app(self) -> None:
        policy = CapturePolicy(schedule=RecordingSchedule("record-within", frozenset({5}), 9 * 60, 18 * 60))
        self.assertEqual(capture_decision(self.snapshot(None), policy, local(FRIDAY, 20)), "skip")
        self.assertEqual(capture_decision(self.snapshot(None), policy, local(FRIDAY, 10)), "record")


class PrivateWindowSignalTests(unittest.TestCase):
    def test_scripting_modes(self) -> None:
        self.assertTrue(private_window_from_mode("incognito"))
        self.assertTrue(private_window_from_mode("guest"))
        self.assertFalse(private_window_from_mode("normal"))
        self.assertIsNone(private_window_from_mode(""))
        self.assertIsNone(private_window_from_mode("missing value"))

    def test_measured_title_labels_only(self) -> None:
        self.assertTrue(private_window_from_title("Safari", "asyncio — Python 3.15, Private Browsing"))
        self.assertTrue(private_window_from_title("Safari", "asyncio, 개인정보 보호 브라우징"))
        self.assertTrue(private_window_from_title("Firefox", "MDN Web Docs — Private Browsing"))
        self.assertTrue(private_window_from_title("Zen", "MDN Web Docs — Mozilla Firefox Private Browsing"))
        # A page that only talks about private browsing is still a normal window.
        self.assertIsNone(private_window_from_title("Safari", "How Private Browsing works"))
        self.assertIsNone(private_window_from_title("Firefox", "Firefox Help - Private Browsing"))
        self.assertIsNone(private_window_from_title("Google Chrome", "Notes, Private Browsing"))
        self.assertIsNone(private_window_from_title("Notes", "Plan, Private Browsing"))

    def test_chromium_reports_the_matched_window_mode(self) -> None:
        reply = "https://example.com/a\nPage A\nmatched\nPage A - Google Chrome\nincognito"
        metadata = browser_metadata("Google Chrome", lambda script: reply)
        self.assertTrue(metadata.private_window)
        self.assertEqual(metadata.site_url, "https://example.com/a")
        normal = browser_metadata("Google Chrome", lambda script: reply.replace("incognito", "normal"))
        self.assertFalse(normal.private_window)
        # Older replies without a mode line stay unknown.
        legacy = browser_metadata("Google Chrome", lambda script: "https://example.com/a\nPage A\nmatched\nPage A")
        self.assertIsNone(legacy.private_window)

    def test_chromium_script_reads_the_mode_and_safari_script_does_not(self) -> None:
        scripts: list[str] = []
        browser_metadata("Google Chrome", lambda script: scripts.append(script) or "x\ny\nmatched\ny\nnormal")
        self.assertIn("mode of w", scripts[0])
        from app.tracker.browser_automation import browser_script
        self.assertNotIn("mode of w", browser_script("Safari") or "")

    def test_windows_private_signals(self) -> None:
        def snapshot(title: str, app: str) -> Snapshot:
            identity = r"C:\Program Files\Microsoft\Edge\Application\msedge.exe" if app == "Microsoft Edge" else None
            return Snapshot(observed_at="2026-10-23T01:00:00+00:00", app_name=app, bundle_id=identity,
                            window_title=title, source="win32-foreground")
        gecko = enrich_browser_snapshot(snapshot("MDN", "Firefox"), 1,
                                        live_reader=lambda hwnd, app: WindowsBrowserUiaResult(None, "private browsing window", privacy_state="private"),
                                        bridge_reader=lambda app, url: None)
        self.assertTrue(gecko.private_window)
        edge = enrich_browser_snapshot(snapshot("MDN and 2 more pages - [InPrivate] - Microsoft Edge", "Microsoft Edge"), 1,
                                       live_reader=lambda hwnd, app: WindowsBrowserUiaResult("https://developer.mozilla.org/", None),
                                       bridge_reader=lambda app, url: None)
        self.assertTrue(edge.private_window)
        chrome = enrich_browser_snapshot(snapshot("MDN - Google Chrome", "Google Chrome"), 1,
                                         live_reader=lambda hwnd, app: WindowsBrowserUiaResult("https://developer.mozilla.org/", None),
                                         bridge_reader=lambda app, url: None)
        self.assertIsNone(chrome.private_window)

    def test_literal_inprivate_in_ordinary_windows_titles_still_records(self) -> None:
        for exe, title in (
            ("chrome.exe", "How [InPrivate] works - Google Chrome"),
            ("brave.exe", "How [InPrivate] works - Brave"),
            ("firefox.exe", "How [InPrivate] works — Mozilla Firefox"),
            ("msedge.exe", "How [InPrivate] works - Microsoft Edge"),
            ("msedge.exe", "[InPrivate] documentation - Profile 1 - Microsoft\u200b Edge"),
            ("msedge.exe", "How - [InPrivate] - Microsoft Edge - Profile 1 - Microsoft Edge"),
            # Even the exact Edge label shape on a different browser is only page text.
            ("chrome.exe", "How - [InPrivate] - Microsoft Edge"),
            ("brave.exe", "How - [InPrivate] - Microsoft Edge"),
            ("firefox.exe", "How - [InPrivate] - Microsoft Edge"),
        ):
            with self.subTest(exe=exe, title=title):
                path = "C:\\Browsers\\" + exe
                snapshot = build_snapshot(
                    ForegroundWindow(hwnd=1, title=title, pid=2),
                    ProcessIdentity(exe_path=path, exe_name=exe, aumid=None),
                )
                enriched = enrich_browser_snapshot(
                    snapshot, 1,
                    live_reader=lambda *_: WindowsBrowserUiaResult("https://example.com/help", None),
                    bridge_reader=lambda *_: None,
                )
                self.assertIsNone(enriched.private_window)
                self.assertEqual(enriched.site_url, "https://example.com/help")
                self.assertEqual(capture_decision(enriched, CapturePolicy(), local(FRIDAY, 12)), "record")

    def test_edge_private_label_requires_its_measured_suffix_and_process_identity(self) -> None:
        for title in (
            "MDN and 2 more pages - [InPrivate] - Microsoft Edge",
            "MDN 외 페이지 1개 - [InPrivate] - Microsoft\u200b Edge",
        ):
            for identity in (
                r"c:\program files\microsoft\edge\application\msedge.exe",
                r"C:\Program Files\Microsoft\Edge\Application\MSEDGE.EXE",
                r"C:\Browsers\chrome.exe",
                None,
            ):
                with self.subTest(title=title, identity=identity):
                    snapshot = Snapshot(
                        observed_at="2026-10-23T01:00:00+00:00", app_name="Microsoft Edge",
                        bundle_id=identity, window_title=title, source="win32-foreground",
                    )
                    enriched = enrich_browser_snapshot(
                        snapshot, 1,
                        live_reader=lambda *_: WindowsBrowserUiaResult("https://example.com/", None),
                        bridge_reader=lambda *_: None,
                    )
                    is_edge = identity is not None and identity.lower().endswith("\\msedge.exe")
                    self.assertEqual(enriched.private_window, True if is_edge else None)
                    self.assertEqual(
                        capture_decision(enriched, CapturePolicy(), local(FRIDAY, 12)),
                        "skip" if is_edge else "record",
                    )

    def test_uia_confirmed_private_is_kept_for_every_supported_windows_browser(self) -> None:
        for app in sorted(WINDOWS_BROWSER_APP_NAMES):
            with self.subTest(app=app):
                snapshot = Snapshot(
                    observed_at="2026-10-23T01:00:00+00:00", app_name=app, bundle_id=None,
                    window_title="A page without a private title label", source="win32-foreground",
                )
                enriched = enrich_browser_snapshot(
                    snapshot, 1,
                    live_reader=lambda *_: WindowsBrowserUiaResult(None, "private browsing window", privacy_state="private"),
                    bridge_reader=lambda *_: None,
                )
                self.assertTrue(enriched.private_window)
                self.assertEqual(capture_decision(enriched, CapturePolicy(), local(FRIDAY, 12)), "skip")


class CapturePolicyTickTests(unittest.TestCase):
    """The daemon tick with a real database and a scripted foreground."""

    def setUp(self) -> None:
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.db = TrackerDatabase(Path(self.temp.name) / "policy.sqlite3")
        self.addCleanup(self.db.close)
        self.wall = datetime(2026, 10, 23, 3, 0, tzinfo=timezone.utc)
        self.tick = 100.0
        self.private = False
        self.title = "Normal page"
        self.last = None
        owner = self

        class ControlledDatetime(datetime):
            @classmethod
            def now(cls, tz=None):
                return owner.wall if tz is not None else owner.wall.astimezone().replace(tzinfo=None)

        stack = ExitStack()
        self.addCleanup(stack.close)
        stack.enter_context(patch.object(main, "datetime", ControlledDatetime))
        stack.enter_context(patch.object(main.time, "monotonic", side_effect=lambda: self.tick))
        stack.enter_context(patch.object(main, "seconds_since_last_input", side_effect=lambda: 0.0))
        stack.enter_context(patch.object(main, "current_power_state", side_effect=lambda:
            SimpleNamespace(observed_at=self.wall, should_capture=True, reason="owned_fixture")))
        stack.enter_context(patch.object(main, "current_snapshot", side_effect=self.snapshot))
        stack.enter_context(patch.object(main, "current_foreground_audio_sample", side_effect=lambda:
            SimpleNamespace(available=True, active=False, reason="owned_fixture")))
        for name in ("_apply_developer_diagnostics_env", "backfill_browser_history_context"):
            stack.enter_context(patch.object(main, name))
        main._CAPTURE_POLICY_GAP["pending"] = False

    def snapshot(self, **kwargs) -> Snapshot:
        return Snapshot(observed_at=self.wall.isoformat(), app_name="Google Chrome", bundle_id="com.google.Chrome",
                        window_title=self.title, source="accessibility", browser_name="Google Chrome",
                        site_domain="example.com", site_title=self.title, site_url="https://example.com/",
                        site_source="applescript", private_window=True if self.private else None)

    def capture(self, seconds: float) -> None:
        self.tick = 100.0 + seconds
        self.wall = datetime(2026, 10, 23, 3, 0, tzinfo=timezone.utc) + timedelta(seconds=seconds)
        self.last = main._daemon_tick(self.db, self.last)

    def rows(self) -> list[dict]:
        with closing(sqlite3.connect(self.db.path)) as conn:
            conn.row_factory = sqlite3.Row
            return [dict(row) for row in conn.execute(
                "SELECT app_name, window_title, site_url, exclusion_source, started_at, ended_at, duration_seconds"
                " FROM activity_segments ORDER BY id")]

    def test_a_private_window_leaves_a_gap_that_no_row_stretches_across(self) -> None:
        for second in (0, 5, 10):
            self.capture(second)
        self.private = True
        for second in (15, 20, 25, 30):
            self.capture(second)
        self.private = False
        for second in (35, 40):
            self.capture(second)
        rows = self.rows()
        self.assertEqual(len(rows), 2, rows)
        self.assertTrue(all(row["window_title"] == "Normal page" for row in rows))
        first_end = datetime.fromisoformat(rows[0]["ended_at"])
        second_start = datetime.fromisoformat(rows[1]["started_at"])
        self.assertGreaterEqual((second_start - first_end).total_seconds(), 20)
        self.assertLessEqual(sum(row["duration_seconds"] for row in rows), 25)

    def test_off_hours_record_nothing_and_the_live_snapshot_is_empty(self) -> None:
        local_now = self.wall.astimezone()
        minute = local_now.hour * 60 + local_now.minute
        save_capture_policy(self.db, {"recordingSchedule": {
            "enabled": True, "mode": "pause-within", "startMinute": minute, "endMinute": (minute + 60) % 1440}})
        for second in (0, 5, 10):
            self.capture(second)
        self.assertEqual(self.rows(), [])
        with patch.object(main, "DB_PATH", self.db.path), patch.object(main, "database", return_value=self.db):
            payload = main.get_current_snapshot()
        self.assertEqual(payload, {"ok": True, "data": None, "error": None})

    def test_policy_round_trips_and_defaults_to_leaving_private_windows_out(self) -> None:
        self.assertEqual(load_capture_policy(self.db), CapturePolicy())
        saved = save_capture_policy(self.db, {"privateWindows": "record", "recordingSchedule": {
            "enabled": True, "mode": "record-within", "days": [1, 2, 3, 4, 5], "startMinute": 540, "endMinute": 1080}})
        self.assertEqual(saved["privateWindows"], "record")
        self.assertEqual(json.loads(self.db.get_meta("capture_policy_recording_schedule"))["days"], [1, 2, 3, 4, 5])
        policy = load_capture_policy(self.db)
        self.assertEqual(policy.private_windows, "record")
        self.assertEqual(policy.schedule, RecordingSchedule("record-within", frozenset({1, 2, 3, 4, 5}), 540, 1080))

    def test_imported_browsing_outside_recording_hours_is_left_out(self) -> None:
        def segment(key: str, start: datetime) -> ImportedActivitySegment:
            end = start + timedelta(minutes=10)
            return ImportedActivitySegment(
                import_key=key, started_at=start.astimezone(timezone.utc).isoformat(),
                ended_at=end.astimezone(timezone.utc).isoformat(), duration_seconds=600, app_name="Safari",
                bundle_id="com.apple.Safari", window_title="Docs", site_domain="example.com", site_title="Docs",
                site_url="https://example.com/docs", youtube_video_id=None, youtube_playlist_id=None,
                youtube_is_shorts=None, browser_name="Safari", site_source="browser-history", platform="macos",
                source="browser-history-import", confidence=0.6, raw_context_json=None)
        save_capture_policy(self.db, {"recordingSchedule": {
            "enabled": True, "mode": "record-within", "startMinute": 9 * 60, "endMinute": 18 * 60}})
        inside = datetime(2026, 10, 22, 10, 0).astimezone()
        outside = datetime(2026, 10, 22, 20, 0).astimezone()
        result = self.db.insert_imported_activity_segments([segment("inside", inside), segment("outside", outside)],
                                                           imported_at="2026-10-23T00:00:00+00:00")
        self.assertEqual(result.inserted_count, 1)


if __name__ == "__main__":
    unittest.main()
