"""Interrupted Codex turns survive append and re-ingestion of synthetic logs."""

from __future__ import annotations

import json
import os
import sys
import tempfile
import time
import unittest
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.storage.db import TrackerDatabase
from app import main as tracker_main
from app.tracker.dev_signals import ingest
from app.tracker.dev_signals.adapters import PROVIDERS
from app.tracker.dev_signals.agent_sessions import parse_codex_session
from app.tracker.dev_signals.git_commits import repo_key_for


class CodexInterruptedTurnTests(unittest.TestCase):
    def setUp(self) -> None:
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.path = self.root / "synthetic.jsonl"
        self.base = datetime(2026, 10, 4, 10, tzinfo=timezone.utc)

    def event(self, seconds: int, kind: str, **payload: object) -> dict:
        return {
            "timestamp": (self.base + timedelta(seconds=seconds)).isoformat(),
            "type": "event_msg",
            "payload": {"type": kind, **payload},
        }

    def write(self, records: list[dict], *, append: bool = False) -> None:
        with self.path.open("a" if append else "w", encoding="utf-8") as handle:
            for record in records:
                handle.write(json.dumps(record) + "\n")

    def context(self, seconds: int, name: str, **identity: object) -> dict:
        return {
            "timestamp": (self.base + timedelta(seconds=seconds)).isoformat(),
            "type": "turn_context",
            "payload": {"cwd": str(self.root / name), "model": name, **identity},
        }

    def test_next_context_preserves_previous_unfinished_evidence(self) -> None:
        for explicit_ids in (False, True):
            with self.subTest(explicit_ids=explicit_ids):
                first_id = {"turn_id": "first"} if explicit_ids else {}
                second_id = {"turn_id": "second"} if explicit_ids else {}
                self.write([
                    self.context(-1, "model-A", **first_id),
                    self.event(0, "task_started", **first_id),
                    self.event(30, "token_count", info={"total_token_usage": {"total_tokens": 100}}),
                ])
                original = parse_codex_session(self.path)[0]
                self.assertEqual(original.active_seconds, 30)
                self.write([self.context(599, "model-B", **second_id)], append=True)
                # A refresh while the next start is still being written must
                # not assign its context or idle gap to the unfinished task.
                self.assertEqual(parse_codex_session(self.path), [original])
                self.write([
                    self.event(600, "task_started", **second_id),
                    self.event(660, "task_complete", **second_id),
                ], append=True)
                turns = parse_codex_session(self.path)
                self.assertEqual(turns[0], original)
                self.assertEqual(turns[1].active_seconds, 60)
                self.assertEqual(turns[1].model, "model-B")
                self.assertNotEqual(turns[1].cwd_key, original.cwd_key)

    def test_context_within_a_completed_turn_preserves_existing_behavior(self) -> None:
        for identity in ({}, {"turn_id": "same"}):
            with self.subTest(identity=identity):
                self.write([
                    self.context(-1, "model-A", **identity),
                    self.event(0, "task_started", **identity),
                    self.context(30, "model-B", **identity),
                    self.event(180, "task_complete", **identity),
                ])
                turns = parse_codex_session(self.path)
                self.assertEqual(len(turns), 1)
                self.assertEqual(turns[0].active_seconds, 180)
                self.assertEqual(turns[0].model, "model-B")

    def test_legacy_context_followed_by_activity_still_updates_current_turn(self) -> None:
        self.write([
            self.context(-1, "model-A"),
            self.event(0, "task_started"),
            self.context(30, "model-B"),
            self.event(60, "agent_message"),
        ])
        turns = parse_codex_session(self.path)
        self.assertEqual(len(turns), 1)
        self.assertEqual(turns[0].active_seconds, 60)
        self.assertEqual(turns[0].model, "model-B")

    def test_next_identified_context_does_not_change_current_completion_or_abort(self) -> None:
        for terminal, expected_seconds in (("task_complete", 180), ("turn_aborted", 120)):
            with self.subTest(terminal=terminal):
                self.write([
                    self.context(-1, "model-A", turn_id="first"),
                    self.event(0, "task_started", turn_id="first"),
                    self.event(30, "agent_message"),
                    self.context(179, "model-B", turn_id="second"),
                    self.event(180, terminal, turn_id="first"),
                    self.event(600, "task_started", turn_id="second"),
                    self.event(660, "task_complete", turn_id="second"),
                ])
                turns = parse_codex_session(self.path)
                self.assertEqual([turn.active_seconds for turn in turns], [expected_seconds, 60])
                self.assertEqual([turn.model for turn in turns], ["model-A", "model-B"])
                self.assertEqual([turn.cwd_key for turn in turns], [
                    repo_key_for(self.root / "model-A"), repo_key_for(self.root / "model-B"),
                ])

    def test_next_start_preserves_capped_turn_and_cumulative_tokens(self) -> None:
        self.write([
            self.event(0, "task_started", turn_id="interrupted"),
            self.event(180, "token_count", info={"total_token_usage": {
                "total_tokens": 100, "input_tokens": 80, "output_tokens": 20,
            }}),
        ])
        original = parse_codex_session(self.path)[0]
        self.write([
            self.event(600, "task_started", turn_id="resumed"),
            self.event(620, "token_count", info={"total_token_usage": {
                "total_tokens": 150, "input_tokens": 110, "output_tokens": 40,
            }}),
            self.event(660, "task_complete", turn_id="resumed"),
        ], append=True)
        turns = parse_codex_session(self.path)
        self.assertEqual([turn.active_seconds for turn in turns], [120, 60])
        self.assertEqual(turns[0], original)
        self.assertEqual([turn.total_tokens for turn in turns], [100, 150])
        self.assertEqual([turn.tokens_in for turn in turns], [80, 110])
        self.assertEqual([turn.tokens_out for turn in turns], [20, 40])
        self.assertNotEqual(turns[0].turn_index, turns[1].turn_index)

    def test_later_start_is_not_activity_for_the_previous_turn(self) -> None:
        for observed in (0, 30):
            with self.subTest(observed=observed):
                self.write([
                    self.event(0, "task_started"),
                    self.event(observed, "agent_message"),
                ])
                original = parse_codex_session(self.path)[0]
                self.write([
                    self.event(600, "task_started"),
                    self.event(660, "task_complete"),
                ], append=True)
                turns = parse_codex_session(self.path)
                self.assertEqual([turn.active_seconds for turn in turns], [observed, 60])
                self.assertEqual(turns[0], original)

    def test_duplicate_start_does_not_restart_a_completed_turn(self) -> None:
        for identity, duplicate_at in (({}, 0), ({"turn_id": "same"}, 0), ({"turn_id": "same"}, 30)):
            with self.subTest(identity=identity, duplicate_at=duplicate_at):
                self.write([
                    self.event(0, "task_started", **identity),
                    self.event(15, "agent_message"),
                    self.event(duplicate_at, "task_started", **identity),
                    self.event(180, "task_complete", **identity),
                ])
                turns = parse_codex_session(self.path)
                self.assertEqual(len(turns), 1)
                self.assertEqual(turns[0].active_seconds, 180)

    def test_duplicate_start_does_not_extend_unfinished_activity(self) -> None:
        self.write([
            self.event(0, "task_started", turn_id="same"),
            self.event(15, "agent_message"),
        ])
        original = parse_codex_session(self.path)
        self.write([self.event(600, "task_started", turn_id="same")], append=True)
        self.assertEqual(parse_codex_session(self.path), original)

    def test_abort_closes_only_the_active_turn_at_the_existing_cap(self) -> None:
        # Codex TurnAbortedEvent permits a missing turn_id in older rollouts.
        for identity in ({}, {"turn_id": "first"}):
            for aborted_at in (30, 180):
                with self.subTest(identity=identity, aborted_at=aborted_at):
                    self.write([
                        self.event(0, "task_started", turn_id="first"),
                        self.event(aborted_at, "turn_aborted", reason="interrupted", **identity),
                        self.event(500, "agent_message"),
                        self.event(600, "task_started", turn_id="second"),
                        self.event(660, "task_complete", turn_id="second"),
                    ])
                    turns = parse_codex_session(self.path)
                    self.assertEqual([turn.active_seconds for turn in turns], [min(aborted_at, 120), 60])

    def test_abort_at_eof_ignores_later_non_turn_records(self) -> None:
        self.write([
            self.event(0, "task_started", turn_id="first"),
            self.event(30, "turn_aborted", turn_id="first", reason="interrupted"),
        ])
        original = parse_codex_session(self.path)
        self.assertEqual(original[0].active_seconds, 30)
        self.write([self.event(600, "agent_message")], append=True)
        self.assertEqual(parse_codex_session(self.path), original)

    def test_mismatched_abort_cannot_close_or_extend_another_turn(self) -> None:
        self.write([
            self.event(0, "task_started", turn_id="current"),
            self.event(15, "agent_message"),
            self.event(300, "turn_aborted", turn_id="previous", reason="interrupted"),
            self.event(600, "task_started", turn_id="next"),
            self.event(660, "task_complete", turn_id="next"),
        ])
        self.assertEqual([turn.active_seconds for turn in parse_codex_session(self.path)], [15, 60])

    def test_restart_ingestion_preserves_the_previously_stored_turn(self) -> None:
        self.write([
            self.context(-1, "model-A", turn_id="first"),
            self.event(0, "task_started", turn_id="first"),
            self.event(30, "agent_message"),
        ])
        modified = time.time() - 60
        os.utime(self.path, (modified, modified))
        adapter = replace(next(item for item in PROVIDERS if item.key == "codex"), discover=lambda: [self.path])
        db_path = self.root / "synthetic.sqlite3"

        def refresh():
            database = TrackerDatabase(db_path, perform_maintenance=False)
            try:
                with patch.object(ingest, "PROVIDERS", (adapter,)):
                    ingest.ingest_agent_sessions(database)
                return database.fetch_agent_session_events("2026-10-04T00:00:00Z", "2026-10-05T00:00:00Z")
            finally:
                database.close()

        original = refresh()
        self.assertEqual([row["activeSeconds"] for row in original], [30])
        self.write([
            self.context(599, "model-B", turn_id="second"),
            self.event(600, "task_started", turn_id="second"),
            self.event(660, "task_complete", turn_id="second"),
        ], append=True)
        os.utime(self.path, (modified + 1, modified + 1))
        recovered = refresh()
        self.assertEqual([row["activeSeconds"] for row in recovered], [30, 60])
        self.assertEqual(recovered[0], original[0])
        self.assertEqual(recovered[1]["model"], "model-B")
        self.assertEqual(refresh(), recovered)

    def test_initialized_checkpoint_does_not_replay_unchanged_logs_after_parser_upgrade(self) -> None:
        self.write([
            self.event(0, "task_started", turn_id="first"),
            self.event(30, "agent_message"),
            self.event(600, "task_started", turn_id="second"),
            self.event(660, "task_complete", turn_id="second"),
        ])
        now = time.time()
        os.utime(self.path, (now - 120, now - 120))
        adapter = replace(next(item for item in PROVIDERS if item.key == "codex"), discover=lambda: [self.path])
        db_path = self.root / "existing-checkpoint.sqlite3"
        checkpoint = json.dumps({"modified": now, "files": {}, "retry": [], "retryNext": True})
        database = TrackerDatabase(db_path, perform_maintenance=False)
        try:
            # An existing identity-v2 installation already ingested this log
            # with the old parser, which retained only the completed task.
            database.save_agent_session_events(ingest._turn_rows(adapter, self.path)[-1:])
            database.set_meta("dev_signals_identity_version_codex", "2")
            database.set_meta("dev_signals_watermark_codex", checkpoint)
        finally:
            database.close()

        for _ in range(2):
            database = TrackerDatabase(db_path, perform_maintenance=False)
            try:
                with patch.object(ingest, "PROVIDERS", (adapter,)), patch.object(
                    ingest, "_turn_rows", wraps=ingest._turn_rows,
                ) as parse:
                    tracker_main._maybe_ingest_dev_signals(database, 0, now_wall_seconds=now)
                    parse.assert_not_called()
                self.assertEqual(database.get_meta("dev_signals_watermark_codex"), checkpoint)
                rows = database.fetch_agent_session_events("2026-10-04T00:00:00Z", "2026-10-05T00:00:00Z")
                self.assertEqual([row["activeSeconds"] for row in rows], [60])
            finally:
                database.close()

        # Normal source updates still use the corrected parser. No historical
        # reset is needed to retain interrupted work when this session resumes.
        self.write([
            self.event(900, "task_started", turn_id="third"),
            self.event(930, "task_complete", turn_id="third"),
        ], append=True)
        os.utime(self.path, (now + 1, now + 1))
        database = TrackerDatabase(db_path, perform_maintenance=False)
        try:
            with patch.object(ingest, "PROVIDERS", (adapter,)):
                self.assertEqual(ingest.ingest_agent_sessions(database, max_files=1), (2, 1, 0))
                self.assertEqual(ingest.ingest_agent_sessions(database, max_files=1), (0, 0, 0))
            rows = database.fetch_agent_session_events("2026-10-04T00:00:00Z", "2026-10-05T00:00:00Z")
            self.assertEqual([row["activeSeconds"] for row in rows], [30, 60, 30])
        finally:
            database.close()

    def test_existing_retry_survives_upgrade_and_temporary_access_failure(self) -> None:
        paths = [self.root / "older.jsonl", self.root / "newer.jsonl"]
        modified = time.time() - 120
        for index, path in enumerate(paths):
            self.path = path
            self.write([
                self.event(0, "task_started", turn_id=path.stem),
                self.event(60, "task_complete", turn_id=path.stem),
            ])
            os.utime(path, (modified + index, modified + index))
        adapter = replace(next(item for item in PROVIDERS if item.key == "codex"), discover=lambda: [self.root])
        db_path = self.root / "retry-upgrade.sqlite3"
        real_open = Path.open

        def denied_open(path, *args, **kwargs):
            if path == paths[0]:
                raise PermissionError("synthetic initial read failure")
            return real_open(path, *args, **kwargs)

        database = TrackerDatabase(db_path, perform_maintenance=False)
        try:
            database.set_meta("dev_signals_identity_version_codex", "2")
            with patch.object(ingest, "PROVIDERS", (adapter,)), patch.object(Path, "open", denied_open):
                self.assertEqual(ingest.ingest_agent_sessions(database), (1, 2, 1))
            before = json.loads(database.get_meta("dev_signals_watermark_codex"))
            self.assertEqual(len(before["retry"]), 1)
        finally:
            database.close()

        real_state = ingest._session_file_state

        def denied_stat(path):
            if path == paths[0]:
                raise PermissionError("synthetic temporary metadata failure during upgrade")
            return real_state(path)

        database = TrackerDatabase(db_path, perform_maintenance=False)
        try:
            with patch.object(ingest, "PROVIDERS", (adapter,)), patch.object(ingest, "_session_file_state", denied_stat):
                self.assertEqual(ingest.ingest_agent_sessions(database, max_files=1), (0, 0, 0))
            after = json.loads(database.get_meta("dev_signals_watermark_codex"))
            self.assertEqual(after["retry"], before["retry"])
        finally:
            database.close()

        # Access returns after the newer file advanced the watermark. The
        # older retry must still be read once, even after another restart.
        database = TrackerDatabase(db_path, perform_maintenance=False)
        try:
            with patch.object(ingest, "PROVIDERS", (adapter,)):
                self.assertEqual(ingest.ingest_agent_sessions(database, max_files=1), (1, 1, 0))
                self.assertEqual(ingest.ingest_agent_sessions(database, max_files=1), (0, 0, 0))
            rows = database.fetch_agent_session_events("2026-10-04T00:00:00Z", "2026-10-05T00:00:00Z")
            self.assertEqual({row["sessionKey"] for row in rows}, {"older", "newer"})
            self.assertEqual(len(rows), 2)
        finally:
            database.close()

if __name__ == "__main__":
    unittest.main()
