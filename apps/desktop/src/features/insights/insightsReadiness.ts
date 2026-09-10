import { logicalDayIsoDateForDate } from "@drifty/domain";
import type { ActivitySegment } from "@drifty/domain";

/** Hours of classified activity the coach needs before it says anything. */
export const COACH_REQUIRED_HOURS = 24;
/** Days that must each clear `COACH_MEANINGFUL_DAY_HOURS` for the coach to unlock. */
export const COACH_REQUIRED_DAYS = 3;
/** A day only counts once it carries this much classified activity. */
export const COACH_MEANINGFUL_DAY_HOURS = 2;

const SECONDS_PER_HOUR = 3600;

export type InsightsCoachReadiness = {
  readonly trackedHours: number;
  readonly meaningfulDays: number;
  /** 0-1 progress on each gate, and the slower of the two. */
  readonly hoursProgress: number;
  readonly daysProgress: number;
  readonly progress: number;
  readonly isReady: boolean;
};

function clampUnit(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value > 1 ? 1 : value;
}

/**
 * Readiness is measured inside the selected insight window, from local
 * classified activity only. Both gates must clear: enough total hours, and
 * enough separate days that each carry real activity. A single very long day
 * is not evidence of a pattern.
 */
export function buildInsightsCoachReadiness(segments: readonly ActivitySegment[]): InsightsCoachReadiness {
  const secondsByDay = new Map<string, number>();
  let totalSeconds = 0;

  for (const segment of segments) {
    const started = new Date(segment.startedAt);
    if (Number.isNaN(started.getTime())) continue;
    const duration = Number.isFinite(segment.durationSeconds) && segment.durationSeconds > 0 ? segment.durationSeconds : 0;
    if (duration === 0) continue;
    totalSeconds += duration;
    const dayKey = logicalDayIsoDateForDate(started);
    secondsByDay.set(dayKey, (secondsByDay.get(dayKey) ?? 0) + duration);
  }

  const trackedHours = totalSeconds / SECONDS_PER_HOUR;
  let meaningfulDays = 0;
  for (const daySeconds of secondsByDay.values()) {
    if (daySeconds >= COACH_MEANINGFUL_DAY_HOURS * SECONDS_PER_HOUR) meaningfulDays += 1;
  }

  const hoursProgress = clampUnit(trackedHours / COACH_REQUIRED_HOURS);
  const daysProgress = clampUnit(meaningfulDays / COACH_REQUIRED_DAYS);

  return {
    trackedHours,
    meaningfulDays,
    hoursProgress,
    daysProgress,
    progress: Math.min(hoursProgress, daysProgress),
    isReady: trackedHours >= COACH_REQUIRED_HOURS && meaningfulDays >= COACH_REQUIRED_DAYS,
  };
}
