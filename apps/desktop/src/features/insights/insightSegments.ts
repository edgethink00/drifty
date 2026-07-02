import type { ActivitySegment } from "@drifty/domain";
import { filterSegmentsForRange } from "../../lib/formatting";

type InsightSegmentRange = {
  readonly start: string;
  readonly end: string;
};

type InsightSegmentSelectionInput = {
  readonly historySegments: ActivitySegment[];
  readonly supplementalSegments?: ActivitySegment[];
  readonly selectedDaySegments: ActivitySegment[];
  readonly range: InsightSegmentRange;
};

export function selectInsightSegments(input: InsightSegmentSelectionInput): ActivitySegment[] {
  const historySegments = filterSegmentsForRange(input.historySegments, input.range.start, input.range.end);
  const supplementalSegments = filterSegmentsForRange(input.supplementalSegments ?? [], input.range.start, input.range.end);
  const selectedDaySegments = filterSegmentsForRange(input.selectedDaySegments, input.range.start, input.range.end);
  return mergeInsightSegments(mergeInsightSegments(historySegments, supplementalSegments), selectedDaySegments);
}

function mergeInsightSegments(historySegments: readonly ActivitySegment[], selectedDaySegments: readonly ActivitySegment[]): ActivitySegment[] {
  if (selectedDaySegments.length === 0) return [...historySegments];

  const segmentsById = new Map<string, ActivitySegment>();
  for (const segment of historySegments) {
    segmentsById.set(segment.id, segment);
  }
  for (const segment of selectedDaySegments) {
    const existing = segmentsById.get(segment.id) ?? null;
    segmentsById.set(segment.id, existing ? selectInsightSegment(existing, segment) : segment);
  }

  return Array.from(segmentsById.values());
}

function selectInsightSegment(existing: ActivitySegment, incoming: ActivitySegment): ActivitySegment {
  const existingEndedAtMs = new Date(existing.endedAt).getTime();
  const incomingEndedAtMs = new Date(incoming.endedAt).getTime();

  if (Number.isFinite(existingEndedAtMs) && Number.isFinite(incomingEndedAtMs)) {
    if (incomingEndedAtMs > existingEndedAtMs) return preserveClassification(incoming, existing);
    if (incomingEndedAtMs < existingEndedAtMs) return existing;
  }

  if (existing.classification && !incoming.classification) return existing;
  return incoming;
}

function preserveClassification(segment: ActivitySegment, fallbackSegment: ActivitySegment): ActivitySegment {
  if (segment.classification || !fallbackSegment.classification) return segment;
  return { ...segment, classification: fallbackSegment.classification };
}
