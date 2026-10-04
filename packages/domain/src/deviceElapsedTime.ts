import { preserveCapturedActivityDuration } from "./capturedActivityDuration";
import { isExcludedSegment, isFailedForegroundCaptureSegment, type ActivitySegment } from "./activity";

type WeightedInterval = { start: number; end: number; rate: number };
type ElapsedProjection = { start: number; end: number; intervals: WeightedInterval[] };
// Derived, in-memory metadata only. JSON/SQLite/sync DTOs never carry it.
const elapsedProjection = Symbol("deviceElapsedTime");
type ProjectedSegment = ActivitySegment & { [elapsedProjection]?: ElapsedProjection };

/**
 * All-device summaries count elapsed time once. Simultaneous devices share
 * that time equally; overlapping records on one device share its allocation.
 * IDs, timestamps and classification remain intact for timeline corrections.
 * Filter raw records to one device BEFORE calling this function.
 */
export function aggregateDeviceElapsedTime(segments: readonly ActivitySegment[]): ActivitySegment[] {
  // Preserve allocations when a consumer takes a subset of an already derived
  // array (e.g. only Focus). Reallocating that subset would double count it.
  if (segments.some(segment => (segment as ProjectedSegment)[elapsedProjection])) return segments.slice();

  if (new Set(segments.map(segment => segment.deviceId ?? "")).size < 2) return segments.slice();

  const records = segments.map(segment => {
    const start = Date.parse(segment.startedAt);
    const capturedEnd = Date.parse(segment.endedAt);
    const duration = segment.durationSeconds;
    const valid = Number.isFinite(start) && Number.isFinite(capturedEnd) && capturedEnd >= start
      && Number.isFinite(duration) && duration > 0
      && !isExcludedSegment(segment) && !isFailedForegroundCaptureSegment(segment);
    // The first sample is a point with positive duration. Sampling can also
    // leave duration slightly longer than its timestamp span. Keep that sample
    // as a forward interval rather than dropping or growing recorded time.
    const end = valid ? Math.max(capturedEnd, start + duration * 1000) : start;
    return { segment, start, end, valid, device: segment.deviceId ?? "", density: valid ? duration * 1000 / (end - start) : 0 };
  });
  if (new Set(records.filter(record => record.valid).map(record => record.device)).size < 2) return segments.slice();

  const intervals = records.map(() => [] as WeightedInterval[]);
  const events = records.flatMap((record, index) => record.valid
    ? [{ time: record.start, index, entering: true }, { time: record.end, index, entering: false }]
    : []).sort((a, b) => a.time - b.time);
  const activeByDevice = new Map<string, Set<number>>();
  let cursor = 0;
  while (cursor < events.length) {
    const start = events[cursor].time;
    while (cursor < events.length && events[cursor].time === start) {
      const event = events[cursor++];
      const device = records[event.index].device;
      if (event.entering) {
        const active = activeByDevice.get(device) ?? new Set<number>();
        active.add(event.index);
        activeByDevice.set(device, active);
      } else {
        const active = activeByDevice.get(device);
        active?.delete(event.index);
        if (active?.size === 0) activeByDevice.delete(device);
      }
    }
    if (cursor === events.length) break;
    const end = events[cursor].time;
    const devices = [...activeByDevice.values()].map(active => {
      let density = 0;
      let sum = 0;
      for (const index of active) {
        density = Math.max(density, records[index].density);
        sum += records[index].density;
      }
      return { active, density, sum };
    });
    // Sparse sampled spans cannot establish attention in their gaps. Use the
    // greatest recorded density, never inflate a span to full activity.
    const unionDensity = Math.max(0, ...devices.map(device => device.density));
    const densitySum = devices.reduce((sum, device) => sum + device.density, 0);
    for (const device of devices) {
      for (const index of device.active) {
        // Another device elsewhere in the queried week must not change a
        // local-only day's existing sampling/overlapping-import semantics.
        // Allocate only intervals where different devices actually compete.
        const rate = devices.length === 1 ? records[index].density
          : unionDensity * device.density / densitySum * records[index].density / device.sum;
        const previous = intervals[index][intervals[index].length - 1];
        if (previous?.end === start && previous.rate === rate) previous.end = end;
        else intervals[index].push({ start, end, rate });
      }
    }
  }
  return records.map((record, index): ProjectedSegment => preserveCapturedActivityDuration(record.segment, {
    ...record.segment,
    durationSeconds: intervals[index].reduce((total, interval) => total + (interval.end - interval.start) / 1000 * interval.rate, 0),
    [elapsedProjection]: { start: record.start, end: record.end, intervals: intervals[index] },
  }));
}

/** Timestamp bounds for bucket clipping, including derived point samples. */
export function activityTimeBounds(segment: ActivitySegment): { start: number; end: number } {
  const projection = (segment as ProjectedSegment)[elapsedProjection];
  return projection ?? { start: Date.parse(segment.startedAt), end: Date.parse(segment.endedAt) };
}

/** Exact allocated time within a day/hour/bucket. Legacy single-device spans
 * keep their existing rounded timestamp semantics. Do not round each weighted
 * contribution: three devices must still sum to exactly one elapsed minute. */
export function activitySecondsWithinInterval(segment: ActivitySegment, start: number, end: number): number {
  const projection = (segment as ProjectedSegment)[elapsedProjection];
  if (projection) return projection.intervals.reduce((total, interval) => total
    + Math.max(0, Math.min(end, interval.end) - Math.max(start, interval.start)) / 1000 * interval.rate, 0);
  const bounds = activityTimeBounds(segment);
  const overlap = Math.min(end, bounds.end) - Math.max(start, bounds.start);
  return Number.isFinite(overlap) ? Math.max(0, Math.round(overlap / 1000)) : 0;
}

/** Clip a derived summary to a logical window, or to a virtual project slice.
 * Raw single-device records retain their existing duration semantics. */
export function clipDeviceElapsedTimeSegment(segment: ActivitySegment, window?: { start: number; end: number }): ActivitySegment {
  const projection = (segment as ProjectedSegment)[elapsedProjection];
  if (!projection) return segment;
  const start = window?.start ?? Date.parse(segment.startedAt);
  const end = window?.end ?? (segment.startedAt === segment.endedAt ? projection.end : Date.parse(segment.endedAt));
  const intervals = projection.intervals.flatMap(interval => {
    const clippedStart = Math.max(start, interval.start);
    const clippedEnd = Math.min(end, interval.end);
    return clippedEnd > clippedStart ? [{ ...interval, start: clippedStart, end: clippedEnd }] : [];
  });
  return {
    ...segment,
    durationSeconds: intervals.reduce((sum, interval) => sum + (interval.end - interval.start) / 1000 * interval.rate, 0),
    [elapsedProjection]: { start: Math.max(start, projection.start), end: Math.min(end, projection.end), intervals },
  } as ProjectedSegment;
}
