import { useState } from "react";
import type { CSSProperties, MouseEvent } from "react";
import type { ActivitySegment, Project } from "@drifty/domain";
import { formatCompactDurationFromSeconds, formatDayLabel } from "../../lib/formatting";
import {
  buildProjectIntradayTrendView,
  buildProjectTrendView,
  NO_PROJECT_KEY,
  NO_PROJECT_LABEL,
  type ProjectTrendColumn,
} from "./projectTrendView";
import "./project-trend-chart.css";

export interface ProjectTrendChartProps {
  readonly segments: readonly ActivitySegment[]; // segments across the trend range
  readonly projectBySegmentId: ReadonlyMap<string, string>; // segment.id → projectId (assigned only)
  readonly projects: readonly Project[];
  readonly days?: number; // number of days to show, default 14
  readonly endDay: string; // "YYYY-MM-DD" (most recent day, inclusive)
  /** Render a single day bucketed into 30-minute windows instead of day columns. */
  readonly intraday?: boolean;
  readonly startOfDayMinutes?: number;
}

interface HoverRow {
  readonly key: string;
  readonly label: string;
  readonly color: string;
  readonly durationLabel: string;
}

interface HoverState {
  readonly dayLabel: string;
  readonly totalLabel: string;
  readonly rows: readonly HoverRow[];
  readonly x: number;
  readonly y: number;
}

type ScaleTickStyle = CSSProperties & { readonly "--ptc-scale-y": string };
type AxisTickStyle = CSSProperties & { readonly "--ptc-axis-x": string };

function scaleTickStyle(y: number): ScaleTickStyle {
  return { "--ptc-scale-y": `${y}%` };
}

function axisTickStyle(x: number): AxisTickStyle {
  return { "--ptc-axis-x": `${x}%` };
}

/**
 * Multi-day project trend rendered as a SMOOTH stacked area over the last N days
 * (x = days oldest→newest, y = tracked seconds/day). Each project is a soft
 * translucent band capped by a crisp line, stacked largest-at-the-bottom with a
 * gray "No project" band on top — mirroring the app's Focus/Drift area chart
 * (editorial panel, label-mono eyebrow, pill legend, hour y-scale, day x-axis).
 */
export function ProjectTrendChart(props: ProjectTrendChartProps): JSX.Element {
  const days = props.days ?? 14;
  const [hover, setHover] = useState<HoverState | null>(null);
  const view = props.intraday
    ? buildProjectIntradayTrendView({
        segments: props.segments,
        projectBySegmentId: props.projectBySegmentId,
        projects: props.projects,
        day: props.endDay,
        startOfDayMinutes: props.startOfDayMinutes ?? 0,
      })
    : buildProjectTrendView({
        segments: props.segments,
        projectBySegmentId: props.projectBySegmentId,
        projects: props.projects,
        days,
        endDay: props.endDay,
      });

  const hasData = view.series.length > 0 && view.maxDaySeconds > 0;
  const labelByKey = new Map(view.series.map((item) => [item.key, item.label]));
  const { left, right, top, bottom } = view.bounds;

  function showHover(column: ProjectTrendColumn, event: MouseEvent<SVGRectElement>) {
    const fullDay = column.hoverLabel ?? formatDayLabel(column.day);
    const rows: HoverRow[] = column.segments.map((segment) => ({
      key: segment.key,
      label: labelByKey.get(segment.key) ?? NO_PROJECT_LABEL,
      color: segment.color,
      durationLabel: formatCompactDurationFromSeconds(segment.seconds),
    }));
    setHover({
      dayLabel: fullDay,
      totalLabel: rows.length === 0 ? "No tracked time" : formatCompactDurationFromSeconds(column.totalSeconds),
      rows,
      x: event.clientX,
      y: event.clientY,
    });
  }

  return (
    <section
      className="editorial-panel editorial-panel--soft insight-chart-panel ptc-panel"
      aria-label={`Project time trend, ${view.spanLabel}`}
    >
      <div className="insight-panel-head">
        <span className="label-mono">Project time &middot; {view.spanLabel}</span>
        {view.series.length > 0 ? (
          <div className="insight-panel-head__legend">
            {view.series.map((item) => (
              <span className={`chip ptc-chip${item.key === NO_PROJECT_KEY ? " ptc-chip--none" : ""}`} key={item.key}>
                <span className="sw" style={{ background: item.color }} />
                {item.label}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {hasData ? (
        <div className="ptc-chart">
          <div className="ptc-plot">
            <svg
              className="ptc-svg"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              role="img"
              aria-label={`Stacked project time by day, ${view.spanLabel}`}
            >
              <path className="ptc-grid" d={view.gridPath} />
              <g className="ptc-areas">
                {view.areaBands.map((band) => (
                  <path
                    className={`ptc-area${band.key === NO_PROJECT_KEY ? " ptc-area--none" : ""}`}
                    d={band.areaPath}
                    fill={band.color}
                    key={`area-${band.key}`}
                  />
                ))}
              </g>
              <g className="ptc-lines">
                {view.areaBands.map((band) => (
                  <path
                    className={`ptc-line${band.key === NO_PROJECT_KEY ? " ptc-line--none" : ""}`}
                    d={band.linePath}
                    stroke={band.color}
                    key={`line-${band.key}`}
                  />
                ))}
              </g>
              <g className="ptc-hits">
                {view.columns.map((column, index) => {
                  const previous = view.columns[index - 1];
                  const next = view.columns[index + 1];
                  const x0 = previous ? (previous.x + column.x) / 2 : left;
                  const x1 = next ? (column.x + next.x) / 2 : right;
                  const fullDay = column.hoverLabel ?? formatDayLabel(column.day);
                  return (
                    <rect
                      className="ptc-hit"
                      x={x0}
                      y={top}
                      width={Math.max(0, x1 - x0)}
                      height={bottom - top}
                      key={column.day}
                      onMouseEnter={(event) => showHover(column, event)}
                      onMouseMove={(event) => showHover(column, event)}
                      onMouseLeave={() => setHover(null)}
                    >
                      <title>
                        {column.segments.length === 0
                          ? `${fullDay}: no tracked project time`
                          : `${fullDay}: ${formatCompactDurationFromSeconds(column.totalSeconds)} of tracked project time`}
                      </title>
                    </rect>
                  );
                })}
              </g>
            </svg>
            <div className="ptc-scale" aria-hidden="true">
              {view.yAxis.map((tick) => (
                <span style={scaleTickStyle(tick.y)} key={tick.label}>{tick.label}</span>
              ))}
            </div>
          </div>
          <div className="ptc-axis" aria-hidden="true">
            {view.axisTicks.map((tick) => (
              <span style={axisTickStyle(tick.x)} key={tick.id}>{tick.label}</span>
            ))}
          </div>
        </div>
      ) : (
        <div className="ptc-empty" role="status">No project activity in this range yet.</div>
      )}

      {hover ? (
        <div className="ptc-tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }} role="presentation">
          <div className="ptc-tooltip__head">
            <span className="ptc-tooltip__day">{hover.dayLabel}</span>
            <span className="ptc-tooltip__total">{hover.totalLabel}</span>
          </div>
          {hover.rows.length > 0 ? (
            <ul className="ptc-tooltip__rows">
              {hover.rows.map((row) => (
                <li className="ptc-tooltip__row" key={row.key}>
                  <span className="ptc-tooltip__dot" style={{ background: row.color }} aria-hidden="true" />
                  <span className="ptc-tooltip__name">{row.label}</span>
                  <span className="ptc-tooltip__dur">{row.durationLabel}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
