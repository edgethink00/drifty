import { useMemo, useState, type ReactNode } from "react";
import { logicalMinuteOfDay, type ActivitySegment, type AppIconMap, type CategoryDuration, type ClassificationOptions, type DeviceTimelineFilter, type FlowBlock, type FlowIntervalMinutes, type ProductivityDuration } from "@drifty/domain";
import type { BillingInterval } from "../billing/billingService";
import type { DashboardPeriod } from "./dashboardPeriods";
import { AppUsagePanel, type AppUsagePanelItem } from "./AppUsagePanel";
import { FlowChartView } from "../flow-chart/FlowChartView";
import type { FlowColorMode } from "../flow-chart/FlowChartTypes";
import type { ProjectLegendEntry } from "../flow-chart/projectFlowView";
import { CATEGORY_COLORS, categoryLabel } from "../../lib/activityLabels";
import { formatCompactDurationFromSeconds, logicalTodayIsoDate } from "../../lib/formatting";
import { CompactRingChart } from "./CompactRingChart";
import { CompactClassificationBar } from "./CompactClassificationBar";
import { buildActiveCategoryEntries, buildProductivityCenterPercent, buildProductivityRingEntries } from "./FlowCompactSplitChart";
import { buildCompactClassificationBreakdown } from "./compactChartBreakdown";
import { BreakdownSidePanel } from "./BreakdownSidePanelChrome";
import type { CompactRingEntry } from "./CompactRingChart";
import { HistoryCalendarPanel } from "./HistoryCalendarPanel";
import { WeekDashboard } from "./WeekDashboard";
import type { WeekCalendarEvent, WeekDayRow } from "./weekCalendar";
import { DashboardLoadingSkeleton } from "./DashboardLoadingSkeleton";
import { persistDashboardBreakdownOpen, resolveInitialDashboardBreakdownOpen, type ThemeMode } from "../settings/settingsStorage";
import { ShareCardModal, type ShareCardModalCard } from "../share/ShareCardModal";
import { buildShareCardData, buildShareWeekCardData } from "../share/shareCard";
import { dailyFocusComparisonProgress, weeklyFocusComparisonProgress } from "../share/focusPercentile";
import { WEEK_DASHBOARD_AXIS_SCALE_DEFAULT_PERCENT } from "./weekDashboardAxisScale";
import type { DashboardAiUnavailableState } from "./dashboardAiUnavailableState";
import { DashboardAiRecoveryOverlay } from "./DashboardAiRecoveryOverlay";
import { DashboardDemoReplayBanner, type DashboardDemoReplayBannerState } from "./DashboardDemoReplayBanner";
import { BrowserHistoryBootstrapNotice, type BrowserHistoryBootstrapNoticeModel } from "./BrowserHistoryBootstrapPrompt";
import { DashboardPageHeader } from "./DashboardPageHeader";

type DashboardPageProps = {
  readonly appIcons: AppIconMap;
  readonly appTheme: ThemeMode;
  readonly billingCheckoutLoadingInterval: BillingInterval | null;
  readonly currentMinuteOfDay: number | null;
  readonly dashboardAiRecoveryState: DashboardAiUnavailableState | null;
  readonly dashboardAppUsage: AppUsagePanelItem[];
  readonly dashboardSegments: readonly ActivitySegment[];
  readonly dashboardClassificationOptions: ClassificationOptions;
  readonly dashboardCategoryTotals: CategoryDuration[];
  readonly dashboardDateNavigator: ReactNode;
  readonly dashboardEffectiveProductivityTotals: ProductivityDuration[];
  readonly dashboardProductivityTotals: ProductivityDuration[];
  readonly dashboardReplay: DashboardDemoReplayBannerState | null;
  readonly dashboardRange: {
    readonly startDay: string;
    readonly endDay: string;
  };
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
  readonly dayFocusDeltaSeconds: number | null;
  readonly hasTimelineData: boolean;
  readonly historyClassificationOptions: ClassificationOptions;
  readonly historySegments: ActivitySegment[];
  readonly browserHistoryBootstrapNotice: BrowserHistoryBootstrapNoticeModel | null;
  readonly initialDataLoading: boolean;
  readonly selectedDay: string;
  readonly selectedDayLabel: string;
  readonly startOfDayMinutes: number;
  readonly statusRunning: boolean;
  readonly totalSeconds: number;
  readonly weekCalendarEvents: Map<string, WeekCalendarEvent[]>;
  readonly weekFocusDeltaSeconds: number | null;
  readonly weekRefreshStatus: "idle" | "loading" | "error";
  readonly weekRows: WeekDayRow[];
  readonly weekCurrentCalendarDay: string | null;
  readonly weekCurrentMinuteOfDay: number | null;
  readonly onDismissDashboardAiRecovery: () => void;
  readonly onFlowIntervalChange?: (intervalMinutes: FlowIntervalMinutes) => void;
  readonly onOpenDashboardAiSetup: () => void;
  readonly onJoinLeaderboard?: () => Promise<void>;
  readonly onSelectBillingPlan: (billingInterval: BillingInterval) => void;
  readonly onSelectDay: (day: string) => void;
};

export function DashboardPage({
  appIcons,
  appTheme,
  billingCheckoutLoadingInterval,
  currentMinuteOfDay,
  dashboardAiRecoveryState,
  dashboardAppUsage,
  dashboardSegments,
  dashboardClassificationOptions,
  dashboardCategoryTotals,
  dashboardDateNavigator,
  dashboardEffectiveProductivityTotals,
  dashboardProductivityTotals,
  dashboardReplay,
  dashboardRange,
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
  dayFocusDeltaSeconds,
  hasTimelineData,
  historyClassificationOptions,
  historySegments,
  browserHistoryBootstrapNotice,
  initialDataLoading,
  selectedDay,
  selectedDayLabel,
  startOfDayMinutes,
  statusRunning,
  totalSeconds,
  weekCalendarEvents,
  weekFocusDeltaSeconds,
  weekRefreshStatus,
  weekRows,
  weekCurrentCalendarDay,
  weekCurrentMinuteOfDay,
  onDismissDashboardAiRecovery,
  onFlowIntervalChange,
  onOpenDashboardAiSetup,
  onJoinLeaderboard,
  onSelectBillingPlan,
  onSelectDay,
}: DashboardPageProps) {
  const [flowColorMode, setFlowColorMode] = useState<FlowColorMode>("category");
  const [shareCardOpen, setShareCardOpen] = useState(false);
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
  const hasMeasuredActivity = totalSeconds > 0 || hasTimelineData || isDashboardReplayActive;
  const emptyTimelineDetail = browserHistoryBootstrapNotice?.detail
    ?? (statusRunning ? `Tracker is live for ${selectedDayLabel}.` : "Tracking is paused or unavailable. Start the tracker, then activity will appear here.");
  const focusSeconds = dashboardProductivityTotals.find((entry) => entry.productivity === "focus")?.totalSeconds ?? 0;
  const focusDuration = hasMeasuredActivity
    ? (focusSeconds > 0 ? formatCompactDurationFromSeconds(focusSeconds) : "0m")
    : null;
  const dayActiveCategoryEntries = buildActiveCategoryEntries(dashboardCategoryTotals);
  const dayProductivityRingEntries = buildProductivityRingEntries(dashboardEffectiveProductivityTotals);
  const dayProductivityCenterPercent = buildProductivityCenterPercent(dashboardEffectiveProductivityTotals);
  const showProjectDonut = flowColorMode === "project" && (flowProjectRingEntries?.length ?? 0) > 0;
  // 2026-07 dashboard redesign: on Day/Week the header lives inside the main
  // content column (day-split__main / week-v2-calendar) instead of on top of
  // the page. Loading and Month keep the classic top placement.
  const headInsideBlock = !initialDataLoading && (dashPeriod === "Today" || dashPeriod === "Week");
  const showShareButton = !initialDataLoading && !isDashboardReplayActive && (
    (dashPeriod === "Today" && hasMeasuredActivity)
    || (dashPeriod === "Week" && totalSeconds > 0)
  );
  const logicalToday = logicalTodayIsoDate(startOfDayMinutes);
  const currentLogicalMinute = currentMinuteOfDay === null
    ? 24 * 60
    : logicalMinuteOfDay(currentMinuteOfDay, startOfDayMinutes);
  // Share cards are assembled only after the modal opens. The shape is aggregate-only:
  // category/productivity totals and derived hourly/daily rhythm, never raw activity rows.
  const shareCard = useMemo<ShareCardModalCard | null>(() => {
    if (!shareCardOpen) return null;
    if (dashPeriod === "Week") {
      return {
        kind: "week",
        data: buildShareWeekCardData({
          startDay: dashboardRange.startDay,
          endDay: dashboardRange.endDay,
          totalSeconds,
          categoryTotals: dashboardCategoryTotals,
          productivityTotals: dashboardProductivityTotals,
          weekRows,
          calendarEvents: weekCalendarEvents,
          deltaSeconds: weekFocusDeltaSeconds,
          comparisonProgress: weeklyFocusComparisonProgress(
            dashboardRange.startDay,
            dashboardRange.endDay,
            logicalToday,
            currentLogicalMinute,
          ),
          isCurrentPeriod: logicalToday >= dashboardRange.startDay && logicalToday <= dashboardRange.endDay,
        }),
      };
    }
    if (dashPeriod !== "Today") return null;
    return {
      kind: "day",
      data: buildShareCardData({
        day: selectedDay,
        totalSeconds,
        categoryTotals: dashboardCategoryTotals,
        productivityTotals: dashboardProductivityTotals,
        flowBlocks,
        deltaSeconds: dayFocusDeltaSeconds,
        comparisonProgress: dailyFocusComparisonProgress(selectedDay, logicalToday, currentLogicalMinute),
        isCurrentPeriod: selectedDay === logicalToday,
      }),
    };
  }, [currentLogicalMinute, dashPeriod, dashboardCategoryTotals, dashboardProductivityTotals, dashboardRange.endDay, dashboardRange.startDay, dayFocusDeltaSeconds, flowBlocks, logicalToday, selectedDay, shareCardOpen, totalSeconds, weekCalendarEvents, weekFocusDeltaSeconds, weekRows]);
  const pageHead = (
    <DashboardPageHeader
      dashPeriod={dashPeriod}
      initialDataLoading={initialDataLoading}
      dateNavigator={dashboardDateNavigator}
      focusDuration={focusDuration}
      headerAction={showShareButton ? (
        <button
          type="button"
          className="app-btn app-btn--secondary app-btn--header-action dashboard-share-button"
          aria-haspopup="dialog"
          onClick={() => setShareCardOpen(true)}
        >
          <ShareIcon />
          <span>Share</span>
        </button>
      ) : null}
    />
  );

  return (
    <div className={pageClassName}>
      {dashboardAiRecoveryState ? (
        <DashboardAiRecoveryOverlay
          billingCheckoutLoadingInterval={billingCheckoutLoadingInterval}
          state={dashboardAiRecoveryState}
          onClose={onDismissDashboardAiRecovery}
          onOpenAiSetup={onOpenDashboardAiSetup}
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
          segments={dashboardSegments}
          classificationOptions={dashboardClassificationOptions}
          appIcons={appIcons}
          startDay={dashboardRange.startDay}
          endDay={dashboardRange.endDay}
          categoryEntries={dashboardCategoryTotals}
          productivityEntries={dashboardProductivityTotals}
          totalSeconds={totalSeconds}
          refreshStatus={weekRefreshStatus}
          startOfDayMinutes={startOfDayMinutes}
          currentCalendarDay={weekCurrentCalendarDay ?? undefined}
          currentMinuteOfDay={weekCurrentMinuteOfDay ?? undefined}
          axisScalePercent={WEEK_DASHBOARD_AXIS_SCALE_DEFAULT_PERCENT}
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
            {!hasMeasuredActivity ? (
              <div className="dashboard-breakdown-empty" role="status" aria-label="Breakdown availability">
                <span className="dashboard-breakdown-empty__marker" aria-hidden="true">—</span>
                <div>
                  <strong>No activity recorded</strong>
                  <p>This breakdown will fill in after activity is recorded for this day.</p>
                </div>
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

      {shareCardOpen && shareCard ? (
        <ShareCardModal
          card={shareCard}
          defaultTheme={appTheme}
          onJoinLeaderboard={onJoinLeaderboard}
          onClose={() => setShareCardOpen(false)}
        />
      ) : null}
    </div>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12" />
      <path d="m8 6.5 4-3.5 4 3.5" />
      <path d="M6.5 10H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-.5" />
    </svg>
  );
}
