import { AppGlyph } from "../../components/AppGlyph";
import { SiteFavicon } from "../../components/SiteFavicon";
import { DONUT_CIRCUMFERENCE, NO_PROJECT_KEY, WEEKLY_BREAKDOWN_WEEKDAYS, buildDonutView, buildWeeklyChartView, formatInsightSourceValue, insightSourceValue } from "./insightData";
import type { AttentionRhythmCell, DonutCategorySlice, DonutView, InsightSourceLists, ProductivityAnalysisKind, ProductivityInsightReport, WeeklyBreakdownDay, WeeklyChartMode, WeeklyChartProjectSeriesItem, WeeklyChartSegment } from "./insightData";
import { CATEGORY_COLORS, FLOW_BREAKDOWN_PRODUCTIVITY_ORDER, PRODUCTIVITY_COLORS, categoryLabel, productivityLabel } from "../../lib/activityLabels";
import { formatCompactDurationFromSeconds, formatLocalizedCompactDurationFromSeconds, formatLocalizedHourLabel, localDateKey, weekdayOrderIndex } from "../../lib/formatting";
import { buildProductivityPersona, classifyActivity, logicalDayIsoDateForDate } from "@drifty/domain";
import type { ActivityCategory, ActivitySegment, AppIconMap, ClassificationOptions, ProductivityLabel } from "@drifty/domain";
import { EmptyState } from "../../components/EmptyState";
import { buildCompactActivityBreakdown } from "../dashboard/CompactCharts";
import { CompactClassificationHoverCard, formatSharePercent } from "../dashboard/HoverCards";
import type { CompactClassificationHoverPayload, CompactClassificationHoverState } from "../dashboard/HoverCards";
import { useMemo, useState } from "react";
import type { CSSProperties, MouseEvent } from "react";
import { WeeklyTrendChart } from "./WeeklyTrendChart";
import { localizedCategoryLabel, localizedProductivityLabel } from "../localization/activityTranslations";
import { useLocalization } from "../localization/LocalizationContext";

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

const KOREAN_PERSONA_CONTENT: Record<string, { name: string; tags: string; copy: [string, string] }> = {
  deep_diver: {
    name: "깊은 몰입형",
    tags: "긴 집중 세션 · 적은 딴짓 · 안정된 맥락",
    copy: [
      "딴짓과 맥락 전환이 적은 긴 집중 세션에서 가장 좋은 흐름을 만듭니다.",
      "방해받지 않는 작업 시간을 지킬수록 깊이 있는 성과가 선명하게 쌓이는 유형입니다.",
    ],
  },
  deep_focus_deep_drift: {
    name: "몰입 진폭형",
    tags: "강한 집중 · 깊은 딴짓 · 큰 진폭",
    copy: [
      "깊은 집중과 강한 딴짓 사이를 오가며 중간 상태에 머무는 시간이 적습니다.",
      "딴짓으로 향하는 강한 에너지를 집중 구간으로 돌리는 것이 가장 큰 개선 지점입니다.",
    ],
  },
  drift_diver: {
    name: "딴짓 잠수형",
    tags: "긴 딴짓 구간 · 낮은 집중 · 벗어나기 어려운 흐름",
    copy: [
      "한 번 시작한 딴짓이 길게 이어지고 다시 빠져나오기 어려운 흐름이 자주 나타납니다.",
      "딴짓이 시작되는 순간에 작은 안전장치를 두면 하루에서 가장 많은 시간을 되찾을 수 있습니다.",
    ],
  },
  focus_sprinter: {
    name: "집중 질주형",
    tags: "짧은 집중 폭발 · 잦은 전환 · 높은 에너지",
    copy: [
      "긴 몰입보다 짧고 힘 있는 집중 구간에서 추진력을 얻습니다.",
      "몇 번의 집중 질주를 연달아 배치하면 순간의 탄력을 지속적인 진전으로 바꿀 수 있습니다.",
    ],
  },
  reactive_operator: {
    name: "반응 업무형",
    tags: "소통 중심 · 잦은 전환 · 빠른 대응",
    copy: [
      "소통과 즉각 대응 업무가 많은 비중을 차지해 주의가 자주 이동합니다.",
      "하루에 한 구간만이라도 보호된 집중 시간을 만들면 깊은 작업이 숨 쉴 공간이 생깁니다.",
    ],
  },
  night_owl: {
    name: "야간 집중형",
    tags: "늦은 밤 집중 · 이동된 리듬 · 조용한 시간",
    copy: [
      "일반적인 업무 시간이 지난 늦은 밤에 가장 생산적인 흐름이 나타납니다.",
      "회복 시간을 함께 지키면서 자연스러운 야간 리듬을 활용하면 이 패턴을 오래 유지할 수 있습니다.",
    ],
  },
  balanced_builder: {
    name: "균형 축적형",
    tags: "고른 분포 · 안정된 리듬 · 유연한 전환",
    copy: [
      "집중, 중립, 딴짓이 비교적 고르게 나뉘고 일상의 리듬도 안정적입니다.",
      "여러 종류의 업무에 잘 적응하므로 집중 시간을 조금만 늘려도 효과가 빠르게 누적됩니다.",
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
  projectSeries,
  projectMeta,
  projectBySegmentId,
  projectSegments,
  projectModeAvailable = false,
  mode,
  onModeChange,
}: {
  weekly: WeeklyBreakdownDay[];
  categoryTotals: Array<{ category: ActivityCategory; totalSeconds: number }>;
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
  const categoryDonut = useMemo(() => {
    const view = buildDonutView("category", categorySeries, productivityTotals);
    const secondsByCategory = new Map(categorySeries.map((entry) => [entry.category, entry.seconds]));
    return {
      ...view,
      centerLabel: view.rows[0] ? localizedCategoryLabel(view.rows[0].key as ActivityCategory, t) : view.centerLabel,
      rows: view.rows.map((row) => ({ ...row, name: localizedCategoryLabel(row.key as ActivityCategory, t), time: formatLocalizedCompactDurationFromSeconds(secondsByCategory.get(row.key as ActivityCategory) ?? 0, effectiveLanguage) })),
    };
  }, [categorySeries, effectiveLanguage, productivityTotals, t]);

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
      const projectSecondsByKey = new Map<string, number>();
      for (const segment of hoverSegments) {
        const projectId = projectBySegmentId?.get(segment.id);
        if (projectId) {
          projectSecondsByKey.set(projectId, (projectSecondsByKey.get(projectId) ?? 0) + segment.durationSeconds);
        } else if (classifyActivity(segment, classificationOptions).category !== "unknown") {
          projectSecondsByKey.set(NO_PROJECT_KEY, (projectSecondsByKey.get(NO_PROJECT_KEY) ?? 0) + segment.durationSeconds);
        }
      }
      const totalSeconds = [...projectSecondsByKey.values()].reduce((sum, value) => sum + value, 0);
      for (const item of projectSeries ?? []) {
        const seconds = projectSecondsByKey.get(item.key) ?? 0;
        if (seconds <= 0) continue;
        const meta = projectMeta?.get(item.key);
        entries.set(item.key, {
          label: meta?.label ?? t("common.project"),
          durationLabel: formatLocalizedCompactDurationFromSeconds(seconds, effectiveLanguage),
          shareLabel: `${Math.round((seconds / Math.max(totalSeconds, 1)) * 100)}%`,
          dotClassName: "",
          color: meta?.color ?? item.color,
          appBreakdown: buildBreakdown((segment) => matchesProject(segment, item.key)),
        });
      }
    } else {
      const totalSeconds = categoryTotals.reduce((sum, entry) => sum + entry.totalSeconds, 0);
      for (const entry of categoryTotals) {
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
  }, [categoryTotals, classificationOptions, effectiveLanguage, effectiveMode, hoverSegments, productivityTotals, projectSeries, projectMeta, projectBySegmentId, t]);

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
    <div className="insights-row--weekly-categories">
      <WeeklyTrendChart
        chart={chart}
        hasData={hasData}
        mode={effectiveMode}
        projectModeAvailable={projectModeAvailable}
        onHideSegmentHover={() => setHoveredSegment(null)}
        onModeChange={onModeChange}
        onMoveSegmentHover={moveSegmentHover}
        onShowSegmentHover={showWeeklySegmentHover}
      />
      <section className="editorial-panel editorial-panel--soft insight-section od-cat-rebuilt weekly-summary-rail weekly-breakdown-analytical is-linked" aria-label={t("trends.weeklySummariesAria")}>
        {productivityDonut.rows.length > 0 || categoryDonut.rows.length > 0 ? (
          <div className="weekly-summary-rail__stack weekly-breakdown-analytical__stack">
            <WeeklyDonutSummary
              ariaLabel={t("trends.productivityBreakdownAria")}
              className="weekly-summary-rail__summary--productivity weekly-breakdown-analytical__productivity productivity-donut-compact"
              view={productivityDonut}
              onShowHover={showAggregateHover}
              onMoveHover={moveSegmentHover}
              onHideHover={() => setHoveredSegment(null)}
            />
            <WeeklyCategoryBreakdown
              ariaLabel={t("trends.categoryBreakdownAria")}
              view={categoryDonut}
              onShowHover={showAggregateHover}
              onMoveHover={moveSegmentHover}
              onHideHover={() => setHoveredSegment(null)}
            />
          </div>
        ) : <EmptyState title={t("trends.noWeeklySplit")} detail={t("trends.noWeeklySplitDetail")} />}
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
  const { t } = useLocalization();
  return (
    <div className="weekly-summary-rail__summary weekly-summary-rail__summary--category top-categories-breakdown" role="group" aria-label={ariaLabel}>
      <span className="weekly-breakdown-analytical__eyebrow">{t("trends.topCategories")}</span>
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
      {hasData ? (
        <div className="productivity-rhythm-card__grid" role="img" aria-label={t("trends.attentionRhythmAria")}>
          <div className="productivity-rhythm-card__times">
            <span />
            {Array.from({ length: 24 }, (_, hour) => <span key={hour}>{effectiveLanguage === "ko" ? formatLocalizedHourLabel(hour, effectiveLanguage) : formatRhythmHourLabel(hour)}</span>)}
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
}: {
  variant: ProductivityAnalysisKind;
  lists: InsightSourceLists;
  appIcons: AppIconMap;
}) {
  const { effectiveLanguage, t } = useLocalization();
  const tone = variant === "drift" ? "var(--warn)" : "var(--accent)";
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

    return (
      <div className="drift-time-trend__sources">
        <span className="label-mono drift-time-trend__sources-label">{sourceLabel}</span>
        <div className="drift-time-trend__sources-items" style={toneStyle}>
          {items.map((item, index) => (
            <div className="drift-time-trend__sources-item drift-time-trend__sources-item--app" key={item.id}>
              <span className="drift-time-trend__sources-rank" aria-hidden="true">{index + 1}</span>
              <span className="drift-time-trend__sources-icon" aria-hidden="true">
                {item.isSite && item.siteDomain
                  ? <SiteFavicon domain={item.siteDomain} size={22} fallbackIconSrc={appIcons[item.bundleId ?? item.appName] ?? null} />
                  : <AppGlyph appName={item.appName} iconSrc={appIcons[item.bundleId ?? item.appName] ?? null} size="sm" />}
              </span>
              <span className="drift-time-trend__sources-name">{item.label}</span>
              <strong className="drift-time-trend__sources-value">{item.valueKind === "count" ? (effectiveLanguage === "ko" ? `${item.count}회` : `${item.count}x`) : formatLocalizedCompactDurationFromSeconds(item.seconds, effectiveLanguage)}</strong>
              <div className="drift-source-bar"><div className="drift-source-bar__fill" style={{ width: `${Math.max((insightSourceValue(item) / maxValue) * 100, 3)}%` }} /></div>
            </div>
          ))}
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
  const { effectiveLanguage, t } = useLocalization();
  const englishContent = PERSONA_CONTENT[report.personaId] ?? PERSONA_CONTENT.balanced_builder;
  const koreanContent = KOREAN_PERSONA_CONTENT[report.personaId] ?? KOREAN_PERSONA_CONTENT.balanced_builder;
  const content = effectiveLanguage === "ko" ? koreanContent : englishContent;
  const personaName = effectiveLanguage === "ko" ? koreanContent.name : report.personaName;
  const activeDays = report.metrics.activeDays;
  const rubricVersionLabel = report.rubricVersion.match(/v\d+$/)?.[0] ?? report.rubricVersion;
  const fixedRubricLabel = t("trends.rubric", { version: rubricVersionLabel });
  const tagPills = content.tags.split(" · ");
  const radarCenter = { x: 150, y: 116 };
  const radarRadius = 86;
  const radarAxes = buildFocusProfileAxes(segments, classificationOptions, report.metrics).map((axis) => ({
    ...axis,
    label: t(axis.key === "focus_start"
      ? "trends.axis.focusStart"
      : axis.key === "focus_endurance"
        ? "trends.axis.focusEndurance"
        : axis.key === "short_drifts"
          ? "trends.axis.shortDrifts"
          : axis.key === "focus_routine"
            ? "trends.axis.focusRoutine"
            : "trends.axis.balancedFocus"),
  }));
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
  const radarLabel = t("trends.personaRadarAria", { name: personaName, axes: radarAxes.map((axis) => `${axis.label} ${formatSharePercent(axis.value * 100)}`).join(", ") });
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
    <section className={cardClassName} aria-label={t("trends.personaReportAria")}>
      {hasData && variant === "radar" ? (
        <div className="persona-radar-card">
          <div className="persona-radar-card__head">
            <span className="label-mono insight-section__label">{t("trends.focusProfile")}</span>
            <span className="persona-radar-card__help-wrap">
              <button type="button" className="help-trigger persona-radar-card__help" aria-label={t("trends.focusProfileHelpAria")} aria-describedby="focus-profile-help-tooltip">?</button>
              <span className="persona-radar-card__tooltip" id="focus-profile-help-tooltip" role="tooltip">{t("trends.focusProfileHelp")}</span>
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
              <span className="label-mono insight-section__label">{t("trends.persona")}</span>
              <h2 className="persona-profile-card__title">{personaName}</h2>
              <p className="persona-profile-card__subtitle productivity-persona-card__copy">{content.copy[0]}</p>
              <p className="productivity-persona-card__copy">{content.copy[1]}</p>
              <div className="persona-profile-card__tags" aria-label={t("trends.personaTraitsAria")}>
                {tagPills.map((tag) => <span className="persona-profile-card__tag" key={tag}>{tag}</span>)}
              </div>
              <span className="chip green productivity-persona-card__badge">{fixedRubricLabel}</span>
              <span className="chip productivity-persona-card__badge">{t("trends.activeDays", { count: activeDays })}</span>
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
              <span className="label-mono insight-section__label">{t("trends.persona")}</span>
              <h2>{t("trends.waitingPatterns")}</h2>
            </div>
          </div>
          <EmptyState title={t("trends.noPersona")} detail={t("trends.noPersonaDetail")} />
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
