import { describe, expect, it } from "vitest";
import type { ActivitySegment } from "@drifty/domain";
import {
  FOCUS_DRIFT_CHART_BOUNDS,
  FOCUS_DRIFT_CLIP_BOUNDS,
  FOCUS_DRIFT_MINUTES_PER_DAY,
  applyFocusDriftReplayReveal,
  buildFocusDriftChart,
  buildSmoothPath,
  getSmoothPathPointAtX,
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
    classifiedSeconds: 0,
    unclassifiedSeconds: 0,
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

function parsePathNumbers(pathData: string): readonly number[] {
  return Array.from(pathData.matchAll(/-?\d+(?:\.\d+)?/g), (match) => Number(match[0]));
}

function cubicBezierAt(start: { readonly x: number; readonly y: number }, segment: CubicSegment, t: number): { x: number; y: number } {
  const u = 1 - t;
  return {
    x: u * u * u * start.x + 3 * u * u * t * segment.c1.x + 3 * u * t * t * segment.c2.x + t * t * t * segment.end.x,
    y: u * u * u * start.y + 3 * u * u * t * segment.c1.y + 3 * u * t * t * segment.c2.y + t * t * t * segment.end.y,
  };
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

  it("starts and ends on the source boundary points", () => {
    const bottomY = scaleFocusDriftY(0);
    const topY = scaleFocusDriftY(100);
    const pathData = buildSmoothPath([
      makePoint(0, 10, bottomY),
      makePoint(1, 20, topY),
      makePoint(2, 30, bottomY),
    ], "focusY");
    const numbers = parsePathNumbers(pathData);
    const segments = parseCubicSegments(pathData);
    const lastSegment = segments[segments.length - 1];

    expect(readNumberAt(numbers, 0)).toBe(10);
    expect(readNumberAt(numbers, 1)).toBe(bottomY);
    expect(lastSegment?.end).toEqual({ x: 30, y: bottomY });
  });

  it("keeps tangents continuous across interior knots", () => {
    const bottomY = scaleFocusDriftY(0);
    const topY = scaleFocusDriftY(100);
    const pathData = buildSmoothPath([
      makePoint(0, 10, bottomY),
      makePoint(1, 20, topY),
      makePoint(2, 30, bottomY),
      makePoint(3, 40, topY),
      makePoint(4, 50, bottomY),
    ], "focusY");
    const numbers = parsePathNumbers(pathData);
    const segments = parseCubicSegments(pathData);
    const moveToPoint = { x: readNumberAt(numbers, 0), y: readNumberAt(numbers, 1) };
    const epsilon = 1e-5;

    expect(segments.length).toBeGreaterThan(1);

    for (let index = 1; index < segments.length; index += 1) {
      const previousSegment = segments[index - 1];
      const segment = segments[index];
      const previousStart = index === 1 ? moveToPoint : segments[index - 2]?.end;
      if (!previousSegment || !segment || !previousStart) throw new Error(`Expected cubic segments around knot ${index}`);

      const knot = previousSegment.end;
      const beforeKnot = cubicBezierAt(previousStart, previousSegment, 1 - epsilon);
      const afterKnot = cubicBezierAt(knot, segment, epsilon);
      const incoming = { x: (knot.x - beforeKnot.x) / epsilon, y: (knot.y - beforeKnot.y) / epsilon };
      const outgoing = { x: (afterKnot.x - knot.x) / epsilon, y: (afterKnot.y - knot.y) / epsilon };

      expect(Math.abs(outgoing.x - incoming.x)).toBeLessThan(0.01);
      expect(Math.abs(outgoing.y - incoming.y)).toBeLessThan(0.01);
    }
  });

  it("softens sharp interior peaks instead of using them as segment endpoints", () => {
    const bottomY = scaleFocusDriftY(0);
    const topY = scaleFocusDriftY(100);
    const pathData = buildSmoothPath([
      makePoint(0, 10, bottomY),
      makePoint(1, 20, topY),
      makePoint(2, 30, bottomY),
    ], "focusY");

    const segments = parseCubicSegments(pathData);
    const interiorEnds = segments.slice(0, -1).map((segment) => segment.end.y);

    expect(interiorEnds.length).toBeGreaterThan(0);
    expect(interiorEnds.every((y) => y > topY)).toBe(true);
  });

  it("returns the rendered spline coordinate rather than an interior control point", () => {
    const bottomY = scaleFocusDriftY(0);
    const topY = scaleFocusDriftY(100);
    const points = [
      makePoint(0, 10, bottomY),
      makePoint(1, 20, topY),
      makePoint(2, 30, bottomY),
    ];

    const renderedPoint = getSmoothPathPointAtX(points, "focusY", 20);

    // A basis spline softens this source control point to y=36 at x=20;
    // hover markers must follow that visible curve, never the raw y=8 input.
    expect(renderedPoint?.x).toBeCloseTo(20, 5);
    expect(renderedPoint?.y).toBeCloseTo(36, 5);
    expect(renderedPoint?.y).not.toBe(topY);
  });

  it("clamps hover marker lookup to the visible spline endpoints", () => {
    const bottomY = scaleFocusDriftY(0);
    const topY = scaleFocusDriftY(100);
    const points = [
      makePoint(0, 10, bottomY),
      makePoint(1, 20, topY),
      makePoint(2, 30, bottomY),
    ];

    expect(getSmoothPathPointAtX(points, "focusY", -20)).toEqual({ x: 10, y: bottomY });
    expect(getSmoothPathPointAtX(points, "focusY", 90)).toEqual({ x: 30, y: bottomY });
  });
});

describe("buildFocusDriftChart", () => {
  it("leaves an honest curve gap for fully unclassified tracked windows", () => {
    const unclassifiedSegment: ActivitySegment = {
      ...makeTimedSegment("unclassified-after-cutoff", 13 * 60, 30),
      classification: undefined,
    };
    const chart = buildFocusDriftChart([
      makeTimedSegment("focus-before-cutoff", 12 * 60, 30),
      unclassifiedSegment,
      makeTimedSegment("focus-after-recovery", 14 * 60, 30),
    ], "2026-06-13", {
      builtInHeuristicsUnavailableSince: "2026-06-13T13:00:00",
    });
    const gapPoint = chart.points.find((point) => point.bucketStartMinute === 13 * 60);

    expect(gapPoint).toMatchObject({
      trackedSeconds: 30 * 60,
      classifiedSeconds: 0,
      unclassifiedSeconds: 30 * 60,
    });
    expect(chart.seriesPointRuns).toHaveLength(2);
    expect(chart.seriesPointRuns.flat().some((point) => point.id === gapPoint?.id)).toBe(false);
    expect(chart.focusPath.match(/M/g)).toHaveLength(2);
    expect(chart.driftPath.match(/M/g)).toHaveLength(2);
    expect(chart.focusAreaPath.match(/Z/g)).toHaveLength(2);
    expect(chart.driftAreaPath.match(/Z/g)).toHaveLength(2);
  });

  it("keeps replay reveal position separate from completed chart geometry", () => {
    const chart = buildFocusDriftChart([
      makeTimedSegment("late-focus", 18 * 60, 60),
    ], "2026-06-13");

    const revealed = applyFocusDriftReplayReveal({
      chart,
      revealMinuteOfDay: 12 * 60,
      startOfDayMinutes: 0,
    });

    expect(revealed.isLive).toBe(false);
    expect(revealed.currentX).toBeNull();
    expect(revealed.currentTimeLabel).toBeNull();
    expect(revealed.revealX).toBe(50);
    expect(revealed.revealTimeLabel).toBe("12:00 PM");
    expect(revealed.focusPath).toBe(chart.focusPath);
    expect(revealed.driftPath).toBe(chart.driftPath);
    expect(revealed.points.find((point) => point.bucketStartMinute === 18 * 60)?.isFuture).toBe(false);
  });

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
    expect(chart.axisTicks.map((tick) => tick.label)).toEqual(["4am", "7am", "10am", "1pm", "4pm", "7pm", "10pm", "1am", "4am"]);
    expect(chart.axisTicks[0]?.x).toBe(4.5);
    expect(chart.axisTicks[chart.axisTicks.length - 1]?.x).toBe(95.5);
  });

  it("scores the live bucket by its elapsed window instead of the full bucket", () => {
    const currentMinuteOfDay = 12 * 60 + 31;
    const chart = buildFocusDriftChart([
      makeTimedSegmentInSeconds({
        id: "live-focus",
        startSecond: (12 * 60 + 30) * 60,
        durationSeconds: 60,
        productivity: "focus",
      }),
    ], "2026-06-13", undefined, currentMinuteOfDay, 0);
    const livePoint = chart.points.find((point) => point.bucketStartMinute === 12 * 60 + 30);

    if (!livePoint) throw new Error("Expected live bucket point to exist");

    expect(livePoint.windowSeconds).toBe(60);
    expect(livePoint.focusScore).toBe(100);
  });

  it("keeps completed buckets scored on the full window while live", () => {
    const currentMinuteOfDay = 12 * 60 + 31;
    const chart = buildFocusDriftChart([
      makeTimedSegmentInSeconds({
        id: "completed-focus",
        startSecond: 12 * 60 * 60,
        durationSeconds: 3 * 60,
        productivity: "focus",
      }),
    ], "2026-06-13", undefined, currentMinuteOfDay, 0);
    const completedPoint = chart.points.find((point) => point.bucketStartMinute === 12 * 60);

    if (!completedPoint) throw new Error("Expected completed bucket point to exist");

    expect(completedPoint.windowSeconds).toBe(30 * 60);
    expect(completedPoint.focusScore).toBeCloseTo(74, 2);
  });

  it("still penalizes a sparsely tracked live bucket relative to its elapsed window", () => {
    const currentMinuteOfDay = 12 * 60 + 20;
    const chart = buildFocusDriftChart([
      makeTimedSegmentInSeconds({
        id: "sparse-live-focus",
        startSecond: 12 * 60 * 60,
        durationSeconds: 60,
        productivity: "focus",
      }),
    ], "2026-06-13", undefined, currentMinuteOfDay, 0);
    const livePoint = chart.points.find((point) => point.bucketStartMinute === 12 * 60);

    if (!livePoint) throw new Error("Expected live bucket point to exist");

    expect(livePoint.windowSeconds).toBe(20 * 60);
    expect(livePoint.focusScore).toBeCloseTo(62, 2);
  });

  it.each([
    { durationSeconds: 90, expectedConsistency: 62, expectedScore: 62, label: "5%" },
    { durationSeconds: 3 * 60, expectedConsistency: 74, expectedScore: 74, label: "10%" },
    { durationSeconds: 4 * 60, expectedConsistency: 76, expectedScore: 76.44, label: "13.3%" },
    { durationSeconds: 270, expectedConsistency: 78, expectedScore: 77.67, label: "15%" },
  ] as const)("scores $label pure focus coverage with a light early penalty", ({ durationSeconds, expectedConsistency, expectedScore }) => {
    const bucketStartSecond = 12 * 60 * 60;
    const chart = buildFocusDriftChart([
      makeTimedSegmentInSeconds({
        id: `focus-${durationSeconds}`,
        startSecond: bucketStartSecond,
        durationSeconds,
        productivity: "focus",
      }),
    ], "2026-06-13");
    const focusPoint = chart.points.find((point) => point.bucketStartMinute === 12 * 60);

    if (!focusPoint) throw new Error("Expected focus bucket to exist");

    expect(focusPoint.focusScore).toBeCloseTo(expectedScore, 2);
    expect(focusPoint.driftScore).toBe(0);
    expect(focusPoint.trackedSeconds).toBe(durationSeconds);
    expect(chart.focusConsistency).toBe(expectedConsistency);
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
    expect(reliableFocusPoint.driftScore).toBe(16);
    expect(chart.focusConsistency).toBe(81);
  });
});
