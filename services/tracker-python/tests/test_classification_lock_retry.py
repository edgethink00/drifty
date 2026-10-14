from __future__ import annotations

import io
import json
import sqlite3
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from app import main
from app.storage.db import TrackerDatabase
from tests.support_cleanup import cleanup_temp_dir


def busy_error(code: int | None = None) -> sqlite3.OperationalError:
    error = sqlite3.OperationalError("database is locked")
    if code is not None:
        error.sqlite_errorcode = code
    return error


class ClassificationLockRetryTests(unittest.TestCase):
    def setUp(self):
        temp = TemporaryDirectory()
        self.addCleanup(cleanup_temp_dir, temp)
        self.path = Path(temp.name) / "qa.sqlite3"
        self.db = TrackerDatabase(self.path, perform_maintenance=False)
        self.addCleanup(self.db.close)
        for minute in (0, 2):
            self.db.insert_segment({
                "started_at": f"2026-10-14T01:0{minute}:00Z",
                "ended_at": f"2026-10-14T01:0{minute + 1}:00Z",
                "duration_seconds": 60, "app_name": "Synthetic QA",
            })
        self.ids = [row["id"] for row in self.db.fetch_timeline("2026-10-14")]
        self.records = [{"segmentId": sid, "category": "workspace",
                         "productivity": "focus", "source": "llm"} for sid in self.ids]
        self.db.connect().execute("PRAGMA busy_timeout=20")

    def writer(self):
        conn = sqlite3.connect(self.path)
        conn.execute("PRAGMA foreign_keys=ON")
        self.addCleanup(conn.close)
        self.addCleanup(conn.rollback)
        conn.execute("BEGIN IMMEDIATE")
        return conn

    def save(self):
        with patch.object(main, "database", return_value=self.db):
            return main.save_classifications({"classifications": self.records})

    def test_real_writer_release_recovers_the_completed_classification_batch(self):
        writer = self.writer()

        def release(delay):
            self.assertFalse(self.db.connect().in_transaction)
            self.assertEqual(delay, 0.15)
            writer.commit()

        with patch.object(main.time, "sleep", side_effect=release) as sleep:
            self.assertEqual(self.save(), {"ok": True, "data": {"saved": 2}, "error": None})
        sleep.assert_called_once()
        self.assertEqual(self.db.connect().execute(
            "SELECT count(*) FROM activity_classifications"
        ).fetchone()[0], 2)

    def test_persistent_writer_reports_one_error_after_two_bounded_attempts(self):
        self.writer()
        request = {"id": 1, "command": "save_classifications",
                   "payload": {"classifications": self.records}}
        output = io.StringIO()
        with patch.object(main, "database", return_value=self.db), patch.object(
            self.db, "save_classifications", wraps=self.db.save_classifications
        ) as save, patch.object(main.time, "sleep") as sleep, patch.object(
            main, "capture_tracker_exception"
        ) as report, patch.object(main.sys, "stdin", io.StringIO(json.dumps(request) + "\n")), \
                patch.object(main.sys, "stdout", output):
            main.serve()
        self.assertEqual(save.call_count, 2)
        sleep.assert_called_once_with(0.15)
        report.assert_called_once()
        reply = json.loads(output.getvalue())
        self.assertFalse(reply["ok"])
        self.assertEqual(reply["error"], "database is locked")
        self.assertFalse(self.db.connect().in_transaction)
        self.assertEqual(self.db.connect().execute(
            "SELECT count(*) FROM activity_classifications"
        ).fetchone()[0], 0)

    def test_a_manual_correction_during_backoff_keeps_priority_over_the_retry(self):
        corrector = TrackerDatabase(self.path, perform_maintenance=False)
        self.addCleanup(corrector.close)
        writer = self.writer()

        def correct(_):
            writer.commit()
            corrector.save_classifications([
                {**row, "category": "entertainment", "productivity": "drift", "source": "manual"}
                for row in self.records
            ])

        with patch.object(main.time, "sleep", side_effect=correct):
            self.assertEqual(self.save()["data"]["saved"], 0)
        rows = self.db.connect().execute(
            "SELECT category, productivity, source FROM activity_classifications"
        ).fetchall()
        self.assertEqual([tuple(row) for row in rows], [("entertainment", "drift", "manual")] * 2)

    def test_deletion_during_backoff_cannot_be_resurrected_by_the_retry(self):
        writer = self.writer()
        writer.execute("DELETE FROM activity_segments WHERE id=?", (self.ids[0],))
        with patch.object(main.time, "sleep", side_effect=lambda _: writer.commit()):
            self.assertEqual(self.save()["data"]["saved"], 1)
        rows = self.db.connect().execute("SELECT segment_id FROM activity_classifications").fetchall()
        self.assertEqual([str(row[0]) for row in rows], [str(self.ids[1])])

    def test_only_busy_errors_are_retried_even_when_the_message_looks_like_a_lock(self):
        for error in (busy_error(6), busy_error(8), sqlite3.OperationalError("disk I/O error"),
                      sqlite3.OperationalError("database table is locked"),
                      sqlite3.IntegrityError("FOREIGN KEY constraint failed")):
            with self.subTest(error=repr(error)), patch.object(
                self.db, "save_classifications", side_effect=error
            ) as save, patch.object(main.time, "sleep") as sleep, self.assertRaises(type(error)) as raised:
                self.save()
            self.assertIs(raised.exception, error)
            self.assertEqual(save.call_count, 1)
            sleep.assert_not_called()

    def test_extended_busy_error_retries_the_storage_call_only_once(self):
        with patch.object(self.db, "save_classifications", side_effect=[busy_error(517), 2]) as save, \
                patch.object(main.time, "sleep"):
            self.assertEqual(self.save()["data"]["saved"], 2)
        self.assertEqual(save.call_count, 2)

    def test_a_busy_failure_with_an_unfinished_transaction_is_not_replayed(self):
        self.db.connect().execute("BEGIN")
        error = busy_error(5)
        with patch.object(self.db, "save_classifications", side_effect=error) as save, \
                patch.object(main.time, "sleep") as sleep, self.assertRaises(sqlite3.OperationalError):
            self.save()
        self.assertEqual(save.call_count, 1)
        sleep.assert_not_called()
        self.assertTrue(self.db.connect().in_transaction)

    def test_mid_batch_busy_rolls_back_review_audit_before_the_retry(self):
        self.db.save_classifications(self.records)
        pass_id = self.db.record_project_pass({
            "rangeStart": "2026-10-14T00:00:00Z", "rangeEnd": "2026-10-15T00:00:00Z",
            "trigger": "manual", "correctionsCount": 0,
        })["id"]
        self.records = [{**row, "source": "ai_review", "reviewPassId": pass_id,
                         "category": "entertainment", "productivity": "drift"} for row in self.records]

        class FailSecondClassificationOnce(sqlite3.Connection):
            remaining = 2

            def execute(conn, sql, params=()):
                if sql.lstrip().upper().startswith("INSERT INTO ACTIVITY_CLASSIFICATIONS"):
                    conn.remaining -= 1
                    if conn.remaining == 0:
                        raise busy_error(5)
                return super().execute(sql, params)

        self.db.close()
        conn = sqlite3.connect(self.path, factory=FailSecondClassificationOnce)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        self.db._connection = conn

        def check_rollback(_):
            self.assertFalse(conn.in_transaction)
            self.assertEqual(self.db.get_ai_review_events(), [])
            self.assertEqual(self.db.get_project_pass_runs()[0]["correctionsCount"], 0)
            self.assertEqual([tuple(row) for row in conn.execute(
                "SELECT category, source FROM activity_classifications"
            ).fetchall()], [("workspace", "llm")] * 2)

        with patch.object(main.time, "sleep", side_effect=check_rollback):
            self.assertEqual(self.save()["data"]["saved"], 2)
        self.assertEqual(len(self.db.get_ai_review_events()), 2)
        self.assertEqual(self.db.get_project_pass_runs()[0]["correctionsCount"], 2)


if __name__ == "__main__":
    unittest.main()
