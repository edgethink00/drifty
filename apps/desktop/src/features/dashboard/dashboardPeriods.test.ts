import { describe, expect, it } from "vitest";
import { getInsightPeriodRange, shiftInsightPeriodDay } from "./dashboardPeriods";

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
