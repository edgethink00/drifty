type CoverageMultiplierPoint = {
  readonly coverage: number;
  readonly multiplier: number;
};

const ZERO_COVERAGE_MULTIPLIER: CoverageMultiplierPoint = { coverage: 0, multiplier: 0 };
const MAX_COVERAGE_MULTIPLIER: CoverageMultiplierPoint = { coverage: 1, multiplier: 1.05 };
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
  return Math.min(kindRatio * coverageMultiplier * 100, 100);
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
