import { describe, expect, it } from "vitest";
import type { ActivityCategory, ActivitySegment, ProductivityLabel } from "@drifty/domain";
import {
  WeekDashboardDayModelCache,
  buildWeekDashboardDayModel,
  buildWeekDashboardModel,
  prewarmClosedWeekDashboardDays,
} from "./weekDashboardModel";

function makeSegment(
  id: string,
  startedAt: string,
  endedAt: string,
  appName: string,
  category: ActivityCategory,
  productivity: ProductivityLabel,
): ActivitySegment {
  const durationSeconds = Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000);

  return {
    id,
    startedAt,
    endedAt,
    durationSeconds,
    appName,
    bundleId: `com.example.${appName.toLowerCase().replace(/\s+/g, "-")}`,
    windowTitle: appName,
    platform: "macos",
    source: "manual",
    classification: {
      category,
      productivity,
      source: "manual",
      confidence: 1,
    },
  };
}

describe("buildWeekDashboardModel", () => {
  it("uses cached closed days and computes the current logical day live", () => {
    const cache = new WeekDashboardDayModelCache();
    cache.set(buildWeekDashboardDayModel({
      day: "2026-06-15",
      segments: [
        makeSegment("cached-monday", "2026-06-15T09:00:00", "2026-06-15T09:30:00", "Cached App", "workspace", "focus"),
      ],
      classificationOptions: { includeAiClassifications: true },
      startOfDayMinutes: 0,
    }));

    const model = buildWeekDashboardModel({
      cache,
      classificationOptions: { includeAiClassifications: true },
      endDay: "2026-06-18",
      segments: [
        makeSegment("raw-monday", "2026-06-15T09:00:00", "2026-06-15T10:00:00", "Raw App", "entertainment", "drift"),
        makeSegment("today", "2026-06-18T11:00:00", "2026-06-18T11:30:00", "Today App", "learning", "focus"),
      ],
      startDay: "2026-06-15",
      startOfDayMinutes: 0,
      todayDay: "2026-06-18",
    });

    expect(model.cacheStats.closedDayHits).toBe(1);
    expect(model.cacheStats.liveDaysComputed).toBe(1);
    expect(model.calendarEvents.get("2026-06-15")?.[0]?.appName).toBe("Cached App");
    expect(model.calendarEvents.get("2026-06-18")?.[0]?.appName).toBe("Today App");
    expect(model.rows.map((row) => row.day)).toEqual(["2026-06-15", "2026-06-16", "2026-06-17", "2026-06-18"]);
  });

  it("prewarms only closed logical days before today", () => {
    const cache = new WeekDashboardDayModelCache();
    const warmedDays = prewarmClosedWeekDashboardDays({
      cache,
      classificationOptions: { includeAiClassifications: true },
      endDay: "2026-06-18",
      segments: [
        makeSegment("past", "2026-06-17T15:00:00", "2026-06-17T15:45:00", "Past App", "utility", "neutral"),
        makeSegment("today", "2026-06-18T10:00:00", "2026-06-18T10:45:00", "Today App", "workspace", "focus"),
      ],
      startDay: "2026-06-16",
      startOfDayMinutes: 0,
      todayDay: "2026-06-18",
    });

    expect(warmedDays).toBe(2);
    expect(cache.get("2026-06-16")).not.toBeNull();
    expect(cache.get("2026-06-17")?.calendarEvents[0]?.appName).toBe("Past App");
    expect(cache.get("2026-06-18")).toBeNull();
  });
});
