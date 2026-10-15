from __future__ import annotations

import sqlite3
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.storage.db import TrackerDatabase
from tests.support_cleanup import cleanup_temp_dir


class RuleMatchingBatchTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = TemporaryDirectory()
        self.db = TrackerDatabase(Path(self.temp.name) / "tracker.sqlite3", perform_maintenance=False)
        self.addCleanup(cleanup_temp_dir, self.temp)
        self.addCleanup(self.db.close)

    def segment(self, **fields) -> int:
        self.db.insert_segment({
            "started_at": "2026-10-15T00:00:00Z",
            "ended_at": "2026-10-15T00:00:05Z", "duration_seconds": 5,
            "app_name": "Synthetic Browser", "platform": "windows",
            "source": "win32-foreground", **fields,
        })
        return int(self.db.connect().execute("SELECT max(id) FROM activity_segments").fetchone()[0])

    def rule(self, **fields):
        return self.db.save_classification_rule({
            "targetKind": "site", "targetValue": "example.org",
            "category": "workspace", "productivity": "focus", **fields,
        })

    def test_batch_keeps_each_segment_and_detail_kind_independent(self) -> None:
        surface = self.rule()
        window = self.rule(matchScope="detail", detailKind="windowTitle", detailValue="Plan")
        site = self.rule(matchScope="detail", detailKind="siteTitle", detailValue="Guide")
        url = self.rule(matchScope="detail", detailKind="siteUrl", detailValue="https://example.org/work")
        app = self.rule(targetKind="app", targetValue="Another App")
        rows = [
            (self.segment(site_url="https://example.org/other", window_title="Plan"), window["id"]),
            (self.segment(site_domain="docs.example.org", site_title="Guide"), site["id"]),
            (self.segment(site_url="https://example.org/work#section"), url["id"]),
            (self.segment(site_domain="example.org", window_title="Other"), surface["id"]),
            (self.segment(site_url="https://[invalid", app_name="Another App"), app["id"]),
            (self.segment(site_domain="unrelated.invalid"), None),
        ]
        self.assertEqual(self.db.apply_classification_rules(),
                         {"matchedCount": 5, "appliedCount": 5, "skippedCount": 0})
        saved = dict(self.db.connect().execute(
            "SELECT segment_id, classification_rule_id FROM activity_classifications"))
        for segment_id, expected in rows:
            self.assertEqual(saved.get(segment_id), expected)
        # A later invocation reads the new captured fields on the same DB instance.
        with self.db.connect() as conn:
            conn.execute("UPDATE activity_segments SET window_title = 'Other' WHERE id = ?", (rows[0][0],))
        self.db.apply_classification_rules()
        self.assertEqual(self.db.connect().execute(
            "SELECT classification_rule_id FROM activity_classifications WHERE segment_id = ?",
            (rows[0][0],)).fetchone()[0], surface["id"])

    def test_late_write_failure_preserves_atomic_rule_batch(self) -> None:
        self.rule()
        first = self.segment(site_domain="example.org")
        second = self.segment(site_domain="example.org")
        self.db.save_classifications([{
            "segmentId": first, "inputFingerprint": "synthetic-existing",
            "category": "learning", "productivity": "focus", "source": "llm",
        }])
        before = [tuple(row) for row in self.db.connect().execute("SELECT * FROM activity_classifications")]
        with self.db.connect() as conn:
            conn.execute(f"""CREATE TRIGGER synthetic_reject_rule BEFORE INSERT ON activity_classifications
                WHEN NEW.segment_id = {second}
                BEGIN SELECT RAISE(ABORT, 'synthetic late rule failure'); END""")
        with self.assertRaisesRegex(sqlite3.IntegrityError, "synthetic late rule failure"):
            self.db.apply_classification_rules()
        self.assertEqual([tuple(row) for row in self.db.connect().execute(
            "SELECT * FROM activity_classifications")], before)
        self.assertFalse(self.db.connect().in_transaction)
