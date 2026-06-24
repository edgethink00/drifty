import type { ActivitySegment, AppIconMap, CategoryDuration, ClassificationOptions, ProductivityDuration, buildProductivityPersona } from "@drifty/domain";
import type { ReactNode } from "react";
import { DateNavigator } from "../../components/DateNavigator";
import { BreakRecoveryCard } from "./BreakRecoveryCard";
import type { BreakRecoveryInsight } from "../companion/driftAlarmRecovery";
import { INSIGHT_RANGE_OPTIONS, type InsightRange } from "../dashboard/dashboardPeriods";
import { AttentionRhythmCard, InsightSourceGroup, ProductivityPersonaCard, WeeklyCategoryRow } from "./InsightCards";
import type { AttentionRhythmCell, InsightSourceLists, WeeklyBreakdownDay } from "./insightData";

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
  readonly onNextInsightRange: () => void;
  readonly onPreviousInsightRange: () => void;
  readonly onTodayInsightRange: () => void;
  readonly onTrendsRangeChange: (range: InsightRange) => void;
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
  onNextInsightRange,
  onPreviousInsightRange,
  onTodayInsightRange,
  onTrendsRangeChange,
}: TrendsPageProps) {
  const productivityTotals = {
    focus: activeInsightProductivityTotals.find((entry) => entry.productivity === "focus")?.totalSeconds ?? 0,
    neutral: activeInsightProductivityTotals.find((entry) => entry.productivity === "neutral")?.totalSeconds ?? 0,
    drift: activeInsightProductivityTotals.find((entry) => entry.productivity === "drift")?.totalSeconds ?? 0,
  };

  return (
    <div className="page insights-page">
      <div className="pg-head insights-page__head">
        <div>
          <h1>Patterns and trends</h1>
        </div>
        <div className="classification-range-controls trends-range-controls">
          <div className="settings-mode-switch settings-mode-switch--triple" role="radiogroup" aria-label="Trends range">
            {INSIGHT_RANGE_OPTIONS.map((option) => (
              <button
                key={option.range}
                type="button"
                className={`settings-mode-option${trendsRange === option.range ? " is-active" : ""}`}
                role="radio"
                aria-checked={trendsRange === option.range}
                onClick={() => onTrendsRangeChange(option.range)}
              >
                <span>{option.label}</span>
              </button>
            ))}
          </div>
          <DateNavigator
            ariaLabel="Insight window selector"
            label={insightDateLabel}
            todayLabel="Latest"
            isTodayDisabled={isTodaySelected}
            isNextDisabled={!canShiftInsightForward}
            onPrevious={onPreviousInsightRange}
            onNext={onNextInsightRange}
            onToday={onTodayInsightRange}
            previousLabel="Show previous insight window"
            nextLabel="Show next insight window"
          />
        </div>
      </div>

      {bodyReady ? (
        <>
          <WeeklyCategoryRow
            weekly={weeklyBreakdown}
            categoryTotals={activeInsightCategoryTotals}
            segments={insightSegments}
            classificationOptions={insightClassificationOptions}
            appIcons={appIcons}
            productivityTotals={productivityTotals}
          />

          <div className="insight-grid attention-rhythm-radar-row productivity-focus-radar-row" aria-label="Weekly attention and persona analysis">
            <ProductivityPersonaCard
              classificationOptions={insightClassificationOptions}
              hasData={insightSegments.length > 0}
              report={productivityPersonaReport}
              segments={insightSegments}
              variant="radar"
            />
            <AttentionRhythmCard
              appIcons={appIcons}
              cells={attentionRhythm}
              classificationOptions={insightClassificationOptions}
              segments={insightSegments}
            />
          </div>

          <div className="insight-grid productivity-insight-groups" aria-label="Productivity trend charts">
            <InsightSourceGroup variant="drift" lists={driftSourceLists} appIcons={appIcons} />
            <InsightSourceGroup variant="focus" lists={focusSourceLists} appIcons={appIcons} />
          </div>

          <BreakRecoveryCard summary={breakRecoveryInsight} />
        </>
      ) : bodyFallback}
    </div>
  );
}
