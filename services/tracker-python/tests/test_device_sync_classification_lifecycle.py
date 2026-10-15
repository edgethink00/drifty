from __future__ import annotations

import json
import sqlite3
import sys
import threading
import unittest
from contextlib import closing
from pathlib import Path
from tempfile import TemporaryDirectory

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.storage.db import TrackerDatabase
from app.storage.live_tail import fetch_live_tail
from tests.support_cleanup import cleanup_temp_dir


ORIGIN_DEVICE_ID = "11111111-2222-3333-4444-555555555555"
RECEIVER_DEVICE_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"


class DeviceSyncClassificationLifecycleTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = TemporaryDirectory()
        self.databases: list[TrackerDatabase] = []

    def tearDown(self) -> None:
        for database in reversed(self.databases):
            database.close()
        cleanup_temp_dir(self.tempdir)

    def _database(self, name: str) -> TrackerDatabase:
        database = TrackerDatabase(Path(self.tempdir.name) / f"{name}.sqlite3", perform_maintenance=False)
        database.set_sync_state({
            "sync_account_id": "synthetic-account",
            "sync_device_id": RECEIVER_DEVICE_ID,
        })
        self.databases.append(database)
        return database

    @staticmethod
    def _insert_local_segment(database: TrackerDatabase, app_name: str = "Code") -> int:
        database.insert_segment({
            "started_at": "2026-07-06T09:00:00+00:00",
            "ended_at": "2026-07-06T09:03:00+00:00",
            "duration_seconds": 180,
            "app_name": app_name,
            "bundle_id": f"qa.{app_name.lower()}",
            "window_title": "Synthetic cold segment",
            "platform": "macos",
            "source": "accessibility",
            "raw_context_json": "{}",
        })
        with database.connect() as conn:
            return int(conn.execute("SELECT id FROM activity_segments").fetchone()["id"])

    @staticmethod
    def _remote_segment(
        uid: str,
        *,
        app_name: str = "Remote",
        category: str = "workspace",
        productivity: str = "focus",
        source: str = "llm",
        classification_present: bool = True,
    ) -> dict:
        item = {
            "segmentUid": uid,
            "originDeviceId": ORIGIN_DEVICE_ID,
            "startedAt": "2026-07-06T09:00:00+00:00",
            "endedAt": "2026-07-06T09:03:00+00:00",
            "durationSeconds": 180,
            "appName": app_name,
            "bundleId": f"qa.{app_name.lower()}",
            "windowTitle": "Synthetic remote segment",
            "platform": "macos",
            "source": "accessibility",
        }
        if classification_present:
            item["classification"] = {
                "category": category,
                "productivity": productivity,
                "source": source,
                "confidence": 0.9,
                "reason": "synthetic sync",
                "classifiedAt": "2026-07-06T09:04:00+00:00",
            }
        return item

    @staticmethod
    def _cloud_items(outbox: dict) -> list[dict]:
        return [{**item, "originDeviceId": ORIGIN_DEVICE_ID} for item in outbox["items"]]

    @staticmethod
    def _classification(database: TrackerDatabase, uid: str) -> sqlite3.Row | None:
        with database.connect() as conn:
            return conn.execute(
                """
                SELECT c.*
                FROM activity_classifications c
                JOIN activity_segments s ON s.id = c.segment_id
                WHERE s.segment_uid = ?
                """,
                (uid,),
            ).fetchone()

    @staticmethod
    def _segment_id(database: TrackerDatabase, uid: str) -> int:
        with database.connect() as conn:
            return int(conn.execute(
                "SELECT id FROM activity_segments WHERE segment_uid = ?", (uid,)
            ).fetchone()["id"])

    @staticmethod
    def _has_marker_table(database: TrackerDatabase) -> bool:
        with database.connect() as conn:
            return conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sync_classification_provenance'"
            ).fetchone() is not None

    @classmethod
    def _provenance(cls, database: TrackerDatabase, segment_id: int) -> str | None:
        if not cls._has_marker_table(database):
            return None
        with database.connect() as conn:
            row = conn.execute(
                "SELECT provenance FROM sync_classification_provenance WHERE segment_id = ?",
                (segment_id,),
            ).fetchone()
        return str(row["provenance"]) if row is not None else None

    @classmethod
    def _rule_snapshot_kind(cls, database: TrackerDatabase, segment_id: int) -> str | None:
        if not cls._has_marker_table(database):
            return None
        with database.connect() as conn:
            row = conn.execute(
                "SELECT rule_snapshot_kind FROM sync_classification_provenance WHERE segment_id = ?",
                (segment_id,),
            ).fetchone()
        return str(row["rule_snapshot_kind"]) if row is not None and row["rule_snapshot_kind"] else None

    @classmethod
    def _has_sync_marker(cls, database: TrackerDatabase, segment_id: int) -> bool:
        return cls._provenance(database, segment_id) == "sync"

    def _roundtrip_origin_change(self, source: str) -> None:
        origin = self._database(f"origin-{source}")
        receiver = self._database(f"receiver-{source}")
        segment_id = self._insert_local_segment(origin, app_name=f"Code-{source}")

        if source == "rule":
            rule = origin.save_classification_rule({
                "targetKind": "app",
                "targetValue": f"Code-{source}",
                "category": "workspace",
                "productivity": "focus",
            })
            self.assertEqual(origin.apply_classification_rules()["appliedCount"], 1)
        else:
            self.assertEqual(origin.save_classifications([{
                "segmentId": segment_id,
                "inputFingerprint": f"origin:{source}:first",
                "category": "workspace",
                "productivity": "focus",
                "source": source,
                "confidence": 0.9,
            }]), 1)

        first = origin.get_sync_outbox(0, hot_grace_seconds=0)
        self.assertEqual(len(first["items"]), 1)
        uid = first["items"][0]["segmentUid"]
        receiver.apply_synced_segments(self._cloud_items(first))
        self.assertEqual(self._classification(receiver, uid)["category"], "workspace")

        if source == "rule":
            origin.save_classification_rule({
                **rule,
                "category": "entertainment",
                "productivity": "drift",
            })
            self.assertEqual(origin.apply_classification_rules()["appliedCount"], 1)
        else:
            self.assertEqual(origin.save_classifications([{
                "segmentId": segment_id,
                "inputFingerprint": f"origin:{source}:second",
                "category": "entertainment",
                "productivity": "drift",
                "source": source,
                "confidence": 0.95,
            }]), 1)

        second = origin.get_sync_outbox(first["batchMaxSeq"], hot_grace_seconds=0)
        self.assertEqual(len(second["items"]), 1)
        receiver.apply_synced_segments(self._cloud_items(second))
        current = self._classification(receiver, uid)
        self.assertEqual((current["category"], current["productivity"], current["source"]),
                         ("entertainment", "drift", source))
        self.assertEqual(
            self._rule_snapshot_kind(receiver, self._segment_id(receiver, uid)),
            "synced-rule" if source == "rule" else None,
        )

    def test_repeated_origin_manual_rule_and_ai_review_changes_roundtrip(self) -> None:
        for source in ("manual", "rule", "ai_review"):
            with self.subTest(source=source):
                self._roundtrip_origin_change(source)

    def test_actual_receiver_local_choices_invalidate_sync_provenance(self) -> None:
        receiver = self._database("receiver-local-choices")
        manual_uid = "10000000-0000-0000-0000-000000000001"
        rule_uid = "10000000-0000-0000-0000-000000000002"
        review_uid = "10000000-0000-0000-0000-000000000003"
        receiver.apply_synced_segments([
            self._remote_segment(manual_uid, app_name="ManualApp"),
            self._remote_segment(rule_uid, app_name="RuleApp"),
            self._remote_segment(review_uid, app_name="ReviewApp"),
        ])

        manual_id = self._segment_id(receiver, manual_uid)
        self.assertEqual(receiver.save_classifications([{
            "segmentId": manual_id,
            "inputFingerprint": f"sync:{manual_uid}",
            "category": "manual-local",
            "productivity": "focus",
            "source": "manual",
            "confidence": 1,
        }]), 1)

        receiver.save_classification_rule({
            "targetKind": "app",
            "targetValue": "RuleApp",
            "category": "rule-local",
            "productivity": "focus",
        })
        self.assertEqual(receiver.apply_classification_rules()["appliedCount"], 1)

        review_id = self._segment_id(receiver, review_uid)
        pass_id = receiver.record_project_pass({
            "rangeStart": "2026-07-06T00:00:00+00:00",
            "rangeEnd": "2026-07-07T00:00:00+00:00",
            "trigger": "manual",
            "correctionsCount": 0,
        })["id"]
        self.assertEqual(receiver.save_classifications([{
            "segmentId": review_id,
            # This is the real counterexample: project review reuses the current
            # incoming fingerprint, so the fingerprint cannot prove provenance.
            "inputFingerprint": f"sync:{review_uid}",
            "category": "review-local",
            "productivity": "focus",
            "source": "ai_review",
            "confidence": 0.99,
            "reviewPassId": pass_id,
        }]), 1)

        for uid in (manual_uid, rule_uid, review_uid):
            self.assertEqual(
                self._provenance(receiver, self._segment_id(receiver, uid)),
                "local-protected",
            )
            self.assertIsNone(
                self._rule_snapshot_kind(receiver, self._segment_id(receiver, uid))
            )

        receiver.apply_synced_segments([
            self._remote_segment(manual_uid, app_name="ManualApp", category="origin-new", source="manual"),
            self._remote_segment(rule_uid, app_name="RuleApp", category="origin-new", source="rule"),
            self._remote_segment(review_uid, app_name="ReviewApp", category="origin-new", source="ai_review"),
        ])
        self.assertEqual(self._classification(receiver, manual_uid)["category"], "manual-local")
        self.assertEqual(self._classification(receiver, rule_uid)["category"], "rule-local")
        self.assertEqual(self._classification(receiver, review_uid)["category"], "review-local")

    def test_receiver_automatic_classifications_do_not_block_later_origin_manual_choice(self) -> None:
        automatic_sources = ("llm", "app-db", "domain-db", "youtube", "fallback")
        for index, automatic_source in enumerate(automatic_sources, start=1):
            with self.subTest(source=automatic_source):
                origin = self._database(f"origin-auto-{automatic_source}")
                receiver = self._database(f"receiver-auto-{automatic_source}")
                origin_segment_id = self._insert_local_segment(
                    origin, app_name=f"Automatic-{automatic_source}"
                )

                first = origin.get_sync_outbox(0, hot_grace_seconds=0)
                self.assertIsNone(first["items"][0]["classification"])
                uid = first["items"][0]["segmentUid"]
                receiver.apply_synced_segments(self._cloud_items(first))

                receiver_segment_id = self._segment_id(receiver, uid)
                self.assertEqual(receiver.save_classifications([{
                    "segmentId": receiver_segment_id,
                    "inputFingerprint": f"receiver:{automatic_source}:{index}",
                    "category": "workspace",
                    "productivity": "focus",
                    "source": automatic_source,
                    "confidence": 0.9,
                }]), 1)
                self.assertIsNone(self._provenance(receiver, receiver_segment_id))

                self.assertEqual(origin.save_classifications([{
                    "segmentId": origin_segment_id,
                    "inputFingerprint": f"origin:manual:{index}",
                    "category": "entertainment",
                    "productivity": "drift",
                    "source": "manual",
                    "confidence": 1,
                }]), 1)
                changed = origin.get_sync_outbox(first["batchMaxSeq"], hot_grace_seconds=0)
                receiver.apply_synced_segments(self._cloud_items(changed))

                current = self._classification(receiver, uid)
                self.assertEqual(
                    (current["category"], current["productivity"], current["source"]),
                    ("entertainment", "drift", "manual"),
                )
                self.assertEqual(self._provenance(receiver, receiver_segment_id), "sync")

    def test_rule_update_then_delete_emits_classification_null(self) -> None:
        origin = self._database("origin-rule-delete")
        receiver = self._database("receiver-rule-delete")
        self._insert_local_segment(origin, app_name="RuleDeleteApp")
        rule = origin.save_classification_rule({
            "targetKind": "app",
            "targetValue": "RuleDeleteApp",
            "category": "workspace",
            "productivity": "focus",
        })
        origin.apply_classification_rules()
        first = origin.get_sync_outbox(0, hot_grace_seconds=0)
        receiver.apply_synced_segments(self._cloud_items(first))
        uid = first["items"][0]["segmentUid"]
        receiver_segment_id = self._segment_id(receiver, uid)
        self.assertEqual(
            self._rule_snapshot_kind(receiver, receiver_segment_id), "synced-rule"
        )

        origin.save_classification_rule({**rule, "category": "learning"})
        origin.apply_classification_rules()
        changed = origin.get_sync_outbox(first["batchMaxSeq"], hot_grace_seconds=0)
        self.assertEqual(changed["items"][0]["classification"]["category"], "learning")
        receiver.apply_synced_segments(self._cloud_items(changed))
        self.assertEqual(self._classification(receiver, uid)["category"], "learning")

        self.assertEqual(origin.delete_classification_rule(rule["id"]), 1)
        deleted = origin.get_sync_outbox(changed["batchMaxSeq"], hot_grace_seconds=0)
        self.assertEqual(len(deleted["items"]), 1)
        self.assertIsNone(deleted["items"][0]["classification"])
        self.assertGreater(deleted["items"][0]["syncSeq"], changed["batchMaxSeq"])
        receiver.apply_synced_segments(self._cloud_items(deleted))
        self.assertIsNone(self._classification(receiver, uid))
        self.assertIsNone(self._provenance(receiver, receiver_segment_id))

    def test_explicit_null_removes_only_proven_sync_rows_and_omission_preserves(self) -> None:
        receiver = self._database("receiver-null")
        synced_uid = "20000000-0000-0000-0000-000000000001"
        local_uid = "20000000-0000-0000-0000-000000000002"
        receiver.apply_synced_segments([
            self._remote_segment(synced_uid, app_name="SyncedApp"),
            self._remote_segment(local_uid, app_name="LocalApp"),
        ])

        omitted = self._remote_segment(synced_uid, app_name="SyncedApp", classification_present=False)
        omitted["durationSeconds"] = 240
        receiver.apply_synced_segments([omitted])
        self.assertEqual(self._classification(receiver, synced_uid)["category"], "workspace")

        local_id = self._segment_id(receiver, local_uid)
        receiver.save_classifications([{
            "segmentId": local_id,
            "inputFingerprint": f"sync:{local_uid}",
            "category": "local-choice",
            "productivity": "focus",
            "source": "manual",
            "confidence": 1,
        }])

        synced_null = self._remote_segment(synced_uid, app_name="SyncedApp", classification_present=False)
        synced_null["classification"] = None
        local_null = self._remote_segment(local_uid, app_name="LocalApp", classification_present=False)
        local_null["classification"] = None
        receiver.apply_synced_segments([synced_null, local_null])

        self.assertIsNone(self._classification(receiver, synced_uid))
        self.assertEqual(self._classification(receiver, local_uid)["category"], "local-choice")
        self.assertEqual(receiver.get_sync_outbox(0, hot_grace_seconds=0)["items"], [])

    def test_read_only_queries_accept_pre_provenance_database_without_migration(self) -> None:
        from app.cli.main import run_cli
        from contextlib import redirect_stdout
        import io

        database = self._database("read-only-old-schema")
        self._insert_local_segment(database, app_name="Legacy")
        with database.connect() as conn:
            for operation in ("insert", "update", "delete"):
                conn.execute(f"DROP TRIGGER trg_activity_classifications_sync_origin_{operation}")
            conn.execute("DROP TABLE sync_classification_provenance")
        database.close()
        before = database.db_path.read_bytes()
        reader = TrackerDatabase(database.db_path, perform_maintenance=False, read_only=True)
        self.databases.append(reader)
        start, end = "2026-07-06T00:00:00+00:00", "2026-07-07T00:00:00+00:00"
        self.assertEqual(len(reader.timeline(start, end)), 1)
        self.assertEqual(len(reader.timeline_page(start, end)["items"]), 1)
        self.assertEqual(len(reader.search_timeline_page("Legacy", start, end)["items"]), 1)
        self.assertEqual(len(reader.dashboard_week_timeline(start, end)), 1)
        self.assertEqual(len(fetch_live_tail(reader, start, end, None, None)), 1)
        output = io.StringIO()
        with redirect_stdout(output):
            status = run_cli(["--db", str(database.db_path), "timeline", "--day", "2026-07-06"])
        self.assertEqual(status, 0, output.getvalue())
        self.assertFalse(self._has_marker_table(reader))
        reader.close()
        self.assertEqual(database.db_path.read_bytes(), before)

    def test_marker_delete_cascade_and_transaction_rollback(self) -> None:
        receiver = self._database("receiver-atomicity")
        uid = "30000000-0000-0000-0000-000000000001"
        receiver.apply_synced_segments([self._remote_segment(uid, source="rule")])
        segment_id = self._segment_id(receiver, uid)
        self.assertTrue(self._has_sync_marker(receiver, segment_id))
        self.assertEqual(self._rule_snapshot_kind(receiver, segment_id), "synced-rule")
        with receiver.connect() as conn:
            before_seq = conn.execute(
                "SELECT sync_seq FROM activity_segments WHERE id = ?", (segment_id,)
            ).fetchone()["sync_seq"]

        with self.assertRaisesRegex(RuntimeError, "synthetic rollback"):
            with receiver.connect() as conn:
                conn.execute("DELETE FROM activity_classifications WHERE segment_id = ?", (segment_id,))
                raise RuntimeError("synthetic rollback")

        self.assertIsNotNone(self._classification(receiver, uid))
        self.assertTrue(self._has_sync_marker(receiver, segment_id))
        self.assertEqual(self._rule_snapshot_kind(receiver, segment_id), "synced-rule")
        with receiver.connect() as conn:
            after_seq = conn.execute(
                "SELECT sync_seq FROM activity_segments WHERE id = ?", (segment_id,)
            ).fetchone()["sync_seq"]
            conn.execute("DELETE FROM activity_segments WHERE id = ?", (segment_id,))
        self.assertEqual(after_seq, before_seq)
        self.assertFalse(self._has_sync_marker(receiver, segment_id))

    def test_receiver_local_ai_review_revert_remains_a_local_choice(self) -> None:
        receiver = self._database("receiver-review-revert")
        uid = "30000000-0000-0000-0000-000000000002"
        receiver.apply_synced_segments([self._remote_segment(uid, source="rule")])
        segment_id = self._segment_id(receiver, uid)
        pass_id = receiver.record_project_pass({
            "rangeStart": "2026-07-06T00:00:00+00:00",
            "rangeEnd": "2026-07-07T00:00:00+00:00",
            "trigger": "manual",
            "correctionsCount": 0,
        })["id"]
        receiver.save_classifications([{
            "segmentId": segment_id,
            "inputFingerprint": f"sync:{uid}",
            "category": "entertainment",
            "productivity": "drift",
            "source": "ai_review",
            "confidence": 0.99,
            "reviewPassId": pass_id,
        }])
        event_id = receiver.get_ai_review_events()[0]["id"]
        self.assertEqual(
            receiver.revert_ai_review_event(event_id),
            {"reverted": True, "restored": True},
        )
        reverted = self._classification(receiver, uid)
        self.assertEqual((reverted["category"], reverted["source"]), ("workspace", "rule"))
        self.assertEqual(self._provenance(receiver, segment_id), "local-protected")
        self.assertEqual(self._rule_snapshot_kind(receiver, segment_id), "synced-rule")

        with receiver.connect() as conn:
            raw_event = conn.execute(
                "SELECT prev_classification_json, applied_classification_json "
                "FROM ai_review_events WHERE id = ?", (event_id,)
            ).fetchone()
        previous_snapshot = json.loads(raw_event["prev_classification_json"])
        applied_snapshot = json.loads(raw_event["applied_classification_json"])
        expected_snapshot_keys = set(receiver._AI_REVIEW_CLASSIFICATION_SNAPSHOT_COLUMNS) | {
            receiver._AI_REVIEW_RULE_SNAPSHOT_KIND_KEY
        }
        self.assertEqual(set(previous_snapshot), expected_snapshot_keys)
        self.assertEqual(set(applied_snapshot), expected_snapshot_keys)
        self.assertEqual(previous_snapshot["rule_snapshot_kind"], "synced-rule")
        self.assertIsNone(applied_snapshot["rule_snapshot_kind"])
        self.assertNotIn("prevClassification", receiver.get_ai_review_events()[0])

        start = "2026-07-06T00:00:00+00:00"
        end = "2026-07-07T00:00:00+00:00"
        full = receiver._serialize_row(receiver.timeline(start, end)[0])
        compact = receiver.dashboard_week_timeline(start, end)[0]
        live = fetch_live_tail(receiver, start, end, None, None)[0]
        for dto in (full, compact, live):
            self.assertEqual(
                dto["classification"]["ruleSnapshotKind"], "synced-rule"
            )

        receiver.apply_synced_segments([
            self._remote_segment(uid, category="origin-after-revert", source="ai_review")
        ])
        self.assertEqual(self._classification(receiver, uid)["category"], "workspace")

    def test_latest_first_review_undo_restores_synced_rule_meaning_chain(self) -> None:
        receiver = self._database("receiver-review-chain")
        uid = "30000000-0000-0000-0000-000000000003"
        receiver.apply_synced_segments([self._remote_segment(uid, source="rule")])
        segment_id = self._segment_id(receiver, uid)

        def review(category: str, productivity: str) -> int:
            pass_id = receiver.record_project_pass({
                "rangeStart": "2026-07-06T00:00:00+00:00",
                "rangeEnd": "2026-07-07T00:00:00+00:00",
                "trigger": "manual",
                "correctionsCount": 0,
            })["id"]
            self.assertEqual(receiver.save_classifications([{
                "segmentId": segment_id,
                "inputFingerprint": f"sync:{uid}",
                "category": category,
                "productivity": productivity,
                "source": "ai_review",
                "confidence": 0.99,
                "reviewPassId": pass_id,
            }]), 1)
            return receiver.get_ai_review_events()[0]["id"]

        first_event_id = review("communication", "neutral")
        latest_event_id = review("learning", "focus")
        self.assertEqual(
            receiver.revert_ai_review_event(latest_event_id),
            {"reverted": True, "restored": True},
        )
        self.assertEqual(self._classification(receiver, uid)["category"], "communication")
        self.assertIsNone(self._rule_snapshot_kind(receiver, segment_id))
        self.assertEqual(
            receiver.revert_ai_review_event(first_event_id),
            {"reverted": True, "restored": True},
        )
        restored = self._classification(receiver, uid)
        self.assertEqual((restored["category"], restored["source"]), ("workspace", "rule"))
        self.assertEqual(self._provenance(receiver, segment_id), "local-protected")
        self.assertEqual(self._rule_snapshot_kind(receiver, segment_id), "synced-rule")

    def test_review_failure_rolls_back_classification_ownership_and_rule_meaning(self) -> None:
        receiver = self._database("receiver-review-rollback")
        uid = "30000000-0000-0000-0000-000000000004"
        receiver.apply_synced_segments([self._remote_segment(uid, source="rule")])
        segment_id = self._segment_id(receiver, uid)
        pass_id = receiver.record_project_pass({
            "rangeStart": "2026-07-06T00:00:00+00:00",
            "rangeEnd": "2026-07-07T00:00:00+00:00",
            "trigger": "manual",
            "correctionsCount": 0,
        })["id"]
        with receiver.connect() as conn:
            conn.execute(
                "CREATE TRIGGER qa_abort_sync_review BEFORE INSERT ON ai_review_events "
                "BEGIN SELECT RAISE(ABORT, 'qa sync review failure'); END"
            )
        with self.assertRaisesRegex(sqlite3.IntegrityError, "qa sync review failure"):
            receiver.save_classifications([{
                "segmentId": segment_id,
                "category": "entertainment",
                "productivity": "drift",
                "source": "ai_review",
                "confidence": 0.99,
                "reviewPassId": pass_id,
            }])
        current = self._classification(receiver, uid)
        self.assertEqual((current["category"], current["source"]), ("workspace", "rule"))
        self.assertEqual(self._provenance(receiver, segment_id), "sync")
        self.assertEqual(self._rule_snapshot_kind(receiver, segment_id), "synced-rule")
        self.assertEqual(receiver.get_ai_review_events(), [])

    def test_table_absent_legacy_migration_is_idempotent_and_invents_no_meaning(self) -> None:
        path = Path(self.tempdir.name) / "legacy.sqlite3"
        database = TrackerDatabase(path, perform_maintenance=False)
        uids = {
            "manual": "40000000-0000-0000-0000-000000000001",
            "rule": "40000000-0000-0000-0000-000000000002",
            "ai_review": "40000000-0000-0000-0000-000000000003",
        }
        database.apply_synced_segments([
            self._remote_segment(uid, app_name=source, category=f"legacy-{source}", source=source)
            for source, uid in uids.items()
        ])
        segment_ids = {
            source: self._segment_id(database, uid) for source, uid in uids.items()
        }
        database.close()

        with closing(sqlite3.connect(path)) as conn, conn:
            conn.execute("DROP TABLE IF EXISTS sync_classification_provenance")

        first_reopen = TrackerDatabase(path, perform_maintenance=False)
        self.databases.append(first_reopen)
        self.assertTrue(self._has_marker_table(first_reopen))
        for segment_id in segment_ids.values():
            self.assertFalse(self._has_sync_marker(first_reopen, segment_id))
            self.assertEqual(self._provenance(first_reopen, segment_id), "legacy")
            self.assertIsNone(self._rule_snapshot_kind(first_reopen, segment_id))
        with first_reopen.connect() as conn:
            schema = conn.execute(
                "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'sync_classification_provenance'"
            ).fetchone()["sql"]
        self.assertIn("local-protected", schema)
        self.assertIn("synced-rule", schema)
        self.assertIn("provenance != 'legacy' OR rule_snapshot_kind IS NULL", schema)
        first_reopen.close()

        second_reopen = TrackerDatabase(path, perform_maintenance=False)
        self.databases.append(second_reopen)
        for source, uid in uids.items():
            segment_id = segment_ids[source]
            self.assertEqual(self._provenance(second_reopen, segment_id), "legacy")
            self.assertIsNone(self._rule_snapshot_kind(second_reopen, segment_id))
            second_reopen.apply_synced_segments([
                self._remote_segment(uid, app_name=source, category="legacy-second", source=source)
            ])
            # Historical protected-source ownership and rule meaning are both
            # unknowable; preserve the choice and never infer from labels.
            self.assertEqual(
                self._classification(second_reopen, uid)["category"], f"legacy-{source}"
            )
            legacy_null = self._remote_segment(uid, classification_present=False)
            legacy_null["classification"] = None
            second_reopen.apply_synced_segments([legacy_null])
            self.assertEqual(
                self._classification(second_reopen, uid)["category"], f"legacy-{source}"
            )

    def test_interrupted_legacy_migration_does_not_publish_empty_ownership_table(self) -> None:
        import os
        import subprocess

        database = self._database("migration-crash")
        uid = "40000000-0000-0000-0000-000000000099"
        database.apply_synced_segments([self._remote_segment(uid, source="manual")])
        with database.connect() as conn:
            for operation in ("insert", "update", "delete"):
                conn.execute(f"DROP TRIGGER trg_activity_classifications_sync_origin_{operation}")
            conn.execute("DROP TABLE sync_classification_provenance")
        database.close()
        code = """
import os, sys
from pathlib import Path
from app.storage.db import TrackerDatabase
class InterruptedUpgrade(TrackerDatabase):
    def _ensure_sync_schema(self, conn):
        def interrupt(statement):
            if 'INSERT OR IGNORE INTO sync_classification_provenance' in statement:
                os._exit(73)
        conn.set_trace_callback(interrupt)
        super()._ensure_sync_schema(conn)
InterruptedUpgrade(Path(sys.argv[1]), perform_maintenance=False)
"""
        child = subprocess.run(
            [sys.executable, "-c", code, str(database.db_path)],
            env={**os.environ, "PYTHONPATH": str(SERVICE_ROOT)},
            capture_output=True, text=True, timeout=15,
        )
        self.assertEqual(child.returncode, 73, child.stderr)
        with closing(sqlite3.connect(database.db_path)) as conn:
            self.assertIsNone(conn.execute(
                "SELECT 1 FROM sqlite_master WHERE name = 'sync_classification_provenance'"
            ).fetchone())
            self.assertEqual(conn.execute("SELECT count(*) FROM activity_classifications").fetchone()[0], 1)
        reopened = TrackerDatabase(database.db_path, perform_maintenance=False)
        self.databases.append(reopened)
        segment_id = self._segment_id(reopened, uid)
        self.assertEqual(self._provenance(reopened, segment_id), "legacy")
        reopened.apply_synced_segments([self._remote_segment(uid, category="remote-new", source="manual")])
        self.assertEqual(self._classification(reopened, uid)["category"], "workspace")

    def test_distinct_sqlite_writer_invalidates_marker_before_future_pull(self) -> None:
        path = Path(self.tempdir.name) / "shared.sqlite3"
        receiver = TrackerDatabase(path, perform_maintenance=False)
        local_writer = TrackerDatabase(path, perform_maintenance=False)
        self.databases.extend((receiver, local_writer))
        uid = "50000000-0000-0000-0000-000000000001"
        receiver.apply_synced_segments([self._remote_segment(uid)])
        segment_id = self._segment_id(receiver, uid)
        self.assertTrue(self._has_sync_marker(receiver, segment_id))

        local_writer.save_classifications([{
            "segmentId": segment_id,
            "inputFingerprint": f"sync:{uid}",
            "category": "local-writer",
            "productivity": "focus",
            "source": "ai_review",
            "confidence": 0.98,
        }])
        self.assertFalse(self._has_sync_marker(receiver, segment_id))

        receiver.apply_synced_segments([
            self._remote_segment(uid, category="origin-later", source="ai_review")
        ])
        self.assertEqual(self._classification(receiver, uid)["category"], "local-writer")
        self.assertEqual(self._provenance(receiver, segment_id), "local-protected")

    def test_contending_sqlite_writers_serialize_provenance_with_classification(self) -> None:
        path = Path(self.tempdir.name) / "contended.sqlite3"
        receiver = TrackerDatabase(path, perform_maintenance=False)
        self.databases.append(receiver)
        uid = "50000000-0000-0000-0000-000000000002"
        receiver.apply_synced_segments([self._remote_segment(uid)])
        segment_id = self._segment_id(receiver, uid)
        self.assertTrue(self._has_sync_marker(receiver, segment_id))

        local_write_ready = threading.Event()
        remote_write_started = threading.Event()
        allow_local_commit = threading.Event()
        errors: list[BaseException] = []

        def write_local_override() -> None:
            database = TrackerDatabase(path, perform_maintenance=False)
            try:
                with database.connect() as conn:
                    conn.execute("BEGIN IMMEDIATE")
                    conn.execute(
                        """
                        UPDATE activity_classifications
                        SET input_fingerprint = ?, category = 'local-race',
                            productivity = 'focus', source = 'manual'
                        WHERE segment_id = ?
                        """,
                        (f"sync:{uid}", segment_id),
                    )
                    local_write_ready.set()
                    if not allow_local_commit.wait(5):
                        raise AssertionError("local writer was not released")
            except BaseException as error:
                errors.append(error)
            finally:
                database.close()

        def apply_remote_change() -> None:
            try:
                if not local_write_ready.wait(5):
                    raise AssertionError("local writer never reserved SQLite")
                remote_write_started.set()
                database = TrackerDatabase(path, perform_maintenance=False)
                try:
                    database.apply_synced_segments([
                        self._remote_segment(uid, category="origin-race", source="manual")
                    ])
                finally:
                    database.close()
            except BaseException as error:
                errors.append(error)

        local_thread = threading.Thread(target=write_local_override)
        remote_thread = threading.Thread(target=apply_remote_change)
        local_thread.start()
        remote_thread.start()
        self.assertTrue(local_write_ready.wait(5))
        self.assertTrue(remote_write_started.wait(5))
        allow_local_commit.set()
        local_thread.join(10)
        remote_thread.join(10)

        self.assertFalse(local_thread.is_alive())
        self.assertFalse(remote_thread.is_alive())
        self.assertEqual(errors, [])
        self.assertEqual(self._classification(receiver, uid)["category"], "local-race")
        self.assertEqual(self._provenance(receiver, segment_id), "local-protected")

    def test_sync_marker_never_changes_public_outbox_shape_or_repushes_remote_rows(self) -> None:
        origin = self._database("origin-dto")
        receiver = self._database("receiver-dto")
        segment_id = self._insert_local_segment(origin)
        origin.save_classifications([{
            "segmentId": segment_id,
            "category": "workspace",
            "productivity": "focus",
            "source": "manual",
            "confidence": 1,
        }])
        outbox = origin.get_sync_outbox(0, hot_grace_seconds=0)
        self.assertEqual(set(outbox["items"][0]["classification"]), {
            "category", "productivity", "source", "confidence", "reason", "classifiedAt",
        })
        receiver.apply_synced_segments(self._cloud_items(outbox))
        self.assertTrue(self._has_sync_marker(
            receiver, self._segment_id(receiver, outbox["items"][0]["segmentUid"])
        ))
        self.assertEqual(receiver.get_sync_outbox(0, hot_grace_seconds=0)["items"], [])


if __name__ == "__main__":
    unittest.main()
