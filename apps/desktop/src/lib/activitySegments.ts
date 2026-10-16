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
  let highestIdSegment: ActivitySegment | null = null;
  let highestId = Number.NEGATIVE_INFINITY;

  for (const segment of segments) {
    // Insert order and wall time are independent after history imports or a
    // clock correction. Advancing only the newest timestamp can replay the
    // same bounded page forever and hide later captures.
    const id = Number(segment.id);
    if (Number.isFinite(id) && id > highestId) {
      highestIdSegment = segment;
      highestId = id;
    }
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
    afterSegmentId: highestIdSegment?.id ?? latestSegment?.id ?? null,
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
  const existingRevision = activitySegmentRevision(existing);
  const incomingRevision = activitySegmentRevision(incoming);
  if (existingRevision !== null && incomingRevision !== null && existingRevision !== incomingRevision) {
    // A newer local row revision is authoritative even when an idle trim made
    // the interval shorter or removed a classification. Do not fill fields
    // from the stale copy across this boundary.
    return incomingRevision > existingRevision ? incoming : existing;
  }

  const existingEndedAtMs = activitySegmentEndedAtMs(existing);
  const incomingEndedAtMs = activitySegmentEndedAtMs(incoming);

  if (Number.isFinite(existingEndedAtMs) && Number.isFinite(incomingEndedAtMs)) {
    if (incomingEndedAtMs > existingEndedAtMs) return preserveClassification(incoming, existing);
    if (incomingEndedAtMs < existingEndedAtMs) return existing;
  }

  if (existing.classification && !incoming.classification) return existing;
  return incoming;
}

function activitySegmentRevision(segment: ActivitySegment): number | null {
  return typeof segment.revision === "number" && Number.isFinite(segment.revision)
    ? segment.revision
    : null;
}

export function preserveClassification(segment: ActivitySegment, fallbackSegment: ActivitySegment): ActivitySegment {
  if (segment.classification || !fallbackSegment.classification) return segment;
  return { ...segment, classification: fallbackSegment.classification };
}
