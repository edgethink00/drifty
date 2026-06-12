import type { ActivityCategory, ActivitySegment, ProductivityLabel } from "@drifty/domain";
import { describe, expect, it } from "vitest";
import { buildAttentionRhythm, buildWeeklyBreakdown } from "./insightData";

function segmentOnDay(
  id: string,
  day: string,
  category: ActivityCategory,
  productivity: ProductivityLabel,
): ActivitySegment {
  return {
    id,
    startedAt: `${day}T10:00:00.000`,
    endedAt: `${day}T11:00:00.000`,
    durationSeconds: 60 * 60,
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

  it("leaves attention rhythm cells empty after the insight window end weekday", () => {
    const segments = [
      segmentOnDay("friday-focus", "2026-06-12", "workspace", "focus"),
      segmentOnDay("saturday-focus", "2026-06-06", "workspace", "focus"),
      segmentOnDay("sunday-drift", "2026-06-07", "entertainment", "drift"),
    ];

    const cells = buildAttentionRhythm(segments, undefined, { visibleThroughDay: "2026-06-12" });
    const saturdayCells = cells.filter((cell) => cell.weekdayIndex === 5);
    const sundayCells = cells.filter((cell) => cell.weekdayIndex === 6);

    expect(cells.find((cell) => cell.weekdayIndex === 4 && cell.hour === 10)).toMatchObject({ state: "focus", intensity: 3 });
    expect(saturdayCells.every((cell) => cell.state === "neutral" && cell.intensity === 0)).toBe(true);
    expect(sundayCells.every((cell) => cell.state === "neutral" && cell.intensity === 0)).toBe(true);
  });
});
