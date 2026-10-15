import { appUsageSummaryGroupKey, buildAppUsageSummaries, categorizeActivity, classifyActivity } from "@drifty/domain";
import type { ActivityCategory, ActivitySegment, ClassificationOptions, ProductivityLabel } from "@drifty/domain";
import { CATEGORY_COLORS, FLOW_BREAKDOWN_PRODUCTIVITY_ORDER, PRODUCTIVITY_COLORS, categoryLabel, productivityLabel } from "../../lib/activityLabels";
import { formatCompactDurationFromSeconds, formatDuration, getLocalDaysBetween, localDateKey, weekdayOrderIndex } from "../../lib/formatting";
import type { WeeklyChartMode } from "./weeklyChartView";

export { buildWeeklyChartView, chooseChartStepHours, formatChartHourLabel } from "./weeklyChartView";
export type { WeeklyChartColumn, WeeklyChartMode, WeeklyChartProjectSeriesItem, WeeklyChartSegment, WeeklyChartView } from "./weeklyChartView";

export type ProductivityAnalysisKind = Extract<ProductivityLabel, "focus" | "drift">;

export { buildAttentionRhythm } from "./attentionRhythm";
export type { AttentionRhythmCell, AttentionRhythmState } from "./attentionRhythm";

export type ProductivitySurfaceInsight = {
  id: string;
  label: string;
  detail: string;
  appName: string;
  bundleId: string | null;
  siteDomain: string | null;
  seconds: number;
  captures: number;
  activeDays: number;
  share: number;
};

export type DriftPatternTone = "warn" | "focus" | "neutral";

export type DriftPatternCard = {
  id: string;
  label: string;
  value: string;
  detail: string;
  tone: DriftPatternTone;
};

export type ProductivityInsightReport = {
  totalSeconds: number;
  trackedDays: number;
  startedWithProductivityDays: number;
  topSurfaces: ProductivitySurfaceInsight[];
  patternCards: DriftPatternCard[];
};

export const WEEKLY_BREAKDOWN_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export interface WeeklyBreakdownDay {
  weekdayIndex: number;
  weekday: string;
  isActive: boolean;
  focusSeconds: number;
  neutralSeconds: number;
  driftSeconds: number;
  categorySeconds: Partial<Record<ActivityCategory, number>>;
  /** Seconds per project id (averaged by occurrences like categorySeconds). Empty when no project map supplied. */
  projectSeconds: Partial<Record<string, number>>;
}

export type InsightWeekVisibility = {
  readonly startDay?: string;
  readonly visibleThroughDay?: string;
};

function weekdayIndexForDay(day?: string): number | null {
  if (!day) return null;
  const date = new Date(`${day}T12:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return weekdayOrderIndex(date);
}

function orderedWeekdayIndexes(startDay?: string): readonly number[] {
  const startIndex = weekdayIndexForDay(startDay) ?? 0;
  return Array.from({ length: WEEKLY_BREAKDOWN_WEEKDAYS.length }, (_, offset) => (startIndex + offset) % WEEKLY_BREAKDOWN_WEEKDAYS.length);
}

function hiddenWeekdayIndexes(visibility?: InsightWeekVisibility): ReadonlySet<number> {
  if (weekdayIndexForDay(visibility?.startDay) !== null) return new Set<number>();
  if (!visibility?.visibleThroughDay) return new Set<number>();
  const visibleThroughDate = new Date(`${visibility.visibleThroughDay}T12:00:00`);
  if (Number.isNaN(visibleThroughDate.getTime())) return new Set<number>();

  const visibleThroughIndex = weekdayOrderIndex(visibleThroughDate);
  const hidden = new Set<number>();
  for (let index = visibleThroughIndex + 1; index < WEEKLY_BREAKDOWN_WEEKDAYS.length; index += 1) {
    hidden.add(index);
  }
  return hidden;
}

/** Stacked-bar key for classified time not assigned to any project. Its label
 *  comes from the display language (projects.chart.noProject) where it is shown. */
export const NO_PROJECT_KEY = "__no_project__";

export function buildWeeklyBreakdown(
  segments: ActivitySegment[],
  options?: ClassificationOptions,
  visibility?: InsightWeekVisibility,
  projectBySegmentId?: ReadonlyMap<string, string>,
  projectSegments?: readonly ActivitySegment[],
): WeeklyBreakdownDay[] {
  const focus = Array.from({ length: 7 }, () => 0);
  const neutral = Array.from({ length: 7 }, () => 0);
  const drift = Array.from({ length: 7 }, () => 0);
  const categories = Array.from({ length: 7 }, () => new Map<ActivityCategory, number>());
  const projects = Array.from({ length: 7 }, () => new Map<string, number>());
  const dates = Array.from({ length: 7 }, () => new Set<string>());
  const hidden = hiddenWeekdayIndexes(visibility);
  const weekdayIndexes = orderedWeekdayIndexes(visibility?.startDay);

  for (const segment of segments) {
    const started = new Date(segment.startedAt);
    if (Number.isNaN(started.getTime())) continue;
    const index = weekdayOrderIndex(started);
    if (hidden.has(index)) continue;
    const seconds = segment.durationSeconds;
    const { category, productivity } = classifyActivity(segment, options);
    if (productivity === "focus") focus[index] += seconds;
    else if (productivity === "drift") drift[index] += seconds;
    else if (category !== "unknown") neutral[index] += seconds;
    categories[index].set(category, (categories[index].get(category) ?? 0) + seconds);
    dates[index].add(localDateKey(started));
  }

  if (projectBySegmentId) {
    for (const segment of projectSegments ?? segments) {
      const started = new Date(segment.startedAt);
      if (Number.isNaN(started.getTime())) continue;
      const index = weekdayOrderIndex(started);
      if (hidden.has(index)) continue;
      const seconds = segment.durationSeconds;
      const { category } = classifyActivity(segment, options);
      const projectId = projectBySegmentId.get(segment.id);
      if (projectId) {
        projects[index].set(projectId, (projects[index].get(projectId) ?? 0) + seconds);
      } else if (category !== "unknown") {
        // Classified time with no project → the shared "No project" bucket, so the
        // Project lens totals match Category/Productivity (all classified time).
        projects[index].set(NO_PROJECT_KEY, (projects[index].get(NO_PROJECT_KEY) ?? 0) + seconds);
      }
    }
  }

  return weekdayIndexes.map((index) => {
    const occurrences = Math.max(dates[index].size, 1);
    const categorySeconds: Partial<Record<ActivityCategory, number>> = {};
    for (const [category, seconds] of categories[index]) categorySeconds[category] = seconds / occurrences;
    const projectSeconds: Partial<Record<string, number>> = {};
    for (const [projectId, seconds] of projects[index]) projectSeconds[projectId] = seconds / occurrences;
    return {
      weekdayIndex: index,
      weekday: WEEKLY_BREAKDOWN_WEEKDAYS[index] ?? "",
      isActive: dates[index].size > 0,
      focusSeconds: focus[index] / occurrences,
      neutralSeconds: neutral[index] / occurrences,
      driftSeconds: drift[index] / occurrences,
      categorySeconds,
      projectSeconds,
    };
  });
}

export type InsightSourceValueKind = "duration" | "count";

export interface InsightSourceItem {
  id: string;
  /**
   * Which records the item counts. Duration items use the app usage group key;
   * transition items use the surface identity of the switch's focus or drift side.
   */
  groupKey: string;
  label: string;
  seconds: number;
  count: number;
  valueKind: InsightSourceValueKind;
  appName: string;
  bundleId: string | null;
  siteDomain: string | null;
  isSite: boolean;
}

export interface InsightSourceLists {
  topics: InsightSourceItem[];
  apps: InsightSourceItem[];
}

export function buildInsightSourceLists(
  segments: ActivitySegment[],
  productivity: ProductivityLabel,
  options?: ClassificationOptions,
): InsightSourceLists {
  const filtered = segments.filter((segment) => classifyActivity(segment, options).productivity === productivity);
  const toItem = (summary: ReturnType<typeof buildAppUsageSummaries>[number]): InsightSourceItem => ({
    id: `${summary.usageKind}:${summary.siteDomain ?? summary.appName}`,
    groupKey: appUsageSummaryGroupKey(summary),
    label: summary.usageKind === "site" ? (summary.siteDomain ?? summary.appName) : summary.appName,
    seconds: summary.totalSeconds,
    count: summary.sessionCount,
    valueKind: "duration",
    appName: summary.usageKind === "site" ? (summary.siteDomain ?? summary.appName) : summary.appName,
    bundleId: summary.bundleId,
    siteDomain: summary.siteDomain,
    isSite: summary.usageKind === "site",
  });
  return {
    topics: buildFocusDriftTransitionItems(segments, productivity, options),
    apps: buildAppUsageSummaries(filtered, { groupBy: "activity" }).map(toItem),
  };
}

const DRIFT_RUN_MAX_GAP_SECONDS = 5 * 60;

export type FocusDriftTransition = {
  readonly focus: ActivitySegment;
  readonly drift: ActivitySegment;
};

/**
 * Each place where a focus record is directly followed by a drift record, in
 * time order. "Drift after focus" counts the drift side of these switches and
 * "Focus before drift" the focus side.
 */
export function listFocusDriftTransitions(
  segments: readonly ActivitySegment[],
  options?: ClassificationOptions,
): FocusDriftTransition[] {
  const transitions: FocusDriftTransition[] = [];
  const sortedSegments = segments.slice().sort((left, right) => new Date(left.startedAt).getTime() - new Date(right.startedAt).getTime());
  for (let index = 0; index < sortedSegments.length - 1; index += 1) {
    const focus = sortedSegments[index];
    const drift = sortedSegments[index + 1];
    if (classifyActivity(focus, options).productivity !== "focus") continue;
    if (classifyActivity(drift, options).productivity !== "drift") continue;
    transitions.push({ focus, drift });
  }
  return transitions;
}

export function buildFocusDriftTransitionItems(
  segments: ActivitySegment[],
  productivity: ProductivityLabel,
  options?: ClassificationOptions,
): InsightSourceItem[] {
  const accumulator = new Map<string, InsightSourceItem>();

  for (const transition of listFocusDriftTransitions(segments, options)) {
    const segment = productivity === "drift" ? transition.drift : transition.focus;
    const identity = getInsightSurfaceIdentity(segment);
    const current = accumulator.get(identity.id) ?? {
      id: identity.id,
      groupKey: identity.id,
      label: identity.label,
      seconds: 0,
      count: 0,
      valueKind: "count",
      appName: identity.label,
      bundleId: identity.bundleId,
      siteDomain: identity.siteDomain,
      isSite: identity.siteDomain !== null,
    };
    current.seconds += segment.durationSeconds;
    current.count += 1;
    accumulator.set(identity.id, current);
  }

  return Array.from(accumulator.values())
    .sort((left, right) => {
      const countDelta = right.count - left.count;
      if (countDelta !== 0) return countDelta;
      return right.seconds - left.seconds;
    });
}

export function insightSourceValue(item: InsightSourceItem): number {
  return item.valueKind === "count" ? item.count : item.seconds;
}

export function formatInsightSourceValue(item: InsightSourceItem): string {
  return item.valueKind === "count" ? `${item.count}x` : formatDuration(item.seconds);
}

export interface DonutCategorySlice {
  category: ActivityCategory;
  seconds: number;
}

export interface DonutView {
  slices: Array<{ key: string; color: string; dash: number; offset: number }>;
  centerPct: string;
  centerLabel: string;
  rows: Array<{ key: string; name: string; pct: number; time: string; color: string; fillPct: number }>;
}

export const DONUT_CIRCUMFERENCE = 2 * Math.PI * 40;

export function buildDonutView(
  mode: WeeklyChartMode,
  categorySeries: DonutCategorySlice[],
  productivityTotals: Record<ProductivityLabel, number>,
): DonutView {
  const items = mode === "productivity"
    ? FLOW_BREAKDOWN_PRODUCTIVITY_ORDER.map((productivity) => ({
        key: productivity,
        name: productivityLabel(productivity),
        color: PRODUCTIVITY_COLORS[productivity],
        seconds: productivityTotals[productivity],
      })).filter((item) => item.seconds > 0)
    : categorySeries.map((slice) => ({
        key: slice.category,
        name: categoryLabel(slice.category),
        color: CATEGORY_COLORS[slice.category],
        seconds: slice.seconds,
      }));

  const ordered = items.slice().sort((left, right) => right.seconds - left.seconds);
  const total = ordered.reduce((sum, item) => sum + item.seconds, 0);

  let cumulativeFraction = 0;
  const slices = ordered.map((item) => {
    const fraction = total > 0 ? item.seconds / total : 0;
    const dash = Math.max(0, fraction * DONUT_CIRCUMFERENCE - 1.5);
    const offset = -(cumulativeFraction * DONUT_CIRCUMFERENCE);
    cumulativeFraction += fraction;
    return { key: item.key, color: item.color, dash, offset };
  });

  const withPct = ordered.map((item) => ({ ...item, pct: total > 0 ? (item.seconds / total) * 100 : 0 }));
  const maxPct = Math.max(1, ...withPct.map((item) => item.pct));
  const top = withPct[0] ?? null;

  return {
    slices,
    centerPct: top ? `${Math.round(top.pct)}%` : "0%",
    centerLabel: top ? top.name : "—",
    rows: withPct.slice(0, mode === "category" ? 5 : 6).map((item) => ({
      key: item.key,
      name: item.name,
      pct: item.pct,
      time: formatDuration(item.seconds),
      color: item.color,
      fillPct: (item.pct / maxPct) * 88,
    })),
  };
}

export type DriftSurfaceAccumulator = {
  id: string;
  label: string;
  detail: string;
  appName: string;
  bundleId: string | null;
  siteDomain: string | null;
  seconds: number;
  captures: number;
  activeDays: Set<string>;
};

export function buildDriftInsightReport(segments: ActivitySegment[], rangeStart: string, rangeEnd: string, classificationOptions?: ClassificationOptions): ProductivityInsightReport {
  return buildProductivityInsightReport(segments, rangeStart, rangeEnd, "drift", classificationOptions);
}

export function buildFocusInsightReport(segments: ActivitySegment[], rangeStart: string, rangeEnd: string, classificationOptions?: ClassificationOptions): ProductivityInsightReport {
  return buildProductivityInsightReport(segments, rangeStart, rangeEnd, "focus", classificationOptions);
}

export function buildProductivityInsightReport(
  segments: ActivitySegment[],
  rangeStart: string,
  rangeEnd: string,
  productivity: ProductivityAnalysisKind,
  classificationOptions?: ClassificationOptions,
): ProductivityInsightReport {
  const rangeStartMs = new Date(rangeStart).getTime();
  const rangeEndMs = new Date(rangeEnd).getTime();
  const sortedSegments = segments.slice().sort((left, right) => new Date(left.startedAt).getTime() - new Date(right.startedAt).getTime());
  const trackedDays = new Set<string>();
  const firstSegmentByDay = new Map<string, ActivitySegment>();
  const surfaceMap = new Map<string, DriftSurfaceAccumulator>();
  const hourSeconds = Array.from({ length: 24 }, () => 0);
  let totalSeconds = 0;
  let longestRunSeconds = 0;
  let currentRunSeconds = 0;
  let currentRunEndMs = 0;

  for (const segment of sortedSegments) {
    const segmentStartMs = new Date(segment.startedAt).getTime();
    const segmentEndMs = new Date(segment.endedAt).getTime();
    const clippedStartMs = Math.max(segmentStartMs, rangeStartMs);
    const clippedEndMs = Math.min(segmentEndMs, rangeEndMs);
    if (!Number.isFinite(clippedStartMs) || !Number.isFinite(clippedEndMs) || clippedEndMs <= clippedStartMs) continue;

    const segmentDays = getLocalDaysBetween(clippedStartMs, clippedEndMs);
    for (const day of segmentDays) {
      trackedDays.add(day);
      if (!firstSegmentByDay.has(day)) firstSegmentByDay.set(day, segment);
    }

    if (categorizeActivity(segment, classificationOptions) !== productivity) continue;

    const clippedDurationSeconds = Math.round((clippedEndMs - clippedStartMs) / 1000);

    totalSeconds += clippedDurationSeconds;
    addSegmentHours(clippedStartMs, clippedEndMs, hourSeconds);

    if (currentRunSeconds > 0 && clippedStartMs - currentRunEndMs <= DRIFT_RUN_MAX_GAP_SECONDS * 1000) {
      currentRunSeconds += clippedDurationSeconds;
      currentRunEndMs = Math.max(currentRunEndMs, clippedEndMs);
    } else {
      currentRunSeconds = clippedDurationSeconds;
      currentRunEndMs = clippedEndMs;
    }
    longestRunSeconds = Math.max(longestRunSeconds, currentRunSeconds);

    const surface = getInsightSurfaceIdentity(segment);
    const current = surfaceMap.get(surface.id) ?? { ...surface, seconds: 0, captures: 0, activeDays: new Set<string>() };
    current.seconds += clippedDurationSeconds;
    current.captures += 1;
    for (const day of segmentDays) current.activeDays.add(day);
    surfaceMap.set(surface.id, current);
  }

  const startedWithProductivityDays = Array.from(firstSegmentByDay.values()).filter((segment) => categorizeActivity(segment, classificationOptions) === productivity).length;
  const topSurfaces = Array.from(surfaceMap.values())
    .sort((left, right) => right.seconds - left.seconds)
    .slice(0, 4)
    .map((surface) => ({
      id: surface.id,
      label: surface.label,
      detail: surface.detail,
      appName: surface.appName,
      bundleId: surface.bundleId,
      siteDomain: surface.siteDomain,
      seconds: surface.seconds,
      captures: surface.captures,
      activeDays: surface.activeDays.size,
      share: totalSeconds > 0 ? surface.seconds / totalSeconds : 0,
    }));
  const topSurface = topSurfaces[0] ?? null;
  const peakHourIndex = hourSeconds.reduce((bestIndex, seconds, index) => (seconds > hourSeconds[bestIndex] ? index : bestIndex), 0);
  const peakHourSeconds = hourSeconds[peakHourIndex] ?? 0;
  const initialProductivityRate = trackedDays.size > 0 ? Math.round((startedWithProductivityDays / trackedDays.size) * 100) : 0;
  const isFocusReport = productivity === "focus";
  const positiveTone: DriftPatternTone = isFocusReport ? "focus" : "warn";
  const firstActivityDetail = isFocusReport
    ? `${startedWithProductivityDays} of ${trackedDays.size} tracked days began with focus.`
    : `${startedWithProductivityDays} of ${trackedDays.size} tracked days had drift first.`;
  const longestRunDetail = isFocusReport
    ? "Longest focus stretch with gaps under five minutes."
    : "Longest drift stretch with gaps under five minutes.";
  const mainSourceDetail = topSurface
    ? `${topSurface.label} accounts for the largest share.`
    : "No recurring source yet.";
  const windowLabel = isFocusReport ? "Focus window" : "Drift window";
  const firstActivityTone = isFocusReport
    ? initialProductivityRate >= 45 ? "focus" : "neutral"
    : initialProductivityRate >= 30 ? "warn" : "neutral";
  const longestRunTone = isFocusReport
    ? longestRunSeconds >= 45 * 60 ? "focus" : "neutral"
    : longestRunSeconds >= 45 * 60 ? "warn" : "neutral";
  const mainSourceTone = topSurface && topSurface.share >= 0.4 ? positiveTone : "neutral";

  return {
    totalSeconds,
    trackedDays: trackedDays.size,
    startedWithProductivityDays,
    topSurfaces,
    patternCards: [
      { id: `${productivity}-first-activity`, label: "First activity", value: `${initialProductivityRate}%`, detail: firstActivityDetail, tone: firstActivityTone },
      { id: `${productivity}-longest-run`, label: "Longest run", value: formatCompactDurationFromSeconds(longestRunSeconds), detail: longestRunDetail, tone: longestRunTone },
      { id: `${productivity}-main-source`, label: "Main source", value: topSurface ? `${Math.round(topSurface.share * 100)}%` : "0%", detail: mainSourceDetail, tone: mainSourceTone },
      { id: `${productivity}-window`, label: windowLabel, value: peakHourSeconds > 0 ? `${String(peakHourIndex).padStart(2, "0")}:00` : "—", detail: peakHourSeconds > 0 ? `${formatCompactDurationFromSeconds(peakHourSeconds)} accumulated in that hour.` : "No hour stands out yet.", tone: isFocusReport ? "focus" : "neutral" },
    ],
  };
}

export function getInsightSurfaceIdentity(segment: ActivitySegment): Omit<DriftSurfaceAccumulator, "seconds" | "captures" | "activeDays"> {
  const siteDomain = segment.siteDomain?.trim() || null;
  const siteTitle = segment.siteTitle?.trim() || null;
  const appName = segment.appName.trim() || "Unknown app";
  const bundleId = segment.bundleId?.trim() || null;

  if (siteDomain || siteTitle) {
    const label = siteDomain ?? siteTitle ?? appName;
    return { id: `site:${siteDomain ?? siteTitle}`, label, detail: "Website", appName, bundleId, siteDomain };
  }

  return { id: `app:${bundleId ?? appName}`, label: appName, detail: "Desktop app", appName, bundleId, siteDomain: null };
}

export function addSegmentHours(segmentStartMs: number, segmentEndMs: number, hourSeconds: number[]) {
  if (!Number.isFinite(segmentStartMs) || !Number.isFinite(segmentEndMs) || segmentEndMs <= segmentStartMs) return;

  const cursor = new Date(segmentStartMs);
  cursor.setMinutes(0, 0, 0);

  while (cursor.getTime() < segmentEndMs) {
    const hourStartMs = cursor.getTime();
    const hourEndMs = hourStartMs + 60 * 60 * 1000;
    const overlapSeconds = Math.max(0, Math.round((Math.min(segmentEndMs, hourEndMs) - Math.max(segmentStartMs, hourStartMs)) / 1000));
    hourSeconds[cursor.getHours()] += overlapSeconds;
    cursor.setHours(cursor.getHours() + 1);
  }
}
