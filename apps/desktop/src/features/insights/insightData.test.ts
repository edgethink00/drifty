import type { ActivityCategory, ActivitySegment, ProductivityLabel } from "@drifty/domain";
import { describe, expect, it } from "vitest";
import { buildAttentionRhythm, buildWeeklyBreakdown, buildWeeklyChartView, NO_PROJECT_KEY } from "./insightData";

function segmentOnDay(
  id: string,
  day: string,
  category: ActivityCategory,
  productivity: ProductivityLabel,
): ActivitySegment {
  return segmentBetween(id, `${day}T10:00:00.000`, `${day}T11:00:00.000`, category, productivity);
}

function segmentBetween(
  id: string,
  startedAt: string,
  endedAt: string,
  category: ActivityCategory,
  productivity: ProductivityLabel,
): ActivitySegment {
  return {
    id,
    startedAt,
    endedAt,
    durationSeconds: Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000),
    appName: "Code",
    bundleId: "com.example.code",
    windowTitle: "Insight test",
    platform: "macos",
    source: "nsworkspace",
    classification: {
      category,
      productivity,
      source: "manual",
      confidence: 1,
      reason: "test",
    },
  };
}

describe("insight weekly builders", () => {
  it("marks weekdays after the insight window end weekday inactive when historical weekend data exists", () => {
    const segments = [
      segmentOnDay("friday-focus", "2026-06-12", "workspace", "focus"),
      segmentOnDay("saturday-focus", "2026-06-06", "workspace", "focus"),
      segmentOnDay("sunday-drift", "2026-06-07", "entertainment", "drift"),
    ];

    const weekly = buildWeeklyBreakdown(segments, undefined, { visibleThroughDay: "2026-06-12" });

    expect(weekly.map((day) => day.weekday)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(weekly[4]).toMatchObject({ weekday: "Fri", isActive: true, focusSeconds: 3600 });
    expect(weekly[5]).toMatchObject({ weekday: "Sat", isActive: false, focusSeconds: 0, driftSeconds: 0 });
    expect(weekly[6]).toMatchObject({ weekday: "Sun", isActive: false, focusSeconds: 0, driftSeconds: 0 });
  });

  it("orders weekly builders from the rolling insight start day", () => {
    const segments = [
      segmentOnDay("saturday-focus", "2026-06-06", "workspace", "focus"),
      segmentOnDay("friday-drift", "2026-06-12", "entertainment", "drift"),
    ];

    const weekly = buildWeeklyBreakdown(segments, undefined, { startDay: "2026-06-06" });
    const cells = buildAttentionRhythm(segments, undefined, { startDay: "2026-06-06" });

    expect(weekly.map((day) => day.weekday)).toEqual(["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"]);
    expect(weekly[0]).toMatchObject({ weekday: "Sat", weekdayIndex: 5, isActive: true, focusSeconds: 3600 });
    expect(weekly[6]).toMatchObject({ weekday: "Fri", weekdayIndex: 4, isActive: true, driftSeconds: 3600 });
    expect(cells.filter((cell) => cell.hour === 0).map((cell) => cell.weekdayIndex)).toEqual([5, 6, 0, 1, 2, 3, 4]);
  });

  it("keeps historical weekend attention rhythm cells in a partial current-week insight window", () => {
    const segments = [
      segmentOnDay("friday-focus", "2026-06-12", "workspace", "focus"),
      segmentOnDay("saturday-focus", "2026-06-06", "workspace", "focus"),
      segmentOnDay("sunday-drift", "2026-06-07", "entertainment", "drift"),
    ];

    const cells = buildAttentionRhythm(segments, undefined, { visibleThroughDay: "2026-06-12" });
    expect(cells.find((cell) => cell.weekdayIndex === 4 && cell.hour === 10)).toMatchObject({ state: "focus", intensity: 3 });
    expect(cells.find((cell) => cell.weekdayIndex === 5 && cell.hour === 10)).toMatchObject({ state: "focus", intensity: 3 });
    expect(cells.find((cell) => cell.weekdayIndex === 6 && cell.hour === 10)).toMatchObject({ state: "drift", intensity: 3 });
  });

  it("spreads long attention rhythm segments across every overlapped hour", () => {
    const segments = [
      segmentBetween("long-focus", "2026-06-10T09:05:00.000", "2026-06-10T12:05:00.000", "workspace", "focus"),
    ];

    const cells = buildAttentionRhythm(segments, undefined, { visibleThroughDay: "2026-06-12" });
    const activeWednesdayHours = cells
      .filter((cell) => cell.weekdayIndex === 2 && cell.intensity > 0)
      .map((cell) => cell.hour);

    expect(activeWednesdayHours).toEqual([9, 10, 11, 12]);
    expect(cells.find((cell) => cell.weekdayIndex === 2 && cell.hour === 9)).toMatchObject({ state: "focus", intensity: 3 });
    expect(cells.find((cell) => cell.weekdayIndex === 2 && cell.hour === 12)).toMatchObject({ state: "focus", intensity: 1 });
  });

  it("colors longer attention rhythm windows from weekday-hour averages", () => {
    const segments = [
      segmentOnDay("monday-1", "2026-06-01", "workspace", "focus"),
      segmentOnDay("monday-2", "2026-06-08", "workspace", "focus"),
      segmentOnDay("monday-3", "2026-06-15", "workspace", "focus"),
      segmentOnDay("monday-4", "2026-06-22", "workspace", "focus"),
      segmentOnDay("monday-5", "2026-06-29", "workspace", "focus"),
      segmentOnDay("tuesday-1", "2026-06-02", "workspace", "focus"),
      segmentOnDay("wednesday-1", "2026-06-03", "workspace", "focus"),
      segmentOnDay("wednesday-2", "2026-06-10", "workspace", "focus"),
      segmentOnDay("wednesday-3", "2026-06-17", "workspace", "focus"),
    ];
    const visibility = {
      averagingRange: { startDay: "2026-06-01", endDay: "2026-06-30" },
    };

    const cells = buildAttentionRhythm(segments, undefined, visibility);

    expect(cells.find((cell) => cell.weekdayIndex === 0 && cell.hour === 10)).toMatchObject({ state: "focus", intensity: 3 });
    expect(cells.find((cell) => cell.weekdayIndex === 1 && cell.hour === 10)).toMatchObject({ state: "focus", intensity: 1 });
    expect(cells.find((cell) => cell.weekdayIndex === 2 && cell.hour === 10)).toMatchObject({ state: "focus", intensity: 3 });
  });

  it("orders weekly chart segments by each day's largest share first", () => {
    const weekly = [
      {
        weekdayIndex: 0,
        weekday: "Mon",
        isActive: true,
        focusSeconds: 0,
        neutralSeconds: 0,
        driftSeconds: 0,
        categorySeconds: {
          workspace: 1800,
          learning: 1800,
          entertainment: 7200,
          utility: 3600,
        },
        projectSeconds: {},
      },
    ];

    const chart = buildWeeklyChartView(weekly, "category", [
      { category: "workspace", seconds: 1800 },
      { category: "learning", seconds: 1800 },
      { category: "entertainment", seconds: 7200 },
      { category: "utility", seconds: 3600 },
    ]);

    expect(chart.columns[0]?.segments.map((segment) => segment.key)).toEqual([
      "entertainment",
      "utility",
      "workspace",
      "learning",
    ]);
  });
});

describe("weekly project view", () => {
  it("buckets project time by weekday, averaging, and pools unassigned classified time under No project", () => {
    const segments = [
      segmentOnDay("a", "2026-06-12", "workspace", "focus"), // Fri
      segmentOnDay("b", "2026-06-05", "workspace", "focus"), // previous Fri
      segmentOnDay("c", "2026-06-12", "entertainment", "drift"), // Fri, classified but unassigned
    ];
    const projectBySegmentId = new Map([["a", "p1"], ["b", "p1"]]);
    const weekly = buildWeeklyBreakdown(segments, undefined, undefined, projectBySegmentId);
    const friday = weekly.find((day) => day.weekday === "Fri");
    // Friday bucket spans two dates → occurrences 2 → (3600 + 3600) / 2.
    expect(friday?.projectSeconds.p1).toBeCloseTo(3600, 5);
    // Segment c is classified but assigned to no project → the shared No-project bucket.
    expect(friday?.projectSeconds[NO_PROJECT_KEY]).toBeCloseTo(1800, 5);
  });

  it("keeps unclassified time out of the No-project bucket", () => {
    const segments = [
      segmentOnDay("a", "2026-06-12", "workspace", "focus"), // assigned
      segmentOnDay("u", "2026-06-12", "unknown", "neutral"), // unclassified, unassigned
    ];
    const projectBySegmentId = new Map([["a", "p1"]]);
    const weekly = buildWeeklyBreakdown(segments, undefined, undefined, projectBySegmentId);
    const friday = weekly.find((day) => day.weekday === "Fri");
    expect(friday?.projectSeconds.p1).toBeCloseTo(3600, 5);
    // Unclassified time is excluded from every lens, including No project.
    expect(friday?.projectSeconds[NO_PROJECT_KEY]).toBeUndefined();
  });

  it("builds project-mode chart columns from projectSeconds + projectSeries, largest first", () => {
    const weekly = [{
      weekdayIndex: 0,
      weekday: "Mon",
      isActive: true,
      focusSeconds: 0,
      neutralSeconds: 0,
      driftSeconds: 0,
      categorySeconds: {},
      projectSeconds: { p1: 5400, p2: 1800 },
    }];
    const chart = buildWeeklyChartView(weekly, "project", [], [
      { key: "p1", color: "#111111" },
      { key: "p2", color: "#222222" },
    ]);
    const column = chart.columns[0];
    expect(column?.totalSeconds).toBe(7200);
    expect(column?.segments.map((segment) => segment.key)).toEqual(["p1", "p2"]);
    expect(column?.segments.map((segment) => segment.color)).toEqual(["#111111", "#222222"]);
    expect(column?.segments[0]?.seconds).toBe(5400);
  });
});
