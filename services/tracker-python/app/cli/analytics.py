"""Deterministic, read-only evidence for Chat and CLI summaries.

Keep these rules in step with domain/deviceElapsedTime.ts,
domain/projectWindowAssignments.ts and desktop/lib/productivityRuns.ts.
The cross-runtime fixtures exercise the same allocation, clipping and run rules.
No title, URL, project description or project anchor is needed for these totals.
"""

from __future__ import annotations

import math
from collections import defaultdict
from datetime import datetime, time, timedelta
from typing import Any

from app.storage.timestamps import parse_iso_datetime

MAX_FOCUS_GAP_SECONDS = 5 * 60


def number(value: float) -> int | float:
    rounded = round(value, 6)
    return int(rounded) if rounded == int(rounded) else rounded


def timestamp(value: str, zone: Any) -> float:
    parsed = parse_iso_datetime(value)
    return (parsed.replace(tzinfo=zone) if parsed.tzinfo is None else parsed).timestamp()


def _iso(value: float, zone: Any) -> str:
    return datetime.fromtimestamp(value, zone).isoformat(timespec="seconds")


def _usable(item: dict[str, Any]) -> bool:
    if item.get("exclusionSource") is not None or item.get("appName") == "[Redacted]":
        return False
    return not (
        item.get("platform") == "windows" and item.get("appName") == "Unavailable"
        and not item.get("bundleId")
        and item.get("source") in {"unknown", "win32-foreground", "win32-foreground-untitled"}
    )


def allocate_records(items: list[dict[str, Any]], zone: Any) -> list[dict[str, Any]]:
    """Allocate simultaneous devices before filtering productivity or projects."""
    records: list[dict[str, Any]] = []
    for item in items:
        if not _usable(item):
            continue
        try:
            start, captured_end = timestamp(item["startedAt"], zone), timestamp(item["endedAt"], zone)
            seconds = float(item.get("durationSeconds") or 0)
        except (ValueError, TypeError, KeyError, OverflowError):
            continue
        if not all(math.isfinite(value) for value in (start, captured_end, seconds)) or captured_end < start or seconds <= 0:
            continue
        end = max(captured_end, start + seconds)
        records.append({"item": item, "start": start, "end": end, "density": seconds / (end - start),
                        "device": item.get("deviceId") or "", "intervals": []})
    if len({record["device"] for record in records}) < 2:
        for record in records:
            record["intervals"] = [(record["start"], record["end"], record["density"])]
        return records

    events: dict[float, list[tuple[int, bool]]] = defaultdict(list)
    for index, record in enumerate(records):
        events[record["start"]].append((index, True))
        events[record["end"]].append((index, False))
    times = sorted(events)
    active: dict[str, set[int]] = {}
    for position, start in enumerate(times[:-1]):
        for index, entering in events[start]:
            device = records[index]["device"]
            if entering:
                active.setdefault(device, set()).add(index)
            elif device in active:
                active[device].discard(index)
                if not active[device]:
                    del active[device]
        devices = [(indices, max(records[index]["density"] for index in indices),
                    sum(records[index]["density"] for index in indices)) for indices in active.values()]
        union = max((density for _, density, _ in devices), default=0)
        total_density = sum(density for _, density, _ in devices)
        for indices, density, own_sum in devices:
            for index in indices:
                rate = records[index]["density"] if len(devices) == 1 else union * density / total_density * records[index]["density"] / own_sum
                records[index]["intervals"].append((start, times[position + 1], rate))
    return records


def seconds_within(record: dict[str, Any], start: float, end: float) -> float:
    return sum(max(0, min(end, right) - max(start, left)) * rate for left, right, rate in record["intervals"])


def _gaps(start: float, end: float, covered: list[tuple[float, float]]) -> list[tuple[float, float]]:
    cursor = start
    gaps = []
    for left, right in sorted(covered):
        if left > cursor:
            gaps.append((cursor, min(left, end)))
        cursor = max(cursor, right)
        if cursor >= end:
            break
    if cursor < end:
        gaps.append((cursor, end))
    return [(left, right) for left, right in gaps if right > left]


def project_slices(records: list[dict[str, Any]], assignments: list[dict[str, Any]],
                   windows: list[dict[str, Any]], zone: Any) -> list[dict[str, Any]]:
    """Stored windows own their intervals; manual segment choices override them."""
    legacy = {row["segmentId"]: row for row in assignments if not row.get("stale")}
    by_id = {record["item"]["id"]: record for record in records}
    covered: dict[str, list[tuple[float, float]]] = defaultdict(list)
    slices = []
    for window in sorted((row for row in windows if not row.get("stale")), key=lambda row: row["windowStartedAt"]):
        left, right = timestamp(window["windowStartedAt"], zone), timestamp(window["windowEndedAt"], zone)
        for overlap in window["segmentOverlaps"]:
            record = by_id.get(overlap["segmentId"])
            if record is None or overlap["durationSeconds"] <= 0:
                continue
            record_id = record["item"]["id"]
            choice = legacy.get(record_id)
            project = choice["projectId"] if choice and choice["source"] == "manual" else window.get("projectId")
            for start, end in _gaps(max(record["start"], left), min(record["end"], right), covered[record_id]):
                if seconds_within(record, start, end) > 0:
                    slices.append({**record, "start": start, "end": end, "projectId": project})
                    covered[record_id].append((start, end))
    for record in records:
        record_id = record["item"]["id"]
        project = legacy.get(record_id, {}).get("projectId")
        for start, end in _gaps(record["start"], record["end"], covered[record_id]):
            slices.append({**record, "start": start, "end": end, "projectId": project})
    return slices


def _ranked(values: dict[str, float], limit: int = 10) -> list[dict[str, Any]]:
    return [{"name": name, "seconds": number(seconds)}
            for name, seconds in sorted(values.items(), key=lambda pair: (-pair[1], pair[0].lower()))[:limit]]


def _focus_run(parts: list[tuple[float, float, float]], zone: Any) -> dict[str, Any] | None:
    runs: list[list[float]] = []
    for start, end, seconds in sorted(parts):
        if runs and start <= runs[-1][1] + MAX_FOCUS_GAP_SECONDS:
            runs[-1][1] = max(runs[-1][1], end)
            runs[-1][2] += seconds
        else:
            runs.append([start, end, seconds])
    if not runs:
        return None
    start, end, seconds = max(runs, key=lambda run: run[2])
    return {"startedAt": _iso(start, zone), "endedAt": _iso(end, zone), "seconds": number(seconds)}


def summarize(items: list[dict[str, Any]], start: float, end: float, zone: Any,
              projects: list[dict[str, Any]], assignments: list[dict[str, Any]],
              windows: list[dict[str, Any]], project_id: str | None = None) -> dict[str, Any]:
    records = allocate_records(items, zone)
    slices = project_slices(records, assignments, windows, zone)
    if project_id is not None:
        slices = [piece for piece in slices if piece["projectId"] == project_id]
    totals: dict[str, float] = defaultdict(float)
    apps: dict[str, float] = defaultdict(float)
    sites: dict[str, float] = defaultdict(float)
    categories: dict[str, float] = defaultdict(float)
    drift_apps: dict[str, float] = defaultdict(float)
    drift_sites: dict[str, float] = defaultdict(float)
    project_seconds: dict[str, float] = defaultdict(float)
    segment_ids = set()
    first, last = math.inf, -math.inf
    counted = []
    for piece in slices:
        left, right = max(start, piece["start"]), min(end, piece["end"])
        seconds = seconds_within(piece, left, right)
        if seconds <= 0:
            continue
        item = piece["item"]
        classification = item.get("classification") or {}
        productivity = classification.get("productivity")
        bucket = productivity if productivity in {"focus", "drift"} else "other"
        totals[bucket] += seconds
        app = str(item.get("appName") or "Unknown")
        apps[app] += seconds
        if item.get("siteDomain"):
            sites[item["siteDomain"]] += seconds
        if classification.get("category"):
            categories[classification["category"]] += seconds
        if bucket == "drift":
            drift_apps[app] += seconds
            if item.get("siteDomain"):
                drift_sites[item["siteDomain"]] += seconds
        if piece["projectId"]:
            project_seconds[piece["projectId"]] += seconds
        else:
            totals["unassigned"] += seconds
        segment_ids.add(item["id"])
        first, last = min(first, left), max(last, right)
        counted.append((piece, left, right, bucket, classification.get("category")))

    days = []
    longest = None
    current = datetime.fromtimestamp(start, zone).date()
    while datetime.combine(current, time.min, tzinfo=zone).timestamp() < end:
        left = max(start, datetime.combine(current, time.min, tzinfo=zone).timestamp())
        right = min(end, datetime.combine(current + timedelta(days=1), time.min, tzinfo=zone).timestamp())
        day_totals: dict[str, float] = defaultdict(float)
        day_projects: dict[str, float] = defaultdict(float)
        focus_parts = []
        for piece, part_start, part_end, bucket, category in counted:
            a, b = max(left, part_start), min(right, part_end)
            seconds = seconds_within(piece, a, b)
            if seconds <= 0:
                continue
            day_totals[bucket] += seconds
            if piece["projectId"]:
                day_projects[piece["projectId"]] += seconds
            if bucket == "focus" and category not in {None, "unknown"}:
                focus_parts.append((a, b, seconds))
        total = sum(day_totals.values())
        run = _focus_run(focus_parts, zone)
        if run and (longest is None or run["seconds"] > longest["seconds"]):
            longest = run
        days.append({"day": current.isoformat(), "recordedSeconds": number(total),
                     "focusSeconds": number(day_totals["focus"]), "driftSeconds": number(day_totals["drift"]),
                     "focusShare": round(day_totals["focus"] / total, 4) if total else None,
                     "projects": [{"id": key, "seconds": number(value)} for key, value in sorted(day_projects.items())]})
        current += timedelta(days=1)
    names = {project["id"]: project["name"] for project in projects}
    return {
        "recordedSeconds": number(totals["focus"] + totals["drift"] + totals["other"]),
        "focusSeconds": number(totals["focus"]), "driftSeconds": number(totals["drift"]),
        "otherSeconds": number(totals["other"]), "segmentCount": len(segment_ids),
        "firstRecordedAt": _iso(first, zone) if segment_ids else None,
        "lastRecordedAt": _iso(last, zone) if segment_ids else None,
        "topApps": _ranked(apps), "topSiteDomains": _ranked(sites), "topCategories": _ranked(categories),
        "topDriftApps": _ranked(drift_apps), "topDriftSiteDomains": _ranked(drift_sites),
        "projects": [{"id": key, "name": names[key], "seconds": number(value)}
                     for key, value in sorted(project_seconds.items(), key=lambda pair: (-pair[1], pair[0])) if key in names],
        "unassignedSeconds": number(totals["unassigned"]), "days": days,
        "recordedDays": sum(day["recordedSeconds"] > 0 for day in days),
        "longestFocus": longest, "focusRunMaxGapSeconds": MAX_FOCUS_GAP_SECONDS,
        "totalsComplete": True,
    }
