import { AppGlyph } from "../../components/AppGlyph";
import { SiteFavicon } from "../../components/SiteFavicon";
import type { WeekCalendarEvent, WeekCalendarEventIdentity, WeekCalendarEventStyle, WeekCalendarNowMarkerStyle, WeekDayRow } from "./weekCalendar";
import { CATEGORY_COLORS, PRODUCTIVITY_COLORS, categoryLabel, productivityLabel } from "../../lib/activityLabels";
import { clockHourForLogicalHour, formatCalendarMinuteLabel, formatCompactDurationFromSeconds, formatDuration, formatHourLabel, logicalTodayIsoDate } from "../../lib/formatting";
import { buildAppUsageSummaries, logicalMinuteOfDay } from "@drifty/domain";
import type { ActivitySegment, AppIconMap, CategoryDuration, ClassificationOptions, ProductivityDuration } from "@drifty/domain";
import { WeekCalendarHoverLayer } from "./WeekCalendarHoverLayer";
import { buildWeekCalendarEventLayout, planWeekIdentityStrip } from "./weekCalendarEventLayout";
import { WEEK_DASHBOARD_AXIS_SCALE_DEFAULT_PERCENT, formatWeekDashboardAxisPixelValue, weekDashboardAxisScalePercentToHourHeight } from "./weekDashboardAxisScale";
import { useDeferredWeekIdentityIcons } from "./useDeferredWeekIdentityIcons";
import { CompactRingChart } from "./CompactRingChart";
import { CompactClassificationBar } from "./CompactClassificationBar";
import { buildActiveCategoryEntries, buildProductivityCenterPercent, buildProductivityRingEntries } from "./FlowCompactSplitChart";
import { BreakdownSidePanel } from "./BreakdownSidePanelChrome";
import { CompactClassificationHoverCard } from "./HoverCards";
import type { CompactClassificationHoverState } from "./HoverCards";
import { buildWeekBreakdownHoverRows } from "./weekBreakdownHover";
import { MetricTile } from "../../components/MetricTile";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

/* Width of .week-v2-calendar__time-rail (2.5rem at the 16px root font size). */
const WEEK_CALENDAR_TIME_RAIL_PX = 40;
/* Longer than one animation frame, well under the 340ms panel transition. */
const WEEK_CALENDAR_RESIZE_SETTLE_MS = 120;

export type WeekDashboardColorMode = "category" | "productivity";

const WEEK_COLOR_MODE_OPTIONS = [
  { id: "category", label: "Category" },
  { id: "productivity", label: "Productivity" },
] as const satisfies readonly { readonly id: WeekDashboardColorMode; readonly label: string }[];

/* Categories grouped by their productivity tone, mirroring the Day flow chart legend. */
const WEEK_LEGEND_GROUPS = [
  { productivity: "focus", categories: ["workspace", "learning"] },
  { productivity: "neutral", categories: ["communication", "music", "utility", "unknown"] },
  { productivity: "drift", categories: ["entertainment", "social_media", "shopping", "game"] },
] as const;

function WeekCalendarLegend({ colorMode }: { colorMode: WeekDashboardColorMode }) {
  if (colorMode === "productivity") {
    return (
      <div className="flow-chart-legend" aria-label="Week productivity tones">
        {WEEK_LEGEND_GROUPS.map((group) => (
          <span className="flow-chart-legend__group flow-chart-legend__group--productivity" key={group.productivity}>
            <span className="flow-chart-legend__parent flow-chart-legend__parent--tone" title={`${productivityLabel(group.productivity)} blocks`}>
              <span className="flow-chart-legend__tone-dot" style={{ "--flow-legend-tone": PRODUCTIVITY_COLORS[group.productivity] } as WeekLegendToneStyle} />
              {productivityLabel(group.productivity)}
            </span>
          </span>
        ))}
      </div>
    );
  }

  return (
    <div className="flow-chart-legend" aria-label="Week category tones">
      {WEEK_LEGEND_GROUPS.map((group) => (
        <span className="flow-chart-legend__group" key={group.productivity}>
          <span className="flow-chart-legend__parent" title={`${productivityLabel(group.productivity)} categories`}>
            {productivityLabel(group.productivity)}
          </span>
          <span className="flow-chart-legend__categories" aria-label={`${productivityLabel(group.productivity)} categories`}>
            {group.categories.map((category) => (
              <span
                aria-label={categoryLabel(category)}
                className={`flow-chart-legend__dot flow-chart-legend__dot--${category}`}
                key={category}
                title={categoryLabel(category)}
              />
            ))}
          </span>
        </span>
      ))}
    </div>
  );
}

type WeekLegendToneStyle = CSSProperties & { "--flow-legend-tone": string };

type WeekIdentityStripStyle = CSSProperties & {
  "--week-identity-tile": string;
  "--week-identity-gap": string;
};

type WeekSideTrendSegment = {
  readonly key: string;
  readonly label: string;
  readonly seconds: number;
  readonly heightPercent: number;
  readonly color: string;
  readonly title: string;
};

type WeekSideTrendColumn = {
  readonly day: string;
  readonly dayLabel: string;
  readonly totalSeconds: number;
  readonly off: boolean;
  readonly barHeightPercent: number;
  readonly segments: WeekSideTrendSegment[];
};

type WeekSideTrendChart = {
  readonly gridlines: { readonly label: string; readonly topPercent: number }[];
  readonly columns: WeekSideTrendColumn[];
};

type WeekSummaryMetrics = {
  readonly activeDayCount: number;
  readonly averageDailySeconds: number;
  readonly averageSessionMinutes: number;
  readonly peakDayLabel: string;
  readonly peakDaySeconds: number;
  readonly sessionCount: number;
  readonly topAppLabel: string;
  readonly uniqueAppsCount: number;
};

function buildWeekSummaryMetrics(
  rows: readonly WeekDayRow[],
  segments: readonly ActivitySegment[],
  totalSeconds: number,
): WeekSummaryMetrics {
  const activeRows = rows.filter((row) => row.totalSeconds > 0);
  const peakDay = activeRows.reduce<WeekDayRow | null>(
    (peak, row) => !peak || row.totalSeconds > peak.totalSeconds ? row : peak,
    null,
  );
  const topApp = buildAppUsageSummaries([...segments], { limit: 1, groupBy: "app" })[0] ?? null;
  const uniqueAppsCount = new Set(segments.map((segment) => segment.bundleId ?? segment.appName)).size;

  return {
    activeDayCount: activeRows.length,
    averageDailySeconds: activeRows.length > 0 ? Math.round(totalSeconds / activeRows.length) : 0,
    averageSessionMinutes: segments.length > 0 ? Math.round(totalSeconds / 60 / segments.length) : 0,
    peakDayLabel: peakDay?.dayName ?? "\u2014",
    peakDaySeconds: peakDay?.totalSeconds ?? 0,
    sessionCount: segments.length,
    topAppLabel: topApp?.appName ?? "No activity",
    uniqueAppsCount,
  };
}

const WEEK_SIDE_TREND_VLINE_LEFTS = [14.2857, 28.5714, 42.8571, 57.1429, 71.4286, 85.7143];
const WEEK_SIDE_TREND_STEP_CANDIDATES = [0.25, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24];

/** Compact Trends-style stacked bars for the Breakdown side panel. */
function buildWeekSideTrendChart(rows: WeekDayRow[], colorMode: WeekDashboardColorMode): WeekSideTrendChart {
  const maxHours = Math.max(...rows.map((row) => row.totalSeconds / 3600), 0);
  const axisMaxHours = maxHours > 0 ? maxHours / 0.93 : 1;
  const stepHours = WEEK_SIDE_TREND_STEP_CANDIDATES.find((candidate) => maxHours / candidate <= 4)
    ?? WEEK_SIDE_TREND_STEP_CANDIDATES[WEEK_SIDE_TREND_STEP_CANDIDATES.length - 1];
  const gridlines: { label: string; topPercent: number }[] = [];
  for (let value = stepHours; value <= maxHours + 1e-9; value += stepHours) {
    gridlines.push({
      label: `${Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "")}h`,
      topPercent: (1 - value / axisMaxHours) * 100,
    });
  }
  gridlines.reverse();

  const columns = rows.map((row) => {
    const off = row.totalSeconds <= 0;
    const slices = colorMode === "productivity"
      ? row.productivitySlices.map((slice) => ({
          key: slice.productivity,
          seconds: slice.totalSeconds,
          color: PRODUCTIVITY_COLORS[slice.productivity],
          label: productivityLabel(slice.productivity),
        }))
      : row.slices.map((slice) => ({
          key: slice.category,
          seconds: slice.totalSeconds,
          color: CATEGORY_COLORS[slice.category],
          label: categoryLabel(slice.category),
        }));
    return {
      day: row.day,
      dayLabel: row.dayName,
      totalSeconds: row.totalSeconds,
      off,
      barHeightPercent: Math.min((row.totalSeconds / (axisMaxHours * 3600)) * 100, 100),
      segments: slices.map((slice) => ({
        key: slice.key,
        label: slice.label,
        seconds: slice.seconds,
        heightPercent: off ? 0 : (slice.seconds / row.totalSeconds) * 100,
        color: slice.color,
        title: `${slice.label} · ${formatCompactDurationFromSeconds(slice.seconds)}`,
      })),
    };
  });

  return { gridlines, columns };
}

type WeekDashboardProps = {
  /** Page header (title + date navigator) rendered inside the calendar block
   *  for the 2026-07 dashboard redesign. */
  readonly header?: ReactNode;
  readonly rows: WeekDayRow[];
  readonly calendarEvents: Map<string, WeekCalendarEvent[]>;
  readonly segments: readonly ActivitySegment[];
  readonly classificationOptions: ClassificationOptions;
  readonly appIcons: AppIconMap;
  readonly startDay: string;
  readonly endDay: string;
  readonly categoryEntries: CategoryDuration[];
  readonly productivityEntries: ProductivityDuration[];
  readonly totalSeconds: number;
  readonly refreshStatus: "idle" | "loading" | "error";
  readonly startOfDayMinutes: number;
  readonly currentCalendarDay?: string;
  readonly currentMinuteOfDay?: number;
  readonly axisScalePercent?: number;
  /** Breakdown collapse state is owned by DashboardPage so Day and Week share
   *  one preference; standalone renders (tests) fall back to open. */
  readonly sideOpen?: boolean;
  readonly onToggleSide?: () => void;
};

export function WeekCalendarIdentityIcon({ identity, appIcons }: { identity: WeekCalendarEventIdentity; appIcons: AppIconMap }) {
  const iconSrc = appIcons[identity.bundleId ?? identity.appName] ?? appIcons[identity.appName] ?? null;
  if (identity.siteDomain) {
    return <SiteFavicon domain={identity.siteDomain} size={16} fallbackIconSrc={iconSrc} />;
  }

  return <AppGlyph appName={identity.label} iconSrc={identity.siteTitle ? null : iconSrc} size="sm" />;
}

export function WeekDashboard({
  header,
  rows,
  calendarEvents,
  segments,
  classificationOptions,
  appIcons,
  startDay,
  endDay,
  categoryEntries,
  productivityEntries,
  totalSeconds,
  refreshStatus,
  startOfDayMinutes,
  currentCalendarDay,
  currentMinuteOfDay,
  axisScalePercent = WEEK_DASHBOARD_AXIS_SCALE_DEFAULT_PERCENT,
  sideOpen: controlledSideOpen,
  onToggleSide,
}: WeekDashboardProps) {
  // Controlled by DashboardPage in the app (shared Day/Week preference);
  // standalone renders fall back to local state so the toggle still works.
  const [localSideOpen, setLocalSideOpen] = useState(true);
  const sideOpen = controlledSideOpen ?? localSideOpen;
  const toggleSide = onToggleSide ?? (() => setLocalSideOpen((open) => !open));
  const [colorMode, setColorMode] = useState<WeekDashboardColorMode>("category");
  const [breakdownHover, setBreakdownHover] = useState<CompactClassificationHoverState | null>(null);
  // Element state (not just a ref) so the hover layer's delegation effect can
  // re-subscribe when the calendar body mounts.
  const [calendarBodyElement, setCalendarBodyElement] = useState<HTMLDivElement | null>(null);
  const calendarScrollerRef = useRef<HTMLDivElement>(null);
  const calendarBodyRef = useRef<HTMLDivElement | null>(null);
  const setCalendarBody = useCallback((element: HTMLDivElement | null) => {
    calendarBodyRef.current = element;
    setCalendarBodyElement(element);
  }, []);
  const autoScrollKeyRef = useRef<string | null>(null);
  const refreshStatusLabel = refreshStatus === "loading" ? "Updating" : refreshStatus === "error" ? "Update failed" : null;
  const activeCategoryEntries = buildActiveCategoryEntries(categoryEntries);
  const productivityRingEntries = buildProductivityRingEntries(productivityEntries);
  const productivityCenterPercent = buildProductivityCenterPercent(productivityEntries);
  const summaryMetrics = useMemo(
    () => buildWeekSummaryMetrics(rows, segments, totalSeconds),
    [rows, segments, totalSeconds],
  );
  const sideTrendChart = useMemo(() => buildWeekSideTrendChart(rows, colorMode), [colorMode, rows]);
  const buildHoverRows = useCallback((key: string, mode: WeekDashboardColorMode, day?: string) => (
    buildWeekBreakdownHoverRows({
      segments,
      classificationOptions,
      startDay,
      endDay,
      startOfDayMinutes,
      mode,
      key,
      day,
    })
  ), [classificationOptions, endDay, segments, startDay, startOfDayMinutes]);
  const todayDay = logicalTodayIsoDate(startOfDayMinutes);
  const calendarStartHour = 0;
  const calendarEndHour = 24;
  const effectiveAxisScalePercent = axisScalePercent;
  const calendarHourHeight = weekDashboardAxisScalePercentToHourHeight(effectiveAxisScalePercent);
  const calendarHours = Array.from({ length: calendarEndHour - calendarStartHour }, (_, index) => calendarStartHour + index);
  const calendarRows = rows;
  const canMountIdentityIcons = useDeferredWeekIdentityIcons({ calendarEvents, endDay, startDay });
  const minCalendarMinute = calendarStartHour * 60;
  const maxCalendarMinute = calendarEndHour * 60;
  const isRealCurrentCalendarWeek = startDay <= todayDay && todayDay <= endDay;
  const realCurrentCalendarMinute = isRealCurrentCalendarWeek
    ? Math.min(maxCalendarMinute, Math.max(minCalendarMinute, logicalMinuteOfDay(new Date().getHours() * 60 + new Date().getMinutes(), startOfDayMinutes)))
    : null;
  const virtualCalendarDay = currentCalendarDay !== undefined && startDay <= currentCalendarDay && currentCalendarDay <= endDay
    ? currentCalendarDay
    : null;
  const hasVirtualCurrentCalendarMarker = virtualCalendarDay !== null && currentMinuteOfDay !== undefined;
  const markerCalendarDay = virtualCalendarDay ?? todayDay;
  const currentCalendarMinute = hasVirtualCurrentCalendarMarker
    ? Math.min(maxCalendarMinute, Math.max(minCalendarMinute, currentMinuteOfDay))
    : realCurrentCalendarMinute;
  const currentCalendarOffset = currentCalendarMinute === null
    ? null
    : ((currentCalendarMinute - minCalendarMinute) / 60) * calendarHourHeight;
  const currentCalendarLabel = currentCalendarMinute === null ? null : formatCalendarMinuteLabel(markerCalendarDay, currentCalendarMinute, startOfDayMinutes);
  const currentCalendarLineEnd = String(calendarRows.findIndex((row) => row.day === markerCalendarDay) + 3);
  const currentCalendarMarkerStyle: WeekCalendarNowMarkerStyle | null = currentCalendarOffset === null
    ? null
    : {
        "--week-calendar-now-offset": formatWeekDashboardAxisPixelValue(currentCalendarOffset),
        "--week-calendar-now-line-end": currentCalendarLineEnd,
      };
  const autoScrollTargetMinute = useMemo(() => {
    if (currentCalendarDay === undefined && realCurrentCalendarMinute !== null) return realCurrentCalendarMinute;

    const earliestEventOffset = calendarRows.reduce<number | null>((earliest, row) => {
      const firstEvent = calendarEvents.get(row.day)?.[0];
      if (!firstEvent) return earliest;
      return earliest === null ? firstEvent.topMinutes : Math.min(earliest, firstEvent.topMinutes);
    }, null);

    return earliestEventOffset === null
      ? minCalendarMinute
      : Math.min(maxCalendarMinute, Math.max(minCalendarMinute, minCalendarMinute + earliestEventOffset));
  }, [calendarEvents, calendarRows, currentCalendarDay, maxCalendarMinute, minCalendarMinute, realCurrentCalendarMinute]);

  // The calendar squishes (no horizontal scroll) while the Breakdown panel is
  // open, so the identity strips must adapt to the live day-column width
  // instead of always showing the model's 4-icon cap.
  const [dayColumnWidth, setDayColumnWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const body = calendarBodyRef.current;
    if (!body) return undefined;

    const updateDayColumnWidth = () => {
      const bodyWidth = body.getBoundingClientRect().width;
      const nextWidth = bodyWidth > 0 ? Math.round((bodyWidth - WEEK_CALENDAR_TIME_RAIL_PX) / 7) : null;
      setDayColumnWidth(nextWidth);
    };

    updateDayColumnWidth();
    if (typeof ResizeObserver !== "function") return undefined;
    // The Breakdown panel animates grid-template-columns for 340ms, which fires
    // the observer every frame; re-rendering the calendar per frame would fight
    // that layout animation, so wait for the size to settle and apply once.
    let settleTimeout = 0;
    const observer = new ResizeObserver(() => {
      window.clearTimeout(settleTimeout);
      settleTimeout = window.setTimeout(updateDayColumnWidth, WEEK_CALENDAR_RESIZE_SETTLE_MS);
    });
    observer.observe(body);
    return () => {
      observer.disconnect();
      window.clearTimeout(settleTimeout);
    };
  }, []);

  const eventsById = useMemo(() => {
    const byId = new Map<string, WeekCalendarEvent>();
    for (const events of calendarEvents.values()) {
      for (const event of events) byId.set(event.id, event);
    }
    return byId;
  }, [calendarEvents]);

  useLayoutEffect(() => {
    const scroller = calendarScrollerRef.current;
    const body = calendarBodyRef.current;
    if (!scroller || !body) return;

    const scrollKey = `${startDay}:${endDay}:${autoScrollTargetMinute}`;
    if (autoScrollKeyRef.current === scrollKey) return;

    const scrollerRect = scroller.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    const timelineOffset = ((autoScrollTargetMinute - minCalendarMinute) / 60) * calendarHourHeight;
    const bodyTop = bodyRect.top - scrollerRect.top + scroller.scrollTop;
    const weekTimelineViewportAnchorRatio = 0.58;
    const viewportAnchor = Math.max(96, scroller.clientHeight * weekTimelineViewportAnchorRatio);
    const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const nextScrollTop = Math.min(maxScrollTop, Math.max(0, bodyTop + timelineOffset - viewportAnchor));

    scroller.scrollTop = nextScrollTop;
    autoScrollKeyRef.current = scrollKey;
  }, [autoScrollTargetMinute, calendarHourHeight, endDay, minCalendarMinute, startDay]);

  return (
    <section className="week-v2" aria-label="Your week overview" data-week-axis-scale-percent={effectiveAxisScalePercent}>
      <div className={`week-v2-grid week-v2-grid--calendar${sideOpen ? " week-v2-grid--side-open" : ""}`}>
        <section className="week-v2-calendar editorial-panel editorial-panel--soft" aria-label="Week calendar schedule">
          {header}
          <div className="week-v2-calendar__legend" aria-label="Week legend">
            <div className="flow-chart-head__actions">
              <div className="seg flow-color-mode-control" aria-label="Week color mode">
                {WEEK_COLOR_MODE_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={option.id === colorMode ? "on" : undefined}
                    aria-pressed={option.id === colorMode}
                    onClick={() => {
                      setBreakdownHover(null);
                      setColorMode(option.id);
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <WeekCalendarLegend colorMode={colorMode} />
            </div>
            {refreshStatusLabel ? (
              <span className={`week-v2-summary__refresh week-v2-summary__refresh--${refreshStatus}`} aria-live="polite">{refreshStatusLabel}</span>
            ) : null}
          </div>
          <div ref={calendarScrollerRef} className="week-v2-calendar__scroller">
            <div className="week-v2-calendar__day-head" aria-hidden="true">
              <span />
              {calendarRows.map((row) => {
                const weekday = new Date(`${row.day}T12:00:00`).getDay();
                const isWeekend = weekday === 0 || weekday === 6;
                return (
                  <span className={`${isWeekend ? "is-weekend" : ""}${row.day === markerCalendarDay ? " is-today" : ""}`.trim()} key={row.day}>
                    <strong>{row.dayName}</strong>
                    <small>{row.dayNumber}</small>
                  </span>
                );
              })}
            </div>
            <div ref={setCalendarBody} className="week-v2-calendar__body" style={{ height: formatWeekDashboardAxisPixelValue((calendarEndHour - calendarStartHour) * calendarHourHeight) }}>
              <div className="week-v2-calendar__time-rail">
                {calendarHours.map((hour) => (
                  <span key={hour} style={{ top: formatWeekDashboardAxisPixelValue((hour - calendarStartHour) * calendarHourHeight) }}>{formatHourLabel(clockHourForLogicalHour(hour, startOfDayMinutes))}</span>
                ))}
                <span
                  className="week-v2-calendar__time-rail-endpoint"
                  style={{ top: formatWeekDashboardAxisPixelValue((calendarEndHour - calendarStartHour) * calendarHourHeight) }}
                >
                  {formatHourLabel(clockHourForLogicalHour(calendarEndHour, startOfDayMinutes))}
                </span>
              </div>
              {currentCalendarMarkerStyle && currentCalendarLabel ? (
                <div
                  className="week-v2-calendar__now-marker week-v2-calendar__now-marker--line"
                  style={currentCalendarMarkerStyle}
                  aria-hidden="true"
                >
                  <span className="week-v2-calendar__now-line" />
                  <span className="week-v2-calendar__now-cap" aria-hidden="true" />
                </div>
              ) : null}
              {calendarRows.map((row) => {
                const events = calendarEvents.get(row.day) ?? [];
                return (
                  <div className={`week-v2-calendar__day-column${row.day === markerCalendarDay ? " is-today" : ""}`} key={row.day}>
                    {calendarHours.map((hour) => (
                      <span className="week-v2-calendar__line" key={`${row.day}-${hour}`} style={{ top: formatWeekDashboardAxisPixelValue((hour - calendarStartHour) * calendarHourHeight) }} />
                    ))}
                    {events.map((event) => {
                      const eventLayout = buildWeekCalendarEventLayout(event, calendarHourHeight);
                      const identityStrip = planWeekIdentityStrip(
                        event.identities.length,
                        event.hiddenIdentityCount,
                        // Lane-stacked events render 24px narrower than the full column.
                        dayColumnWidth === null ? null : dayColumnWidth - (event.laneCount > 1 ? 24 : 0),
                      );
                      const eventStyle: WeekCalendarEventStyle = {
                        top: formatWeekDashboardAxisPixelValue((event.topMinutes / 60) * calendarHourHeight),
                        height: formatWeekDashboardAxisPixelValue(eventLayout.eventHeight),
                        left: event.laneCount > 1 ? `calc(${event.lane * 12}px + 4px)` : "4px",
                        width: event.laneCount > 1 ? "calc(100% - 32px)" : "calc(100% - 8px)",
                        zIndex: event.laneCount > 1 ? 10 + event.lane : 3,
                        "--event-tone": colorMode === "productivity" ? PRODUCTIVITY_COLORS[event.productivity] : CATEGORY_COLORS[event.category],
                      };
                      return (
                        <article
                          aria-label={event.detailTitle.replace(/\n/g, ", ")}
                          className={`week-v2-calendar__event week-v2-calendar__event--${event.productivity}${event.isShort ? " week-v2-calendar__event--short" : ""}${event.isGroupedCluster ? " week-v2-calendar__event--grouped" : ""}${eventLayout.isTinyEvent ? " week-v2-calendar__event--tiny" : ""}${eventLayout.isMicroEvent ? " week-v2-calendar__event--micro" : ""}${event.laneCount > 2 ? " week-v2-calendar__event--dense" : ""}${eventLayout.isCompactEvent ? " week-v2-calendar__event--compact" : ""}`}
                          data-event-id={event.id}
                          key={event.id}
                          tabIndex={0}
                          style={eventStyle}
                          title={event.detailTitle}
                        >
                          <span className={`category-dot category-dot--${event.category}`} aria-hidden="true" />
                          {eventLayout.showsIdentityStrip ? (
                            <span
                              className="week-v2-calendar__identity-strip"
                              style={identityStrip.tilePx !== 18 ? {
                                "--week-identity-tile": `${identityStrip.tilePx}px`,
                                "--week-identity-gap": `${identityStrip.gapPx}px`,
                              } as WeekIdentityStripStyle : undefined}
                              aria-hidden="true"
                            >
                              {event.identities.slice(0, identityStrip.visibleCount).map((identity) => (
                                <span className="week-v2-calendar__identity" key={identity.id} title={identity.label}>
                                  {canMountIdentityIcons ? <WeekCalendarIdentityIcon appIcons={appIcons} identity={identity} /> : null}
                                </span>
                              ))}
                              {identityStrip.hiddenCount > 0 ? (
                                <span className="week-v2-calendar__identity-more">+{identityStrip.hiddenCount}</span>
                              ) : null}
                            </span>
                          ) : null}
                          {eventLayout.hidesInlineText ? null : <strong className={event.isGroupedCluster && eventLayout.showsIdentityStrip ? "week-v2-calendar__event-label" : undefined}>{event.appName}</strong>}
                          {!eventLayout.isCompactEvent ? <small>{event.startLabel}–{event.endLabel}</small> : null}
                          {eventLayout.showsInlineDetail ? <em>{event.detailSummary}</em> : null}
                        </article>
                      );
                    })}
                  </div>
                );
              })}
              {currentCalendarMarkerStyle && currentCalendarLabel ? (
                <div
                  className="week-v2-calendar__now-marker week-v2-calendar__now-marker--overlay"
                  style={currentCalendarMarkerStyle}
                  aria-label={`Current time ${currentCalendarLabel}`}
                >
                  <span className="week-v2-calendar__now-label">{currentCalendarLabel}</span>
                </div>
              ) : null}
            </div>
          </div>
        </section>
        <WeekCalendarHoverLayer appIcons={appIcons} bodyElement={calendarBodyElement} eventsById={eventsById} />

        <BreakdownSidePanel
          open={sideOpen}
          onToggle={toggleSide}
          ariaLabel="Week time breakdown"
          toggleSubject="week breakdown"
        >
          <CompactRingChart
            title="Productivity"
            entries={productivityRingEntries}
            totalSeconds={totalSeconds}
            centerPercent={productivityCenterPercent}
            flowBlocks={[]}
            appIcons={appIcons}
            getAppBreakdown={(entry) => buildHoverRows(entry.key, "productivity")}
          />
          <CompactClassificationBar<CategoryDuration>
            title="Categories"
            ariaLabel="Week category classification"
            entries={activeCategoryEntries}
            totalSeconds={totalSeconds}
            getKey={(entry) => entry.category}
            getLabel={(entry) => categoryLabel(entry.category)}
            getColor={(entry) => CATEGORY_COLORS[entry.category]}
            getDotClassName={(entry) => `category-dot--${entry.category}`}
            getAppBreakdown={(entry) => buildHoverRows(entry.category, "category")}
            appIcons={appIcons}
            visibleLimit={5}
          />
          <section className="week-v2-side-card week-v2-side-card--weekly-breakdown" aria-label="Weekly breakdown">
            <span className="label-mono">Weekly breakdown</span>
            <div className="wt-plot">
              <div className="wt-grid">
                {sideTrendChart.gridlines.map((line) => (
                  <div className="wt-gridline" style={{ top: `${line.topPercent.toFixed(2)}%` }} key={`gl-${line.label}`}>
                    <span className="wt-gridlabel">{line.label}</span>
                  </div>
                ))}
                {WEEK_SIDE_TREND_VLINE_LEFTS.map((left) => (
                  <div className="wt-vline" style={{ left: `${left}%` }} key={`vl-${left}`} />
                ))}
              </div>
              <div className="wt-cols">
                {sideTrendChart.columns.map((column) => (
                  <div className={`wt-col${column.off ? " wt-col--off" : ""}`} key={column.day}>
                    <div className="wt-bars-zone">
                      {column.off ? null : (
                        <div className="wt-bar" style={{ height: `${column.barHeightPercent.toFixed(2)}%` }}>
                          {column.segments.map((segment) => (
                            <div
                              className="wt-seg"
                              style={{ height: `${segment.heightPercent.toFixed(2)}%`, background: segment.color }}
                              key={segment.key}
                              title={segment.title}
                              tabIndex={0}
                              role="img"
                              aria-label={`${column.dayLabel} ${segment.title}`}
                              onMouseEnter={(event) => setBreakdownHover({
                                label: segment.label,
                                durationLabel: formatCompactDurationFromSeconds(segment.seconds),
                                shareLabel: `${Math.round((segment.seconds / Math.max(column.totalSeconds, 1)) * 100)}%`,
                                dotClassName: colorMode === "productivity" ? `productivity-dot--${segment.key}` : `category-dot--${segment.key}`,
                                color: segment.color,
                                appBreakdown: buildHoverRows(segment.key, colorMode, column.day),
                                x: event.clientX,
                                y: event.clientY,
                              })}
                              onMouseMove={(event) => setBreakdownHover((current) => current ? { ...current, x: event.clientX, y: event.clientY } : current)}
                              onMouseLeave={() => setBreakdownHover(null)}
                              onFocus={(event) => {
                                const bounds = event.currentTarget.getBoundingClientRect();
                                setBreakdownHover({
                                  label: segment.label,
                                  durationLabel: formatCompactDurationFromSeconds(segment.seconds),
                                  shareLabel: `${Math.round((segment.seconds / Math.max(column.totalSeconds, 1)) * 100)}%`,
                                  dotClassName: colorMode === "productivity" ? `productivity-dot--${segment.key}` : `category-dot--${segment.key}`,
                                  color: segment.color,
                                  appBreakdown: buildHoverRows(segment.key, colorMode, column.day),
                                  x: bounds.left + bounds.width / 2,
                                  y: bounds.top + bounds.height / 2,
                                });
                              }}
                              onBlur={() => setBreakdownHover(null)}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="wt-daylabel">{column.dayLabel}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>
          <div className="kpi-row kpi-row--insights insight-summary" aria-label="Week summary metrics">
            <MetricTile
              className="insight-summary__tile insight-summary__tile--tracked"
              label="Tracked"
              value={formatDuration(totalSeconds)}
              detail={summaryMetrics.activeDayCount > 0
                ? `${formatCompactDurationFromSeconds(summaryMetrics.averageDailySeconds)} avg/day`
                : "No active days"}
            />
            <MetricTile
              className="insight-summary__tile insight-summary__tile--sessions"
              label="Sessions"
              value={String(summaryMetrics.sessionCount)}
              detail={summaryMetrics.sessionCount > 0 ? `${summaryMetrics.averageSessionMinutes}m avg` : "No sessions"}
            />
            <MetricTile
              className="insight-summary__tile insight-summary__tile--peak"
              label="Peak day"
              value={summaryMetrics.peakDayLabel}
              detail={summaryMetrics.peakDaySeconds > 0 ? formatCompactDurationFromSeconds(summaryMetrics.peakDaySeconds) : "No activity"}
            />
            <MetricTile
              className="insight-summary__tile insight-summary__tile--apps"
              label="Apps"
              value={String(summaryMetrics.uniqueAppsCount)}
              detail={summaryMetrics.topAppLabel}
            />
          </div>
        </BreakdownSidePanel>
        {breakdownHover ? <CompactClassificationHoverCard hover={breakdownHover} appIcons={appIcons} /> : null}
      </div>
    </section>
  );
}
