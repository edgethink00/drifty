import type {
  ActivitySegment,
  AppIconMap,
  CategoryDuration,
  ClassificationOptions,
  ProductivityPersonaReport,
} from "@drifty/domain";
import type { BreakRecoveryInsight } from "../companion/driftAlarmRecovery";
import { BreakRecoveryCard } from "./BreakRecoveryCard";
import {
  AttentionRhythmCard,
  InsightSourceGroup,
  ProductivityPersonaCard,
  WeeklyCategoryRow,
} from "./InsightCards";
import type { AttentionRhythmCell, InsightSourceLists, WeeklyBreakdownDay } from "./insightData";
import type { WeeklyChartMode, WeeklyChartProjectSeriesItem } from "./weeklyChartView";
import { useLocalization } from "../localization/LocalizationContext";

type TrendsPageBodyProps = {
  readonly appIcons: AppIconMap;
  readonly attentionRhythm: AttentionRhythmCell[];
  readonly breakRecoveryInsight: BreakRecoveryInsight;
  readonly categoryTotals: CategoryDuration[];
  readonly classificationOptions: ClassificationOptions;
  readonly driftSourceLists: InsightSourceLists;
  readonly focusSourceLists: InsightSourceLists;
  readonly productivityPersonaReport: ProductivityPersonaReport;
  readonly productivityTotals: {
    readonly focus: number;
    readonly neutral: number;
    readonly drift: number;
  };
  readonly projectBySegmentId?: ReadonlyMap<string, string>;
  readonly projectMeta?: ReadonlyMap<string, { readonly label: string; readonly color: string }>;
  readonly projectModeAvailable?: boolean;
  readonly projectSegments: readonly ActivitySegment[];
  readonly projectSeries?: readonly WeeklyChartProjectSeriesItem[];
  readonly segments: ActivitySegment[];
  readonly weekly: WeeklyBreakdownDay[];
  readonly weeklyChartMode: WeeklyChartMode;
  readonly onWeeklyChartModeChange: (mode: WeeklyChartMode) => void;
};

export function TrendsPageBody({
  appIcons,
  attentionRhythm,
  breakRecoveryInsight,
  categoryTotals,
  classificationOptions,
  driftSourceLists,
  focusSourceLists,
  productivityPersonaReport,
  productivityTotals,
  projectBySegmentId,
  projectMeta,
  projectModeAvailable,
  projectSegments,
  projectSeries,
  segments,
  weekly,
  weeklyChartMode,
  onWeeklyChartModeChange,
}: TrendsPageBodyProps) {
  const { t } = useLocalization();
  return (
    <>
      <WeeklyCategoryRow
        weekly={weekly}
        categoryTotals={categoryTotals}
        segments={segments}
        classificationOptions={classificationOptions}
        appIcons={appIcons}
        productivityTotals={productivityTotals}
        projectSeries={projectSeries}
        projectMeta={projectMeta}
        projectBySegmentId={projectBySegmentId}
        projectSegments={projectSegments}
        projectModeAvailable={projectModeAvailable}
        mode={weeklyChartMode}
        onModeChange={onWeeklyChartModeChange}
      />

      <div className="insight-grid attention-rhythm-radar-row productivity-focus-radar-row" aria-label={t("trends.analysisAria")}>
        <ProductivityPersonaCard
          classificationOptions={classificationOptions}
          hasData={segments.length > 0}
          report={productivityPersonaReport}
          segments={segments}
          variant="radar"
        />
        <AttentionRhythmCard
          appIcons={appIcons}
          cells={attentionRhythm}
          classificationOptions={classificationOptions}
          segments={segments}
        />
      </div>

      <div className="insight-grid productivity-insight-groups" aria-label={t("trends.chartsAria")}>
        <InsightSourceGroup variant="drift" lists={driftSourceLists} appIcons={appIcons} />
        <InsightSourceGroup variant="focus" lists={focusSourceLists} appIcons={appIcons} />
      </div>

      <BreakRecoveryCard summary={breakRecoveryInsight} />
    </>
  );
}
