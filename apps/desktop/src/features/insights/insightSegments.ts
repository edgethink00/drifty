import { aggregateDeviceElapsedTime, clipDeviceElapsedTimeSegment, isFailedForegroundCaptureSegment, type ActivitySegment } from "@drifty/domain";
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
  // Query ranges end at HH:mm:59; display intervals include that final second.
  readonly endExclusiveMs?: number;
};

export function selectInsightSegments(input: InsightSegmentSelectionInput): ActivitySegment[] {
  const historySegments = filterSegmentsForRange(input.historySegments, input.range.start, input.range.end);
  const supplementalSegments = filterSegmentsForRange(input.supplementalSegments ?? [], input.range.start, input.range.end);
  const selectedDaySegments = filterSegmentsForRange(input.selectedDaySegments, input.range.start, input.range.end);
  // Trends reads history directly, outside the dashboard's filtered arrays, so
  // failed Windows foreground captures have to be dropped here as well.
  return aggregateDeviceElapsedTime(mergeActivitySegments(mergeActivitySegments(historySegments, supplementalSegments), selectedDaySegments)
    .filter((segment) => !isFailedForegroundCaptureSegment(segment)))
    .map(segment => clipDeviceElapsedTimeSegment(segment, { start: Date.parse(input.range.start), end: input.endExclusiveMs ?? Date.parse(input.range.end) }));
}
