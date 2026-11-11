"""Process-local capture order and input boundaries; never persist monotonic time."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from app.storage.timestamps import parse_iso_datetime


@dataclass(frozen=True)
class CaptureTiming:
    segment_id: int
    segment_uid: str
    started_at: str
    ended_at: str
    duration_seconds: int

    @classmethod
    def from_row(cls, row) -> CaptureTiming:
        return cls(int(row["id"]), row["segment_uid"], row["started_at"],
                   row["ended_at"], int(row["duration_seconds"]))


@dataclass(frozen=True)
class CaptureMutation:
    before: CaptureTiming | None
    after: CaptureTiming
    sample_seconds: int
    # Optional enrichment must use the content that survived storage redaction,
    # never the caller's original foreground observation.
    youtube_video_id: str | None = None
    site_url: str | None = None


@dataclass(frozen=True)
class CaptureTrim:
    expected: CaptureTiming
    target: CaptureTiming | None


@dataclass(frozen=True)
class CapturePoint:
    tick: float
    timing: CaptureTiming
    supported_seconds: float
    continuous: bool
    sample_seconds: int


@dataclass(frozen=True)
class CaptureFloor:
    before: CaptureTiming | None


class CaptureTimeline:
    def __init__(self) -> None:
        self.points: list[CapturePoint] = []
        self.floors: dict[str, CaptureFloor] = {}
        self.input_tick: float | None = None
        # Frozen UTC/UID trim plans survive later input and passive samples.
        # They are process-local and separate from the bounded observations.
        self.pending_input_trims: dict[str, CaptureTrim] = {}
        self.cleanup_retry_logged = False
        self.pending_capture_boundary = False
        self.has_recorded_sample = False
        self.last_mac_capture_tick: float | None = None
        self._sample_second_remainder = 0.0

    def credit_sample_seconds(self, previous_tick: float | None, current_tick: float,
                              default_seconds: int) -> int:
        if previous_tick is None:
            # A failed/suppressed capture or fresh daemon cannot carry timing
            # credit from its preceding observation window.
            self._sample_second_remainder = 0.0
            return default_seconds
        elapsed = max(default_seconds, current_tick - previous_tick)
        precise_seconds = elapsed + self._sample_second_remainder
        credited_seconds = max(default_seconds, int(round(precise_seconds)))
        # Storage stays in integer seconds. Preserve the fraction across
        # continuous foreground changes and passive samples, not across gaps.
        self._sample_second_remainder = precise_seconds - credited_seconds
        return credited_seconds

    def clear_observations(self) -> None:
        self.points.clear()
        self.floors.clear()
        self.input_tick = None

    def queue_input_stop(self, input_tick: float) -> None:
        for trim in self.trims_to_input(input_tick):
            self.pending_input_trims[trim.expected.segment_uid] = trim
        # New activity starts a fresh observation window even if guarded
        # cleanup cannot complete. Its input cannot bless the old idle tail.
        self.clear_observations()

    def input_boundary(self, input_tick: float) -> float:
        # OS input age and Python's elapsed clock need not advance equally
        # across sleep. Without new input the last input cannot move backward.
        self.input_tick = max(input_tick, self.input_tick) if self.input_tick is not None else input_tick
        return self.input_tick

    def remember(self, mutation: CaptureMutation, tick: float, input_tick: float | None,
                 *, passive: bool, continuous: bool) -> None:
        self.has_recorded_sample = True
        if passive or input_tick is None:
            # Audio-supported time and unavailable idle detection must not be
            # retroactively treated as unsupported interactive samples.
            self.clear_observations()
            return
        input_tick = self.input_boundary(input_tick)
        uid = mutation.after.segment_uid
        previous = self.points[-1] if self.points else None
        if previous is not None and previous.timing == mutation.before:
            # Keep fractional precision inside uninterrupted capture, but a
            # failed/suppressed tick credits only its fresh default sample.
            # Elapsed time across an unobserved gap must not become activity
            # merely because input resumes in the same stored segment.
            supported = previous.supported_seconds + (
                max(0, tick - previous.tick) if continuous else mutation.sample_seconds
            )
        else:
            # An external timing mutation ends our authority over the earlier
            # row state. Preserve it as the new floor instead of applying old
            # in-memory capture observations to its replacement.
            self.points = [point for point in self.points if point.timing.segment_uid != uid]
            self.floors[uid] = CaptureFloor(mutation.before)
            supported = (mutation.before.duration_seconds + mutation.sample_seconds
                         if mutation.before is not None else 0)
        point = CapturePoint(tick, mutation.after, supported, continuous, mutation.sample_seconds)
        self.points.append(point)
        # Only the nearest pre-input anchor and provisional post-input samples
        # can be trimmed. Keep a small margin for idle-reader rounding jitter.
        older = [i for i, entry in enumerate(self.points) if entry.tick <= input_tick - 1]
        if older:
            self.points = self.points[older[-1]:]
            retained = {entry.timing.segment_uid for entry in self.points}
            self.floors = {uid: floor for uid, floor in self.floors.items() if uid in retained}

    def trims_to_input(self, input_tick: float) -> list[CaptureTrim]:
        input_tick = self.input_boundary(input_tick)
        groups: dict[str, list[CapturePoint]] = {}
        for point in self.points:
            groups.setdefault(point.timing.segment_uid, []).append(point)
        supported = [point for point in self.points if point.tick <= input_tick]
        boundary_uid = supported[-1].timing.segment_uid if supported else None
        trims = []
        for uid, points in groups.items():
            expected = points[-1].timing
            floor = self.floors[uid]
            before = floor.before
            supported_points = [point for point in points if point.tick <= input_tick]
            if not supported_points:
                # A new row is wholly provisional. A row continued from a
                # previous run keeps its pre-run floor, without reusing that
                # run's monotonic clock or changing its earlier history.
                target = before
            elif uid != boundary_uid:
                continue
            else:
                boundary = supported_points[-1]
                remaining = max(0, input_tick - boundary.tick)
                later = [point for point in self.points if point.tick > input_tick]
                if not later:
                    remaining = 0
                elif not later[0].continuous:
                    # A fresh sample after a capture gap describes only its
                    # trailing sample interval, not the entire missing span.
                    next_point = later[0]
                    remaining = (max(0, input_tick - max(boundary.tick,
                                 next_point.tick - next_point.sample_seconds))
                                 if next_point.timing.segment_uid == uid else 0)
                # A fresh row starts at its first observation, excluding its
                # initial default sample as ordinary input trimming does.
                # Round the elapsed span once, not each provisional sample.
                duration = boundary.supported_seconds
                duration = min(expected.duration_seconds, int(round(duration + remaining)))
                end_offset = input_tick - boundary.tick if remaining > 0 else 0
                end = parse_iso_datetime(boundary.timing.ended_at) + timedelta(seconds=end_offset)
                target = (CaptureTiming(expected.segment_id, uid, expected.started_at,
                                        end.isoformat(), duration) if duration > 0 else None)
            if target != expected:
                trims.append(CaptureTrim(expected, target))
        return trims
