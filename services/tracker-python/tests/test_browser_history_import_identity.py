import sqlite3
import sys
import unittest
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urlsplit

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.storage.db import TrackerDatabase
from app.tracker.browser_history_import import (
    BrowserHistoryImportRequest,
    import_browser_history,
    preview_browser_history_import,
)
from app.tracker.browser_history_import.reader import _sanitize_url


class BrowserHistoryImportIdentityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = TemporaryDirectory()
        self.addCleanup(self.tempdir.cleanup)
        self.root = Path(self.tempdir.name)
        self.started_at = datetime(2026, 10, 4, 11, tzinfo=timezone.utc)
        self.observed_at = self.started_at + timedelta(hours=1)

    def _write_history(self, root: Path, browser: str, visits: list[tuple[str, datetime]]) -> None:
        safari = browser == "Safari"
        path = root / ("History.db" if safari else "Default/History")
        path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(path)) as conn:
            if safari:
                conn.execute("CREATE TABLE history_items(id INTEGER PRIMARY KEY, url TEXT)")
                conn.execute(
                    "CREATE TABLE history_visits(history_item INTEGER, visit_time REAL, title TEXT)"
                )
            else:
                conn.execute("CREATE TABLE urls(id INTEGER PRIMARY KEY, url TEXT, title TEXT)")
                conn.execute("CREATE TABLE visits(url INTEGER, visit_time INTEGER)")
            for index, (url, visited_at) in enumerate(visits, start=1):
                if safari:
                    conn.execute("INSERT INTO history_items VALUES (?, ?)", (index, url))
                    conn.execute(
                        "INSERT INTO history_visits VALUES (?, ?, ?)",
                        (index, visited_at.timestamp() - 978_307_200, "Synthetic page"),
                    )
                else:
                    conn.execute("INSERT INTO urls VALUES (?, ?, ?)", (index, url, "Synthetic page"))
                    conn.execute(
                        "INSERT INTO visits VALUES (?, ?)",
                        (index, int((visited_at.timestamp() + 11_644_473_600) * 1_000_000)),
                    )
            conn.commit()

    def _database(self, root: Path) -> TrackerDatabase:
        db = TrackerDatabase(root / "tracker.sqlite3")
        self.addCleanup(db.close)
        return db

    def _rows(self, db: TrackerDatabase) -> list[dict]:
        return [
            dict(row)
            for row in db.connect().execute(
                "SELECT app_name, browser_name, site_url, site_domain, started_at, ended_at, "
                "duration_seconds FROM activity_segments ORDER BY started_at"
            )
        ]

    def test_ipv6_preview_and_apply_preserve_authority_and_minimize_url(self) -> None:
        urls = (
            ("http://[::1]/", "http://[::1]/", "::1", None),
            ("http://[::1]:3000/dashboard", "http://[::1]:3000/dashboard", "::1", 3000),
            ("https://[2001:DB8::1]/docs", "https://[2001:db8::1]/docs", "2001:db8::1", None),
            (
                "https://user:password@[2001:DB8::1]:443/docs?token=synthetic#section",
                "https://[2001:db8::1]:443/docs",
                "2001:db8::1",
                443,
            ),
        )
        for browser in ("Google Chrome", "Safari", "Microsoft Edge"):
            for index, (raw_url, expected_url, host, port) in enumerate(urls):
                with self.subTest(browser=browser, url=raw_url):
                    root = self.root / browser / str(index)
                    self._write_history(root, browser, [(raw_url, self.started_at)])
                    request = BrowserHistoryImportRequest(2, self.observed_at, {browser: root})
                    preview = preview_browser_history_import(request)
                    self.assertEqual(preview.candidate_count, 1)
                    self.assertEqual(preview.segment_count, 1)
                    self.assertEqual(preview.estimated_seconds, 300)
                    self.assertEqual(preview.error_count, 0)
                    db = self._database(root)
                    self.assertEqual(import_browser_history(db, request).inserted_count, 1)
                    row, = self._rows(db)
                    self.assertEqual(row["site_url"], expected_url)
                    self.assertEqual(row["site_domain"], host)
                    self.assertEqual(row["browser_name"], browser)
                    parsed = urlsplit(row["site_url"])
                    self.assertEqual(parsed.hostname, host)
                    self.assertEqual(parsed.port, port)
                    self.assertIsNone(parsed.username)
                    self.assertIsNone(parsed.password)
                    self.assertEqual((parsed.query, parsed.fragment), ("", ""))
                    repeated = import_browser_history(db, request)
                    self.assertEqual((repeated.inserted_count, repeated.skipped_duplicate_count), (0, 1))
                    self.assertEqual(self._rows(db), [row])

    def test_same_host_browser_switch_preserves_browser_and_dedupes(self) -> None:
        for second_browser in ("Safari", "Microsoft Edge"):
            # Keep both the normal five-minute tail and the observed-at bound.
            for observed_minutes, second_duration in ((60, 300), (3, 60)):
                with self.subTest(browser=second_browser, observed_minutes=observed_minutes):
                    root = self.root / second_browser / str(observed_minutes)
                    first_root, second_root = root / "chrome", root / "second"
                    self._write_history(
                        first_root, "Google Chrome", [("https://docs.example.test/a", self.started_at)]
                    )
                    self._write_history(
                        second_root,
                        second_browser,
                        [("https://docs.example.test/b", self.started_at + timedelta(minutes=2))],
                    )
                    request = BrowserHistoryImportRequest(
                        2,
                        self.started_at + timedelta(minutes=observed_minutes),
                        {"Google Chrome": first_root, second_browser: second_root},
                    )
                    preview = preview_browser_history_import(request)
                    self.assertEqual(preview.browser_count, 2)
                    self.assertEqual(preview.segment_count, 2)
                    self.assertEqual(preview.estimated_seconds, 120 + second_duration)
                    db = self._database(root)
                    self.assertEqual(import_browser_history(db, request).inserted_count, 2)
                    rows = self._rows(db)
                    self.assertEqual([row["app_name"] for row in rows], ["Google Chrome", second_browser])
                    self.assertEqual([row["browser_name"] for row in rows], ["Google Chrome", second_browser])
                    self.assertEqual([row["duration_seconds"] for row in rows], [120, second_duration])
                    self.assertEqual(rows[0]["ended_at"], rows[1]["started_at"])
                    self.assertEqual(
                        rows[1]["ended_at"],
                        (self.started_at + timedelta(seconds=120 + second_duration)).isoformat(),
                    )
                    repeated = import_browser_history(db, request)
                    self.assertEqual((repeated.inserted_count, repeated.skipped_duplicate_count), (0, 2))
                    self.assertEqual(self._rows(db), rows)

    def test_same_browser_same_host_still_merges_and_dedupes(self) -> None:
        for browser in ("Google Chrome", "Safari", "Microsoft Edge"):
            with self.subTest(browser=browser):
                root = self.root / browser
                self._write_history(
                    root,
                    browser,
                    [
                        ("https://docs.example.test/a", self.started_at),
                        ("https://docs.example.test/b", self.started_at + timedelta(minutes=2)),
                    ],
                )
                request = BrowserHistoryImportRequest(2, self.observed_at, {browser: root})
                preview = preview_browser_history_import(request)
                self.assertEqual(preview.segment_count, 1)
                self.assertEqual(preview.estimated_seconds, 420)
                db = self._database(root)
                self.assertEqual(import_browser_history(db, request).inserted_count, 1)
                row, = self._rows(db)
                self.assertEqual(row["app_name"], browser)
                self.assertEqual(row["duration_seconds"], 420)
                repeated = import_browser_history(db, request)
                self.assertEqual((repeated.inserted_count, repeated.skipped_duplicate_count), (0, 1))
                self.assertEqual(self._rows(db), [row])

    def test_existing_host_and_explicit_port_minimization_is_preserved(self) -> None:
        cases = (
            ("https://user:password@EXAMPLE.test:443/docs?token=synthetic#section", "https://example.test:443/docs"),
            ("http://127.0.0.1:8080/path?query=synthetic", "http://127.0.0.1:8080/path"),
            ("http://example.test:80", "http://example.test:80/"),
            ("https://example.test/", "https://example.test/"),
        )
        for raw_url, expected in cases:
            with self.subTest(url=raw_url):
                self.assertEqual(_sanitize_url(raw_url), expected)


if __name__ == "__main__":
    unittest.main()
