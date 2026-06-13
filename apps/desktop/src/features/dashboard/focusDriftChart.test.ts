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
    focusScore: 0,
    driftScore: 0,
    topFocusSource: null,
    topDriftSource: null,
    x,
    focusY,
    driftY: focusY,
  };
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
});
