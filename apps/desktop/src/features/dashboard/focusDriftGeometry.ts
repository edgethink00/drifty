import type { FocusDriftPoint } from "./focusDriftChart";

type FocusDriftPathPoint = {
  readonly x: number;
  readonly y: number;
};

type FocusDriftBezierSegment = {
  readonly controlStart: FocusDriftPathPoint;
  readonly controlEnd: FocusDriftPathPoint;
  readonly end: FocusDriftPathPoint;
};

type FocusDriftBasisWindow = {
  readonly p0: FocusDriftPathPoint;
  readonly p1: FocusDriftPathPoint;
  readonly p2: FocusDriftPathPoint;
  readonly p3: FocusDriftPathPoint;
};

export const FOCUS_DRIFT_CHART_BOUNDS = { left: 5, right: 95, top: 8, bottom: 92 } as const;

export const FOCUS_DRIFT_MINUTES_PER_DAY = 24 * 60;

export const FOCUS_DRIFT_BUCKET_MINUTES = 30;

export const FOCUS_DRIFT_BUCKET_COUNT = FOCUS_DRIFT_MINUTES_PER_DAY / FOCUS_DRIFT_BUCKET_MINUTES;

export const FOCUS_DRIFT_CLIP_PADDING = { x: 2.5, y: 2.5 } as const;

export const FOCUS_DRIFT_CLIP_BOUNDS = {
  left: FOCUS_DRIFT_CHART_BOUNDS.left - FOCUS_DRIFT_CLIP_PADDING.x,
  right: FOCUS_DRIFT_CHART_BOUNDS.right + FOCUS_DRIFT_CLIP_PADDING.x,
  top: FOCUS_DRIFT_CHART_BOUNDS.top - FOCUS_DRIFT_CLIP_PADDING.y,
  bottom: FOCUS_DRIFT_CHART_BOUNDS.bottom + FOCUS_DRIFT_CLIP_PADDING.y,
} as const;

export function scaleFocusDriftY(score: number): number {
  const boundedScore = Math.min(Math.max(score, 0), 100);
  const chartHeight = FOCUS_DRIFT_CHART_BOUNDS.bottom - FOCUS_DRIFT_CHART_BOUNDS.top;
  return FOCUS_DRIFT_CHART_BOUNDS.top + ((100 - boundedScore) / 100) * chartHeight;
}

export function clampFocusDriftChartX(value: number): number {
  return Math.min(Math.max(value, FOCUS_DRIFT_CLIP_BOUNDS.left), FOCUS_DRIFT_CLIP_BOUNDS.right);
}

export function clampFocusDriftChartY(value: number): number {
  return Math.min(Math.max(value, FOCUS_DRIFT_CHART_BOUNDS.top), FOCUS_DRIFT_CHART_BOUNDS.bottom);
}

export function buildSmoothPath(points: readonly FocusDriftPoint[], yKey: "focusY" | "driftY"): string {
  if (points.length === 0) return "";

  const pathPoints = points.map((point) => ({
    x: clampFocusDriftChartX(point.x),
    y: clampFocusDriftChartY(point[yKey]),
  }));
  const firstPoint = pathPoints[0];
  if (!firstPoint) return "";
  if (pathPoints.length === 1) return `M ${firstPoint.x} ${firstPoint.y}`;

  const basisPoints = padBasisSplineEndpoints(pathPoints);
  const pathParts = [`M ${firstPoint.x} ${firstPoint.y}`];

  for (let index = 0; index <= basisPoints.length - 4; index += 1) {
    const basisWindow = basisWindowAt(basisPoints, index);
    if (!basisWindow) continue;

    const segment = basisBezierSegment(basisWindow);
    pathParts.push(`C ${segment.controlStart.x} ${segment.controlStart.y}, ${segment.controlEnd.x} ${segment.controlEnd.y}, ${segment.end.x} ${segment.end.y}`);
  }

  return pathParts.join(" ");
}

function padBasisSplineEndpoints(points: readonly FocusDriftPathPoint[]): readonly FocusDriftPathPoint[] {
  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  if (!firstPoint || !lastPoint) return [];
  return [firstPoint, firstPoint, firstPoint, ...points.slice(1, -1), lastPoint, lastPoint, lastPoint];
}

function basisWindowAt(points: readonly FocusDriftPathPoint[], index: number): FocusDriftBasisWindow | null {
  const p0 = points[index];
  const p1 = points[index + 1];
  const p2 = points[index + 2];
  const p3 = points[index + 3];
  if (!p0 || !p1 || !p2 || !p3) return null;
  return { p0, p1, p2, p3 };
}

function basisBezierSegment({ p1, p2, p3 }: FocusDriftBasisWindow): FocusDriftBezierSegment {
  return {
    controlStart: basisPoint({ p0: p1, p1: p1, p2 }),
    controlEnd: basisPoint({ p0: p1, p1: p2, p2 }),
    end: basisPoint({ p0: p1, p1: p2, p2: p3 }),
  };
}

function basisPoint({ p0, p1, p2 }: Omit<FocusDriftBasisWindow, "p3">): FocusDriftPathPoint {
  return {
    x: (p0.x + 4 * p1.x + p2.x) / 6,
    y: (p0.y + 4 * p1.y + p2.y) / 6,
  };
}
