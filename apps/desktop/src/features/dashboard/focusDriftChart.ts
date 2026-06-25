import { categorizeActivity, logicalDayStartMs, logicalMinuteOfDay, normalizeStartOfDayMinutes } from "@drifty/domain";
import type { ActivitySegment, ClassificationOptions, ProductivityDuration } from "@drifty/domain";
import { getInsightSurfaceIdentity } from "../insights/insightData";
import type { DriftSurfaceAccumulator } from "../insights/insightData";
import { formatQuarterHourLabel } from "../../lib/formatting";
import type { CSSProperties } from "react";
import { scoreFocusDriftWindowShare } from "./focusDriftScoring";
import {
  FOCUS_DRIFT_BUCKET_COUNT,
  FOCUS_DRIFT_BUCKET_MINUTES,
  FOCUS_DRIFT_CHART_BOUNDS,
  FOCUS_DRIFT_MINUTES_PER_DAY,
  buildSmoothPath,
  scaleFocusDriftY,
} from "./focusDriftGeometry";

export {
  FOCUS_DRIFT_BUCKET_COUNT,
  FOCUS_DRIFT_BUCKET_MINUTES,
  FOCUS_DRIFT_CHART_BOUNDS,
  FOCUS_DRIFT_CLIP_BOUNDS,
  FOCUS_DRIFT_CLIP_PADDING,
  FOCUS_DRIFT_MINUTES_PER_DAY,
  buildSmoothPath,
  clampFocusDriftChartX,
  clampFocusDriftChartY,
  scaleFocusDriftY,
} from "./focusDriftGeometry";

export type FocusDriftPoint = {
  id: string;
  day: string;
  label: string;
  unit: "window";
  bucketStartMinute: number;
  isFuture: boolean;
  focusSeconds: number;
  driftSeconds: number;
  focusCaptures: number;
  driftCaptures: number;
  totalSeconds: number;
  trackedSeconds: number;
  windowSeconds: number;
  focusScore: number;
  driftScore: number;
  topFocusSource: FocusDriftSourceSummary | null;
  topDriftSource: FocusDriftSourceSummary | null;
  x: number;
  focusY: number;
  driftY: number;
};

export type FocusDriftSourceSummary = {
  id: string;
  label: string;
  detail: string;
  appName: string;
  bundleId: string | null;
  siteDomain: string | null;
  seconds: number;
  captures: number;
};

export type FocusDriftSourceAccumulator = FocusDriftSourceSummary;

export type FocusDriftAxisTick = {
  id: string;
  label: string;
  x: number;
};

export type FocusDriftAxisTickStyle = CSSProperties & {
  "--focus-drift-axis-x": string;
};

export type FocusDriftLiveStyle = CSSProperties & {
  "--focus-drift-now-x": string;
};

export type FocusDriftChart = {
  points: FocusDriftPoint[];
  focusPath: string;
  driftPath: string;
  focusAreaPath: string;
  peakFocusPoint: FocusDriftPoint | null;
  peakDriftPoint: FocusDriftPoint | null;
  focusConsistency: number;
  hasData: boolean;
  isLive: boolean;
  currentX: number | null;
  currentTimeLabel: string | null;
  axisTicks: FocusDriftAxisTick[];
};

export function buildFocusDriftAxisTicks(startOfDayMinutes = 0): FocusDriftAxisTick[] {
  const chartWidth = FOCUS_DRIFT_CHART_BOUNDS.right - FOCUS_DRIFT_CHART_BOUNDS.left;
  return Array.from({ length: 9 }, (_, index) => {
    const logicalMinute = index * 3 * 60;
    return {
      id: `focus-drift-axis-${logicalMinute}`,
      label: formatFocusDriftBucketLabel(logicalMinute, startOfDayMinutes),
      x: FOCUS_DRIFT_CHART_BOUNDS.left + (logicalMinute / FOCUS_DRIFT_MINUTES_PER_DAY) * chartWidth,
    };
  });
}

export const FOCUS_DRIFT_AXIS_TICKS: FocusDriftAxisTick[] = buildFocusDriftAxisTicks();

export const FOCUS_DRIFT_Y_AXIS_TICKS = [
  { label: "100%", y: scaleFocusDriftY(100) },
  { label: "50%", y: scaleFocusDriftY(50) },
  { label: "0%", y: scaleFocusDriftY(0) },
] as const;

export const FOCUS_DRIFT_GRID_PATH = FOCUS_DRIFT_Y_AXIS_TICKS.map((tick) => `M${FOCUS_DRIFT_CHART_BOUNDS.left} ${tick.y}H${FOCUS_DRIFT_CHART_BOUNDS.right}`).join(" ");

export function buildFocusDriftChart(segments: ActivitySegment[], day: string, classificationOptions?: ClassificationOptions, currentMinuteOfDay?: number | null, startOfDayMinutes = 0): FocusDriftChart {
  return buildWindowedFocusDriftChart(segments, day, classificationOptions, currentMinuteOfDay, startOfDayMinutes);
}

export function buildProductivityQualityPercent(productivityTotals: ProductivityDuration[]): number {
  const totalSeconds = productivityTotals.reduce((total, entry) => total + entry.totalSeconds, 0);
  const focusSeconds = productivityTotals.find((entry) => entry.productivity === "focus")?.totalSeconds ?? 0;
  return totalSeconds > 0 ? Math.round((focusSeconds / totalSeconds) * 100) : 0;
}

export function buildWindowedFocusDriftChart(segments: ActivitySegment[], day: string, classificationOptions?: ClassificationOptions, currentMinuteOfDay?: number | null, startOfDayMinutes = 0): FocusDriftChart {
  const dayStartMs = logicalDayStartMs(day, startOfDayMinutes);
  const buckets = Array.from({ length: FOCUS_DRIFT_BUCKET_COUNT }, (_, index) => ({
    focusSeconds: 0,
    driftSeconds: 0,
    trackedSeconds: 0,
    focusCaptures: 0,
    driftCaptures: 0,
    focusSources: new Map<string, FocusDriftSourceAccumulator>(),
    driftSources: new Map<string, FocusDriftSourceAccumulator>(),
    bucketStartMinute: index * FOCUS_DRIFT_BUCKET_MINUTES,
  }));
  const boundedCurrentMinute = currentMinuteOfDay === null || currentMinuteOfDay === undefined
    ? null
    : Math.min(Math.max(Math.floor(logicalMinuteOfDay(currentMinuteOfDay, startOfDayMinutes)), 0), FOCUS_DRIFT_MINUTES_PER_DAY - 1);
  const currentBucketStartMinute = boundedCurrentMinute === null
    ? null
    : Math.floor(boundedCurrentMinute / FOCUS_DRIFT_BUCKET_MINUTES) * FOCUS_DRIFT_BUCKET_MINUTES;
  const chartWidth = FOCUS_DRIFT_CHART_BOUNDS.right - FOCUS_DRIFT_CHART_BOUNDS.left;
  const currentX = boundedCurrentMinute === null ? null : FOCUS_DRIFT_CHART_BOUNDS.left + (boundedCurrentMinute / FOCUS_DRIFT_MINUTES_PER_DAY) * chartWidth;
  const currentTimeLabel = boundedCurrentMinute === null ? null : formatQuarterHourLabel(clockMinuteForLogicalMinute(boundedCurrentMinute, startOfDayMinutes));
  const isLive = currentX !== null && currentBucketStartMinute !== null;

  for (const segment of segments) {
    const productivity = categorizeActivity(segment, classificationOptions);
    const sourceIdentity = productivity === "focus" || productivity === "drift" ? getInsightSurfaceIdentity(segment) : null;
    const segmentStartMs = new Date(segment.startedAt).getTime();
    const segmentEndMs = new Date(segment.endedAt).getTime();

    for (const bucket of buckets) {
      const bucketStartMs = dayStartMs + bucket.bucketStartMinute * 60 * 1000;
      const bucketEndMs = bucketStartMs + FOCUS_DRIFT_BUCKET_MINUTES * 60 * 1000;
      const overlapSeconds = Math.max(0, Math.round((Math.min(segmentEndMs, bucketEndMs) - Math.max(segmentStartMs, bucketStartMs)) / 1000));
      if (overlapSeconds <= 0) continue;

      bucket.trackedSeconds += overlapSeconds;
      if (productivity === "focus" && sourceIdentity) {
        bucket.focusSeconds += overlapSeconds;
        bucket.focusCaptures += 1;
        addFocusDriftSourceOverlap(bucket.focusSources, sourceIdentity, overlapSeconds);
      } else if (productivity === "drift" && sourceIdentity) {
        bucket.driftSeconds += overlapSeconds;
        bucket.driftCaptures += 1;
        addFocusDriftSourceOverlap(bucket.driftSources, sourceIdentity, overlapSeconds);
      }
    }
  }

  const points = buckets.map((entry) => {
    const totalSeconds = entry.focusSeconds + entry.driftSeconds;
    const windowSeconds = FOCUS_DRIFT_BUCKET_MINUTES * 60;
    const focusScore = scoreFocusDriftWindowShare(entry.focusSeconds, totalSeconds, windowSeconds);
    const driftScore = scoreFocusDriftWindowShare(entry.driftSeconds, totalSeconds, windowSeconds);
    const isFuture = currentBucketStartMinute !== null ? entry.bucketStartMinute > currentBucketStartMinute : false;
    const x = currentBucketStartMinute !== null && currentX !== null && entry.bucketStartMinute === currentBucketStartMinute
      ? currentX
      : FOCUS_DRIFT_CHART_BOUNDS.left + ((entry.bucketStartMinute + FOCUS_DRIFT_BUCKET_MINUTES / 2) / FOCUS_DRIFT_MINUTES_PER_DAY) * chartWidth;

    return {
      id: `${day}-${entry.bucketStartMinute}`,
      day,
      label: formatFocusDriftBucketLabel(entry.bucketStartMinute, startOfDayMinutes),
      unit: "window" as const,
      bucketStartMinute: entry.bucketStartMinute,
      isFuture,
      focusSeconds: entry.focusSeconds,
      driftSeconds: entry.driftSeconds,
      focusCaptures: entry.focusCaptures,
      driftCaptures: entry.driftCaptures,
      totalSeconds,
      trackedSeconds: entry.trackedSeconds,
      windowSeconds,
      focusScore,
      driftScore,
      topFocusSource: getTopFocusDriftSource(entry.focusSources),
      topDriftSource: getTopFocusDriftSource(entry.driftSources),
      x,
      focusY: scaleFocusDriftY(focusScore),
      driftY: scaleFocusDriftY(driftScore),
    };
  });

  const measuredPoints = isLive ? points.filter((point) => !point.isFuture) : points;
  const activePoints = measuredPoints.filter((point) => point.totalSeconds > 0);
  const focusPath = buildSmoothPath(measuredPoints, "focusY");
  const driftPath = buildSmoothPath(measuredPoints, "driftY");
  const first = measuredPoints[0], last = measuredPoints[measuredPoints.length - 1];
  const focusAreaPath = first && last && focusPath ? `M ${first.x} ${FOCUS_DRIFT_CHART_BOUNDS.bottom} L ${focusPath.slice(2)} L ${last.x} ${FOCUS_DRIFT_CHART_BOUNDS.bottom} Z` : "";
  const peakFocusPoint = activePoints.reduce<FocusDriftPoint | null>((current, point) => (!current || point.focusScore > current.focusScore ? point : current), null);
  const peakDriftPoint = activePoints.reduce<FocusDriftPoint | null>((current, point) => (!current || point.driftScore > current.driftScore ? point : current), null);

  return {
    points,
    focusPath,
    driftPath,
    focusAreaPath,
    peakFocusPoint,
    peakDriftPoint,
    focusConsistency: buildAverageFocusScore(activePoints),
    hasData: activePoints.length > 0,
    isLive,
    currentX,
    currentTimeLabel,
    axisTicks: buildFocusDriftAxisTicks(startOfDayMinutes),
  };
}

function buildAverageFocusScore(points: readonly FocusDriftPoint[]): number {
  if (points.length === 0) return 0;
  return Math.round(points.reduce((total, point) => total + point.focusScore, 0) / points.length);
}

export function formatFocusDriftBucketLabel(bucketStartMinute: number, startOfDayMinutes = 0): string {
  const clockMinute = clockMinuteForLogicalMinute(bucketStartMinute, startOfDayMinutes);
  const hour = Math.floor(clockMinute / 60);
  const minute = clockMinute % 60;
  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

function clockMinuteForLogicalMinute(logicalMinute: number, startOfDayMinutes: number): number {
  const boundaryMinutes = normalizeStartOfDayMinutes(startOfDayMinutes);
  const roundedMinute = Math.round(logicalMinute);
  if (boundaryMinutes === 0 && roundedMinute === FOCUS_DRIFT_MINUTES_PER_DAY) return FOCUS_DRIFT_MINUTES_PER_DAY;
  return ((roundedMinute + boundaryMinutes) % FOCUS_DRIFT_MINUTES_PER_DAY + FOCUS_DRIFT_MINUTES_PER_DAY) % FOCUS_DRIFT_MINUTES_PER_DAY;
}

export function addFocusDriftSourceOverlap(
  sources: Map<string, FocusDriftSourceAccumulator>,
  identity: Omit<DriftSurfaceAccumulator, "seconds" | "captures" | "activeDays">,
  overlapSeconds: number,
) {
  const current = sources.get(identity.id) ?? { ...identity, seconds: 0, captures: 0 };
  current.seconds += overlapSeconds;
  current.captures += 1;
  sources.set(identity.id, current);
}

export function getTopFocusDriftSource(sources: Map<string, FocusDriftSourceAccumulator>): FocusDriftSourceSummary | null {
  return Array.from(sources.values()).sort((left, right) => {
    if (right.seconds !== left.seconds) return right.seconds - left.seconds;
    if (right.captures !== left.captures) return right.captures - left.captures;
    return left.label.localeCompare(right.label);
  })[0] ?? null;
}
