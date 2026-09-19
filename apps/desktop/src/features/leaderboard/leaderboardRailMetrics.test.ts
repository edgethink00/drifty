import { describe, expect, it } from "vitest";
import { trailingFocusStreakDays, weekOverWeekDeltaPercent } from "./leaderboardRailMetrics";

function day(offset: number, focus: number) {
  return { day: `2026-09-${String(offset).padStart(2, "0")}`, focus, drift: 0, neutral: 0 };
}

describe("weekOverWeekDeltaPercent", () => {
  it("compares the latest 7 days with the previous 7", () => {
    const points = [
      ...Array.from({ length: 7 }, (_, index) => day(index + 1, 3600)),
      ...Array.from({ length: 7 }, (_, index) => day(index + 8, 5400)),
    ];
    expect(weekOverWeekDeltaPercent(points)).toBe(50);
  });

  it("returns null without two full weeks", () => {
    expect(weekOverWeekDeltaPercent([day(1, 3600), day(2, 1800)])).toBeNull();
  });
});

describe("trailingFocusStreakDays", () => {
  it("skips a trailing empty day and counts consecutive focus days", () => {
    const points = [day(1, 0), day(2, 1200), day(3, 2400), day(4, 0)];
    expect(trailingFocusStreakDays(points)).toBe(2);
  });

  it("returns 0 when the window has no focus", () => {
    expect(trailingFocusStreakDays([day(1, 0), day(2, 0)])).toBe(0);
  });
});
