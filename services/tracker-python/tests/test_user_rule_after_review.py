from __future__ import annotations

import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.storage.db import TrackerDatabase
from tests.support_cleanup import cleanup_temp_dir


class UserRuleAfterReviewTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = TemporaryDirectory()
        self.db = TrackerDatabase(Path(self.tempdir.name) / "tracker.sqlite3")
        self.db.insert_segment({
            "started_at": "2026-04-06T09:00:00Z",
            "ended_at": "2026-04-06T09:03:00Z",
            "duration_seconds": 180,
            "app_name": "Safari",
            "site_domain": "docs.example.com",
            "site_title": "Sprint plan",
        })
        self.sid = self.db.fetch_timeline("2026-04-06")[0]["id"]
        self.db.save_classifications([{
            "segmentId": self.sid, "category": "learning", "productivity": "focus",
            "source": "llm", "confidence": 0.8, "inputFingerprint": "qa-original",
        }])
        pid = self.db.record_project_pass({
            "rangeStart": "2026-04-06T00:00:00Z", "rangeEnd": "2026-04-07T00:00:00Z",
            "trigger": "manual", "correctionsCount": 0,
        })["id"]
        self.assertEqual(self.db.save_classifications([{
            "segmentId": self.sid, "category": "entertainment", "productivity": "drift",
            "source": "ai_review", "confidence": 0.95,
            "inputFingerprint": "qa-review", "reviewPassId": pid,
        }]), 1)
        self.event = self.db.get_ai_review_events()[0]

    def tearDown(self) -> None:
        self.db.close()
        cleanup_temp_dir(self.tempdir)

    def assert_rule_wins(self, target: dict) -> None:
        rule = self.db.save_classification_rule({
            **target, "category": "workspace", "productivity": "focus",
        })
        self.assertEqual(self.db.apply_classification_rules(),
                         {"matchedCount": 1, "appliedCount": 1, "skippedCount": 0})
        current = self.db.fetch_timeline("2026-04-06")[0]["classification"]
        self.assertEqual((current["category"], current["productivity"], current["source"]),
                         ("workspace", "focus", "rule"))
        self.assertEqual(current["classificationRuleId"], rule["id"])
        self.assertEqual(self.db.revert_ai_review_event(self.event["id"]),
                         {"reverted": True, "restored": False})
        self.assertEqual(self.db.fetch_timeline("2026-04-06")[0]["classification"], current)

    def test_app_rule_materializes_over_an_accepted_project_review(self) -> None:
        self.assert_rule_wins({"targetKind": "app", "targetValue": "Safari"})

    def test_site_detail_rule_materializes_over_an_accepted_project_review(self) -> None:
        self.assert_rule_wins({
            "targetKind": "site", "targetValue": "docs.example.com",
            "matchScope": "detail", "detailKind": "title", "detailValue": "Sprint plan",
        })
