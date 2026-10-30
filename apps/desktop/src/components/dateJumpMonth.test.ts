import { describe, expect, it } from "vitest";

import { calendarMonthWeeks, lastReachableDay, movedFocusDay, pickedDay, shiftCalendarMonth } from "./dateJumpMonth";

describe("date jump calendar", () => {
  it("lays a month out in whole weeks from the reader's first weekday", () => {
    const monday = calendarMonthWeeks("2026-10-01", "monday");
    expect(monday[0]).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    expect(monday[monday.length - 1]).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
    expect(monday).toHaveLength(5);

    expect(calendarMonthWeeks("2026-10-01", "sunday")[0]![0]).toBe("2026-09-27");
    expect(calendarMonthWeeks("2026-10-01", "saturday")[0]![0]).toBe("2026-09-26");
    // A month that starts on the first weekday has no leading days from the month before.
    expect(calendarMonthWeeks("2026-06-01", "monday")[0]![0]).toBe("2026-06-01");
    for (const week of calendarMonthWeeks("2026-08-01", "sunday")) expect(week).toHaveLength(7);
  });

  it("moves months across years and keeps PageUp/PageDown inside short months", () => {
    expect(shiftCalendarMonth("2026-01-01", -1)).toBe("2025-12-01");
    expect(shiftCalendarMonth("2026-12-01", 1)).toBe("2027-01-01");
    expect(movedFocusDay("2026-03-31", "PageUp", "monday")).toBe("2026-02-28");
    expect(movedFocusDay("2026-01-31", "PageDown", "monday")).toBe("2026-02-28");
    expect(movedFocusDay("2026-10-01", "ArrowLeft", "monday")).toBe("2026-09-30");
    expect(movedFocusDay("2026-10-29", "Home", "sunday")).toBe("2026-10-25");
    expect(movedFocusDay("2026-10-29", "End", "monday")).toBe("2026-11-01");
    expect(movedFocusDay("2026-10-29", "Enter", "monday")).toBeNull();
  });

  it("stops at today, or at the end of this week when picking weeks", () => {
    expect(lastReachableDay("day", "2026-10-29", "monday")).toBe("2026-10-29");
    expect(lastReachableDay("week", "2026-10-29", "monday")).toBe("2026-11-01");
    expect(lastReachableDay("week", "2026-10-29", "sunday")).toBe("2026-10-31");
    expect(pickedDay("2026-10-31", "2026-10-29")).toBe("2026-10-29");
    expect(pickedDay("2026-10-12", "2026-10-29")).toBe("2026-10-12");
  });
});
