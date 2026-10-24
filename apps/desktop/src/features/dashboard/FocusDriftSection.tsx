import { isAdditionalDisplayLanguage, supplementalText } from "../localization/supplementalCopy";
import { memo, useId, useMemo, useState } from "react";
import type { CSSProperties, FocusEvent, KeyboardEvent, MouseEvent } from "react";
import type { AppIconMap } from "@drifty/domain";
import { EmptyState } from "../../components/EmptyState";
import { MetricTile } from "../../components/MetricTile";
import { formatDuration, formatLocalizedCompactDurationFromSeconds, formatLocalizedDuration, formatLocalizedQuarterHourLabel } from "../../lib/formatting";
import { FocusDriftHoverCard, formatFocusDriftHoverLabel } from "./FocusDriftHoverCard";
import { useLocalization } from "../localization/LocalizationContext";
import {
  FOCUS_DRIFT_BUCKET_MINUTES,
  FOCUS_DRIFT_CHART_BOUNDS,
  FOCUS_DRIFT_CLIP_BOUNDS,
  FOCUS_DRIFT_GRID_PATH,
  FOCUS_DRIFT_MINUTES_PER_DAY,
  FOCUS_DRIFT_Y_AXIS_TICKS,
  getSmoothPathPointAtX,
  type FocusDriftAxisTickStyle,
  type FocusDriftChart,
  type FocusDriftPoint,
} from "./focusDriftChart";
import type { FocusDriftHoverKind, FocusDriftHoverState } from "./HoverCards";

type FocusDriftSectionProps = {
  readonly appIcons: AppIconMap;
  readonly chart: FocusDriftChart;
  readonly startOfDayMinutes?: number;
  /** The day is still loading: keep the panel, scale and axis, with no curves yet. */
  readonly loading?: boolean;
};

type FocusDriftSummaryTilesProps = {
  readonly activeHourCount: number;
  readonly averageSessionMinutes: number;
  readonly chart: FocusDriftChart;
  readonly peakTrackedSeconds: number;
  readonly peakWindowLabel: string;
  readonly sessionCount: number;
  readonly topAppLabel: string;
  readonly totalSeconds: number;
  readonly uniqueAppsCount: number;
  readonly startOfDayMinutes?: number;
};

/** KPI tiles that used to sit beside the focus/drift chart; the 2026-07
 *  redesign moves them into the Breakdown side panel. */
export function FocusDriftSummaryTiles({
  activeHourCount,
  averageSessionMinutes,
  chart,
  peakTrackedSeconds,
  peakWindowLabel,
  sessionCount,
  topAppLabel,
  totalSeconds,
  uniqueAppsCount,
  startOfDayMinutes = 0,
}: FocusDriftSummaryTilesProps) {
  const { effectiveLanguage, t } = useLocalization();
  // A day with tracked time but nothing classified has no drift reading yet,
  // which is different from a day that was classified and had no drift. A day
  // with nothing tracked keeps the tile hidden, as before: there is no
  // measurement to report either way. (chart.hasData counts classified time
  // only, so it cannot tell these apart.)
  const trackedChartSeconds = chart.points.reduce((sum, point) => sum + point.trackedSeconds, 0);
  const classifiedChartSeconds = chart.points.reduce((sum, point) => sum + point.classifiedSeconds, 0);
  const driftAwaitsClassification = classifiedChartSeconds === 0;
  return (
    <div className="kpi-row kpi-row--insights insight-summary" aria-label={t("dashboard.today.insightSummary")}>
      <MetricTile className="insight-summary__tile insight-summary__tile--tracked" label={t("dashboard.today.tracked")} value={effectiveLanguage !== "en" ? formatLocalizedDuration(totalSeconds, effectiveLanguage) : formatDuration(totalSeconds)} detail={t("dashboard.today.activeHours", { duration: formatLocalizedDuration(activeHourCount * 3600, effectiveLanguage) })} />
      <MetricTile className="insight-summary__tile insight-summary__tile--sessions" label={t("dashboard.today.sessions")} value={String(sessionCount)} detail={averageSessionMinutes > 0 ? t("dashboard.today.averageValue", { duration: isAdditionalDisplayLanguage(effectiveLanguage) ? formatLocalizedDuration(averageSessionMinutes * 60, effectiveLanguage) : effectiveLanguage === "ko" ? `${averageSessionMinutes}분` : effectiveLanguage === "es" ? `${averageSessionMinutes} min` : `${averageSessionMinutes}m` }) : t("dashboard.today.noSessions")} />
      <MetricTile className="insight-summary__tile insight-summary__tile--peak" label={t("dashboard.today.peak")} value={peakWindowLabel} detail={peakTrackedSeconds > 0 ? formatLocalizedCompactDurationFromSeconds(peakTrackedSeconds, effectiveLanguage) : (isAdditionalDisplayLanguage(effectiveLanguage) ? supplementalText(effectiveLanguage, "No peak") : effectiveLanguage === "ko" ? "—" : effectiveLanguage === "es" ? "Sin máximo" : "No peak")} />
      <MetricTile className="insight-summary__tile insight-summary__tile--apps" label={t("dashboard.today.apps")} value={String(uniqueAppsCount)} detail={topAppLabel} detailTitle />
      <MetricTile className="insight-summary__tile insight-summary__tile--focus" label={t("dashboard.today.focusScore")} value={`${chart.focusConsistency}%`} detail={t("dashboard.today.score")} />
      {/* Same clock format as the Peak tile beside it; the chart's 24-hour bucket label is an axis label, not a display time.
          Without drift the tile keeps its place and uses the Peak tile's empty form. */}
      {chart.peakDriftPoint ? (
        <MetricTile className="insight-summary__tile insight-summary__tile--drift" label={t("dashboard.today.driftPeak")} value={formatLocalizedQuarterHourLabel(chart.peakDriftPoint.bucketStartMinute + startOfDayMinutes, effectiveLanguage)} detail={t("dashboard.today.peakDetail")} />
      ) : trackedChartSeconds > 0 ? (
        <MetricTile className="insight-summary__tile insight-summary__tile--drift" label={t("dashboard.today.driftPeak")} value={"\u2014"} detail={driftAwaitsClassification ? t("dashboard.today.driftNotClassified") : t("dashboard.today.noDrift")} />
      ) : null}
    </div>
  );
}

type FocusDriftScaleTickStyle = CSSProperties & {
  readonly "--focus-drift-scale-y": string;
};

type FocusDriftPlotStyle = CSSProperties & {
  readonly "--focus-drift-chart-left": string;
  readonly "--focus-drift-chart-right": string;
  readonly "--focus-drift-now-x"?: string;
};

function visibleMarkerXForChart(chart: FocusDriftChart): number | null {
  if (chart.revealX !== null) return chart.revealX;
  return chart.hasData ? chart.currentX : null;
}

function plotStyleForChart(markerX: number | null): FocusDriftPlotStyle {
  const baseStyle = {
    "--focus-drift-chart-left": `${FOCUS_DRIFT_CHART_BOUNDS.left}%`,
    "--focus-drift-chart-right": `${FOCUS_DRIFT_CHART_BOUNDS.right}%`,
  };
  return markerX !== null ? { ...baseStyle, "--focus-drift-now-x": `${markerX}%` } : baseStyle;
}

function scaleTickStyle(y: number): FocusDriftScaleTickStyle {
  return { "--focus-drift-scale-y": `${y}%` };
}

function axisTickStyle(x: number): FocusDriftAxisTickStyle {
  return { "--focus-drift-axis-x": `${x}%` };
}

/** Horizontal snap reach of the line hover: one 30-minute window on either
 *  side of a tracked point. Beyond that (untracked gaps, the region past the
 *  last window) the cursor is over empty chart, so no card is shown. */
const HOVER_MAX_X_DISTANCE =
  ((FOCUS_DRIFT_CHART_BOUNDS.right - FOCUS_DRIFT_CHART_BOUNDS.left) * FOCUS_DRIFT_BUCKET_MINUTES) / FOCUS_DRIFT_MINUTES_PER_DAY;

function isPointRevealed(point: FocusDriftPoint, chart: FocusDriftChart): boolean {
  return !point.isFuture && (chart.revealX === null || point.x <= chart.revealX);
}

function revealClipWidthForChart(chart: FocusDriftChart): number | null {
  if (chart.revealX === null) return null;
  return Math.max(0, Math.min(FOCUS_DRIFT_CLIP_BOUNDS.right, chart.revealX) - FOCUS_DRIFT_CLIP_BOUNDS.left);
}

export const FocusDriftSection = memo(function FocusDriftSection({
  appIcons,
  chart,
  startOfDayMinutes = 0,
  loading = false,
}: FocusDriftSectionProps) {
  const { effectiveLanguage, t } = useLocalization();
  const [hover, setHover] = useState<FocusDriftHoverState | null>(null);
  const hoverPoints = useMemo(
    () => loading ? [] : chart.points.filter((point) => point.totalSeconds > 0 && isPointRevealed(point, chart)),
    [chart, loading],
  );
  const markerX = loading ? null : visibleMarkerXForChart(chart);
  const plotStyle = plotStyleForChart(markerX);
  const shouldRenderMarker = markerX !== null;
  const shouldRenderSeries = !loading && chart.hasData;
  const revealClipWidth = revealClipWidthForChart(chart);
  const chartClipPath = revealClipWidth === null ? "url(#focus-drift-chart-bounds)" : "url(#focus-drift-chart-reveal)";
  // While loading, the empty frame stands in for the chart instead of the "no pattern" message.
  const shouldRenderChart = loading || chart.hasData || chart.isLive || chart.revealX !== null;
  const sectionAriaLabel = effectiveLanguage === "en"
    ? chart.revealX !== null && chart.revealTimeLabel
      ? `Focus versus drift by 30-minute windows, replaying through ${chart.revealTimeLabel}.`
      : chart.isLive && chart.currentTimeLabel
        ? `Focus versus drift by 30-minute windows, in progress through ${chart.currentTimeLabel}. Future windows are pending.`
        : "Focus versus drift by 30-minute windows"
    : chart.revealX !== null && chart.revealTimeLabel
      ? t("dashboard.today.focusDriftChartAt", { time: chart.revealTimeLabel })
      : chart.isLive && chart.currentTimeLabel
        ? t("dashboard.today.focusDriftChartAt", { time: chart.currentTimeLabel })
        : t("dashboard.today.focusDriftChart");
  const svgAriaLabel = effectiveLanguage === "en"
    ? chart.revealX !== null && chart.revealTimeLabel
      ? `Focus and drift curves replaying through ${chart.revealTimeLabel}`
      : chart.isLive && chart.currentTimeLabel
        ? `Focus and drift curves in progress through ${chart.currentTimeLabel}`
        : "Focus and drift curves"
    : chart.revealX !== null && chart.revealTimeLabel
      ? t("dashboard.today.focusDriftCurvesAt", { time: chart.revealTimeLabel })
      : chart.isLive && chart.currentTimeLabel
        ? t("dashboard.today.focusDriftCurvesAt", { time: chart.currentTimeLabel })
        : t("dashboard.today.focusDriftCurves");

  function buildHoverState(
    point: FocusDriftPoint,
    kind: FocusDriftHoverKind,
    x: number,
    y: number,
    markerX = point.x,
  ): FocusDriftHoverState {
    const yKey = kind === "focus" ? "focusY" : "driftY";
    const seriesRun = chart.seriesPointRuns.find((run) => run.some((candidate) => candidate.id === point.id)) ?? [point];
    const marker = getSmoothPathPointAtX(seriesRun, yKey, markerX);

    return {
      point,
      kind,
      markerX: marker?.x ?? markerX,
      markerY: marker?.y ?? point[yKey],
      x,
      y,
    };
  }

  function clearHover() {
    setHover(null);
  }

  // The chart is one tab stop. Left/Right walk the half-hours, Up/Down switch
  // between the focus and drift lines, Home/End jump to the ends.
  const [keyboardStop, setKeyboardStop] = useState<{ readonly kind: FocusDriftHoverKind; readonly index: number }>({ kind: "focus", index: 0 });
  const keyboardHintId = useId();
  const [arrowKeysUsed, setArrowKeysUsed] = useState(false);
  const stopIndex = Math.min(keyboardStop.index, Math.max(0, hoverPoints.length - 1));
  function moveKeyboardStop(event: KeyboardEvent<SVGSVGElement>) {
    const target = event.target instanceof Element ? event.target.closest<SVGElement>("[data-focus-drift-stop]") : null;
    if (!target) return;
    const [kind, rawIndex] = (target.dataset.focusDriftStop ?? "").split(":");
    const index = Number(rawIndex);
    let nextKind = kind as FocusDriftHoverKind;
    let nextIndex = index;
    switch (event.key) {
      case "ArrowRight": nextIndex = Math.min(index + 1, hoverPoints.length - 1); break;
      case "ArrowLeft": nextIndex = Math.max(index - 1, 0); break;
      case "ArrowUp": nextKind = "focus"; break;
      case "ArrowDown": nextKind = "drift"; break;
      case "Home": nextIndex = 0; break;
      case "End": nextIndex = hoverPoints.length - 1; break;
      default: return;
    }
    event.preventDefault();
    setArrowKeysUsed(true);
    event.currentTarget.querySelector<SVGElement>(`[data-focus-drift-stop="${nextKind}:${nextIndex}"]`)?.focus();
  }

  function updateKeyboardHover(kind: FocusDriftHoverKind, point: FocusDriftPoint, event: FocusEvent<SVGCircleElement>) {
    const marker = buildHoverState(point, kind, 0, 0);
    const svgBounds = event.currentTarget.ownerSVGElement?.getBoundingClientRect() ?? null;
    if (svgBounds) {
      setHover({
        ...marker,
        x: svgBounds.left + (marker.markerX / 100) * svgBounds.width,
        y: svgBounds.top + (marker.markerY / 100) * svgBounds.height,
      });
      return;
    }
    const targetBounds = event.currentTarget.getBoundingClientRect();
    setHover({ ...marker, x: targetBounds.left + targetBounds.width / 2, y: targetBounds.top + targetBounds.height / 2 });
  }

  function updateLineHover(event: MouseEvent<SVGRectElement>) {
    // Read bounds fresh on every move: a rect cached on mouseenter goes stale
    // when the layout shifts while the pointer stays inside (window resize,
    // sidebar toggle, a modal scale animation moving the chart), and no
    // mouseleave fires to clear it because the cursor itself never moved.
    const svgRect = event.currentTarget.ownerSVGElement?.getBoundingClientRect() ?? null;
    if (!svgRect || hoverPoints.length === 0) return;

    const chartX = ((event.clientX - svgRect.left) / svgRect.width) * 100;
    const chartY = ((event.clientY - svgRect.top) / svgRect.height) * 100;
    const firstPoint = hoverPoints[0];
    const lastPoint = hoverPoints[hoverPoints.length - 1];
    const hoverX = Math.min(Math.max(chartX, firstPoint.x), lastPoint.x);
    const rightIndex = hoverPoints.findIndex((point) => point.x >= hoverX);
    const nextPoint = hoverPoints[rightIndex] ?? lastPoint;
    const previousPoint = hoverPoints[Math.max(0, rightIndex - 1)] ?? firstPoint;
    const nearestPoint = Math.abs(previousPoint.x - hoverX) <= Math.abs(nextPoint.x - hoverX) ? previousPoint : nextPoint;
    if (Math.abs(chartX - nearestPoint.x) > HOVER_MAX_X_DISTANCE) {
      setHover(null);
      return;
    }
    const seriesRun = chart.seriesPointRuns.find((run) => run.some((candidate) => candidate.id === nearestPoint.id)) ?? [nearestPoint];
    const runFirstPoint = seriesRun[0] ?? nearestPoint;
    const runLastPoint = seriesRun[seriesRun.length - 1] ?? nearestPoint;
    const curveX = Math.min(Math.max(hoverX, runFirstPoint.x), runLastPoint.x);
    const focusY = getSmoothPathPointAtX(seriesRun, "focusY", curveX)?.y
      ?? previousPoint.focusY;
    const driftY = getSmoothPathPointAtX(seriesRun, "driftY", curveX)?.y
      ?? previousPoint.driftY;
    const focusDistance = Math.abs(chartY - focusY);
    const driftDistance = Math.abs(chartY - driftY);
    const distance = Math.min(focusDistance, driftDistance);

    if (distance > 24) {
      setHover(null);
      return;
    }

    const kind: FocusDriftHoverKind = focusDistance <= driftDistance ? "focus" : "drift";
    // The card describes one 30-minute window, so the dot shares that
    // window's x coordinate. Its y still comes from the rendered spline,
    // never from the raw source control point.
    setHover(buildHoverState(nearestPoint, kind, event.clientX, event.clientY));
  }

  return (
    <section className={`editorial-panel editorial-panel--soft insight-chart-panel${loading ? " insight-chart-panel--loading" : ""}`} aria-busy={loading || undefined}>
        <div className="insight-panel-head">
          <span className="label-mono">{t("dashboard.today.focusDriftTitle")}</span>
          <div className="insight-panel-head__legend">
            <span className="chip green"><span className="sw" style={{ background: "var(--productivity-focus)" }} />{t("activity.productivity.focus")}</span>
            <span className="chip warn"><span className="sw" style={{ background: "var(--productivity-drift)" }} />{t("activity.productivity.drift")}</span>
          </div>
        </div>
        {shouldRenderChart ? (
          <div
            className={`focus-drift${chart.isLive ? " focus-drift--live" : ""}${chart.revealX !== null ? " focus-drift--reveal" : ""}`}
            aria-label={sectionAriaLabel}
          >
            <div className="focus-drift__plot" style={plotStyle}>
              <span id={keyboardHintId} className="sr-only">{t("dashboard.today.focusDriftKeyboardHint")}</span>
              <svg className="focus-drift__svg" viewBox="0 0 100 100" preserveAspectRatio="none" role="group" aria-label={svgAriaLabel} onKeyDown={moveKeyboardStop}>
                <defs>
                  <clipPath id="focus-drift-chart-bounds" clipPathUnits="userSpaceOnUse">
                    <rect x={FOCUS_DRIFT_CLIP_BOUNDS.left} y={FOCUS_DRIFT_CLIP_BOUNDS.top} width={FOCUS_DRIFT_CLIP_BOUNDS.right - FOCUS_DRIFT_CLIP_BOUNDS.left} height={FOCUS_DRIFT_CLIP_BOUNDS.bottom - FOCUS_DRIFT_CLIP_BOUNDS.top} />
                  </clipPath>
                  {revealClipWidth !== null ? (
                    <clipPath id="focus-drift-chart-reveal" clipPathUnits="userSpaceOnUse">
                      <rect x={FOCUS_DRIFT_CLIP_BOUNDS.left} y={FOCUS_DRIFT_CLIP_BOUNDS.top} width={revealClipWidth} height={FOCUS_DRIFT_CLIP_BOUNDS.bottom - FOCUS_DRIFT_CLIP_BOUNDS.top} />
                    </clipPath>
                  ) : null}
                  <linearGradient id="focus-drift-chart-drift-mist" x1="0" x2="0" y1="0" y2="1">
                    <stop className="focus-drift__drift-mist-stop--strong" offset="0%" />
                    <stop className="focus-drift__drift-mist-stop--soft" offset="78%" />
                    <stop className="focus-drift__drift-mist-stop--clear" offset="100%" />
                  </linearGradient>
                </defs>
                <path className="focus-drift__grid" d={FOCUS_DRIFT_GRID_PATH} />
                {/* The "future / pending" shaded region (a box from now to the
                    day's end that only appeared on today) was removed — it read
                    as a stray box and the now-marker + curve already convey the
                    current time, keeping every day visually consistent. */}
                {shouldRenderSeries ? (
                  <g clipPath={chartClipPath}>
                    <path className="focus-drift__area" d={chart.focusAreaPath} />
                    <path className="focus-drift__drift-mist" d={chart.driftAreaPath} />
                    <path className="focus-drift__line focus-drift__line--focus" d={chart.focusPath} />
                    <path className="focus-drift__line focus-drift__line--drift" d={chart.driftPath} />
                  </g>
                ) : null}
                <rect className="focus-drift__line-target" x={FOCUS_DRIFT_CHART_BOUNDS.left} y={FOCUS_DRIFT_CHART_BOUNDS.top} width={FOCUS_DRIFT_CHART_BOUNDS.right - FOCUS_DRIFT_CHART_BOUNDS.left} height={100 - FOCUS_DRIFT_CHART_BOUNDS.top} aria-label={t("dashboard.today.focusDriftHoverTarget")} onMouseEnter={updateLineHover} onMouseMove={updateLineHover} onMouseLeave={clearHover} />
                {hoverPoints.map((point, index) => (
                  <g key={point.id}>
                    <circle className="focus-drift__target focus-drift__target--focus" cx={point.x} cy={point.focusY} r="3" role="img" tabIndex={keyboardStop.kind === "focus" && stopIndex === index ? 0 : -1} aria-describedby={!arrowKeysUsed && keyboardStop.kind === "focus" && stopIndex === index ? keyboardHintId : undefined} data-focus-drift-stop={`focus:${index}`} aria-label={formatFocusDriftHoverLabel(point, "focus", effectiveLanguage, startOfDayMinutes)} onFocus={(event) => { setKeyboardStop({ kind: "focus", index }); updateKeyboardHover("focus", point, event); }} onBlur={clearHover} />
                    <circle className="focus-drift__target focus-drift__target--drift" cx={point.x} cy={point.driftY} r="3" role="img" tabIndex={keyboardStop.kind === "drift" && stopIndex === index ? 0 : -1} aria-describedby={!arrowKeysUsed && keyboardStop.kind === "drift" && stopIndex === index ? keyboardHintId : undefined} data-focus-drift-stop={`drift:${index}`} aria-label={formatFocusDriftHoverLabel(point, "drift", effectiveLanguage, startOfDayMinutes)} onFocus={(event) => { setKeyboardStop({ kind: "drift", index }); updateKeyboardHover("drift", point, event); }} onBlur={clearHover} />
                  </g>
                ))}
              </svg>
              {shouldRenderMarker ? (
                <div
                  className={`focus-drift__now-marker${chart.revealX !== null ? " focus-drift__now-marker--replay" : ""}`}
                  aria-hidden="true"
                />
              ) : null}
              {hover ? (
                /* The visible marker is outside the stretched SVG so it stays
                   circular, then snaps to the same window as the hover card. */
                <div
                  className={`focus-drift__hover-dot focus-drift__hover-dot--${hover.kind}`}
                  style={{
                    left: `${hover.markerX}%`,
                    top: `${hover.markerY}%`,
                  }}
                  aria-hidden="true"
                />
              ) : null}
              <div className="focus-drift__scale" aria-hidden="true">
                {FOCUS_DRIFT_Y_AXIS_TICKS.map((tick) => (
                  <span key={tick.label} style={scaleTickStyle(tick.y)}>{tick.label}</span>
                ))}
              </div>
            </div>
            {hover ? <FocusDriftHoverCard appIcons={appIcons} hover={hover} startOfDayMinutes={startOfDayMinutes} /> : null}
            <div className="focus-drift__axis" aria-hidden="true">
              {chart.axisTicks.map((tick, index) => (
                <span
                  key={tick.id}
                  className={index > 0 && index < chart.axisTicks.length - 1 && index % 2 === 1 ? "focus-drift__axis-tick--dense" : undefined}
                  style={axisTickStyle(tick.x)}
                >
                  {effectiveLanguage === "ko" ? localizeCompactHourTick(tick.label) : tick.label}
                </span>
              ))}
            </div>
          </div>
        ) : <EmptyState title={t("dashboard.today.noFocusPattern")} detail={t("dashboard.today.noFocusPatternDetail")} />}
    </section>
  );
});

function localizeCompactHourTick(label: string): string {
  const match = /^(\d{1,2})(am|pm)$/iu.exec(label);
  if (!match) return label;
  const hour = Number(match[1]) % 12 + (match[2].toLowerCase() === "pm" ? 12 : 0);
  return `${hour}시`;
}
