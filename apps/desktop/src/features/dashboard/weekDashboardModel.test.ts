import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityCategory, ActivitySegment, ProductivityLabel } from "@drifty/domain";

const classificationCallCounter = vi.hoisted(() => ({ count: 0 }));

vi.mock("@drifty/domain", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@drifty/domain")>();
  return {
    ...actual,
    classifyActivityDetailed: (...args: Parameters<typeof actual.classifyActivityDetailed>): ReturnType<typeof actual.classifyActivityDetailed> => {
      classificationCallCounter.count += 1;
      return actual.classifyActivityDetailed(...args);
    },
  };
});

import {
  WeekDashboardDayModelCache,
  buildWeekDashboardDayModel,
  buildWeekDashboardModel,
  syncWeekDashboardDayModelCacheSettings,
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
  beforeEach(() => {
    classificationCallCounter.count = 0;
  });

  it("classifies each segment once when building rows and calendar events", () => {
    const segments = [
      makeSegment("design", "2026-06-18T09:00:00", "2026-06-18T09:45:00", "Design App", "workspace", "focus"),
      makeSegment("research", "2026-06-18T10:00:00", "2026-06-18T10:30:00", "Research App", "learning", "focus"),
      makeSegment("video", "2026-06-18T11:00:00", "2026-06-18T11:15:00", "Video App", "entertainment", "drift"),
    ];

    const model = buildWeekDashboardDayModel({
      day: "2026-06-18",
      segments,
      classificationOptions: { includeAiClassifications: true },
      startOfDayMinutes: 0,
    });

    expect(classificationCallCounter.count).toBe(segments.length);
    expect(model.row.totalSeconds).toBe(90 * 60);
    expect(model.row.focusSeconds).toBe(75 * 60);
    expect(model.row.slices.map((slice) => slice.category)).toEqual(["workspace", "learning", "entertainment"]);
    expect(model.calendarEvents.map((event) => event.appName)).toEqual(["Design App", "Research App", "Video App"]);
    expect(model.calendarEvents.map((event) => event.segmentIds)).toEqual([["design"], ["research"], ["video"]]);
  });

  it("retains every exact source record when overlapping segments become one calendar block", () => {
    const segments = [
      makeSegment("design-doc", "2026-06-18T09:00:00", "2026-06-18T09:45:00", "Design App", "workspace", "focus"),
      makeSegment("design-call", "2026-06-18T09:10:00", "2026-06-18T09:30:00", "Meeting App", "communication", "focus"),
    ];

    const model = buildWeekDashboardDayModel({
      day: "2026-06-18",
      segments,
      classificationOptions: { includeAiClassifications: true },
      startOfDayMinutes: 0,
    });

    expect(model.calendarEvents).toHaveLength(1);
    expect(model.calendarEvents[0].sessionCount).toBe(2);
    expect(model.calendarEvents[0].segmentIds).toEqual(["design-doc", "design-call"]);
    expect(model.calendarEvents[0].hasMixedCategory).toBe(true);
    expect(model.calendarEvents[0].hasMixedProductivity).toBe(false);
  });

  it("uses cached closed days and computes the current logical day live", () => {
    const cache = new WeekDashboardDayModelCache();
    const cachedSegment = makeSegment("cached-monday", "2026-06-15T09:00:00", "2026-06-15T09:30:00", "Cached App", "workspace", "focus");
    prewarmClosedWeekDashboardDays({
      cache,
      classificationOptions: { includeAiClassifications: true },
      endDay: "2026-06-15",
      segments: [
        cachedSegment,
      ],
      startDay: "2026-06-15",
      startOfDayMinutes: 0,
      todayDay: "2026-06-18",
    });

    const model = buildWeekDashboardModel({
      cache,
      classificationOptions: { includeAiClassifications: true },
      endDay: "2026-06-18",
      segments: [
        cachedSegment,
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

  it("keeps closed-day cache through live-only updates and invalidates changed closed-day data", () => {
    const cache = new WeekDashboardDayModelCache();
    const initialSettings = { includeAiClassifications: true, startOfDayMinutes: 0 };
    const nextSettings = syncWeekDashboardDayModelCacheSettings(cache, null, initialSettings);
    const closedSegment = makeSegment("closed", "2026-06-17T09:00:00", "2026-06-17T09:30:00", "Closed App", "workspace", "focus");
    const warmedDays = prewarmClosedWeekDashboardDays({
      cache,
      classificationOptions: { includeAiClassifications: true },
      endDay: "2026-06-18",
      segments: [
        closedSegment,
      ],
      startDay: "2026-06-17",
      startOfDayMinutes: 0,
      todayDay: "2026-06-18",
    });

    const preservedSettings = syncWeekDashboardDayModelCacheSettings(cache, nextSettings, initialSettings);
    const liveUpdateModel = buildWeekDashboardModel({
      cache,
      classificationOptions: { includeAiClassifications: true },
      endDay: "2026-06-18",
      segments: [
        closedSegment,
        makeSegment("live-update", "2026-06-18T11:00:00", "2026-06-18T11:20:00", "Live App", "learning", "focus"),
      ],
      startDay: "2026-06-17",
      startOfDayMinutes: 0,
      todayDay: "2026-06-18",
    });

    expect(warmedDays).toBe(1);
    expect(preservedSettings).toEqual(initialSettings);
    expect(liveUpdateModel.cacheStats.closedDayHits).toBe(1);
    expect(liveUpdateModel.cacheStats.liveDaysComputed).toBe(1);
    expect(liveUpdateModel.calendarEvents.get("2026-06-17")?.[0]?.appName).toBe("Closed App");
    expect(liveUpdateModel.calendarEvents.get("2026-06-18")?.[0]?.appName).toBe("Live App");

    const closedDataChangedModel = buildWeekDashboardModel({
      cache,
      classificationOptions: { includeAiClassifications: true },
      endDay: "2026-06-18",
      segments: [
        makeSegment("closed-replacement", "2026-06-17T09:00:00", "2026-06-17T10:00:00", "Replacement App", "entertainment", "drift"),
        makeSegment("live-update", "2026-06-18T11:00:00", "2026-06-18T11:20:00", "Live App", "learning", "focus"),
      ],
      startDay: "2026-06-17",
      startOfDayMinutes: 0,
      todayDay: "2026-06-18",
    });

    expect(closedDataChangedModel.cacheStats.closedDayHits).toBe(0);
    expect(closedDataChangedModel.cacheStats.closedDaysComputed).toBe(1);
    expect(closedDataChangedModel.calendarEvents.get("2026-06-17")?.[0]?.appName).toBe("Replacement App");

    syncWeekDashboardDayModelCacheSettings(cache, preservedSettings, { includeAiClassifications: false, startOfDayMinutes: 0 });
    expect(cache.size).toBe(0);

    prewarmClosedWeekDashboardDays({
      cache,
      classificationOptions: { includeAiClassifications: false },
      endDay: "2026-06-17",
      segments: [
        makeSegment("closed-start", "2026-06-17T09:00:00", "2026-06-17T09:30:00", "Closed Start App", "workspace", "focus"),
      ],
      startDay: "2026-06-17",
      startOfDayMinutes: 0,
      todayDay: "2026-06-18",
    });
    const aiDisabledSettings = { includeAiClassifications: false, startOfDayMinutes: 0 };
    syncWeekDashboardDayModelCacheSettings(cache, aiDisabledSettings, { includeAiClassifications: false, startOfDayMinutes: 120 });
    expect(cache.size).toBe(0);
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
