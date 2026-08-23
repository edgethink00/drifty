"""Dev signals: local git commit and agent session ingestion.

Both sources are read-only, local-only, and deliberately minimal: only
timestamps, churn counts, and coarse identity are retained. Commit messages,
file paths, prompt text, and model output never enter this layer.
"""

from .agent_sessions import AgentTurn, parse_claude_session, parse_codex_session
from .git_commits import CommitEvent, collect_commits, repo_key_for, resolve_primary_repo
from .ingest import IngestResult, register_repo, run_ingest

__all__ = [
    "AgentTurn",
    "CommitEvent",
    "IngestResult",
    "collect_commits",
    "parse_claude_session",
    "parse_codex_session",
    "register_repo",
    "repo_key_for",
    "resolve_primary_repo",
    "run_ingest",
]
