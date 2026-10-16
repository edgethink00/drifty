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


class ClassificationRulePreviewTests(unittest.TestCase):
    """The preview a correction shows must count what saving and applying the rule does."""

    def setUp(self) -> None:
        self.tempdir = TemporaryDirectory()
        self.db = TrackerDatabase(Path(self.tempdir.name) / "tracker.sqlite3")
        self.ids: dict[str, int] = {}
        for index, (key, fields) in enumerate([
            ("docs-ai", {"app_name": "Safari", "bundle_id": "com.apple.Safari", "site_domain": "docs.example.com", "site_title": "API guide"}),
            ("docs-plain", {"app_name": "Safari", "bundle_id": "com.apple.Safari", "site_domain": "example.com", "site_title": "Pricing"}),
            ("docs-manual", {"app_name": "Safari", "bundle_id": "com.apple.Safari", "site_domain": "www.example.com", "site_title": "Blog"}),
            ("other-site", {"app_name": "Safari", "bundle_id": "com.apple.Safari", "site_domain": "news.test", "site_title": "Headlines"}),
            ("code", {"app_name": "Code", "bundle_id": "com.microsoft.VSCode", "window_title": "db.py"}),
        ]):
            self.db.insert_segment({
                "started_at": f"2026-04-06T{9 + index:02d}:00:00+00:00",
                "ended_at": f"2026-04-06T{9 + index:02d}:10:00+00:00",
                "duration_seconds": 600 + index * 60,
                **fields,
            })
        for row in self.db.fetch_timeline("2026-04-06"):
            key = {"docs.example.com": "docs-ai", "example.com": "docs-plain", "www.example.com": "docs-manual", "news.test": "other-site"}.get(row.get("siteDomain") or "", "code")
            self.ids[key] = row["id"]
        self.db.save_classifications([
            self.record("docs-ai", "entertainment", "drift", "llm"),
            self.record("docs-manual", "learning", "focus", "manual"),
        ])

    def tearDown(self) -> None:
        self.db.close()
        cleanup_temp_dir(self.tempdir)

    def record(self, key: str, category: str, productivity: str, source: str) -> dict:
        return {"segmentId": self.ids[key], "category": category, "productivity": productivity,
                "source": source, "confidence": 0.9, "inputFingerprint": f"test:{key}"}

    def classifications(self) -> dict[int, tuple[str, str, str] | None]:
        return {
            row["id"]: ((row["classification"]["category"], row["classification"]["productivity"], row["classification"]["source"])
                        if row.get("classification") else None)
            for row in self.db.fetch_timeline("2026-04-06")
        }

    def test_counts_the_records_a_site_rule_takes_and_writes_nothing(self) -> None:
        before = self.classifications()
        rule = {"targetKind": "site", "targetValue": "example.com", "category": "workspace", "productivity": "focus"}

        preview = self.db.preview_classification_rule(rule)

        self.assertEqual(preview["matchedCount"], 2)
        self.assertEqual(preview["matchedSeconds"], 600 + 660)
        self.assertEqual(preview["manualCount"], 1)
        self.assertEqual(self.classifications(), before)
        self.assertEqual(self.db.get_classification_rules(), [])

        self.db.save_classification_rule(rule)
        applied = self.db.apply_classification_rules()
        self.assertEqual(applied["appliedCount"], preview["matchedCount"])
        self.assertEqual(applied["skippedCount"], preview["manualCount"])

    def test_an_existing_detail_rule_keeps_its_records_from_a_whole_site_rule(self) -> None:
        self.db.save_classification_rule({"targetKind": "site", "targetValue": "example.com", "matchScope": "detail",
                                          "detailKind": "siteTitle", "detailValue": "API guide",
                                          "category": "learning", "productivity": "focus"})
        self.db.apply_classification_rules()

        preview = self.db.preview_classification_rule({"targetKind": "site", "targetValue": "example.com",
                                                       "category": "workspace", "productivity": "focus"})

        self.assertEqual(preview["matchedCount"], 1)
        self.assertEqual(preview["matchedSeconds"], 660)

    def test_a_detail_rule_takes_its_record_from_a_whole_app_rule(self) -> None:
        self.db.save_classification_rule({"targetKind": "app", "targetValue": "com.microsoft.VSCode",
                                          "category": "workspace", "productivity": "focus"})
        self.db.apply_classification_rules()

        preview = self.db.preview_classification_rule({"targetKind": "app", "targetValue": "com.microsoft.VSCode",
                                                       "matchScope": "detail", "detailKind": "windowTitle",
                                                       "detailValue": "db.py", "category": "learning", "productivity": "focus"})

        self.assertEqual(preview["matchedCount"], 1)
        self.assertEqual(preview["matchedSeconds"], 600 + 4 * 60)

    def test_editing_a_saved_rule_counts_the_records_it_already_holds(self) -> None:
        rule = {"targetKind": "site", "targetValue": "example.com", "category": "workspace", "productivity": "focus"}
        self.db.save_classification_rule(rule)
        self.db.apply_classification_rules()

        preview = self.db.preview_classification_rule({**rule, "category": "learning"})

        self.assertEqual(preview["matchedCount"], 2)
        self.assertEqual(self.db.apply_classification_rules()["appliedCount"], 2)

    def test_rejects_a_rule_it_could_not_save(self) -> None:
        with self.assertRaises(ValueError):
            self.db.preview_classification_rule({"targetKind": "site", "targetValue": "  ", "category": "workspace", "productivity": "focus"})
        with self.assertRaises(ValueError):
            self.db.preview_classification_rule({"targetKind": "folder", "targetValue": "x"})


if __name__ == "__main__":
    unittest.main()
