import { useState, type ReactNode } from "react";
import type { ActivitySegment, AppIconMap, CategoryDuration, ClassificationOptions, DeviceTimelineFilter, FlowBlock, FlowIntervalMinutes, ProductivityDuration } from "@drifty/domain";
import type { BillingInterval } from "../billing/billingService";
import type { DashboardPeriod } from "./dashboardPeriods";
import { AppUsagePanel, type AppUsagePanelItem } from "./AppUsagePanel";
import { FlowChartView } from "../flow-chart/FlowChartView";
import type { FlowColorMode } from "../flow-chart/FlowChartTypes";
import type { ProjectLegendEntry } from "../flow-chart/projectFlowView";
import { CATEGORY_COLORS, categoryLabel } from "../../lib/activityLabels";
import { UI_LOCALE, formatCompactDurationFromSeconds, logicalTodayIsoDate } from "../../lib/formatting";
import { CompactRingChart } from "./CompactRingChart";
import { CompactClassificationBar } from "./CompactClassificationBar";
import { buildActiveCategoryEntries, buildProductivityCenterPercent, buildProductivityRingEntries } from "./FlowCompactSplitChart";
import { buildCompactClassificationBreakdown } from "./compactChartBreakdown";
import { BreakdownHeroCard, BreakdownSidePanel } from "./BreakdownSidePanelChrome";
import type { CompactRingEntry } from "./CompactRingChart";
import { HistoryCalendarPanel } from "./HistoryCalendarPanel";
import { WeekDashboard } from "./WeekDashboard";
import type { WeekCalendarEvent, WeekDayRow } from "./weekCalendar";
import { DashboardLoadingSkeleton } from "./DashboardLoadingSkeleton";
import { persistDashboardBreakdownOpen, resolveInitialDashboardBreakdownOpen } from "../settings/settingsStorage";
import { WEEK_DASHBOARD_AXIS_SCALE_DEFAULT_PERCENT } from "./weekDashboardAxisScale";
import {
  DashboardAiUnavailableNotice,
  type DashboardAiUnavailableState,
  type DashboardAiUnavailableVariant,
} from "./DashboardAiUnavailableNotice";
import { DashboardAiRecoveryOverlay } from "./DashboardAiRecoveryOverlay";
import { DashboardDemoReplayBanner, type DashboardDemoReplayBannerState } from "./DashboardDemoReplayBanner";
import { BrowserHistoryBootstrapNotice, type BrowserHistoryBootstrapNoticeModel } from "./BrowserHistoryBootstrapPrompt";

type DashboardPageProps = {
  readonly appIcons: AppIconMap;
  readonly billingCheckoutLoadingInterval: BillingInterval | null;
  readonly classificationActionLoading: boolean;
  readonly currentMinuteOfDay: number | null;
  readonly dashboardAiRecoveryState: DashboardAiUnavailableState | null;
  readonly dashboardAiUnavailableState: DashboardAiUnavailableState | null;
  readonly dashboardAppUsage: AppUsagePanelItem[];
  readonly dashboardCategoryTotals: CategoryDuration[];
  readonly dashboardDateNavigator: ReactNode;
  readonly dashboardEffectiveProductivityTotals: ProductivityDuration[];
  readonly dashboardProductivityTotals: ProductivityDuration[];
  readonly dashboardReplay: DashboardDemoReplayBannerState | null;
  readonly dashboardRange: {
    readonly startDay: string;
    readonly endDay: string;
  };
  readonly dashboardTitle: string;
  readonly dashboardTitleDuration: string;
  readonly dashPeriod: DashboardPeriod;
  readonly flowBlocks: FlowBlock[];
  readonly flowIntervalMinutes: FlowIntervalMinutes;
  readonly projectModeAvailable?: boolean;
  readonly projectLegend?: readonly ProjectLegendEntry[];
  readonly deviceLabelById?: ReadonlyMap<string, string>;
  readonly deviceTimelineFilter?: DeviceTimelineFilter;
  readonly onDeviceTimelineFilterChange?: (filter: DeviceTimelineFilter) => void;
  readonly flowProjectRingEntries?: readonly CompactRingEntry[];
  readonly flowProjectCenterPercent?: number;
  readonly focusDriftSection: ReactNode;
  readonly dayBreakdownTiles: ReactNode;
  readonly dayFocusDeltaPercent: number | null;
  readonly hasTimelineData: boolean;
  readonly historyClassificationOptions: ClassificationOptions;
  readonly historySegments: ActivitySegment[];
  readonly browserHistoryBootstrapNotice: BrowserHistoryBootstrapNoticeModel | null;
  readonly initialDataLoading: boolean;
  readonly isPreviewSurface: boolean;
  readonly selectedDay: string;
  readonly selectedDayLabel: string;
  readonly startOfDayMinutes: number;
  readonly statusRunning: boolean;
  readonly totalSeconds: number;
  readonly weekCalendarEvents: Map<string, WeekCalendarEvent[]>;
  readonly weekFocusDeltaPercent: number | null;
  readonly weekRefreshStatus: "idle" | "loading" | "error";
  readonly weekRows: WeekDayRow[];
  readonly weekCurrentCalendarDay: string | null;
  readonly weekCurrentMinuteOfDay: number | null;
  readonly weekDashboardAxisScalePercent?: number;
  readonly onDashboardAiUnavailableAction: (variant: DashboardAiUnavailableVariant) => void;
  readonly onDismissDashboardAiRecovery: () => void;
  readonly onFlowIntervalChange?: (intervalMinutes: FlowIntervalMinutes) => void;
  readonly onOpenDashboardAiSetup: () => void;
  readonly onRetrySelectedDayAiClassification: () => void;
  readonly onSelectBillingPlan: (billingInterval: BillingInterval) => void;
  readonly onSelectDay: (day: string) => void;
};

export function DashboardPage({
  appIcons,
  billingCheckoutLoadingInterval,
  classificationActionLoading,
  currentMinuteOfDay,
  dashboardAiRecoveryState,
  dashboardAiUnavailableState,
  dashboardAppUsage,
  dashboardCategoryTotals,
  dashboardDateNavigator,
  dashboardEffectiveProductivityTotals,
  dashboardProductivityTotals,
  dashboardReplay,
  dashboardRange,
  dashboardTitle,
  dashboardTitleDuration,
  dashPeriod,
  flowBlocks,
  flowIntervalMinutes,
  projectModeAvailable,
  projectLegend,
  deviceLabelById,
  deviceTimelineFilter = "all",
  onDeviceTimelineFilterChange,
  flowProjectRingEntries,
  flowProjectCenterPercent,
  focusDriftSection,
  dayBreakdownTiles,
  dayFocusDeltaPercent,
  hasTimelineData,
  historyClassificationOptions,
  historySegments,
  browserHistoryBootstrapNotice,
  initialDataLoading,
  isPreviewSurface,
  selectedDay,
  selectedDayLabel,
  startOfDayMinutes,
  statusRunning,
  totalSeconds,
  weekCalendarEvents,
  weekFocusDeltaPercent,
  weekRefreshStatus,
  weekRows,
  weekCurrentCalendarDay,
  weekCurrentMinuteOfDay,
  weekDashboardAxisScalePercent = WEEK_DASHBOARD_AXIS_SCALE_DEFAULT_PERCENT,
  onDashboardAiUnavailableAction,
  onDismissDashboardAiRecovery,
  onFlowIntervalChange,
  onOpenDashboardAiSetup,
  onRetrySelectedDayAiClassification,
  onSelectBillingPlan,
  onSelectDay,
}: DashboardPageProps) {
  const [flowColorMode, setFlowColorMode] = useState<FlowColorMode>("category");
  // Shared by the Day view and WeekDashboard: the Breakdown side panel is one
  // surface across both dashboards, so its collapse state lives here (and in
  // localStorage) instead of per view.
  const [breakdownOpen, setBreakdownOpen] = useState(resolveInitialDashboardBreakdownOpen);
  const toggleBreakdown = () => {
    setBreakdownOpen((open) => {
      persistDashboardBreakdownOpen(!open);
      return !open;
    });
  };
  const pageClassName = [
    "page",
    dashPeriod === "Week" ? "page--week-dashboard" : null,
    initialDataLoading ? "page--loading-skeleton" : null,
  ].filter(Boolean).join(" ");
  const isDashboardReplayActive = dashboardReplay !== null;
  const hasMeasuredDayActivity = totalSeconds > 0 || hasTimelineData || isDashboardReplayActive;
  const emptyTimelineDetail = browserHistoryBootstrapNotice?.detail
    ?? (statusRunning ? `Tracker is live for ${selectedDayLabel}.` : "Tracking is paused or unavailable. Start the tracker, then activity will appear here.");
  const todayDay = logicalTodayIsoDate(startOfDayMinutes);
  const weekIncludesToday = dashboardRange.startDay <= todayDay && todayDay <= dashboardRange.endDay;
  const weekTitle = weekIncludesToday
    ? "This week"
    : `Week of ${new Date(`${dashboardRange.startDay}T12:00:00`).toLocaleDateString(UI_LOCALE, { month: "short", day: "numeric" })}`;
  const headTitle = dashPeriod === "Week" ? weekTitle : dashboardTitle;
  const headDuration = dashPeriod === "Today" && !hasMeasuredDayActivity ? "—" : dashboardTitleDuration;
  const dayFocusSeconds = dashboardProductivityTotals.find((entry) => entry.productivity === "focus")?.totalSeconds ?? 0;
  const dayActiveCategoryEntries = buildActiveCategoryEntries(dashboardCategoryTotals);
  const dayProductivityRingEntries = buildProductivityRingEntries(dashboardEffectiveProductivityTotals);
  const dayProductivityCenterPercent = buildProductivityCenterPercent(dashboardEffectiveProductivityTotals);
  const showProjectDonut = flowColorMode === "project" && (flowProjectRingEntries?.length ?? 0) > 0;
  // 2026-07 dashboard redesign: on Day/Week the header lives inside the main
  // content column (day-split__main / week-v2-calendar) instead of on top of
  // the page. Loading and Month keep the classic top placement.
  const headInsideBlock = !initialDataLoading && (dashPeriod === "Today" || dashPeriod === "Week");
  const pageHead = (
    <div className={`pg-head dashboard-page-head${dashPeriod === "Today" || dashPeriod === "Week" ? " dashboard-page-head--today" : ""}`}>
        <div className="dashboard-page-head__row">
          <div>
            <h1
              aria-label={initialDataLoading ? "Loading dashboard data" : `${headTitle} ${headDuration}`}
              className="dashboard-page-head__title"
            >
              <span className="dashboard-page-head__title-value">{headTitle}</span>
              <span className={`dashboard-page-head__title-value dashboard-page-head__title-duration${initialDataLoading ? " dashboard-page-head__title-duration--loading" : ""}`}>
                {initialDataLoading ? <span className="loading-skeleton-line loading-skeleton-line--metric" aria-hidden="true" /> : headDuration}
              </span>
            </h1>
          </div>
          {dashboardDateNavigator}
        </div>
    </div>
  );

  return (
    <div className={pageClassName}>
      {dashboardAiUnavailableState ? (
        <DashboardAiUnavailableNotice
          state={dashboardAiUnavailableState}
          onAction={onDashboardAiUnavailableAction}
        />
      ) : null}
      {dashboardAiRecoveryState ? (
        <DashboardAiRecoveryOverlay
          billingCheckoutLoadingInterval={billingCheckoutLoadingInterval}
          retrying={classificationActionLoading}
          state={dashboardAiRecoveryState}
          onClose={onDismissDashboardAiRecovery}
          onOpenAiSetup={onOpenDashboardAiSetup}
          onRetryAi={onRetrySelectedDayAiClassification}
          onSelectBillingPlan={onSelectBillingPlan}
        />
      ) : null}

      {headInsideBlock ? null : pageHead}

      <DashboardDemoReplayBanner replay={dashboardReplay} />

      {onDeviceTimelineFilterChange && deviceLabelById && deviceLabelById.size > 0 ? (
        <div className="dashboard-device-filter" role="group" aria-label="Device filter">
          <button
            type="button"
            className={`dashboard-device-filter__option${deviceTimelineFilter === "all" ? " dashboard-device-filter__option--active" : ""}`}
            onClick={() => onDeviceTimelineFilterChange("all")}
          >
            All devices
          </button>
          <button
            type="button"
            className={`dashboard-device-filter__option${deviceTimelineFilter === "local" ? " dashboard-device-filter__option--active" : ""}`}
            onClick={() => onDeviceTimelineFilterChange("local")}
          >
            This Mac
          </button>
          {[...deviceLabelById.entries()].map(([deviceId, label]) => (
            <button
              key={deviceId}
              type="button"
              className={`dashboard-device-filter__option${deviceTimelineFilter === deviceId ? " dashboard-device-filter__option--active" : ""}`}
              onClick={() => onDeviceTimelineFilterChange(deviceId)}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {initialDataLoading ? (
        <DashboardLoadingSkeleton dashPeriod={dashPeriod} dateNavigator={null} />
      ) : dashPeriod === "Week" ? (
        <WeekDashboard
          header={headInsideBlock ? pageHead : null}
          rows={weekRows}
          calendarEvents={weekCalendarEvents}
          appIcons={appIcons}
          startDay={dashboardRange.startDay}
          endDay={dashboardRange.endDay}
          categoryEntries={dashboardCategoryTotals}
          productivityEntries={dashboardProductivityTotals}
          totalSeconds={totalSeconds}
          focusDeltaPercent={isPreviewSurface ? 21 : weekFocusDeltaPercent}
          refreshStatus={weekRefreshStatus}
          isPreviewSurface={isPreviewSurface}
          startOfDayMinutes={startOfDayMinutes}
          currentCalendarDay={weekCurrentCalendarDay ?? undefined}
          currentMinuteOfDay={weekCurrentMinuteOfDay ?? undefined}
          axisScalePercent={weekDashboardAxisScalePercent}
          sideOpen={breakdownOpen}
          onToggleSide={toggleBreakdown}
        />
      ) : dashPeriod === "Month" ? (
        <HistoryCalendarPanel
          segments={historySegments}
          selectedDay={selectedDay}
          classificationOptions={historyClassificationOptions}
          startOfDayMinutes={startOfDayMinutes}
          onSelectDay={onSelectDay}
        />
      ) : (
        <div className={`week-v2-grid week-v2-grid--calendar week-v2-grid--day${breakdownOpen ? " week-v2-grid--side-open" : ""}`}>
          <div className="day-split__main">
            {headInsideBlock ? pageHead : null}
            {/* Always render the flow chart frame — with the fixed legend and
                time axis and an empty grid when there's no data — so a data-less
                day (or a brief load) keeps the same block instead of collapsing
                to a bare card. */}
            <div className="flow-breakdown-layout flow-breakdown-layout--full">
              <div className="flow-breakdown-layout__chart">
                <FlowChartView
                  blocks={flowBlocks}
                  appIcons={appIcons}
                  currentMinuteOfDay={currentMinuteOfDay}
                  intervalMinutes={flowIntervalMinutes}
                  startOfDayMinutes={startOfDayMinutes}
                  onIntervalChange={onFlowIntervalChange}
                  /* Keep the frame (legend + axis + empty grid) whenever there
                     are no blocks — an empty day, replay, OR the brief moment
                     mid day-navigation before the next day's blocks arrive —
                     so the chart never blanks out to nothing. */
                  showEmptyGrid={flowBlocks.length === 0 || isDashboardReplayActive}
                  projectModeAvailable={projectModeAvailable}
                  projectLegend={projectLegend}
                  colorMode={flowColorMode}
                  onColorModeChange={setFlowColorMode}
                  deviceLabelById={deviceLabelById}
                />
              </div>
            </div>
            {!hasTimelineData && !isDashboardReplayActive ? (
              <div className="dashboard-flow-empty-note" role="note">
                <p>{emptyTimelineDetail}</p>
                {browserHistoryBootstrapNotice ? (
                  <BrowserHistoryBootstrapNotice notice={browserHistoryBootstrapNotice} />
                ) : null}
              </div>
            ) : null}

            <div className="dashboard-insight-stack">
              {focusDriftSection}
            </div>

            <AppUsagePanel
              items={dashboardAppUsage}
              periodLabel={dashPeriod.toLowerCase()}
              totalSeconds={totalSeconds}
              appIcons={appIcons}
              emptyPresentation={isDashboardReplayActive ? "blank" : "message"}
            />
          </div>

          <BreakdownSidePanel
            open={breakdownOpen}
            onToggle={toggleBreakdown}
            ariaLabel="Day breakdown"
            toggleSubject="day breakdown"
          >
            <BreakdownHeroCard
              ariaLabel="Focus total today"
              eyebrow={dashboardTitle === "Today" ? "Focus today" : "Focus"}
              value={hasMeasuredDayActivity
                ? dayFocusSeconds > 0
                  ? formatCompactDurationFromSeconds(dayFocusSeconds)
                  : "0m"
                : "—"}
              deltaPercent={hasMeasuredDayActivity ? dayFocusDeltaPercent : null}
              deltaComparisonLabel={dashboardTitle === "Today" ? "vs yesterday" : "vs previous day"}
            />
            {!hasMeasuredDayActivity ? (
              <div className="empty-state" role="status" aria-label="Breakdown availability">
                <span className="eyebrow">No activity data</span>
                <strong>Breakdown unavailable</strong>
                <p>Breakdown metrics appear after activity is recorded for this day.</p>
              </div>
            ) : (
              <>
                {showProjectDonut ? (
                  <CompactRingChart
                    title="Projects"
                    entries={flowProjectRingEntries ?? []}
                    totalSeconds={totalSeconds}
                    centerPercent={flowProjectCenterPercent ?? 0}
                    flowBlocks={flowBlocks}
                    appIcons={appIcons}
                  />
                ) : (
                  <CompactRingChart
                    title="Productivity"
                    entries={dayProductivityRingEntries}
                    totalSeconds={totalSeconds}
                    centerPercent={dayProductivityCenterPercent}
                    flowBlocks={flowBlocks}
                    appIcons={appIcons}
                  />
                )}
                <CompactClassificationBar<CategoryDuration>
                  title="Categories"
                  ariaLabel="Category compact classification"
                  entries={dayActiveCategoryEntries}
                  totalSeconds={totalSeconds}
                  getKey={(entry) => entry.category}
                  getLabel={(entry) => categoryLabel(entry.category)}
                  getColor={(entry) => CATEGORY_COLORS[entry.category]}
                  getDotClassName={(entry) => `category-dot--${entry.category}`}
                  getAppBreakdown={(entry) => buildCompactClassificationBreakdown(flowBlocks, (block) => block.category === entry.category)}
                  appIcons={appIcons}
                  visibleLimit={5}
                />
                {dayBreakdownTiles}
              </>
            )}
          </BreakdownSidePanel>
        </div>
      )}
    </div>
  );
}
