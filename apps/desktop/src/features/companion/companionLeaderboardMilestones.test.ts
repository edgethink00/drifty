// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { LeaderboardCheckpointEntry } from "../leaderboard/leaderboardService";
import {
  COMPANION_LEADERBOARD_MILESTONES_STORAGE_KEY,
  DAILY_LEADERBOARD_CHECKPOINT_MINUTE,
  evaluateCompanionWeeklyLeaderboardMilestone,
  getCompanionWeeklyResultWindowEndDay,
  initializeCompanionLeaderboardMilestones,
  persistCompanionLeaderboardMilestones,
  readCompanionLeaderboardMilestones,
  toLeaderboardCelebration,
  WEEKLY_LEADERBOARD_RESULT_MINUTE,
} from "./companionLeaderboardMilestones";

function entry(
  period: "daily" | "weekly",
  rank: number,
  day: string,
  overrides: Partial<LeaderboardCheckpointEntry> = {},
): LeaderboardCheckpointEntry {
  return {
    rank,
    participant_count: 14,
    display_name: "Drifty",
    period,
    focus_seconds: period === "daily" ? 14_400 : 58_000,
    focus_seconds_7d: period === "daily" ? 14_400 : 58_000,
    window_start_date: period === "daily" ? day : "2026-07-27",
    window_end_date: day,
    timezone: "Asia/Seoul",
    opted_in: true,
    updated_at: `${day}T11:00:00.000Z`,
    ...overrides,
  };
}

describe("Companion leaderboard celebration policy", () => {
  afterEach(() => window.localStorage.clear());

  it("uses an 8 PM daily checkpoint and a 9 AM weekly result", () => {
    expect(DAILY_LEADERBOARD_CHECKPOINT_MINUTE).toBe(20 * 60);
    expect(WEEKLY_LEADERBOARD_RESULT_MINUTE).toBe(9 * 60);
  });

  it("celebrates only real-account checkpoint entries in the top three with at least ten active people", () => {
    expect(toLeaderboardCelebration(entry("daily", 2, "2026-08-03"), "daily", "2026-08-03")).toMatchObject({
      rank: 2,
      participantCount: 14,
      windowEndDay: "2026-08-03",
    });
    expect(toLeaderboardCelebration(entry("daily", 4, "2026-08-03"), "daily", "2026-08-03")).toBeNull();
    expect(toLeaderboardCelebration(entry("daily", 2, "2026-08-03", { participant_count: 9 }), "daily", "2026-08-03")).toBeNull();
    expect(toLeaderboardCelebration(entry("daily", 2, "2026-08-03", { focus_seconds: 0 }), "daily", "2026-08-03")).toBeNull();
    expect(toLeaderboardCelebration(entry("daily", 2, "2026-08-02"), "daily", "2026-08-03")).toBeNull();
  });

  it("makes the closed weekly window available at 9 AM on the following day", () => {
    expect(getCompanionWeeklyResultWindowEndDay("2026-08-03", 8 * 60 + 59, "monday")).toBeNull();
    expect(getCompanionWeeklyResultWindowEndDay("2026-08-03", 9 * 60, "monday")).toBe("2026-08-02");
    expect(getCompanionWeeklyResultWindowEndDay("2026-08-04", 12 * 60, "monday")).toBe("2026-08-02");
    expect(getCompanionWeeklyResultWindowEndDay("2026-08-02", 20 * 60, "monday")).toBeNull();
  });

  it("maps weekly closing days from the user's start-of-week setting", () => {
    expect(getCompanionWeeklyResultWindowEndDay("2026-08-03", 9 * 60, "monday")).toBe("2026-08-02");
    expect(getCompanionWeeklyResultWindowEndDay("2026-08-02", 9 * 60, "sunday")).toBe("2026-08-01");
    expect(getCompanionWeeklyResultWindowEndDay("2026-08-01", 9 * 60, "saturday")).toBe("2026-07-31");
  });

  it("does not finalize before a logical day boundary later than 9 AM", () => {
    expect(getCompanionWeeklyResultWindowEndDay("2026-08-03", 9 * 60, "monday", 12 * 60)).toBeNull();
    expect(getCompanionWeeklyResultWindowEndDay("2026-08-03", 12 * 60, "monday", 12 * 60)).toBe("2026-08-02");
  });

  it("announces one finalized weekly result and consumes that closed window", () => {
    const progress = initializeCompanionLeaderboardMilestones("user-1", null);
    const first = evaluateCompanionWeeklyLeaderboardMilestone({
      progress,
      windowEndDay: "2026-08-02",
      entry: entry("weekly", 2, "2026-08-02"),
      announce: true,
    });
    const duplicate = evaluateCompanionWeeklyLeaderboardMilestone({
      progress: first.progress,
      windowEndDay: "2026-08-02",
      entry: entry("weekly", 1, "2026-08-02"),
      announce: true,
    });

    expect(first.event).toMatchObject({
      id: "companion-leaderboard-final:weekly:2026-08-02:rank2",
      title: "#2 in focus last week",
      subtitle: "Final rank among 14 active people",
    });
    expect(duplicate.event).toBeNull();
  });

  it("consumes an ineligible completed window without retrying a non-celebration", () => {
    const progress = initializeCompanionLeaderboardMilestones("user-1", null);
    const result = evaluateCompanionWeeklyLeaderboardMilestone({
      progress,
      windowEndDay: "2026-08-02",
      entry: entry("weekly", 7, "2026-08-02"),
      announce: true,
    });

    expect(result.event).toBeNull();
    expect(result.progress.lastWeeklyWindowEndDay).toBe("2026-08-02");
  });

  it("draws only a weekly first place as the trophy card", () => {
    const celebrate = (rank: number) => evaluateCompanionWeeklyLeaderboardMilestone({
      progress: initializeCompanionLeaderboardMilestones("user-" + rank, null),
      windowEndDay: "2026-08-02",
      entry: entry("weekly", rank, "2026-08-02"),
      announce: true,
    }).event;

    expect(celebrate(1)).toMatchObject({ title: "#1 in focus last week", presentation: "trophyCard" });
    expect(celebrate(2)).not.toBeNull();
    expect(celebrate(2)?.presentation).toBeUndefined();
    expect(celebrate(3)?.presentation).toBeUndefined();
  });

  it("persists only the user-scoped finalized weekly checkpoint", () => {
    const progress = { userScopeKey: "user-1", lastWeeklyWindowEndDay: "2026-08-02" };
    persistCompanionLeaderboardMilestones(progress);
    expect(readCompanionLeaderboardMilestones()).toEqual(progress);

    window.localStorage.setItem(COMPANION_LEADERBOARD_MILESTONES_STORAGE_KEY, JSON.stringify({
      userScopeKey: "user-1",
      lastWeeklyWindowEndDay: 8,
    }));
    expect(readCompanionLeaderboardMilestones()).toBeNull();
  });
});
