import type { CommunityFocusPercentileModel } from "../companion/communityFocusPercentile";
import { evaluateCompanionCommunityMilestone } from "../companion/companionCommunityMilestones";
import type { ShareCardData, ShareWeekCardData } from "./shareCard";
import { describe, expect, it } from "vitest";
import {
  estimateShareCardFocusPercentile,
} from "./focusPercentile";

const model: CommunityFocusPercentileModel = {
  version: 1, source: "leaderboard", period: "daily", sampleSize: 100, participantCount: 100,
  logMeanMinutes: Math.log(100), logStandardDeviationMinutes: 0.5,
  generatedAt: new Date().toISOString(),
};
const day = { day: "2026-09-07", focusSeconds: 100 * 60, isCurrentPeriod: true } as ShareCardData;
const estimate = (data = day, daily: CommunityFocusPercentileModel | null = model) =>
  estimateShareCardFocusPercentile(data, { daily, weekly: null });

describe("share-card community comparisons", () => {
  it("uses the community median without an additional elapsed-time adjustment", () => {
    expect(estimate(day)?.topPercent).toBeCloseTo(50);
  });

  it("agrees with the achievement threshold and respects the sample-supported tail", () => {
    const daily = { ...model, sampleSize: 20, participantCount: 20 };
    const focusedDay = { ...day, focusSeconds: 500 * 60 };
    expect(estimate(focusedDay, daily)?.topPercent).toBe(10);
    const result = evaluateCompanionCommunityMilestone({
      progress: { celebratedDailyTopTen: false, suppressedDay: null },
      day: day.day, focusSeconds: focusedDay.focusSeconds, model: daily, announce: true,
    });
    expect(result.event?.title).toBe("Top 10% focus today");
    expect(result.event?.subtitle).toContain("20 leaderboard participants");
  });

  it("omits claims for missing, undersized, stale, future, and wrong-period models", () => {
    for (const invalid of [
      null,
      { ...model, sampleSize: 19, participantCount: 19 },
      { ...model, generatedAt: new Date(Date.now() - 13 * 3600_000).toISOString() },
      { ...model, generatedAt: new Date(Date.now() + 3600_000).toISOString() },
      { ...model, period: "weekly" as const },
    ]) expect(estimate(day, invalid)).toBeNull();
  });

  it("does not compare historical or empty focus totals with today's cohort", () => {
    expect(estimate({ ...day, isCurrentPeriod: false })).toBeNull();
    for (const focusSeconds of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(estimate({ ...day, focusSeconds })).toBeNull();
    }
  });

  it("requires the calendar range to match the rolling seven-day comparison", () => {
    const week = {
      startDay: "2026-09-01", endDay: "2026-09-07", comparisonDay: "2026-09-07",
      focusSeconds: 100 * 60, isCurrentPeriod: true,
    } as ShareWeekCardData;
    const models = { daily: null, weekly: { ...model, period: "weekly" as const } };
    expect(estimateShareCardFocusPercentile(week, models)?.topPercent).toBeCloseTo(50);
    expect(estimateShareCardFocusPercentile({ ...week, comparisonDay: "2026-09-05" }, models)).toBeNull();
    expect(estimateShareCardFocusPercentile({ ...week, comparisonDay: undefined }, models)).toBeNull();
    expect(estimateShareCardFocusPercentile({ ...week, startDay: "2026-09-02" }, models)).toBeNull();
    expect(estimateShareCardFocusPercentile({ ...week, isCurrentPeriod: false }, models)).toBeNull();
  });
});
