import { describe, expect, it } from "vitest";
import { formatDashboardPeriodLabel, getInsightPeriodRange, resolveDashboardPeriodAnchorDay, shiftInsightPeriodDay } from "./dashboardPeriods";

describe("dashboard period anchor", () => {
  it("clamps a future week anchor when opening Day", () => {
    expect(resolveDashboardPeriodAnchorDay("2026-06-14", "2026-06-12", "Today")).toBe("2026-06-12");
  });

  it("preserves historical days and future week anchors", () => {
    expect(resolveDashboardPeriodAnchorDay("2026-06-10", "2026-06-12", "Today")).toBe("2026-06-10");
    expect(resolveDashboardPeriodAnchorDay("2026-06-14", "2026-06-12", "Week")).toBe("2026-06-14");
  });
});

describe("insight period ranges", () => {
  it("builds rolling Week, Month, and 90-day ranges ending on the selected day", () => {
    expect(getInsightPeriodRange("2026-06-12", "Week")).toMatchObject({
      startDay: "2026-06-06",
      endDay: "2026-06-12",
    });
    expect(getInsightPeriodRange("2026-06-12", "Month")).toMatchObject({
      startDay: "2026-05-14",
      endDay: "2026-06-12",
    });
    expect(getInsightPeriodRange("2026-06-12", "90Day")).toMatchObject({
      startDay: "2026-03-15",
      endDay: "2026-06-12",
    });
  });

  it("moves insight windows by their rolling day count", () => {
    expect(shiftInsightPeriodDay("2026-06-12", "Week", -1)).toBe("2026-06-05");
    expect(shiftInsightPeriodDay("2026-06-12", "Month", -1)).toBe("2026-05-13");
    expect(shiftInsightPeriodDay("2026-06-12", "90Day", -1)).toBe("2026-03-14");
    expect(shiftInsightPeriodDay("2026-06-12", "Month", 1)).toBe("2026-07-12");
  });
});

describe("formatDashboardPeriodLabel", () => {
  it("keeps a single day as a weekday date", () => {
    expect(formatDashboardPeriodLabel("Today", "2026-08-24", "2026-08-24")).toBe("Mon, Aug 24");
  });

  it("uses the compact range grammar for week and month windows", () => {
    expect(formatDashboardPeriodLabel("Week", "2026-08-24", "2026-08-30")).toBe("Week · Aug 24–30");
    expect(formatDashboardPeriodLabel("Month", "2026-08-01", "2026-08-30")).toBe("Month · Aug 1–30");
    expect(formatDashboardPeriodLabel("Week", "2026-12-28", "2027-01-03")).toBe("Week · Dec 28, 2026 – Jan 3, 2027");
  });
});
