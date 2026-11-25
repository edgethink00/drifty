import { describe, expect, it } from "vitest";
import { bestDay, dayMeasure, dayMeasureKind } from "./achievementDayMeasure";
import type { AchievementDayFacts } from "./achievementFacts";

const day = (date: string, patch: Partial<AchievementDayFacts>): AchievementDayFacts => ({
  day: date, trackedSeconds: 0, focusSeconds: 0, driftSeconds: 0, longestFocusRunSeconds: 0, earlyFocusSeconds: 0, lateFocusSeconds: 0, ...patch,
});

describe("achievement day measures", () => {
  it("reads the figure that decided each one-day achievement", () => {
    const facts = day("2026-11-03", { trackedSeconds: 8000, focusSeconds: 6000, driftSeconds: 2000, longestFocusRunSeconds: 5400, earlyFocusSeconds: 1800 });
    expect(dayMeasure(dayMeasureKind("flow90")!, facts)).toBe(5400);
    expect(dayMeasure(dayMeasureKind("focusDay8h")!, facts)).toBe(6000);
    expect(dayMeasure(dayMeasureKind("earlyStart")!, facts)).toBe(1800);
    expect(dayMeasure(dayMeasureKind("driftDay")!, facts)).toBe(0.25);
  });

  it("has no single-day figure for achievements judged over several days", () => {
    expect(dayMeasureKind("streak7")).toBeNull();
    expect(dayMeasureKind("focus100h")).toBeNull();
    expect(dayMeasureKind("comeback")).toBeNull();
  });

  it("finds the day that came closest for time goals only", () => {
    const facts = [day("2026-11-01", { focusSeconds: 3600 }), day("2026-11-02", { focusSeconds: 23160 }), day("2026-11-03", { focusSeconds: 7200 })];
    expect(bestDay("focusDay8h", facts)).toEqual({ day: "2026-11-02", value: 23160 });
    expect(bestDay("noDriftDay", facts)).toBeNull();
    expect(bestDay("streak30", facts)).toBeNull();
    expect(bestDay("nightOwl", facts)).toBeNull();
  });
});
