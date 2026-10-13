import json
import sqlite3
import sys
import unittest

try:
    # plistlib imports xml.parsers.expat, which can fail on a mis-linked local
    # interpreter. The plist-parsing tests skip in that case; everything else runs.
    import plistlib

    _PLISTLIB_AVAILABLE = True
except Exception:  # pragma: no cover - environment-dependent
    plistlib = None  # type: ignore[assignment]
    _PLISTLIB_AVAILABLE = False
from contextlib import closing
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.storage.db import ImportedActivitySegment, TrackerDatabase
from app.capture_platform import CAPTURE_PLATFORM
from app.tracker.browser_history import (  # noqa: E402
    default_browser_is_safari,
    safari_history_readable,
)
from app.tracker.browser_history_import import (  # noqa: E402
    BrowserHistoryImportRequest,
    import_browser_history,
    preview_browser_history_import,
)
from app import main as tracker_main  # noqa: E402
from tests.support_cleanup import cleanup_temp_dir

CHROMIUM_EPOCH_OFFSET_SECONDS = 11_644_473_600
COCOA_EPOCH_OFFSET_SECONDS = 978_307_200
MICROSECONDS_PER_SECOND = 1_000_000


def chromium_timestamp(value: datetime) -> int:
    return int((value.timestamp() + CHROMIUM_EPOCH_OFFSET_SECONDS) * MICROSECONDS_PER_SECOND)


def firefox_timestamp(value: datetime) -> int:
    return int(value.timestamp() * MICROSECONDS_PER_SECOND)


def safari_timestamp(value: datetime) -> float:
    # Safari's History.db stores visit_time as REAL seconds since the Cocoa epoch.
    return value.timestamp() - COCOA_EPOCH_OFFSET_SECONDS


def write_safari_history(root: Path, rows: list[tuple[str, str, datetime]]) -> Path:
    history_path = root / "History.db"
    history_path.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(history_path)) as conn:
        conn.execute("CREATE TABLE history_items(id INTEGER PRIMARY KEY, url TEXT, visit_count INTEGER)")
        conn.execute(
            "CREATE TABLE history_visits(id INTEGER PRIMARY KEY, history_item INTEGER, visit_time REAL, title TEXT)"
        )
        for index, (url, title, visited_at) in enumerate(rows, start=1):
            conn.execute("INSERT INTO history_items(id, url, visit_count) VALUES (?, ?, ?)", (index, url, 1))
            conn.execute(
                "INSERT INTO history_visits(history_item, visit_time, title) VALUES (?, ?, ?)",
                (index, safari_timestamp(visited_at), title),
            )
        conn.commit()
    return history_path


class BrowserHistoryImportTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = TemporaryDirectory()
        self.root = Path(self.tempdir.name)
        self.now = datetime(2026, 7, 3, 12, 0, tzinfo=timezone.utc)

    def tearDown(self) -> None:
        cleanup_temp_dir(self.tempdir)

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

    def _write_firefox_places(self, profile: str, rows: list[tuple[str, str, datetime]]) -> Path:
        places_path = self.root / profile / "places.sqlite"
        places_path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(places_path)) as conn:
            conn.execute("CREATE TABLE moz_places(id INTEGER PRIMARY KEY, url TEXT, title TEXT, last_visit_date INTEGER)")
            conn.execute("CREATE TABLE moz_historyvisits(id INTEGER PRIMARY KEY, place_id INTEGER, visit_date INTEGER)")
            for index, (url, title, visited_at) in enumerate(rows, start=1):
                timestamp = firefox_timestamp(visited_at)
                conn.execute(
                    "INSERT INTO moz_places(id, url, title, last_visit_date) VALUES (?, ?, ?, ?)",
                    (index, url, title, timestamp),
                )
                conn.execute(
                    "INSERT INTO moz_historyvisits(place_id, visit_date) VALUES (?, ?)",
                    (index, timestamp),
                )
            conn.commit()
        return places_path

    def _request(self) -> BrowserHistoryImportRequest:
        return BrowserHistoryImportRequest(
            lookback_days=7,
            observed_at=self.now,
            profile_roots={"Google Chrome": self.root},
        )

    def test_import_reads_whale_chromium_root(self) -> None:
        self._write_chromium_history(
            [
                ("https://docs.example.test/whale", "Whale Docs", self.now - timedelta(days=1, hours=3)),
                ("https://docs.example.test/next", "Whale next", self.now - timedelta(days=1, hours=2, minutes=57)),
            ]
        )
        db = TrackerDatabase(self.root / "tracker.sqlite3")
        request = BrowserHistoryImportRequest(
            lookback_days=7,
            observed_at=self.now,
            profile_roots={"Whale": self.root},
        )

        imported = import_browser_history(db, request).to_payload()
        rows = db.timeline(
            start=(self.now - timedelta(days=2)).isoformat(),
            end=self.now.isoformat(),
        )

        self.assertEqual(imported["insertedCount"], 1)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["site_url"], "https://docs.example.test/whale")

    def test_import_reads_zen_firefox_root(self) -> None:
        self._write_firefox_places(
            "abcd.Default (release)",
            [
                ("https://docs.example.test/zen", "Zen Docs", self.now - timedelta(days=1, hours=3)),
                ("https://docs.example.test/next", "Zen next", self.now - timedelta(days=1, hours=2, minutes=57)),
            ],
        )
        db = TrackerDatabase(self.root / "tracker.sqlite3")
        request = BrowserHistoryImportRequest(
            lookback_days=7,
            observed_at=self.now,
            profile_roots={"Zen": self.root},
        )

        imported = import_browser_history(db, request).to_payload()
        rows = db.timeline(
            start=(self.now - timedelta(days=2)).isoformat(),
            end=self.now.isoformat(),
        )

        self.assertEqual(imported["insertedCount"], 1)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["site_url"], "https://docs.example.test/zen")

    def test_import_skips_only_a_browser_whose_profile_folder_cannot_be_listed(self) -> None:
        # macOS 1.11.23 (DRIFTY-MAC-NATIVE-4J): listing Chrome's profile folder
        # raised PermissionError and failed the whole import.
        self._write_firefox_places(
            "abcd.Default (release)",
            [
                ("https://docs.example.test/zen", "Zen Docs", self.now - timedelta(days=1, hours=3)),
                ("https://docs.example.test/next", "Zen next", self.now - timedelta(days=1, hours=2, minutes=57)),
            ],
        )
        db = TrackerDatabase(self.root / "tracker.sqlite3")
        request = BrowserHistoryImportRequest(
            lookback_days=7,
            observed_at=self.now,
            profile_roots={"Google Chrome": self.root / "chrome", "Zen": self.root},
        )
        denied = PermissionError(1, "Operation not permitted", str(self.root / "chrome"))

        with patch(
            "app.tracker.browser_history_import.reader.chromium_history_paths_for_root",
            side_effect=denied,
        ):
            preview = preview_browser_history_import(request).to_payload()
            imported = import_browser_history(db, request).to_payload()

        self.assertGreaterEqual(preview["errorCount"], 1)
        self.assertEqual(imported["insertedCount"], 1)
        rows = db.timeline(start=(self.now - timedelta(days=2)).isoformat(), end=self.now.isoformat())
        self.assertEqual([row["site_url"] for row in rows], ["https://docs.example.test/zen"])

    def test_import_reads_safari_history_with_cocoa_timestamps(self) -> None:
        visited = self.now - timedelta(days=1, hours=3)
        write_safari_history(
            self.root,
            [
                ("https://docs.example.test/safari", "Safari Docs", visited),
                ("https://docs.example.test/next", "Safari next", visited + timedelta(minutes=3)),
            ],
        )
        db = TrackerDatabase(self.root / "tracker.sqlite3")
        request = BrowserHistoryImportRequest(
            lookback_days=7,
            observed_at=self.now,
            profile_roots={"Safari": self.root},
        )

        imported = import_browser_history(db, request).to_payload()
        rows = db.timeline(
            start=(self.now - timedelta(days=2)).isoformat(),
            end=self.now.isoformat(),
        )

        self.assertEqual(imported["insertedCount"], 1)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["site_url"], "https://docs.example.test/safari")
        self.assertEqual(rows[0]["app_name"], "Safari")
        # Cocoa second timestamp round-tripped back to the real visit instant.
        self.assertEqual(rows[0]["started_at"], visited.isoformat())

    def test_safari_timestamp_round_trips_through_cocoa_epoch(self) -> None:
        from app.tracker.browser_history_import.reader import _safari_datetime, _safari_timestamp

        cocoa_epoch = datetime(2001, 1, 1, tzinfo=timezone.utc)
        self.assertEqual(_safari_timestamp(cocoa_epoch), 0)
        moment = datetime(2026, 7, 2, 9, 0, tzinfo=timezone.utc)
        self.assertEqual(_safari_timestamp(moment), int(moment.timestamp()) - COCOA_EPOCH_OFFSET_SECONDS)
        self.assertEqual(_safari_datetime(_safari_timestamp(moment)), moment)

    def test_safari_denied_or_corrupt_open_counts_error_and_reports_unreadable(self) -> None:
        # A TCC-denied open raises PermissionError on copy; a corrupt/garbage database
        # raises sqlite3.DatabaseError on read. Both hit the same guarded branch, so a
        # non-database file is a deterministic stand-in for the denied-open path.
        (self.root / "History.db").write_bytes(b"not a sqlite database")
        request = BrowserHistoryImportRequest(
            lookback_days=7,
            observed_at=self.now,
            profile_roots={"Safari": self.root},
        )

        preview = preview_browser_history_import(request).to_payload()

        self.assertGreaterEqual(preview["errorCount"], 1)
        self.assertEqual(preview["segmentCount"], 0)
        self.assertFalse(safari_history_readable(self.root))

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

    def test_rerun_with_extended_session_skips_overlapping_segment(self) -> None:
        history_rows = [
            ("https://docs.example.test/path", "Docs", self.now - timedelta(days=1, hours=3)),
            ("https://docs.example.test/next", "Docs next", self.now - timedelta(days=1, hours=2, minutes=57)),
        ]
        history_path = self._write_chromium_history(history_rows)
        db = TrackerDatabase(self.root / "tracker.sqlite3")

        first = import_browser_history(db, self._request()).to_payload()
        # The session gains a visit between runs: same start, later end, new
        # session import key. The overlap check must still skip it.
        history_path.unlink()
        self._write_chromium_history(
            history_rows
            + [("https://docs.example.test/more", "Docs more", self.now - timedelta(days=1, hours=2, minutes=55))]
        )
        second = import_browser_history(db, self._request()).to_payload()
        rows = db.timeline(
            start=(self.now - timedelta(days=2)).isoformat(),
            end=self.now.isoformat(),
        )

        self.assertEqual(first["insertedCount"], 1)
        self.assertEqual(second["insertedCount"], 0)
        self.assertEqual(second["skippedDuplicateCount"], 1)
        self.assertEqual(len(rows), 1)

    def test_import_skips_segment_overlapping_live_tracker_segment(self) -> None:
        self._write_chromium_history(
            [
                ("https://docs.example.test/path", "Docs", self.now - timedelta(days=1, hours=3)),
                ("https://docs.example.test/next", "Docs next", self.now - timedelta(days=1, hours=2, minutes=57)),
            ]
        )
        db = TrackerDatabase(self.root / "tracker.sqlite3")
        db.insert_segment(
            {
                "started_at": (self.now - timedelta(days=1, hours=2, minutes=58)).isoformat(),
                "ended_at": (self.now - timedelta(days=1, hours=2, minutes=54)).isoformat(),
                "duration_seconds": 240,
                "app_name": "Google Chrome",
                "source": "nsworkspace",
            }
        )

        imported = import_browser_history(db, self._request()).to_payload()
        rows = db.timeline(
            start=(self.now - timedelta(days=2)).isoformat(),
            end=self.now.isoformat(),
        )

        self.assertEqual(imported["insertedCount"], 0)
        self.assertEqual(imported["skippedDuplicateCount"], 1)
        self.assertEqual({row["source"] for row in rows}, {"nsworkspace"})

    def _synthetic_import_segment(self, key: str, start: datetime) -> ImportedActivitySegment:
        return ImportedActivitySegment(
            import_key=key, started_at=start.isoformat(),
            ended_at=(start + timedelta(seconds=20)).isoformat(), duration_seconds=20,
            app_name="Synthetic Browser", bundle_id=None, window_title="Synthetic page",
            site_domain="example.invalid", site_title="Synthetic page", site_url="https://example.invalid/",
            youtube_video_id=None, youtube_playlist_id=None, youtube_is_shorts=None,
            browser_name="Synthetic Browser", site_source="browser-history-import",
            platform=CAPTURE_PLATFORM, source="browser-history-import", confidence=0.35,
            raw_context_json="{}",
        )

    def test_import_does_not_repeatedly_scan_unrelated_earlier_or_later_history(self) -> None:
        # Bound actual SQLite work, not wall-clock time or a platform's chosen
        # EXPLAIN wording. Both date distributions need a selective range.
        for name, existing_is_later, origin, opposite_local_count in (
            ("local-later", True, None, 0), ("local-earlier", False, None, 0),
            ("remote-earlier", False, "remote", 10), ("remote-later", True, "remote", 10),
        ):
            with self.subTest(distribution=name):
                db = TrackerDatabase(self.root / f"range-{name}.sqlite3", perform_maintenance=False)
                existing_start = self.now - timedelta(days=1 if existing_is_later else 3)
                import_start = self.now - timedelta(days=2)
                with db.connect() as conn:
                    conn.executemany(
                        "INSERT INTO activity_segments(started_at, ended_at, duration_seconds, app_name, "
                        "platform, source, confidence, origin_device_id) "
                        "VALUES (?, ?, 5, 'Synthetic existing', ?, 'synthetic', 1, ?)",
                        [((existing_start + timedelta(seconds=i * 10)).isoformat(),
                          (existing_start + timedelta(seconds=i * 10 + 5)).isoformat(), CAPTURE_PLATFORM, origin)
                         for i in range(2000)],
                    )
                    opposite_start = self.now - timedelta(days=3 if existing_is_later else 1)
                    conn.executemany(
                        "INSERT INTO activity_segments(started_at, ended_at, duration_seconds, app_name, "
                        "platform, source, confidence) VALUES (?, ?, 5, 'Synthetic local', ?, 'synthetic', 1)",
                        [((opposite_start + timedelta(seconds=i * 10)).isoformat(),
                          (opposite_start + timedelta(seconds=i * 10 + 5)).isoformat(), CAPTURE_PLATFORM)
                         for i in range(opposite_local_count)],
                    )
                segments = [self._synthetic_import_segment(f"range-{i}", import_start + timedelta(seconds=i * 30))
                            for i in range(80)]
                vm_steps = 0

                def count_work() -> int:
                    nonlocal vm_steps
                    vm_steps += 1000
                    return 0

                db.connect().set_progress_handler(count_work, 1000)
                try:
                    result = db.insert_imported_activity_segments(segments, self.now.isoformat())
                finally:
                    db.connect().set_progress_handler(None, 0)
                self.assertEqual((result.inserted_count, result.skipped_duplicate_count), (80, 0))
                self.assertLess(vm_steps, 200_000, "unrelated history must not be rescanned for every import")
                self.assertEqual(db.connect().execute("SELECT COUNT(*) FROM activity_segments").fetchone()[0],
                                 2080 + opposite_local_count)
                db.close()

    def test_import_preserves_overlap_and_remote_exemption_for_unsorted_offset_dates(self) -> None:
        db = TrackerDatabase(self.root / "overlap.sqlite3", perform_maintenance=False)
        first = self._synthetic_import_segment("first", self.now - timedelta(days=2))
        later = self._synthetic_import_segment("later", self.now - timedelta(days=1))
        with db.connect() as conn:
            conn.execute(
                "INSERT INTO activity_segments(started_at, ended_at, duration_seconds, app_name, platform, "
                "source, confidence, origin_device_id) VALUES (?, ?, 20, 'Synthetic remote', ?, 'synthetic', 1, 'remote')",
                (first.started_at, first.ended_at, CAPTURE_PLATFORM),
            )
            conn.execute(
                "INSERT INTO activity_segments(started_at, ended_at, duration_seconds, app_name, platform, "
                "source, confidence) VALUES (?, ?, 20, 'Synthetic local', ?, 'synthetic', 1)",
                (later.started_at, later.ended_at, CAPTURE_PLATFORM),
            )
        offset = timezone(timedelta(hours=9))
        offset_first = replace(first, started_at=datetime.fromisoformat(first.started_at).astimezone(offset).isoformat(),
                               ended_at=datetime.fromisoformat(first.ended_at).astimezone(offset).isoformat())
        overlap = replace(first, import_key="overlap")
        touching = self._synthetic_import_segment("touching", datetime.fromisoformat(first.ended_at))
        result = db.insert_imported_activity_segments([later, touching, offset_first, overlap], self.now.isoformat())
        self.assertEqual((result.inserted_count, result.skipped_duplicate_count), (2, 2))
        rerun = db.insert_imported_activity_segments([offset_first, touching], self.now.isoformat())
        self.assertEqual((rerun.inserted_count, rerun.skipped_duplicate_count), (0, 2))
        self.assertEqual(db.connect().execute("SELECT COUNT(*) FROM activity_segments").fetchone()[0], 4)
        db.close()

    def test_import_failure_rolls_back_the_whole_batch_and_import_keys(self) -> None:
        db = TrackerDatabase(self.root / "rollback.sqlite3", perform_maintenance=False)
        first = self._synthetic_import_segment("first", self.now - timedelta(days=2))
        second = replace(self._synthetic_import_segment("second", self.now - timedelta(days=1)),
                         app_name="Synthetic failure")
        with db.connect() as conn:
            conn.execute("CREATE TRIGGER synthetic_failure BEFORE INSERT ON activity_segments "
                         "WHEN NEW.app_name = 'Synthetic failure' BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END")
        with self.assertRaises(sqlite3.IntegrityError):
            db.insert_imported_activity_segments([first, second], self.now.isoformat())
        self.assertFalse(db.connect().in_transaction)
        self.assertEqual(db.connect().execute("SELECT COUNT(*) FROM activity_segments").fetchone()[0], 0)
        self.assertEqual(db.connect().execute("SELECT COUNT(*) FROM browser_history_import_keys").fetchone()[0], 0)
        with db.connect() as conn:
            conn.execute("DROP TRIGGER synthetic_failure")
        result = db.insert_imported_activity_segments([first, second], self.now.isoformat())
        self.assertEqual((result.inserted_count, result.skipped_duplicate_count), (2, 0))
        db.close()

    def test_trim_latest_segment_leaves_imported_segments_untouched(self) -> None:
        self._write_chromium_history(
            [
                ("https://docs.example.test/path", "Docs", self.now - timedelta(days=1, hours=3)),
                ("https://docs.example.test/next", "Docs next", self.now - timedelta(days=1, hours=2, minutes=57)),
            ]
        )
        db = TrackerDatabase(self.root / "tracker.sqlite3")
        import_browser_history(db, self._request())

        # Only the imported segment exists, so an idle/power trim finds nothing.
        db.trim_latest_segment((self.now - timedelta(days=2)).isoformat())

        live_start = self.now - timedelta(days=1, hours=5)
        live_end = self.now - timedelta(days=1, hours=4)
        db.insert_segment(
            {
                "started_at": live_start.isoformat(),
                "ended_at": live_end.isoformat(),
                "duration_seconds": 3600,
                "app_name": "Google Chrome",
                "source": "nsworkspace",
            }
        )
        # The imported segment ends later than the live one; the trim must still
        # target the live segment.
        db.trim_latest_segment((live_end - timedelta(minutes=10)).isoformat())

        with db.connect() as conn:
            rows = conn.execute(
                "SELECT source, ended_at, duration_seconds FROM activity_segments ORDER BY id"
            ).fetchall()
        by_source = {row["source"]: row for row in rows}
        self.assertIn("browser-history-import", by_source)
        expected_imported_end = self.now - timedelta(days=1, hours=2, minutes=52)
        self.assertEqual(by_source["browser-history-import"]["ended_at"], expected_imported_end.isoformat())
        self.assertEqual(by_source["nsworkspace"]["duration_seconds"], 3000)

    def test_import_extracts_youtube_video_id_from_watch_url(self) -> None:
        self._write_chromium_history(
            [
                (
                    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLtest123&t=42s",
                    "Video",
                    self.now - timedelta(days=1, hours=3),
                ),
            ]
        )
        db = TrackerDatabase(self.root / "tracker.sqlite3")

        import_browser_history(db, self._request())
        rows = db.timeline(
            start=(self.now - timedelta(days=2)).isoformat(),
            end=self.now.isoformat(),
        )

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["youtube_video_id"], "dQw4w9WgXcQ")
        self.assertEqual(rows[0]["youtube_playlist_id"], "PLtest123")
        # Sanitization still strips the raw query from the stored URL.
        self.assertEqual(rows[0]["site_url"], "https://www.youtube.com/watch")

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
            "https://www.google.co.kr/search?q=drifty",
            "https://google.de/search?q=drifty",
            "https://www.google.com.au/search?q=drifty",
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
            "https://google.co.kr/maps",
            "https://blog.mygoogle.com/search",
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
        self.assertTrue(all(s.platform == CAPTURE_PLATFORM for s in segments))


class BrowserHistoryEnvironmentTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = TemporaryDirectory()
        self.root = Path(self.tempdir.name)
        self.now = datetime(2026, 7, 3, 12, 0, tzinfo=timezone.utc)

    def tearDown(self) -> None:
        cleanup_temp_dir(self.tempdir)

    def _write_plist(self, name: str, data: object) -> Path:
        plist_path = self.root / name
        with plist_path.open("wb") as handle:
            plistlib.dump(data, handle)
        return plist_path

    def test_environment_command_returns_only_booleans(self) -> None:
        result = tracker_main._dispatch({"command": "get_browser_history_environment", "payload": {}})
        self.assertTrue(result["ok"])
        self.assertEqual(set(result["data"].keys()), {"safariHistoryReadable", "defaultBrowserIsSafari"})
        for value in result["data"].values():
            self.assertIsInstance(value, bool)

    def test_non_macos_never_reports_safari_as_the_default(self) -> None:
        self.assertFalse(default_browser_is_safari(self.root / "missing.plist", platform="win32"))

    def test_safari_history_readable_true_for_valid_database(self) -> None:
        write_safari_history(self.root, [("https://safari.test/", "Safari", self.now)])
        self.assertTrue(safari_history_readable(self.root))

    def test_safari_history_readable_false_when_absent(self) -> None:
        self.assertFalse(safari_history_readable(self.root))

    @unittest.skipUnless(_PLISTLIB_AVAILABLE, "plistlib unavailable in this interpreter")
    def test_default_browser_is_safari_false_for_explicit_chrome_handler(self) -> None:
        plist_path = self._write_plist(
            "chrome.plist",
            {"LSHandlers": [{"LSHandlerURLScheme": "http", "LSHandlerRoleAll": "com.google.chrome"}]},
        )
        self.assertFalse(default_browser_is_safari(plist_path, platform="darwin"))

    @unittest.skipUnless(_PLISTLIB_AVAILABLE, "plistlib unavailable in this interpreter")
    def test_default_browser_is_safari_true_for_explicit_safari_handler(self) -> None:
        plist_path = self._write_plist(
            "safari.plist",
            {"LSHandlers": [{"LSHandlerURLScheme": "https", "LSHandlerRoleAll": "com.apple.Safari"}]},
        )
        self.assertTrue(default_browser_is_safari(plist_path, platform="darwin"))

    @unittest.skipUnless(_PLISTLIB_AVAILABLE, "plistlib unavailable in this interpreter")
    def test_default_browser_is_safari_true_when_no_http_handler(self) -> None:
        plist_path = self._write_plist(
            "no_http.plist",
            {"LSHandlers": [{"LSHandlerURLScheme": "mailto", "LSHandlerRoleAll": "com.apple.mail"}]},
        )
        self.assertTrue(default_browser_is_safari(plist_path, platform="darwin"))

    @unittest.skipUnless(_PLISTLIB_AVAILABLE, "plistlib unavailable in this interpreter")
    def test_default_browser_is_safari_true_when_plist_absent(self) -> None:
        self.assertTrue(default_browser_is_safari(self.root / "missing.plist", platform="darwin"))

    @unittest.skipUnless(_PLISTLIB_AVAILABLE, "plistlib unavailable in this interpreter")
    def test_default_browser_is_safari_false_for_garbage_plist(self) -> None:
        garbage_path = self.root / "garbage.plist"
        garbage_path.write_bytes(b"\x00\x01 not a plist \xff")
        self.assertFalse(default_browser_is_safari(garbage_path, platform="darwin"))


if __name__ == "__main__":
    unittest.main()
