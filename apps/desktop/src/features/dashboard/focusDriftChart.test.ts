import { describe, expect, it } from "vitest";
import type { ActivitySegment } from "@drifty/domain";
import {
  FOCUS_DRIFT_CHART_BOUNDS,
  FOCUS_DRIFT_CLIP_BOUNDS,
  FOCUS_DRIFT_MINUTES_PER_DAY,
  buildFocusDriftChart,
  buildSmoothPath,
  scaleFocusDriftY,
  type FocusDriftPoint,
} from "./focusDriftChart";

type CubicSegment = {
  readonly c1: { readonly x: number; readonly y: number };
  readonly c2: { readonly x: number; readonly y: number };
  readonly end: { readonly x: number; readonly y: number };
};

type FocusDriftTestProductivity = "focus" | "drift";

type TimedSegmentInSeconds = {
  readonly id: string;
  readonly startSecond: number;
  readonly durationSeconds: number;
  readonly productivity: FocusDriftTestProductivity;
};

const CATEGORY_BY_TEST_PRODUCTIVITY = {
  focus: "workspace",
  drift: "social_media",
} as const satisfies Record<FocusDriftTestProductivity, "workspace" | "social_media">;

function makePoint(index: number, x: number, focusY: number): FocusDriftPoint {
  return {
    id: `point-${index}`,
    day: "2026-06-13",
    label: `${index}`,
    unit: "window",
    bucketStartMinute: index * 30,
    isFuture: false,
    focusSeconds: 0,
    driftSeconds: 0,
    focusCaptures: 0,
    driftCaptures: 0,
    totalSeconds: 0,
    trackedSeconds: 0,
    windowSeconds: 30 * 60,
    focusScore: 0,
    driftScore: 0,
    topFocusSource: null,
    topDriftSource: null,
    x,
    focusY,
    driftY: focusY,
  };
}

function formatDateTimeAtSecond(secondOfDay: number): string {
  const hour = Math.floor(secondOfDay / 3600);
  const minute = Math.floor((secondOfDay % 3600) / 60);
  const second = secondOfDay % 60;
  return `2026-06-13T${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}:${second.toString().padStart(2, "0")}`;
}

function makeTimedSegmentInSeconds(input: TimedSegmentInSeconds): ActivitySegment {
  const endSecond = input.startSecond + input.durationSeconds;
  return {
    id: input.id,
    startedAt: formatDateTimeAtSecond(input.startSecond),
    endedAt: formatDateTimeAtSecond(endSecond),
    durationSeconds: input.durationSeconds,
    appName: "Visual Studio Code",
    bundleId: "com.microsoft.VSCode",
    windowTitle: "focusDriftChart.ts",
    platform: "macos",
    source: "manual",
    classification: {
      category: CATEGORY_BY_TEST_PRODUCTIVITY[input.productivity],
      productivity: input.productivity,
      source: "manual",
      confidence: 1,
    },
  };
}

function makeTimedSegment(id: string, startMinute: number, durationMinutes: number): ActivitySegment {
  return makeTimedSegmentInSeconds({
    id,
    startSecond: startMinute * 60,
    durationSeconds: durationMinutes * 60,
    productivity: "focus",
  });
}

function makeFocusSegment(): ActivitySegment {
  return {
    id: "focus-live",
    startedAt: "2026-06-13T12:00:00",
    endedAt: "2026-06-13T13:00:00",
    durationSeconds: 3600,
    appName: "Visual Studio Code",
    bundleId: "com.microsoft.VSCode",
    windowTitle: "focusDriftChart.ts",
    platform: "macos",
    source: "manual",
    classification: {
      category: "workspace",
      productivity: "focus",
      source: "manual",
      confidence: 1,
    },
  };
}

function readNumberAt(values: readonly number[], index: number): number {
  const value = values[index];
  if (value === undefined) throw new Error(`Expected path number at index ${index}`);
  return value;
}

function parseCubicSegments(pathData: string): readonly CubicSegment[] {
  const numbers = Array.from(pathData.matchAll(/-?\d+(?:\.\d+)?/g), (match) => Number(match[0]));
  const segments: CubicSegment[] = [];
  for (let index = 2; index < numbers.length; index += 6) {
    segments.push({
      c1: { x: readNumberAt(numbers, index), y: readNumberAt(numbers, index + 1) },
      c2: { x: readNumberAt(numbers, index + 2), y: readNumberAt(numbers, index + 3) },
      end: { x: readNumberAt(numbers, index + 4), y: readNumberAt(numbers, index + 5) },
    });
  }
  return segments;
}

describe("buildSmoothPath", () => {
  it("keeps generated control points inside the focus drift chart bounds", () => {
    const bottomY = scaleFocusDriftY(0);
    const topY = scaleFocusDriftY(100);
    const pathData = buildSmoothPath([
      makePoint(0, 0, bottomY),
      makePoint(1, 20, topY),
      makePoint(2, 40, topY),
      makePoint(3, 60, bottomY),
      makePoint(4, 120, bottomY),
    ], "focusY");

    const numbers = Array.from(pathData.matchAll(/-?\d+(?:\.\d+)?/g), (match) => Number(match[0]));

    for (let index = 0; index < numbers.length; index += 2) {
      const x = readNumberAt(numbers, index);
      const y = readNumberAt(numbers, index + 1);
      expect(x).toBeGreaterThanOrEqual(FOCUS_DRIFT_CLIP_BOUNDS.left);
      expect(x).toBeLessThanOrEqual(FOCUS_DRIFT_CLIP_BOUNDS.right);
      expect(y).toBeGreaterThanOrEqual(FOCUS_DRIFT_CHART_BOUNDS.top);
      expect(y).toBeLessThanOrEqual(FOCUS_DRIFT_CHART_BOUNDS.bottom);
    }
  });

  it("enters a full focus plateau with a horizontal tangent", () => {
    const bottomY = scaleFocusDriftY(0);
    const topY = scaleFocusDriftY(100);
    const pathData = buildSmoothPath([
      makePoint(0, 10, bottomY),
      makePoint(1, 20, topY),
      makePoint(2, 30, topY),
    ], "focusY");

    const [riseSegment] = parseCubicSegments(pathData);

    expect(riseSegment?.end.y).toBe(topY);
    expect(riseSegment?.c2.y).toBe(topY);
  });

  it("leaves a full focus plateau with a horizontal tangent", () => {
    const bottomY = scaleFocusDriftY(0);
    const topY = scaleFocusDriftY(100);
    const pathData = buildSmoothPath([
      makePoint(0, 10, topY),
      makePoint(1, 20, topY),
      makePoint(2, 30, bottomY),
    ], "focusY");

    const segments = parseCubicSegments(pathData);
    const fallSegment = segments[1];

    expect(fallSegment?.c1.y).toBe(topY);
    expect(fallSegment?.end.y).toBe(bottomY);
  });
});

describe("buildFocusDriftChart", () => {
  it("keeps the live bucket anchored to the current minute", () => {
    const currentMinuteOfDay = 12 * 60 + 45;
    const expectedCurrentX = FOCUS_DRIFT_CHART_BOUNDS.left
      + (currentMinuteOfDay / FOCUS_DRIFT_MINUTES_PER_DAY)
      * (FOCUS_DRIFT_CHART_BOUNDS.right - FOCUS_DRIFT_CHART_BOUNDS.left);

    const chart = buildFocusDriftChart([makeFocusSegment()], "2026-06-13", undefined, currentMinuteOfDay, 0);
    const livePoint = chart.points.find((point) => point.bucketStartMinute === 12 * 60 + 30);
    if (!livePoint) throw new Error("Expected live bucket point to exist");

    expect(chart.currentX).toBe(expectedCurrentX);
    expect(livePoint.x).toBe(expectedCurrentX);
  });

  it("labels live windows with clock time when the day starts after midnight", () => {
    const currentMinuteOfDay = 12 * 60 + 45;
    const startOfDayMinutes = 4 * 60;

    const chart = buildFocusDriftChart([makeFocusSegment()], "2026-06-13", undefined, currentMinuteOfDay, startOfDayMinutes);
    const livePoint = chart.points.find((point) => point.bucketStartMinute === 8 * 60 + 30);
    if (!livePoint) throw new Error("Expected live bucket point to exist");

    expect(chart.currentTimeLabel).toBe("12:45 PM");
    expect(livePoint.label).toBe("12:30");
    expect(chart.axisTicks.map((tick) => tick.label)).toEqual(["04:00", "07:00", "10:00", "13:00", "16:00", "19:00", "22:00", "01:00", "04:00"]);
  });

  it("keeps sparse focus windows downweighted by scored coverage", () => {
    const chart = buildFocusDriftChart([makeTimedSegment("short-focus", 12 * 60, 3)], "2026-06-13");
    const sparseFocusPoint = chart.points.find((point) => point.bucketStartMinute === 12 * 60);

    if (!sparseFocusPoint) throw new Error("Expected sparse focus bucket to exist");

    expect(sparseFocusPoint.focusScore).toBe(84);
    expect(sparseFocusPoint.driftScore).toBe(0);
    expect(sparseFocusPoint.trackedSeconds).toBe(3 * 60);
    expect(chart.focusConsistency).toBe(84);
  });

  it("scores focus and drift windows with their own ratio and coverage", () => {
    const bucketStartSecond = 12 * 60 * 60;
    const chart = buildFocusDriftChart([
      makeTimedSegmentInSeconds({
        id: "mostly-focus",
        startSecond: bucketStartSecond,
        durationSeconds: 1_152,
        productivity: "focus",
      }),
      makeTimedSegmentInSeconds({
        id: "some-drift",
        startSecond: bucketStartSecond + 1_152,
        durationSeconds: 288,
        productivity: "drift",
      }),
    ], "2026-06-13");
    const reliableFocusPoint = chart.points.find((point) => point.bucketStartMinute === 12 * 60);

    if (!reliableFocusPoint) throw new Error("Expected reliable focus bucket to exist");

    expect(reliableFocusPoint.totalSeconds).toBe(24 * 60);
    expect(reliableFocusPoint.focusScore).toBeCloseTo(81.12, 2);
    expect(reliableFocusPoint.driftScore).toBeCloseTo(17.68, 2);
    expect(chart.focusConsistency).toBe(81);
  });
});
