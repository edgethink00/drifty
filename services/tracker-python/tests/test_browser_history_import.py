import json
import sqlite3
import sys
import unittest
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.storage.db import TrackerDatabase
from app.tracker.browser_history_import import (  # noqa: E402
    BrowserHistoryImportRequest,
    import_browser_history,
    preview_browser_history_import,
)
from app import main as tracker_main  # noqa: E402

CHROMIUM_EPOCH_OFFSET_SECONDS = 11_644_473_600
MICROSECONDS_PER_SECOND = 1_000_000


def chromium_timestamp(value: datetime) -> int:
    return int((value.timestamp() + CHROMIUM_EPOCH_OFFSET_SECONDS) * MICROSECONDS_PER_SECOND)


class BrowserHistoryImportTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = TemporaryDirectory()
        self.root = Path(self.tempdir.name)
        self.now = datetime(2026, 7, 3, 12, 0, tzinfo=timezone.utc)

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    def _write_chromium_history(self, rows: list[tuple[str, str, datetime]]) -> Path:
        history_path = self.root / "Default" / "History"
        history_path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(history_path)) as conn:
            conn.execute("CREATE TABLE urls(id INTEGER PRIMARY KEY, url TEXT, title TEXT, last_visit_time INTEGER)")
            conn.execute("CREATE TABLE visits(id INTEGER PRIMARY KEY, url INTEGER, visit_time INTEGER)")
            for index, (url, title, visited_at) in enumerate(rows, start=1):
                timestamp = chromium_timestamp(visited_at)
                conn.execute(
                    "INSERT INTO urls(id, url, title, last_visit_time) VALUES (?, ?, ?, ?)",
                    (index, url, title, timestamp),
                )
                conn.execute(
                    "INSERT INTO visits(url, visit_time) VALUES (?, ?)",
                    (index, timestamp),
                )
            conn.commit()
        return history_path

    def _request(self) -> BrowserHistoryImportRequest:
        return BrowserHistoryImportRequest(
            lookback_days=7,
            observed_at=self.now,
            profile_roots={"Google Chrome": self.root},
        )

    def test_preview_summarizes_last_week_without_raw_history(self) -> None:
        self._write_chromium_history(
            [
                ("https://docs.example.test/path?token=secret#intro", "Docs", self.now - timedelta(days=1, hours=3)),
                ("https://docs.example.test/next", "Docs next", self.now - timedelta(days=1, hours=2, minutes=57)),
                ("chrome://settings/privacy", "Privacy", self.now - timedelta(days=1, hours=2)),
                ("https://old.example.test/", "Old", self.now - timedelta(days=8)),
            ]
        )

        preview = preview_browser_history_import(self._request()).to_payload()

        self.assertEqual(preview["lookbackDays"], 7)
        self.assertEqual(preview["candidateCount"], 2)
        self.assertEqual(preview["segmentCount"], 1)
        self.assertGreater(preview["estimatedSeconds"], 0)
        serialized = json.dumps(preview)
        self.assertNotIn("docs.example.test", serialized)
        self.assertNotIn("token=secret", serialized)
        self.assertNotIn("Docs", serialized)

    def test_import_persists_estimated_segments_idempotently(self) -> None:
        self._write_chromium_history(
            [
                ("https://docs.example.test/path?token=secret#intro", "Docs", self.now - timedelta(days=1, hours=3)),
                ("https://docs.example.test/next", "Docs next", self.now - timedelta(days=1, hours=2, minutes=57)),
                ("https://social.example.test/feed", "Social", self.now - timedelta(days=1, hours=2, minutes=40)),
            ]
        )
        db = TrackerDatabase(self.root / "tracker.sqlite3")

        first = import_browser_history(db, self._request()).to_payload()
        second = import_browser_history(db, self._request()).to_payload()
        rows = db.timeline(
            start=(self.now - timedelta(days=2)).isoformat(),
            end=self.now.isoformat(),
        )

        self.assertEqual(first["lookbackDays"], 7)
        self.assertEqual(first["insertedCount"], 2)
        self.assertEqual(first["skippedDuplicateCount"], 0)
        self.assertEqual(second["insertedCount"], 0)
        self.assertEqual(second["skippedDuplicateCount"], 2)
        self.assertEqual(len(rows), 2)
        self.assertEqual({row["source"] for row in rows}, {"browser-history-import"})
        self.assertEqual({row["site_source"] for row in rows}, {"browser-history-import"})
        self.assertEqual(rows[0]["site_url"], "https://docs.example.test/path")
        self.assertIsNotNone(rows[0]["raw_context_json"])
        self.assertIn("browser-history-import", rows[0]["raw_context_json"])

    def test_tracker_commands_preview_and_import_last_48_hours_by_default(self) -> None:
        self._write_chromium_history(
            [
                ("https://docs.example.test/path?token=secret#intro", "Docs", self.now - timedelta(days=1, hours=3)),
                ("https://docs.example.test/next", "Docs next", self.now - timedelta(days=1, hours=2, minutes=57)),
                ("https://old.example.test/", "Old", self.now - timedelta(days=8)),
            ]
        )
        original_db_path = tracker_main.DB_PATH
        tracker_main.DB_PATH = self.root / "tracker.sqlite3"
        payload = {
            "observedAt": self.now.isoformat(),
            "profileRoots": {"Google Chrome": str(self.root)},
        }
        try:
            preview = tracker_main._dispatch({"command": "preview_browser_history_import", "payload": payload})
            imported = tracker_main._dispatch({"command": "import_browser_history", "payload": payload})
        finally:
            tracker_main.DB_PATH = original_db_path

        self.assertTrue(preview["ok"])
        self.assertEqual(preview["data"]["lookbackDays"], 2)
        self.assertEqual(preview["data"]["candidateCount"], 2)
        self.assertEqual(preview["data"]["segmentCount"], 1)
        self.assertNotIn("docs.example.test", json.dumps(preview["data"]))
        self.assertTrue(imported["ok"])
        self.assertEqual(imported["data"]["insertedCount"], 1)


class BrowserHistorySegmentFilterTests(unittest.TestCase):
    def _visit(self, url: str, when: datetime) -> "BrowserHistoryImportVisit":
        from urllib.parse import urlsplit

        from app.tracker.browser_history_import.models import BrowserHistoryImportVisit

        return BrowserHistoryImportVisit(
            import_key=f"key:{url}:{when.isoformat()}",
            url=url,
            title="t",
            visited_at=when,
            browser_name="Google Chrome",
            profile_name="Default",
            site_domain=(urlsplit(url).hostname or "").lstrip("www."),
        )

    def test_low_signal_urls_are_filtered(self) -> None:
        from app.tracker.browser_history_import.segments import is_low_signal_url

        for url in (
            "https://www.google.com/search?q=drifty",
            "https://example.com/signin?next=/app",
            "https://accounts.google.com/o/oauth2/auth",
            "about:blank",
            "",
        ):
            self.assertTrue(is_low_signal_url(url), url)
        for url in (
            "https://github.com/example/drifty",
            "https://claude.ai/chat/123",
            "https://docs.example.com/guide",
        ):
            self.assertFalse(is_low_signal_url(url), url)

    def test_short_sessions_are_dropped_and_noise_removed(self) -> None:
        from app.tracker.browser_history_import.models import (
            MIN_SESSION_DURATION_SECONDS,
            BrowserHistoryImportRequest,
        )
        from app.tracker.browser_history_import.segments import segments_from_visits

        now = datetime(2026, 7, 3, 12, 0, tzinfo=timezone.utc)
        request = BrowserHistoryImportRequest(lookback_days=2, observed_at=now)
        base = now - timedelta(minutes=30)
        visits = [
            # brief detour to a.example (only ~5s before jumping to b.example) -> dropped
            self._visit("https://a.example/", base),
            # a google search in the middle -> filtered as low-signal (C)
            self._visit("https://www.google.com/search?q=x", base + timedelta(seconds=2)),
            # b.example gets meaningful dwell via the session timeout -> kept (A)
            self._visit("https://b.example/", base + timedelta(seconds=5)),
        ]
        segments = segments_from_visits(visits, request)
        domains = {segment.site_domain for segment in segments}
        self.assertNotIn("a.example", domains)  # too short
        self.assertNotIn("google.com", domains)  # low-signal search
        self.assertIn("b.example", domains)
        self.assertTrue(all(s.duration_seconds >= MIN_SESSION_DURATION_SECONDS for s in segments))
