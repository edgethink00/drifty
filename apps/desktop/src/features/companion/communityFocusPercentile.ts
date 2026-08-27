export type CommunityFocusPeriod = "daily" | "weekly";

/** Aggregate-only parameters computed from every eligible real account. */
export type CommunityFocusPercentileAggregate = {
  readonly period: string;
  readonly sample_size: number;
  readonly participant_count: number;
  readonly log_mean_minutes: number;
  readonly log_standard_deviation_minutes: number;
  readonly generated_at: string;
};

export type CommunityFocusPercentileModel = {
  readonly version: 1;
  readonly period: CommunityFocusPeriod;
  readonly source: "leaderboard";
  readonly sampleSize: number;
  readonly participantCount: number;
  readonly logMeanMinutes: number;
  readonly logStandardDeviationMinutes: number;
  readonly generatedAt: string;
};

export type CommunityFocusPercentileModels = Readonly<
  Record<CommunityFocusPeriod, CommunityFocusPercentileModel | null>
>;

export type CommunityFocusPercentileEstimate = {
  readonly topPercent: number;
  readonly sampleSize: number;
  readonly participantCount: number;
};

const MIN_MODEL_SAMPLE_SIZE = 20;
const MIN_LOG_STANDARD_DEVIATION = 0.15;
const MAX_TOP_PERCENT = 99.9;
export const PROACTIVE_COMMUNITY_FOCUS_MODEL_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/**
 * Validate the server-computed model before proactive use. The RPC fits the
 * parameters from all fresh, opted-in, positive-focus real accounts and never
 * returns participant-level rows.
 */
export function buildCommunityFocusPercentileModel(
  aggregate: CommunityFocusPercentileAggregate | null | undefined,
  period: CommunityFocusPeriod,
): CommunityFocusPercentileModel | null {
  if (!aggregate || aggregate.period !== period) return null;

  const sampleSize = finiteInteger(aggregate.sample_size);
  const participantCount = finiteInteger(aggregate.participant_count);
  const logMeanMinutes = finiteNumber(aggregate.log_mean_minutes);
  const logStandardDeviationMinutes = finiteNumber(aggregate.log_standard_deviation_minutes);
  if (sampleSize === null
    || participantCount === null
    || sampleSize < MIN_MODEL_SAMPLE_SIZE
    || participantCount !== sampleSize
    || logMeanMinutes === null
    || logStandardDeviationMinutes === null
    || logStandardDeviationMinutes < MIN_LOG_STANDARD_DEVIATION
    || typeof aggregate.generated_at !== "string") return null;

  return {
    version: 1,
    period,
    source: "leaderboard",
    sampleSize,
    participantCount,
    logMeanMinutes,
    logStandardDeviationMinutes,
    generatedAt: aggregate.generated_at,
  };
}

/** Compare one period-to-date focus total with a current leaderboard model. */
export function estimateCommunityFocusPercentile(
  focusSeconds: number,
  model: CommunityFocusPercentileModel | null,
): CommunityFocusPercentileEstimate | null {
  if (!isCommunityFocusPercentileModel(model)) return null;
  const minutes = Math.max(0, Number.isFinite(focusSeconds) ? focusSeconds / 60 : 0);
  const rawTopPercent = minutes <= 0
    ? MAX_TOP_PERCENT
    : (1 - standardNormalCdf(
      (Math.log(minutes) - model.logMeanMinutes) / model.logStandardDeviationMinutes,
    )) * 100;
  const supportedFloor = minimumEstimatedTopPercent(model.sampleSize);
  return {
    topPercent: Math.min(MAX_TOP_PERCENT, Math.max(supportedFloor, rawTopPercent)),
    sampleSize: model.sampleSize,
    participantCount: model.participantCount,
  };
}

/** Require roughly two observations to support a modeled tail claim. */
export function minimumEstimatedTopPercent(sampleSize: number): number {
  const normalizedSize = Math.max(1, Math.floor(Number.isFinite(sampleSize) ? sampleSize : 1));
  const rawFloor = (2 / normalizedSize) * 100;
  const boundaries = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100] as const;
  return boundaries.find((boundary) => boundary >= rawFloor) ?? 100;
}

export function isCommunityFocusPercentileModel(value: unknown): value is CommunityFocusPercentileModel {
  if (typeof value !== "object" || value === null) return false;
  const model = value as Partial<CommunityFocusPercentileModel>;
  return model.version === 1
    && (model.period === "daily" || model.period === "weekly")
    && model.source === "leaderboard"
    && typeof model.sampleSize === "number"
    && Number.isInteger(model.sampleSize)
    && model.sampleSize >= MIN_MODEL_SAMPLE_SIZE
    && typeof model.participantCount === "number"
    && Number.isInteger(model.participantCount)
    && model.participantCount === model.sampleSize
    && typeof model.logMeanMinutes === "number"
    && Number.isFinite(model.logMeanMinutes)
    && typeof model.logStandardDeviationMinutes === "number"
    && Number.isFinite(model.logStandardDeviationMinutes)
    && model.logStandardDeviationMinutes >= MIN_LOG_STANDARD_DEVIATION
    && typeof model.generatedAt === "string";
}

export function isCommunityFocusPercentileModelFresh(
  model: CommunityFocusPercentileModel | null | undefined,
  maxAgeMs = PROACTIVE_COMMUNITY_FOCUS_MODEL_MAX_AGE_MS,
  nowMs = Date.now(),
): model is CommunityFocusPercentileModel {
  if (!isCommunityFocusPercentileModel(model)) return false;
  const generatedAtMs = Date.parse(model.generatedAt);
  return Number.isFinite(generatedAtMs)
    && generatedAtMs <= nowMs + 60_000
    && nowMs - generatedAtMs <= maxAgeMs;
}

function standardNormalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-(x * x));
  return 0.5 * (1 + sign * erf);
}

function finiteInteger(value: unknown): number | null {
  const normalized = typeof value === "number" ? value : Number.NaN;
  return Number.isInteger(normalized) && normalized >= 0 ? normalized : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
