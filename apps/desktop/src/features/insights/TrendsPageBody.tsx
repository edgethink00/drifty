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
import type { WeeklyChartProjectSeriesItem } from "./weeklyChartView";

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
  readonly projectSeries?: readonly WeeklyChartProjectSeriesItem[];
  readonly segments: ActivitySegment[];
  readonly weekly: WeeklyBreakdownDay[];
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
  projectSeries,
  segments,
  weekly,
}: TrendsPageBodyProps) {
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
        projectModeAvailable={projectModeAvailable}
      />

      <div className="insight-grid attention-rhythm-radar-row productivity-focus-radar-row" aria-label="Weekly attention and persona analysis">
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

      <div className="insight-grid productivity-insight-groups" aria-label="Productivity trend charts">
        <InsightSourceGroup variant="drift" lists={driftSourceLists} appIcons={appIcons} />
        <InsightSourceGroup variant="focus" lists={focusSourceLists} appIcons={appIcons} />
      </div>

      <BreakRecoveryCard summary={breakRecoveryInsight} />
    </>
  );
}
