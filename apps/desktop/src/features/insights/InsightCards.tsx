import { AppGlyph } from "../../components/AppGlyph";
import { SiteFavicon } from "../../components/SiteFavicon";
import { DONUT_CIRCUMFERENCE, NO_PROJECT_KEY, WEEKLY_BREAKDOWN_WEEKDAYS, buildDonutView, buildWeeklyChartView, formatInsightSourceValue, insightSourceValue } from "./insightData";
import type { AttentionRhythmCell, DonutCategorySlice, DonutView, InsightSourceItem, InsightSourceLists, ProductivityAnalysisKind, ProductivityInsightReport, WeeklyBreakdownDay, WeeklyChartMode, WeeklyChartProjectSeriesItem, WeeklyChartSegment } from "./insightData";
import { CATEGORY_COLORS, FLOW_BREAKDOWN_PRODUCTIVITY_ORDER, PRODUCTIVITY_COLORS, categoryLabel, productivityLabel } from "../../lib/activityLabels";
import { formatCompactDurationFromSeconds, formatLocalizedCompactDurationFromSeconds, localDateKey, weekdayOrderIndex } from "../../lib/formatting";
import { buildProductivityPersona, classifyActivity, logicalDayIsoDateForDate } from "@drifty/domain";
import type { ActivityCategory, ActivitySegment, AppIconMap, CategoryDuration, ClassificationOptions, ProductivityDuration, ProductivityLabel } from "@drifty/domain";
import { EmptyState } from "../../components/EmptyState";
import type { DisplayLanguage } from "../localization/languagePreference";
import { CompactClassificationBar, buildCompactActivityBreakdown } from "../dashboard/CompactCharts";
import { CompactRingChart } from "../dashboard/CompactRingChart";
import { buildClassifiedCategoryEntries, buildProductivityCenterPercent, buildProductivityRingEntries } from "../dashboard/FlowCompactSplitChart";
import { CompactClassificationHoverCard, formatSharePercent } from "../dashboard/HoverCards";
import type { CompactClassificationHoverPayload, CompactClassificationHoverState } from "../dashboard/HoverCards";
import { useMemo, useState } from "react";
import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { WeeklyTrendChart } from "./WeeklyTrendChart";
import { INSIGHT_EVIDENCE_PANEL_ID } from "./insightEvidence";
import { localizedCategoryLabel, localizedProductivityLabel } from "../localization/activityTranslations";
import { useLocalization } from "../localization/LocalizationContext";


/**
 * Hour ticks for the 24-column rhythm axis. Korean uses bare 24-hour numbers:
 * the `시` suffix pushes each tick past the column width and wraps every label
 * from 10 onward onto a second line. The card heading already says 시간대별.
 */
export function formatRhythmHourLabel(hour: number, language: DisplayLanguage = "en"): string {
  if (language === "ko") return String(hour);
  if (hour === 0) return "12a";
  if (hour === 12) return "12p";
  return String(hour > 12 ? hour - 12 : hour);
}

export function WeeklyCategoryRow({
  weekly,
  categoryTotals,
  productivityDurations,
  productivityTotals,
  segments,
  classificationOptions,
  appIcons,
  projectSeries,
  projectMeta,
  projectBySegmentId,
  projectSegments,
  projectModeAvailable = false,
  mode,
  parts = "all",
  composition = "both",
  onModeChange,
}: {
  weekly: WeeklyBreakdownDay[];
  categoryTotals: CategoryDuration[];
  productivityDurations: ProductivityDuration[];
  productivityTotals: Record<ProductivityLabel, number>;
  segments: ActivitySegment[];
  classificationOptions: ClassificationOptions;
  appIcons: AppIconMap;
  projectSeries?: readonly WeeklyChartProjectSeriesItem[];
  projectMeta?: ReadonlyMap<string, { readonly label: string; readonly color: string }>;
  projectBySegmentId?: ReadonlyMap<string, string>;
  projectSegments: readonly ActivitySegment[];
  projectModeAvailable?: boolean;
  mode: WeeklyChartMode;
  /** Exploration switch: render the chart, the composition rail, or both. */
  parts?: "all" | "chart" | "rail";
  composition?: "both" | "category";
  onModeChange: (mode: WeeklyChartMode) => void;
}) {
  const { effectiveLanguage, t } = useLocalization();
  // A vanished project set (or an empty range) must not strand the chart in project mode.
  const effectiveMode: WeeklyChartMode = mode === "project" && !projectModeAvailable ? "category" : mode;
  const hoverSegments = effectiveMode === "project" ? projectSegments : segments;
  const [hoveredSegment, setHoveredSegment] = useState<CompactClassificationHoverState | null>(null);
  const categorySeries = useMemo<DonutCategorySlice[]>(
    () => categoryTotals.map((entry) => ({ category: entry.category, seconds: entry.totalSeconds })),
    [categoryTotals],
  );
  const hasData = weekly.some((day) => day.isActive);
  const chart = useMemo(() => buildWeeklyChartView(weekly, effectiveMode, categorySeries, projectSeries), [categorySeries, effectiveMode, projectSeries, weekly]);
  const productivityDonut = useMemo(() => {
    const view = buildDonutView("productivity", categorySeries, productivityTotals);
    return {
      ...view,
      centerLabel: view.rows[0] ? localizedProductivityLabel(view.rows[0].key as ProductivityLabel, t) : view.centerLabel,
      rows: view.rows.map((row) => ({ ...row, name: localizedProductivityLabel(row.key as ProductivityLabel, t), time: formatLocalizedCompactDurationFromSeconds(productivityTotals[row.key as ProductivityLabel], effectiveLanguage) })),
    };
  }, [categorySeries, effectiveLanguage, productivityTotals, t]);

  // Shared Day-rail inputs: durations, one composition bar, coloured dots.
  const railProductivityEntries = useMemo(
    () => buildProductivityRingEntries(productivityDurations).map((entry) => ({
      ...entry,
      label: localizedProductivityLabel(entry.key as ProductivityLabel, t),
    })),
    [productivityDurations, t],
  );
  const railProductivityCenterPercent = useMemo(() => buildProductivityCenterPercent(productivityDurations), [productivityDurations]);
  const railCategoryEntries = useMemo(() => buildClassifiedCategoryEntries(categoryTotals), [categoryTotals]);
  const railTotalSeconds = useMemo(
    () => FLOW_BREAKDOWN_PRODUCTIVITY_ORDER.reduce((sum, productivity) => sum + productivityTotals[productivity], 0),
    [productivityTotals],
  );
  const categoryDonut = useMemo(() => {
    const view = buildDonutView("category", categorySeries, productivityTotals);
    const secondsByCategory = new Map(categorySeries.map((entry) => [entry.category, entry.seconds]));
    return {
      ...view,
      centerLabel: view.rows[0] ? localizedCategoryLabel(view.rows[0].key as ActivityCategory, t) : view.centerLabel,
      rows: view.rows.map((row) => ({ ...row, name: localizedCategoryLabel(row.key as ActivityCategory, t), time: formatLocalizedCompactDurationFromSeconds(secondsByCategory.get(row.key as ActivityCategory) ?? 0, effectiveLanguage) })),
    };
  }, [categorySeries, effectiveLanguage, productivityTotals, t]);

  // Use the same projected slices and residual bucket as the project chart.
  // Weekday columns may be averages over several weeks; the rail shows the
  // selected period's actual totals, just like the category rail.
  const railProjectEntries = useMemo(() => {
    const secondsByKey = new Map<string, number>();
    for (const segment of projectSegments) {
      const key = projectBySegmentId?.get(segment.id)
        ?? (classifyActivity(segment, classificationOptions).category !== "unknown" ? NO_PROJECT_KEY : null);
      if (key === null) continue;
      secondsByKey.set(key, (secondsByKey.get(key) ?? 0) + segment.durationSeconds);
    }
    const entries = (projectSeries ?? []).map((item) => ({
      ...item,
      totalSeconds: secondsByKey.get(item.key) ?? 0,
    })).filter((entry) => entry.totalSeconds > 0);
    const totalSeconds = entries.reduce((sum, entry) => sum + entry.totalSeconds, 0);
    return entries.map((entry) => ({ ...entry, ratio: entry.totalSeconds / totalSeconds }));
  }, [classificationOptions, projectBySegmentId, projectSegments, projectSeries]);
  const railProjectTotalSeconds = railProjectEntries.reduce((sum, entry) => sum + entry.totalSeconds, 0);
  const projectLabel = (key: string) => projectMeta?.get(key)?.label
    ?? t(key === NO_PROJECT_KEY ? "projects.chart.noProject" : "common.project");

  const hoverPayloads = useMemo(() => {
    const entries = new Map<string, CompactClassificationHoverPayload>();

    function buildBreakdown(matchesSegment: (segment: ActivitySegment) => boolean) {
      return buildCompactActivityBreakdown(hoverSegments.filter(matchesSegment));
    }

    if (effectiveMode === "productivity") {
      const totalSeconds = FLOW_BREAKDOWN_PRODUCTIVITY_ORDER.reduce((sum, productivity) => sum + productivityTotals[productivity], 0);
      const productivityEntries = FLOW_BREAKDOWN_PRODUCTIVITY_ORDER.map((productivity) => ({
        key: productivity,
        label: localizedProductivityLabel(productivity, t),
        seconds: productivityTotals[productivity],
        color: PRODUCTIVITY_COLORS[productivity],
        dotClassName: `productivity-dot--${productivity}`,
      }));

      for (const entry of productivityEntries) {
        if (entry.seconds <= 0) continue;
        entries.set(entry.key, {
          label: entry.label,
          durationLabel: formatLocalizedCompactDurationFromSeconds(entry.seconds, effectiveLanguage),
          shareLabel: `${Math.round((entry.seconds / Math.max(totalSeconds, 1)) * 100)}%`,
          dotClassName: entry.dotClassName,
          color: entry.color,
          appBreakdown: buildBreakdown((segment) => classifyActivity(segment, classificationOptions).productivity === entry.key),
        });
      }
    } else if (effectiveMode === "project") {
      // Assigned time buckets by project; classified-but-unassigned time collects
      // in the shared "No project" bucket (matching the chart's stacked series).
      const matchesProject = (segment: ActivitySegment, key: string): boolean => key === NO_PROJECT_KEY
        ? !projectBySegmentId?.get(segment.id) && classifyActivity(segment, classificationOptions).category !== "unknown"
        : projectBySegmentId?.get(segment.id) === key;
      for (const item of railProjectEntries) {
        const meta = projectMeta?.get(item.key);
        entries.set(item.key, {
          label: meta?.label ?? t(item.key === NO_PROJECT_KEY ? "projects.chart.noProject" : "common.project"),
          durationLabel: formatLocalizedCompactDurationFromSeconds(item.totalSeconds, effectiveLanguage),
          shareLabel: `${Math.round(item.ratio * 100)}%`,
          dotClassName: "",
          color: item.color,
          appBreakdown: buildBreakdown((segment) => matchesProject(segment, item.key)),
        });
      }
    } else {
      const totalSeconds = railCategoryEntries.reduce((sum, entry) => sum + entry.totalSeconds, 0);
      for (const entry of railCategoryEntries) {
        if (entry.totalSeconds <= 0) continue;
        entries.set(entry.category, {
          label: localizedCategoryLabel(entry.category, t),
          durationLabel: formatLocalizedCompactDurationFromSeconds(entry.totalSeconds, effectiveLanguage),
          shareLabel: `${Math.round((entry.totalSeconds / Math.max(totalSeconds, 1)) * 100)}%`,
          dotClassName: `category-dot--${entry.category}`,
          color: CATEGORY_COLORS[entry.category],
          appBreakdown: buildBreakdown((segment) => classifyActivity(segment, classificationOptions).category === entry.category),
        });
      }
    }

    return entries;
  }, [classificationOptions, effectiveLanguage, effectiveMode, hoverSegments, productivityTotals, railProjectEntries, projectMeta, projectBySegmentId, railCategoryEntries, t]);

  function showAggregateHover(key: string, x: number, y: number) {
    const payload = hoverPayloads.get(key);
    if (!payload) return;
    setHoveredSegment({ ...payload, x, y });
  }

  function showWeeklySegmentHover(segment: WeeklyChartSegment, weekdayIndex: number, columnSeconds: number, x: number, y: number) {
    const payload = hoverPayloads.get(segment.key);
    if (!payload) return;
    const weekdayDates = new Set<string>();
    const bucketSegments = hoverSegments.filter((activitySegment) => {
      const started = new Date(activitySegment.startedAt);
      if (Number.isNaN(started.getTime()) || weekdayOrderIndex(started) !== weekdayIndex) return false;
      weekdayDates.add(localDateKey(started));
      if (effectiveMode === "project") {
        return segment.key === NO_PROJECT_KEY
          ? !projectBySegmentId?.get(activitySegment.id) && classifyActivity(activitySegment, classificationOptions).category !== "unknown"
          : projectBySegmentId?.get(activitySegment.id) === segment.key;
      }
      const classification = classifyActivity(activitySegment, classificationOptions);
      return effectiveMode === "productivity"
        ? classification.productivity === segment.key
        : classification.category === segment.key;
    });
    const occurrences = Math.max(weekdayDates.size, 1);
    setHoveredSegment({
      ...payload,
      durationLabel: formatLocalizedCompactDurationFromSeconds(segment.seconds, effectiveLanguage),
      shareLabel: `${Math.round((segment.seconds / Math.max(columnSeconds, 1)) * 100)}%`,
      appBreakdown: buildCompactActivityBreakdown(bucketSegments, occurrences),
      x,
      y,
    });
  }

  function moveSegmentHover(x: number, y: number) {
    setHoveredSegment((current) => current ? { ...current, x, y } : current);
  }

  return (
    <div className={`insights-row--weekly-categories insights-row--weekly-categories--${parts}`}>
      {parts === "rail" ? null : <WeeklyTrendChart
        chart={chart}
        segmentLabel={(key) => hoverPayloads.get(key)?.label ?? key}
        hasData={hasData}
        mode={effectiveMode}
        projectModeAvailable={projectModeAvailable}
        onHideSegmentHover={() => setHoveredSegment(null)}
        onModeChange={onModeChange}
        onMoveSegmentHover={moveSegmentHover}
        onShowSegmentHover={showWeeklySegmentHover}
      />}
      {parts === "chart" ? null : <section className="editorial-panel editorial-panel--soft insight-section od-cat-rebuilt weekly-summary-rail weekly-breakdown-analytical is-linked" aria-label={t("trends.weeklySummariesAria")}>
        {/* Same components the Day breakdown rail uses, so a category reads as
            one composition bar with durations here too, instead of five
            separately scaled percentage bars. */}
        {railTotalSeconds > 0 || railCategoryEntries.length > 0 || railProjectEntries.length > 0 ? (
          <div className={`weekly-summary-rail__stack weekly-breakdown-analytical__stack${composition === "category" ? " weekly-summary-rail__stack--category-only" : ""}`}>
            {composition === "both" && <CompactRingChart
              title={t("trends.overallProductivity")}
              ariaLabel={t("trends.productivityBreakdownAria")}
              entries={railProductivityEntries}
              totalSeconds={railTotalSeconds}
              centerPercent={railProductivityCenterPercent}
              flowBlocks={[]}
              appIcons={appIcons}
              language={effectiveLanguage}
            />}
            {effectiveMode === "project" ? <CompactClassificationBar
              key="project"
              title={t("dashboard.today.projects")}
              ariaLabel={t("trends.projectBreakdownAria")}
              entries={railProjectEntries}
              totalSeconds={railProjectTotalSeconds}
              getKey={(entry) => entry.key}
              getLabel={(entry) => projectLabel(entry.key)}
              getColor={(entry) => entry.color}
              getDotClassName={() => ""}
              getAppBreakdown={(entry) => hoverPayloads.get(entry.key)?.appBreakdown ?? []}
              appIcons={appIcons}
              visibleLimit={5}
              language={effectiveLanguage}
            /> : <CompactClassificationBar<CategoryDuration>
              key="category"
              title={t("dashboard.today.categories")}
              ariaLabel={t("trends.categoryBreakdownAria")}
              entries={railCategoryEntries}
              totalSeconds={railTotalSeconds}
              getKey={(entry) => entry.category}
              getLabel={(entry) => localizedCategoryLabel(entry.category, t)}
              getColor={(entry) => CATEGORY_COLORS[entry.category]}
              getDotClassName={(entry) => `category-dot--${entry.category}`}
              getAppBreakdown={() => []}
              appIcons={appIcons}
              visibleLimit={5}
              language={effectiveLanguage}
            />}
          </div>
        ) : <EmptyState title={t("trends.noWeeklySplit")} detail={t("trends.noWeeklySplitDetail")} />}
      </section>}
      {hoveredSegment ? <CompactClassificationHoverCard hover={hoveredSegment} appIcons={appIcons} /> : null}
    </div>
  );
}

export function AttentionRhythmCard({
  appIcons,
  cells,
  classificationOptions,
  segments,
  summary,
}: {
  appIcons: AppIconMap;
  cells: AttentionRhythmCell[];
  classificationOptions: ClassificationOptions;
  segments: ActivitySegment[];
  summary?: ReactNode;
}) {
  const { effectiveLanguage, t } = useLocalization();
  const [hoveredSegment, setHoveredSegment] = useState<CompactClassificationHoverState | null>(null);
  const hasData = cells.some((cell) => cell.intensity > 0);
  const totalSeconds = segments.reduce((sum, segment) => sum + segment.durationSeconds, 0);
  const weekdayLabels = useMemo(() => {
    const orderedWeekdayIndexes = cells
      .filter((cell) => cell.hour === 0)
      .map((cell) => cell.weekdayIndex);
    const fallbackIndexes = orderedWeekdayIndexes.length > 0 ? orderedWeekdayIndexes : [0, 1, 2, 3, 4, 5, 6];
    const koreanWeekdays = ["월", "화", "수", "목", "금", "토", "일"] as const;
    return fallbackIndexes.map((weekdayIndex) => (
      effectiveLanguage === "ko"
        ? koreanWeekdays[weekdayIndex] ?? ""
        : WEEKLY_BREAKDOWN_WEEKDAYS[weekdayIndex] ?? ""
    ));
  }, [cells, effectiveLanguage]);

  function showCellHover(cell: AttentionRhythmCell, x: number, y: number) {
    if (cell.intensity <= 0 || cell.state === "neutral") return;
    const matchingSegments = segments.filter((segment) => {
      const started = new Date(segment.startedAt);
      return !Number.isNaN(started.getTime())
        && weekdayOrderIndex(started) === cell.weekdayIndex
        && started.getHours() === cell.hour
        && classifyActivity(segment, classificationOptions).productivity === cell.state;
    });
    const cellSeconds = matchingSegments.reduce((sum, segment) => sum + segment.durationSeconds, 0);
    if (cellSeconds <= 0) return;
    setHoveredSegment({
      label: localizedProductivityLabel(cell.state, t),
      durationLabel: formatLocalizedCompactDurationFromSeconds(cellSeconds, effectiveLanguage),
      shareLabel: `${Math.round((cellSeconds / Math.max(totalSeconds, 1)) * 100)}%`,
      dotClassName: `productivity-dot--${cell.state}`,
      color: PRODUCTIVITY_COLORS[cell.state],
      appBreakdown: buildCompactActivityBreakdown(matchingSegments),
      x,
      y,
    });
  }

  function moveCellHover(x: number, y: number) {
    setHoveredSegment((current) => current ? { ...current, x, y } : current);
  }

  return (
    <section id="insights-weekly-attention-rhythm" className="editorial-panel editorial-panel--soft insight-section productivity-rhythm-card productivity-rhythm-card--attention" aria-label={t("trends.attentionRhythm")}>
      <div className="productivity-rhythm-card__head productivity-rhythm-card__head--attention">
        <div><span className="label-mono insight-section__label">{t("trends.attentionRhythm")}</span></div>
        <div className="productivity-rhythm-card__legend" aria-hidden="true">
          <span className="productivity-rhythm-card__legend-item"><span className="productivity-rhythm-card__legend-dot productivity-rhythm-card__legend-dot--focus" /><span>{t("activity.productivity.focus")}</span></span>
          <span className="productivity-rhythm-card__legend-item"><span className="productivity-rhythm-card__legend-dot productivity-rhythm-card__legend-dot--drift" /><span>{t("activity.productivity.drift")}</span></span>
          <span className="productivity-rhythm-card__legend-item"><span className="productivity-rhythm-card__legend-dot productivity-rhythm-card__legend-dot--neutral" /><span>{t("activity.productivity.neutral")}</span></span>
        </div>
      </div>
      {summary}
      {hasData ? (
        <div className="productivity-rhythm-card__grid" role="img" aria-label={t("trends.attentionRhythmAria")}>
          <div className="productivity-rhythm-card__times">
            <span />
            {Array.from({ length: 24 }, (_, hour) => <span key={hour}>{formatRhythmHourLabel(hour, effectiveLanguage)}</span>)}
          </div>
          <div className="productivity-rhythm-card__body">
            <div className="productivity-rhythm-card__weekdays" aria-hidden="true">
              {weekdayLabels.map((weekday, index) => <span className="productivity-rhythm-card__weekday" key={`${weekday}-${index}`}>{weekday}</span>)}
            </div>
            <div className="productivity-rhythm-card__board">
              {cells.map((cell, index) => {
                const variant = cell.state === "neutral" ? "neutral" : `${cell.state}-${cell.intensity}`;
                const parts: string[] = [];
                const weekdayPosition = Math.floor(index / 24);
                if (cell.hour !== 23) parts.push("inset -1px 0 0 var(--attention-rhythm-divider)");
                if (weekdayPosition < weekdayLabels.length - 1) parts.push("inset 0 -1px 0 var(--attention-rhythm-divider)");
                return (
                  <span
                    key={`${cell.weekdayIndex}-${cell.hour}`}
                    className={`productivity-rhythm-card__cell productivity-rhythm-card__cell--${variant}`}
                    style={parts.length > 0 ? { boxShadow: parts.join(", ") } : undefined}
                    onMouseEnter={(event: MouseEvent<HTMLSpanElement>) => showCellHover(cell, event.clientX, event.clientY)}
                    onMouseMove={(event: MouseEvent<HTMLSpanElement>) => moveCellHover(event.clientX, event.clientY)}
                    onMouseLeave={() => setHoveredSegment(null)}
                  />
                );
              })}
            </div>
          </div>
        </div>
      ) : <EmptyState title={t("trends.noRhythm")} detail={t("trends.noRhythmDetail")} />}
      {hoveredSegment ? <CompactClassificationHoverCard hover={hoveredSegment} appIcons={appIcons} /> : null}
    </section>
  );
}

export function InsightSourceGroup({
  variant,
  lists,
  appIcons,
  pageSize,
  activeEvidence = null,
  onOpenEvidence,
}: {
  variant: ProductivityAnalysisKind;
  lists: InsightSourceLists;
  appIcons: AppIconMap;
  pageSize?: number;
  /** The row whose records are open beside the lists, if any. */
  activeEvidence?: { readonly list: keyof InsightSourceLists; readonly itemId: string } | null;
  /** When given, each row opens the records it counts. */
  onOpenEvidence?: (list: keyof InsightSourceLists, item: InsightSourceItem) => void;
}) {
  const { effectiveLanguage, t } = useLocalization();
  const [pages, setPages] = useState({ apps: 0, topics: 0 });
  const tone = variant === "drift" ? "var(--productivity-drift)" : "var(--productivity-focus)";
  const topicsLabel = t(variant === "drift" ? "trends.driftAfterFocus" : "trends.focusBeforeDrift");
  const transitionsLabel = t(variant === "drift" ? "trends.driftTransitionsAria" : "trends.focusTransitionsAria");
  const appsLabel = t(variant === "drift" ? "trends.driftApps" : "trends.focusApps");
  const kindLabel = t(variant === "drift" ? "activity.productivity.drift" : "activity.productivity.focus");
  const toneStyle = { "--trend-tone": tone } as CSSProperties;

  const renderSourceList = (
    kind: keyof InsightSourceLists,
    sourceLabel: string,
    emptyTitle: string,
    emptyDetail: string,
  ) => {
    const items = lists[kind];
    const maxValue = Math.max(1, ...items.map((item) => insightSourceValue(item)));
    const lastPage = pageSize ? Math.max(0, Math.ceil(items.length / pageSize) - 1) : 0;
    const page = Math.min(pages[kind], lastPage);
    const start = pageSize ? page * pageSize : 0;
    const visibleItems = pageSize ? items.slice(start, start + pageSize) : items;

    return (
      <div className="drift-time-trend__sources">
        <div className="insight-source-heading">
          <span className="label-mono drift-time-trend__sources-label">{sourceLabel}</span>
          {lastPage > 0 && <div className="insight-source-pager">
            <span aria-live="polite">{start + 1}–{Math.min(start + pageSize!, items.length)} / {items.length}</span>
            <button type="button" disabled={page === 0} aria-label={t("trends.sources.previous", { label: sourceLabel })} onClick={() => setPages(current => ({ ...current, [kind]: page - 1 }))}>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m10 4-4 4 4 4" /></svg>
            </button>
            <button type="button" disabled={page === lastPage} aria-label={t("trends.sources.next", { label: sourceLabel })} onClick={() => setPages(current => ({ ...current, [kind]: page + 1 }))}>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 4 4 4-4 4" /></svg>
            </button>
          </div>}
        </div>
        <div className="drift-time-trend__sources-items" style={toneStyle}>
          {visibleItems.map((item, index) => {
            const valueLabel = item.valueKind === "count" ? (effectiveLanguage === "ko" ? `${item.count}회` : `${item.count}x`) : formatLocalizedCompactDurationFromSeconds(item.seconds, effectiveLanguage);
            const content = (
              <>
                <span className="drift-time-trend__sources-rank" aria-hidden="true">{start + index + 1}</span>
                <span className="drift-time-trend__sources-icon" aria-hidden="true">
                  {item.isSite && item.siteDomain
                    ? <SiteFavicon domain={item.siteDomain} size={22} fallbackIconSrc={appIcons[item.bundleId ?? item.appName] ?? null} />
                    : <AppGlyph appName={item.appName} iconSrc={appIcons[item.bundleId ?? item.appName] ?? null} size="sm" />}
                </span>
                <span className="drift-time-trend__sources-name" title={item.label}>{item.label}</span>
                <strong className="drift-time-trend__sources-value">{valueLabel}</strong>
                <span className="drift-source-bar" aria-hidden="true"><span className="drift-source-bar__fill" style={{ width: `${Math.max((insightSourceValue(item) / maxValue) * 100, 3)}%` }} /></span>
              </>
            );
            if (!onOpenEvidence) {
              return <div className="drift-time-trend__sources-item drift-time-trend__sources-item--app" key={item.id}>{content}</div>;
            }
            const isActive = activeEvidence?.list === kind && activeEvidence.itemId === item.id;
            return (
              <button
                type="button"
                className={`drift-time-trend__sources-item drift-time-trend__sources-item--app drift-time-trend__sources-item--evidence${isActive ? " is-active" : ""}`}
                key={item.id}
                data-insight-evidence-key={`${variant}:${kind}:${item.id}`}
                aria-label={`${item.label}, ${valueLabel}. ${t("trends.evidence.open", { label: item.label })}`}
                aria-expanded={isActive}
                aria-controls={isActive ? INSIGHT_EVIDENCE_PANEL_ID : undefined}
                onClick={() => onOpenEvidence(kind, item)}
              >
                {content}
              </button>
            );
          })}
          {items.length === 0 ? <EmptyState title={emptyTitle} detail={emptyDetail} /> : null}
        </div>
      </div>
    );
  };

  return (
    <section className={`editorial-panel editorial-panel--soft insight-section productivity-insight-group productivity-insight-group--${variant}`} aria-label={t(variant === "drift" ? "trends.driftPatternsAria" : "trends.focusPatternsAria")}>
      <section className="editorial-panel editorial-panel--soft insight-section trend-topics-card productivity-insight-group__section" aria-label={transitionsLabel} style={toneStyle}>
        <div className="trend-topics-card__columns">
          {renderSourceList("apps", appsLabel, t("trends.noApps", { kind: kindLabel }), t("trends.appsEmptyDetail"))}
          {renderSourceList("topics", topicsLabel, t("trends.noTransitions", { kind: kindLabel }), t("trends.transitionsEmptyDetail"))}
        </div>
      </section>
    </section>
  );
}

export function ProductivityAnalysisSection({
  appIcons,
  ariaLabel,
  emptyDetail,
  emptyTitle,
  heading,
  label,
  metricLabel,
  patternsLabel,
  report,
  sourcesLabel,
  variant,
}: {
  appIcons: AppIconMap;
  ariaLabel: string;
  emptyDetail: string;
  emptyTitle: string;
  heading: string;
  label: string;
  metricLabel: string;
  patternsLabel: string;
  report: ProductivityInsightReport;
  sourcesLabel: string;
  variant: ProductivityAnalysisKind;
}) {
  return (
    <section className={`editorial-panel editorial-panel--soft insight-section insight-section--source-analysis insight-section--${variant}-analysis`} aria-label={ariaLabel}>
      <div className="drift-analysis__head">
        <div>
          <span className="label-mono insight-section__label">{label}</span>
          <h2>{heading}</h2>
        </div>
        <span className="drift-analysis__badge">Weekly signal</span>
      </div>
      {report.totalSeconds > 0 ? (
        <div className="drift-analysis__layout">
          <div className="drift-analysis__sources" aria-label={sourcesLabel}>
            {report.topSurfaces.map((surface, index) => (
              <div className="drift-source-row" key={surface.id}>
                <div className="drift-source-row__rank">{index + 1}</div>
                <div className="drift-source-row__icon" aria-hidden="true">
                  {surface.siteDomain ? (
                    <SiteFavicon domain={surface.siteDomain} size={20} fallbackIconSrc={appIcons[surface.bundleId ?? surface.appName] ?? null} />
                  ) : (
                    <AppGlyph appName={surface.label} iconSrc={appIcons[surface.bundleId ?? surface.appName] ?? null} size="sm" />
                  )}
                </div>
                <div className="drift-source-row__body">
                  <div className="drift-source-row__title"><strong>{surface.label}</strong><span>{surface.detail}</span></div>
                  <div className="drift-source-row__bar"><span style={{ width: `${Math.max(surface.share * 100, 3)}%` }} /></div>
                  <p>{formatCompactDurationFromSeconds(surface.seconds)} {metricLabel} · {surface.captures} {surface.captures === 1 ? "capture" : "captures"} · {surface.activeDays} active {surface.activeDays === 1 ? "day" : "days"}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="drift-analysis__patterns" aria-label={patternsLabel}>
            {report.patternCards.map((card) => (
              <div className={`drift-pattern-card drift-pattern-card--${card.tone}`} key={card.id}>
                <span>{card.label}</span>
                <strong>{card.value}</strong>
                <p>{card.detail}</p>
              </div>
            ))}
          </div>
        </div>
      ) : <EmptyState title={emptyTitle} detail={emptyDetail} />}
    </section>
  );
}
