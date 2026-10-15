import { describe, expect, it } from "vitest";
import type { CategoryDuration, FlowBlock, ProductivityDuration } from "@drifty/domain";
import type { WeekCalendarEvent, WeekDayRow } from "../dashboard/weekCalendar";
import { buildShareCardData, buildShareWeekCardData } from "./shareCard";

function category(category: CategoryDuration["category"], totalSeconds: number): CategoryDuration {
  return { category, totalSeconds, segments: 1, ratio: 0 };
}

function productivity(
  label: ProductivityDuration["productivity"],
  totalSeconds: number,
  ratio: number,
): ProductivityDuration {
  return { productivity: label, totalSeconds, segments: 1, ratio };
}

function block(overrides: Partial<FlowBlock> & Pick<FlowBlock, "minuteOfDay" | "durationSeconds" | "productivity">): FlowBlock {
  return {
    id: `block-${overrides.minuteOfDay}`,
    day: "2026-07-17",
    hour: Math.floor(overrides.minuteOfDay / 60),
    quarter: 0,
    appName: "Preview",
    category: "workspace",
    colorKey: "workspace",
    ...overrides,
  };
}

const BASE_INPUT = {
  day: "2026-07-17",
  totalSeconds: 3600,
  categoryTotals: [category("workspace", 2400), category("communication", 900), category("unknown", 300)],
  productivityTotals: [productivity("focus", 2400, 0.727), productivity("drift", 300, 0.09)],
  flowBlocks: [] as FlowBlock[],
  deltaSeconds: null,
};

describe("buildShareCardData", () => {
  it("labels the day and derives focus totals", () => {
    const data = buildShareCardData(BASE_INPUT);
    expect(data.weekdayLabel).toBe("Friday");
    expect(data.dateLabel).toBe("Jul 17");
    expect(data.focusSeconds).toBe(2400);
    expect(data.focusPercent).toBe(73);
    expect(data.deltaSeconds).toBeNull();
  });

  it("builds Korean date and category labels for the Korean beta", () => {
    const data = buildShareCardData({ ...BASE_INPUT, language: "ko" });

    expect(data.language).toBe("ko");
    expect(data.weekdayLabel).toBe("금요일");
    expect(data.dateLabel).toBe("7월 17일");
    expect(data.slices.map((slice) => slice.label)).toEqual(["작업", "커뮤니케이션", "미분류"]);
  });

  it("preserves the classified-time productivity denominator used by the dashboard", () => {
    const data = buildShareCardData(BASE_INPUT);

    expect(data.productivitySlices.find((slice) => slice.key === "focus")?.ratio).toBe(0.727);
    expect(data.productivitySlices.find((slice) => slice.key === "drift")?.ratio).toBe(0.09);
  });

  it("sanitizes non-finite productivity ratios at the aggregate boundary", () => {
    const data = buildShareCardData({
      ...BASE_INPUT,
      productivityTotals: [productivity("focus", 2400, Number.NaN)],
    });

    expect(data.productivitySlices).toEqual([{ key: "focus", seconds: 2400, ratio: 0 }]);
  });

  it("keeps unclassified separate from named-category overflow", () => {
    const data = buildShareCardData({
      ...BASE_INPUT,
      categoryTotals: [
        category("workspace", 2000),
        category("communication", 900),
        category("learning", 600),
        category("music", 300),
        category("utility", 100),
        category("unknown", 200),
      ],
      totalSeconds: 4100,
    });

    expect(data.slices.map((slice) => slice.key)).toEqual(["workspace", "communication", "learning", "other", "unknown"]);
    expect(data.slices.find((slice) => slice.key === "other")?.seconds).toBe(400);
    expect(data.slices.find((slice) => slice.key === "unknown")?.seconds).toBe(200);
    expect(data.slices.reduce((sum, slice) => sum + slice.ratio, 0)).toBeCloseTo(1);
  });

  it("shows the user's added categories only as Other, so their names stay on the device", () => {
    const data = buildShareCardData({
      ...BASE_INPUT,
      language: "ko",
      categoryTotals: [category("workspace", 2000), category("custom-side0001", 700), category("custom-read0002", 300), category("unknown", 200)],
      totalSeconds: 3200,
    });

    expect(data.slices.map((slice) => [slice.key, slice.label, slice.seconds])).toEqual([
      ["workspace", "작업", 2000],
      ["other", "기타", 1000],
      ["unknown", "미분류", 200],
    ]);
  });

  it("omits other when all named categories fit", () => {
    const data = buildShareCardData(BASE_INPUT);
    expect(data.slices.map((slice) => slice.key)).toEqual(["workspace", "communication", "unknown"]);
  });

  it("combines duplicate unclassified aggregates without dropping time", () => {
    const data = buildShareCardData({
      ...BASE_INPUT,
      categoryTotals: [category("workspace", 2400), category("unknown", 200), category("unknown", 100)],
      totalSeconds: 2700,
    });

    expect(data.slices.find((slice) => slice.key === "unknown")?.seconds).toBe(300);
  });

  it("buckets flow blocks into hourly tone totals", () => {
    const data = buildShareCardData({
      ...BASE_INPUT,
      flowBlocks: [
        block({ minuteOfDay: 9 * 60, durationSeconds: 300, productivity: "focus" }),
        block({ minuteOfDay: 9 * 60 + 30, durationSeconds: 120, productivity: "drift" }),
        block({ minuteOfDay: 14 * 60 + 5, durationSeconds: 600, productivity: "neutral" }),
      ],
    });
    expect(data.hours[9]).toEqual({ hour: 9, focusSeconds: 300, driftSeconds: 120, neutralSeconds: 0 });
    expect(data.hours[14]).toEqual({ hour: 14, focusSeconds: 0, driftSeconds: 0, neutralSeconds: 600 });
    expect(data.hours).toHaveLength(24);
  });

  it("merges focus runs across gaps up to five minutes", () => {
    const data = buildShareCardData({
      ...BASE_INPUT,
      flowBlocks: [
        // 10:00–10:30 focus, 4-minute gap, 10:34–10:54 focus → one 54-minute run.
        block({ minuteOfDay: 600, durationSeconds: 1800, productivity: "focus" }),
        block({ minuteOfDay: 634, durationSeconds: 1200, productivity: "focus" }),
        // 6-minute gap breaks the run.
        block({ minuteOfDay: 660, durationSeconds: 600, productivity: "focus" }),
      ],
    });
    expect(data.longestFocusSeconds).toBe(54 * 60);
  });

  it("drift blocks never extend a focus run", () => {
    const data = buildShareCardData({
      ...BASE_INPUT,
      flowBlocks: [
        block({ minuteOfDay: 600, durationSeconds: 600, productivity: "focus" }),
        block({ minuteOfDay: 610, durationSeconds: 1200, productivity: "drift" }),
      ],
    });
    expect(data.longestFocusSeconds).toBe(600);
  });

  it("finds the best two-hour focus window", () => {
    const data = buildShareCardData({
      ...BASE_INPUT,
      flowBlocks: [
        block({ minuteOfDay: 9 * 60, durationSeconds: 600, productivity: "focus" }),
        block({ minuteOfDay: 14 * 60, durationSeconds: 3000, productivity: "focus" }),
        block({ minuteOfDay: 15 * 60, durationSeconds: 2400, productivity: "focus" }),
      ],
    });
    expect(data.peakFocusLabel).toBe("14–16h");
  });

  it("returns null peak label and zero run for a day with no focus", () => {
    const data = buildShareCardData({
      ...BASE_INPUT,
      productivityTotals: [productivity("drift", 300, 1)],
      flowBlocks: [block({ minuteOfDay: 600, durationSeconds: 600, productivity: "drift" })],
    });
    expect(data.peakFocusLabel).toBeNull();
    expect(data.longestFocusSeconds).toBe(0);
    expect(data.focusSeconds).toBe(0);
    expect(data.focusPercent).toBe(0);
  });

  it("handles a completely empty day", () => {
    const data = buildShareCardData({
      ...BASE_INPUT,
      totalSeconds: 0,
      categoryTotals: [],
      productivityTotals: [],
    });
    expect(data.slices).toEqual([]);
    expect(data.totalSeconds).toBe(0);
    expect(data.hours.every((bucket) => bucket.focusSeconds + bucket.driftSeconds + bucket.neutralSeconds === 0)).toBe(true);
  });
});

function weekRow(day: string, dayName: string, focusSeconds: number, totalSeconds = focusSeconds): WeekDayRow {
  return {
    day,
    dayName,
    dayNumber: day.slice(-2),
    totalSeconds,
    focusSeconds,
    focusScore: 0,
    slices: [],
    productivitySlices: [],
  };
}

function focusEvent(topMinutes: number, durationMinutes: number, productivity: WeekCalendarEvent["productivity"] = "focus"): WeekCalendarEvent {
  return {
    id: `event-${topMinutes}`,
    segmentIds: [`segment-${topMinutes}`],
    appName: "Preview",
    category: "workspace",
    productivity,
    startLabel: "",
    endLabel: "",
    detailSummary: "",
    detailTitle: "",
    sessionCount: 1,
    identities: [],
    hiddenIdentityCount: 0,
    hasMixedCategory: false,
    hasMixedProductivity: false,
    isGroupedCluster: false,
    classificationSource: "fallback",
    aiClassification: false,
    topMinutes,
    activeDurationMinutes: durationMinutes,
    durationMinutes,
    isShort: false,
    lane: 0,
    laneCount: 1,
  };
}

const WEEK_INPUT = {
  startDay: "2026-07-13",
  endDay: "2026-07-19",
  totalSeconds: 20 * 3600,
  categoryTotals: [category("workspace", 14 * 3600), category("communication", 4 * 3600), category("learning", 2 * 3600)],
  productivityTotals: [productivity("focus", 16 * 3600, 0.8)],
  weekRows: [
    weekRow("2026-07-13", "Mon", 3 * 3600),
    weekRow("2026-07-14", "Tue", 4 * 3600),
    weekRow("2026-07-15", "Wed", 2 * 3600),
    weekRow("2026-07-16", "Thu", 5 * 3600),
    weekRow("2026-07-17", "Fri", 2 * 3600),
    weekRow("2026-07-18", "Sat", 0),
    weekRow("2026-07-19", "Sun", 0),
  ],
  calendarEvents: new Map<string, WeekCalendarEvent[]>(),
  deltaSeconds: 3 * 3600,
};

describe("buildShareWeekCardData", () => {
  it("labels the week and range", () => {
    const data = buildShareWeekCardData(WEEK_INPUT);
    expect(data.weekLabel).toBe("Week 29");
    expect(data.rangeLabel).toBe("Jul 13–19");
    expect(data.focusSeconds).toBe(16 * 3600);
    expect(data.focusPercent).toBe(80);
  });

  it("averages daily focus over tracked days, including a zero-focus activity day", () => {
    const weekRows = WEEK_INPUT.weekRows.map((row) => (
      row.day === "2026-07-18" ? { ...row, totalSeconds: 3600 } : row
    ));
    const data = buildShareWeekCardData({ ...WEEK_INPUT, weekRows });
    // 16h across six tracked days; Saturday counts even though it had no Focus.
    expect(data.avgDailyFocusSeconds).toBe((16 * 3600) / 6);
  });

  it("spans months in the range label", () => {
    const data = buildShareWeekCardData({ ...WEEK_INPUT, startDay: "2026-06-29", endDay: "2026-07-05" });
    expect(data.rangeLabel).toBe("Jun 29–Jul 5");
  });

  it("builds Korean week labels and weekday initials", () => {
    const data = buildShareWeekCardData({ ...WEEK_INPUT, language: "ko" });

    expect(data.language).toBe("ko");
    expect(data.weekLabel).toMatch(/주차$/);
    expect(data.rangeLabel).toContain("7월");
    expect(data.days.map((day) => day.letter)).toEqual(["월", "화", "수", "목", "금", "토", "일"]);
    expect(data.bestDayLabel).toBe("목요일");
  });

  it("marks the best day and derives its full name", () => {
    const data = buildShareWeekCardData(WEEK_INPUT);
    expect(data.days).toHaveLength(7);
    expect(data.days.map((day) => day.letter)).toEqual(["M", "T", "W", "T", "F", "S", "S"]);
    expect(data.days.filter((day) => day.isBest).map((day) => day.day)).toEqual(["2026-07-16"]);
    expect(data.bestDayLabel).toBe("Thursday");
  });

  it("computes the longest per-day deep-work run from calendar events", () => {
    const events = new Map<string, WeekCalendarEvent[]>([
      // 10:00–11:00 + 4-min gap + 11:04–11:34 → 94 minutes; drift never joins a run.
      ["2026-07-16", [focusEvent(600, 60), focusEvent(664, 30), focusEvent(700, 120, "drift")]],
      ["2026-07-14", [focusEvent(540, 45)]],
    ]);
    const data = buildShareWeekCardData({ ...WEEK_INPUT, calendarEvents: events });
    expect(data.longestFocusSeconds).toBe(94 * 60);
  });

  it("handles an empty week", () => {
    const data = buildShareWeekCardData({
      ...WEEK_INPUT,
      totalSeconds: 0,
      categoryTotals: [],
      productivityTotals: [],
      weekRows: WEEK_INPUT.weekRows.map((row) => ({ ...row, focusSeconds: 0, totalSeconds: 0 })),
      deltaSeconds: null,
    });
    expect(data.bestDayLabel).toBeNull();
    expect(data.days.every((day) => !day.isBest)).toBe(true);
    expect(data.longestFocusSeconds).toBe(0);
    expect(data.avgDailyFocusSeconds).toBe(0);
    expect(data.slices).toEqual([]);
  });
});
