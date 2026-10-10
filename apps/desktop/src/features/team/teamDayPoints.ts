import type { ProjectTrendChartBounds, ProjectTrendColumn } from "../projects/projectTrendView";

export interface TeamDayPoint {
  readonly key: string;
  readonly color: string;
  /** Plot coordinates in the chart's 0–100 viewBox. */
  readonly x: number;
  readonly y: number;
}

/**
 * Team totals are stored per day, so the Day view has one data point. A line
 * chart draws a lone point as a marker, not a line: place one marker per project
 * where that project's stacked line would pass through the day.
 */
export function buildTeamDayPoints(column: ProjectTrendColumn, bounds: ProjectTrendChartBounds): readonly TeamDayPoint[] {
  let stackedPct = 0;
  return column.segments.map((segment) => {
    stackedPct += segment.heightPct;
    const ratio = Math.min(Math.max(stackedPct / 100, 0), 1);
    return { key: segment.key, color: segment.color, x: column.x, y: bounds.bottom - ratio * (bounds.bottom - bounds.top) };
  });
}
