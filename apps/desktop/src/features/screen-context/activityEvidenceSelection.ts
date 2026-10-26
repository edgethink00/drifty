import { activityTimeBounds, isRemoteDeviceSegment, type ActivitySegment } from "@drifty/domain";
import { buildLogicalDayDrawingBuckets } from "../dashboard/logicalDayDrawingBuckets";

export interface ActivityEvidenceSelection {
  readonly recordIds: readonly string[];
  readonly windows: readonly (readonly [number, number])[];
}
/** Real source intersections carried by a rendered card, before its minute
 * geometry is rounded. These remain view filters, never native authority. */
export interface ActivityEvidenceSourceRange {
  readonly segmentId: string;
  readonly startMs: number;
  readonly endMs: number;
}
const MAX_ID = 9223372036854775807n;
function localId(segment: ActivitySegment): boolean {
  return !isRemoteDeviceSegment(segment) && /^[1-9]\d{0,18}$/.test(segment.id) && BigInt(segment.id) <= MAX_ID;
}

export function activityEvidenceSelectionForSourceRanges(
  segments: readonly ActivitySegment[],
  ranges: readonly ActivityEvidenceSourceRange[],
): ActivityEvidenceSelection | null {
  const local = segments.filter(localId);
  const recordIds = [...new Set(local.map(segment => segment.id))];
  if (!recordIds.length || recordIds.length > 64) return null;
  const byId = new Map(local.map(segment => [segment.id, activityTimeBounds(segment)]));
  const intersections: [number, number][] = [];
  for (const range of ranges) {
    if (!Number.isSafeInteger(range.startMs) || !Number.isSafeInteger(range.endMs) || range.startMs >= range.endMs) return null;
    const bound = byId.get(range.segmentId);
    if (!bound) continue;
    const start = Math.max(range.startMs, bound.start);
    const end = Math.min(range.endMs, bound.end);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) intersections.push([Math.ceil(start), Math.ceil(end)]);
  }
  intersections.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const windows: [number, number][] = [];
  for (const range of intersections) {
    const prior = windows[windows.length - 1];
    if (prior && range[0] <= prior[1]) prior[1] = Math.max(prior[1], range[1]);
    else windows.push(range);
  }
  return windows.length && windows.length <= 64 ? { recordIds, windows } : null;
}

/** View filters only. Native resolves current row identity/provenance again.
 * Actual drawing intervals preserve DST folds/gaps and non-midnight days.
 * Clamp each interval to the selected local records before merging. */
export function activityEvidenceSelection(
  segments: readonly ActivitySegment[],
  day: string,
  startMinute: number,
  endMinute: number,
  boundaryMinutes: number,
): ActivityEvidenceSelection | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(startMinute) || !Number.isFinite(endMinute)
    || startMinute < 0 || endMinute > 1440 || startMinute >= endMinute) return null;
  const local = segments.filter(localId);
  const recordIds = [...new Set(local.map(segment => segment.id))];
  if (!recordIds.length || recordIds.length > 64) return null;
  const ranges: [number, number][] = [];
  const buckets = buildLogicalDayDrawingBuckets(day, 1, boundaryMinutes);
  const bounds = local.map(activityTimeBounds).filter(b => Number.isFinite(b.start) && Number.isFinite(b.end) && b.end > b.start);
  for (const bucket of buckets) {
    if (bucket.startMinute < startMinute || bucket.startMinute >= endMinute) continue;
    for (const interval of bucket.intervals) for (const bound of bounds) {
      const start = Math.max(interval.start, bound.start);
      const end = Math.min(interval.end, bound.end);
      if (end > start) ranges.push([Math.ceil(start), Math.ceil(end)]);
    }
  }
  ranges.sort((a,b) => a[0] - b[0] || a[1] - b[1]);
  const windows: [number,number][] = [];
  for (const range of ranges) {
    const prior = windows[windows.length-1];
    if (prior && range[0] <= prior[1]) prior[1] = Math.max(prior[1], range[1]);
    else windows.push(range);
  }
  return windows.length && windows.length <= 64 ? { recordIds, windows } : null;
}

/** The panel's drawn card already has absolute bounds. Keep only its selected
 * local records and their real intersections; gaps never become evidence. */
export function activityEvidenceSelectionForStretch(
  segments: readonly ActivitySegment[],
  startMs: number,
  endMs: number,
): ActivityEvidenceSelection | null {
  if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) || startMs >= endMs) return null;
  const local = segments.filter(localId);
  const recordIds = [...new Set(local.map(segment => segment.id))];
  if (!recordIds.length || recordIds.length > 64) return null;
  const ranges: [number, number][] = [];
  for (const segment of local) {
    const bound = activityTimeBounds(segment);
    const start = Math.max(startMs, bound.start);
    const end = Math.min(endMs, bound.end);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) ranges.push([Math.ceil(start), Math.ceil(end)]);
  }
  ranges.sort((a,b) => a[0] - b[0] || a[1] - b[1]);
  const windows: [number,number][] = [];
  for (const range of ranges) {
    const prior = windows[windows.length-1];
    if (prior && range[0] <= prior[1]) prior[1] = Math.max(prior[1], range[1]);
    else windows.push(range);
  }
  return windows.length && windows.length <= 64 ? { recordIds, windows } : null;
}
