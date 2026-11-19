import { afterEach, describe, expect, it, vi } from "vitest";
import { buildActivityRefreshPlan } from "./activityRefreshPlan";

describe("buildActivityRefreshPlan", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("clips the current dashboard week history range to the current logical day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 21, 13, 0, 0, 0));

    const plan = buildActivityRefreshPlan({
      activeTab: "dashboard",
      dashPeriod: "Week",
      day: "2026-05-21",
      shouldLoadHistory: true,
      startOfDayMinutes: 240,
      startOfWeek: "monday",
      trendsRange: "Week",
    });

    expect(plan.shouldLoadDashboardWeekHistory).toBe(true);
    expect(plan.shouldLoadHistorySummaries).toBe(false);
    expect(plan.historyTimelineRange).toEqual({
      start: "2026-05-18T04:00:00",
      end: "2026-05-22T03:59:59",
    });
  });

  it("keeps past dashboard week history ranges as full calendar weeks", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 21, 13, 0, 0, 0));

    const plan = buildActivityRefreshPlan({
      activeTab: "dashboard",
      dashPeriod: "Week",
      day: "2026-05-12",
      shouldLoadHistory: true,
      startOfDayMinutes: 240,
      startOfWeek: "monday",
      trendsRange: "Week",
    });

    expect(plan.shouldLoadDashboardWeekHistory).toBe(true);
    expect(plan.shouldLoadHistorySummaries).toBe(false);
    expect(plan.historyTimelineRange).toEqual({
      start: "2026-05-11T04:00:00",
      end: "2026-05-18T03:59:59",
    });
  });

  it("reads only the selected week for Classification's Week, not the 90-day archive", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 21, 13, 0, 0, 0));

    const plan = buildActivityRefreshPlan({
      activeTab: "classification",
      dashPeriod: "Today",
      day: "2026-05-21",
      shouldLoadHistory: true,
      startOfDayMinutes: 240,
      startOfWeek: "monday",
      trendsRange: "Week",
    });

    expect(plan.historyTimelineRange).toEqual({
      start: "2026-05-18T04:00:00",
      end: "2026-05-25T03:59:59",
    });
  });

  it("uses the rolling insight window for Trends week history", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 21, 13, 0, 0, 0));

    const plan = buildActivityRefreshPlan({
      activeTab: "trends",
      dashPeriod: "Today",
      day: "2026-05-21",
      shouldLoadHistory: true,
      startOfDayMinutes: 240,
      startOfWeek: "monday",
      trendsRange: "Week",
    });

    expect(plan.shouldLoadDashboardWeekHistory).toBe(false);
    expect(plan.shouldLoadHistorySummaries).toBe(true);
    expect(plan.historyTimelineRange).toEqual({
      start: "2026-05-15T04:00:00",
      end: "2026-05-22T03:59:59",
    });
  });
});
