import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./watcherBridge";
import type { CompanionMomentTimestamps } from "./companionMomentFreshness";

/**
 * Informational moments (day review, milestones, celebrations, reentry) carry
 * no decision, so they must never pop over a fullscreen app — a keynote, a
 * film, a game. Interventions (drift alarm, extreme nudge) deliberately skip
 * this gate: late-night drift is exactly when they matter.
 *
 * The native answer rides in a short-lived cache so the show path stays
 * synchronous and flicker-free; every gate read kicks a background refresh,
 * and the deferred queue forces one before each retry. Everything fails
 * open: when the state cannot be determined, moments are allowed through
 * rather than silently lost.
 */
export const INFORMATIONAL_MOMENT_DEFER_RETRY_MS = 60_000;

let cachedSuppression = false;
let refreshInFlight: Promise<void> | null = null;

export function isInformationalMomentKind(kind: string): boolean {
  return kind === "milestone" || kind === "reentry" || kind === "endOfDayReview";
}

/** Every informational kind carries a wall-clock anchor for staleness. */
export type InformationalMomentEvent = CompanionMomentTimestamps & {
  kind: "milestone" | "reentry" | "endOfDayReview";
};

export function isInformationalMomentEvent<T extends { kind: string }>(
  event: T,
): event is T & InformationalMomentEvent {
  return isInformationalMomentKind(event.kind);
}

/** Last known suppression state; cheap enough to consult on the show path. */
export function isInformationalMomentSuppressedNow(): boolean {
  return cachedSuppression;
}

export function refreshInformationalMomentSuppression(): Promise<void> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      if (!isTauriRuntime()) {
        cachedSuppression = false;
        return;
      }
      cachedSuppression = await invoke<boolean>("companion_informational_moments_suppressed");
    } catch {
      cachedSuppression = false;
    }
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}
