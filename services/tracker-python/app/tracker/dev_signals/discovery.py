"""Find git repositories on this machine.

Registering repositories by hand does not survive contact with a real machine:
this workspace alone holds over a hundred worktrees. Discovery scans a small set
of roots and reports what it finds, leaving the choice of what to track to the
user.

Two details decide whether a scan is correct or useless:

- ``.git`` is a directory in a normal clone but a *file* in a linked worktree or
  a submodule, so matching directories alone misses every worktree.
- An unpruned home scan spends its time inside ``node_modules`` and caches. The
  prune list is what makes the scan finish.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from .git_commits import _run_git, repo_key_for, resolve_primary_repo

#: Directory names never worth descending into while looking for repositories.
PRUNED_DIRECTORY_NAMES = frozenset(
    {
        ".Trash",
        ".cache",
        ".cargo",
        ".gradle",
        ".npm",
        ".nvm",
        ".rustup",
        ".venv",
        "Library",
        "node_modules",
        "target",
        "venv",
    }
)

DEFAULT_MAX_DEPTH = 6
DEFAULT_SCAN_LIMIT = 500

#: Where code usually lives. Scanning the whole home directory would spend its
#: time in application data and cloud-sync folders for no return, so automatic
#: discovery looks only at the conventional roots and whatever the user has
#: already told us about. Missing roots are skipped silently.
DEFAULT_DISCOVERY_ROOT_NAMES = (
    "Desktop",
    "Developer",
    "Documents",
    "Projects",
    "Sites",
    "code",
    "dev",
    "git",
    "repos",
    "src",
    "work",
    "workspace",
)


def default_discovery_roots() -> list[str]:
    home = Path.home()
    roots = [home / name for name in DEFAULT_DISCOVERY_ROOT_NAMES]
    return [str(root) for root in roots if root.is_dir()]


@dataclass(frozen=True)
class DiscoveredRepo:
    repo_key: str
    repo_path: str
    remote_identity: str | None
    last_commit_at: str | None
    worktree_count: int


def _remote_identity(repo: Path) -> str | None:
    """Owner/name derived from the origin remote.

    A remote URL is stable across clones, so it identifies the same project on
    another machine where the filesystem path differs. Credentials that some
    remotes embed are dropped rather than stored.
    """
    output = _run_git(repo, ["remote", "get-url", "origin"])
    if not output:
        return None
    url = output.strip()
    if not url:
        return None
    if url.endswith(".git"):
        url = url[: -len(".git")]
    # Strip any embedded credentials before the host.
    scheme, separator, rest = url.partition("://")
    if separator:
        url = f"{scheme}://{rest.rpartition('@')[2]}"
    else:
        # scp-style remote: git@github.com:owner/name
        url = url.rpartition(":")[2] or url
    parts = [part for part in url.replace("\\", "/").split("/") if part]
    if len(parts) >= 2:
        return "/".join(parts[-2:])
    return parts[-1] if parts else None


def _last_commit_at(repo: Path) -> str | None:
    output = _run_git(repo, ["log", "--all", "-1", "--pretty=format:%aI"])
    if not output:
        return None
    try:
        return datetime.fromisoformat(output.strip()).astimezone(timezone.utc).isoformat()
    except ValueError:
        return None


def _worktree_count(repo: Path) -> int:
    output = _run_git(repo, ["worktree", "list", "--porcelain"])
    if not output:
        return 1
    return sum(1 for line in output.splitlines() if line.startswith("worktree "))


def iter_git_markers(
    root: str | Path,
    *,
    max_depth: int = DEFAULT_MAX_DEPTH,
    limit: int = DEFAULT_SCAN_LIMIT,
):
    """Yield paths containing a ``.git`` entry, directory or file."""
    base = Path(root).expanduser()
    if not base.is_dir():
        return
    base_depth = len(base.parts)
    found = 0
    for current, directories, files in os.walk(base, followlinks=False):
        current_path = Path(current)
        if len(current_path.parts) - base_depth >= max_depth:
            directories[:] = []
            continue
        directories[:] = [
            name
            for name in directories
            if name not in PRUNED_DIRECTORY_NAMES
        ]
        if ".git" in directories or ".git" in files:
            # Everything below a repository root belongs to that repository.
            directories[:] = [name for name in directories if name != ".git"]
            yield current_path
            found += 1
            if found >= limit:
                return


def discover_repositories(
    roots: list[str] | None = None,
    *,
    max_depth: int = DEFAULT_MAX_DEPTH,
    limit: int = DEFAULT_SCAN_LIMIT,
) -> list[DiscoveredRepo]:
    """Scan roots and return distinct repositories, most recent first.

    Worktrees collapse onto their primary repository, so a workspace holding a
    hundred task worktrees of one project reports one entry.
    """
    search_roots = roots if roots else [str(Path.home())]
    seen: dict[str, DiscoveredRepo] = {}

    for root in search_roots:
        for marker_path in iter_git_markers(root, max_depth=max_depth, limit=limit):
            primary = resolve_primary_repo(marker_path)
            if primary is None:
                continue
            key = repo_key_for(primary)
            if key in seen:
                continue
            seen[key] = DiscoveredRepo(
                repo_key=key,
                repo_path=str(primary),
                remote_identity=_remote_identity(primary),
                last_commit_at=_last_commit_at(primary),
                worktree_count=_worktree_count(primary),
            )

    return sorted(
        seen.values(),
        key=lambda repo: repo.last_commit_at or "",
        reverse=True,
    )
