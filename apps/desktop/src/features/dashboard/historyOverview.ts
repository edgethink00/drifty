import { buildProductivityDurations } from "@drifty/domain";
import type { ActivitySegment, ClassificationOptions } from "@drifty/domain";
import { chunk, formatDayLabel, formatHistoryMonthLabel } from "../../lib/formatting";

export type HistoryCell = {
  id: string;
  isoDay: string;
  label: string;
  minutes: number;
  focusScore: number;
  level: 0 | 1 | 2 | 3;
  isSelected: boolean;
  isEmpty?: boolean;
};

export type HistoryMonth = {
  id: string;
  label: string;
  weeks: HistoryCell[][];
};

export type HistoryOverview = {
  months: HistoryMonth[];
  activeDays: number;
  streakDays: number;
  bestDayLabel: string;
  bestDayMinutes: number;
  totalTrackedSeconds: number;
  averageTrackedSeconds: number;
};

export function buildHistoryOverview(selectedDay: string, dailyTotals: Array<{ day: string; totalSeconds: number }>, segments: ActivitySegment[], classificationOptions?: ClassificationOptions): HistoryOverview {
  const days = dailyTotals.map((entry) => {
    const daySegments = segments.filter((segment) => segment.startedAt.slice(0, 10) === entry.day);
    const productivities = buildProductivityDurations(daySegments, classificationOptions);
    const focusSeconds = productivities.find((item) => item.productivity === "focus")?.totalSeconds ?? 0;
    const driftSeconds = productivities.find((item) => item.productivity === "drift")?.totalSeconds ?? 0;
    const scoredSeconds = focusSeconds + driftSeconds;
    const focusScore = scoredSeconds > 0 ? Math.round((focusSeconds / scoredSeconds) * 100) : 0;
    const minutes = Math.round(entry.totalSeconds / 60);
    const level: 0 | 1 | 2 | 3 = scoredSeconds <= 0 ? 0 : focusScore < 34 ? 1 : focusScore < 68 ? 2 : 3;
    return { id: `history-${entry.day}`, isoDay: entry.day, label: formatDayLabel(entry.day), minutes, focusScore, level, isSelected: entry.day === selectedDay };
  });
  const monthGroups = new Map<string, HistoryCell[]>();
  for (const day of days) {
    const monthKey = day.isoDay.slice(0, 7);
    monthGroups.set(monthKey, [...(monthGroups.get(monthKey) ?? []), day]);
  }
  const dayByIso = new Map(days.map((day) => [day.isoDay, day]));
  const months: HistoryMonth[] = Array.from(monthGroups.keys()).map((monthKey) => {
    const monthDays = getHistoryMonthDays(monthKey).map((day) => dayByIso.get(day) ?? buildEmptyHistoryDay(day, selectedDay));
    const firstDayOffset = monthDays[0] ? new Date(`${monthDays[0].isoDay}T00:00:00`).getDay() : 0;
    const calendarDays: HistoryCell[] = [
      ...Array.from({ length: firstDayOffset }, (_, index) => ({ id: `history-empty-${monthKey}-${index}`, isoDay: "", label: "", minutes: 0, focusScore: 0, level: 0 as const, isSelected: false, isEmpty: true })),
      ...monthDays,
    ];

    return { id: monthKey, label: formatHistoryMonthLabel(monthKey), weeks: chunk(calendarDays, 7) };
  });
  const activeDays = days.filter((d) => d.focusScore > 0);
  const bestDay = activeDays.reduce<HistoryCell | null>((cur, d) => (!cur || d.focusScore > cur.focusScore ? d : cur), null);
  let streakDays = 0;
  for (let i = days.length - 1; i >= 0; i--) { if (days[i].focusScore <= 0) break; streakDays++; }
  const totalTrackedSeconds = days.reduce((sum, d) => sum + d.minutes * 60, 0);
  const averageTrackedSeconds = activeDays.length > 0 ? Math.round(activeDays.reduce((sum, d) => sum + d.focusScore, 0) / activeDays.length) : 0;
  return { months, activeDays: activeDays.length, streakDays, bestDayLabel: bestDay ? bestDay.label : "No focus day", bestDayMinutes: bestDay?.focusScore ?? 0, totalTrackedSeconds, averageTrackedSeconds };
}

export function getHistoryMonthDays(month: string): string[] {
  const [yearValue, monthValue] = month.split("-").map(Number);
  const daysInMonth = new Date(yearValue, monthValue, 0).getDate();
  return Array.from({ length: daysInMonth }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`);
}

export function buildEmptyHistoryDay(day: string, selectedDay: string): HistoryCell {
  return { id: `history-${day}`, isoDay: day, label: formatDayLabel(day), minutes: 0, focusScore: 0, level: 0, isSelected: day === selectedDay };
}
