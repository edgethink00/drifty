from __future__ import annotations

import json
from collections.abc import Callable, Sequence
from typing import Final, Literal, TypedDict

SystemTransientActivity = Literal["mission_control", "app_switcher"]
JsonValue = object


class OnScreenWindowRow(TypedDict):
    owner_name: str | None
    layer: int | None
    name: str | None


CG_WINDOW_ROWS_SCRIPT: Final[str] = "\n".join(
    (
        "import Foundation",
        "import CoreGraphics",
        "let rawRows = (CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]]) ?? []",
        "let rows = rawRows.map { row -> [String: Any] in",
        "    [",
        '        "owner_name": row[kCGWindowOwnerName as String] as? String ?? NSNull(),',
        '        "layer": row[kCGWindowLayer as String] as? Int ?? NSNull(),',
        '        "name": row[kCGWindowName as String] as? String ?? NSNull(),',
        "    ]",
        "}",
        "let data = try JSONSerialization.data(withJSONObject: rows)",
        "print(String(data: data, encoding: .utf8) ?? \"[]\")",
    )
)


def json_text(value: JsonValue) -> str | None:
    return value if isinstance(value, str) else None


def json_int(value: JsonValue) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def onscreen_window_rows(run_command: Callable[[list[str]], str]) -> list[OnScreenWindowRow]:
    try:
        raw_rows = json.loads(run_command(["/usr/bin/swift", "-e", CG_WINDOW_ROWS_SCRIPT]))
    except (RuntimeError, json.JSONDecodeError):
        return []

    if not isinstance(raw_rows, list):
        return []

    rows: list[OnScreenWindowRow] = []
    for raw_row in raw_rows:
        if not isinstance(raw_row, dict):
            continue
        rows.append(
            {
                "owner_name": json_text(raw_row.get("owner_name")),
                "layer": json_int(raw_row.get("layer")),
                "name": json_text(raw_row.get("name")),
            }
        )
    return rows


def row_name(row: OnScreenWindowRow) -> str:
    return (row["name"] or "").strip()


def has_readable_window_names(rows: Sequence[OnScreenWindowRow]) -> bool:
    """Report whether this process can actually read window names.

    ``kCGWindowName`` is only populated when Screen Recording permission is
    granted. Without it every row arrives with a ``None`` name, which is
    indistinguishable from a genuinely untitled window once ``row_name``
    collapses both to ``""``. Any marker that treats "no name" as evidence must
    first confirm names are observable at all.
    """
    return any(row["name"] is not None for row in rows)


def is_dock_window(row: OnScreenWindowRow) -> bool:
    return row["owner_name"] == "Dock"


def is_mission_control_marker(row: OnScreenWindowRow) -> bool:
    return is_dock_window(row) and (row["layer"] == 18 or (row["layer"] == 17 and row_name(row) == "appicon"))


def is_app_switcher_marker(row: OnScreenWindowRow) -> bool:
    # Layer 20 is the Dock's own window level, so a permanently visible Dock
    # also sits here. The empty name is what separates the switcher overlay
    # from the Dock itself -- but an unreadable name is not an empty one, so
    # require a real "" rather than a missing value.
    return is_dock_window(row) and row["layer"] == 20 and row["name"] is not None and row_name(row) == ""


def system_transient_activity_from_rows(rows: Sequence[OnScreenWindowRow]) -> SystemTransientActivity | None:
    if any(is_mission_control_marker(row) for row in rows):
        return "mission_control"
    # Without readable names the switcher is undetectable. Suppressing drift
    # alarms forever is far worse than missing a brief switcher overlay, so
    # report "nothing transient" instead of guessing.
    if has_readable_window_names(rows) and any(is_app_switcher_marker(row) for row in rows):
        return "app_switcher"
    return None
