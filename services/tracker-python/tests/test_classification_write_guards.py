from __future__ import annotations

import json
import sqlite3
import sys
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Barrier
from unittest.mock import patch

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.storage.db import TrackerDatabase
from tests.support_cleanup import cleanup_temp_dir


class ClassificationWriteGuardsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = TemporaryDirectory()
        self.db = TrackerDatabase(Path(self.tempdir.name) / "tracker.sqlite3")
        self.db.insert_segment({"started_at": "2026-04-06T09:00:00Z", "ended_at": "2026-04-06T09:03:00Z",
                                "duration_seconds": 180, "app_name": "Code"})
        self.sid = self.db.fetch_timeline("2026-04-06")[0]["id"]

    def tearDown(self) -> None:
        self.db.close()
        cleanup_temp_dir(self.tempdir)

    def record(self, source: str = "llm", **fields: object) -> dict:
        return {"segmentId": self.sid, "category": "entertainment", "productivity": "drift",
                "source": source, "confidence": 0.95, "inputFingerprint": "qa-late", **fields}

    def rule(self) -> dict:
        rule = self.db.save_classification_rule({"targetKind": "app", "targetValue": "Code",
                                                 "category": "workspace", "productivity": "focus"})
        self.assertEqual(self.db.apply_classification_rules()["appliedCount"], 1)
        return rule

    def current(self) -> dict | None:
        return self.db.fetch_timeline("2026-04-06")[0].get("classification")

    def pass_id(self) -> int:
        return self.db.record_project_pass({"rangeStart": "2026-04-06T00:00:00Z",
                                            "rangeEnd": "2026-04-07T00:00:00Z", "trigger": "manual",
                                            "correctionsCount": 0})["id"]

    def builtin_record(self, source: str = "app-db", **fields: object) -> dict:
        return self.record(source, **{
            "taxonomyVersion": "builtin-heuristics-v3", "aiResult": False, "stale": False,
            "inputFingerprint": f"builtin:builtin-heuristics-v3:{self.sid}:09:00:09:03",
            "classifiedAt": "2026-04-06T10:00:00+00:00", **fields,
        })

    def stored_state(self) -> dict:
        with self.db.connect() as conn:
            return {
                "classification": dict(conn.execute(
                    "SELECT * FROM activity_classifications WHERE segment_id = ?", (self.sid,),
                ).fetchone()),
                "seq": conn.execute("SELECT sync_seq FROM activity_segments WHERE id = ?", (self.sid,)).fetchone()[0],
                "counter": conn.execute("SELECT seq FROM sync_counter WHERE id = 1").fetchone()[0],
                "provenance": [dict(row) for row in conn.execute(
                    "SELECT * FROM sync_classification_provenance WHERE segment_id = ?", (self.sid,),
                )],
            }

    def test_overlapping_builtin_refreshes_from_two_connections_save_nine_only_once(self) -> None:
        records = []
        for group in ("stale", "old", "unversioned"):
            for source in ("app-db", "domain-db", "youtube"):
                self.db.insert_segment({"started_at": "2026-04-06T11:00:00Z",
                                        "ended_at": "2026-04-06T11:03:00Z",
                                        "duration_seconds": 180, "app_name": "Synthetic refresh"})
                sid = self.db.connect().execute("SELECT max(id) FROM activity_segments").fetchone()[0]
                record = self.builtin_record(source, segmentId=sid, inputFingerprint=f"builtin:{sid}")
                self.assertEqual(self.db.save_classifications([{
                    **record, "stale": group == "stale",
                    "taxonomyVersion": None if group == "unversioned" else (
                        "builtin-heuristics-v2" if group == "old" else record["taxonomyVersion"]
                    ),
                }]), 1)
                records.append(record)
        before = self.db.connect().execute("SELECT seq FROM sync_counter WHERE id = 1").fetchone()[0]
        ready = Barrier(3, timeout=10)

        def refresh() -> int:
            database = TrackerDatabase(self.db.db_path, perform_maintenance=False)
            try:
                database.connect()
                ready.wait()  # Both independent jobs hold the same precomputed stale-nine batch.
                return database.save_classifications(records)
            finally:
                database.close()

        with ThreadPoolExecutor(max_workers=2) as workers:
            jobs = [workers.submit(refresh) for _ in range(2)]
            ready.wait()
            saved = sorted(job.result(timeout=15) for job in jobs)
        self.assertEqual(saved, [0, 9])
        with self.db.connect() as conn:
            self.assertEqual(conn.execute("SELECT seq FROM sync_counter WHERE id = 1").fetchone()[0] - before, 9)
            rows = conn.execute("SELECT * FROM activity_classifications ORDER BY segment_id").fetchall()
        self.assertEqual(len(rows), 9)
        self.assertTrue(all(row["stale"] == 0 and row["taxonomy_version"] == "builtin-heuristics-v3" for row in rows))
        self.assertEqual(self.db.save_classifications(records), 0)

    def test_builtin_timestamp_only_retries_preserve_first_times_and_sync_sequence(self) -> None:
        for source in ("app-db", "domain-db", "youtube"):
            with self.subTest(source=source):
                record = self.builtin_record(source)
                with patch("app.storage.db.datetime") as clock:
                    clock.now.return_value = datetime.fromisoformat("2026-04-06T10:00:01+00:00")
                    self.assertEqual(self.db.save_classifications([record]), 1)
                before = self.stored_state()
                with patch("app.storage.db.datetime") as clock:
                    clock.now.return_value = datetime.fromisoformat("2026-04-06T12:00:01+00:00")
                    self.assertEqual(self.db.save_classifications([
                        {**record, "classifiedAt": "2026-04-06T12:00:00+00:00"},
                    ]), 0)
                self.assertEqual(self.stored_state(), before)

    def test_changed_builtin_answers_and_metadata_are_saved(self) -> None:
        record = self.builtin_record()
        self.assertEqual(self.db.save_classifications([record]), 1)
        changes = {
            "category": "learning", "productivity": "focus", "source": "domain-db",
            "confidence": 0.8, "reason": "New evidence", "model": "metadata-model",
            "promptVersion": "prompt-v2", "taxonomyVersion": "builtin-heuristics-v4",
            "inputFingerprint": "builtin:changed-input", "requestId": "new-request",
            "latencyMs": 0, "aiResult": True, "stale": True,
        }
        for field, value in changes.items():
            with self.subTest(field=field):
                before = self.stored_state()
                changed = {**record, field: value}
                self.assertEqual(self.db.save_classifications([changed]), 1)
                after = self.stored_state()
                self.assertEqual(after["counter"], before["counter"] + 1)
                self.assertGreater(after["seq"], before["seq"])
                if field not in ("aiResult", "stale"):
                    # Non-null metadata compares by value too; it does not disable idempotency.
                    self.assertEqual(self.db.save_classifications([changed]), 0)
                    self.assertEqual(self.stored_state(), after)
                self.assertEqual(self.db.save_classifications([record]), 1)

    def test_extended_segment_with_a_new_builtin_input_fingerprint_is_saved(self) -> None:
        record = self.builtin_record()
        self.db.save_classifications([record])
        with self.db.connect() as conn:
            conn.execute("UPDATE activity_segments SET ended_at = ?, duration_seconds = 240 WHERE id = ?",
                         ("2026-04-06T09:04:00Z", self.sid))
        before = self.stored_state()
        extended = {**record, "inputFingerprint": f"builtin:builtin-heuristics-v3:{self.sid}:09:00:09:04"}
        self.assertEqual(self.db.save_classifications([extended]), 1)
        after = self.stored_state()
        self.assertEqual(after["counter"], before["counter"] + 1)
        self.assertNotEqual(after["classification"]["input_fingerprint"], before["classification"]["input_fingerprint"])
        self.assertEqual(self.db.save_classifications([extended]), 0)

    def test_null_and_empty_builtin_metadata_are_distinct_answers(self) -> None:
        record = self.builtin_record()
        self.db.save_classifications([record])
        for field in ("reason", "model", "promptVersion", "requestId"):
            with self.subTest(field=field):
                empty = {**record, field: ""}
                self.assertEqual(self.db.save_classifications([empty]), 1)
                self.assertEqual(self.db.save_classifications([empty]), 0)
                self.assertEqual(self.db.save_classifications([record]), 1)

    def test_identical_unqualified_or_non_builtin_attempts_keep_existing_write_behavior(self) -> None:
        records = [self.builtin_record(taxonomyVersion=None), self.builtin_record(taxonomyVersion=""),
                   self.builtin_record(stale=True), self.builtin_record(aiResult=True)]
        records.extend(self.builtin_record(source) for source in
                       ("manual", "llm", "rule", "ai_review", "fallback", "system", "unknown"))
        for record in records:
            with self.subTest(source=record["source"], taxonomy=record["taxonomyVersion"],
                              stale=record["stale"], ai=record["aiResult"]):
                with self.db.connect() as conn:
                    conn.execute("DELETE FROM activity_classifications WHERE segment_id = ?", (self.sid,))
                self.assertEqual(self.db.save_classifications([record]), 1)
                before = self.stored_state()
                self.assertEqual(self.db.save_classifications([record]), 1)
                self.assertEqual(self.stored_state()["counter"], before["counter"] + 1)

    def test_identical_builtin_claims_still_clear_existing_provenance(self) -> None:
        record = self.builtin_record()
        self.db.save_classifications([record])
        for provenance in ("sync", "legacy", "local-protected"):
            with self.subTest(provenance=provenance):
                with self.db.connect() as conn:
                    conn.execute("INSERT INTO sync_classification_provenance(segment_id, provenance) VALUES (?, ?)",
                                 (self.sid, provenance))
                before = self.stored_state()
                self.assertEqual(self.db.save_classifications([record]), 1)
                after = self.stored_state()
                self.assertEqual(after["counter"], before["counter"] + 1)
                self.assertEqual(after["provenance"], [])
                self.assertEqual(self.db.save_classifications([record]), 0)
                self.assertEqual(self.stored_state(), after)

    def test_identical_builtin_after_an_actual_sync_receipt_clears_ownership_once(self) -> None:
        uid = "80000000-0000-0000-0000-000000000001"
        remote = {
            "segmentUid": uid, "originDeviceId": "80000000-0000-0000-0000-000000000002",
            "startedAt": "2026-04-06T09:00:00Z", "endedAt": "2026-04-06T09:03:00Z",
            "durationSeconds": 180, "appName": "Code", "platform": "windows",
            "classification": {"source": "app-db", "category": "workspace", "productivity": "focus",
                               "confidence": 0.9, "classifiedAt": "2026-04-06T10:00:00+00:00"},
        }
        self.db.apply_synced_segments([remote])
        self.sid = self.db.connect().execute(
            "SELECT id FROM activity_segments WHERE segment_uid = ?", (uid,),
        ).fetchone()[0]
        record = self.builtin_record(category="workspace", productivity="focus", confidence=0.9,
                                     inputFingerprint=f"sync:{uid}")
        self.assertEqual(self.db.save_classifications([record]), 1)
        # A subsequent receipt retains the existing taxonomy but restores sync ownership.
        self.db.apply_synced_segments([remote])
        before = self.stored_state()
        self.assertEqual(before["classification"]["taxonomy_version"], record["taxonomyVersion"])
        self.assertEqual(before["provenance"][0]["provenance"], "sync")
        self.assertEqual(self.db.save_classifications([record]), 1)
        after = self.stored_state()
        self.assertEqual(after["counter"], before["counter"] + 1)
        self.assertEqual(after["provenance"], [])
        self.assertEqual(self.db.save_classifications([record]), 0)
        self.assertEqual(self.stored_state(), after)

    def test_late_automatic_results_preserve_materialized_user_rules(self) -> None:
        rule = self.rule()
        before = self.current()
        for source in ["llm", "fallback", "system", "unknown", "app-db", "domain-db", "youtube", "ai_review", "rule"]:
            with self.subTest(source=source):
                self.assertEqual(self.db.save_classifications([self.record(source)]), 0)
                self.assertEqual(self.current(), before)
                self.assertEqual(self.current()["classificationRuleId"], rule["id"])

    def test_late_result_cannot_restore_a_disabled_rule(self) -> None:
        rule = self.rule()
        self.db.save_classification_rule({**rule, "enabled": False})
        self.assertIsNone(self.current())
        self.assertEqual(self.db.save_classifications([self.record("rule", classificationRuleId=rule["id"])]), 0)
        self.assertIsNone(self.current())

    def test_manual_override_and_active_rule_updates_still_work(self) -> None:
        rule = self.rule()
        self.db.save_classification_rule({**rule, "category": "learning"})
        self.assertEqual(self.db.apply_classification_rules()["appliedCount"], 1)
        self.assertEqual(self.current()["category"], "learning")
        self.assertEqual(self.db.save_classifications([self.record("manual")]), 1)
        self.assertEqual(self.current()["source"], "manual")
        self.assertIsNone(self.current()["classificationRuleId"])
        self.assertEqual(self.db.apply_classification_rules()["appliedCount"], 0)

    def test_unlinked_legacy_rule_labels_are_not_treated_as_user_rules(self) -> None:
        self.db.save_classifications([self.record("rule", category="workspace", productivity="focus")])
        self.assertEqual(self.db.save_classifications([self.record()]), 1)
        self.assertEqual(self.current()["source"], "llm")

    def test_review_records_actual_previous_values_and_supports_revert(self) -> None:
        self.db.save_classifications([self.record(category="workspace", productivity="focus")])
        pid = self.pass_id()
        self.assertEqual(self.db.save_classifications([self.record("ai_review", reviewPassId=pid)]), 1)
        event = self.db.get_ai_review_events()[0]
        self.assertEqual((event["prevCategory"], event["prevProductivity"], event["prevSource"]),
                         ("workspace", "focus", "llm"))
        self.assertEqual((event["newCategory"], event["newProductivity"]), ("entertainment", "drift"))
        self.assertEqual(self.db.get_project_pass_runs()[0]["correctionsCount"], 1)
        self.assertEqual(self.db.revert_ai_review_event(event["id"]), {"reverted": True, "restored": True})
        self.assertEqual(self.current()["category"], "workspace")

    def test_review_revert_restores_the_complete_prior_classification(self) -> None:
        original = self.record(
            category="workspace",
            productivity="focus",
            confidence=0.61,
            reason="Original LLM reason",
            model="synthetic-model",
            promptVersion="prompt-v7",
            taxonomyVersion="taxonomy-v4",
            requestId="request-original",
            latencyMs=654,
            classifiedAt="2026-04-06T08:00:00Z",
            aiResult=True,
            stale=False,
        )
        self.db.save_classifications([original])
        with self.db.connect() as conn:
            before = dict(conn.execute(
                "SELECT * FROM activity_classifications WHERE segment_id = ?", (self.sid,)
            ).fetchone())

        pid = self.pass_id()
        self.db.save_classifications([self.record(
            "ai_review", reviewPassId=pid, reason="Review reason", model=None,
            promptVersion=None, taxonomyVersion=None, requestId=None, latencyMs=None,
            aiResult=False,
        )])
        event = self.db.get_ai_review_events()[0]
        self.assertEqual(
            set(event),
            {"id", "segmentId", "passId", "prevCategory", "prevProductivity", "prevSource",
             "newCategory", "newProductivity", "confidence", "reason", "createdAt", "revertedAt"},
        )

        traced: list[str] = []
        self.db.connect().set_trace_callback(traced.append)
        try:
            self.assertEqual(
                self.db.revert_ai_review_event(event["id"]),
                {"reverted": True, "restored": True},
            )
        finally:
            self.db.connect().set_trace_callback(None)
        with self.db.connect() as conn:
            after = dict(conn.execute(
                "SELECT * FROM activity_classifications WHERE segment_id = ?", (self.sid,)
            ).fetchone())
        self.assertEqual(after, before)
        self.assertEqual(next(statement for statement in traced if statement.startswith("BEGIN")), "BEGIN IMMEDIATE")
        self.assertEqual(self.db.get_reusable_ai_classifications(["qa-late"])["qa-late"]["model"],
                         "synthetic-model")
        self.assertEqual(self.db.refresh_non_ai_classifications(), 0)
        self.assertIsNotNone(self.current())

    def test_latest_then_earlier_revert_restores_the_original_classification(self) -> None:
        self.db.save_classifications([self.record(
            category="workspace", productivity="focus", confidence=0.61,
            reason="Original AI reason", model="original-model", aiResult=True,
        )])
        original = self.current()
        self.db.save_classifications([self.record(
            "ai_review", reviewPassId=self.pass_id(),
            category="communication", productivity="neutral",
        )])
        first = self.db.get_ai_review_events()[0]
        self.db.save_classifications([self.record("ai_review", reviewPassId=self.pass_id())])
        latest = self.db.get_ai_review_events()[0]
        self.assertEqual(self.db.revert_ai_review_event(latest["id"]),
                         {"reverted": True, "restored": True})
        self.assertEqual(self.current()["category"], "communication")
        self.assertEqual(self.db.revert_ai_review_event(first["id"]),
                         {"reverted": True, "restored": True})
        self.assertEqual(self.current(), original)

    def test_older_review_is_consumed_without_overwriting_newer_review(self) -> None:
        self.db.save_classifications([self.record(category="workspace", productivity="focus")])
        first_pass = self.pass_id()
        self.db.save_classifications([self.record(
            "ai_review", reviewPassId=first_pass,
            category="communication", productivity="neutral", reason="first review",
        )])
        older = self.db.get_ai_review_events()[0]

        second_pass = self.pass_id()
        self.db.save_classifications([self.record(
            "ai_review", reviewPassId=second_pass,
            category="learning", productivity="focus", reason="second review",
        )])
        newer = self.db.get_ai_review_events()[0]

        self.assertEqual(
            self.db.revert_ai_review_event(older["id"]),
            {"reverted": True, "restored": False},
        )
        self.assertEqual((self.current()["category"], self.current()["source"]),
                         ("learning", "ai_review"))
        events = {event["id"]: event for event in self.db.get_ai_review_events()}
        self.assertIsNotNone(events[older["id"]]["revertedAt"])
        self.assertIsNone(events[newer["id"]]["revertedAt"])

        self.assertEqual(
            self.db.revert_ai_review_event(newer["id"]),
            {"reverted": True, "restored": True},
        )
        self.assertEqual((self.current()["category"], self.current()["productivity"]),
                         ("communication", "neutral"))
        self.assertEqual(self.db.revert_ai_review_event(newer["id"]),
                         {"reverted": False, "restored": False})

    def test_revert_rejects_same_label_ai_review_that_does_not_own_current_row(self) -> None:
        self.db.save_classifications([self.record(category="workspace", productivity="focus")])
        pid = self.pass_id()
        review = self.record("ai_review", reviewPassId=pid, reason="accepted review")
        self.db.save_classifications([review])
        event = self.db.get_ai_review_events()[0]

        # A later legacy writer can reproduce the same labels without creating
        # an accepted event. Exact applied-state comparison still detects it.
        self.db.save_classifications([self.record("ai_review", reason="later same-label write")])
        self.assertEqual(
            self.db.revert_ai_review_event(event["id"]),
            {"reverted": True, "restored": False},
        )
        self.assertEqual(self.current()["reason"], "later same-label write")

    def test_revert_rejects_accepted_ai_review_aba(self) -> None:
        self.db.save_classifications([self.record(category="workspace", productivity="focus")])
        first_pass = self.pass_id()
        self.db.save_classifications([self.record(
            "ai_review", reviewPassId=first_pass,
            category="communication", productivity="neutral", reason="A to B",
        )])
        oldest = self.db.get_ai_review_events()[0]
        second_pass = self.pass_id()
        self.db.save_classifications([self.record(
            "ai_review", reviewPassId=second_pass,
            category="learning", productivity="focus", reason="B to C",
        )])
        third_pass = self.pass_id()
        self.db.save_classifications([self.record(
            "ai_review", reviewPassId=third_pass,
            category="communication", productivity="neutral", reason="C back to B",
        )])

        self.assertEqual((self.current()["category"], self.current()["productivity"]),
                         ("communication", "neutral"))
        self.assertEqual(
            self.db.revert_ai_review_event(oldest["id"]),
            {"reverted": True, "restored": False},
        )
        self.assertEqual(self.current()["reason"], "C back to B")

    def test_revert_preserves_a_later_active_rule_materialization(self) -> None:
        self.db.save_classifications([self.record(category="workspace", productivity="focus")])
        pid = self.pass_id()
        self.db.save_classifications([self.record("ai_review", reviewPassId=pid)])
        event = self.db.get_ai_review_events()[0]
        rule = self.db.save_classification_rule({
            "targetKind": "app", "targetValue": "Code",
            "category": "learning", "productivity": "focus",
        })
        self.db.save_classifications([self.record(
            "rule", classificationRuleId=rule["id"], category="learning", productivity="focus",
        )])

        self.assertEqual(
            self.db.revert_ai_review_event(event["id"]),
            {"reverted": True, "restored": False},
        )
        self.assertEqual((self.current()["source"], self.current()["classificationRuleId"]),
                         ("rule", rule["id"]))

    def test_rejected_review_creates_no_event_or_correction_count(self) -> None:
        self.rule()
        pid = self.pass_id()
        self.assertEqual(self.db.save_classifications([self.record("ai_review", reviewPassId=pid)]), 0)
        self.assertEqual(self.db.get_ai_review_events(), [])
        self.assertEqual(self.db.get_project_pass_runs()[0]["correctionsCount"], 0)
        self.db.save_classifications([self.record("manual", category="learning", productivity="focus")])
        self.assertEqual(self.db.save_classifications([self.record("ai_review", reviewPassId=pid)]), 0)
        self.assertEqual(self.db.get_ai_review_events(), [])
        self.assertEqual(self.current()["source"], "manual")

    def test_review_batch_skips_missing_pass_and_segment_without_losing_valid_rows(self) -> None:
        self.db.save_classifications([self.record(category="workspace", productivity="focus")])
        pid = self.pass_id()
        result = self.db.save_classifications([
            self.record("ai_review", reviewPassId=pid + 999),
            self.record("ai_review", reviewPassId=pid, segmentId=str(int(self.sid) + 999)),
            self.record("ai_review", reviewPassId=pid),
        ])
        self.assertEqual(result, 1)
        self.assertEqual(len(self.db.get_ai_review_events()), 1)

    def test_review_event_error_rolls_back_classification_and_count(self) -> None:
        self.db.save_classifications([self.record(category="workspace", productivity="focus")])
        before = self.current()
        pid = self.pass_id()
        with self.db.connect() as conn:
            conn.execute("CREATE TRIGGER qa_abort_review BEFORE INSERT ON ai_review_events "
                         "BEGIN SELECT RAISE(ABORT, 'qa review failure'); END")
        with self.assertRaisesRegex(sqlite3.IntegrityError, "qa review failure"):
            self.db.save_classifications([self.record("ai_review", reviewPassId=pid)])
        self.assertEqual(self.current(), before)
        self.assertEqual(self.db.get_ai_review_events(), [])
        self.assertEqual(self.db.get_project_pass_runs()[0]["correctionsCount"], 0)

    def test_replayed_identical_review_does_not_duplicate_history(self) -> None:
        self.db.save_classifications([self.record(category="workspace", productivity="focus")])
        pid = self.pass_id()
        review = self.record("ai_review", reviewPassId=pid)
        self.assertEqual(self.db.save_classifications([review]), 1)
        self.assertEqual(self.db.save_classifications([review]), 0)
        self.assertEqual(len(self.db.get_ai_review_events()), 1)
        self.assertEqual(self.db.get_project_pass_runs()[0]["correctionsCount"], 1)

    def test_review_after_an_explicit_revert_preserves_the_undo(self) -> None:
        self.db.save_classifications([self.record(category="workspace", productivity="focus")])
        first_pass = self.pass_id()
        self.db.save_classifications([self.record("ai_review", reviewPassId=first_pass)])
        event = self.db.get_ai_review_events()[0]
        self.db.revert_ai_review_event(event["id"])
        before = self.current()
        late_pass = self.pass_id()
        self.assertEqual(self.db.save_classifications([self.record("ai_review", reviewPassId=late_pass)]), 0)
        self.assertEqual(self.current(), before)
        self.assertEqual(len(self.db.get_ai_review_events()), 1)

    def test_review_does_not_recreate_a_removed_classification(self) -> None:
        self.db.save_classifications([self.record(category="workspace", productivity="focus")])
        pid = self.pass_id()
        self.db.delete_history_range(scopes={"aiClassifications": True})
        self.assertIsNone(self.current())
        self.assertEqual(self.db.save_classifications([self.record("ai_review", reviewPassId=pid)]), 0)
        self.assertIsNone(self.current())
        self.assertEqual(self.db.get_ai_review_events(), [])

    def test_json_command_dispatch_preserves_atomic_review_input(self) -> None:
        from app import main
        self.db.save_classifications([self.record(category="workspace", productivity="focus")])
        pid = self.pass_id()
        request = json.loads(json.dumps({"command": "save_classifications", "payload": {
            "classifications": [self.record("ai_review", reviewPassId=pid)],
        }}))
        with patch.object(main, "database", return_value=self.db):
            response = main._dispatch(request)
        self.assertEqual(response, {"ok": True, "data": {"saved": 1}, "error": None})
        self.assertEqual(self.db.get_ai_review_events()[0]["passId"], pid)
        self.assertEqual(self.db.get_project_pass_runs()[0]["correctionsCount"], 1)

    def test_legacy_review_write_without_pass_id_remains_supported(self) -> None:
        self.assertEqual(self.db.save_classifications([self.record("ai_review")]), 1)
        self.assertEqual(self.current()["source"], "ai_review")
        self.assertEqual(self.db.get_ai_review_events(), [])


if __name__ == "__main__":
    unittest.main()
