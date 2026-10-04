import { aggregateDeviceElapsedTime, activitySecondsWithinInterval, logicalDayStartMs } from "@drifty/domain";
import type { ActivitySegment } from "@drifty/domain";

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
  const slotDur = 15 * 60;
  const dayStartMs = logicalDayStartMs(day, startOfDayMinutes);
  const slots = Array.from({ length: 96 }, (_, index) => {
    const slotStartMs = dayStartMs + index * slotDur * 1000;
    const slotEndMs = slotStartMs + slotDur * 1000;
    let totalSeconds = 0;
    for (const seg of segments) {
      totalSeconds += activitySecondsWithinInterval(seg, slotStartMs, slotEndMs);
    }
    const minuteOfDay = (startOfDayMinutes + index * 15) % (24 * 60);
    return { index, minuteOfDay, hour: Math.floor(minuteOfDay / 60), quarter: Math.floor((minuteOfDay % 60) / 15), totalSeconds, ratio: 0 };
  });
  const peak = Math.max(...slots.map((s) => s.totalSeconds), 1);
  return slots.map((s) => ({ ...s, ratio: s.totalSeconds === 0 ? 0.04 : Math.max(s.totalSeconds / peak, 0.1) }));
}
