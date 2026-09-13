import type { ActivitySegment, AppIconMap, CategoryDuration, ClassificationOptions, ProductivityDuration } from "@drifty/domain";
import { Suspense, lazy, useState, type ReactNode } from "react";
import { DateNavigator } from "../../components/DateNavigator";
import type { AlarmFollowThrough } from "./alarmFollowThrough";
import { INSIGHT_RANGE_OPTIONS, type InsightRange } from "../dashboard/dashboardPeriods";
import type { AttentionRhythmCell, InsightSourceLists, WeeklyBreakdownDay } from "./insightData";
import { InsightsTabs, INSIGHTS_TABS, type InsightsTabId } from "./InsightsTabs";
import { isInsightsReadTabEnabled } from "./insightsReadTab";
import type { WeeklyChartMode, WeeklyChartProjectSeriesItem } from "./weeklyChartView";
import { useLocalization } from "../localization/LocalizationContext";
import { FocusCalendarCard, type FocusCalendarCardProps } from "./FocusCalendarCard";

const TrendsPageBody = lazy(async () => ({
  default: (await import("./TrendsPageBody")).TrendsPageBody,
}));

type TrendsPageProps = {
  readonly calendarEndDay: string;
  readonly calendarStartOfDayMinutes: number;
  readonly loadCalendarHistory: FocusCalendarCardProps["loadHistory"];
  readonly activeInsightCategoryTotals: CategoryDuration[];
  readonly activeInsightProductivityTotals: ProductivityDuration[];
  readonly appIcons: AppIconMap;
  readonly attentionRhythm: AttentionRhythmCell[];
  readonly bodyFallback?: ReactNode;
  readonly bodyReady?: boolean;
  readonly alarmFollowThrough: AlarmFollowThrough;
  readonly canShiftInsightForward: boolean;
  readonly driftSourceLists: InsightSourceLists;
  readonly focusSourceLists: InsightSourceLists;
  readonly insightClassificationOptions: ClassificationOptions;
  readonly insightDateLabel: string;
  readonly insightSegments: ActivitySegment[];
  readonly isTodaySelected: boolean;
  readonly trendsRange: InsightRange;
  readonly weeklyBreakdown: WeeklyBreakdownDay[];
  readonly weeklyProjectSeries?: readonly WeeklyChartProjectSeriesItem[];
  readonly weeklyProjectMeta?: ReadonlyMap<string, { readonly label: string; readonly color: string }>;
  readonly weeklyProjectBySegmentId?: ReadonlyMap<string, string>;
  readonly weeklyProjectSegments: readonly ActivitySegment[];
  readonly projectModeAvailable?: boolean;
  readonly weeklyChartMode: WeeklyChartMode;
  readonly onNextInsightRange: () => void;
  readonly onPreviousInsightRange: () => void;
  readonly onTodayInsightRange: () => void;
  readonly onTrendsRangeChange: (range: InsightRange) => void;
  readonly onWeeklyChartModeChange: (mode: WeeklyChartMode) => void;
};

export function TrendsPage({
  calendarEndDay,
  calendarStartOfDayMinutes,
  loadCalendarHistory,
  activeInsightCategoryTotals,
  activeInsightProductivityTotals,
  appIcons,
  attentionRhythm,
  bodyFallback,
  bodyReady = true,
  alarmFollowThrough,
  canShiftInsightForward,
  driftSourceLists,
  focusSourceLists,
  insightClassificationOptions,
  insightDateLabel,
  insightSegments,
  isTodaySelected,
  trendsRange,
  weeklyBreakdown,
  weeklyProjectSeries,
  weeklyProjectMeta,
  weeklyProjectBySegmentId,
  weeklyProjectSegments,
  projectModeAvailable,
  weeklyChartMode,
  onNextInsightRange,
  onPreviousInsightRange,
  onTodayInsightRange,
  onTrendsRangeChange,
  onWeeklyChartModeChange,
}: TrendsPageProps) {
  const { effectiveLanguage, t } = useLocalization();
  const readTabEnabled = isInsightsReadTabEnabled();
  const [activeTab, setActiveTab] = useState<InsightsTabId>("usage");
  const visibleTab = readTabEnabled && INSIGHTS_TABS.some((tab) => tab.id === activeTab) ? activeTab : "usage";
  const productivityTotals = {
    focus: activeInsightProductivityTotals.find((entry) => entry.productivity === "focus")?.totalSeconds ?? 0,
    neutral: activeInsightProductivityTotals.find((entry) => entry.productivity === "neutral")?.totalSeconds ?? 0,
    drift: activeInsightProductivityTotals.find((entry) => entry.productivity === "drift")?.totalSeconds ?? 0,
  };

  return (
    <div className="page insights-page">
      <div className="pg-head insights-page__head">
        <div>
          <h1>{t("trends.title")}</h1>
        </div>
      </div>

      {/* Tabs and the window controls share one rule: the range only ever
          filters the usage tab, so it belongs beside that tab rather than
          floating in the page title row. The read tab, when restored, picks
          its own comparable window, so the control leaves the row on that tab. */}
      <div className="insights-toolbar">
        <InsightsTabs activeTab={visibleTab} onChange={setActiveTab} />
        {visibleTab === "usage" ? (
          <div className="classification-range-controls trends-range-controls">
            <div className="settings-mode-switch settings-mode-switch--triple" role="radiogroup" aria-label={t("trends.rangeAria")}>
              {INSIGHT_RANGE_OPTIONS.map((option) => (
                <button
                  key={option.range}
                  type="button"
                  className={`settings-mode-option${trendsRange === option.range ? " is-active" : ""}`}
                  role="radio"
                  aria-checked={trendsRange === option.range}
                  onClick={() => onTrendsRangeChange(option.range)}
                >
                  <span>{t(option.range === "Week" ? "trends.range.week" : option.range === "Month" ? "trends.range.month" : "trends.range.ninetyDays")}</span>
                </button>
              ))}
            </div>
            <DateNavigator
              ariaLabel={t("trends.windowAria")}
              label={insightDateLabel}
              todayLabel={t("trends.latest")}
              isTodayDisabled={isTodaySelected}
              isNextDisabled={!canShiftInsightForward}
              onPrevious={onPreviousInsightRange}
              onNext={onNextInsightRange}
              onToday={onTodayInsightRange}
              previousLabel={t("trends.previousWindow")}
              nextLabel={t("trends.nextWindow")}
              todayActionLabel={effectiveLanguage === "ko" ? "가장 최근 분석 기간으로 이동" : undefined}
            />
          </div>
        ) : null}
      </div>

      {bodyReady ? (
        <Suspense fallback={bodyFallback ?? null}>
          <TrendsPageBody
            calendar={<FocusCalendarCard endDay={calendarEndDay} endDayIsInProgress={isTodaySelected} startOfDayMinutes={calendarStartOfDayMinutes} loadHistory={loadCalendarHistory} recentSegments={insightSegments} classificationOptions={insightClassificationOptions} />}
            activeTab={visibleTab}
            weekly={weeklyBreakdown}
            range={trendsRange}
            categoryTotals={activeInsightCategoryTotals}
            productivityDurations={activeInsightProductivityTotals}
            segments={insightSegments}
            classificationOptions={insightClassificationOptions}
            appIcons={appIcons}
            productivityTotals={productivityTotals}
            projectSeries={weeklyProjectSeries}
            projectMeta={weeklyProjectMeta}
            projectBySegmentId={weeklyProjectBySegmentId}
            projectSegments={weeklyProjectSegments}
            projectModeAvailable={projectModeAvailable}
            weeklyChartMode={weeklyChartMode}
            onWeeklyChartModeChange={onWeeklyChartModeChange}
            attentionRhythm={attentionRhythm}
            driftSourceLists={driftSourceLists}
            focusSourceLists={focusSourceLists}
            alarmFollowThrough={alarmFollowThrough}
          />
        </Suspense>
      ) : bodyFallback}
    </div>
  );
}
