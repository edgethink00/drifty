from __future__ import annotations

import json
import sqlite3
import subprocess
import sys
import unittest
from contextlib import closing
from pathlib import Path
from tempfile import TemporaryDirectory

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.storage.database_maintenance import create_rotating_backup, database_backup_dir
from app.storage.db import TrackerDatabase
from app.tracker.macos_workspace import Snapshot
from tests.support_cleanup import cleanup_temp_dir


class SyncedDeletionAtomicityTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = TemporaryDirectory()
        self.path = Path(self.tempdir.name) / "tracker.sqlite3"
        self.database = TrackerDatabase(self.path, perform_maintenance=False)

    def tearDown(self) -> None:
        self.database.close()
        cleanup_temp_dir(self.tempdir)

    def reset_database(self) -> None:
        self.database.close()
        cleanup_temp_dir(self.tempdir)
        self.setUp()

    def capture(self, name: str, moment: str) -> str:
        self.database.record_snapshot(
            Snapshot(observed_at=moment, app_name=name, bundle_id="fixture." + name,
                     window_title=name, source="test"), 5,
        )
        return self.database.connect().execute(
            "SELECT segment_uid FROM activity_segments ORDER BY id DESC LIMIT 1"
        ).fetchone()[0]

    def deletion(self, kind: str, uid: str, number: int = 1) -> dict:
        return {
            "deletionUid": f"77777777-0000-0000-0000-{number:012d}",
            "kind": kind,
            "segmentUids": [uid] if kind == "uids" else None,
            "rangeStart": "2026-10-07T00:00:00+00:00",
            "rangeEnd": "2026-10-07T23:59:59+00:00",
        }

    def names(self) -> list[str]:
        return [row[0] for row in self.database.connect().execute(
            "SELECT app_name FROM activity_segments ORDER BY id"
        )]

    def markers(self) -> list[str]:
        return [row[0] for row in self.database.connect().execute(
            "SELECT deletion_uid FROM applied_sync_deletions ORDER BY deletion_uid"
        )]

    def assert_backup(self, expected_names: list[str], expected_markers: list[str]) -> None:
        copies = list(database_backup_dir(self.path).glob("*.sqlite3"))
        self.assertTrue(copies)
        for path in copies:
            with closing(sqlite3.connect(path.resolve().as_uri() + "?mode=ro&immutable=1", uri=True)) as conn:
                self.assertEqual([row[0] for row in conn.execute(
                    "SELECT app_name FROM activity_segments ORDER BY id"
                )], expected_names)
                self.assertEqual([row[0] for row in conn.execute(
                    "SELECT deletion_uid FROM applied_sync_deletions ORDER BY deletion_uid"
                )], expected_markers)

    def test_restart_after_committed_delete_does_not_replay_over_fresh_capture(self) -> None:
        child = """
import json, os, sys
from pathlib import Path
from app.storage.db import TrackerDatabase
db = TrackerDatabase(Path(sys.argv[1]), perform_maintenance=False)
deletion = json.loads(sys.argv[2])
method = "delete_history_range" if deletion["kind"] == "range" else "delete_activity_segments"
original = getattr(db, method)
def delete_then_exit(*args, **kwargs):
    original(*args, **kwargs)
    os._exit(73)
setattr(db, method, delete_then_exit)
db.apply_synced_deletions([deletion])
raise AssertionError("termination boundary was not reached")
"""
        for number, kind in enumerate(("range", "uids"), 1):
            with self.subTest(kind=kind):
                self.reset_database()
                uid = self.capture("before" + kind, "2026-10-07T09:00:00+00:00")
                deletion = self.deletion(kind, uid, number)
                self.database.close()
                result = subprocess.run(
                    [sys.executable, "-c", child, str(self.path), json.dumps(deletion)],
                    cwd=SERVICE_ROOT, capture_output=True, text=True, timeout=15,
                )
                self.assertEqual(result.returncode, 73, result.stderr)
                self.database = TrackerDatabase(self.path)
                self.capture("fresh" + kind, "2026-10-07T09:02:00+00:00")
                retry = self.database.apply_synced_deletions([deletion])
                self.assertEqual(self.names(), ["fresh" + kind])
                self.assertEqual(retry, {"applied": 0, "skipped": 1})
                self.assertIn(deletion["deletionUid"], self.markers())
                self.database.delete_history_range(scopes={"activity": True})

    def test_marker_write_failure_preserves_activity_and_existing_backup(self) -> None:
        for number, kind in enumerate(("range", "uids"), 3):
            with self.subTest(kind=kind):
                self.reset_database()
                uid = self.capture("keep" + kind, "2026-10-07T09:00:00+00:00")
                deletion = self.deletion(kind, uid, number)
                create_rotating_backup(self.database.connect(), self.path, interval_seconds=0)
                with self.database.connect() as conn:
                    conn.execute("CREATE TRIGGER refuse_marker BEFORE INSERT ON applied_sync_deletions "
                                 "BEGIN SELECT RAISE(ABORT, 'synthetic marker failure'); END")
                with self.assertRaisesRegex(sqlite3.DatabaseError, "synthetic marker failure"):
                    self.database.apply_synced_deletions([deletion])
                self.assertEqual(self.names(), ["keep" + kind])
                self.assertEqual(self.markers(), [])
                self.assertFalse(self.database.connect().in_transaction)
                self.assert_backup(["keep" + kind], [])
                with self.database.connect() as conn:
                    conn.execute("DROP TRIGGER refuse_marker")
                self.assertEqual(self.database.apply_synced_deletions([deletion]),
                                 {"applied": 1, "skipped": 0})

    def test_activity_delete_failure_does_not_leave_an_applied_marker(self) -> None:
        uid = self.capture("keep", "2026-10-07T09:00:00+00:00")
        deletion = self.deletion("range", uid, 5)
        create_rotating_backup(self.database.connect(), self.path, interval_seconds=0)
        with self.database.connect() as conn:
            conn.execute("CREATE TRIGGER refuse_activity BEFORE DELETE ON activity_segments "
                         "BEGIN SELECT RAISE(ABORT, 'synthetic activity failure'); END")
        with self.assertRaisesRegex(sqlite3.DatabaseError, "synthetic activity failure"):
            self.database.apply_synced_deletions([deletion])
        self.assertEqual(self.names(), ["keep"])
        self.assertEqual(self.markers(), [])
        self.assertFalse(self.database.connect().in_transaction)
        self.assert_backup(["keep"], [])
        with self.database.connect() as conn:
            conn.execute("DROP TRIGGER refuse_activity")
        self.assertEqual(self.database.apply_synced_deletions([deletion]),
                         {"applied": 1, "skipped": 0})
        self.assertEqual(self.names(), [])

    def test_failed_later_marker_keeps_only_completed_page_deletions(self) -> None:
        first_uid = self.capture("first", "2026-10-07T09:00:00+00:00")
        second_uid = self.capture("second", "2026-10-07T09:02:00+00:00")
        first = self.deletion("uids", first_uid, 6)
        second = self.deletion("uids", second_uid, 7)
        create_rotating_backup(self.database.connect(), self.path, interval_seconds=0)
        with self.database.connect() as conn:
            conn.execute("CREATE TRIGGER refuse_second_marker BEFORE INSERT ON applied_sync_deletions "
                         f"WHEN NEW.deletion_uid = '{second['deletionUid']}' "
                         "BEGIN SELECT RAISE(ABORT, 'synthetic second marker failure'); END")
        with self.assertRaisesRegex(sqlite3.DatabaseError, "synthetic second marker failure"):
            self.database.apply_synced_deletions([first, second])
        self.assertEqual(self.names(), ["second"])
        self.assertEqual(self.markers(), [first["deletionUid"]])
        self.assert_backup(["second"], [first["deletionUid"]])
        with self.database.connect() as conn:
            conn.execute("DROP TRIGGER refuse_second_marker")
        self.assertEqual(self.database.apply_synced_deletions([first, second]),
                         {"applied": 1, "skipped": 1})
        self.assertEqual(self.names(), [])


if __name__ == "__main__":
    unittest.main()
