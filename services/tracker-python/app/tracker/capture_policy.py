"""What the user asked Drifty not to record: confirmed private windows and
the hours outside a recording schedule.

Both choices are made in the app and stored here, because the tracker records
while the window is closed and the WebView can be asleep. The daemon reads them
on every tick, the same way it reads the content-context switch.

A private window counts only when the browser positively reports it (a window
mode, an identifier or a measured title label). An unknown state is recorded
as a normal window, so normal browsing is never lost to a guess.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Final, Literal

from app.tracker.capture_contract import Snapshot

PrivateWindowPolicy = Literal["skip", "record"]
ScheduleMode = Literal["pause-within", "record-within"]

PRIVATE_WINDOW_POLICY_META_KEY: Final = "capture_policy_private_windows"
RECORDING_SCHEDULE_META_KEY: Final = "capture_policy_recording_schedule"
DEFAULT_PRIVATE_WINDOW_POLICY: Final[PrivateWindowPolicy] = "skip"
MINUTES_PER_DAY: Final = 24 * 60
ALL_DAYS: Final = frozenset(range(1, 8))


@dataclass(frozen=True)  # noqa: SLOTS_OK - packaged sidecar still supports Python 3.9.
class RecordingSchedule:
    """A daily window; `days` are ISO weekdays (Monday 1 ... Sunday 7).

    A window that crosses midnight belongs to the day it starts on, so a
    Friday 22:00-02:00 window covers early Saturday too.
    """

    mode: ScheduleMode
    days: frozenset[int]
    start_minute: int
    end_minute: int

    def window_contains(self, moment: datetime) -> bool:
        minute = moment.hour * 60 + moment.minute
        today = moment.isoweekday()
        if self.start_minute < self.end_minute:
            return today in self.days and self.start_minute <= minute < self.end_minute
        yesterday = (moment - timedelta(days=1)).isoweekday()
        return (today in self.days and minute >= self.start_minute) or (
            yesterday in self.days and minute < self.end_minute
        )

    def allows_recording(self, moment: datetime) -> bool:
        inside = self.window_contains(moment)
        return not inside if self.mode == "pause-within" else inside


@dataclass(frozen=True)  # noqa: SLOTS_OK - packaged sidecar still supports Python 3.9.
class CapturePolicy:
    private_windows: PrivateWindowPolicy = DEFAULT_PRIVATE_WINDOW_POLICY
    schedule: RecordingSchedule | None = None

    def allows_recording_at(self, moment: datetime) -> bool:
        return self.schedule is None or self.schedule.allows_recording(moment)


def _minute(value: object) -> int | None:
    if type(value) is not int or not 0 <= value < MINUTES_PER_DAY:
        return None
    return value


def schedule_from_payload(value: object) -> RecordingSchedule | None:
    """A valid enabled schedule, or None (record at every hour)."""
    if not isinstance(value, dict) or value.get("enabled") is not True:
        return None
    mode = value.get("mode")
    if mode not in ("pause-within", "record-within"):
        return None
    start, end = _minute(value.get("startMinute")), _minute(value.get("endMinute"))
    if start is None or end is None or start == end:
        return None
    raw_days = value.get("days")
    if raw_days is None:
        days = ALL_DAYS
    elif isinstance(raw_days, list):
        days = frozenset(day for day in raw_days if type(day) is int and 1 <= day <= 7)
    else:
        return None
    if not days:
        # No chosen day: a record-only schedule would record nothing at all and
        # a pause schedule would pause nothing. Neither is what an empty pick means.
        return None
    return RecordingSchedule(mode=mode, days=days, start_minute=start, end_minute=end)


def schedule_to_payload(schedule: RecordingSchedule | None) -> dict[str, object] | None:
    if schedule is None:
        return None
    return {
        "enabled": True,
        "mode": schedule.mode,
        "days": sorted(schedule.days),
        "startMinute": schedule.start_minute,
        "endMinute": schedule.end_minute,
    }


def private_policy_from_value(value: object) -> PrivateWindowPolicy:
    return value if value in ("skip", "record") else DEFAULT_PRIVATE_WINDOW_POLICY  # type: ignore[return-value]


def load_capture_policy(db) -> CapturePolicy:
    """The saved choices; anything unreadable means the defaults."""
    private_windows = private_policy_from_value(db.get_meta(PRIVATE_WINDOW_POLICY_META_KEY))
    raw_schedule = db.get_meta(RECORDING_SCHEDULE_META_KEY)
    schedule = None
    if isinstance(raw_schedule, str) and raw_schedule:
        try:
            schedule = schedule_from_payload(json.loads(raw_schedule))
        except ValueError:
            schedule = None
    return CapturePolicy(private_windows=private_windows, schedule=schedule)


def save_capture_policy(db, payload: dict) -> dict[str, object]:
    private_windows = private_policy_from_value(payload.get("privateWindows"))
    schedule = schedule_from_payload(payload.get("recordingSchedule"))
    db.set_meta(PRIVATE_WINDOW_POLICY_META_KEY, private_windows)
    db.set_meta(RECORDING_SCHEDULE_META_KEY, json.dumps(schedule_to_payload(schedule)))
    return capture_policy_response(CapturePolicy(private_windows=private_windows, schedule=schedule))


def capture_policy_response(policy: CapturePolicy) -> dict[str, object]:
    return {
        "privateWindows": policy.private_windows,
        "recordingSchedule": schedule_to_payload(policy.schedule),
    }


CaptureDecision = Literal["record", "skip"]


def capture_decision(snapshot: Snapshot, policy: CapturePolicy, moment: datetime) -> CaptureDecision:
    """Whether this sample is recorded or left out."""
    if not policy.allows_recording_at(moment):
        return "skip"
    if snapshot.private_window is True and policy.private_windows == "skip":
        return "skip"
    return "record"
