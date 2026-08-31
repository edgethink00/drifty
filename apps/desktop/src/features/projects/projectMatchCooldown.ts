/**
 * Manual refresh is a provider round over the same latest-7-days window, so a
 * click seconds after a completed pass re-buys the identical answer. The guard
 * keys on the last pass that finished CLEANLY: a partially failed pass leaves
 * the window stale, and locking the retry behind it would hide the button
 * exactly when the user needs it. The window is short enough that a genuine
 * "I changed something, run it again" still works.
 */
export const PROJECT_MATCH_COOLDOWN_MS = 2 * 60 * 1000;

export interface ProjectMatchCooldown {
  readonly active: boolean;
  /** Whole seconds left, for a stable countdown label. */
  readonly remainingSeconds: number;
}

export const NO_PROJECT_MATCH_COOLDOWN: ProjectMatchCooldown = { active: false, remainingSeconds: 0 };

export function resolveProjectMatchCooldown(
  lastSuccessAtMs: number | null | undefined,
  nowMs: number,
  cooldownMs: number = PROJECT_MATCH_COOLDOWN_MS,
): ProjectMatchCooldown {
  if (lastSuccessAtMs === null || lastSuccessAtMs === undefined) return NO_PROJECT_MATCH_COOLDOWN;
  if (!Number.isFinite(lastSuccessAtMs)) return NO_PROJECT_MATCH_COOLDOWN;
  // A timestamp ahead of now (clock change mid-session) must not hold the button
  // until wall time catches up, so it releases immediately instead of waiting.
  if (lastSuccessAtMs > nowMs) return NO_PROJECT_MATCH_COOLDOWN;
  const elapsedMs = nowMs - lastSuccessAtMs;
  const remainingMs = cooldownMs - elapsedMs;
  if (remainingMs <= 0) return NO_PROJECT_MATCH_COOLDOWN;
  return { active: true, remainingSeconds: Math.ceil(remainingMs / 1000) };
}

/** "Just matched · 1:12 left" style suffix for the disabled action. */
export function formatProjectMatchCooldown(remainingSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(remainingSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return minutes > 0 ? `${minutes}:${String(seconds).padStart(2, "0")}` : `${seconds}s`;
}
