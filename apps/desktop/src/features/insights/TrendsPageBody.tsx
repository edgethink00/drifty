import type {
  ActivitySegment,
  AppIconMap,
  CategoryDuration,
  ClassificationOptions,
  ProductivityDuration,
} from "@drifty/domain";
import { AlarmFollowThroughCard } from "./AlarmFollowThroughCard";
import type { AlarmFollowThrough } from "./alarmFollowThrough";
import type { InsightRange } from "../dashboard/dashboardPeriods";
import {
  AttentionRhythmCard,
  InsightSourceGroup,
  WeeklyCategoryRow,
} from "./InsightCards";
import type { AttentionRhythmCell, InsightSourceLists, WeeklyBreakdownDay } from "./insightData";
import { InsightsCoachPanel } from "./InsightsCoachPanel";
import { buildInsightsCoachReadiness } from "./insightsReadiness";
import { InsightsSummaryTiles } from "./InsightsSummaryTiles";
import { isInsightsReadDesignPreview, isInsightsReadTabEnabled } from "./insightsReadTab";
import type { InsightsTabId } from "./InsightsTabs";
import type { WeeklyChartMode, WeeklyChartProjectSeriesItem } from "./weeklyChartView";
import { useLocalization } from "../localization/LocalizationContext";
import { Suspense, lazy, type ReactNode } from "react";

// Dev-server design review for Your read. Vite replaces import.meta.env.DEV
// with false in production builds, so the preview and its fixtures are not
// bundled there.
const InsightsReadPreview = import.meta.env.DEV
  ? lazy(async () => ({ default: (await import("./read/InsightsReadPreview")).InsightsReadPreview }))
  : null;

type TrendsPageBodyProps = {
  readonly calendar?: ReactNode;
  readonly activeTab: InsightsTabId;
  readonly appIcons: AppIconMap;
  readonly attentionRhythm: AttentionRhythmCell[];
  readonly alarmFollowThrough: AlarmFollowThrough;
  readonly categoryTotals: CategoryDuration[];
  readonly classificationOptions: ClassificationOptions;
  readonly driftSourceLists: InsightSourceLists;
  readonly focusSourceLists: InsightSourceLists;
  readonly productivityDurations: ProductivityDuration[];
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
  readonly range: InsightRange;
  /** Where Your read puts its week navigator: the toolbar slot Your usage uses for its range. */
  readonly readToolbar?: HTMLElement | null;
  readonly segments: ActivitySegment[];
  readonly weekly: WeeklyBreakdownDay[];
  readonly weeklyChartMode: WeeklyChartMode;
  readonly onWeeklyChartModeChange: (mode: WeeklyChartMode) => void;
};

export function TrendsPageBody({
  calendar,
  activeTab,
  appIcons,
  attentionRhythm,
  alarmFollowThrough,
  categoryTotals,
  classificationOptions,
  driftSourceLists,
  focusSourceLists,
  productivityDurations,
  productivityTotals,
  projectBySegmentId,
  projectMeta,
  projectModeAvailable,
  projectSegments,
  projectSeries,
  range,
  readToolbar,
  segments,
  weekly,
  weeklyChartMode,
  onWeeklyChartModeChange,
}: TrendsPageBodyProps) {
  const { effectiveLanguage, t } = useLocalization();
  // Comparison switch for this review only: ?rr=half renders the even split.
  const evenSplit = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("rr") === "half";
  // Exploration switch for the usage tab's information architecture.
  // K is the selected checkpoint; explicit parameters retain review alternatives.
  const arrangement = typeof window === "undefined"
    ? "k"
    : new URLSearchParams(window.location.search).get("ia") ?? "k";
  const isReduced = ["d", "e", "f"].includes(arrangement);
  const isRetained = ["g", "h", "i"].includes(arrangement);
  const isStacked = ["j", "k", "l"].includes(arrangement);
  const showCalendar = typeof window === "undefined" || new URLSearchParams(window.location.search).get("calendar") !== "off";
  const requestedPlacement = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("calendarPlacement");
  const calendarPlacement = requestedPlacement === "left-strip" || requestedPlacement === "right-top" || requestedPlacement === "original" ? requestedPlacement : "right-bottom";
  const calendarOnRight = calendarPlacement === "right-top" || calendarPlacement === "right-bottom";
  const fitWindow = arrangement === "k" && calendarOnRight && (typeof window === "undefined" || new URLSearchParams(window.location.search).get("usageLayout") !== "scroll");

  if (activeTab === "read" && isInsightsReadTabEnabled()) {
    return (
      <div
        className="insights-tabpanel insights-tabpanel--read"
        id="insights-tabpanel-read"
        role="tabpanel"
        aria-labelledby="insights-tab-read"
        tabIndex={-1}
      >
        {InsightsReadPreview && isInsightsReadDesignPreview() ? (
          <Suspense fallback={null}><InsightsReadPreview toolbar={readToolbar ?? null} appIcons={appIcons} /></Suspense>
        ) : (
          <InsightsCoachPanel readiness={buildInsightsCoachReadiness(segments)} />
        )}
      </div>
    );
  }

  const summaryTiles = (
    <InsightsSummaryTiles
      productivityTotals={productivityTotals}
      range={range}
      segments={segments}
      weekly={weekly}
      compact={isReduced || isRetained}
    />
  );

  function weeklyBlock(parts: "all" | "chart" | "rail", composition: "both" | "category" = "both") {
    return (
      <WeeklyCategoryRow
        weekly={weekly}
        categoryTotals={categoryTotals}
        productivityDurations={productivityDurations}
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
        parts={parts}
        composition={composition}
        onModeChange={onWeeklyChartModeChange}
      />
    );
  }

  const rhythmCard = (
    <AttentionRhythmCard
      appIcons={appIcons}
      cells={attentionRhythm}
      classificationOptions={classificationOptions}
      segments={segments}
    />
  );

  const alarmCard = alarmFollowThrough.totalAlarms > 0
    ? <AlarmFollowThroughCard followThrough={alarmFollowThrough} />
    : null;

  const sourcesBlock = (
    <div className="insight-grid productivity-insight-groups" aria-label={t("trends.chartsAria")}>
      <InsightSourceGroup variant="drift" lists={driftSourceLists} appIcons={appIcons} pageSize={fitWindow ? 3 : undefined} />
      <InsightSourceGroup variant="focus" lists={focusSourceLists} appIcons={appIcons} pageSize={fitWindow ? 3 : undefined} />
    </div>
  );

  const panelProps = {
    id: "insights-tabpanel-usage",
    role: "tabpanel" as const,
    "aria-labelledby": "insights-tab-usage",
    tabIndex: -1,
  };

  // Day-style vertical composition. These alternatives keep all three charts;
  // only their reading order and the space reserved for the weekly chart vary.
  if (isStacked) {
    return (
      <div className={`insights-tabpanel insights-tabpanel--usage insights-reduced insights-retained insights-stacked insights-stacked--${arrangement}${fitWindow ? " insights-fit-window" : ""}`} data-calendar-placement={calendarPlacement} {...panelProps}>
        {arrangement === "l" && <div className="insights-stacked__wide-chart">{weeklyBlock("chart")}</div>}
        <div className="insights-stacked__columns">
          {arrangement === "k" && <div className="insights-stacked__patterns">{showCalendar && !calendarOnRight && calendar}{alarmCard}{rhythmCard}{fitWindow && sourcesBlock}</div>}
          <div className="insights-stacked__breakdown">
            {arrangement === "k" && showCalendar && calendarPlacement === "right-top" && calendar}
            {weeklyBlock(arrangement === "l" ? "rail" : "all")}
            {arrangement === "k" && showCalendar && calendarPlacement === "right-bottom" && calendar}
          </div>
          {arrangement !== "k" && <div className="insights-stacked__patterns">{alarmCard}{rhythmCard}</div>}
        </div>
        {!fitWindow && sourcesBlock}
      </div>
    );
  }

  // Compare what earns permanent space, not just arrangements of the same cuts.
  if (isRetained) {
    const rhythmAndAlarm = alarmCard ? (
      <div className="insights-row--rhythm-recovery">{rhythmCard}{alarmCard}</div>
    ) : rhythmCard;
    return (
      <div className={`insights-tabpanel insights-tabpanel--usage insights-reduced insights-retained insights-retained--${arrangement}`} {...panelProps}>
        {arrangement !== "g" && summaryTiles}
        {arrangement === "i" ? (
          <>
            {rhythmAndAlarm}
            <details className="insights-reduced__sources insights-retained__analysis">
              <summary>{effectiveLanguage === "ko" ? "기간별 상세 분석 · 주간 그래프, 생산성, 카테고리" : "Period details · weekly graph, productivity, categories"}</summary>
              {weeklyBlock("all")}
            </details>
          </>
        ) : (
          <>
            {weeklyBlock("all", arrangement === "h" ? "category" : "both")}
            {rhythmAndAlarm}
          </>
        )}
        {sourcesBlock}
      </div>
    );
  }

  // Review-only reduced variants: same measurements, fewer competing blocks.
  if (isReduced) {
    return (
      <div className={`insights-tabpanel insights-tabpanel--usage insights-reduced insights-reduced--${arrangement}`} {...panelProps}>
        {summaryTiles}
        {arrangement === "e" ? (
          <>
            {rhythmCard}
            {alarmCard}
          </>
        ) : alarmCard ? (
          <div className="insights-row--rhythm-recovery">
            {rhythmCard}
            {alarmCard}
          </div>
        ) : rhythmCard}
        {arrangement === "f" ? (
          <details className="insights-reduced__sources">
            <summary>{effectiveLanguage === "ko" ? "앱과 집중 전환 자세히 보기" : "Explore apps and focus transitions"}</summary>
            {sourcesBlock}
          </details>
        ) : sourcesBlock}
      </div>
    );
  }

  // A: how much / when / what on / did we help. Composition leaves the weekly
  // panel and joins the ranked sources, which answer the same question.
  if (arrangement === "a") {
    return (
      <div className="insights-tabpanel insights-tabpanel--usage insights-ia insights-ia--a" {...panelProps}>
        {summaryTiles}
        <div className="insights-ia__group">
          {weeklyBlock("chart")}
          {rhythmCard}
        </div>
        <div className="insights-ia__group">
          {weeklyBlock("rail")}
          {sourcesBlock}
        </div>
        {alarmCard}
      </div>
    );
  }

  // B: two columns. Time on the left, composition on the right, so the page
  // stops being one long stack.
  if (arrangement === "b") {
    return (
      <div className="insights-tabpanel insights-tabpanel--usage insights-ia insights-ia--b" {...panelProps}>
        {summaryTiles}
        <div className="insights-ia__columns">
          <div className="insights-ia__column">
            {weeklyBlock("chart")}
            {rhythmCard}
          </div>
          <div className="insights-ia__column">
            {weeklyBlock("rail")}
            {sourcesBlock}
            {alarmCard}
          </div>
        </div>
      </div>
    );
  }

  // C: the first screen answers how much and when; everything more granular
  // waits behind one disclosure.
  if (arrangement === "c") {
    return (
      <div className="insights-tabpanel insights-tabpanel--usage insights-ia insights-ia--c" {...panelProps}>
        {summaryTiles}
        {weeklyBlock("chart")}
        {rhythmCard}
        <details className="insights-ia__details">
          <summary>{t("trends.chartsAria")}</summary>
          <div className="insights-ia__details-body">
            {weeklyBlock("rail")}
            {sourcesBlock}
            {alarmCard}
          </div>
        </details>
      </div>
    );
  }

  return (
    <div className="insights-tabpanel insights-tabpanel--usage" {...panelProps}>
      {summaryTiles}
      {weeklyBlock("all")}
      {alarmCard ? (
        <div className={`insights-row--rhythm-recovery${evenSplit ? " is-even-split" : ""}`}>
          {rhythmCard}
          {alarmCard}
        </div>
      ) : rhythmCard}
      {sourcesBlock}
    </div>
  );
}
