import type { FocusDriftPoint } from "./focusDriftChart";

type FocusDriftPathPoint = {
  readonly x: number;
  readonly y: number;
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

  const tangents = buildMonotoneTangents(pathPoints);
  const pathParts = [`M ${firstPoint.x} ${firstPoint.y}`];

  for (let index = 1; index < pathPoints.length; index += 1) {
    const previousPoint = pathPoints[index - 1];
    const currentPoint = pathPoints[index];
    const previousTangent = tangents[index - 1];
    const currentTangent = tangents[index];
    if (
      previousPoint === undefined
      || currentPoint === undefined
      || previousTangent === undefined
      || currentTangent === undefined
    ) {
      continue;
    }

    const deltaX = currentPoint.x - previousPoint.x;
    const controlStartX = clampFocusDriftChartX(previousPoint.x + deltaX / 3);
    const controlStartY = clampFocusDriftChartY(previousPoint.y + (previousTangent * deltaX) / 3);
    const controlEndX = clampFocusDriftChartX(currentPoint.x - deltaX / 3);
    const controlEndY = clampFocusDriftChartY(currentPoint.y - (currentTangent * deltaX) / 3);

    pathParts.push(`C ${controlStartX} ${controlStartY}, ${controlEndX} ${controlEndY}, ${currentPoint.x} ${currentPoint.y}`);
  }

  return pathParts.join(" ");
}

function buildMonotoneTangents(points: readonly FocusDriftPathPoint[]): readonly number[] {
  const slopes = buildSlopes(points);
  const tangents = points.map((point, index) => initialTangentAt(points, slopes, point, index));

  for (let index = 0; index < slopes.length; index += 1) {
    const slope = slopes[index];
    const leftTangent = tangents[index];
    const rightTangent = tangents[index + 1];
    if (slope === undefined || leftTangent === undefined || rightTangent === undefined) continue;

    if (isFlatSlope(slope)) {
      tangents[index] = 0;
      tangents[index + 1] = 0;
      continue;
    }

    const leftRatio = leftTangent / slope;
    const rightRatio = rightTangent / slope;
    const magnitude = leftRatio * leftRatio + rightRatio * rightRatio;
    if (magnitude <= 9) continue;

    const scale = 3 / Math.sqrt(magnitude);
    tangents[index] = scale * leftRatio * slope;
    tangents[index + 1] = scale * rightRatio * slope;
  }

  return tangents;
}

function buildSlopes(points: readonly FocusDriftPathPoint[]): readonly number[] {
  const slopes: number[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const previousPoint = points[index - 1];
    const currentPoint = points[index];
    if (previousPoint === undefined || currentPoint === undefined) continue;

    const deltaX = currentPoint.x - previousPoint.x;
    slopes.push(deltaX === 0 ? 0 : (currentPoint.y - previousPoint.y) / deltaX);
  }
  return slopes;
}

function initialTangentAt(
  points: readonly FocusDriftPathPoint[],
  slopes: readonly number[],
  point: FocusDriftPathPoint,
  index: number,
): number {
  if (hasBoundaryPlateau(points, point, index)) return 0;

  const leftSlope = slopes[index - 1];
  const rightSlope = slopes[index];
  if (leftSlope === undefined) return rightSlope ?? 0;
  if (rightSlope === undefined) return leftSlope;
  if (isFlatSlope(leftSlope) || isFlatSlope(rightSlope)) return 0;
  if (Math.sign(leftSlope) !== Math.sign(rightSlope)) return 0;
  return (leftSlope + rightSlope) / 2;
}

function hasBoundaryPlateau(points: readonly FocusDriftPathPoint[], point: FocusDriftPathPoint, index: number): boolean {
  if (!isChartBoundaryY(point.y)) return false;
  return points[index - 1]?.y === point.y || points[index + 1]?.y === point.y;
}

function isChartBoundaryY(value: number): boolean {
  return value === FOCUS_DRIFT_CHART_BOUNDS.top || value === FOCUS_DRIFT_CHART_BOUNDS.bottom;
}

function isFlatSlope(value: number): boolean {
  return Math.abs(value) <= Number.EPSILON;
}
