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
PROVIDER_ASIDE = "aside"
PROVIDER_OPENCODE = "opencode"
PROVIDER_GEMINI = "gemini"
PROVIDER_HERMES = "hermes"
PROVIDER_OPENCLAW = "openclaw"
PROVIDER_KIMI = "kimi"
PROVIDER_PI = "pi"
PROVIDER_DROID = "droid"
PROVIDER_AMP = "amp"
PROVIDER_COPILOT = "copilot"
PROVIDER_CLINE = "cline"
PROVIDER_ROO = "roo"
PROVIDER_GOOSE = "goose"
PROVIDER_ZED = "zed"
PROVIDER_QWEN = "qwen"
PROVIDER_KIRO = "kiro"
PROVIDER_CURSOR_CLI = "cursor_cli"

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
    tokens_in: int | None = None
    tokens_out: int | None = None
    tokens_cache_read: int | None = None
    tokens_cache_write: int | None = None
    cost_usd: float | None = None


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


def parse_epoch(value: object) -> datetime | None:
    """Accept Unix seconds, Unix milliseconds, or an ISO timestamp."""
    if isinstance(value, datetime):
        parsed = value
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        timestamp = float(value)
        if timestamp > 1e17:
            timestamp /= 1_000_000_000.0
        elif timestamp > 1e11:
            timestamp /= 1000.0
        try:
            return datetime.fromtimestamp(timestamp, tz=timezone.utc)
        except (OverflowError, OSError, ValueError):
            return None
    if isinstance(value, str):
        stripped = value.strip()
        if stripped.isdigit() or (stripped.replace(".", "", 1).isdigit() and stripped.count(".") < 2):
            try:
                return parse_epoch(float(stripped))
            except ValueError:
                pass
        return _parse_timestamp(stripped)
    return None


def as_int(value: object) -> int | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return None


def as_float(value: object) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    return None


def _first_int(*values: object) -> int | None:
    for value in values:
        parsed = as_int(value)
        if parsed is not None:
            return parsed
    return None


def tokens_from_mapping(usage: object) -> tuple[int | None, int | None, int | None, int | None, int | None, float | None]:
    """Return total, in, out, cache_read, cache_write, cost from a usage object."""
    if not isinstance(usage, dict):
        return None, None, None, None, None, None
    tokens_in = _first_int(
        usage.get("input"),
        usage.get("input_tokens"),
        usage.get("inputTokens"),
        usage.get("tokensIn"),
        usage.get("prompt"),
        usage.get("prompt_tokens"),
        usage.get("promptTokenCount"),
    )
    tokens_out = _first_int(
        usage.get("output"),
        usage.get("output_tokens"),
        usage.get("outputTokens"),
        usage.get("tokensOut"),
        usage.get("candidates"),
        usage.get("completion_tokens"),
        usage.get("candidatesTokenCount"),
    )
    cache_read = _first_int(
        usage.get("cacheRead"),
        usage.get("cache_read"),
        usage.get("cache_read_input_tokens"),
        usage.get("cacheReadTokens"),
        usage.get("cacheReadInputTokens"),
        usage.get("cacheReads"),
        usage.get("cached_input_tokens"),
        usage.get("cached"),
        usage.get("cached_tokens"),
        usage.get("cachedContentTokenCount"),
    )
    cache_write = _first_int(
        usage.get("cacheWrite"),
        usage.get("cache_write"),
        usage.get("cache_write_input_tokens"),
        usage.get("cache_creation"),
        usage.get("cache_creation_input_tokens"),
        usage.get("cacheCreationTokens"),
        usage.get("cacheCreationInputTokens"),
        usage.get("cacheWrites"),
        usage.get("cache_creation"),
    )
    cache = usage.get("cache")
    if isinstance(cache, dict):
        if cache_read is None:
            cache_read = _first_int(cache.get("read"), cache.get("cacheRead"))
        if cache_write is None:
            cache_write = _first_int(cache.get("write"), cache.get("cacheWrite"))
    total = _first_int(usage.get("totalTokens"), usage.get("total_tokens"), usage.get("total"), usage.get("totalTokenCount"))
    if total is None:
        parts = [part for part in (tokens_in, tokens_out, cache_read, cache_write) if part is not None]
        total = sum(parts) if parts else None
    cost = None
    raw_cost = usage.get("cost")
    if isinstance(raw_cost, dict):
        cost = as_float(raw_cost.get("total"))
        if cost is None:
            cost = as_float(raw_cost.get("cost"))
    else:
        cost = as_float(raw_cost)
    return total, tokens_in, tokens_out, cache_read, cache_write, cost


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
    tokens_in: int | None = None,
    tokens_out: int | None = None,
    tokens_cache_read: int | None = None,
    tokens_cache_write: int | None = None,
    cost_usd: float | None = None,
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
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        tokens_cache_read=tokens_cache_read,
        tokens_cache_write=tokens_cache_write,
        cost_usd=cost_usd,
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
    tokens_in: int | None = None
    tokens_out: int | None = None
    cache_read: int | None = None
    cache_write: int | None = None
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
                    parsed_total, parsed_in, parsed_out, parsed_read, parsed_write, _ = tokens_from_mapping(usage)
                    if parsed_total is not None:
                        total_tokens = parsed_total
                    tokens_in = parsed_in
                    tokens_out = parsed_out
                    cache_read = parsed_read
                    cache_write = parsed_write
            continue

        if event_type == "task_started" and stamp is not None:
            start = stamp
            continue

        if event_type == "task_complete" and stamp is not None and start is not None:
            turns.append(
                _build_turn(
                    PROVIDER_CODEX, session_key, len(turns), start, stamp,
                    cwd_key, model, total_tokens,
                    tokens_in, tokens_out, cache_read, cache_write,
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
                tokens_in, tokens_out, cache_read, cache_write,
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
    last_usage: dict | None = None

    for record in _iter_json_lines(file_path):
        session_id = record.get("sessionId") or record.get("session_id")
        if isinstance(session_id, str) and session_id:
            session_key = session_id
        if cwd_key is None:
            cwd_key = _cwd_key(record.get("cwd"))
        message = record.get("message")
        if isinstance(message, dict):
            candidate_model = message.get("model")
            if isinstance(candidate_model, str) and candidate_model:
                model = candidate_model
            usage = message.get("usage")
            if isinstance(usage, dict):
                last_usage = usage
        stamp = _parse_timestamp(record.get("timestamp"))
        if stamp is not None:
            stamps.append(stamp)

    total, tokens_in, tokens_out, cache_read, cache_write, cost = tokens_from_mapping(last_usage)
    return _turns_from_stamps(
        PROVIDER_CLAUDE_CODE, session_key, stamps, cwd_key, model,
        total_tokens=total, tokens_in=tokens_in, tokens_out=tokens_out,
        tokens_cache_read=cache_read, tokens_cache_write=cache_write, cost_usd=cost,
    )


def _turns_from_stamps(
    provider: str,
    session_key: str,
    stamps: list[datetime],
    cwd_key: str | None,
    model: str | None,
    gap_ceiling_seconds: int = DEFAULT_GAP_CEILING_SECONDS,
    total_tokens: int | None = None,
    tokens_in: int | None = None,
    tokens_out: int | None = None,
    tokens_cache_read: int | None = None,
    tokens_cache_write: int | None = None,
    cost_usd: float | None = None,
    min_active_seconds: int = 0,
) -> list[AgentTurn]:
    if not stamps:
        return []
    stamps.sort()
    segments: list[tuple[datetime, datetime]] = []
    start = stamps[0]
    previous = stamps[0]
    for stamp in stamps[1:]:
        if (stamp - previous).total_seconds() > gap_ceiling_seconds:
            segments.append((start, previous))
            start = stamp
        previous = stamp
    segments.append((start, previous))
    last_index = len(segments) - 1
    turns: list[AgentTurn] = []
    for index, (segment_start, segment_end) in enumerate(segments):
        if segment_end == segment_start and min_active_seconds > 0:
            segment_end = segment_start + timedelta(seconds=min_active_seconds)
        attach = index == last_index
        turns.append(
            _build_turn(
                provider, session_key, len(turns), segment_start, segment_end, cwd_key, model,
                total_tokens if attach else None,
                tokens_in if attach else None,
                tokens_out if attach else None,
                tokens_cache_read if attach else None,
                tokens_cache_write if attach else None,
                cost_usd if attach else None,
            )
        )
    return [turn for turn in turns if turn.active_seconds > 0]
