import { CATEGORY_COLORS, FLOW_BREAKDOWN_PRODUCTIVITY_ORDER, PRODUCTIVITY_COLORS } from "../../lib/activityLabels";
import type { ActivityCategory, ProductivityLabel } from "@drifty/domain";
import type { DonutCategorySlice, WeeklyBreakdownDay } from "./insightData";

export type WeeklyChartMode = "productivity" | "category";

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
  readonly key: ProductivityLabel | ActivityCategory;
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

export function buildWeeklyChartView(
  weekly: WeeklyBreakdownDay[],
  mode: WeeklyChartMode,
  categorySeries: DonutCategorySlice[],
): WeeklyChartView {
  const series: WeeklyChartSeriesItem[] = mode === "productivity"
    ? FLOW_BREAKDOWN_PRODUCTIVITY_ORDER.map((productivity, order) => ({ key: productivity, color: PRODUCTIVITY_COLORS[productivity], order }))
    : categorySeries.map((slice, order) => ({ key: slice.category, color: CATEGORY_COLORS[slice.category], order }));

  const valueFor = (day: WeeklyBreakdownDay, key: WeeklyChartSeriesItem["key"]): number => {
    if (mode === "productivity") {
      switch (key) {
        case "focus": return day.focusSeconds;
        case "neutral": return day.neutralSeconds;
        case "drift": return day.driftSeconds;
        default: return 0;
      }
    }
    return categorySecondsFor(day, key);
  };

  const dayTotals = weekly.map((day) => series.reduce((sum, item) => sum + valueFor(day, item.key), 0));

  const categoryKeys = categorySeries.map((slice) => slice.category);
  const productivityHours = weekly.map((day) => (day.focusSeconds + day.neutralSeconds + day.driftSeconds) / 3600);
  const categoryHours = weekly.map((day) => categoryKeys.reduce((sum, key) => sum + (day.categorySeconds[key] ?? 0), 0) / 3600);
  const maxHours = Math.max(0, ...productivityHours, ...categoryHours);
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
      segments: off ? [] : orderedSegmentsForDay(day, total, series, valueFor),
    };
  });

  return { gridlines, columns };
}

function orderedSegmentsForDay(
  day: WeeklyBreakdownDay,
  total: number,
  series: readonly WeeklyChartSeriesItem[],
  valueFor: (day: WeeklyBreakdownDay, key: WeeklyChartSeriesItem["key"]) => number,
): WeeklyChartSegment[] {
  return series
    .map((item) => {
      const value = valueFor(day, item.key);
      return value > 0
        ? { key: item.key, heightPct: (value / total) * 100, color: item.color, seconds: value, order: item.order }
        : null;
    })
    .filter((segment): segment is OrderedWeeklyChartSegment => segment !== null)
    .sort((left, right) => right.seconds - left.seconds || left.order - right.order)
    .map(({ key, heightPct, color, seconds }) => ({ key, heightPct, color, seconds }));
}

function categorySecondsFor(day: WeeklyBreakdownDay, key: WeeklyChartSeriesItem["key"]): number {
  switch (key) {
    case "workspace": return day.categorySeconds.workspace ?? 0;
    case "learning": return day.categorySeconds.learning ?? 0;
    case "communication": return day.categorySeconds.communication ?? 0;
    case "music": return day.categorySeconds.music ?? 0;
    case "game": return day.categorySeconds.game ?? 0;
    case "social_media": return day.categorySeconds.social_media ?? 0;
    case "entertainment": return day.categorySeconds.entertainment ?? 0;
    case "shopping": return day.categorySeconds.shopping ?? 0;
    case "utility": return day.categorySeconds.utility ?? 0;
    case "unknown": return day.categorySeconds.unknown ?? 0;
    default: return 0;
  }
}
