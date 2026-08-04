// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { LeaderboardPeriod, OwnLeaderboardEntry } from "../leaderboard/leaderboardService";
import {
  COMPANION_LEADERBOARD_MILESTONES_STORAGE_KEY,
  evaluateCompanionLeaderboardMilestones,
  getCompanionWeeklyRankClosingDay,
  initializeCompanionLeaderboardMilestones,
  isCompanionWeeklyRankDue,
  persistCompanionLeaderboardMilestones,
  readCompanionLeaderboardMilestones,
} from "./companionLeaderboardMilestones";

function entry(period: LeaderboardPeriod, rank: number, day = "2026-08-03"): OwnLeaderboardEntry {
  return {
    rank,
    display_name: "Drifty",
    period,
    focus_seconds: period === "daily" ? 14_400 : 58_000,
    focus_seconds_7d: period === "daily" ? 14_400 : 58_000,
    window_start_date: period === "daily" ? day : "2026-07-28",
    window_end_date: day,
    timezone: "Asia/Seoul",
    opted_in: true,
    updated_at: `${day}T09:00:00.000Z`,
  };
}

describe("Companion leaderboard milestones", () => {
  afterEach(() => window.localStorage.clear());

  it("announces daily #3, #2 and #1 only as the rank improves", () => {
    let progress = initializeCompanionLeaderboardMilestones("user-1", "2026-08-03", null);
    const titles: string[] = [];
    for (const rank of [3, 3, 2, 4, 1]) {
      const result = evaluateCompanionLeaderboardMilestones({
        progress,
        day: "2026-08-03",
        currentMinuteOfDay: 12 * 60,
        startOfWeek: "monday",
        dailyEntry: entry("daily", rank),
        weeklyEntry: null,
        announce: true,
      });
      progress = result.progress;
      titles.push(...result.events.map((event) => event.title));
    }

    expect(titles).toEqual([
      "#3 in focus today",
      "#2 in focus today",
      "#1 in focus today",
    ]);
  });

  it("announces only #1 when the observed rank jumps directly from #4", () => {
    let progress = initializeCompanionLeaderboardMilestones("user-1", "2026-08-03", null);
    const outsidePodium = evaluateCompanionLeaderboardMilestones({
      progress,
      day: "2026-08-03",
      currentMinuteOfDay: 12 * 60,
      startOfWeek: "monday",
      dailyEntry: entry("daily", 4),
      weeklyEntry: null,
      announce: true,
    });
    progress = outsidePodium.progress;
    const firstPlace = evaluateCompanionLeaderboardMilestones({
      progress,
      day: "2026-08-03",
      currentMinuteOfDay: 12 * 60 + 5,
      startOfWeek: "monday",
      dailyEntry: entry("daily", 1),
      weeklyEntry: null,
      announce: true,
    });

    expect(outsidePodium.events).toEqual([]);
    expect(firstPlace.events.map((event) => event.title)).toEqual(["#1 in focus today"]);
  });

  it("shows the weekly rank only after 18:00 on the configured final weekday", () => {
    const progress = initializeCompanionLeaderboardMilestones("user-1", "2026-08-02", null);
    const before = evaluateCompanionLeaderboardMilestones({
      progress,
      day: "2026-08-02",
      currentMinuteOfDay: 17 * 60 + 59,
      startOfWeek: "monday",
      dailyEntry: null,
      weeklyEntry: entry("weekly", 2, "2026-08-02"),
      announce: true,
    });
    const after = evaluateCompanionLeaderboardMilestones({
      progress: before.progress,
      day: "2026-08-02",
      currentMinuteOfDay: 18 * 60,
      startOfWeek: "monday",
      dailyEntry: null,
      weeklyEntry: entry("weekly", 2, "2026-08-02"),
      announce: true,
    });

    expect(before.events).toEqual([]);
    expect(after.events[0]).toMatchObject({
      title: "#2 in focus this week",
      statLabel: "7 days",
    });
  });

  it("maps the weekly closing day to the user's start-of-week setting", () => {
    expect(isCompanionWeeklyRankDue("2026-08-02", 18 * 60, "monday")).toBe(true); // Sunday
    expect(isCompanionWeeklyRankDue("2026-08-01", 18 * 60, "sunday")).toBe(true); // Saturday
    expect(isCompanionWeeklyRankDue("2026-07-31", 18 * 60, "saturday")).toBe(true); // Friday
  });

  it("carries an unseen weekly result into the next day", () => {
    const progress = initializeCompanionLeaderboardMilestones("user-1", "2026-08-03", null);
    const result = evaluateCompanionLeaderboardMilestones({
      progress,
      day: "2026-08-03", // Monday
      currentMinuteOfDay: 9 * 60,
      startOfWeek: "monday",
      dailyEntry: null,
      weeklyEntry: entry("weekly", 2, "2026-08-02"),
      announce: true,
    });

    expect(getCompanionWeeklyRankClosingDay("2026-08-03", 9 * 60, "monday")).toBe("2026-08-02");
    expect(result.progress.weeklyClosingDay).toBe("2026-08-02");
    expect(result.events.map((event) => event.title)).toEqual(["#2 in focus this week"]);
  });

  it("consumes a muted rank without replaying it when announcements resume", () => {
    const progress = initializeCompanionLeaderboardMilestones("user-1", "2026-08-03", null);
    const muted = evaluateCompanionLeaderboardMilestones({
      progress,
      day: "2026-08-03",
      currentMinuteOfDay: 12 * 60,
      startOfWeek: "monday",
      dailyEntry: entry("daily", 3),
      weeklyEntry: null,
      announce: false,
    });
    const shown = evaluateCompanionLeaderboardMilestones({
      progress: muted.progress,
      day: "2026-08-03",
      currentMinuteOfDay: 12 * 60 + 5,
      startOfWeek: "monday",
      dailyEntry: entry("daily", 3),
      weeklyEntry: null,
      announce: true,
    });

    expect(muted.events).toEqual([]);
    expect(shown.events).toEqual([]);
  });

  it("persists only safe top-three progress and ignores corrupt storage", () => {
    const progress = initializeCompanionLeaderboardMilestones("user-1", "2026-08-03", null);
    persistCompanionLeaderboardMilestones({ ...progress, bestDailyRank: 2 });
    expect(readCompanionLeaderboardMilestones()?.bestDailyRank).toBe(2);

    window.localStorage.setItem(COMPANION_LEADERBOARD_MILESTONES_STORAGE_KEY, JSON.stringify({
      ...progress,
      bestDailyRank: 8,
    }));
    expect(readCompanionLeaderboardMilestones()).toBeNull();
  });
});
