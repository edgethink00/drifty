// Local-only focus percentile model for share cards.
//
// This is intentionally a distribution model, not a leaderboard claim. It
// makes the "Top n%" cards useful before someone opts into the leaderboard;
// only the separately gated `#place / participant count` card uses live
// leaderboard aggregates.

export type FocusPercentilePeriod = "daily" | "weekly";

type NormalDistribution = {
  readonly meanMinutes: number;
  readonly standardDeviationMinutes: number;
};

// Approximate comparison distributions derived from the approved persona-day
// plan in supabase/generated/leaderboard-seed-personas-20260804-20261104.json
// (active-day mean/SD 200/99m; rolling-seven-day mean/SD 727/494m). They are
// deliberately treated as estimates:
// the daily live board is a small, timezone-mixed snapshot and the dashboard
// week is calendar-based while the leaderboard week is rolling seven days.
const FOCUS_TIME_DISTRIBUTIONS: Record<FocusPercentilePeriod, NormalDistribution> = {
  daily: { meanMinutes: 200, standardDeviationMinutes: 99 },
  weekly: { meanMinutes: 727, standardDeviationMinutes: 494 },
};

const MIN_TOP_PERCENT = 0.1;
const MAX_TOP_PERCENT = 99.9;
const MINUTES_PER_DAY = 24 * 60;
const MIN_COMPARISON_PROGRESS = 1 / MINUTES_PER_DAY;

function standardNormalCdf(z: number): number {
  // Abramowitz and Stegun 7.1.26, accurate enough for a display percentile.
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-(x * x));
  return 0.5 * (1 + sign * erf);
}

function roundForDisplay(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Estimate a local Top n% focus-time percentile from the selected aggregate. */
export function estimateFocusTopPercent(
  focusSeconds: number,
  period: FocusPercentilePeriod,
  comparisonProgress = 1,
): number {
  const distribution = FOCUS_TIME_DISTRIBUTIONS[period];
  const minutes = Math.max(0, Number.isFinite(focusSeconds) ? focusSeconds / 60 : 0);
  const progress = Math.max(
    MIN_COMPARISON_PROGRESS,
    Math.min(1, Number.isFinite(comparisonProgress) ? comparisonProgress : 1),
  );
  const elapsedMean = distribution.meanMinutes * progress;
  // Treat focus accumulated in disjoint elapsed intervals as additive: the
  // mean grows linearly, while variance grows linearly (so SD grows with √t).
  const elapsedStandardDeviation = distribution.standardDeviationMinutes * Math.sqrt(progress);
  const z = (minutes - elapsedMean) / elapsedStandardDeviation;
  const rawTopPercent = (1 - standardNormalCdf(z)) * 100;
  return roundForDisplay(Math.min(MAX_TOP_PERCENT, Math.max(MIN_TOP_PERCENT, rawTopPercent)));
}

function utcDayNumber(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return Date.UTC(year, month - 1, date) / 86_400_000;
}

function currentDayProgress(currentMinuteOfDay: number): number {
  const minute = Number.isFinite(currentMinuteOfDay) ? currentMinuteOfDay : MINUTES_PER_DAY;
  return Math.max(MIN_COMPARISON_PROGRESS, Math.min(1, minute / MINUTES_PER_DAY));
}

/** Use elapsed logical-day time only when the selected day is today. */
export function dailyFocusComparisonProgress(
  selectedDay: string,
  logicalToday: string,
  currentMinuteOfDay: number,
): number {
  return selectedDay === logicalToday ? currentDayProgress(currentMinuteOfDay) : 1;
}

/** Progress through a selected calendar week, including today's logical-day fraction. */
export function weeklyFocusComparisonProgress(
  startDay: string,
  endDay: string,
  logicalToday: string,
  currentMinuteOfDay: number,
): number {
  const start = utcDayNumber(startDay);
  const end = utcDayNumber(endDay);
  const today = utcDayNumber(logicalToday);
  if (![start, end, today].every(Number.isFinite) || today < start || today > end) return 1;

  const totalDays = Math.max(1, end - start + 1);
  const completedDays = Math.max(0, today - start);
  return Math.min(1, (completedDays + currentDayProgress(currentMinuteOfDay)) / totalDays);
}
