import { logicalMinuteOfDay, normalizeStartOfDayMinutes } from "@drifty/domain";
import type { ActivitySegment, Project } from "@drifty/domain";
import { formatCompactHourLabel, formatQuarterHourLabel } from "../../lib/formatting";
import { buildSmoothAreaPath, type TrendPoint } from "./projectTrendView";

// Intraday "which project got my energy" chart geometry. One logical day is
// split into 48 thirty-minute windows; each project is a stacked band and any
// classified-but-unassigned time collects in a trailing "No project" band.

export const PROJECT_DAY_MINUTES_PER_DAY = 24 * 60;
export const PROJECT_DAY_WINDOW_MINUTES = 30;
export const PROJECT_DAY_WINDOW_COUNT = PROJECT_DAY_MINUTES_PER_DAY / PROJECT_DAY_WINDOW_MINUTES;

export const PROJECT_DAY_NO_PROJECT_KEY = "__no_project__";
export const PROJECT_DAY_NO_PROJECT_LABEL = "No project";
export const PROJECT_DAY_NO_PROJECT_COLOR = "#9ca3af";

// Shares the calm inset used by the Focus/Drift intraday chart so the two read
// as one family when stacked in the same column.
export const PROJECT_DAY_PLOT_BOUNDS = { left: 4.5, right: 95.5, top: 8, bottom: 92 } as const;

export interface ProjectDaySeries {
  readonly key: string;
  readonly label: string;
  readonly color: string;
  readonly totalSeconds: number;
}

export interface ProjectDayBand {
  readonly key: string;
  readonly color: string;
  readonly areaPath: string;
}

export interface ProjectDayWindowSlice {
  readonly key: string;
  readonly label: string;
  readonly color: string;
  readonly seconds: number;
  readonly lowerSeconds: number;
  readonly upperSeconds: number;
}

export interface ProjectDayWindow {
  readonly index: number;
  readonly startMinute: number;
  readonly clockMinute: number;
  readonly label: string;
  readonly x: number;
  readonly columnX: number;
  readonly columnWidth: number;
  readonly totalSeconds: number;
  readonly slices: readonly ProjectDayWindowSlice[];
}

export interface ProjectDayAxisTick {
  readonly id: string;
  readonly label: string;
  readonly x: number;
}

export interface ProjectDayYAxisTick {
  readonly label: string;
  readonly y: number;
}

export interface ProjectDayChart {
  readonly windows: readonly ProjectDayWindow[];
  readonly series: readonly ProjectDaySeries[];
  readonly bands: readonly ProjectDayBand[];
  readonly maxWindowSeconds: number;
  readonly totalSeconds: number;
  readonly hasData: boolean;
  readonly topProjectLabel: string | null;
  readonly axisTicks: readonly ProjectDayAxisTick[];
  /** Minute-scale ticks up the left edge, with matching horizontal grid lines. */
  readonly yAxis: readonly ProjectDayYAxisTick[];
  readonly gridPath: string;
}

export interface ProjectDayChartInput {
  readonly segments: readonly ActivitySegment[];
  readonly projectBySegmentId: ReadonlyMap<string, string>;
  readonly projects: readonly Project[];
  readonly day: string;
  readonly startOfDayMinutes?: number;
}

const PLOT_WIDTH = PROJECT_DAY_PLOT_BOUNDS.right - PROJECT_DAY_PLOT_BOUNDS.left;
const PLOT_HEIGHT = PROJECT_DAY_PLOT_BOUNDS.bottom - PROJECT_DAY_PLOT_BOUNDS.top;
const COLUMN_WIDTH = PLOT_WIDTH / PROJECT_DAY_WINDOW_COUNT;

function windowCenterX(index: number): number {
  return PROJECT_DAY_PLOT_BOUNDS.left + ((index + 0.5) / PROJECT_DAY_WINDOW_COUNT) * PLOT_WIDTH;
}

function windowColumnX(index: number): number {
  return PROJECT_DAY_PLOT_BOUNDS.left + (index / PROJECT_DAY_WINDOW_COUNT) * PLOT_WIDTH;
}

// Convert accumulated seconds in a window to a y-coordinate, where the busiest
// window fills the plot height and zero sits on the baseline.
export function scaleProjectDayY(seconds: number, maxWindowSeconds: number): number {
  const denom = Math.max(maxWindowSeconds, 1);
  const bounded = Math.min(Math.max(seconds, 0), denom);
  return PROJECT_DAY_PLOT_BOUNDS.bottom - (bounded / denom) * PLOT_HEIGHT;
}

function windowIndexForSegment(segment: ActivitySegment, startOfDayMinutes: number): number | null {
  const startedMs = new Date(segment.startedAt).getTime();
  if (Number.isNaN(startedMs)) return null;
  const started = new Date(startedMs);
  const clockMinute = started.getHours() * 60 + started.getMinutes();
  const logicalMinute = logicalMinuteOfDay(clockMinute, startOfDayMinutes);
  const index = Math.floor(logicalMinute / PROJECT_DAY_WINDOW_MINUTES);
  return Math.min(Math.max(index, 0), PROJECT_DAY_WINDOW_COUNT - 1);
}

export function buildProjectDayAxisTicks(startOfDayMinutes = 0): ProjectDayAxisTick[] {
  const boundaryMinutes = normalizeStartOfDayMinutes(startOfDayMinutes);
  const ticks: ProjectDayAxisTick[] = [];
  for (let hour = 0; hour <= 24; hour += 4) {
    const logicalMinute = hour * 60;
    const clockHour = Math.floor(((logicalMinute + boundaryMinutes) % PROJECT_DAY_MINUTES_PER_DAY) / 60);
    ticks.push({
      id: `project-day-axis-${logicalMinute}`,
      label: formatCompactHourLabel(clockHour),
      x: PROJECT_DAY_PLOT_BOUNDS.left + (logicalMinute / PROJECT_DAY_MINUTES_PER_DAY) * PLOT_WIDTH,
    });
  }
  return ticks;
}

// Smoothed with the same cubic B-spline as the multi-day trend chart (and the
// Focus/Drift chart), so the intraday bands read as one family with Your Week.
function buildBandPath(prefix: readonly number[][], seriesIndex: number, maxWindowSeconds: number): string {
  const upper: TrendPoint[] = [];
  const lower: TrendPoint[] = [];
  for (let windowIndex = 0; windowIndex < PROJECT_DAY_WINDOW_COUNT; windowIndex += 1) {
    const x = windowCenterX(windowIndex);
    upper.push({ x, y: scaleProjectDayY(prefix[windowIndex][seriesIndex + 1], maxWindowSeconds) });
    lower.push({ x, y: scaleProjectDayY(prefix[windowIndex][seriesIndex], maxWindowSeconds) });
  }
  return buildSmoothAreaPath(upper, lower);
}

function chooseMinuteStep(maxMinutes: number): number {
  for (const step of [2, 5, 10, 15, 30]) {
    if (maxMinutes / step <= 4.5) return step;
  }
  return 30;
}

export function buildProjectDayChart(input: ProjectDayChartInput): ProjectDayChart {
  const startOfDayMinutes = input.startOfDayMinutes ?? 0;
  const boundaryMinutes = normalizeStartOfDayMinutes(startOfDayMinutes);
  const projectById = new Map(input.projects.map((project) => [project.id, project]));

  // Per-window seconds keyed by series (a real project id, or the No-project bucket).
  const windowSeconds = Array.from({ length: PROJECT_DAY_WINDOW_COUNT }, () => new Map<string, number>());
  const keyTotals = new Map<string, number>();

  for (const segment of input.segments) {
    if (!(segment.durationSeconds > 0)) continue;
    const windowIndex = windowIndexForSegment(segment, startOfDayMinutes);
    if (windowIndex === null) continue;

    const assignedProjectId = input.projectBySegmentId.get(segment.id);
    const project = assignedProjectId ? projectById.get(assignedProjectId) : undefined;
    const key = project ? project.id : PROJECT_DAY_NO_PROJECT_KEY;

    const bucket = windowSeconds[windowIndex];
    bucket.set(key, (bucket.get(key) ?? 0) + segment.durationSeconds);
    keyTotals.set(key, (keyTotals.get(key) ?? 0) + segment.durationSeconds);
  }

  const projectSeries: ProjectDaySeries[] = input.projects
    .filter((project) => (keyTotals.get(project.id) ?? 0) > 0)
    .map((project) => ({
      key: project.id,
      label: project.name,
      color: project.color,
      totalSeconds: keyTotals.get(project.id) ?? 0,
    }))
    .sort((left, right) => right.totalSeconds - left.totalSeconds || left.label.localeCompare(right.label));

  const noProjectSeconds = keyTotals.get(PROJECT_DAY_NO_PROJECT_KEY) ?? 0;
  const series: ProjectDaySeries[] = noProjectSeconds > 0
    ? [
        ...projectSeries,
        {
          key: PROJECT_DAY_NO_PROJECT_KEY,
          label: PROJECT_DAY_NO_PROJECT_LABEL,
          color: PROJECT_DAY_NO_PROJECT_COLOR,
          totalSeconds: noProjectSeconds,
        },
      ]
    : projectSeries;

  // Prefix[window][i] = seconds stacked below series[i]; the final entry is the
  // window total. Zero-height series still advance the prefix so a band pinches
  // shut in windows where its project is idle.
  const prefix: number[][] = windowSeconds.map((bucket) => {
    const row: number[] = [0];
    let running = 0;
    for (const entry of series) {
      running += bucket.get(entry.key) ?? 0;
      row.push(running);
    }
    return row;
  });

  const maxWindowSeconds = prefix.reduce((max, row) => Math.max(max, row[row.length - 1]), 0);

  const windows: ProjectDayWindow[] = windowSeconds.map((bucket, index) => {
    const startMinute = index * PROJECT_DAY_WINDOW_MINUTES;
    const clockMinute = (startMinute + boundaryMinutes) % PROJECT_DAY_MINUTES_PER_DAY;
    const slices: ProjectDayWindowSlice[] = [];
    let running = 0;
    for (const entry of series) {
      const seconds = bucket.get(entry.key) ?? 0;
      const lowerSeconds = running;
      running += seconds;
      if (seconds > 0) {
        slices.push({
          key: entry.key,
          label: entry.label,
          color: entry.color,
          seconds,
          lowerSeconds,
          upperSeconds: running,
        });
      }
    }
    return {
      index,
      startMinute,
      clockMinute,
      label: formatQuarterHourLabel(clockMinute),
      x: windowCenterX(index),
      columnX: windowColumnX(index),
      columnWidth: COLUMN_WIDTH,
      totalSeconds: running,
      slices,
    };
  });

  const bands: ProjectDayBand[] = series.map((entry, seriesIndex) => ({
    key: entry.key,
    color: entry.color,
    areaPath: buildBandPath(prefix, seriesIndex, maxWindowSeconds),
  }));

  const totalSeconds = series.reduce((sum, entry) => sum + entry.totalSeconds, 0);

  const maxMinutes = maxWindowSeconds / 60;
  const yAxis: ProjectDayYAxisTick[] = [];
  if (maxMinutes > 0) {
    const step = chooseMinuteStep(maxMinutes);
    for (let value = step; value <= maxMinutes + 1e-9; value += step) {
      yAxis.push({ label: `${value}m`, y: scaleProjectDayY(value * 60, maxWindowSeconds) });
    }
  }
  const gridPath = yAxis
    .map((tick) => `M${PROJECT_DAY_PLOT_BOUNDS.left} ${Math.round(tick.y * 100) / 100}H${PROJECT_DAY_PLOT_BOUNDS.right}`)
    .join(" ");

  return {
    windows,
    series,
    bands,
    maxWindowSeconds,
    totalSeconds,
    hasData: totalSeconds > 0,
    topProjectLabel: series[0]?.label ?? null,
    axisTicks: buildProjectDayAxisTicks(startOfDayMinutes),
    yAxis,
    gridPath,
  };
}
