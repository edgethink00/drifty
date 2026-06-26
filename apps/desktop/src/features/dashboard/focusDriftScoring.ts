type CoverageMultiplierPoint = {
  readonly coverage: number;
  readonly multiplier: number;
};

const ZERO_COVERAGE_MULTIPLIER: CoverageMultiplierPoint = { coverage: 0, multiplier: 0 };
const MAX_COVERAGE_MULTIPLIER: CoverageMultiplierPoint = { coverage: 1, multiplier: 1.05 };
const LOW_COVERAGE_SCORE_PENALTY = 10;
const LOW_COVERAGE_FULL_PENALTY_END = 0.2;
const LOW_COVERAGE_PENALTY_END = 0.25;
const FOCUS_DRIFT_COVERAGE_MULTIPLIER_POINTS: readonly CoverageMultiplierPoint[] = [
  ZERO_COVERAGE_MULTIPLIER,
  { coverage: 0.05, multiplier: 0.72 },
  { coverage: 0.1, multiplier: 0.84 },
  { coverage: 0.25, multiplier: 0.95 },
  { coverage: 0.5, multiplier: 1 },
  { coverage: 0.8, multiplier: 1.03 },
  MAX_COVERAGE_MULTIPLIER,
] as const;

export function scoreFocusDriftWindowShare(seconds: number, scoredSeconds: number, windowSeconds: number): number {
  const boundedSeconds = Math.max(seconds, 0);
  const boundedScoredSeconds = Math.max(scoredSeconds, 0);
  if (boundedSeconds <= 0 || boundedScoredSeconds <= 0 || windowSeconds <= 0) return 0;

  const kindRatio = Math.min(boundedSeconds / boundedScoredSeconds, 1);
  const kindCoverage = Math.min(boundedSeconds / windowSeconds, 1);
  const coverageMultiplier = interpolateFocusDriftCoverageMultiplier(kindCoverage);
  const windowCoverageScore = kindCoverage * 100;
  const coverageMultiplierScore = kindRatio * coverageMultiplier * 100;
  const penaltyTransitionProgress = Math.min(
    Math.max((kindCoverage - LOW_COVERAGE_FULL_PENALTY_END) / (LOW_COVERAGE_PENALTY_END - LOW_COVERAGE_FULL_PENALTY_END), 0),
    1,
  );
  const smoothedPenaltyTransition = penaltyTransitionProgress * penaltyTransitionProgress * (3 - 2 * penaltyTransitionProgress);
  const lowCoveragePenaltyScale = kindCoverage < LOW_COVERAGE_PENALTY_END ? 1 - smoothedPenaltyTransition : 0;
  const scorePenalty = LOW_COVERAGE_SCORE_PENALTY * kindRatio * lowCoveragePenaltyScale;
  return Math.min(
    Math.max(coverageMultiplierScore - scorePenalty, windowCoverageScore),
    100,
  );
}

function interpolateFocusDriftCoverageMultiplier(coverage: number): number {
  const boundedCoverage = Math.min(Math.max(coverage, 0), 1);
  let previous = ZERO_COVERAGE_MULTIPLIER;

  for (const point of FOCUS_DRIFT_COVERAGE_MULTIPLIER_POINTS) {
    if (boundedCoverage <= point.coverage) {
      if (point.coverage === previous.coverage) return point.multiplier;
      const span = point.coverage - previous.coverage;
      const progress = (boundedCoverage - previous.coverage) / span;
      return previous.multiplier + (point.multiplier - previous.multiplier) * progress;
    }
    previous = point;
  }

  return MAX_COVERAGE_MULTIPLIER.multiplier;
}
