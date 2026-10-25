import { describe, expect, it } from "vitest";

import {
  teamExportDayCount,
  teamExportDayText,
  teamExportMonthWeeks,
  teamExportPresetWindow,
  teamExportRangeClass,
  teamExportShiftMonth,
} from "./teamExportRange";

describe("teamExportRange", () => {
  // Wednesday 22 October 2026.
  const today = "2026-10-22";

  it("ends every preset by today and starts weeks on Monday", () => {
    expect(teamExportPresetWindow("thisWeek", today)).toEqual({ start_date: "2026-10-19", end_date: "2026-10-22" });
    expect(teamExportPresetWindow("lastWeek", today)).toEqual({ start_date: "2026-10-12", end_date: "2026-10-18" });
    expect(teamExportPresetWindow("thisMonth", today)).toEqual({ start_date: "2026-10-01", end_date: "2026-10-22" });
    expect(teamExportPresetWindow("lastMonth", today)).toEqual({ start_date: "2026-09-01", end_date: "2026-09-30" });
    expect(teamExportPresetWindow("lastMonth", "2026-03-05")).toEqual({ start_date: "2026-02-01", end_date: "2026-02-28" });
    expect(teamExportDayCount(teamExportPresetWindow("last90", today))).toBe(90);
  });

  it("lays a month out from Monday", () => {
    const weeks = teamExportMonthWeeks("2026-10-01");
    // 1 October 2026 is a Thursday.
    expect(weeks[0]).toEqual([null, null, null, "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    expect(weeks[weeks.length - 1]).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", null]);
    expect(teamExportShiftMonth("2026-01-01", -1)).toBe("2025-12-01");
    expect(teamExportShiftMonth("2026-12-01", 1)).toBe("2027-01-01");
  });

  it("writes a day short with its weekday, adding the year only when it is not today's", () => {
    expect(teamExportDayText("2026-10-19", "ko-KR", today, "short")).toBe("10월 19일 (월)");
    expect(teamExportDayText("2025-12-30", "ko-KR", today, "short")).toBe("2025년 12월 30일 (화)");
    expect(teamExportDayText("2026-10-19", "ko-KR", today, "long")).toBe("2026년 10월 19일");
  });

  it("marks the days a range covers and its two ends", () => {
    const range = { start_date: "2026-10-19", end_date: "2026-10-22" };
    expect(teamExportRangeClass("2026-10-18", range)).toBe("");
    expect(teamExportRangeClass("2026-10-19", range)).toBe(" is-in-range is-range-start");
    expect(teamExportRangeClass("2026-10-20", range)).toBe(" is-in-range");
    expect(teamExportRangeClass("2026-10-22", range)).toBe(" is-in-range is-range-end");
  });
});
