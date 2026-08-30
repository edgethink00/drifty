"""Tests for dev-signals ingestion.

Agent log formats are unofficial and change without notice, so every parser test
runs against fixtures written here rather than against live session files.
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.storage.db import TrackerDatabase
from app.tracker.dev_signals.aggregation import (
    merge_spans,
    peak_concurrency,
    summarize_agent_time,
)
from app.tracker.dev_signals.adapters import (
    parse_amp_store,
    parse_aside_store,
    parse_cline_store,
    parse_copilot_store,
    parse_droid_store,
    parse_gemini_store,
    parse_goose_store,
    parse_hermes_store,
    parse_kimi_store,
    parse_openclaw_store,
    parse_opencode_store,
    parse_pi_store,
    parse_roo_store,
    parse_zed_store,
)
from app.tracker.dev_signals.agent_sessions import (
    UNTERMINATED_TURN_CAP_SECONDS,
    parse_claude_session,
    parse_codex_session,
    tokens_from_mapping,
)
from app.tracker.dev_signals.discovery import discover_repositories
from app.tracker.dev_signals.git_commits import (
    collect_commits,
    is_plausible_commit_time,
    repo_key_for,
    resolve_primary_repo,
)
from app.tracker.dev_signals.ingest import _candidate_files, discover_and_register_repos, ingest_agent_sessions, register_repo


def _git(repo: Path, *args: str) -> None:
    subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True)


def _git_init(repo: Path) -> None:
    _git(repo, "init", "-q", "-b", "main")
    _git(repo, "config", "user.email", "dev@example.com")
    _git(repo, "config", "user.name", "Dev")


class TempDirTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self._temp = tempfile.TemporaryDirectory()
        # macOS resolves /var to /private/var, and git reports the resolved
        # form, so compare against resolved paths throughout.
        self.tmp_path = Path(self._temp.name).resolve()
        self.addCleanup(self._temp.cleanup)


class GitRepoTestCase(TempDirTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.repo = self.tmp_path / "sample-repo"
        self.repo.mkdir()
        _git(self.repo, "init", "-q", "-b", "main")
        _git(self.repo, "config", "user.email", "dev@example.com")
        _git(self.repo, "config", "user.name", "Dev")
        (self.repo / "a.txt").write_text("one\ntwo\n", encoding="utf-8")
        _git(self.repo, "add", "a.txt")
        _git(self.repo, "commit", "-q", "-m", "first")
        # A linked worktree must be removed before the temp dir is cleaned up.
        self.addCleanup(lambda: _git_prune(self.repo))


def _git_prune(repo: Path) -> None:
    subprocess.run(
        ["git", "-C", str(repo), "worktree", "prune"],
        check=False,
        capture_output=True,
    )


class GitCommitTests(GitRepoTestCase):
    def test_collects_churn_without_reading_messages(self) -> None:
        events = collect_commits(self.repo)
        self.assertEqual(len(events), 1)
        event = events[0]
        self.assertEqual(event.insertions, 2)
        self.assertEqual(event.deletions, 0)
        self.assertEqual(event.files_changed, 1)
        # The dataclass has no field that could carry a commit message.
        self.assertFalse(hasattr(event, "subject"))
        self.assertFalse(hasattr(event, "message"))

    def test_missing_and_non_repository_paths_yield_nothing(self) -> None:
        self.assertEqual(collect_commits(self.tmp_path / "absent"), [])
        plain = self.tmp_path / "plain"
        plain.mkdir()
        self.assertEqual(collect_commits(plain), [])

    def test_author_filter_excludes_other_authors(self) -> None:
        self.assertTrue(collect_commits(self.repo, author_email="dev@example.com"))
        self.assertEqual(collect_commits(self.repo, author_email="someone@else.test"), [])

    def test_commits_on_unchecked_out_branches_are_included(self) -> None:
        """Work happens in task worktrees, so HEAD alone is not enough."""
        _git(self.repo, "checkout", "-q", "-b", "feature")
        (self.repo / "b.txt").write_text("x\n", encoding="utf-8")
        _git(self.repo, "add", "b.txt")
        _git(self.repo, "commit", "-q", "-m", "second")
        _git(self.repo, "checkout", "-q", "main")
        self.assertEqual(len(collect_commits(self.repo)), 2)

    def test_merge_commits_are_excluded(self) -> None:
        _git(self.repo, "checkout", "-q", "-b", "side")
        (self.repo / "c.txt").write_text("y\n", encoding="utf-8")
        _git(self.repo, "add", "c.txt")
        _git(self.repo, "commit", "-q", "-m", "side work")
        _git(self.repo, "checkout", "-q", "main")
        (self.repo / "d.txt").write_text("z\n", encoding="utf-8")
        _git(self.repo, "add", "d.txt")
        _git(self.repo, "commit", "-q", "-m", "main work")
        _git(self.repo, "merge", "--no-ff", "-q", "-m", "merge side", "side")
        shas = {event.commit_sha for event in collect_commits(self.repo)}
        self.assertEqual(len(shas), 3)

    def test_worktrees_resolve_to_one_repository_key(self) -> None:
        linked = self.tmp_path / "linked-worktree"
        _git(self.repo, "worktree", "add", "-q", "-b", "task", str(linked))
        self.assertEqual(
            repo_key_for(resolve_primary_repo(linked)),
            repo_key_for(resolve_primary_repo(self.repo)),
        )


class CodexSessionTests(TempDirTestCase):
    def _write(self, name: str, records: list[dict]) -> Path:
        path = self.tmp_path / name
        path.write_text(
            "\n".join(json.dumps(record) for record in records) + "\n",
            encoding="utf-8",
        )
        return path

    def test_turn_boundaries_and_token_totals(self) -> None:
        session = self._write(
            "rollout.jsonl",
            [
                {
                    "timestamp": "2026-08-21T10:00:00.000Z",
                    "type": "session_meta",
                    "payload": {"session_id": "abc", "cwd": str(self.tmp_path)},
                },
                {
                    "timestamp": "2026-08-21T10:00:01.000Z",
                    "type": "turn_context",
                    "payload": {"cwd": str(self.tmp_path), "model": "test-model"},
                },
                {
                    "timestamp": "2026-08-21T10:00:05.000Z",
                    "type": "event_msg",
                    "payload": {"type": "task_started"},
                },
                {
                    "timestamp": "2026-08-21T10:00:10.000Z",
                    "type": "event_msg",
                    "payload": {
                        "type": "token_count",
                        "info": {"total_token_usage": {
                            "total_tokens": 4242,
                            "input_tokens": 1000,
                            "output_tokens": 200,
                            "cached_input_tokens": 3000,
                            "cache_write_input_tokens": 42,
                        }},
                    },
                },
                {
                    "timestamp": "2026-08-21T10:05:05.000Z",
                    "type": "event_msg",
                    "payload": {"type": "task_complete"},
                },
            ],
        )
        turns = parse_codex_session(session)
        self.assertEqual(len(turns), 1)
        self.assertEqual(turns[0].active_seconds, 300)
        self.assertEqual(turns[0].session_key, "abc")
        self.assertEqual(turns[0].model, "test-model")
        self.assertEqual(turns[0].total_tokens, 4242)
        self.assertEqual(turns[0].tokens_in, 1000)
        self.assertEqual(turns[0].tokens_out, 200)
        self.assertEqual(turns[0].tokens_cache_read, 3000)
        self.assertEqual(turns[0].tokens_cache_write, 42)

    def test_unterminated_turn_is_capped(self) -> None:
        """A crashed session must not bill the gap until its last log line."""
        session = self._write(
            "crashed.jsonl",
            [
                {
                    "timestamp": "2026-08-21T10:00:00.000Z",
                    "type": "event_msg",
                    "payload": {"type": "task_started"},
                },
                {
                    "timestamp": "2026-08-21T14:00:00.000Z",
                    "type": "event_msg",
                    "payload": {"type": "agent_message"},
                },
            ],
        )
        turns = parse_codex_session(session)
        self.assertEqual(len(turns), 1)
        self.assertEqual(turns[0].active_seconds, UNTERMINATED_TURN_CAP_SECONDS)

    def test_malformed_lines_are_skipped(self) -> None:
        session = self.tmp_path / "broken.jsonl"
        session.write_text(
            "not json\n"
            + json.dumps(
                {
                    "timestamp": "2026-08-21T10:00:00.000Z",
                    "type": "event_msg",
                    "payload": {"type": "task_started"},
                }
            )
            + "\n[]\n"
            + json.dumps(
                {
                    "timestamp": "2026-08-21T10:01:00.000Z",
                    "type": "event_msg",
                    "payload": {"type": "task_complete"},
                }
            )
            + "\n",
            encoding="utf-8",
        )
        turns = parse_codex_session(session)
        self.assertEqual(len(turns), 1)
        self.assertEqual(turns[0].active_seconds, 60)

    def test_missing_file_returns_empty(self) -> None:
        self.assertEqual(parse_codex_session(self.tmp_path / "nope.jsonl"), [])

    def test_prompt_text_never_reaches_the_turn(self) -> None:
        secret = "launch-plan-for-unreleased-client"
        session = self._write(
            "secrets.jsonl",
            [
                {
                    "timestamp": "2026-08-21T10:00:00.000Z",
                    "type": "event_msg",
                    "payload": {"type": "task_started"},
                },
                {
                    "timestamp": "2026-08-21T10:00:30.000Z",
                    "type": "event_msg",
                    "payload": {"type": "user_message", "message": secret},
                },
                {
                    "timestamp": "2026-08-21T10:01:00.000Z",
                    "type": "event_msg",
                    "payload": {"type": "task_complete"},
                },
            ],
        )
        turns = parse_codex_session(session)
        self.assertNotIn(secret, json.dumps([turn.__dict__ for turn in turns]))


class ClaudeSessionTests(TempDirTestCase):
    def test_gap_splits_turns(self) -> None:
        session = self.tmp_path / "claude.jsonl"
        session.write_text(
            "\n".join(
                json.dumps(record)
                for record in [
                    {
                        "timestamp": "2026-08-21T10:00:00.000Z",
                        "sessionId": "s1",
                        "cwd": str(self.tmp_path),
                    },
                    {"timestamp": "2026-08-21T10:01:00.000Z", "sessionId": "s1"},
                    # 40 minutes later: a separate stretch of work.
                    {"timestamp": "2026-08-21T10:41:00.000Z", "sessionId": "s1"},
                    {"timestamp": "2026-08-21T10:43:00.000Z", "sessionId": "s1"},
                ]
            )
            + "\n",
            encoding="utf-8",
        )
        turns = parse_claude_session(session)
        self.assertEqual(len(turns), 2)
        self.assertEqual([turn.active_seconds for turn in turns], [60, 120])


class AggregationTests(unittest.TestCase):
    def _turn(self, start: str, end: str, seconds: int) -> dict:
        return {"startedAt": start, "endedAt": end, "activeSeconds": seconds}

    def test_overlapping_sessions_do_not_exceed_wall_clock(self) -> None:
        """Parallel agents made a real day report 33 hours before merging."""
        events = [
            self._turn("2026-08-21T10:00:00+00:00", "2026-08-21T11:00:00+00:00", 3600),
            self._turn("2026-08-21T10:30:00+00:00", "2026-08-21T11:30:00+00:00", 3600),
            self._turn("2026-08-21T10:45:00+00:00", "2026-08-21T11:15:00+00:00", 1800),
        ]
        summary = summarize_agent_time(events)
        self.assertEqual(summary.cumulative_seconds, 9000)
        self.assertEqual(summary.wall_clock_seconds, 5400)
        self.assertEqual(summary.concurrency_peak, 3)
        self.assertEqual(round(summary.parallel_factor, 2), 1.67)

    def test_disjoint_spans_stay_separate(self) -> None:
        events = [
            self._turn("2026-08-21T10:00:00+00:00", "2026-08-21T10:30:00+00:00", 1800),
            self._turn("2026-08-21T12:00:00+00:00", "2026-08-21T12:30:00+00:00", 1800),
        ]
        summary = summarize_agent_time(events)
        self.assertEqual(len(summary.spans), 2)
        self.assertEqual(summary.wall_clock_seconds, 3600)
        self.assertEqual(summary.concurrency_peak, 1)

    def test_touching_spans_are_not_concurrent(self) -> None:
        events = [
            self._turn("2026-08-21T10:00:00+00:00", "2026-08-21T10:30:00+00:00", 1800),
            self._turn("2026-08-21T10:30:00+00:00", "2026-08-21T11:00:00+00:00", 1800),
        ]
        summary = summarize_agent_time(events)
        self.assertEqual(summary.concurrency_peak, 1)
        self.assertEqual(summary.wall_clock_seconds, 3600)

    def test_invalid_input_is_ignored(self) -> None:
        self.assertEqual(summarize_agent_time([]).wall_clock_seconds, 0)
        self.assertEqual(merge_spans([{"startedAt": "bad", "endedAt": "bad"}]), [])
        self.assertEqual(peak_concurrency([{"startedAt": "x"}]), 0)
        backwards = [self._turn("2026-08-21T11:00:00+00:00", "2026-08-21T10:00:00+00:00", 0)]
        self.assertEqual(summarize_agent_time(backwards).wall_clock_seconds, 0)


class StorageTests(GitRepoTestCase):
    def _database(self) -> TrackerDatabase:
        return TrackerDatabase(self.tmp_path / "tracker.sqlite3")

    def test_dev_signal_writes_stay_out_of_the_sync_counter(self) -> None:
        """These tables are local-only and must never enter the sync stream."""
        database = self._database()
        register_repo(database, str(self.repo))
        database.save_dev_commit_events(
            [
                {
                    "repoKey": "k",
                    "commitSha": "abc123",
                    "authoredAt": "2026-08-21T10:00:00+00:00",
                    "insertions": 5,
                    "deletions": 1,
                    "filesChanged": 2,
                }
            ]
        )
        database.save_agent_session_events(
            [
                {
                    "provider": "codex",
                    "sessionKey": "s1",
                    "turnIndex": 0,
                    "startedAt": "2026-08-21T10:00:00+00:00",
                    "endedAt": "2026-08-21T10:05:00+00:00",
                    "activeSeconds": 300,
                    "cwdKey": "k",
                    "model": "m",
                    "totalTokens": 10,
                }
            ]
        )
        with database.connect() as conn:
            seq = conn.execute("SELECT seq FROM sync_counter WHERE id = 1").fetchone()[0]
        self.assertEqual(seq, 0)

    def test_reingestion_does_not_duplicate(self) -> None:
        database = self._database()
        payload = [
            {
                "repoKey": "k",
                "commitSha": "abc123",
                "authoredAt": "2026-08-21T10:00:00+00:00",
                "insertions": 5,
                "deletions": 1,
                "filesChanged": 2,
            }
        ]
        self.assertEqual(database.save_dev_commit_events(payload), 1)
        self.assertEqual(database.save_dev_commit_events(payload), 0)

    def test_agent_turn_updates_end_time(self) -> None:
        database = self._database()
        first = {
            "provider": "aside",
            "sessionKey": "s1",
            "turnIndex": 7,
            "startedAt": "2026-08-21T10:00:00+00:00",
            "endedAt": "2026-08-21T10:01:00+00:00",
            "activeSeconds": 60,
            "cwdKey": "k",
            "model": "m",
            "totalTokens": 10,
        }
        later = dict(first)
        later["endedAt"] = "2026-08-21T10:05:00+00:00"
        later["activeSeconds"] = 300
        later["totalTokens"] = 40
        self.assertEqual(database.save_agent_session_events([first]), 1)
        self.assertEqual(database.save_agent_session_events([later]), 0)
        rows = database.fetch_agent_session_events("2026-08-21T00:00:00+00:00", "2026-08-22T00:00:00+00:00")
        self.assertEqual(rows[0]["endedAt"], "2026-08-21T10:05:00+00:00")
        self.assertEqual(rows[0]["totalTokens"], 40)
        self.assertEqual(rows[0]["turnIndex"], 7)

    def test_range_queries_filter_by_time(self) -> None:
        database = self._database()
        database.save_dev_commit_events(
            [
                {
                    "repoKey": "k",
                    "commitSha": "in-range",
                    "authoredAt": "2026-08-21T10:00:00+00:00",
                    "insertions": 1,
                    "deletions": 0,
                    "filesChanged": 1,
                },
                {
                    "repoKey": "k",
                    "commitSha": "out-of-range",
                    "authoredAt": "2026-08-25T10:00:00+00:00",
                    "insertions": 1,
                    "deletions": 0,
                    "filesChanged": 1,
                },
            ]
        )
        found = database.fetch_dev_commit_events(
            "2026-08-21T00:00:00+00:00", "2026-08-22T00:00:00+00:00"
        )
        self.assertEqual([event["commitSha"] for event in found], ["in-range"])

    def test_registering_a_worktree_and_its_repo_creates_one_entry(self) -> None:
        database = self._database()
        linked = self.tmp_path / "task-worktree"
        _git(self.repo, "worktree", "add", "-q", "-b", "task", str(linked))
        register_repo(database, str(self.repo))
        register_repo(database, str(linked))
        self.assertEqual(len(database.list_dev_repos()), 1)

    def test_non_repository_registration_is_rejected(self) -> None:
        database = self._database()
        plain = self.tmp_path / "plain"
        plain.mkdir()
        self.assertIsNone(register_repo(database, str(plain)))
        self.assertEqual(database.list_dev_repos(), [])


class CommitTimestampTests(GitRepoTestCase):
    """Git timestamps are user-settable and a measurable fraction are wrong.

    arXiv:2209.04511 found ~50k commits predating CVS and >80k children older
    than their parent across 54M commits.
    """

    def test_prehistoric_timestamps_are_dropped(self) -> None:
        (self.repo / "old.txt").write_text("x\n", encoding="utf-8")
        _git(self.repo, "add", "old.txt")
        _git(
            self.repo,
            "commit",
            "-q",
            "-m",
            "impossible date",
            "--date=1980-01-01T00:00:00+00:00",
        )
        authored = {event.authored_at[:4] for event in collect_commits(self.repo)}
        self.assertNotIn("1980", authored)

    def test_future_timestamps_are_dropped(self) -> None:
        future = (datetime.now(timezone.utc) + timedelta(days=400)).isoformat()
        (self.repo / "future.txt").write_text("x\n", encoding="utf-8")
        _git(self.repo, "add", "future.txt")
        _git(self.repo, "commit", "-q", "-m", "future", "--date=" + future)
        self.assertEqual(len(collect_commits(self.repo)), 1)

    def test_plausible_boundaries(self) -> None:
        now = datetime(2026, 8, 22, tzinfo=timezone.utc)
        self.assertFalse(
            is_plausible_commit_time(datetime(1985, 1, 1, tzinfo=timezone.utc), now=now)
        )
        self.assertTrue(
            is_plausible_commit_time(datetime(2026, 8, 21, tzinfo=timezone.utc), now=now)
        )
        # A short skew ahead of the clock is tolerated; a long one is not.
        self.assertTrue(is_plausible_commit_time(now + timedelta(hours=2), now=now))
        self.assertFalse(is_plausible_commit_time(now + timedelta(days=3), now=now))


class DiscoveryTests(GitRepoTestCase):
    def test_finds_repositories_under_a_root(self) -> None:
        found = discover_repositories([str(self.tmp_path)])
        self.assertEqual([repo.repo_path for repo in found], [str(self.repo)])

    def test_linked_worktrees_do_not_appear_as_separate_repositories(self) -> None:
        """A `.git` file, not a directory, marks a linked worktree."""
        linked = self.tmp_path / "task-worktree"
        _git(self.repo, "worktree", "add", "-q", "-b", "task", str(linked))
        self.assertTrue((linked / ".git").is_file())
        found = discover_repositories([str(self.tmp_path)])
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0].worktree_count, 2)

    def test_pruned_directories_are_not_searched(self) -> None:
        buried = self.tmp_path / "node_modules" / "package"
        buried.mkdir(parents=True)
        _git_init(buried)
        found = discover_repositories([str(self.tmp_path)])
        self.assertEqual([repo.repo_path for repo in found], [str(self.repo)])

    def test_nested_paths_below_a_repository_are_not_rescanned(self) -> None:
        nested = self.repo / "sub" / "deep"
        nested.mkdir(parents=True)
        (nested / "file.txt").write_text("x\n", encoding="utf-8")
        found = discover_repositories([str(self.tmp_path)])
        self.assertEqual(len(found), 1)

    def test_remote_identity_is_owner_and_name(self) -> None:
        _git(self.repo, "remote", "add", "origin", "git@github.com:acme/widget.git")
        found = discover_repositories([str(self.tmp_path)])
        self.assertEqual(found[0].remote_identity, "acme/widget")

    def test_remote_credentials_are_not_retained(self) -> None:
        _git(
            self.repo,
            "remote",
            "add",
            "origin",
            "https://token123:x-oauth-basic@github.com/acme/widget.git",
        )
        found = discover_repositories([str(self.tmp_path)])
        self.assertEqual(found[0].remote_identity, "acme/widget")
        self.assertNotIn("token123", str(found[0]))

    def test_missing_root_is_ignored(self) -> None:
        self.assertEqual(discover_repositories([str(self.tmp_path / "absent")]), [])

    def test_depth_limit_stops_the_walk(self) -> None:
        deep = self.tmp_path / "a" / "b" / "c" / "d" / "e"
        deep.mkdir(parents=True)
        _git_init(deep)
        shallow = discover_repositories([str(self.tmp_path)], max_depth=2)
        self.assertEqual([repo.repo_path for repo in shallow], [str(self.repo)])


class AutoRegistrationTests(GitRepoTestCase):
    """Commit ingestion only visits registered repositories, so registration
    has to happen without the user doing it by hand."""

    def _database(self) -> TrackerDatabase:
        return TrackerDatabase(self.tmp_path / "tracker.sqlite3")

    def _discover(self, database, *, force: bool = False) -> int:
        # Point discovery at the temp dir instead of the real home directory.
        import app.tracker.dev_signals.ingest as ingest_module

        original = ingest_module.default_discovery_roots
        ingest_module.default_discovery_roots = lambda: [str(self.tmp_path)]
        try:
            return discover_and_register_repos(database, force=force)
        finally:
            ingest_module.default_discovery_roots = original

    def test_repositories_the_user_commits_to_are_registered(self) -> None:
        database = self._database()
        self.assertEqual(self._discover(database), 1)
        self.assertEqual(
            [repo["repo_path"] for repo in database.list_dev_repos()],
            [str(self.repo)],
        )

    def test_repositories_without_the_user_as_author_are_left_alone(self) -> None:
        """A clone of someone else's project is on disk but is not their work."""
        theirs = self.tmp_path / "someone-elses"
        theirs.mkdir()
        _git(theirs, "init", "-q", "-b", "main")
        _git(theirs, "config", "user.email", "nobody@example.com")
        _git(theirs, "config", "user.name", "Nobody")
        (theirs / "b.txt").write_text("x\n", encoding="utf-8")
        _git(theirs, "add", "b.txt")
        _git(theirs, "commit", "-q", "-m", "theirs")
        # Their commits are authored by someone else, so the identity check has
        # to reject the repository even though it sits under a scanned root.
        _git(theirs, "config", "user.email", "dev@example.com")

        database = self._database()
        self._discover(database)
        self.assertEqual(
            [repo["repo_path"] for repo in database.list_dev_repos()],
            [str(self.repo)],
        )

    def test_a_second_pass_skips_the_filesystem_walk(self) -> None:
        """Discovery is expensive, so it is watermarked rather than run on
        every refresh."""
        database = self._database()
        self.assertEqual(self._discover(database), 1)
        later = self.tmp_path / "added-later"
        later.mkdir()
        _git_init(later)
        self.assertEqual(self._discover(database), 0)
        self.assertEqual(len(database.list_dev_repos()), 1)




class AsideSessionTests(TempDirTestCase):
    def _write_state(self, secret: str = "aside-secret-should-not-leak") -> Path:
        import sqlite3
        db = self.tmp_path / "state.db"
        conn = sqlite3.connect(db)
        conn.executescript(
            """
            CREATE TABLE sessions (
              id TEXT PRIMARY KEY,
              cwd TEXT,
              model TEXT,
              title TEXT
            );
            CREATE TABLE session_runs (
              id INTEGER PRIMARY KEY,
              session_id TEXT,
              user_message TEXT,
              token_usage TEXT,
              started_at INTEGER,
              last_message_timestamp INTEGER,
              finished_at INTEGER,
              aborted_at INTEGER
            );
            """
        )
        conn.execute(
            "INSERT INTO sessions(id, cwd, model, title) VALUES (?, ?, ?, ?)",
            ("sess1", str(self.tmp_path), '{"provider":"openai-codex","modelId":"gpt-5.6-sol"}', secret),
        )
        conn.execute(
            "INSERT INTO session_runs(id, session_id, user_message, token_usage, started_at, last_message_timestamp, finished_at, aborted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                1,
                "sess1",
                secret,
                json.dumps({
                    "input": 10,
                    "output": 4,
                    "cacheRead": 20,
                    "cacheWrite": 0,
                    "totalTokens": 34,
                    "cost": {"total": 0.12},
                }),
                1_700_000_000,
                1_700_000_030,
                1_700_000_060,
                None,
            ),
        )
        conn.commit()
        conn.close()
        return db

    def test_reads_runs_without_titles_or_prompts(self) -> None:
        secret = "aside-secret-should-not-leak"
        turns = parse_aside_store(self._write_state(secret))
        self.assertEqual(len(turns), 1)
        self.assertEqual(turns[0].provider, "aside")
        self.assertEqual(turns[0].session_key, "sess1")
        self.assertEqual(turns[0].turn_index, 1)
        self.assertEqual(turns[0].active_seconds, 60)
        self.assertEqual(turns[0].model, "gpt-5.6-sol")
        self.assertEqual(turns[0].total_tokens, 34)
        self.assertEqual(turns[0].tokens_in, 10)
        self.assertEqual(turns[0].tokens_cache_read, 20)
        self.assertEqual(turns[0].cost_usd, 0.12)
        self.assertNotIn(secret, json.dumps([turn.__dict__ for turn in turns]))


    def test_zero_duration_runs_are_dropped(self) -> None:
        import sqlite3
        db = self.tmp_path / "zero.db"
        conn = sqlite3.connect(db)
        conn.executescript(
            """
            CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT, model TEXT, title TEXT);
            CREATE TABLE session_runs (
              id INTEGER PRIMARY KEY, session_id TEXT, user_message TEXT, token_usage TEXT,
              started_at INTEGER, last_message_timestamp INTEGER, finished_at INTEGER, aborted_at INTEGER
            );
            """
        )
        conn.execute("INSERT INTO sessions(id, cwd, model, title) VALUES ('z', NULL, NULL, 't')")
        conn.execute(
            "INSERT INTO session_runs(id, session_id, token_usage, started_at, last_message_timestamp, finished_at) VALUES (1, 'z', ?, 100, 100, 100)",
            (json.dumps({"totalTokens": 99}),),
        )
        conn.commit()
        conn.close()
        self.assertEqual(parse_aside_store(db), [])

    def test_missing_database_is_empty(self) -> None:
        self.assertEqual(parse_aside_store(self.tmp_path / "missing.db"), [])

    def test_unfinished_run_is_skipped(self) -> None:
        import sqlite3
        db = self.tmp_path / "open.db"
        conn = sqlite3.connect(db)
        conn.executescript(
            """
            CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT, model TEXT, title TEXT);
            CREATE TABLE session_runs (
              id INTEGER PRIMARY KEY, session_id TEXT, user_message TEXT, token_usage TEXT,
              started_at INTEGER, last_message_timestamp INTEGER, finished_at INTEGER, aborted_at INTEGER
            );
            """
        )
        conn.execute("INSERT INTO sessions(id, cwd, model, title) VALUES ('open', NULL, NULL, 'keep out')")
        conn.execute(
            "INSERT INTO session_runs(id, session_id, token_usage, started_at, last_message_timestamp, finished_at) VALUES (1, 'open', '{}', 100, 10000, NULL)"
        )
        conn.commit()
        conn.close()
        turns = parse_aside_store(db)
        self.assertEqual(turns, [])


class OpenCodeSessionTests(TempDirTestCase):
    def test_sqlite_assistant_rows(self) -> None:
        import sqlite3
        db = self.tmp_path / "opencode.db"
        conn = sqlite3.connect(db)
        conn.executescript(
            """
            CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, title TEXT);
            CREATE TABLE message (id TEXT, session_id TEXT, data TEXT);
            """
        )
        secret = "opencode-user-prompt-secret"
        conn.execute("INSERT INTO session(id, directory, title) VALUES ('s1', ?, ?)", (str(self.tmp_path), secret))
        conn.execute(
            "INSERT INTO message(id, session_id, data) VALUES ('m1', 's1', ?)",
            (json.dumps({
                "role": "assistant",
                "modelID": "gpt-5",
                "tokens": {"input": 8, "output": 2, "cache": {"read": 4, "write": 1}},
                "time": {"created": 1_700_000_000_000, "completed": 1_700_000_005_000},
                "cost": 0.01,
            }),),
        )
        conn.execute(
            "INSERT INTO message(id, session_id, data) VALUES ('m0', 's1', ?)",
            (json.dumps({"role": "user", "content": secret}),),
        )
        conn.commit()
        conn.close()
        turns = parse_opencode_store(db)
        self.assertEqual(len(turns), 1)
        self.assertEqual(turns[0].provider, "opencode")
        self.assertEqual(turns[0].active_seconds, 5)
        self.assertEqual(turns[0].tokens_in, 8)
        self.assertEqual(turns[0].tokens_cache_read, 4)
        self.assertNotIn(secret, json.dumps([turn.__dict__ for turn in turns]))


    def test_message_id_keeps_turn_index_stable(self) -> None:
        import sqlite3
        db = self.tmp_path / "stable.db"
        conn = sqlite3.connect(db)
        conn.executescript(
            """
            CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, title TEXT);
            CREATE TABLE message (id TEXT, session_id TEXT, data TEXT);
            """
        )
        payload = json.dumps({
            "role": "assistant",
            "modelID": "gpt-5",
            "tokens": {"input": 8, "output": 2, "cache": {"read": 0, "write": 0}},
            "time": {"created": 1_700_000_000_000, "completed": 1_700_000_005_000},
        })
        conn.execute("INSERT INTO session(id, directory, title) VALUES ('s1', ?, 't')", (str(self.tmp_path),))
        conn.execute("INSERT INTO message(id, session_id, data) VALUES ('m-keep', 's1', ?)", (payload,))
        conn.commit()
        first = parse_opencode_store(db)[0].turn_index
        conn.execute(
            "INSERT INTO message(id, session_id, data) VALUES ('m-new', 's1', ?)",
            (json.dumps({
                "role": "assistant",
                "modelID": "gpt-5",
                "tokens": {"input": 1, "output": 1, "cache": {"read": 0, "write": 0}},
                "time": {"created": 1_700_000_010_000, "completed": 1_700_000_012_000},
            }),),
        )
        conn.commit()
        conn.close()
        later = parse_opencode_store(db)
        keep = [turn for turn in later if turn.tokens_in == 8][0]
        self.assertEqual(keep.turn_index, first)
        self.assertEqual(len(later), 2)

    def test_legacy_json_file(self) -> None:
        secret = "legacy-opencode-secret"
        path = self.tmp_path / "msg.json"
        path.write_text(json.dumps({
            "role": "assistant",
            "sessionID": "legacy",
            "modelID": "local",
            "tokens": {"input": 1, "output": 1, "cache": {"read": 0, "write": 0}},
            "time": {"created": 1_700_000_000, "completed": 1_700_000_002},
            "content": secret,
        }), encoding="utf-8")
        turns = parse_opencode_store(path)
        self.assertEqual(len(turns), 1)
        self.assertEqual(turns[0].session_key, "legacy")
        self.assertNotIn(secret, json.dumps([turn.__dict__ for turn in turns]))

    def test_missing_store_is_empty(self) -> None:
        self.assertEqual(parse_opencode_store(self.tmp_path / "nope.db"), [])


class GeminiSessionTests(TempDirTestCase):
    def test_session_json(self) -> None:
        secret = "gemini-prompt-secret"
        path = self.tmp_path / "session-abc.json"
        path.write_text(json.dumps({
            "sessionId": "g1",
            "startTime": "2026-08-21T10:00:00Z",
            "lastUpdated": "2026-08-21T10:02:00Z",
            "messages": [
                {"id": "1", "type": "user", "timestamp": "2026-08-21T10:00:00Z", "content": secret},
                {"id": "2", "type": "gemini", "timestamp": "2026-08-21T10:02:00Z", "model": "gemini-2.5-pro",
                 "tokens": {"input": 11, "output": 3, "cached": 2}},
            ],
        }), encoding="utf-8")
        turns = parse_gemini_store(path)
        self.assertEqual(len(turns), 1)
        self.assertEqual(turns[0].provider, "gemini")
        self.assertEqual(turns[0].session_key, "g1")
        self.assertEqual(turns[0].active_seconds, 120)
        self.assertEqual(turns[0].model, "gemini-2.5-pro")
        self.assertEqual(turns[0].tokens_in, 11)
        self.assertNotIn(secret, json.dumps([turn.__dict__ for turn in turns]))

    def test_jsonl(self) -> None:
        path = self.tmp_path / "headless.jsonl"
        path.write_text(
            "\n".join(
                [
                    json.dumps({"sessionId": "g2", "timestamp": "2026-08-21T11:00:00Z", "type": "init"}),
                    json.dumps({"timestamp": "2026-08-21T11:01:00Z", "model": "gemini-flash", "tokens": {"promptTokenCount": 5, "candidatesTokenCount": 1}}),
                ]
            )
            + "\n",
            encoding="utf-8",
        )
        turns = parse_gemini_store(path)
        self.assertEqual(len(turns), 1)
        self.assertEqual(turns[0].session_key, "g2")
        self.assertEqual(turns[0].active_seconds, 60)
        self.assertEqual(turns[0].tokens_in, 5)

    def test_missing_file_is_empty(self) -> None:
        self.assertEqual(parse_gemini_store(self.tmp_path / "nope.json"), [])


class TokenMappingTests(unittest.TestCase):
    def test_zero_is_not_treated_as_missing(self) -> None:
        total, tokens_in, tokens_out, cache_read, cache_write, cost = tokens_from_mapping(
            {"input": 0, "output": 4, "cacheRead": 0, "cost": {"total": 0.0}}
        )
        self.assertEqual((total, tokens_in, tokens_out, cache_read, cache_write, cost), (4, 0, 4, 0, None, 0.0))



class HermesSessionTests(TempDirTestCase):
    def test_sessions_table_only(self) -> None:
        import sqlite3
        db = self.tmp_path / "state.db"
        conn = sqlite3.connect(db)
        conn.executescript(
            """
            CREATE TABLE sessions (
              id TEXT PRIMARY KEY,
              model TEXT,
              started_at REAL,
              ended_at REAL,
              cwd TEXT,
              input_tokens INTEGER,
              output_tokens INTEGER,
              cache_read_tokens INTEGER,
              cache_write_tokens INTEGER,
              reasoning_tokens INTEGER,
              estimated_cost_usd REAL,
              actual_cost_usd REAL,
              title TEXT
            );
            CREATE TABLE messages (id INTEGER, session_id TEXT, content TEXT);
            """
        )
        secret = "hermes-message-secret"
        conn.execute(
            "INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            ("h1", "combo/cron", 1_700_000_000, 1_700_000_040, str(self.tmp_path), 10, 2, 3, 0, 1, 0.2, 0.0, secret),
        )
        conn.execute("INSERT INTO messages VALUES (1, 'h1', ?)", (secret,))
        conn.commit()
        conn.close()
        turns = parse_hermes_store(db)
        self.assertEqual(len(turns), 1)
        self.assertEqual(turns[0].provider, "hermes")
        self.assertEqual(turns[0].active_seconds, 40)
        self.assertEqual(turns[0].tokens_in, 10)
        self.assertEqual(turns[0].tokens_out, 3)
        self.assertNotIn(secret, json.dumps([turn.__dict__ for turn in turns]))


    def test_zero_actual_cost_falls_back_to_estimate(self) -> None:
        import sqlite3
        db = self.tmp_path / "cost.db"
        conn = sqlite3.connect(db)
        conn.execute(
            """CREATE TABLE sessions (id TEXT PRIMARY KEY, model TEXT, started_at REAL, ended_at REAL, cwd TEXT, input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER, reasoning_tokens INTEGER, estimated_cost_usd REAL, actual_cost_usd REAL, title TEXT)"""
        )
        conn.execute(
            "INSERT INTO sessions VALUES ('h2', 'm', 100, 110, NULL, 1, 1, 0, 0, 0, 0.5, 0.0, 't')"
        )
        conn.commit()
        conn.close()
        turns = parse_hermes_store(db)
        self.assertEqual(turns[0].cost_usd, 0.5)


    def test_cron_sessions_are_skipped(self) -> None:
        import sqlite3
        db = self.tmp_path / "cron.db"
        conn = sqlite3.connect(db)
        conn.execute(
            """CREATE TABLE sessions (id TEXT PRIMARY KEY, model TEXT, started_at REAL, ended_at REAL, cwd TEXT, input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER, reasoning_tokens INTEGER, estimated_cost_usd REAL, actual_cost_usd REAL, title TEXT, source TEXT)"""
        )
        conn.execute("INSERT INTO sessions VALUES ('c1', 'm', 100, 140, NULL, 1, 1, 0, 0, 0, 0.1, 0.1, 't', 'cron')")
        conn.execute("INSERT INTO sessions VALUES ('h3', 'm', 100, 140, NULL, 1, 1, 0, 0, 0, 0.1, 0.1, 't', 'cli')")
        conn.commit()
        conn.close()
        turns = parse_hermes_store(db)
        self.assertEqual([turn.session_key for turn in turns], ['h3'])

    def test_open_sessions_are_skipped(self) -> None:
        import sqlite3
        db = self.tmp_path / "open-h.db"
        conn = sqlite3.connect(db)
        conn.execute(
            """CREATE TABLE sessions (id TEXT PRIMARY KEY, model TEXT, started_at REAL, ended_at REAL, cwd TEXT, input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER, reasoning_tokens INTEGER, estimated_cost_usd REAL, actual_cost_usd REAL, title TEXT)"""
        )
        conn.execute("INSERT INTO sessions VALUES ('open', 'm', 100, NULL, NULL, 1, 1, 0, 0, 0, 0.1, 0.1, 't')")
        conn.commit()
        conn.close()
        self.assertEqual(parse_hermes_store(db), [])

    def test_missing_is_empty(self) -> None:
        self.assertEqual(parse_hermes_store(self.tmp_path / "nope.db"), [])


class OpenClawSessionTests(TempDirTestCase):
    def test_timestamp_gap_and_optional_usage(self) -> None:
        secret = "openclaw-message-secret"
        path = self.tmp_path / "claw.jsonl"
        path.write_text(
            "\n".join([
                json.dumps({"type": "message", "timestamp": "2026-08-21T10:00:00Z", "cwd": str(self.tmp_path), "modelId": "claude-opus-4-5", "message": {"role": "user", "content": secret}}),
                json.dumps({"type": "message", "timestamp": "2026-08-21T10:01:00Z", "message": {"role": "assistant", "usage": {"input": 6, "output": 2}}}),
            ]) + "\n",
            encoding="utf-8",
        )
        turns = parse_openclaw_store(path)
        self.assertEqual(len(turns), 1)
        self.assertEqual(turns[0].provider, "openclaw")
        self.assertEqual(turns[0].active_seconds, 60)
        self.assertEqual(turns[0].tokens_in, 6)
        self.assertNotIn(secret, json.dumps([turn.__dict__ for turn in turns]))

    def test_missing_is_empty(self) -> None:
        self.assertEqual(parse_openclaw_store(self.tmp_path / "nope.jsonl"), [])


class ClaudeUsageTests(TempDirTestCase):
    def test_usage_is_captured_without_message_text(self) -> None:
        secret = "claude-usage-secret"
        path = self.tmp_path / "claude.jsonl"
        path.write_text(
            "\n".join([
                json.dumps({"timestamp": "2026-08-21T10:00:00.000Z", "sessionId": "s2", "cwd": str(self.tmp_path), "message": {"model": "claude-opus", "usage": {"input_tokens": 9, "output_tokens": 3, "cache_read_input_tokens": 1}}}),
                json.dumps({"timestamp": "2026-08-21T10:00:20.000Z", "sessionId": "s2", "message": {"content": secret}}),
            ]) + "\n",
            encoding="utf-8",
        )
        turns = parse_claude_session(path)
        self.assertEqual(len(turns), 1)
        self.assertEqual(turns[0].tokens_in, 9)
        self.assertEqual(turns[0].tokens_out, 3)
        self.assertEqual(turns[0].tokens_cache_read, 1)
        self.assertNotIn(secret, json.dumps([turn.__dict__ for turn in turns]))

    def test_usage_stays_on_the_last_turn(self) -> None:
        path = self.tmp_path / "claude-gap.jsonl"
        path.write_text(
            "\n".join([
                json.dumps({"timestamp": "2026-08-21T10:00:00.000Z", "sessionId": "s3", "cwd": str(self.tmp_path), "message": {"model": "claude-opus"}}),
                json.dumps({"timestamp": "2026-08-21T10:00:20.000Z", "sessionId": "s3"}),
                json.dumps({"timestamp": "2026-08-21T10:10:00.000Z", "sessionId": "s3", "message": {"usage": {"input_tokens": 9, "output_tokens": 3, "cache_read_input_tokens": 1}}}),
                json.dumps({"timestamp": "2026-08-21T10:10:20.000Z", "sessionId": "s3"}),
            ]) + "\n",
            encoding="utf-8",
        )
        turns = parse_claude_session(path)
        self.assertEqual(len(turns), 2)
        self.assertIsNone(turns[0].tokens_in)
        self.assertEqual(turns[1].tokens_in, 9)
        self.assertEqual(turns[1].tokens_out, 3)


class KimiSessionTests(TempDirTestCase):
    def test_wire_jsonl_usage_and_no_content(self) -> None:
        secret = "kimi-content-secret"
        path = self.tmp_path / "wire.jsonl"
        lines = [
            {"type": "TurnBegin", "timestamp": 1700000000.0, "message": {"type": "TurnBegin", "content": secret}},
            {"type": "StatusUpdate", "timestamp": 1700000060.0, "message": {"type": "StatusUpdate", "payload": {"token_usage": {"input_other": 5, "output": 2, "input_cache_read": 7, "input_cache_creation": 1}}}},
        ]
        path.write_text("\n".join(json.dumps(line) for line in lines) + "\n", encoding="utf-8")
        turns = parse_kimi_store(path)
        self.assertEqual(len(turns), 1)
        self.assertEqual(turns[0].provider, "kimi")
        self.assertEqual(turns[0].active_seconds, 60)
        self.assertEqual(turns[0].tokens_in, 5)
        self.assertEqual(turns[0].tokens_cache_read, 7)
        self.assertNotIn(secret, json.dumps([turn.__dict__ for turn in turns]))

    def test_missing_is_empty(self) -> None:
        self.assertEqual(parse_kimi_store(self.tmp_path / "nope.jsonl"), [])




class PiSessionTests(TempDirTestCase):
    def test_skips_title_and_drops_prompt(self) -> None:
        secret = "pi-prompt-secret"
        path = self.tmp_path / "pi.jsonl"
        path.write_text(
            "\n".join([
                json.dumps({"type": "title", "title": secret}),
                json.dumps({"type": "session", "id": "pi_ses_1", "timestamp": "2026-08-21T10:00:00Z", "cwd": str(self.tmp_path)}),
                json.dumps({"type": "message", "timestamp": "2026-08-21T10:01:00Z", "message": {"role": "user", "content": secret}}),
                json.dumps({"type": "message", "timestamp": "2026-08-21T10:02:00Z", "message": {"role": "assistant", "model": "claude-sonnet", "usage": {"input": 4, "output": 2, "cacheRead": 1, "cacheWrite": 0}}}),
            ]) + "\n",
            encoding="utf-8",
        )
        turns = parse_pi_store(path)
        self.assertEqual(len(turns), 1)
        self.assertEqual(turns[0].provider, "pi")
        self.assertEqual(turns[0].session_key, "pi_ses_1")
        self.assertEqual(turns[0].active_seconds, 120)
        self.assertEqual(turns[0].tokens_in, 4)
        self.assertNotIn(secret, json.dumps([turn.__dict__ for turn in turns]))

    def test_missing_is_empty(self) -> None:
        self.assertEqual(parse_pi_store(self.tmp_path / "nope.jsonl"), [])


class DroidSessionTests(TempDirTestCase):
    def test_settings_plus_jsonl_without_prompt(self) -> None:
        secret = "droid-user-secret"
        session_id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
        settings = self.tmp_path / f"{session_id}.settings.json"
        settings.write_text(json.dumps({
            "model": "custom:Claude-Opus-4.5-Thinking-[Anthropic]-0",
            "tokenUsage": {"inputTokens": 9, "outputTokens": 3, "cacheReadTokens": 2, "cacheCreationTokens": 1},
        }), encoding="utf-8")
        jsonl = self.tmp_path / f"{session_id}.jsonl"
        jsonl.write_text(
            "\n".join([
                json.dumps({"type": "message", "timestamp": "2026-08-21T10:00:00Z", "message": {"role": "user", "content": secret}}),
                json.dumps({"type": "message", "timestamp": "2026-08-21T10:01:00Z", "message": {"role": "assistant", "content": secret}}),
            ]) + "\n",
            encoding="utf-8",
        )
        turns = parse_droid_store(settings)
        self.assertEqual(len(turns), 1)
        self.assertEqual(turns[0].provider, "droid")
        self.assertEqual(turns[0].active_seconds, 60)
        self.assertEqual(turns[0].tokens_in, 9)
        self.assertEqual(turns[0].tokens_cache_read, 2)
        self.assertNotIn(secret, json.dumps([turn.__dict__ for turn in turns]))


    def test_settings_without_jsonl_is_capped(self) -> None:
        settings = self.tmp_path / "only.settings.json"
        settings.write_text(json.dumps({
            "model": "claude",
            "providerLockTimestamp": "2026-08-21T10:00:00Z",
            "tokenUsage": {"inputTokens": 4, "outputTokens": 1},
        }), encoding="utf-8")
        # Force a later mtime by rewriting after a sleep is unnecessary; parser
        # uses mtime only when lock/mtime differ. Cap still applies to long gaps.
        turns = parse_droid_store(settings)
        self.assertEqual(len(turns), 1)
        self.assertLessEqual(turns[0].active_seconds, 120)

    def test_missing_is_empty(self) -> None:
        self.assertEqual(parse_droid_store(self.tmp_path / "nope.settings.json"), [])


class AmpSessionTests(TempDirTestCase):
    def test_usage_ledger_without_message_bodies(self) -> None:
        secret = "amp-message-secret"
        path = self.tmp_path / "T-abc.json"
        path.write_text(json.dumps({
            "id": "T-abc",
            "created": 1_700_000_000_000,
            "messages": [{"role": "user", "content": secret}],
            "usageLedger": {"events": [{
                "timestamp": "2026-08-21T10:01:00Z",
                "model": "claude-sonnet",
                "credits": 0.2,
                "tokens": {"input": 8, "output": 2, "cacheReadInputTokens": 3, "cacheCreationInputTokens": 1},
            }]},
        }), encoding="utf-8")
        turns = parse_amp_store(path)
        self.assertEqual(len(turns), 1)
        self.assertEqual(turns[0].provider, "amp")
        self.assertEqual(turns[0].session_key, "T-abc")
        self.assertEqual(turns[0].tokens_in, 8)
        self.assertEqual(turns[0].cost_usd, 0.2)
        self.assertNotIn(secret, json.dumps([turn.__dict__ for turn in turns]))
        self.assertEqual(turns[0].active_seconds, 1)


    def test_idle_gap_is_not_billed(self) -> None:
        path = self.tmp_path / "T-gap.json"
        path.write_text(json.dumps({
            "id": "T-gap",
            "created": 1_700_000_000_000,
            "usageLedger": {"events": [
                {"timestamp": "2026-08-21T10:00:00Z", "tokens": {"input": 1, "output": 1}},
                {"timestamp": "2026-08-21T12:00:00Z", "tokens": {"input": 8, "output": 2}},
            ]},
        }), encoding="utf-8")
        turns = parse_amp_store(path)
        self.assertEqual(len(turns), 2)
        self.assertEqual([turn.active_seconds for turn in turns], [1, 1])
        self.assertEqual(turns[-1].tokens_in, 8)

    def test_missing_is_empty(self) -> None:
        self.assertEqual(parse_amp_store(self.tmp_path / "T-missing.json"), [])


class CopilotSessionTests(TempDirTestCase):
    def test_otel_attributes_without_prompt(self) -> None:
        secret = "copilot-prompt-secret"
        path = self.tmp_path / "otel.jsonl"
        path.write_text(
            json.dumps({
                "startTimeUnixNano": 1_700_000_000_000_000_000,
                "endTimeUnixNano": 1_700_000_030_000_000_000,
                "attributes": {
                    "gen_ai.usage.input_tokens": 6,
                    "gen_ai.usage.output_tokens": 2,
                    "gen_ai.request.model": "gpt-4.1",
                    "session.id": "copilot-1",
                    "prompt": secret,
                },
            }) + "\n",
            encoding="utf-8",
        )
        turns = parse_copilot_store(path)
        self.assertEqual(len(turns), 1)
        self.assertEqual(turns[0].provider, "copilot")
        self.assertEqual(turns[0].session_key, "copilot-1")
        self.assertEqual(turns[0].active_seconds, 30)
        self.assertEqual(turns[0].tokens_in, 6)
        self.assertEqual(turns[0].model, "gpt-4.1")
        self.assertNotIn(secret, json.dumps([turn.__dict__ for turn in turns]))


    def test_duration_nano_is_not_read_as_milliseconds(self) -> None:
        path = self.tmp_path / "nano.jsonl"
        path.write_text(
            json.dumps({
                "startTimeUnixNano": 1_700_000_000_000_000_000,
                "durationNano": 2_000_000_000,
                "attributes": {"gen_ai.usage.input_tokens": 3, "gen_ai.usage.output_tokens": 1, "session.id": "n1"},
            }) + "\n",
            encoding="utf-8",
        )
        turns = parse_copilot_store(path)
        self.assertEqual(len(turns), 1)
        self.assertEqual(turns[0].active_seconds, 2)

    def test_same_trace_is_counted_once(self) -> None:
        path = self.tmp_path / "dup.jsonl"
        lines = [
            json.dumps({
                "traceId": "abc",
                "startTimeUnixNano": 1_700_000_000_000_000_000,
                "endTimeUnixNano": 1_700_000_010_000_000_000,
                "attributes": {"gen_ai.usage.input_tokens": 4, "gen_ai.usage.output_tokens": 1, "session.id": "s"},
            }),
            json.dumps({
                "traceId": "abc",
                "startTimeUnixNano": 1_700_000_000_000_000_000,
                "endTimeUnixNano": 1_700_000_010_000_000_000,
                "attributes": {"gen_ai.usage.input_tokens": 4, "gen_ai.usage.output_tokens": 1, "session.id": "s"},
            }),
        ]
        path.write_text(chr(10).join(lines) + chr(10), encoding="utf-8")
        turns = parse_copilot_store(path)
        self.assertEqual(len(turns), 1)
        self.assertEqual(turns[0].active_seconds, 10)

    def test_records_without_attributes_are_skipped(self) -> None:
        path = self.tmp_path / "bare.jsonl"
        path.write_text(
            json.dumps({
                "timestamp": "2026-08-21T10:00:00Z",
                "gen_ai.usage.input_tokens": 9,
                "prompt": "should-not-matter",
            }) + "\n",
            encoding="utf-8",
        )
        self.assertEqual(parse_copilot_store(path), [])

    def test_missing_is_empty(self) -> None:
        self.assertEqual(parse_copilot_store(self.tmp_path / "nope.jsonl"), [])


class ClineRooSessionTests(TempDirTestCase):
    def test_ui_messages_api_req_without_prompt(self) -> None:
        secret = "cline-prompt-secret"
        task = self.tmp_path / "tasks" / "task-1"
        task.mkdir(parents=True)
        (task / "ui_messages.json").write_text(json.dumps([
            {"type": "say", "say": "text", "ts": "2026-08-21T10:00:00Z", "text": secret},
            {"type": "say", "say": "api_req_started", "ts": "2026-08-21T10:00:00Z",
             "text": json.dumps({"cost": 0.11, "tokensIn": 12, "tokensOut": 4, "cacheReads": 3, "cacheWrites": 1})},
            {"type": "say", "say": "text", "ts": "2026-08-21T10:00:20Z", "text": secret},
        ]), encoding="utf-8")
        turns = parse_cline_store(task / "ui_messages.json")
        self.assertEqual(len(turns), 1)
        self.assertEqual(turns[0].provider, "cline")
        self.assertEqual(turns[0].session_key, "task-1")
        self.assertEqual(turns[0].active_seconds, 20)
        self.assertEqual(turns[0].tokens_in, 12)
        self.assertEqual(turns[0].cost_usd, 0.11)
        self.assertNotIn(secret, json.dumps([turn.__dict__ for turn in turns]))
        roo = parse_roo_store(task / "ui_messages.json")
        self.assertEqual(roo[0].provider, "roo")


    def test_long_gap_is_not_billed_as_one_turn(self) -> None:
        task = self.tmp_path / "tasks" / "task-gap"
        task.mkdir(parents=True)
        (task / "ui_messages.json").write_text(json.dumps([
            {"type": "say", "say": "api_req_started", "ts": "2026-08-21T10:00:00Z",
             "text": json.dumps({"tokensIn": 2, "tokensOut": 1})},
            {"type": "say", "say": "text", "ts": "2026-08-21T12:00:00Z", "text": "later"},
        ]), encoding="utf-8")
        turns = parse_cline_store(task / "ui_messages.json")
        self.assertEqual(len(turns), 1)
        self.assertEqual(turns[0].active_seconds, 1)

    def test_missing_is_empty(self) -> None:
        self.assertEqual(parse_cline_store(self.tmp_path / "nope.json"), [])


class GooseSessionTests(TempDirTestCase):
    def test_sessions_table_without_messages(self) -> None:
        import sqlite3
        db = self.tmp_path / "sessions.db"
        conn = sqlite3.connect(db)
        conn.execute(
            """CREATE TABLE sessions (
              id TEXT PRIMARY KEY,
              model_config_json TEXT,
              provider_name TEXT,
              created_at TEXT,
              updated_at TEXT,
              total_tokens INTEGER,
              input_tokens INTEGER,
              output_tokens INTEGER,
              accumulated_total_tokens INTEGER,
              accumulated_input_tokens INTEGER,
              accumulated_output_tokens INTEGER,
              working_dir TEXT,
              title TEXT
            )"""
        )
        secret = "goose-title-secret"
        conn.execute(
            "INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            ("g1", json.dumps({"model_name": "claude-sonnet"}), "anthropic",
             "2026-08-21T10:00:00Z", "2026-08-21T10:02:00Z",
             9, 6, 3, 9, 6, 3, str(self.tmp_path), secret),
        )
        conn.commit()
        conn.close()
        turns = parse_goose_store(db)
        self.assertEqual(len(turns), 1)
        self.assertEqual(turns[0].provider, "goose")
        self.assertEqual(turns[0].active_seconds, 120)
        self.assertEqual(turns[0].tokens_in, 6)
        self.assertEqual(turns[0].model, "claude-sonnet")
        self.assertNotIn(secret, json.dumps([turn.__dict__ for turn in turns]))

    def test_open_session_is_skipped(self) -> None:
        import sqlite3
        db = self.tmp_path / "open.db"
        conn = sqlite3.connect(db)
        conn.execute("CREATE TABLE sessions (id TEXT, model_config_json TEXT, created_at TEXT, input_tokens INTEGER, output_tokens INTEGER)")
        conn.execute("INSERT INTO sessions VALUES ('open', ?, '2026-08-21T10:00:00Z', 1, 1)", (json.dumps({"model_name": "gpt"}),))
        conn.commit()
        conn.close()
        self.assertEqual(parse_goose_store(db), [])

    def test_updated_at_without_ended_at_is_capped(self) -> None:
        import sqlite3
        db = self.tmp_path / "updated.db"
        conn = sqlite3.connect(db)
        conn.execute("CREATE TABLE sessions (id TEXT, model_config_json TEXT, created_at TEXT, updated_at TEXT, input_tokens INTEGER, output_tokens INTEGER)")
        conn.execute(
            "INSERT INTO sessions VALUES ('u1', ?, '2026-08-21T10:00:00Z', '2026-08-21T12:00:00Z', 1, 1)",
            (json.dumps({"model_name": "gpt"}),),
        )
        conn.commit()
        conn.close()
        turns = parse_goose_store(db)
        self.assertEqual(len(turns), 1)
        self.assertEqual(turns[0].active_seconds, 120)

    def test_missing_is_empty(self) -> None:
        self.assertEqual(parse_goose_store(self.tmp_path / "nope.db"), [])


class ZedSessionTests(TempDirTestCase):
    def test_hosted_thread_json_without_prompt(self) -> None:
        import sqlite3
        db = self.tmp_path / "threads.db"
        conn = sqlite3.connect(db)
        conn.execute("CREATE TABLE threads (id TEXT, created_at TEXT, updated_at TEXT, folder_paths TEXT, data_type TEXT, data TEXT)")
        secret = "zed-prompt-secret"
        payload = {
            "model": {"provider": "zed.dev", "model": "zed-hosted"},
            "token_usage": {"input_tokens": 5, "output_tokens": 2, "cache_read_input_tokens": 1, "cache_creation_input_tokens": 0},
            "messages": [{"role": "user", "content": secret}],
        }
        conn.execute(
            "INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?)",
            ("z1", "2026-08-21T10:00:00Z", "2026-08-21T10:01:30Z", json.dumps([str(self.tmp_path)]), "json", json.dumps(payload)),
        )
        conn.commit()
        conn.close()
        turns = parse_zed_store(db)
        self.assertEqual(len(turns), 1)
        self.assertEqual(turns[0].provider, "zed")
        self.assertEqual(turns[0].active_seconds, 90)
        self.assertEqual(turns[0].tokens_in, 5)
        self.assertEqual(turns[0].model, "zed-hosted")
        self.assertNotIn(secret, json.dumps([turn.__dict__ for turn in turns]))

    def test_external_provider_is_skipped(self) -> None:
        import sqlite3
        db = self.tmp_path / "external.db"
        conn = sqlite3.connect(db)
        conn.execute("CREATE TABLE threads (id TEXT, created_at TEXT, updated_at TEXT, folder_paths TEXT, data_type TEXT, data TEXT)")
        payload = {"model": {"provider": "anthropic", "model": "claude"}, "token_usage": {"input_tokens": 5, "output_tokens": 2}}
        conn.execute("INSERT INTO threads VALUES ('z2', '2026-08-21T10:00:00Z', '2026-08-21T10:01:00Z', NULL, 'json', ?)", (json.dumps(payload),))
        conn.commit()
        conn.close()
        self.assertEqual(parse_zed_store(db), [])


    def test_lifetime_without_request_stamps_is_capped(self) -> None:
        import sqlite3
        db = self.tmp_path / "lifetime.db"
        conn = sqlite3.connect(db)
        conn.execute("CREATE TABLE threads (id TEXT, created_at TEXT, updated_at TEXT, folder_paths TEXT, data_type TEXT, data TEXT)")
        payload = {"model": {"provider": "zed.dev", "model": "zed-hosted"}, "token_usage": {"input_tokens": 5, "output_tokens": 2}}
        conn.execute(
            "INSERT INTO threads VALUES ('z3', '2026-08-21T10:00:00Z', '2026-08-21T12:00:00Z', NULL, 'json', ?)",
            (json.dumps(payload),),
        )
        conn.commit()
        conn.close()
        turns = parse_zed_store(db)
        self.assertEqual(len(turns), 1)
        self.assertEqual(turns[0].active_seconds, 120)

    def test_missing_is_empty(self) -> None:
        self.assertEqual(parse_zed_store(self.tmp_path / "nope.db"), [])


class IngestRegistryTests(TempDirTestCase):
    def test_candidate_globs_do_not_pick_unrelated_json(self) -> None:
        root = self.tmp_path / "sessions"
        root.mkdir()
        (root / "keep.jsonl").write_text("{}", encoding="utf-8")
        (root / "noise.json").write_text("{}", encoding="utf-8")
        (root / "noise.db").write_bytes(b"x")
        found = {path.name for _, path in _candidate_files(root, 0.0, 0.0, ("*.jsonl",))}
        self.assertEqual(found, {"keep.jsonl"})

    def test_empty_discover_ingests_nothing(self) -> None:
        from app.tracker.dev_signals import ingest as ingest_mod
        from app.tracker.dev_signals.adapters import ProviderAdapter
        original = ingest_mod.PROVIDERS
        ingest_mod.PROVIDERS = (
            ProviderAdapter("ghost", lambda: [], lambda path: [], ("*.jsonl",)),
        )
        try:
            database = TrackerDatabase(self.tmp_path / "tracker.sqlite3")
            turns, scanned, skipped = ingest_agent_sessions(database, backfill_days=1)
            self.assertEqual((turns, scanned, skipped), (0, 0, 0))
        finally:
            ingest_mod.PROVIDERS = original


if __name__ == "__main__":
    unittest.main()
