import type { ActivitySegment } from "@drifty/domain";
import { describe, expect, it } from "vitest";
import { selectDashboardSegments } from "./dashboardWeekData";

type SegmentSource = {
  readonly range: {
    readonly start: string;
    readonly end: string;
  };
  readonly segments: ActivitySegment[];
};

const visibleCurrentWeek = {
  start: "2026-05-18T04:00:00",
  end: "2026-05-25T03:59:59",
  startDay: "2026-05-18",
  endDay: "2026-05-24",
};

const currentWeekThroughToday = {
  start: "2026-05-18T04:00:00",
  end: "2026-05-21T03:59:59",
};

const previousWeekRange = {
  start: "2026-05-11T04:00:00",
  end: "2026-05-18T03:59:59",
};

function segment(id: string, startedAt: string, endedAt: string): ActivitySegment {
  return {
    id,
    startedAt,
    endedAt,
    durationSeconds: 1800,
    appName: id,
    bundleId: `com.drifty.test.${id}`,
    windowTitle: `${id} window`,
    platform: "macos",
    source: "nsworkspace",
  };
}

function classifiedSegment(id: string, startedAt: string, endedAt: string): ActivitySegment {
  return {
    ...segment(id, startedAt, endedAt),
    classification: {
      category: "workspace",
      confidence: 0.94,
      productivity: "focus",
      reason: "cached classification",
      source: "rule",
    },
  };
}

function source(range: SegmentSource["range"], segments: ActivitySegment[]): SegmentSource {
  return { range, segments };
}

describe("selectDashboardSegments", () => {
  it("uses compact week history before stale global history when selecting Week data", () => {
    const compactSegment = segment("compact-focus", "2026-05-19T10:00:00", "2026-05-19T10:30:00");
    const staleHistorySegment = segment("stale-history", "2026-05-19T11:00:00", "2026-05-19T11:30:00");

    const selected = selectDashboardSegments({
      compactHistorySource: source(currentWeekThroughToday, [compactSegment]),
      dashPeriod: "Week",
      historySource: source(previousWeekRange, [staleHistorySegment]),
      requiredHistoryRange: currentWeekThroughToday,
      selectedDaySegments: [],
      visibleRange: visibleCurrentWeek,
    });

    expect(selected.map((item) => item.id)).toEqual(["compact-focus"]);
  });

  it("does not show wrong-range history as loaded Week data during a cache miss", () => {
    const wrongRangeSegment = segment("wrong-range", "2026-05-19T11:00:00", "2026-05-19T11:30:00");

    const selected = selectDashboardSegments({
      compactHistorySource: null,
      dashPeriod: "Week",
      historySource: source(previousWeekRange, [wrongRangeSegment]),
      requiredHistoryRange: currentWeekThroughToday,
      selectedDaySegments: [],
      visibleRange: visibleCurrentWeek,
    });

    expect(selected).toEqual([]);
  });

  it("uses covered history as a Week fallback when compact history is missing", () => {
    const fallbackSegment = segment("covered-history", "2026-05-19T11:00:00", "2026-05-19T11:30:00");

    const selected = selectDashboardSegments({
      compactHistorySource: null,
      dashPeriod: "Week",
      historySource: source(currentWeekThroughToday, [fallbackSegment]),
      requiredHistoryRange: currentWeekThroughToday,
      selectedDaySegments: [],
      visibleRange: visibleCurrentWeek,
    });

    expect(selected.map((item) => item.id)).toEqual(["covered-history"]);
  });

  it("treats an empty covered compact Week load as authoritative", () => {
    const fallbackSegment = segment("fallback-history", "2026-05-19T11:00:00", "2026-05-19T11:30:00");

    const selected = selectDashboardSegments({
      compactHistorySource: source(currentWeekThroughToday, []),
      dashPeriod: "Week",
      historySource: source(currentWeekThroughToday, [fallbackSegment]),
      requiredHistoryRange: currentWeekThroughToday,
      selectedDaySegments: [],
      visibleRange: visibleCurrentWeek,
    });

    expect(selected).toEqual([]);
  });

  it("merges overlapping selected-day live segments into cached Week data", () => {
    const compactSegment = segment("compact-focus", "2026-05-19T10:00:00", "2026-05-19T10:30:00");
    const liveSegment = segment("live-today", "2026-05-20T12:00:00", "2026-05-20T12:30:00");

    const selected = selectDashboardSegments({
      compactHistorySource: source(currentWeekThroughToday, [compactSegment]),
      dashPeriod: "Week",
      historySource: null,
      requiredHistoryRange: currentWeekThroughToday,
      selectedDaySegments: [liveSegment],
      visibleRange: visibleCurrentWeek,
    });

    expect(selected.map((item) => item.id)).toEqual(["compact-focus", "live-today"]);
  });

  it("preserves cached classification when a newer live copy does not have one", () => {
    const cachedSegment = classifiedSegment("same-segment", "2026-05-20T12:00:00", "2026-05-20T12:25:00");
    const liveSegment = segment("same-segment", "2026-05-20T12:00:00", "2026-05-20T12:30:00");

    const selected = selectDashboardSegments({
      compactHistorySource: source(currentWeekThroughToday, [cachedSegment]),
      dashPeriod: "Week",
      historySource: null,
      requiredHistoryRange: currentWeekThroughToday,
      selectedDaySegments: [liveSegment],
      visibleRange: visibleCurrentWeek,
    });

    expect(selected).toHaveLength(1);
    expect(selected[0]?.endedAt).toBe("2026-05-20T12:30:00");
    expect(selected[0]?.classification?.category).toBe("workspace");
  });

  it("lets a newer selected-day revision shrink a stale compact Week row", () => {
    const staleCompact = {
      ...segment("same-segment", "2026-05-20T12:00:00", "2026-05-20T12:03:05"),
      durationSeconds: 185,
      revision: 37,
    } as ActivitySegment & { readonly revision: number };
    const trimmedLive = {
      ...segment("same-segment", "2026-05-20T12:00:00", "2026-05-20T12:01:00"),
      durationSeconds: 60,
      revision: 38,
    } as ActivitySegment & { readonly revision: number };

    const selected = selectDashboardSegments({
      compactHistorySource: source(currentWeekThroughToday, [staleCompact]),
      dashPeriod: "Week",
      historySource: null,
      requiredHistoryRange: currentWeekThroughToday,
      selectedDaySegments: [trimmedLive],
      visibleRange: visibleCurrentWeek,
    });

    expect(selected).toHaveLength(1);
    expect(selected[0]).toBe(trimmedLive);
    expect(selected[0]?.durationSeconds).toBe(60);
  });

  it("keeps Today selection on selected-day segments and ignores week sources", () => {
    const todaySegment = segment("today-only", "2026-05-20T12:00:00", "2026-05-20T12:30:00");
    const compactSegment = segment("compact-focus", "2026-05-19T10:00:00", "2026-05-19T10:30:00");
    const todayRange = {
      start: "2026-05-20T04:00:00",
      end: "2026-05-21T03:59:59",
      startDay: "2026-05-20",
      endDay: "2026-05-20",
    };

    const selected = selectDashboardSegments({
      compactHistorySource: source(currentWeekThroughToday, [compactSegment]),
      dashPeriod: "Today",
      historySource: source(currentWeekThroughToday, [compactSegment]),
      requiredHistoryRange: todayRange,
      selectedDaySegments: [todaySegment],
      visibleRange: todayRange,
    });

    expect(selected.map((item) => item.id)).toEqual(["today-only"]);
  });
});
