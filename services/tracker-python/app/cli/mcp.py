"""Read-only Model Context Protocol server over the public Drifty queries.

Local agents (Codex CLI, Claude Code and other MCP hosts) reach the same
summary, search and timeline queries as the `drifty` command, without shell
access. Every call opens the database read-only, the privacy detail is fixed
by whoever starts the server, and nothing here writes, sends or caches data.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Mapping, TextIO

from app.cli.main import CLI_VERSION, execute_arguments
from app.cli.memory import MEMORY_TOOLS, NAMES as MEMORY_NAMES, call_memory

PROTOCOL_VERSION = "2025-06-18"
SUPPORTED_PROTOCOL_VERSIONS = frozenset({"2024-11-05", "2025-03-26", "2025-06-18"})
DEFAULT_PAGE_LIMIT = 100
MAX_PAGE_LIMIT = 200

_READ_ONLY = {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False}
_DAY = {"type": "string", "description": "Local calendar day, YYYY-MM-DD."}
_RANGE = {
    "day": _DAY,
    "from": {"type": "string", "description": "Range start, ISO 8601 with local UTC offset. Use together with to, instead of day."},
    "to": {"type": "string", "description": "Exclusive range end, ISO 8601 with UTC offset. Use together with from."},
}
_PAGE = {
    "limit": {"type": "integer", "minimum": 1, "maximum": MAX_PAGE_LIMIT, "description": "Page size (default 100)."},
    "cursor": {"type": "string", "description": "nextCursor from the previous page."},
}

TOOLS: tuple[dict[str, Any], ...] = (
    {
        "name": "summary",
        "title": "Day summary",
        "description": "Complete recorded totals for a local day or explicit range (up to 31 days): daily coverage, top apps/sites, drift rankings, assigned projects and longest focus using the app's five-minute gap rule. Counts overlapping devices once and clips records to the range. Use this for totals, week reviews, equal-time comparisons and project time; search matches text, not exact project membership.",
        "inputSchema": {"type": "object", "properties": {
            **_RANGE,
            "projectId": {"type": "string", "description": "Optional exact assigned project id, from summary.projects or the task. Omit for all projects. Never substitute a title search."},
        }, "additionalProperties": False},
        "annotations": _READ_ONLY,
    },
    {
        "name": "search",
        "title": "Search activity",
        "description": "Find recorded activity whose app, site, title or assigned project matches a term, within one day or between two ISO 8601 times. Omit both to search retained history up to now.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Term to match."},
                "day": _DAY,
                "from": {"type": "string", "description": "Range start, ISO 8601. Use together with to."},
                "to": {"type": "string", "description": "Range end, ISO 8601. Use together with from."},
                **_PAGE,
            },
            "required": ["query"],
            "additionalProperties": False,
        },
        "annotations": _READ_ONLY,
    },
    {
        "name": "timeline",
        "title": "Day timeline",
        "description": "Chronological recorded segments for one local calendar day, newest first, one bounded page at a time.",
        "inputSchema": {
            "type": "object",
            "properties": {"day": _DAY, **_PAGE},
            "required": ["day"],
            "additionalProperties": False,
        },
        "annotations": _READ_ONLY,
    },
)
_TOOL_NAMES = frozenset(tool["name"] for tool in TOOLS)

INSTRUCTIONS = (
    "Read-only access to the user's Drifty activity records. Resolve relative dates to explicit days first. "
    "Treat durations as recorded evidence, not the whole day, and never treat an empty result as proof that nothing happened."
)


class ToolArgumentError(ValueError):
    pass


def tool_arguments(name: str, arguments: Mapping[str, Any], detail: str) -> list[str]:
    """Translate one MCP tool call into the equivalent read-only CLI arguments."""
    if name not in _TOOL_NAMES:
        raise ToolArgumentError(f"Unknown tool: {name}")
    allowed = set(next(tool for tool in TOOLS if tool["name"] == name)["inputSchema"]["properties"])
    unexpected = sorted(set(arguments) - allowed)
    if unexpected:
        raise ToolArgumentError(f"Unexpected arguments: {', '.join(unexpected)}")

    def text(key: str, *, required: bool = False) -> str | None:
        value = arguments.get(key)
        if value is None:
            if required:
                raise ToolArgumentError(f"{key} is required")
            return None
        if not isinstance(value, str) or not value.strip():
            raise ToolArgumentError(f"{key} must be a non-empty string")
        return value.strip()

    if name == "summary":
        day, start, end = text("day"), text("from"), text("to")
        if day and (start or end):
            raise ToolArgumentError("Use either day or from/to, not both")
        if not day and not (start and end):
            raise ToolArgumentError("summary needs day or both from and to")
        argv = ["summary", "--day", day] if day else ["summary", "--from", str(start), "--to", str(end)]
        project = text("projectId")
        if project:
            argv += ["--project-id", project]
        return argv

    argv = [name]
    if name == "timeline":
        argv += ["--day", str(text("day", required=True))]
    else:
        argv += ["--query", str(text("query", required=True))]
        day, start, end = text("day"), text("from"), text("to")
        if day and (start or end):
            raise ToolArgumentError("Use either day or from/to, not both")
        if (start is None) != (end is None):
            raise ToolArgumentError("from and to must be given together")
        if day:
            argv += ["--day", day]
        elif start and end:
            argv += ["--from", start, "--to", end]
    limit = arguments.get("limit", DEFAULT_PAGE_LIMIT)
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= MAX_PAGE_LIMIT:
        raise ToolArgumentError(f"limit must be an integer between 1 and {MAX_PAGE_LIMIT}")
    argv += ["--limit", str(limit), "--detail", "safe" if detail == "safe" else "full"]
    cursor = text("cursor")
    if cursor:
        argv += ["--cursor", cursor]
    return argv


def call_tool(db: Path, name: str, arguments: Mapping[str, Any], detail: str, memory_socket: Path | None = None) -> dict[str, Any]:
    if name in MEMORY_NAMES:
        return call_memory(memory_socket, name, arguments)
    try:
        argv = tool_arguments(name, arguments, detail)
    except ToolArgumentError as error:
        return {"content": [{"type": "text", "text": str(error)}], "isError": True}
    result, exit_code = execute_arguments(["--db", str(db), *argv])
    if detail == "titles":
        result = _without_urls(result)
    payload = json.dumps(result, ensure_ascii=False, separators=(",", ":"))
    return {"content": [{"type": "text", "text": payload}], "structuredContent": result, "isError": exit_code != 0}


def _without_urls(result: dict[str, Any]) -> dict[str, Any]:
    data = result.get("data")
    if not isinstance(data, dict) or not isinstance(data.get("items"), list):
        return result
    items = [{key: value for key, value in item.items() if key != "siteUrl"} for item in data["items"]]
    query = result.get("query")
    return {
        **result,
        "query": {**query, "detail": "titles"} if isinstance(query, dict) else query,
        "data": {**data, "items": items},
    }


def handle_message(message: Any, db: Path, detail: str, memory_socket: Path | None = None) -> dict[str, Any] | None:
    """Return the JSON-RPC response for one message, or None for notifications."""
    if not isinstance(message, dict) or message.get("jsonrpc") != "2.0" or not isinstance(message.get("method"), str):
        return _failure(message.get("id") if isinstance(message, dict) else None, -32600, "Invalid request")
    if "id" not in message:
        return None
    message_id = message["id"]
    method = message["method"]
    params = message.get("params") or {}
    if not isinstance(params, dict):
        return _failure(message_id, -32602, "params must be an object")
    if method == "initialize":
        requested = params.get("protocolVersion")
        version = requested if requested in SUPPORTED_PROTOCOL_VERSIONS else PROTOCOL_VERSION
        return _success(message_id, {
            "protocolVersion": version,
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": {"name": "drifty", "title": "Drifty", "version": CLI_VERSION},
            "instructions": INSTRUCTIONS,
        })
    if method == "ping":
        return _success(message_id, {})
    if method == "tools/list":
        return _success(message_id, {"tools": list(TOOLS) + (list(MEMORY_TOOLS) if memory_socket is not None else [])})
    if method == "tools/call":
        name = params.get("name")
        arguments = params.get("arguments") or {}
        if not isinstance(name, str) or not isinstance(arguments, dict):
            return _failure(message_id, -32602, "tools/call needs a tool name and an arguments object")
        return _success(message_id, call_tool(db, name, arguments, detail, memory_socket))
    return _failure(message_id, -32601, f"Method not found: {method}")


def serve(db: Path, detail: str = "safe", stdin: TextIO | None = None, stdout: TextIO | None = None, memory_socket: Path | None = None) -> int:
    """Serve newline-delimited JSON-RPC over stdio until the host closes stdin."""
    source = stdin or sys.stdin
    sink = stdout or sys.stdout
    for line in source:
        line = line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except json.JSONDecodeError:
            response: dict[str, Any] | None = _failure(None, -32700, "Parse error")
        else:
            response = handle_message(message, db, detail, memory_socket)
        if response is not None:
            sink.write(json.dumps(response, ensure_ascii=False, separators=(",", ":")) + "\n")
            sink.flush()
    return 0


def call_once(db: Path, name: str, raw_arguments: str, detail: str = "safe", stdout: TextIO | None = None, memory_socket: Path | None = None) -> int:
    """Run one tool call and print its MCP result without structuredContent.

    Drifty Cloud chat runs the model in the cloud, so the app executes each tool
    call it asks for here, with the same tools and detail policy as the stdio
    server. Tool errors stay in the result (isError) so the model can recover.
    """
    sink = stdout or sys.stdout
    try:
        arguments = json.loads(raw_arguments)
    except json.JSONDecodeError:
        arguments = None
    if not isinstance(arguments, dict):
        result: dict[str, Any] = {"content": [{"type": "text", "text": "arguments must be a JSON object"}], "isError": True}
    else:
        result = call_tool(db, name, arguments, detail, memory_socket)
    output = {"content": result["content"], "isError": bool(result.get("isError"))}
    sink.write(json.dumps(output, ensure_ascii=False, separators=(",", ":")) + "\n")
    sink.flush()
    return 0


def _success(message_id: Any, result: dict[str, Any]) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": message_id, "result": result}


def _failure(message_id: Any, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": message_id, "error": {"code": code, "message": message}}

