import type { ReactNode } from "react";
import type { ActivitySegment, AppIconMap, CategoryDuration, ClassificationOptions, FlowBlock, FlowIntervalMinutes, ProductivityDuration } from "@drifty/domain";
import type { BillingInterval } from "../billing/billingService";
import type { DashboardPeriod } from "./dashboardPeriods";
import { AppUsagePanel, type AppUsagePanelItem } from "./AppUsagePanel";
import { FlowChartView } from "../flow-chart/FlowChartView";
import { EmptyState } from "../../components/EmptyState";
import { FlowCompactSplitChart } from "./CompactCharts";
import { HistoryCalendarPanel } from "./HistoryCalendarPanel";
import { WeekDashboard } from "./WeekDashboard";
import type { WeekCalendarEvent, WeekDayRow } from "./weekCalendar";
import { DashboardLoadingSkeleton } from "./DashboardLoadingSkeleton";
import {
  DashboardAiUnavailableNotice,
  type DashboardAiUnavailableState,
  type DashboardAiUnavailableVariant,
} from "./DashboardAiUnavailableNotice";
import { DashboardAiRecoveryOverlay } from "./DashboardAiRecoveryOverlay";
import { DashboardDemoReplayBanner, type DashboardDemoReplayBannerState } from "./DashboardDemoReplayBanner";

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
  readonly focusDriftSection: ReactNode;
  readonly hasTimelineData: boolean;
  readonly historyClassificationOptions: ClassificationOptions;
  readonly historySegments: ActivitySegment[];
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
  focusDriftSection,
  hasTimelineData,
  historyClassificationOptions,
  historySegments,
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
  onDashboardAiUnavailableAction,
  onDismissDashboardAiRecovery,
  onFlowIntervalChange,
  onOpenDashboardAiSetup,
  onRetrySelectedDayAiClassification,
  onSelectBillingPlan,
  onSelectDay,
}: DashboardPageProps) {
  const pageClassName = [
    "page",
    dashPeriod === "Week" ? "page--week-dashboard" : null,
    initialDataLoading ? "page--loading-skeleton" : null,
  ].filter(Boolean).join(" ");
  const isDashboardReplayActive = dashboardReplay !== null;

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

      {dashPeriod === "Week" ? null : (
        <div className={`pg-head dashboard-page-head${dashPeriod === "Today" ? " dashboard-page-head--today" : ""}`}>
          <div className="dashboard-page-head__row">
            <div>
              <h1
                aria-label={initialDataLoading ? "Loading dashboard data" : `${dashboardTitle} ${dashboardTitleDuration}`}
                className="dashboard-page-head__title"
              >
                <span className="dashboard-page-head__title-value">{dashboardTitle}</span>
                <span className={`dashboard-page-head__title-value dashboard-page-head__title-duration${initialDataLoading ? " dashboard-page-head__title-duration--loading" : ""}`}>
                  {initialDataLoading ? <span className="loading-skeleton-line loading-skeleton-line--metric" aria-hidden="true" /> : dashboardTitleDuration}
                </span>
              </h1>
            </div>
            {dashboardDateNavigator}
          </div>
        </div>
      )}

      <DashboardDemoReplayBanner replay={dashboardReplay} />

      {initialDataLoading ? (
        <DashboardLoadingSkeleton dashPeriod={dashPeriod} dateNavigator={dashboardDateNavigator} />
      ) : dashPeriod === "Week" ? (
        <WeekDashboard
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
          dateNavigator={dashboardDateNavigator}
          currentCalendarDay={weekCurrentCalendarDay ?? undefined}
          currentMinuteOfDay={weekCurrentMinuteOfDay ?? undefined}
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
        <>
          {hasTimelineData || isDashboardReplayActive ? (
            <div className="flow-breakdown-layout">
              <div className="flow-breakdown-layout__chart">
                <FlowChartView
                  blocks={flowBlocks}
                  appIcons={appIcons}
                  currentMinuteOfDay={currentMinuteOfDay}
                  intervalMinutes={flowIntervalMinutes}
                  startOfDayMinutes={startOfDayMinutes}
                  onIntervalChange={onFlowIntervalChange}
                  showEmptyGrid={isDashboardReplayActive}
                />
              </div>
              <FlowCompactSplitChart
                categoryEntries={dashboardCategoryTotals}
                productivityEntries={dashboardEffectiveProductivityTotals}
                totalSeconds={totalSeconds}
                flowBlocks={flowBlocks}
                appIcons={appIcons}
              />
            </div>
          ) : (
            <EmptyState title="No timeline yet" detail={statusRunning ? `Tracker is live for ${selectedDayLabel}.` : "Tracking is paused. Use the sidebar control or move to a day with recorded activity."} />
          )}
        </>
      )}

      {dashPeriod === "Today" && !initialDataLoading ? (
        <>
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
        </>
      ) : null}
    </div>
  );
}
