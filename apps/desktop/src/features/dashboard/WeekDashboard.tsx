import { AppGlyph } from "../../components/AppGlyph";
import { SiteFavicon } from "../../components/SiteFavicon";
import type { WeekCalendarEvent, WeekCalendarEventIdentity, WeekCalendarEventStyle, WeekCalendarNowMarkerStyle, WeekDayRow } from "./weekCalendar";
import { CATEGORY_COLORS, PRODUCTIVITY_COLORS } from "../../lib/activityLabels";
import { clockHourForLogicalHour, formatLocalizedCalendarMinuteLabel, formatLocalizedCompactDurationFromSeconds, formatLocalizedDuration, formatLocalizedHourLabel, logicalTodayIsoDate } from "../../lib/formatting";
import { buildAppUsageSummaries, logicalMinuteOfDay } from "@drifty/domain";
import type { ActivityCategory, ActivitySegment, AppIconMap, CategoryDuration, ClassificationOptions, ProductivityDuration, ProductivityLabel } from "@drifty/domain";
import { WeekCalendarHoverLayer } from "./WeekCalendarHoverLayer";
import {
  WeekActivityInspector,
  resolveActivityActionsDisabledReason,
  type ActivityInspectorEvent,
  type ActivityInspectorProjectOption,
  type ActivityInspectorSaveHandler,
  type ActivityInspectorView,
} from "./WeekActivityInspector";
import { buildWeekActivityInspectorEvent } from "./weekActivityInspectorEvent";
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
import { FlowChartLegend } from "../flow-chart/FlowChartLegend";
import type { FlowLegendBreakdownRequest } from "../flow-chart/FlowChartLegend";
import { FlowLegendHoverCard } from "../flow-chart/FlowChartHoverCards";
import type { FlowLegendHoverState } from "../flow-chart/FlowChartHoverCards";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useLocalization, type LocalizationController } from "../localization/LocalizationContext";
import { localizedCategoryLabel, localizedProductivityLabel } from "../localization/activityTranslations";
import type { GoogleCalendarWeekEvent } from "../calendar/googleCalendarWeek";
import type { GoogleCalendarWeekStatus } from "../calendar/useGoogleCalendarWeek";

/* Width of .week-v2-calendar__time-rail (2.5rem at the 16px root font size). */
const WEEK_CALENDAR_TIME_RAIL_PX = 40;
/* Longer than one animation frame, well under the 340ms panel transition. */
const WEEK_CALENDAR_RESIZE_SETTLE_MS = 120;
const EMPTY_ACTIVITY_INSPECTOR_PROJECT_OPTIONS: readonly ActivityInspectorProjectOption[] = [];
const EMPTY_PROJECT_BY_SEGMENT_ID: ReadonlyMap<string, string | null> = new Map();

export type WeekDashboardColorMode = "category" | "productivity";

const WEEK_COLOR_MODE_OPTIONS = ["category", "productivity"] as const satisfies readonly WeekDashboardColorMode[];

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
  language: "en" | "ko",
  t: LocalizationController["t"],
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
    peakDayLabel: peakDay
      ? new Intl.DateTimeFormat(language === "ko" ? "ko-KR" : "en-US", { weekday: "short" }).format(new Date(`${peakDay.day}T12:00:00`))
      : "\u2014",
    peakDaySeconds: peakDay?.totalSeconds ?? 0,
    sessionCount: segments.length,
    topAppLabel: topApp?.appName ?? t("dashboard.week.noActivity"),
    uniqueAppsCount,
  };
}

const WEEK_SIDE_TREND_VLINE_LEFTS = [14.2857, 28.5714, 42.8571, 57.1429, 71.4286, 85.7143];
const WEEK_SIDE_TREND_STEP_CANDIDATES = [0.25, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24];

/** Compact Trends-style stacked bars for the Breakdown side panel. */
function buildWeekSideTrendChart(
  rows: WeekDayRow[],
  colorMode: WeekDashboardColorMode,
  language: "en" | "ko",
  t: LocalizationController["t"],
): WeekSideTrendChart {
  const maxHours = Math.max(...rows.map((row) => row.totalSeconds / 3600), 0);
  const axisMaxHours = maxHours > 0 ? maxHours / 0.93 : 1;
  const stepHours = WEEK_SIDE_TREND_STEP_CANDIDATES.find((candidate) => maxHours / candidate <= 4)
    ?? WEEK_SIDE_TREND_STEP_CANDIDATES[WEEK_SIDE_TREND_STEP_CANDIDATES.length - 1];
  const gridlines: { label: string; topPercent: number }[] = [];
  for (let value = stepHours; value <= maxHours + 1e-9; value += stepHours) {
    gridlines.push({
      label: language === "ko"
        ? `${Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "")}시간`
        : `${Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "")}h`,
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
          label: localizedProductivityLabel(slice.productivity, t),
        }))
      : row.slices.map((slice) => ({
          key: slice.category,
          seconds: slice.totalSeconds,
          color: CATEGORY_COLORS[slice.category],
          label: localizedCategoryLabel(slice.category, t),
        }));
    return {
      day: row.day,
      dayLabel: new Intl.DateTimeFormat(language === "ko" ? "ko-KR" : "en-US", { weekday: "short" }).format(new Date(`${row.day}T12:00:00`)),
      totalSeconds: row.totalSeconds,
      off,
      barHeightPercent: Math.min((row.totalSeconds / (axisMaxHours * 3600)) * 100, 100),
      segments: slices.map((slice) => ({
        key: slice.key,
        label: slice.label,
        seconds: slice.seconds,
        heightPercent: off ? 0 : (slice.seconds / row.totalSeconds) * 100,
        color: slice.color,
        title: `${slice.label} · ${formatLocalizedCompactDurationFromSeconds(slice.seconds, language)}`,
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
  readonly googleCalendarEvents?: Map<string, GoogleCalendarWeekEvent[]>;
  readonly googleCalendarStatus?: GoogleCalendarWeekStatus;
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
  readonly deviceLabelById?: ReadonlyMap<string, string>;
  readonly activityActionsEnabled?: boolean;
  readonly projectOptions?: readonly ActivityInspectorProjectOption[];
  readonly projectBySegmentId?: ReadonlyMap<string, string | null>;
  readonly onSaveActivityValues?: ActivityInspectorSaveHandler;
  readonly onAssignProject?: (
    segments: readonly ActivitySegment[],
    projectId: string | null,
  ) => Promise<void>;
  readonly onClassifyActivity?: (
    segments: readonly ActivitySegment[],
    category: ActivityCategory,
    productivity: ProductivityLabel,
  ) => Promise<void>;
  readonly onDeleteActivity?: (segmentIds: readonly string[]) => Promise<void>;
};

type WeekActivityInspectorState = {
  readonly sessionId: number;
  readonly event: ActivityInspectorEvent;
  readonly sourceEventId: string;
  readonly sourceDay: string;
  readonly sourceSegmentIds: readonly string[];
  readonly regroupedBlockCount: number;
  readonly anchorElement: HTMLElement;
  readonly restoreFocusTarget: HTMLElement | null;
  readonly initialView: ActivityInspectorView;
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
  googleCalendarEvents = new Map(),
  googleCalendarStatus = "disabled",
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
  deviceLabelById,
  activityActionsEnabled = false,
  projectOptions = EMPTY_ACTIVITY_INSPECTOR_PROJECT_OPTIONS,
  projectBySegmentId = EMPTY_PROJECT_BY_SEGMENT_ID,
  onSaveActivityValues,
  onAssignProject,
  onClassifyActivity,
  onDeleteActivity,
}: WeekDashboardProps) {
  const { effectiveLanguage, t } = useLocalization();
  // Controlled by DashboardPage in the app (shared Day/Week preference);
  // standalone renders fall back to local state so the toggle still works.
  const [localSideOpen, setLocalSideOpen] = useState(true);
  const sideOpen = controlledSideOpen ?? localSideOpen;
  const toggleSide = onToggleSide ?? (() => setLocalSideOpen((open) => !open));
  const [colorMode, setColorMode] = useState<WeekDashboardColorMode>("category");
  const [legendHover, setLegendHover] = useState<FlowLegendHoverState | null>(null);
  const [breakdownHover, setBreakdownHover] = useState<CompactClassificationHoverState | null>(null);
  const [activityInspector, setActivityInspector] = useState<WeekActivityInspectorState | null>(null);
  const activityInspectorSessionIdRef = useRef(0);
  const activityInspectorRef = useRef(activityInspector);
  activityInspectorRef.current = activityInspector;
  const legendHoverCardRef = useRef<HTMLDivElement>(null);
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
  const refreshStatusLabel = refreshStatus === "loading" ? t("dashboard.week.updating") : refreshStatus === "error" ? t("dashboard.week.updateFailed") : null;
  const googleCalendarStatusLabel = googleCalendarStatus === "ready"
    ? t("dashboard.week.googleCalendarPlanned")
    : googleCalendarStatus === "loading"
      ? t("dashboard.week.googleCalendarLoading")
      : googleCalendarStatus === "error"
        ? t("dashboard.week.googleCalendarError")
        : null;
  const activeCategoryEntries = buildActiveCategoryEntries(categoryEntries);
  const productivityRingEntries = buildProductivityRingEntries(productivityEntries).map((entry) => ({
    ...entry,
    label: localizedProductivityLabel(entry.key as ProductivityLabel, t),
  }));
  const productivityCenterPercent = buildProductivityCenterPercent(productivityEntries);
  const summaryMetrics = useMemo(
    () => buildWeekSummaryMetrics(rows, segments, totalSeconds, effectiveLanguage, t),
    [effectiveLanguage, rows, segments, t, totalSeconds],
  );
  const sideTrendChart = useMemo(
    () => buildWeekSideTrendChart(rows, colorMode, effectiveLanguage, t),
    [colorMode, effectiveLanguage, rows, t],
  );
  const buildHoverRows = useCallback((key: string | readonly string[], mode: WeekDashboardColorMode, day?: string) => (
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
  const buildLegendHoverRows = useCallback((request: FlowLegendBreakdownRequest) => {
    switch (request.kind) {
      case "category": return buildHoverRows(request.category, "category");
      case "category-group": return buildHoverRows(request.categories, "category");
      case "productivity": return buildHoverRows(request.productivity, "productivity");
    }
  }, [buildHoverRows]);
  const hasUnclassified = categoryEntries.some((entry) => entry.category === "unknown" && entry.totalSeconds > 0);
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
  const currentCalendarLabel = currentCalendarMinute === null
    ? null
    : formatLocalizedCalendarMinuteLabel(markerCalendarDay, currentCalendarMinute, effectiveLanguage, startOfDayMinutes);
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

  const displayCalendarEvents = useMemo(() => {
    if (effectiveLanguage === "en") return calendarEvents;

    return new Map(Array.from(calendarEvents.entries()).map(([day, events]) => [
      day,
      events.map((event) => {
        const startMinute = minCalendarMinute + event.topMinutes;
        const endMinute = startMinute + event.durationMinutes;
        const startLabel = formatLocalizedCalendarMinuteLabel(day, startMinute, effectiveLanguage, startOfDayMinutes);
        const endLabel = formatLocalizedCalendarMinuteLabel(day, endMinute, effectiveLanguage, startOfDayMinutes);
        const categoryName = localizedCategoryLabel(event.category, t);
        const recordLabel = event.sessionCount === 1
          ? t("dashboard.week.inspector.record")
          : t("dashboard.week.inspector.records", { count: event.sessionCount });
        const detailSummary = event.isGroupedCluster || event.sessionCount > 1 ? recordLabel : categoryName;
        const detailTitle = [
          `${startLabel}–${endLabel} · ${categoryName}`,
          `${formatLocalizedCompactDurationFromSeconds(event.activeDurationMinutes * 60, effectiveLanguage)} · ${recordLabel}`,
          ...event.identities.slice(0, 3).map((identity) => (
            `${identity.label} · ${formatLocalizedCompactDurationFromSeconds(identity.seconds, effectiveLanguage)}`
          )),
        ].join("\n");

        return { ...event, startLabel, endLabel, detailSummary, detailTitle };
      }),
    ]));
  }, [calendarEvents, effectiveLanguage, minCalendarMinute, startOfDayMinutes, t]);

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
    for (const events of displayCalendarEvents.values()) {
      for (const event of events) byId.set(event.id, event);
    }
    return byId;
  }, [displayCalendarEvents]);
  const segmentsById = useMemo(
    () => new Map(segments.map((segment) => [segment.id, segment])),
    [segments],
  );
  const projectsById = useMemo(
    () => new Map(projectOptions.flatMap((project) => project.id ? [[project.id, project] as const] : [])),
    [projectOptions],
  );
  const inspectedSegments = useMemo(() => (
    activityInspector?.event.segmentIds.flatMap((segmentId) => {
      const segment = segmentsById.get(segmentId);
      return segment ? [segment] : [];
    }) ?? []
  ), [activityInspector, segmentsById]);
  const closeActivityInspector = useCallback((restoreFocus = true) => {
    const restoreFocusTarget = activityInspectorRef.current?.restoreFocusTarget ?? null;
    setActivityInspector(null);
    if (!restoreFocus) return;
    window.setTimeout(() => {
      if (restoreFocusTarget?.isConnected) {
        const activeElement = document.activeElement;
        if (activeElement && activeElement !== document.body && activeElement !== restoreFocusTarget && activeElement.isConnected) return;
        restoreFocusTarget.dataset.activityPreviewFocusSuppressed = "true";
        restoreFocusTarget.focus();
        if (restoreFocusTarget.dataset.activityPreviewFocusSuppressed === "true") {
          delete restoreFocusTarget.dataset.activityPreviewFocusSuppressed;
        }
      }
    }, 0);
  }, []);
  const openActivityInspector = useCallback((
    event: WeekCalendarEvent,
    target: HTMLElement,
    initialView: ActivityInspectorView = "overview",
  ) => {
    const eventElement = target.closest<HTMLElement>(".week-v2-calendar__event") ?? target;
    const sourceDay = eventElement.closest<HTMLElement>(".week-v2-calendar__day-column")?.dataset.weekDay;
    if (!sourceDay) return;
    const restoreFocusTarget = eventElement.querySelector<HTMLElement>(".week-v2-calendar__event-open") ?? target;
    activityInspectorSessionIdRef.current += 1;
    setActivityInspector({
      sessionId: activityInspectorSessionIdRef.current,
      event: buildWeekActivityInspectorEvent(event, segmentsById, projectBySegmentId, projectsById),
      sourceEventId: event.id,
      sourceDay,
      sourceSegmentIds: [...new Set(event.segmentIds)],
      regroupedBlockCount: 1,
      anchorElement: eventElement,
      restoreFocusTarget,
      initialView,
    });
  }, [projectBySegmentId, projectsById, segmentsById]);

  // A direct classification can regroup the calendar event and therefore
  // change its generated id. Keep the pinned inspector on the event that still
  // contains the greatest number of its source records, and update the anchor
  // before the detached-element observer gets a chance to close it.
  useLayoutEffect(() => {
    setActivityInspector((current) => {
      if (!current) return current;
      const sourceIds = new Set(current.sourceSegmentIds);
      const candidates = (displayCalendarEvents.get(current.sourceDay) ?? [])
        .map((candidate) => ({
          event: candidate,
          overlap: candidate.segmentIds.reduce((count, segmentId) => count + (sourceIds.has(segmentId) ? 1 : 0), 0),
        }))
        .filter((candidate) => candidate.overlap > 0);
      const nextCandidate = candidates.reduce<(typeof candidates)[number] | null>((best, candidate) => {
        if (!best || candidate.overlap > best.overlap) return candidate;
        if (candidate.overlap < best.overlap) return best;
        if (candidate.event.id === current.sourceEventId) return candidate;
        return best;
      }, null);
      const nextEvent = nextCandidate?.event ?? null;
      if (!nextEvent) return null;

      const nextAnchor = Array.from(calendarBodyRef.current?.querySelectorAll<HTMLElement>(".week-v2-calendar__event[data-event-id]") ?? [])
        .find((element) => element.dataset.eventId === nextEvent?.id) ?? null;
      if (!nextAnchor) return current;
      const regroupedBlockCount = candidates.length;
      return {
        ...current,
        // The rendered block is only the moving anchor. The inspector and Undo
        // continue to own the exact records selected when this session opened,
        // even if the timeline later splits or merges them with other records.
        event: { ...current.event, id: nextEvent.id, segmentIds: current.sourceSegmentIds },
        sourceEventId: nextEvent.id,
        regroupedBlockCount,
        anchorElement: nextAnchor,
        restoreFocusTarget: nextAnchor.querySelector<HTMLElement>(".week-v2-calendar__event-open"),
      };
    });
  }, [displayCalendarEvents, projectBySegmentId, projectsById, segmentsById]);
  const activityActionsDisabledReason = useMemo(() => {
    if (!activityInspector) return null;
    return resolveActivityActionsDisabledReason(
      activityInspector.event,
      inspectedSegments,
      activityActionsEnabled,
      t,
    );
  }, [activityActionsEnabled, activityInspector, inspectedSegments, t]);

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
    <section className="week-v2" aria-label={t("dashboard.week.overviewAria")} data-week-axis-scale-percent={effectiveAxisScalePercent}>
      <div className={`week-v2-grid week-v2-grid--calendar${sideOpen ? " week-v2-grid--side-open" : ""}`}>
        <section className="week-v2-calendar editorial-panel editorial-panel--soft" aria-label={t("dashboard.week.calendarAria")}>
          {header}
          <div className="week-v2-calendar__legend" aria-label={t("dashboard.week.legendAria")}>
            <div className="flow-chart-head__actions">
              <div className="seg flow-color-mode-control" aria-label={t("dashboard.week.colorModeAria")}>
                {WEEK_COLOR_MODE_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={option === colorMode ? "on" : undefined}
                    aria-pressed={option === colorMode}
                    onClick={() => {
                      setBreakdownHover(null);
                      setLegendHover(null);
                      setColorMode(option);
                    }}
                  >
                    {t(option === "category" ? "common.category" : "common.productivity")}
                  </button>
                ))}
              </div>
              <FlowChartLegend
                ariaLabel={t(colorMode === "category" ? "dashboard.week.categoryTones" : "dashboard.week.productivityTones")}
                colorMode={colorMode}
                getAppBreakdown={buildLegendHoverRows}
                hasUnclassified={hasUnclassified}
                hoveredLegendCardRef={legendHoverCardRef}
                setHoveredLegend={setLegendHover}
              />
              {googleCalendarStatusLabel ? (
                <span className={`week-v2-calendar__calendar-key week-v2-calendar__calendar-key--${googleCalendarStatus}`} aria-live="polite">
                  <span aria-hidden="true" />
                  {googleCalendarStatusLabel}
                </span>
              ) : null}
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
                    <strong>{new Intl.DateTimeFormat(effectiveLanguage === "ko" ? "ko-KR" : "en-US", { weekday: "short" }).format(new Date(`${row.day}T12:00:00`))}</strong>
                    <small>{row.dayNumber}</small>
                  </span>
                );
              })}
            </div>
            <div ref={setCalendarBody} className="week-v2-calendar__body" style={{ height: formatWeekDashboardAxisPixelValue((calendarEndHour - calendarStartHour) * calendarHourHeight) }}>
              <div className="week-v2-calendar__time-rail">
                {calendarHours.map((hour) => (
                  <span key={hour} style={{ top: formatWeekDashboardAxisPixelValue((hour - calendarStartHour) * calendarHourHeight) }}>{formatLocalizedHourLabel(clockHourForLogicalHour(hour, startOfDayMinutes), effectiveLanguage)}</span>
                ))}
                <span
                  className="week-v2-calendar__time-rail-endpoint"
                  style={{ top: formatWeekDashboardAxisPixelValue((calendarEndHour - calendarStartHour) * calendarHourHeight) }}
                >
                  {formatLocalizedHourLabel(clockHourForLogicalHour(calendarEndHour, startOfDayMinutes), effectiveLanguage)}
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
                const events = displayCalendarEvents.get(row.day) ?? [];
                const plannedEvents = googleCalendarEvents.get(row.day) ?? [];
                return (
                  <div className={`week-v2-calendar__day-column${row.day === markerCalendarDay ? " is-today" : ""}`} data-week-day={row.day} key={row.day}>
                    {calendarHours.map((hour) => (
                      <span className="week-v2-calendar__line" key={`${row.day}-${hour}`} style={{ top: formatWeekDashboardAxisPixelValue((hour - calendarStartHour) * calendarHourHeight) }} />
                    ))}
                    {plannedEvents.map((event) => {
                      const allDayIndex = event.allDay
                        ? plannedEvents.filter((candidate) => candidate.allDay).findIndex((candidate) => candidate.id === event.id)
                        : -1;
                      const eventHeight = event.allDay
                        ? 18
                        : Math.max(12, (event.durationMinutes / 60) * calendarHourHeight);
                      const eventTop = event.allDay
                        ? 2 + Math.max(0, allDayIndex) * 20
                        : (event.startMinute / 60) * calendarHourHeight;
                      const timeLabel = event.allDay
                        ? t("dashboard.week.googleCalendarAllDay")
                        : `${formatLocalizedCalendarMinuteLabel(row.day, event.startMinute, effectiveLanguage, startOfDayMinutes)}–${formatLocalizedCalendarMinuteLabel(row.day, event.startMinute + event.durationMinutes, effectiveLanguage, startOfDayMinutes)}`;
                      return (
                        <article
                          className={`week-v2-calendar__scheduled-event${event.allDay ? " week-v2-calendar__scheduled-event--all-day" : ""}`}
                          key={event.id}
                          role="note"
                          aria-label={t("dashboard.week.googleCalendarEvent", { title: event.title, time: timeLabel })}
                          title={`${event.title}\n${timeLabel}`}
                          style={{
                            top: formatWeekDashboardAxisPixelValue(eventTop),
                            height: formatWeekDashboardAxisPixelValue(eventHeight),
                          }}
                        >
                          <strong>{event.title}</strong>
                          {!event.allDay && eventHeight >= 30 ? <small>{timeLabel}</small> : null}
                        </article>
                      );
                    })}
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
                          className={`week-v2-calendar__event week-v2-calendar__event--${event.productivity}${event.isShort ? " week-v2-calendar__event--short" : ""}${event.isGroupedCluster ? " week-v2-calendar__event--grouped" : ""}${eventLayout.isTinyEvent ? " week-v2-calendar__event--tiny" : ""}${eventLayout.isMicroEvent ? " week-v2-calendar__event--micro" : ""}${event.laneCount > 2 ? " week-v2-calendar__event--dense" : ""}${eventLayout.isCompactEvent ? " week-v2-calendar__event--compact" : ""}${activityInspector?.event.id === event.id ? " is-inspected" : ""}`}
                          data-event-id={event.id}
                          key={event.id}
                          onContextMenu={(contextMenuEvent) => {
                            contextMenuEvent.preventDefault();
                            openActivityInspector(
                              event,
                              contextMenuEvent.target instanceof HTMLElement ? contextMenuEvent.target : contextMenuEvent.currentTarget,
                            );
                          }}
                          style={eventStyle}
                        >
                          <button
                            type="button"
                            className="week-v2-calendar__event-open"
                            aria-label={`${event.detailTitle.replace(/\n/g, ", ")}. ${t("dashboard.week.openActivity")}.`}
                            aria-haspopup="dialog"
                            aria-expanded={activityInspector?.event.id === event.id}
                            data-activity-inspector-trigger="true"
                            title={event.detailTitle}
                            onClick={(clickEvent) => openActivityInspector(event, clickEvent.currentTarget)}
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
                          </button>
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
                  aria-label={t("dashboard.week.currentTime", { time: currentCalendarLabel })}
                >
                  <span className="week-v2-calendar__now-label">{currentCalendarLabel}</span>
                </div>
              ) : null}
            </div>
          </div>
        </section>
        <WeekCalendarHoverLayer
          appIcons={appIcons}
          bodyElement={calendarBodyElement}
          eventsById={eventsById}
          segmentsById={segmentsById}
          deviceLabelById={deviceLabelById}
          activityActionsEnabled={activityActionsEnabled}
          classificationOptions={classificationOptions}
          projectOptions={projectOptions}
          projectBySegmentId={projectBySegmentId}
          hasAssignProjectAction={Boolean(onSaveActivityValues || onAssignProject)}
          hasClassifyAction={Boolean(onSaveActivityValues || onClassifyActivity)}
          hasDeleteAction={Boolean(onDeleteActivity)}
          onOpenActivity={openActivityInspector}
          disabled={activityInspector !== null}
        />
        {activityInspector ? (
          <WeekActivityInspector
            key={activityInspector.sessionId}
            event={activityInspector.event}
            segments={inspectedSegments}
            appIcons={appIcons}
            deviceLabelById={deviceLabelById}
            anchorElement={activityInspector.anchorElement}
            actionsDisabledReason={activityActionsDisabledReason}
            projectOptions={projectOptions}
            initialView={activityInspector.initialView}
            regroupedBlockCount={activityInspector.regroupedBlockCount}
            onClose={closeActivityInspector}
            onSaveValues={onSaveActivityValues}
            onAssignProject={onAssignProject}
            onClassify={onClassifyActivity}
            onDelete={onDeleteActivity}
            classificationOptions={classificationOptions}
          />
        ) : null}
        {legendHover && !activityInspector ? <FlowLegendHoverCard hover={legendHover} appIcons={appIcons} cardRef={legendHoverCardRef} /> : null}

        <BreakdownSidePanel
          open={sideOpen}
          onToggle={toggleSide}
          ariaLabel={t("dashboard.week.breakdownAria")}
          toggleSubject={t("dashboard.week.breakdownSubject")}
          title={t("dashboard.today.breakdown")}
          showLabel={t("dashboard.week.showBreakdown")}
          collapseLabel={t("dashboard.week.collapseBreakdown")}
        >
          <CompactRingChart
            title={t("common.productivity")}
            entries={productivityRingEntries}
            totalSeconds={totalSeconds}
            centerPercent={productivityCenterPercent}
            flowBlocks={[]}
            appIcons={appIcons}
            getAppBreakdown={(entry) => buildHoverRows(entry.key, "productivity")}
            language={effectiveLanguage}
          />
          <CompactClassificationBar<CategoryDuration>
            title={t("dashboard.today.categories")}
            ariaLabel={t("dashboard.week.categoryAria")}
            entries={activeCategoryEntries}
            totalSeconds={totalSeconds}
            getKey={(entry) => entry.category}
            getLabel={(entry) => localizedCategoryLabel(entry.category, t)}
            getColor={(entry) => CATEGORY_COLORS[entry.category]}
            getDotClassName={(entry) => `category-dot--${entry.category}`}
            getAppBreakdown={(entry) => buildHoverRows(entry.category, "category")}
            appIcons={appIcons}
            visibleLimit={5}
            language={effectiveLanguage}
          />
          <section className="week-v2-side-card week-v2-side-card--weekly-breakdown" aria-label={t("dashboard.week.weeklyBreakdown")}>
            <span className="label-mono">{t("dashboard.week.weeklyBreakdown")}</span>
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
                                durationLabel: formatLocalizedCompactDurationFromSeconds(segment.seconds, effectiveLanguage),
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
                                  durationLabel: formatLocalizedCompactDurationFromSeconds(segment.seconds, effectiveLanguage),
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
          <div className="kpi-row kpi-row--insights insight-summary" aria-label={t("dashboard.week.summaryAria")}>
            <MetricTile
              className="insight-summary__tile insight-summary__tile--tracked"
              label={t("common.tracked")}
              value={formatLocalizedDuration(totalSeconds, effectiveLanguage)}
              detail={summaryMetrics.activeDayCount > 0
                ? t("dashboard.week.averagePerDay", { duration: formatLocalizedCompactDurationFromSeconds(summaryMetrics.averageDailySeconds, effectiveLanguage) })
                : t("dashboard.week.noActiveDays")}
            />
            <MetricTile
              className="insight-summary__tile insight-summary__tile--sessions"
              label={t("common.sessions")}
              value={String(summaryMetrics.sessionCount)}
              detail={summaryMetrics.sessionCount > 0 ? t("dashboard.week.averageValue", { minutes: summaryMetrics.averageSessionMinutes }) : t("dashboard.week.noSessions")}
            />
            <MetricTile
              className="insight-summary__tile insight-summary__tile--peak"
              label={t("dashboard.week.peakDay")}
              value={summaryMetrics.peakDayLabel}
              detail={summaryMetrics.peakDaySeconds > 0 ? formatLocalizedCompactDurationFromSeconds(summaryMetrics.peakDaySeconds, effectiveLanguage) : t("dashboard.week.noActivity")}
            />
            <MetricTile
              className="insight-summary__tile insight-summary__tile--apps"
              label={t("common.apps")}
              value={String(summaryMetrics.uniqueAppsCount)}
              detail={summaryMetrics.topAppLabel}
            />
          </div>
        </BreakdownSidePanel>
        {breakdownHover && !activityInspector ? <CompactClassificationHoverCard hover={breakdownHover} appIcons={appIcons} /> : null}
      </div>
    </section>
  );
}
