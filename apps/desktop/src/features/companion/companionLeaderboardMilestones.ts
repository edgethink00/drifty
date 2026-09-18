import { shiftIsoDate } from "@drifty/domain";
import type { LeaderboardCheckpointEntry } from "../leaderboard/leaderboardService";
import type { StartOfWeek } from "../settings/settingsStorage";
import type { CompanionPillMilestoneEvent } from "./CompanionPillMoment";
import { translateFor, type Translate } from "../localization/translate";

export const DAILY_LEADERBOARD_CHECKPOINT_MINUTE = 20 * 60;
export const WEEKLY_LEADERBOARD_RESULT_MINUTE = 9 * 60;
export const LEADERBOARD_CELEBRATION_MIN_PARTICIPANTS = 10;
export const COMPANION_LEADERBOARD_MILESTONES_STORAGE_KEY =
  "drifty.companion.leaderboardCelebrations.v2";

export type LeaderboardCelebration = {
  readonly period: "daily" | "weekly";
  readonly rank: 1 | 2 | 3;
  readonly participantCount: number;
  readonly focusSeconds: number;
  readonly windowEndDay: string;
};

export type CompanionLeaderboardMilestoneProgress = {
  readonly userScopeKey: string;
  readonly lastWeeklyWindowEndDay: string | null;
};

export function toLeaderboardCelebration(
  entry: LeaderboardCheckpointEntry | null,
  period: "daily" | "weekly",
  windowEndDay: string,
): LeaderboardCelebration | null {
  if (!entry) return null;
  if (entry.period !== period || entry.window_end_date !== windowEndDay) return null;
  if (!entry.opted_in || entry.focus_seconds <= 0) return null;
  if (entry.participant_count < LEADERBOARD_CELEBRATION_MIN_PARTICIPANTS) return null;
  if (entry.rank !== 1 && entry.rank !== 2 && entry.rank !== 3) return null;

  return {
    period,
    rank: entry.rank,
    participantCount: entry.participant_count,
    focusSeconds: entry.focus_seconds,
    windowEndDay,
  };
}

export function getCompanionWeeklyResultWindowEndDay(
  calendarDay: string,
  currentMinuteOfDay: number,
  startOfWeek: StartOfWeek,
  startOfDayMinutes = 0,
): string | null {
  const date = new Date(`${calendarDay}T12:00:00`);
  if (!Number.isFinite(date.getTime())) return null;

  const weekStartWeekday: Record<StartOfWeek, number> = { sunday: 0, monday: 1, saturday: 6 };
  const weekEndWeekday = (weekStartWeekday[startOfWeek] + 6) % 7;
  const weekday = date.getDay();
  const daysSinceClose = (weekday - weekEndWeekday + 7) % 7;

  // The current closing weekday is not final until midnight. Do not resurrect
  // the prior result a full week late while the next window is about to close.
  if (daysSinceClose === 0) return null;
  const resultMinute = Math.max(WEEKLY_LEADERBOARD_RESULT_MINUTE, startOfDayMinutes);
  if (daysSinceClose === 1 && currentMinuteOfDay < resultMinute) return null;
  return shiftIsoDate(calendarDay, -daysSinceClose);
}

export function initializeCompanionLeaderboardMilestones(
  userScopeKey: string,
  stored = readCompanionLeaderboardMilestones(),
): CompanionLeaderboardMilestoneProgress {
  if (stored?.userScopeKey === userScopeKey) return stored;
  return { userScopeKey, lastWeeklyWindowEndDay: null };
}

export function evaluateCompanionWeeklyLeaderboardMilestone({
  progress,
  windowEndDay,
  entry,
  announce,
  translate,
}: {
  readonly progress: CompanionLeaderboardMilestoneProgress;
  readonly windowEndDay: string;
  readonly entry: LeaderboardCheckpointEntry | null;
  readonly announce: boolean;
  readonly translate?: Translate;
}): {
  readonly progress: CompanionLeaderboardMilestoneProgress;
  readonly event: CompanionPillMilestoneEvent | null;
} {
  if (progress.lastWeeklyWindowEndDay && progress.lastWeeklyWindowEndDay >= windowEndDay) {
    return { progress, event: null };
  }

  const celebration = toLeaderboardCelebration(entry, "weekly", windowEndDay);
  const nextProgress = { ...progress, lastWeeklyWindowEndDay: windowEndDay };
  return {
    progress: nextProgress,
    event: announce && celebration ? buildWeeklyLeaderboardResultEvent(celebration, translate ?? translateFor("en")) : null,
  };
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
    // The in-memory progress still prevents duplicates for this session.
  }
}

function buildWeeklyLeaderboardResultEvent(
  celebration: LeaderboardCelebration,
  translate: Translate,
): CompanionPillMilestoneEvent {
  return {
    kind: "milestone",
    id: `companion-leaderboard-final:weekly:${celebration.windowEndDay}:rank${celebration.rank}`,
    milestoneKind: "rank",
    tier: 3,
    title: translate("companion.milestone.leaderboardTitle", { rank: celebration.rank }),
    subtitle: translate("companion.milestone.leaderboardSubtitle", { participants: celebration.participantCount }),
    destination: "leaderboard",
    statSeconds: celebration.focusSeconds,
    statLabel: translate("companion.milestone.statLastWeek"),
    generatedAt: new Date().toISOString(),
  };
}

function isStoredProgress(value: unknown): value is CompanionLeaderboardMilestoneProgress {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<CompanionLeaderboardMilestoneProgress>;
  return typeof candidate.userScopeKey === "string"
    && (candidate.lastWeeklyWindowEndDay === null || typeof candidate.lastWeeklyWindowEndDay === "string");
}
