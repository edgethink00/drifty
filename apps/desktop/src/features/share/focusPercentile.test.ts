import { describe, expect, it } from "vitest";
import {
  dailyFocusComparisonProgress,
  estimateFocusTopPercent,
  weeklyFocusComparisonProgress,
} from "./focusPercentile";

describe("estimateFocusTopPercent", () => {
  it("centers the completed-day estimate on the leaderboard-backed daily model", () => {
    expect(estimateFocusTopPercent(200 * 60, "daily")).toBe(50);
  });

  it("centers the completed-week estimate on the leaderboard-backed weekly model", () => {
    expect(estimateFocusTopPercent(727 * 60, "weekly")).toBe(50);
  });

  it("compares an in-progress day against the elapsed portion of the distribution", () => {
    const halfway = estimateFocusTopPercent(100 * 60, "daily", 0.5);
    const completed = estimateFocusTopPercent(100 * 60, "daily", 1);

    expect(halfway).toBe(50);
    expect(completed).toBeGreaterThan(halfway);
  });

  it("avoids false precision at the tails", () => {
    expect(estimateFocusTopPercent(0, "daily")).toBeLessThanOrEqual(99.9);
    expect(estimateFocusTopPercent(1_000 * 60 * 60, "weekly")).toBe(0.1);
  });
});

describe("focus comparison progress", () => {
  it("uses logical-day progress only for the current day", () => {
    expect(dailyFocusComparisonProgress("2026-08-21", "2026-08-21", 12 * 60)).toBe(0.5);
    expect(dailyFocusComparisonProgress("2026-08-20", "2026-08-21", 12 * 60)).toBe(1);
  });

  it("combines elapsed calendar days and today's progress for the current week", () => {
    expect(weeklyFocusComparisonProgress("2026-08-17", "2026-08-23", "2026-08-19", 12 * 60)).toBeCloseTo(2.5 / 7);
    expect(weeklyFocusComparisonProgress("2026-08-10", "2026-08-16", "2026-08-21", 12 * 60)).toBe(1);
  });
});
