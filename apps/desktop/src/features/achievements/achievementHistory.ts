import type { AchievementDefinition } from "./achievementCatalog";
import type { EarnedAchievement } from "./achievementStore";

/**
 * Every time an earned achievement was reached, read from the daily facts this
 * computer still keeps (about the last two years). Older days are folded into
 * a running total, so a long record can hold more times than kept days.
 */
export type AchievementHistory = {
  /** Kept days it was reached on, newest first. A one-off achievement lists only the day it was earned. */
  readonly days: readonly string[];
  /** Times earned before the kept days begin: the count beyond the days listed. */
  readonly earlier: number;
};

/** One kept day of a history with which time it was: the newest is the count-th. */
export type AchievementHistoryEntry = {
  readonly day: string;
  readonly ordinal: number;
};

/**
 * History of one achievement from its evaluation's earned days (oldest first,
 * as evaluateAchievements returns them). Null until it is earned.
 */
export function achievementHistory(
  definition: AchievementDefinition,
  earned: EarnedAchievement | null,
  earnedDays: readonly string[],
): AchievementHistory | null {
  if (!earned) return null;
  if (!definition.repeatable) return { days: [earned.firstDay], earlier: 0 };
  const days = [...new Set(earnedDays)].sort((left, right) => right.localeCompare(left)).slice(0, earned.count);
  return { days, earlier: Math.max(0, earned.count - days.length) };
}

/** The history to show: the kept one when known, else what the earned record alone tells (first and latest day). */
export function historyFor(item: {
  readonly definition: AchievementDefinition;
  readonly earned: EarnedAchievement | null;
  readonly history?: AchievementHistory | null;
}): AchievementHistory | null {
  if (item.history) return item.history;
  const { definition, earned } = item;
  if (!earned) return null;
  if (!definition.repeatable) return { days: [earned.firstDay], earlier: 0 };
  const days = earned.count > 1 && earned.firstDay !== earned.lastDay ? [earned.lastDay, earned.firstDay] : [earned.lastDay];
  return { days: days.slice(0, earned.count), earlier: Math.max(0, earned.count - days.length) };
}

/** Kept days numbered by which time each was, newest first: with 39 times and none folded away, the first entry is the 39th. */
export function historyEntries(history: AchievementHistory): AchievementHistoryEntry[] {
  const total = history.days.length + history.earlier;
  return history.days.map((day, index) => ({ day, ordinal: total - index }));
}
