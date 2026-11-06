from __future__ import annotations

import io
import json
import sqlite3
import struct
import subprocess
import sys
import time
import unittest
import uuid
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from app.storage.screen_activity_binding import window_title_digest
from app.storage.screen_activity_fence import prepare
from app.storage.screen_activity_reader import (
    END, MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES, READY, dispatch, run,
)

ROOT = Path(__file__).resolve().parents[1]


def request(operation):
    return {"protocolVersion": 2, "requestId": str(uuid.uuid4()), "operation": operation}


def packet(value):
    body = value if isinstance(value, bytes) else json.dumps(value, ensure_ascii=False).encode()
    return struct.pack(">I", len(body)) + body


class ScreenActivityReaderTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "tracker.sqlite3"
        self.base = time.time_ns() // 1_000_000 - 5000
        self.uid = str(uuid.uuid4())
        self.platform = patch("app.storage.screen_activity_binding.CAPTURE_PLATFORM", "macos")
        self.platform.start()
        self.addCleanup(self.platform.stop)
        with closing(sqlite3.connect(self.path)) as db:
            db.execute("""CREATE TABLE activity_segments (
                id INTEGER PRIMARY KEY, segment_uid TEXT, started_at TEXT, ended_at TEXT,
                platform TEXT, source TEXT, bundle_id TEXT, window_title TEXT,
                origin_device_id TEXT, exclusion_source TEXT, engagement_evidence TEXT,
                confidence REAL)""")
            db.execute("INSERT INTO activity_segments VALUES (1,?,?,?,?,?,?,?,?,?,?,?)",
                       (self.uid, self.iso(0), self.iso(5000), "macos", "accessibility",
                        "com.apple.TextEdit", "한글 Owned QA document", None, None, None, 1.0))
            db.commit()
            db.execute("BEGIN IMMEDIATE")
            prepare(db)
            db.commit()

    def iso(self, offset):
        return datetime.fromtimestamp((self.base + offset) / 1000, timezone.utc).isoformat()

    def resolve_operation(self):
        return {"kind": "resolve", "appKey": "com.apple.TextEdit",
                "titleDigest": window_title_digest("한글 Owned QA document"),
                "observedAtMs": self.base + 1000}

    def test_resolve_and_read_have_exact_minimal_wire_and_preserve_database(self):
        before = self.path.read_bytes()
        first = request(self.resolve_operation())
        request_id, rows = dispatch(self.path, json.dumps(first).encode())
        self.assertEqual(request_id, first["requestId"])
        self.assertEqual(rows[0]["segmentUid"], self.uid)
        self.assertEqual(set(rows[0]), {"recordId", "segmentUid", "identityDigest", "startedAtMs", "endedAtMs"})
        second = request({"kind": "read", "recordIds": ["1"]})
        self.assertEqual(dispatch(self.path, json.dumps(second).encode())[1], rows)
        self.assertEqual(self.path.read_bytes(), before)
        serialized = json.dumps(rows)
        self.assertNotIn("TextEdit", serialized)
        self.assertNotIn("Owned QA", serialized)

    def test_replay_titleless_and_partial_address_are_time_refs_not_exact_bindings(self):
        from app.storage.screen_activity_binding import read_local_record_refs
        with closing(sqlite3.connect(self.path)) as db:
            # New rows, so the identity fence has not revoked their observed points.
            for ident, source, title, confidence in [(2, "nsworkspace", None, 0.5),
                                                      (3, "accessibility", "QA Safari", 0.6)]:
                db.execute("INSERT INTO activity_segments VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                           (ident, str(uuid.uuid4()), self.iso(0), self.iso(5000), "macos", source,
                            "com.apple.Safari", title, None, None, None, confidence))
            db.commit()
        refs = read_local_record_refs(self.path, ["2", "3"], require_fence=True, replay=True)
        self.assertEqual([r.record_id for r in refs], ["2", "3"])
        self.assertTrue(all(r.contains(self.base + 1000) for r in refs))
        self.assertEqual(read_local_record_refs(self.path, ["2", "3"], require_fence=True), ())
        payload = json.dumps(request({"kind": "read_replay", "recordIds": ["2", "3"]})).encode()
        self.assertEqual(len(dispatch(self.path, payload)[1]), 2)
        self.assertNotIn("Safari", json.dumps(dispatch(self.path, payload)))
        exact = read_local_record_refs(self.path, ["1"], require_fence=True)[0]
        replay = read_local_record_refs(self.path, ["1"], require_fence=True, replay=True)[0]
        self.assertNotEqual(exact.identity_digest, replay.identity_digest)
        for column, value in [("origin_device_id", "remote"), ("exclusion_source", "manual"),
                              ("engagement_evidence", "{}"), ("source", "unknown")]:
            with self.subTest(column=column), closing(sqlite3.connect(self.path)) as db:
                db.execute("BEGIN IMMEDIATE")
                prepare(db)
                db.execute("UPDATE activity_segments SET " + column + "=? WHERE id=2", (value,))
                db.commit()
                self.assertEqual(read_local_record_refs(self.path, ["2"], require_fence=True, replay=True), ())
                db.execute("UPDATE activity_segments SET " + column + "=? WHERE id=2",
                           ("nsworkspace" if column == "source" else None,))
                db.commit()
        # Even after the row is restored, a revoked point does not return.
        restored = read_local_record_refs(self.path, ["2"], require_fence=True, replay=True)
        self.assertTrue(not restored or not restored[0].contains(self.base + 1000))

    def test_framing_request_uuid_footer_and_multiple_jobs(self):
        queries = [request(self.resolve_operation()), request({"kind": "read", "recordIds": ["1"]})]
        output = bytearray()
        self.assertEqual(run(self.path, io.BytesIO(b"".join(packet(q) for q in queries)), output.extend), 0)
        self.assertEqual(output[:4], READY)
        remaining = bytes(output[4:])
        for q in queries:
            size = struct.unpack(">I", remaining[:4])[0]
            reply = json.loads(remaining[4:4 + size])
            self.assertEqual(reply["protocolVersion"], 2)
            self.assertEqual(reply["requestId"], q["requestId"])
            self.assertEqual(len(reply["records"]), 1)
            self.assertEqual(remaining[4 + size:44 + size], END + q["requestId"].encode())
            remaining = remaining[44 + size:]
        self.assertEqual(remaining, b"")

    def test_malformed_mixed_duplicate_or_path_requests_close_without_echo(self):
        valid = request(self.resolve_operation())
        cases = [b"{bad", b"[]", b"null", b'{"protocolVersion":1,"protocolVersion":1}',
                 json.dumps(valid).encode("utf-16"), b'{"protocolVersion":NaN}']
        for key, value in [("protocolVersion", True), ("protocolVersion", 1),
                           ("requestId", str(uuid.UUID(int=0))), ("requestId", valid["requestId"].upper()),
                           ("dbPath", "/some/private/path"), ("operation", {"kind": "query", "sql": "secret"})]:
            changed = {**valid, key: value}
            cases.append(json.dumps(changed).encode())
        for raw in cases:
            with self.subTest(raw=raw[:40]):
                output = bytearray()
                self.assertEqual(run(self.path, io.BytesIO(packet(raw)), output.extend), 2)
                self.assertEqual(output, READY)

    def test_invalid_operation_shapes_and_noncanonical_or_oversized_ids_refuse(self):
        valid = self.resolve_operation()
        bad = [{**valid, "appKey": "a" * 257}, {**valid, "appKey": "a\nb"},
               {**valid, "observedAtMs": True}, {**valid, "titleDigest": "A" * 64},
               {**valid, "rawTitle": "secret"}, {k: v for k, v in valid.items() if k != "titleDigest"}]
        bad.extend({"kind": kind, "recordIds": ids} for kind in ["read", "read_replay"] for ids in
                   [[], ["1", "1"], ["0"], ["01"], [1], ["9223372036854775808"], ["1"] * 65])
        for operation in bad:
            with self.subTest(operation=operation):
                with self.assertRaises(ValueError):
                    dispatch(self.path, json.dumps(request(operation)).encode())

    def test_maximum_64_references_fit_output_budget_without_truncation(self):
        # Worst-length identity/timestamps, not inferred live tracker data.
        from app.storage.screen_activity_binding import LocalActivityRecord
        refs = tuple(LocalActivityRecord(str(9223372036854775807 - n), str(uuid.uuid4()),
                                         "a" * 64, 253402300799998, 253402300799999,
                                         proof_version=1) for n in range(64))
        query = request({"kind": "read", "recordIds": [r.record_id for r in refs]})
        self.assertLessEqual(len(packet(query)) - 4, MAX_REQUEST_BYTES)
        output = bytearray()
        with patch("app.storage.screen_activity_reader.read_local_record_refs", return_value=refs):
            self.assertEqual(run(self.path, io.BytesIO(packet(query)), output.extend), 0)
        size = struct.unpack(">I", output[4:8])[0]
        self.assertLessEqual(size, MAX_RESPONSE_BYTES)
        self.assertEqual(len(json.loads(output[8:8 + size])["records"]), 64)
        self.assertEqual(len(output), 4 + 4 + size + 40)

    def test_unfenced_or_excessive_point_proofs_return_no_partial_response(self):
        from app.storage.screen_activity_binding import LocalActivityRecord
        for refs in [
            (LocalActivityRecord('1', self.uid, 'a'*64, 0, 1000),),
            tuple(LocalActivityRecord(str(n+1), str(uuid.uuid4()), 'a'*64, 0, 1000,
                                      tuple((n*2, n*2+1) for n in range(64)), 1)
                  for n in range(64)),
        ]:
            query = request({'kind': 'read', 'recordIds': [r.record_id for r in refs]})
            output = bytearray()
            with patch('app.storage.screen_activity_reader.read_local_record_refs', return_value=refs):
                self.assertEqual(run(self.path, io.BytesIO(packet(query)), output.extend), 2)
            self.assertEqual(output, READY)

    def test_missing_corrupt_locked_database_returns_empty_without_creation_or_diagnostics(self):
        operation = request({"kind": "read", "recordIds": ["1"]})
        missing = self.path.parent / "missing.sqlite3"
        self.assertEqual(dispatch(missing, json.dumps(operation).encode())[1], [])
        self.assertFalse(missing.exists())
        corrupt = self.path.parent / "corrupt.sqlite3"
        corrupt.write_bytes(b"owned preserved bytes")
        self.assertEqual(dispatch(corrupt, json.dumps(operation).encode())[1], [])
        self.assertEqual(corrupt.read_bytes(), b"owned preserved bytes")
        with closing(sqlite3.connect(self.path)) as lock:
            lock.execute("BEGIN EXCLUSIVE")
            self.assertEqual(dispatch(self.path, json.dumps(operation).encode())[1], [])

    def test_oversize_truncated_eof_max_jobs_and_closed_output_are_bounded(self):
        for body in [struct.pack(">I", MAX_REQUEST_BYTES + 1), struct.pack(">I", 0)]:
            output = bytearray()
            self.assertEqual(run(self.path, io.BytesIO(body), output.extend), 2)
            self.assertEqual(output, READY)
        output = bytearray()
        self.assertEqual(run(self.path, io.BytesIO(b"\x00\x00"), output.extend), 0)
        self.assertEqual(output, READY)
        queries = [request({"kind": "read", "recordIds": ["1"]}) for _ in range(65)]
        stream = io.BytesIO(b"".join(packet(q) for q in queries))
        output = bytearray()
        self.assertEqual(run(self.path, stream, output.extend), 0)
        self.assertEqual(stream.read(), packet(queries[-1]))
        def closed(_):
            raise BrokenPipeError()
        self.assertEqual(run(self.path, io.BytesIO(), closed), 2)

    def test_actual_entry_exits_before_heavy_tracker_or_telemetry_imports_and_creates_no_db(self):
        missing = self.path.parent / "uncreated.sqlite3"
        script = f"""import sys,importlib.abc,runpy
class Guard(importlib.abc.MetaPathFinder):
 def find_spec(self,fullname,path=None,target=None):
  if fullname in {{'app.storage.db','app.sentry_setup','app.tracker.macos_workspace','app.tracker.windows_workspace','sentry_sdk','ssl'}}:raise AssertionError('heavy import attempted')
sys.meta_path.insert(0,Guard())
sys.argv=[{str(ROOT / 'app/main.py')!r},'screen-context-activity-reader-v2','--db',{str(missing)!r}]
runpy.run_path(sys.argv[0],run_name='__main__')
"""
        result = subprocess.run([sys.executable, "-I", "-c", script], input=b"", capture_output=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, READY)
        self.assertEqual(result.stderr, b"")
        self.assertFalse(missing.exists())


if __name__ == "__main__":
    unittest.main()
