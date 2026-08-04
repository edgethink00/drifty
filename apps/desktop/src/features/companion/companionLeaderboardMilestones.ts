import { shiftIsoDate } from "@drifty/domain";
import type { StartOfWeek } from "../settings/settingsStorage";
import type { OwnLeaderboardEntry } from "../leaderboard/leaderboardService";
import type { CompanionPillMilestoneEvent } from "./CompanionPillMoment";

export const COMPANION_LEADERBOARD_MILESTONES_STORAGE_KEY =
  "drifty.companion.leaderboardMilestones.v1";
export const COMPANION_WEEKLY_RANK_ANNOUNCEMENT_MINUTE = 18 * 60;

export type CompanionLeaderboardMilestoneProgress = {
  readonly userScopeKey: string;
  readonly dailyDay: string;
  readonly bestDailyRank: number | null;
  readonly weeklyClosingDay: string | null;
  readonly bestWeeklyRank: number | null;
};

export function initializeCompanionLeaderboardMilestones(
  userScopeKey: string,
  day: string,
  stored = readCompanionLeaderboardMilestones(),
): CompanionLeaderboardMilestoneProgress {
  if (stored?.userScopeKey === userScopeKey) {
    return {
      ...stored,
      dailyDay: day,
      bestDailyRank: stored.dailyDay === day ? stored.bestDailyRank : null,
    };
  }
  return {
    userScopeKey,
    dailyDay: day,
    bestDailyRank: null,
    weeklyClosingDay: null,
    bestWeeklyRank: null,
  };
}

export function evaluateCompanionLeaderboardMilestones({
  progress,
  day,
  currentMinuteOfDay,
  startOfWeek,
  dailyEntry,
  weeklyEntry,
  announce,
}: {
  readonly progress: CompanionLeaderboardMilestoneProgress;
  readonly day: string;
  readonly currentMinuteOfDay: number;
  readonly startOfWeek: StartOfWeek;
  readonly dailyEntry: OwnLeaderboardEntry | null;
  readonly weeklyEntry: OwnLeaderboardEntry | null;
  readonly announce: boolean;
}): {
  readonly progress: CompanionLeaderboardMilestoneProgress;
  readonly events: readonly CompanionPillMilestoneEvent[];
} {
  let bestDailyRank = progress.dailyDay === day ? progress.bestDailyRank : null;
  let weeklyClosingDay = progress.weeklyClosingDay;
  let bestWeeklyRank = progress.bestWeeklyRank;
  const events: CompanionPillMilestoneEvent[] = [];

  if (isCurrentTopThreeEntry(dailyEntry, "daily", day)) {
    const rank = dailyEntry.rank;
    if (bestDailyRank === null || rank < bestDailyRank) {
      bestDailyRank = rank;
      if (announce) events.push(buildLeaderboardRankEvent("daily", day, dailyEntry));
    }
  }

  const dueWeeklyClosingDay = getCompanionWeeklyRankClosingDay(day, currentMinuteOfDay, startOfWeek);
  if (dueWeeklyClosingDay) {
    if (weeklyClosingDay !== dueWeeklyClosingDay) {
      weeklyClosingDay = dueWeeklyClosingDay;
      bestWeeklyRank = null;
    }
    const latestWeeklyEntryDay = shiftIsoDate(dueWeeklyClosingDay, 7) === day
      && currentMinuteOfDay < COMPANION_WEEKLY_RANK_ANNOUNCEMENT_MINUTE
      ? dueWeeklyClosingDay
      : day;
    if (isTopThreeEntryForWindow(weeklyEntry, "weekly", dueWeeklyClosingDay, latestWeeklyEntryDay)) {
      const rank = weeklyEntry.rank;
      if (bestWeeklyRank === null || rank < bestWeeklyRank) {
        bestWeeklyRank = rank;
        if (announce) events.push(buildLeaderboardRankEvent("weekly", dueWeeklyClosingDay, weeklyEntry));
      }
    }
  }

  return {
    progress: {
      ...progress,
      dailyDay: day,
      bestDailyRank,
      weeklyClosingDay,
      bestWeeklyRank,
    },
    events,
  };
}

export function isCompanionWeeklyRankDue(
  day: string,
  currentMinuteOfDay: number,
  startOfWeek: StartOfWeek,
): boolean {
  return getCompanionWeeklyRankClosingDay(day, currentMinuteOfDay, startOfWeek) === day;
}

/**
 * Returns the latest weekly close whose result may be announced. Before 18:00
 * on the configured closing weekday, the previous week's close remains due;
 * after 18:00, the current day becomes due. This lets an unseen Sunday result
 * appear when the app is first opened on Monday instead of being lost.
 */
export function getCompanionWeeklyRankClosingDay(
  day: string,
  currentMinuteOfDay: number,
  startOfWeek: StartOfWeek,
): string | null {
  const date = new Date(`${day}T12:00:00`);
  if (!Number.isFinite(date.getTime())) return null;
  const weekday = date.getDay();
  const weekStartWeekday: Record<StartOfWeek, number> = { sunday: 0, monday: 1, saturday: 6 };
  const weekEndWeekday = (weekStartWeekday[startOfWeek] + 6) % 7;
  let daysSinceClose = (weekday - weekEndWeekday + 7) % 7;
  if (daysSinceClose === 0 && currentMinuteOfDay < COMPANION_WEEKLY_RANK_ANNOUNCEMENT_MINUTE) {
    daysSinceClose = 7;
  }
  return shiftIsoDate(day, -daysSinceClose);
}

export function readCompanionLeaderboardMilestones(): CompanionLeaderboardMilestoneProgress | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(COMPANION_LEADERBOARD_MILESTONES_STORAGE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    return isStoredProgress(value) ? value : null;
  } catch {
    return null;
  }
}

export function persistCompanionLeaderboardMilestones(
  progress: CompanionLeaderboardMilestoneProgress,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      COMPANION_LEADERBOARD_MILESTONES_STORAGE_KEY,
      JSON.stringify(progress),
    );
  } catch {
    // The in-memory progress still prevents duplicate moments for this session.
  }
}

function buildLeaderboardRankEvent(
  period: "daily" | "weekly",
  day: string,
  entry: OwnLeaderboardEntry & { rank: number },
): CompanionPillMilestoneEvent {
  const periodLabel = period === "daily" ? "today" : "this week";
  return {
    kind: "milestone",
    id: `companion-leaderboard:${period}:${day}:rank${entry.rank}`,
    milestoneKind: "rank",
    tier: 3,
    title: `#${entry.rank} in focus ${periodLabel}`,
    subtitle: rankSubtitle(entry.rank, period),
    destination: "leaderboard",
    statSeconds: entry.focus_seconds,
    statLabel: period === "daily" ? "today" : "7 days",
  };
}

function rankSubtitle(rank: number, period: "daily" | "weekly"): string {
  if (period === "weekly") return `Your rolling 7-day focus is #${rank}`;
  if (rank === 1) return "You reached the top of today's leaderboard";
  if (rank === 2) return "You moved into second place today";
  return "You entered today's top three";
}

function isCurrentTopThreeEntry(
  entry: OwnLeaderboardEntry | null,
  period: "daily" | "weekly",
  day: string,
): entry is OwnLeaderboardEntry & { rank: number } {
  return isTopThreeEntryForWindow(entry, period, day, day);
}

function isTopThreeEntryForWindow(
  entry: OwnLeaderboardEntry | null,
  period: "daily" | "weekly",
  earliestWindowEndDay: string,
  latestWindowEndDay: string,
): entry is OwnLeaderboardEntry & { rank: number } {
  return entry?.period === period
    && entry.opted_in === true
    && entry.window_end_date >= earliestWindowEndDay
    && entry.window_end_date <= latestWindowEndDay
    && typeof entry.rank === "number"
    && Number.isInteger(entry.rank)
    && entry.rank >= 1
    && entry.rank <= 3;
}

function isStoredProgress(value: unknown): value is CompanionLeaderboardMilestoneProgress {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<CompanionLeaderboardMilestoneProgress>;
  return typeof candidate.userScopeKey === "string"
    && typeof candidate.dailyDay === "string"
    && isNullableTopThreeRank(candidate.bestDailyRank)
    && (candidate.weeklyClosingDay === null || typeof candidate.weeklyClosingDay === "string")
    && isNullableTopThreeRank(candidate.bestWeeklyRank);
}

function isNullableTopThreeRank(value: unknown): value is number | null {
  return value === null
    || (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 3);
}
