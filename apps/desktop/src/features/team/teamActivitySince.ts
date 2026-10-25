import { activityTimeBounds, clipDeviceElapsedTimeSegment, type ActivitySegment } from "@drifty/domain";

/** Clip before either aggregation; preserve assignment ids and sampled density. */
export function teamActivitySince(segments: readonly ActivitySegment[], joinedAt: string): ActivitySegment[] {
  const since = Date.parse(joinedAt);
  if (!Number.isFinite(since)) return [];
  return segments.flatMap((segment) => {
    const bounds = activityTimeBounds(segment);
    const start = Math.max(since, bounds.start);
    if (!Number.isFinite(start) || !(bounds.end > start)) return [];
    if (bounds.start >= since) return [segment];
    const clipped = clipDeviceElapsedTimeSegment(segment, { start, end: bounds.end });
    return clipped.durationSeconds > 0 ? [{ ...clipped, startedAt: new Date(start).toISOString(), endedAt: new Date(bounds.end).toISOString() }] : [];
  });
}
