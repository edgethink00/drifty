import type { ActivitySegment, CurrentActivitySnapshot } from "@drifty/domain";
import { mergeActivitySegments } from "../../lib/activitySegments";
import { formatLocalDateTime, getLogicalDayRange } from "../../lib/formatting";

export const DRIFT_ALARM_TIMELINE_LOOKBACK_MS = 30 * 60 * 1000;
export const DRIFT_ALARM_SOURCE_SEGMENT_CACHE_LIMIT = 20;

export function rememberDriftAlarmSourceSegment(
  cache: Map<string, ActivitySegment>,
  sourceSegmentId: string | null,
  segment: ActivitySegment,
): void {
  if (!sourceSegmentId) return;
  cache.delete(sourceSegmentId);
  cache.set(sourceSegmentId, segment);

  while (cache.size > DRIFT_ALARM_SOURCE_SEGMENT_CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (oldest.done) return;
    cache.delete(oldest.value);
  }
}

// Live-AI retry cooldowns are keyed by candidate key (which embeds the segment
// endedAt, so keys never repeat). An expired cooldown reads the same as a
// missing one, so sweeping expired entries whenever a new cooldown is recorded
// keeps the map bounded over a long-running session.
export function pruneExpiredDriftAlarmAiRetries(retryAfterByKey: Map<string, number>, nowMs: number): void {
  for (const [key, retryAfterMs] of retryAfterByKey) {
    if (retryAfterMs <= nowMs) retryAfterByKey.delete(key);
  }
}

export function getDriftAlarmPollTimelineRange(day: string, startOfDayMinutes: number): { start: string; end: string } {
  const nowMs = Date.now();
  const selectedDayRange = getLogicalDayRange(day, day, startOfDayMinutes);
  const logicalDayStartMs = new Date(selectedDayRange.start).getTime();
  const lowerBoundMs = Number.isFinite(logicalDayStartMs) ? logicalDayStartMs : nowMs - DRIFT_ALARM_TIMELINE_LOOKBACK_MS;
  const startMs = Math.min(nowMs, Math.max(nowMs - DRIFT_ALARM_TIMELINE_LOOKBACK_MS, lowerBoundMs));

  return {
    start: formatLocalDateTime(startMs),
    end: formatLocalDateTime(nowMs),
  };
}

export function mergeDriftAlarmSegments(baseSegments: readonly ActivitySegment[], liveSegments: readonly ActivitySegment[]): ActivitySegment[] {
  return mergeActivitySegments(baseSegments, liveSegments);
}

export type DriftAlarmEvaluationInput = {
  readonly checkedAt?: Date;
  readonly snapshot: CurrentActivitySnapshot | null;
  readonly liveSegments: readonly ActivitySegment[];
  readonly updateRendererState?: boolean;
};

export type DriftAlarmEvaluator = (input: DriftAlarmEvaluationInput) => void;

export type DriftAlarmTrayPublishOptions = {
  readonly updateRendererState?: boolean;
};
