from __future__ import annotations

import hashlib
import sqlite3
import unittest
import uuid
from contextlib import closing, contextmanager
from dataclasses import asdict, replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from app.storage.db import TrackerDatabase
from app.storage import screen_activity_binding
from app.storage.screen_activity_binding import (
    CapturedWindowHint, read_local_record_refs, resolve_capture_record, window_title_digest,
)
from app.tracker.capture_contract import Snapshot

BASE = 1_792_512_000_000
APP = "com.apple.TextEdit"
TITLE = "Owned QA document — cache expiry"


def iso(offset_ms: int) -> str:
    return datetime.fromtimestamp((BASE + offset_ms) / 1000, timezone.utc).isoformat()


@contextmanager
def database_connection(path):
    # Close explicitly so a Windows test never leaves a SQLite file handle
    # alive until cyclic GC while its temporary directory is being removed.
    with closing(sqlite3.connect(path)) as conn:
        with conn:
            yield conn


class ScreenActivityBindingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "tracker.sqlite3"
        self.platform = patch("app.storage.screen_activity_binding.CAPTURE_PLATFORM", "macos")
        self.platform.start()
        self.addCleanup(self.platform.stop)
        # These assertions exercise row identity/range semantics, not host I/O
        # speed. Keep the optional query's clock deterministic; separate tests
        # below force pre-query and post-query deadline exhaustion. Actual
        # Python/Rust interop exercises the unchanged real 50/200ms budgets.
        self.query_clock = patch("app.storage.screen_activity_binding.time.monotonic", return_value=1000.0)
        self.query_clock.start()
        self.addCleanup(self.query_clock.stop)
        with database_connection(self.path) as conn:
            conn.execute("""CREATE TABLE activity_segments (
                id INTEGER PRIMARY KEY, segment_uid TEXT, started_at TEXT, ended_at TEXT,
                duration_seconds INTEGER DEFAULT 5, platform TEXT DEFAULT 'macos',
                source TEXT DEFAULT 'accessibility', bundle_id TEXT, window_title TEXT,
                origin_device_id TEXT, exclusion_source TEXT, engagement_evidence TEXT,
                confidence REAL DEFAULT 1)""")
            conn.execute("CREATE INDEX ends ON activity_segments(datetime(ended_at))")
        self.hint = CapturedWindowHint(APP, window_title_digest(TITLE), BASE + 1000)

    def row(self, **changes) -> dict:
        value = dict(id=1, segment_uid=str(uuid.uuid4()), started_at=iso(0), ended_at=iso(5000),
                     platform="macos", source="accessibility", bundle_id=APP, window_title=TITLE,
                     origin_device_id=None, exclusion_source=None, engagement_evidence=None,
                     confidence=1.0)
        value.update(changes)
        with database_connection(self.path) as conn:
            keys = ",".join(value)
            conn.execute(f"INSERT INTO activity_segments ({keys}) VALUES ({','.join('?' for _ in value)})",
                         tuple(value.values()))
        return value

    def resolve(self, hint=None, **kwargs):
        return resolve_capture_record(self.path, self.hint if hint is None else hint,
                                      now_ms=BASE + 6000, **kwargs)

    def test_unique_exact_native_hint_returns_minimal_stable_reference(self):
        row = self.row()
        before = self.path.read_bytes()
        ref = self.resolve()
        self.assertEqual(ref.record_id, "1")
        self.assertEqual(ref.segment_uid, row["segment_uid"])
        self.assertTrue(ref.contains(BASE + 1000))
        self.assertEqual(len(ref.identity_digest), 64)
        self.assertNotIn(APP, str(asdict(ref)))
        self.assertNotIn(TITLE, str(asdict(ref)))
        self.assertEqual(self.path.read_bytes(), before)

    def test_real_tracker_point_waits_for_normal_extension_without_forcing_time(self):
        path = self.path.parent / "real.sqlite3"
        with patch("app.storage.db.CAPTURE_PLATFORM", "macos"):
            db = TrackerDatabase(path, perform_maintenance=False)
            try:
                first = db.record_snapshot(Snapshot(iso(0), "TextEdit", APP, TITLE, "accessibility"), 5)
                self.assertIsNone(resolve_capture_record(path, self.hint, now_ms=BASE + 1000))
                second = db.record_snapshot(Snapshot(iso(5000), "TextEdit", APP, TITLE, "accessibility"), 5)
                self.assertEqual(first.after.segment_uid, second.after.segment_uid)
                ref = resolve_capture_record(path, self.hint, now_ms=BASE + 6000)
                self.assertEqual(ref.segment_uid, first.after.segment_uid)
                with database_connection(path) as conn:
                    timing = conn.execute("SELECT started_at,ended_at,duration_seconds FROM activity_segments").fetchone()
                self.assertEqual(timing, (iso(0), iso(5000), 10))
            finally:
                db.close()

    def test_exact_interval_is_half_open_not_sqlite_second_precision(self):
        self.row(started_at=iso(0).replace("00+", "00.000500+"),
                 ended_at=iso(5000).replace("05+", "05.000500+"))
        for offset, expected in [(0, False), (1, True), (5000, True), (5001, False)]:
            with self.subTest(offset=offset):
                ref = self.resolve(replace(self.hint, observed_at_ms=BASE + offset))
                self.assertEqual(ref is not None, expected)
        current = read_local_record_refs(self.path, ["1"])[0]
        self.assertEqual(current.started_at_ms, BASE + 1)
        self.assertEqual(current.ended_at_ms, BASE + 5001)

    def test_offset_aware_ranges_preserve_the_actual_point(self):
        zone = timezone(timedelta(hours=9))
        row = self.row(started_at=datetime.fromisoformat(iso(0)).astimezone(zone).isoformat(),
                       ended_at=datetime.fromisoformat(iso(5000)).astimezone(zone).isoformat())
        self.assertTrue(row["started_at"].endswith("+09:00"))
        self.assertEqual(self.resolve().started_at_ms, BASE)

    def test_ambiguous_complete_matches_never_choose_first_or_latest(self):
        self.row()
        self.row(id=2)
        self.assertIsNone(self.resolve())

    def test_candidates_outside_exact_fraction_do_not_make_a_false_match(self):
        self.row(started_at=iso(1000).replace("01+", "01.000500+"))
        self.assertIsNone(self.resolve())

    def test_candidate_cap_refuses_incomplete_scan_even_with_one_exact_match(self):
        for index in range(65):
            self.row(id=index + 1, started_at=iso(1000).replace("01+", "01.000500+") if index else iso(0))
        self.assertIsNone(self.resolve())

    def test_title_and_app_identity_are_exact_not_similar(self):
        self.row()
        for hint in [replace(self.hint, app_key="TextEdit"),
                     replace(self.hint, app_key=APP.upper()),
                     replace(self.hint, title_digest=window_title_digest(TITLE.lower())),
                     replace(self.hint, title_digest=window_title_digest(TITLE + " "))]:
            with self.subTest(hint=hint):
                self.assertIsNone(self.resolve(hint))

    def test_remote_imported_redacted_passive_uncertain_unknown_rows_do_not_bind(self):
        cases = [dict(origin_device_id="other-device"), dict(source="browser-history-import"),
                 dict(exclusion_source="app"), dict(engagement_evidence="foreground-audio"),
                 dict(confidence=0.8), dict(platform="windows"), dict(bundle_id=None),
                 dict(window_title=None), dict(segment_uid=None),
                 dict(segment_uid="00000000-0000-0000-0000-000000000000"),
                 dict(segment_uid="not-a-stable-uid"), dict(source="unknown"),
                 dict(started_at="2026-10-20T00:00:00"), dict(ended_at=iso(-1))]
        for changes in cases:
            with self.subTest(changes=changes):
                with database_connection(self.path) as conn:
                    conn.execute("DELETE FROM activity_segments")
                self.row(**changes)
                self.assertIsNone(self.resolve())
                self.assertEqual(read_local_record_refs(self.path, ["1"]), ())

    def test_windows_uses_its_actual_platform_and_native_app_key(self):
        app = "Microsoft.WindowsNotepad_8wekyb3d8bbwe!App"
        self.row(platform="windows", source="win32-foreground", bundle_id=app)
        hint = replace(self.hint, app_key=app)
        with patch("app.storage.screen_activity_binding.CAPTURE_PLATFORM", "windows"):
            self.assertIsNotNone(self.resolve(hint))
            self.assertEqual(len(read_local_record_refs(self.path, ["1"])), 1)
        self.assertIsNone(self.resolve(hint))

    def test_id_reuse_changes_uid_and_identity_while_range_growth_does_not(self):
        self.row()
        original = read_local_record_refs(self.path, ["1"])[0]
        with database_connection(self.path) as conn:
            conn.execute("UPDATE activity_segments SET ended_at=? WHERE id=1", (iso(8000),))
        grown = read_local_record_refs(self.path, ["1"])[0]
        self.assertEqual(original.identity_digest, grown.identity_digest)
        with database_connection(self.path) as conn:
            conn.execute("DELETE FROM activity_segments WHERE id=1")
        self.row()
        reused = read_local_record_refs(self.path, ["1"])[0]
        self.assertNotEqual(original.segment_uid, reused.segment_uid)
        self.assertNotEqual(original.identity_digest, reused.identity_digest)

    def test_a_result_finishing_after_the_optional_deadline_is_never_returned(self):
        self.row()
        read_connection = screen_activity_binding._read_connection
        for operation in (lambda: self.resolve(), lambda: read_local_record_refs(self.path, ["1"])):
            now = [1000.0]

            class DelayedResult:
                def __init__(self, cursor):
                    self.cursor = cursor

                def fetchall(self):
                    rows = self.cursor.fetchall()
                    now[0] += 0.051
                    return rows

            class DelayedQuery:
                def __init__(self, connection):
                    self.connection = connection

                def execute(self, *args):
                    return DelayedResult(self.connection.execute(*args))

            @contextmanager
            def delayed_connection(path):
                with read_connection(path) as (connection, deadline):
                    yield DelayedQuery(connection), deadline

            with patch("app.storage.screen_activity_binding.time.monotonic",
                       side_effect=lambda: now[0]), patch(
                           "app.storage.screen_activity_binding._read_connection", delayed_connection):
                self.assertFalse(operation())

    def test_same_uid_cannot_hide_app_title_source_or_time_changes(self):
        row = self.row()
        original = read_local_record_refs(self.path, ["1"])[0]
        with database_connection(self.path) as conn:
            conn.execute("UPDATE activity_segments SET window_title=? WHERE id=1", (TITLE + " changed",))
        changed = read_local_record_refs(self.path, ["1"])[0]
        self.assertEqual(changed.segment_uid, row["segment_uid"])
        self.assertNotEqual(original.identity_digest, changed.identity_digest)
        with database_connection(self.path) as conn:
            conn.execute("UPDATE activity_segments SET bundle_id=? WHERE id=1", (APP + ".other",))
        changed_app = read_local_record_refs(self.path, ["1"])[0]
        self.assertNotEqual(changed.identity_digest, changed_app.identity_digest)
        with database_connection(self.path) as conn:
            conn.execute("UPDATE activity_segments SET ended_at=? WHERE id=1", (iso(500),))
        trimmed = read_local_record_refs(self.path, ["1"])[0]
        self.assertFalse(trimmed.contains(BASE + 1000))
        with database_connection(self.path) as conn:
            conn.execute("UPDATE activity_segments SET source='unknown' WHERE id=1")
        self.assertEqual(read_local_record_refs(self.path, ["1"]), ())

    def test_missing_foreign_corrupt_locked_database_never_creates_or_repairs(self):
        missing = self.path.parent / "missing.sqlite3"
        self.assertIsNone(resolve_capture_record(missing, self.hint, now_ms=BASE + 6000))
        self.assertFalse(missing.exists())
        foreign = self.path.parent / "foreign.sqlite3"
        foreign.write_bytes(b"unrelated bytes")
        self.assertEqual(read_local_record_refs(foreign, ["1"]), ())
        self.assertEqual(foreign.read_bytes(), b"unrelated bytes")
        self.row()
        with database_connection(self.path) as writer:
            writer.execute("BEGIN EXCLUSIVE")
            self.assertIsNone(self.resolve())

    def test_symlink_path_is_not_followed(self):
        self.row()
        linked = self.path.parent / "link.sqlite3"
        try:
            linked.symlink_to(self.path)
        except OSError:
            self.skipTest("Symlink creation is unavailable for this test token")
        self.assertIsNone(resolve_capture_record(linked, self.hint, now_ms=BASE + 6000))

    def test_exhausted_optional_query_budget_never_returns_a_reference(self):
        self.row()
        with patch("app.storage.screen_activity_binding._QUERY_BUDGET_SECONDS", 0):
            self.assertIsNone(self.resolve())
            self.assertEqual(read_local_record_refs(self.path, ["1"]), ())

    def test_bad_stale_future_hints_and_unbounded_id_requests_are_refused(self):
        self.row()
        for hint in [replace(self.hint, observed_at_ms=True),
                     replace(self.hint, observed_at_ms=BASE - 5000),
                     replace(self.hint, observed_at_ms=BASE + 6001),
                     replace(self.hint, title_digest="A" * 64),
                     replace(self.hint, app_key=" "), replace(self.hint, app_key="x" * 2049)]:
            with self.subTest(hint=hint):
                self.assertIsNone(self.resolve(hint))
        for ids in [[], ["01"], ["1", "1"], [True], ["1' OR 1=1"],
                    ["9223372036854775808"], [str(i + 1) for i in range(65)]]:
            with self.subTest(ids=ids):
                self.assertEqual(read_local_record_refs(self.path, ids), ())

    def test_request_order_is_preserved_without_filling_missing_or_foreign_ids(self):
        self.row()
        self.row(id=2, origin_device_id="other")
        self.row(id=3)
        refs = read_local_record_refs(self.path, ["3", "2", "4", "1"])
        self.assertEqual([ref.record_id for ref in refs], ["3", "1"])

    def test_title_digest_is_versioned_bounded_and_lossless(self):
        self.assertEqual(window_title_digest(TITLE), hashlib.sha256(
            b"drifty-window-title-v1\0" + TITLE.encode("utf-8")).hexdigest())
        for title in [None, "", " ", "x\nother", "x" * 2049, "\ud800"]:
            self.assertIsNone(window_title_digest(title))
        self.assertNotEqual(window_title_digest("é"), window_title_digest("e\u0301"))
