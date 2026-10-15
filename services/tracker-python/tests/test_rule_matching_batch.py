from __future__ import annotations

import os
import sqlite3
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.storage.db import TrackerDatabase
from app.tracker.adaptive_context.developer_diagnostics import save_developer_diagnostics
from tests.support_cleanup import cleanup_temp_dir


class RuleMatchingBatchTests(unittest.TestCase):
    def setUp(self) -> None:
        # The real settings writer refreshes process capture flags as well as
        # SQLite; those flags must not leak into unrelated capture tests.
        environment = patch.dict(os.environ)
        environment.start()
        self.addCleanup(environment.stop)
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

    def test_snapshot_deletion_keeps_survivors_and_concurrent_manual_corrections(self) -> None:
        self.rule()
        deleted, manual, survivor = [self.segment(site_domain="example.org") for _ in range(3)]
        other = TrackerDatabase(self.db.db_path, perform_maintenance=False)
        self.addCleanup(other.close)
        original = self.db._matching_rule

        def interleave(segment, rules):
            if int(segment["id"]) == deleted:
                other.delete_activity_segments([str(deleted)], refresh_recovery_backup=False)
                other.save_classifications([{
                    "segmentId": manual, "category": "entertainment",
                    "productivity": "drift", "source": "manual",
                }])
            return original(segment, rules)

        with patch.object(self.db, "_matching_rule", side_effect=interleave):
            self.assertEqual(self.db.apply_classification_rules(),
                             {"matchedCount": 3, "appliedCount": 1, "skippedCount": 2})
        saved = {row["segment_id"]: (row["category"], row["source"])
                 for row in self.db.connect().execute("SELECT * FROM activity_classifications")}
        self.assertEqual(saved, {manual: ("entertainment", "manual"), survivor: ("workspace", "rule")})
        self.assertIsNone(self.db.connect().execute(
            "SELECT 1 FROM activity_segments WHERE id = ?", (deleted,)).fetchone())
        self.assertFalse(self.db.connect().in_transaction)

    def assert_invalidated_snapshot_rule_is_skipped(self, *, delete: bool) -> None:
        stale_rule = self.rule()
        live_rule = self.rule(targetValue="survivor.invalid")
        stale = self.segment(site_domain="example.org")
        survivor = self.segment(site_domain="survivor.invalid")
        other = TrackerDatabase(self.db.db_path, perform_maintenance=False)
        self.addCleanup(other.close)
        original = self.db._matching_rule

        def interleave(segment, rules):
            if int(segment["id"]) == stale:
                if delete:
                    other.delete_classification_rule(stale_rule["id"])
                else:
                    other.save_classification_rule({**stale_rule, "enabled": False})
            return original(segment, rules)

        with patch.object(self.db, "_matching_rule", side_effect=interleave):
            self.assertEqual(self.db.apply_classification_rules(),
                             {"matchedCount": 2, "appliedCount": 1, "skippedCount": 1})
        self.assertEqual(dict(self.db.connect().execute(
            "SELECT segment_id, classification_rule_id FROM activity_classifications")),
            {survivor: live_rule["id"]})
        self.assertEqual(self.db.connect().execute("SELECT count(*) FROM activity_segments").fetchone()[0], 2)
        self.assertFalse(self.db.connect().in_transaction)

    def test_deleted_snapshot_rule_does_not_abort_other_classifications(self) -> None:
        self.assert_invalidated_snapshot_rule_is_skipped(delete=True)

    def test_disabled_snapshot_rule_cannot_be_reapplied(self) -> None:
        self.assert_invalidated_snapshot_rule_is_skipped(delete=False)

    def test_matching_allows_another_settings_writer_after_the_first_match(self) -> None:
        self.rule()
        first, second = [self.segment(site_domain="example.org") for _ in range(2)]
        other = TrackerDatabase(self.db.db_path, perform_maintenance=False)
        self.addCleanup(other.close)
        other.connect().execute("PRAGMA busy_timeout = 50")
        original = self.db._matching_rule

        def interleave(segment, rules):
            if int(segment["id"]) == second:
                save_developer_diagnostics(other, {"browserContentContextEnabled": True})
                # No partial result may be visible while matching continues.
                self.assertEqual(other.connect().execute(
                    "SELECT count(*) FROM activity_classifications").fetchone()[0], 0)
            return original(segment, rules)

        with patch.object(self.db, "_matching_rule", side_effect=interleave):
            self.assertEqual(self.db.apply_classification_rules(),
                             {"matchedCount": 2, "appliedCount": 2, "skippedCount": 0})
        self.assertEqual(set(row[0] for row in self.db.connect().execute(
            "SELECT segment_id FROM activity_classifications")), {first, second})
        self.assertFalse(self.db.connect().in_transaction)

    def test_changed_capture_is_skipped_after_matching_before_writer_admission(self) -> None:
        self.rule(matchScope="detail", detailKind="windowTitle", detailValue="Plan")
        first, second = [self.segment(site_domain="example.org", window_title="Plan") for _ in range(2)]
        other = TrackerDatabase(self.db.db_path, perform_maintenance=False)
        self.addCleanup(other.close)
        other.connect().execute("PRAGMA busy_timeout = 50")
        original = self.db._matching_rule

        def interleave(segment, rules):
            if int(segment["id"]) == second:
                with other.connect() as conn:
                    conn.execute("UPDATE activity_segments SET window_title = 'Different' WHERE id = ?", (first,))
            return original(segment, rules)

        with patch.object(self.db, "_matching_rule", side_effect=interleave):
            self.assertEqual(self.db.apply_classification_rules(),
                             {"matchedCount": 2, "appliedCount": 1, "skippedCount": 1})
        self.assertEqual([row[0] for row in self.db.connect().execute(
            "SELECT segment_id FROM activity_classifications")], [second])

    def test_new_detail_rule_restarts_matching_outside_the_writer(self) -> None:
        self.rule()
        first, second = [self.segment(site_domain="example.org", window_title="Plan") for _ in range(2)]
        other = TrackerDatabase(self.db.db_path, perform_maintenance=False)
        self.addCleanup(other.close)
        other.connect().execute("PRAGMA busy_timeout = 50")
        original = self.db._matching_rule
        detail = None

        def interleave(segment, rules):
            nonlocal detail
            if int(segment["id"]) == second and detail is None:
                detail = other.save_classification_rule({
                    "targetKind": "site", "targetValue": "example.org", "category": "learning",
                    "productivity": "focus", "matchScope": "detail",
                    "detailKind": "windowTitle", "detailValue": "Plan",
                })
            return original(segment, rules)

        with patch.object(self.db, "_matching_rule", side_effect=interleave):
            self.assertEqual(self.db.apply_classification_rules(),
                             {"matchedCount": 2, "appliedCount": 2, "skippedCount": 0})
        self.assertIsNotNone(detail)
        self.assertEqual(dict(self.db.connect().execute(
            "SELECT segment_id, category FROM activity_classifications")),
            {first: "learning", second: "learning"})

    def test_edited_rule_restarts_with_its_current_meaning(self) -> None:
        rule = self.rule()
        self.segment(site_domain="example.org")
        other = TrackerDatabase(self.db.db_path, perform_maintenance=False)
        self.addCleanup(other.close)
        original = self.db._matching_rule
        changed = False

        def interleave(segment, rules):
            nonlocal changed
            if not changed:
                changed = True
                other.save_classification_rule({**rule, "category": "learning"})
            return original(segment, rules)

        with patch.object(self.db, "_matching_rule", side_effect=interleave):
            self.assertEqual(self.db.apply_classification_rules(),
                             {"matchedCount": 1, "appliedCount": 1, "skippedCount": 0})
        self.assertEqual(self.db.connect().execute(
            "SELECT category FROM activity_classifications").fetchone()[0], "learning")

    def test_changed_video_title_is_not_applied_from_the_old_join(self) -> None:
        self.rule(matchScope="detail", detailKind="youtubeTitle", detailValue="Plan")
        with self.db.connect() as conn:
            conn.execute("INSERT INTO youtube_video_metadata (video_id, title, status) VALUES ('fixture', 'Plan', 'ready')")
        self.segment(site_domain="example.org", youtube_video_id="fixture")
        other = TrackerDatabase(self.db.db_path, perform_maintenance=False)
        self.addCleanup(other.close)
        original = self.db._matching_rule

        def interleave(segment, rules):
            with other.connect() as conn:
                conn.execute("UPDATE youtube_video_metadata SET title = 'Different' WHERE video_id = 'fixture'")
            return original(segment, rules)

        with patch.object(self.db, "_matching_rule", side_effect=interleave):
            self.assertEqual(self.db.apply_classification_rules(),
                             {"matchedCount": 1, "appliedCount": 0, "skippedCount": 1})
        self.assertEqual(self.db.connect().execute(
            "SELECT count(*) FROM activity_classifications").fetchone()[0], 0)

    def test_continuous_rule_edits_stop_without_partial_writes(self) -> None:
        rule = self.rule()
        self.segment(site_domain="example.org")
        other = TrackerDatabase(self.db.db_path, perform_maintenance=False)
        self.addCleanup(other.close)
        original = self.db._matching_rule
        edits = 0

        def interleave(segment, rules):
            nonlocal edits
            edits += 1
            other.save_classification_rule({**rule, "category": "learning" if edits % 2 else "workspace"})
            return original(segment, rules)

        with patch.object(self.db, "_matching_rule", side_effect=interleave):
            with self.assertRaisesRegex(RuntimeError, "rules changed"):
                self.db.apply_classification_rules()
        self.assertEqual(edits, 2)
        self.assertEqual(self.db.connect().execute(
            "SELECT count(*) FROM activity_classifications").fetchone()[0], 0)
        self.assertFalse(self.db.connect().in_transaction)
        save_developer_diagnostics(other, {"browserContentContextEnabled": True})

    def test_repeated_surfaces_avoid_full_rule_scans_without_reusing_details(self) -> None:
        surface = self.rule()
        detail = self.rule(matchScope="detail", detailKind="windowTitle", detailValue="Plan")
        for index in range(80):
            self.rule(targetValue=f"unrelated-{index}.invalid", matchScope="detail",
                      detailKind="windowTitle", detailValue="Plan")
        expected = {}
        for index in range(40):
            segment_id = self.segment(site_domain="example.org",
                                      site_url=f"https://example.org/page-{index}",
                                      window_title="Plan" if index % 2 else "Other")
            expected[segment_id] = detail["id"] if index % 2 else surface["id"]
        for index in range(20):
            self.segment(site_domain="no-rule.invalid", window_title=str(index))

        with patch.object(self.db, "_rule_surface_matches",
                          wraps=self.db._rule_surface_matches) as compare:
            self.assertEqual(self.db.apply_classification_rules(),
                             {"matchedCount": 40, "appliedCount": 40, "skippedCount": 0})
        saved = dict(self.db.connect().execute(
            "SELECT segment_id, classification_rule_id FROM activity_classifications"))
        self.assertEqual(saved, expected)
        # The same site/app should not rescan every unrelated rule for every
        # segment, including repeated surfaces with no applicable rule.
        self.assertLess(compare.call_count, 500)

        # Candidate reuse ends with this invocation; disabling a rule must be
        # observed when the same database instance applies the next batch.
        self.db.save_classification_rule({**detail, "enabled": False})
        self.db.apply_classification_rules()
        self.assertEqual(set(row[0] for row in self.db.connect().execute(
            "SELECT classification_rule_id FROM activity_classifications")), {surface["id"]})

    def test_many_unique_surfaces_keep_the_original_ordered_matching_result(self) -> None:
        surface = self.rule()
        detail = self.rule(matchScope="detail", detailKind="siteUrl",
                           detailValue="https://example.org/work")
        app = self.rule(targetKind="app", targetValue="qa.exact.bundle")
        expected = {}
        for index in range(300):
            # Exceed the bounded candidate cache and exercise domain/URL
            # fallback, exact bundle matching, misses, and per-row URL detail.
            kind = index % 4
            segment_id = self.segment(
                app_name=f"Synthetic App {index}",
                bundle_id="qa.exact.bundle" if kind == 2 else None,
                site_domain="docs.example.org" if kind == 0 else None,
                site_url="https://example.org/work" if kind == 1 else "https://miss.invalid/",
            )
            selected = [surface["id"], detail["id"], app["id"], None][kind]
            if selected is not None:
                expected[segment_id] = selected
        self.db.apply_classification_rules()
        self.assertEqual(dict(self.db.connect().execute(
            "SELECT segment_id, classification_rule_id FROM activity_classifications")), expected)
