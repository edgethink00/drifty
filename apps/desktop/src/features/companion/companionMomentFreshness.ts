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
  readonly expiresAt?: string;
};

export function companionMomentReferenceMs(event: CompanionMomentTimestamps): number | null {
  const raw = event.generatedAt;
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function companionMomentDeadlineMs(
  event: CompanionMomentTimestamps,
  staleAfterMs: number = COMPANION_MOMENT_STALE_AFTER_MS,
): number | null {
  const referenceMs = companionMomentReferenceMs(event);
  const ageDeadlineMs = referenceMs === null ? null : referenceMs + staleAfterMs;
  const producerDeadlineMs = event.expiresAt ? Date.parse(event.expiresAt) : Number.NaN;
  if (!Number.isFinite(producerDeadlineMs)) return ageDeadlineMs;
  return ageDeadlineMs === null ? producerDeadlineMs : Math.min(ageDeadlineMs, producerDeadlineMs);
}

/** Once a card began presentation, only wall-clock age can invalidate its acknowledgement. */
export function isCompanionMomentAgedOut(
  event: CompanionMomentTimestamps,
  nowMs: number = Date.now(),
  staleAfterMs: number = COMPANION_MOMENT_STALE_AFTER_MS,
): boolean {
  const referenceMs = companionMomentReferenceMs(event);
  return referenceMs !== null && nowMs - referenceMs > staleAfterMs;
}

export function isCompanionMomentStale(
  event: CompanionMomentTimestamps,
  nowMs: number = Date.now(),
  staleAfterMs: number = COMPANION_MOMENT_STALE_AFTER_MS,
): boolean {
  const expiresAtMs = event.expiresAt ? Date.parse(event.expiresAt) : Number.NaN;
  if (Number.isFinite(expiresAtMs) && nowMs >= expiresAtMs) return true;
  return isCompanionMomentAgedOut(event, nowMs, staleAfterMs);
}
