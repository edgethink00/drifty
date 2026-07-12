import { describe, expect, it } from "vitest";
import {
  toAppSurfaceAnalytics,
  toDashboardPeriodAnalytics,
  toScheduledProjectPassAnalytics,
  toTrackerModeAnalytics,
} from "./appAnalytics";

describe("app analytics mapping", () => {
  it("maps dashboard periods exhaustively to bounded analytics values", () => {
    expect(toDashboardPeriodAnalytics("Today")).toBe("day");
    expect(toDashboardPeriodAnalytics("Week")).toBe("week");
    expect(toDashboardPeriodAnalytics("Month")).toBe("month");
  });

  it("maps supported app surfaces without falling through to raw labels", () => {
    expect(toAppSurfaceAnalytics("dashboard")).toBe("dashboard");
    expect(toAppSurfaceAnalytics("classification")).toBe("classification");
    expect(toAppSurfaceAnalytics("history")).toBe("history");
    expect(toAppSurfaceAnalytics("trends")).toBe("trends");
    expect(toAppSurfaceAnalytics("leaderboard")).toBe("leaderboard");
    expect(toAppSurfaceAnalytics("team")).toBe("team");
    expect(toAppSurfaceAnalytics("settings")).toBe("settings");
  });

  it("maps unknown tracker modes to a bounded fallback", () => {
    expect(toTrackerModeAnalytics("tracking")).toBe("tracking");
    expect(toTrackerModeAnalytics("degraded")).toBe("degraded");
    expect(toTrackerModeAnalytics("future-mode")).toBe("unknown");
    expect(toTrackerModeAnalytics(null)).toBe("unknown");
  });

  it("maps scheduled project pass outcomes to bounded privacy-safe telemetry", () => {
    expect(toScheduledProjectPassAnalytics("schedule", {
      status: "completed",
      summary: {
        ran: true,
        chunks: 2,
        assignments: 7,
        corrections: 1,
        tokensIn: 100,
        tokensOut: 20,
      },
    })).toEqual({
      trigger: "schedule",
      result: "success",
      assignment_count_bucket: "6_20",
      correction_count_bucket: "1",
    });
    expect(toScheduledProjectPassAnalytics("open", {
      status: "skipped",
      reason: "no_work",
    })).toEqual({
      trigger: "open",
      result: "skipped",
      skip_reason: "no_work",
      assignment_count_bucket: "none",
      correction_count_bucket: "none",
    });
    expect(toScheduledProjectPassAnalytics("eod", {
      status: "failed",
      category: "provider_error",
    })).toEqual({
      trigger: "eod",
      result: "error",
      assignment_count_bucket: "none",
      correction_count_bucket: "none",
      error_kind: "provider_error",
    });
  });
});
