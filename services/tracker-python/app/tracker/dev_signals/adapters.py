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
    PROVIDER_ASIDE,
    PROVIDER_CLAUDE_CODE,
    PROVIDER_CODEX,
    PROVIDER_GEMINI,
    PROVIDER_HERMES,
    PROVIDER_KIMI,
    PROVIDER_OPENCLAW,
    PROVIDER_OPENCODE,
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
    ProviderAdapter(PROVIDER_CODEX, discover_codex, lambda path: parse_jsonl_tree(parse_codex_session, path)),
    ProviderAdapter(PROVIDER_CLAUDE_CODE, discover_claude, lambda path: parse_jsonl_tree(parse_claude_session, path)),
    ProviderAdapter(PROVIDER_ASIDE, discover_aside, parse_aside_store, ("*.db",)),
    ProviderAdapter(PROVIDER_OPENCODE, discover_opencode, parse_opencode_store, ("*.db", "*.json")),
    ProviderAdapter(PROVIDER_GEMINI, discover_gemini, parse_gemini_store, ("*.json", "*.jsonl")),
    ProviderAdapter(PROVIDER_HERMES, discover_hermes, parse_hermes_store, ("*.db",)),
    ProviderAdapter(PROVIDER_OPENCLAW, discover_openclaw, parse_openclaw_store),
    ProviderAdapter(PROVIDER_KIMI, discover_kimi, parse_kimi_store, ("wire.jsonl",)),
)
