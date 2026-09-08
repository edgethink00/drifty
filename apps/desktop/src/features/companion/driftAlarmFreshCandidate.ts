import type { ActivitySegment, ClassificationOptions, CurrentActivitySnapshot } from "@drifty/domain";
import { buildDriftAlarmCandidates, type DriftAlarmCandidate } from "./driftAlarmData";

export type FreshDriftAlarmCandidateInput = {
  readonly candidate: DriftAlarmCandidate;
  readonly segments: readonly ActivitySegment[];
  readonly currentSnapshot: CurrentActivitySnapshot | null;
  readonly classificationOptions: ClassificationOptions;
  readonly minimumDurationSeconds: number;
};

export function resolveFreshDriftAlarmCandidate(input: FreshDriftAlarmCandidateInput): DriftAlarmCandidate | null {
  if (!input.currentSnapshot) return null;

  const freshCandidate = buildDriftAlarmCandidates({
    segments: [...input.segments],
    currentSnapshot: input.currentSnapshot,
    classificationOptions: input.classificationOptions,
    minimumDurationSeconds: input.minimumDurationSeconds,
  })[0] ?? null;
  if (!freshCandidate) return null;

  return freshCandidate.episodeKey === input.candidate.episodeKey
    ? freshCandidate
    : null;
}

/** Classify a failed candidate check without treating capture loss as a verified context change. */
export function getUnconfirmedDriftAlarmReason(
  candidate: DriftAlarmCandidate,
  current: CurrentActivitySnapshot | null,
): "current-window-changed" | "current-snapshot-unavailable" {
  const appName = current?.appName.trim();
  if (!current || !appName || appName === "Unavailable") {
    return "current-snapshot-unavailable";
  }

  const target = candidate.segment;
  const sameApp = current.bundleId && target.bundleId
    ? current.bundleId === target.bundleId
    : appName === target.appName.trim();
  const browserReadFailed = Boolean(current.browserAutomationError)
    || current.browserAutomationStatus === "denied"
    || current.browserAutomationStatus === "unavailable"
    || current.browserAutomationStatus === "stale"
    || current.browserAutomationStatus === "empty_result";
  // A browser may still report its app/window after losing access to the address.
  // Keep no-close, but allow the ordinary fallback alarm for that unknown target.
  // A positively identified different app or site keeps context-change suppression.
  if (sameApp && target.browserName && !current.siteDomain && !current.siteUrl && browserReadFailed) {
    return "current-snapshot-unavailable";
  }
  return "current-window-changed";
}
