import type { ActivitySegment } from "@drifty/domain";
import { mergeActivitySegments } from "../../lib/activitySegments";
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
  return mergeActivitySegments(mergeActivitySegments(historySegments, supplementalSegments), selectedDaySegments);
}
