export type FocusDriftPathPoint = {
  readonly x: number;
  readonly y: number;
};

export type FocusDriftSplinePoint = {
  readonly x: number;
  readonly focusY: number;
  readonly driftY: number;
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

export const FOCUS_DRIFT_CHART_BOUNDS = { left: 4.5, right: 95.5, top: 8, bottom: 92 } as const;

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

export function buildSmoothPath(points: readonly FocusDriftSplinePoint[], yKey: "focusY" | "driftY"): string {
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

/** Returns the exact point on the cubic spline that buildSmoothPath renders
 *  at x. Interior source points are smoothing controls, not necessarily points
 *  on the visible curve, so hover markers must use this instead of a raw
 *  FocusDriftPoint y coordinate. */
export function getSmoothPathPointAtX(
  points: readonly FocusDriftSplinePoint[],
  yKey: "focusY" | "driftY",
  x: number,
): FocusDriftPathPoint | null {
  const pathPoints = points.map((point) => ({
    x: clampFocusDriftChartX(point.x),
    y: clampFocusDriftChartY(point[yKey]),
  }));
  const firstPoint = pathPoints[0];
  const lastPoint = pathPoints[pathPoints.length - 1];
  if (!firstPoint || !lastPoint) return null;
  if (pathPoints.length === 1) return firstPoint;

  const targetX = Math.min(Math.max(x, firstPoint.x), lastPoint.x);
  const basisPoints = padBasisSplineEndpoints(pathPoints);
  let segmentStart = firstPoint;

  for (let index = 0; index <= basisPoints.length - 4; index += 1) {
    const basisWindow = basisWindowAt(basisPoints, index);
    if (!basisWindow) continue;
    const segment = basisBezierSegment(basisWindow);
    const isLastSegment = index === basisPoints.length - 4;

    if (targetX <= segment.end.x || isLastSegment) {
      const t = solveCubicBezierTForX(segmentStart, segment, targetX);
      return cubicBezierPointAt(segmentStart, segment, t);
    }

    segmentStart = segment.end;
  }

  return lastPoint;
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
    controlStart: basisControlPoint(p1, p2),
    controlEnd: basisControlPoint(p2, p1),
    end: basisPoint({ p0: p1, p1: p2, p2: p3 }),
  };
}

function basisControlPoint(near: FocusDriftPathPoint, far: FocusDriftPathPoint): FocusDriftPathPoint {
  return {
    x: (2 * near.x + far.x) / 3,
    y: (2 * near.y + far.y) / 3,
  };
}

function solveCubicBezierTForX(
  start: FocusDriftPathPoint,
  segment: FocusDriftBezierSegment,
  targetX: number,
): number {
  let lower = 0;
  let upper = 1;

  for (let iteration = 0; iteration < 24; iteration += 1) {
    const midpoint = (lower + upper) / 2;
    if (cubicBezierPointAt(start, segment, midpoint).x < targetX) {
      lower = midpoint;
    } else {
      upper = midpoint;
    }
  }

  return (lower + upper) / 2;
}

function cubicBezierPointAt(
  start: FocusDriftPathPoint,
  segment: FocusDriftBezierSegment,
  t: number,
): FocusDriftPathPoint {
  const inverseT = 1 - t;
  return {
    x: inverseT ** 3 * start.x
      + 3 * inverseT ** 2 * t * segment.controlStart.x
      + 3 * inverseT * t ** 2 * segment.controlEnd.x
      + t ** 3 * segment.end.x,
    y: inverseT ** 3 * start.y
      + 3 * inverseT ** 2 * t * segment.controlStart.y
      + 3 * inverseT * t ** 2 * segment.controlEnd.y
      + t ** 3 * segment.end.y,
  };
}

function basisPoint({ p0, p1, p2 }: Omit<FocusDriftBasisWindow, "p3">): FocusDriftPathPoint {
  return {
    x: (p0.x + 4 * p1.x + p2.x) / 6,
    y: (p0.y + 4 * p1.y + p2.y) / 6,
  };
}
