"""Security and privacy tests for explicit SSH agent collection."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.tracker.dev_signals.ssh_sources import (
    MAX_DISCOVERED_ALIASES,
    REMOTE_EXPORTER_SCRIPT,
    collect_ssh_agent_source,
    list_ssh_agent_sources,
    test_ssh_agent_source as check_ssh_agent_source,
    validate_ssh_host,
)


class CapturingDatabase:
    def __init__(self) -> None:
        self.events: list[dict] = []
        self.commits: list[dict] = []

    def save_agent_session_events(self, events: list[dict]) -> int:
        self.events.extend(events)
        return len(events)

    def save_dev_commit_events(self, events: list[dict]) -> int:
        self.commits.extend(events)
        return len(events)


class SshHostValidationTests(unittest.TestCase):
    def test_accepts_explicit_alias_hostname_and_user(self) -> None:
        self.assertEqual(validate_ssh_host(" gpu-server "), "gpu-server")
        self.assertEqual(validate_ssh_host("dev@worker.example.test"), "dev@worker.example.test")

    def test_rejects_options_ports_whitespace_and_shell_syntax(self) -> None:
        for value in (
            "-oProxyCommand=touch /tmp/pwned",
            "worker -p 2222",
            "worker:2222",
            "worker;whoami",
            "$(whoami)",
            "user@-worker",
            "",
        ):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    validate_ssh_host(value)


class SshConfigDiscoveryTests(unittest.TestCase):
    def test_missing_config_is_an_empty_custom_host_fallback(self) -> None:
        with tempfile.TemporaryDirectory() as raw_home:
            home = Path(raw_home)
            result = list_ssh_agent_sources(home / ".ssh" / "config", home_path=home)

        self.assertTrue(result["ok"])
        self.assertEqual(result["code"], "missing")
        self.assertEqual(result["aliases"], [])

    def test_returns_only_literal_deduplicated_host_aliases(self) -> None:
        with tempfile.TemporaryDirectory() as raw_home:
            home = Path(raw_home)
            config = home / ".ssh" / "config"
            marker = home / "should-never-run"
            config.parent.mkdir()
            config.write_text(
                "\n".join(
                    (
                        "Host gpu-server staging gpu-server",
                        "Host *.internal !blocked literal,backup",
                        "Host=Lab-Host",
                        f"Match exec \"touch {marker}\"",
                        "  HostName secret.internal.example",
                        "  IdentityFile /private/secret-key-name",
                        f"  ProxyCommand touch {marker}",
                    )
                ),
                encoding="utf-8",
            )

            result = list_ssh_agent_sources(config, home_path=home)

            self.assertFalse(marker.exists())

        self.assertTrue(result["ok"])
        self.assertEqual(result["aliases"], ["backup", "gpu-server", "Lab-Host", "literal", "staging"])
        serialized = json.dumps(result)
        self.assertNotIn("secret.internal.example", serialized)
        self.assertNotIn("secret-key-name", serialized)
        self.assertNotIn("ProxyCommand", serialized)

    def test_follows_includes_as_text_with_cycle_and_size_bounds(self) -> None:
        with tempfile.TemporaryDirectory() as raw_home:
            home = Path(raw_home)
            ssh_dir = home / ".ssh"
            included_dir = ssh_dir / "config.d"
            included_dir.mkdir(parents=True)
            config = ssh_dir / "config"
            included = included_dir / "work.conf"
            config.write_text("Include config.d/*.conf\nHost root-host\n", encoding="utf-8")
            included.write_text("Include config\nHost included-host\n", encoding="utf-8")

            result = list_ssh_agent_sources(config, home_path=home)

        self.assertTrue(result["ok"])
        self.assertEqual(result["aliases"], ["included-host", "root-host"])

    def test_caps_large_alias_lists(self) -> None:
        with tempfile.TemporaryDirectory() as raw_home:
            home = Path(raw_home)
            config = home / ".ssh" / "config"
            config.parent.mkdir()
            config.write_text(
                "\n".join(f"Host worker-{index:03d}" for index in range(MAX_DISCOVERED_ALIASES + 10)),
                encoding="utf-8",
            )

            result = list_ssh_agent_sources(config, home_path=home)

        self.assertTrue(result["ok"])
        self.assertEqual(result["code"], "partial")
        self.assertEqual(len(result["aliases"]), MAX_DISCOVERED_ALIASES)


class SshConnectionTests(unittest.TestCase):
    def test_uses_fixed_argv_and_strict_noninteractive_ssh(self) -> None:
        calls = []

        def runner(args, **kwargs):
            calls.append((args, kwargs))
            return subprocess.CompletedProcess(args, 0, stdout="drifty-ssh-ready", stderr="")

        result = check_ssh_agent_source("dev@worker", runner=runner)

        self.assertTrue(result["ok"])
        args, kwargs = calls[0]
        self.assertEqual(args[0], "/usr/bin/ssh")
        self.assertIn("-n", args)
        self.assertIn("BatchMode=yes", args)
        self.assertIn("StrictHostKeyChecking=yes", args)
        self.assertEqual(args[-2:], ["dev@worker", "printf drifty-ssh-ready"])
        self.assertNotIn("shell", kwargs)
        self.assertTrue(kwargs["text"])
        self.assertTrue(kwargs["capture_output"])

    def test_maps_host_key_auth_and_timeout_failures(self) -> None:
        def failed(stderr):
            return lambda args, **kwargs: subprocess.CompletedProcess(args, 255, stdout="", stderr=stderr)

        self.assertEqual(
            check_ssh_agent_source("worker", runner=failed("Host key verification failed."))["code"],
            "host_key",
        )
        self.assertEqual(
            check_ssh_agent_source("worker", runner=failed("Permission denied (publickey)."))["code"],
            "auth",
        )

        def timed_out(args, **kwargs):
            raise subprocess.TimeoutExpired(args, kwargs["timeout"])

        self.assertEqual(check_ssh_agent_source("worker", runner=timed_out)["code"], "timeout")


class SshCollectionTests(unittest.TestCase):
    def test_namespaces_and_saves_only_valid_metadata(self) -> None:
        remote_key = "remote-" + "a" * 32
        wire = {
            "version": 1,
            "filesScanned": 2,
            "truncated": False,
            "turns": [
                {
                    "provider": "gemini",
                    "sessionKey": remote_key,
                    "turnIndex": 2_000_000,
                    "startedAt": "2026-09-01T01:00:00+00:00",
                    "endedAt": "2026-09-01T01:01:00+00:00",
                    "activeSeconds": 60,
                    "model": "gpt-5.6-codex",
                    "totalTokens": 123,
                    "tokensIn": 100,
                    "tokensOut": 23,
                    "tokensCacheRead": None,
                    "tokensCacheWrite": None,
                    "prompt": "must never be stored",
                }
            ],
        }
        wire["turns"].append({
            **wire["turns"][0],
            "provider": "unknown_agent",
            "sessionKey": "remote-" + "b" * 32,
        })

        def runner(args, **kwargs):
            self.assertEqual(args[-2:], ["worker", "python3 - 30"])
            self.assertNotIn("-n", args)
            self.assertEqual(kwargs["input"], REMOTE_EXPORTER_SCRIPT)
            return subprocess.CompletedProcess(args, 0, stdout=json.dumps(wire), stderr="")

        database = CapturingDatabase()
        result = collect_ssh_agent_source(database, "worker", runner=runner)

        self.assertTrue(result["ok"])
        self.assertEqual(result["turnsIngested"], 1)
        self.assertEqual(result["providers"], ["gemini"])
        self.assertEqual(len(database.events), 1)
        event = database.events[0]
        self.assertTrue(event["sessionKey"].startswith("ssh:"))
        self.assertEqual(event["turnIndex"], 2_000_000)
        self.assertNotIn("worker", event["sessionKey"])
        self.assertIsNone(event["cwdKey"])
        self.assertNotIn("prompt", event)

        # Wire turn with repo name sets namespaced cwdKey
        wire_with_repo = {
            "version": 1,
            "filesScanned": 1,
            "truncated": False,
            "turns": [
                {
                    **wire["turns"][0],
                    "repo": "drifty_mac",
                }
            ],
        }
        database2 = CapturingDatabase()
        collect_ssh_agent_source(database2, "worker", runner=lambda args, **kwargs: subprocess.CompletedProcess(args, 0, stdout=json.dumps(wire_with_repo), stderr=""))
        self.assertEqual(database2.events[0]["cwdKey"], "remote:drifty_mac")

    def test_saves_only_valid_remote_commits_under_the_session_repo_key(self) -> None:
        sha = "b" * 40
        wire = {
            "version": 1,
            "filesScanned": 1,
            "truncated": False,
            "turns": [],
            "commits": [
                {"repo": "drifty_mac", "sha": sha, "authoredAt": "2026-09-01T02:00:00+00:00", "insertions": 12, "deletions": 3, "filesChanged": 2},
                {"repo": "drifty_mac", "sha": sha, "authoredAt": "2026-09-01T02:00:00+00:00", "insertions": 12, "deletions": 3, "filesChanged": 2},
                {"repo": "drifty_mac", "sha": "not-a-sha", "authoredAt": "2026-09-01T02:00:00+00:00"},
                {"repo": "/Users/someone/secret", "sha": "c" * 40, "authoredAt": "2026-09-01T02:00:00+00:00"},
                {"repo": "drifty_mac", "sha": "d" * 40, "authoredAt": "not a time"},
                {"repo": "drifty_mac", "sha": "e" * 40, "authoredAt": "2026-09-01T02:00:00+00:00", "message": "must never be stored"},
            ],
        }

        database = CapturingDatabase()
        result = collect_ssh_agent_source(
            database,
            "worker",
            runner=lambda args, **kwargs: subprocess.CompletedProcess(args, 0, stdout=json.dumps(wire), stderr=""),
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["commitsFound"], 2)
        self.assertEqual(result["commitsIngested"], 2)
        self.assertEqual([commit["commitSha"] for commit in database.commits], [sha, "e" * 40])
        # Remote commits meet remote sessions on one repository key.
        self.assertEqual({commit["repoKey"] for commit in database.commits}, {"remote:drifty_mac"})
        self.assertNotIn("message", database.commits[1])
        self.assertEqual(database.commits[0]["insertions"], 12)

    def test_remote_exporter_uses_shared_providers_and_keeps_raw_content_and_paths_remote(self) -> None:
        secret = "TOP-SECRET-PROMPT-CONTENT"
        now = datetime.now(timezone.utc)
        with tempfile.TemporaryDirectory() as raw_home:
            home = Path(raw_home)
            codex_dir = home / ".codex" / "sessions" / "2026" / "09"
            claude_dir = home / ".claude" / "projects" / "private-project-name"
            gemini_dir = home / ".gemini" / "tmp" / "private-project-name" / "chats"
            codex_dir.mkdir(parents=True)
            claude_dir.mkdir(parents=True)
            gemini_dir.mkdir(parents=True)
            codex_path = codex_dir / "private-session-name.jsonl"
            claude_path = claude_dir / "another-private-session.jsonl"
            gemini_path = gemini_dir / "private-gemini-session.json"
            codex_records = [
                {"timestamp": (now - timedelta(minutes=6)).isoformat(), "type": "session_meta", "payload": {"session_id": "private-codex-id", "cwd": "/secret/repo"}},
                {"timestamp": (now - timedelta(minutes=5)).isoformat(), "type": "turn_context", "payload": {"model": "gpt-5.6-codex", "cwd": "/secret/repo"}},
                {"timestamp": (now - timedelta(minutes=4)).isoformat(), "type": "event_msg", "payload": {"type": "task_started", "prompt": secret}},
                {"timestamp": (now - timedelta(minutes=3)).isoformat(), "type": "event_msg", "payload": {"type": "token_count", "info": {"total_token_usage": {"total_tokens": 44}}}},
                {"timestamp": (now - timedelta(minutes=2)).isoformat(), "type": "event_msg", "payload": {"type": "task_complete", "response": secret}},
            ]
            claude_records = [
                {"timestamp": (now - timedelta(minutes=5)).isoformat(), "sessionId": "private-claude-id", "cwd": "/secret/repo", "message": {"content": secret, "model": "claude-opus-4-1"}},
                {"timestamp": (now - timedelta(minutes=4)).isoformat(), "sessionId": "private-claude-id", "message": {"content": secret, "usage": {"input_tokens": 10, "output_tokens": 5}}},
            ]
            codex_path.write_text("\n".join(json.dumps(record) for record in codex_records) + "\n", encoding="utf-8")
            claude_path.write_text("\n".join(json.dumps(record) for record in claude_records) + "\n", encoding="utf-8")
            gemini_path.write_text(json.dumps({
                "sessionId": "private-gemini-id",
                "startTime": (now - timedelta(minutes=5)).isoformat(),
                "lastUpdated": (now - timedelta(minutes=3)).isoformat(),
                "messages": [
                    {"type": "user", "timestamp": (now - timedelta(minutes=5)).isoformat(), "content": secret},
                    {
                        "type": "gemini",
                        "timestamp": (now - timedelta(minutes=3)).isoformat(),
                        "content": secret,
                        "model": "gemini-2.5-pro",
                        "tokens": {"input": 8, "output": 3},
                    },
                ],
            }), encoding="utf-8")

            remote_env = {
                **os.environ,
                "HOME": str(home),
                # pathlib.Path.home() follows USERPROFILE on Windows rather
                # than HOME. Point both conventions at the isolated fixture
                # so the exporter cannot discover the test runner's sessions.
                "USERPROFILE": str(home),
            }
            completed = subprocess.run(
                [sys.executable, "-", "30"],
                input=REMOTE_EXPORTER_SCRIPT,
                text=True,
                capture_output=True,
                check=True,
                env=remote_env,
            )

        self.assertNotIn(secret, completed.stdout)
        self.assertNotIn(str(home), completed.stdout)
        self.assertNotIn("private-codex-id", completed.stdout)
        self.assertNotIn("private-claude-id", completed.stdout)
        self.assertNotIn("private-gemini-id", completed.stdout)
        payload = json.loads(completed.stdout)
        self.assertEqual({turn["provider"] for turn in payload["turns"]}, {"codex", "claude_code", "gemini"})
        self.assertEqual(payload["filesScanned"], 3)



AUTHOR_EMAIL = "fixture@drifty.test"


class RemoteCommitCollectionTests(unittest.TestCase):
    """The exporter runs for real here: these assert what leaves the host."""

    def git(self, *args: str, cwd: Path) -> str:
        completed = subprocess.run(
            ["git", *args],
            cwd=str(cwd),
            capture_output=True,
            text=True,
            check=True,
            env={
                **os.environ,
                "GIT_CONFIG_GLOBAL": os.devnull,
                "GIT_CONFIG_SYSTEM": os.devnull,
                "GIT_AUTHOR_NAME": "Fixture",
                "GIT_AUTHOR_EMAIL": AUTHOR_EMAIL,
                "GIT_COMMITTER_NAME": "Fixture",
                "GIT_COMMITTER_EMAIL": AUTHOR_EMAIL,
            },
        )
        return completed.stdout

    def make_repo(self, path: Path) -> None:
        path.mkdir(parents=True)
        self.git("init", "--quiet", "--initial-branch=main", cwd=path)
        self.git("config", "user.email", AUTHOR_EMAIL, cwd=path)
        self.git("config", "user.name", "Fixture", cwd=path)

    def commit_file(self, repo: Path, name: str, body: str) -> str:
        (repo / name).write_text(body, encoding="utf-8")
        self.git("add", name, cwd=repo)
        self.git("commit", "--quiet", "-m", "fixture change", cwd=repo)
        # Local ingestion stores the same abbreviated sha, which is what lets a
        # commit reachable from both sources be recognised as one commit.
        return self.git("rev-parse", "HEAD", cwd=repo).strip()[:12]

    def write_codex_session(self, home: Path, cwd: Path, name: str) -> None:
        codex_dir = home / ".codex" / "sessions" / "2026" / "09"
        codex_dir.mkdir(parents=True, exist_ok=True)
        now = datetime.now(timezone.utc)
        records = [
            {"timestamp": (now - timedelta(minutes=6)).isoformat(), "type": "session_meta", "payload": {"session_id": name, "cwd": str(cwd)}},
            {"timestamp": (now - timedelta(minutes=5)).isoformat(), "type": "turn_context", "payload": {"model": "gpt-5.6-codex", "cwd": str(cwd)}},
            {"timestamp": (now - timedelta(minutes=4)).isoformat(), "type": "event_msg", "payload": {"type": "task_started", "prompt": "fixture"}},
            {"timestamp": (now - timedelta(minutes=3)).isoformat(), "type": "event_msg", "payload": {"type": "token_count", "info": {"total_token_usage": {"total_tokens": 44}}}},
            {"timestamp": (now - timedelta(minutes=2)).isoformat(), "type": "event_msg", "payload": {"type": "task_complete", "response": "fixture"}},
        ]
        path = codex_dir / f"{name}.jsonl"
        path.write_text("\n".join(json.dumps(record) for record in records) + "\n", encoding="utf-8")

    def run_exporter(self, home: Path, *, path_value: str | None = None) -> tuple[dict, str]:
        env = {**os.environ, "HOME": str(home), "USERPROFILE": str(home)}
        if path_value is not None:
            env["PATH"] = path_value
        completed = subprocess.run(
            [sys.executable, "-", "30"],
            input=REMOTE_EXPORTER_SCRIPT,
            text=True,
            capture_output=True,
            check=True,
            env=env,
        )
        return json.loads(completed.stdout), completed.stdout

    def test_collects_commits_only_from_repositories_an_agent_worked_in(self) -> None:
        with tempfile.TemporaryDirectory() as raw_root:
            root = Path(raw_root)
            home = root / "home"
            home.mkdir()
            repo = root / "worked-repo"
            idle = root / "untouched-repo"
            self.make_repo(repo)
            self.make_repo(idle)
            sha = self.commit_file(repo, "a.txt", "one\ntwo\n")
            self.commit_file(idle, "b.txt", "ignored\n")
            self.write_codex_session(home, repo, "worked-session")

            payload, stdout = self.run_exporter(home)

        self.assertEqual([commit["repo"] for commit in payload["commits"]], ["worked-repo"])
        self.assertEqual(payload["commits"][0]["sha"], sha)
        self.assertEqual(payload["commits"][0]["filesChanged"], 1)
        self.assertEqual(payload["commits"][0]["insertions"], 2)
        self.assertEqual({turn["repo"] for turn in payload["turns"]}, {"worked-repo"})
        # The repository directory name is the only path fragment allowed out.
        self.assertNotIn(str(root), stdout)
        self.assertNotIn("untouched-repo", stdout)

    def test_folds_worktrees_onto_their_repository_so_commits_count_once(self) -> None:
        with tempfile.TemporaryDirectory() as raw_root:
            root = Path(raw_root)
            home = root / "home"
            home.mkdir()
            repo = root / "primary-repo"
            self.make_repo(repo)
            first = self.commit_file(repo, "a.txt", "one\n")
            worktree = root / "task-worktree-slug"
            self.git("worktree", "add", "--quiet", "-b", "task", str(worktree), cwd=repo)
            second = self.commit_file(worktree, "b.txt", "two\n")
            self.write_codex_session(home, repo, "primary-session")
            self.write_codex_session(home, worktree, "worktree-session")

            payload, stdout = self.run_exporter(home)

        shas = [commit["sha"] for commit in payload["commits"]]
        self.assertEqual(sorted(shas), sorted({first, second}))
        self.assertEqual({commit["repo"] for commit in payload["commits"]}, {"primary-repo"})
        self.assertEqual({turn["repo"] for turn in payload["turns"]}, {"primary-repo"})
        self.assertNotIn("task-worktree-slug", stdout)

    def test_without_git_the_turns_still_arrive_and_commits_are_omitted(self) -> None:
        with tempfile.TemporaryDirectory() as raw_root:
            root = Path(raw_root)
            home = root / "home"
            home.mkdir()
            repo = root / "worked-repo"
            self.make_repo(repo)
            self.commit_file(repo, "a.txt", "one\n")
            self.write_codex_session(home, repo, "worked-session")

            payload, _ = self.run_exporter(home, path_value="")

        self.assertEqual(payload["commits"], [])
        self.assertTrue(payload["turns"])
        self.assertEqual({turn["repo"] for turn in payload["turns"]}, {"worked-repo"})


if __name__ == "__main__":
    unittest.main()
