/**
 * Moments are "right now" objects: a drift alarm describes the session in
 * progress, while a review describes the day at build time. The auto-dismiss
 * budget freezes while macOS sleeps, so without a wall-clock expiry a card
 * fired seconds before sleep would greet the user the next morning as if it
 * had just happened.
 *
 * Anything older than this at activation (or that grows older while shown) is
 * consumed silently instead of displayed; live producers simply build a fresh
 * event on the next evaluation.
 */
export const COMPANION_MOMENT_STALE_AFTER_MS = 10 * 60 * 1000;

/** Any moment event carries at least one of these wall-clock anchors. */
export type CompanionMomentTimestamps = {
  readonly generatedAt?: string;
};

export function companionMomentReferenceMs(event: CompanionMomentTimestamps): number | null {
  const raw = event.generatedAt;
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isCompanionMomentStale(
  event: CompanionMomentTimestamps,
  nowMs: number = Date.now(),
  staleAfterMs: number = COMPANION_MOMENT_STALE_AFTER_MS,
): boolean {
  const referenceMs = companionMomentReferenceMs(event);
  if (referenceMs === null) return false;
  return nowMs - referenceMs > staleAfterMs;
}
