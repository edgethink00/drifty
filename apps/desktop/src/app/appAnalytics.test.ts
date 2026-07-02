import { describe, expect, it } from "vitest";
import { toAppSurfaceAnalytics, toDashboardPeriodAnalytics, toTrackerModeAnalytics } from "./appAnalytics";

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
    expect(toTrackerModeAnalytics("future-mode")).toBe("unknown");
    expect(toTrackerModeAnalytics(null)).toBe("unknown");
  });
});
