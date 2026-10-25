import type { CSSProperties, MouseEvent } from "react";

import type { ProjectTrendColumn, ProjectTrendView } from "./projectTrendView";

type ScaleTickStyle = CSSProperties & { readonly "--ptc-scale-y": string };
type BarsGridStyle = CSSProperties & { readonly "--ptc-bar-columns": number };

export interface ProjectTrendBarsProps {
  readonly view: ProjectTrendView;
  readonly ariaLabel: string;
  /** Segment keys drawn as the muted "No project" band. */
  readonly mutedKey?: string;
  readonly onHover: (column: ProjectTrendColumn, event: MouseEvent<Element>) => void;
  readonly onLeave: () => void;
  /** Makes each column clickable (a team chart of people opens the person). */
  readonly onSelect?: (column: ProjectTrendColumn) => void;
}

/**
 * The shared stacked-column language for project time summaries (project library
 * overview, Teams overview), comparable with Weekly Breakdown. Day labels follow
 * the view's axis ticks, so a month keeps an even, readable stride.
 */
export function ProjectTrendBars({ view, ariaLabel, mutedKey, onHover, onLeave, onSelect }: ProjectTrendBarsProps): JSX.Element {
  const labelledDays = new Set(view.axisTicks.map((tick) => tick.id.replace(/^ptc-axis-/, "")));
  return (
    <div className={onSelect ? "ptc-bars ptc-bars--selectable" : "ptc-bars"} role="img" aria-label={ariaLabel}>
      <div className="ptc-bars__plot">
        <div className="ptc-bars__grid" aria-hidden="true">
          {view.yAxis.map((tick) => (
            <span className="ptc-bars__gridline" style={{ "--ptc-scale-y": `${tick.y}%` } as ScaleTickStyle} key={tick.label}><i>{tick.label}</i></span>
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
              <div className="ptc-bars__column" key={column.day} onClick={onSelect ? () => onSelect(column) : undefined}>
                <div className="ptc-bars__zone">
                  <div
                    className="ptc-bars__stack"
                    style={{ height: `${Math.min(stackHeight, 100)}%` }}
                    onMouseEnter={(event) => onHover(column, event)}
                    onMouseMove={(event) => onHover(column, event)}
                    onMouseLeave={onLeave}
                  >
                    {column.segments.map((segment) => (
                      <span
                        className={`ptc-bars__segment${segment.key === mutedKey ? " ptc-bars__segment--none" : ""}`}
                        style={{ height: `${(segment.seconds / Math.max(column.totalSeconds, 1)) * 100}%`, background: segment.color }}
                        key={segment.key}
                      />
                    ))}
                  </div>
                </div>
                <span className="ptc-bars__day">{labelledDays.has(column.day) ? column.label : ""}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
