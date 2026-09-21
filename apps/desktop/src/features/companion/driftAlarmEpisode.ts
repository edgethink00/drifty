import {
  isBrowserHistoryImportSegment,
  isRemoteDeviceSegment,
  type ActivitySegment,
} from "@drifty/domain";
import {
  areSameDriftAlarmSurface,
  driftAlarmSurfaceKey,
  resolveDriftAlarmSurface,
  type DriftAlarmSurface,
} from "./driftAlarmSurface";

export const DRIFT_ALARM_EPISODE_MAX_GAP_SECONDS = 15;

export type DriftAlarmEpisode = {
  readonly episodeKey: string;
  readonly surfaceKey: string;
  readonly startedAt: string;
  readonly durationSeconds: number;
  readonly segmentIds: readonly string[];
};

export function buildContinuousDriftAlarmEpisode(input: {
  readonly currentSegment: ActivitySegment;
  readonly segments: readonly ActivitySegment[];
  readonly isEligibleDrift: (segment: ActivitySegment) => boolean;
  readonly maxGapSeconds?: number;
}): DriftAlarmEpisode | null {
  const currentSurface = resolveDriftAlarmSurface(input.currentSegment);
  if (!input.isEligibleDrift(input.currentSegment)) return null;
  if (!currentSurface) return singleSegmentEpisode(input.currentSegment);

  const localSegmentsById = new Map<string, ActivitySegment>();
  for (const segment of input.segments) {
    if (!isLocalLiveSegment(segment)) continue;
    localSegmentsById.set(segment.id, segment);
  }
  localSegmentsById.set(input.currentSegment.id, input.currentSegment);

  const ordered = Array.from(localSegmentsById.values()).sort(compareSegmentsChronologically);
  const currentIndex = ordered.findIndex((segment) => segment.id === input.currentSegment.id);
  if (currentIndex < 0) return null;

  const episodeSegments = [input.currentSegment];
  const maxGapSeconds = input.maxGapSeconds ?? DRIFT_ALARM_EPISODE_MAX_GAP_SECONDS;
  let nextSegment = input.currentSegment;

  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    const previousSegment = ordered[index];
    const previousSurface = resolveDriftAlarmSurface(previousSegment);
    if (!areSegmentsContinuous(previousSegment, nextSegment, maxGapSeconds)) break;
    if (!previousSurface) {
      if (!isTransientBrowserContextGap(previousSegment, nextSegment, currentSurface, maxGapSeconds)) break;
      // A bounded failed address sample proves no drift time by itself. Skip it
      // without adding its duration, but keep it as the temporal bridge to the
      // next independently identified segment on the same browser surface.
      nextSegment = previousSegment;
      continue;
    }
    if (!areSameDriftAlarmSurface(previousSurface, currentSurface)) break;
    if (!input.isEligibleDrift(previousSegment)) break;

    episodeSegments.unshift(previousSegment);
    nextSegment = previousSegment;
  }

  const firstSegment = episodeSegments[0];
  return {
    episodeKey: `drift-episode:${firstSegment.id}`,
    surfaceKey: driftAlarmSurfaceKey(currentSurface),
    startedAt: firstSegment.startedAt,
    durationSeconds: episodeSegments.reduce(
      (total, segment) => total + normalizedDurationSeconds(segment.durationSeconds),
      0,
    ),
    segmentIds: episodeSegments.map((segment) => segment.id),
  };
}

function isTransientBrowserContextGap(
  segment: ActivitySegment,
  nextSegment: ActivitySegment,
  currentSurface: DriftAlarmSurface,
  maxGapSeconds: number,
): boolean {
  if (currentSurface.kind !== "browser") return false;
  if (segment.browserAutomationStatus !== "unavailable") return false;
  if (resolveDriftAlarmSurface(segment) !== null) return false;
  if (normalizedDurationSeconds(segment.durationSeconds) > maxGapSeconds) return false;

  const segmentBundleId = normalizedIdentity(segment.bundleId);
  const nextBundleId = normalizedIdentity(nextSegment.bundleId);
  const segmentBrowser = normalizedIdentity(segment.browserName ?? segment.appName);
  const nextBrowser = normalizedIdentity(nextSegment.browserName ?? nextSegment.appName);
  const segmentTitle = normalizedTitle(segment.windowTitle);
  const nextTitle = normalizedTitle(nextSegment.windowTitle);

  return Boolean(
    segmentBundleId
    && segmentBundleId === nextBundleId
    && segmentBrowser
    && segmentBrowser === nextBrowser
    && segmentTitle
    && segmentTitle === nextTitle
  );
}

function singleSegmentEpisode(segment: ActivitySegment): DriftAlarmEpisode {
  return {
    episodeKey: `drift-episode:${segment.id}`,
    surfaceKey: `exact:${segment.id}`,
    startedAt: segment.startedAt,
    durationSeconds: normalizedDurationSeconds(segment.durationSeconds),
    segmentIds: [segment.id],
  };
}

function isLocalLiveSegment(segment: ActivitySegment): boolean {
  return !isRemoteDeviceSegment(segment) && !isBrowserHistoryImportSegment(segment);
}

function compareSegmentsChronologically(left: ActivitySegment, right: ActivitySegment): number {
  const leftStartedAtMs = timestampMs(left.startedAt);
  const rightStartedAtMs = timestampMs(right.startedAt);
  if (leftStartedAtMs !== rightStartedAtMs) return leftStartedAtMs - rightStartedAtMs;

  const leftEndedAtMs = timestampMs(left.endedAt);
  const rightEndedAtMs = timestampMs(right.endedAt);
  if (leftEndedAtMs !== rightEndedAtMs) return leftEndedAtMs - rightEndedAtMs;
  return left.id.localeCompare(right.id);
}

function areSegmentsContinuous(previous: ActivitySegment, next: ActivitySegment, maxGapSeconds: number): boolean {
  const previousEndedAtMs = timestampMs(previous.endedAt);
  const nextStartedAtMs = timestampMs(next.startedAt);
  if (!Number.isFinite(previousEndedAtMs) || !Number.isFinite(nextStartedAtMs)) return false;

  const gapSeconds = (nextStartedAtMs - previousEndedAtMs) / 1_000;
  return gapSeconds >= -maxGapSeconds && gapSeconds <= maxGapSeconds;
}

function normalizedDurationSeconds(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function normalizedIdentity(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizedTitle(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

function timestampMs(value: string): number {
  const result = new Date(value).getTime();
  return Number.isFinite(result) ? result : Number.POSITIVE_INFINITY;
}
