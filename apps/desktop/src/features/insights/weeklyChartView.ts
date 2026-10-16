import { CATEGORY_COLORS, FLOW_BREAKDOWN_PRODUCTIVITY_ORDER, PRODUCTIVITY_COLORS } from "../../lib/activityLabels";
import type { ActivityCategory, ProductivityLabel, ProductivityLevel } from "@drifty/domain";
import type { DonutCategorySlice, WeeklyBreakdownDay } from "./insightData";

export type WeeklyChartMode = "productivity" | "category" | "project";

/** A project series entry for the weekly chart: project id key + resolved color, ordered by the caller. */
export interface WeeklyChartProjectSeriesItem {
  readonly key: string;
  readonly color: string;
}

export interface WeeklyChartSegment {
  key: string;
  heightPct: number;
  color: string;
  seconds: number;
}

export interface WeeklyChartColumn {
  weekdayIndex: number;
  weekday: string;
  off: boolean;
  totalSeconds: number;
  barHeightPct: number;
  segments: WeeklyChartSegment[];
}

export interface WeeklyChartView {
  gridlines: Array<{ topPct: number; label: string }>;
  columns: WeeklyChartColumn[];
}

type WeeklyChartSeriesItem = {
  // Widened to string so project ids (arbitrary) can key the same machinery as
  // productivity labels and activity categories.
  readonly key: ProductivityLabel | ActivityCategory | string;
  readonly color: string;
  readonly order: number;
};

type OrderedWeeklyChartSegment = {
  readonly key: WeeklyChartSeriesItem["key"];
  readonly heightPct: number;
  readonly color: string;
  readonly seconds: number;
  readonly order: number;
};

export function chooseChartStepHours(maxHours: number): number {
  const candidates = [0.25, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24];
  for (const candidate of candidates) {
    if (maxHours / candidate <= 4) return candidate;
  }
  return candidates[candidates.length - 1] ?? 24;
}

export function formatChartHourLabel(value: number): string {
  return Number.isInteger(value) ? `${value}` : `${value.toFixed(1).replace(/\.0$/, "")}`;
}

// Residual buckets are the lens leftover, not the answer. The bar uses
// column-reverse, so array order is bottom -> top; residuals always sort last
// and render as the cap. `__no_project__` matches insightData.NO_PROJECT_KEY.
function isResidualWeeklyChartKey(key: WeeklyChartSeriesItem["key"]): boolean {
  return key === "neutral" || key === "__no_project__";
}

export function buildWeeklyChartView(
  weekly: WeeklyBreakdownDay[],
  mode: WeeklyChartMode,
  categorySeries: DonutCategorySlice[],
  projectSeries: readonly WeeklyChartProjectSeriesItem[] = [],
  levels: readonly ProductivityLevel[] = [],
): WeeklyChartView {
  // Unclassified ("unknown") time is excluded from the category lens so the three
  // modes share a denominator (classified time) and their bars match in length.
  const classifiedCategorySeries = categorySeries.filter((slice) => slice.category !== "unknown");
  // Added productivity levels stack under neutral, which stays the cap.
  const productivitySeries = [
    ...FLOW_BREAKDOWN_PRODUCTIVITY_ORDER.filter((productivity) => productivity !== "neutral").map((productivity) => ({ key: productivity as string, color: PRODUCTIVITY_COLORS[productivity] })),
    ...levels.map((level) => ({ key: level.id as string, color: level.color })),
    { key: "neutral", color: PRODUCTIVITY_COLORS.neutral },
  ];
  const series: WeeklyChartSeriesItem[] = mode === "productivity"
    ? productivitySeries.map((item, order) => ({ ...item, order }))
    : mode === "project"
      ? projectSeries.map((item, order) => ({ key: item.key, color: item.color, order }))
      : classifiedCategorySeries.map((slice, order) => ({ key: slice.category, color: CATEGORY_COLORS[slice.category], order }));

  // Each added level's share of a day's neutral time (a level holds only neutral time).
  const levelSecondsByDay = new Map<WeeklyBreakdownDay, Map<string, number>>();
  const levelSecondsFor = (day: WeeklyBreakdownDay): Map<string, number> => {
    const cached = levelSecondsByDay.get(day);
    if (cached) return cached;
    const result = new Map<string, number>();
    let left = day.neutralSeconds;
    for (const level of levels) {
      const seconds = Math.min(left, level.categories.reduce((sum, category) => sum + (day.neutralCategorySeconds?.[category] ?? 0), 0));
      if (seconds > 0) result.set(level.id, seconds);
      left -= seconds;
    }
    levelSecondsByDay.set(day, result);
    return result;
  };

  const valueFor = (day: WeeklyBreakdownDay, key: WeeklyChartSeriesItem["key"]): number => {
    if (mode === "productivity") {
      switch (key) {
        case "focus": return day.focusSeconds;
        case "neutral": return Math.max(0, day.neutralSeconds - [...levelSecondsFor(day).values()].reduce((sum, seconds) => sum + seconds, 0));
        case "drift": return day.driftSeconds;
        default: return levelSecondsFor(day).get(key) ?? 0;
      }
    }
    if (mode === "project") return day.projectSeconds[key] ?? 0;
    return categorySecondsFor(day, key);
  };

  const dayTotals = weekly.map((day) => series.reduce((sum, item) => sum + valueFor(day, item.key), 0));

  const categoryKeys = classifiedCategorySeries.map((slice) => slice.category);
  const projectKeys = projectSeries.map((item) => item.key);
  const productivityHours = weekly.map((day) => (day.focusSeconds + day.neutralSeconds + day.driftSeconds) / 3600);
  const categoryHours = weekly.map((day) => categoryKeys.reduce((sum, key) => sum + (day.categorySeconds[key] ?? 0), 0) / 3600);
  const projectHours = weekly.map((day) => projectKeys.reduce((sum, key) => sum + (day.projectSeconds[key] ?? 0), 0) / 3600);
  const maxHours = Math.max(0, ...productivityHours, ...categoryHours, ...projectHours);
  const axisMax = maxHours > 0 ? maxHours / 0.93 : 1;
  const step = chooseChartStepHours(maxHours);

  const gridlines: Array<{ topPct: number; label: string }> = [];
  if (maxHours > 0) {
    for (let value = step; value <= maxHours + 1e-9; value += step) {
      gridlines.push({ topPct: (1 - value / axisMax) * 100, label: `${formatChartHourLabel(value)}h` });
    }
    gridlines.reverse();
  }

  const columns = weekly.map((day, index) => {
    const total = dayTotals[index] ?? 0;
    const off = total <= 0;
    return {
      weekdayIndex: day.weekdayIndex,
      weekday: day.weekday,
      off,
      totalSeconds: total,
      barHeightPct: Math.min((total / (axisMax * 3600)) * 100, 100),
      segments: off ? [] : orderedSegmentsForDay(day, total, series, valueFor, mode),
    };
  });

  return { gridlines, columns };
}

function orderedSegmentsForDay(
  day: WeeklyBreakdownDay,
  total: number,
  series: readonly WeeklyChartSeriesItem[],
  valueFor: (day: WeeklyBreakdownDay, key: WeeklyChartSeriesItem["key"]) => number,
  mode: WeeklyChartMode,
): WeeklyChartSegment[] {
  const present = series
    .map((item) => {
      const value = valueFor(day, item.key);
      return value > 0
        ? { key: item.key, heightPct: (value / total) * 100, color: item.color, seconds: value, order: item.order }
        : null;
    })
    .filter((segment): segment is OrderedWeeklyChartSegment => segment !== null);

  present.sort((left, right) => {
    const residualDelta = Number(isResidualWeeklyChartKey(left.key)) - Number(isResidualWeeklyChartKey(right.key));
    if (residualDelta !== 0) return residualDelta;
    if (mode === "category") return right.seconds - left.seconds || left.order - right.order;
    return left.order - right.order;
  });

  return present.map(({ key, heightPct, color, seconds }) => ({ key, heightPct, color, seconds }));
}

/** A category's seconds that day, user-added categories included. */
function categorySecondsFor(day: WeeklyBreakdownDay, key: WeeklyChartSeriesItem["key"]): number {
  return day.categorySeconds[key as ActivityCategory] ?? 0;
}
