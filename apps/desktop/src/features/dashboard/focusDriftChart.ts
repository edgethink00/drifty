import { categorizeActivity, logicalDayStartMs, logicalMinuteOfDay } from "@drifty/domain";
import type { ActivitySegment, ClassificationOptions, ProductivityDuration } from "@drifty/domain";
import { getInsightSurfaceIdentity } from "../insights/insightData";
import type { DriftSurfaceAccumulator } from "../insights/insightData";
import { formatQuarterHourLabel } from "../../lib/formatting";
import type { CSSProperties } from "react";
import {
  FOCUS_DRIFT_BUCKET_COUNT,
  FOCUS_DRIFT_BUCKET_MINUTES,
  FOCUS_DRIFT_CHART_BOUNDS,
  FOCUS_DRIFT_CLIP_BOUNDS,
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
};

export const FOCUS_DRIFT_AXIS_TICKS: FocusDriftAxisTick[] = Array.from({ length: 9 }, (_, index) => {
  const hour = index * 3;
  const chartWidth = FOCUS_DRIFT_CHART_BOUNDS.right - FOCUS_DRIFT_CHART_BOUNDS.left;
  return {
    id: `focus-drift-axis-${hour}`,
    label: `${hour.toString().padStart(2, "0")}:00`,
    x: FOCUS_DRIFT_CHART_BOUNDS.left + (hour / 24) * chartWidth,
  };
});

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
  const currentTimeLabel = boundedCurrentMinute === null ? null : formatQuarterHourLabel(boundedCurrentMinute);
  const isLive = currentX !== null && currentBucketStartMinute !== null;

  for (const segment of segments) {
    const productivity = categorizeActivity(segment, classificationOptions);
    if (productivity !== "focus" && productivity !== "drift") continue;

    const sourceIdentity = getInsightSurfaceIdentity(segment);
    const segmentStartMs = new Date(segment.startedAt).getTime();
    const segmentEndMs = new Date(segment.endedAt).getTime();

    for (const bucket of buckets) {
      const bucketStartMs = dayStartMs + bucket.bucketStartMinute * 60 * 1000;
      const bucketEndMs = bucketStartMs + FOCUS_DRIFT_BUCKET_MINUTES * 60 * 1000;
      const overlapSeconds = Math.max(0, Math.round((Math.min(segmentEndMs, bucketEndMs) - Math.max(segmentStartMs, bucketStartMs)) / 1000));
      if (overlapSeconds <= 0) continue;

      if (productivity === "focus") {
        bucket.focusSeconds += overlapSeconds;
        bucket.focusCaptures += 1;
        addFocusDriftSourceOverlap(bucket.focusSources, sourceIdentity, overlapSeconds);
      } else {
        bucket.driftSeconds += overlapSeconds;
        bucket.driftCaptures += 1;
        addFocusDriftSourceOverlap(bucket.driftSources, sourceIdentity, overlapSeconds);
      }
    }
  }

  const points = buckets.map((entry) => {
    const totalSeconds = entry.focusSeconds + entry.driftSeconds;
    const focusScore = totalSeconds > 0 ? (entry.focusSeconds / totalSeconds) * 100 : 0;
    const driftScore = totalSeconds > 0 ? (entry.driftSeconds / totalSeconds) * 100 : 0;
    const isFuture = currentBucketStartMinute !== null ? entry.bucketStartMinute > currentBucketStartMinute : false;
    const x = currentBucketStartMinute !== null && currentX !== null && entry.bucketStartMinute === currentBucketStartMinute
      ? currentX
      : FOCUS_DRIFT_CHART_BOUNDS.left + ((entry.bucketStartMinute + FOCUS_DRIFT_BUCKET_MINUTES / 2) / FOCUS_DRIFT_MINUTES_PER_DAY) * chartWidth;

    return {
      id: `${day}-${entry.bucketStartMinute}`,
      day,
      label: formatFocusDriftBucketLabel(entry.bucketStartMinute),
      unit: "window" as const,
      bucketStartMinute: entry.bucketStartMinute,
      isFuture,
      focusSeconds: entry.focusSeconds,
      driftSeconds: entry.driftSeconds,
      focusCaptures: entry.focusCaptures,
      driftCaptures: entry.driftCaptures,
      totalSeconds,
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
  const totalFocus = points.reduce((sum, point) => sum + point.focusSeconds, 0);
  const totalAll = points.reduce((sum, point) => sum + point.totalSeconds, 0);

  return {
    points,
    focusPath,
    driftPath,
    focusAreaPath,
    peakFocusPoint,
    peakDriftPoint,
    focusConsistency: totalAll > 0 ? Math.round((totalFocus / totalAll) * 100) : 0,
    hasData: activePoints.length > 0,
    isLive,
    currentX,
    currentTimeLabel,
  };
}

export function formatFocusDriftBucketLabel(bucketStartMinute: number): string {
  const hour = Math.floor(bucketStartMinute / 60);
  const minute = bucketStartMinute % 60;
  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
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
