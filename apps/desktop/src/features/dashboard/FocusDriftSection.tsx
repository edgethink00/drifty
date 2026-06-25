import { memo, useMemo, useRef, useState } from "react";
import type { CSSProperties, FocusEvent, MouseEvent } from "react";
import type { AppIconMap } from "@drifty/domain";
import { EmptyState } from "../../components/EmptyState";
import { MetricTile } from "../../components/MetricTile";
import { formatCompactDurationFromSeconds, formatDuration } from "../../lib/formatting";
import { FocusDriftHoverCard, formatFocusDriftHoverLabel } from "./FocusDriftHoverCard";
import {
  FOCUS_DRIFT_CHART_BOUNDS,
  FOCUS_DRIFT_CLIP_BOUNDS,
  FOCUS_DRIFT_GRID_PATH,
  FOCUS_DRIFT_Y_AXIS_TICKS,
  type FocusDriftAxisTickStyle,
  type FocusDriftChart,
  type FocusDriftLiveStyle,
  type FocusDriftPoint,
} from "./focusDriftChart";
import type { FocusDriftHoverKind, FocusDriftHoverState } from "./HoverCards";

type FocusDriftSectionProps = {
  readonly activeHourCount: number;
  readonly appIcons: AppIconMap;
  readonly averageSessionMinutes: number;
  readonly chart: FocusDriftChart;
  readonly peakTrackedSeconds: number;
  readonly peakWindowLabel: string;
  readonly sessionCount: number;
  readonly topAppLabel: string;
  readonly totalSeconds: number;
  readonly uniqueAppsCount: number;
};

type FocusDriftScaleTickStyle = CSSProperties & {
  readonly "--focus-drift-scale-y": string;
};

function liveStyleForChart(chart: FocusDriftChart): FocusDriftLiveStyle | undefined {
  return chart.currentX !== null ? { "--focus-drift-now-x": `${chart.currentX}%` } : undefined;
}

function scaleTickStyle(y: number): FocusDriftScaleTickStyle {
  return { "--focus-drift-scale-y": `${y}%` };
}

function axisTickStyle(x: number): FocusDriftAxisTickStyle {
  return { "--focus-drift-axis-x": `${x}%` };
}

function buildFocusDriftAreaPath(points: readonly FocusDriftPoint[], path: string): string {
  const first = points[0];
  const last = points[points.length - 1];
  return first && last && path ? `M ${first.x} ${FOCUS_DRIFT_CHART_BOUNDS.bottom} L ${path.slice(2)} L ${last.x} ${FOCUS_DRIFT_CHART_BOUNDS.bottom} Z` : "";
}

export const FocusDriftSection = memo(function FocusDriftSection({
  activeHourCount,
  appIcons,
  averageSessionMinutes,
  chart,
  peakTrackedSeconds,
  peakWindowLabel,
  sessionCount,
  topAppLabel,
  totalSeconds,
  uniqueAppsCount,
}: FocusDriftSectionProps) {
  const [hover, setHover] = useState<FocusDriftHoverState | null>(null);
  const chartBoundsRef = useRef<DOMRect | null>(null);
  const hoverPoints = useMemo(
    () => chart.points.filter((point) => point.totalSeconds > 0 && !point.isFuture),
    [chart.points],
  );
  const measuredPoints = useMemo(
    () => chart.points.filter((point) => !point.isFuture),
    [chart.points],
  );
  const liveStyle = liveStyleForChart(chart);
  const driftMistAreaPath = useMemo(
    () => buildFocusDriftAreaPath(measuredPoints, chart.driftPath),
    [chart.driftPath, measuredPoints],
  );

  function readChartBounds(event: MouseEvent<SVGRectElement>): DOMRect | null {
    const bounds = event.currentTarget.ownerSVGElement?.getBoundingClientRect() ?? null;
    chartBoundsRef.current = bounds;
    return bounds;
  }

  function clearHover() {
    chartBoundsRef.current = null;
    setHover(null);
  }

  function updateKeyboardHover(kind: FocusDriftHoverKind, point: FocusDriftPoint, event: FocusEvent<SVGCircleElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    setHover({ point, kind, x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 });
  }

  function updateLineHover(event: MouseEvent<SVGRectElement>) {
    const svgRect = chartBoundsRef.current ?? readChartBounds(event);
    if (!svgRect || hoverPoints.length === 0) return;

    const chartX = ((event.clientX - svgRect.left) / svgRect.width) * 100;
    const chartY = ((event.clientY - svgRect.top) / svgRect.height) * 100;
    const firstPoint = hoverPoints[0];
    const lastPoint = hoverPoints[hoverPoints.length - 1];
    const hoverX = Math.min(Math.max(chartX, firstPoint.x), lastPoint.x);
    const rightIndex = hoverPoints.findIndex((point) => point.x >= hoverX);
    const nextPoint = hoverPoints[rightIndex] ?? lastPoint;
    const previousPoint = hoverPoints[Math.max(0, rightIndex - 1)] ?? firstPoint;
    const span = Math.max(nextPoint.x - previousPoint.x, 0.0001);
    const ratio = Math.min(Math.max((hoverX - previousPoint.x) / span, 0), 1);
    const focusY = previousPoint.focusY + (nextPoint.focusY - previousPoint.focusY) * ratio;
    const driftY = previousPoint.driftY + (nextPoint.driftY - previousPoint.driftY) * ratio;
    const focusDistance = Math.abs(chartY - focusY);
    const driftDistance = Math.abs(chartY - driftY);
    const distance = Math.min(focusDistance, driftDistance);

    if (distance > 24) {
      setHover(null);
      return;
    }

    const kind: FocusDriftHoverKind = focusDistance <= driftDistance ? "focus" : "drift";
    const nearestPoint = Math.abs(previousPoint.x - hoverX) <= Math.abs(nextPoint.x - hoverX) ? previousPoint : nextPoint;
    setHover({ point: nearestPoint, kind, x: event.clientX, y: event.clientY });
  }

  return (
    <>
      <section className="editorial-panel editorial-panel--soft insight-chart-panel">
        <div className="insight-panel-head">
          <span className="label-mono">Focus/drift score &middot; 30m windows</span>
          <div className="insight-panel-head__legend">
            <span className="chip green"><span className="sw" style={{ background: "var(--productivity-focus)" }} />Focus</span>
            <span className="chip warn"><span className="sw" style={{ background: "var(--productivity-drift)" }} />Drift</span>
          </div>
        </div>
        {chart.hasData ? (
          <div
            className={`focus-drift${chart.isLive ? " focus-drift--live" : ""}`}
            aria-label={chart.isLive && chart.currentTimeLabel ? `Focus versus drift by 30-minute windows, in progress through ${chart.currentTimeLabel}. Future windows are pending.` : "Focus versus drift by 30-minute windows"}
          >
            <div className="focus-drift__plot" style={liveStyle}>
              <svg className="focus-drift__svg" viewBox="0 0 100 100" preserveAspectRatio="none" role="group" aria-label={chart.isLive && chart.currentTimeLabel ? `Focus and drift curves in progress through ${chart.currentTimeLabel}` : "Focus and drift curves"}>
                <defs>
                  <clipPath id="focus-drift-chart-bounds" clipPathUnits="userSpaceOnUse">
                    <rect x={FOCUS_DRIFT_CLIP_BOUNDS.left} y={FOCUS_DRIFT_CLIP_BOUNDS.top} width={FOCUS_DRIFT_CLIP_BOUNDS.right - FOCUS_DRIFT_CLIP_BOUNDS.left} height={FOCUS_DRIFT_CLIP_BOUNDS.bottom - FOCUS_DRIFT_CLIP_BOUNDS.top} />
                  </clipPath>
                  <linearGradient id="focus-drift-chart-drift-mist" x1="0" x2="0" y1="0" y2="1">
                    <stop className="focus-drift__drift-mist-stop--strong" offset="0%" />
                    <stop className="focus-drift__drift-mist-stop--soft" offset="78%" />
                    <stop className="focus-drift__drift-mist-stop--clear" offset="100%" />
                  </linearGradient>
                </defs>
                <path className="focus-drift__grid" d={FOCUS_DRIFT_GRID_PATH} />
                {chart.currentX !== null ? (
                  <rect className="focus-drift__future-region" x={chart.currentX} y={FOCUS_DRIFT_CHART_BOUNDS.top} width={FOCUS_DRIFT_CHART_BOUNDS.right - chart.currentX} height={FOCUS_DRIFT_CHART_BOUNDS.bottom - FOCUS_DRIFT_CHART_BOUNDS.top} aria-hidden="true" />
                ) : null}
                <g clipPath="url(#focus-drift-chart-bounds)">
                  <path className="focus-drift__area" d={chart.focusAreaPath} />
                  <path className="focus-drift__drift-mist" d={driftMistAreaPath} />
                  <path className="focus-drift__line focus-drift__line--focus" d={chart.focusPath} />
                  <path className="focus-drift__line focus-drift__line--drift" d={chart.driftPath} />
                </g>
                <rect className="focus-drift__line-target" x={FOCUS_DRIFT_CHART_BOUNDS.left} y={FOCUS_DRIFT_CHART_BOUNDS.top} width={FOCUS_DRIFT_CHART_BOUNDS.right - FOCUS_DRIFT_CHART_BOUNDS.left} height={100 - FOCUS_DRIFT_CHART_BOUNDS.top} aria-label="Focus and drift curve hover target" onMouseEnter={updateLineHover} onMouseMove={updateLineHover} onMouseLeave={clearHover} />
                {hoverPoints.map((point) => (
                  <g key={point.id}>
                    <circle className="focus-drift__target focus-drift__target--focus" cx={point.x} cy={point.focusY} r="3" role="button" tabIndex={0} aria-label={formatFocusDriftHoverLabel(point, "focus")} onMouseEnter={(event) => setHover({ point, kind: "focus", x: event.clientX, y: event.clientY })} onMouseMove={(event) => setHover({ point, kind: "focus", x: event.clientX, y: event.clientY })} onMouseLeave={clearHover} onFocus={(event) => updateKeyboardHover("focus", point, event)} onBlur={clearHover} />
                    <circle className="focus-drift__target focus-drift__target--drift" cx={point.x} cy={point.driftY} r="3" role="button" tabIndex={0} aria-label={formatFocusDriftHoverLabel(point, "drift")} onMouseEnter={(event) => setHover({ point, kind: "drift", x: event.clientX, y: event.clientY })} onMouseMove={(event) => setHover({ point, kind: "drift", x: event.clientX, y: event.clientY })} onMouseLeave={clearHover} onFocus={(event) => updateKeyboardHover("drift", point, event)} onBlur={clearHover} />
                  </g>
                ))}
              </svg>
              {chart.currentX !== null ? <div className="focus-drift__now-marker" aria-hidden="true" /> : null}
              <div className="focus-drift__scale" aria-hidden="true">
                {FOCUS_DRIFT_Y_AXIS_TICKS.map((tick) => (
                  <span key={tick.label} style={scaleTickStyle(tick.y)}>{tick.label}</span>
                ))}
              </div>
            </div>
            {hover ? <FocusDriftHoverCard appIcons={appIcons} hover={hover} /> : null}
            <div className="focus-drift__axis" aria-hidden="true">
              {chart.axisTicks.map((tick, index) => (
                <span
                  key={tick.id}
                  className={index > 0 && index < chart.axisTicks.length - 1 && index % 2 === 1 ? "focus-drift__axis-tick--dense" : undefined}
                  style={axisTickStyle(tick.x)}
                >
                  {tick.label}
                </span>
              ))}
            </div>
          </div>
        ) : <EmptyState title="No focus pattern yet" detail="Focus and drift curves appear after tracked category data is available." />}
      </section>

      <div className="kpi-row kpi-row--insights insight-summary" aria-label="Insight summary">
        <MetricTile className="insight-summary__tile insight-summary__tile--tracked" label="Tracked" value={formatDuration(totalSeconds)} detail={`${activeHourCount}h active`} />
        <MetricTile className="insight-summary__tile insight-summary__tile--sessions" label="Sessions" value={String(sessionCount)} detail={averageSessionMinutes > 0 ? `${averageSessionMinutes}m avg` : "No sessions"} />
        <MetricTile className="insight-summary__tile insight-summary__tile--peak" label="Peak" value={peakWindowLabel} detail={peakTrackedSeconds > 0 ? formatCompactDurationFromSeconds(peakTrackedSeconds) : "No peak"} />
        <MetricTile className="insight-summary__tile insight-summary__tile--apps" label="Apps" value={String(uniqueAppsCount)} detail={topAppLabel} />
        <MetricTile className="insight-summary__tile insight-summary__tile--focus" label="Focus" value={`${chart.focusConsistency}%`} detail="score" />
        {chart.peakDriftPoint ? <MetricTile className="insight-summary__tile insight-summary__tile--drift" label="Drift" value={chart.peakDriftPoint.label} detail="peak" /> : null}
      </div>
    </>
  );
});
