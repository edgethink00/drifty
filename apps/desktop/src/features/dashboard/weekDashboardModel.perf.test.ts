import { describe, expect, it, vi } from "vitest";
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
  buildWeekDashboardModel,
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

function daySegment(day: string, index: number): ActivitySegment {
  const startHour = 9 + index;
  const startedAt = `${day}T${String(startHour).padStart(2, "0")}:00:00`;
  const endedAt = `${day}T${String(startHour).padStart(2, "0")}:30:00`;
  return makeSegment(`${day}-${index}`, startedAt, endedAt, `App ${day} ${index}`, "workspace", "focus");
}

describe("week dashboard performance counters", () => {
  it("prints classification and closed-day cache counters for week transition", () => {
    const closedDays = ["2026-06-15", "2026-06-16", "2026-06-17"] as const;
    const coldSegments = [
      ...closedDays.flatMap((day) => [daySegment(day, 0), daySegment(day, 1)]),
      daySegment("2026-06-18", 0),
    ];
    const cache = new WeekDashboardDayModelCache();

    classificationCallCounter.count = 0;
    const coldModel = buildWeekDashboardModel({
      cache,
      classificationOptions: { includeAiClassifications: true },
      endDay: "2026-06-18",
      segments: coldSegments,
      startDay: "2026-06-15",
      startOfDayMinutes: 0,
      todayDay: "2026-06-18",
    });
    const coldClassificationCalls = classificationCallCounter.count;

    classificationCallCounter.count = 0;
    const warmModel = buildWeekDashboardModel({
      cache,
      classificationOptions: { includeAiClassifications: true },
      endDay: "2026-06-18",
      segments: [
        ...coldSegments,
        daySegment("2026-06-18", 1),
      ],
      startDay: "2026-06-15",
      startOfDayMinutes: 0,
      todayDay: "2026-06-18",
    });
    const warmClassificationCalls = classificationCallCounter.count;
    const counters = {
      segmentCount: coldSegments.length,
      expectedDuplicateClassificationCallsBeforeTask2: coldSegments.length * 2,
      coldClassificationCallsAfterTask2: coldClassificationCalls,
      warmClassificationCallsAfterClosedDayCacheHit: warmClassificationCalls,
      coldCacheStats: coldModel.cacheStats,
      warmCacheStats: warmModel.cacheStats,
    };

    console.info(`PERF_COUNTERS ${JSON.stringify(counters)}`);
    expect(coldClassificationCalls).toBe(coldSegments.length);
    expect(warmModel.cacheStats.closedDayHits).toBe(closedDays.length);
    expect(warmModel.cacheStats.liveDaysComputed).toBe(1);
    expect(warmClassificationCalls).toBe(2);
  });
});
