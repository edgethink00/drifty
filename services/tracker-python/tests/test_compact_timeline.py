from __future__ import annotations

import io
import json
import sqlite3
import unittest
from unittest.mock import patch

from app import main
from app.storage.db import fetch_row_dicts
from app.storage.timeline_response import TimelineTooLarge
from tests import test_bounded_timeline as bounded_fixture


def restore(packet):
    result = []
    for row in packet["items"]:
        item = dict(row)
        metadata = packet["youtubeMetadata"][item.pop("youtubeMetadataIndex")]
        result.append({**item, **metadata})
    return result


class CompactTimelineTests(unittest.TestCase):
    setUp = bounded_fixture.BoundedTimelineTests.setUp
    seed = bounded_fixture.BoundedTimelineTests.seed
    expected = bounded_fixture.BoundedTimelineTests.expected

    def compact(self, **kwargs):
        return json.loads(self.db.encoded_timeline(share_video_metadata=True, **kwargs).json)

    def test_exact_full_values_with_one_metadata_read_per_video(self):
        self.seed()
        expected = self.expected()
        queries = []
        self.db.connect().set_trace_callback(queries.append)
        actual = self.compact()
        self.db.connect().set_trace_callback(None)
        self.assertEqual(restore(actual), expected)
        self.assertEqual(len(actual["youtubeMetadata"]), 1)
        self.assertEqual(len(actual["items"]), 405)
        self.assertEqual(len([sql for sql in queries if " FROM youtube_video_metadata WHERE video_id" in sql]), 2)
        self.assertFalse(any("LEFT JOIN youtube_video_metadata" in sql for sql in queries))
        self.assertEqual(self.compact(start="2027-01-01", end="2027-01-02"), {"items": [], "youtubeMetadata": []})

    def test_long_shared_description_succeeds_below_same_budget_that_rejects_full(self):
        self.seed(200)
        with self.db.connect() as conn:
            conn.execute("UPDATE youtube_video_metadata SET description=?", ("가" * 4000,))
        expected = self.expected()
        with patch("app.storage.timeline_response.MAX_TIMELINE_JSON_BYTES", 512 * 1024), \
                patch("app.storage.compact_timeline.MAX_TIMELINE_JSON_BYTES", 512 * 1024):
            with self.assertRaises(TimelineTooLarge):
                self.db.encoded_timeline()
            packet = self.compact()
        self.assertEqual(restore(packet), expected)
        self.assertLess(len(json.dumps(packet)), 512 * 1024)

    def test_snapshot_includes_unseen_metadata_while_writer_retimes_deletes_and_appends(self):
        self.seed()
        with self.db.connect() as conn:
            conn.execute("INSERT INTO youtube_video_metadata(video_id,description,status) VALUES('unseen','Before','ready')")
            conn.execute("UPDATE activity_segments SET youtube_video_id='unseen' WHERE id=405")
        expected = self.expected()
        writer = sqlite3.connect(self.path, timeout=0.05)
        self.addCleanup(writer.close)
        calls = 0

        def read(conn, query, params):
            nonlocal calls
            calls += 1
            if calls == 2:
                with writer:
                    writer.execute("UPDATE youtube_video_metadata SET description='Changed'")
                    writer.execute("DELETE FROM activity_segments WHERE id=405")
                    writer.execute("UPDATE activity_segments SET started_at='2030-01-01',ended_at='2030-01-02' WHERE id=1")
                    writer.execute("UPDATE activity_classifications SET category='entertainment' WHERE segment_id=1")
                    writer.execute("""INSERT INTO activity_segments
                        (started_at,ended_at,duration_seconds,app_name,segment_uid,platform,source)
                        VALUES('2031-01-01','2031-01-02',1,'Synthetic','new','windows','synthetic')""")
            return fetch_row_dicts(conn, query, params)

        with patch("app.storage.db.fetch_row_dicts", side_effect=read):
            self.assertEqual(restore(self.compact()), expected)
        self.assertGreater(calls, 2)
        self.assertNotEqual(self.expected(), expected)
        self.assertEqual(writer.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()[0], 0)

    def test_missing_empty_and_hidden_lookup_id_preserve_existing_privacy_values(self):
        self.seed(5)
        with self.db.connect() as conn:
            conn.execute("INSERT INTO youtube_video_metadata(video_id,description,status) VALUES('','Empty ID','ready')")
            conn.execute("INSERT INTO youtube_video_metadata(video_id,description,status) VALUES('hidden-lookup','Private','ready')")
            conn.execute("UPDATE activity_segments SET youtube_video_id=NULL WHERE id=1")
            conn.execute("UPDATE activity_segments SET youtube_video_id='' WHERE id=2")
            conn.execute("UPDATE activity_segments SET youtube_video_id='missing' WHERE id=3")
            conn.execute("""UPDATE activity_segments SET youtube_video_id='hidden-lookup',
                site_source='applescript-front-window',site_title='Different',window_title='Unrelated' WHERE id=4""")
        packet = self.compact()
        self.assertEqual(restore(packet), self.expected())
        self.assertNotIn("hidden-lookup", json.dumps(packet))
        hidden = next(row for row in restore(packet) if row["id"] == "4")
        self.assertIsNone(hidden["youtubeVideoId"])
        self.assertEqual(hidden["youtubeDescription"], "Private")

    def test_equal_metadata_does_not_disclose_distinct_hidden_lookup_identities(self):
        self.seed(2)
        with self.db.connect() as conn:
            conn.execute("INSERT INTO youtube_video_metadata(video_id,title,description,status) SELECT 'other',title,description,status FROM youtube_video_metadata WHERE video_id='synthetic'")
            conn.execute("UPDATE activity_segments SET youtube_video_id='other' WHERE id=2")
            conn.execute("UPDATE activity_segments SET site_source='applescript-front-window',site_title='Different',window_title='Unrelated'")
        packet = self.compact()
        self.assertEqual(restore(packet), self.expected())
        self.assertEqual(len(packet["youtubeMetadata"]), 1)
        self.assertTrue(all(row["youtubeVideoId"] is None for row in packet["items"]))
        self.assertEqual([row["youtubeMetadataIndex"] for row in packet["items"]], [0, 0])
        self.assertNotIn('other', json.dumps(packet))

    def test_exact_combined_budget_counts_both_arrays_and_packet_overhead(self):
        self.seed(3)
        size = len(self.db.encoded_timeline(share_video_metadata=True).json)
        with patch("app.storage.compact_timeline.MAX_TIMELINE_JSON_BYTES", size):
            self.assertEqual(restore(self.compact()), self.expected())
        with patch("app.storage.compact_timeline.MAX_TIMELINE_JSON_BYTES", size - 1):
            with self.assertRaises(TimelineTooLarge):
                self.compact()

    def test_metadata_preflight_and_failure_release_with_retained_traceback(self):
        self.seed()
        with self.db.connect() as conn:
            conn.execute("UPDATE youtube_video_metadata SET description=?", ("\x00" + "가" * 4000,))
        held = None
        with patch("app.storage.db.MAX_TIMELINE_SOURCE_ROW_BYTES", 4000):
            try:
                self.compact()
            except TimelineTooLarge as exc:
                held = exc
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

    def test_protocol_error_then_healthy_response_without_exception_capture(self):
        self.seed(3)
        full = {"id": 1, "command": "get_compact_timeline", "payload": {"start": "2026-11-10", "end": "2026-11-11"}}
        empty = {**full, "id": 2, "payload": {"start": "2027-01-01", "end": "2027-01-02"}}
        output = io.StringIO()
        with patch.object(main, "database", return_value=self.db), \
                patch.object(main.sys, "stdin", io.StringIO(json.dumps(full) + "\n" + json.dumps(empty) + "\n")), \
                patch.object(main.sys, "stdout", output), \
                patch.object(main, "capture_tracker_exception") as capture, \
                patch("app.storage.compact_timeline.MAX_TIMELINE_JSON_BYTES", 100):
            main.serve()
        failed, healthy = [json.loads(row) for row in output.getvalue().splitlines()]
        self.assertEqual(failed, {"id": 1, "ok": False, "data": None, "error": "tracker_timeline_too_large"})
        self.assertEqual(healthy, {"id": 2, "ok": True, "data": {"items": [], "youtubeMetadata": []}, "error": None})
        capture.assert_not_called()
        for payload in ({}, {"start": "x"}, {"day": "2026-11-10"}):
            with patch.object(main, "database") as database:
                self.assertFalse(main.get_compact_timeline(payload)["ok"])
                database.assert_not_called()
