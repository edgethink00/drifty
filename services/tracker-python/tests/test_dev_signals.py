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
from app.tracker.dev_signals.agent_sessions import (
    UNTERMINATED_TURN_CAP_SECONDS,
    parse_claude_session,
    parse_codex_session,
)
from app.tracker.dev_signals.discovery import discover_repositories
from app.tracker.dev_signals.git_commits import (
    collect_commits,
    is_plausible_commit_time,
    repo_key_for,
    resolve_primary_repo,
)
from app.tracker.dev_signals.ingest import discover_and_register_repos, register_repo


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
                        "info": {"total_token_usage": {"total_tokens": 4242}},
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


if __name__ == "__main__":
    unittest.main()
