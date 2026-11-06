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

/**
 * Keep only the parts of records inside the given stretches of time (a team's hours).
 * A record reaching into several stretches keeps its id on the first part; the later
 * parts get ids of their own, so no stored project assignment follows them and the
 * team receives less, never more.
 */
export function teamActivityWithinSpans(
  segments: readonly ActivitySegment[],
  spans: readonly { readonly start: number; readonly end: number }[],
): ActivitySegment[] {
  return segments.flatMap((segment) => {
    const bounds = activityTimeBounds(segment);
    if (!Number.isFinite(bounds.start) || !(bounds.end > bounds.start)) return [];
    const parts: ActivitySegment[] = [];
    for (const span of spans) {
      const start = Math.max(span.start, bounds.start);
      const end = Math.min(span.end, bounds.end);
      if (!(end > start)) continue;
      if (start === bounds.start && end === bounds.end) {
        parts.push(segment);
        continue;
      }
      const clipped = clipDeviceElapsedTimeSegment(segment, { start, end });
      if (!(clipped.durationSeconds > 0)) continue;
      parts.push({
        ...clipped,
        id: parts.length === 0 ? segment.id : `${segment.id}~${parts.length}`,
        startedAt: new Date(start).toISOString(),
        endedAt: new Date(end).toISOString(),
      });
    }
    return parts;
  });
}
