"""Local SSH alias discovery and metadata-only coding-agent collection.

Alias discovery parses SSH configuration as inert text and returns only
literal ``Host`` aliases. It never evaluates commands or opens identity files.
The system SSH client is invoked only after the caller explicitly tests or
collects from one selected host. A small stdlib-only exporter then runs from
stdin on that host and returns only normalized timing/model/token metadata;
raw JSONL never leaves the remote machine.
"""

from __future__ import annotations

import glob
import base64
import hashlib
import json
import os
import re
import shlex
import subprocess
import zlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from .adapters import PROVIDERS


SSH_PATH = "/usr/bin/ssh"
HOST_PATTERN = re.compile(r"\A(?:[A-Za-z0-9][A-Za-z0-9._-]{0,127}@)?[A-Za-z0-9][A-Za-z0-9._-]{0,254}\Z")
HOST_ALIAS_PATTERN = re.compile(r"\A[A-Za-z0-9][A-Za-z0-9._-]{0,254}\Z")
CONFIG_DIRECTIVE_PATTERN = re.compile(r"\A\s*([A-Za-z][A-Za-z0-9]*)(?:\s*=\s*|\s+)(.*?)\s*\Z")
MAX_RESPONSE_BYTES = 8 * 1024 * 1024
DEFAULT_BACKFILL_DAYS = 30
MAX_BACKFILL_DAYS = 400
MAX_REMOTE_COMMITS = 500
REMOTE_REPO_NAME_PATTERN = re.compile(r"\A[A-Za-z0-9._-]{1,100}\Z")
COMMIT_SHA_PATTERN = re.compile(r"\A[0-9a-f]{7,64}\Z")
MAX_CONFIG_FILES = 64
MAX_CONFIG_BYTES = 1024 * 1024
MAX_CONFIG_DEPTH = 8
MAX_DISCOVERED_ALIASES = 200
REMOTE_PROVIDER_KEYS = frozenset(adapter.key for adapter in PROVIDERS)

SSH_BASE_ARGS = (
    SSH_PATH,
    "-T",
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=8",
    "-o",
    "ConnectionAttempts=1",
    "-o",
    "ServerAliveInterval=5",
    "-o",
    "ServerAliveCountMax=1",
    "-o",
    "StrictHostKeyChecking=yes",
)


def _config_result(ok: bool, code: str, message: str, aliases: list[str]) -> dict[str, Any]:
    return {"ok": ok, "code": code, "message": message, "aliases": aliases}


def _config_directive(line: str) -> tuple[str, list[str]] | None:
    match = CONFIG_DIRECTIVE_PATTERN.match(line)
    if match is None:
        return None
    try:
        lexer = shlex.shlex(match.group(2), posix=True)
        lexer.whitespace_split = True
        lexer.commenters = "#"
        values = list(lexer)
    except ValueError:
        return None
    return match.group(1).lower(), values


def _include_paths(patterns: list[str], *, base: Path, home: Path) -> list[Path]:
    paths: list[Path] = []
    for raw_pattern in patterns:
        expanded = os.path.expandvars(raw_pattern.replace("%d", str(home)))
        if expanded.startswith("~"):
            expanded = str(home) + expanded[1:]
        candidate = Path(expanded)
        if not candidate.is_absolute():
            candidate = base / candidate
        for match in sorted(glob.glob(str(candidate), recursive=False)):
            paths.append(Path(match))
    return paths


def list_ssh_agent_sources(
    config_path: Path | None = None,
    *,
    home_path: Path | None = None,
) -> dict[str, Any]:
    """Return literal SSH Host aliases without evaluating SSH configuration."""

    home = home_path or Path.home()
    root = config_path or home / ".ssh" / "config"
    if not root.exists():
        return _config_result(True, "missing", "No SSH config was found. You can enter a custom host.", [])

    aliases: list[str] = []
    seen_aliases: set[str] = set()
    seen_files: set[Path] = set()
    pending: list[tuple[Path, int]] = [(root, 0)]
    bytes_read = 0
    skipped_files = 0
    alias_limit_reached = False

    while pending and len(seen_files) < MAX_CONFIG_FILES and not alias_limit_reached:
        current, depth = pending.pop(0)
        try:
            resolved = current.expanduser().resolve()
        except (OSError, RuntimeError):
            skipped_files += 1
            continue
        if resolved in seen_files:
            continue
        seen_files.add(resolved)
        try:
            size = resolved.stat().st_size
            if size < 0 or bytes_read + size > MAX_CONFIG_BYTES:
                skipped_files += 1
                continue
            contents = resolved.read_text(encoding="utf-8", errors="replace")
        except OSError:
            if resolved == root.expanduser().resolve():
                return _config_result(False, "unreadable", "Drifty could not read your SSH config. You can still enter a custom host.", [])
            skipped_files += 1
            continue
        bytes_read += size

        for line in contents.splitlines():
            if alias_limit_reached:
                break
            directive = _config_directive(line)
            if directive is None:
                continue
            keyword, values = directive
            if keyword == "host":
                for value in values:
                    for candidate in value.split(","):
                        if not HOST_ALIAS_PATTERN.fullmatch(candidate):
                            continue
                        dedupe_key = candidate.casefold()
                        if dedupe_key in seen_aliases:
                            continue
                        if len(aliases) >= MAX_DISCOVERED_ALIASES:
                            alias_limit_reached = True
                            break
                        seen_aliases.add(dedupe_key)
                        aliases.append(candidate)
                    if alias_limit_reached:
                        break
            elif keyword == "include" and depth < MAX_CONFIG_DEPTH:
                for included in _include_paths(values, base=root.parent, home=home):
                    pending.append((included, depth + 1))

    aliases.sort(key=str.casefold)
    truncated = bool(pending) or alias_limit_reached
    if aliases:
        if skipped_files or truncated:
            return _config_result(True, "partial", f"Found {len(aliases)} SSH hosts. Some configuration was skipped.", aliases)
        return _config_result(True, "found", f"Found {len(aliases)} SSH hosts.", aliases)
    if skipped_files or truncated:
        return _config_result(True, "partial", "No literal SSH hosts were found. Some configuration was skipped.", [])
    return _config_result(True, "empty", "No literal SSH hosts were found. You can enter a custom host.", [])


# The remote host does not need Drifty installed. We embed the exact local
# provider parsers into one stdlib-only script, execute them in memory, disable
# cwd/repository resolution, and emit only the same narrow metadata envelope.
# The raw parser sources are bundled as PyInstaller data so the packaged
# tracker and source runtime stay on one adapter registry rather than carrying
# a second SSH-only implementation.
_REMOTE_EXPORTER_TEMPLATE = r'''import base64
import hashlib
import json
import sys
import time
import types
import zlib
from datetime import datetime, timezone
from pathlib import Path

MAX_FILES = 400
MAX_TURNS = 5000
MAX_TURN_INDEX = 2**31 - 1
#: Commit collection runs git on the remote host, so it is bounded twice: by
#: how many repositories it will visit and by how long it may spend in total.
#: The SSH call itself has a fixed timeout, and losing the agent turns because
#: git was slow would be a worse trade than reporting fewer commits.
MAX_COMMIT_REPOS = 10
MAX_COMMITS = 500
MAX_REPO_LOOKUPS = 40
COMMIT_BUDGET_SECONDS = 10.0
REMOTE_GIT_TIMEOUT_SECONDS = 5.0
SOURCE_BLOB = "__DRIFTY_AGENT_SOURCES__"

def module(name):
    value = types.ModuleType(name)
    value.__file__ = "<drifty-remote-agent-source>"
    value.__package__ = name.rpartition(".")[0]
    sys.modules[name] = value
    return value

package_name = "_drifty_remote_agents"
package = module(package_name)
package.__path__ = []

sources = json.loads(zlib.decompress(base64.b64decode(SOURCE_BLOB)).decode("utf-8"))
git_commits = module(package_name + ".git_commits")
exec(compile(sources["git_commits.py"], git_commits.__file__, "exec"), git_commits.__dict__)
git_commits.GIT_TIMEOUT_SECONDS = REMOTE_GIT_TIMEOUT_SECONDS
agent_sessions = module(package_name + ".agent_sessions")
exec(compile(sources["agent_sessions.py"], agent_sessions.__file__, "exec"), agent_sessions.__dict__)

def remote_repo_name(value):
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        name = Path(value).expanduser().name.strip()
        if name and all(c in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-" for c in name) and len(name) <= 100:
            return name
    except Exception:
        pass
    return None

# The working directory stays on the remote host. It is kept here only long
# enough to fold a worktree back onto its repository and to run git in it; the
# envelope carries the repository's directory name and nothing else.
agent_sessions._cwd_key = lambda value: value if isinstance(value, str) and value else None

repo_cache = {}
repo_targets = {}

def repo_for_cwd(value):
    """Return (repo name, repository path) for one session's working directory.

    A task worktree and its main checkout are the same repository, and git log
    walks every ref, so keying commits by the worktree directory would report
    one commit once per worktree. --git-common-dir collapses them. Without git
    on the host the directory name is still returned, which is what this
    exporter reported before it collected commits at all.
    """
    if not isinstance(value, str) or not value:
        return (None, None)
    cached = repo_cache.get(value)
    if cached is not None:
        return cached
    primary = None
    if len(repo_cache) < MAX_REPO_LOOKUPS:
        try:
            primary = git_commits.resolve_primary_repo(value)
        except Exception:
            primary = None
    if primary is not None:
        result = (remote_repo_name(str(primary)), str(primary))
    else:
        result = (remote_repo_name(value), None)
    if result[0] is None:
        result = (None, None)
    repo_cache[value] = result
    return result

adapters = module(package_name + ".adapters")
exec(compile(sources["adapters.py"], adapters.__file__, "exec"), adapters.__dict__)

def safe_int(value, maximum=1000000000000):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if isinstance(value, float) and not value.is_integer():
        return None
    parsed = int(value)
    return parsed if 0 <= parsed <= maximum else None

def safe_model(value):
    if not isinstance(value, str) or not value or len(value) > 120:
        return None
    allowed = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._:/+-"
    return value if all(character in allowed for character in value) else None

def parsed_time(value):
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)

def public_turn(provider, value, cutoff):
    started = parsed_time(value.started_at)
    ended = parsed_time(value.ended_at)
    active = safe_int(value.active_seconds, 7 * 86400)
    index = safe_int(value.turn_index, MAX_TURN_INDEX)
    if started is None or ended is None or not active or index is None or ended.timestamp() < cutoff:
        return None
    observed = int((ended - started).total_seconds())
    if observed <= 0 or abs(observed - active) > 2:
        return None
    raw_key = str(value.session_key).encode("utf-8", errors="replace")
    remote_key = "remote-" + hashlib.sha256(provider.encode("utf-8") + b":" + raw_key).hexdigest()[:32]
    repo_name, repo_path = repo_for_cwd(value.cwd_key)
    if repo_path is not None and repo_path not in repo_targets:
        repo_targets[repo_path] = repo_name
    result = {
        "provider": provider,
        "sessionKey": remote_key,
        "turnIndex": index,
        "startedAt": started.isoformat(),
        "endedAt": ended.isoformat(),
        "activeSeconds": active,
        "model": safe_model(value.model),
        "totalTokens": safe_int(value.total_tokens),
        "tokensIn": safe_int(value.tokens_in),
        "tokensOut": safe_int(value.tokens_out),
        "tokensCacheRead": safe_int(value.tokens_cache_read),
        "tokensCacheWrite": safe_int(value.tokens_cache_write),
    }
    if repo_name:
        result["repo"] = repo_name
    return result

def candidate_files(root, cutoff, patterns):
    root = Path(root)
    if root.is_file():
        try:
            modified = root.stat().st_mtime
        except OSError:
            return []
        return [(modified, root)] if modified >= cutoff else []
    if not root.is_dir():
        return []
    found = []
    seen = set()
    for pattern in patterns:
        try:
            matches = root.rglob(pattern)
        except OSError:
            continue
        for path in matches:
            if path in seen:
                continue
            seen.add(path)
            try:
                if not path.is_file():
                    continue
                modified = path.stat().st_mtime
            except OSError:
                continue
            if modified >= cutoff:
                found.append((modified, path))
    return found

try:
    days = int(sys.argv[1]) if len(sys.argv) > 1 else 30
except (TypeError, ValueError):
    days = 30
days = max(1, min(days, 400))
cutoff = datetime.now(timezone.utc).timestamp() - days * 86400

candidates = []
for adapter in adapters.PROVIDERS:
    try:
        roots = adapter.discover()
    except Exception:
        continue
    for root in roots:
        for modified, path in candidate_files(root, cutoff, adapter.patterns):
            candidates.append((modified, adapter, path))
candidates.sort(key=lambda item: item[0], reverse=True)

truncated = len(candidates) > MAX_FILES
turns = []
files_scanned = 0
for _, adapter, path in candidates[:MAX_FILES]:
    files_scanned += 1
    try:
        parsed_turns = adapter.parse(path)
    except Exception:
        continue
    for parsed_turn in parsed_turns:
        item = public_turn(adapter.key, parsed_turn, cutoff)
        if item is not None:
            turns.append(item)
        if len(turns) >= MAX_TURNS:
            turns = turns[:MAX_TURNS]
            truncated = True
            break
    if len(turns) >= MAX_TURNS:
        break

def public_commit(repo_name, event, cutoff):
    stamp = parsed_time(getattr(event, "authored_at", None))
    sha = getattr(event, "commit_sha", None)
    if stamp is None or stamp.timestamp() < cutoff:
        return None
    if not isinstance(sha, str) or not 7 <= len(sha) <= 64:
        return None
    if any(character not in "0123456789abcdefABCDEF" for character in sha):
        return None
    return {
        "repo": repo_name,
        "sha": sha.lower(),
        "authoredAt": stamp.isoformat(),
        "insertions": safe_int(getattr(event, "insertions", 0)) or 0,
        "deletions": safe_int(getattr(event, "deletions", 0)) or 0,
        "filesChanged": safe_int(getattr(event, "files_changed", 0)) or 0,
    }

# Only repositories this run already saw an agent work in are visited, so the
# exporter never walks the remote filesystem looking for code.
commits = []
deadline = time.monotonic() + COMMIT_BUDGET_SECONDS
since = str(days) + " days ago"
targets = list(repo_targets.items())
if len(targets) > MAX_COMMIT_REPOS:
    targets = targets[:MAX_COMMIT_REPOS]
    truncated = True
for repo_path, repo_name in targets:
    if time.monotonic() >= deadline:
        truncated = True
        break
    try:
        # A repository with no git identity on this host is someone else's
        # checkout that happens to live here. Local repository discovery
        # applies the same authorship test before it registers a repository.
        email = git_commits.default_author_email(repo_path)
        if not email:
            continue
        events = git_commits.collect_commits(repo_path, since=since, author_email=email, limit=MAX_COMMITS)
    except Exception:
        continue
    for event in events:
        item = public_commit(repo_name, event, cutoff)
        if item is not None:
            commits.append(item)
        if len(commits) >= MAX_COMMITS:
            commits = commits[:MAX_COMMITS]
            truncated = True
            break
    if len(commits) >= MAX_COMMITS:
        break

print(json.dumps({"version": 1, "turns": turns, "commits": commits, "filesScanned": files_scanned, "truncated": truncated}, separators=(",", ":")))
'''


def _remote_exporter_script() -> str:
    module_directory = Path(__file__).resolve().parent
    bundled_directory = module_directory / "remote_exporter_support"
    sources: dict[str, str] = {}
    for filename in ("git_commits.py", "agent_sessions.py", "adapters.py"):
        bundled_path = bundled_directory / filename
        source_path = bundled_path if bundled_path.is_file() else module_directory / filename
        sources[filename] = source_path.read_text(encoding="utf-8")
    encoded = base64.b64encode(
        zlib.compress(json.dumps(sources, separators=(",", ":")).encode("utf-8"), level=9)
    ).decode("ascii")
    return _REMOTE_EXPORTER_TEMPLATE.replace("__DRIFTY_AGENT_SOURCES__", encoded)


REMOTE_EXPORTER_SCRIPT = _remote_exporter_script()


Runner = Callable[..., subprocess.CompletedProcess[str]]


def validate_ssh_host(value: object) -> str:
    if not isinstance(value, str):
        raise ValueError("Enter an SSH host or alias.")
    host = value.strip()
    if not host or len(host) > 383 or not HOST_PATTERN.fullmatch(host):
        raise ValueError("Use a host or alias such as gpu-server or user@gpu-server. Configure ports in SSH config.")
    return host


def _result(ok: bool, code: str, message: str, host: str = "", **extra: Any) -> dict[str, Any]:
    return {"ok": ok, "code": code, "message": message, "host": host, **extra}


def _empty_collection() -> dict[str, Any]:
    """Counters a collection result always carries, even when it failed."""
    return {
        "providers": [],
        "turnsFound": 0,
        "turnsIngested": 0,
        "commitsFound": 0,
        "commitsIngested": 0,
        "filesScanned": 0,
        "truncated": False,
    }


def _failure(host: str, returncode: int | None, stderr: str, *, timed_out: bool = False) -> dict[str, Any]:
    text = stderr.lower()
    if timed_out or "operation timed out" in text or "connection timed out" in text:
        return _result(False, "timeout", "Connection timed out. Check the host, VPN, and SSH reachability.", host)
    if "host key verification failed" in text or "no host key is known" in text:
        return _result(False, "host_key", "This host is not trusted yet. Connect once in Terminal, verify its fingerprint, then retry.", host)
    if "permission denied" in text or "authentication failed" in text:
        return _result(False, "auth", "Key-based SSH authentication failed. Check your SSH agent and host configuration.", host)
    if "could not resolve hostname" in text or "name or service not known" in text:
        return _result(False, "unknown_host", "The SSH host could not be resolved. Check the alias or hostname.", host)
    if "python3: command not found" in text or "python3: not found" in text:
        return _result(False, "remote_runtime", "Python 3 is required on the remote host to collect agent metadata.", host)
    return _result(False, "remote_error", f"SSH exited without collecting metadata (code {returncode or 1}).", host)


def _run(args: list[str], *, runner: Runner, input_text: str | None = None, timeout: int) -> subprocess.CompletedProcess[str]:
    return runner(
        args,
        input=input_text,
        text=True,
        capture_output=True,
        timeout=timeout,
        check=False,
    )


def test_ssh_agent_source(host_value: object, *, runner: Runner = subprocess.run) -> dict[str, Any]:
    try:
        host = validate_ssh_host(host_value)
    except ValueError as error:
        return _result(False, "invalid_host", str(error))
    # The tracker sidecar receives its own command protocol on stdin. Keep a
    # connection-only probe from inheriting and consuming that pipe; collection
    # intentionally omits -n because it streams the exporter over SSH stdin.
    args = [*SSH_BASE_ARGS, "-n", host, "printf drifty-ssh-ready"]
    try:
        completed = _run(args, runner=runner, timeout=15)
    except FileNotFoundError:
        return _result(False, "ssh_unavailable", "The system SSH client is unavailable.", host)
    except subprocess.TimeoutExpired:
        return _failure(host, None, "", timed_out=True)
    except (OSError, UnicodeError):
        return _result(False, "remote_error", "The SSH connection could not be started.", host)
    if completed.returncode != 0:
        return _failure(host, completed.returncode, completed.stderr or "")
    if (completed.stdout or "").strip() != "drifty-ssh-ready":
        return _result(False, "invalid_response", "The host connected, but its response could not be verified.", host)
    return _result(True, "ready", "Connection ready. Drifty has not collected any activity yet.", host)


def _bounded_int(value: object, *, minimum: int = 0, maximum: int = 1_000_000_000_000) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if isinstance(value, float) and not value.is_integer():
        return None
    parsed = int(value)
    return parsed if minimum <= parsed <= maximum else None


def _parse_time(value: object) -> str | None:
    if not isinstance(value, str) or len(value) > 64:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat()


def _normalize_commits(payload: object) -> list[dict[str, Any]]:
    """Validate the commit half of a remote envelope.

    Commits are keyed by ``remote:<repo-name>``, the same key remote agent turns
    already carry, so one repository's sessions and commits meet on one row
    instead of splitting into two entries that look like two projects.
    """
    if not isinstance(payload, dict):
        return []
    raw_commits = payload.get("commits")
    if not isinstance(raw_commits, list):
        return []
    normalized: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for raw in raw_commits[:MAX_REMOTE_COMMITS]:
        if not isinstance(raw, dict):
            continue
        repo = raw.get("repo")
        sha = raw.get("sha")
        if not isinstance(repo, str) or not REMOTE_REPO_NAME_PATTERN.fullmatch(repo):
            continue
        if not isinstance(sha, str) or not COMMIT_SHA_PATTERN.fullmatch(sha):
            continue
        authored_at = _parse_time(raw.get("authoredAt"))
        if authored_at is None:
            continue
        key = (repo, sha)
        if key in seen:
            continue
        seen.add(key)
        normalized.append(
            {
                "repoKey": f"remote:{repo}",
                "commitSha": sha,
                "authoredAt": authored_at,
                "insertions": _bounded_int(raw.get("insertions"), maximum=10_000_000) or 0,
                "deletions": _bounded_int(raw.get("deletions"), maximum=10_000_000) or 0,
                "filesChanged": _bounded_int(raw.get("filesChanged"), maximum=100_000) or 0,
            }
        )
    return normalized


def _normalize_turns(host: str, payload: object) -> list[dict[str, Any]] | None:
    if not isinstance(payload, dict) or payload.get("version") != 1 or not isinstance(payload.get("turns"), list):
        return None
    namespace = hashlib.sha256(host.encode("utf-8")).hexdigest()[:12]
    normalized: list[dict[str, Any]] = []
    for raw in payload["turns"][:5000]:
        if not isinstance(raw, dict) or raw.get("provider") not in REMOTE_PROVIDER_KEYS:
            continue
        session = raw.get("sessionKey")
        started_at = _parse_time(raw.get("startedAt"))
        ended_at = _parse_time(raw.get("endedAt"))
        turn_index = _bounded_int(raw.get("turnIndex"), maximum=2**31 - 1)
        active_seconds = _bounded_int(raw.get("activeSeconds"), maximum=7 * 86400)
        model = raw.get("model")
        if not isinstance(session, str) or not session.startswith("remote-") or len(session) != 39:
            continue
        if started_at is None or ended_at is None or turn_index is None or not active_seconds:
            continue
        started = datetime.fromisoformat(started_at)
        ended = datetime.fromisoformat(ended_at)
        observed_seconds = int((ended - started).total_seconds())
        if observed_seconds <= 0 or abs(observed_seconds - active_seconds) > 2:
            continue
        if model is not None and (not isinstance(model, str) or len(model) > 120 or not re.fullmatch(r"[A-Za-z0-9._:/+-]+", model)):
            model = None
        repo = raw.get("repo")
        if isinstance(repo, str) and re.fullmatch(r"[A-Za-z0-9._-]+", repo) and len(repo) <= 100:
            cwd_key = f"remote:{repo}"
        else:
            cwd_key = None
        normalized.append(
            {
                "provider": raw["provider"],
                "sessionKey": f"ssh:{namespace}:{session}",
                "turnIndex": turn_index,
                "startedAt": started_at,
                "endedAt": ended_at,
                "activeSeconds": active_seconds,
                "cwdKey": cwd_key,
                "model": model,
                "totalTokens": _bounded_int(raw.get("totalTokens")),
                "tokensIn": _bounded_int(raw.get("tokensIn")),
                "tokensOut": _bounded_int(raw.get("tokensOut")),
                "tokensCacheRead": _bounded_int(raw.get("tokensCacheRead")),
                "tokensCacheWrite": _bounded_int(raw.get("tokensCacheWrite")),
                "costUsd": None,
            }
        )
    return normalized


def collect_ssh_agent_source(
    database: Any,
    host_value: object,
    *,
    backfill_days: int = DEFAULT_BACKFILL_DAYS,
    runner: Runner = subprocess.run,
) -> dict[str, Any]:
    try:
        host = validate_ssh_host(host_value)
    except ValueError as error:
        return _result(False, "invalid_host", str(error), **_empty_collection())
    days = max(1, min(int(backfill_days), MAX_BACKFILL_DAYS))
    args = [*SSH_BASE_ARGS, host, f"python3 - {days}"]
    try:
        completed = _run(args, runner=runner, input_text=REMOTE_EXPORTER_SCRIPT, timeout=45)
    except FileNotFoundError:
        failure = _result(False, "ssh_unavailable", "The system SSH client is unavailable.", host)
    except subprocess.TimeoutExpired:
        failure = _failure(host, None, "", timed_out=True)
    except (OSError, UnicodeError):
        failure = _result(False, "remote_error", "The SSH connection could not be started.", host)
    else:
        failure = _failure(host, completed.returncode, completed.stderr or "") if completed.returncode != 0 else None
    if failure is not None:
        return {**failure, **_empty_collection()}
    stdout = completed.stdout or ""
    if len(stdout.encode("utf-8", errors="replace")) > MAX_RESPONSE_BYTES:
        return _result(False, "invalid_response", "The remote metadata response was too large.", host, **{**_empty_collection(), "truncated": True})
    try:
        raw_payload = json.loads(stdout.strip())
    except (TypeError, ValueError):
        return _result(False, "invalid_response", "The host connected, but returned invalid metadata.", host, **_empty_collection())
    turns = _normalize_turns(host, raw_payload)
    if turns is None:
        return _result(False, "invalid_response", "The host connected, but returned an unsupported metadata format.", host, **_empty_collection())
    ingested = database.save_agent_session_events(turns)
    commits = _normalize_commits(raw_payload)
    commits_ingested = database.save_dev_commit_events(commits) if commits else 0
    providers = sorted({turn["provider"] for turn in turns})
    files_scanned = _bounded_int(raw_payload.get("filesScanned"), maximum=400) or 0
    truncated = bool(raw_payload.get("truncated"))
    if not turns and not commits:
        message = "Connected, but no recent supported agent activity was found."
        code = "empty"
    elif commits:
        message = f"Collected {len(turns)} agent turns and {len(commits)} commits."
        code = "collected"
    else:
        message = f"Collected {len(turns)} agent turns."
        code = "collected"
    return _result(
        True,
        code,
        message,
        host,
        providers=providers,
        turnsFound=len(turns),
        turnsIngested=ingested,
        commitsFound=len(commits),
        commitsIngested=commits_ingested,
        filesScanned=files_scanned,
        truncated=truncated,
    )
