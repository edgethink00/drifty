import type { DailyProductivityPoint } from "../share/dailyProductivity";

export function weekOverWeekDeltaPercent(points: readonly DailyProductivityPoint[] | null | undefined): number | null {
  if (!points || points.length < 14) return null;
  const current = points.slice(-7).reduce((sum, point) => sum + Math.max(0, point.focus), 0);
  const previous = points.slice(-14, -7).reduce((sum, point) => sum + Math.max(0, point.focus), 0);
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export function trailingFocusStreakDays(points: readonly DailyProductivityPoint[] | null | undefined): number {
  if (!points || points.length === 0) return 0;
  let index = points.length - 1;
  if ((points[index]?.focus ?? 0) <= 0) index -= 1;
  let streak = 0;
  for (let i = index; i >= 0; i -= 1) {
    if ((points[i]?.focus ?? 0) > 0) streak += 1;
    else break;
  }
  return streak;
}
