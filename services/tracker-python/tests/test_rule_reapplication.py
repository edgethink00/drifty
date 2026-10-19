from __future__ import annotations

import sqlite3
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from app.storage.db import TrackerDatabase
from tests.support_cleanup import cleanup_temp_dir


class RuleReapplicationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = TemporaryDirectory()
        self.addCleanup(cleanup_temp_dir, self.temp)
        self.db = TrackerDatabase(Path(self.temp.name) / "tracker.sqlite3", perform_maintenance=False)
        self.addCleanup(self.db.close)
        self.rule = self.db.save_classification_rule({
            "targetKind": "app", "targetValue": "qa.synthetic",
            "category": "workspace", "productivity": "focus",
        })

    def seed(self, count: int = 1) -> list[int]:
        ids = []
        for _ in range(count):
            self.db.insert_segment({
                "started_at": "2026-10-19T00:00:00Z",
                "ended_at": "2026-10-19T00:00:05Z", "duration_seconds": 5,
                "app_name": "Synthetic", "bundle_id": "qa.synthetic",
                "platform": "windows", "source": "synthetic",
            })
            ids.append(self.db.connect().execute("SELECT max(id) FROM activity_segments").fetchone()[0])
        self.db.apply_classification_rules()
        return ids

    def state(self):
        conn = self.db.connect()
        return {
            "classifications": [tuple(row) for row in conn.execute(
                "SELECT * FROM activity_classifications ORDER BY segment_id")],
            "provenance": [tuple(row) for row in conn.execute(
                "SELECT * FROM sync_classification_provenance ORDER BY segment_id")],
            "segments": [tuple(row) for row in conn.execute(
                "SELECT id, sync_seq FROM activity_segments ORDER BY id")],
            "counter": [tuple(row) for row in conn.execute("SELECT * FROM sync_counter")],
        }

    def test_reapply_keeps_counts_timestamps_and_sync_outbox_unchanged(self):
        self.seed(70)
        before = self.state()
        changes = self.db.connect().total_changes
        self.assertEqual(self.db.apply_classification_rules(), {
            "matchedCount": 70, "appliedCount": 70, "skippedCount": 0,
        })
        self.assertEqual(self.state(), before)
        self.assertEqual(self.db.connect().total_changes, changes)
        self.assertFalse(self.db.connect().in_transaction)

    def test_new_rule_writes_only_its_changed_records(self):
        ids = self.seed(70)
        conn = self.db.connect()
        with conn:
            conn.execute("UPDATE activity_segments SET bundle_id='qa.other' WHERE id=?", (ids[-1],))
        before = self.state()
        other_rule = self.db.save_classification_rule({
            "targetKind": "app", "targetValue": "qa.other",
            "category": "learning", "productivity": "focus",
        })
        self.assertEqual(self.db.apply_classification_rules(), {
            "matchedCount": 70, "appliedCount": 70, "skippedCount": 0,
        })
        after = self.state()
        self.assertEqual(after["classifications"][:-1], before["classifications"][:-1])
        self.assertEqual(after["segments"][:-1], before["segments"][:-1])
        changed = conn.execute("SELECT * FROM activity_classifications WHERE segment_id=?", (ids[-1],)).fetchone()
        self.assertEqual((changed["category"], changed["classification_rule_id"]), ("learning", other_rule["id"]))

    def test_changed_or_incomplete_meaning_is_repaired_and_refreshed(self):
        segment_id, = self.seed()
        conn = self.db.connect()
        expected = dict(conn.execute("SELECT * FROM activity_classifications").fetchone())
        mutations = {
            "input_fingerprint": "old-input", "category": "learning", "productivity": "drift",
            "source": "llm", "confidence": 0.3, "reason": "outdated",
            "model": "old-model", "prompt_version": "old-prompt", "taxonomy_version": "old-taxonomy",
            "request_id": "old-request", "latency_ms": 3, "ai_result": 1, "stale": 1,
            "classification_rule_id": None,
        }
        for field, value in mutations.items():
            with self.subTest(field=field):
                with conn:
                    conn.execute(f"UPDATE activity_classifications SET {field}=?, classified_at='old', refreshed_at='old' WHERE segment_id=?", (value, segment_id))
                seq = conn.execute("SELECT sync_seq FROM activity_segments WHERE id=?", (segment_id,)).fetchone()[0]
                self.assertEqual(self.db.apply_classification_rules()["appliedCount"], 1)
                actual = dict(conn.execute("SELECT * FROM activity_classifications").fetchone())
                self.assertNotEqual(actual["classified_at"], "old")
                self.assertNotEqual(actual["refreshed_at"], "old")
                for key in expected:
                    if key not in {"classified_at", "refreshed_at"}:
                        self.assertEqual(actual[key], expected[key], key)
                self.assertGreater(conn.execute("SELECT sync_seq FROM activity_segments WHERE id=?", (segment_id,)).fetchone()[0], seq)

    def test_same_result_still_establishes_local_rule_ownership(self):
        segment_id, = self.seed()
        conn = self.db.connect()
        for provenance, kind in [(None, None), ("legacy", None), ("sync", None),
                                 ("sync", "synced-rule"), ("local-protected", "synced-rule")]:
            with self.subTest(provenance=provenance, kind=kind):
                with conn:
                    conn.execute("DELETE FROM sync_classification_provenance WHERE segment_id=?", (segment_id,))
                    if provenance is not None:
                        conn.execute("INSERT INTO sync_classification_provenance VALUES(?,?,?)", (segment_id, provenance, kind))
                seq = conn.execute("SELECT sync_seq FROM activity_segments WHERE id=?", (segment_id,)).fetchone()[0]
                self.assertEqual(self.db.apply_classification_rules()["appliedCount"], 1)
                self.assertEqual(tuple(conn.execute("SELECT provenance, rule_snapshot_kind FROM sync_classification_provenance WHERE segment_id=?", (segment_id,)).fetchone()), ("local-protected", None))
                self.assertGreater(conn.execute("SELECT sync_seq FROM activity_segments WHERE id=?", (segment_id,)).fetchone()[0], seq)

    def test_current_manual_correction_and_deletion_beat_old_materialized_snapshot(self):
        deleted, manual, unchanged = self.seed(3)
        other = TrackerDatabase(self.db.path, perform_maintenance=False)
        self.addCleanup(other.close)
        matching = self.db._matching_rule
        changed = False

        def interleave(segment, rules):
            nonlocal changed
            if not changed:
                changed = True
                other.delete_activity_segments([str(deleted)], refresh_recovery_backup=False)
                other.save_classifications([{
                    "segmentId": manual, "category": "entertainment",
                    "productivity": "drift", "source": "manual",
                }])
            return matching(segment, rules)

        with patch.object(self.db, "_matching_rule", side_effect=interleave):
            self.assertEqual(self.db.apply_classification_rules(), {
                "matchedCount": 3, "appliedCount": 1, "skippedCount": 2,
            })
        rows = {row["segment_id"]: row["source"] for row in self.db.connect().execute("SELECT * FROM activity_classifications")}
        self.assertEqual(rows, {manual: "manual", unchanged: "rule"})

    def test_changed_capture_is_not_counted_as_an_unchanged_application(self):
        segment_id, = self.seed()
        other = TrackerDatabase(self.db.path, perform_maintenance=False)
        self.addCleanup(other.close)
        before = self.state()["classifications"]
        matching = self.db._matching_rule

        def interleave(segment, rules):
            with other.connect() as conn:
                conn.execute("UPDATE activity_segments SET window_title='New capture' WHERE id=?", (segment_id,))
            return matching(segment, rules)

        with patch.object(self.db, "_matching_rule", side_effect=interleave):
            self.assertEqual(self.db.apply_classification_rules(), {
                "matchedCount": 1, "appliedCount": 0, "skippedCount": 1,
            })
        self.assertEqual(self.state()["classifications"], before)

    def test_late_failure_rolls_back_changed_rows_and_sync_state_across_batches(self):
        ids = self.seed(70)
        conn = self.db.connect()
        with conn:
            conn.execute("UPDATE activity_classifications SET stale=1 WHERE segment_id IN (?,?)", (ids[0], ids[-1]))
            conn.execute(f"""CREATE TRIGGER reject_last_rule BEFORE INSERT ON activity_classifications
                WHEN NEW.segment_id={ids[-1]}
                BEGIN SELECT RAISE(ABORT, 'late rule failure'); END""")
        before = self.state()
        with self.assertRaisesRegex(sqlite3.IntegrityError, "late rule failure"):
            self.db.apply_classification_rules()
        self.assertEqual(self.state(), before)
        self.assertFalse(conn.in_transaction)


if __name__ == "__main__":
    unittest.main()
