import type { Ref } from "react";
import { AppGlyph } from "../../components/AppGlyph";
import { SiteFavicon } from "../../components/SiteFavicon";
import type { WeekCalendarEvent, WeekCalendarEventIdentity, WeekCalendarEventStyle, WeekCalendarNowMarkerStyle, WeekDayRow } from "./weekCalendar";
import { CATEGORY_COLORS, PRODUCTIVITY_COLORS } from "../../lib/activityLabels";
import { localeForDisplayLanguage, clockHourForLogicalHour, formatLocalizedCalendarMinuteLabel, formatLocalizedCompactDurationFromSeconds, formatLocalizedDayLabel, formatLocalizedDuration, formatLocalizedCompactHourLabel, logicalTodayIsoDate } from "../../lib/formatting";
import { buildAppUsageSummaries, logicalMinuteOfDay } from "@drifty/domain";
import type { ActivityCategory, ActivitySegment, AppIconMap, CategoryDuration, ClassificationOptions, ProductivityDuration, ProductivityLabel, ProductivityLevel, ProjectAssignmentRecord, ProjectWindowAssignmentRecord } from "@drifty/domain";
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
import {
  buildWeekCalendarEventLayout,
  planWeekIdentityStrip,
  WEEK_CALENDAR_BASE_ROOT_FONT_SIZE_PX,
} from "./weekCalendarEventLayout";
import { WEEK_DASHBOARD_AXIS_SCALE_DEFAULT_PERCENT, formatWeekDashboardAxisPixelValue, weekDashboardAxisScalePercentToHourHeight } from "./weekDashboardAxisScale";
import { WeekCalendarBoard } from "./weekCalendarBoard";
import { useDeferredWeekIdentityIcons } from "./useDeferredWeekIdentityIcons";
import { CompactRingChart } from "./CompactRingChart";
import { CompactClassificationBar } from "./CompactClassificationBar";
import { buildActiveCategoryEntries, buildProductivityCenterPercent, buildProductivityRingEntries } from "./FlowCompactSplitChart";
import { levelFor, neutralSecondsByCategory, withLevelRingEntries, withLevelSlices } from "../productivity-levels/productivityLevelView";
import { useProductivityLevels } from "../settings/categoryCustomizationStore";
import { BreakdownSidePanel } from "./BreakdownSidePanelChrome";
import { CompactClassificationHoverCard } from "./HoverCards";
import type { CompactClassificationHoverState } from "./HoverCards";
import { buildWeekBreakdownHoverRows } from "./weekBreakdownHover";
import { buildWeekProjectView, type WeekProjectSlice } from "./weekProjectView";
import { MetricTile } from "../../components/MetricTile";
import { FlowChartLegend } from "../flow-chart/FlowChartLegend";
import type { FlowLegendBreakdownRequest } from "../flow-chart/FlowChartLegend";
import { FlowLegendHoverCard } from "../flow-chart/FlowChartHoverCards";
import type { FlowLegendHoverState } from "../flow-chart/FlowChartHoverCards";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useLocalization, type LocalizationController } from "../localization/LocalizationContext";
import { localizedCategoryLabel, localizedExcludedIdentityLabel, localizedProductivityLabel } from "../localization/activityTranslations";
import type { GoogleCalendarWeekEvent } from "../calendar/googleCalendarWeek";
import type { GoogleCalendarWeekStatus } from "../calendar/useGoogleCalendarWeek";
import { WeekDashboardLoadingBreakdown, WeekDashboardLoadingLegend } from "./WeekDashboardLoadingState";
import type { CategoryEditorTarget } from "../categories/categoryEditorModel";

/* Width of .week-v2-calendar__time-rail: the calendar body's first grid column. */
const WEEK_CALENDAR_TIME_RAIL_REM = 2.5;
/* Longer than one animation frame, well under the 340ms panel transition. */
const WEEK_CALENDAR_RESIZE_SETTLE_MS = 120;
/** How long a record sent from History may take to appear before it is dropped. */
const REVEAL_GIVE_UP_MS = 5000;

function readRootFontSizePx(): number {
  if (typeof window === "undefined") return WEEK_CALENDAR_BASE_ROOT_FONT_SIZE_PX;
  const size = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(size) && size > 0 ? size : WEEK_CALENDAR_BASE_ROOT_FONT_SIZE_PX;
}
const EMPTY_ACTIVITY_INSPECTOR_PROJECT_OPTIONS: readonly ActivityInspectorProjectOption[] = [];
const EMPTY_PROJECT_BY_SEGMENT_ID: ReadonlyMap<string, string | null> = new Map();

export type WeekDashboardColorMode = "category" | "productivity" | "project";
const EMPTY_PROJECT_ASSIGNMENTS: readonly ProjectAssignmentRecord[] = [];
const EMPTY_PROJECT_WINDOW_ASSIGNMENTS: readonly ProjectWindowAssignmentRecord[] = [];

// Productivity, categories, projects: the category editor's tab order.
const WEEK_COLOR_MODE_OPTIONS = ["productivity", "category"] as const satisfies readonly WeekDashboardColorMode[];

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
  language: "en" | "ko" | "es",
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
      ? new Intl.DateTimeFormat(localeForDisplayLanguage(language), { weekday: "short" }).format(new Date(`${peakDay.day}T12:00:00`))
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
  language: "en" | "ko" | "es",
  t: LocalizationController["t"],
  projectSlicesByDay?: ReadonlyMap<string, readonly WeekProjectSlice[]>,
  levels: readonly ProductivityLevel[] = [],
): WeekSideTrendChart {
  const chartRows = colorMode === "project" ? rows.map(row => ({ ...row, totalSeconds: (projectSlicesByDay?.get(row.day) ?? []).reduce((sum, slice) => sum + slice.seconds, 0) })) : rows;
  const maxHours = Math.max(...chartRows.map((row) => row.totalSeconds / 3600), 0);
  const axisMaxHours = maxHours > 0 ? maxHours / 0.93 : 1;
  const stepHours = WEEK_SIDE_TREND_STEP_CANDIDATES.find((candidate) => maxHours / candidate <= 4)
    ?? WEEK_SIDE_TREND_STEP_CANDIDATES[WEEK_SIDE_TREND_STEP_CANDIDATES.length - 1];
  const gridlines: { label: string; topPercent: number }[] = [];
  for (let value = stepHours; value <= maxHours + 1e-9; value += stepHours) {
    gridlines.push({
      // Both languages use the compact "6h" tick the Projects trend chart already
      // ships in Korean. "6시간" did not fit the rail's tick gutter, and the
      // shorter "6시" would read as a clock hour next to the calendar's own
      // "8시 / 9시" axis on the same screen.
      label: `${Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "")}h`,
      topPercent: (1 - value / axisMaxHours) * 100,
    });
  }
  gridlines.reverse();

  const columns = chartRows.map((row) => {
    const off = row.totalSeconds <= 0;
    // .wt-bar stacks bottom-up; pin category-mode Unclassified above the classified slices.
    const slices = colorMode === "project"
      ? projectSlicesByDay?.get(row.day) ?? []
      : colorMode === "productivity"
      ? withLevelSlices(
          row.productivitySlices.map((slice) => ({
            key: slice.productivity,
            seconds: slice.totalSeconds,
            color: PRODUCTIVITY_COLORS[slice.productivity],
            label: localizedProductivityLabel(slice.productivity, t),
          })),
          levels,
          neutralSecondsByCategory(row.slices),
        )
      : row.slices.map((slice) => ({
          key: slice.category,
          seconds: slice.totalSeconds,
          color: CATEGORY_COLORS[slice.category],
          label: localizedCategoryLabel(slice.category, t),
        })).sort((left, right) => Number(left.key === "unknown") - Number(right.key === "unknown"));
    return {
      day: row.day,
      dayLabel: new Intl.DateTimeFormat(localeForDisplayLanguage(language), { weekday: "short" }).format(new Date(`${row.day}T12:00:00`)),
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
  readonly colorMode?: WeekDashboardColorMode;
  readonly onColorModeChange?: (mode: WeekDashboardColorMode) => void;
  readonly projectAssignments?: readonly ProjectAssignmentRecord[];
  readonly projectWindowAssignments?: readonly ProjectWindowAssignmentRecord[];
  readonly classifiedResultIds?: ReadonlySet<string>;
  readonly funnelResultRef?: Ref<HTMLElement>;
  /** Page header (title + date navigator) rendered inside the calendar block
   *  for the 2026-07 dashboard redesign. */
  readonly header?: ReactNode;
  readonly initialDataLoading?: boolean;
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
  readonly onSelectDay?: (day: string) => void;
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
  /** Opens the category editor from the legend, the breakdown, and the activity inspector. */
  readonly onEditCategories?: (target: CategoryEditorTarget) => void;
  /**
   * A record opened from History: scroll to the block that holds it and open
   * that block's card once the week has loaded.
   */
  readonly revealSegmentId?: string | null;
  /** Called once the card opens, or when the week holds no such record. */
  readonly onRevealSettled?: () => void;
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

  return <AppGlyph appName={identity.appName || identity.label} iconSrc={identity.siteTitle ? null : iconSrc} size="sm" />;
}

export function WeekDashboard({
  classifiedResultIds,
  funnelResultRef,
  header,
  initialDataLoading = false,
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
  onSelectDay,
  deviceLabelById,
  activityActionsEnabled = false,
  projectOptions = EMPTY_ACTIVITY_INSPECTOR_PROJECT_OPTIONS,
  projectBySegmentId = EMPTY_PROJECT_BY_SEGMENT_ID,
  colorMode: controlledColorMode,
  onColorModeChange,
  projectAssignments = EMPTY_PROJECT_ASSIGNMENTS,
  projectWindowAssignments = EMPTY_PROJECT_WINDOW_ASSIGNMENTS,
  onSaveActivityValues,
  onAssignProject,
  onClassifyActivity,
  onDeleteActivity,
  onEditCategories,
  revealSegmentId = null,
  onRevealSettled,
}: WeekDashboardProps) {
  const { effectiveLanguage, t } = useLocalization();
  const productivityLevels = useProductivityLevels();
  // Controlled by DashboardPage in the app (shared Day/Week preference);
  // standalone renders fall back to local state so the toggle still works.
  const [localSideOpen, setLocalSideOpen] = useState(true);
  const sideOpen = controlledSideOpen ?? localSideOpen;
  const toggleSide = onToggleSide ?? (() => setLocalSideOpen((open) => !open));
  const [localColorMode, setLocalColorMode] = useState<WeekDashboardColorMode>("category");
  const projectModeAvailable = projectOptions.some(project => project.id !== null)
    && (projectAssignments.length > 0 || projectWindowAssignments.length > 0);
  const selectedColorMode = controlledColorMode ?? localColorMode;
  const colorMode = selectedColorMode === "project" && !projectModeAvailable ? "category" : selectedColorMode;
  const setColorMode = onColorModeChange ?? setLocalColorMode;
  const colorModeOptions: readonly WeekDashboardColorMode[] = projectModeAvailable ? [...WEEK_COLOR_MODE_OPTIONS, "project"] : WEEK_COLOR_MODE_OPTIONS;
  const projectView = useMemo(() => colorMode === "project" ? buildWeekProjectView({
    segments, assignments: projectAssignments, windowAssignments: projectWindowAssignments, projects: projectOptions,
    calendarEvents, startDay, endDay, startOfDayMinutes,
    noProjectLabel: t("projects.chart.noProject"), unavailableProjectLabel: t("dashboard.week.inspector.unavailableProject"),
  }) : null, [colorMode, segments, projectAssignments, projectWindowAssignments, projectOptions, calendarEvents, startDay, endDay, startOfDayMinutes, t]);
  const renderedCalendarEvents = projectView?.calendarEvents ?? calendarEvents;
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
  // Rendered inside the legend's control row rather than after it: as a sibling
  // of that row it was pushed onto a line of its own, which grew the legend by a
  // full row and shifted the calendar down whenever a refresh started.
  const refreshStatusChip = refreshStatusLabel ? (
    <span className={`week-v2-summary__refresh week-v2-summary__refresh--${refreshStatus}`} aria-live="polite">{refreshStatusLabel}</span>
  ) : null;
  const googleCalendarStatusLabel = googleCalendarStatus === "ready"
    ? t("dashboard.week.googleCalendarPlanned")
    : googleCalendarStatus === "loading"
      ? t("dashboard.week.googleCalendarLoading")
      : googleCalendarStatus === "error"
        ? t("dashboard.week.googleCalendarError")
        : null;
  const activeCategoryEntries = buildActiveCategoryEntries(categoryEntries);
  const productivityRingEntries = withLevelRingEntries(
    buildProductivityRingEntries(productivityEntries).map((entry) => ({
      ...entry,
      label: localizedProductivityLabel(entry.key as ProductivityLabel, t),
    })),
    productivityLevels,
    neutralSecondsByCategory(categoryEntries),
  );
  const productivityCenterPercent = buildProductivityCenterPercent(productivityEntries);
  const summaryMetrics = useMemo(
    () => buildWeekSummaryMetrics(rows, segments, totalSeconds, effectiveLanguage, t),
    [effectiveLanguage, rows, segments, t, totalSeconds],
  );
  const sideTrendChart = useMemo(
    () => buildWeekSideTrendChart(rows, colorMode, effectiveLanguage, t, projectView?.slicesByDay, productivityLevels),
    [colorMode, effectiveLanguage, rows, t, projectView, productivityLevels],
  );
  const buildHoverRows = useCallback((key: string | readonly string[], mode: WeekDashboardColorMode, day?: string) => (
    buildWeekBreakdownHoverRows({
      segments: mode === "project" ? projectView?.segments ?? [] : segments,
      projectBySegmentId: projectView?.projectBySegmentId,
      classificationOptions,
      startDay,
      endDay,
      startOfDayMinutes,
      mode,
      key,
      day,
      levels: productivityLevels,
    })
  ), [classificationOptions, endDay, segments, startDay, startOfDayMinutes, projectView, productivityLevels]);
  const buildLegendHoverRows = useCallback((request: FlowLegendBreakdownRequest) => {
    switch (request.kind) {
      case "category": return buildHoverRows(request.category, "category");
      case "category-group": return buildHoverRows(request.categories, "category");
      case "productivity": return buildHoverRows(request.productivity, "productivity");
      case "level": return buildHoverRows(request.level, "productivity");
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
  const canMountIdentityIcons = useDeferredWeekIdentityIcons({ endDay, startDay });
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
  // The block holding a record opened from History, once this week shows it.
  const revealTarget = useMemo(() => {
    if (!revealSegmentId) return null;
    for (const row of calendarRows) {
      const event = renderedCalendarEvents.get(row.day)?.find((candidate) => candidate.segmentIds.includes(revealSegmentId));
      if (event) return { day: row.day, eventId: event.id, topMinutes: event.topMinutes };
    }
    return null;
  }, [calendarRows, renderedCalendarEvents, revealSegmentId]);

  const autoScrollTargetMinute = useMemo(() => {
    if (revealTarget) return Math.min(maxCalendarMinute, minCalendarMinute + revealTarget.topMinutes);
    if (currentCalendarDay === undefined && realCurrentCalendarMinute !== null) return realCurrentCalendarMinute;

    const earliestEventOffset = calendarRows.reduce<number | null>((earliest, row) => {
      const firstEvent = renderedCalendarEvents.get(row.day)?.[0];
      if (!firstEvent) return earliest;
      return earliest === null ? firstEvent.topMinutes : Math.min(earliest, firstEvent.topMinutes);
    }, null);

    return earliestEventOffset === null
      ? minCalendarMinute
      : Math.min(maxCalendarMinute, Math.max(minCalendarMinute, minCalendarMinute + earliestEventOffset));
  }, [renderedCalendarEvents, calendarRows, currentCalendarDay, maxCalendarMinute, minCalendarMinute, realCurrentCalendarMinute, revealTarget]);

  const displayCalendarEvents = useMemo(() => {
    if (effectiveLanguage === "en") return renderedCalendarEvents;

    return new Map(Array.from(renderedCalendarEvents.entries()).map(([day, events]) => [
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
            `${localizedExcludedIdentityLabel(identity, t)} · ${formatLocalizedCompactDurationFromSeconds(identity.seconds, effectiveLanguage)}`
          )),
        ].join("\n");

        return { ...event, startLabel, endLabel, detailSummary, detailTitle };
      }),
    ]));
  }, [renderedCalendarEvents, effectiveLanguage, minCalendarMinute, startOfDayMinutes, t]);

  // The calendar squishes (no horizontal scroll) while the Breakdown panel is
  // open, so the identity strips must adapt to the live day-column width
  // instead of always showing the model's 4-icon cap.
  const [dayColumnWidth, setDayColumnWidth] = useState<number | null>(null);
  // Event text is sized in rem, and the root font size steps up on wide windows
  // (tokens-base.css), so the card heights that fit each line move with it.
  const [rootFontSizePx, setRootFontSizePx] = useState(readRootFontSizePx);
  useLayoutEffect(() => {
    const body = calendarBodyRef.current;
    if (!body) return undefined;

    const updateDayColumnWidth = () => {
      const bodyWidth = body.getBoundingClientRect().width;
      const railWidth = WEEK_CALENDAR_TIME_RAIL_REM * readRootFontSizePx();
      const nextWidth = bodyWidth > 0 ? Math.round((bodyWidth - railWidth) / 7) : null;
      setDayColumnWidth(nextWidth);
    };

    // The root size last applied, so a window resize can tell a breakpoint crossing.
    let appliedRootFontSizePx = readRootFontSizePx();
    setRootFontSizePx(appliedRootFontSizePx);
    updateDayColumnWidth();
    // The Breakdown panel animates grid-template-columns for 340ms, which fires
    // the observer every frame; re-rendering the calendar per frame would fight
    // that layout animation, so wait for the size to settle and apply once.
    let settleTimeout = 0;
    const scheduleDayColumnWidth = () => {
      window.clearTimeout(settleTimeout);
      settleTimeout = window.setTimeout(updateDayColumnWidth, WEEK_CALENDAR_RESIZE_SETTLE_MS);
    };
    // The root font size steps at window widths (tokens-base.css), even where
    // the calendar body keeps its width. Read it on every window resize so cards
    // never lay out lines for the previous size. The time rail is sized in rem
    // too, so a new root size re-measures the day columns in the same render
    // instead of after the settle delay.
    const handleWindowResize = () => {
      const nextRootFontSizePx = readRootFontSizePx();
      if (nextRootFontSizePx !== appliedRootFontSizePx) {
        appliedRootFontSizePx = nextRootFontSizePx;
        setRootFontSizePx(nextRootFontSizePx);
        updateDayColumnWidth();
      }
      scheduleDayColumnWidth();
    };
    window.addEventListener("resize", handleWindowResize);
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(scheduleDayColumnWidth) : null;
    observer?.observe(body);
    return () => {
      window.removeEventListener("resize", handleWindowResize);
      observer?.disconnect();
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
  const closeActivityInspector = useCallback((sessionId: number, restoreFocus = true) => {
    // A previous session's async deletion must not dismiss a newly opened card.
    if (activityInspectorRef.current?.sessionId !== sessionId) return;
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
      if (!nextEvent) {
        // Cache invalidation briefly removes historical days during a save.
        // Keep this selection only while its visible week is being reloaded.
        return refreshStatus === "loading" && current.sourceDay >= startDay && current.sourceDay <= endDay
          ? current
          : null;
      }

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
  }, [displayCalendarEvents, endDay, projectBySegmentId, projectsById, refreshStatus, segmentsById, startDay]);

  // Open the card of a record sent from History once its block has rendered;
  // the scroll above has already brought the block into view.
  const onRevealSettledRef = useRef(onRevealSettled);
  onRevealSettledRef.current = onRevealSettled;
  // The week may still be loading. Give up quietly if the record never shows;
  // the timer is keyed to the record alone, so live refreshes cannot restart it.
  useEffect(() => {
    if (!revealSegmentId) return;
    const timeoutId = window.setTimeout(() => onRevealSettledRef.current?.(), REVEAL_GIVE_UP_MS);
    return () => window.clearTimeout(timeoutId);
  }, [revealSegmentId]);
  useEffect(() => {
    if (!revealSegmentId || !revealTarget) return;
    const event = displayCalendarEvents.get(revealTarget.day)?.find((candidate) => candidate.id === revealTarget.eventId);
    const element = Array.from(calendarBodyElement?.querySelectorAll<HTMLElement>(".week-v2-calendar__event[data-event-id]") ?? [])
      .find((candidate) => candidate.dataset.eventId === revealTarget.eventId);
    if (!event || !element) return;
    openActivityInspector(event, element.querySelector<HTMLElement>(".week-v2-calendar__event-open") ?? element);
    onRevealSettledRef.current?.();
  }, [calendarBodyElement, displayCalendarEvents, openActivityInspector, revealSegmentId, revealTarget]);
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
    <section
      className={`week-v2${initialDataLoading ? " dashboard-loading-skeleton dashboard-loading-skeleton--week" : ""}`}
      aria-label={initialDataLoading ? t("dashboard.loadingAria") : t("dashboard.week.overviewAria")}
      aria-busy={initialDataLoading || undefined}
      aria-live={initialDataLoading ? "polite" : undefined}
      role={initialDataLoading ? "status" : undefined}
      data-week-axis-scale-percent={effectiveAxisScalePercent}
    >
      <div className={`week-v2-grid week-v2-grid--calendar${sideOpen ? " week-v2-grid--side-open" : ""}`}>
        <section ref={funnelResultRef} className="week-v2-calendar editorial-panel editorial-panel--soft" aria-label={t("dashboard.week.calendarAria")}>
          {header}
          <div className="week-v2-calendar__legend" aria-label={t("dashboard.week.legendAria")}>
            {initialDataLoading ? (
              <WeekDashboardLoadingLegend trailing={refreshStatusChip} />
            ) : (
              <div className="flow-chart-head__actions">
                <div className="seg flow-color-mode-control" aria-label={t("dashboard.week.colorModeAria")}>
                  {colorModeOptions.map((option) => (
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
                      {t(option === "project" ? "common.project" : option === "category" ? "common.category" : "common.productivity")}
                    </button>
                  ))}
                </div>
                {refreshStatusChip}
                <FlowChartLegend
                  ariaLabel={t(colorMode === "category" ? "dashboard.week.categoryTones" : "dashboard.week.productivityTones")}
                  colorMode={colorMode}
                  projectLegend={projectView?.legend}
                  getAppBreakdown={buildLegendHoverRows}
                  hasUnclassified={hasUnclassified}
                  hoveredLegendCardRef={legendHoverCardRef}
                  setHoveredLegend={setLegendHover}
                  onEdit={onEditCategories ? () => onEditCategories({ group: colorMode }) : undefined}
                />
                {googleCalendarStatusLabel ? (
                  <span className={`week-v2-calendar__calendar-key week-v2-calendar__calendar-key--${googleCalendarStatus}`} aria-live="polite">
                    <span aria-hidden="true" />
                    {googleCalendarStatusLabel}
                  </span>
                ) : null}
              </div>
            )}
          </div>
          <WeekCalendarBoard scrollerRef={calendarScrollerRef}>
            <div className="week-v2-calendar__day-head" aria-hidden={onSelectDay ? undefined : true}>
              <span aria-hidden="true" />
              {calendarRows.map((row) => {
                const weekday = new Date(`${row.day}T12:00:00`).getDay();
                const isWeekend = weekday === 0 || weekday === 6;
                const dayLabel = formatLocalizedDayLabel(row.day, effectiveLanguage);
                return onSelectDay ? (
                  <button
                    type="button"
                    className={`${isWeekend ? "is-weekend" : ""}${row.day === markerCalendarDay ? " is-today" : ""}`.trim()}
                    key={row.day}
                    disabled={row.day > todayDay}
                    aria-label={t("dashboard.week.openDay", { date: dayLabel })}
                    onClick={() => onSelectDay(row.day)}
                  >
                    <strong>{new Intl.DateTimeFormat(localeForDisplayLanguage(effectiveLanguage), { weekday: "short" }).format(new Date(`${row.day}T12:00:00`))}</strong>
                    <small>{row.dayNumber}</small>
                  </button>
                ) : (
                  <span className={`${isWeekend ? "is-weekend" : ""}${row.day === markerCalendarDay ? " is-today" : ""}`.trim()} key={row.day}>
                    <strong>{new Intl.DateTimeFormat(localeForDisplayLanguage(effectiveLanguage), { weekday: "short" }).format(new Date(`${row.day}T12:00:00`))}</strong>
                    <small>{row.dayNumber}</small>
                  </span>
                );
              })}
            </div>
            <div ref={calendarScrollerRef} className="week-v2-calendar__scroller">
              <div ref={setCalendarBody} className="week-v2-calendar__body" style={{ height: formatWeekDashboardAxisPixelValue((calendarEndHour - calendarStartHour) * calendarHourHeight) }}>
              <div className="week-v2-calendar__time-rail">
                {calendarHours.map((hour) => (
                  <span key={hour} style={{ top: formatWeekDashboardAxisPixelValue((hour - calendarStartHour) * calendarHourHeight) }}>{formatLocalizedCompactHourLabel(clockHourForLogicalHour(hour, startOfDayMinutes), effectiveLanguage)}</span>
                ))}
                <span
                  className="week-v2-calendar__time-rail-endpoint"
                  style={{ top: formatWeekDashboardAxisPixelValue((calendarEndHour - calendarStartHour) * calendarHourHeight) }}
                >
                  {formatLocalizedCompactHourLabel(clockHourForLogicalHour(calendarEndHour, startOfDayMinutes), effectiveLanguage)}
                </span>
              </div>
              {!initialDataLoading && currentCalendarMarkerStyle && currentCalendarLabel ? (
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
                const events = initialDataLoading ? [] : displayCalendarEvents.get(row.day) ?? [];
                const plannedEvents = initialDataLoading ? [] : googleCalendarEvents.get(row.day) ?? [];
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
                      const eventLayout = buildWeekCalendarEventLayout(event, calendarHourHeight, rootFontSizePx);
                      const identityStrip = planWeekIdentityStrip(
                        event.identities.length,
                        event.hiddenIdentityCount,
                        // Lane-stacked events render 24px narrower than the full column.
                        dayColumnWidth === null ? null : dayColumnWidth - (event.laneCount > 1 ? 24 : 0),
                      );
                      const eventStyle: WeekCalendarEventStyle = {
                        top: formatWeekDashboardAxisPixelValue((event.topMinutes / 60) * calendarHourHeight),
                        height: formatWeekDashboardAxisPixelValue(eventLayout.eventHeight),
                        // Blocks hug the left of their day (1px) and leave the free space on
                        // the right (6px), the direction concurrent lanes already cascade in.
                        left: event.laneCount > 1 ? `calc(${event.lane * 12}px + 1px)` : "1px",
                        width: event.laneCount > 1 ? "calc(100% - 31px)" : "calc(100% - 7px)",
                        zIndex: event.laneCount > 1 ? 10 + event.lane : 3,
                        "--event-tone": colorMode === "project" ? event.projectColor : colorMode === "productivity" ? levelFor(event.category, event.productivity, productivityLevels)?.color ?? PRODUCTIVITY_COLORS[event.productivity] : CATEGORY_COLORS[event.category],
                      };
                      return (
                        <article
                          className={`week-v2-calendar__event week-v2-calendar__event--${event.productivity}${event.isShort ? " week-v2-calendar__event--short" : ""}${event.isGroupedCluster ? " week-v2-calendar__event--grouped" : ""}${eventLayout.isTinyEvent ? " week-v2-calendar__event--tiny" : ""}${eventLayout.isMicroEvent ? " week-v2-calendar__event--micro" : ""}${event.laneCount > 1 ? " week-v2-calendar__event--stacked" : ""}${event.laneCount > 2 ? " week-v2-calendar__event--dense" : ""}${eventLayout.isCompactEvent ? " week-v2-calendar__event--compact" : ""}${activityInspector?.event.id === event.id ? " is-inspected" : ""}`}
                          data-funnel-classified-result={event.category !== "unknown" && event.segmentIds.some((id) => classifiedResultIds?.has(id)) ? "true" : undefined}
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
                            <span className={`category-dot category-dot--${event.category}`} style={colorMode === "project" ? { background: event.projectColor } : undefined} aria-hidden="true" />
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
                                  <span className="week-v2-calendar__identity" key={identity.id} title={localizedExcludedIdentityLabel(identity, t)}>
                                    {canMountIdentityIcons ? <WeekCalendarIdentityIcon appIcons={appIcons} identity={identity} /> : null}
                                  </span>
                                ))}
                                {identityStrip.hiddenCount > 0 ? (
                                  <span className="week-v2-calendar__identity-more">+{identityStrip.hiddenCount}</span>
                                ) : null}
                              </span>
                            ) : null}
                            {eventLayout.hidesInlineText ? null : <strong className={event.isGroupedCluster && eventLayout.showsIdentityStrip ? "week-v2-calendar__event-label" : undefined}>{event.appName}</strong>}
                            {!eventLayout.isCompactEvent ? (
                              <small className="week-v2-calendar__event-time">
                                <span>{event.startLabel}</span>
                                <span>–{event.endLabel}</span>
                              </small>
                            ) : null}
                            {eventLayout.showsInlineDetail ? <em className="week-v2-calendar__event-detail"><span>{event.detailSummary}</span></em> : null}
                          </button>
                        </article>
                      );
                    })}
                  </div>
                );
              })}
              {!initialDataLoading && currentCalendarMarkerStyle && currentCalendarLabel ? (
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
          </WeekCalendarBoard>
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
          disabled={initialDataLoading || activityInspector !== null}
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
            anchorRefreshing={refreshStatus === "loading" && activityInspector.sourceDay >= startDay && activityInspector.sourceDay <= endDay}
            regroupedBlockCount={activityInspector.regroupedBlockCount}
            onClose={(restoreFocus) => closeActivityInspector(activityInspector.sessionId, restoreFocus)}
            onSaveValues={onSaveActivityValues}
            onAssignProject={onAssignProject}
            onClassify={onClassifyActivity}
            onDelete={onDeleteActivity}
            classificationOptions={classificationOptions}
            onEditCategories={onEditCategories}
          />
        ) : null}
        {!initialDataLoading && legendHover && !activityInspector ? <FlowLegendHoverCard hover={legendHover} appIcons={appIcons} cardRef={legendHoverCardRef} /> : null}

        <BreakdownSidePanel
          open={sideOpen}
          onToggle={toggleSide}
          ariaLabel={t("dashboard.week.breakdownAria")}
          toggleSubject={t("dashboard.week.breakdownSubject")}
          title={t("dashboard.today.breakdown")}
          showLabel={t("dashboard.week.showBreakdown")}
          collapseLabel={t("dashboard.week.collapseBreakdown")}
        >
          {initialDataLoading ? (
            <WeekDashboardLoadingBreakdown />
          ) : (
            <>
              <CompactRingChart
                title={t(colorMode === "project" ? "dashboard.today.projects" : "common.productivity")}
                ariaLabel={t("dashboard.today.compactClassificationAria", { title: t(colorMode === "project" ? "dashboard.today.projects" : "common.productivity") })}
                entries={projectView?.ringEntries ?? productivityRingEntries}
                totalSeconds={projectView?.totalSeconds ?? totalSeconds}
                centerPercent={projectView?.centerPercent ?? productivityCenterPercent}
                flowBlocks={[]}
                appIcons={appIcons}
                getAppBreakdown={(entry) => buildHoverRows(entry.key, projectView ? "project" : "productivity")}
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
                                    dotClassName: colorMode === "project" ? "" : colorMode === "productivity" ? `productivity-dot--${segment.key}` : `category-dot--${segment.key}`,
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
                                      dotClassName: colorMode === "project" ? "" : colorMode === "productivity" ? `productivity-dot--${segment.key}` : `category-dot--${segment.key}`,
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
                  detailTitle
                />
              </div>
            </>
          )}
        </BreakdownSidePanel>
        {!initialDataLoading && breakdownHover && !activityInspector ? <CompactClassificationHoverCard hover={breakdownHover} appIcons={appIcons} /> : null}
      </div>
    </section>
  );
}
