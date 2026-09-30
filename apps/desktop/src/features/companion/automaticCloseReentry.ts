import type { CurrentActivitySnapshot } from "@drifty/domain";
import type { DriftAlarmCandidate } from "./driftAlarmData";
import { areSameDriftAlarmSurface, resolveDriftAlarmSurface } from "./driftAlarmSurface";

// Keep the existing 12.5s result card usable, even with Instant selected.
export const AUTOMATIC_CLOSE_RECOVERY_MS = 15_000;
const MAX_SNAPSHOT_AGE_MS = 15_000;
const MAX_OBSERVATION_GAP_MS = 30_000;

export type AutomaticCloseReentry = {
  readonly closedAtMs: number;
  readonly entry: {
    readonly episodeKey: string;
    readonly startedAtMs: number;
    readonly observedAtMs: number;
  } | null;
};

export function observeAutomaticCloseReentry(
  state: AutomaticCloseReentry,
  candidate: DriftAlarmCandidate | null,
  snapshot: CurrentActivitySnapshot | null,
  nowMs: number,
  delaySeconds: number,
): { state: AutomaticCloseReentry; ready: boolean; remainingMs: number } {
  const observedAtMs = Date.parse(snapshot?.observedAt ?? "");
  const candidateSurface = candidate && resolveDriftAlarmSurface(candidate.segment);
  const currentSurface = snapshot && resolveDriftAlarmSurface(snapshot);
  const unavailable = snapshot?.browserAutomationError
    || (snapshot?.browserAutomationStatus != null && snapshot.browserAutomationStatus !== "granted");
  const verified = candidate && candidateSurface?.kind === "browser" && currentSurface?.kind === "browser"
    && areSameDriftAlarmSurface(candidateSurface, currentSurface)
    && snapshot?.siteUrl && candidate.segment.siteUrl === snapshot.siteUrl
    && !snapshot.systemTransientActivity && !unavailable
    && Number.isFinite(observedAtMs) && observedAtMs > state.closedAtMs
    && observedAtMs <= nowMs && nowMs - observedAtMs <= MAX_SNAPSHOT_AGE_MS;
  if (!verified) return { state: { ...state, entry: null }, ready: false, remainingMs: 0 };

  const previous = state.entry;
  const continuous = previous?.episodeKey === candidate.episodeKey
    && observedAtMs >= previous.observedAtMs
    && observedAtMs - previous.observedAtMs <= MAX_OBSERVATION_GAP_MS;
  const entry = {
    episodeKey: candidate.episodeKey,
    startedAtMs: continuous ? previous.startedAtMs : observedAtMs,
    observedAtMs,
  };
  // Grace and delay run concurrently; old episode time never pays this delay.
  const readyAtMs = Math.max(state.closedAtMs + AUTOMATIC_CLOSE_RECOVERY_MS, entry.startedAtMs + delaySeconds * 1_000);
  const remainingMs = Math.max(0, readyAtMs - observedAtMs);
  return { state: { ...state, entry }, ready: remainingMs === 0, remainingMs };
}
