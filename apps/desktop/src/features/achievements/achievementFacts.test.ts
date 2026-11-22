import { describe, expect, it } from "vitest";
import type { ActivitySegment } from "@drifty/domain";
import { buildAchievementDayFacts } from "./achievementFacts";

function segment(startedAt: string, endedAt: string, productivity: "focus" | "neutral" | "drift" = "focus", extra: Partial<ActivitySegment> = {}): ActivitySegment {
  return {
    id: startedAt + "-" + productivity,
    startedAt,
    endedAt,
    durationSeconds: (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000,
    appName: "Fixture Editor",
    windowTitle: "",
    platform: "macos",
    source: "nsworkspace",
    classification: { category: "workspace", productivity, source: "manual", confidence: 1, reason: "fixture" },
    ...extra,
  };
}

describe("achievement day facts", () => {
  it("keeps a focus stretch across a short gap and breaks it on other activity or a long gap", () => {
    const [day] = buildAchievementDayFacts([
      segment("2026-09-08T09:00:00", "2026-09-08T09:50:00"),
      segment("2026-09-08T09:53:00", "2026-09-08T10:30:00"),
      segment("2026-09-08T10:30:00", "2026-09-08T10:40:00", "drift"),
      segment("2026-09-08T10:40:00", "2026-09-08T11:00:00"),
      segment("2026-09-08T11:07:00", "2026-09-08T12:30:00"),
    ], { startDay: "2026-09-08", endDay: "2026-09-08" });
    expect(day.longestFocusRunSeconds).toBe(87 * 60);
    expect(day.focusSeconds).toBe((50 + 37 + 20 + 83) * 60);
    expect(day.driftSeconds).toBe(10 * 60);
    expect(day.trackedSeconds).toBe((50 + 37 + 10 + 20 + 83) * 60);
  });

  it("splits at the user's day boundary and reads early and late focus by the clock", () => {
    const days = buildAchievementDayFacts([
      segment("2026-09-08T03:00:00", "2026-09-08T05:00:00"),
      segment("2026-09-08T06:30:00", "2026-09-08T07:30:00"),
    ], { startDay: "2026-09-07", endDay: "2026-09-08", startOfDayMinutes: 240 });
    expect(days.map((day) => [day.day, day.lateFocusSeconds, day.earlyFocusSeconds])).toEqual([
      ["2026-09-07", 3600, 0],
      ["2026-09-08", 3600, 30 * 60],
    ]);
  });

  it("leaves out excluded apps, failed captures and estimated browser-history imports", () => {
    const days = buildAchievementDayFacts([
      segment("2026-09-08T09:00:00", "2026-09-08T10:00:00", "focus", { source: "browser-history-import" }),
      segment("2026-09-08T10:00:00", "2026-09-08T11:00:00", "focus", { exclusionSource: "user" }),
    ], { startDay: "2026-09-08", endDay: "2026-09-08" });
    expect(days).toEqual([]);
  });

  it("returns only days inside the range that have recorded time", () => {
    const days = buildAchievementDayFacts([
      segment("2026-09-06T09:00:00", "2026-09-06T10:00:00"),
      segment("2026-09-08T09:00:00", "2026-09-08T09:30:00", "neutral"),
    ], { startDay: "2026-09-07", endDay: "2026-09-08" });
    expect(days).toEqual([{ day: "2026-09-08", trackedSeconds: 1800, focusSeconds: 0, driftSeconds: 0, longestFocusRunSeconds: 0, earlyFocusSeconds: 0, lateFocusSeconds: 0 }]);
  });
});

