import { aggregateDeviceElapsedTime, activitySecondsWithinInterval } from "@drifty/domain";
import type { ActivitySegment } from "@drifty/domain";
import { buildLogicalDayDrawingBuckets } from "./logicalDayDrawingBuckets";

export type DayFieldSlot = {
  index: number;
  minuteOfDay: number;
  hour: number;
  quarter: number;
  totalSeconds: number;
  ratio: number;
};

export function buildQuarterHourDayField(segments: ActivitySegment[], day: string, startOfDayMinutes = 0): DayFieldSlot[] {
  segments = aggregateDeviceElapsedTime(segments);
  const slots = buildLogicalDayDrawingBuckets(day, 15, startOfDayMinutes).map((bucket) => {
    const index = bucket.index;
    let totalSeconds = 0;
    for (const seg of segments) {
      totalSeconds += bucket.intervals.reduce(
        (sum, interval) => sum + activitySecondsWithinInterval(seg, interval.start, interval.end),
        0,
      );
    }
    const minuteOfDay = (startOfDayMinutes + index * 15) % (24 * 60);
    return { index, minuteOfDay, hour: Math.floor(minuteOfDay / 60), quarter: Math.floor((minuteOfDay % 60) / 15), totalSeconds, ratio: 0 };
  });
  const peak = Math.max(...slots.map((s) => s.totalSeconds), 1);
  return slots.map((s) => ({ ...s, ratio: s.totalSeconds === 0 ? 0.04 : Math.max(s.totalSeconds / peak, 0.1) }));
}
