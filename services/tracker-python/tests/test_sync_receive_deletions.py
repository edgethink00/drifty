from __future__ import annotations

import json
import sqlite3
import subprocess
import sys
from unittest.mock import patch
import unittest

from tests.test_device_sync import DeviceSyncTestCase


class SyncReceiveDeletionTests(DeviceSyncTestCase):
    def segment(self, uid="late", **overrides):
        return self._remote_segment(uid, started_at="2026-07-06T09:00:00+00:00",
                                    ended_at="2026-07-06T09:01:00+00:00", **overrides)

    def tombstone(self, kind="uids", uid="delete", **overrides):
        return {"deletionUid": uid, "kind": kind, "segmentUids": ["late"],
                "rangeStart": "2026-07-06T09:00:00+00:00",
                "rangeEnd": "2026-07-06T09:01:00+00:00", **overrides}

    def uids(self):
        return {row[0] for row in self.database.connect().execute(
            "SELECT segment_uid FROM activity_segments")}

    def restart(self):
        self.database.close()
        from app.storage.db import TrackerDatabase
        self.database = TrackerDatabase(self.db_path)

    def test_remote_delete_blocks_late_pages_after_restart(self):
        for kind in ("uids", "range"):
            with self.subTest(kind=kind):
                self.database.close()
                self.tearDown()
                self.setUp()
                deletion = self.tombstone(kind, uid=kind)
                self.database.apply_synced_deletions([deletion])
                self.restart()
                self.assertEqual(self.database.apply_synced_segments([self.segment()]),
                                 {"inserted": 0, "updated": 0, "skipped": 1})
                self.assertNotIn("late", self.uids())
                self.assertEqual(self.database.get_pending_sync_deletions(), [])

    def test_local_delete_blocks_late_page_before_and_after_upload(self):
        for kind in ("uids", "range"):
            with self.subTest(kind=kind):
                self.database.close()
                self.tearDown()
                self.setUp()
                # Use an independent range for each scenario.
                segment = self.segment(uid=kind)
                self.database.apply_synced_segments([segment])
                if kind == "range":
                    self.database.delete_history_range(start="2026-07-06", end="2026-07-06",
                                                       scopes={"activity": True})
                else:
                    row = self.database.connect().execute(
                        "SELECT id FROM activity_segments WHERE segment_uid = ?", (kind,)).fetchone()
                    self.database.delete_activity_segments([str(row[0])])
                self.assertEqual(self.database.apply_synced_segments([segment])["skipped"], 1)
                self.database.mark_sync_deletions_pushed(
                    [d["deletionUid"] for d in self.database.get_pending_sync_deletions()])
                self.restart()
                self.assertEqual(self.database.apply_synced_segments([segment])["skipped"], 1)

    def test_replay_enriches_legacy_marker_without_deleting_new_local_history(self):
        for kind in ("uids", "range"):
            with self.subTest(kind=kind):
                self.database.close()
                self.tearDown()
                self.setUp()
                deletion = self.tombstone(kind, uid="legacy-" + kind)
                self.database.apply_synced_segments([self.segment()])
                with self.database.connect() as conn:
                    conn.execute("INSERT INTO applied_sync_deletions VALUES (?, ?)",
                                 (deletion["deletionUid"], "2026-07-06T08:00:00Z"))
                self._insert_local_segment(0)
                local_uids = self.uids() - {"late"}
                self.database.apply_synced_deletions([deletion])
                self.assertNotIn("late", self.uids())
                self.assertTrue(local_uids <= self.uids())
                self.assertEqual(self.database.apply_synced_segments([self.segment()])["skipped"], 1)
                self.assertEqual(self.database.apply_synced_deletions([deletion]),
                                 {"applied": 0, "skipped": 1})

    def test_range_retry_preserves_new_capture_and_local_classification(self):
        self.database.apply_synced_deletions([self.tombstone("range")])
        self._insert_local_segment(0)
        with self.database.connect() as conn:
            local = conn.execute("SELECT id, segment_uid FROM activity_segments").fetchone()
        self.database.save_classifications([{"segmentId": str(local["id"]), "category": "My choice",
                                             "productivity": "focus", "source": "manual"}])
        self.database.apply_synced_deletions([self.tombstone("range")])
        self.database.apply_synced_segments([self.segment(uid=local["segment_uid"])])
        self.assertIn(local["segment_uid"], self.uids())
        self.assertEqual(self.database.connect().execute(
            "SELECT category FROM activity_classifications WHERE segment_id = ?", (local["id"],)).fetchone()[0],
            "My choice")

    def test_receive_barriers_are_account_scoped_and_survive_remote_purge(self):
        self.database.apply_synced_deletions([self.tombstone()])
        self.database.purge_remote_segments()
        self.database.set_sync_state({"sync_account_id": "account-b", "sync_generation": "2"})
        self.assertEqual(self.database.apply_synced_segments([self.segment()])["inserted"], 1)
        self.database.purge_remote_segments()
        self.database.set_sync_state({"sync_account_id": "account-a", "sync_generation": "3"})
        self.assertEqual(self.database.apply_synced_segments([self.segment()])["skipped"], 1)

    def test_local_barriers_do_not_claim_unscoped_legacy_or_other_account_deletions(self):
        with self.database.connect() as conn:
            for account in (None, "account-b"):
                conn.execute("INSERT INTO sync_deletions(deletion_uid,account_id,kind,segment_uids_json,created_at) "
                             "VALUES (?, ?, 'uids', '[\"late\"]', '2026-07-06')", (str(account), account))
        self.assertEqual(self.database.apply_synced_segments([self.segment()])["inserted"], 1)

    def test_duplicate_tombstone_cannot_broaden_its_original_target(self):
        original = self.tombstone()
        self.database.apply_synced_deletions([original])
        self.database.apply_synced_deletions([self.tombstone(segmentUids=["other"])])
        self.assertEqual(self.database.apply_synced_segments([self.segment(uid="other")])["inserted"], 1)
        self.assertEqual(self.database.apply_synced_segments([self.segment()])["skipped"], 1)

    def test_range_boundary_matches_deletion_predicate(self):
        self.database.apply_synced_deletions([self.tombstone("range", rangeStart="2026-07-06T09:00:00.12345Z",
                                                            rangeEnd="2026-07-06T09:01:00.5Z")])
        cases = [("ends-at-start", "08:59:00", "09:00:00.12345", False),
                 ("ends-after-start", "08:59:00", "09:00:00.12346", True),
                 ("starts-at-end", "09:01:00.5", "09:02:00", True),
                 ("outside", "09:01:01", "09:02:00", False)]
        for uid, start, end, blocked in cases:
            with self.subTest(uid=uid):
                segment = self._remote_segment(uid, started_at=f"2026-07-06T{start}Z", ended_at=f"2026-07-06T{end}Z")
                self.assertEqual(self.database.apply_synced_segments([segment])["skipped"], int(blocked))

    def test_unknown_uid_deletion_and_open_range_block_future_pages(self):
        self.database.apply_synced_deletions([self.tombstone()])
        self.assertEqual(self.database.apply_synced_segments([self.segment()])["skipped"], 1)
        self.database.apply_synced_deletions([self.tombstone("range", uid="open", rangeStart=None, rangeEnd=None)])
        self.assertEqual(self.database.apply_synced_segments([self.segment(uid="unseen")])["skipped"], 1)

    def test_barrier_write_failure_rolls_back_deletion_and_marker(self):
        self.database.apply_synced_segments([self.segment()])
        with self.database.connect() as conn:
            conn.execute("CREATE TRIGGER refuse_barrier BEFORE INSERT ON received_sync_deletions "
                         "BEGIN SELECT RAISE(ABORT, 'synthetic barrier failure'); END")
        with self.assertRaisesRegex(sqlite3.DatabaseError, "synthetic barrier failure"):
            self.database.apply_synced_deletions([self.tombstone()])
        self.assertIn("late", self.uids())
        self.assertEqual(self.database.connect().execute("SELECT COUNT(*) FROM applied_sync_deletions").fetchone()[0], 0)
        self.assertFalse(self.database.connect().in_transaction)

    def test_uid_target_lookup_happens_inside_the_deletion_transaction(self):
        original = self.database.delete_activity_segments
        def page_arrives_before_delete(*args, **kwargs):
            self.database.apply_synced_segments([self.segment()])
            return original(*args, **kwargs)
        with patch.object(self.database, "delete_activity_segments", side_effect=page_arrives_before_delete):
            self.database.apply_synced_deletions([self.tombstone()])
        self.assertNotIn("late", self.uids())

    def test_real_sqlite_writer_waits_then_observes_committed_tombstone(self):
        # A separate process has already initialized its connection, then
        # waits on our write transaction before accepting an in-flight page.
        child = r"""
import json, sys
from pathlib import Path
from app.storage.db import TrackerDatabase
db = TrackerDatabase(Path(sys.argv[1]), perform_maintenance=False)
print("ready", flush=True)
sys.stdin.readline()
print(json.dumps(db.apply_synced_segments([json.loads(sys.argv[2])])), flush=True)
db.close()
"""
        from tests.test_device_sync import SERVICE_ROOT
        process = subprocess.Popen([sys.executable, "-c", child, str(self.db_path), json.dumps(self.segment())],
                                   cwd=SERVICE_ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True)
        try:
            self.assertEqual(process.stdout.readline().strip(), "ready")
            conn = self.database.connect()
            def wake_receiver(sql):
                if sql.startswith("INSERT OR IGNORE INTO applied_sync_deletions"):
                    self.assertTrue(conn.in_transaction)
                    process.stdin.write("receive\n")
                    process.stdin.flush()
            conn.set_trace_callback(wake_receiver)
            try:
                self.database.apply_synced_deletions([self.tombstone()])
            finally:
                conn.set_trace_callback(None)
            out, err = process.communicate(timeout=10)
            self.assertEqual(process.returncode, 0, err)
            self.assertEqual(json.loads(out), {"inserted": 0, "updated": 0, "skipped": 1})
            self.assertNotIn("late", self.uids())
        finally:
            if process.poll() is None:
                process.kill()
                process.communicate()

    def test_schema_upgrade_preserves_legacy_marker_and_cursor(self):
        with self.database.connect() as conn:
            conn.execute("DROP TABLE received_sync_deletions")
            conn.execute("INSERT INTO applied_sync_deletions VALUES ('old', '2026-07-06')")
        self.database.set_sync_state({"sync_pull_cursor": "saved-segment-cursor",
                                      "sync_deletion_pull_cursor": "saved-deletion-cursor"})
        self.restart()
        state = self.database.get_sync_state()["state"]
        self.assertEqual(state["sync_pull_cursor"], "saved-segment-cursor")
        self.assertEqual(state["sync_deletion_pull_cursor"], "saved-deletion-cursor")
        self.assertEqual(self.database.connect().execute("SELECT * FROM applied_sync_deletions").fetchone()[0], "old")
        self.assertEqual(self.database.connect().execute("SELECT COUNT(*) FROM received_sync_deletions").fetchone()[0], 0)

    def test_empty_target_barrier_replaces_older_recovery_copies(self):
        from app.storage.database_maintenance import create_rotating_backup, database_backup_dir
        from contextlib import closing
        previous = create_rotating_backup(self.database.connect(), self.db_path, interval_seconds=0)
        self.database.apply_synced_deletions([self.tombstone()])
        self.assertFalse(previous.exists())
        copies = list(database_backup_dir(self.db_path).glob("*.sqlite3"))
        self.assertTrue(copies)
        for backup in copies:
            with closing(sqlite3.connect(backup.resolve().as_uri() + "?mode=ro&immutable=1", uri=True)) as conn:
                self.assertEqual(conn.execute("SELECT deletion_uid FROM received_sync_deletions").fetchone()[0], "delete")

    def test_historical_replay_preserves_cursors_local_history_and_remote_correction(self):
        keep = self._remote_segment("keep", started_at="2026-07-06T10:00:00Z", ended_at="2026-07-06T10:01:00Z")
        self.database.apply_synced_segments([keep, self.segment()])
        with self.database.connect() as conn:
            keep_id = conn.execute("SELECT id FROM activity_segments WHERE segment_uid = 'keep'").fetchone()[0]
            conn.execute("INSERT INTO applied_sync_deletions VALUES ('legacy-range', '2026-07-06')")
        self.database.save_classifications([{"segmentId": str(keep_id), "category": "Receiver choice",
                                             "productivity": "focus", "source": "manual"}])
        self._insert_local_segment(0)
        local = self.uids() - {"keep", "late"}
        self.database.set_sync_state({"sync_pull_cursor": "past-missed-update", "sync_deletion_pull_cursor": "past-missed-delete"})
        self.database.apply_synced_segments([{**keep, "windowTitle": "recovered update"}, self.segment()])
        self.database.apply_synced_deletions([self.tombstone("range", uid="legacy-range")])
        self.assertEqual(self.uids(), local | {"keep"})
        self.assertEqual(tuple(self.database.connect().execute(
            "SELECT s.window_title, c.category FROM activity_segments s JOIN activity_classifications c ON c.segment_id=s.id "
            "WHERE s.segment_uid='keep'").fetchone()), ("recovered update", "Receiver choice"))
        self.assertEqual(self.database.get_sync_state()["state"]["sync_pull_cursor"], "past-missed-update")
        self.assertEqual(self.database.get_sync_state()["state"]["sync_deletion_pull_cursor"], "past-missed-delete")
        self.restart()
        self.assertEqual(self.database.apply_synced_segments([self.segment()])["skipped"], 1)

    def test_open_received_range_ends_at_original_deletion_time(self):
        deletion = self.tombstone("range", rangeStart=None, rangeEnd=None,
                                  createdAt="2026-07-06T09:01:00Z")
        self.database.apply_synced_deletions([deletion])
        future = self._remote_segment("future", started_at="2026-07-06T09:02:00Z", ended_at="2026-07-06T09:03:00Z")
        self.assertEqual(self.database.apply_synced_segments([self.segment(), future]),
                         {"inserted": 1, "updated": 0, "skipped": 1})
        self.database.set_sync_state({"sync_generation": "2"})
        self.restart()
        self.assertEqual(self.database.apply_synced_segments([future])["updated"], 1)

    def test_legacy_local_open_range_does_not_block_future_capture(self):
        with self.database.connect() as conn:
            conn.execute("INSERT INTO sync_deletions(deletion_uid,account_id,kind,created_at,pushed) "
                         "VALUES ('legacy-all', 'account-a', 'range', '2026-07-06T09:01:00Z', 1)")
        future = self._remote_segment("future", started_at="2026-07-06T09:02:00Z", ended_at="2026-07-06T09:03:00Z")
        self.assertEqual(self.database.apply_synced_segments([self.segment(), future]),
                         {"inserted": 1, "updated": 0, "skipped": 1})

    def test_new_local_open_range_sends_finite_upper_bound(self):
        self.database.apply_synced_segments([self.segment()])
        self.database.delete_history_range(scopes={"activity": True})
        deletion = self.database.get_pending_sync_deletions()[0]
        self.assertEqual(deletion["rangeEnd"], deletion["createdAt"])
        self.assertIsNotNone(deletion["rangeEnd"])

    def test_open_range_first_receive_keeps_activity_recorded_after_deletion(self):
        future = self._remote_segment("future", started_at="2026-07-06T09:02:00Z", ended_at="2026-07-06T09:03:00Z")
        self.database.apply_synced_segments([self.segment(), future])
        self.database.apply_synced_deletions([self.tombstone("range", rangeStart=None, rangeEnd=None,
                                                           createdAt="2026-07-06T09:01:00Z")])
        self.assertEqual(self.uids(), {"future"})

    def test_pending_legacy_open_range_is_bounded_on_upload_without_rewriting_identity(self):
        with self.database.connect() as conn:
            conn.execute("INSERT INTO sync_deletions(deletion_uid,account_id,kind,created_at,pushed) "
                         "VALUES ('legacy-pending', 'account-a', 'range', '2026-07-06T09:01:00Z', 0)")
        outgoing = self.database.get_pending_sync_deletions()[0]
        self.assertEqual(outgoing["deletionUid"], "legacy-pending")
        self.assertEqual(outgoing["rangeEnd"], "2026-07-06T09:01:00Z")
        self.assertEqual(outgoing["createdAt"], "2026-07-06T09:01:00Z")
        self.assertIsNone(self.database.connect().execute(
            "SELECT range_end FROM sync_deletions WHERE deletion_uid='legacy-pending'").fetchone()[0])


if __name__ == "__main__":
    unittest.main()
