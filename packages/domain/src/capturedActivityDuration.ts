import type { ActivitySegment } from "./activity";

// Derived display time must not change the captured evidence used by the
// 30-second feed rules. This metadata stays in memory, never in JSON/SQLite/sync.
const capturedDuration = Symbol("capturedActivityDuration");
type DerivedActivity = ActivitySegment & { [capturedDuration]?: number };

export function capturedActivityDurationSeconds(segment: ActivitySegment): number {
  return (segment as DerivedActivity)[capturedDuration] ?? segment.durationSeconds;
}

export function preserveCapturedActivityDuration<T extends ActivitySegment>(source: ActivitySegment, derived: T): T {
  return { ...derived, [capturedDuration]: capturedActivityDurationSeconds(source) };
}
