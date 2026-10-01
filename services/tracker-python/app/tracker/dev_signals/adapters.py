"""Provider adapters for local agent-session stores.

Each adapter discovers zero or more files and parses them into AgentTurn
values. Missing homes and unknown schemas return empty lists. Payload bodies
are dropped during parse.
"""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
from urllib.parse import quote
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Callable

from .agent_sessions import (
    PROVIDER_AMP,
    PROVIDER_ASIDE,
    PROVIDER_CLAUDE_CODE,
    PROVIDER_CLINE,
    PROVIDER_CODEX,
    PROVIDER_COPILOT,
    PROVIDER_DROID,
    PROVIDER_GEMINI,
    PROVIDER_GOOSE,
    PROVIDER_HERMES,
    PROVIDER_KIMI,
    PROVIDER_OPENCLAW,
    PROVIDER_OPENCODE,
    PROVIDER_PI,
    PROVIDER_ROO,
    PROVIDER_CURSOR_CLI,
    PROVIDER_KIRO,
    PROVIDER_QWEN,
    PROVIDER_ZED,
    DEFAULT_GAP_CEILING_SECONDS,
    UNTERMINATED_TURN_CAP_SECONDS,
    AgentTurn,
    _build_turn,
    _cwd_key,
    _turns_from_stamps,
    parse_claude_session,
    parse_codex_session,
    as_float,
    parse_epoch,
    tokens_from_mapping,
)


@dataclass(frozen=True)
class ProviderAdapter:
    key: str
    discover: Callable[[], list[Path]]
    parse: Callable[[Path], list[AgentTurn]]
    patterns: tuple[str, ...] = ("*.jsonl",)
    # True only when one parsed source returns a complete session. Empty or
    # unreadable sources intentionally leave the last known rows untouched.
    replace_sessions: bool = False


def _existing_file(path: Path) -> Path | None:
    try:
        if path.is_file():
            return path
    except OSError:
        return None
    return None


def _existing_dir(path: Path) -> Path | None:
    try:
        if path.is_dir():
            return path
    except OSError:
        return None
    return None


def discover_codex() -> list[Path]:
    root = Path.home() / ".codex" / "sessions"
    if _existing_dir(root) is None:
        return []
    return [root]


def discover_claude() -> list[Path]:
    root = Path.home() / ".claude" / "projects"
    if _existing_dir(root) is None:
        return []
    return [root]


def discover_aside() -> list[Path]:
    root = Path.home() / ".aside" / "u"
    if _existing_dir(root) is None:
        return []
    found: list[Path] = []
    try:
        users = sorted(root.iterdir())
    except OSError:
        return []
    for user in users:
        db = user / "state.db"
        if _existing_file(db) is not None:
            found.append(db)
    return found


def discover_opencode() -> list[Path]:
    home = Path(os.environ.get("OPENCODE_HOME", "")).expanduser() if os.environ.get("OPENCODE_HOME") else None
    roots: list[Path] = []
    if home is not None:
        roots.append(home)
    roots.extend(
        [
            Path.home() / ".local" / "share" / "opencode",
            Path.home() / ".opencode",
        ]
    )
    found: list[Path] = []
    seen: set[Path] = set()
    for root in roots:
        db = root / "opencode.db"
        if db in seen:
            continue
        if _existing_file(db) is not None:
            found.append(db)
            seen.add(db)
            continue
        messages = root / "storage" / "message"
        if messages in seen:
            continue
        if _existing_dir(messages) is not None:
            found.append(messages)
            seen.add(messages)
    return found


def discover_gemini() -> list[Path]:
    env_home = os.environ.get("GEMINI_CLI_HOME")
    homes = []
    if env_home:
        homes.append(Path(env_home).expanduser())
    homes.append(Path.home() / ".gemini")
    found: list[Path] = []
    for home in homes:
        tmp = home / "tmp"
        if _existing_dir(tmp) is None:
            continue
        try:
            chats_dirs = [path for path in tmp.glob("*/chats") if path.is_dir()]
        except OSError:
            continue
        found.extend(chats_dirs)
        if chats_dirs:
            break
    return found


def _readonly_sqlite(path: Path) -> sqlite3.Connection | None:
    # Live agent DBs are often in WAL mode. `immutable=1` refuses those, so
    # read-only is enough: we never write, and a busy writer just fails this
    # pass instead of crashing ingest.
    encoded = quote(path.expanduser().as_posix(), safe="/")
    uri = f"file:{encoded}?mode=ro"
    try:
        connection = sqlite3.connect(uri, uri=True, timeout=1.0)
    except sqlite3.Error:
        return None
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("PRAGMA busy_timeout = 1000")
        connection.execute("PRAGMA query_only = ON")
    except sqlite3.Error:
        connection.close()
        return None
    return connection


def _table_names(connection: sqlite3.Connection) -> set[str]:
    try:
        rows = connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
    except sqlite3.Error:
        return set()
    return {str(row[0]) for row in rows}


def _cap_unfinished(start: datetime, last_seen: datetime | None) -> datetime:
    if last_seen is None or last_seen < start:
        return start + timedelta(seconds=UNTERMINATED_TURN_CAP_SECONDS)
    observed = (last_seen - start).total_seconds()
    return start + timedelta(seconds=min(max(0.0, observed), float(UNTERMINATED_TURN_CAP_SECONDS)))


def parse_aside_store(path: str | Path) -> list[AgentTurn]:
    """Parse one Aside per-user state.db into turns.

    Reads session_runs plus cwd/model from sessions. Never opens messages,
    passwords, inbox, or the agents/*/sessions hardlink mirror.
    """
    db_path = Path(path).expanduser()
    connection = _readonly_sqlite(db_path)
    if connection is None:
        return []
    try:
        tables = _table_names(connection)
        if "session_runs" not in tables:
            return []
        session_rows: dict[str, sqlite3.Row] = {}
        if "sessions" in tables:
            try:
                for row in connection.execute("SELECT id, cwd, model FROM sessions"):
                    session_id = row["id"]
                    if isinstance(session_id, str) and session_id:
                        session_rows[session_id] = row
            except sqlite3.Error:
                session_rows = {}
        try:
            runs = connection.execute(
                """
                SELECT id, session_id, token_usage, started_at, last_message_timestamp,
                       finished_at, aborted_at
                FROM session_runs
                ORDER BY session_id, started_at, id
                """
            ).fetchall()
        except sqlite3.Error:
            return []
    finally:
        connection.close()

    grouped: dict[str, list[sqlite3.Row]] = {}
    for run in runs:
        session_id = run["session_id"]
        if not isinstance(session_id, str) or not session_id:
            continue
        grouped.setdefault(session_id, []).append(run)

    turns: list[AgentTurn] = []
    for session_id, session_runs in grouped.items():
        session = session_rows.get(session_id)
        cwd_key = _cwd_key(session["cwd"]) if session is not None else None
        model = None
        if session is not None:
            raw_model = session["model"]
            if isinstance(raw_model, str) and raw_model:
                try:
                    parsed_model = json.loads(raw_model)
                except (TypeError, ValueError):
                    parsed_model = None
                if isinstance(parsed_model, dict):
                    candidate = parsed_model.get("modelId") or parsed_model.get("model")
                    if isinstance(candidate, str) and candidate:
                        model = candidate
                else:
                    model = raw_model
        for run in session_runs:
            start = parse_epoch(run["started_at"])
            if start is None:
                continue
            raw_index = run["id"]
            turn_index = raw_index if isinstance(raw_index, int) else 0
            finished = parse_epoch(run["finished_at"]) or parse_epoch(run["aborted_at"])
            if finished is None:
                continue
            end = finished
            if end < start:
                continue
            total, tokens_in, tokens_out, cache_read, cache_write, cost = tokens_from_mapping(
                _load_json_object(run["token_usage"])
            )
            turn = _build_turn(
                PROVIDER_ASIDE,
                session_id,
                turn_index,
                start,
                end,
                cwd_key,
                model,
                total,
                tokens_in,
                tokens_out,
                cache_read,
                cache_write,
                cost,
            )
            if turn.active_seconds > 0:
                turns.append(turn)
    return turns



def _row_value(row, key: str):
    if isinstance(row, dict):
        return row.get(key)
    try:
        return row[key]
    except (KeyError, IndexError, TypeError):
        return None


def _stable_turn_index(*parts: object) -> int:
    payload = chr(31).join("" if part is None else str(part) for part in parts).encode("utf-8")
    return int.from_bytes(hashlib.sha256(payload).digest()[:8], "big") % (2**31 - 1)


def _load_json_object(value: object) -> dict | None:
    if isinstance(value, dict):
        return value
    if isinstance(value, (bytes, bytearray)):
        try:
            value = value.decode("utf-8")
        except UnicodeDecodeError:
            return None
    if isinstance(value, str) and value:
        try:
            parsed = json.loads(value)
        except (TypeError, ValueError):
            return None
        return parsed if isinstance(parsed, dict) else None
    return None


OPENCODE_QUERIES = (
    """
    SELECT sm.id, sm.session_id, sm.data, NULLIF(s.directory, '') AS workspace_root
    FROM session_message sm
    LEFT JOIN session_v2 s ON s.id = sm.session_id
    WHERE sm.type = 'assistant'
      AND json_extract(sm.data, '$.tokens') IS NOT NULL
    ORDER BY sm.session_id, sm.id
    """,
    """
    SELECT sm.id, sm.session_id, sm.data, NULLIF(s.directory, '') AS workspace_root
    FROM session_message sm
    LEFT JOIN session s ON s.id = sm.session_id
    WHERE sm.type = 'assistant'
      AND json_extract(sm.data, '$.tokens') IS NOT NULL
    ORDER BY sm.session_id, sm.id
    """,
    """
    SELECT sm.id, sm.session_id, sm.data, NULL AS workspace_root
    FROM session_message sm
    WHERE sm.type = 'assistant'
      AND json_extract(sm.data, '$.tokens') IS NOT NULL
    ORDER BY sm.session_id, sm.id
    """,
    """
    SELECT m.id, m.session_id, m.data, NULLIF(s.directory, '') AS workspace_root
    FROM message m
    LEFT JOIN session s ON s.id = m.session_id
    WHERE json_extract(m.data, '$.role') = 'assistant'
      AND json_extract(m.data, '$.tokens') IS NOT NULL
    ORDER BY m.session_id, m.id
    """,
)


def parse_opencode_store(path: str | Path) -> list[AgentTurn]:
    target = Path(path).expanduser()
    if target.is_dir():
        return _parse_opencode_message_dir(target)
    if target.suffix.lower() == ".json":
        return _parse_opencode_json_file(target)
    if target.is_file():
        return _parse_opencode_sqlite(target)
    return []


def _parse_opencode_sqlite(db_path: Path) -> list[AgentTurn]:
    connection = _readonly_sqlite(db_path)
    if connection is None:
        return []
    rows: list[sqlite3.Row] = []
    try:
        for query in OPENCODE_QUERIES:
            try:
                candidate = connection.execute(query).fetchall()
            except sqlite3.Error:
                continue
            if candidate:
                rows = candidate
                break
    finally:
        connection.close()
    return _opencode_turns_from_rows(rows)


def _parse_opencode_json_file(path: Path) -> list[AgentTurn]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8", errors="replace"))
    except (OSError, TypeError, ValueError):
        return []
    if not isinstance(payload, dict) or payload.get("role") != "assistant":
        return []
    session_id = payload.get("sessionID") or payload.get("session_id")
    if not isinstance(session_id, str) or not session_id:
        session_id = path.stem
    return _opencode_turns_from_rows(
        [
            {
                "id": payload.get("id") or path.stem,
                "session_id": session_id,
                "data": json.dumps(payload),
                "workspace_root": ((payload.get("path") or {}) if isinstance(payload.get("path"), dict) else {}).get("root"),
            }
        ]
    )


def _parse_opencode_message_dir(root: Path) -> list[AgentTurn]:
    rows: list[dict] = []
    try:
        files = sorted(root.rglob("*.json"))
    except OSError:
        return []
    for file_path in files:
        try:
            payload = json.loads(file_path.read_text(encoding="utf-8", errors="replace"))
        except (OSError, TypeError, ValueError):
            continue
        if not isinstance(payload, dict):
            continue
        if payload.get("role") != "assistant":
            continue
        session_id = payload.get("sessionID") or payload.get("session_id")
        if not isinstance(session_id, str) or not session_id:
            session_id = file_path.stem
        rows.append(
            {
                "id": payload.get("id") or file_path.stem,
                "session_id": session_id,
                "data": json.dumps(payload),
                "workspace_root": ((payload.get("path") or {}) if isinstance(payload.get("path"), dict) else {}).get("root"),
            }
        )
    return _opencode_turns_from_rows(rows)


def _opencode_turns_from_rows(rows: list) -> list[AgentTurn]:
    grouped: dict[str, list] = {}
    for row in rows:
        session_id = row["session_id"] if not isinstance(row, dict) else row.get("session_id")
        if not isinstance(session_id, str) or not session_id:
            continue
        grouped.setdefault(session_id, []).append(row)
    turns: list[AgentTurn] = []
    for session_id, session_rows in grouped.items():
        for row in session_rows:
            data = _load_json_object(_row_value(row, "data"))
            if not isinstance(data, dict):
                continue
            tokens = data.get("tokens")
            total, tokens_in, tokens_out, cache_read, cache_write, cost = tokens_from_mapping(tokens)
            if cost is None:
                cost = as_float(data.get("cost"))
            time_info = data.get("time") if isinstance(data.get("time"), dict) else {}
            start = parse_epoch(time_info.get("created"))
            end = parse_epoch(time_info.get("completed")) or start
            if start is None:
                continue
            if end is None or end < start:
                end = start
            model = data.get("modelID")
            nested_model = data.get("model")
            if not isinstance(model, str) or not model:
                if isinstance(nested_model, dict):
                    model = nested_model.get("id")
                elif isinstance(nested_model, str):
                    model = nested_model
            cwd = _row_value(row, "workspace_root")
            if not cwd:
                path_info = data.get("path")
                if isinstance(path_info, dict):
                    cwd = path_info.get("root")
            message_id = _row_value(row, "id") or data.get("id")
            turn_index = _stable_turn_index(session_id, message_id)
            turn = _build_turn(
                PROVIDER_OPENCODE,
                session_id,
                turn_index,
                start,
                end,
                _cwd_key(cwd),
                model if isinstance(model, str) else None,
                total,
                tokens_in,
                tokens_out,
                cache_read,
                cache_write,
                cost,
            )
            if turn.active_seconds > 0:
                turns.append(turn)
    return turns


def parse_gemini_store(path: str | Path) -> list[AgentTurn]:
    target = Path(path).expanduser()
    if target.is_dir():
        turns: list[AgentTurn] = []
        try:
            files = sorted(p for p in target.iterdir() if p.is_file())
        except OSError:
            return []
        for file_path in files:
            turns.extend(_parse_gemini_file(file_path))
        return _reindex(turns)
    if target.is_file():
        return _reindex(_parse_gemini_file(target))
    return []


def _reindex(turns: list[AgentTurn]) -> list[AgentTurn]:
    grouped: dict[str, list[AgentTurn]] = {}
    for turn in turns:
        grouped.setdefault(turn.session_key, []).append(turn)
    reindexed: list[AgentTurn] = []
    for session_key, session_turns in grouped.items():
        session_turns.sort(key=lambda item: item.started_at)
        for index, turn in enumerate(session_turns):
            reindexed.append(
                AgentTurn(
                    provider=turn.provider,
                    session_key=session_key,
                    turn_index=index,
                    started_at=turn.started_at,
                    ended_at=turn.ended_at,
                    active_seconds=turn.active_seconds,
                    cwd_key=turn.cwd_key,
                    model=turn.model,
                    total_tokens=turn.total_tokens,
                    tokens_in=turn.tokens_in,
                    tokens_out=turn.tokens_out,
                    tokens_cache_read=turn.tokens_cache_read,
                    tokens_cache_write=turn.tokens_cache_write,
                    cost_usd=turn.cost_usd,
                )
            )
    return reindexed


def _parse_gemini_file(path: Path) -> list[AgentTurn]:
    if path.suffix == ".jsonl":
        return _parse_gemini_jsonl(path)
    try:
        raw = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return []
    try:
        payload = json.loads(raw)
    except (TypeError, ValueError):
        return _parse_gemini_jsonl(path)
    if isinstance(payload, dict):
        return _parse_gemini_session_object(payload, path.stem)
    return []


def _parse_gemini_jsonl(path: Path) -> list[AgentTurn]:
    session_key = path.stem
    stamps: list[datetime] = []
    model: str | None = None
    last_usage = None
    try:
        handle = path.open("r", encoding="utf-8", errors="replace")
    except OSError:
        return []
    with handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except (TypeError, ValueError):
                continue
            if not isinstance(record, dict):
                continue
            for key in ("sessionId", "session_id"):
                value = record.get(key)
                if isinstance(value, str) and value:
                    session_key = value
            stamp = parse_epoch(record.get("timestamp") or record.get("startTime") or record.get("lastUpdated"))
            if stamp is not None:
                stamps.append(stamp)
            candidate_model = record.get("model")
            if isinstance(candidate_model, str) and candidate_model:
                model = candidate_model
            usage = record.get("tokens") or record.get("usage")
            if isinstance(usage, dict):
                last_usage = usage
    if not stamps:
        return []
    stamps.sort()
    start = stamps[0]
    end = stamps[-1]
    if end < start:
        end = start
    total, tokens_in, tokens_out, cache_read, cache_write, cost = tokens_from_mapping(last_usage)
    turn = _build_turn(
        PROVIDER_GEMINI, session_key, 0, start, end, None, model, total,
        tokens_in, tokens_out, cache_read, cache_write, cost,
    )
    return [turn] if turn.active_seconds > 0 else []


def _parse_gemini_session_object(payload: dict, fallback_key: str) -> list[AgentTurn]:
    session_key = payload.get("sessionId") or payload.get("session_id") or fallback_key
    if not isinstance(session_key, str) or not session_key:
        session_key = fallback_key
    messages = payload.get("messages")
    stamps: list[datetime] = []
    model: str | None = None
    last_usage = None
    if isinstance(messages, list):
        for message in messages:
            if not isinstance(message, dict):
                continue
            stamp = parse_epoch(message.get("timestamp"))
            if stamp is not None:
                stamps.append(stamp)
            candidate_model = message.get("model")
            if isinstance(candidate_model, str) and candidate_model:
                model = candidate_model
            usage = message.get("tokens") or message.get("usage")
            if isinstance(usage, dict):
                last_usage = usage
    start = parse_epoch(payload.get("startTime"))
    end = parse_epoch(payload.get("lastUpdated"))
    if stamps:
        stamps.sort()
        start = start or stamps[0]
        end = end or stamps[-1]
    if start is None:
        return []
    if end is None or end < start:
        end = start
    total, tokens_in, tokens_out, cache_read, cache_write, cost = tokens_from_mapping(last_usage)
    turn = _build_turn(
        PROVIDER_GEMINI, session_key, 0, start, end, None, model, total,
        tokens_in, tokens_out, cache_read, cache_write, cost,
    )
    return [turn] if turn.active_seconds > 0 else []



def discover_hermes() -> list[Path]:
    found: list[Path] = []
    env_home = os.environ.get("HERMES_HOME")
    homes = []
    if env_home:
        homes.append(Path(env_home).expanduser())
    homes.append(Path.home() / ".hermes")
    for home in homes:
        db = home / "state.db"
        if _existing_file(db) is not None:
            found.append(db)
            break
    return found


def discover_openclaw() -> list[Path]:
    homes = [
        Path.home() / ".openclaw",
        Path.home() / ".clawdbot",
        Path.home() / ".moltbot",
    ]
    found: list[Path] = []
    for home in homes:
        agents = home / "agents"
        if _existing_dir(agents) is None:
            continue
        try:
            session_dirs = [path for path in agents.glob("*/sessions") if path.is_dir()]
        except OSError:
            continue
        found.extend(session_dirs)
    return found


def parse_hermes_store(path: str | Path) -> list[AgentTurn]:
    """Parse Hermes sessions table only. Never open messages or FTS."""
    db_path = Path(path).expanduser()
    connection = _readonly_sqlite(db_path)
    if connection is None:
        return []
    try:
        tables = _table_names(connection)
        if "sessions" not in tables:
            return []
        columns = {row["name"] if isinstance(row, sqlite3.Row) else row[1] for row in connection.execute("PRAGMA table_info(sessions)")}
        select_source = ", source" if "source" in columns else ""
        try:
            rows = connection.execute(
                f"""
                SELECT id, model, started_at, ended_at, cwd,
                       input_tokens, output_tokens, cache_read_tokens,
                       cache_write_tokens, reasoning_tokens,
                       estimated_cost_usd, actual_cost_usd{select_source}
                FROM sessions
                ORDER BY started_at, id
                """
            ).fetchall()
        except sqlite3.Error:
            return []
    finally:
        connection.close()

    turns: list[AgentTurn] = []
    for row in rows:
        session_id = row["id"]
        if not isinstance(session_id, str) or not session_id:
            continue
        try:
            source = row["source"]
        except (KeyError, IndexError, TypeError):
            source = None
        if source == "cron":
            continue
        start = parse_epoch(row["started_at"])
        if start is None:
            continue
        finished = parse_epoch(row["ended_at"])
        if finished is None:
            # An open session has no observed end. Capping it would invent
            # agent time the log does not support.
            continue
        end = finished
        if end < start:
            continue
        tokens_in = row["input_tokens"] if isinstance(row["input_tokens"], int) else None
        tokens_out = row["output_tokens"] if isinstance(row["output_tokens"], int) else None
        cache_read = row["cache_read_tokens"] if isinstance(row["cache_read_tokens"], int) else None
        cache_write = row["cache_write_tokens"] if isinstance(row["cache_write_tokens"], int) else None
        reasoning = row["reasoning_tokens"] if isinstance(row["reasoning_tokens"], int) else None
        if tokens_out is None:
            tokens_out = reasoning
        elif reasoning:
            tokens_out = tokens_out + reasoning
        parts = [part for part in (tokens_in, tokens_out, cache_read, cache_write) if isinstance(part, int)]
        total = sum(parts) if parts else None
        actual = row["actual_cost_usd"]
        estimated = row["estimated_cost_usd"]
        # Prefer a non-zero actual cost, then the estimate, then an explicit 0.
        if isinstance(actual, (int, float)) and actual != 0:
            cost = float(actual)
        elif isinstance(estimated, (int, float)):
            cost = float(estimated)
        elif isinstance(actual, (int, float)):
            cost = float(actual)
        else:
            cost = None
        model = row["model"] if isinstance(row["model"], str) else None
        turn = _build_turn(
            PROVIDER_HERMES,
            session_id,
            0,
            start,
            end,
            _cwd_key(row["cwd"]),
            model,
            total,
            tokens_in,
            tokens_out,
            cache_read,
            cache_write,
            cost,
        )
        if turn.active_seconds > 0:
            turns.append(turn)
    return turns


def parse_openclaw_store(path: str | Path) -> list[AgentTurn]:
    target = Path(path).expanduser()
    if target.is_dir():
        turns: list[AgentTurn] = []
        try:
            files = sorted(target.glob("*.jsonl"))
        except OSError:
            return []
        for file_path in files:
            turns.extend(_parse_openclaw_file(file_path))
        return turns
    if target.is_file():
        return _parse_openclaw_file(target)
    return []


def _parse_openclaw_file(path: Path) -> list[AgentTurn]:
    session_key = path.stem
    cwd_key = None
    model = None
    stamps = []
    last_usage = None
    try:
        handle = path.open("r", encoding="utf-8", errors="replace")
    except OSError:
        return []
    with handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except (TypeError, ValueError):
                continue
            if not isinstance(record, dict):
                continue
            if cwd_key is None:
                cwd_key = _cwd_key(record.get("cwd"))
            candidate_model = record.get("modelId") or record.get("model")
            message = record.get("message") if isinstance(record.get("message"), dict) else {}
            if not isinstance(candidate_model, str) or not candidate_model:
                candidate_model = message.get("model") if isinstance(message, dict) else None
            if isinstance(candidate_model, str) and candidate_model:
                model = candidate_model
            usage = None
            if isinstance(message, dict):
                usage = message.get("usage")
            if usage is None:
                usage = record.get("usage")
            if isinstance(usage, dict):
                last_usage = usage
            stamp = parse_epoch(record.get("timestamp") or (message.get("timestamp") if isinstance(message, dict) else None))
            if stamp is not None:
                stamps.append(stamp)
    total, tokens_in, tokens_out, cache_read, cache_write, cost = tokens_from_mapping(last_usage)
    return _turns_from_stamps(
        PROVIDER_OPENCLAW, session_key, stamps, cwd_key, model,
        total_tokens=total, tokens_in=tokens_in, tokens_out=tokens_out,
        tokens_cache_read=cache_read, tokens_cache_write=cache_write, cost_usd=cost,
    )



def discover_kimi() -> list[Path]:
    homes = [Path.home() / ".kimi", Path.home() / ".kimi-code"]
    found: list[Path] = []
    for home in homes:
        sessions = home / "sessions"
        if _existing_dir(sessions) is None:
            continue
        found.append(sessions)
    return found


def parse_kimi_store(path: str | Path) -> list[AgentTurn]:
    target = Path(path).expanduser()
    if target.is_dir():
        turns: list[AgentTurn] = []
        try:
            files = sorted(target.rglob("wire.jsonl"))
        except OSError:
            return []
        for file_path in files:
            turns.extend(_parse_kimi_file(file_path))
        return turns
    if target.is_file():
        return _parse_kimi_file(target)
    return []


def _parse_kimi_file(path: Path) -> list[AgentTurn]:
    session_key = path.parent.name if path.parent.name else path.stem
    stamps = []
    last_usage = None
    model = None
    try:
        handle = path.open("r", encoding="utf-8", errors="replace")
    except OSError:
        return []
    with handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except (TypeError, ValueError):
                continue
            if not isinstance(record, dict):
                continue
            stamp = parse_epoch(record.get("timestamp"))
            if stamp is not None:
                stamps.append(stamp)
            message = record.get("message") if isinstance(record.get("message"), dict) else {}
            payload = message.get("payload") if isinstance(message.get("payload"), dict) else {}
            usage = payload.get("token_usage") if isinstance(payload, dict) else None
            if usage is None:
                usage = record.get("token_usage") or record.get("usage")
            if isinstance(usage, dict):
                last_usage = {
                    "input": usage.get("input_other") or usage.get("inputOther") or usage.get("input"),
                    "output": usage.get("output"),
                    "cache_read": usage.get("input_cache_read") or usage.get("inputCacheRead"),
                    "cache_write": usage.get("input_cache_creation") or usage.get("inputCacheCreation"),
                }
            candidate_model = record.get("model") or message.get("model")
            if isinstance(candidate_model, str) and candidate_model:
                model = candidate_model
    if model is None:
        model = "kimi-for-coding"
    total, tokens_in, tokens_out, cache_read, cache_write, cost = tokens_from_mapping(last_usage)
    return _turns_from_stamps(
        PROVIDER_KIMI, session_key, stamps, None, model,
        total_tokens=total, tokens_in=tokens_in, tokens_out=tokens_out,
        tokens_cache_read=cache_read, tokens_cache_write=cache_write, cost_usd=cost,
    )



def _append_unique_path(found: list[Path], seen: set[Path], path: Path) -> None:
    if path in seen:
        return
    seen.add(path)
    found.append(path)


def _vscode_global_storage_roots() -> list[Path]:
    home = Path.home()
    roots = [
        home / "Library" / "Application Support" / "Code" / "User" / "globalStorage",
        home / "Library" / "Application Support" / "Cursor" / "User" / "globalStorage",
        home / "Library" / "Application Support" / "Code - Insiders" / "User" / "globalStorage",
        home / ".config" / "Code" / "User" / "globalStorage",
        home / ".vscode-server" / "data" / "User" / "globalStorage",
    ]
    return [root for root in roots if _existing_dir(root) is not None]


def _discover_vscode_task_roots(*extension_ids: str) -> list[Path]:
    found: list[Path] = []
    seen: set[Path] = set()
    for storage in _vscode_global_storage_roots():
        for extension_id in extension_ids:
            tasks = storage / extension_id / "tasks"
            if _existing_dir(tasks) is not None:
                _append_unique_path(found, seen, tasks)
    return found


def _mapping_model(*values: object) -> str | None:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
        if isinstance(value, dict):
            nested = value.get("modelId") or value.get("model") or value.get("model_name") or value.get("id")
            if isinstance(nested, str) and nested.strip():
                return nested.strip()
    return None


def _attr_value(attributes: dict, *keys: str):
    for key in keys:
        if key in attributes:
            return attributes[key]
    return None


def discover_pi() -> list[Path]:
    homes = [
        Path.home() / ".pi" / "agent" / "sessions",
        Path.home() / ".omp" / "agent" / "sessions",
        Path.home() / ".senpi" / "agent" / "sessions",
        Path.home() / ".omo" / "agent" / "sessions",
    ]
    env_home = os.environ.get("SENPI_CODING_AGENT_DIR") or os.environ.get("PI_CONFIG_DIR")
    if env_home:
        homes.insert(0, Path(env_home).expanduser() / "sessions")
    found: list[Path] = []
    seen: set[Path] = set()
    for home in homes:
        if _existing_dir(home) is not None:
            _append_unique_path(found, seen, home)
        profiles = home.parent.parent / "profiles" if home.name == "sessions" else None
        if profiles is not None and _existing_dir(profiles) is not None:
            try:
                for profile in sorted(profiles.glob("*/agent/sessions")):
                    if profile.is_dir():
                        _append_unique_path(found, seen, profile)
            except OSError:
                continue
    return found


def parse_pi_store(path: str | Path) -> list[AgentTurn]:
    target = Path(path).expanduser()
    if target.is_dir():
        turns: list[AgentTurn] = []
        try:
            files = sorted(target.rglob("*.jsonl"))
        except OSError:
            return []
        for file_path in files:
            turns.extend(_parse_pi_file(file_path))
        return turns
    if target.is_file():
        return _parse_pi_file(target)
    return []


def _parse_pi_file(path: Path) -> list[AgentTurn]:
    session_key = path.stem
    cwd_key = None
    model = None
    stamps: list = []
    last_usage = None
    awaiting_session = True
    for record in _iter_json_records(path):
        record_type = record.get("type")
        if awaiting_session:
            if record_type == "title":
                continue
            if record_type != "session":
                return []
            awaiting_session = False
            session_id = record.get("id")
            if isinstance(session_id, str) and session_id:
                session_key = session_id
            if cwd_key is None:
                cwd_key = _cwd_key(record.get("cwd"))
            stamp = parse_epoch(record.get("timestamp"))
            if stamp is not None:
                stamps.append(stamp)
            continue
        stamp = parse_epoch(record.get("timestamp"))
        if stamp is not None:
            stamps.append(stamp)
        message = record.get("message") if isinstance(record.get("message"), dict) else {}
        candidate_model = record.get("model") or message.get("model")
        if isinstance(candidate_model, str) and candidate_model:
            model = candidate_model
        usage = message.get("usage") if isinstance(message, dict) else None
        if usage is None:
            usage = record.get("usage")
        if isinstance(usage, dict):
            last_usage = usage
        if cwd_key is None:
            cwd_key = _cwd_key(record.get("cwd") or message.get("cwd"))
    total, tokens_in, tokens_out, cache_read, cache_write, cost = tokens_from_mapping(last_usage)
    return _turns_from_stamps(
        PROVIDER_PI, session_key, stamps, cwd_key, model,
        total_tokens=total, tokens_in=tokens_in, tokens_out=tokens_out,
        tokens_cache_read=cache_read, tokens_cache_write=cache_write, cost_usd=cost,
    )


def _iter_json_records(path: Path):
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
            except (TypeError, ValueError):
                continue
            if isinstance(record, dict):
                yield record


def discover_droid() -> list[Path]:
    root = Path.home() / ".factory" / "sessions"
    if _existing_dir(root) is None:
        return []
    return [root]


def parse_droid_store(path: str | Path) -> list[AgentTurn]:
    target = Path(path).expanduser()
    if target.is_dir():
        turns: list[AgentTurn] = []
        try:
            files = sorted(target.rglob("*.settings.json"))
        except OSError:
            return []
        if files:
            for file_path in files:
                turns.extend(_parse_droid_settings(file_path))
            return turns
        try:
            jsonl_files = sorted(target.rglob("*.jsonl"))
        except OSError:
            return []
        for file_path in jsonl_files:
            turns.extend(_parse_droid_jsonl(file_path, None))
        return turns
    if target.name.endswith(".settings.json"):
        return _parse_droid_settings(target)
    if target.suffix.lower() == ".jsonl":
        return _parse_droid_jsonl(target, None)
    return []


def _parse_droid_settings(path: Path) -> list[AgentTurn]:
    try:
        payload = _load_json_object(path.read_text(encoding="utf-8", errors="replace"))
    except OSError:
        return []
    if payload is None:
        return []
    model = _mapping_model(payload.get("model"))
    usage = payload.get("tokenUsage") or payload.get("token_usage")
    jsonl_path = path.with_name(path.name.replace(".settings.json", ".jsonl"))
    if jsonl_path.is_file():
        turns = _parse_droid_jsonl(jsonl_path, usage, model=model)
        if turns:
            return turns
    start = parse_epoch(payload.get("providerLockTimestamp") or payload.get("updatedAt") or payload.get("createdAt"))
    if start is None:
        try:
            start = parse_epoch(path.stat().st_mtime)
        except OSError:
            return []
    last_seen = None
    try:
        last_seen = parse_epoch(path.stat().st_mtime)
    except OSError:
        last_seen = None
    if last_seen is None or last_seen < start:
        end = start + timedelta(seconds=1)
    else:
        end = _cap_unfinished(start, last_seen)
        if end == start:
            end = start + timedelta(seconds=1)
    total, tokens_in, tokens_out, cache_read, cache_write, cost = tokens_from_mapping(usage if isinstance(usage, dict) else None)
    session_key = path.name.replace(".settings.json", "")
    turn = _build_turn(
        PROVIDER_DROID, session_key, 0, start, end, None, model, total,
        tokens_in, tokens_out, cache_read, cache_write, cost,
    )
    return [turn] if turn.active_seconds > 0 else []


def _parse_droid_jsonl(path: Path, usage: object, model: str | None = None) -> list[AgentTurn]:
    session_key = path.stem
    cwd_key = None
    stamps = []
    last_usage = usage if isinstance(usage, dict) else None
    resolved_model = model
    for record in _iter_json_records(path):
        stamp = parse_epoch(record.get("timestamp"))
        if stamp is not None:
            stamps.append(stamp)
        if cwd_key is None:
            cwd_key = _cwd_key(record.get("cwd"))
        message = record.get("message") if isinstance(record.get("message"), dict) else {}
        candidate_model = record.get("model") or message.get("model")
        if isinstance(candidate_model, str) and candidate_model:
            resolved_model = candidate_model
        nested_usage = message.get("usage") if isinstance(message, dict) else None
        if nested_usage is None:
            nested_usage = record.get("usage") or record.get("tokenUsage")
        if isinstance(nested_usage, dict):
            last_usage = nested_usage
    total, tokens_in, tokens_out, cache_read, cache_write, cost = tokens_from_mapping(last_usage)
    return _turns_from_stamps(
        PROVIDER_DROID, session_key, stamps, cwd_key, resolved_model,
        total_tokens=total, tokens_in=tokens_in, tokens_out=tokens_out,
        tokens_cache_read=cache_read, tokens_cache_write=cache_write, cost_usd=cost,
    )


def discover_amp() -> list[Path]:
    roots = [
        Path.home() / ".local" / "share" / "amp" / "threads",
        Path.home() / "Library" / "Application Support" / "amp" / "threads",
    ]
    found: list[Path] = []
    seen: set[Path] = set()
    for root in roots:
        if _existing_dir(root) is not None:
            _append_unique_path(found, seen, root)
    return found


def parse_amp_store(path: str | Path) -> list[AgentTurn]:
    target = Path(path).expanduser()
    if target.is_dir():
        turns: list[AgentTurn] = []
        try:
            files = sorted(target.glob("T-*.json"))
        except OSError:
            return []
        for file_path in files:
            turns.extend(_parse_amp_file(file_path))
        return turns
    if target.is_file():
        return _parse_amp_file(target)
    return []


def _parse_amp_file(path: Path) -> list[AgentTurn]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8", errors="replace"))
    except (OSError, TypeError, ValueError):
        return []
    if not isinstance(payload, dict):
        return []
    session_key = payload.get("id") if isinstance(payload.get("id"), str) and payload.get("id") else path.stem
    stamps = []
    last_usage = None
    model = None
    cost = None
    ledger = payload.get("usageLedger") if isinstance(payload.get("usageLedger"), dict) else {}
    events = ledger.get("events") if isinstance(ledger, dict) else None
    has_ledger = isinstance(events, list) and any(isinstance(event, dict) for event in events)
    if has_ledger:
        for event in events:
            if not isinstance(event, dict):
                continue
            stamp = parse_epoch(event.get("timestamp"))
            if stamp is not None:
                stamps.append(stamp)
            candidate_model = event.get("model")
            if isinstance(candidate_model, str) and candidate_model:
                model = candidate_model
            tokens = event.get("tokens")
            if isinstance(tokens, dict):
                last_usage = tokens
            event_cost = as_float(event.get("credits"))
            if event_cost is not None:
                cost = event_cost if cost is None else cost + event_cost
    else:
        messages = payload.get("messages")
        if isinstance(messages, list):
            for message in messages:
                if not isinstance(message, dict):
                    continue
                usage = message.get("usage")
                if not isinstance(usage, dict):
                    continue
                last_usage = usage
                stamp = parse_epoch(message.get("timestamp") or usage.get("timestamp"))
                if stamp is not None:
                    stamps.append(stamp)
                candidate_model = usage.get("model") or message.get("model")
                if isinstance(candidate_model, str) and candidate_model:
                    model = candidate_model
                event_cost = as_float(usage.get("credits"))
                if event_cost is not None:
                    cost = event_cost if cost is None else cost + event_cost
    if not stamps:
        return []
    total, tokens_in, tokens_out, cache_read, cache_write, mapped_cost = tokens_from_mapping(last_usage)
    return _turns_from_stamps(
        PROVIDER_AMP, session_key, stamps, None, model,
        total_tokens=total, tokens_in=tokens_in, tokens_out=tokens_out,
        tokens_cache_read=cache_read, tokens_cache_write=cache_write,
        cost_usd=mapped_cost if mapped_cost is not None else cost,
        min_active_seconds=1,
    )


def discover_copilot() -> list[Path]:
    env_path = os.environ.get("COPILOT_OTEL_FILE_EXPORTER_PATH")
    found: list[Path] = []
    seen: set[Path] = set()
    if env_path:
        candidate = Path(env_path).expanduser()
        if candidate.is_file() or candidate.is_dir():
            _append_unique_path(found, seen, candidate)
    root = Path.home() / ".copilot" / "otel"
    if _existing_dir(root) is not None:
        _append_unique_path(found, seen, root)
    return found


def parse_copilot_store(path: str | Path) -> list[AgentTurn]:
    target = Path(path).expanduser()
    if target.is_dir():
        turns: list[AgentTurn] = []
        try:
            files = sorted(target.glob("*.jsonl"))
        except OSError:
            return []
        for file_path in files:
            turns.extend(_parse_copilot_file(file_path))
        return turns
    if target.is_file():
        return _parse_copilot_file(target)
    return []


def _otel_end(record: dict, start: datetime) -> datetime | None:
    end = parse_epoch(record.get("endTimeUnixNano") or record.get("end_time"))
    if end is not None:
        return end
    nano = as_float(record.get("durationNano"))
    if nano is not None and nano >= 0:
        return start + timedelta(seconds=nano / 1_000_000_000.0)
    millis = as_float(record.get("duration_ms") or record.get("durationMillis"))
    if millis is not None and millis >= 0:
        return start + timedelta(milliseconds=millis)
    return None


def _parse_copilot_file(path: Path) -> list[AgentTurn]:
    turns: list[AgentTurn] = []
    seen_traces: set[str] = set()
    for index, record in enumerate(_iter_json_records(path)):
        attributes = record.get("attributes")
        if not isinstance(attributes, dict):
            continue
        usage = {
            "input_tokens": _attr_value(attributes, "gen_ai.usage.input_tokens", "input_tokens"),
            "output_tokens": _attr_value(attributes, "gen_ai.usage.output_tokens", "output_tokens"),
            "cache_read_input_tokens": _attr_value(
                attributes,
                "gen_ai.usage.cache_read.input_tokens",
                "gen_ai.usage.cache_read_input_tokens",
            ),
            "cache_creation_input_tokens": _attr_value(
                attributes,
                "gen_ai.usage.cache_creation.input_tokens",
                "gen_ai.usage.cache_creation_input_tokens",
            ),
        }
        total, tokens_in, tokens_out, cache_read, cache_write, cost = tokens_from_mapping(usage)
        if all(value is None for value in (total, tokens_in, tokens_out, cache_read, cache_write)):
            continue
        start = parse_epoch(
            record.get("startTimeUnixNano")
            or record.get("timeUnixNano")
            or attributes.get("start_time")
            or record.get("timestamp")
        )
        if start is None:
            continue
        end = _otel_end(record, start)
        if end is None:
            end = start + timedelta(seconds=1)
        if end < start:
            continue
        if end == start:
            end = start + timedelta(seconds=1)
        session_key = (
            _attr_value(attributes, "session.id", "gen_ai.conversation.id", "gen_ai.session.id")
            or record.get("traceId")
            or path.stem
        )
        if not isinstance(session_key, str) or not session_key:
            session_key = path.stem
        trace_id = record.get("traceId") or record.get("trace_id") or attributes.get("trace_id")
        if isinstance(trace_id, str) and trace_id:
            if trace_id in seen_traces:
                continue
            seen_traces.add(trace_id)
        model = _mapping_model(
            _attr_value(attributes, "gen_ai.request.model", "gen_ai.response.model", "model")
        )
        turn = _build_turn(
            PROVIDER_COPILOT,
            str(session_key),
            _stable_turn_index(session_key, start.isoformat(), index),
            start, end, None, model, total,
            tokens_in, tokens_out, cache_read, cache_write, cost,
        )
        if turn.active_seconds > 0:
            turns.append(turn)
    return turns


def discover_cline() -> list[Path]:
    return _discover_vscode_task_roots(
        "saoudrizwan.claude-dev",
        "saoudrizwan.claude-dev-nightly",
    )


def discover_roo() -> list[Path]:
    return _discover_vscode_task_roots(
        "rooveterinaryinc.roo-cline",
        "kilocode.kilo-code",
    )


def parse_cline_store(path: str | Path) -> list[AgentTurn]:
    return _parse_vscode_task_store(path, PROVIDER_CLINE)


def parse_roo_store(path: str | Path) -> list[AgentTurn]:
    return _parse_vscode_task_store(path, PROVIDER_ROO)


def _parse_vscode_task_store(path: str | Path, provider: str) -> list[AgentTurn]:
    target = Path(path).expanduser()
    if target.is_dir():
        turns: list[AgentTurn] = []
        try:
            files = sorted(target.rglob("ui_messages.json"))
        except OSError:
            return []
        for file_path in files:
            turns.extend(_parse_vscode_ui_messages(file_path, provider))
        return turns
    if target.is_file():
        return _parse_vscode_ui_messages(target, provider)
    return []


def _parse_vscode_ui_messages(path: Path, provider: str) -> list[AgentTurn]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8", errors="replace"))
    except (OSError, TypeError, ValueError):
        return []
    entries = payload if isinstance(payload, list) else []
    session_key = path.parent.name if path.parent.name else path.stem
    model = None
    turns: list[AgentTurn] = []
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            continue
        if entry.get("type") != "say" or entry.get("say") != "api_req_started":
            continue
        stamp = parse_epoch(entry.get("ts") or entry.get("timestamp"))
        if stamp is None:
            continue
        raw_text = entry.get("text")
        usage = _load_json_object(raw_text) if isinstance(raw_text, str) else (raw_text if isinstance(raw_text, dict) else None)
        if usage is None:
            continue
        total, tokens_in, tokens_out, cache_read, cache_write, cost = tokens_from_mapping(usage)
        end = stamp + timedelta(seconds=1)
        if index + 1 < len(entries) and isinstance(entries[index + 1], dict):
            nxt = parse_epoch(entries[index + 1].get("ts") or entries[index + 1].get("timestamp"))
            if nxt is not None and nxt >= stamp:
                gap = (nxt - stamp).total_seconds()
                if 0 < gap <= DEFAULT_GAP_CEILING_SECONDS:
                    end = nxt
        turn = _build_turn(
            provider, session_key, index, stamp, end, None, model, total,
            tokens_in, tokens_out, cache_read, cache_write, cost,
        )
        if turn.active_seconds > 0:
            turns.append(turn)
    return turns


def discover_goose() -> list[Path]:
    env_root = os.environ.get("GOOSE_PATH_ROOT")
    homes = []
    if env_root:
        homes.append(Path(env_root).expanduser() / "data" / "sessions" / "sessions.db")
    homes.extend(
        [
            Path.home() / ".local" / "share" / "goose" / "sessions" / "sessions.db",
            Path.home() / "Library" / "Application Support" / "goose" / "sessions" / "sessions.db",
            Path.home() / ".local" / "share" / "Block" / "goose" / "sessions" / "sessions.db",
        ]
    )
    found: list[Path] = []
    seen: set[Path] = set()
    for db in homes:
        if _existing_file(db) is not None:
            _append_unique_path(found, seen, db)
    return found


def parse_goose_store(path: str | Path) -> list[AgentTurn]:
    db_path = Path(path).expanduser()
    connection = _readonly_sqlite(db_path)
    if connection is None:
        return []
    try:
        tables = _table_names(connection)
        if "sessions" not in tables:
            return []
        columns = {row[1] for row in connection.execute("PRAGMA table_info(sessions)")}
        needed = {"id", "created_at"}
        if not needed.issubset(columns):
            return []
        select_cols = [
            "id",
            "created_at",
            "model_config_json" if "model_config_json" in columns else "NULL AS model_config_json",
            "provider_name" if "provider_name" in columns else "NULL AS provider_name",
            "total_tokens" if "total_tokens" in columns else "NULL AS total_tokens",
            "input_tokens" if "input_tokens" in columns else "NULL AS input_tokens",
            "output_tokens" if "output_tokens" in columns else "NULL AS output_tokens",
            "accumulated_total_tokens" if "accumulated_total_tokens" in columns else "NULL AS accumulated_total_tokens",
            "accumulated_input_tokens" if "accumulated_input_tokens" in columns else "NULL AS accumulated_input_tokens",
            "accumulated_output_tokens" if "accumulated_output_tokens" in columns else "NULL AS accumulated_output_tokens",
            "updated_at" if "updated_at" in columns else "NULL AS updated_at",
            "ended_at" if "ended_at" in columns else "NULL AS ended_at",
            "working_dir" if "working_dir" in columns else ("cwd" if "cwd" in columns else "NULL AS working_dir"),
        ]
        try:
            rows = connection.execute(
                f"SELECT {', '.join(select_cols)} FROM sessions ORDER BY created_at, id"
            ).fetchall()
        except sqlite3.Error:
            return []
    finally:
        connection.close()
    turns: list[AgentTurn] = []
    for row in rows:
        session_id = row["id"]
        if not isinstance(session_id, str) or not session_id:
            continue
        start = parse_epoch(row["created_at"])
        if start is None:
            continue
        finished = parse_epoch(row["ended_at"])
        if finished is None:
            updated = parse_epoch(row["updated_at"])
            if updated is None:
                continue
            finished = _cap_unfinished(start, updated)
        if finished < start:
            continue
        model = None
        config = _load_json_object(row["model_config_json"])
        if isinstance(config, dict):
            model = _mapping_model(config.get("model_name"), config.get("model"))
        tokens_in = row["accumulated_input_tokens"] if isinstance(row["accumulated_input_tokens"], int) else row["input_tokens"]
        tokens_out = row["accumulated_output_tokens"] if isinstance(row["accumulated_output_tokens"], int) else row["output_tokens"]
        total = row["accumulated_total_tokens"] if isinstance(row["accumulated_total_tokens"], int) else row["total_tokens"]
        if not isinstance(tokens_in, int):
            tokens_in = None
        if not isinstance(tokens_out, int):
            tokens_out = None
        if not isinstance(total, int):
            parts = [part for part in (tokens_in, tokens_out) if isinstance(part, int)]
            total = sum(parts) if parts else None
        turn = _build_turn(
            PROVIDER_GOOSE, session_id, 0, start, finished, _cwd_key(row["working_dir"]), model, total,
            tokens_in if isinstance(tokens_in, int) else None,
            tokens_out if isinstance(tokens_out, int) else None,
            None, None, None,
        )
        if turn.active_seconds > 0:
            turns.append(turn)
    return turns


def discover_zed() -> list[Path]:
    homes = [
        Path.home() / "Library" / "Application Support" / "Zed" / "threads" / "threads.db",
        Path.home() / ".local" / "share" / "zed" / "threads" / "threads.db",
    ]
    xdg = os.environ.get("XDG_DATA_HOME")
    if xdg:
        homes.insert(0, Path(xdg).expanduser() / "zed" / "threads" / "threads.db")
    found: list[Path] = []
    seen: set[Path] = set()
    for db in homes:
        if _existing_file(db) is not None:
            _append_unique_path(found, seen, db)
    return found


def parse_zed_store(path: str | Path) -> list[AgentTurn]:
    db_path = Path(path).expanduser()
    connection = _readonly_sqlite(db_path)
    if connection is None:
        return []
    try:
        tables = _table_names(connection)
        if "threads" not in tables:
            return []
        columns = {row[1] for row in connection.execute("PRAGMA table_info(threads)")}
        if "id" not in columns or "updated_at" not in columns:
            return []
        created = "created_at" if "created_at" in columns else "NULL"
        folder = "folder_paths" if "folder_paths" in columns else "NULL"
        data_type = "data_type" if "data_type" in columns else "'json'"
        data = "data" if "data" in columns else "NULL"
        try:
            rows = connection.execute(
                f"SELECT id, updated_at, {created} AS created_at, {folder} AS folder_paths, {data_type} AS data_type, {data} AS data FROM threads"
            ).fetchall()
        except sqlite3.Error:
            return []
    finally:
        connection.close()
    turns: list[AgentTurn] = []
    for row in rows:
        session_id = row["id"]
        if not isinstance(session_id, str) or not session_id:
            continue
        payload = row["data"]
        thread = None
        data_type = row["data_type"] if isinstance(row["data_type"], str) else "json"
        if isinstance(payload, (bytes, bytearray, str)) and str(data_type).lower() == "json":
            thread = _load_json_object(payload if not isinstance(payload, bytes) else payload.decode("utf-8", "replace"))
        if not isinstance(thread, dict):
            continue
        if thread.get("imported") is True:
            continue
        model_info = thread.get("model") if isinstance(thread.get("model"), dict) else {}
        provider = model_info.get("provider") if isinstance(model_info, dict) else None
        if not isinstance(provider, str) or provider.lower() != "zed.dev":
            continue
        model = _mapping_model(model_info.get("model") if isinstance(model_info, dict) else None)
        request_stamps = []
        usages = []
        requests = thread.get("requests") if isinstance(thread.get("requests"), list) else []
        for request in requests:
            if not isinstance(request, dict):
                continue
            stamp = parse_epoch(request.get("timestamp") or request.get("created_at") or request.get("updated_at"))
            if stamp is not None:
                request_stamps.append(stamp)
            if isinstance(request.get("token_usage"), dict):
                usages.append(request["token_usage"])
        if not usages and isinstance(thread.get("token_usage"), dict):
            usages.append(thread["token_usage"])
        usage_total = {"input_tokens": 0, "output_tokens": 0, "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0}
        for usage in usages:
            total, tokens_in, tokens_out, cache_read, cache_write, _ = tokens_from_mapping(usage)
            if tokens_in:
                usage_total["input_tokens"] += tokens_in
            if tokens_out:
                usage_total["output_tokens"] += tokens_out
            if cache_read:
                usage_total["cache_read_input_tokens"] += cache_read
            if cache_write:
                usage_total["cache_creation_input_tokens"] += cache_write
            if total and tokens_in is None and tokens_out is None:
                usage_total["input_tokens"] += total
        cwd_key = None
        folders = row["folder_paths"]
        if isinstance(folders, str) and folders:
            try:
                parsed_folders = json.loads(folders)
            except (TypeError, ValueError):
                parsed_folders = folders
            if isinstance(parsed_folders, list) and parsed_folders:
                cwd_key = _cwd_key(parsed_folders[0])
            elif isinstance(parsed_folders, str):
                cwd_key = _cwd_key(parsed_folders)
        total, tokens_in, tokens_out, cache_read, cache_write, cost = tokens_from_mapping(usage_total)
        if request_stamps:
            turns.extend(_turns_from_stamps(
                PROVIDER_ZED, session_id, request_stamps, cwd_key, model,
                total_tokens=total, tokens_in=tokens_in, tokens_out=tokens_out,
                tokens_cache_read=cache_read, tokens_cache_write=cache_write, cost_usd=cost,
            ))
            continue
        start = parse_epoch(row["created_at"]) or parse_epoch(row["updated_at"])
        if start is None:
            continue
        end = _cap_unfinished(start, parse_epoch(row["updated_at"]))
        if end < start:
            continue
        turn = _build_turn(
            PROVIDER_ZED, session_id, 0, start, end, cwd_key, model, total,
            tokens_in, tokens_out, cache_read, cache_write, cost,
        )
        if turn.active_seconds > 0:
            turns.append(turn)
    return turns



def discover_qwen() -> list[Path]:
    homes = []
    env_home = os.environ.get("QWEN_DATA_DIR") or os.environ.get("QWEN_HOME")
    if env_home:
        homes.append(Path(env_home).expanduser())
    homes.append(Path.home() / ".qwen")
    found: list[Path] = []
    seen: set[Path] = set()
    for home in homes:
        projects = home / "projects"
        if _existing_dir(projects) is not None:
            _append_unique_path(found, seen, projects)
    return found


def parse_qwen_store(path: str | Path) -> list[AgentTurn]:
    target = Path(path).expanduser()
    if target.is_dir():
        turns: list[AgentTurn] = []
        try:
            files = sorted(target.rglob("*.jsonl"))
        except OSError:
            return []
        for file_path in files:
            if file_path.parent.name != "chats":
                continue
            turns.extend(_parse_qwen_file(file_path))
        return turns
    if target.is_file():
        return _parse_qwen_file(target)
    return []


def _parse_qwen_file(path: Path) -> list[AgentTurn]:
    session_key = path.stem
    parent = path.parent
    if parent.name == "chats" and parent.parent.name:
        session_key = f"{parent.parent.name}-{path.stem}"
    cwd_key = _cwd_key(parent.parent.name) if parent.name == "chats" else None
    stamps = []
    last_usage = None
    model = None
    for record in _iter_json_records(path):
        if cwd_key is None:
            cwd_key = _cwd_key(record.get("cwd"))
        session_id = record.get("sessionId") or record.get("session_id")
        if isinstance(session_id, str) and session_id:
            session_key = session_id
        usage = record.get("usageMetadata") or record.get("usage_metadata")
        if not isinstance(usage, dict):
            continue
        if record.get("type") not in (None, "assistant"):
            continue
        stamp = parse_epoch(record.get("timestamp"))
        if stamp is not None:
            stamps.append(stamp)
        candidate_model = record.get("model")
        if isinstance(candidate_model, str) and candidate_model:
            model = candidate_model
        last_usage = {
            "promptTokenCount": usage.get("promptTokenCount"),
            "candidatesTokenCount": usage.get("candidatesTokenCount"),
            "cachedContentTokenCount": usage.get("cachedContentTokenCount"),
            "totalTokenCount": usage.get("totalTokenCount"),
        }
    if not stamps:
        return []
    total, tokens_in, tokens_out, cache_read, cache_write, cost = tokens_from_mapping(last_usage)
    return _turns_from_stamps(
        PROVIDER_QWEN, session_key, stamps, cwd_key, model,
        total_tokens=total, tokens_in=tokens_in, tokens_out=tokens_out,
        tokens_cache_read=cache_read, tokens_cache_write=cache_write, cost_usd=cost,
        min_active_seconds=1,
    )


def discover_kiro() -> list[Path]:
    found: list[Path] = []
    seen: set[Path] = set()
    cli = Path.home() / ".kiro" / "sessions" / "cli"
    if _existing_dir(cli) is not None:
        _append_unique_path(found, seen, cli)
    sqlite = Path.home() / "Library" / "Application Support" / "kiro-cli" / "data.sqlite3"
    if _existing_file(sqlite) is not None:
        _append_unique_path(found, seen, sqlite)
    return found


def parse_kiro_store(path: str | Path) -> list[AgentTurn]:
    target = Path(path).expanduser()
    if target.suffix.lower() in {".sqlite3", ".db"} or target.name == "data.sqlite3":
        return _parse_kiro_sqlite(target)
    if target.is_dir():
        turns: list[AgentTurn] = []
        try:
            json_files = sorted(target.rglob("*.json"))
        except OSError:
            return []
        for file_path in json_files:
            if file_path.name == "session.json":
                # IDE transcripts are prompt-bearing and currently lack real
                # token/time fields. Skip rather than invent agent time.
                continue
            if file_path.suffix.lower() == ".json":
                turns.extend(_parse_kiro_cli_header(file_path))
        return turns
    if target.name == "session.json":
        return []
    if target.suffix.lower() == ".json":
        return _parse_kiro_cli_header(target)
    return []


def _parse_kiro_cli_header(path: Path) -> list[AgentTurn]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8", errors="replace"))
    except (OSError, TypeError, ValueError):
        return []
    if not isinstance(payload, dict):
        return []
    session_key = payload.get("session_id") if isinstance(payload.get("session_id"), str) and payload.get("session_id") else path.stem
    cwd_key = _cwd_key(payload.get("cwd"))
    model = None
    state = payload.get("session_state") if isinstance(payload.get("session_state"), dict) else {}
    model_info = ((state.get("rts_model_state") or {}) if isinstance(state, dict) else {})
    if isinstance(model_info, dict):
        info = model_info.get("model_info") if isinstance(model_info.get("model_info"), dict) else {}
        model = _mapping_model(info.get("model_id") if isinstance(info, dict) else None)
    if not isinstance(state, dict) or not state:
        return []
    metadata = state.get("conversation_metadata") if isinstance(state.get("conversation_metadata"), dict) else {}
    turns_meta = metadata.get("user_turn_metadatas") if isinstance(metadata, dict) else None
    if not isinstance(turns_meta, list):
        return []
    turns: list[AgentTurn] = []
    for index, item in enumerate(turns_meta):
        if not isinstance(item, dict):
            continue
        tokens_in = item.get("input_token_count") if isinstance(item.get("input_token_count"), int) else None
        tokens_out = item.get("output_token_count") if isinstance(item.get("output_token_count"), int) else None
        if not tokens_in and not tokens_out:
            continue
        end = parse_epoch(item.get("end_timestamp"))
        start = parse_epoch(item.get("start_timestamp"))
        duration = as_float(item.get("turn_duration"))
        if start is None and end is not None and duration is not None and duration >= 0:
            # turn_duration is milliseconds in current Kiro headers.
            start = end - timedelta(milliseconds=duration if duration > 10 else duration * 1000)
        if start is None and end is not None:
            start = end - timedelta(seconds=1)
        if end is None and start is not None:
            end = start + timedelta(seconds=1)
        if start is None or end is None or end < start:
            continue
        if end == start:
            end = start + timedelta(seconds=1)
        total = None
        parts = [part for part in (tokens_in, tokens_out) if isinstance(part, int)]
        if parts:
            total = sum(parts)
        turn = _build_turn(
            PROVIDER_KIRO, str(session_key), index, start, end, cwd_key, model, total,
            tokens_in, tokens_out, None, None, None,
        )
        if turn.active_seconds > 0:
            turns.append(turn)
    return turns


def _parse_kiro_sqlite(path: Path) -> list[AgentTurn]:
    connection = _readonly_sqlite(path)
    if connection is None:
        return []
    try:
        tables = _table_names(connection)
        if "conversations_v2" not in tables:
            return []
        try:
            rows = connection.execute("SELECT key, conversation_id, value FROM conversations_v2").fetchall()
        except sqlite3.Error:
            return []
    finally:
        connection.close()
    turns: list[AgentTurn] = []
    for row in rows:
        payload = _load_json_object(row["value"])
        if not isinstance(payload, dict):
            continue
        session_key = row["conversation_id"] if isinstance(row["conversation_id"], str) else None
        if not session_key:
            continue
        cwd_key = _cwd_key(row["key"])
        model = None
        info = payload.get("model_info") if isinstance(payload.get("model_info"), dict) else {}
        if isinstance(info, dict):
            model = _mapping_model(info.get("model_id"))
        history = payload.get("history") if isinstance(payload.get("history"), list) else []
        for index, item in enumerate(history):
            if not isinstance(item, dict):
                continue
            meta = item.get("request_metadata") if isinstance(item.get("request_metadata"), dict) else {}
            tokens_in = meta.get("input_token_count") if isinstance(meta.get("input_token_count"), int) else None
            tokens_out = meta.get("output_token_count") if isinstance(meta.get("output_token_count"), int) else None
            if not tokens_in and not tokens_out:
                continue
            stamp = parse_epoch(meta.get("end_timestamp") or item.get("timestamp"))
            if stamp is None:
                continue
            start = stamp - timedelta(seconds=1)
            total = sum(part for part in (tokens_in, tokens_out) if isinstance(part, int))
            turn = _build_turn(
                PROVIDER_KIRO, session_key, index, start, stamp, cwd_key, model, total,
                tokens_in, tokens_out, None, None, None,
            )
            if turn.active_seconds > 0:
                turns.append(turn)
    return turns


def discover_cursor_cli() -> list[Path]:
    found: list[Path] = []
    seen: set[Path] = set()
    chats = Path.home() / ".cursor" / "chats"
    if _existing_dir(chats) is not None:
        _append_unique_path(found, seen, chats)
    return found


def parse_cursor_cli_store(path: str | Path) -> list[AgentTurn]:
    target = Path(path).expanduser()
    if target.is_dir():
        turns: list[AgentTurn] = []
        try:
            files = sorted(target.rglob("store.db"))
        except OSError:
            return []
        for file_path in files:
            turns.extend(_parse_cursor_cli_db(file_path))
        return turns
    if target.name == "store.db" or target.suffix.lower() == ".db":
        return _parse_cursor_cli_db(target)
    return []


def _parse_cursor_cli_db(path: Path) -> list[AgentTurn]:
    connection = _readonly_sqlite(path)
    if connection is None:
        return []
    try:
        tables = _table_names(connection)
        session_table = None
        for candidate in ("sessions", "session"):
            if candidate in tables:
                session_table = candidate
                break
        if session_table is None:
            return []
        columns = {row[1] for row in connection.execute(f"PRAGMA table_info({session_table})")}
        id_col = next((name for name in ("id", "session_id", "thread_id", "chat_id") if name in columns), None)
        if id_col is None:
            return []
        created_col = next((name for name in ("created_at", "createdAt", "started_at", "created") if name in columns), None)
        updated_col = next((name for name in ("updated_at", "updatedAt", "ended_at", "last_message_at", "mtime") if name in columns), None)
        cwd_col = next((name for name in ("cwd", "directory", "workspace", "root_path") if name in columns), None)
        model_col = next((name for name in ("model", "model_id", "modelId") if name in columns), None)
        select = [id_col]
        aliases = {id_col: "id"}
        for col, alias in ((created_col, "created_at"), (updated_col, "updated_at"), (cwd_col, "cwd"), (model_col, "model")):
            if col:
                select.append(f"{col} AS {alias}" if col != alias else col)
                aliases[alias] = alias
        try:
            rows = connection.execute(f"SELECT {', '.join(select)} FROM {session_table}").fetchall()
        except sqlite3.Error:
            return []
        # Never open blobs/messages tables even if present.
    finally:
        connection.close()
    session_key_prefix = path.parent.name
    turns: list[AgentTurn] = []
    for row in rows:
        raw_id = row["id"] if "id" in row.keys() else None
        if raw_id is None:
            continue
        session_key = f"{session_key_prefix}:{raw_id}" if session_key_prefix else str(raw_id)
        start = parse_epoch(row["created_at"]) if "created_at" in row.keys() else None
        end = parse_epoch(row["updated_at"]) if "updated_at" in row.keys() else None
        if start is None or end is None:
            continue
        if end < start:
            continue
        observed = (end - start).total_seconds()
        if observed > UNTERMINATED_TURN_CAP_SECONDS:
            end = start + timedelta(seconds=UNTERMINATED_TURN_CAP_SECONDS)
        if end == start:
            end = start + timedelta(seconds=1)
        cwd_key = _cwd_key(row["cwd"]) if "cwd" in row.keys() else _cwd_key(path.parent.parent.name)
        model = row["model"] if "model" in row.keys() and isinstance(row["model"], str) else None
        turn = _build_turn(
            PROVIDER_CURSOR_CLI, session_key, 0, start, end, cwd_key, model, None,
            None, None, None, None, None,
        )
        if turn.active_seconds > 0:
            turns.append(turn)
    return turns


def parse_jsonl_tree(parser: Callable[[Path], list[AgentTurn]], root: Path) -> list[AgentTurn]:
    if root.is_file():
        return parser(root)
    if not root.is_dir():
        return []
    turns: list[AgentTurn] = []
    try:
        files = sorted(root.rglob("*.jsonl"))
    except OSError:
        return []
    for file_path in files:
        try:
            turns.extend(parser(file_path))
        except Exception:
            continue
    return turns


PROVIDERS: tuple[ProviderAdapter, ...] = (
    ProviderAdapter(
        PROVIDER_CODEX,
        discover_codex,
        lambda path: parse_jsonl_tree(lambda file: parse_codex_session(file, raise_io_errors=True), path),
        replace_sessions=True,
    ),
    ProviderAdapter(PROVIDER_CLAUDE_CODE, discover_claude, lambda path: parse_jsonl_tree(lambda file: parse_claude_session(file, raise_io_errors=True), path)),
    ProviderAdapter(PROVIDER_ASIDE, discover_aside, parse_aside_store, ("*.db",)),
    ProviderAdapter(PROVIDER_OPENCODE, discover_opencode, parse_opencode_store, ("*.db", "*.json")),
    ProviderAdapter(PROVIDER_GEMINI, discover_gemini, parse_gemini_store, ("*.json", "*.jsonl")),
    ProviderAdapter(PROVIDER_HERMES, discover_hermes, parse_hermes_store, ("*.db",)),
    ProviderAdapter(PROVIDER_OPENCLAW, discover_openclaw, parse_openclaw_store),
    ProviderAdapter(PROVIDER_KIMI, discover_kimi, parse_kimi_store, ("wire.jsonl",)),
    ProviderAdapter(PROVIDER_PI, discover_pi, parse_pi_store),
    ProviderAdapter(PROVIDER_DROID, discover_droid, parse_droid_store, ("*.settings.json",)),
    ProviderAdapter(PROVIDER_AMP, discover_amp, parse_amp_store, ("T-*.json",)),
    ProviderAdapter(PROVIDER_COPILOT, discover_copilot, parse_copilot_store),
    ProviderAdapter(PROVIDER_CLINE, discover_cline, parse_cline_store, ("ui_messages.json",)),
    ProviderAdapter(PROVIDER_ROO, discover_roo, parse_roo_store, ("ui_messages.json",)),
    ProviderAdapter(PROVIDER_GOOSE, discover_goose, parse_goose_store, ("*.db",)),
    ProviderAdapter(PROVIDER_ZED, discover_zed, parse_zed_store, ("*.db",)),
    ProviderAdapter(PROVIDER_QWEN, discover_qwen, parse_qwen_store, ("*.jsonl",)),
    ProviderAdapter(PROVIDER_KIRO, discover_kiro, parse_kiro_store, ("*.json", "*.sqlite3", "*.db")),
    ProviderAdapter(PROVIDER_CURSOR_CLI, discover_cursor_cli, parse_cursor_cli_store, ("store.db",)),
)
