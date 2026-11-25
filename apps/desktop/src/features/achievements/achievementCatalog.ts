import { shiftIsoDate } from "@drifty/domain";
import type { AchievementDayFacts } from "./achievementFacts";

export type AchievementGroup = "focus" | "rhythm" | "consistency" | "unexpected";

export const ACHIEVEMENT_GROUPS: readonly AchievementGroup[] = ["focus", "rhythm", "consistency", "unexpected"];

export const ACHIEVEMENT_IDS = [
  "firstFlow",
  "flow90",
  "flow180",
  "focusDay8h",
  "earlyStart",
  "nightOwl",
  "weekendShift",
  "streak7",
  "streak30",
  "focus100h",
  "driftDay",
  "noDriftDay",
  "comeback",
] as const;

export type AchievementId = typeof ACHIEVEMENT_IDS[number];

export type AchievementProgress = {
  readonly current: number;
  readonly target: number;
  readonly unit: "seconds" | "days";
};

export type AchievementEvaluation = {
  readonly id: AchievementId;
  /** Logical days on which the achievement was reached, oldest first. */
  readonly earnedDays: readonly string[];
  /** Best result so far against the goal; null where progress would only encourage the wrong thing. */
  readonly progress: AchievementProgress | null;
};

export type AchievementDefinition = {
  readonly id: AchievementId;
  readonly group: AchievementGroup;
  /** Shown as "???" with no goal until earned. */
  readonly hidden: boolean;
  /** Whether reaching it again adds to its count. One-time achievements show no count. */
  readonly repeatable: boolean;
  /** Lead order when several arrive together; higher is more notable. */
  readonly weight: number;
};

export type AchievementEvaluationContext = {
  /** Focus from summarised days that are no longer kept one by one. */
  readonly archivedFocusSeconds?: number;
  /** The last finished day summarised; a streak still counts as going only if it reaches this day. Defaults to the last day given. */
  readonly throughDay?: string | null;
};

const MINUTE = 60;
const HOUR = 60 * MINUTE;

export const ACHIEVEMENT_THRESHOLDS = {
  firstFlowSeconds: 25 * MINUTE,
  flow90Seconds: 90 * MINUTE,
  flow180Seconds: 3 * HOUR,
  focusDaySeconds: 8 * HOUR,
  rhythmFocusSeconds: 30 * MINUTE,
  weekendFocusSeconds: 2 * HOUR,
  /** A day counts toward a streak once it has this much recorded time. */
  streakDaySeconds: 30 * MINUTE,
  cumulativeFocusSeconds: 100 * HOUR,
  /** Days below this much recorded time are too short to call a day of drifting or of no drift. */
  wholeDaySeconds: 4 * HOUR,
  driftDayFocusShare: 0.03,
  driftDayDriftShare: 0.5,
  noDriftSeconds: MINUTE,
  comebackFocusSeconds: 4 * HOUR,
  comebackLowFocusSeconds: HOUR,
  comebackLowDays: 3,
} as const;

export const ACHIEVEMENT_DEFINITIONS: readonly AchievementDefinition[] = [
  { id: "firstFlow", group: "focus", hidden: false, repeatable: false, weight: 1 },
  { id: "flow90", group: "focus", hidden: false, repeatable: true, weight: 3 },
  { id: "flow180", group: "focus", hidden: false, repeatable: true, weight: 6 },
  { id: "focusDay8h", group: "focus", hidden: false, repeatable: true, weight: 5 },
  { id: "earlyStart", group: "rhythm", hidden: false, repeatable: true, weight: 3 },
  { id: "nightOwl", group: "rhythm", hidden: false, repeatable: true, weight: 3 },
  { id: "weekendShift", group: "rhythm", hidden: false, repeatable: true, weight: 4 },
  { id: "streak7", group: "consistency", hidden: false, repeatable: true, weight: 2 },
  { id: "streak30", group: "consistency", hidden: false, repeatable: true, weight: 6 },
  { id: "focus100h", group: "consistency", hidden: false, repeatable: false, weight: 5 },
  { id: "driftDay", group: "unexpected", hidden: false, repeatable: true, weight: 7 },
  { id: "noDriftDay", group: "unexpected", hidden: true, repeatable: true, weight: 7 },
  { id: "comeback", group: "unexpected", hidden: true, repeatable: true, weight: 7 },
];

export function achievementDefinition(id: AchievementId): AchievementDefinition {
  return ACHIEVEMENT_DEFINITIONS.find((definition) => definition.id === id) ?? ACHIEVEMENT_DEFINITIONS[0];
}

/** Evaluate the whole catalogue over summarised days, in any order. */
export function evaluateAchievements(
  facts: readonly AchievementDayFacts[],
  context: AchievementEvaluationContext = {},
): AchievementEvaluation[] {
  const days = [...facts].sort((left, right) => left.day.localeCompare(right.day));
  const t = ACHIEVEMENT_THRESHOLDS;
  const bestRun = maxOf(days, (day) => day.longestFocusRunSeconds);
  const result: AchievementEvaluation[] = [];
  const perDay = (id: AchievementId, reached: (day: AchievementDayFacts) => boolean, progress: AchievementProgress | null) => {
    result.push({ id, earnedDays: days.filter(reached).map((day) => day.day), progress });
  };

  perDay("firstFlow", (day) => day.longestFocusRunSeconds >= t.firstFlowSeconds, seconds(bestRun, t.firstFlowSeconds));
  perDay("flow90", (day) => day.longestFocusRunSeconds >= t.flow90Seconds, seconds(bestRun, t.flow90Seconds));
  perDay("flow180", (day) => day.longestFocusRunSeconds >= t.flow180Seconds, seconds(bestRun, t.flow180Seconds));
  perDay("focusDay8h", (day) => day.focusSeconds >= t.focusDaySeconds, seconds(maxOf(days, (day) => day.focusSeconds), t.focusDaySeconds));
  perDay("earlyStart", (day) => day.earlyFocusSeconds >= t.rhythmFocusSeconds, seconds(maxOf(days, (day) => day.earlyFocusSeconds), t.rhythmFocusSeconds));
  perDay("nightOwl", (day) => day.lateFocusSeconds >= t.rhythmFocusSeconds, seconds(maxOf(days, (day) => day.lateFocusSeconds), t.rhythmFocusSeconds));
  result.push(evaluateWeekendShift(days));
  result.push(evaluateStreak("streak7", days, 7, context.throughDay));
  result.push(evaluateStreak("streak30", days, 30, context.throughDay));
  result.push(evaluateCumulativeFocus(days, context.archivedFocusSeconds ?? 0));
  perDay("driftDay", isDriftDay, null);
  perDay("noDriftDay", (day) => day.trackedSeconds >= t.wholeDaySeconds && day.driftSeconds < t.noDriftSeconds, null);
  result.push(evaluateComeback(days));
  return result;
}

/** Whoop's "1% Club" for attention: a full day recorded with almost no focus and mostly drift. */
export function isDriftDay(day: AchievementDayFacts): boolean {
  const t = ACHIEVEMENT_THRESHOLDS;
  return day.trackedSeconds >= t.wholeDaySeconds
    && day.focusSeconds < day.trackedSeconds * t.driftDayFocusShare
    && day.driftSeconds >= day.trackedSeconds * t.driftDayDriftShare;
}

function evaluateWeekendShift(days: readonly AchievementDayFacts[]): AchievementEvaluation {
  const target = ACHIEVEMENT_THRESHOLDS.weekendFocusSeconds;
  const byDay = new Map(days.map((day) => [day.day, day]));
  const earnedDays: string[] = [];
  let best = 0;
  for (const sunday of days) {
    if (weekdayOf(sunday.day) !== 0) continue;
    const saturday = byDay.get(shiftIsoDate(sunday.day, -1));
    if (!saturday) continue;
    const weaker = Math.min(saturday.focusSeconds, sunday.focusSeconds);
    best = Math.max(best, weaker);
    if (weaker >= target) earnedDays.push(sunday.day);
  }
  return { id: "weekendShift", earnedDays, progress: seconds(best, target) };
}

/**
 * A streak is earned on the day it first reaches its length. Its progress is
 * the streak still going: the run of recorded days ending on the last finished
 * day, or nothing once a day has been missed, so what it says is left really is.
 */
function evaluateStreak(id: AchievementId, days: readonly AchievementDayFacts[], length: number, throughDay?: string | null): AchievementEvaluation {
  const earnedDays: string[] = [];
  let current = 0;
  let previous: string | null = null;
  for (const day of days) {
    if (day.trackedSeconds < ACHIEVEMENT_THRESHOLDS.streakDaySeconds) {
      current = 0;
      previous = null;
      continue;
    }
    current = previous !== null && shiftIsoDate(previous, 1) === day.day ? current + 1 : 1;
    previous = day.day;
    // One streak counts once, on the day it first reaches the length.
    if (current === length) earnedDays.push(day.day);
  }
  const lastDay = throughDay ?? days[days.length - 1]?.day ?? null;
  const going = previous !== null && previous === lastDay ? current : 0;
  return { id, earnedDays, progress: { current: Math.min(going, length), target: length, unit: "days" } };
}

function evaluateCumulativeFocus(days: readonly AchievementDayFacts[], archivedFocusSeconds: number): AchievementEvaluation {
  const target = ACHIEVEMENT_THRESHOLDS.cumulativeFocusSeconds;
  let total = Math.max(0, archivedFocusSeconds);
  let reachedOn: string | null = total >= target && days[0] ? days[0].day : null;
  for (const day of days) {
    total += day.focusSeconds;
    if (reachedOn === null && total >= target) reachedOn = day.day;
  }
  return { id: "focus100h", earnedDays: reachedOn ? [reachedOn] : [], progress: seconds(total, target) };
}

function evaluateComeback(days: readonly AchievementDayFacts[]): AchievementEvaluation {
  const t = ACHIEVEMENT_THRESHOLDS;
  const earnedDays: string[] = [];
  let lowRun = 0;
  let previous: string | null = null;
  for (const day of days) {
    const consecutive = previous !== null && shiftIsoDate(previous, 1) === day.day;
    if (!consecutive) lowRun = 0;
    if (day.focusSeconds >= t.comebackFocusSeconds && consecutive && lowRun >= t.comebackLowDays) earnedDays.push(day.day);
    const isLowDay = day.trackedSeconds >= t.streakDaySeconds && day.focusSeconds < t.comebackLowFocusSeconds;
    lowRun = isLowDay ? lowRun + 1 : 0;
    previous = day.day;
  }
  return { id: "comeback", earnedDays, progress: null };
}

function seconds(current: number, target: number): AchievementProgress {
  return { current: Math.min(Math.max(0, Math.round(current)), target), target, unit: "seconds" };
}

function maxOf(days: readonly AchievementDayFacts[], read: (day: AchievementDayFacts) => number): number {
  return days.reduce((best, day) => Math.max(best, read(day)), 0);
}

function weekdayOf(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date, 12).getDay();
}

