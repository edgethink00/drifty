import type { ActivitySegment, AppIconMap, CategoryDuration, ClassificationOptions, ProductivityDuration, buildProductivityPersona } from "@drifty/domain";
import { Suspense, lazy, type ReactNode } from "react";
import { DateNavigator } from "../../components/DateNavigator";
import type { BreakRecoveryInsight } from "../companion/driftAlarmRecovery";
import { INSIGHT_RANGE_OPTIONS, type InsightRange } from "../dashboard/dashboardPeriods";
import type { AttentionRhythmCell, InsightSourceLists, WeeklyBreakdownDay } from "./insightData";
import type { WeeklyChartMode, WeeklyChartProjectSeriesItem } from "./weeklyChartView";
import { useLocalization } from "../localization/LocalizationContext";

const TrendsPageBody = lazy(async () => ({
  default: (await import("./TrendsPageBody")).TrendsPageBody,
}));

type TrendsPageProps = {
  readonly activeInsightCategoryTotals: CategoryDuration[];
  readonly activeInsightProductivityTotals: ProductivityDuration[];
  readonly appIcons: AppIconMap;
  readonly attentionRhythm: AttentionRhythmCell[];
  readonly bodyFallback?: ReactNode;
  readonly bodyReady?: boolean;
  readonly breakRecoveryInsight: BreakRecoveryInsight;
  readonly canShiftInsightForward: boolean;
  readonly driftSourceLists: InsightSourceLists;
  readonly focusSourceLists: InsightSourceLists;
  readonly insightClassificationOptions: ClassificationOptions;
  readonly insightDateLabel: string;
  readonly insightSegments: ActivitySegment[];
  readonly isTodaySelected: boolean;
  readonly productivityPersonaReport: ReturnType<typeof buildProductivityPersona>;
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
  activeInsightCategoryTotals,
  activeInsightProductivityTotals,
  appIcons,
  attentionRhythm,
  bodyFallback,
  bodyReady = true,
  breakRecoveryInsight,
  canShiftInsightForward,
  driftSourceLists,
  focusSourceLists,
  insightClassificationOptions,
  insightDateLabel,
  insightSegments,
  isTodaySelected,
  productivityPersonaReport,
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
      </div>

      {bodyReady ? (
        <Suspense fallback={bodyFallback ?? null}>
          <TrendsPageBody
            weekly={weeklyBreakdown}
            categoryTotals={activeInsightCategoryTotals}
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
            productivityPersonaReport={productivityPersonaReport}
            attentionRhythm={attentionRhythm}
            driftSourceLists={driftSourceLists}
            focusSourceLists={focusSourceLists}
            breakRecoveryInsight={breakRecoveryInsight}
          />
        </Suspense>
      ) : bodyFallback}
    </div>
  );
}
