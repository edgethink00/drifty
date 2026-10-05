"""Orchestrate dev-signal ingestion.

The session corpus on a working machine reaches thousands of files and tens of
gigabytes, so a full rescan on every refresh is not viable. Ingestion is
watermarked by file modification time and bounded to a recent window; older
ranges are pulled in only on request.
"""

from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

from app.platform_locks import lock_exclusive_nonblocking, unlock

from .adapters import PROVIDERS, ProviderAdapter
from .git_commits import collect_commits, default_author_email, repo_key_for, resolve_primary_repo
from .discovery import default_discovery_roots, discover_repositories

DEFAULT_BACKFILL_DAYS = 30
WATERMARK_KEY_PREFIX = "dev_signals_watermark_"
IDENTITY_VERSION_KEY_PREFIX = "dev_signals_identity_version_"
CODEX_IDENTITY_VERSION = 2

#: Repository discovery walks the filesystem, so it runs on its own slower
#: cadence than session ingestion rather than on every refresh.
DISCOVERY_INTERVAL_SECONDS = 6 * 60 * 60

#: Bound the number of files per pass (not the byte count or elapsed time).
MAX_FILES_PER_PASS = 400

#: Share of every pass reserved for the newest session files.
#:
#: The watermark walks forward from the oldest unscanned file, so a backlog
#: bigger than one pass hides *today* behind it: on a machine that writes ~150
#: session files a day, the current range is only as fresh as the oldest
#: unread file. Reading part of every pass from the newest end keeps the
#: visible range correct while the backlog drains from the other end. Head
#: files are read again once the watermark reaches them, which the turn upsert
#: makes free. A share rather than a count keeps both ends alive at any budget.
HEAD_SHARE_PER_PASS = 0.4


@dataclass(frozen=True)
class IngestResult:
    commits_ingested: int
    agent_turns_ingested: int
    files_scanned: int
    skipped_files: int


def _watermark_key(provider: str) -> str:
    return f"{WATERMARK_KEY_PREFIX}{provider}"


def _read_watermark(database, provider: str) -> float:
    raw = database.get_meta(_watermark_key(provider))
    if raw is None:
        return 0.0
    try:
        return float(raw)
    except (TypeError, ValueError):
        return 0.0


def _write_watermark(database, provider: str, value: float) -> None:
    database.set_meta(_watermark_key(provider), repr(float(value)))


def _file_key(path: Path) -> str:
    # Only a local fingerprint is persisted, never the session-log path.
    return hashlib.sha256(str(path).encode("utf-8", errors="surrogatepass")).hexdigest()


def _file_version(stat) -> str:
    # Detect growth and sub-float mtime changes without reading/hashing log bodies.
    return hashlib.sha256(f"{stat.st_size}:{stat.st_mtime_ns}".encode("ascii")).hexdigest()


def _session_file_state(path: Path) -> tuple[float, str]:
    stat = path.stat()
    modified = stat.st_mtime
    version = _file_version(stat)
    if path.suffix.lower() in {".db", ".sqlite3"}:
        # A live SQLite producer can commit only to WAL while the main file
        # stays unchanged. SHM is reader coordination, not activity content.
        try:
            wal = path.with_name(path.name + "-wal").stat()
        except FileNotFoundError:
            wal = None
        if wal is not None and wal.st_size > 0:
            modified = max(modified, wal.st_mtime)
            version = hashlib.sha256(f"{version}:{_file_version(wal)}".encode("ascii")).hexdigest()
    return modified, version


def _read_session_watermark(database, provider: str) -> tuple[float, dict[str, str]]:
    raw = database.get_meta(_watermark_key(provider))
    try:
        state = json.loads(raw) if raw is not None else None
        if isinstance(state, dict):
            modified = float(state["modified"])
            files = state["files"]
            if math.isfinite(modified):
                if isinstance(files, dict) and all(
                    isinstance(key, str) and isinstance(version, str)
                    for key, version in files.items()
                ):
                    return modified, files
                if isinstance(files, list) and all(isinstance(key, str) for key in files):
                    # The earlier path-only checkpoint cannot identify versions.
                    # Revisit its boundary within the same per-pass budget.
                    return modified, {}
    except (TypeError, ValueError, KeyError):
        pass
    # A legacy scalar cannot identify which tied files were skipped. Replay
    # the bounded backfill once; the existing turn upsert prevents duplicates.
    return 0.0, {}


def _read_session_retries(database, provider: str) -> tuple[list[tuple[str, float]], bool]:
    try:
        state = json.loads(database.get_meta(_watermark_key(provider)) or "null")
        if isinstance(state, dict):
            retry = state.get("retry", [])
            if isinstance(retry, list):
                pending: dict[str, float] = {}
                for item in retry:
                    if not isinstance(item, list) or len(item) != 2 or not isinstance(item[0], str):
                        continue
                    modified = float(item[1])
                    if math.isfinite(modified):
                        pending[item[0]] = modified
                return list(pending.items()), state.get("retryNext") is True
    except (TypeError, ValueError):
        pass
    return [], False


def _write_session_watermark(
    database, provider: str, modified: float, files: dict[str, str],
    *, retry_files: list[tuple[str, float]] | None = None, retry_next: bool = False,
) -> None:
    # Persist the boundary and its completed files together so restarts cannot
    # retain one half of a checkpoint and silently skip the unread remainder.
    database.set_meta(
        _watermark_key(provider),
        json.dumps({"modified": modified, "files": files, "retry": retry_files or [], "retryNext": retry_next}, sort_keys=True),
    )


def _prepare_provider_identity(database, adapter: ProviderAdapter) -> None:
    """Schedule a one-time Codex reparse when its stored identity changes."""
    if adapter.key != "codex" or not adapter.replace_sessions:
        return
    version_key = f"{IDENTITY_VERSION_KEY_PREFIX}{adapter.key}"
    if database.get_meta(version_key) == str(CODEX_IDENTITY_VERSION):
        return
    database.set_meta(_watermark_key(adapter.key), "0.0")
    database.set_meta(version_key, str(CODEX_IDENTITY_VERSION))


def _candidate_files(
    root: Path,
    watermark: float,
    cutoff: float,
    patterns: tuple[str, ...] = ("*.jsonl",),
    watermark_files: dict[str, str] | None = None,
    retry_files: set[str] | None = None,
) -> list[tuple[float, Path]]:
    """Unread session files at/after the watermark inside the backfill window."""
    candidates: list[tuple[float, Path]] = []
    retry_files = retry_files or set()
    if root.is_file():
        try:
            modified, version = _session_file_state(root)
        except OSError:
            return []
        already_read = (
            modified == watermark
            and (watermark_files or {}).get(_file_key(root)) == version
        )
        retry = _file_key(root) in retry_files
        if modified >= cutoff and (retry or (modified >= watermark and not already_read)):
            candidates.append((modified, root))
        return candidates
    if not root.is_dir():
        return []
    seen: set[Path] = set()
    for pattern in patterns:
        try:
            matches = root.rglob(pattern)
        except OSError:
            continue
        for path in matches:
            if path in seen:
                continue
            seen.add(path)
            if not path.is_file():
                continue
            try:
                modified, version = _session_file_state(path)
            except OSError:
                continue
            retry = _file_key(path) in retry_files
            if modified < cutoff or (modified < watermark and not retry):
                continue
            if (
                not retry and modified == watermark
                and (watermark_files or {}).get(_file_key(path)) == version
            ):
                continue
            candidates.append((modified, path))
    candidates.sort()
    return candidates


def _split_pass(
    candidates: list[tuple[float, Path]],
    max_files: int,
) -> tuple[list[tuple[float, Path]], list[tuple[float, Path]]]:
    """Split one pass into a backlog slice and a head slice.

    The backlog is contiguous from the watermark, so reaching its end may
    advance the watermark. The head is the newest tail of the corpus and never
    advances it, because the files between the two slices are still unread.
    """
    budget = max(1, max_files)
    if len(candidates) <= budget:
        return candidates, []
    head_size = min(budget - 1, max(1, int(budget * HEAD_SHARE_PER_PASS)))
    if head_size <= 0:
        return candidates[:budget], []
    return candidates[: budget - head_size], candidates[-head_size:]


def _turn_rows(adapter: ProviderAdapter, path: Path) -> list[dict] | None:
    """Rows for one session file, or None when the file could not be read."""
    try:
        turns = adapter.parse(path)
    except Exception:
        # A schema change degrades to fewer events, never a failed capture
        # cycle.
        return None
    return [
        {
            "provider": turn.provider,
            "sessionKey": turn.session_key,
            "turnIndex": turn.turn_index,
            "startedAt": turn.started_at,
            "endedAt": turn.ended_at,
            "activeSeconds": turn.active_seconds,
            "cwdKey": turn.cwd_key,
            "model": turn.model,
            "totalTokens": turn.total_tokens,
            "tokensIn": turn.tokens_in,
            "tokensOut": turn.tokens_out,
            "tokensCacheRead": turn.tokens_cache_read,
            "tokensCacheWrite": turn.tokens_cache_write,
            "costUsd": turn.cost_usd,
        }
        for turn in turns
    ]


def ingest_agent_sessions(
    database,
    *,
    backfill_days: int = DEFAULT_BACKFILL_DAYS,
    max_files: int = MAX_FILES_PER_PASS,
    cancelled: Callable[[], bool] | None = None,
) -> tuple[int, int, int]:
    """Ingest new agent turns for every registered provider.

    Returns ``(turns_ingested, files_scanned, skipped_files)``. If another
    importer owns this database, defer this pass without reading or writing it.
    """
    # The daemon and a manual refresh use separate processes. Their read/parse/
    # save/checkpoint sequence must not overwrite a newer pass or its retries.
    # This lock is only for importers; parsing holds no SQLite transaction and
    # a contended pass defers immediately rather than pausing activity capture.
    db_path = Path(database.db_path).resolve()
    lock_path = db_path.with_name(f".{db_path.name}.agent-ingest.lock")
    # Keep the rendezvous file: unlinking it would let peers lock different files.
    with lock_path.open("a+b") as lock_file:
        if not lock_exclusive_nonblocking(lock_file):
            return 0, 0, 0
        try:
            return _ingest_agent_sessions(database, backfill_days=backfill_days, max_files=max_files,
                                          cancelled=cancelled)
        finally:
            unlock(lock_file)


class IngestCancelled(Exception):
    """Stop an optional pass without publishing its partially parsed provider."""


def _check_cancelled(cancelled: Callable[[], bool] | None) -> None:
    if cancelled is not None and cancelled():
        raise IngestCancelled()


def _ingest_agent_sessions(database, *, backfill_days: int, max_files: int,
                           cancelled: Callable[[], bool] | None = None) -> tuple[int, int, int]:
    cutoff = (datetime.now(timezone.utc) - timedelta(days=max(1, backfill_days))).timestamp()
    total_turns = 0
    total_scanned = 0
    total_skipped = 0

    for adapter in PROVIDERS:
        _check_cancelled(cancelled)
        _prepare_provider_identity(database, adapter)
        watermark, watermark_files = _read_session_watermark(database, adapter.key)
        retry_state, retry_next = _read_session_retries(database, adapter.key)
        # Keep a temporarily undiscoverable file until its original backfill
        # window expires, rather than treating stat/access failure as deletion.
        retry_times = {key: modified for key, modified in retry_state if modified >= cutoff}
        retry_files = list(retry_times)
        try:
            roots = adapter.discover()
        except Exception:
            total_skipped += 1
            continue
        candidates: dict[str, tuple[float, Path]] = {}
        for root in roots:
            for item in _candidate_files(root, watermark, cutoff, adapter.patterns, watermark_files, set(retry_files)):
                _check_cancelled(cancelled)
                candidates[_file_key(item[1])] = item
        _check_cancelled(cancelled)
        if not candidates:
            if retry_state:
                _write_session_watermark(
                    database, adapter.key, watermark, watermark_files,
                    retry_files=list(retry_times.items()), retry_next=retry_next,
                )
            continue

        pending = [key for key in retry_files if key in candidates]
        pending_keys = set(pending)
        fresh = sorted(item for key, item in candidates.items() if key not in pending_keys)
        budget = max(1, max_files)
        # A failed retry goes to the tail. Healthy backlog keeps its share;
        # at budget one, persist which lane goes next across restarts.
        retry_budget = min(len(pending), budget) if not fresh else min(len(pending), 1)
        if budget == 1 and pending and fresh:
            retry_budget = int(retry_next)
            retry_next = not retry_next
        retries = [candidates[key] for key in pending[:retry_budget]]
        retry_queue = [key for key in retry_files if key not in candidates] + pending[retry_budget:]
        if budget > retry_budget:
            backlog, head = _split_pass(fresh, budget - retry_budget)
        else:
            backlog, head = [], []
        highest = watermark
        completed_at_highest = dict(watermark_files)
        batch: list[dict] = []
        for modified, path in backlog:
            _check_cancelled(cancelled)
            total_scanned += 1
            try:
                # Record the version before parsing. An append during parsing
                # must remain eligible next time, even if mtime stays equal.
                _, version = _session_file_state(path)
            except OSError:
                total_skipped += 1
                retry_queue.append(_file_key(path))
                retry_times[_file_key(path)] = modified
                continue
            rows = _turn_rows(adapter, path)
            if rows is None:
                total_skipped += 1
                retry_queue.append(_file_key(path))
                retry_times[_file_key(path)] = modified
                continue
            batch.extend(rows)
            if modified > highest:
                highest = modified
                completed_at_highest.clear()
            completed_at_highest[_file_key(path)] = version
        # The newest files land in the same pass, ahead of the unread middle.
        # They stay behind the watermark so the backlog still gets read.
        for modified, path in [*head, *retries]:
            _check_cancelled(cancelled)
            total_scanned += 1
            try:
                _, version = _session_file_state(path)
            except OSError:
                total_skipped += 1
                retry_queue.append(_file_key(path))
                retry_times[_file_key(path)] = modified
                continue
            rows = _turn_rows(adapter, path)
            if rows is None:
                total_skipped += 1
                retry_queue.append(_file_key(path))
                retry_times[_file_key(path)] = modified
                continue
            batch.extend(rows)
            if modified == highest:
                completed_at_highest[_file_key(path)] = version

        _check_cancelled(cancelled)
        total_turns += database.save_agent_session_events(
            batch,
            replace_sessions=adapter.replace_sessions,
        )
        # Only advance the watermark past files this pass actually reached, so a
        # truncated batch resumes instead of skipping the remainder.
        _check_cancelled(cancelled)
        _write_session_watermark(
            database, adapter.key, highest, completed_at_highest,
            retry_files=[(key, retry_times[key]) for key in dict.fromkeys(retry_queue)], retry_next=retry_next,
        )

    return total_turns, total_scanned, total_skipped


def ingest_git_commits(database, *, since_days: int = DEFAULT_BACKFILL_DAYS) -> int:
    since = f"{max(1, since_days)} days ago"
    ingested = 0
    for repo in database.list_dev_repos():
        repo_path = repo.get("repo_path")
        if not repo_path:
            continue
        events = collect_commits(
            repo_path,
            since=since,
            author_email=repo.get("author_email"),
        )
        ingested += database.save_dev_commit_events(
            [
                {
                    "repoKey": event.repo_key,
                    "commitSha": event.commit_sha,
                    "authoredAt": event.authored_at,
                    "insertions": event.insertions,
                    "deletions": event.deletions,
                    "filesChanged": event.files_changed,
                }
                for event in events
            ]
        )
    return ingested


def register_repo(database, repo_path: str, author_email: str | None = None) -> dict | None:
    """Register a repository for commit ingestion.

    The path is resolved to its primary repository first, so adding a worktree
    and adding its main checkout produce one entry rather than two.
    """
    primary = resolve_primary_repo(repo_path)
    if primary is None:
        return None
    email = author_email or default_author_email(primary)
    return database.save_dev_repo(repo_key_for(primary), str(primary), email)


def discover_and_register_repos(database, *, force: bool = False) -> int:
    """Register repositories found under the conventional code roots.

    Commit ingestion only visits registered repositories, so without this the
    git half of the feature stays empty forever while the agent half fills in
    from the session logs it reads directly. Making the user hand-register
    repositories to fix that asks them to do work the scan can do, on a machine
    where the answer is already unambiguous: a repository whose commits carry
    their own git identity is theirs.

    That authorship check is what keeps this from being a land grab. Clones of
    other people's projects sit on disk too, and they are not this user's work;
    only repositories they actually commit to are registered. Discovery walks
    the filesystem, so it runs at most every six hours rather than on every
    refresh.
    """
    if not force:
        last_run = _read_watermark(database, "repo_discovery")
        if last_run and datetime.now(timezone.utc).timestamp() - last_run < DISCOVERY_INTERVAL_SECONDS:
            return 0

    known = {repo["repo_key"] for repo in database.list_dev_repos()}
    registered = 0
    for repo in discover_repositories(default_discovery_roots()):
        if repo.repo_key in known:
            continue
        # A repository with no commits from this machine's git identity is
        # someone else's work that happens to be checked out here.
        email = default_author_email(repo.repo_path)
        if not email or not collect_commits(repo.repo_path, since="365 days ago", author_email=email, limit=1):
            continue
        if register_repo(database, repo.repo_path, email) is not None:
            registered += 1

    _write_watermark(database, "repo_discovery", datetime.now(timezone.utc).timestamp())
    return registered


def run_ingest(database, *, backfill_days: int = DEFAULT_BACKFILL_DAYS) -> IngestResult:
    discover_and_register_repos(database)
    commits = ingest_git_commits(database, since_days=backfill_days)
    turns, scanned, skipped = ingest_agent_sessions(database, backfill_days=backfill_days)
    return IngestResult(
        commits_ingested=commits,
        agent_turns_ingested=turns,
        files_scanned=scanned,
        skipped_files=skipped,
    )
