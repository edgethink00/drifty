import type { ActivityCategory, ActivitySegment, ProductivityLabel } from "@drifty/domain";
import { describe, expect, it } from "vitest";
import { buildAttentionRhythm, buildWeeklyBreakdown } from "./insightData";

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
});
