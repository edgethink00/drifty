import { describe, expect, it } from "vitest";
import { clipDeviceElapsedTimeSegment, type ActivitySegment } from "@drifty/domain";
import { selectInsightSegments } from "../features/insights/insightSegments";
import { filterSegmentsForRange } from "./formatting";
import { selectDashboardSegments } from "../features/dashboard/dashboardWeekData";

const range = {
  start: "2026-09-30T09:00:00+09:00",
  end: "2026-09-30T01:00:00Z",
  startDay: "2026-09-30",
  endDay: "2026-09-30",
};

function segment(id: string, startedAt: string, endedAt = startedAt): ActivitySegment {
  return {
    id,
    startedAt,
    endedAt,
    durationSeconds: 60,
    appName: "Synthetic",
    platform: "macos",
    source: "nsworkspace",
  };
}

describe("activity range selection contract", () => {
  it("includes touching endpoints and forward positive points across offsets while preserving references and order", () => {
    const end = segment("duplicate", "2026-09-30T10:00:00+09:00");
    const start = segment("duplicate", "2026-09-29T23:59:00Z", "2026-09-30T00:00:00Z");
    const spanning = segment("spanning", "2026-09-29T23:00:00Z", "2026-09-30T02:00:00Z");
    const before = segment("before", "2026-09-29T23:59:59.999Z");
    const after = segment("after", "2026-09-30T01:00:00.001Z");
    const rows = [end, before, start, after, spanning];
    rows.forEach(Object.freeze);
    Object.freeze(rows);

    const result = filterSegmentsForRange(rows, range.start, range.end);

    expect(result).toEqual([end, before, start, spanning]);
    expect(result[0]).toBe(end);
    expect(result[1]).toBe(before);
    expect(result[2]).toBe(start);
    expect(result[3]).toBe(spanning);
    expect(result).not.toBe(rows);
  });

  it("keeps invalid timestamp and invalid range exclusion behavior", () => {
    const valid = segment("valid", "2026-09-30T00:30:00Z");
    const rows = [
      segment("bad-start", ""),
      segment("bad-end", valid.startedAt, "invalid"),
      valid,
    ];

    expect(filterSegmentsForRange(rows, range.start, range.end)).toEqual([valid]);
    expect(filterSegmentsForRange(rows, "invalid", range.end)).toEqual([]);
    expect(filterSegmentsForRange(rows, range.start, "")).toEqual([]);
  });

  it.each(["Today", "Week", "Month"] as const)("keeps inclusive offset-aware selection for %s", (dashPeriod) => {
    const start = segment("start", "2026-09-30T00:00:00Z");
    const end = segment("end", "2026-09-30T10:00:00+09:00");
    const outside = segment("outside", "2026-09-30T01:00:00.001Z");
    const rows = [end, outside, start];

    const result = selectDashboardSegments({
      dashPeriod,
      compactHistorySource: { range, segments: rows },
      historySource: { range, segments: rows },
      requiredHistoryRange: range,
      selectedDaySegments: dashPeriod === "Today" ? rows : [],
      visibleRange: range,
    });

    expect(result).toEqual([end, start]);
    expect(result[0]).toBe(end);
    expect(result[1]).toBe(start);
  });

  it("uses covered Week fallback when compact coverage has an invalid bound", () => {
    const row = segment("fallback", "2026-09-30T00:30:00Z");

    const result = selectDashboardSegments({
      dashPeriod: "Week",
      compactHistorySource: { range: { ...range, end: "invalid" }, segments: [] },
      historySource: { range, segments: [row] },
      requiredHistoryRange: range,
      selectedDaySegments: [],
      visibleRange: range,
    });

    expect(result).toEqual([row]);
    expect(result[0]).toBe(row);
  });
});


describe("summary selection agrees with exact logical clipping", () => {
  it.each(["Today", "Week", "Month"] as const)("preserves forward and final-second samples for %s", (dashPeriod) => {
    for (const [startedAt, durationSeconds, expected] of [
      ["2026-10-04T23:59:58Z", 60, [2, 58]],
      ["2026-10-04T23:59:59.500Z", 1, [0.5, 0.5]],
    ] as const) {
      const raw = { ...segment("boundary", startedAt), durationSeconds };
      const dashboardTotals: number[] = [];
      const insightTotals: number[] = [];
      for (const day of ["2026-10-04", "2026-10-05"]) {
        const visibleRange = { start: day + "T00:00:00Z", end: day + "T23:59:59Z", startDay: day, endDay: day };
        const clipWindow = { start: Date.parse(visibleRange.start), end: Date.parse(visibleRange.end) + 1000 };
        const selected = selectDashboardSegments({
          dashPeriod,
          compactHistorySource: { range: visibleRange, segments: [raw] },
          historySource: { range: visibleRange, segments: [raw] },
          requiredHistoryRange: visibleRange,
          selectedDaySegments: dashPeriod === "Today" ? [raw] : [],
          visibleRange,
          clipWindow,
        });
        dashboardTotals.push(selected.reduce((sum, row) => sum + clipDeviceElapsedTimeSegment(row, clipWindow).durationSeconds, 0));
        insightTotals.push(selectInsightSegments({
          historySegments: [raw], selectedDaySegments: [], range: visibleRange, endExclusiveMs: clipWindow.end,
        }).reduce((sum, row) => sum + row.durationSeconds, 0));
      }
      expect(dashboardTotals).toEqual(expected);
      expect(insightTotals).toEqual(expected);
      expect(raw.durationSeconds).toBe(durationSeconds);
    }
  });
});
