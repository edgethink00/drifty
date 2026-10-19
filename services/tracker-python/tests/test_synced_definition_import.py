"""Inbound definitions and their ACK share one SQLite transaction and CAS snapshot."""
from __future__ import annotations

import json
import sqlite3
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from app import main as tracker_main
from app.storage.db import TrackerDatabase


class SyncedDefinitionImportTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = Path(directory.name) / "tracker.sqlite3"
        self.db = TrackerDatabase(self.path, perform_maintenance=False)
        self.addCleanup(self.db.close)
        self.db.set_sync_state({"sync_account_id": "user-1"})

    def request(self, *, kind="project", key="p-1", value=None, expected=None, **overrides):
        return {"accountId": "user-1", "kind": kind, "key": key, "value": value,
                "updatedAt": "2026-10-20T00:00:00.000Z", "expected": expected, **overrides}

    def project(self, **overrides):
        return {"name": "Remote", "description": "Imported", "color": "#123456", "status": "active",
                "createdAt": "2026-01-02T03:04:05.000Z", "anchors": [
                    {"kind": "keyword", "value": "Remote", "source": "manual"},
                    {"kind": "domain", "value": "example.com", "source": "harvested"},
                ], **overrides}

    def rule(self, **overrides):
        return {"targetKind": "site", "targetValue": "www.Example.com", "category": "learning",
                "productivity": "focus", **overrides}

    def rule_key(self, value):
        return self.db._classification_rule_sync_key(self.db._classification_rule_identity(value["targetKind"], value))

    def seed_project(self):
        self.db.save_project({"id": "p-1", "name": "Local", "createdAt": "2025-01-01T00:00:00Z"})
        self.db.save_project_anchors("p-1", [{"kind": "app", "value": "Editor", "source": "manual"}])
        return self.db.get_projects()[0]

    def raw_ledger(self):
        return self.db.get_sync_state()["state"].get("sync_definition_ledger")

    def fail_ledger(self):
        with self.db.connect() as conn:
            conn.execute("""CREATE TRIGGER fail_import_ledger BEFORE INSERT ON tracker_meta
                WHEN NEW.key = 'sync_definition_ledger'
                BEGIN SELECT RAISE(ABORT, 'injected ledger failure'); END""")

    def test_project_header_anchor_replacement_and_ledger_commit_together(self):
        before = self.seed_project()
        old_ledger = {"projects": {"other": {"at": "old", "hash": "keep"}}, "rules": {}, "rulesNeedApply": True}
        self.db.set_sync_state({"sync_definition_ledger": json.dumps(old_ledger)})
        request = self.request(value=self.project(), expected=before)
        result = self.db.apply_synced_definition(request)
        self.assertTrue(result["applied"])
        self.assertEqual(result["value"], self.db.get_projects()[0])
        self.assertEqual(result["value"]["createdAt"], before["createdAt"])
        self.assertEqual(result["value"]["name"], "Remote")
        self.assertEqual(result["value"]["anchors"], request["value"]["anchors"])
        ledger = json.loads(result["ledger"])
        self.assertEqual(result["ledger"], self.raw_ledger())
        self.assertEqual(ledger["projects"]["other"], old_ledger["projects"]["other"])
        self.assertTrue(ledger["rulesNeedApply"])
        self.assertEqual(ledger["projects"]["p-1"], {"at": request["updatedAt"], "value": {
            **self.project(createdAt="2025-01-01T00:00:00.000Z"),
            "anchors": sorted(request["value"]["anchors"], key=lambda anchor: (anchor["kind"], anchor["value"])),
        }})

    def test_project_insert_uses_remote_created_at_and_has_no_ledger_hash(self):
        result = self.db.apply_synced_definition(self.request(value=self.project()))
        self.assertEqual(result["value"]["createdAt"], "2026-01-02T03:04:05+00:00")
        self.assertNotIn("hash", json.loads(result["ledger"])["projects"]["p-1"])

    def test_project_and_anchors_roll_back_if_ledger_write_fails(self):
        before = self.seed_project()
        self.fail_ledger()
        with self.assertRaisesRegex(sqlite3.IntegrityError, "injected ledger failure"):
            self.db.apply_synced_definition(self.request(value=self.project(), expected=before))
        self.assertEqual(self.db.get_projects(), [before])
        self.assertIsNone(self.raw_ledger())
        self.assertFalse(self.db.connect().in_transaction)

    def test_project_insertion_and_deletion_roll_back_with_ledger(self):
        self.fail_ledger()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.apply_synced_definition(self.request(value=self.project()))
        self.assertEqual(self.db.get_projects(), [])
        before = self.seed_project()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.apply_synced_definition(self.request(expected=before))
        self.assertEqual(self.db.get_projects(), [before])

    def test_project_delete_and_absent_delete_ack_are_atomic(self):
        before = self.seed_project()
        result = self.db.apply_synced_definition(self.request(expected=before))
        self.assertEqual(result["value"], None)
        self.assertEqual(self.db.get_projects(), [])
        self.assertEqual(json.loads(result["ledger"])["projects"]["p-1"]["value"], None)
        again = self.db.apply_synced_definition(self.request())
        self.assertTrue(again["applied"])

    def test_cas_compares_all_project_fields_including_anchors_and_timestamp(self):
        before = self.seed_project()
        fields = {"name": "edit", "description": "edit", "color": "#abcdef", "status": "archived",
                  "id": "other", "createdAt": "2025-02-01T00:00:00Z", "updatedAt": "2026-10-20T00:00:01Z",
                  "anchors": [{"kind": "app", "value": "Editor", "source": "harvested"}]}
        for field, changed in fields.items():
            with self.subTest(field=field):
                stale = {**before, field: changed}
                result = self.db.apply_synced_definition(self.request(value=self.project(), expected=stale))
                self.assertEqual(result, {"applied": False, "value": before,
                                         "ledger": '{"projects":{},"rules":{}}', "reason": "local_changed"})
                self.assertIsNone(self.raw_ledger())

    def test_anchor_only_ui_edit_is_not_acknowledged_or_overwritten(self):
        before = self.seed_project()
        self.db.save_project_anchors("p-1", [{"kind": "keyword", "value": "UI added", "source": "manual"}])
        current = self.db.get_projects()[0]
        self.assertEqual(before["updatedAt"], current["updatedAt"])
        result = self.db.apply_synced_definition(self.request(value=self.project(), expected=before))
        self.assertEqual(result["reason"], "local_changed")
        self.assertEqual(result["value"], current)
        self.assertEqual(self.db.get_projects()[0], current)
        self.assertIsNone(self.raw_ledger())

    def test_anchor_order_is_insignificant_but_expected_absence_is_not(self):
        before = self.seed_project()
        self.db.save_project_anchors("p-1", [{"kind": "keyword", "value": "Second", "source": "manual"}])
        before = self.db.get_projects()[0]
        before["anchors"].reverse()
        self.assertTrue(self.db.apply_synced_definition(self.request(value=self.project(), expected=before))["applied"])
        self.assertEqual(self.db.apply_synced_definition(self.request(value=self.project()))["reason"], "local_changed")

    def test_ui_deletion_and_revert_with_new_timestamp_cannot_be_acknowledged(self):
        before = self.seed_project()
        self.db.delete_project("p-1")
        result = self.db.apply_synced_definition(self.request(value=self.project(), expected=before))
        self.assertEqual(result["reason"], "local_changed")
        self.assertIsNone(result["value"])
        self.db.save_project({**before, "name": "temporary edit"})
        self.db.save_project(before)
        current = self.db.get_projects()[0]
        self.assertNotEqual(current["updatedAt"], before["updatedAt"])
        self.assertEqual(self.db.apply_synced_definition(self.request(value=self.project(), expected=before))["reason"], "local_changed")

    def test_rule_singleton_save_captures_canonical_ack_and_pending_flag(self):
        before = self.db.save_classification_rule(self.rule())
        value = self.rule(targetValue="https://example.com/path", productivity="neutral", enabled=False, confidence=0.5)
        result = self.db.apply_synced_definition(self.request(kind="rule", key=before["syncKey"], value=value, expected=before))
        self.assertTrue(result["applied"])
        self.assertEqual(self.db.get_classification_rules(), [result["value"]])
        self.assertEqual(result["value"]["id"], before["id"])
        self.assertEqual(result["value"]["createdAt"], before["createdAt"])
        ledger = json.loads(result["ledger"])
        self.assertTrue(ledger["rulesNeedApply"])
        self.assertEqual(ledger["rules"][before["syncKey"]]["value"], {
            "targetKind": "site", "targetValue": "example.com", "matchScope": "surface",
            "detailKind": None, "detailValue": None, "category": "learning", "productivity": "neutral",
            "enabled": False, "confidence": 0.5,
        })

    def test_rule_insert_delete_and_pending_flag_roll_back_on_ledger_failure(self):
        before = self.db.save_classification_rule(self.rule())
        self.db.set_sync_state({"sync_definition_ledger": '{"projects":{},"rules":{},"rulesNeedApply":false}'})
        raw = self.raw_ledger()
        self.fail_ledger()
        other = self.rule(targetValue="other.example.com")
        for value, expected, key in ((self.rule(productivity="drift"), before, before["syncKey"]),
                                     (None, before, before["syncKey"]), (other, None, self.rule_key(other))):
            with self.subTest(value=value):
                with self.assertRaises(sqlite3.IntegrityError):
                    self.db.apply_synced_definition(self.request(kind="rule", key=key, value=value, expected=expected))
                self.assertEqual(self.db.get_classification_rules(), [before])
                self.assertEqual(self.raw_ledger(), raw)

    def test_rule_delete_and_pending_flag_commit_together(self):
        before = self.db.save_classification_rule(self.rule())
        result = self.db.apply_synced_definition(self.request(kind="rule", key=before["syncKey"], expected=before))
        self.assertEqual(self.db.get_classification_rules(), [])
        self.assertIsNone(result["value"])
        ledger = json.loads(result["ledger"])
        self.assertTrue(ledger["rulesNeedApply"])
        self.assertIsNone(ledger["rules"][before["syncKey"]]["value"])

    def test_rule_full_snapshot_cas_does_not_replace_a_ui_edit(self):
        before = self.db.save_classification_rule(self.rule())
        changed = self.db.save_classification_rule(self.rule(productivity="drift"))
        result = self.db.apply_synced_definition(self.request(kind="rule", key=before["syncKey"], value=self.rule(), expected=before))
        self.assertEqual(result["reason"], "local_changed")
        self.assertEqual(result["value"], changed)
        self.assertIsNone(self.raw_ledger())

    def test_rule_cas_compares_every_serialized_field(self):
        before = self.db.save_classification_rule(self.rule(confidence=0.8))
        changes = {"id": "other", "targetKind": "app", "targetValue": "other.example", "matchScope": "detail",
                   "detailKind": "siteTitle", "detailValue": "Edited", "category": "other", "productivity": "drift",
                   "enabled": False, "confidence": 0.7, "createdAt": "2025-01-01T00:00:00Z",
                   "updatedAt": "2026-10-20T00:00:00Z", "syncKey": "0" * 64}
        for field, value in changes.items():
            with self.subTest(field=field):
                result = self.db.apply_synced_definition(self.request(kind="rule", key=before["syncKey"], value=self.rule(), expected={**before, field: value}))
                self.assertEqual(result["reason"], "local_changed")
                self.assertEqual(result["value"], before)
                self.assertIsNone(self.raw_ledger())

    def test_account_mismatch_and_unbound_account_do_not_write(self):
        before = self.seed_project()
        raw = '{"projects":{},"rules":{}}'
        self.db.set_sync_state({"sync_definition_ledger": raw})
        for account in ("user-2", None):
            self.db.set_sync_state({"sync_account_id": account})
            result = self.db.apply_synced_definition(self.request(value=self.project(), expected=before))
            self.assertEqual(result, {"applied": False, "value": before, "ledger": raw, "reason": "account_changed"})
            self.assertEqual(self.db.get_projects(), [before])
            self.assertEqual(self.raw_ledger(), raw)

    def test_bad_inputs_fail_without_mutation(self):
        valid = self.request(value=self.project())
        bad = [None, {}, {**valid, "extra": True}, {**valid, "accountId": " "}, {**valid, "kind": "other"},
               {**valid, "key": "bad/key"}, {**valid, "key": "p" * 65}, {**valid, "updatedAt": "yesterday"},
               {**valid, "updatedAt": "2026-10-20T00:00:00"}, {**valid, "expected": {}}, {**valid, "value": []}]
        for value in ({"name": ""}, self.project(extra=True), self.project(status="other"), self.project(description=1),
                      self.project(createdAt="today"), self.project(anchors=[{"kind": "repo_path", "value": "x"}]),
                      self.project(anchors=[{"kind": "keyword", "value": "x", "source": "other"}]),
                      self.project(anchors=[{"kind": "keyword", "value": "x", "extra": True}]),
                      self.project(anchors=[{"kind": "keyword", "value": "x"}] * 2), self.project(description="x" * 16_384)):
            bad.append({**valid, "value": value})
        for request in bad:
            with self.subTest(request=request), self.assertRaises(ValueError):
                self.db.apply_synced_definition(request)
        self.assertEqual(self.db.get_projects(), [])
        self.assertIsNone(self.raw_ledger())

    def test_invalid_rule_identity_and_ranges_are_rejected_without_writing(self):
        value = self.rule()
        valid = self.request(kind="rule", key=self.rule_key(value), value=value)
        bad = [{**valid, "key": "0" * 64}, {**valid, "key": "A" * 64}]
        for invalid in (self.rule(targetValue=""), self.rule(enabled=1), self.rule(confidence=True), self.rule(confidence=-0.1),
                        self.rule(confidence=1.1), self.rule(confidence=float("nan")), self.rule(extra=True),
                        self.rule(matchScope="detail"), self.rule(detailKind="unknown"), self.rule(category="x" * 4096)):
            bad.append({**valid, "value": invalid})
        for request in bad:
            with self.subTest(request=request), self.assertRaises(ValueError):
                self.db.apply_synced_definition(request)
        self.assertEqual(self.db.get_classification_rules(), [])
        self.assertIsNone(self.raw_ledger())

    def test_malformed_existing_ledger_fails_before_mutation(self):
        before = self.seed_project()
        for raw in ("bad json", "[]", '{"projects":[]}'):
            self.db.set_sync_state({"sync_definition_ledger": raw})
            with self.assertRaisesRegex(ValueError, "invalid sync definition ledger"):
                self.db.apply_synced_definition(self.request(value=self.project(), expected=before))
            self.assertEqual(self.db.get_projects(), [before])
            self.assertEqual(self.raw_ledger(), raw)

    def peer(self):
        peer = TrackerDatabase(self.path, perform_maintenance=False)
        peer.close()  # Open the worker connection on its own thread.
        return peer

    def test_ui_write_winning_the_sqlite_lock_is_seen_by_cas(self):
        before = self.seed_project()
        peer = self.peer()
        attempted = threading.Event()
        def import_after_ui():
            try:
                attempted.set()
                return peer.apply_synced_definition(self.request(value=self.project(), expected=before))
            finally:
                peer.close()
        with ThreadPoolExecutor(max_workers=1) as executor:
            with self.db.connect() as conn:
                conn.execute("BEGIN IMMEDIATE")
                self.db.save_project({"id": "p-1", "name": "UI wins"}, _conn=conn)
                future = executor.submit(import_after_ui)
                self.assertTrue(attempted.wait(2))
                self.assertFalse(future.done())
            result = future.result(timeout=5)
        self.assertEqual(result["reason"], "local_changed")
        self.assertEqual(result["value"]["name"], "UI wins")
        self.assertEqual(self.db.get_projects()[0]["name"], "UI wins")
        self.assertIsNone(self.raw_ledger())

    def test_account_reset_winning_the_sqlite_lock_cancels_import(self):
        before = self.seed_project()
        peer = self.peer()
        attempted = threading.Event()
        def import_after_reset():
            try:
                attempted.set()
                return peer.apply_synced_definition(self.request(value=self.project(), expected=before))
            finally:
                peer.close()
        with ThreadPoolExecutor(max_workers=1) as executor:
            with self.db.connect() as conn:
                conn.execute("BEGIN IMMEDIATE")
                self.db.set_sync_state({"sync_account_id": "user-2", "sync_definition_ledger": None}, _conn=conn)
                future = executor.submit(import_after_reset)
                self.assertTrue(attempted.wait(2))
                self.assertFalse(future.done())
            result = future.result(timeout=5)
        self.assertEqual(result["reason"], "account_changed")
        self.assertEqual(result["value"], before)
        self.assertEqual(self.db.get_projects(), [before])
        self.assertIsNone(self.raw_ledger())

    def test_import_winning_lock_captures_ack_before_a_later_ui_write(self):
        before = self.seed_project()
        importer, editor = self.peer(), self.peer()
        reached_ledger, release_import, editor_started, editor_done = (threading.Event() for _ in range(4))
        original_set = importer.set_sync_state
        def blocked_ledger(entries, *, _conn=None):
            reached_ledger.set()
            if not release_import.wait(3):
                raise TimeoutError("test did not release import")
            return original_set(entries, _conn=_conn)
        def run_import():
            try:
                return importer.apply_synced_definition(self.request(value=self.project(), expected=before))
            finally:
                importer.close()
        def edit_after_import():
            try:
                editor_started.set()
                return editor.save_project({"id": "p-1", "name": "Later UI edit"})
            finally:
                editor.close()
                editor_done.set()
        with patch.object(importer, "set_sync_state", side_effect=blocked_ledger), ThreadPoolExecutor(max_workers=2) as executor:
            future = executor.submit(run_import)
            try:
                self.assertTrue(reached_ledger.wait(2))
                edit = executor.submit(edit_after_import)
                self.assertTrue(editor_started.wait(2))
                self.assertFalse(editor_done.wait(0.05))
                # Another connection cannot see the uncommitted header or anchors.
                self.assertEqual(self.db.get_projects(), [before])
            finally:
                release_import.set()
            result, edited = future.result(timeout=5), edit.result(timeout=5)
        self.assertTrue(result["applied"])
        self.assertEqual(result["value"]["name"], "Remote")
        self.assertEqual(json.loads(result["ledger"])["projects"]["p-1"]["value"]["name"], "Remote")
        self.assertEqual(edited["name"], "Later UI edit")
        self.assertEqual(self.db.get_projects()[0]["name"], "Later UI edit")

    def test_dispatcher_accepts_wrapped_and_direct_inputs_and_returns_validation_errors(self):
        with patch.object(tracker_main, "database", return_value=self.db):
            result = tracker_main._dispatch({"command": "apply_synced_definition", "payload": {"input": self.request(value=self.project())}})
            self.assertTrue(result["ok"])
            self.assertTrue(result["data"]["applied"])
            result = tracker_main._dispatch({"command": "apply_synced_definition", "payload": self.request(expected=result["data"]["value"])})
            self.assertTrue(result["data"]["applied"])
            bad = tracker_main._dispatch({"command": "apply_synced_definition", "payload": {"input": {}}})
            self.assertFalse(bad["ok"])


if __name__ == "__main__":
    unittest.main()
