import { AppGlyph } from "../../components/AppGlyph";
import { SiteFavicon } from "../../components/SiteFavicon";
import { DONUT_CIRCUMFERENCE, WEEKLY_BREAKDOWN_WEEKDAYS, buildDonutView, buildWeeklyChartView, formatInsightSourceValue, insightSourceValue } from "./insightData";
import type { AttentionRhythmCell, DonutCategorySlice, DonutView, InsightSourceLists, ProductivityAnalysisKind, ProductivityInsightReport, WeeklyBreakdownDay, WeeklyChartMode, WeeklyChartSegment } from "./insightData";
import { CATEGORY_COLORS, FLOW_BREAKDOWN_PRODUCTIVITY_ORDER, PRODUCTIVITY_COLORS, categoryLabel, productivityLabel } from "../../lib/activityLabels";
import { formatCompactDurationFromSeconds, localDateKey, weekdayOrderIndex } from "../../lib/formatting";
import { buildProductivityPersona, classifyActivity, logicalDayIsoDateForDate } from "@drifty/domain";
import type { ActivityCategory, ActivitySegment, AppIconMap, ClassificationOptions, ProductivityLabel } from "@drifty/domain";
import { EmptyState } from "../../components/EmptyState";
import { buildCompactActivityBreakdown } from "../dashboard/CompactCharts";
import { CompactClassificationHoverCard, formatSharePercent } from "../dashboard/HoverCards";
import type { CompactClassificationHoverPayload, CompactClassificationHoverState } from "../dashboard/HoverCards";
import { useMemo, useState } from "react";
import type { CSSProperties, MouseEvent } from "react";
import { WeeklyTrendChart } from "./WeeklyTrendChart";

export const PERSONA_CONTENT: Record<string, { tags: string; copy: [string, string] }> = {
  deep_diver: {
    tags: "Long focus sessions · Low drift · Stable context",
    copy: [
      "You do your best work in long, focused sessions with low drift and minimal context switching.",
      "Your pattern shows strong depth, making you most effective when you protect uninterrupted work blocks.",
    ],
  },
  deep_focus_deep_drift: {
    tags: "Strong focus · Heavy drift · High contrast",
    copy: [
      "You swing between deep focus and heavy drift, with little time spent in the middle.",
      "Channeling the same intensity that fuels your drift into your focus blocks is where your biggest gains are.",
    ],
  },
  drift_diver: {
    tags: "Long drift runs · Low focus · Sticky surfaces",
    copy: [
      "Your time leans toward long drift sessions that are hard to break out of once they start.",
      "Small guardrails at the start of a drift run would reclaim the largest share of your day.",
    ],
  },
  focus_sprinter: {
    tags: "Short focus bursts · Frequent switching · High energy",
    copy: [
      "You focus in short, energetic bursts rather than long stretches of deep work.",
      "Stacking a few sprints back to back would turn your momentum into sustained progress.",
    ],
  },
  reactive_operator: {
    tags: "Communication-heavy · Frequent switching · Responsive",
    copy: [
      "Much of your time goes to communication and reactive work that pulls your attention around.",
      "Carving out one protected block a day would give your deeper work room to breathe.",
    ],
  },
  night_owl: {
    tags: "Late-night focus · Shifted rhythm · Quiet hours",
    copy: [
      "Your most productive hours land late at night, well after the typical workday.",
      "Leaning into your natural night rhythm — while protecting recovery — keeps this pattern sustainable.",
    ],
  },
  balanced_builder: {
    tags: "Even split · Steady rhythm · Adaptable",
    copy: [
      "Your time is split fairly evenly across focus, neutral, and drift, with a steady daily rhythm.",
      "You adapt well to different kinds of work; nudging a bit more time toward focus compounds quickly.",
    ],
  },
};

export type FocusProfileAxisKey = "focus_start" | "focus_endurance" | "short_drifts" | "focus_routine" | "balanced_focus";

export type FocusProfileAxis = {
  readonly key: FocusProfileAxisKey;
  readonly label: string;
  readonly value: number;
};

export const FOCUS_PROFILE_HELP =
  "Focus profile is calculated from focus starts, focus endurance, short drift recovery, focus routine consistency, and balanced focus ratio.";

export const FOCUS_ENDURANCE_TARGET_SECONDS = 45 * 60;

export const MEANINGFUL_DAILY_FOCUS_SECONDS = 30 * 60;

export const STRONG_DAILY_FOCUS_SECONDS = 3 * 60 * 60;

export const SHORT_DRIFT_REFERENCE_SECONDS = 20 * 60;

export const BALANCED_FOCUS_TARGET = 0.65;

export const BALANCED_FOCUS_LOW_TOLERANCE = 0.55;

export const BALANCED_FOCUS_HIGH_TOLERANCE = 0.65;

export function buildFocusProfileAxes(
  segments: ActivitySegment[],
  classificationOptions: ClassificationOptions,
  metrics: ReturnType<typeof buildProductivityPersona>["metrics"],
): FocusProfileAxis[] {
  const dayStats = buildFocusProfileDayStats(segments, classificationOptions);
  const activeDayCount = dayStats.length;
  const focusStartScore = activeDayCount > 0
    ? calibrateCoverage(dayStats.filter((day) => day.firstProductivity === "focus").length / activeDayCount)
    : metrics.focusShare;
  const focusDays = dayStats.filter((day) => day.focusSeconds >= MEANINGFUL_DAILY_FOCUS_SECONDS).length;
  const dailyFocusAverage = activeDayCount > 0
    ? dayStats.reduce((total, day) => total + day.focusSeconds, 0) / activeDayCount
    : metrics.focusAverageSegmentSeconds;
  const focusRoutineScore = activeDayCount > 0
    ? (calibrateCoverage(focusDays / activeDayCount) * 0.7) + (calibrateSqrt(dailyFocusAverage, STRONG_DAILY_FOCUS_SECONDS) * 0.3)
    : metrics.focusShare;
  const shortDriftScore = metrics.driftSeconds > 0
    ? SHORT_DRIFT_REFERENCE_SECONDS / (SHORT_DRIFT_REFERENCE_SECONDS + metrics.driftAverageSegmentSeconds)
    : 1;
  const focusBalanceTolerance = metrics.focusShare <= BALANCED_FOCUS_TARGET
    ? BALANCED_FOCUS_LOW_TOLERANCE
    : BALANCED_FOCUS_HIGH_TOLERANCE;
  const balancedFocusScore = 1 - clampFocusProfileValue(Math.abs(metrics.focusShare - BALANCED_FOCUS_TARGET) / focusBalanceTolerance);

  return [
    { key: "focus_start", label: "Focus Start", value: clampFocusProfileValue(focusStartScore) },
    { key: "focus_endurance", label: "Focus Endurance", value: calibrateSqrt(metrics.focusAverageSegmentSeconds, FOCUS_ENDURANCE_TARGET_SECONDS) },
    { key: "short_drifts", label: "Short Drifts", value: clampFocusProfileValue(shortDriftScore) },
    { key: "focus_routine", label: "Focus Routine", value: clampFocusProfileValue(focusRoutineScore) },
    { key: "balanced_focus", label: "Balanced Focus", value: clampFocusProfileValue(balancedFocusScore) },
  ];
}

export function buildFocusProfileDayStats(segments: ActivitySegment[], classificationOptions: ClassificationOptions): Array<{
  readonly firstProductivity: ProductivityLabel;
  readonly focusSeconds: number;
}> {
  const byDay = new Map<string, { firstProductivity: ProductivityLabel; focusSeconds: number }>();
  const orderedSegments = segments.slice().sort((left, right) => {
    const startedAtOrder = left.startedAt.localeCompare(right.startedAt);
    if (startedAtOrder !== 0) return startedAtOrder;
    return left.id.localeCompare(right.id);
  });

  for (const segment of orderedSegments) {
    const dayKey = logicalDayIsoDateForDate(new Date(segment.startedAt));
    const classification = classifyActivity(segment, classificationOptions);
    const existing = byDay.get(dayKey);
    const focusSeconds = classification.productivity === "focus" ? segment.durationSeconds : 0;

    byDay.set(dayKey, {
      firstProductivity: existing?.firstProductivity ?? classification.productivity,
      focusSeconds: (existing?.focusSeconds ?? 0) + focusSeconds,
    });
  }

  return Array.from(byDay.values());
}

export function clampFocusProfileValue(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function calibrateSqrt(value: number, target: number): number {
  if (value <= 0 || target <= 0) return 0;
  return clampFocusProfileValue(Math.sqrt(value / target));
}

export function calibrateCoverage(value: number): number {
  return clampFocusProfileValue(0.15 + (0.85 * clampFocusProfileValue(value)));
}

export function formatRhythmHourLabel(hour: number): string {
  if (hour === 0) return "12a";
  if (hour === 12) return "12p";
  return String(hour > 12 ? hour - 12 : hour);
}

export function WeeklyCategoryRow({
  weekly,
  categoryTotals,
  productivityTotals,
  segments,
  classificationOptions,
  appIcons,
}: {
  weekly: WeeklyBreakdownDay[];
  categoryTotals: Array<{ category: ActivityCategory; totalSeconds: number }>;
  productivityTotals: Record<ProductivityLabel, number>;
  segments: ActivitySegment[];
  classificationOptions: ClassificationOptions;
  appIcons: AppIconMap;
}) {
  const [mode, setMode] = useState<WeeklyChartMode>("category");
  const [hoveredSegment, setHoveredSegment] = useState<CompactClassificationHoverState | null>(null);
  const categorySeries = useMemo<DonutCategorySlice[]>(
    () => categoryTotals.map((entry) => ({ category: entry.category, seconds: entry.totalSeconds })),
    [categoryTotals],
  );
  const hasData = weekly.some((day) => day.isActive);
  const chart = useMemo(() => buildWeeklyChartView(weekly, mode, categorySeries), [categorySeries, mode, weekly]);
  const productivityDonut = useMemo(() => buildDonutView("productivity", categorySeries, productivityTotals), [categorySeries, productivityTotals]);
  const categoryDonut = useMemo(() => buildDonutView("category", categorySeries, productivityTotals), [categorySeries, productivityTotals]);

  const hoverPayloads = useMemo(() => {
    const totalSeconds = mode === "productivity"
      ? FLOW_BREAKDOWN_PRODUCTIVITY_ORDER.reduce((sum, productivity) => sum + productivityTotals[productivity], 0)
      : categoryTotals.reduce((sum, entry) => sum + entry.totalSeconds, 0);
    const entries = new Map<string, CompactClassificationHoverPayload>();

    function buildBreakdown(matchesSegment: (segment: ActivitySegment) => boolean) {
      return buildCompactActivityBreakdown(segments.filter(matchesSegment));
    }

    if (mode === "productivity") {
      const productivityEntries = FLOW_BREAKDOWN_PRODUCTIVITY_ORDER.map((productivity) => ({
        key: productivity,
        label: productivityLabel(productivity),
        seconds: productivityTotals[productivity],
        color: PRODUCTIVITY_COLORS[productivity],
        dotClassName: `productivity-dot--${productivity}`,
      }));

      for (const entry of productivityEntries) {
        if (entry.seconds <= 0) continue;
        entries.set(entry.key, {
          label: entry.label,
          durationLabel: formatCompactDurationFromSeconds(entry.seconds),
          shareLabel: `${Math.round((entry.seconds / Math.max(totalSeconds, 1)) * 100)}%`,
          dotClassName: entry.dotClassName,
          color: entry.color,
          disableRemoteFavicons: true,
          appBreakdown: buildBreakdown((segment) => classifyActivity(segment, classificationOptions).productivity === entry.key),
        });
      }
    } else {
      for (const entry of categoryTotals) {
        if (entry.totalSeconds <= 0) continue;
        entries.set(entry.category, {
          label: categoryLabel(entry.category),
          durationLabel: formatCompactDurationFromSeconds(entry.totalSeconds),
          shareLabel: `${Math.round((entry.totalSeconds / Math.max(totalSeconds, 1)) * 100)}%`,
          dotClassName: `category-dot--${entry.category}`,
          color: CATEGORY_COLORS[entry.category],
          disableRemoteFavicons: true,
          appBreakdown: buildBreakdown((segment) => classifyActivity(segment, classificationOptions).category === entry.category),
        });
      }
    }

    return entries;
  }, [categoryTotals, classificationOptions, mode, productivityTotals, segments]);

  function showAggregateHover(key: string, x: number, y: number) {
    const payload = hoverPayloads.get(key);
    if (!payload) return;
    setHoveredSegment({ ...payload, x, y });
  }

  function showWeeklySegmentHover(segment: WeeklyChartSegment, weekdayIndex: number, columnSeconds: number, x: number, y: number) {
    const payload = hoverPayloads.get(segment.key);
    if (!payload) return;
    const weekdayDates = new Set<string>();
    const bucketSegments = segments.filter((activitySegment) => {
      const started = new Date(activitySegment.startedAt);
      if (Number.isNaN(started.getTime()) || weekdayOrderIndex(started) !== weekdayIndex) return false;
      weekdayDates.add(localDateKey(started));
      const classification = classifyActivity(activitySegment, classificationOptions);
      return mode === "productivity"
        ? classification.productivity === segment.key
        : classification.category === segment.key;
    });
    const occurrences = Math.max(weekdayDates.size, 1);
    setHoveredSegment({
      ...payload,
      durationLabel: formatCompactDurationFromSeconds(segment.seconds),
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
    <div className="insights-row--weekly-categories">
      <WeeklyTrendChart
        chart={chart}
        hasData={hasData}
        mode={mode}
        onHideSegmentHover={() => setHoveredSegment(null)}
        onModeChange={setMode}
        onMoveSegmentHover={moveSegmentHover}
        onShowSegmentHover={showWeeklySegmentHover}
      />
      <section className="editorial-panel editorial-panel--soft insight-section od-cat-rebuilt weekly-summary-rail weekly-breakdown-analytical is-linked" aria-label="Insight weekly summaries">
        {productivityDonut.rows.length > 0 || categoryDonut.rows.length > 0 ? (
          <div className="weekly-summary-rail__stack weekly-breakdown-analytical__stack">
            <WeeklyDonutSummary
              ariaLabel="Insight productivity breakdown"
              className="weekly-summary-rail__summary--productivity weekly-breakdown-analytical__productivity productivity-donut-compact"
              view={productivityDonut}
              onShowHover={showAggregateHover}
              onMoveHover={moveSegmentHover}
              onHideHover={() => setHoveredSegment(null)}
            />
            <WeeklyCategoryBreakdown
              ariaLabel="Insight category breakdown"
              view={categoryDonut}
              onShowHover={showAggregateHover}
              onMoveHover={moveSegmentHover}
              onHideHover={() => setHoveredSegment(null)}
            />
          </div>
        ) : <EmptyState title="No weekly split yet" detail="Weekly focus and category totals appear once activity is recorded." />}
      </section>
      {hoveredSegment ? <CompactClassificationHoverCard hover={hoveredSegment} appIcons={appIcons} /> : null}
    </div>
  );
}

export function WeeklyDonutSummary({
  ariaLabel,
  className,
  view,
  onShowHover,
  onMoveHover,
  onHideHover,
}: {
  ariaLabel: string;
  className: string;
  view: DonutView;
  onShowHover: (key: string, x: number, y: number) => void;
  onMoveHover: (x: number, y: number) => void;
  onHideHover: () => void;
}) {
  return (
    <div className={`weekly-summary-rail__summary ${className}`} role="group" aria-label={ariaLabel}>
      <div className="od-cat-body">
        <div className="od-cat-left">
          <div className="od-cat-donut-wrap">
            <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
              <circle cx="50" cy="50" r="40" fill="none" style={{ stroke: "rgba(0,0,0,0.07)" }} strokeWidth="17" />
              {view.slices.map((slice) => (
                <circle
                  key={slice.key}
                  className="od-cat-donut-slice"
                  cx="50"
                  cy="50"
                  r="40"
                  fill="none"
                  style={{ stroke: slice.color }}
                  strokeWidth="17"
                  strokeLinecap="butt"
                  strokeDasharray={`${slice.dash.toFixed(2)} ${DONUT_CIRCUMFERENCE.toFixed(2)}`}
                  strokeDashoffset={slice.offset.toFixed(2)}
                  transform="rotate(-90 50 50)"
                  onMouseEnter={(event: MouseEvent<SVGCircleElement>) => onShowHover(slice.key, event.clientX, event.clientY)}
                  onMouseMove={(event: MouseEvent<SVGCircleElement>) => onMoveHover(event.clientX, event.clientY)}
                  onMouseLeave={onHideHover}
                />
              ))}
            </svg>
            <div className="od-cat-center">
              <span className="od-cat-center-pct">{view.centerPct}</span>
              <span className="od-cat-center-label">{view.centerLabel}</span>
            </div>
          </div>
        </div>
        <div className="od-cat-right">
          {view.rows.map((row) => (
            <div
              className="od-cat-row"
              key={row.key}
              onMouseEnter={(event: MouseEvent<HTMLDivElement>) => onShowHover(row.key, event.clientX, event.clientY)}
              onMouseMove={(event: MouseEvent<HTMLDivElement>) => onMoveHover(event.clientX, event.clientY)}
              onMouseLeave={onHideHover}
            >
              <div className="od-cat-row-head">
                <span className="od-cat-row-dot" style={{ background: row.color }} aria-hidden="true" />
                <span className="od-cat-row-name">{row.name}</span>
                <div className="od-cat-row-meta">
                  <span className="od-cat-row-time">{row.time}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function WeeklyCategoryBreakdown({
  ariaLabel,
  view,
  onShowHover,
  onMoveHover,
  onHideHover,
}: {
  ariaLabel: string;
  view: DonutView;
  onShowHover: (key: string, x: number, y: number) => void;
  onMoveHover: (x: number, y: number) => void;
  onHideHover: () => void;
}) {
  return (
    <div className="weekly-summary-rail__summary weekly-summary-rail__summary--category top-categories-breakdown" role="group" aria-label={ariaLabel}>
      <span className="weekly-breakdown-analytical__eyebrow">Top categories</span>
      <div className="top-categories-breakdown__list">
        {view.rows.map((row) => (
          <div
            className="top-categories-breakdown__row"
            key={row.key}
            onMouseEnter={(event: MouseEvent<HTMLDivElement>) => onShowHover(row.key, event.clientX, event.clientY)}
            onMouseMove={(event: MouseEvent<HTMLDivElement>) => onMoveHover(event.clientX, event.clientY)}
            onMouseLeave={onHideHover}
          >
            <div className="top-categories-breakdown__meta">
              <span>{row.name}</span>
              <strong>{Math.round(row.pct)}%</strong>
            </div>
            <div className="top-categories-breakdown__bar">
              <span style={{ width: `${Math.max(row.fillPct, 3)}%`, background: row.color }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AttentionRhythmCard({
  appIcons,
  cells,
  classificationOptions,
  segments,
}: {
  appIcons: AppIconMap;
  cells: AttentionRhythmCell[];
  classificationOptions: ClassificationOptions;
  segments: ActivitySegment[];
}) {
  const [hoveredSegment, setHoveredSegment] = useState<CompactClassificationHoverState | null>(null);
  const hasData = cells.some((cell) => cell.intensity > 0);
  const totalSeconds = segments.reduce((sum, segment) => sum + segment.durationSeconds, 0);
  const weekdayLabels = useMemo(() => {
    const labels = cells
      .filter((cell) => cell.hour === 0)
      .map((cell) => WEEKLY_BREAKDOWN_WEEKDAYS[cell.weekdayIndex] ?? "");
    return labels.length > 0 ? labels : WEEKLY_BREAKDOWN_WEEKDAYS;
  }, [cells]);

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
      label: productivityLabel(cell.state),
      durationLabel: formatCompactDurationFromSeconds(cellSeconds),
      shareLabel: `${Math.round((cellSeconds / Math.max(totalSeconds, 1)) * 100)}%`,
      dotClassName: `productivity-dot--${cell.state}`,
      color: PRODUCTIVITY_COLORS[cell.state],
      disableRemoteFavicons: true,
      appBreakdown: buildCompactActivityBreakdown(matchingSegments),
      x,
      y,
    });
  }

  function moveCellHover(x: number, y: number) {
    setHoveredSegment((current) => current ? { ...current, x, y } : current);
  }

  return (
    <section id="insights-weekly-attention-rhythm" className="editorial-panel editorial-panel--soft insight-section productivity-rhythm-card productivity-rhythm-card--attention" aria-label="Weekly attention rhythm">
      <div className="productivity-rhythm-card__head productivity-rhythm-card__head--attention">
        <div><span className="label-mono insight-section__label">Weekly attention rhythm</span></div>
        <div className="productivity-rhythm-card__legend" aria-hidden="true">
          <span className="productivity-rhythm-card__legend-item"><span className="productivity-rhythm-card__legend-dot productivity-rhythm-card__legend-dot--focus" /><span>Focus</span></span>
          <span className="productivity-rhythm-card__legend-item"><span className="productivity-rhythm-card__legend-dot productivity-rhythm-card__legend-dot--drift" /><span>Drift</span></span>
          <span className="productivity-rhythm-card__legend-item"><span className="productivity-rhythm-card__legend-dot productivity-rhythm-card__legend-dot--neutral" /><span>Neutral</span></span>
        </div>
      </div>
      {hasData ? (
        <div className="productivity-rhythm-card__grid" role="img" aria-label="Weekly attention rhythm dominant focus or drift by weekday and time block">
          <div className="productivity-rhythm-card__times">
            <span />
            {Array.from({ length: 24 }, (_, hour) => <span key={hour}>{formatRhythmHourLabel(hour)}</span>)}
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
      ) : <EmptyState title="No rhythm yet" detail="The weekly attention rhythm appears after activity is recorded across the insight window." />}
      {hoveredSegment ? <CompactClassificationHoverCard hover={hoveredSegment} appIcons={appIcons} /> : null}
    </section>
  );
}

export function InsightSourceGroup({
  variant,
  lists,
  appIcons,
}: {
  variant: ProductivityAnalysisKind;
  lists: InsightSourceLists;
  appIcons: AppIconMap;
}) {
  const tone = variant === "drift" ? "var(--warn)" : "var(--accent)";
  const topicsLabel = variant === "drift" ? "Drift after focus" : "Focus before drift";
  const transitionsLabel = variant === "drift" ? "Top drift after focus transitions" : "Top focus before drift transitions";
  const appsLabel = variant === "drift" ? "Drift apps" : "Focus apps";
  const toneStyle = { "--trend-tone": tone } as CSSProperties;

  const renderSourceList = (
    kind: keyof InsightSourceLists,
    sourceLabel: string,
    emptyTitle: string,
    emptyDetail: string,
  ) => {
    const items = lists[kind];
    const maxValue = Math.max(1, ...items.map((item) => insightSourceValue(item)));

    return (
      <div className="drift-time-trend__sources">
        <span className="label-mono drift-time-trend__sources-label">{sourceLabel}</span>
        <div className="drift-time-trend__sources-items" style={toneStyle}>
          {items.map((item, index) => (
            <div className="drift-time-trend__sources-item drift-time-trend__sources-item--app" key={item.id}>
              <span className="drift-time-trend__sources-rank" aria-hidden="true">{index + 1}</span>
              <span className="drift-time-trend__sources-icon" aria-hidden="true">
                {item.isSite && item.siteDomain
                  ? <SiteFavicon domain={item.siteDomain} size={14} fallbackIconSrc={appIcons[item.bundleId ?? item.appName] ?? null} />
                  : <AppGlyph appName={item.appName} iconSrc={appIcons[item.bundleId ?? item.appName] ?? null} size="sm" />}
              </span>
              <span className="drift-time-trend__sources-name">{item.label}</span>
              <strong className="drift-time-trend__sources-value">{formatInsightSourceValue(item)}</strong>
              <div className="drift-source-bar"><div className="drift-source-bar__fill" style={{ width: `${Math.max((insightSourceValue(item) / maxValue) * 100, 3)}%` }} /></div>
            </div>
          ))}
          {items.length === 0 ? <EmptyState title={emptyTitle} detail={emptyDetail} /> : null}
        </div>
      </div>
    );
  };

  return (
    <section className={`editorial-panel editorial-panel--soft insight-section productivity-insight-group productivity-insight-group--${variant}`} aria-label={`${variant === "drift" ? "Drift" : "Focus"} patterns`}>
      <section className="editorial-panel editorial-panel--soft insight-section trend-topics-card productivity-insight-group__section" aria-label={transitionsLabel} style={toneStyle}>
        <div className="trend-topics-card__columns">
          {renderSourceList("apps", appsLabel, `No ${variant} apps yet`, "Apps appear after classified activity is recorded.")}
          {renderSourceList("topics", topicsLabel, `No ${variant} transitions yet`, "Transitions appear after focus is followed by drift.")}
        </div>
      </section>
    </section>
  );
}

export function ProductivityPersonaCard({
  classificationOptions = {},
  report,
  hasData,
  segments = [],
  variant = "profile",
}: {
  classificationOptions?: ClassificationOptions;
  report: ReturnType<typeof buildProductivityPersona>;
  hasData: boolean;
  segments?: ActivitySegment[];
  variant?: "profile" | "radar";
}) {
  const content = PERSONA_CONTENT[report.personaId] ?? PERSONA_CONTENT.balanced_builder;
  const activeDays = report.metrics.activeDays;
  const rubricVersionLabel = report.rubricVersion.match(/v\d+$/)?.[0] ?? report.rubricVersion;
  const fixedRubricLabel = `Scored with Drifty fixed rubric ${rubricVersionLabel}`;
  const tagPills = content.tags.split(" · ");
  const radarCenter = { x: 150, y: 116 };
  const radarRadius = 86;
  const radarAxes = buildFocusProfileAxes(segments, classificationOptions, report.metrics);
  const pointFor = (index: number, value: number, radius = radarRadius) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / radarAxes.length;
    return {
      x: radarCenter.x + Math.cos(angle) * radius * value,
      y: radarCenter.y + Math.sin(angle) * radius * value,
    };
  };
  const polygonPoints = (value: number) => radarAxes.map((_, index) => {
    const point = pointFor(index, value);
    return `${point.x.toFixed(1)},${point.y.toFixed(1)}`;
  }).join(" ");
  const radarShape = radarAxes.map((axis, index) => {
    const point = pointFor(index, axis.value);
    return `${point.x.toFixed(1)},${point.y.toFixed(1)}`;
  }).join(" ");
  const radarLabel = `${report.personaName} persona radar: ${radarAxes.map((axis) => `${axis.label} ${formatSharePercent(axis.value * 100)}`).join(", ")}`;
  const renderRadarLabel = (axis: FocusProfileAxis, index: number) => {
    const point = pointFor(index, 1, radarRadius + 22);
    const x = point.x.toFixed(1);
    const y = point.y.toFixed(1);

    return (
      <text className="persona-radar__label" x={x} y={y} textAnchor="middle" dominantBaseline="middle" key={axis.key}>
        <tspan x={x}>{axis.label}</tspan>
        <tspan className="persona-radar__label-value" x={x} dy="1.24em">
          {formatSharePercent(axis.value * 100)}
        </tspan>
      </text>
    );
  };
  const cardClassName = [
    "editorial-panel editorial-panel--soft insight-section productivity-persona-card",
    hasData && variant === "profile" ? "persona-profile-card" : null,
    hasData && variant === "radar" ? "productivity-persona-card--radar-only" : null,
  ].filter(Boolean).join(" ");

  return (
    <section className={cardClassName} aria-label="Local productivity persona report">
      {hasData && variant === "radar" ? (
        <div className="persona-radar-card">
          <div className="persona-radar-card__head">
            <span className="label-mono insight-section__label">Focus profile</span>
            <span className="chip green productivity-persona-card__badge">{fixedRubricLabel}</span>
            <span className="persona-radar-card__help-wrap">
              <button type="button" className="persona-radar-card__help" aria-label="Focus profile help" aria-describedby="focus-profile-help-tooltip">?</button>
              <span className="persona-radar-card__tooltip" id="focus-profile-help-tooltip" role="tooltip">{FOCUS_PROFILE_HELP}</span>
            </span>
          </div>
          <div className="persona-radar-card__chart">
            <svg className="persona-radar" viewBox="0 0 300 232" role="img" aria-label={radarLabel}>
              {[1, 0.8, 0.6, 0.4, 0.2].map((level) => <polygon className="persona-radar__grid" points={polygonPoints(level)} key={level} />)}
              {radarAxes.map((axis, index) => {
                const point = pointFor(index, 1);
                return <line className="persona-radar__axis" x1={radarCenter.x} y1={radarCenter.y} x2={point.x.toFixed(1)} y2={point.y.toFixed(1)} key={axis.key} />;
              })}
              <polygon className="persona-radar__shape" points={radarShape} />
              {radarAxes.map((axis, index) => {
                const point = pointFor(index, axis.value);
                return <circle className="persona-radar__point" cx={point.x.toFixed(1)} cy={point.y.toFixed(1)} r="2.35" key={axis.key} />;
              })}
              {radarAxes.map(renderRadarLabel)}
            </svg>
          </div>
        </div>
      ) : hasData ? (
        <>
          <div className="persona-profile-card__identity">
            <div className="persona-profile-card__intro">
              <span className="label-mono insight-section__label">Productivity persona</span>
              <h2 className="persona-profile-card__title">{report.personaName}</h2>
              <p className="persona-profile-card__subtitle productivity-persona-card__copy">{content.copy[0]}</p>
              <p className="productivity-persona-card__copy">{content.copy[1]}</p>
              <div className="persona-profile-card__tags" aria-label="Persona traits">
                {tagPills.map((tag) => <span className="persona-profile-card__tag" key={tag}>{tag}</span>)}
              </div>
              <span className="chip green productivity-persona-card__badge">{fixedRubricLabel}</span>
              <span className="chip productivity-persona-card__badge">Analyzing {activeDays} active {activeDays === 1 ? "day" : "days"} in this window</span>
            </div>
          </div>
          <div className="persona-radar-card">
            <div className="persona-radar-card__chart">
              <svg className="persona-radar" viewBox="0 0 300 232" role="img" aria-label={radarLabel}>
                {[1, 0.8, 0.6, 0.4, 0.2].map((level) => <polygon className="persona-radar__grid" points={polygonPoints(level)} key={level} />)}
                {radarAxes.map((axis, index) => {
                  const point = pointFor(index, 1);
                  return <line className="persona-radar__axis" x1={radarCenter.x} y1={radarCenter.y} x2={point.x.toFixed(1)} y2={point.y.toFixed(1)} key={axis.key} />;
                })}
                <polygon className="persona-radar__shape" points={radarShape} />
                {radarAxes.map((axis, index) => {
                  const point = pointFor(index, axis.value);
                  return <circle className="persona-radar__point" cx={point.x.toFixed(1)} cy={point.y.toFixed(1)} r="2.35" key={axis.key} />;
                })}
                {radarAxes.map(renderRadarLabel)}
              </svg>
            </div>
            <div className="persona-radar-card__axis-list" aria-hidden="true">
              {radarAxes.map((axis) => <span key={axis.key}>{axis.label}<strong>{formatSharePercent(axis.value * 100)}</strong></span>)}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="productivity-persona-card__head">
            <div>
              <span className="label-mono insight-section__label">Productivity persona</span>
              <h2>Waiting for local patterns</h2>
            </div>
          </div>
          <EmptyState title="No persona yet" detail="The local report appears after tracker history exists in this insight window." />
        </>
      )}
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
