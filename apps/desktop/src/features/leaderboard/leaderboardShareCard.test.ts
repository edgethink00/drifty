import { describe, expect, it } from "vitest";
import { buildLeaderboardShareCard, leaderboardShareStoryIds } from "./leaderboardShareCard";

const point = (day: string, focus: number) => ({ day, focus, drift: 0, neutral: 0 });

describe("buildLeaderboardShareCard", () => {
  it.each([
    ["ja", "第"], ["pt-BR", "Semana"], ["zh-Hans", "第"], ["fr", "Semaine"], ["de", "Woche"],
  ] as const)("assembles %s export labels in the selected language", (language, weekLabel) => {
    const card = buildLeaderboardShareCard({ language, period: "weekly", windowEndDay: "2026-10-13", dailyProductivity: [] });
    expect(card.data.language).toBe(language);
    if (card.kind !== "week") throw new Error("Expected the weekly aggregate card");
    expect(card.data.weekLabel).toContain(weekLabel);
    expect(card.data.rangeLabel).not.toContain("Oct");
  });

  it("preserves English export labels for the Korean UI", () => {
    const card = buildLeaderboardShareCard({ language: "ko", period: "daily", windowEndDay: "2026-10-13", dailyProductivity: [] });
    expect(card.data.language).toBe("en");
    if (card.kind !== "day") throw new Error("Expected the daily aggregate card");
    expect(card.data.dateLabel).toBe("Oct 13");
  });

  it("fills days without data in the weekly rank window with zero focus", () => {
    const card = buildLeaderboardShareCard({
      period: "weekly",
      windowEndDay: "2026-10-13",
      dailyProductivity: [point("2026-10-10", 3_600), point("2026-10-13", 1_800)],
    });

    expect(card.kind).toBe("week");
    if (card.kind !== "week") return;
    expect(card.data.days.map((day) => [day.day, day.focusSeconds])).toEqual([
      ["2026-10-07", 0], ["2026-10-08", 0], ["2026-10-09", 0], ["2026-10-10", 3_600],
      ["2026-10-11", 0], ["2026-10-12", 0], ["2026-10-13", 1_800],
    ]);
    expect(card.data.deltaSeconds).toBeNull();
    expect(card.data.slices).toEqual([]);
  });

  it("compares the week with the seven days before it when they were tracked", () => {
    const card = buildLeaderboardShareCard({
      period: "weekly",
      windowEndDay: "2026-10-13",
      dailyProductivity: [point("2026-10-01", 600), point("2026-10-13", 1_800)],
    });

    expect(card.kind === "week" ? card.data.deltaSeconds : undefined).toBe(1_200);
  });

  it("offers only stories the leaderboard aggregates can fill", () => {
    const day = buildLeaderboardShareCard({ period: "daily", windowEndDay: "2026-10-13", dailyProductivity: [] });
    const week = buildLeaderboardShareCard({ period: "weekly", windowEndDay: "2026-10-13", dailyProductivity: [] });

    expect(leaderboardShareStoryIds(day, true)).not.toContain("X4");
    expect(leaderboardShareStoryIds(week, true)).toEqual(["WR4", "WR1", "W5", "X5"]);
  });

  it("opens on the exact placement only when the board shows a rank", () => {
    const day = buildLeaderboardShareCard({ period: "daily", windowEndDay: "2026-10-13", dailyProductivity: [] });
    const week = buildLeaderboardShareCard({ period: "weekly", windowEndDay: "2026-10-13", dailyProductivity: [] });

    expect(leaderboardShareStoryIds(day, true)[0]).toBe("R4");
    expect(leaderboardShareStoryIds(day, false)[0]).toBe("R2");
    expect(leaderboardShareStoryIds(day, false).slice(-1)[0]).toBe("R4");
    expect(leaderboardShareStoryIds(week, false)).toEqual(["WR1", "W5", "X5", "WR4"]);
  });

  it("offers only the place card while the daily series is missing", () => {
    const week = buildLeaderboardShareCard({ period: "weekly", windowEndDay: "2026-10-13", dailyProductivity: [] });

    expect(leaderboardShareStoryIds(week, true, false)).toEqual(["WR4"]);
  });
});
