import type { ActivitySegment } from "@drifty/domain";

export const EMPTY_ACTIVITY_SEGMENTS: ActivitySegment[] = [];

export type LiveTailCursor = {
  readonly afterSegmentId: string | null;
  readonly afterEndedAt: string | null;
};

export function activitySegmentEndedAtMs(segment: ActivitySegment): number {
  const endedAtMs = new Date(segment.endedAt).getTime();
  return Number.isFinite(endedAtMs) ? endedAtMs : Number.NEGATIVE_INFINITY;
}

export function latestActivitySegmentCursor(segments: readonly ActivitySegment[]): LiveTailCursor {
  let latestSegment: ActivitySegment | null = null;
  let latestEndedAtMs = Number.NEGATIVE_INFINITY;

  for (const segment of segments) {
    const endedAtMs = activitySegmentEndedAtMs(segment);
    if (endedAtMs > latestEndedAtMs) {
      latestSegment = segment;
      latestEndedAtMs = endedAtMs;
      continue;
    }
    if (endedAtMs !== latestEndedAtMs || latestSegment === null) continue;

    const latestId = Number(latestSegment.id);
    const segmentId = Number(segment.id);
    if (Number.isFinite(segmentId) && (!Number.isFinite(latestId) || segmentId > latestId)) {
      latestSegment = segment;
    }
  }

  if (!latestSegment && segments.length > 0) {
    latestSegment = segments[segments.length - 1] ?? null;
  }

  return {
    afterSegmentId: latestSegment?.id ?? null,
    afterEndedAt: latestSegment?.endedAt ?? null,
  };
}

export function mergeActivitySegments(baseSegments: readonly ActivitySegment[], liveSegments: readonly ActivitySegment[]): ActivitySegment[] {
  if (liveSegments.length === 0) return [...baseSegments];

  const segmentsById = new Map<string, ActivitySegment>();
  for (const segment of baseSegments) {
    segmentsById.set(segment.id, segment);
  }
  for (const segment of liveSegments) {
    const existing = segmentsById.get(segment.id) ?? null;
    segmentsById.set(segment.id, existing ? selectActivitySegment(existing, segment) : segment);
  }

  return Array.from(segmentsById.values());
}

export function selectActivitySegment(existing: ActivitySegment, incoming: ActivitySegment): ActivitySegment {
  const existingEndedAtMs = activitySegmentEndedAtMs(existing);
  const incomingEndedAtMs = activitySegmentEndedAtMs(incoming);

  if (Number.isFinite(existingEndedAtMs) && Number.isFinite(incomingEndedAtMs)) {
    if (incomingEndedAtMs > existingEndedAtMs) return preserveClassification(incoming, existing);
    if (incomingEndedAtMs < existingEndedAtMs) return existing;
  }

  if (existing.classification && !incoming.classification) return existing;
  return incoming;
}

export function preserveClassification(segment: ActivitySegment, fallbackSegment: ActivitySegment): ActivitySegment {
  if (segment.classification || !fallbackSegment.classification) return segment;
  return { ...segment, classification: fallbackSegment.classification };
}
