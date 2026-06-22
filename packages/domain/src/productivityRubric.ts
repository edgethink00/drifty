export const DRIFTY_PRODUCTIVITY_RUBRIC_VERSION = "drifty_productivity_rubric_v1";

export type DriftyProductivityRubricVersion = typeof DRIFTY_PRODUCTIVITY_RUBRIC_VERSION;

export type ProductivityScoreDimensionKey =
  | "focus_quality"
  | "drift_control"
  | "switching_stability"
  | "reactive_load"
  | "night_balance";

export type ProductivityScoreDirection = "higher_is_better" | "lower_is_better";

export interface HigherIsBetterThresholds {
  readonly floor: number;
  readonly target: number;
}

export interface LowerIsBetterThresholds {
  readonly target: number;
  readonly ceiling: number;
}

export interface ProductivityScoreThreshold {
  readonly metric: string;
  readonly direction: ProductivityScoreDirection;
  readonly floor?: number;
  readonly target: number;
  readonly ceiling?: number;
}

export interface ProductivityScoreDimension {
  readonly key: ProductivityScoreDimensionKey;
  readonly label: string;
  readonly direction: ProductivityScoreDirection;
  readonly value: number;
  readonly score: number;
  readonly weight: number;
  readonly thresholds: readonly ProductivityScoreThreshold[];
}

export interface ProductivityRubricScore {
  readonly rubricVersion: DriftyProductivityRubricVersion;
  readonly overallScore: number;
  readonly dimensions: readonly ProductivityScoreDimension[];
}

export interface ProductivityRubricMetricInput {
  readonly focusShare: number;
  readonly focusAverageSegmentSeconds: number;
  readonly driftShare: number;
  readonly switchRatePerHour: number;
  readonly reactiveShare: number;
  readonly nightShare: number;
}

export const DRIFTY_PRODUCTIVITY_RUBRIC_V1 = {
  version: DRIFTY_PRODUCTIVITY_RUBRIC_VERSION,
  dimensions: {
    focusQuality: {
      key: "focus_quality",
      label: "Focus quality",
      direction: "higher_is_better",
      weight: 0.32,
      focusShare: { floor: 0.16, target: 0.51 },
      focusAverageSegmentSeconds: { floor: 13, target: 45 },
    },
    driftControl: {
      key: "drift_control",
      label: "Drift control",
      direction: "lower_is_better",
      weight: 0.24,
      driftShare: { target: 0.012, ceiling: 0.248 },
    },
    switchingStability: {
      key: "switching_stability",
      label: "Switching stability",
      direction: "lower_is_better",
      weight: 0.18,
      switchRatePerHour: { target: 36, ceiling: 73 },
    },
    reactiveLoad: {
      key: "reactive_load",
      label: "Reactive load",
      direction: "lower_is_better",
      weight: 0.14,
      reactiveShare: { target: 0.011, ceiling: 0.063 },
    },
    nightBalance: {
      key: "night_balance",
      label: "Night balance",
      direction: "lower_is_better",
      weight: 0.12,
      nightShare: { target: 0.192, ceiling: 0.432 },
    },
  },
  personas: {
    nightOwl: { nightShareMinimum: 0.35 },
    deepFocusDeepDrift: { focusShareMinimum: 0.35, driftShareMinimum: 0.3 },
    deepDiver: {
      focusShareMinimum: 0.65,
      focusAverageSegmentSecondsMinimum: 1500,
      switchRatePerHourMaximum: 6,
      focusQualityScoreMinimum: 0.8,
      switchingStabilityScoreMinimum: 0.6,
    },
    driftDiver: {
      driftShareMinimum: 0.5,
      driftAverageSegmentSecondsMinimum: 720,
      driftControlScoreMaximum: 0.1,
    },
    focusSprinter: { focusShareMinimum: 0.5, focusAverageSegmentSecondsMaximum: 900 },
    reactiveOperator: { reactiveShareMinimum: 0.35 },
  },
} as const;

export function scoreHigherIsBetter(value: number, thresholds: HigherIsBetterThresholds): number {
  return clampScore((value - thresholds.floor) / (thresholds.target - thresholds.floor));
}

export function scoreLowerIsBetter(value: number, thresholds: LowerIsBetterThresholds): number {
  return clampScore((thresholds.ceiling - value) / (thresholds.ceiling - thresholds.target));
}

export function scoreDriftyProductivityRubricV1(metrics: ProductivityRubricMetricInput): ProductivityRubricScore {
  const { dimensions } = DRIFTY_PRODUCTIVITY_RUBRIC_V1;
  const focusShareScore = scoreHigherIsBetter(metrics.focusShare, dimensions.focusQuality.focusShare);
  const focusSegmentScore = scoreHigherIsBetter(
    metrics.focusAverageSegmentSeconds,
    dimensions.focusQuality.focusAverageSegmentSeconds,
  );
  const focusQualityScore = roundScore(focusShareScore * 0.7 + focusSegmentScore * 0.3);
  const driftControlScore = scoreLowerIsBetter(metrics.driftShare, dimensions.driftControl.driftShare);
  const switchingStabilityScore = scoreLowerIsBetter(
    metrics.switchRatePerHour,
    dimensions.switchingStability.switchRatePerHour,
  );
  const reactiveLoadScore = scoreLowerIsBetter(metrics.reactiveShare, dimensions.reactiveLoad.reactiveShare);
  const nightBalanceScore = scoreLowerIsBetter(metrics.nightShare, dimensions.nightBalance.nightShare);

  const rubricDimensions: ProductivityScoreDimension[] = [
    {
      key: dimensions.focusQuality.key,
      label: dimensions.focusQuality.label,
      direction: dimensions.focusQuality.direction,
      value: roundScore(metrics.focusShare),
      score: focusQualityScore,
      weight: dimensions.focusQuality.weight,
      thresholds: [
        {
          metric: "focusShare",
          direction: dimensions.focusQuality.direction,
          floor: dimensions.focusQuality.focusShare.floor,
          target: dimensions.focusQuality.focusShare.target,
        },
        {
          metric: "focusAverageSegmentSeconds",
          direction: dimensions.focusQuality.direction,
          floor: dimensions.focusQuality.focusAverageSegmentSeconds.floor,
          target: dimensions.focusQuality.focusAverageSegmentSeconds.target,
        },
      ],
    },
    {
      key: dimensions.driftControl.key,
      label: dimensions.driftControl.label,
      direction: dimensions.driftControl.direction,
      value: roundScore(metrics.driftShare),
      score: driftControlScore,
      weight: dimensions.driftControl.weight,
      thresholds: [
        {
          metric: "driftShare",
          direction: dimensions.driftControl.direction,
          target: dimensions.driftControl.driftShare.target,
          ceiling: dimensions.driftControl.driftShare.ceiling,
        },
      ],
    },
    {
      key: dimensions.switchingStability.key,
      label: dimensions.switchingStability.label,
      direction: dimensions.switchingStability.direction,
      value: roundScore(metrics.switchRatePerHour),
      score: switchingStabilityScore,
      weight: dimensions.switchingStability.weight,
      thresholds: [
        {
          metric: "switchRatePerHour",
          direction: dimensions.switchingStability.direction,
          target: dimensions.switchingStability.switchRatePerHour.target,
          ceiling: dimensions.switchingStability.switchRatePerHour.ceiling,
        },
      ],
    },
    {
      key: dimensions.reactiveLoad.key,
      label: dimensions.reactiveLoad.label,
      direction: dimensions.reactiveLoad.direction,
      value: roundScore(metrics.reactiveShare),
      score: reactiveLoadScore,
      weight: dimensions.reactiveLoad.weight,
      thresholds: [
        {
          metric: "reactiveShare",
          direction: dimensions.reactiveLoad.direction,
          target: dimensions.reactiveLoad.reactiveShare.target,
          ceiling: dimensions.reactiveLoad.reactiveShare.ceiling,
        },
      ],
    },
    {
      key: dimensions.nightBalance.key,
      label: dimensions.nightBalance.label,
      direction: dimensions.nightBalance.direction,
      value: roundScore(metrics.nightShare),
      score: nightBalanceScore,
      weight: dimensions.nightBalance.weight,
      thresholds: [
        {
          metric: "nightShare",
          direction: dimensions.nightBalance.direction,
          target: dimensions.nightBalance.nightShare.target,
          ceiling: dimensions.nightBalance.nightShare.ceiling,
        },
      ],
    },
  ];

  return {
    rubricVersion: DRIFTY_PRODUCTIVITY_RUBRIC_V1.version,
    overallScore: weightedScore(rubricDimensions),
    dimensions: rubricDimensions,
  };
}

function weightedScore(dimensions: readonly ProductivityScoreDimension[]): number {
  const totalWeight = dimensions.reduce((total, dimension) => total + dimension.weight, 0);
  if (totalWeight <= 0) return 0;
  const weightedTotal = dimensions.reduce((total, dimension) => total + dimension.score * dimension.weight, 0);
  return roundScore(weightedTotal / totalWeight);
}

function clampScore(value: number): number {
  return roundScore(Math.min(1, Math.max(0, value)));
}

function roundScore(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
