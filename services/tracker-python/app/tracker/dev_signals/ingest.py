"""Orchestrate dev-signal ingestion.

The session corpus on a working machine reaches thousands of files and tens of
gigabytes, so a full rescan on every refresh is not viable. Ingestion is
watermarked by file modification time and bounded to a recent window; older
ranges are pulled in only on request.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .adapters import PROVIDERS, ProviderAdapter
from .git_commits import collect_commits, default_author_email, repo_key_for, resolve_primary_repo
from .discovery import default_discovery_roots, discover_repositories

DEFAULT_BACKFILL_DAYS = 30
WATERMARK_KEY_PREFIX = "dev_signals_watermark_"

#: Repository discovery walks the filesystem, so it runs on its own slower
#: cadence than session ingestion rather than on every refresh.
DISCOVERY_INTERVAL_SECONDS = 6 * 60 * 60

#: Ceiling on files read in one pass, so a first run cannot stall the tracker.
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


def _candidate_files(
    root: Path,
    watermark: float,
    cutoff: float,
    patterns: tuple[str, ...] = ("*.jsonl",),
) -> list[tuple[float, Path]]:
    """Session files newer than the watermark and inside the backfill window."""
    candidates: list[tuple[float, Path]] = []
    if root.is_file():
        try:
            modified = root.stat().st_mtime
        except OSError:
            return []
        if modified > watermark and modified >= cutoff:
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
                modified = path.stat().st_mtime
            except OSError:
                continue
            if modified <= watermark or modified < cutoff:
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
) -> tuple[int, int, int]:
    """Ingest new agent turns for every registered provider.

    Returns ``(turns_ingested, files_scanned, skipped_files)``.
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(days=max(1, backfill_days))).timestamp()
    total_turns = 0
    total_scanned = 0
    total_skipped = 0

    for adapter in PROVIDERS:
        watermark = _read_watermark(database, adapter.key)
        try:
            roots = adapter.discover()
        except Exception:
            total_skipped += 1
            continue
        candidates: list[tuple[float, Path]] = []
        for root in roots:
            candidates.extend(_candidate_files(root, watermark, cutoff, adapter.patterns))
        candidates.sort()
        if not candidates:
            continue

        backlog, head = _split_pass(candidates, max_files)
        highest = watermark
        batch: list[dict] = []
        for modified, path in backlog:
            total_scanned += 1
            rows = _turn_rows(adapter, path)
            if rows is None:
                total_skipped += 1
                continue
            batch.extend(rows)
            highest = max(highest, modified)
        # The newest files land in the same pass, ahead of the unread middle.
        # They stay behind the watermark so the backlog still gets read.
        for _, path in head:
            total_scanned += 1
            rows = _turn_rows(adapter, path)
            if rows is None:
                total_skipped += 1
                continue
            batch.extend(rows)

        total_turns += database.save_agent_session_events(batch)
        # Only advance the watermark past files this pass actually reached, so a
        # truncated batch resumes instead of skipping the remainder.
        _write_watermark(database, adapter.key, highest)

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
