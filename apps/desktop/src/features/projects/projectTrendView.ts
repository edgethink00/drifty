import { shiftIsoDate } from "@drifty/domain";
import type { ActivitySegment, Project } from "@drifty/domain";
import { isoDateFromTimestamp } from "../../lib/formatting";
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

/** One calendar day column, oldest → newest across the window. */
export interface ProjectTrendColumn {
  readonly day: string;
  readonly label: string;
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

interface TrendPoint {
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

function buildSmoothLinePath(points: readonly TrendPoint[]): string {
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
function buildSmoothAreaPath(upper: readonly TrendPoint[], lower: readonly TrendPoint[]): string {
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

  const dayTotals = dayList.map((day) => {
    const bucket = buckets.get(day)!;
    return series.reduce((sum, item) => sum + (bucket.get(item.key) ?? 0), 0);
  });
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
  const spanLabel =
    visibleCount <= 1
      ? compactDayLabel(visibleDays[0] ?? endDay)
      : `${compactDayLabel(visibleDays[0]!)} – ${compactDayLabel(visibleDays[visibleCount - 1]!)}`;

  // Scale the plot to PROJECT time (excluding the "No project" bucket) so the
  // actual projects fill the chart instead of being crushed under a dominant gray
  // unassigned band. The unassigned band still renders (faint, clamped to the top)
  // for context. Fall back to total time on days that have no assigned project time.
  const projectKeys = series.filter((item) => item.key !== NO_PROJECT_KEY).map((item) => item.key);
  const maxProjectDaySeconds = dayList.reduce((max, day) => {
    const bucket = buckets.get(day)!;
    return Math.max(max, projectKeys.reduce((sum, key) => sum + (bucket.get(key) ?? 0), 0));
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
    const bucket = buckets.get(day)!;
    let running = 0;
    return series.map((item) => {
      running += bucket.get(item.key) ?? 0;
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
    const bucket = buckets.get(day)!;
    const columnSegments: ProjectTrendSegment[] = [];
    // Series order (largest project first) matches the bottom→top band stacking.
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
    return { day, label: compactDayLabel(day), totalSeconds: total, x: xForDayIndex(index, visibleCount), segments: columnSegments };
  });

  return { columns, series, areaBands, axisTicks, yAxis, gridPath, bounds: PROJECT_TREND_CHART_BOUNDS, maxDaySeconds, spanLabel, visibleDayCount: visibleCount };
}
