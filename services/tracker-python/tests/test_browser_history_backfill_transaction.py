from __future__ import annotations

import json
import sqlite3
import sys
import threading
import unittest
from dataclasses import replace
from pathlib import Path
from tempfile import TemporaryDirectory

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.storage.db import BrowserHistoryBackfillConfig, TrackerDatabase
from app.tracker.browser_automation import BrowserMetadata
from app.tracker.macos_workspace import Snapshot
from tests.support_cleanup import cleanup_temp_dir


class BrowserHistoryBackfillTransactionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = TemporaryDirectory()
        self.path = Path(self.tempdir.name) / "tracker.sqlite3"
        self.database = TrackerDatabase(self.path)
        self.other = TrackerDatabase(self.path)
        self.other.connect()
        self.config = BrowserHistoryBackfillConfig("2026-10-14T01:00:30+00:00", 180)
        self.metadata = BrowserMetadata(
            browser_name="Google Chrome",
            site_domain="qa.invalid",
            site_title="Synthetic page",
            site_url="https://qa.invalid/page",
            match_state="browser-history-title",
            browser_history_status="matched",
        )

    def tearDown(self) -> None:
        self.other.close()
        self.database.close()
        cleanup_temp_dir(self.tempdir)

    def _segment(self, second: int = 0, *, platform: str = "macos", source: str = "accessibility") -> int:
        self.database.record_snapshot(
            Snapshot(
                observed_at=f"2026-10-14T01:00:{second:02d}+00:00",
                app_name="Google Chrome",
                bundle_id="qa.browser",
                window_title=f"Synthetic page {second} - Google Chrome",
                source=source,
                browser_name="Google Chrome",
                browser_history_status="no_match",
            ),
            5,
            max_merge_gap_seconds=0,
        )
        with self.database.connect() as conn:
            segment_id = int(conn.execute("SELECT max(id) FROM activity_segments").fetchone()[0])
            conn.execute("UPDATE activity_segments SET platform = ? WHERE id = ?", (platform, segment_id))
        self.other.save_classifications([{
            "segmentId": segment_id, "inputFingerprint": "qa-before",
            "category": "workspace", "productivity": "focus", "source": "manual",
        }])
        return segment_id

    def _backfill(self, resolver):
        return self.database.backfill_recent_browser_history_context(resolver, lambda title: True, self.config)

    def _row(self, segment_id: int):
        return self.database.connect().execute("SELECT * FROM activity_segments WHERE id = ?", (segment_id,)).fetchone()

    def _stale(self, segment_id: int) -> int:
        return int(self.database.connect().execute(
            "SELECT stale FROM activity_classifications WHERE segment_id = ?", (segment_id,),
        ).fetchone()[0])

    def test_other_writer_can_save_while_second_history_lookup_is_blocked(self) -> None:
        first_id = self._segment(0)
        self._segment(10)
        waiting = threading.Event()
        release = threading.Event()
        result = {}

        def writer() -> None:
            database = TrackerDatabase(self.path)
            calls = 0

            def resolve(*args):
                nonlocal calls
                calls += 1
                if calls == 2:
                    result["transaction_during_lookup"] = database.connect().in_transaction
                    waiting.set()
                    if not release.wait(5):
                        raise TimeoutError("Test lookup was not released")
                return self.metadata

            try:
                result["backfilled"] = database.backfill_recent_browser_history_context(
                    resolve, lambda title: True, self.config,
                )
            except Exception as exc:
                result["error"] = exc
            finally:
                database.close()

        thread = threading.Thread(target=writer)
        thread.start()
        try:
            self.assertTrue(waiting.wait(5), "Second lookup did not start")
            # A short bounded timeout makes a held writer fail without sleeping
            # for SQLite's production five-second busy timeout.
            self.other.connect().execute("PRAGMA busy_timeout = 200")
            saved = self.other.save_classifications([{
                "segmentId": first_id, "inputFingerprint": "qa-during-lookup",
                "category": "workspace", "productivity": "focus", "source": "manual",
            }])
            self.assertEqual(saved, 1)
            self.assertFalse(result["transaction_during_lookup"])
        finally:
            release.set()
            thread.join(5)
        self.assertFalse(thread.is_alive())
        self.assertNotIn("error", result)
        self.assertEqual(len(result["backfilled"]), 2)
        self.assertFalse(self.database.connect().in_transaction)

    def test_late_resolver_error_leaves_all_rows_and_classifications_unchanged(self) -> None:
        ids = [self._segment(0), self._segment(10)]
        before = [dict(self._row(segment_id)) for segment_id in ids]
        calls = 0

        def resolve(*args):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError("Synthetic History read failed")
            return self.metadata

        with self.assertRaisesRegex(OSError, "Synthetic History read failed"):
            self._backfill(resolve)
        self.assertEqual([dict(self._row(segment_id)) for segment_id in ids], before)
        self.assertEqual([self._stale(segment_id) for segment_id in ids], [0, 0])
        self.assertFalse(self.database.connect().in_transaction)

    def test_late_write_error_rolls_back_enrichment_and_stale_flags(self) -> None:
        ids = [self._segment(0), self._segment(10)]
        before = [dict(self._row(segment_id)) for segment_id in ids]
        with self.database.connect() as conn:
            # Newest is updated first. Fail the later UPDATE to verify the
            # staged batch and classification invalidation remain atomic.
            conn.execute(f"""CREATE TRIGGER qa_fail_backfill BEFORE UPDATE OF site_url ON activity_segments
                WHEN NEW.id = {ids[0]} BEGIN SELECT RAISE(ABORT, 'Synthetic write failed'); END""")
        with self.assertRaisesRegex(sqlite3.IntegrityError, "Synthetic write failed"):
            self._backfill(lambda *args: self.metadata)
        self.assertEqual([dict(self._row(segment_id)) for segment_id in ids], before)
        self.assertEqual([self._stale(segment_id) for segment_id in ids], [0, 0])
        self.assertFalse(self.database.connect().in_transaction)

    def test_deleted_segment_is_not_reported_or_recreated(self) -> None:
        segment_id = self._segment()

        def resolve(*args):
            self.other.delete_activity_segments([str(segment_id)])
            return self.metadata

        self.assertEqual(self._backfill(resolve), [])
        self.assertIsNone(self._row(segment_id))

    def test_new_site_context_is_not_overwritten_or_marked_stale(self) -> None:
        segment_id = self._segment()

        def resolve(*args):
            with self.other.connect() as conn:
                conn.execute("UPDATE activity_segments SET site_url = ?, site_title = ? WHERE id = ?",
                             ("https://qa.invalid/newer", "Newer context", segment_id))
            return self.metadata

        self.assertEqual(self._backfill(resolve), [])
        self.assertEqual(self._row(segment_id)["site_url"], "https://qa.invalid/newer")
        self.assertEqual(self._row(segment_id)["site_title"], "Newer context")
        self.assertEqual(self._stale(segment_id), 0)

    def test_changed_capture_or_context_is_skipped(self) -> None:
        changes = {
            "started_at": "2026-10-14T00:59:59+00:00",
            "ended_at": "2026-10-14T01:00:25+00:00",
            "duration_seconds": 25,
            "app_name": "Another browser", "bundle_id": "qa.other",
            "window_title": "Another page", "platform": "windows",
            "source": "win32-foreground", "browser_name": "Another browser",
            "site_source": "newer-source", "confidence": 0.9,
            "raw_context_json": json.dumps({"browser_history_status": "matched"}),
            "site_domain": "newer.invalid", "site_title": "Newer title",
            "youtube_video_id": "newer-video", "youtube_playlist_id": "newer-playlist",
            "youtube_is_shorts": 0,
        }
        for column, value in changes.items():
            with self.subTest(column=column):
                segment_id = self._segment()

                def resolve(*args):
                    with self.other.connect() as conn:
                        conn.execute(f"UPDATE activity_segments SET {column} = ? WHERE id = ?", (value, segment_id))
                    return self.metadata

                self.assertEqual(self._backfill(resolve), [])
                self.assertEqual(self._row(segment_id)[column], value)
                self.assertIsNone(self._row(segment_id)["site_url"])
                self.assertEqual(self._stale(segment_id), 0)
                self.database.delete_activity_segments([str(segment_id)])

    def test_unchanged_row_is_enriched_and_its_new_classification_is_marked_stale(self) -> None:
        segment_id = self._segment()

        def resolve(*args):
            self.other.save_classifications([{
                "segmentId": segment_id, "inputFingerprint": "qa-newer",
                "category": "entertainment", "productivity": "drift", "source": "manual",
            }])
            return self.metadata

        results = self._backfill(resolve)
        self.assertEqual([item.segment_id for item in results], [segment_id])
        self.assertEqual(self._row(segment_id)["site_url"], self.metadata.site_url)
        self.assertEqual(self._row(segment_id)["confidence"], 0.45)
        self.assertEqual(self._stale(segment_id), 1)

    def test_no_match_does_not_open_write_transaction(self) -> None:
        segment_id = self._segment()
        before = dict(self._row(segment_id))
        self.assertEqual(self._backfill(lambda *args: replace(self.metadata, match_state="no-match", site_url=None)), [])
        self.assertEqual(dict(self._row(segment_id)), before)
        self.assertEqual(self._stale(segment_id), 0)
        self.assertFalse(self.database.connect().in_transaction)

    def test_windows_records_are_not_resolved(self) -> None:
        self._segment(0, platform="windows")
        self._segment(10, source="win32-foreground")

        def resolve(*args):
            self.fail("Windows title-only records must not acquire History context")

        self.assertEqual(self._backfill(resolve), [])


if __name__ == "__main__":
    unittest.main()
