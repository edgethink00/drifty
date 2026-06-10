import { buildCategoryDurations, buildProductivityDurations, classifyActivity, logicalDayIsoDateForDate, todayIsoDate } from "@drifty/domain";
import type { ActivitySegment, CategoryDuration, ClassificationOptions, ProductivityDuration } from "@drifty/domain";
import { chunk, formatHistoryMonthLabel } from "../../lib/formatting";
import type { CSSProperties } from "react";

export type MonthOverviewCell = {
  id: string;
  isoDay: string;
  dayNumber?: number;
  totalSeconds: number;
  focusSeconds: number;
  driftSeconds: number;
  isBlank: boolean;
  isFuture: boolean;
  isToday: boolean;
  isSelected: boolean;
};

export type MonthOverview = {
  monthLabel: string;
  weeks: MonthOverviewCell[][];
  activeDays: number;
  focusDays: number;
  streakDays: number;
  bestDay: MonthOverviewCell | null;
  totalFocusSeconds: number;
  totalDriftSeconds: number;
  totalTrackedSeconds: number;
  averageFocusPerActiveDay: number;
  peakActivitySeconds: number;
  weekdayFocusAverages: number[];
  maxWeekdayFocusAverage: number;
  categoryEntries: CategoryDuration[];
  productivityEntries: ProductivityDuration[];
  primaryProductivity: ProductivityDuration | null;
};

export type MonthCellStyle = CSSProperties & {
  "--activity-tone"?: string;
  "--activity-border"?: string;
  "--activity-ink"?: string;
};

export function buildMonthV2Overview(segments: ActivitySegment[], selectedDay: string, classificationOptions?: ClassificationOptions, startOfDayMinutes = 0): MonthOverview {
  const monthKey = selectedDay.slice(0, 7);
  const [yearValue, monthValue] = monthKey.split("-").map(Number);
  const daysInMonth = new Date(yearValue, monthValue, 0).getDate();
  const today = todayIsoDate();
  const cells: MonthOverviewCell[] = [];
  const firstWeekday = new Date(`${monthKey}-01T12:00:00`).getDay();

  for (let index = 0; index < firstWeekday; index += 1) {
    cells.push({ id: `month-v2-blank-${monthKey}-${index}`, isoDay: "", totalSeconds: 0, focusSeconds: 0, driftSeconds: 0, isBlank: true, isFuture: false, isToday: false, isSelected: false });
  }

  for (let dayNumber = 1; dayNumber <= daysInMonth; dayNumber += 1) {
    const isoDay = `${monthKey}-${String(dayNumber).padStart(2, "0")}`;
    const daySegments = segments.filter((segment) => logicalDayIsoDateForDate(new Date(segment.startedAt), startOfDayMinutes) === isoDay);
    const totalSeconds = daySegments.reduce((sum, segment) => sum + segment.durationSeconds, 0);
    const focusSeconds = daySegments.reduce((sum, segment) => sum + (classifyActivity(segment, classificationOptions).productivity === "focus" ? segment.durationSeconds : 0), 0);
    const driftSeconds = daySegments.reduce((sum, segment) => sum + (classifyActivity(segment, classificationOptions).productivity === "drift" ? segment.durationSeconds : 0), 0);
    cells.push({
      id: `month-v2-${isoDay}`,
      isoDay,
      dayNumber,
      totalSeconds,
      focusSeconds,
      driftSeconds,
      isBlank: false,
      isFuture: isoDay > today,
      isToday: isoDay === today,
      isSelected: isoDay === selectedDay,
    });
  }

  while (cells.length % 7 !== 0) {
    cells.push({ id: `month-v2-tail-${cells.length}`, isoDay: "", totalSeconds: 0, focusSeconds: 0, driftSeconds: 0, isBlank: true, isFuture: false, isToday: false, isSelected: false });
  }

  const realCells = cells.filter((cell) => !cell.isBlank && !cell.isFuture);
  const activeCells = realCells.filter((cell) => cell.totalSeconds > 0);
  const focusCells = realCells.filter((cell) => cell.focusSeconds > 0);
  let streakDays = 0;
  let currentStreak = 0;
  for (const cell of realCells) {
    if (cell.focusSeconds > 0) {
      currentStreak += 1;
      streakDays = Math.max(streakDays, currentStreak);
    } else {
      currentStreak = 0;
    }
  }

  const monthSegments = segments.filter((segment) => {
    const logicalDay = logicalDayIsoDateForDate(new Date(segment.startedAt), startOfDayMinutes);
    return logicalDay.slice(0, 7) === monthKey && logicalDay <= today;
  });
  const weekdayBuckets = Array.from({ length: 7 }, () => ({ total: 0, count: 0 }));
  for (const cell of focusCells) {
    const weekday = new Date(`${cell.isoDay}T12:00:00`).getDay();
    weekdayBuckets[weekday].total += cell.focusSeconds;
    weekdayBuckets[weekday].count += 1;
  }
  const weekdayFocusAverages = weekdayBuckets.map((bucket) => bucket.count > 0 ? Math.round(bucket.total / bucket.count) : 0);
  const productivityEntries = buildProductivityDurations(monthSegments, classificationOptions);
  const activeProductivityEntries = productivityEntries.filter((entry) => entry.totalSeconds > 0).slice().sort((left, right) => right.totalSeconds - left.totalSeconds);
  const bestDay = realCells.reduce<MonthOverviewCell | null>((current, cell) => (!current || cell.focusSeconds > current.focusSeconds ? cell : current), null);

  return {
    monthLabel: formatHistoryMonthLabel(monthKey),
    weeks: chunk(cells, 7),
    activeDays: activeCells.length,
    focusDays: focusCells.length,
    streakDays,
    bestDay: bestDay && bestDay.focusSeconds > 0 ? bestDay : null,
    totalFocusSeconds: realCells.reduce((sum, cell) => sum + cell.focusSeconds, 0),
    totalDriftSeconds: realCells.reduce((sum, cell) => sum + cell.driftSeconds, 0),
    totalTrackedSeconds: realCells.reduce((sum, cell) => sum + cell.totalSeconds, 0),
    averageFocusPerActiveDay: activeCells.length > 0 ? Math.round(focusCells.reduce((sum, cell) => sum + cell.focusSeconds, 0) / activeCells.length) : 0,
    peakActivitySeconds: realCells.reduce((peak, cell) => Math.max(peak, cell.totalSeconds), 0),
    weekdayFocusAverages,
    maxWeekdayFocusAverage: Math.max(...weekdayFocusAverages, 1),
    categoryEntries: buildCategoryDurations(monthSegments, classificationOptions).filter((entry) => entry.totalSeconds > 0).slice(0, 4),
    productivityEntries,
    primaryProductivity: activeProductivityEntries[0] ?? productivityEntries[0] ?? null,
  };
}
