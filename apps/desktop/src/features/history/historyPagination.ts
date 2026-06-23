import type { ActivitySegment } from "@drifty/domain";

export const HISTORY_TIMELINE_PAGE_SIZE = 200;

export function mergeHistoryTimelinePages(
  currentSegments: readonly ActivitySegment[],
  olderSegments: readonly ActivitySegment[],
): ActivitySegment[] {
  if (olderSegments.length === 0) return [...currentSegments];

  const segmentsById = new Map<string, ActivitySegment>();
  for (const segment of olderSegments) {
    segmentsById.set(segment.id, segment);
  }
  for (const segment of currentSegments) {
    segmentsById.set(segment.id, segment);
  }

  return Array.from(segmentsById.values()).sort(compareActivitySegmentsChronologically);
}

function compareActivitySegmentsChronologically(left: ActivitySegment, right: ActivitySegment): number {
  const startedAtDelta = Date.parse(left.startedAt) - Date.parse(right.startedAt);
  if (startedAtDelta !== 0) return startedAtDelta;

  const leftId = Number(left.id);
  const rightId = Number(right.id);
  if (Number.isFinite(leftId) && Number.isFinite(rightId)) return leftId - rightId;

  return left.id.localeCompare(right.id);
}
