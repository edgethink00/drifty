/**
 * The recording-hours rule shared with the tracker
 * (services/tracker-python/app/tracker/capture_policy.py). Days are ISO
 * weekdays, Monday 1 through Sunday 7; a window that crosses midnight belongs
 * to the day it starts on.
 */
export type RecordingScheduleMode = "pause-within" | "record-within";

export type RecordingSchedulePayload = {
  readonly enabled: true;
  readonly mode: RecordingScheduleMode;
  readonly days?: readonly number[];
  readonly startMinute: number;
  readonly endMinute: number;
};

const MINUTES_PER_DAY = 24 * 60;
export const ALL_ISO_DAYS: readonly number[] = [1, 2, 3, 4, 5, 6, 7];
export const WORK_DAYS: readonly number[] = [1, 2, 3, 4, 5];

export function isoWeekday(date: Date): number {
  return ((date.getDay() + 6) % 7) + 1;
}

function windowContains(schedule: RecordingSchedulePayload, date: Date): boolean {
  const days = schedule.days ?? ALL_ISO_DAYS;
  const minute = date.getHours() * 60 + date.getMinutes();
  const today = isoWeekday(date);
  if (schedule.startMinute < schedule.endMinute) {
    return days.includes(today) && minute >= schedule.startMinute && minute < schedule.endMinute;
  }
  const yesterday = today === 1 ? 7 : today - 1;
  return (days.includes(today) && minute >= schedule.startMinute) || (days.includes(yesterday) && minute < schedule.endMinute);
}

export function recordingAllowedAt(schedule: RecordingSchedulePayload | null, date: Date): boolean {
  if (!schedule) return true;
  const inside = windowContains(schedule, date);
  return schedule.mode === "pause-within" ? !inside : inside;
}

/** The next moment the allowed state flips, within eight days, or null. */
export function nextRecordingChange(schedule: RecordingSchedulePayload | null, from: Date): Date | null {
  if (!schedule) return null;
  const current = recordingAllowedAt(schedule, from);
  const midnight = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const candidates: Date[] = [];
  for (let offset = 0; offset <= 8; offset += 1) {
    for (const minute of [schedule.startMinute, schedule.endMinute]) {
      const candidate = new Date(midnight);
      candidate.setDate(midnight.getDate() + offset);
      candidate.setHours(Math.floor(minute / 60), minute % 60, 0, 0);
      if (candidate.getTime() > from.getTime()) candidates.push(candidate);
    }
  }
  candidates.sort((left, right) => left.getTime() - right.getTime());
  return candidates.find((candidate) => recordingAllowedAt(schedule, candidate) !== current) ?? null;
}

export function clampMinute(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return ((Math.round(value) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}
