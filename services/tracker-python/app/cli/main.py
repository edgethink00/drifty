from __future__ import annotations

import argparse
import base64
import json
import os
import sqlite3
import sys
from collections import defaultdict
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Any, Sequence

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover - Python 3.9+ always provides zoneinfo
    ZoneInfo = None  # type: ignore[assignment]

from app.storage.db import TrackerDatabase
from app.storage.activity_segment_serialization import serialize_activity_row

SCHEMA_VERSION = 1
CLI_VERSION = "1.6.1"
CLI_COMMANDS = frozenset({"status", "summary", "timeline", "search"})
DEFAULT_LIMIT = 100
MAX_LIMIT = 500
DEFAULT_DB_PATH = Path.home() / "Library" / "Application Support" / "so.drifty.mac" / "tracker.sqlite3"
SAFE_ITEM_FIELDS = (
    "id",
    "startedAt",
    "endedAt",
    "durationSeconds",
    "appName",
    "siteDomain",
)
FULL_ITEM_FIELDS = SAFE_ITEM_FIELDS + ("windowTitle", "siteTitle", "siteUrl")
SAFE_CLASSIFICATION_FIELDS = ("category", "productivity")


class CliArgumentError(ValueError):
    pass


class CliParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        raise CliArgumentError(message)


def _parser() -> CliParser:
    parser = CliParser(
        prog="drifty",
        description="Read-only local queries over your Drifty activity history.",
        epilog="Privacy default: safe detail omits full URLs and window titles. Example: drifty summary --day 2026-07-29",
    )
    parser.add_argument("--version", action="version", version=f"drifty {CLI_VERSION}")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH, help=argparse.SUPPRESS)
    subparsers = parser.add_subparsers(dest="command", required=True)

    status = subparsers.add_parser("status", help="Check local database availability without changing it.")
    status.add_argument("--pretty", action="store_true")

    summary = subparsers.add_parser("summary", help="Summarize one local calendar day.")
    summary.add_argument("--day", required=True, type=_iso_day)
    summary.add_argument("--pretty", action="store_true")

    timeline = subparsers.add_parser("timeline", help="Read a bounded chronological page for one day.")
    timeline.add_argument("--day", required=True, type=_iso_day)
    _add_page_arguments(timeline)

    search = subparsers.add_parser("search", help="Search bounded retained history for a named term.")
    search.add_argument("--query", required=True)
    selectors = search.add_mutually_exclusive_group()
    selectors.add_argument("--day", type=_iso_day)
    selectors.add_argument("--from", dest="start")
    search.add_argument("--to", dest="end")
    _add_page_arguments(search)
    return parser


def _add_page_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT)
    parser.add_argument("--cursor")
    parser.add_argument("--detail", choices=("safe", "full"), default="safe")
    parser.add_argument("--pretty", action="store_true")


def _iso_day(value: str) -> str:
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError as error:
        raise argparse.ArgumentTypeError("must be YYYY-MM-DD") from error


def _local_zone() -> tuple[Any, str]:
    """The zone to resolve day/range bounds in, plus a label for the output.

    ``TZ`` wins when it names a zone this interpreter can load. That lookup can
    fail even for a valid key: Windows ships no IANA tzdata, so ``zoneinfo``
    resolves nothing unless the optional ``tzdata`` package is installed, and
    an unresolvable ``TZ`` must not silently fall through to a different zone
    than the caller asked for.
    """
    configured = os.environ.get("TZ")
    if configured and ZoneInfo is not None:
        try:
            return ZoneInfo(configured), configured
        except Exception:
            pass
    local = datetime.now().astimezone().tzinfo
    name = getattr(local, "key", None) or _stable_zone_name(local)
    return local, str(name)


def _stable_zone_name(local: Any) -> str:
    """A machine-readable zone label when no IANA key is available.

    ``tzname()`` returns a *localized display* string, not an identifier:
    Windows reports "Eastern Standard Time" in English and
    "\ub300\ud55c\ubbfc\uad6d \ud45c\uc900\uc2dc" on a Korean install for the same zone that macOS
    reports as "Asia/Seoul". Emitting that into a machine-read ``timezone``
    field makes the CLI's output depend on the user's regional settings.

    ``zoneinfo`` cannot resolve a Windows zone to an IANA key on its own (that
    needs the Windows-to-IANA mapping ``tzlocal`` carries), and this service is
    stdlib-only. So rather than emit a localized name that no consumer can
    parse, fall back to the unambiguous UTC offset.
    """
    now = datetime.now().astimezone()
    key = getattr(now.tzinfo, "key", None)
    if key:
        return str(key)
    offset = now.utcoffset()
    if offset is None:
        return "local"
    total_minutes = int(offset.total_seconds() // 60)
    sign = "+" if total_minutes >= 0 else "-"
    hours, minutes = divmod(abs(total_minutes), 60)
    return f"UTC{sign}{hours:02d}:{minutes:02d}"


def _day_query(day_value: str) -> dict[str, str]:
    zone, zone_name = _local_zone()
    resolved = date.fromisoformat(day_value)
    start = datetime.combine(resolved, time.min, zone)
    exclusive_end = start + timedelta(days=1)
    inclusive_end = exclusive_end - timedelta(seconds=1)
    return {
        "day": day_value,
        "start": start.isoformat(),
        "end": inclusive_end.isoformat(),
        "databaseEndExclusive": exclusive_end.isoformat(),
        "timezone": zone_name,
        "dayBoundary": "local-midnight",
    }


def _range_query(start_value: str | None, end_value: str | None) -> dict[str, str]:
    zone, zone_name = _local_zone()
    if bool(start_value) != bool(end_value):
        raise CliArgumentError("--from and --to must be provided together")
    if start_value and end_value:
        start = _iso_datetime(start_value, zone)
        end = _iso_datetime(end_value, zone)
        if end <= start:
            raise CliArgumentError("--to must be later than --from")
    else:
        start = datetime(1970, 1, 1, tzinfo=zone)
        end = datetime.now(zone)
    return {
        "start": start.isoformat(),
        "end": end.isoformat(),
        "timezone": zone_name,
        "rangePolicy": "explicit" if start_value else "retained-history-through-now",
    }


def _iso_datetime(value: str, zone: Any) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise CliArgumentError("--from and --to must be ISO 8601 timestamps") from error
    return parsed.replace(tzinfo=zone) if parsed.tzinfo is None else parsed


def _open_database(path: Path) -> TrackerDatabase:
    if not path.is_file():
        raise FileNotFoundError
    db = TrackerDatabase(path, perform_maintenance=False, read_only=True)
    with db.connect() as connection:
        tables = {
            str(row[0])
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
        }
    if not {"activity_segments", "activity_classifications"}.issubset(tables):
        db.close()
        raise sqlite3.DatabaseError("required Drifty tables are unavailable")
    return db


def _cursor_decode(token: str | None) -> tuple[str | None, str | None]:
    if not token:
        return None, None
    try:
        padding = "=" * (-len(token) % 4)
        value = json.loads(base64.urlsafe_b64decode(token + padding).decode("utf-8"))
        ended_at = value["beforeEndedAt"]
        segment_id = value["beforeSegmentId"]
        if not isinstance(ended_at, str) or not isinstance(segment_id, str):
            raise ValueError
        return ended_at, segment_id
    except (KeyError, ValueError, TypeError, json.JSONDecodeError) as error:
        raise CliArgumentError("--cursor is not a valid Drifty cursor") from error


def _cursor_encode(value: object) -> str | None:
    if not isinstance(value, dict):
        return None
    raw = json.dumps(value, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _redact_item(item: dict[str, Any], detail: str) -> dict[str, Any]:
    fields = FULL_ITEM_FIELDS if detail == "full" else SAFE_ITEM_FIELDS
    result = {field: item.get(field) for field in fields if item.get(field) is not None}
    classification = item.get("classification")
    if isinstance(classification, dict):
        safe_classification = {
            field: classification.get(field)
            for field in SAFE_CLASSIFICATION_FIELDS
            if classification.get(field) is not None
        }
        if safe_classification:
            result["classification"] = safe_classification
    return result


def _page_data(page: dict[str, Any], detail: str) -> dict[str, Any]:
    items = [_redact_item(item, detail) for item in page["items"]]
    return {
        "items": items,
        "resultCount": len(items),
        "matchedSeconds": sum(int(item.get("durationSeconds") or 0) for item in items),
        "hasMore": bool(page["hasMore"]),
        "nextCursor": _cursor_encode(page.get("nextCursor")),
    }


def _summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    totals: dict[str, int] = defaultdict(int)
    apps: dict[str, int] = defaultdict(int)
    sites: dict[str, int] = defaultdict(int)
    categories: dict[str, int] = defaultdict(int)
    for item in rows:
        seconds = int(item.get("durationSeconds") or 0)
        productivity = (item.get("classification") or {}).get("productivity")
        bucket = productivity if productivity in {"focus", "drift"} else "other"
        totals[bucket] += seconds
        apps[str(item.get("appName") or "Unknown")] += seconds
        if item.get("siteDomain"):
            sites[str(item["siteDomain"])] += seconds
        category = (item.get("classification") or {}).get("category")
        if category:
            categories[str(category)] += seconds
    recorded = sum(int(item.get("durationSeconds") or 0) for item in rows)
    return {
        "recordedSeconds": recorded,
        "focusSeconds": totals["focus"],
        "driftSeconds": totals["drift"],
        "otherSeconds": totals["other"],
        "segmentCount": len(rows),
        "firstRecordedAt": rows[0].get("startedAt") if rows else None,
        "lastRecordedAt": rows[-1].get("endedAt") if rows else None,
        "topApps": _ranked(apps),
        "topSiteDomains": _ranked(sites),
        "topCategories": _ranked(categories),
    }


def _ranked(values: dict[str, int]) -> list[dict[str, Any]]:
    return [
        {"name": name, "seconds": seconds}
        for name, seconds in sorted(values.items(), key=lambda item: (-item[1], item[0].lower()))[:10]
    ]


def _warnings(*, empty: bool = False) -> list[dict[str, str]]:
    result = [
        {
            "code": "coverage_not_guaranteed",
            "message": "Drifty records only observed captured activity and may contain recording gaps.",
        }
    ]
    if empty:
        result.insert(
            0,
            {
                "code": "no_records",
                "message": "No matching records were captured; this does not prove no activity occurred.",
            },
        )
    return result


def _envelope(command: str, query: dict[str, Any], data: Any, warnings: list[dict[str, str]]) -> dict[str, Any]:
    query = {key: value for key, value in query.items() if key != "databaseEndExclusive"}
    return {
        "schemaVersion": SCHEMA_VERSION,
        "command": command,
        "ok": True,
        "query": query,
        "data": data,
        "warnings": warnings,
    }


def _error(command: str, code: str, message: str) -> dict[str, Any]:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "command": command,
        "ok": False,
        "query": None,
        "data": None,
        "warnings": [],
        "error": {"code": code, "message": message},
    }


def _execute(args: argparse.Namespace) -> dict[str, Any]:
    command = str(args.command)
    query: dict[str, Any] = {}
    start: str | None = None
    end: str | None = None
    before_ended_at: str | None = None
    before_segment_id: str | None = None
    if command in {"summary", "timeline"}:
        query = _day_query(args.day)
        start = query["start"]
        end = query["databaseEndExclusive"]
    elif command == "search":
        if not args.query.strip():
            raise CliArgumentError("--query must not be empty")
        if args.day and args.end:
            raise CliArgumentError("search cannot mix --day with --from or --to")
        if args.day:
            query = _day_query(args.day)
            start = query["start"]
            end = query["databaseEndExclusive"]
        else:
            query = _range_query(args.start, args.end)
            start = query["start"]
            end = query["end"]
    if command in {"timeline", "search"} and (args.limit < 1 or args.limit > MAX_LIMIT):
        raise CliArgumentError(f"--limit must be between 1 and {MAX_LIMIT}")
    if command in {"timeline", "search"}:
        before_ended_at, before_segment_id = _cursor_decode(args.cursor)

    db = _open_database(args.db)
    try:
        if command == "status":
            return _envelope(
                command,
                {},
                {"available": True, "database": "local-drifty-history", "readOnly": True},
                [],
            )

        if command == "summary":
            assert start is not None and end is not None
            rows = db.timeline(start=start, end=end)
            items = [_redact_item(serialize_activity_row(item), "safe") for item in rows]
            data = _summary(items)
            return _envelope(command, {**query, "detail": "safe"}, data, _warnings(empty=not items))

        assert start is not None and end is not None
        if command == "timeline":
            page = db.timeline_page(start, end, before_ended_at, before_segment_id, args.limit)
        else:
            page = db.search_timeline_page(
                args.query,
                start,
                end,
                before_ended_at,
                before_segment_id,
                args.limit,
            )
            query = {**query, "text": args.query}
        data = _page_data(page, args.detail)
        return _envelope(command, {**query, "detail": args.detail}, data, _warnings(empty=not data["items"]))
    finally:
        db.close()


def run_cli(argv: Sequence[str] | None = None) -> int:
    arguments = list(sys.argv[1:] if argv is None else argv)
    parser = _parser()
    command = next((value for value in arguments if value in CLI_COMMANDS), "unknown")
    pretty = "--pretty" in arguments
    try:
        args = parser.parse_args(arguments)
        pretty = bool(getattr(args, "pretty", False))
        result = _execute(args)
        exit_code = 0
    except CliArgumentError as error:
        result = _error(command, "invalid_arguments", str(error))
        exit_code = 2
    except FileNotFoundError:
        result = _error(
            command,
            "database_not_found",
            "The local Drifty history database was not found. Open Drifty and start recording first.",
        )
        exit_code = 3
    except (OSError, sqlite3.DatabaseError) as error:
        if os.environ.get("DRIFTY_CLI_DEBUG") == "1":
            print(f"drifty CLI database debug: {type(error).__name__}: {error}", file=sys.stderr)
        result = _error(
            command,
            "database_unreadable",
            "The local Drifty history database could not be read with the expected schema.",
        )
        exit_code = 4
    print(json.dumps(result, ensure_ascii=False, indent=2 if pretty else None, separators=None if pretty else (",", ":")))
    return exit_code
