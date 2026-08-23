"""Turn overlapping agent turns into wall-clock time.

Agent turns are not mutually exclusive. Several sessions run at once across
worktrees, and their spans overlap freely: summing ``active_seconds`` on a busy
day produced 33 hours out of 24 during development. Any duration shown to a user
has to merge overlaps first.

Two distinct measures come out of the same events:

- **Wall-clock** — how much real time had at least one agent working. This is
  the number that belongs next to tracked attention time, because both measure
  the same clock.
- **Cumulative** — the sum across concurrent sessions. Useful for "how much
  agent work happened", meaningless as a share of a day.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone


@dataclass(frozen=True)
class Span:
    start: datetime
    end: datetime


@dataclass(frozen=True)
class AgentTimeSummary:
    wall_clock_seconds: int
    cumulative_seconds: int
    concurrency_peak: int
    spans: tuple[Span, ...]

    @property
    def parallel_factor(self) -> float:
        """Cumulative over wall-clock: 1.0 is serial, 3.0 means three at once."""
        if self.wall_clock_seconds <= 0:
            return 0.0
        return self.cumulative_seconds / self.wall_clock_seconds


def _parse(value: str) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (AttributeError, ValueError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def merge_spans(events: list[dict]) -> list[Span]:
    """Collapse overlapping and adjacent turn spans into disjoint spans."""
    intervals: list[tuple[datetime, datetime]] = []
    for event in events:
        start = _parse(str(event.get("startedAt", "")))
        end = _parse(str(event.get("endedAt", "")))
        if start is None or end is None or end <= start:
            continue
        intervals.append((start, end))
    if not intervals:
        return []

    intervals.sort()
    merged: list[list[datetime]] = [list(intervals[0])]
    for start, end in intervals[1:]:
        if start <= merged[-1][1]:
            if end > merged[-1][1]:
                merged[-1][1] = end
        else:
            merged.append([start, end])
    return [Span(start=item[0], end=item[1]) for item in merged]


def peak_concurrency(events: list[dict]) -> int:
    """Highest number of turns running at the same instant."""
    boundaries: list[tuple[datetime, int]] = []
    for event in events:
        start = _parse(str(event.get("startedAt", "")))
        end = _parse(str(event.get("endedAt", "")))
        if start is None or end is None or end <= start:
            continue
        boundaries.append((start, 1))
        boundaries.append((end, -1))
    if not boundaries:
        return 0
    # Ends sort before starts at an identical timestamp, so a turn ending as
    # another begins is not counted as concurrency.
    boundaries.sort(key=lambda item: (item[0], item[1]))
    current = 0
    peak = 0
    for _, delta in boundaries:
        current += delta
        peak = max(peak, current)
    return peak


def summarize_agent_time(events: list[dict]) -> AgentTimeSummary:
    spans = merge_spans(events)
    wall_clock = sum(int((span.end - span.start).total_seconds()) for span in spans)
    cumulative = 0
    for event in events:
        try:
            cumulative += int(event.get("activeSeconds") or 0)
        except (TypeError, ValueError):
            continue
    return AgentTimeSummary(
        wall_clock_seconds=wall_clock,
        cumulative_seconds=cumulative,
        concurrency_peak=peak_concurrency(events),
        spans=tuple(spans),
    )
