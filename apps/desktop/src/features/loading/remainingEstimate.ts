/**
 * One honest remaining-time policy for every long wait in the app.
 *
 * Two surfaces need it — the first-day preparation gate and the managed model
 * download — and a countdown that behaves differently in each is worse than no
 * countdown at all. The rules here are deliberately conservative: say nothing
 * until the throughput is real, round hard enough that nobody audits the number,
 * and never let the estimate creep upward over noise.
 */

export type ProgressSample = {
  readonly at: number;
  /** 0..1 completion at that moment. */
  readonly value: number;
};

/** Ignore a throughput read this short — it is mostly scheduling noise. */
const MIN_SPAN_MS = 6_000;
/** Ignore a throughput read this small; one batch or one chunk says very little. */
const MIN_DELTA = 0.02;
/** Past this the estimate is a guess dressed up as a promise, so say nothing. */
export const REMAINING_ESTIMATE_MAX_MS = 10 * 60_000;
/** A slower read is adopted only when the work has genuinely fallen behind. */
const SLOWDOWN_TOLERANCE = 1.6;
/**
 * "Almost done" is only allowed to appear next to a number that agrees with it.
 * A fast connection really can finish the last half of a download in twenty
 * seconds, but "almost done" beside 45% reads as a broken screen, so below this
 * completion the estimate makes the weaker claim instead — which is still true.
 */
const ALMOST_MIN_COMPLETION = 0.85;

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Remaining milliseconds from observed throughput, or `null` when unknowable. */
export function estimateRemainingMs(samples: readonly ProgressSample[]): number | null {
  if (samples.length < 2) return null;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const span = last.at - first.at;
  const delta = last.value - first.value;
  if (span < MIN_SPAN_MS || delta < MIN_DELTA) return null;
  const rate = delta / span;
  if (!Number.isFinite(rate) || rate <= 0) return null;
  const remaining = (1 - clampUnit(last.value)) / rate;
  if (!Number.isFinite(remaining) || remaining < 0) return null;
  return remaining > REMAINING_ESTIMATE_MAX_MS ? null : remaining;
}

/**
 * Fold a fresh estimate into the one already on screen. A countdown that keeps
 * growing reads as the app losing ground, so the calmer of the two wins unless
 * the work has really slowed down.
 */
export function mergeRemainingMs(shownMs: number | null, nextMs: number | null): number | null {
  if (nextMs === null) return shownMs;
  if (shownMs === null) return nextMs;
  if (nextMs > shownMs * SLOWDOWN_TOLERANCE) return nextMs;
  return Math.min(shownMs, nextMs);
}

export type RemainingLabel =
  | { readonly kind: "almost" }
  | { readonly kind: "underMinute" }
  | { readonly kind: "minutes"; readonly minutes: number };

/**
 * Coarse buckets only. A per-second countdown invites the user to audit it; a
 * rounded "about two minutes" sets an expectation without making a promise.
 */
export function remainingLabel(remainingMs: number | null, completion: number | null = null): RemainingLabel | null {
  if (remainingMs === null || !Number.isFinite(remainingMs)) return null;
  if (remainingMs > REMAINING_ESTIMATE_MAX_MS) return null;
  if (remainingMs <= 25_000) {
    const agrees = completion === null || completion >= ALMOST_MIN_COMPLETION;
    return agrees ? { kind: "almost" } : { kind: "underMinute" };
  }
  if (remainingMs < 60_000) return { kind: "underMinute" };
  return { kind: "minutes", minutes: Math.max(1, Math.round(remainingMs / 60_000)) };
}

export function sameRemainingLabel(left: RemainingLabel | null, right: RemainingLabel | null): boolean {
  if (left === null || right === null) return left === right;
  if (left.kind !== right.kind) return false;
  return left.kind !== "minutes" || right.kind !== "minutes" || left.minutes === right.minutes;
}
