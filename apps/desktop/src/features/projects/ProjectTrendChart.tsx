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
  /** Compact, fixed-window summary used on the project library. */
  readonly variant?: "detail" | "overview";
  readonly onOpenTrends?: () => void;
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
type BarsGridStyle = CSSProperties & { readonly "--ptc-bar-columns": number };

function scaleTickStyle(y: number): ScaleTickStyle {
  return { "--ptc-scale-y": `${y}%` };
}

function axisTickStyle(x: number): AxisTickStyle {
  return { "--ptc-axis-x": `${x}%` };
}

/**
 * Project assignment trend. Detail ranges use the app's smooth stacked-area
 * language; the fixed project-library overview uses the shared stacked-column
 * language so it stays comparable with Weekly Breakdown.
 */
export function ProjectTrendChart(props: ProjectTrendChartProps): JSX.Element {
  const days = props.days ?? 14;
  const isOverview = props.variant === "overview";
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
  const overviewRangeLabel = `latest ${days} days`;
  const labelByKey = new Map(view.series.map((item) => [item.key, item.label]));
  const overviewAccessibleSummary = view.columns.map((column) => {
    const fullDay = formatDayLabel(column.day);
    if (column.segments.length === 0) return `${fullDay}: no tracked time`;
    const segments = column.segments.map((segment) => {
      const label = labelByKey.get(segment.key) ?? NO_PROJECT_LABEL;
      return `${label} ${formatCompactDurationFromSeconds(segment.seconds)}`;
    });
    return `${fullDay}: ${segments.join(", ")}`;
  }).join("; ");
  const { left, right, top, bottom } = view.bounds;

  function showHover(column: ProjectTrendColumn, event: MouseEvent<Element>) {
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
      className={`editorial-panel editorial-panel--soft insight-chart-panel ptc-panel${isOverview ? " ptc-panel--overview" : ""}`}
      aria-label={isOverview ? `Latest ${days} days project overview, ${view.spanLabel}` : `Project assignment trend, ${view.spanLabel}`}
    >
      <div className="insight-panel-head">
        <span className="label-mono">{isOverview ? `Project allocation · ${overviewRangeLabel}` : <>Project time &middot; {view.spanLabel}</>}</span>
        <div className="ptc-panel__head-actions">
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
          {isOverview && props.onOpenTrends ? (
            <button type="button" className="app-btn app-btn--quiet app-btn--compact ptc-overview__link" onClick={props.onOpenTrends}>
              Explore in Trends <span aria-hidden="true">&rarr;</span>
            </button>
          ) : null}
        </div>
      </div>

      {hasData && isOverview ? (
        <div
          className="ptc-bars"
          role="img"
          aria-label={`Project and unassigned time by day, ${view.spanLabel}. ${overviewAccessibleSummary}`}
        >
          <div className="ptc-bars__plot">
            <div className="ptc-bars__grid" aria-hidden="true">
              {view.yAxis.map((tick) => (
                <span className="ptc-bars__gridline" style={scaleTickStyle(tick.y)} key={tick.label}><i>{tick.label}</i></span>
              ))}
              {view.columns.slice(1).map((column, index) => (
                <span
                  className="ptc-bars__vline"
                  style={{ left: `${((index + 1) / view.columns.length) * 100}%` }}
                  key={`vline-${column.day}`}
                />
              ))}
            </div>
            <div className="ptc-bars__columns" style={{ "--ptc-bar-columns": view.columns.length } as BarsGridStyle}>
              {view.columns.map((column) => {
                const stackHeight = column.segments.reduce((sum, segment) => sum + segment.heightPct, 0);
                return (
                  <div className="ptc-bars__column" key={column.day}>
                    <div className="ptc-bars__zone">
                      <div
                        className="ptc-bars__stack"
                        style={{ height: `${Math.min(stackHeight, 100)}%` }}
                        onMouseEnter={(event) => showHover(column, event)}
                        onMouseMove={(event) => showHover(column, event)}
                        onMouseLeave={() => setHover(null)}
                      >
                        {column.segments.map((segment) => (
                          <span
                            className={`ptc-bars__segment${segment.key === NO_PROJECT_KEY ? " ptc-bars__segment--none" : ""}`}
                            style={{ height: `${(segment.seconds / Math.max(column.totalSeconds, 1)) * 100}%`, background: segment.color }}
                            key={segment.key}
                          />
                        ))}
                      </div>
                    </div>
                    <span className="ptc-bars__day">{column.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : hasData ? (
        <div className="ptc-chart">
          <div className="ptc-plot">
            <svg
              className="ptc-svg"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              role="img"
              aria-label={`Project and unassigned time by day, ${view.spanLabel}`}
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
                          ? `${fullDay}: no tracked time`
                          : `${fullDay}: ${formatCompactDurationFromSeconds(column.totalSeconds)} tracked time`}
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
