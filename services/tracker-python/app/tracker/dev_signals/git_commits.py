"""Read commit timing and churn from local git repositories.

Only commit sha, authored timestamp, and line/file churn are extracted. Commit
subjects and bodies are never read into memory: they routinely carry client
names, ticket identifiers, and unreleased feature names, and no dev-signals
surface needs them.
"""

from __future__ import annotations

import hashlib
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

RECORD_SEPARATOR = "\x1e"
FIELD_SEPARATOR = "\x1f"
GIT_TIMEOUT_SECONDS = 20.0

#: Window in which two commits with identical churn are treated as one piece of
#: work. A squash merge rewrites the author date, so the landed commit trails
#: its branch original by the time it took to review and merge.
SQUASH_DEDUPE_WINDOW_SECONDS = 6 * 60 * 60

#: Git lets any user or tool set an author timestamp, so a fraction of commits
#: carry dates that cannot be true. A study of 54M commits (arXiv:2209.04511)
#: found ~50k dated before CVS 1.0 shipped and >80k children older than their
#: parent, caused by rebases, migrations, wrong clocks, and timezone errors.
#: A marker drawn at such a time would place work in the middle of the night,
#: so implausible timestamps are dropped instead of displayed.
EARLIEST_PLAUSIBLE_COMMIT = datetime(1990, 11, 19, tzinfo=timezone.utc)

#: Clock skew tolerance for commits dated ahead of now.
FUTURE_COMMIT_TOLERANCE_SECONDS = 24 * 60 * 60


def is_plausible_commit_time(authored: datetime, *, now: datetime | None = None) -> bool:
    """False for a timestamp that cannot describe real work."""
    if authored < EARLIEST_PLAUSIBLE_COMMIT:
        return False
    reference = now or datetime.now(timezone.utc)
    return (authored - reference).total_seconds() <= FUTURE_COMMIT_TOLERANCE_SECONDS


@dataclass(frozen=True)
class CommitEvent:
    repo_key: str
    commit_sha: str
    authored_at: str
    insertions: int
    deletions: int
    files_changed: int


def repo_key_for(repo_path: str | Path) -> str:
    """Stable, non-reversible key for a repository path."""
    resolved = str(Path(repo_path).expanduser())
    return hashlib.sha256(resolved.encode("utf-8")).hexdigest()[:16]


def _run_git(repo_path: Path, args: list[str]) -> str | None:
    try:
        completed = subprocess.run(
            ["git", "-C", str(repo_path), *args],
            capture_output=True,
            text=True,
            timeout=GIT_TIMEOUT_SECONDS,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if completed.returncode != 0:
        return None
    return completed.stdout


def resolve_primary_repo(path: str | Path) -> Path | None:
    """Resolve a worktree path back to the repository it belongs to.

    A checkout under ``worktrees/`` is a distinct working directory for the same
    logical project. ``--git-common-dir`` points at the shared ``.git``
    directory, so every worktree of one repository collapses to a single key.
    """
    candidate = Path(path).expanduser()
    if not candidate.is_dir():
        return None
    common_dir = _run_git(candidate, ["rev-parse", "--git-common-dir"])
    if common_dir is None:
        return None
    common = Path(common_dir.strip())
    if not common.is_absolute():
        common = (candidate / common).resolve()
    if common.name == ".git":
        return common.parent
    return common


def default_author_email(repo_path: str | Path) -> str | None:
    output = _run_git(Path(repo_path), ["config", "user.email"])
    if output is None:
        return None
    email = output.strip()
    return email or None


def _parse_numstat(block: str) -> tuple[int, int, int, str]:
    insertions = 0
    deletions = 0
    files = 0
    # File names are hashed immediately and never retained: they are needed only
    # to tell two same-size commits apart, not to describe the work.
    names = hashlib.sha256()
    for line in block.splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split("\t")
        if len(parts) < 3:
            continue
        added, removed = parts[0], parts[1]
        files += 1
        names.update(parts[2].encode("utf-8", errors="replace"))
        # Binary files report "-" for both counts.
        if added.isdigit():
            insertions += int(added)
        if removed.isdigit():
            deletions += int(removed)
    return insertions, deletions, files, names.hexdigest()[:16]


def _is_duplicate(
    seen: list[tuple[datetime, int, int, int, str]],
    authored: datetime,
    insertions: int,
    deletions: int,
    files: int,
    touched: str,
) -> bool:
    """True when an equivalent commit was already recorded.

    An empty commit carries no churn to compare, so it is never folded away.
    """
    if insertions == 0 and deletions == 0 and files == 0:
        return False
    for previous_time, previous_ins, previous_del, previous_files, previous_touched in seen:
        if (previous_ins, previous_del, previous_files, previous_touched) != (
            insertions,
            deletions,
            files,
            touched,
        ):
            continue
        if abs((previous_time - authored).total_seconds()) <= SQUASH_DEDUPE_WINDOW_SECONDS:
            return True
    return False


def collect_commits(
    repo_path: str | Path,
    *,
    since: str | None = None,
    author_email: str | None = None,
    limit: int = 2000,
) -> list[CommitEvent]:
    """Collect commit events for one repository.

    Returns an empty list for a missing directory, a non-repository path, or any
    git failure. Ingestion must never break the capture loop.
    """
    repo = Path(repo_path).expanduser()
    primary = resolve_primary_repo(repo)
    if primary is None:
        return []
    key = repo_key_for(primary)

    args = [
        "log",
        # Walk every ref, not just the checked-out branch. Work on this machine
        # happens in per-task worktrees, so the primary checkout's HEAD is
        # usually the least active branch in the repository. Scoping to HEAD
        # would report zero commits on an actively developed repo.
        "--all",
        # A merge commit records integration, not authored work, and its churn
        # double-counts the branch it absorbs.
        "--no-merges",
        f"--max-count={max(1, int(limit))}",
        f"--pretty=format:{RECORD_SEPARATOR}%H{FIELD_SEPARATOR}%aI",
        "--numstat",
        "--no-color",
    ]
    if since:
        args.append(f"--since={since}")
    if author_email:
        args.append(f"--author={author_email}")

    output = _run_git(repo, args)
    if not output:
        return []

    events: list[CommitEvent] = []
    # Walking all refs surfaces both the branch commit and the squashed commit
    # that landed it. They are one piece of work with two shas, so identical
    # churn within a short window collapses to a single event.
    seen: list[tuple[datetime, int, int, int, str]] = []
    for record in output.split(RECORD_SEPARATOR):
        if not record.strip():
            continue
        header, _, numstat = record.partition("\n")
        fields = header.split(FIELD_SEPARATOR)
        if len(fields) < 2:
            continue
        sha, authored_at = fields[0].strip(), fields[1].strip()
        if not sha or not authored_at:
            continue
        try:
            parsed = datetime.fromisoformat(authored_at).astimezone(timezone.utc)
        except ValueError:
            continue
        normalized = parsed.isoformat()
        if not is_plausible_commit_time(parsed):
            continue
        insertions, deletions, files, touched = _parse_numstat(numstat)
        if _is_duplicate(seen, parsed, insertions, deletions, files, touched):
            continue
        seen.append((parsed, insertions, deletions, files, touched))
        events.append(
            CommitEvent(
                repo_key=key,
                commit_sha=sha[:12],
                authored_at=normalized,
                insertions=insertions,
                deletions=deletions,
                files_changed=files,
            )
        )
    return events
