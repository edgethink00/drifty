from __future__ import annotations

from datetime import datetime, timedelta, timezone
import io
import json
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from app import main
from app.storage.db import TrackerDatabase, fetch_row_dicts
from app.storage.timeline_response import (
    TIMELINE_TOO_LARGE, TimelineJsonBuilder, TimelineTooLarge,
)
from tests.support_cleanup import cleanup_temp_dir


class BoundedTimelineTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(cleanup_temp_dir, self.temp)
        self.path = Path(self.temp.name) / "tracker.sqlite3"
        self.db = TrackerDatabase(self.path, perform_maintenance=False)
        self.addCleanup(self.db.close)

    def seed(self, count=405):
        start = datetime(2026, 11, 10, tzinfo=timezone.utc)
        with self.db.connect() as conn:
            conn.execute("INSERT INTO youtube_video_metadata(video_id,title,description,status) VALUES(?,?,?,?)",
                         ("synthetic", "한글 😀", "한글 😀 \"\\\x00" * 100, "ready"))
            for i in range(count):
                # Shuffled insertion order and equal start times at batch cuts.
                when = start + timedelta(seconds=((i * 17) % count) // 2)
                conn.execute("""INSERT INTO activity_segments
                    (started_at,ended_at,duration_seconds,app_name,segment_uid,
                     window_title,youtube_video_id,platform,source)
                    VALUES(?,?,?,?,?,?,?,?,?)""",
                    (when.isoformat(), (when + timedelta(seconds=1)).isoformat(),
                     1, "Synthetic", f"synthetic-{i}", f"Window {i}", "synthetic",
                     "windows", "synthetic"))
        self.db.save_classifications([
            {"segmentId": 1, "category": "workspace", "productivity": "focus", "source": "manual"},
        ])

    def expected(self, **kwargs):
        return [self.db._serialize_row(row) for row in self.db.timeline(**kwargs)]

    def test_preserves_order_enrichment_unicode_day_and_range(self):
        self.seed()
        for kwargs in ({}, {"start": "2026-11-10T00:00:15Z", "end": "2026-11-10T00:01:00Z"},
                       {"start": "2027-01-01T00:00:00Z"}):
            with self.subTest(kwargs=kwargs):
                encoded = self.db.encoded_timeline(**kwargs)
                self.assertEqual(json.loads(encoded.json), self.expected(**kwargs))
                self.assertEqual(encoded.count, len(json.loads(encoded.json)))
                self.assertTrue(encoded.json.isascii())
                self.assertFalse(self.db.connect().in_transaction)
        day = self.db._local_day(self.db.timeline()[0]["started_at"])
        self.assertEqual(json.loads(self.db.encoded_timeline(day=day).json), self.db.fetch_timeline(day))

    def test_all_batches_share_snapshot_during_retime_delete_append_and_metadata_edit(self):
        self.seed()
        expected = self.expected()
        writer = sqlite3.connect(self.path, timeout=0.05)
        self.addCleanup(writer.close)
        calls = 0

        def read(conn, query, params):
            nonlocal calls
            calls += 1
            if calls == 2:
                with writer:
                    writer.execute("DELETE FROM activity_segments WHERE id=405")
                    writer.execute("UPDATE activity_segments SET started_at='2030-01-01', ended_at='2030-01-02' WHERE id=1")
                    writer.execute("UPDATE activity_segments SET started_at='2020-01-01', ended_at='2020-01-02' WHERE id=400")
                    writer.execute("UPDATE youtube_video_metadata SET description='Changed'")
                    writer.execute("UPDATE activity_classifications SET category='entertainment' WHERE segment_id=1")
                    writer.execute("""INSERT INTO activity_segments
                        (started_at,ended_at,duration_seconds,app_name,segment_uid,platform,source)
                        VALUES('2031-01-01','2031-01-02',1,'Synthetic','new-synthetic','windows','synthetic')""")
            return fetch_row_dicts(conn, query, params)

        with patch("app.storage.db.fetch_row_dicts", side_effect=read):
            self.assertEqual(json.loads(self.db.encoded_timeline().json), expected)
        self.assertGreater(calls, 2)
        self.assertNotEqual(self.expected(), expected)
        self.assertFalse(self.db.connect().in_transaction)
        # Reader lifetime ended: a writer can checkpoint through its snapshot.
        self.assertEqual(writer.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()[0], 0)

    def test_exact_json_budget_rejects_whole_result_and_releases_snapshot(self):
        self.seed(3)
        expected = self.expected()
        size = len(json.dumps(expected).encode("ascii"))
        with patch("app.storage.timeline_response.MAX_TIMELINE_JSON_BYTES", size):
            self.assertEqual(json.loads(self.db.encoded_timeline().json), expected)
        with patch("app.storage.timeline_response.MAX_TIMELINE_JSON_BYTES", size - 1):
            with self.assertRaisesRegex(TimelineTooLarge, TIMELINE_TOO_LARGE):
                self.db.encoded_timeline()
        self.assertFalse(self.db.connect().in_transaction)
        self.assertEqual(json.loads(self.db.encoded_timeline().json), expected)

    def test_limit_failure_releases_snapshot_even_with_retained_traceback(self):
        self.seed()
        held = None
        with patch("app.storage.timeline_response.MAX_TIMELINE_JSON_BYTES", 100):
            try:
                self.db.encoded_timeline()
            except TimelineTooLarge as error:
                held = error
        self.assertIsNotNone(held)
        self.assertIsNotNone(held.__traceback__)
        self.assertFalse(self.db.connect().in_transaction)
        writer = sqlite3.connect(self.path, timeout=0.05)
        try:
            with writer:
                writer.execute("UPDATE activity_segments SET window_title='Changed' WHERE id=1")
            self.assertEqual(writer.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()[0], 0)
        finally:
            writer.close()
        self.assertIsNotNone(held.__traceback__)

    def test_preflight_counts_nul_and_multibyte_before_detail_materialization(self):
        self.seed(1)
        with self.db.connect() as conn:
            conn.execute("UPDATE youtube_video_metadata SET description=?", ("\x00" + "한글😀" * 1000,))
        with patch("app.storage.db.MAX_TIMELINE_SOURCE_ROW_BYTES", 4000), \
                patch("app.storage.db.fetch_row_dicts", wraps=fetch_row_dicts) as read:
            with self.assertRaises(TimelineTooLarge):
                self.db.encoded_timeline()
        read.assert_not_called()
        self.assertFalse(self.db.connect().in_transaction)

    def test_encoded_row_budget_releases_reader_without_partial_success(self):
        self.seed(1)
        with patch("app.storage.timeline_response.MAX_TIMELINE_JSON_ROW_BYTES", 100):
            with self.assertRaises(TimelineTooLarge):
                self.db.encoded_timeline()
        self.assertFalse(self.db.connect().in_transaction)
        self.assertEqual(self.db.connect().execute("PRAGMA quick_check").fetchone()[0], "ok")

    def test_detail_error_releases_reader_and_read_only_result_does_not_mutate(self):
        self.seed()
        expected = self.expected()
        reader = TrackerDatabase(self.path, read_only=True)
        self.addCleanup(reader.close)
        original = self.path.read_bytes()
        with patch("app.storage.db.fetch_row_dicts", side_effect=sqlite3.OperationalError("synthetic read failure")):
            with self.assertRaisesRegex(sqlite3.OperationalError, "synthetic read failure"):
                reader.encoded_timeline()
        self.assertFalse(reader.connect().in_transaction)
        changes = reader.connect().total_changes
        self.assertEqual(json.loads(reader.encoded_timeline().json), expected)
        self.assertEqual(reader.connect().total_changes, changes)
        reader.close()
        self.assertEqual(self.path.read_bytes(), original)

    def test_serve_and_one_shot_keep_array_contract_and_follow_limit_failure(self):
        self.seed(3)
        expected = self.expected()
        request = {"id": 42, "command": "get_timeline", "payload": {}}
        output = io.StringIO()
        with patch.object(main, "database", return_value=self.db), \
                patch.object(main.sys, "stdin", io.StringIO(json.dumps(request) + "\n")), \
                patch.object(main.sys, "stdout", output):
            main.serve()
        wire = json.loads(output.getvalue())
        self.assertEqual(wire, {"ok": True, "error": None, "id": 42, "data": expected})
        self.assertLessEqual(len(output.getvalue().encode("ascii")), 32 * 1024 * 1024 + 1024)
        output = io.StringIO()
        with patch.object(main, "database", return_value=self.db), \
                patch.object(main.sys, "stdout", output):
            main.handle_request(json.dumps(request))
        self.assertEqual(json.loads(output.getvalue())["data"], expected)
        request["payload"] = {"start": "2027-01-01", "end": "2027-01-02"}
        output = io.StringIO()
        lines = json.dumps({"id": 1, "command": "get_timeline", "payload": {}}) + "\n" + json.dumps(request) + "\n"
        with patch.object(main, "database", return_value=self.db), \
                patch("app.storage.timeline_response.MAX_TIMELINE_JSON_BYTES", 10), \
                patch.object(main.sys, "stdin", io.StringIO(lines)), \
                patch.object(main.sys, "stdout", output), \
                patch.object(main, "capture_tracker_exception") as capture:
            main.serve()
        failure, healthy = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual(failure, {"ok": False, "data": None, "error": TIMELINE_TOO_LARGE, "id": 1})
        self.assertEqual(healthy, {"ok": True, "data": [], "error": None, "id": 42})
        capture.assert_not_called()

    def test_source_batches_obey_byte_budget(self):
        self.seed(405)
        sizes = []

        def read(conn, query, params):
            sizes.append(len(params))
            return fetch_row_dicts(conn, query, params)

        with patch("app.storage.db.MAX_TIMELINE_SOURCE_BATCH_BYTES", 8000), \
                patch("app.storage.db.fetch_row_dicts", side_effect=read):
            actual = json.loads(self.db.encoded_timeline().json)
        self.assertEqual(actual, self.expected())
        self.assertGreater(len(sizes), 3)
        self.assertLess(max(sizes), 200)


class TimelineJsonBuilderTests(unittest.TestCase):
    def test_ascii_escaping_and_exact_row_limit(self):
        item = {"text": "한글 😀 \"\\\x00\n"}
        size = len(json.dumps(item).encode("ascii"))
        for budget, succeeds in ((size, True), (size - 1, False)):
            with self.subTest(budget=budget), patch("app.storage.timeline_response.MAX_TIMELINE_JSON_ROW_BYTES", budget):
                builder = TimelineJsonBuilder()
                try:
                    if succeeds:
                        builder.append(item)
                        self.assertEqual(json.loads(builder.finish().json), [item])
                    else:
                        with self.assertRaises(TimelineTooLarge):
                            builder.append(item)
                finally:
                    builder.close()
