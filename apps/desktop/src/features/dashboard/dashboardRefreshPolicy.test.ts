import { describe, expect, it } from "vitest";
import {
  resolveDashboardRefreshMode,
  shouldRefreshHistoryData,
  type DashboardRefreshInputs,
} from "./dashboardRefreshPolicy";

const loadedMondayInput: DashboardRefreshInputs = {
  selectedDay: "2026-05-20",
  startOfDayMinutes: 240,
  startOfWeek: "monday",
};

describe("shouldRefreshHistoryData", () => {
  it("requires history only for dashboard history views and history-backed tabs", () => {
    expect(shouldRefreshHistoryData("dashboard", "Today", "Day")).toBe(false);
    expect(shouldRefreshHistoryData("dashboard", "Week", "Day")).toBe(true);
    expect(shouldRefreshHistoryData("classification", "Today", "Day")).toBe(false);
    expect(shouldRefreshHistoryData("classification", "Today", "Week")).toBe(true);
    expect(shouldRefreshHistoryData("trends", "Today", "Day")).toBe(true);
    expect(shouldRefreshHistoryData("history", "Today", "Day")).toBe(true);
    expect(shouldRefreshHistoryData("leaderboard", "Today", "Day")).toBe(false);
  });
});

describe("resolveDashboardRefreshMode", () => {
  it("uses foreground refresh before the first tracker load", () => {
    expect(resolveDashboardRefreshMode({
      hasLoadedOnce: false,
      nextInputs: loadedMondayInput,
      previousInputs: null,
    })).toBe("foreground");
  });

  it("skips duplicate refresh inputs after the first load", () => {
    expect(resolveDashboardRefreshMode({
      hasLoadedOnce: true,
      nextInputs: loadedMondayInput,
      previousInputs: loadedMondayInput,
    })).toBe("skip");
  });

  it("uses background refresh for date-only navigation after the first load", () => {
    expect(resolveDashboardRefreshMode({
      hasLoadedOnce: true,
      nextInputs: { ...loadedMondayInput, selectedDay: "2026-05-19" },
      previousInputs: loadedMondayInput,
    })).toBe("background");
  });

  it("keeps foreground refresh when logical day boundaries change", () => {
    expect(resolveDashboardRefreshMode({
      hasLoadedOnce: true,
      nextInputs: { ...loadedMondayInput, startOfDayMinutes: 300 },
      previousInputs: loadedMondayInput,
    })).toBe("foreground");

    expect(resolveDashboardRefreshMode({
      hasLoadedOnce: true,
      nextInputs: { ...loadedMondayInput, startOfWeek: "sunday" },
      previousInputs: loadedMondayInput,
    })).toBe("foreground");
  });
});
