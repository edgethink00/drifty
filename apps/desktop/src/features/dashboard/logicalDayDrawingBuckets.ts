import { logicalDayEndExclusiveMs, logicalDayStartMs, normalizeStartOfDayMinutes } from "@drifty/domain";

export type LogicalDayDrawingInterval = {
  start: number;
  end: number;
};

export type LogicalDayDrawingBucket = {
  readonly index: number;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly intervals: readonly LogicalDayDrawingInterval[];
};

/**
 * Keep the fixed 24-hour drawing geometry while mapping the actual logical
 * day onto local clock buckets. A spring-forward gap leaves its clock buckets
 * empty; both occurrences of a fall-back hour fold into the same buckets.
 */
export function buildLogicalDayDrawingBuckets(
  day: string,
  bucketMinutes: number,
  startOfDayMinutes = 0,
): LogicalDayDrawingBucket[] {
  if (!(bucketMinutes > 0) || 1440 % bucketMinutes !== 0) return [];
  const normalizedBoundary = normalizeStartOfDayMinutes(startOfDayMinutes);
  const buckets = Array.from({ length: 1440 / bucketMinutes }, (_, index) => ({
    index,
    startMinute: index * bucketMinutes,
    endMinute: (index + 1) * bucketMinutes,
    intervals: [] as LogicalDayDrawingInterval[],
  }));
  const dayStart = logicalDayStartMs(day, normalizedBoundary);
  const dayEnd = logicalDayEndExclusiveMs(day, normalizedBoundary);
  const minuteMs = 60_000;

  for (let cursor = dayStart; cursor < dayEnd; cursor += minuteMs) {
    const intervalEnd = Math.min(dayEnd, cursor + minuteMs);
    const local = new Date(cursor);
    const clockMinute = local.getHours() * 60 + local.getMinutes();
    const logicalMinute = (clockMinute - normalizedBoundary + 1440) % 1440;
    const bucket = buckets[Math.floor(logicalMinute / bucketMinutes)];
    const previous = bucket.intervals[bucket.intervals.length - 1];
    if (previous?.end === cursor) previous.end = intervalEnd;
    else bucket.intervals.push({ start: cursor, end: intervalEnd });
  }

  return buckets;
}
