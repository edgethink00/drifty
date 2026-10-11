import { useProFunnelExposure } from "../../lib/analytics/useProFunnelExposure";
import { classifiedDashboardSegmentIds } from "./hasClassifiedDashboardResult";
import { useMemo, useState, type ReactNode } from "react";
import { ModalPresence } from "../../components/ModalPresence";
import type { ActivityCategory, ActivitySegment, AppIconMap, CategoryDuration, ClassificationOptions, DeviceTimelineFilter, FlowBlock, ProductivityDuration, ProductivityLabel } from "@drifty/domain";
import type { BillingInterval } from "../billing/billingService";
import type { DashboardPeriod } from "./dashboardPeriods";
import { AppUsagePanel, type AppUsagePanelItem } from "./AppUsagePanel";
import { FlowChartView } from "../flow-chart/FlowChartView";
import { YOUR_DAY_FLOW_INTERVAL_MINUTES } from "../flow-chart/flowChartDetailPreference";
import type { FlowColorMode } from "../flow-chart/FlowChartTypes";
import type { ProjectLegendEntry } from "../flow-chart/projectFlowView";
import { CATEGORY_COLORS } from "../../lib/activityLabels";
import { formatLocalizedCompactDurationFromSeconds, formatLocalizedDayLabel, logicalTodayIsoDate } from "../../lib/formatting";
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
import { useShareCardPreparation } from "../share/useShareCardPreparation";
import { buildShareCardData, buildShareWeekCardData } from "../share/shareCard";
import { WEEK_DASHBOARD_AXIS_SCALE_DEFAULT_PERCENT } from "./weekDashboardAxisScale";
import type { DashboardAiUnavailableState } from "./dashboardAiUnavailableState";
import { DashboardAiRecoveryOverlay } from "./DashboardAiRecoveryOverlay";
import { DashboardDemoReplayBanner, type DashboardDemoReplayBannerState } from "./DashboardDemoReplayBanner";
import { BrowserHistoryBootstrapNotice, type BrowserHistoryBootstrapNoticeModel } from "./BrowserHistoryBootstrapPrompt";
import { SettingsSelect } from "../settings/SettingsSelect";
import { DashboardPageHeader } from "./DashboardPageHeader";
import { DayWeekToggle, type DayWeekPeriod } from "../../components/DayWeekToggle";
import type { ActivityInspectorProjectOption, ActivityInspectorSaveHandler } from "./WeekActivityInspector";
import { useLocalization } from "../localization/LocalizationContext";
import { localizedCategoryLabel, localizedProductivityLabel } from "../localization/activityTranslations";
import type { GoogleCalendarWeekEvent } from "../calendar/googleCalendarWeek";
import type { GoogleCalendarWeekStatus } from "../calendar/useGoogleCalendarWeek";
import type { IndividualPricingQuote } from "../billing/individualPricing";

const EMPTY_ACTIVITY_INSPECTOR_PROJECT_OPTIONS: readonly ActivityInspectorProjectOption[] = [];
const EMPTY_PROJECT_BY_SEGMENT_ID: ReadonlyMap<string, string | null> = new Map();

type DashboardPageProps = {
  readonly funnelEnabled?: boolean;
  readonly funnelResultEnabled?: boolean;
  readonly appIcons: AppIconMap;
  readonly appTheme: ThemeMode;
  readonly billingCheckoutLoadingInterval: BillingInterval | null;
  readonly billingPlansDisabled?: boolean;
  readonly billingPortalLoading?: boolean;
  readonly individualPricingQuote?: IndividualPricingQuote | null;
  readonly currentMinuteOfDay: number | null;
  readonly dashboardAiRecoveryState: DashboardAiUnavailableState | null;
  readonly dashboardAppUsage: AppUsagePanelItem[];
  readonly dashboardSegments: readonly ActivitySegment[];
  readonly dashboardClassificationOptions: ClassificationOptions;
  readonly dashboardCategoryTotals: CategoryDuration[];
  readonly dashboardDateNavigator: ReactNode;
  readonly dashboardProductivityTotals: ProductivityDuration[];
  readonly dashboardReplay: DashboardDemoReplayBannerState | null;
  readonly dashboardActivityActionsEnabled?: boolean;
  readonly dashboardRange: {
    readonly startDay: string;
    readonly endDay: string;
  };
  readonly dashPeriod: DashboardPeriod;
  readonly flowBlocks: FlowBlock[];
  /** Stable 5-minute blocks for summaries whose meaning must not change with the chart display preference. */
  readonly summaryFlowBlocks: FlowBlock[];
  readonly projectModeAvailable?: boolean;
  readonly projectLegend?: readonly ProjectLegendEntry[];
  readonly activityInspectorProjectOptions?: readonly ActivityInspectorProjectOption[];
  readonly activityInspectorProjectBySegmentId?: ReadonlyMap<string, string | null>;
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
  readonly googleCalendarWeekEvents?: Map<string, GoogleCalendarWeekEvent[]>;
  readonly googleCalendarWeekStatus?: GoogleCalendarWeekStatus;
  readonly weekFocusDeltaSeconds: number | null;
  readonly weekRefreshStatus: "idle" | "loading" | "error";
  readonly weekRows: WeekDayRow[];
  readonly weekCurrentCalendarDay: string | null;
  readonly weekCurrentMinuteOfDay: number | null;
  readonly onDismissDashboardAiRecovery: () => void;
  readonly onOpenDashboardAiSetup: () => void;
  readonly shareAccountScope?: string | null;
  readonly onJoinLeaderboard?: () => Promise<void>;
  readonly onManageCloudBilling?: () => void;
  readonly onSelectBillingPlan: (billingInterval: BillingInterval) => void;
  readonly navigationRefreshEnabled?: boolean;
  readonly onPeriodChange: (period: DayWeekPeriod) => void;
  readonly onSelectDay: (day: string) => void;
  readonly onSaveDashboardActivityValues?: ActivityInspectorSaveHandler;
  readonly onClassifyDashboardActivity?: (
    segments: readonly ActivitySegment[],
    category: ActivityCategory,
    productivity: ProductivityLabel,
  ) => Promise<void>;
  readonly onAssignDashboardProject?: (
    segments: readonly ActivitySegment[],
    projectId: string | null,
  ) => Promise<void>;
  readonly onDeleteDashboardActivity?: (segmentIds: readonly string[]) => Promise<void>;
};

export function DashboardPage({
  funnelEnabled = false,
  funnelResultEnabled = false,
  appIcons,
  appTheme,
  billingCheckoutLoadingInterval,
  billingPlansDisabled = false,
  billingPortalLoading = false,
  individualPricingQuote = null,
  currentMinuteOfDay,
  dashboardAiRecoveryState,
  dashboardAppUsage,
  dashboardSegments,
  dashboardClassificationOptions,
  dashboardCategoryTotals,
  dashboardDateNavigator,
  dashboardProductivityTotals,
  dashboardReplay,
  dashboardActivityActionsEnabled = false,
  dashboardRange,
  dashPeriod,
  flowBlocks,
  summaryFlowBlocks,
  projectModeAvailable,
  projectLegend,
  activityInspectorProjectOptions = EMPTY_ACTIVITY_INSPECTOR_PROJECT_OPTIONS,
  activityInspectorProjectBySegmentId = EMPTY_PROJECT_BY_SEGMENT_ID,
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
  googleCalendarWeekEvents,
  googleCalendarWeekStatus,
  weekFocusDeltaSeconds,
  weekRefreshStatus,
  weekRows,
  weekCurrentCalendarDay,
  weekCurrentMinuteOfDay,
  onDismissDashboardAiRecovery,
  onOpenDashboardAiSetup,
  shareAccountScope = null,
  onJoinLeaderboard,
  onManageCloudBilling,
  onSelectBillingPlan,
  navigationRefreshEnabled = false,
  onPeriodChange,
  onSelectDay,
  onSaveDashboardActivityValues,
  onAssignDashboardProject,
  onClassifyDashboardActivity,
  onDeleteDashboardActivity,
}: DashboardPageProps) {
  const { effectiveLanguage, t } = useLocalization();
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
  const classifiedResultIds = useMemo(
    () => classifiedDashboardSegmentIds(dashboardSegments, dashboardClassificationOptions),
    [dashboardSegments, dashboardClassificationOptions],
  );
  const resultRef = useProFunnelExposure<HTMLDivElement>(funnelEnabled,
    funnelResultEnabled && !initialDataLoading && !dashboardReplay && !dashboardAiRecoveryState
      && !shareCardOpen && dashPeriod !== "Month" && (dashPeriod !== "Week" || weekRefreshStatus === "idle") && classifiedResultIds.size > 0
      ? { step: "classified_result_viewed", dashboard_period: dashPeriod === "Week" ? "week" : "day" }
      : null,
  );
  const pageClassName = [
    "page",
    dashPeriod === "Week" ? "page--week-dashboard" : null,
    initialDataLoading ? "page--loading-skeleton" : null,
  ].filter(Boolean).join(" ");
  const isDashboardReplayActive = dashboardReplay !== null;
  const hasMeasuredActivity = totalSeconds > 0 || hasTimelineData || isDashboardReplayActive;
  const logicalToday = logicalTodayIsoDate(startOfDayMinutes);
  const selectedDayDisplayLabel = effectiveLanguage === "ko" ? formatLocalizedDayLabel(selectedDay, effectiveLanguage) : selectedDayLabel;
  const emptyTimelineDetail = browserHistoryBootstrapNotice?.detail
    ?? (selectedDay !== logicalToday
      ? t("dashboard.today.noActivityForDayDetail", { date: selectedDayDisplayLabel })
      : statusRunning
      ? t("dashboard.today.trackerLiveDetail", { date: selectedDayDisplayLabel })
      : t("dashboard.today.trackerPausedDetail"));
  const focusSeconds = dashboardProductivityTotals.find((entry) => entry.productivity === "focus")?.totalSeconds ?? 0;
  const focusDuration = hasMeasuredActivity
    ? focusSeconds > 0
      ? formatLocalizedCompactDurationFromSeconds(focusSeconds, effectiveLanguage)
      : effectiveLanguage === "ko" ? "0분" : "0m"
    : null;
  const dayActiveCategoryEntries = buildActiveCategoryEntries(dashboardCategoryTotals);
  const dayProductivityRingEntries = buildProductivityRingEntries(dashboardProductivityTotals).map((entry) => ({
    ...entry,
    label: localizedProductivityLabel(entry.key as ProductivityLabel, t),
  }));
  const dayProductivityCenterPercent = buildProductivityCenterPercent(dashboardProductivityTotals);
  const showProjectDonut = flowColorMode === "project" && (flowProjectRingEntries?.length ?? 0) > 0;
  // Week keeps the integrated calendar header while Day keeps its standalone
  // header. Both remain interactive during loading so view changes never wait
  // on tracker data.
  const headInsideBlock = dashPeriod === "Week"
    || (dashPeriod === "Today" && (navigationRefreshEnabled || !initialDataLoading));
  const showShareButton = !initialDataLoading && !isDashboardReplayActive && (
    (dashPeriod === "Today" && hasMeasuredActivity)
    || (dashPeriod === "Week" && totalSeconds > 0)
  );
  const shareComparisonWindowKey = `${logicalToday}:${startOfDayMinutes}`;
  const prepareShareCard = useShareCardPreparation(showShareButton, shareAccountScope, shareComparisonWindowKey);
  // Share cards are assembled only after the modal opens. The shape is aggregate-only:
  // category/productivity totals and derived hourly/daily rhythm, never raw activity rows.
  // Exported card content stays English even when the surrounding app chrome is Korean.
  const shareCard = useMemo<ShareCardModalCard | null>(() => {
    if (!shareCardOpen) return null;
    if (dashPeriod === "Week") {
      return {
        kind: "week",
        data: buildShareWeekCardData({
          language: "en",
          startDay: dashboardRange.startDay,
          endDay: dashboardRange.endDay,
          totalSeconds,
          categoryTotals: dashboardCategoryTotals,
          productivityTotals: dashboardProductivityTotals,
          weekRows,
          calendarEvents: weekCalendarEvents,
          deltaSeconds: weekFocusDeltaSeconds,
          comparisonDay: logicalToday,
          isCurrentPeriod: logicalToday >= dashboardRange.startDay && logicalToday <= dashboardRange.endDay,
        }),
      };
    }
    if (dashPeriod !== "Today") return null;
    return {
      kind: "day",
      data: buildShareCardData({
        language: "en",
        day: selectedDay,
        totalSeconds,
        categoryTotals: dashboardCategoryTotals,
        productivityTotals: dashboardProductivityTotals,
        flowBlocks: summaryFlowBlocks,
        deltaSeconds: dayFocusDeltaSeconds,
        isCurrentPeriod: selectedDay === logicalToday,
      }),
    };
  }, [dashPeriod, dashboardCategoryTotals, dashboardProductivityTotals, dashboardRange.endDay, dashboardRange.startDay, dayFocusDeltaSeconds, logicalToday, selectedDay, shareCardOpen, summaryFlowBlocks, totalSeconds, weekCalendarEvents, weekFocusDeltaSeconds, weekRows]);
  const pageHead = (
    <DashboardPageHeader
      dashPeriod={dashPeriod}
      initialDataLoading={initialDataLoading}
      dateNavigator={dashboardDateNavigator}
      deviceSelect={onDeviceTimelineFilterChange && deviceLabelById && deviceLabelById.size > 0 ? (
        <div title={deviceTimelineFilter === "all" ? t("dashboard.deviceElapsedTime") : undefined}>
          <SettingsSelect<DeviceTimelineFilter> ariaLabel={t("dashboard.deviceFilter")}
            className="dashboard-device-select" triggerVariant="header-action" value={deviceTimelineFilter}
            options={[
              { value: "all", label: t("dashboard.allDevices") },
              { value: "local", label: t("dashboard.thisMac") },
              ...[...deviceLabelById].map(([value, label]) => ({ value, label, title: label })),
            ]}
            onChange={onDeviceTimelineFilterChange} placement="below" />
        </div>
      ) : null}
      periodToggle={navigationRefreshEnabled && dashPeriod !== "Month" ? (
        <DayWeekToggle
          ariaLabel={t("dashboard.range.aria")}
          dayLabel={t("common.day")}
          period={dashPeriod}
          weekLabel={t("common.week")}
          onChange={onPeriodChange}
        />
      ) : null}
      focusDuration={focusDuration}
      headerAction={showShareButton ? (
        <button
          type="button"
          className="app-btn app-btn--secondary app-btn--header-action dashboard-share-button"
          aria-haspopup="dialog"
          onPointerEnter={prepareShareCard}
          onFocus={prepareShareCard}
          onClick={() => { prepareShareCard(); setShareCardOpen(true); }}
        >
          <ShareIcon />
          <span>{dashPeriod === "Today" ? t("dashboard.today.share") : t("dashboard.week.share")}</span>
        </button>
      ) : null}
    />
  );

  return (
    <div className={pageClassName}>
      <ModalPresence>
        {dashboardAiRecoveryState ? (
        <DashboardAiRecoveryOverlay
          funnelEnabled={funnelEnabled}
          billingCheckoutLoadingInterval={billingCheckoutLoadingInterval}
          billingPlansDisabled={billingPlansDisabled}
          billingPortalLoading={billingPortalLoading}
          individualPricingQuote={individualPricingQuote}
          state={dashboardAiRecoveryState}
          onClose={onDismissDashboardAiRecovery}
          onManageCloudBilling={onManageCloudBilling}
          onOpenAiSetup={onOpenDashboardAiSetup}
          onSelectBillingPlan={onSelectBillingPlan}
        />
        ) : null}
      </ModalPresence>

      {headInsideBlock ? null : pageHead}

      <DashboardDemoReplayBanner replay={dashboardReplay} />

      {dashPeriod === "Week" ? (
        <WeekDashboard
          funnelResultRef={resultRef}
          classifiedResultIds={classifiedResultIds}
          header={headInsideBlock ? pageHead : null}
          initialDataLoading={initialDataLoading}
          rows={weekRows}
          calendarEvents={weekCalendarEvents}
          googleCalendarEvents={googleCalendarWeekEvents}
          googleCalendarStatus={googleCalendarWeekStatus}
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
          onSelectDay={navigationRefreshEnabled ? (day) => {
            onPeriodChange("Today");
            onSelectDay(day);
          } : undefined}
          deviceLabelById={deviceLabelById}
          activityActionsEnabled={dashboardActivityActionsEnabled && !isDashboardReplayActive}
          projectOptions={activityInspectorProjectOptions}
          projectBySegmentId={activityInspectorProjectBySegmentId}
          onSaveActivityValues={onSaveDashboardActivityValues}
          onAssignProject={onAssignDashboardProject}
          onClassifyActivity={onClassifyDashboardActivity}
          onDeleteActivity={onDeleteDashboardActivity}
        />
      ) : initialDataLoading ? (
        <DashboardLoadingSkeleton
          dashPeriod={dashPeriod}
          header={navigationRefreshEnabled ? pageHead : undefined}
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
              <div className="flow-breakdown-layout__chart" ref={resultRef}>
                <FlowChartView
                  classifiedResultIds={classifiedResultIds}
                  blocks={flowBlocks}
                  appIcons={appIcons}
                  currentMinuteOfDay={currentMinuteOfDay}
                  intervalMinutes={YOUR_DAY_FLOW_INTERVAL_MINUTES}
                  startOfDayMinutes={startOfDayMinutes}
                  /* Keep the frame (legend + axis + empty grid) whenever there
                     are no blocks — an empty day, replay, OR the brief moment
                     mid day-navigation before the next day's blocks arrive —
                     so the chart never blanks out to nothing. */
                  showEmptyGrid={flowBlocks.length === 0 || isDashboardReplayActive}
                  projectModeAvailable={projectModeAvailable}
                  projectLegend={projectLegend}
                  projectOptions={activityInspectorProjectOptions}
                  colorMode={flowColorMode}
                  onColorModeChange={setFlowColorMode}
                  deviceLabelById={deviceLabelById}
                  segments={dashboardSegments}
                  activityActionsEnabled={dashboardActivityActionsEnabled && !isDashboardReplayActive}
                  onSaveActivityValues={onSaveDashboardActivityValues}
                  onAssignProject={onAssignDashboardProject}
                  onClassifyActivity={onClassifyDashboardActivity}
                  onDeleteActivity={onDeleteDashboardActivity}
                  classificationOptions={dashboardClassificationOptions}
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
            ariaLabel={t("dashboard.today.breakdownAria")}
            toggleSubject="day breakdown"
            title={t("dashboard.today.breakdown")}
            showLabel={t("dashboard.today.showBreakdown")}
            collapseLabel={t("dashboard.today.collapseBreakdown")}
          >
            {!hasMeasuredActivity ? (
              <div className="dashboard-breakdown-empty" role="status" aria-label={t("dashboard.today.breakdownAvailability")}>
                <span className="dashboard-breakdown-empty__marker" aria-hidden="true">—</span>
                <div>
                  <strong>{t("dashboard.today.noActivity")}</strong>
                  <p>{t("dashboard.today.noActivityDetail")}</p>
                </div>
              </div>
            ) : (
              <>
                {showProjectDonut ? (
                  <CompactRingChart
                    title={t("dashboard.today.projects")}
                    ariaLabel={t("dashboard.today.compactClassificationAria", { title: t("dashboard.today.projects") })}
                    entries={flowProjectRingEntries ?? []}
                    totalSeconds={totalSeconds}
                    centerPercent={flowProjectCenterPercent ?? 0}
                    flowBlocks={summaryFlowBlocks}
                    appIcons={appIcons}
                    language={effectiveLanguage}
                  />
                ) : (
                  <CompactRingChart
                    title={t("dashboard.today.productivity")}
                    ariaLabel={t("dashboard.today.compactClassificationAria", { title: t("dashboard.today.productivity") })}
                    entries={dayProductivityRingEntries}
                    totalSeconds={totalSeconds}
                    centerPercent={dayProductivityCenterPercent}
                    flowBlocks={summaryFlowBlocks}
                    appIcons={appIcons}
                    language={effectiveLanguage}
                  />
                )}
                <CompactClassificationBar<CategoryDuration>
                  title={t("dashboard.today.categories")}
                  ariaLabel={t("dashboard.today.compactClassificationAria", { title: t("common.category") })}
                  entries={dayActiveCategoryEntries}
                  totalSeconds={totalSeconds}
                  getKey={(entry) => entry.category}
                  getLabel={(entry) => localizedCategoryLabel(entry.category, t)}
                  getColor={(entry) => CATEGORY_COLORS[entry.category]}
                  getDotClassName={(entry) => `category-dot--${entry.category}`}
                  getAppBreakdown={(entry) => buildCompactClassificationBreakdown(summaryFlowBlocks, (block) => block.category === entry.category)}
                  appIcons={appIcons}
                  visibleLimit={5}
                  language={effectiveLanguage}
                />
                {dayBreakdownTiles}
              </>
            )}
          </BreakdownSidePanel>
        </div>
      )}

      <ModalPresence>{shareCardOpen && shareCard ? (
        <ShareCardModal
          key={shareAccountScope ?? "signed-out"}
          accountScope={shareAccountScope}
          comparisonWindowKey={shareComparisonWindowKey}
          card={shareCard}
          defaultTheme={appTheme}
          onJoinLeaderboard={onJoinLeaderboard}
          onClose={() => setShareCardOpen(false)}
        />
      ) : null}</ModalPresence>
    </div>
  );
}

export function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12" />
      <path d="m8 6.5 4-3.5 4 3.5" />
      <path d="M6.5 10H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-.5" />
    </svg>
  );
}
