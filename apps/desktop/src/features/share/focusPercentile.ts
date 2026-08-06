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

// These defaults preserve the approved art-direction anchors: a 5h 15m day
// lands around Top 0.4%, while a 20h 20m week lands around Top 1.2%.
const FOCUS_TIME_DISTRIBUTIONS: Record<FocusPercentilePeriod, NormalDistribution> = {
  daily: { meanMinutes: 130, standardDeviationMinutes: 70 },
  weekly: { meanMinutes: 700, standardDeviationMinutes: 230 },
};

const MIN_TOP_PERCENT = 0.001;
const MAX_TOP_PERCENT = 99;

function standardNormalCdf(z: number): number {
  // Abramowitz and Stegun 7.1.26, accurate enough for a display percentile.
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-(x * x));
  return 0.5 * (1 + sign * erf);
}

function roundForDisplay(value: number): number {
  if (value < 0.1) return Math.round(value * 1_000) / 1_000;
  if (value < 1) return Math.round(value * 100) / 100;
  return Math.round(value * 10) / 10;
}

/** Estimate a local Top n% focus-time percentile from the selected aggregate. */
export function estimateFocusTopPercent(focusSeconds: number, period: FocusPercentilePeriod): number {
  const distribution = FOCUS_TIME_DISTRIBUTIONS[period];
  const minutes = Math.max(0, Number.isFinite(focusSeconds) ? focusSeconds / 60 : 0);
  const z = (minutes - distribution.meanMinutes) / distribution.standardDeviationMinutes;
  const rawTopPercent = (1 - standardNormalCdf(z)) * 100;
  return roundForDisplay(Math.min(MAX_TOP_PERCENT, Math.max(MIN_TOP_PERCENT, rawTopPercent)));
}
