from __future__ import annotations

import json
import sqlite3
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from app import main
from app.storage.db import TrackerDatabase
from app.storage.screen_activity_deletions import collect_deletion_effects, current_deletion_effects
from app.tracker.capture_contract import Snapshot


class ScreenActivityDeletionTests(unittest.TestCase):
    def setUp(self):
        temp = TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.db = TrackerDatabase(Path(temp.name) / "tracker.sqlite3", perform_maintenance=False)
        self.addCleanup(self.db.close)
        self.database = patch("app.main.database", return_value=self.db)
        self.database.start()
        self.addCleanup(self.database.stop)

    def capture(self, at, name="Owned Editor"):
        self.db.record_snapshot(Snapshot(at, name, "owned." + name, "Owned QA", "qa"), 5)
        return str(self.db.connect().execute("SELECT MAX(id) FROM activity_segments").fetchone()[0])

    def request(self, command, payload, *, private=True):
        request = {"command": command, "payload": payload}
        if private:
            request["screenContextDeletionEffects"] = True
        return main._dispatch(request)

    def effects(self, response):
        self.assertTrue(response["ok"])
        return response["screenContextDeletionEffects"]

    def test_selected_ids_return_only_actual_transaction_deletions_and_normal_data_is_unchanged(self):
        first = self.capture("2026-10-20T10:00:00+00:00")
        keep = self.capture("2026-10-20T10:00:10+00:00", "Keep")
        self.db.connect().execute(f"""CREATE TRIGGER owned_ignore_delete BEFORE DELETE ON activity_segments
            WHEN OLD.id={int(keep)} BEGIN SELECT RAISE(IGNORE); END""")
        result = self.request("delete_activity_segments", {"ids": [first, keep, "999999"]})
        self.assertEqual(result["data"], {"deleted": 1})
        self.assertEqual(self.effects(result), {"version": 1, "recordIds": [first], "overflow": False})
        self.assertEqual(self.db.connect().execute("SELECT COUNT(*) FROM activity_segments").fetchone()[0], 1)
        self.assertIsNone(current_deletion_effects())
        ordinary = self.request("delete_activity_segments", {"ids": []}, private=False)
        self.assertEqual(ordinary, {"ok": True, "data": {"deleted": 0}, "error": None})

    def test_range_receipt_covers_whole_overlapping_rows_and_preserves_touching_row(self):
        touching = self.capture("2026-10-20T10:00:00+00:00", "Touching")
        selected = self.capture("2026-10-20T10:00:10+00:00")
        self.capture("2026-10-20T10:00:20+00:00")
        # Ordinary tracking coalesces one row [10:00:10,10:00:20]; evidence at
        # 10:00:12 is outside this request but belongs to the deleted row.
        result = self.request("delete_history_range", {
            "start": "2026-10-20T10:00:19.999999+00:00", "end": "2026-10-20T10:00:21+00:00",
            "scopes": {"activity": True}})
        self.assertEqual(result["data"]["activitySegments"], 1)
        self.assertEqual(self.effects(result)["recordIds"], [selected])
        self.assertEqual([str(r[0]) for r in self.db.connect().execute("SELECT id FROM activity_segments")], [touching])

    def test_dry_run_and_metadata_only_scopes_report_no_activity_effect(self):
        self.capture("2026-10-20T10:00:00+00:00")
        for payload in [{"scopes": {"activity": True}, "dryRun": True},
                        {"scopes": {"aiClassifications": True}}, {"scopes": {"youtubeMetadata": True}}]:
            with self.subTest(payload=payload):
                result = self.request("delete_history_range", payload)
                self.assertEqual(self.effects(result), {"version": 1, "recordIds": [], "overflow": False})
                self.assertEqual(self.db.connect().execute("SELECT COUNT(*) FROM activity_segments").fetchone()[0], 1)

    def test_app_history_and_nested_sync_uid_deletion_share_the_same_receipt(self):
        first = self.capture("2026-10-20T10:00:00+00:00")
        second = self.capture("2026-10-20T10:00:10+00:00", "Second")
        result = self.request("delete_excluded_app_history", {"name": "Owned Editor"})
        self.assertEqual(self.effects(result)["recordIds"], [first])
        uid = self.db.connect().execute("SELECT segment_uid FROM activity_segments WHERE id=?", (second,)).fetchone()[0]
        result = self.request("apply_synced_deletions", {"deletions": [{
            "deletionUid": "owned-screen-delete-receipt", "kind": "uids", "segmentUids": [uid]}]})
        self.assertEqual(result["data"]["applied"], 1)
        self.assertEqual(self.effects(result)["recordIds"], [second])

    def test_overflow_is_explicit_and_never_a_partial_success_list(self):
        ids = [self.capture(f"2026-10-20T10:00:{i * 10:02d}+00:00", str(i)) for i in range(3)]
        with patch("app.storage.screen_activity_deletions.MAX_DELETED_RECORD_IDS", 2):
            result = self.request("delete_activity_segments", {"ids": ids})
        self.assertEqual(result["data"], {"deleted": 3})
        self.assertEqual(self.effects(result), {"version": 1, "recordIds": [], "overflow": True})

    def test_context_does_not_leak_to_another_request_or_thread(self):
        with collect_deletion_effects() as outer:
            self.assertIs(current_deletion_effects(), outer)
            with ThreadPoolExecutor(max_workers=1) as pool:
                self.assertIsNone(pool.submit(current_deletion_effects).result(timeout=2))
            with collect_deletion_effects() as inner:
                self.assertIs(current_deletion_effects(), inner)
            self.assertIs(current_deletion_effects(), outer)
        self.assertIsNone(current_deletion_effects())

    def test_private_errors_never_report_or_echo_and_unsupported_commands_do_not_run(self):
        request = {"command": "delete_activity_segments", "payload": {"ids": []},
                   "screenContextDeletionEffects": True}
        with patch("app.main.capture_tracker_exception") as report, \
                patch("app.main._write_response_line") as output, \
                patch.dict(main.COMMANDS, {"delete_activity_segments": lambda _: (_ for _ in ()).throw(
                    sqlite3.OperationalError("owned private diagnostic"))}):
            main.handle_request(json.dumps(request))
            response = json.loads(output.call_args[0][0])
        report.assert_not_called()
        self.assertEqual(response["error"], "screen_activity_deletion_unavailable")
        self.assertIsNone(current_deletion_effects())
        with patch.dict(main.COMMANDS, {"get_status": lambda _: self.fail("unsupported handler ran")}):
            with self.assertRaisesRegex(ValueError, "invalid_screen_activity_deletion_request"):
                self.request("get_status", {})


if __name__ == "__main__":
    unittest.main()
