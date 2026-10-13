import { aggregateDeviceElapsedTime, clipDeviceElapsedTimeSegment, classifyActivity } from "@drifty/domain";
import type { ActivitySegment, ClassificationOptions } from "@drifty/domain";
import { buildCompactActivityBreakdown } from "./compactChartBreakdown";
import type { CompactClassificationBreakdownRow } from "./HoverCards";
import { splitSegmentIntoDayOverlaps } from "./weekCalendar";
import { WEEK_NO_PROJECT_KEY } from "./weekProjectView";

type WeekDashboardColorMode = "category" | "productivity" | "project";

type WeekBreakdownHoverInput = {
  readonly segments: readonly ActivitySegment[];
  readonly projectBySegmentId?: ReadonlyMap<string, string>;
  readonly classificationOptions: ClassificationOptions;
  readonly startDay: string;
  readonly endDay: string;
  readonly startOfDayMinutes: number;
  readonly mode: WeekDashboardColorMode;
  readonly key: string | readonly string[];
  readonly day?: string;
};

/**
 * Builds the app/site rows used by the Week Breakdown hover cards. Segment
 * durations are clipped to the requested logical day or week so the detail
 * rows add up to the same window as the chart slice, including overnight
 * activity that crosses a configured day boundary.
 */
export function buildWeekBreakdownHoverRows({
  segments,
  projectBySegmentId,
  classificationOptions,
  startDay,
  endDay,
  startOfDayMinutes,
  mode,
  key,
  day,
}: WeekBreakdownHoverInput): CompactClassificationBreakdownRow[] {
  const rangeStartDay = day ?? startDay;
  const rangeEndDay = day ?? endDay;
  const clippedSegments: ActivitySegment[] = [];
  const keys = typeof key === "string" ? [key] : key;

  for (const segment of aggregateDeviceElapsedTime(segments)) {
    const classification = classifyActivity(segment, classificationOptions);
    const matches = mode === "project"
      ? keys.includes(projectBySegmentId?.get(segment.id) ?? WEEK_NO_PROJECT_KEY)
      : mode === "productivity"
      ? keys.includes(classification.productivity)
      : keys.includes(classification.category);
    if (!matches) continue;

    for (const overlap of splitSegmentIntoDayOverlaps(segment, rangeStartDay, rangeEndDay, startOfDayMinutes, { sampledTime: mode === "project" })) {
      clippedSegments.push(clipDeviceElapsedTimeSegment({
        ...segment,
        startedAt: overlap.startedAt.toISOString(),
        endedAt: overlap.endedAt.toISOString(),
        durationSeconds: overlap.durationSeconds,
      }));
    }
  }

  return buildCompactActivityBreakdown(clippedSegments);
}
