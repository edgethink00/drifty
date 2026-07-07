import type { ProjectPassRun } from "@drifty/domain";

/**
 * Aggregates project_pass_runs into the dev-mode cost panel model (§4.7). This
 * is the instrumentation that decides whether the scheduled cadence is
 * affordable (D10 revisit condition). Token→cost is optional: we store tokens,
 * not cost, so the panel supplies per-model prices to estimate spend.
 */
export interface ProjectPassCostBucket {
  readonly day: string;
  readonly passes: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly assignments: number;
  readonly corrections: number;
}

export interface ProjectPassCostSummary {
  readonly totalPasses: number;
  readonly totalTokensIn: number;
  readonly totalTokensOut: number;
  readonly estimatedCostUsd: number | null;
  readonly byDay: ProjectPassCostBucket[];
  readonly byTrigger: Record<string, number>;
}

export interface ProjectPassCostOptions {
  /** USD per 1M input tokens; omit to leave cost unestimated. */
  readonly pricePerMTokIn?: number;
  /** USD per 1M output tokens. */
  readonly pricePerMTokOut?: number;
  /** Map a run's ranAt ISO to a day key. Defaults to the ISO date (UTC) slice. */
  readonly dayKey?: (ranAtIso: string) => string;
}

function defaultDayKey(ranAtIso: string): string {
  return ranAtIso.slice(0, 10);
}

export function summarizeProjectPassCost(runs: readonly ProjectPassRun[], options: ProjectPassCostOptions = {}): ProjectPassCostSummary {
  const dayKey = options.dayKey ?? defaultDayKey;
  const buckets = new Map<string, { passes: number; tokensIn: number; tokensOut: number; assignments: number; corrections: number }>();
  const byTrigger: Record<string, number> = {};
  let totalTokensIn = 0;
  let totalTokensOut = 0;

  for (const run of runs) {
    const day = dayKey(run.ranAt);
    const bucket = buckets.get(day) ?? { passes: 0, tokensIn: 0, tokensOut: 0, assignments: 0, corrections: 0 };
    bucket.passes += 1;
    bucket.tokensIn += run.tokensIn ?? 0;
    bucket.tokensOut += run.tokensOut ?? 0;
    bucket.assignments += run.assignmentsCount ?? 0;
    bucket.corrections += run.correctionsCount ?? 0;
    buckets.set(day, bucket);
    totalTokensIn += run.tokensIn ?? 0;
    totalTokensOut += run.tokensOut ?? 0;
    byTrigger[run.trigger] = (byTrigger[run.trigger] ?? 0) + 1;
  }

  const canEstimate = options.pricePerMTokIn !== undefined || options.pricePerMTokOut !== undefined;
  const estimatedCostUsd = canEstimate
    ? (totalTokensIn / 1_000_000) * (options.pricePerMTokIn ?? 0) + (totalTokensOut / 1_000_000) * (options.pricePerMTokOut ?? 0)
    : null;

  const byDay = Array.from(buckets.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([day, value]) => ({ day, ...value }));

  return {
    totalPasses: runs.length,
    totalTokensIn,
    totalTokensOut,
    estimatedCostUsd,
    byDay,
    byTrigger,
  };
}

/** Approximate USD per 1M tokens (input / output) for the analysis models. These
 *  are estimates for at-a-glance spend, not billing — providers are the source
 *  of truth. Unknown models fall back to the gpt-5-mini tier. */
export const PROJECT_PASS_MODEL_PRICING: Record<string, { readonly in: number; readonly out: number }> = {
  "openai/gpt-5-mini": { in: 0.25, out: 2.0 },
  "anthropic/claude-sonnet-5": { in: 3.0, out: 15.0 },
  "google/gemini-3.1-flash-lite": { in: 0.1, out: 0.4 },
};

const DEFAULT_PROJECT_PASS_PRICING = { in: 0.25, out: 2.0 } as const;

export function pricingForModel(model: string | null | undefined): { readonly in: number; readonly out: number } {
  if (model && PROJECT_PASS_MODEL_PRICING[model]) return PROJECT_PASS_MODEL_PRICING[model];
  return DEFAULT_PROJECT_PASS_PRICING;
}

function activityDaysForRun(run: ProjectPassRun): number {
  const start = Date.parse(run.rangeStart);
  const end = Date.parse(run.rangeEnd);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 1;
  return Math.max(1, Math.ceil((end - start) / 86_400_000));
}

export interface ProjectPassSpendEstimate {
  /** USD spent across the runs we have, priced per-run by each run's model. */
  readonly totalUsd: number;
  /** Extrapolated USD/month: cost normalized per activity-day processed × 30. */
  readonly monthlyUsd: number;
  /** Distinct models seen across the runs (most-recent-first order preserved). */
  readonly models: string[];
}

/**
 * Prices project passes per-run using each run's own model, then extrapolates a
 * monthly figure from the cost per activity-day processed (a 7-day backfill that
 * cost $X implies ~$X/7 per day → ×30). Re-running the same range keeps the
 * per-day rate stable, so the monthly figure reflects steady-state usage.
 */
export function estimateProjectPassSpend(runs: readonly ProjectPassRun[]): ProjectPassSpendEstimate {
  let totalUsd = 0;
  let activityDays = 0;
  const models: string[] = [];
  for (const run of runs) {
    const pricing = pricingForModel(run.model);
    totalUsd += ((run.tokensIn ?? 0) / 1_000_000) * pricing.in + ((run.tokensOut ?? 0) / 1_000_000) * pricing.out;
    activityDays += activityDaysForRun(run);
    if (run.model && !models.includes(run.model)) models.push(run.model);
  }
  const monthlyUsd = activityDays > 0 ? (totalUsd / activityDays) * 30 : 0;
  return { totalUsd, monthlyUsd, models };
}
