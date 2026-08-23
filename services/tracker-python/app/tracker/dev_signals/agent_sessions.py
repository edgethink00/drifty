"""Derive agent working time from local coding-agent session logs.

Frontmost-window capture undercounts agent-assisted work by construction: a long
agent run registers only for the minutes its window happened to be in front.
These logs carry the missing timing.

Both log formats embed full prompt text, model output, reasoning traces, and
tool results. This module reads timestamps, working directory, model name, and
token counts, and drops payload bodies during parsing rather than filtering them
at write time. Neither format is a published interface, so every reader fails
soft: an unparseable line is skipped, never raised.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .git_commits import repo_key_for, resolve_primary_repo

PROVIDER_CODEX = "codex"
PROVIDER_CLAUDE_CODE = "claude_code"

#: Turns separated by more than this are treated as idle, not agent time.
DEFAULT_GAP_CEILING_SECONDS = 300

#: Cap applied to a turn with no completion event (crash, force-quit).
UNTERMINATED_TURN_CAP_SECONDS = 120


@dataclass(frozen=True)
class AgentTurn:
    provider: str
    session_key: str
    turn_index: int
    started_at: str
    ended_at: str
    active_seconds: int
    cwd_key: str | None
    model: str | None
    total_tokens: int | None


def _parse_timestamp(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    text = value.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _cwd_key(cwd: object) -> str | None:
    if not isinstance(cwd, str) or not cwd:
        return None
    primary = resolve_primary_repo(cwd)
    target = primary if primary is not None else Path(cwd).expanduser()
    return repo_key_for(target)


def _iter_json_lines(path: Path):
    """Stream one JSON object per line, skipping anything unparseable.

    Session files reach hundreds of megabytes, so the file is never read whole.
    """
    try:
        handle = path.open("r", encoding="utf-8", errors="replace")
    except OSError:
        return
    with handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except (ValueError, TypeError):
                continue
            if isinstance(record, dict):
                yield record


def _build_turn(
    provider: str,
    session_key: str,
    turn_index: int,
    start: datetime,
    end: datetime,
    cwd_key: str | None,
    model: str | None,
    total_tokens: int | None,
) -> AgentTurn:
    active = max(0, int((end - start).total_seconds()))
    return AgentTurn(
        provider=provider,
        session_key=session_key,
        turn_index=turn_index,
        started_at=start.isoformat(),
        ended_at=end.isoformat(),
        active_seconds=active,
        cwd_key=cwd_key,
        model=model,
        total_tokens=total_tokens,
    )


def parse_codex_session(path: str | Path) -> list[AgentTurn]:
    """Parse one Codex rollout JSONL file into turns.

    Turn boundaries come from ``task_started`` / ``task_complete`` event
    messages. ``turn_context`` supplies cwd and model; ``token_count`` carries a
    cumulative total, so the last value seen in a turn is the running total.
    """
    file_path = Path(path).expanduser()
    session_key = file_path.stem
    turns: list[AgentTurn] = []
    cwd_key: str | None = None
    model: str | None = None
    total_tokens: int | None = None
    start: datetime | None = None
    last_seen: datetime | None = None

    for record in _iter_json_lines(file_path):
        record_type = record.get("type")
        payload = record.get("payload")
        payload = payload if isinstance(payload, dict) else {}
        stamp = _parse_timestamp(record.get("timestamp"))
        if stamp is not None:
            last_seen = stamp

        if record_type == "session_meta":
            session_id = payload.get("session_id")
            if isinstance(session_id, str) and session_id:
                session_key = session_id
            if cwd_key is None:
                cwd_key = _cwd_key(payload.get("cwd"))
            continue

        if record_type == "turn_context":
            resolved = _cwd_key(payload.get("cwd"))
            if resolved is not None:
                cwd_key = resolved
            candidate_model = payload.get("model")
            if isinstance(candidate_model, str) and candidate_model:
                model = candidate_model
            continue

        if record_type != "event_msg":
            continue

        event_type = payload.get("type")
        if event_type == "token_count":
            info = payload.get("info")
            if isinstance(info, dict):
                usage = info.get("total_token_usage")
                if isinstance(usage, dict):
                    candidate = usage.get("total_tokens")
                    if isinstance(candidate, int):
                        total_tokens = candidate
            continue

        if event_type == "task_started" and stamp is not None:
            start = stamp
            continue

        if event_type == "task_complete" and stamp is not None and start is not None:
            turns.append(
                _build_turn(
                    PROVIDER_CODEX, session_key, len(turns), start, stamp,
                    cwd_key, model, total_tokens,
                )
            )
            start = None

    # A turn with no completion event means the session died mid-run. Cap it at
    # the last observed event rather than extending to file mtime, which would
    # silently bill idle hours as agent time.
    if start is not None and last_seen is not None and last_seen >= start:
        observed = (last_seen - start).total_seconds()
        end = start + timedelta(seconds=min(observed, float(UNTERMINATED_TURN_CAP_SECONDS)))
        turns.append(
            _build_turn(
                PROVIDER_CODEX, session_key, len(turns), start, end,
                cwd_key, model, total_tokens,
            )
        )

    return turns


def parse_claude_session(path: str | Path) -> list[AgentTurn]:
    """Parse one Claude Code session JSONL file into turns.

    This format has no explicit turn-boundary events, so activity is segmented by
    gaps: consecutive records closer than the gap ceiling belong to one turn.
    """
    file_path = Path(path).expanduser()
    session_key = file_path.stem
    cwd_key: str | None = None
    model: str | None = None
    stamps: list[datetime] = []

    for record in _iter_json_lines(file_path):
        session_id = record.get("sessionId")
        if isinstance(session_id, str) and session_id:
            session_key = session_id
        if cwd_key is None:
            cwd_key = _cwd_key(record.get("cwd"))
        message = record.get("message")
        if isinstance(message, dict):
            candidate_model = message.get("model")
            if isinstance(candidate_model, str) and candidate_model:
                model = candidate_model
        stamp = _parse_timestamp(record.get("timestamp"))
        if stamp is not None:
            stamps.append(stamp)

    return _turns_from_stamps(PROVIDER_CLAUDE_CODE, session_key, stamps, cwd_key, model)


def _turns_from_stamps(
    provider: str,
    session_key: str,
    stamps: list[datetime],
    cwd_key: str | None,
    model: str | None,
    gap_ceiling_seconds: int = DEFAULT_GAP_CEILING_SECONDS,
) -> list[AgentTurn]:
    if not stamps:
        return []
    stamps.sort()
    turns: list[AgentTurn] = []
    start = stamps[0]
    previous = stamps[0]
    for stamp in stamps[1:]:
        if (stamp - previous).total_seconds() > gap_ceiling_seconds:
            turns.append(
                _build_turn(provider, session_key, len(turns), start, previous, cwd_key, model, None)
            )
            start = stamp
        previous = stamp
    turns.append(
        _build_turn(provider, session_key, len(turns), start, previous, cwd_key, model, None)
    )
    return [turn for turn in turns if turn.active_seconds > 0]
