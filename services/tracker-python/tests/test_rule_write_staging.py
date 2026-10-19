from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from app.storage.db import TrackerDatabase
from tests.support_cleanup import cleanup_temp_dir


class RuleWriteStagingTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(cleanup_temp_dir, self.temp)
        self.db = TrackerDatabase(Path(self.temp.name) / "tracker.sqlite3", perform_maintenance=False)
        self.addCleanup(self.db.close)
        self.rule = self.db.save_classification_rule({
            "targetKind": "app", "targetValue": "qa.bulk",
            "category": "workspace", "productivity": "focus",
        })

    def seed(self, count=300):
        conn = self.db.connect()
        first = conn.execute("SELECT coalesce(max(id), 0) + 1 FROM activity_segments").fetchone()[0]
        with conn:
            conn.executemany("""INSERT INTO activity_segments
                (started_at, ended_at, duration_seconds, app_name, bundle_id, segment_uid, platform, source)
                VALUES ('2026-10-19T00:00:00Z', '2026-10-19T00:00:05Z', 5, 'Synthetic', 'qa.bulk', ?, 'windows', 'synthetic')""",
                ((f"synthetic-{i}",) for i in range(first, first + count)))
        return list(range(first, first + count))

    def state(self):
        conn = self.db.connect()
        return {table: [tuple(row) for row in conn.execute(f"SELECT * FROM {table} ORDER BY 1")]
                for table in ("activity_classifications", "sync_classification_provenance",
                              "activity_segments", "sync_counter")}

    def assert_clean_transaction(self):
        conn = self.db.connect()
        self.assertFalse(conn.in_transaction)
        self.assertEqual(conn.execute("SELECT name FROM sqlite_temp_master WHERE type='table'").fetchall(), [])

    def other_connection(self):
        other = TrackerDatabase(self.db.path, perform_maintenance=False)
        self.addCleanup(other.close)
        other.connect().execute("PRAGMA busy_timeout = 50")
        return other

    def test_first_application_and_repeat_keep_meaning_and_no_write_contract(self):
        self.seed()
        expected = {"matchedCount": 300, "appliedCount": 300, "skippedCount": 0}
        self.assertEqual(self.db.apply_classification_rules(), expected)
        before = self.state()
        self.assertEqual(len(before["activity_classifications"]), 300)
        self.assertEqual(len(before["sync_classification_provenance"]), 300)
        changes = self.db.connect().total_changes
        self.assertEqual(self.db.apply_classification_rules(), expected)
        self.assertEqual(self.state(), before)
        self.assertEqual(self.db.connect().total_changes, changes)
        self.assert_clean_transaction()

    def test_main_writer_can_correct_and_delete_during_temp_preparation(self):
        deleted, manual, changed, *rest = self.seed()
        other = self.other_connection()
        observed = []

        def trace(sql):
            if not sql.startswith("INSERT INTO temp.pending_rule_results") or observed:
                return
            observed.append(self.db.connect().in_transaction)
            try:
                self.assertEqual(other.connect().execute("SELECT count(*) FROM activity_classifications").fetchone()[0], 0)
                other.delete_activity_segments([str(deleted)], refresh_recovery_backup=False)
                other.save_classifications([{"segmentId": manual, "category": "entertainment",
                                            "productivity": "drift", "source": "manual"}])
                with other.connect() as conn:
                    conn.execute("UPDATE activity_segments SET window_title='Changed' WHERE id=?", (changed,))
                observed.append("other writer completed")
            except Exception as error:
                # sqlite trace callbacks swallow exceptions; assert outside.
                observed.append(error)

        self.db.connect().set_trace_callback(trace)
        try:
            self.assertEqual(self.db.apply_classification_rules(),
                             {"matchedCount": 300, "appliedCount": 297, "skippedCount": 3})
        finally:
            self.db.connect().set_trace_callback(None)
        self.assertEqual(observed, [True, "other writer completed"])
        saved = dict(self.db.connect().execute("SELECT segment_id, source FROM activity_classifications"))
        self.assertEqual(saved, {manual: "manual", **{i: "rule" for i in rest}})
        self.assert_clean_transaction()

    def test_mixed_batch_preserves_already_materialized_rows(self):
        self.seed(70)
        self.db.apply_classification_rules()
        before = self.state()
        self.seed()
        self.assertEqual(self.db.apply_classification_rules(),
                         {"matchedCount": 370, "appliedCount": 370, "skippedCount": 0})
        after = self.state()
        for table in ("activity_classifications", "sync_classification_provenance", "activity_segments"):
            self.assertEqual(after[table][:70], before[table])
        self.assert_clean_transaction()

    def test_failure_after_bulk_write_rolls_back_both_paths_and_can_retry(self):
        existing, = self.seed(1)
        self.db.apply_classification_rules()
        self.seed()
        conn = self.db.connect()
        with conn:
            conn.execute("UPDATE activity_classifications SET stale=1 WHERE segment_id=?", (existing,))
            conn.execute(f"""CREATE TRIGGER reject_existing BEFORE INSERT ON activity_classifications
                WHEN NEW.segment_id={existing}
                BEGIN SELECT RAISE(ABORT, 'late existing failure'); END""")
        before = self.state()
        with self.assertRaisesRegex(sqlite3.IntegrityError, "late existing failure"):
            self.db.apply_classification_rules()
        self.assertEqual(self.state(), before)
        self.assert_clean_transaction()
        conn.execute("DROP TRIGGER reject_existing")
        self.assertEqual(self.db.apply_classification_rules()["appliedCount"], 301)
        self.assert_clean_transaction()

    def test_rule_edit_after_staging_restarts_with_new_snapshot(self):
        self.seed()
        other = self.other_connection()
        stage = self.db._stage_new_rule_results
        attempts = []

        @contextmanager
        def interleave(conn, rows):
            with stage(conn, rows) as staged:
                attempts.append(staged)
                if len(attempts) == 1:
                    other.save_classification_rule({**self.rule, "category": "learning"})
                yield staged

        with patch.object(self.db, "_stage_new_rule_results", side_effect=interleave):
            self.assertEqual(self.db.apply_classification_rules()["appliedCount"], 300)
        self.assertEqual(attempts, [True, True])
        self.assertEqual(self.db.connect().execute(
            "SELECT count(*) FROM activity_classifications WHERE category='learning'").fetchone()[0], 300)
        self.assert_clean_transaction()

    def test_preparation_failure_leaves_persistent_state_and_connection_reusable(self):
        ids = self.seed()
        before = self.state()
        self.db.close()

        class FailingStageConnection(sqlite3.Connection):
            fail_stage = True

            def execute(connection, sql, params=()):
                result = super().execute(sql, params)
                if connection.fail_stage and sql.startswith("CREATE TEMP TABLE pending_rule_results"):
                    connection.fail_stage = False
                    super().execute(f"""CREATE TEMP TRIGGER reject_stage BEFORE INSERT ON pending_rule_results
                        WHEN NEW.segment_id={ids[-1]}
                        BEGIN SELECT RAISE(ABORT, 'stage failure'); END""")
                return result

        connect = sqlite3.connect
        with patch("app.storage.db.sqlite3.connect", side_effect=lambda *args, **kwargs:
                   connect(*args, factory=FailingStageConnection, **kwargs)):
            self.db.connect()
        with self.assertRaisesRegex(sqlite3.IntegrityError, "stage failure"):
            self.db.apply_classification_rules()
        self.assertEqual(self.state(), before)
        self.assert_clean_transaction()
        self.assertEqual(self.db.apply_classification_rules()["appliedCount"], 300)
        self.assert_clean_transaction()

    def test_existing_transaction_is_not_committed_by_preparation(self):
        first, *rest = self.seed()
        before = self.state()
        self.db.connect().execute("UPDATE activity_segments SET window_title='Pending' WHERE id=?", (first,))
        with self.assertRaisesRegex(sqlite3.OperationalError, "within a transaction"):
            self.db.apply_classification_rules()
        self.assertEqual(self.state(), before)
        self.assert_clean_transaction()


if __name__ == "__main__":
    unittest.main()
