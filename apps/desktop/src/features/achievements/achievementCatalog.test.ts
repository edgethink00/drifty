import { describe, expect, it } from "vitest";
import { shiftIsoDate } from "@drifty/domain";
import type { AchievementDayFacts } from "./achievementFacts";
import { evaluateAchievements, type AchievementId } from "./achievementCatalog";

const HOUR = 3600;

function day(dayIso: string, values: Partial<Omit<AchievementDayFacts, "day">> = {}): AchievementDayFacts {
  return { day: dayIso, trackedSeconds: HOUR, focusSeconds: 0, driftSeconds: 0, longestFocusRunSeconds: 0, earlyFocusSeconds: 0, lateFocusSeconds: 0, ...values };
}

function days(startDay: string, count: number, values: Partial<Omit<AchievementDayFacts, "day">> = {}): AchievementDayFacts[] {
  return Array.from({ length: count }, (_, index) => day(shiftIsoDate(startDay, index), values));
}

function earned(facts: readonly AchievementDayFacts[], id: AchievementId, archivedFocusSeconds = 0) {
  return evaluateAchievements(facts, { archivedFocusSeconds }).find((evaluation) => evaluation.id === id)!;
}

describe("achievement catalogue", () => {
  it("counts a streak once, on the day it first reaches its length, and restarts after a missed day", () => {
    const facts = [...days("2026-09-01", 14), ...days("2026-09-16", 7)];
    expect(earned(facts, "streak7").earnedDays).toEqual(["2026-09-07", "2026-09-22"]);
    // Progress is the streak still going, not the longest one before the missed day.
    expect(earned(facts, "streak30").progress).toEqual({ current: 7, target: 30, unit: "days" });
  });

  it("counts no streak as going once the last finished day was missed", () => {
    const facts = days("2026-09-01", 14);
    const going = (throughDay: string) => evaluateAchievements(facts, { throughDay }).find((evaluation) => evaluation.id === "streak30")!.progress;
    expect(going("2026-09-14")).toEqual({ current: 14, target: 30, unit: "days" });
    expect(going("2026-09-15")).toEqual({ current: 0, target: 30, unit: "days" });
  });

  it("does not count a day with too little recorded time toward a streak", () => {
    const facts = days("2026-09-01", 7).map((entry, index) => index === 3 ? { ...entry, trackedSeconds: 20 * 60 } : entry);
    expect(earned(facts, "streak7").earnedDays).toEqual([]);
  });

  it("needs both days of the same weekend for the weekend shift", () => {
    // 2026-09-12 is a Saturday.
    const facts = [
      day("2026-09-12", { focusSeconds: 2.5 * HOUR }),
      day("2026-09-13", { focusSeconds: 2 * HOUR }),
      day("2026-09-19", { focusSeconds: 3 * HOUR }),
      day("2026-09-20", { focusSeconds: 1 * HOUR }),
    ];
    const result = earned(facts, "weekendShift");
    expect(result.earnedDays).toEqual(["2026-09-13"]);
  });

  it("calls a full day with almost no focus and mostly drift a day adrift, and only that", () => {
    const facts = [
      day("2026-09-01", { trackedSeconds: 5 * HOUR, focusSeconds: 5 * 60, driftSeconds: 3 * HOUR }),
      day("2026-09-02", { trackedSeconds: 5 * HOUR, focusSeconds: 5 * 60, driftSeconds: 2 * HOUR }),
      day("2026-09-03", { trackedSeconds: 3 * HOUR, focusSeconds: 0, driftSeconds: 3 * HOUR }),
      day("2026-09-04", { trackedSeconds: 6 * HOUR, focusSeconds: 0.25 * HOUR, driftSeconds: 4 * HOUR }),
    ];
    const result = earned(facts, "driftDay");
    expect(result.earnedDays).toEqual(["2026-09-01"]);
    expect(result.progress).toBeNull();
  });

  it("finds a comeback only right after three low days in a row", () => {
    const low = { trackedSeconds: 3 * HOUR, focusSeconds: 0.5 * HOUR };
    const strong = { trackedSeconds: 6 * HOUR, focusSeconds: 4.5 * HOUR };
    const facts = [
      ...days("2026-09-01", 3, low), day("2026-09-04", strong),
      ...days("2026-09-10", 2, low), day("2026-09-13", low), day("2026-09-14", strong),
    ];
    expect(earned(facts, "comeback").earnedDays).toEqual(["2026-09-04"]);
  });

  it("adds folded focus to the 100-hour total", () => {
    const result = earned([day("2026-09-01", { focusSeconds: HOUR }), day("2026-09-02", { focusSeconds: 2 * HOUR })], "focus100h", 98.5 * HOUR);
    expect(result.earnedDays).toEqual(["2026-09-02"]);
  });

  it("reports the best focus stretch as progress, capped at the goal", () => {
    const facts = [day("2026-09-01", { longestFocusRunSeconds: 2 * HOUR }), day("2026-09-02", { longestFocusRunSeconds: 50 * 60 })];
    expect(earned(facts, "flow180").progress).toEqual({ current: 2 * HOUR, target: 3 * HOUR, unit: "seconds" });
    expect(earned(facts, "flow90").earnedDays).toEqual(["2026-09-01"]);
    expect(earned(facts, "flow90").progress).toEqual({ current: 90 * 60, target: 90 * 60, unit: "seconds" });
  });
});

