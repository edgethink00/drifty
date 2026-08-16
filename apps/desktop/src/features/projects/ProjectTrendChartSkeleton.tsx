import type { CSSProperties } from "react";
import { normalizeStartOfDayMinutes } from "@drifty/domain";
import { buildIsoDayList, formatCompactHourLabel } from "../../lib/formatting";
import { PROJECT_TREND_CHART_BOUNDS } from "./projectTrendView";
import "./project-trend-chart.css";

type AxisTickStyle = CSSProperties & { readonly "--ptc-axis-x": string };
type BarsGridStyle = CSSProperties & { readonly "--ptc-bar-columns": number };

interface SkeletonTick {
  readonly id: string;
  readonly label: string;
  readonly x: number;
}

const { left, right, top, bottom } = PROJECT_TREND_CHART_BOUNDS;

// Three faint placeholder gridlines — the real y-scale depends on the data.
const PLACEHOLDER_GRID = [1, 2, 3]
  .map((step) => {
    const y = Math.round((top + (step * (bottom - top)) / 4) * 100) / 100;
    return `M ${left} ${y} H ${right}`;
  })
  .join(" ");

function xAt(ratio: number): number {
  return left + ratio * (right - left);
}

function compactDayLabel(day: string): string {
  const [, month, date] = day.split("-").map(Number);
  if (!Number.isFinite(month) || !Number.isFinite(date)) return day;
  return `${month}/${date}`;
}

function dayTicks(startDay: string, endDay: string): SkeletonTick[] {
  const days = buildIsoDayList(startDay, endDay);
  const count = days.length;
  if (count === 0) return [];
  if (count === 1) return [{ id: days[0]!, label: compactDayLabel(days[0]!), x: xAt(0.5) }];
  const stride = Math.max(1, Math.ceil(count / 8));
  return days
    .map((day, index) => ({ day, index }))
    .filter(({ index }) => index === 0 || index === count - 1 || (index % stride === 0 && count - 1 - index >= stride))
    .map(({ day, index }) => ({ id: day, label: compactDayLabel(day), x: xAt(index / (count - 1)) }));
}

function hourTicks(startOfDayMinutes: number): SkeletonTick[] {
  const boundaryMinutes = normalizeStartOfDayMinutes(startOfDayMinutes);
  const ticks: SkeletonTick[] = [];
  for (let hour = 0; hour <= 24; hour += 4) {
    const clockHour = Math.floor(((hour * 60 + boundaryMinutes) % (24 * 60)) / 60);
    ticks.push({ id: `h${hour}`, label: formatCompactHourLabel(clockHour), x: xAt(hour / 24) });
  }
  return ticks;
}

/** Minimal legend shape so team projects can reuse the skeleton. */
export interface SkeletonLegendProject {
  readonly id: string;
  readonly name: string;
  readonly color: string;
}

export interface ProjectTrendChartSkeletonProps {
  /** Eyebrow text, e.g. "Project time · Jul 5 – Jul 11". */
  readonly windowLabel: string;
  /** Projects shown as legend chips so the head doesn't flicker while loading. */
  readonly legendProjects: readonly SkeletonLegendProject[];
  readonly isDayMode: boolean;
  readonly startDay: string;
  readonly endDay: string;
  readonly startOfDayMinutes: number;
  readonly variant?: "detail" | "overview";
  readonly onOpenTrends?: () => void;
}

/**
 * Loading placeholder that keeps the chart's full frame — panel head with the
 * legend chips, placeholder gridlines, and the window's x-axis ticks — so a
 * window/mode switch swaps only the bands instead of flashing an empty box.
 */
export function ProjectTrendChartSkeleton({
  windowLabel,
  legendProjects,
  isDayMode,
  startDay,
  endDay,
  startOfDayMinutes,
  variant = "detail",
  onOpenTrends,
}: ProjectTrendChartSkeletonProps): JSX.Element {
  const ticks = isDayMode ? hourTicks(startOfDayMinutes) : dayTicks(startDay, endDay);
  const isOverview = variant === "overview";
  const overviewRangeLabel = windowLabel.toLowerCase();
  const overviewTicks = buildIsoDayList(startDay, endDay).map((day) => ({ id: day, label: compactDayLabel(day), x: 0 }));
  const visibleTicks = isOverview ? overviewTicks : ticks;

  return (
    <section className={`editorial-panel editorial-panel--soft insight-chart-panel ptc-panel${isOverview ? " ptc-panel--overview" : ""}`} aria-label={isOverview ? `${windowLabel} project overview loading` : "Project time trend loading"} aria-busy="true">
      <div className="insight-panel-head">
        <span className="label-mono">{isOverview ? `Project allocation · ${overviewRangeLabel}` : <>Project time &middot; {windowLabel}</>}</span>
        <div className="ptc-panel__head-actions">
          {legendProjects.length > 0 ? (
            <div className="insight-panel-head__legend">
              {legendProjects.map((project) => (
                <span className="chip ptc-chip" key={project.id}>
                  <span className="sw" style={{ background: project.color }} />
                  {project.name}
                </span>
              ))}
            </div>
          ) : null}
          {isOverview && onOpenTrends ? (
            <button type="button" className="app-btn app-btn--quiet app-btn--compact ptc-overview__link" onClick={onOpenTrends}>
              Explore in Trends <span aria-hidden="true">&rarr;</span>
            </button>
          ) : null}
        </div>
      </div>
      <div className={isOverview ? "ptc-bars ptc-bars--loading" : "ptc-chart"}>
        <div className={isOverview ? "ptc-bars__plot" : "ptc-plot projects-chart-skeleton"}>
          {isOverview ? (
            <div className="ptc-bars__columns" style={{ "--ptc-bar-columns": visibleTicks.length } as BarsGridStyle} aria-hidden="true">
              {visibleTicks.map((tick, index) => (
                <div className="ptc-bars__column" key={tick.id}>
                  <div className="ptc-bars__zone"><span className="ptc-bars__placeholder" style={{ height: `${44 + ((index * 11) % 42)}%` }} /></div>
                  <span className="ptc-bars__day">{tick.label}</span>
                </div>
              ))}
            </div>
          ) : (
            <svg className="ptc-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <path className="ptc-grid" d={PLACEHOLDER_GRID} />
            </svg>
          )}
        </div>
        {!isOverview ? (
          <div className="ptc-axis" aria-hidden="true">
            {ticks.map((tick) => (
              <span style={{ "--ptc-axis-x": `${tick.x}%` } as AxisTickStyle} key={tick.id}>{tick.label}</span>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
