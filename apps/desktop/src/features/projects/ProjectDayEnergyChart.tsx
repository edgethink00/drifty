import { useMemo, useState } from "react";
import type { CSSProperties, MouseEvent } from "react";
import type { ActivitySegment, Project } from "@drifty/domain";
import { describeRelativeDay, formatCompactDurationFromSeconds } from "../../lib/formatting";
import {
  buildProjectDayChart,
  scaleProjectDayY,
  type ProjectDayWindow,
  type ProjectDayWindowSlice,
} from "./projectDayChart";
import "./project-day-energy-chart.css";

export interface ProjectDayEnergyChartProps {
  readonly segments: readonly ActivitySegment[];
  readonly projectBySegmentId: ReadonlyMap<string, string>;
  readonly projects: readonly Project[];
  readonly day: string;
  readonly startOfDayMinutes?: number;
}

type ProjectDayHover = {
  readonly label: string;
  readonly color: string;
  readonly timeLabel: string;
  readonly seconds: number;
  readonly x: number;
  readonly y: number;
};

type TooltipStyle = CSSProperties & {
  readonly "--project-day-tooltip-x": string;
  readonly "--project-day-tooltip-y": string;
};

type AxisTickStyle = CSSProperties & {
  readonly "--project-day-axis-x": string;
};

type ScaleTickStyle = CSSProperties & {
  readonly "--project-day-scale-y": string;
};

function hoverFromSlice(window: ProjectDayWindow, slice: ProjectDayWindowSlice, event: MouseEvent): ProjectDayHover {
  return {
    label: slice.label,
    color: slice.color,
    timeLabel: window.label,
    seconds: slice.seconds,
    x: event.clientX,
    y: event.clientY,
  };
}

export function ProjectDayEnergyChart({
  segments,
  projectBySegmentId,
  projects,
  day,
  startOfDayMinutes = 0,
}: ProjectDayEnergyChartProps) {
  const chart = useMemo(
    () => buildProjectDayChart({ segments, projectBySegmentId, projects, day, startOfDayMinutes }),
    [segments, projectBySegmentId, projects, day, startOfDayMinutes],
  );
  const [hover, setHover] = useState<ProjectDayHover | null>(null);

  const relativeLabel = describeRelativeDay(day, startOfDayMinutes).toLowerCase();
  const eyebrow = `Project focus · ${relativeLabel}`;

  if (!chart.hasData) {
    return (
      <section className="project-day-energy project-day-energy--empty" aria-label={`Project focus for ${relativeLabel}`}>
        <span className="label-mono project-day-energy__eyebrow">{eyebrow}</span>
        <p className="project-day-energy__empty">No project activity for this day yet.</p>
      </section>
    );
  }

  const svgAriaLabel = chart.topProjectLabel
    ? `Stacked project time across the day in 30-minute windows. Top project ${relativeLabel}: ${chart.topProjectLabel}.`
    : `Stacked project time across the day in 30-minute windows for ${relativeLabel}.`;

  return (
    <section className="project-day-energy" aria-label={`Project focus by 30-minute windows for ${relativeLabel}`}>
      <header className="project-day-energy__head">
        <span className="label-mono project-day-energy__eyebrow">{eyebrow}</span>
        <span className="project-day-energy__peak" aria-label={`Peak ${formatCompactDurationFromSeconds(chart.maxWindowSeconds)} in a 30-minute window`}>
          peak {formatCompactDurationFromSeconds(chart.maxWindowSeconds)}/30m
        </span>
      </header>

      <ul className="project-day-energy__legend">
        {chart.series.map((entry) => (
          <li className="project-day-energy__legend-item" key={entry.key}>
            <span className="project-day-energy__swatch" style={{ background: entry.color }} aria-hidden="true" />
            <span className="project-day-energy__legend-label">{entry.label}</span>
            <span className="project-day-energy__legend-value">{formatCompactDurationFromSeconds(entry.totalSeconds)}</span>
          </li>
        ))}
      </ul>

      <div className="project-day-energy__plot">
        <svg
          className="project-day-energy__svg"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          role="img"
          aria-label={svgAriaLabel}
        >
          <path className="project-day-energy__grid" d={chart.gridPath} aria-hidden="true" />
          {chart.bands.map((band) => (
            <path className="project-day-energy__band" d={band.areaPath} fill={band.color} key={band.key} />
          ))}
          <g className="project-day-energy__hit-layer" aria-hidden="true">
            {chart.windows.flatMap((window) =>
              window.slices.map((slice) => {
                const upperY = scaleProjectDayY(slice.upperSeconds, chart.maxWindowSeconds);
                const lowerY = scaleProjectDayY(slice.lowerSeconds, chart.maxWindowSeconds);
                return (
                  <rect
                    className="project-day-energy__hit"
                    key={`${window.index}-${slice.key}`}
                    x={window.columnX}
                    y={upperY}
                    width={window.columnWidth}
                    height={Math.max(lowerY - upperY, 0.001)}
                    onMouseEnter={(event) => setHover(hoverFromSlice(window, slice, event))}
                    onMouseMove={(event) => setHover(hoverFromSlice(window, slice, event))}
                    onMouseLeave={() => setHover(null)}
                  />
                );
              }),
            )}
          </g>
        </svg>

        <div className="project-day-energy__scale" aria-hidden="true">
          {chart.yAxis.map((tick) => (
            <span style={{ "--project-day-scale-y": `${tick.y}%` } as ScaleTickStyle} key={tick.label}>{tick.label}</span>
          ))}
        </div>

        {hover ? (
          <div
            className="project-day-energy__tooltip"
            role="status"
            style={{ "--project-day-tooltip-x": `${hover.x}px`, "--project-day-tooltip-y": `${hover.y}px` } as TooltipStyle}
          >
            <span className="project-day-energy__tooltip-dot" style={{ background: hover.color }} aria-hidden="true" />
            <span className="project-day-energy__tooltip-label">{hover.label}</span>
            <span className="project-day-energy__tooltip-meta">
              {hover.timeLabel} &middot; {formatCompactDurationFromSeconds(hover.seconds)}
            </span>
          </div>
        ) : null}
      </div>

      <div className="project-day-energy__axis" aria-hidden="true">
        {chart.axisTicks.map((tick) => (
          <span key={tick.id} style={{ "--project-day-axis-x": `${tick.x}%` } as AxisTickStyle}>
            {tick.label}
          </span>
        ))}
      </div>
    </section>
  );
}
