import { logicalMinuteOfDay, normalizeStartOfDayMinutes, shiftIsoDate } from "@drifty/domain";
import type { ActivitySegment, Project } from "@drifty/domain";
import { formatCompactHourLabel, formatQuarterHourLabel, isoDateFromTimestamp } from "../../lib/formatting";
import { chooseChartStepHours, formatChartHourLabel } from "../insights/weeklyChartView";

// Unassigned classified time renders as a single gray band, matching the flow
// chart / donut "No project" convention (#9ca3af, Timing/ActivityWatch style).
export const NO_PROJECT_KEY = "__no_project__";
export const NO_PROJECT_LABEL = "No project";
export const NO_PROJECT_COLOR = "#9ca3af";

// 0..100 viewBox insets. Left/right/bottom mirror the Focus/Drift chart; the top
// runs tighter (less headroom) because this is a compact secondary chart and the
// busiest day should nearly reach the top rather than leaving a big empty band.
export interface ProjectTrendChartBounds {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

export const PROJECT_TREND_CHART_BOUNDS: ProjectTrendChartBounds = { left: 4.5, right: 95.5, top: 5, bottom: 92 };

/** A stacked-band series: a project (or the trailing "No project" bucket). */
export interface ProjectTrendSeriesItem {
  readonly key: string;
  readonly label: string;
  readonly color: string;
}

/** One project's slice of a day's tracked time (used for the hover tooltip). */
export interface ProjectTrendSegment {
  readonly key: string;
  readonly color: string;
  readonly heightPct: number;
  readonly seconds: number;
}

/** One column (a calendar day, or a 30-minute window in the intraday view). */
export interface ProjectTrendColumn {
  readonly day: string;
  readonly label: string;
  /** Tooltip heading override; defaults to the full formatted calendar day. */
  readonly hoverLabel?: string;
  readonly totalSeconds: number;
  readonly x: number;
  readonly segments: readonly ProjectTrendSegment[];
}

/** A smooth stacked band: soft translucent fill + crisp top line, per series. */
export interface ProjectTrendAreaBand {
  readonly key: string;
  readonly color: string;
  readonly areaPath: string;
  readonly linePath: string;
}

/** A labelled day tick along the x-axis (only a subset of days is labelled). */
export interface ProjectTrendAxisTick {
  readonly id: string;
  readonly label: string;
  readonly x: number;
}

/** An hour gridline / y-scale tick. */
export interface ProjectTrendYAxisTick {
  readonly value: number;
  readonly label: string;
  readonly y: number;
}

export interface ProjectTrendView {
  readonly columns: readonly ProjectTrendColumn[];
  readonly series: readonly ProjectTrendSeriesItem[];
  readonly areaBands: readonly ProjectTrendAreaBand[];
  readonly axisTicks: readonly ProjectTrendAxisTick[];
  readonly yAxis: readonly ProjectTrendYAxisTick[];
  readonly gridPath: string;
  readonly bounds: ProjectTrendChartBounds;
  readonly maxDaySeconds: number;
  /** Compact label for the trimmed, data-fitted window, e.g. "7/1 – 7/7". */
  readonly spanLabel: string;
  /** Number of days actually plotted after trimming empty leading/trailing days. */
  readonly visibleDayCount: number;
}

export interface BuildProjectTrendViewParams {
  readonly segments: readonly ActivitySegment[];
  readonly projectBySegmentId: ReadonlyMap<string, string>;
  readonly projects: readonly Project[];
  readonly days: number;
  readonly endDay: string;
}

export interface TrendPoint {
  readonly x: number;
  readonly y: number;
}

/** Compact "M/D" label derived from a "YYYY-MM-DD" key without touching the clock. */
function compactDayLabel(day: string): string {
  const [, month, date] = day.split("-").map(Number);
  if (!Number.isFinite(month) || !Number.isFinite(date)) return day;
  return `${month}/${date}`;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

function xForDayIndex(index: number, dayCount: number): number {
  const { left, right } = PROJECT_TREND_CHART_BOUNDS;
  if (dayCount <= 1) return (left + right) / 2;
  return left + (index / (dayCount - 1)) * (right - left);
}

function yForSeconds(seconds: number, axisSeconds: number): number {
  const { top, bottom } = PROJECT_TREND_CHART_BOUNDS;
  const ratio = axisSeconds > 0 ? Math.min(Math.max(seconds / axisSeconds, 0), 1) : 0;
  return bottom - ratio * (bottom - top);
}

// Cubic B-spline smoothing, identical to the Focus/Drift chart's buildSmoothPath:
// endpoints are tripled so the curve passes through the first/last day, and the
// convex-hull property keeps stacked bands from ever crossing.
function padBasisEndpoints(points: readonly TrendPoint[]): readonly TrendPoint[] {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return [];
  return [first, first, first, ...points.slice(1, -1), last, last, last];
}

export function buildSmoothLinePath(points: readonly TrendPoint[]): string {
  const first = points[0];
  if (!first) return "";
  if (points.length === 1) return `M ${round2(first.x)} ${round2(first.y)}`;

  const basis = padBasisEndpoints(points);
  const parts = [`M ${round2(first.x)} ${round2(first.y)}`];
  for (let index = 0; index <= basis.length - 4; index += 1) {
    const p1 = basis[index + 1];
    const p2 = basis[index + 2];
    const p3 = basis[index + 3];
    if (!p1 || !p2 || !p3) continue;
    const controlStartX = round2((2 * p1.x + p2.x) / 3);
    const controlStartY = round2((2 * p1.y + p2.y) / 3);
    const controlEndX = round2((2 * p2.x + p1.x) / 3);
    const controlEndY = round2((2 * p2.y + p1.y) / 3);
    const endX = round2((p1.x + 4 * p2.x + p3.x) / 6);
    const endY = round2((p1.y + 4 * p2.y + p3.y) / 6);
    parts.push(`C ${controlStartX} ${controlStartY}, ${controlEndX} ${controlEndY}, ${endX} ${endY}`);
  }
  return parts.join(" ");
}

/** Closed band between an upper and lower curve, both smoothed the same way. */
export function buildSmoothAreaPath(upper: readonly TrendPoint[], lower: readonly TrendPoint[]): string {
  const upperPath = buildSmoothLinePath(upper);
  const lastUpper = upper[upper.length - 1];
  const lastLower = lower[lower.length - 1];
  if (!upperPath || !lastUpper || !lastLower) return "";
  // Walk the lower edge right→left; smoothing is symmetric so the reversed points
  // trace the identical curve backwards, giving a seam-free shared boundary.
  const lowerPath = buildSmoothLinePath([...lower].reverse());
  if (!lowerPath) return "";
  const lowerBody = lowerPath.replace(/^M\s*-?\d[\d.]*\s+-?\d[\d.]*/, "");
  return `${upperPath} L ${round2(lastUpper.x)} ${round2(lastLower.y)}${lowerBody} Z`;
}

/**
 * Pure multi-day project-trend model: buckets each segment's seconds into its
 * LOCAL calendar day under its project (or the "No project" bucket) and emits a
 * SMOOTH stacked area — one soft-filled, crisp-lined band per series (largest
 * project at the bottom, gray "No project" on top) — scaled so the busiest day
 * fills the plot. Deterministic given `endDay`; it never reads Date.now().
 */
export function buildProjectTrendView(params: BuildProjectTrendViewParams): ProjectTrendView {
  const { segments, projectBySegmentId, projects, endDay } = params;
  const dayCount = Math.max(1, Math.floor(params.days));

  // Calendar days ending at endDay (inclusive), oldest → newest — pure string math.
  const dayList: string[] = [];
  for (let offset = dayCount - 1; offset >= 0; offset -= 1) dayList.push(shiftIsoDate(endDay, -offset));
  const windowDays = new Set(dayList);

  const buckets = new Map<string, Map<string, number>>();
  for (const day of dayList) buckets.set(day, new Map());
  const projectTotals = new Map<string, number>();

  for (const segment of segments) {
    const day = isoDateFromTimestamp(segment.startedAt);
    if (!day || !windowDays.has(day)) continue;
    const dayBucket = buckets.get(day);
    if (!dayBucket) continue;
    const seconds = Number.isFinite(segment.durationSeconds) ? Math.max(0, segment.durationSeconds) : 0;
    if (seconds <= 0) continue;
    const assigned = projectBySegmentId.get(segment.id);
    const key = assigned ?? NO_PROJECT_KEY;
    dayBucket.set(key, (dayBucket.get(key) ?? 0) + seconds);
    projectTotals.set(key, (projectTotals.get(key) ?? 0) + seconds);
  }

  // Active projects (any time in the window) ordered by total desc, then the
  // trailing gray "No project" band when there is unassigned classified time.
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const activeSeries: ProjectTrendSeriesItem[] = [...projectTotals.entries()]
    .filter(([key, total]) => key !== NO_PROJECT_KEY && total > 0 && projectById.has(key))
    .map(([key, total]) => {
      const project = projectById.get(key)!;
      return { key, total, label: project.name, color: project.color };
    })
    .sort((left, right) => right.total - left.total || left.label.localeCompare(right.label))
    .map(({ key, label, color }) => ({ key, label, color }));

  const noProjectSeconds = projectTotals.get(NO_PROJECT_KEY) ?? 0;
  const series: ProjectTrendSeriesItem[] = noProjectSeconds > 0
    ? [...activeSeries, { key: NO_PROJECT_KEY, label: NO_PROJECT_LABEL, color: NO_PROJECT_COLOR }]
    : activeSeries;

  // Scale the plot to PROJECT time (excluding the "No project" bucket) so the
  // actual projects fill the chart instead of being crushed under a dominant gray
  // unassigned band. The unassigned band still renders (faint, clamped to the top)
  // for context.
  return buildTrendGeometry({
    dayList,
    series,
    secondsFor: (day, key) => buckets.get(day)?.get(key) ?? 0,
    axisKeys: series.filter((item) => item.key !== NO_PROJECT_KEY).map((item) => item.key),
  });
}

export interface TrendGeometryParams {
  /** Calendar days oldest → newest, "YYYY-MM-DD". */
  readonly dayList: readonly string[];
  /** Bands bottom → top (largest first by convention). */
  readonly series: readonly ProjectTrendSeriesItem[];
  readonly secondsFor: (day: string, seriesKey: string) => number;
  /** Series keys that set the y-scale; other bands render clamped for context. Defaults to all series. */
  readonly axisKeys?: readonly string[];
}

/**
 * Geometry-only half of the trend model: takes per-day per-series second totals
 * (however they were bucketed — activity segments, published team aggregates)
 * and emits the smooth stacked-area view. Deterministic, never reads the clock.
 */
export function buildTrendGeometry(params: TrendGeometryParams): ProjectTrendView {
  const { dayList, series, secondsFor } = params;

  const dayTotals = dayList.map((day) => series.reduce((sum, item) => sum + secondsFor(day, item.key), 0));
  const maxDaySeconds = dayTotals.reduce((max, value) => Math.max(max, value), 0);

  // Fit the plotted window to the days that actually have tracked time so the
  // curve spans the panel edge-to-edge instead of trailing off into the empty
  // history before tracking began. Interior zero-days stay (they are real gaps);
  // only leading/trailing empties are trimmed. Falls back to the full window when
  // nothing has data (the caller renders an empty state in that case anyway).
  let firstIdx = dayTotals.findIndex((total) => total > 0);
  let lastIdx = -1;
  for (let index = dayTotals.length - 1; index >= 0; index -= 1) {
    if (dayTotals[index]! > 0) {
      lastIdx = index;
      break;
    }
  }
  if (firstIdx === -1 || lastIdx < firstIdx) {
    firstIdx = 0;
    lastIdx = dayList.length - 1;
  }
  const visibleDays = dayList.slice(firstIdx, lastIdx + 1);
  const visibleCount = visibleDays.length;
  const fallbackDay = dayList[dayList.length - 1] ?? "";
  const spanLabel =
    visibleCount <= 1
      ? compactDayLabel(visibleDays[0] ?? fallbackDay)
      : `${compactDayLabel(visibleDays[0]!)} – ${compactDayLabel(visibleDays[visibleCount - 1]!)}`;

  // Fall back to total time on days that have no axis-basis series time.
  const axisKeys = params.axisKeys ?? series.map((item) => item.key);
  const maxProjectDaySeconds = dayList.reduce((max, day) => {
    return Math.max(max, axisKeys.reduce((sum, key) => sum + secondsFor(day, key), 0));
  }, 0);
  const axisBasisSeconds = maxProjectDaySeconds > 0 ? maxProjectDaySeconds : maxDaySeconds;

  // Same nice-hour-step gridline machinery as the weekly trend chart, so the two
  // charts read consistently. The busiest day fills ~97% of the plot height so the
  // compact chart doesn't waste a tall empty band above the peak.
  const maxHours = axisBasisSeconds / 3600;
  const axisMax = maxHours > 0 ? maxHours / 0.97 : 1;
  const axisSeconds = axisMax * 3600;
  const step = chooseChartStepHours(maxHours);

  // Per-day cumulative sums across the VISIBLE window: cumulative[i][seriesIndex]
  // is the running total through series 0..seriesIndex (the band's upper edge).
  const cumulative = visibleDays.map((day) => {
    let running = 0;
    return series.map((item) => {
      running += secondsFor(day, item.key);
      return running;
    });
  });

  // One x sample per visible day; a lone day is drawn as a flat full-width band.
  const samples = visibleCount <= 1
    ? [{ dayIndex: 0, x: PROJECT_TREND_CHART_BOUNDS.left }, { dayIndex: 0, x: PROJECT_TREND_CHART_BOUNDS.right }]
    : visibleDays.map((_, index) => ({ dayIndex: index, x: xForDayIndex(index, visibleCount) }));

  const areaBands: ProjectTrendAreaBand[] = series.map((item, seriesIndex) => {
    const upperPoints = samples.map((sample) => ({
      x: sample.x,
      y: yForSeconds(cumulative[sample.dayIndex]![seriesIndex]!, axisSeconds),
    }));
    const lowerPoints = samples.map((sample) => ({
      x: sample.x,
      y: yForSeconds(seriesIndex === 0 ? 0 : cumulative[sample.dayIndex]![seriesIndex - 1]!, axisSeconds),
    }));
    return {
      key: item.key,
      color: item.color,
      areaPath: buildSmoothAreaPath(upperPoints, lowerPoints),
      linePath: buildSmoothLinePath(upperPoints),
    };
  });

  // Label every visible day on the x-axis (the trimmed window keeps this readable).
  const axisTicks: ProjectTrendAxisTick[] = visibleDays.map((day, index) => ({
    id: `ptc-axis-${day}`,
    label: compactDayLabel(day),
    x: xForDayIndex(index, visibleCount),
  }));

  const yAxis: ProjectTrendYAxisTick[] = [];
  if (maxHours > 0) {
    for (let value = step; value <= maxHours + 1e-9; value += step) {
      yAxis.push({ value, label: `${formatChartHourLabel(value)}h`, y: yForSeconds(value * 3600, axisSeconds) });
    }
  }
  const gridPath = yAxis
    .map((tick) => `M ${PROJECT_TREND_CHART_BOUNDS.left} ${round2(tick.y)} H ${PROJECT_TREND_CHART_BOUNDS.right}`)
    .join(" ");

  const columns: ProjectTrendColumn[] = visibleDays.map((day, index) => {
    const columnSegments: ProjectTrendSegment[] = [];
    // Series order (largest project first) matches the bottom→top band stacking.
    let total = 0;
    for (const item of series) {
      const seconds = secondsFor(day, item.key);
      total += seconds;
      if (seconds <= 0) continue;
      columnSegments.push({
        key: item.key,
        color: item.color,
        seconds,
        heightPct: axisSeconds > 0 ? (seconds / axisSeconds) * 100 : 0,
      });
    }
    return { day, label: compactDayLabel(day), totalSeconds: total, x: xForDayIndex(index, visibleCount), segments: columnSegments };
  });

  return { columns, series, areaBands, axisTicks, yAxis, gridPath, bounds: PROJECT_TREND_CHART_BOUNDS, maxDaySeconds, spanLabel, visibleDayCount: visibleCount };
}

export interface BuildProjectIntradayTrendViewParams {
  readonly segments: readonly ActivitySegment[];
  readonly projectBySegmentId: ReadonlyMap<string, string>;
  readonly projects: readonly Project[];
  /** The logical day being shown, "YYYY-MM-DD" (for the span label only). */
  readonly day: string;
  readonly startOfDayMinutes?: number;
}

const INTRADAY_WINDOW_MINUTES = 30;
const INTRADAY_WINDOW_COUNT = (24 * 60) / INTRADAY_WINDOW_MINUTES;

function chooseIntradayMinuteStep(maxMinutes: number): number {
  for (const step of [2, 5, 10, 15, 30]) {
    if (maxMinutes / step <= 4.5) return step;
  }
  return 30;
}

/**
 * Single-day variant of the trend model in the SAME ProjectTrendView shape:
 * segments bucket into 30-minute windows instead of days, so Day mode renders
 * through the identical smooth stacked-area panel as Week/Month. Leading and
 * trailing idle windows are trimmed (like empty days in the multi-day view),
 * the y-scale switches to minutes-per-window while a window's peak stays under
 * an hour, and x-ticks land on clock-hour boundaries.
 */
export function buildProjectIntradayTrendView(params: BuildProjectIntradayTrendViewParams): ProjectTrendView {
  const { segments, projectBySegmentId, projects } = params;
  const boundaryMinutes = normalizeStartOfDayMinutes(params.startOfDayMinutes ?? 0);

  const buckets: Map<string, number>[] = Array.from({ length: INTRADAY_WINDOW_COUNT }, () => new Map());
  const projectTotals = new Map<string, number>();

  for (const segment of segments) {
    const seconds = Number.isFinite(segment.durationSeconds) ? Math.max(0, segment.durationSeconds) : 0;
    if (seconds <= 0) continue;
    const startedMs = new Date(segment.startedAt).getTime();
    if (Number.isNaN(startedMs)) continue;
    const started = new Date(startedMs);
    const clockMinute = started.getHours() * 60 + started.getMinutes();
    const logicalMinute = logicalMinuteOfDay(clockMinute, boundaryMinutes);
    const index = Math.min(Math.max(Math.floor(logicalMinute / INTRADAY_WINDOW_MINUTES), 0), INTRADAY_WINDOW_COUNT - 1);
    const key = projectBySegmentId.get(segment.id) ?? NO_PROJECT_KEY;
    buckets[index]!.set(key, (buckets[index]!.get(key) ?? 0) + seconds);
    projectTotals.set(key, (projectTotals.get(key) ?? 0) + seconds);
  }

  const projectById = new Map(projects.map((project) => [project.id, project]));
  const activeSeries: ProjectTrendSeriesItem[] = [...projectTotals.entries()]
    .filter(([key, total]) => key !== NO_PROJECT_KEY && total > 0 && projectById.has(key))
    .map(([key, total]) => {
      const project = projectById.get(key)!;
      return { key, total, label: project.name, color: project.color };
    })
    .sort((left, right) => right.total - left.total || left.label.localeCompare(right.label))
    .map(({ key, label, color }) => ({ key, label, color }));

  const noProjectSeconds = projectTotals.get(NO_PROJECT_KEY) ?? 0;
  const series: ProjectTrendSeriesItem[] = noProjectSeconds > 0
    ? [...activeSeries, { key: NO_PROJECT_KEY, label: NO_PROJECT_LABEL, color: NO_PROJECT_COLOR }]
    : activeSeries;

  const windowTotals = buckets.map((bucket) => [...bucket.values()].reduce((sum, value) => sum + value, 0));
  const maxDaySeconds = windowTotals.reduce((max, value) => Math.max(max, value), 0);

  let firstIdx = windowTotals.findIndex((total) => total > 0);
  let lastIdx = -1;
  for (let index = windowTotals.length - 1; index >= 0; index -= 1) {
    if (windowTotals[index]! > 0) {
      lastIdx = index;
      break;
    }
  }
  if (firstIdx === -1 || lastIdx < firstIdx) {
    firstIdx = 0;
    lastIdx = INTRADAY_WINDOW_COUNT - 1;
  }
  const visibleCount = lastIdx - firstIdx + 1;
  const xFor = (visibleIndex: number): number => {
    const { left, right } = PROJECT_TREND_CHART_BOUNDS;
    if (visibleCount <= 1) return (left + right) / 2;
    return left + (visibleIndex / (visibleCount - 1)) * (right - left);
  };

  // Project-only basis (gray band clamps) with a minute scale under one hour.
  const axisBasisWindow = buckets.reduce((max, bucket) => {
    let projectSeconds = 0;
    for (const [key, value] of bucket) if (key !== NO_PROJECT_KEY) projectSeconds += value;
    return Math.max(max, projectSeconds);
  }, 0);
  const axisBasisSeconds = axisBasisWindow > 0 ? axisBasisWindow : maxDaySeconds;
  const axisSeconds = axisBasisSeconds > 0 ? axisBasisSeconds / 0.97 : 3600;

  const yAxis: ProjectTrendYAxisTick[] = [];
  if (axisBasisSeconds > 0) {
    if (axisBasisSeconds < 3600) {
      const maxMinutes = axisBasisSeconds / 60;
      const step = chooseIntradayMinuteStep(maxMinutes);
      for (let value = step; value <= maxMinutes + 1e-9; value += step) {
        yAxis.push({ value: value / 60, label: `${value}m`, y: yForSeconds(value * 60, axisSeconds) });
      }
    } else {
      const maxHours = axisBasisSeconds / 3600;
      const step = chooseChartStepHours(maxHours);
      for (let value = step; value <= maxHours + 1e-9; value += step) {
        yAxis.push({ value, label: `${formatChartHourLabel(value)}h`, y: yForSeconds(value * 3600, axisSeconds) });
      }
    }
  }
  const gridPath = yAxis
    .map((tick) => `M ${PROJECT_TREND_CHART_BOUNDS.left} ${round2(tick.y)} H ${PROJECT_TREND_CHART_BOUNDS.right}`)
    .join(" ");

  const cumulative = Array.from({ length: visibleCount }, (_, visibleIndex) => {
    const bucket = buckets[firstIdx + visibleIndex]!;
    let running = 0;
    return series.map((item) => {
      running += bucket.get(item.key) ?? 0;
      return running;
    });
  });

  const samples = visibleCount <= 1
    ? [{ windowIndex: 0, x: PROJECT_TREND_CHART_BOUNDS.left }, { windowIndex: 0, x: PROJECT_TREND_CHART_BOUNDS.right }]
    : Array.from({ length: visibleCount }, (_, index) => ({ windowIndex: index, x: xFor(index) }));

  const areaBands: ProjectTrendAreaBand[] = series.map((item, seriesIndex) => {
    const upperPoints = samples.map((sample) => ({
      x: sample.x,
      y: yForSeconds(cumulative[sample.windowIndex]![seriesIndex]!, axisSeconds),
    }));
    const lowerPoints = samples.map((sample) => ({
      x: sample.x,
      y: yForSeconds(seriesIndex === 0 ? 0 : cumulative[sample.windowIndex]![seriesIndex - 1]!, axisSeconds),
    }));
    return {
      key: item.key,
      color: item.color,
      areaPath: buildSmoothAreaPath(upperPoints, lowerPoints),
      linePath: buildSmoothLinePath(upperPoints),
    };
  });

  // Clock-hour ticks along the visible span, thinned to at most ~7 labels.
  const visibleMinutes = visibleCount * INTRADAY_WINDOW_MINUTES;
  const strideMinutes = Math.max(60, Math.ceil(visibleMinutes / 7 / 60) * 60);
  const axisTicks: ProjectTrendAxisTick[] = [];
  for (let index = firstIdx; index <= lastIdx; index += 1) {
    const startMinute = index * INTRADAY_WINDOW_MINUTES;
    if (startMinute % strideMinutes !== 0) continue;
    const clockHour = Math.floor(((startMinute + boundaryMinutes) % (24 * 60)) / 60);
    axisTicks.push({
      id: `ptc-axis-w${index}`,
      label: formatCompactHourLabel(clockHour),
      x: xFor(index - firstIdx),
    });
  }

  const columns: ProjectTrendColumn[] = Array.from({ length: visibleCount }, (_, visibleIndex) => {
    const index = firstIdx + visibleIndex;
    const bucket = buckets[index]!;
    const clockMinute = (index * INTRADAY_WINDOW_MINUTES + boundaryMinutes) % (24 * 60);
    const endClockMinute = (clockMinute + INTRADAY_WINDOW_MINUTES) % (24 * 60);
    const columnSegments: ProjectTrendSegment[] = [];
    let total = 0;
    for (const item of series) {
      const seconds = bucket.get(item.key) ?? 0;
      total += seconds;
      if (seconds <= 0) continue;
      columnSegments.push({
        key: item.key,
        color: item.color,
        seconds,
        heightPct: axisSeconds > 0 ? (seconds / axisSeconds) * 100 : 0,
      });
    }
    return {
      day: `w${index}`,
      label: formatQuarterHourLabel(clockMinute),
      hoverLabel: `${formatQuarterHourLabel(clockMinute)} – ${formatQuarterHourLabel(endClockMinute)}`,
      totalSeconds: total,
      x: xFor(visibleIndex),
      segments: columnSegments,
    };
  });

  return {
    columns,
    series,
    areaBands,
    axisTicks,
    yAxis,
    gridPath,
    bounds: PROJECT_TREND_CHART_BOUNDS,
    maxDaySeconds,
    spanLabel: compactDayLabel(params.day),
    visibleDayCount: visibleCount,
  };
}
